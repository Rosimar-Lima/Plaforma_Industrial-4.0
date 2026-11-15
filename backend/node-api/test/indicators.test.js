'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeOee } = require('../src/indicators');

function sample(recordedAt, running, produced, good) {
  return { recorded_at: recordedAt, running, produced, good };
}

test('calcula disponibilidade, performance, qualidade e OEE', () => {
  const samples = [
    sample('2026-01-01T00:00:00.000Z', true, 0, 0),
    sample('2026-01-01T01:00:00.000Z', false, 100, 90),
    sample('2026-01-01T02:00:00.000Z', false, 200, 180),
  ];

  const result = computeOee(samples, { nominalCapacityPerHour: 400 });

  assert.equal(result.availability, 0.5);
  assert.equal(result.performance, 0.5);
  assert.equal(result.quality, 0.9);
  assert.equal(result.oee, 0.225);
  assert.equal(result.produced, 200);
  assert.equal(result.good, 180);
  assert.equal(result.operatingTimeMs, 3600000);
  assert.equal(result.plannedTimeMs, 7200000);
});

test('retorna zeros sem amostras suficientes', () => {
  assert.deepEqual(computeOee([], { nominalCapacityPerHour: 400 }), {
    availability: 0,
    performance: 0,
    quality: 0,
    oee: 0,
    produced: 0,
    good: 0,
    operatingTimeMs: 0,
    plannedTimeMs: 0,
    nominalCapacityPerHour: 400,
  });

  const single = computeOee([sample('2026-01-01T00:00:00.000Z', true, 0, 0)]);
  assert.equal(single.oee, 0);
});

test('qualidade é zero quando não há produção', () => {
  const samples = [
    sample('2026-01-01T00:00:00.000Z', true, 10, 10),
    sample('2026-01-01T01:00:00.000Z', true, 10, 10),
  ];

  const result = computeOee(samples, { nominalCapacityPerHour: 400 });
  assert.equal(result.availability, 1);
  assert.equal(result.quality, 0);
  assert.equal(result.oee, 0);
});

test('performance é limitada a 1 quando excede a capacidade nominal', () => {
  const samples = [
    sample('2026-01-01T00:00:00.000Z', true, 0, 0),
    sample('2026-01-01T01:00:00.000Z', true, 1000, 900),
  ];

  const result = computeOee(samples, { nominalCapacityPerHour: 100 });
  assert.equal(result.performance, 1);
  assert.equal(result.oee, 0.9);
});

test('contadores que diminuem são tratados como zero', () => {
  const samples = [
    sample('2026-01-01T00:00:00.000Z', true, 200, 180),
    sample('2026-01-01T01:00:00.000Z', true, 100, 90),
  ];

  const result = computeOee(samples, { nominalCapacityPerHour: 400 });
  assert.equal(result.produced, 0);
  assert.equal(result.good, 0);
  assert.equal(result.quality, 0);
});
