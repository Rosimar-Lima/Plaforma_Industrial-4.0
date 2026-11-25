'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTelemetry,
  deriveStep,
  clampFillPercent,
  normalizeRunning,
  toInteger,
} = require('../src/mapping');
const { validateTelemetry } = require('../../backend/node-api/src/validation');

const timestamp = '2026-01-01T00:00:00.000Z';

test('normalizeRunning mantém null para leitura ausente e aceita 0/1 e texto', () => {
  assert.equal(normalizeRunning(null), null);
  assert.equal(normalizeRunning(undefined), null);
  assert.equal(normalizeRunning(''), null);
  assert.equal(normalizeRunning(0), false);
  assert.equal(normalizeRunning(1), true);
  assert.equal(normalizeRunning(' false '), false);
  assert.equal(normalizeRunning('on'), true);
});

test('monta telemetria completa e válida', () => {
  const payload = buildTelemetry({
    machineId: 'Linha-01',
    timestamp,
    plcVersion: '1.0.0',
    values: {
      running: 1,
      sensorS1: 1,
      sensorS2: 0,
      bottlePositioned: 1,
      conveyorOn: 0,
      evOn: 1,
      atOn: 0,
      fillPercent: 42.6,
      filled: 10,
      capped: 9,
      total: 9,
    },
  });

  assert.equal(payload.machineId, 'Linha-01');
  assert.equal(payload.timestamp, timestamp);
  assert.equal(payload.plcVersion, '1.0.0');
  assert.equal(payload.line.step, 2);
  assert.equal(payload.line.fillPercent, 43);
  assert.equal(payload.line.bottlePositioned, true);
  assert.deepEqual(payload.production, { filled: 10, capped: 9, total: 9 });

  const result = validateTelemetry(payload);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('deriva intertravamentos e posição quando ausentes', () => {
  const payload = buildTelemetry({
    machineId: 'Linha-01',
    timestamp,
    values: { sensorS1: true, sensorS2: true, conveyorOn: false },
  });

  assert.equal(payload.line.bottlePositioned, true);
  assert.equal(payload.line.evInterlock, true);
  assert.equal(payload.line.atInterlock, true);
  assert.equal(payload.line.running, false);
  assert.equal(payload.line.step, 1);
  assert.deepEqual(payload.production, { filled: 0, capped: 0, total: 0 });
});

test('respeita a etapa explícita do PLC', () => {
  const payload = buildTelemetry({
    machineId: 'Linha-01',
    timestamp,
    values: { step: 3, conveyorOn: true, fillPercent: 100 },
  });

  assert.equal(payload.line.step, 3);
});

test('deriva a etapa a partir dos sinais', () => {
  assert.equal(
    deriveStep({ conveyorOn: true, sensorS1: false, evOn: false, fillPercent: 0 }),
    0
  );
  assert.equal(
    deriveStep({ conveyorOn: true, sensorS1: false, evOn: false, fillPercent: 100 }),
    3
  );
  assert.equal(
    deriveStep({ conveyorOn: false, sensorS1: true, evOn: false, fillPercent: 0 }),
    1
  );
  assert.equal(
    deriveStep({ conveyorOn: false, sensorS1: true, evOn: true, fillPercent: 0 }),
    2
  );
  assert.equal(
    deriveStep({ conveyorOn: false, sensorS1: true, evOn: false, fillPercent: 40 }),
    2
  );
});

test('normaliza percentual e contadores', () => {
  assert.equal(clampFillPercent(-5), 0);
  assert.equal(clampFillPercent(150), 100);
  assert.equal(clampFillPercent('42.4'), 42);
  assert.equal(clampFillPercent('x'), 0);
  assert.equal(toInteger(-3), 0);
  assert.equal(toInteger('7.9'), 7);
  assert.equal(toInteger('x'), 0);
});

test('produção total usa min(envasadas, tampadas) quando ausente', () => {
  const payload = buildTelemetry({
    machineId: 'Linha-01',
    timestamp,
    values: { filled: 12, capped: 9 },
  });

  assert.equal(payload.production.total, 9);
});

test('plcVersion da leitura tem prioridade', () => {
  const payload = buildTelemetry({
    machineId: 'Linha-01',
    timestamp,
    plcVersion: 'fallback',
    values: { plcVersion: '3.2.1' },
  });

  assert.equal(payload.plcVersion, '3.2.1');
});
