'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createConnectionTracker } = require('../src/connection');

const MACHINE = 'Linha-01';

function status(overrides = {}) {
  return {
    machineId: MACHINE,
    connected: true,
    running: false,
    lastReadAt: '2026-11-21T20:00:00.000Z',
    timestamp: '2026-11-21T20:00:00.000Z',
    failures: 0,
    error: null,
    ...overrides,
  };
}

test('estado inicial é desconhecido', () => {
  const tracker = createConnectionTracker();
  const view = tracker.view(MACHINE);

  assert.equal(view.state, 'unknown');
  assert.equal(view.connected, false);
  assert.equal(view.running, null);
});

test('primeiro heartbeat online não gera evento de restabelecimento', () => {
  const tracker = createConnectionTracker();
  const { view, events } = tracker.update(
    MACHINE,
    status(),
    Date.parse('2026-11-21T20:00:00.000Z')
  );

  assert.equal(view.state, 'online');
  assert.equal(view.connected, true);
  assert.equal(view.running, false);
  assert.deepEqual(events, []);
});

test('heartbeat com connected false gera evento connection.lost', () => {
  const tracker = createConnectionTracker();
  const t0 = Date.parse('2026-11-21T20:00:00.000Z');
  tracker.update(MACHINE, status(), t0);

  const result = tracker.update(
    MACHINE,
    status({ connected: false, failures: 1, error: 'timeout ADS' }),
    t0 + 1000
  );

  assert.equal(result.view.state, 'offline');
  assert.equal(result.view.failures, 1);
  assert.equal(result.view.error, 'timeout ADS');
  assert.deepEqual(result.events, ['connection.lost']);
});

test('volta do heartbeat gera evento connection.restored', () => {
  const tracker = createConnectionTracker();
  const t0 = Date.parse('2026-11-21T20:00:00.000Z');
  tracker.update(MACHINE, status(), t0);
  tracker.update(MACHINE, status({ connected: false }), t0 + 1000);

  const result = tracker.update(
    MACHINE,
    status({ running: true, timestamp: '2026-11-21T20:00:02.000Z' }),
    t0 + 2000
  );

  assert.equal(result.view.state, 'online');
  assert.equal(result.view.running, true);
  assert.deepEqual(result.events, ['connection.restored']);
});

test('sweep detecta heartbeat expirado e emite connection.lost uma vez', () => {
  const tracker = createConnectionTracker({ staleMs: 5000 });
  const t0 = Date.parse('2026-11-21T20:00:00.000Z');
  tracker.update(MACHINE, status(), t0);

  assert.deepEqual(tracker.sweep([MACHINE], t0 + 4000), []);

  const perdidos = tracker.sweep([MACHINE], t0 + 6000);
  assert.equal(perdidos.length, 1);
  assert.equal(perdidos[0].view.state, 'offline');
  assert.deepEqual(perdidos[0].events, ['connection.lost']);

  // Depois de marcado como offline, o sweep não repete o evento.
  assert.deepEqual(tracker.sweep([MACHINE], t0 + 7000), []);
});

test('view expira sem sweep e máquina diferente permanece desconhecida', () => {
  const tracker = createConnectionTracker({ staleMs: 5000 });
  const t0 = Date.parse('2026-11-21T20:00:00.000Z');
  tracker.update(MACHINE, status(), t0);

  assert.equal(tracker.view(MACHINE, t0 + 6000).state, 'offline');
  assert.equal(tracker.view(MACHINE, t0 + 6000).error, 'heartbeat expirado');
  assert.equal(tracker.view('machine-02', t0).state, 'unknown');
});
