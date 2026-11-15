'use strict';

const { createLineState, tick, toTelemetry } = require('./line-state');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const MACHINE_ID = process.env.MACHINE_ID || 'machine-01';
const TICK_MS = Number(process.env.TICK_MS || 100);
const PUBLISH_MS = Number(process.env.PUBLISH_MS || 1000);
const AUTO_START = (process.env.AUTO_START || 'true') !== 'false';
const PLC_VERSION = process.env.PLC_VERSION || '1.0.0';

const state = createLineState({ plcVersion: PLC_VERSION });
const pending = { start: false, stop: false, reset: false };

let lastTick = Date.now();
let lastPublish = 0;
let autoStarted = false;

async function publish(payload) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Falha ao publicar telemetria: HTTP ${response.status}`);
      return;
    }

    const { line, production } = payload;
    console.log(
      `step=${line.step} conveyor=${line.conveyorOn} ev=${line.evOn} at=${line.atOn} ` +
        `fill=${line.fillPercent}% total=${production.total}`
    );
  } catch (error) {
    console.error(`Erro de conexão: ${error.message}`);
  }
}

function applyCommand(command) {
  if (command === 'start' || command === 'stop' || command === 'reset') {
    pending[command] = true;
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  String(chunk)
    .split(/\s+/)
    .filter(Boolean)
    .forEach((command) => applyCommand(command.trim().toLowerCase()));
});

console.log(
  `Simulador iniciado: ${MACHINE_ID} -> ${BACKEND_URL} ` +
    `(tick=${TICK_MS}ms, publish=${PUBLISH_MS}ms, autoStart=${AUTO_START})`
);
console.log('Comandos: start, stop, reset');

const timer = setInterval(() => {
  const now = Date.now();
  const delta = now - lastTick;
  lastTick = now;

  if (AUTO_START && !autoStarted) {
    pending.start = true;
    autoStarted = true;
  }

  tick(state, delta, pending);
  pending.start = false;
  pending.stop = false;
  pending.reset = false;

  if (now - lastPublish >= PUBLISH_MS) {
    lastPublish = now;
    void publish(toTelemetry(state, { machineId: MACHINE_ID }));
  }
}, TICK_MS);

process.on('SIGINT', () => {
  clearInterval(timer);
  console.log('Simulador encerrado.');
  process.exit(0);
});
