'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSimulatorAdapter } = require('../src/adapters/simulator');

test('simula a linha e expõe as leituras', async () => {
  const adapter = createSimulatorAdapter({
    machineId: 'Linha-01',
    plcVersion: 'gateway-sim',
    autoStart: true,
  });

  await adapter.connect();
  const values = await adapter.readTags();

  assert.equal(values.running, true);
  assert.equal(typeof values.step, 'number');
  assert.equal(typeof values.fillPercent, 'number');
  assert.equal(values.plcVersion, 'gateway-sim');

  await adapter.close();
});

test('respeita autoStart desligado', async () => {
  const adapter = createSimulatorAdapter({ autoStart: false });
  await adapter.connect();

  const values = await adapter.readTags();
  assert.equal(values.running, false);

  await adapter.close();
});
