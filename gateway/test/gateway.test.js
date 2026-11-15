'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGateway } = require('../src/gateway');

function silentLogger(errors = []) {
  return {
    error(message) {
      errors.push(message);
    },
  };
}

function validValues() {
  return {
    running: true,
    sensorS1: true,
    sensorS2: false,
    conveyorOn: false,
    evOn: true,
    atOn: false,
    fillPercent: 50,
    filled: 1,
    capped: 1,
    total: 1,
  };
}

test('publica telemetria a cada leitura', async () => {
  const published = [];
  const adapter = {
    connects: 0,
    async connect() {
      this.connects += 1;
    },
    async readTags() {
      return validValues();
    },
    async close() {},
  };
  const gateway = createGateway({
    adapter,
    publisher: {
      async publish(payload) {
        published.push(payload);
      },
    },
    machineId: 'machine-01',
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
    logger: silentLogger(),
  });

  await gateway.pollOnce();

  assert.equal(adapter.connects, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].machineId, 'machine-01');
  assert.equal(published[0].timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(published[0].line.step, 2);
  assert.equal(published[0].line.bottlePositioned, true);
});

test('reconecta após falha de conexão', async () => {
  const published = [];
  const errors = [];
  let connects = 0;
  const adapter = {
    async connect() {
      connects += 1;
      if (connects === 1) throw new Error('sem PLC');
    },
    async readTags() {
      return validValues();
    },
    async close() {},
  };
  const gateway = createGateway({
    adapter,
    publisher: {
      async publish(payload) {
        published.push(payload);
      },
    },
    machineId: 'machine-01',
    logger: silentLogger(errors),
  });

  await gateway.pollOnce();
  assert.equal(published.length, 0);
  assert.equal(errors.length, 1);

  await gateway.pollOnce();
  assert.equal(connects, 2);
  assert.equal(published.length, 1);
});

test('reconecta após falha de leitura', async () => {
  const published = [];
  const errors = [];
  let connects = 0;
  let reads = 0;
  const adapter = {
    async connect() {
      connects += 1;
    },
    async readTags() {
      reads += 1;
      if (reads === 1) throw new Error('timeout');
      return validValues();
    },
    async close() {},
  };
  const gateway = createGateway({
    adapter,
    publisher: {
      async publish(payload) {
        published.push(payload);
      },
    },
    machineId: 'machine-01',
    logger: silentLogger(errors),
  });

  await gateway.pollOnce();
  assert.equal(published.length, 0);

  await gateway.pollOnce();
  assert.equal(connects, 2);
  assert.equal(published.length, 1);
  assert.match(errors[0], /falha na leitura/);
});

test('mantém a conexão quando a publicação falha', async () => {
  const errors = [];
  let connects = 0;
  let publishes = 0;
  const adapter = {
    async connect() {
      connects += 1;
    },
    async readTags() {
      return validValues();
    },
    async close() {},
  };
  const gateway = createGateway({
    adapter,
    publisher: {
      async publish() {
        publishes += 1;
        throw new Error('backend indisponível');
      },
    },
    machineId: 'machine-01',
    logger: silentLogger(errors),
  });

  await gateway.pollOnce();
  await gateway.pollOnce();

  assert.equal(connects, 1);
  assert.equal(publishes, 2);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /falha na publicação/);
});
