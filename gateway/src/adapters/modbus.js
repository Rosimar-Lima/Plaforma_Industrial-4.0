'use strict';

const { requireOptional } = require('../optional');

function combineWords(words) {
  return words.reduce((value, word) => value * 0x10000 + word, 0);
}

function createModbusAdapter({ host, port = 502, unitId = 1, symbols = {} } = {}) {
  let client = null;

  async function connect() {
    const ModbusRTU = requireOptional('modbus-serial');

    client = new ModbusRTU();
    await client.connectTCP(host, { port });
    client.setID(unitId);
  }

  async function readSpec(spec) {
    const type = spec.type ?? 'holding';
    const words = spec.words ?? 1;
    let raw;

    if (type === 'coil') {
      const result = await client.readCoils(spec.address, 1);
      raw = result.data[0];
    } else if (type === 'discrete') {
      const result = await client.readDiscreteInputs(spec.address, 1);
      raw = result.data[0];
    } else if (type === 'input') {
      const result = await client.readInputRegisters(spec.address, words);
      raw = words > 1 ? combineWords(result.data) : result.data[0];
    } else if (type === 'holding') {
      const result = await client.readHoldingRegisters(spec.address, words);
      raw = words > 1 ? combineWords(result.data) : result.data[0];
    } else {
      throw new Error(`tipo Modbus inválido: ${type}`);
    }

    if (typeof raw === 'boolean') return raw;

    let value = raw;
    if (words > 1 && spec.signed && value >= 0x80000000) {
      value -= 0x100000000;
    }
    if (spec.scale !== undefined) value *= spec.scale;
    if (spec.offset !== undefined) value += spec.offset;

    return value;
  }

  async function readTags() {
    if (!client) throw new Error('cliente Modbus não conectado');

    const values = {};
    for (const [key, spec] of Object.entries(symbols)) {
      if (!spec) continue;
      values[key] = await readSpec(spec);
    }
    return values;
  }

  async function close() {
    if (!client) return;
    await new Promise((resolve) => {
      client.close(() => resolve());
    }).catch(() => {});
    client = null;
  }

  return { connect, readTags, close };
}

module.exports = {
  createModbusAdapter,
};
