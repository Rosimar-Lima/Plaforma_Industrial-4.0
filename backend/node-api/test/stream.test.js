'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createStreamHub } = require('../src/stream');

function fakeResponse() {
  const writes = [];
  const listeners = {};

  return {
    writes,
    statusCode: 0,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(headers) {
      this.headers = headers;
      return this;
    },
    flushHeaders() {},
    write(chunk) {
      writes.push(chunk);
      return true;
    },
    on(event, handler) {
      listeners[event] = handler;
    },
    end() {
      this.ended = true;
    },
    emit(event) {
      listeners[event]?.();
    },
  };
}

test('registra cliente e envia evento ready', () => {
  const hub = createStreamHub({ heartbeatMs: 100000 });
  const res = fakeResponse();

  hub.subscribe({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(hub.size(), 1);
  assert.match(res.writes.join(''), /event: ready/);

  res.emit('close');
  assert.equal(hub.size(), 0);
});

test('broadcast envia eventos para os clientes', () => {
  const hub = createStreamHub({ heartbeatMs: 100000 });
  const res = fakeResponse();
  hub.subscribe({}, res);

  hub.broadcast('telemetry', { machineId: 'machine-01', line: { step: 2 } });

  const output = res.writes.join('');
  assert.match(output, /event: telemetry/);
  assert.match(output, /machine-01/);
  assert.match(output, /"step":2/);

  hub.closeAll();
  assert.equal(res.ended, true);
  assert.equal(hub.size(), 0);
});
