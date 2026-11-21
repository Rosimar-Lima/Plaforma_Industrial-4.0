'use strict';

const { buildTelemetry } = require('./mapping');

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
        connected = false;
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
      running = typeof values.running === 'boolean' ? values.running : null;
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
      connected = false;
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
