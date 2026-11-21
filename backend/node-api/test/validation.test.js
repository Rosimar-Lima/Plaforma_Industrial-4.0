'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateTelemetry, validateGatewayStatus } = require('../src/validation');

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

test('aceita telemetria válida e normaliza o timestamp', () => {
  const result = validateTelemetry(validPayload());
  assert.equal(result.ok, true);
  assert.equal(result.value.machineId, 'machine-01');
  assert.equal(result.value.timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(result.value.line.step, 2);
  assert.equal(result.value.production.total, 9);
});

test('rejeita payload que não é objeto', () => {
  const result = validateTelemetry(null);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('rejeita machineId ausente ou longo', () => {
  const missing = validPayload();
  missing.machineId = '   ';
  assert.equal(validateTelemetry(missing).ok, false);

  const long = validPayload();
  long.machineId = 'x'.repeat(51);
  assert.equal(validateTelemetry(long).ok, false);
});

test('rejeita timestamp inválido', () => {
  const payload = validPayload();
  payload.timestamp = 'ontem';
  assert.equal(validateTelemetry(payload).ok, false);
});

test('rejeita campos de linha com tipo errado', () => {
  const payload = validPayload();
  payload.line.running = 'true';
  payload.line.step = 1.5;
  const result = validateTelemetry(payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('line.running')));
  assert.ok(result.errors.some((error) => error.includes('line.step')));
});

test('rejeita fillPercent fora do intervalo', () => {
  const payload = validPayload();
  payload.line.fillPercent = 130;
  assert.equal(validateTelemetry(payload).ok, false);
});

test('rejeita EV ligada sem garrafa posicionada', () => {
  const payload = validPayload();
  payload.line.bottlePositioned = false;
  const result = validateTelemetry(payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('evOn')));
});

test('rejeita AT ligada sem sensor S2', () => {
  const payload = validPayload();
  payload.line.atOn = true;
  payload.line.sensorS2 = false;
  const result = validateTelemetry(payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('atOn')));
});

test('rejeita contadores negativos', () => {
  const payload = validPayload();
  payload.production.filled = -1;
  assert.equal(validateTelemetry(payload).ok, false);
});

function validStatus() {
  return {
    machineId: 'machine-01',
    connected: true,
    running: false,
    lastReadAt: '2026-11-21T20:00:00.000Z',
    timestamp: '2026-11-21T20:00:00.000Z',
    failures: 0,
    error: null,
  };
}

test('valida status do gateway', () => {
  const result = validateGatewayStatus(validStatus());
  assert.equal(result.ok, true);
  assert.equal(result.value.machineId, 'machine-01');
  assert.equal(result.value.connected, true);
  assert.equal(result.value.running, false);
});

test('aceita status sem campos opcionais', () => {
  const result = validateGatewayStatus({ machineId: 'machine-01', connected: false });
  assert.equal(result.ok, true);
  assert.equal(result.value.running, null);
  assert.equal(result.value.failures, 0);
});

test('rejeita status com campos obrigatórios ou tipos inválidos', () => {
  assert.equal(validateGatewayStatus(null).ok, false);
  assert.equal(validateGatewayStatus({ machineId: 'machine-01' }).ok, false);

  const status = validStatus();
  status.connected = 'true';
  status.running = 1;
  status.failures = -1;
  status.lastReadAt = 'ontem';
  const result = validateGatewayStatus(status);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('connected')));
  assert.ok(result.errors.some((error) => error.includes('running')));
  assert.ok(result.errors.some((error) => error.includes('failures')));
  assert.ok(result.errors.some((error) => error.includes('lastReadAt')));
});
