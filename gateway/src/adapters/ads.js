'use strict';

const { requireOptional } = require('../optional');

function createAdsAdapter({
  targetAmsNetId,
  targetAdsPort,
  timeoutMs = 5000,
  autoReconnect = true,
  symbols = {},
} = {}) {
  let client = null;

  async function connect() {
    const { Client } = requireOptional('ads-client');

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
      values[key] = await client.readValue(symbol);
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
};
