'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
  DEFAULT_SHIFT_HOURS,
  DEFAULT_SHIFT_START_HOUR,
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
} = require('./production');

const DEFAULTS = Object.freeze({
  host: '0.0.0.0',
  port: 3000,
  databaseUrl: 'postgresql://industrial:industrial@localhost:5432/industrial',
  nominalCapacityPerHour: 400,
  alertFillPercentMin: 0,
  alertFillPercentMax: 100,
  alertStoppedMs: 60000,
  plantTimeZone: DEFAULT_TIME_ZONE,
  shiftStartHour: DEFAULT_SHIFT_START_HOUR,
  shiftHours: DEFAULT_SHIFT_HOURS,
  dashboardDir: path.resolve(__dirname, '../../../dashboard/frontend'),
  maintenanceConfigPath: path.resolve(__dirname, '../config/maintenance.json'),
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

function toIntegerInRange(value, fallback, label, min, max) {
  const number = toNumber(value, fallback, label);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} deve ser um inteiro entre ${min} e ${max}`);
  }
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
  const shiftStartHour = toIntegerInRange(
    env.SHIFT_START_HOUR,
    DEFAULTS.shiftStartHour,
    'SHIFT_START_HOUR',
    0,
    23
  );
  const shiftHours = toIntegerInRange(
    env.SHIFT_HOURS,
    DEFAULTS.shiftHours,
    'SHIFT_HOURS',
    1,
    24
  );
  const plantTimeZone = env.PLANT_TIMEZONE || DEFAULTS.plantTimeZone;

  if (!isValidTimeZone(plantTimeZone)) {
    throw new Error(`PLANT_TIMEZONE inválido: ${plantTimeZone}`);
  }

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
    productionSettings: {
      timeZone: plantTimeZone,
      shiftStartHour,
      shiftHours,
    },
    dashboardDir: env.DASHBOARD_DIR ? path.resolve(env.DASHBOARD_DIR) : DEFAULTS.dashboardDir,
    maintenanceConfigPath: env.MAINTENANCE_CONFIG
      ? path.resolve(env.MAINTENANCE_CONFIG)
      : DEFAULTS.maintenanceConfigPath,
  };
}

module.exports = {
  DEFAULTS,
  loadConfig,
  loadEnvFiles,
};
