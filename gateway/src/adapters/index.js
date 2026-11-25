'use strict';

const { createAdsAdapter } = require('./ads');
const { createOpcUaAdapter } = require('./opcua');
const { createModbusAdapter } = require('./modbus');
const { createSimulatorAdapter } = require('./simulator');

function createAdapter(config) {
  switch (config.protocol) {
    case 'ads':
      return createAdsAdapter({ ...config.ads, symbols: config.symbols });
    case 'opcua':
      return createOpcUaAdapter({ ...config.opcua, symbols: config.symbols });
    case 'modbus':
      return createModbusAdapter({ ...config.modbus, symbols: config.symbols });
    case 'simulator':
      return createSimulatorAdapter({
        machineId: config.machineId,
        plcVersion: config.plcVersion || 'gateway-sim',
        autoStart: config.simulator.autoStart,
        // Um tick não pode avançar mais que um intervalo de polling: a primeira
        // leitura pode acontecer muito depois da criação do adaptador.
        maxTickMs: config.pollMs,
      });
    default:
      throw new Error(`Protocolo não suportado: ${config.protocol}`);
  }
}

module.exports = {
  createAdapter,
};
