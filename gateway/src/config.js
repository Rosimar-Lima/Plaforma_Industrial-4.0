'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SYMBOLS_FILE = path.resolve(__dirname, '../plc.config.json');
const DEFAULT_MODBUS_FILE = path.resolve(__dirname, '../modbus.config.json');
const PROTOCOLS = Object.freeze(['ads', 'opcua', 'modbus', 'simulator']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function toNumber(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} inválido: ${value}`);
  return number;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function loadConfig(env = process.env) {
  const protocol = String(env.INDUSTRIAL_PROTOCOL || 'ads').toLowerCase();
  if (!PROTOCOLS.includes(protocol)) {
    throw new Error(
      `INDUSTRIAL_PROTOCOL inválido: ${protocol} (use ${PROTOCOLS.join(', ')})`
    );
  }

  const pollMs = toNumber(env.GATEWAY_POLL_MS, 1000, 'GATEWAY_POLL_MS');
  if (pollMs < 100) {
    throw new Error('GATEWAY_POLL_MS deve ser maior ou igual a 100');
  }

  const symbolsFile = env.GATEWAY_SYMBOLS_FILE
    ? path.resolve(env.GATEWAY_SYMBOLS_FILE)
    : DEFAULT_SYMBOLS_FILE;
  const modbusFile = env.MODBUS_SYMBOLS_FILE
    ? path.resolve(env.MODBUS_SYMBOLS_FILE)
    : DEFAULT_MODBUS_FILE;

  const symbolsConfig = protocol === 'modbus' ? readJson(modbusFile) : readJson(symbolsFile);

  return {
    protocol,
    machineId: env.GATEWAY_MACHINE_ID || env.MACHINE_ID || 'machine-01',
    pollMs,
    backendUrl: env.BACKEND_URL || 'http://localhost:3000',
    plcVersion: env.PLC_VERSION || null,
    symbols: symbolsConfig.symbols ?? symbolsConfig,
    ads: {
      targetAmsNetId: env.ADS_TARGET_AMS_NET_ID || '39.90.64.65.1.1',
      targetAdsPort: toNumber(env.ADS_TARGET_PORT, 851, 'ADS_TARGET_PORT'),
      timeoutMs: toNumber(env.ADS_TIMEOUT_MS, 5000, 'ADS_TIMEOUT_MS'),
      autoReconnect: toBoolean(env.ADS_AUTO_RECONNECT, true),
    },
    opcua: {
      endpointUrl: env.OPCUA_ENDPOINT_URL || 'opc.tcp://localhost:4840',
      userName: env.OPCUA_USERNAME || null,
      password: env.OPCUA_PASSWORD || null,
      securityMode: env.OPCUA_SECURITY_MODE || 'None',
      securityPolicy: env.OPCUA_SECURITY_POLICY || 'None',
    },
    modbus: {
      host: env.MODBUS_HOST || '127.0.0.1',
      port: toNumber(env.MODBUS_PORT, 502, 'MODBUS_PORT'),
      unitId: toNumber(env.MODBUS_UNIT_ID, symbolsConfig.unitId ?? 1, 'MODBUS_UNIT_ID'),
    },
    simulator: {
      autoStart: toBoolean(env.SIMULATOR_AUTO_START, true),
    },
  };
}

module.exports = {
  PROTOCOLS,
  DEFAULT_SYMBOLS_FILE,
  DEFAULT_MODBUS_FILE,
  loadConfig,
};
