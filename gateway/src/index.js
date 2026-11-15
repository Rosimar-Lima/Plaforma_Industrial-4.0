'use strict';

try {
  require('dotenv').config();
} catch {}

const { loadConfig } = require('./config');
const { createAdapter } = require('./adapters');
const { createHttpPublisher } = require('./http-publisher');
const { createGateway } = require('./gateway');

async function main() {
  const config = loadConfig();
  const adapter = createAdapter(config);
  const publisher = createHttpPublisher({ backendUrl: config.backendUrl });
  const gateway = createGateway({
    adapter,
    publisher,
    machineId: config.machineId,
    plcVersion: config.plcVersion,
    pollMs: config.pollMs,
  });

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} recebido; encerrando gateway.`);
    await gateway.stop();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await gateway.start();

  console.log(
    `Gateway ${config.protocol} -> ${config.backendUrl} ` +
      `(máquina ${config.machineId}, polling ${config.pollMs} ms)`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
