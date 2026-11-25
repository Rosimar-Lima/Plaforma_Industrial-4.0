'use strict';

const { buildTelemetry, normalizeRunning } = require('./mapping');

function createGateway({
  adapter,
  publisher,
  machineId,
  plcVersion = null,
  pollMs = 1000,
  logger = console,
  clock = () => new Date(),
} = {}) {
  if (!adapter) throw new Error('adapter é obrigatório');
  if (!publisher) throw new Error('publisher é obrigatório');
  if (!machineId) throw new Error('machineId é obrigatório');

  let timer = null;
  let inFlight = false;
  let connected = false;
  let started = false;
  let running = null;
  let lastReadAt = null;
  let failures = 0;
  let lastError = null;

  // Fechar o adaptador antes de tentar um novo connect() é obrigatório: no ADS,
  // cada cliente registra uma porta local no router. Sem isso, uma queda do
  // TwinCAT gera um cliente novo a cada poll até esgotar as portas e o gateway
  // nunca mais reconhece a volta da linha.
  async function descartarConexao() {
    connected = false;
    running = null;
    try {
      await adapter.close?.();
    } catch (error) {
      logger.error(`[gateway] falha ao fechar conexão: ${error.message}`);
    }
  }

  async function reportStatus(timestamp) {
    const status = {
      machineId,
      connected,
      running,
      lastReadAt,
      timestamp,
      failures,
      error: lastError,
    };

    try {
      await publisher.publishStatus?.(status);
    } catch (error) {
      logger.error(`[gateway] falha ao publicar status: ${error.message}`);
    }
  }

  async function pollOnce() {
    if (inFlight) return;

    inFlight = true;
    const timestamp = clock().toISOString();

    try {
      if (!connected) {
        await adapter.connect?.();
        connected = true;
      }

      let values;
      try {
        values = await adapter.readTags();
      } catch (error) {
        await descartarConexao();
        failures += 1;
        lastError = error.message;
        logger.error(`[gateway] falha na leitura: ${error.message}`);
        return;
      }

      // Leitura bem-sucedida: a linha respondeu, independentemente de estar
      // operando (bRunning=true) ou parada (bRunning=false).
      connected = true;
      failures = 0;
      lastError = null;
      running = normalizeRunning(values.running);
      lastReadAt = timestamp;

      const payload = buildTelemetry({
        machineId,
        values,
        plcVersion,
        timestamp,
      });

      try {
        await publisher.publish(payload);
      } catch (error) {
        logger.error(`[gateway] falha na publicação: ${error.message}`);
      }
    } catch (error) {
      await descartarConexao();
      failures += 1;
      lastError = error.message;
      logger.error(`[gateway] falha na conexão: ${error.message}`);
    } finally {
      try {
        await reportStatus(timestamp);
      } finally {
        inFlight = false;
      }
    }
  }

  async function start() {
    if (started) return;
    started = true;

    await pollOnce();

    timer = setInterval(() => {
      void pollOnce();
    }, pollMs);
  }

  async function stop() {
    started = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await adapter.close?.();
    connected = false;
  }

  return {
    start,
    stop,
    pollOnce,
  };
}

module.exports = {
  createGateway,
};
