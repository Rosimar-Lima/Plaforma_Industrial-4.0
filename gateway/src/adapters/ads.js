'use strict';

const { requireOptional } = require('../optional');

// O ads-client devolve { value, rawValue, dataType, symbol } em readValue().
// Telemetria com esse objeto inteiro viraria false/0 no mapeamento.
function unwrapAdsValue(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }

  return Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
}

function createAdsAdapter({
  targetAmsNetId,
  targetAdsPort,
  timeoutMs = 5000,
  autoReconnect = true,
  symbols = {},
  clientFactory = null,
} = {}) {
  let client = null;

  async function connect() {
    const Client = clientFactory ?? requireOptional('ads-client').Client;

    client = new Client({
      targetAmsNetId,
      targetAdsPort,
      timeoutDelay: timeoutMs,
      autoReconnect,
    });

    client.on('connectionLost', () => {
      console.warn('[ads] conexão perdida; aguardando reconexão.');
    });
    client.on('reconnect', () => {
      console.log('[ads] reconectado.');
    });

    await client.connect();
  }

  async function readTags() {
    if (!client) throw new Error('cliente ADS não conectado');

    const values = {};
    for (const [key, symbol] of Object.entries(symbols)) {
      if (!symbol) continue;
      values[key] = unwrapAdsValue(await client.readValue(symbol));
    }
    return values;
  }

  async function close() {
    if (!client) return;
    await client.disconnect().catch(() => {});
    client = null;
  }

  return { connect, readTags, close };
}

module.exports = {
  createAdsAdapter,
  unwrapAdsValue,
};
