'use strict';

const { requireOptional } = require('../optional');

function createOpcUaAdapter({
  endpointUrl,
  userName = null,
  password = null,
  securityMode = 'None',
  securityPolicy = 'None',
  symbols = {},
} = {}) {
  let client = null;
  let session = null;

  async function connect() {
    const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = requireOptional('node-opcua');

    const mode = MessageSecurityMode[securityMode];
    const policy = SecurityPolicy[securityPolicy];

    if (mode === undefined) throw new Error(`OPCUA_SECURITY_MODE inválido: ${securityMode}`);
    if (policy === undefined) throw new Error(`OPCUA_SECURITY_POLICY inválido: ${securityPolicy}`);

    client = OPCUAClient.create({
      endpointMustExist: false,
      securityMode: mode,
      securityPolicy: policy,
      connectionStrategy: { maxRetry: 2 },
    });

    await client.connect(endpointUrl);

    const userIdentity = userName ? { userName, password } : undefined;
    session = await client.createSession(userIdentity);
  }

  async function readTags() {
    if (!session) throw new Error('sessão OPC-UA não conectada');

    const { AttributeIds } = requireOptional('node-opcua');
    const values = {};

    for (const [key, nodeId] of Object.entries(symbols)) {
      if (!nodeId) continue;
      const dataValue = await session.read({
        nodeId,
        attributeId: AttributeIds.Value,
      });
      values[key] = dataValue.value?.value ?? null;
    }

    return values;
  }

  async function close() {
    if (session) {
      await session.close().catch(() => {});
      session = null;
    }
    if (client) {
      await client.disconnect().catch(() => {});
      client = null;
    }
  }

  return { connect, readTags, close };
}

module.exports = {
  createOpcUaAdapter,
};
