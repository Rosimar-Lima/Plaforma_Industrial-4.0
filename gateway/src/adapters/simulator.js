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
  maxTickMs = 1000,
  now = () => Date.now(),
} = {}) {
  const state = createLineState({ plcVersion });
  let lastTick = now();

  if (autoStart) {
    tick(state, 0, { start: true });
  }

  async function connect() {}

  async function readTags() {
    const current = now();
    tick(state, Math.min(maxTickMs, Math.max(0, current - lastTick)));
    lastTick = current;

    const telemetry = toTelemetry(state, {
      machineId,
      timestamp: new Date(current).toISOString(),
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
