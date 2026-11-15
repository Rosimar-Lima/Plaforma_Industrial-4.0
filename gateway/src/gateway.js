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

  async function pollOnce() {
    if (inFlight) return;

    inFlight = true;

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
        logger.error(`[gateway] falha na leitura: ${error.message}`);
        return;
      }

      const payload = buildTelemetry({
        machineId,
        values,
        plcVersion,
        timestamp: clock().toISOString(),
      });

      try {
        await publisher.publish(payload);
      } catch (error) {
        logger.error(`[gateway] falha na publicação: ${error.message}`);
      }
    } catch (error) {
      connected = false;
      logger.error(`[gateway] falha na conexão: ${error.message}`);
    } finally {
      inFlight = false;
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
