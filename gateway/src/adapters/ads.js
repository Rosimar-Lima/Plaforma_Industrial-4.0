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
  autoReconnect = false,
  symbols = {},
  clientFactory = null,
} = {}) {
  let client = null;

  async function connect() {
    // Nunca deixe dois clientes ADS vivos ao mesmo tempo: cada Client registra
    // uma porta local no router e tentativas simultâneas esgotam as portas
    // (erro "ADS port 0 already in use") e impedem a recuperação.
    await close();

    const Client = clientFactory ?? requireOptional('ads-client').Client;
    const novoCliente = new Client({
      targetAmsNetId,
      targetAdsPort,
      timeoutDelay: timeoutMs,
      autoReconnect,
    });

    client = novoCliente;
    novoCliente.on('connectionLost', () => {
      console.warn('[ads] conexão perdida; o gateway vai recriar o cliente ADS.');
    });
    novoCliente.on('reconnect', () => {
      console.log('[ads] reconectado.');
    });

    try {
      await novoCliente.connect();

      // O projeto de origem carrega símbolos e tipos após conectar e também após
      // reconectar. Evita consultar metadados a cada leitura e mantém o
      // readValue() por nome funcionando se o runtime for reiniciado.
      await novoCliente.cacheSymbols?.();
      await novoCliente.cacheDataTypes?.();
    } catch (error) {
      // connect() pode ter registrado a porta local antes de falhar nos
      // metadados. Fechar aqui evita vazamento mesmo se o chamador não fechar.
      await close();
      throw error;
    }
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
    const cliente = client;
    client = null;
    if (!cliente) return;

    // force=true destrói o socket imediatamente. Não usamos subscrições ADS,
    // então não há efeitos colaterais; o importante é liberar a porta local
    // mesmo quando o router/TwinCAT não responde ao desregistro gracioso.
    await cliente.disconnect?.(true).catch(() => {});
  }

  return { connect, readTags, close };
}

module.exports = {
  createAdsAdapter,
  unwrapAdsValue,
};
