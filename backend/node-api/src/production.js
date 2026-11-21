'use strict';

const HOUR_MS = 3600000;
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_SHIFT_START_HOUR = 6;
const DEFAULT_SHIFT_HOURS = 8;
const MAX_BUCKETS = 1000;

const formatterCache = new Map();

function getFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }
  return formatterCache.get(timeZone);
}

function isValidTimeZone(timeZone) {
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date, timeZone) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function offsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function wallToUtc({ year, month, day, hour }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, 0, 0);
  const firstGuess = wall - offsetMs(new Date(wall), timeZone);
  return wall - offsetMs(new Date(firstGuess), timeZone);
}

function normalizeProductionOptions({
  bucket = 'hour',
  timeZone = DEFAULT_TIME_ZONE,
  shiftStartHour = DEFAULT_SHIFT_START_HOUR,
  shiftHours = DEFAULT_SHIFT_HOURS,
} = {}) {
  if (bucket !== 'hour' && bucket !== 'shift') {
    throw new Error(`bucket inválido: ${bucket}`);
  }

  if (!isValidTimeZone(timeZone)) {
    throw new Error(`fuso horário inválido: ${timeZone}`);
  }

  if (!Number.isInteger(shiftStartHour) || shiftStartHour < 0 || shiftStartHour > 23) {
    throw new Error(`shiftStartHour inválido: ${shiftStartHour}`);
  }

  if (!Number.isInteger(shiftHours) || shiftHours < 1 || shiftHours > 24) {
    throw new Error(`shiftHours inválido: ${shiftHours}`);
  }

  return { bucket, timeZone, shiftStartHour, shiftHours };
}

function bucketStartAt(date, options) {
  const parts = zonedParts(date, options.timeZone);

  if (options.bucket === 'hour') {
    return wallToUtc({ ...parts, hour: parts.hour }, options.timeZone);
  }

  let start = wallToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: options.shiftStartHour,
    },
    options.timeZone
  );

  const at = date.getTime();
  let guard = 0;

  while (start > at && guard < 24) {
    start = previousBucketStart(start, options);
    guard += 1;
  }

  guard = 0;
  while (nextBucketStart(start, options) <= at && guard < 24) {
    start = nextBucketStart(start, options);
    guard += 1;
  }

  return start;
}

function nextBucketStart(startMs, options) {
  return shiftByHours(startMs, options.bucket === 'hour' ? 1 : options.shiftHours, options);
}

function previousBucketStart(startMs, options) {
  return shiftByHours(startMs, -options.shiftHours, options);
}

function shiftByHours(startMs, hours, options) {
  const parts = zonedParts(new Date(startMs), options.timeZone);
  const wall = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour + hours)
  );

  return wallToUtc(
    {
      year: wall.getUTCFullYear(),
      month: wall.getUTCMonth() + 1,
      day: wall.getUTCDate(),
      hour: wall.getUTCHours(),
    },
    options.timeZone
  );
}

function padHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function bucketLabel(startMs, endMs, options) {
  const startHour = zonedParts(new Date(startMs), options.timeZone).hour;
  if (options.bucket === 'hour') return padHour(startHour);

  const endHour = zonedParts(new Date(endMs), options.timeZone).hour;
  return `${padHour(startHour)}-${padHour(endHour)}`;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function toMillis(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function bucketIndexAt(buckets, at) {
  let low = 0;
  let high = buckets.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const bucket = buckets[middle];
    if (at < bucket.startMs) high = middle - 1;
    else if (at >= bucket.endMs) low = middle + 1;
    else return middle;
  }

  return -1;
}

function computeProductionBuckets(samples, options = {}) {
  const settings = normalizeProductionOptions(options);
  const nowMs = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const toMs = options.to ? toMillis(options.to) : nowMs;
  const fromMs = options.from ? toMillis(options.from) : toMs - 24 * HOUR_MS;

  if (fromMs === null || toMs === null || fromMs >= toMs) {
    throw new Error('período inválido');
  }

  const points = (Array.isArray(samples) ? samples : [])
    .map((sample) => ({
      at: toMillis(sample.recorded_at),
      running: Boolean(sample.running),
      produced: Number(sample.produced) || 0,
      good: Number(sample.good) || 0,
    }))
    .filter((point) => point.at !== null)
    .sort((left, right) => left.at - right.at);

  const buckets = [];
  let start = bucketStartAt(new Date(fromMs), settings);

  while (start < toMs) {
    if (buckets.length >= MAX_BUCKETS) {
      throw new RangeError(`período excede ${MAX_BUCKETS} intervalos`);
    }

    const end = nextBucketStart(start, settings);
    const windowStart = Math.max(start, fromMs);
    const windowEnd = Math.min(end, toMs);

    buckets.push({
      startMs: start,
      endMs: end,
      plannedTimeMs: Math.max(0, windowEnd - windowStart),
      produced: 0,
      good: 0,
      operatingTimeMs: 0,
    });

    start = end;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    const intervalStart = Math.max(previous.at, fromMs);
    const intervalEnd = Math.min(current.at, toMs);
    if (intervalEnd <= intervalStart) continue;

    const producedDelta =
      current.produced >= previous.produced ? current.produced - previous.produced : 0;
    const goodDelta = current.good >= previous.good ? current.good - previous.good : 0;

    const target = bucketIndexAt(buckets, Math.min(current.at, toMs - 1));
    if (target >= 0) {
      buckets[target].produced += producedDelta;
      buckets[target].good += goodDelta;
    }

    if (!previous.running) continue;

    for (const bucket of buckets) {
      const overlap =
        Math.min(intervalEnd, bucket.endMs) - Math.max(intervalStart, bucket.startMs);
      if (overlap > 0) bucket.operatingTimeMs += overlap;
    }
  }

  const views = buckets.map((bucket) => {
    const plannedTimeMs = bucket.plannedTimeMs;
    const operatingTimeMs = Math.min(bucket.operatingTimeMs, plannedTimeMs);
    const produced = Math.max(0, bucket.produced);
    const good = Math.max(0, Math.min(bucket.good, produced));

    return {
      start: new Date(bucket.startMs).toISOString(),
      end: new Date(bucket.endMs).toISOString(),
      label: bucketLabel(bucket.startMs, bucket.endMs, settings),
      produced,
      good,
      scrap: produced - good,
      quality: produced > 0 ? round(good / produced) : 0,
      operatingTimeMs,
      stoppedTimeMs: plannedTimeMs - operatingTimeMs,
      plannedTimeMs,
      availability: plannedTimeMs > 0 ? round(operatingTimeMs / plannedTimeMs) : 0,
    };
  });

  const totals = views.reduce(
    (accumulator, bucket) => ({
      produced: accumulator.produced + bucket.produced,
      good: accumulator.good + bucket.good,
      scrap: accumulator.scrap + bucket.scrap,
      operatingTimeMs: accumulator.operatingTimeMs + bucket.operatingTimeMs,
      stoppedTimeMs: accumulator.stoppedTimeMs + bucket.stoppedTimeMs,
      plannedTimeMs: accumulator.plannedTimeMs + bucket.plannedTimeMs,
    }),
    {
      produced: 0,
      good: 0,
      scrap: 0,
      operatingTimeMs: 0,
      stoppedTimeMs: 0,
      plannedTimeMs: 0,
    }
  );

  return {
    bucket: settings.bucket,
    timeZone: settings.timeZone,
    shiftStartHour: settings.shiftStartHour,
    shiftHours: settings.shiftHours,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    totals: {
      ...totals,
      quality: totals.produced > 0 ? round(totals.good / totals.produced) : 0,
      availability:
        totals.plannedTimeMs > 0
          ? round(totals.operatingTimeMs / totals.plannedTimeMs)
          : 0,
    },
    buckets: views,
  };
}

module.exports = {
  DEFAULT_SHIFT_HOURS,
  DEFAULT_SHIFT_START_HOUR,
  DEFAULT_TIME_ZONE,
  MAX_BUCKETS,
  computeProductionBuckets,
  isValidTimeZone,
  normalizeProductionOptions,
};
