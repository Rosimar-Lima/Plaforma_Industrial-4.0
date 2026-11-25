'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createControlAgent } = require('../src/control-agent');

function fakeChild() {
  return { exitCode: null, killed: false };
}

function criarAgente(launcher, agora = () => Date.parse('2026-11-22T12:00:00.000Z')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi40-agente-'));
  const commandPath = path.join(dir, 'system-command.json');
  const agent = createControlAgent({
    token: 'token-de-teste',
    commandPath,
    repoDir: path.resolve(__dirname, '../..'),
    launcher,
    logger: {},
    now: agora,
  });
  return { agent, dir, commandPath };
}

function escrever(commandPath, overrides = {}) {
  fs.writeFileSync(
    commandPath,
    JSON.stringify({
      action: 'stop',
      token: 'token-de-teste',
      requestedAt: '2026-11-22T12:00:00.000Z',
      nonce: 'abc123',
      ...overrides,
    }),
    'utf8'
  );
}

test('launcher padrão passa o caminho do script sem aspas literais', () => {
  const { agent, dir } = criarAgente(() => {});
  try {
    assert.equal(agent.scriptArgs[4], agent.scriptPath);
    assert.equal(agent.scriptArgs.includes(`"${agent.scriptPath}"`), false);
    assert.equal(agent.scriptArgs[5], '-Action');
    assert.equal(fs.existsSync(agent.scriptPath), true);
  } finally {
    agent.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agente não aciona nada quando não há pedido', async () => {
  const chamadas = [];
  const { agent, dir } = criarAgente((action) => chamadas.push(action));
  try {
    await agent.checkCommand();
    assert.deepEqual(chamadas, []);
  } finally {
    agent.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agente descarta pedido sem token válido ou ação desconhecida', async () => {
  const chamadas = [];
  const { agent, dir, commandPath } = criarAgente((action) => chamadas.push(action));
  try {
    escrever(commandPath, { token: 'errado' });
    await agent.checkCommand();
    assert.deepEqual(chamadas, []);
    assert.equal(fs.existsSync(commandPath), false);

    escrever(commandPath, { action: 'restart' });
    await agent.checkCommand();
    assert.deepEqual(chamadas, []);
    assert.equal(fs.existsSync(commandPath), false);
  } finally {
    agent.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agente descarta pedido expirado', async () => {
  const chamadas = [];
  const { agent, dir, commandPath } = criarAgente((action) => chamadas.push(action));
  try {
    escrever(commandPath, { requestedAt: '2026-11-22T11:00:00.000Z' });
    await agent.checkCommand();
    assert.deepEqual(chamadas, []);
    assert.equal(fs.existsSync(commandPath), false);
  } finally {
    agent.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agente aciona Stop uma vez e ignora repetição do mesmo pedido', async () => {
  const chamadas = [];
  let child = fakeChild();
  const { agent, dir, commandPath } = criarAgente((action) => {
    chamadas.push(action);
    return child;
  });
  try {
    escrever(commandPath);
    await agent.checkCommand();
    assert.deepEqual(chamadas, ['Stop']);
    assert.equal(fs.existsSync(commandPath), false);
    assert.equal(agent.isBusy(), true);

    escrever(commandPath);
    await agent.checkCommand();
    assert.deepEqual(chamadas, ['Stop']);
    assert.equal(fs.existsSync(commandPath), false);

    child.exitCode = 0;
    escrever(commandPath, { action: 'start', nonce: 'def456' });
    await agent.checkCommand();
    assert.deepEqual(chamadas, ['Stop', 'Start']);
  } finally {
    agent.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('processo encerrado por sinal libera o agente para nova ação', async () => {
  const chamadas = [];
  const child = { exitCode: null, signalCode: null, killed: false };
  const { agent, dir, commandPath } = criarAgente((action) => {
    chamadas.push(action);
    return child;
  });
  try {
    escrever(commandPath);
    await agent.checkCommand();
    assert.equal(agent.isBusy(), true);

    child.signalCode = 'SIGTERM';
    assert.equal(agent.isBusy(), false);

    escrever(commandPath, { action: 'start', nonce: 'novo-pedido' });
    await agent.checkCommand();
    assert.deepEqual(chamadas, ['Stop', 'Start']);
  } finally {
    agent.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pedido fica pendente enquanto o script anterior está rodando', async () => {
  const chamadas = [];
  const { agent, dir, commandPath } = criarAgente((action) => {
    chamadas.push(action);
    return fakeChild();
  });
  try {
    escrever(commandPath);
    await agent.checkCommand();

    escrever(commandPath, { nonce: 'segue-na-fila' });
    await agent.checkCommand();
    assert.deepEqual(chamadas, ['Stop']);
    assert.equal(fs.existsSync(commandPath), true);
  } finally {
    agent.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
