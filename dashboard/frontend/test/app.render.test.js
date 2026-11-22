'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', 'app.js');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

function criarElemento() {
  const listeners = new Map();
  return {
    textContent: '',
    title: '',
    style: {},
    hidden: false,
    innerHTML: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatch(type) {
      for (const handler of listeners.get(type) || []) handler();
    },
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    querySelector() { return criarElemento(); },
    getContext() { return {}; },
    add() {},
  };
}

function chaveHoje() {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

function carregarApp(opcoes = {}) {
  const elementos = new Map();
  const obter = (id) => {
    if (!elementos.has(id)) elementos.set(id, criarElemento());
    return elementos.get(id);
  };

  const contexto = {
    console: { error() {}, log() {} },
    document: {
      getElementById: obter,
      addEventListener() {},
      querySelector: (sel) => obter(`query:${sel}`),
    },
    window: { addEventListener() {} },
    EventSource: undefined,
    localStorage: opcoes.localStorage || {
      getItem: () => chaveHoje(),
      setItem() {},
    },
    fetch: opcoes.fetch || (async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })),
    setInterval() { return 0; },
    setTimeout() { return 0; },
    requestAnimationFrame(cb) { return setTimeout(() => cb(Date.now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    performance: { now: () => Date.now() },
    Intl,
    URLSearchParams,
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    Promise,
    Option: class {},
  };
  contexto.globalThis = contexto;

  vm.createContext(contexto);
  vm.runInContext(
    fs.readFileSync(APP_PATH, 'utf8') +
      '\nglobalThis.__renderizar = (connection, amostra) => {' +
      '  state.lineConnection = connection;' +
      '  state.samples = amostra;' +
      '  renderOperation();' +
      '  return { texto: el.running.textContent, cor: el.running.style.color };' +
      '};' +
      '\nglobalThis.__etapasProntas = () => {' +
      '  state.monitoring.stages.forEach((s) => { s.status = "done"; });' +
      '  renderBoot();' +
      '};' +
      '\nglobalThis.__bootProgresso = (reveladas, decorridoMs) => {' +
      '  state.boot.revealed = reveladas;' +
      '  state.boot.startedAt = Date.now() - decorridoMs;' +
      '  renderBoot();' +
      '  return { percent: el.bootPercent.textContent, hidden: el.bootScreen.hidden, hint: el.bootHint.textContent };' +
      '};' +
      '\nglobalThis.__pronto = () => {' +
      '  state.monitoring.stages.forEach((s) => { s.status = "done"; });' +
      '  state.boot.revealed = state.monitoring.stages.length;' +
      '  state.boot.startedAt = Date.now() - 60000;' +
      '  renderBoot();' +
      '};' +
      '\nglobalThis.__statusSistema = (status) => renderShutdown(status);' +
      '\nglobalThis.__maquina = (id) => { state.machineId = id; };' +
      '\nglobalThis.__estadoLinha = () => state.shutdown.lineState;',
    contexto
  );

  return { contexto, obter };
}

function renderizar(nome, connection, amostra, textoEsperado, corEsperada, tituloEsperado) {
  const { contexto, obter } = carregarApp();
  const resultado = contexto.__renderizar(connection, amostra);
  const titulo = obter('stat-running').title;

  assert.equal(resultado.texto, textoEsperado, `${nome}: texto do card`);
  assert.equal(resultado.cor, corEsperada, `${nome}: cor do card`);
  assert.equal(titulo, tituloEsperado, `${nome}: tooltip do card`);
}

test('card Operação mostra "Linha sem comunicação" quando o gateway não lê o CLP', () => {
  renderizar(
    'offline',
    { state: 'offline', connected: false, error: 'ADS fora' },
    [{ payload: { line: { running: false } } }],
    'Linha sem comunicação',
    'var(--danger)',
    'O gateway não consegue ler o CLP da linha'
  );
});

test('card Operação mostra "Operação Parada" quando o CLP responde com bRunning=false', () => {
  renderizar(
    'online/parada',
    { state: 'online', connected: true, running: false },
    [{ payload: { line: { running: false } } }],
    'Operação Parada',
    'var(--warn)',
    ''
  );
});

test('card Operação mostra "Linha em operação" quando o CLP responde com bRunning=true', () => {
  renderizar(
    'online/operando',
    { state: 'online', connected: true, running: true },
    [{ payload: { line: { running: true } } }],
    'Linha em operação',
    'var(--ok)',
    ''
  );
});

test('card Operação mostra "—" antes da primeira amostra', () => {
  renderizar('sem dados', null, [], '—', 'var(--muted)', '');
});

test('dashboard não exibe o badge redundante "Tempo real"', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const js = fs.readFileSync(APP_PATH, 'utf8');

  assert.doesNotMatch(html, /id="connection"/);
  assert.doesNotMatch(js, /Tempo real/);
});

test('Atualizar abre popup centralizado quando o monitoramento está desligado', () => {
  const { obter } = carregarApp();
  const modal = obter('warning-modal');
  const mensagem = obter('warning-message');
  const eventos = obter('monitoring-events');

  modal.hidden = true;

  obter('refresh').dispatch('click');

  assert.equal(modal.hidden, false);
  assert.equal(mensagem.textContent, 'Ligue o monitoramento para atualizar os dados.');
  assert.match(eventos.innerHTML, /Ligue o monitoramento para atualizar os dados/);

  obter('warning-dismiss').dispatch('click');
  assert.equal(modal.hidden, true);
});

test('Tela de inicialização aparece no primeiro acesso e abre o painel automaticamente', () => {
  const armazenamento = {
    valor: null,
    getItem() { return this.valor; },
    setItem(chave, valor) { this.valor = valor; },
  };
  const { contexto, obter } = carregarApp({ localStorage: armazenamento });

  assert.equal(obter('boot-screen').hidden, false);
  assert.equal(obter('boot-enter').disabled, true);
  assert.match(obter('boot-hint').textContent, /verificações iniciais/);

  contexto.__pronto();
  assert.equal(obter('boot-screen').hidden, true);
  assert.equal(armazenamento.valor, chaveHoje());
});

test('Abertura revela as etapas gradualmente e entra só depois do tempo mínimo', () => {
  const armazenamento = {
    valor: null,
    getItem() { return this.valor; },
    setItem(chave, valor) { this.valor = valor; },
  };
  const { contexto, obter } = carregarApp({ localStorage: armazenamento });

  contexto.__etapasProntas();
  let resultado = contexto.__bootProgresso(2, 2500);
  assert.equal(resultado.percent, '33%');
  assert.equal(resultado.hidden, false);
  assert.equal(obter('boot-enter').disabled, true);
  assert.match(obter('boot-stages').innerHTML, /Aguardando verificação/);
  assert.doesNotMatch(obter('boot-stages').innerHTML, /Acumulado de produção carregado/);

  resultado = contexto.__bootProgresso(6, 5000);
  assert.equal(resultado.percent, '100%');
  assert.equal(resultado.hidden, false);
  assert.match(resultado.hint, /Finalizando a abertura/);
  assert.equal(obter('boot-enter').disabled, true);

  resultado = contexto.__bootProgresso(6, 10000);
  assert.equal(resultado.hidden, true);
  assert.equal(armazenamento.valor, chaveHoje());
});

test('Encerramento seguro confirma o painel pausado e mostra o progresso do script', async () => {
  const chamadas = [];
  const { contexto, obter } = carregarApp({
    fetch: async (url, options) => {
      chamadas.push({ url, options });
      if (url.includes('/connection')) {
        return { ok: true, status: 200, json: async () => ({ state: 'offline' }) };
      }
      return { ok: true, status: 202, json: async () => ({}) };
    },
  });
  obter('shutdown-modal').hidden = true;
  contexto.__maquina('Linha-01');

  assert.equal(obter('shutdown-modal').hidden, true);
  obter('shutdown-open').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(obter('shutdown-modal').hidden, false);
  assert.equal(obter('shutdown-line-title').textContent, 'Linha desligada confirmada');
  assert.equal(obter('shutdown-confirm').hidden, true);
  const stop = chamadas.find((chamada) => chamada.url === '/api/system/stop');
  assert.ok(stop);
  assert.equal(stop.options.method, 'POST');
  assert.equal(stop.options.headers['x-pi40-control'], '1');
  assert.equal(obter('shutdown-instruction').hidden, true);
  assert.match(obter('shutdown-steps').innerHTML, /1\. Pausar dashboard e stream/);
  assert.match(obter('shutdown-steps').innerHTML, /stage done/);

  contexto.__statusSistema({
    state: 'running',
    action: 'Stop',
    message: 'Parando o gateway.',
    steps: [
      { id: 'dashboard', label: 'Pausar dashboard e stream', status: 'done', detail: 'Pausado.' },
      { id: 'gateway', label: 'Parar serviço PI40Gateway', status: 'active', detail: 'Parando...' },
    ],
  });
  assert.match(obter('shutdown-steps').innerHTML, /stage active/);
  assert.equal(obter('shutdown-status').textContent, 'Encerrando');
  assert.equal(obter('shutdown-instruction').hidden, true);
  assert.equal(obter('shutdown-copy').hidden, true);

  contexto.__statusSistema({
    state: 'done',
    action: 'Stop',
    message: 'Encerramento seguro concluído.',
    steps: [],
  });
  assert.equal(obter('shutdown-final').hidden, false);
  assert.match(obter('shutdown-final').textContent, /Fechando esta página/);

  obter('shutdown-dismiss').dispatch('click');
  assert.equal(obter('shutdown-modal').hidden, true);
});

test('Linha apenas parada bloqueia o encerramento', async () => {
  const chamadas = [];
  const { contexto, obter } = carregarApp({
    fetch: async (url) => {
      chamadas.push(url);
      return { ok: true, status: 200, json: async () => ({ state: 'online', running: false }) };
    },
  });
  obter('shutdown-modal').hidden = true;
  contexto.__maquina('Linha-01');

  obter('shutdown-open').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(obter('shutdown-line-title').textContent, 'Linha apenas parada');
  assert.equal(obter('shutdown-confirm').hidden, false);
  assert.equal(obter('shutdown-confirm').textContent, 'Verificar novamente');
  assert.match(obter('shutdown-line-detail').textContent, /não é permitido/);
  assert.equal(chamadas.includes('/api/system/stop'), false);

  obter('shutdown-confirm').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(chamadas.includes('/api/system/stop'), false);
});

test('Falha no acionamento automático oferece o atalho manual', async () => {
  const { contexto, obter } = carregarApp({
    fetch: async (url) => {
      if (url.includes('/connection')) {
        return { ok: true, status: 200, json: async () => ({ state: 'offline' }) };
      }
      return { ok: false, status: 502, json: async () => ({}) };
    },
  });
  obter('shutdown-modal').hidden = true;
  contexto.__maquina('Linha-01');

  obter('shutdown-open').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(obter('shutdown-instruction').hidden, false);
  assert.equal(obter('shutdown-copy').hidden, false);
  assert.match(obter('shutdown-message').textContent, /ENCERRAR-PI40\.cmd/);
});
