'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ALERT_SETTINGS,
  normalizeSettings,
  evaluateFillAlert,
  buildStoppedAlert,
} = require('../src/alerts');

const settings = normalizeSettings({ fillPercentMin: 20, fillPercentMax: 90 });

function record(line = {}) {
  return {
    machineId: 'Linha-01',
    timestamp: '2026-01-01T00:00:00.000Z',
    line: { step: 2, fillPercent: 50, ...line },
  };
}

test('normaliza configurações padrão', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_ALERT_SETTINGS);
  assert.equal(normalizeSettings({ fillPercentMin: 10 }).fillPercentMin, 10);
  assert.equal(normalizeSettings({ stoppedMs: -5 }).stoppedMs, 0);
});

test('detecta nível de envase abaixo do mínimo', () => {
  const alert = evaluateFillAlert(record({ fillPercent: 10 }), settings);

  assert.equal(alert.sensorCode, 'fillPercent');
  assert.equal(alert.severity, 'warning');
  assert.match(alert.message, /abaixo do limite mínimo/);
});

test('detecta nível de envase acima do máximo', () => {
  const alert = evaluateFillAlert(record({ fillPercent: 95 }), settings);

  assert.equal(alert.sensorCode, 'fillPercent');
  assert.equal(alert.severity, 'critical');
  assert.match(alert.message, /acima do limite máximo/);
});

test('não gera alerta dentro dos limites', () => {
  assert.equal(evaluateFillAlert(record({ fillPercent: 50 }), settings), null);
  assert.equal(evaluateFillAlert(record({ fillPercent: 20 }), settings), null);
  assert.equal(evaluateFillAlert(record({ fillPercent: 90 }), settings), null);
});

test('ignora leituras fora da etapa de envase', () => {
  assert.equal(evaluateFillAlert(record({ step: 0, fillPercent: 0 }), settings), null);
  assert.equal(evaluateFillAlert(record({ step: 3, fillPercent: 100 }), settings), null);
});

test('padrão 0-100 não gera falso positivo na operação normal', () => {
  const defaults = normalizeSettings();

  assert.equal(evaluateFillAlert(record({ fillPercent: 0 }), defaults), null);
  assert.equal(evaluateFillAlert(record({ fillPercent: 100 }), defaults), null);
});

test('gera alerta de linha parada após o limite', () => {
  const alert = buildStoppedAlert(90000, settings);

  assert.equal(alert.sensorCode, 'lineStopped');
  assert.equal(alert.severity, 'warning');
  assert.match(alert.message, /Linha parada há 90s/);
});

test('não gera alerta de parada dentro do limite', () => {
  assert.equal(buildStoppedAlert(30000, settings), null);
  assert.equal(buildStoppedAlert(Number.NaN, settings), null);
});
