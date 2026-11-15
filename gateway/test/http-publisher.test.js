'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHttpPublisher } = require('../src/http-publisher');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test('publica em /api/telemetry', async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse(202, { status: 'accepted' });
  };
  const publisher = createHttpPublisher({
    backendUrl: 'http://localhost:3000/',
    fetchImpl,
    retryDelayMs: 1,
  });

  const body = await publisher.publish({ machineId: 'machine-01' });

  assert.equal(request.url, 'http://localhost:3000/api/telemetry');
  assert.equal(request.options.method, 'POST');
  assert.equal(JSON.parse(request.options.body).machineId, 'machine-01');
  assert.equal(body.status, 'accepted');
});

test('tenta novamente após erro 5xx', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? jsonResponse(500, { error: 'internal_error' }) : jsonResponse(202, {});
  };
  const publisher = createHttpPublisher({
    backendUrl: 'http://localhost:3000',
    fetchImpl,
    maxRetries: 2,
    retryDelayMs: 1,
  });

  await publisher.publish({ machineId: 'machine-01' });
  assert.equal(calls, 2);
});

test('não tenta novamente após erro 4xx', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(400, { error: 'invalid_payload' });
  };
  const publisher = createHttpPublisher({
    backendUrl: 'http://localhost:3000',
    fetchImpl,
    maxRetries: 3,
    retryDelayMs: 1,
  });

  await assert.rejects(() => publisher.publish({}), /HTTP 400/);
  assert.equal(calls, 1);
});

test('desiste após esgotar as tentativas', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(503, { error: 'unavailable' });
  };
  const publisher = createHttpPublisher({
    backendUrl: 'http://localhost:3000',
    fetchImpl,
    maxRetries: 2,
    retryDelayMs: 1,
  });

  await assert.rejects(() => publisher.publish({}), /HTTP 503/);
  assert.equal(calls, 3);
});
