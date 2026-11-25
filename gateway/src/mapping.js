'use strict';

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

// Heartbeat e telemetria precisam concordar: valores do CLP podem chegar como
// 0/1 ou 'true'/'false', e 'running' só é desconhecido quando a leitura não traz
// o campo (ou traz null).
function normalizeRunning(value) {
  if (value === null || value === undefined || value === '') return null;
  return toBoolean(value);
}

function toInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function clampFillPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function deriveStep({ conveyorOn, sensorS1, evOn, fillPercent }) {
  if (conveyorOn) {
    return fillPercent >= 100 ? 3 : 0;
  }
  if (sensorS1) {
    if (evOn || (fillPercent > 0 && fillPercent < 100)) return 2;
    return 1;
  }
  return 0;
}

function buildTelemetry({ machineId, values, plcVersion = null, timestamp } = {}) {
  if (!machineId) throw new Error('machineId é obrigatório');
  if (!values || typeof values !== 'object') throw new Error('values é obrigatório');

  const sensorS1 = toBoolean(values.sensorS1);
  const sensorS2 = toBoolean(values.sensorS2);
  const conveyorOn = toBoolean(values.conveyorOn);
  const beltStopped = !conveyorOn;

  const bottlePositioned =
    values.bottlePositioned === undefined
      ? sensorS1 && beltStopped
      : toBoolean(values.bottlePositioned);
  const evInterlock =
    values.evInterlock === undefined ? sensorS1 && beltStopped : toBoolean(values.evInterlock);
  const atInterlock =
    values.atInterlock === undefined ? sensorS2 && beltStopped : toBoolean(values.atInterlock);

  const fillPercent = clampFillPercent(values.fillPercent);
  const evOn = toBoolean(values.evOn);
  const running = normalizeRunning(values.running) ?? false;

  const explicitStep = Number(values.step);
  const step =
    values.step !== undefined && values.step !== null && Number.isInteger(explicitStep)
      ? Math.max(0, explicitStep)
      : deriveStep({ conveyorOn, sensorS1, evOn, fillPercent });

  const filled = toInteger(values.filled);
  const capped = toInteger(values.capped);
  const total =
    values.total === undefined ? Math.min(filled, capped) : toInteger(values.total);

  const line = {
    step,
    running,
    conveyorOn,
    evOn,
    atOn: toBoolean(values.atOn),
    sensorS1,
    sensorS2,
    bottlePositioned,
    evInterlock,
    atInterlock,
    fillPercent,
  };

  return {
    machineId,
    timestamp: timestamp ?? new Date().toISOString(),
    plcVersion: values.plcVersion ?? plcVersion ?? null,
    line,
    production: { filled, capped, total },
  };
}

module.exports = {
  toBoolean,
  normalizeRunning,
  toInteger,
  clampFillPercent,
  deriveStep,
  buildTelemetry,
};
