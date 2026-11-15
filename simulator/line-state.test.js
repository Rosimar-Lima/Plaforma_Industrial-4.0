'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TIMINGS_MS,
  createLineState,
  tick,
} = require('./line-state');

function advance(state, totalMs, { tickMs = 10, commands = {}, onTick } = {}) {
  let remaining = totalMs;
  let first = true;

  while (remaining > 0) {
    const delta = Math.min(tickMs, remaining);
    tick(state, delta, first ? commands : {});
    if (onTick) onTick(state);
    remaining -= delta;
    first = false;
  }

  return state;
}

function advanceUntil(state, predicate, { tickMs = 10, maxMs = 120000 } = {}) {
  let elapsed = 0;

  while (elapsed < maxMs) {
    tick(state, tickMs, {});
    elapsed += tickMs;
    if (predicate(state)) return elapsed;
  }

  throw new Error('Condição não atingida dentro do tempo máximo.');
}

test('start liga a linha e a esteira inicia o transporte', () => {
  const state = createLineState();
  tick(state, 10, { start: true });

  assert.equal(state.running, true);
  assert.equal(state.step, 0);
  assert.equal(state.conveyorOn, true);
});

test('ciclo cumpre as etapas e os intertravamentos da EV e da AT', () => {
  const state = createLineState();
  tick(state, 10, { start: true });

  advanceUntil(state, (s) => s.step === 1);
  tick(state, 10, {});
  assert.equal(state.sensorS1, true);
  assert.equal(state.conveyorOn, false);

  advanceUntil(state, (s) => s.step === 2);
  assert.equal(state.beltStopped, true);
  assert.equal(state.bottlePositioned, true);
  assert.equal(state.evOn, true);

  advanceUntil(state, (s) => s.fillPercent >= 50);
  assert.equal(state.fillDone, false);
  assert.equal(state.bottlesFilled, 0);

  advanceUntil(state, (s) => s.fillDone);
  assert.equal(state.bottlesFilled, 1);
  assert.equal(state.fillPercent, 100);
  assert.equal(state.evOn, false);

  advanceUntil(state, (s) => s.step === 3);
  advanceUntil(state, (s) => s.step === 1 && s.s2Occupied);

  advanceUntil(state, (s) => s.step === 2);
  assert.equal(state.sensorS2, true);
  assert.equal(state.atOn, true);

  advanceUntil(state, (s) => s.capped);
  assert.equal(state.bottlesCapped, 1);
  assert.equal(state.productionTotal, 1);
  assert.equal(state.atOn, false);
});

test('regras de intertravamento valem em todas as amostras', () => {
  const state = createLineState();
  tick(state, 10, { start: true });

  for (let i = 0; i < 6000; i += 1) {
    tick(state, 10, {});
    if (state.evOn) {
      assert.equal(state.bottlePositioned, true);
      assert.equal(state.running, true);
      assert.equal(state.fillDone, false);
    }
    if (state.atOn) {
      assert.equal(state.sensorS2, true);
      assert.equal(state.beltStopped, true);
      assert.equal(state.capped, false);
    }
  }
});

test('stop pausa preservando a etapa e reset zera os contadores', () => {
  const state = createLineState();
  tick(state, 10, { start: true });
  advance(state, 30000);

  assert.ok(state.productionTotal > 0);

  tick(state, 10, { stop: true });
  assert.equal(state.running, false);
  assert.equal(state.conveyorOn, false);

  const pausedStep = state.step;
  advance(state, 5000);
  assert.equal(state.step, pausedStep);

  tick(state, 10, { reset: true });
  assert.equal(state.bottlesFilled, 0);
  assert.equal(state.bottlesCapped, 0);
  assert.equal(state.productionTotal, 0);
  assert.equal(state.step, 0);
});

test('reset é ignorado com a linha em operação', () => {
  const state = createLineState();
  tick(state, 10, { start: true });
  advance(state, 30000);

  const total = state.productionTotal;
  tick(state, 10, { reset: true });

  assert.equal(state.running, true);
  assert.equal(state.productionTotal, total);
});

test('timings refletem o ciclo do MAIN.st', () => {
  assert.equal(TIMINGS_MS.transportToS1, 3270);
  assert.equal(TIMINGS_MS.sensorS1, 460);
  assert.equal(TIMINGS_MS.fill, 2000);
  assert.equal(TIMINGS_MS.capping, 1200);
  assert.equal(TIMINGS_MS.transportOut, 2770);
});
