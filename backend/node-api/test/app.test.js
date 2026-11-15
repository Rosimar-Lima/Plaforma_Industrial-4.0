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
  const alertsCalls = [];
  const resolveCalls = [];
  return {
    calls,
    telemetryCalls,
    oeeCalls,
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
