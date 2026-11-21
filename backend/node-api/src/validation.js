'use strict';

const LINE_BOOLEAN_FIELDS = Object.freeze([
  'running',
  'conveyorOn',
  'evOn',
  'atOn',
  'sensorS1',
  'sensorS2',
  'bottlePositioned',
  'evInterlock',
  'atInterlock',
]);

const PRODUCTION_FIELDS = Object.freeze(['filled', 'capped', 'total']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTelemetry(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['payload deve ser um objeto'] };
  }

  const errors = [];

  const machineId = typeof payload.machineId === 'string' ? payload.machineId.trim() : '';
  if (!machineId || machineId.length > 50) {
    errors.push('machineId deve ser uma string de 1 a 50 caracteres');
  }

  const timestamp = payload.timestamp;
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    errors.push('timestamp deve ser uma data ISO válida');
  }

  const line = payload.line;
  if (!isPlainObject(line)) {
    errors.push('line deve ser um objeto');
  } else {
    if (!Number.isInteger(line.step) || line.step < 0) {
      errors.push('line.step deve ser um inteiro não negativo');
    }
    for (const field of LINE_BOOLEAN_FIELDS) {
      if (typeof line[field] !== 'boolean') {
        errors.push(`line.${field} deve ser booleano`);
      }
    }
    if (
      typeof line.fillPercent !== 'number' ||
      !Number.isFinite(line.fillPercent) ||
      line.fillPercent < 0 ||
      line.fillPercent > 100
    ) {
      errors.push('line.fillPercent deve ser numérico entre 0 e 100');
    }
    if (line.evOn === true && line.bottlePositioned !== true) {
      errors.push('line.evOn exige line.bottlePositioned');
    }
    if (line.atOn === true && line.sensorS2 !== true) {
      errors.push('line.atOn exige line.sensorS2');
    }
  }

  const production = payload.production;
  if (!isPlainObject(production)) {
    errors.push('production deve ser um objeto');
  } else {
    for (const field of PRODUCTION_FIELDS) {
      if (!Number.isInteger(production[field]) || production[field] < 0) {
        errors.push(`production.${field} deve ser inteiro não negativo`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      machineId,
      timestamp: new Date(timestamp).toISOString(),
      plcVersion: typeof payload.plcVersion === 'string' ? payload.plcVersion : null,
      line: {
        step: line.step,
        running: line.running,
        conveyorOn: line.conveyorOn,
        evOn: line.evOn,
        atOn: line.atOn,
        sensorS1: line.sensorS1,
        sensorS2: line.sensorS2,
        bottlePositioned: line.bottlePositioned,
        evInterlock: line.evInterlock,
        atInterlock: line.atInterlock,
        fillPercent: line.fillPercent,
      },
      production: {
        filled: production.filled,
        capped: production.capped,
        total: production.total,
      },
      raw: payload,
    },
  };
}

function validateGatewayStatus(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['payload deve ser um objeto'] };
  }

  const errors = [];
  const machineId = typeof payload.machineId === 'string' ? payload.machineId.trim() : '';
  if (!machineId || machineId.length > 50) {
    errors.push('machineId deve ser uma string de 1 a 50 caracteres');
  }
  if (typeof payload.connected !== 'boolean') {
    errors.push('connected deve ser booleano');
  }

  for (const field of ['timestamp', 'lastReadAt']) {
    if (payload[field] !== undefined && payload[field] !== null) {
      if (typeof payload[field] !== 'string' || Number.isNaN(Date.parse(payload[field]))) {
        errors.push(`${field} deve ser uma data ISO válida`);
      }
    }
  }

  if (payload.running !== undefined && typeof payload.running !== 'boolean') {
    errors.push('running deve ser booleano');
  }
  if (
    payload.failures !== undefined &&
    (!Number.isInteger(payload.failures) || payload.failures < 0)
  ) {
    errors.push('failures deve ser um inteiro não negativo');
  }
  if (payload.error !== undefined && payload.error !== null && typeof payload.error !== 'string') {
    errors.push('error deve ser uma string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      machineId,
      connected: payload.connected,
      running: typeof payload.running === 'boolean' ? payload.running : null,
      lastReadAt: payload.lastReadAt ?? null,
      timestamp: payload.timestamp ?? null,
      failures: payload.failures ?? 0,
      error: payload.error ?? null,
    },
  };
}

module.exports = {
  LINE_BOOLEAN_FIELDS,
  PRODUCTION_FIELDS,
  validateTelemetry,
  validateGatewayStatus,
};
