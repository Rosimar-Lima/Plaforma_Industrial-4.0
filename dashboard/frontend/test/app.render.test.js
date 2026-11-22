'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', 'app.js');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

function criarElemento() {
  return {
    textContent: '',
    title: '',
    style: {},
    hidden: false,
    innerHTML: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return criarElemento(); },
    getContext() { return {}; },
    add() {},
  };
}

function carregarApp() {
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
    fetch: async () => ({ ok: false, status: 503 }),
    setInterval() { return 0; },
    setTimeout() { return 0; },
    requestAnimationFrame(cb) { return setTimeout(() => cb(Date.now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    performance: { now: () => Date.now() },
    Intl,
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
      '};',
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
