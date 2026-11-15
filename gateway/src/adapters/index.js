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
      });
    default:
      throw new Error(`Protocolo não suportado: ${config.protocol}`);
  }
}

module.exports = {
  createAdapter,
};
