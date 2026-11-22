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
    machineId: 'Linha-01',
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
    logger: silentLogger(),
  });

  await gateway.pollOnce();

  assert.equal(adapter.connects, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].machineId, 'Linha-01');
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
    machineId: 'Linha-01',
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
    machineId: 'Linha-01',
    logger: silentLogger(errors),
  });

  await gateway.pollOnce();
  assert.equal(published.length, 0);

  await gateway.pollOnce();
  assert.equal(connects, 2);
  assert.equal(published.length, 1);
  assert.match(errors[0], /falha na leitura/);
});

test('fecha o adaptador antes de reconectar após falha de leitura', async () => {
  let connects = 0;
  let closes = 0;
  let reads = 0;
  const statuses = [];
  const adapter = {
    async connect() {
      connects += 1;
    },
    async readTags() {
      reads += 1;
      if (reads === 1) throw new Error('TwinCAT em config');
      return validValues();
    },
    async close() {
      closes += 1;
    },
  };
  const gateway = createGateway({
    adapter,
    publisher: {
      async publish() {},
      async publishStatus(status) {
        statuses.push(status);
      },
    },
    machineId: 'Linha-01',
    logger: silentLogger(),
  });

  await gateway.pollOnce();
  assert.equal(closes, 1);
  assert.equal(statuses[0].connected, false);
  assert.equal(statuses[0].running, null);

  await gateway.pollOnce();
  assert.equal(connects, 2);
  assert.equal(closes, 1);
  assert.equal(statuses[1].connected, true);
  assert.equal(statuses[1].running, true);
});

test('fecha o adaptador quando a conexão falha', async () => {
  let connects = 0;
  let closes = 0;
  const adapter = {
    async connect() {
      connects += 1;
      if (connects === 1) throw new Error('ADS fora');
    },
    async readTags() {
      return validValues();
    },
    async close() {
      closes += 1;
    },
  };
  const gateway = createGateway({
    adapter,
    publisher: { async publish() {} },
    machineId: 'Linha-01',
    logger: silentLogger(),
  });

  await gateway.pollOnce();
  assert.equal(closes, 1);

  await gateway.pollOnce();
  assert.equal(connects, 2);
  assert.equal(closes, 1);
});

test('limpa o estado da linha quando a leitura falha após operação', async () => {
  const statuses = [];
  let reads = 0;
  const gateway = createGateway({
    adapter: {
      async connect() {},
      async readTags() {
        reads += 1;
        if (reads === 1) return { ...validValues(), running: true };
        throw new Error('TwinCAT desligado');
      },
      async close() {},
    },
    publisher: {
      async publish() {},
      async publishStatus(status) {
        statuses.push(status);
      },
    },
    machineId: 'Linha-01',
    logger: silentLogger(),
  });

  await gateway.pollOnce();
  assert.equal(statuses[0].running, true);

  await gateway.pollOnce();
  assert.equal(statuses[1].running, null);
  assert.equal(statuses[1].connected, false);
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
    machineId: 'Linha-01',
    logger: silentLogger(errors),
  });

  await gateway.pollOnce();
  await gateway.pollOnce();

  assert.equal(connects, 1);
  assert.equal(publishes, 2);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /falha na publicação/);
});

test('reporta status online com o estado da linha', async () => {
  const statuses = [];
  const adapter = {
    async connect() {},
    async readTags() {
      return validValues();
    },
    async close() {},
  };
  const gateway = createGateway({
    adapter,
    publisher: {
      async publish() {},
      async publishStatus(status) {
        statuses.push(status);
      },
    },
    machineId: 'Linha-01',
    clock: () => new Date('2026-11-21T20:00:00.000Z'),
    logger: silentLogger(),
  });

  await gateway.pollOnce();

  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].connected, true);
  assert.equal(statuses[0].running, true);
  assert.equal(statuses[0].lastReadAt, '2026-11-21T20:00:00.000Z');
  assert.equal(statuses[0].failures, 0);
  assert.equal(statuses[0].error, null);
});

test('reporta status offline com falhas ao falhar leitura', async () => {
  const statuses = [];
  const errors = [];
  let reads = 0;
  const adapter = {
    async connect() {},
    async readTags() {
      reads += 1;
      if (reads === 1) throw new Error('timeout ADS');
      return validValues();
    },
    async close() {},
  };
  const gateway = createGateway({
    adapter,
    publisher: {
      async publish() {},
      async publishStatus(status) {
        statuses.push(status);
      },
    },
    machineId: 'Linha-01',
    logger: silentLogger(errors),
  });

  await gateway.pollOnce();
  assert.equal(statuses[0].connected, false);
  assert.equal(statuses[0].failures, 1);
  assert.equal(statuses[0].error, 'timeout ADS');
  assert.equal(statuses[0].running, null);

  await gateway.pollOnce();
  assert.equal(statuses[1].connected, true);
  assert.equal(statuses[1].failures, 0);
  assert.equal(statuses[1].running, true);
});

test('continua publicando telemetria se o status falhar', async () => {
  const errors = [];
  const published = [];
  const gateway = createGateway({
    adapter: {
      async connect() {},
      async readTags() {
        return validValues();
      },
      async close() {},
    },
    publisher: {
      async publish(payload) {
        published.push(payload);
      },
      async publishStatus() {
        throw new Error('backend fora');
      },
    },
    machineId: 'Linha-01',
    logger: silentLogger(errors),
  });

  await gateway.pollOnce();

  assert.equal(published.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /falha ao publicar status/);
});
