'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const DEFAULTS = Object.freeze({
  host: '0.0.0.0',
  port: 3000,
  databaseUrl: 'postgresql://industrial:industrial@localhost:5432/industrial',
  nominalCapacityPerHour: 400,
  alertFillPercentMin: 0,
  alertFillPercentMax: 100,
  alertStoppedMs: 60000,
  dashboardDir: path.resolve(__dirname, '../../../dashboard/frontend'),
});

function loadEnvFiles() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../../.env'),
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file });
    }
  }
}

function toNumber(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} inválido: ${value}`);
  return number;
}

function loadConfig(env = process.env) {
  const fillPercentMin = toNumber(
    env.ALERT_FILL_PERCENT_MIN,
    DEFAULTS.alertFillPercentMin,
    'ALERT_FILL_PERCENT_MIN'
  );
  const fillPercentMax = toNumber(
    env.ALERT_FILL_PERCENT_MAX,
    DEFAULTS.alertFillPercentMax,
    'ALERT_FILL_PERCENT_MAX'
  );
  const stoppedMs = toNumber(
    env.ALERT_STOPPED_MS,
    DEFAULTS.alertStoppedMs,
    'ALERT_STOPPED_MS'
  );

  if (fillPercentMin > fillPercentMax) {
    throw new Error('ALERT_FILL_PERCENT_MIN não pode ser maior que ALERT_FILL_PERCENT_MAX');
  }

  if (stoppedMs < 0) {
    throw new Error('ALERT_STOPPED_MS não pode ser negativo');
  }

  return {
    host: env.HOST || DEFAULTS.host,
    port: toNumber(env.PORT || env.BACKEND_PORT, DEFAULTS.port, 'PORT'),
    databaseUrl: env.DATABASE_URL || DEFAULTS.databaseUrl,
    nominalCapacityPerHour: toNumber(
      env.NOMINAL_CAPACITY_PER_HOUR,
      DEFAULTS.nominalCapacityPerHour,
      'NOMINAL_CAPACITY_PER_HOUR'
    ),
    alertSettings: {
      fillPercentMin,
      fillPercentMax,
      stoppedMs,
    },
    dashboardDir: env.DASHBOARD_DIR ? path.resolve(env.DASHBOARD_DIR) : DEFAULTS.dashboardDir,
  };
}

module.exports = {
  DEFAULTS,
  loadConfig,
  loadEnvFiles,
};
