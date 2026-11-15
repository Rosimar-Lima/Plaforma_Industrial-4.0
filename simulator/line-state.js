'use strict';

const TIMINGS_MS = Object.freeze({
  transportToS1: 3270,
  sensorS1: 460,
  fill: 2000,
  capping: 1200,
  transportOut: 2770,
});

function createLineState({ plcVersion = '1.0.0' } = {}) {
  return {
    plcVersion,
    step: 0,
    stepTimeMs: 0,
    stepPrev: 255,
    running: false,
    fillDone: false,
    beltStopped: false,
    s2Occupied: false,
    capped: false,
    sensorS1: false,
    sensorS2: false,
    bottlePositioned: false,
    conveyorOn: false,
    evOn: false,
    atOn: false,
    evInterlock: false,
    atInterlock: false,
    fillPercent: 0,
    bottlesFilled: 0,
    bottlesCapped: 0,
    productionTotal: 0,
    lastCmd: { start: false, stop: false, reset: false },
  };
}

function resetLine(state) {
  state.bottlesFilled = 0;
  state.bottlesCapped = 0;
  state.productionTotal = 0;
  state.fillPercent = 0;
  state.step = 0;
  state.stepPrev = 255;
  state.stepTimeMs = 0;
  state.fillDone = false;
  state.beltStopped = false;
  state.s2Occupied = false;
  state.capped = false;
  state.sensorS1 = false;
  state.sensorS2 = false;
  state.atOn = false;
  state.atInterlock = false;
  state.conveyorOn = false;
}

function risingEdges(state, commands = {}) {
  const current = {
    start: Boolean(commands.start),
    stop: Boolean(commands.stop),
    reset: Boolean(commands.reset),
  };
  const edges = {
    start: current.start && !state.lastCmd.start,
    stop: current.stop && !state.lastCmd.stop,
    reset: current.reset && !state.lastCmd.reset,
  };
  state.lastCmd = current;
  return edges;
}

function runStep(state) {
  const t = state.stepTimeMs;

  switch (state.step) {
    case 0:
      state.conveyorOn = true;
      state.sensorS1 = false;
      state.sensorS2 = false;
      if (t >= TIMINGS_MS.transportToS1) state.step = 1;
      break;

    case 1:
      state.conveyorOn = false;
      state.sensorS1 = true;
      state.sensorS2 = state.s2Occupied;
      if (t >= TIMINGS_MS.sensorS1) {
        state.beltStopped = true;
        state.fillDone = false;
        state.capped = false;
        state.fillPercent = 0;
        state.sensorS2 = state.s2Occupied;
        state.step = 2;
      }
      break;

    case 2:
      state.conveyorOn = false;
      state.sensorS1 = true;
      state.sensorS2 = state.s2Occupied;

      if (t >= TIMINGS_MS.fill) {
        state.fillPercent = 100;
        state.bottlesFilled += 1;
        state.fillDone = true;
      } else {
        state.fillPercent = Math.min(99, Math.floor(t / 20));
      }

      if (state.s2Occupied && !state.capped && t >= TIMINGS_MS.capping) {
        state.capped = true;
        state.bottlesCapped += 1;
        state.productionTotal += 1;
      }

      if (state.fillDone && (!state.s2Occupied || state.capped)) {
        state.step = 3;
      }
      break;

    case 3:
      state.conveyorOn = true;
      state.sensorS1 = false;
      state.sensorS2 = false;
      if (t >= TIMINGS_MS.transportOut) {
        state.beltStopped = false;
        state.s2Occupied = true;
        state.step = 1;
      }
      break;

    default:
      state.step = 0;
  }
}

function tick(state, deltaMs, commands = {}) {
  const edges = risingEdges(state, commands);

  if (edges.start && !state.running) state.running = true;
  if (edges.stop) state.running = false;
  if (edges.reset && !state.running) resetLine(state);

  if (state.step !== state.stepPrev) {
    state.stepTimeMs = 0;
    state.stepPrev = state.step;
  }

  if (state.running) {
    state.stepTimeMs += deltaMs;
    runStep(state);
  } else {
    state.conveyorOn = false;
  }

  state.bottlePositioned = state.sensorS1 && state.beltStopped;
  state.evInterlock = state.sensorS1 && state.beltStopped;
  state.evOn = state.running && state.evInterlock && !state.fillDone;
  state.atInterlock = state.sensorS2 && state.beltStopped;
  state.atOn = state.running && state.atInterlock && !state.capped;

  return state;
}

function toTelemetry(state, { machineId, timestamp = new Date().toISOString() }) {
  return {
    machineId,
    timestamp,
    plcVersion: state.plcVersion,
    line: {
      step: state.step,
      running: state.running,
      conveyorOn: state.conveyorOn,
      evOn: state.evOn,
      atOn: state.atOn,
      sensorS1: state.sensorS1,
      sensorS2: state.sensorS2,
      bottlePositioned: state.bottlePositioned,
      evInterlock: state.evInterlock,
      atInterlock: state.atInterlock,
      fillPercent: state.fillPercent,
    },
    production: {
      filled: state.bottlesFilled,
      capped: state.bottlesCapped,
      total: state.productionTotal,
    },
  };
}

module.exports = {
  TIMINGS_MS,
  createLineState,
  resetLine,
  tick,
  toTelemetry,
};
