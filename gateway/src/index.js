'use strict';

try {
  require('dotenv').config();
} catch {}

const path = require('node:path');
const { loadConfig } = require('./config');
const { createAdapter } = require('./adapters');
const { createHttpPublisher } = require('./http-publisher');
const { createGateway } = require('./gateway');
const { createControlAgent } = require('./control-agent');

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

  // Agente elevado: lê os pedidos do botão "Encerrar dia" escritos pelo backend
  // em runtime/system-command.json (bind mount compartilhado, sem abrir portas).
  const control = createControlAgent({
    token: config.control.token,
    commandPath: config.control.commandPath,
    // __dirname é gateway/src; o script pi40-dia.ps1 fica na raiz do repositório.
    repoDir: path.resolve(__dirname, '../..'),
  });
  control.start();
  console.log(`Controle local ativo em ${control.commandPath}.`);
  console.log(`Script de controle: ${control.scriptPath} (existe: ${require('node:fs').existsSync(control.scriptPath)}).`);

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} recebido; encerrando gateway.`);
    await control.stop();
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
