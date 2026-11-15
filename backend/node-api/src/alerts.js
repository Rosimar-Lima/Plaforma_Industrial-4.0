'use strict';

const DEFAULT_ALERT_SETTINGS = Object.freeze({
  fillPercentMin: 0,
  fillPercentMax: 100,
  stoppedMs: 60000,
});

function normalizeSettings(settings = {}) {
  return {
    fillPercentMin: Number.isFinite(settings.fillPercentMin)
      ? settings.fillPercentMin
      : DEFAULT_ALERT_SETTINGS.fillPercentMin,
    fillPercentMax: Number.isFinite(settings.fillPercentMax)
      ? settings.fillPercentMax
      : DEFAULT_ALERT_SETTINGS.fillPercentMax,
    stoppedMs: Number.isFinite(settings.stoppedMs)
      ? Math.max(0, settings.stoppedMs)
      : DEFAULT_ALERT_SETTINGS.stoppedMs,
  };
}

function evaluateFillAlert(record, settings) {
  if (!record?.line || record.line.step !== 2) return null;

  const value = record.line.fillPercent;
  if (!Number.isFinite(value)) return null;

  if (value < settings.fillPercentMin) {
    return {
      sensorCode: 'fillPercent',
      severity: 'warning',
      message: `Nível de envase abaixo do limite mínimo (${value}% < ${settings.fillPercentMin}%).`,
    };
  }

  if (value > settings.fillPercentMax) {
    return {
      sensorCode: 'fillPercent',
      severity: 'critical',
      message: `Nível de envase acima do limite máximo (${value}% > ${settings.fillPercentMax}%).`,
    };
  }

  return null;
}

function buildStoppedAlert(stoppedMs, settings) {
  if (!Number.isFinite(stoppedMs) || stoppedMs < settings.stoppedMs) return null;

  const seconds = Math.round(stoppedMs / 1000);
  const limitSeconds = Math.round(settings.stoppedMs / 1000);

  return {
    sensorCode: 'lineStopped',
    severity: 'warning',
    message: `Linha parada há ${seconds}s (limite ${limitSeconds}s).`,
  };
}

module.exports = {
  DEFAULT_ALERT_SETTINGS,
  normalizeSettings,
  evaluateFillAlert,
  buildStoppedAlert,
};
