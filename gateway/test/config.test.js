'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../src/config');

test('carrega configuração padrão (ADS)', () => {
  const config = loadConfig({});

  assert.equal(config.protocol, 'ads');
  assert.equal(config.machineId, 'Linha-01');
  assert.equal(config.pollMs, 1000);
  assert.equal(config.backendUrl, 'http://localhost:3000');
  assert.equal(config.symbols.running, 'GVL_HMI.bRunning');
  assert.equal(config.ads.targetAdsPort, 851);
  assert.equal(config.ads.targetAmsNetId, '39.90.64.65.1.1');
});

test('aceita overrides por ambiente', () => {
  const config = loadConfig({
    INDUSTRIAL_PROTOCOL: 'simulator',
    GATEWAY_MACHINE_ID: 'linha-02',
    GATEWAY_POLL_MS: '500',
    BACKEND_URL: 'http://backend:3000',
    SIMULATOR_AUTO_START: 'false',
  });

  assert.equal(config.protocol, 'simulator');
  assert.equal(config.machineId, 'linha-02');
  assert.equal(config.pollMs, 500);
  assert.equal(config.backendUrl, 'http://backend:3000');
  assert.equal(config.simulator.autoStart, false);
});

test('carrega mapa Modbus', () => {
  const config = loadConfig({ INDUSTRIAL_PROTOCOL: 'modbus' });

  assert.equal(config.symbols.running.type, 'coil');
  assert.equal(config.symbols.filled.words, 2);
  assert.equal(config.modbus.unitId, 1);
  assert.equal(config.modbus.port, 502);
});

test('rejeita protocolo e polling inválidos', () => {
  assert.throws(() => loadConfig({ INDUSTRIAL_PROTOCOL: 'profibus' }), /inválido/);
  assert.throws(() => loadConfig({ GATEWAY_POLL_MS: '50' }), /maior ou igual/);
  assert.throws(() => loadConfig({ GATEWAY_POLL_MS: 'abc' }), /GATEWAY_POLL_MS/);
});
