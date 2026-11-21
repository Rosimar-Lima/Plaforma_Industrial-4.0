'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeProductionBuckets,
  normalizeProductionOptions,
} = require('../src/production');

function sample(recordedAt, running, produced, good = produced) {
  return { recorded_at: recordedAt, running, produced, good };
}

test('agrupa produção por hora com tempo operando e parado', () => {
  const samples = [
    sample('2026-01-01T00:00:00.000Z', true, 0),
    sample('2026-01-01T00:30:00.000Z', true, 60),
    sample('2026-01-01T01:00:00.000Z', false, 60),
    sample('2026-01-01T02:00:00.000Z', false, 60),
  ];

  const result = computeProductionBuckets(samples, {
    bucket: 'hour',
    timeZone: 'UTC',
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-01T02:00:00.000Z',
  });

  assert.equal(result.buckets.length, 2);

  const [first, second] = result.buckets;
  assert.equal(first.label, '00:00');
  assert.equal(first.produced, 60);
  assert.equal(first.good, 60);
  assert.equal(first.scrap, 0);
  assert.equal(first.quality, 1);
  assert.equal(first.operatingTimeMs, 3600000);
  assert.equal(first.stoppedTimeMs, 0);
  assert.equal(first.availability, 1);

  assert.equal(second.label, '01:00');
  assert.equal(second.produced, 0);
  assert.equal(second.operatingTimeMs, 0);
  assert.equal(second.stoppedTimeMs, 3600000);
  assert.equal(second.availability, 0);

  assert.deepEqual(result.totals, {
    produced: 60,
    good: 60,
    scrap: 0,
    operatingTimeMs: 3600000,
    stoppedTimeMs: 3600000,
    plannedTimeMs: 7200000,
    quality: 1,
    availability: 0.5,
  });
});

test('agrupa em turnos de 8 horas a partir das 06:00', () => {
  const result = computeProductionBuckets(
    [
      sample('2026-01-01T05:30:00.000Z', true, 0),
      sample('2026-01-01T06:00:00.000Z', true, 30),
      sample('2026-01-01T06:30:00.000Z', true, 60),
    ],
    {
      bucket: 'shift',
      timeZone: 'UTC',
      shiftStartHour: 6,
      shiftHours: 8,
      from: '2026-01-01T05:30:00.000Z',
      to: '2026-01-01T06:30:00.000Z',
    }
  );

  assert.equal(result.buckets.length, 2);
  assert.equal(result.buckets[0].label, '22:00-06:00');
  assert.equal(result.buckets[0].start, '2025-12-31T22:00:00.000Z');
  assert.equal(result.buckets[0].plannedTimeMs, 1800000);
  assert.equal(result.buckets[0].operatingTimeMs, 1800000);

  assert.equal(result.buckets[1].label, '06:00-14:00');
  assert.equal(result.buckets[1].start, '2026-01-01T06:00:00.000Z');
  assert.equal(result.buckets[1].produced, 60);
  assert.equal(result.buckets[1].plannedTimeMs, 1800000);
});

test('turnos cuja duração não divide 24 h usam o limite correto', () => {
  const cases = [
    {
      from: '2026-01-01T10:30:00.000Z',
      hours: 7,
      start: '2026-01-01T06:00:00.000Z',
      label: '06:00-13:00',
    },
    {
      from: '2026-01-01T14:30:00.000Z',
      hours: 7,
      start: '2026-01-01T13:00:00.000Z',
      label: '13:00-20:00',
    },
    {
      from: '2026-01-01T00:30:00.000Z',
      hours: 7,
      start: '2025-12-31T23:00:00.000Z',
      label: '23:00-06:00',
    },
    {
      from: '2026-01-01T00:30:00.000Z',
      hours: 5,
      start: '2025-12-31T20:00:00.000Z',
      label: '20:00-01:00',
    },
  ];

  for (const { from, hours, start, label } of cases) {
    const result = computeProductionBuckets([], {
      bucket: 'shift',
      timeZone: 'UTC',
      shiftStartHour: 6,
      shiftHours: hours,
      from,
      to: new Date(Date.parse(from) + 60000).toISOString(),
    });

    assert.equal(result.buckets[0].start, start);
    assert.equal(result.buckets[0].label, label);
  }
});

test('respeita o fuso horário da planta nos rótulos', () => {
  const result = computeProductionBuckets([], {
    bucket: 'hour',
    timeZone: 'America/Sao_Paulo',
    from: '2026-01-01T12:00:00.000Z',
    to: '2026-01-01T14:00:00.000Z',
  });

  assert.equal(result.buckets.length, 2);
  assert.equal(result.buckets[0].label, '09:00');
  assert.equal(result.buckets[1].label, '10:00');
  assert.equal(result.timeZone, 'America/Sao_Paulo');
});

test('intervalo sem telemetria conta como tempo parado', () => {
  const result = computeProductionBuckets(
    [
      sample('2026-01-01T00:00:00.000Z', false, 10),
      sample('2026-01-01T03:00:00.000Z', false, 10),
    ],
    {
      bucket: 'hour',
      timeZone: 'UTC',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T03:00:00.000Z',
    }
  );

  assert.equal(result.buckets.length, 3);
  for (const bucket of result.buckets) {
    assert.equal(bucket.produced, 0);
    assert.equal(bucket.operatingTimeMs, 0);
    assert.equal(bucket.stoppedTimeMs, 3600000);
  }
});

test('contadores que diminuem são tratados como zero', () => {
  const result = computeProductionBuckets(
    [
      sample('2026-01-01T00:00:00.000Z', true, 200, 190),
      sample('2026-01-01T01:00:00.000Z', true, 100, 95),
      sample('2026-01-01T02:00:00.000Z', true, 150, 140),
    ],
    {
      bucket: 'hour',
      timeZone: 'UTC',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T02:00:00.000Z',
    }
  );

  assert.equal(result.buckets[0].produced, 0);
  assert.equal(result.buckets[1].produced, 50);
  assert.equal(result.buckets[1].good, 45);
  assert.equal(result.buckets[1].scrap, 5);
  assert.equal(result.buckets[1].quality, 0.9);
});

test('bucket atual é limitado ao fim do período', () => {
  const result = computeProductionBuckets([], {
    bucket: 'hour',
    timeZone: 'UTC',
    from: '2026-01-01T10:00:00.000Z',
    to: '2026-01-01T10:20:00.000Z',
  });

  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].plannedTimeMs, 1200000);
  assert.equal(result.buckets[0].stoppedTimeMs, 1200000);
});

test('rejeita opções e períodos inválidos', () => {
  assert.throws(() => normalizeProductionOptions({ bucket: 'day' }), /bucket inválido/);
  assert.throws(
    () => normalizeProductionOptions({ timeZone: 'Marte/Olympus' }),
    /fuso horário inválido/
  );
  assert.throws(
    () => normalizeProductionOptions({ shiftStartHour: 24 }),
    /shiftStartHour inválido/
  );
  assert.throws(() => normalizeProductionOptions({ shiftHours: 0 }), /shiftHours inválido/);

  assert.throws(
    () =>
      computeProductionBuckets([], {
        from: '2026-01-01T02:00:00.000Z',
        to: '2026-01-01T01:00:00.000Z',
      }),
    /período inválido/
  );
});
