'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAdsAdapter, unwrapAdsValue } = require('../src/adapters/ads');
const { buildTelemetry } = require('../src/mapping');

function createFakeClient(valuesBySymbol, { wrap = true } = {}) {
  let instance = null;
  const instances = [];

  class FakeAdsClient {
    constructor(options) {
      this.options = options;
      this.reads = [];
      this.cacheCalls = [];
      this.disconnects = [];
      this.connected = false;
      instance = this;
      instances.push(this);
    }

    on() {}

    async connect() {
      this.connected = true;
    }

    async cacheSymbols() {
      this.cacheCalls.push('symbols');
    }

    async cacheDataTypes() {
      this.cacheCalls.push('dataTypes');
    }

    async disconnect(force = false) {
      this.connected = false;
      this.disconnects.push(force);
    }

    async readValue(symbol) {
      this.reads.push(symbol);
      const value = valuesBySymbol[symbol];

      if (!wrap) return value;

      return {
        value,
        rawValue: value,
        dataType: 'fake',
        symbol,
      };
    }
  }

  return {
    Client: FakeAdsClient,
    getInstance: () => instance,
    getInstances: () => instances,
  };
}

test('unwrapAdsValue extrai o valor do resultado do ads-client', () => {
  assert.equal(unwrapAdsValue({ value: true, rawValue: 1 }), true);
  assert.equal(unwrapAdsValue({ value: 123, rawValue: 123 }), 123);
  assert.equal(unwrapAdsValue({ value: '1.0.0' }), '1.0.0');
  assert.equal(unwrapAdsValue(null), null);
  assert.equal(unwrapAdsValue(42), 42);
  assert.deepEqual(unwrapAdsValue({ rawValue: 7 }), { rawValue: 7 });
});

test('readTags devolve escalares quando o ADS responde com objeto de leitura', async () => {
  const symbols = {
    running: 'GVL_HMI.bRunning',
    filled: 'GVL_HMI.nBottlesFilled',
    fillPercent: 'GVL_HMI.nFillPercent',
    plcVersion: 'GVL_HMI.sPlcVersion',
  };

  const fake = createFakeClient({
    [symbols.running]: true,
    [symbols.filled]: 123,
    [symbols.fillPercent]: 42,
    [symbols.plcVersion]: '1.0.0',
  });

  const adapter = createAdsAdapter({
    targetAmsNetId: '39.90.64.65.1.1',
    targetAdsPort: 851,
    symbols,
    clientFactory: fake.Client,
  });

  await adapter.connect();
  const values = await adapter.readTags();

  assert.deepEqual(values, {
    running: true,
    filled: 123,
    fillPercent: 42,
    plcVersion: '1.0.0',
  });
  assert.deepEqual(fake.getInstance().reads, Object.values(symbols));
  assert.deepEqual(fake.getInstance().cacheCalls, ['symbols', 'dataTypes']);
  assert.equal(fake.getInstance().options.targetAmsNetId, '39.90.64.65.1.1');
  assert.equal(fake.getInstance().options.targetAdsPort, 851);

  await adapter.close();
});

test('readTags aceita leitura que já vem como valor escalar', async () => {
  const fake = createFakeClient(
    {
      'GVL_HMI.bRunning': false,
      'GVL_HMI.nBottlesFilled': 9,
    },
    { wrap: false }
  );

  const adapter = createAdsAdapter({
    symbols: {
      running: 'GVL_HMI.bRunning',
      filled: 'GVL_HMI.nBottlesFilled',
    },
    clientFactory: fake.Client,
  });

  await adapter.connect();
  const values = await adapter.readTags();

  assert.deepEqual(values, { running: false, filled: 9 });

  await adapter.close();
});

test('telemetria gerada a partir da leitura ADS mantém contadores reais', async () => {
  const symbols = {
    running: 'GVL_HMI.bRunning',
    sensorS1: 'GVL_HMI.bSensorS1',
    sensorS2: 'GVL_HMI.bSensorS2',
    bottlePositioned: 'GVL_HMI.bBottlePositioned',
    conveyorOn: 'GVL_HMI.bConveyorOn',
    evOn: 'GVL_HMI.bEvOn',
    atOn: 'GVL_HMI.bAtOn',
    evInterlock: 'GVL_HMI.bEvInterlock',
    atInterlock: 'GVL_HMI.bAtInterlock',
    fillPercent: 'GVL_HMI.nFillPercent',
    filled: 'GVL_HMI.nBottlesFilled',
    capped: 'GVL_HMI.nBottlesCapped',
    total: 'GVL_HMI.nProductionTotal',
    plcVersion: 'GVL_HMI.sPlcVersion',
  };

  const fake = createFakeClient({
    [symbols.running]: true,
    [symbols.sensorS1]: true,
    [symbols.sensorS2]: true,
    [symbols.bottlePositioned]: true,
    [symbols.conveyorOn]: false,
    [symbols.evOn]: true,
    [symbols.atOn]: false,
    [symbols.evInterlock]: true,
    [symbols.atInterlock]: true,
    [symbols.fillPercent]: 42,
    [symbols.filled]: 123,
    [symbols.capped]: 122,
    [symbols.total]: 122,
    [symbols.plcVersion]: '1.0.0',
  });

  const adapter = createAdsAdapter({ symbols, clientFactory: fake.Client });

  await adapter.connect();
  const values = await adapter.readTags();
  const telemetry = buildTelemetry({
    machineId: 'Linha-01',
    values,
    timestamp: '2026-11-21T19:00:00.000Z',
  });

  assert.equal(telemetry.plcVersion, '1.0.0');
  assert.equal(telemetry.line.running, true);
  assert.equal(telemetry.line.fillPercent, 42);
  assert.equal(telemetry.production.filled, 123);
  assert.equal(telemetry.production.capped, 122);
  assert.equal(telemetry.production.total, 122);

  await adapter.close();
});

test('connect() fecha o cliente anterior antes de criar outro', async () => {
  const fake = createFakeClient({ 'GVL_HMI.bRunning': true });
  const adapter = createAdsAdapter({
    symbols: { running: 'GVL_HMI.bRunning' },
    clientFactory: fake.Client,
  });

  await adapter.connect();
  await adapter.connect();

  const instancias = fake.getInstances();
  assert.equal(instancias.length, 2);
  assert.deepEqual(instancias[0].disconnects, [true]);
  assert.equal(instancias[0].connected, false);
  assert.equal(instancias[1].connected, true);
  assert.deepEqual(instancias[1].disconnects, []);

  await adapter.close();
  assert.deepEqual(instancias[1].disconnects, [true]);
});

test('connect() libera a porta local se falhar ao carregar metadados', async () => {
  class FakeClientFalho {
    constructor(options) {
      this.options = options;
      this.desconectado = false;
    }

    on() {}

    async connect() {}

    async cacheSymbols() {
      throw new Error('runtime reiniciando');
    }

    async disconnect() {
      this.desconectado = true;
    }
  }

  let instancia = null;
  const adapter = createAdsAdapter({
    symbols: { running: 'GVL_HMI.bRunning' },
    clientFactory: class extends FakeClientFalho {
      constructor(options) {
        super(options);
        instancia = this;
      }
    },
  });

  await assert.rejects(adapter.connect(), /runtime reiniciando/);
  assert.equal(instancia.desconectado, true);

  // Uma nova tentativa deve criar um cliente limpo, sem deixar o anterior preso.
  await adapter.close();
});

test('autoReconnect desligado por padrão para evitar reconexões concorrentes', async () => {
  const fake = createFakeClient({ 'GVL_HMI.bRunning': false });
  const adapter = createAdsAdapter({
    symbols: { running: 'GVL_HMI.bRunning' },
    clientFactory: fake.Client,
  });

  await adapter.connect();

  assert.equal(fake.getInstance().options.autoReconnect, false);

  await adapter.close();
});
