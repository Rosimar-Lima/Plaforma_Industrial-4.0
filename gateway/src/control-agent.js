'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * Ponte entre o backend (container) e o host Windows.
 *
 * O backend escreve `runtime/system-command.json`; este agente, executado pelo
 * serviço PI40Gateway (LocalSystem), lê o pedido e dispara `pi40-dia.ps1`.
 * Nenhuma porta é aberta: o diretório `runtime/` é compartilhado por bind mount.
 */
function createControlAgent({
  token,
  commandPath,
  repoDir,
  intervalMs = 500,
  maxAgeMs = 60000,
  logger = console,
  launcher = null,
  now = () => Date.now(),
} = {}) {
  if (!token) throw new Error('PI40_CONTROL_TOKEN é obrigatório');
  if (!commandPath) throw new Error('PI40_CONTROL_COMMAND_PATH é obrigatório');

  const scriptPath = path.join(repoDir, 'scripts', 'pi40-dia.ps1');
  // O Node já escapa os argumentos ao chamar spawn(). Colocar o caminho entre
  // aspas aqui faz o PowerShell 5.1 receber aspas literais e rejeitar -File.
  const scriptArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Action',
  ];
  let activeChild = null;
  let timer = null;
  let lastNonce = null;

  const launch =
    launcher ||
    ((action) => {
      const powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      const child = spawn(powershellExe, [...scriptArgs, action], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let output = '';
      child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
      child.on('error', (error) => {
        logger.error?.(`[control] falha ao iniciar pi40-dia.ps1: ${error.message}`);
      });
      child.on('exit', (code, signal) => {
        logger.log?.(
          `[control] pi40-dia.ps1 saiu com código ${code} (${signal}): ${output.slice(-2000)}`
        );
      });
      child.unref();
      return child;
    });

  function isBusy() {
    // Um processo encerrado por sinal mantém exitCode === null; sem verificar
    // signalCode o agente ficaria preso para sempre e bloquearia novos pedidos.
    return Boolean(
      activeChild &&
        activeChild.exitCode === null &&
        !activeChild.signalCode &&
        !activeChild.killed
    );
  }

  function discard() {
    try {
      fs.rmSync(commandPath, { force: true });
    } catch (error) {
      logger.error?.(`[control] falha ao remover pedido: ${error.message}`);
    }
  }

  async function checkCommand() {
    let raw;
    try {
      raw = fs.readFileSync(commandPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error?.(`[control] falha ao ler pedido: ${error.message}`);
      }
      return;
    }

    let command;
    try {
      command = JSON.parse(raw);
    } catch {
      discard();
      return;
    }

    const action = String(command?.action || '').toLowerCase();
    if (command?.token !== token || !['start', 'stop'].includes(action)) {
      logger.warn?.('[control] pedido inválido descartado');
      discard();
      return;
    }

    const age = now() - Date.parse(command.requestedAt);
    if (!Number.isFinite(age) || age < -5000 || age > maxAgeMs) {
      logger.warn?.('[control] pedido expirado descartado');
      discard();
      return;
    }

    if (command.nonce && command.nonce === lastNonce) {
      discard();
      return;
    }

    if (isBusy()) return;

    lastNonce = command.nonce || null;
    discard();
    try {
      activeChild = launch(action === 'stop' ? 'Stop' : 'Start');
      logger.log?.(`[control] ação ${action} acionada no host.`);
    } catch (error) {
      logger.error?.(`[control] erro ao acionar ${action}: ${error.message}`);
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => void checkCommand(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, checkCommand, isBusy, commandPath, scriptPath, scriptArgs };
}

module.exports = { createControlAgent };
