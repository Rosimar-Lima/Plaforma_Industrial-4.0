'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { validateTelemetry, validateGatewayStatus } = require('./validation');
const { createStreamHub } = require('./stream');
const { createConnectionTracker } = require('./connection');
const {
  DEFAULT_SHIFT_HOURS,
  DEFAULT_SHIFT_START_HOUR,
  DEFAULT_TIME_ZONE,
  MAX_BUCKETS,
} = require('./production');

function parseLimit(value, { fallback = 100, max = 1000 } = {}) {
  if (value === undefined || value === '') return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return null;
  return Math.min(limit, max);
}

function parseDate(value) {
  if (value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function createApp({
  repository,
  telemetryLimit = '100kb',
  nominalCapacityPerHour = 400,
  dashboardDir = null,
  systemStatusPath = null,
  productionSettings = {
    timeZone: DEFAULT_TIME_ZONE,
    shiftStartHour: DEFAULT_SHIFT_START_HOUR,
    shiftHours: DEFAULT_SHIFT_HOURS,
  },
  streamHub = createStreamHub(),
  gatewayStaleMs = 10000,
} = {}) {
  if (!repository) {
    throw new Error('repository é obrigatório');
  }

  const app = express();
  app.locals.streamHub = streamHub;
  app.disable('x-powered-by');
  app.use(express.json({ limit: telemetryLimit }));

  const connectionTracker = createConnectionTracker({ staleMs: gatewayStaleMs });

  function publishConnection(machineId, action, connection) {
    streamHub.broadcast('connection', { machineId, action, connection });
  }

  const sweepTimer = setInterval(() => {
    for (const result of connectionTracker.sweep()) {
      publishConnection(result.machineId, 'lost', result.view);
    }
  }, Math.max(1000, Math.min(5000, gatewayStaleMs / 2)));
  sweepTimer.unref?.();

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/telemetry', async (req, res, next) => {
    const result = validateTelemetry(req.body);

    if (!result.ok) {
      res.status(400).json({ error: 'invalid_payload', details: result.errors });
      return;
    }

    try {
      const saved = await repository.ingestTelemetry(result.value);
      streamHub.broadcast('telemetry', {
        machineId: result.value.machineId,
        timestamp: result.value.timestamp,
        plcVersion: result.value.plcVersion,
        line: result.value.line,
        production: result.value.production,
      });
      if (saved.productionTotal) {
        streamHub.broadcast('production', {
          machineId: result.value.machineId,
          action: saved.productionReset ? 'reset' : 'update',
          totals: saved.productionTotal,
        });
      }
      for (const event of saved.alerts ?? []) {
        streamHub.broadcast('alert', {
          machineId: result.value.machineId,
          action: event.action,
          alert: event.alert,
        });
      }
      for (const event of saved.maintenance ?? []) {
        streamHub.broadcast('maintenance', {
          machineId: result.value.machineId,
          action: event.action,
          order: event.order,
        });
      }
      res.status(202).json({
        status: 'accepted',
        machineId: result.value.machineId,
        recordedAt: saved.recordedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/gateway/status', async (req, res, next) => {
    const result = validateGatewayStatus(req.body);

    if (!result.ok) {
      res.status(400).json({ error: 'invalid_payload', details: result.errors });
      return;
    }

    try {
      const { view, events } = connectionTracker.update(
        result.value.machineId,
        result.value
      );
      publishConnection(result.value.machineId, 'update', view);
      for (const event of events) {
        publishConnection(result.value.machineId, event, view);
      }
      res.status(202).json({ status: 'accepted', connection: view });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines', async (req, res, next) => {
    try {
      const machines = await repository.listMachines();
      res.json({ machines });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines/:id/connection', async (req, res, next) => {
    const machineId = Number(req.params.id);
    if (!Number.isInteger(machineId) || machineId < 1) {
      res.status(400).json({ error: 'invalid_machine_id' });
      return;
    }

    try {
      // O gateway reporta o código (Linha-01), mas a URL usa o id numérico.
      // Resolve o código para consultar o mesmo heartbeat usado no stream.
      const machines = await repository.listMachines();
      const machine = machines.find((item) => Number(item.id) === machineId);
      res.json(connectionTracker.view(machine?.code ?? String(machineId)));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines/:id/telemetry', async (req, res, next) => {
    const machineId = Number(req.params.id);
    if (!Number.isInteger(machineId) || machineId < 1) {
      res.status(400).json({ error: 'invalid_machine_id' });
      return;
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if ((req.query.from && from === null) || (req.query.to && to === null)) {
      res.status(400).json({ error: 'invalid_period' });
      return;
    }

    const limit = parseLimit(req.query.limit);
    if (limit === null) {
      res.status(400).json({ error: 'invalid_limit' });
      return;
    }

    try {
      const samples = await repository.listTelemetry(machineId, { from, to, limit });
      res.json({ machineId, limit, samples });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines/:id/oee', async (req, res, next) => {
    const machineId = Number(req.params.id);
    if (!Number.isInteger(machineId) || machineId < 1) {
      res.status(400).json({ error: 'invalid_machine_id' });
      return;
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if ((req.query.from && from === null) || (req.query.to && to === null)) {
      res.status(400).json({ error: 'invalid_period' });
      return;
    }

    let nominal = nominalCapacityPerHour;
    if (req.query.nominalCapacityPerHour !== undefined) {
      const parsed = Number(req.query.nominalCapacityPerHour);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400).json({ error: 'invalid_nominal_capacity' });
        return;
      }
      nominal = parsed;
    }

    try {
      const indicators = await repository.getOee(machineId, {
        from,
        to,
        nominalCapacityPerHour: nominal,
      });
      res.json({ machineId, from, to, ...indicators });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines/:id/production/total', async (req, res, next) => {
    const machineId = Number(req.params.id);
    if (!Number.isInteger(machineId) || machineId < 1) {
      res.status(400).json({ error: 'invalid_machine_id' });
      return;
    }

    try {
      const totals = await repository.getProductionTotal(machineId);
      res.json(totals);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines/:id/production', async (req, res, next) => {
    const machineId = Number(req.params.id);
    if (!Number.isInteger(machineId) || machineId < 1) {
      res.status(400).json({ error: 'invalid_machine_id' });
      return;
    }

    const bucket = req.query.bucket ?? 'hour';
    if (!['hour', 'shift'].includes(bucket)) {
      res.status(400).json({ error: 'invalid_bucket' });
      return;
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if ((req.query.from && from === null) || (req.query.to && to === null)) {
      res.status(400).json({ error: 'invalid_period' });
      return;
    }

    const toMs = to ? Date.parse(to) : Date.now();
    const fromMs = from ? Date.parse(from) : toMs - 24 * 3600000;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      res.status(400).json({ error: 'invalid_period' });
      return;
    }

    const bucketHours = bucket === 'hour' ? 1 : productionSettings.shiftHours;
    if (Math.ceil((toMs - fromMs) / 3600000 / bucketHours) > MAX_BUCKETS) {
      res.status(400).json({ error: 'range_too_large' });
      return;
    }

    try {
      const history = await repository.getProductionHistory(machineId, {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        bucket,
        ...productionSettings,
        now: toMs,
      });
      res.json({ machineId, ...history });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines/:id/alerts', async (req, res, next) => {
    const machineId = Number(req.params.id);
    if (!Number.isInteger(machineId) || machineId < 1) {
      res.status(400).json({ error: 'invalid_machine_id' });
      return;
    }

    const status = req.query.status ?? 'open';
    if (!['open', 'all'].includes(status)) {
      res.status(400).json({ error: 'invalid_status' });
      return;
    }

    const limit = parseLimit(req.query.limit, { fallback: 20, max: 200 });
    if (limit === null) {
      res.status(400).json({ error: 'invalid_limit' });
      return;
    }

    try {
      const alerts = await repository.listAlerts(machineId, { status, limit });
      res.json({ machineId, status, limit, alerts });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/alerts/:id/resolve', async (req, res, next) => {
    const alertId = Number(req.params.id);
    if (!Number.isInteger(alertId) || alertId < 1) {
      res.status(400).json({ error: 'invalid_alert_id' });
      return;
    }

    try {
      const alert = await repository.resolveAlert(alertId);
      if (!alert) {
        res.status(404).json({ error: 'alert_not_found' });
        return;
      }

      streamHub.broadcast('alert', {
        machineId: alert.machine_id,
        action: 'resolved',
        alert,
      });

      res.json({ alert });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/machines/:id/maintenance', async (req, res, next) => {
    const machineId = Number(req.params.id);
    if (!Number.isInteger(machineId) || machineId < 1) {
      res.status(400).json({ error: 'invalid_machine_id' });
      return;
    }

    try {
      const overview = await repository.getMaintenanceOverview(machineId);
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/maintenance/orders/:id/send', async (req, res, next) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) {
      res.status(400).json({ error: 'invalid_maintenance_order_id' });
      return;
    }

    try {
      const order = await repository.sendMaintenanceOrder(orderId);
      if (!order) {
        res.status(404).json({ error: 'maintenance_order_not_found' });
        return;
      }

      streamHub.broadcast('maintenance', {
        machineId: order.machine_id,
        action: 'sent',
        order,
      });

      res.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/maintenance/orders/:id/cancel', async (req, res, next) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) {
      res.status(400).json({ error: 'invalid_maintenance_order_id' });
      return;
    }

    try {
      const order = await repository.cancelMaintenanceOrder(orderId);
      if (!order) {
        res.status(404).json({ error: 'maintenance_order_not_found' });
        return;
      }

      streamHub.broadcast('maintenance', {
        machineId: order.machine_id,
        action: 'cancelled',
        order,
      });

      res.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/maintenance/orders/:id/complete', async (req, res, next) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) {
      res.status(400).json({ error: 'invalid_maintenance_order_id' });
      return;
    }

    try {
      const order = await repository.completeMaintenanceOrder(orderId);
      if (!order) {
        res.status(404).json({ error: 'maintenance_order_not_found' });
        return;
      }

      streamHub.broadcast('maintenance', {
        machineId: order.machine_id,
        action: 'completed',
        order,
      });

      res.json({ order });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/integrations/sap/outbox', async (req, res, next) => {
    const limit = parseLimit(req.query.limit, { fallback: 20, max: 100 });
    if (limit === null) {
      res.status(400).json({ error: 'invalid_limit' });
      return;
    }

    try {
      const outbox = await repository.listSapOutbox({ limit });
      res.json({ limit, outbox });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/system/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const statusFile =
      systemStatusPath || (dashboardDir ? path.join(dashboardDir, 'system-status.json') : null);
    const idle = {
      state: 'idle',
      action: null,
      steps: [],
      message: 'Nenhuma operação de sistema em andamento.',
      updatedAt: null,
    };

    if (!statusFile) {
      res.json(idle);
      return;
    }

    try {
      res.json({ ...idle, ...JSON.parse(fs.readFileSync(statusFile, 'utf8')) });
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.json(idle);
        return;
      }
      res.status(500).json({ error: 'system_status_unavailable' });
    }
  });

  if (dashboardDir) {
    app.use(express.static(dashboardDir, { extensions: ['html'] }));
  }

  app.get('/api/stream', (req, res) => {
    streamHub.subscribe(req, res);
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof RangeError) {
      res.status(400).json({ error: 'range_too_large' });
      return;
    }

    if (error.status === 400 || error.statusCode === 400) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    console.error(error);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = {
  createApp,
};
