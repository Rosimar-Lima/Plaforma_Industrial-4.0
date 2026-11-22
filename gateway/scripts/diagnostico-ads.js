'use strict';

// Diagnóstico somente leitura: conecta no ADS, lê o runtime e os símbolos
// configurados e imprime os valores. Não publica telemetria no backend e não
// escreve nenhum símbolo no CLP.

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('ads-client');

function argumento(nome, padrao) {
  const indice = process.argv.indexOf(nome);
  return indice >= 0 && process.argv[indice + 1] ? process.argv[indice + 1] : padrao;
}

function valorDaLeitura(resultado) {
  if (resultado && typeof resultado === 'object' && Object.hasOwn(resultado, 'value')) {
    return resultado.value;
  }
  return resultado;
}

async function main() {
  const ams = argumento('--ams', process.env.ADS_TARGET_AMS_NET_ID || '127.0.0.1.1.1');
  const porta = Number(argumento('--port', process.env.ADS_TARGET_PORT || '851'));
  const timeout = Number(argumento('--timeout', process.env.ADS_TIMEOUT_MS || '5000'));
  const arquivoSimbolos = path.resolve(
    argumento('--symbols', path.join(__dirname, '../plc.config.json'))
  );
  const configuracao = JSON.parse(fs.readFileSync(arquivoSimbolos, 'utf8'));
  const simbolos = configuracao.symbols ?? configuracao;

  console.log(`[diagnostico] alvo ADS ${ams}:${porta}`);
  console.log(`[diagnostico] mapa ${arquivoSimbolos}`);

  const client = new Client({
    targetAmsNetId: ams,
    targetAdsPort: porta,
    timeoutDelay: timeout,
    autoReconnect: false,
  });

  client.on('connectionLost', () => {
    console.warn('[diagnostico] conexão perdida');
  });

  try {
    await client.connect();
    console.log('[diagnostico] conectado');

    try {
      const runtime = await client.readPlcRuntimeState();
      console.log('[diagnostico] runtime:', JSON.stringify(runtime));
    } catch (error) {
      console.warn(`[diagnostico] runtime indisponível: ${error.message}`);
    }

    await client.cacheSymbols();
    await client.cacheDataTypes();
    console.log(`[diagnostico] cache carregado (${Object.keys(simbolos).length} símbolos)`);

    for (const [chave, simbolo] of Object.entries(simbolos)) {
      try {
        const resultado = await client.readValue(simbolo);
        console.log(
          `${chave.padEnd(18)} ${String(simbolo).padEnd(30)} ${JSON.stringify(valorDaLeitura(resultado))}`
        );
      } catch (error) {
        console.error(
          `${chave.padEnd(18)} ${String(simbolo).padEnd(30)} ERRO: ${error.message}`
        );
      }
    }
  } catch (error) {
    console.error(`[diagnostico] falha: ${error.message}`);
    process.exitCode = 1;
  } finally {
    try {
      await client.disconnect();
    } catch {
      // conexão já encerrada
    }
  }
}

void main();
