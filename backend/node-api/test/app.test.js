'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createApp } = require('../src/app');

function validPayload() {
  return {
    machineId: 'machine-01',
    timestamp: '2026-01-01T00:00:00.000Z',
    plcVersion: '1.0.0',
    line: {
      step: 2,
      running: true,
      conveyorOn: false,
      evOn: true,
      atOn: false,
      sensorS1: true,
      sensorS2: false,
      bottlePositioned: true,
      evInterlock: true,
      atInterlock: false,
      fillPercent: 42,
    },
    production: { filled: 10, capped: 9, total: 9 },
  };
}

function createFakeRepository() {
  const calls = [];
  const telemetryCalls = [];
  const oeeCalls = [];
  const productionCalls = [];
  const alertsCalls = [];
  const resolveCalls = [];
  return {
    calls,
    telemetryCalls,
    oeeCalls,
    productionCalls,
    alertsCalls,
    resolveCalls,
    async ingestTelemetry(record) {
      calls.push(record);
      return { machineId: record.machineId, recordedAt: record.timestamp };
    },
    async listMachines() {
      return [{ id: 1, code: 'machine-01', name: 'machine-01', location: null }];
    },
    async listTelemetry(machineId, options) {
      telemetryCalls.push({ machineId, options });
      return [{ id: 10, recorded_at: '2026-01-01T00:00:00.000Z', payload: {} }];
    },
    async getOee(machineId, options) {
      oeeCalls.push({ machineId, options });
      return {
        availability: 0.5,
        performance: 0.5,
        quality: 0.9,
        oee: 0.225,
        produced: 200,
        good: 180,
        operatingTimeMs: 3600000,
        plannedTimeMs: 7200000,
        nominalCapacityPerHour: options.nominalCapacityPerHour,
      };
    },
    async getProductionHistory(machineId, options) {
      productionCalls.push({ machineId, options });
      return {
        bucket: options.bucket,
        timeZone: options.timeZone,
        shiftStartHour: options.shiftStartHour,
        shiftHours: options.shiftHours,
        from: options.from,
        to: options.to,
        totals: {
          produced: 120,
          good: 118,
          scrap: 2,
          quality: 0.9833,
          operatingTimeMs: 3600000,
          stoppedTimeMs: 0,
          plannedTimeMs: 3600000,
          availability: 1,
        },
        buckets: [
          {
            start: '2026-01-01T12:00:00.000Z',
            end: '2026-01-01T13:00:00.000Z',
            label: '09:00',
            produced: 120,
            good: 118,
            scrap: 2,
            quality: 0.9833,
            operatingTimeMs: 3600000,
            stoppedTimeMs: 0,
            plannedTimeMs: 3600000,
            availability: 1,
          },
        ],
      };
    },
    async listAlerts(machineId, options) {
      alertsCalls.push({ machineId, options });
      return [
        {
          id: 7,
          machine_id: machineId,
          sensor_code: 'fillPercent',
          message: 'Nível de envase abaixo do limite mínimo.',
          severity: 'warning',
          created_at: '2026-01-01T00:00:00.000Z',
          resolved_at: null,
        },
      ];
    },
    async resolveAlert(id) {
      resolveCalls.push(id);
      if (id !== 7) return null;
      return {
        id,
        machine_id: 1,
        sensor_code: 'fillPercent',
        message: 'Nível de envase abaixo do limite mínimo.',
        severity: 'warning',
        created_at: '2026-01-01T00:00:00.000Z',
        resolved_at: '2026-01-01T00:01:00.000Z',
      };
    },
    async getMaintenanceOverview(machineId) {
      return {
        machineId,
        warnRatio: 0.8,
        components: [
          {
            code: 'fill-valve',
            name: 'Válvula de envase',
            status: 'warning',
            metric: 'cycles',
            unit: 'ciclos',
            usageRatio: 0.85,
            usage: 340,
            mtbf: 400,
            remaining: 60,
            order: { id: 3, status: 'planned', priority: 'high' },
          },
          {
            code: 'conveyor-bearing',
            name: 'Rolamento da esteira',
            status: 'warning',
            metric: 'hours',
            unit: 'h',
            usageRatio: 0.8,
            usage: 160,
            mtbf: 200,
            remaining: 40,
            order: null,
          },
        ],
        orders: [
          {
            id: 3,
            machine_id: machineId,
            component_code: 'fill-valve',
            status: 'planned',
            priority: 'high',
            source_usage: 340,
            source_unit: 'ciclos',
            parts: [{ code: 'KIT-VAL-FILL', name: 'Kit', quantity: 1, status: 'reserved' }],
            sap: { external_id: 'SAP-3-X', status: 'sent' },
          },
        ],
      };
    },
    async sendMaintenanceOrder(id) {
      if (id !== 3) return null;
      return {
        id,
        machine_id: 1,
        component_code: 'fill-valve',
        status: 'in_progress',
        priority: 'high',
      };
    },
    async cancelMaintenanceOrder(id) {
      if (id !== 3) return null;
      return {
        id,
        machine_id: 1,
        component_code: 'fill-valve',
        status: 'cancelled',
        priority: 'high',
      };
    },
    async completeMaintenanceOrder(id) {
      if (id !== 3) return null;
      return {
        id,
        machine_id: 1,
        component_code: 'fill-valve',
        status: 'completed',
        priority: 'high',
        completed_at: '2026-01-01T00:10:00.000Z',
      };
    },
    async listSapOutbox({ limit = 20 } = {}) {
      return [
        {
          id: 1,
          order_id: 3,
          event_type: 'maintenance_order.created',
          status: 'sent',
          external_id: 'SAP-3-X',
          payload: {},
          created_at: '2026-01-01T00:00:00.000Z',
          sent_at: '2026-01-01T00:00:00.000Z',
        },
      ].slice(0, limit);
    },
  };
}

async function startApp(repository, options = {}) {
  const app = createApp({ repository, ...options });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('POST /api/telemetry aceita payload válido', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository);

  try {
    const response = await fetch(`${app.baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload()),
    });

    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.status, 'accepted');
    assert.equal(body.machineId, 'machine-01');
    assert.equal(repository.calls.length, 1);
    assert.equal(repository.calls[0].production.filled, 10);
  } finally {
    await app.close();
  }
});

test('POST /api/telemetry rejeita payload inválido', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository);

  try {
    const response = await fetch(`${app.baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId: 'machine-01' }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid_payload');
    assert.ok(Array.isArray(body.details));
    assert.equal(repository.calls.length, 0);
  } finally {
    await app.close();
  }
});

test('POST /api/telemetry rejeita JSON malformado', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository);

  try {
    const response = await fetch(`${app.baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid_request');
  } finally {
    await app.close();
  }
});

test('GET /health responde ok', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const response = await fetch(`${app.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await app.close();
  }
});

test('GET /api/machines lista máquinas', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const response = await fetch(`${app.baseUrl}/api/machines`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.machines.length, 1);
    assert.equal(body.machines[0].code, 'machine-01');
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/telemetry repassa filtros ao repositório', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository);

  try {
    const url =
      `${app.baseUrl}/api/machines/1/telemetry?from=2026-01-01T00:00:00.000Z` +
      `&to=2026-01-02T00:00:00.000Z&limit=50`;
    const response = await fetch(url);

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.machineId, 1);
    assert.equal(body.limit, 50);
    assert.equal(body.samples.length, 1);
    assert.deepEqual(repository.telemetryCalls[0], {
      machineId: 1,
      options: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        limit: 50,
      },
    });
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/telemetry valida id, período e limite', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const invalidId = await fetch(`${app.baseUrl}/api/machines/abc/telemetry`);
    assert.equal(invalidId.status, 400);
    assert.equal((await invalidId.json()).error, 'invalid_machine_id');

    const invalidPeriod = await fetch(
      `${app.baseUrl}/api/machines/1/telemetry?from=ontem`
    );
    assert.equal(invalidPeriod.status, 400);
    assert.equal((await invalidPeriod.json()).error, 'invalid_period');

    const invalidLimit = await fetch(
      `${app.baseUrl}/api/machines/1/telemetry?limit=0`
    );
    assert.equal(invalidLimit.status, 400);
    assert.equal((await invalidLimit.json()).error, 'invalid_limit');
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/oee retorna os indicadores', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository);

  try {
    const response = await fetch(
      `${app.baseUrl}/api/machines/1/oee?from=2026-01-01T00:00:00.000Z` +
        `&to=2026-01-02T00:00:00.000Z&nominalCapacityPerHour=250`
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.machineId, 1);
    assert.equal(body.oee, 0.225);
    assert.equal(body.nominalCapacityPerHour, 250);
    assert.deepEqual(repository.oeeCalls[0], {
      machineId: 1,
      options: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        nominalCapacityPerHour: 250,
      },
    });
  } finally {
    await app.close();
  }
});

test('POST /api/telemetry publica a amostra no stream', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const app = await startApp(createFakeRepository(), { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload()),
    });

    assert.equal(response.status, 202);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].event, 'telemetry');
    assert.equal(broadcasts[0].data.machineId, 'machine-01');
    assert.equal(broadcasts[0].data.line.step, 2);
  } finally {
    await app.close();
  }
});

test('POST /api/telemetry publica alertas no stream', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const repository = createFakeRepository();
  repository.ingestTelemetry = async (record) => ({
    machineId: 1,
    recordedAt: record.timestamp,
    alerts: [
      {
        action: 'created',
        alert: { id: 7, sensor_code: 'fillPercent', severity: 'warning' },
      },
    ],
  });
  const app = await startApp(repository, { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload()),
    });

    assert.equal(response.status, 202);
    assert.equal(broadcasts.length, 2);
    assert.equal(broadcasts[0].event, 'telemetry');
    assert.equal(broadcasts[1].event, 'alert');
    assert.equal(broadcasts[1].data.action, 'created');
    assert.equal(broadcasts[1].data.alert.id, 7);
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/alerts lista alertas com filtros', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository);

  try {
    const response = await fetch(
      `${app.baseUrl}/api/machines/1/alerts?status=all&limit=5`
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.machineId, 1);
    assert.equal(body.status, 'all');
    assert.equal(body.limit, 5);
    assert.equal(body.alerts.length, 1);
    assert.deepEqual(repository.alertsCalls[0], {
      machineId: 1,
      options: { status: 'all', limit: 5 },
    });
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/alerts valida id, status e limite', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const invalidId = await fetch(`${app.baseUrl}/api/machines/abc/alerts`);
    assert.equal(invalidId.status, 400);
    assert.equal((await invalidId.json()).error, 'invalid_machine_id');

    const invalidStatus = await fetch(
      `${app.baseUrl}/api/machines/1/alerts?status=pending`
    );
    assert.equal(invalidStatus.status, 400);
    assert.equal((await invalidStatus.json()).error, 'invalid_status');

    const invalidLimit = await fetch(`${app.baseUrl}/api/machines/1/alerts?limit=0`);
    assert.equal(invalidLimit.status, 400);
    assert.equal((await invalidLimit.json()).error, 'invalid_limit');
  } finally {
    await app.close();
  }
});

test('POST /api/alerts/:id/resolve resolve e publica no stream', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const repository = createFakeRepository();
  const app = await startApp(repository, { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/alerts/7/resolve`, {
      method: 'POST',
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.alert.id, 7);
    assert.ok(body.alert.resolved_at);
    assert.equal(repository.resolveCalls[0], 7);
    assert.equal(broadcasts[0].event, 'alert');
    assert.equal(broadcasts[0].data.action, 'resolved');
  } finally {
    await app.close();
  }
});

test('POST /api/alerts/:id/resolve valida id e alerta inexistente', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const invalidId = await fetch(`${app.baseUrl}/api/alerts/abc/resolve`, {
      method: 'POST',
    });
    assert.equal(invalidId.status, 400);
    assert.equal((await invalidId.json()).error, 'invalid_alert_id');

    const missing = await fetch(`${app.baseUrl}/api/alerts/999/resolve`, {
      method: 'POST',
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'alert_not_found');
  } finally {
    await app.close();
  }
});

test('GET /api/stream abre um stream SSE', async () => {
  const app = await startApp(createFakeRepository());
  const controller = new AbortController();

  try {
    const response = await fetch(`${app.baseUrl}/api/stream`, {
      signal: controller.signal,
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);

    const reader = response.body.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    assert.ok(chunk.includes('event: ready'));
  } finally {
    controller.abort();
    app.server.closeAllConnections?.();
    await app.close();
  }
});

test('GET / serve o dashboard estático', async () => {
  const dashboardDir = path.resolve(__dirname, '../../../dashboard/frontend');
  const app = await startApp(createFakeRepository(), { dashboardDir });

  try {
    const response = await fetch(`${app.baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    assert.ok(html.includes('Plataforma Industrial 4.0'));
    assert.ok(html.includes('alerts-list'));
    assert.ok(html.includes('maintenance-panel'));
    assert.ok(html.includes('production-panel'));
    assert.ok(html.includes('chart-summary'));
    assert.ok(html.includes('Volume envasado'));
    assert.ok(html.includes('order-modal'));
    assert.ok(html.includes('Enviar para manutenção'));
    assert.ok(html.includes('Cancelar ordem'));
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/maintenance retorna vida útil e OS abertas', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const response = await fetch(`${app.baseUrl}/api/machines/1/maintenance`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.machineId, 1);
    assert.equal(body.components.length, 2);
    assert.equal(body.components[0].status, 'warning');
    assert.equal(body.components[0].unit, 'ciclos');
    assert.equal(body.components[1].metric, 'hours');
    assert.equal(body.components[1].unit, 'h');
    assert.equal(body.components[1].usage, 160);
    assert.equal(body.orders.length, 1);
    assert.equal(body.orders[0].source_usage, 340);
    assert.equal(body.orders[0].sap.external_id, 'SAP-3-X');
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/maintenance valida o id', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const response = await fetch(`${app.baseUrl}/api/machines/abc/maintenance`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid_machine_id');
  } finally {
    await app.close();
  }
});

test('POST /api/maintenance/orders/:id/send envia OS para manutenção', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const app = await startApp(createFakeRepository(), { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/maintenance/orders/3/send`, {
      method: 'POST',
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.order.status, 'in_progress');
    assert.equal(broadcasts[0].event, 'maintenance');
    assert.equal(broadcasts[0].data.action, 'sent');

    const missing = await fetch(`${app.baseUrl}/api/maintenance/orders/999/send`, {
      method: 'POST',
    });
    assert.equal(missing.status, 404);

    const invalid = await fetch(`${app.baseUrl}/api/maintenance/orders/abc/send`, {
      method: 'POST',
    });
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
  }
});

test('POST /api/maintenance/orders/:id/cancel cancela a OS', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const app = await startApp(createFakeRepository(), { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/maintenance/orders/3/cancel`, {
      method: 'POST',
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.order.status, 'cancelled');
    assert.equal(broadcasts[0].data.action, 'cancelled');

    const missing = await fetch(`${app.baseUrl}/api/maintenance/orders/999/cancel`, {
      method: 'POST',
    });
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test('POST /api/maintenance/orders/:id/complete conclui e publica no stream', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const app = await startApp(createFakeRepository(), { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/maintenance/orders/3/complete`, {
      method: 'POST',
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.order.status, 'completed');
    assert.equal(broadcasts[0].event, 'maintenance');
    assert.equal(broadcasts[0].data.action, 'completed');

    const missing = await fetch(`${app.baseUrl}/api/maintenance/orders/999/complete`, {
      method: 'POST',
    });
    assert.equal(missing.status, 404);

    const invalid = await fetch(`${app.baseUrl}/api/maintenance/orders/abc/complete`, {
      method: 'POST',
    });
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
  }
});

test('GET /api/integrations/sap/outbox lista envios ao SAP', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const response = await fetch(`${app.baseUrl}/api/integrations/sap/outbox?limit=5`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.limit, 5);
    assert.equal(body.outbox.length, 1);
    assert.equal(body.outbox[0].external_id, 'SAP-3-X');

    const invalid = await fetch(`${app.baseUrl}/api/integrations/sap/outbox?limit=0`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'invalid_limit');
  } finally {
    await app.close();
  }
});

test('POST /api/telemetry publica eventos de manutenção no stream', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const repository = createFakeRepository();
  repository.ingestTelemetry = async (record) => ({
    machineId: 1,
    recordedAt: record.timestamp,
    alerts: [],
    maintenance: [
      {
        action: 'created',
        order: { id: 3, component_code: 'fill-valve', status: 'planned' },
      },
    ],
  });
  const app = await startApp(repository, { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload()),
    });

    assert.equal(response.status, 202);
    assert.equal(broadcasts.length, 2);
    assert.equal(broadcasts[1].event, 'maintenance');
    assert.equal(broadcasts[1].data.order.id, 3);
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/oee valida id, período e capacidade', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const invalidId = await fetch(`${app.baseUrl}/api/machines/0/oee`);
    assert.equal(invalidId.status, 400);
    assert.equal((await invalidId.json()).error, 'invalid_machine_id');

    const invalidPeriod = await fetch(
      `${app.baseUrl}/api/machines/1/oee?to=ontem`
    );
    assert.equal(invalidPeriod.status, 400);
    assert.equal((await invalidPeriod.json()).error, 'invalid_period');

    const invalidCapacity = await fetch(
      `${app.baseUrl}/api/machines/1/oee?nominalCapacityPerHour=0`
    );
    assert.equal(invalidCapacity.status, 400);
    assert.equal((await invalidCapacity.json()).error, 'invalid_nominal_capacity');
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/production retorna histórico por hora', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository);

  try {
    const response = await fetch(
      `${app.baseUrl}/api/machines/1/production?bucket=hour` +
        `&from=2026-01-01T00:00:00.000Z&to=2026-01-01T03:00:00.000Z`
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.machineId, 1);
    assert.equal(body.bucket, 'hour');
    assert.equal(body.buckets.length, 1);
    assert.equal(body.buckets[0].label, '09:00');
    assert.equal(body.totals.produced, 120);
    assert.deepEqual(repository.productionCalls[0], {
      machineId: 1,
      options: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-01T03:00:00.000Z',
        bucket: 'hour',
        timeZone: 'America/Sao_Paulo',
        shiftStartHour: 6,
        shiftHours: 8,
        now: Date.parse('2026-01-01T03:00:00.000Z'),
      },
    });
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/production aceita turnos configurados', async () => {
  const repository = createFakeRepository();
  const app = await startApp(repository, {
    productionSettings: { timeZone: 'UTC', shiftStartHour: 7, shiftHours: 12 },
  });

  try {
    const response = await fetch(
      `${app.baseUrl}/api/machines/1/production?bucket=shift` +
        `&from=2026-01-01T06:00:00.000Z&to=2026-01-01T18:00:00.000Z`
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.bucket, 'shift');
    assert.deepEqual(repository.productionCalls[0].options, {
      from: '2026-01-01T06:00:00.000Z',
      to: '2026-01-01T18:00:00.000Z',
      bucket: 'shift',
      timeZone: 'UTC',
      shiftStartHour: 7,
      shiftHours: 12,
      now: Date.parse('2026-01-01T18:00:00.000Z'),
    });
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/production valida id, bucket, período e intervalo', async () => {
  const app = await startApp(createFakeRepository());

  try {
    const invalidId = await fetch(`${app.baseUrl}/api/machines/abc/production`);
    assert.equal(invalidId.status, 400);
    assert.equal((await invalidId.json()).error, 'invalid_machine_id');

    const invalidBucket = await fetch(
      `${app.baseUrl}/api/machines/1/production?bucket=day`
    );
    assert.equal(invalidBucket.status, 400);
    assert.equal((await invalidBucket.json()).error, 'invalid_bucket');

    const invalidPeriod = await fetch(
      `${app.baseUrl}/api/machines/1/production?to=ontem`
    );
    assert.equal(invalidPeriod.status, 400);
    assert.equal((await invalidPeriod.json()).error, 'invalid_period');

    const inverted = await fetch(
      `${app.baseUrl}/api/machines/1/production` +
        `?from=2026-01-01T02:00:00.000Z&to=2026-01-01T01:00:00.000Z`
    );
    assert.equal(inverted.status, 400);
    assert.equal((await inverted.json()).error, 'invalid_period');

    const tooLarge = await fetch(
      `${app.baseUrl}/api/machines/1/production` +
        `?from=2026-01-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z`
    );
    assert.equal(tooLarge.status, 400);
    assert.equal((await tooLarge.json()).error, 'range_too_large');
  } finally {
    await app.close();
  }
});

test('GET /api/machines/:id/production/total devolve o acumulado do banco', async () => {
  const repository = createFakeRepository();
  repository.getProductionTotal = async (machineId) => ({
    machineId,
    accumulatedProduced: 12430,
    accumulatedGood: 12400,
    lastCounter: 0,
    lastGoodCounter: 0,
    lastResetAt: '2026-11-21T19:05:00.000Z',
    updatedAt: '2026-11-21T19:05:00.000Z',
  });

  const app = await startApp(repository);

  try {
    const response = await fetch(`${app.baseUrl}/api/machines/1/production/total`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accumulatedProduced, 12430);

    const invalid = await fetch(`${app.baseUrl}/api/machines/abc/production/total`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'invalid_machine_id');
  } finally {
    await app.close();
  }
});

test('POST /api/telemetry publica reset do acumulado no stream', async () => {
  const broadcasts = [];
  const streamHub = {
    subscribe() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    closeAll() {},
  };
  const repository = createFakeRepository();
  repository.ingestTelemetry = async (record) => ({
    machineId: record.machineId,
    recordedAt: record.timestamp,
    productionReset: true,
    productionTotal: {
      accumulatedProduced: 12430,
      accumulatedGood: 12400,
      lastResetAt: record.timestamp,
    },
  });

  const app = await startApp(repository, { streamHub });

  try {
    const response = await fetch(`${app.baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload()),
    });

    assert.equal(response.status, 202);
    const productionEvent = broadcasts.find((item) => item.event === 'production');
    assert.ok(productionEvent);
    assert.equal(productionEvent.data.action, 'reset');
    assert.equal(productionEvent.data.totals.accumulatedProduced, 12430);
  } finally {
    await app.close();
  }
});
