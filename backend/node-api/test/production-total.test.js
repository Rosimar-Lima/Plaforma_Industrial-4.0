'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeProductionTotal,
  toCounter,
} = require('../src/production-total');

const FIRST = '2026-11-21T19:00:00.000Z';
const RESET = '2026-11-21T19:05:00.000Z';
const AFTER = '2026-11-21T19:06:00.000Z';

test('toCounter ignora valores inválidos e negativos', () => {
  assert.equal(toCounter(123), 123);
  assert.equal(toCounter('123'), 123);
  assert.equal(toCounter(-5), 0);
  assert.equal(toCounter('abc'), 0);
  assert.equal(toCounter(undefined), 0);
  assert.equal(toCounter(null), 0);
});

test('primeira amostra inicia o acumulado com o contador atual', () => {
  const result = computeProductionTotal(null, {
    produced: 100,
    good: 98,
    timestamp: FIRST,
  });

  assert.deepEqual(result, {
    accumulatedProduced: 100,
    accumulatedGood: 98,
    lastCounter: 100,
    lastGoodCounter: 98,
    lastResetAt: null,
    reset: false,
  });
});

test('contadores crescentes somam apenas o delta', () => {
  const previous = computeProductionTotal(null, {
    produced: 100,
    good: 98,
    timestamp: FIRST,
  });

  const result = computeProductionTotal(previous, {
    produced: 110,
    good: 107,
    timestamp: AFTER,
  });

  assert.equal(result.accumulatedProduced, 110);
  assert.equal(result.accumulatedGood, 107);
  assert.equal(result.lastCounter, 110);
  assert.equal(result.reset, false);
  assert.equal(result.lastResetAt, null);
});

test('reset zera o contador atual sem apagar o acumulado', () => {
  const previous = computeProductionTotal(null, {
    produced: 12430,
    good: 12400,
    timestamp: FIRST,
  });

  const result = computeProductionTotal(previous, {
    produced: 0,
    good: 0,
    timestamp: RESET,
  });

  assert.equal(result.accumulatedProduced, 12430);
  assert.equal(result.accumulatedGood, 12400);
  assert.equal(result.lastCounter, 0);
  assert.equal(result.lastGoodCounter, 0);
  assert.equal(result.reset, true);
  assert.equal(result.lastResetAt, RESET);
});

test('após o reset a produção volta a acumular a partir do novo contador', () => {
  const reset = computeProductionTotal(
    { accumulatedProduced: 12430, accumulatedGood: 12400, lastCounter: 12430, lastGoodCounter: 12400 },
    { produced: 0, good: 0, timestamp: RESET }
  );

  const result = computeProductionTotal(reset, {
    produced: 12,
    good: 11,
    timestamp: AFTER,
  });

  assert.equal(result.accumulatedProduced, 12442);
  assert.equal(result.accumulatedGood, 12411);
  assert.equal(result.reset, false);
  assert.equal(result.lastResetAt, RESET);
});

test('queda apenas do contador de bons também é registrada como reset', () => {
  const previous = {
    accumulatedProduced: 500,
    accumulatedGood: 490,
    lastCounter: 500,
    lastGoodCounter: 490,
    lastResetAt: null,
  };

  const result = computeProductionTotal(previous, {
    produced: 505,
    good: 3,
    timestamp: RESET,
  });

  assert.equal(result.accumulatedProduced, 500);
  assert.equal(result.accumulatedGood, 490);
  assert.equal(result.reset, true);
  assert.equal(result.lastResetAt, RESET);
});

test('contador inválido na amostra não reduz o acumulado', () => {
  const previous = {
    accumulatedProduced: 500,
    accumulatedGood: 490,
    lastCounter: 500,
    lastGoodCounter: 490,
    lastResetAt: null,
  };

  const result = computeProductionTotal(previous, {
    produced: 'indisponível',
    good: -1,
    timestamp: AFTER,
  });

  assert.equal(result.accumulatedProduced, 500);
  assert.equal(result.accumulatedGood, 490);
  assert.equal(result.reset, true);
});
