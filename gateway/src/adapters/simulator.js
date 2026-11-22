'use strict';

const {
  createLineState,
  tick,
  toTelemetry,
} = require('../../../simulator/line-state');

function createSimulatorAdapter({
  machineId = 'Linha-01',
  plcVersion = 'gateway-sim',
  autoStart = true,
} = {}) {
  const state = createLineState({ plcVersion });
  let lastTick = Date.now();

  if (autoStart) {
    tick(state, 0, { start: true });
  }

  async function connect() {}

  async function readTags() {
    const now = Date.now();
    tick(state, Math.max(0, now - lastTick));
    lastTick = now;

    const telemetry = toTelemetry(state, {
      machineId,
      timestamp: new Date(now).toISOString(),
    });

    return {
      ...telemetry.line,
      ...telemetry.production,
      plcVersion: telemetry.plcVersion,
    };
  }

  async function close() {}

  return { connect, readTags, close };
}

module.exports = {
  createSimulatorAdapter,
};
