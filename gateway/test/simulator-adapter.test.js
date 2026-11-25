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

test('limita o avanço do simulador quando a primeira leitura demora', async () => {
  let atual = 0;
  const adapter = createSimulatorAdapter({
    autoStart: true,
    now: () => atual,
  });
  await adapter.connect();

  atual = 10 * 60 * 1000;
  const values = await adapter.readTags();

  // Sem o limite, dez minutos em um único tick fariam a linha pular de etapa.
  assert.equal(values.step, 0);
  assert.equal(values.fillPercent, 0);

  await adapter.close();
});

test('respeita autoStart desligado', async () => {
  const adapter = createSimulatorAdapter({ autoStart: false });
  await adapter.connect();

  const values = await adapter.readTags();
  assert.equal(values.running, false);

  await adapter.close();
});
