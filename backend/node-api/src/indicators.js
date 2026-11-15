'use strict';

function toMillis(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function computeOee(samples, { nominalCapacityPerHour = 400 } = {}) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return {
      availability: 0,
      performance: 0,
      quality: 0,
      oee: 0,
      produced: 0,
      good: 0,
      operatingTimeMs: 0,
      plannedTimeMs: 0,
      nominalCapacityPerHour,
    };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const startedAt = toMillis(first.recorded_at);
  const endedAt = toMillis(last.recorded_at);
  const plannedTimeMs = startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : 0;

  let operatingTimeMs = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    const currentAt = toMillis(current.recorded_at);
    const nextAt = toMillis(next.recorded_at);

    if (currentAt === null || nextAt === null) continue;

    const delta = nextAt - currentAt;
    if (delta > 0 && current.running) {
      operatingTimeMs += delta;
    }
  }

  const produced = Math.max(0, Number(last.produced) - Number(first.produced));
  const good = Math.max(0, Number(last.good) - Number(first.good));

  const availability = plannedTimeMs > 0 ? operatingTimeMs / plannedTimeMs : 0;
  const operatingHours = operatingTimeMs / 3600000;
  const nominalPieces = nominalCapacityPerHour * operatingHours;
  const performance = nominalPieces > 0 ? produced / nominalPieces : 0;
  const quality = produced > 0 ? good / produced : 0;

  return {
    availability: round(Math.min(1, availability)),
    performance: round(Math.min(1, performance)),
    quality: round(Math.min(1, quality)),
    oee: round(Math.min(1, availability) * Math.min(1, performance) * Math.min(1, quality)),
    produced,
    good,
    operatingTimeMs,
    plannedTimeMs,
    nominalCapacityPerHour,
  };
}

module.exports = {
  computeOee,
};
