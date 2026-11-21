#!/usr/bin/env node
'use strict';

// Smoke test da Plataforma Industrial 4.0.
// Verifica a API em execução sem dependências externas.
//
// Uso:
//   node scripts/smoke-test.js
//   node scripts/smoke-test.js http://localhost:3000
//   BACKEND_URL=http://localhost:3000 SMOKE_MACHINE_ID=machine-01 node scripts/smoke-test.js

const BASE_URL = (process.argv[2] || process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const MACHINE_CODE = process.env.SMOKE_MACHINE_ID || 'machine-01';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 5000);

const results = [];
let machine = null;
let lastProduction = { filled: 0, capped: 0, total: 0 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

async function run(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`OK   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

function validTelemetry() {
  return {
    machineId: machine.code,
    timestamp: new Date().toISOString(),
    plcVersion: 'smoke-test',
    line: {
      step: 2,
      running: true,
      conveyorOn: true,
      evOn: true,
      atOn: false,
      sensorS1: true,
      sensorS2: false,
      bottlePositioned: true,
      evInterlock: false,
      atInterlock: false,
      fillPercent: 100,
    },
    production: {
      filled: lastProduction.filled + 1,
      capped: lastProduction.capped,
      total: lastProduction.total + 1,
    },
  };
}

async function expectSseReady() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/api/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    assert(response.status === 200, `status ${response.status}`);
    assert(response.body, 'resposta sem corpo');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('event: ready')) {
        await reader.cancel().catch(() => {});
        return 'event: ready recebido';
      }
    }

    throw new Error('stream encerrou antes de event: ready');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function main() {
  console.log(`Smoke test PI40 em ${BASE_URL}\n`);

  await run('GET /health', async () => {
    const res = await api('/health');
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'ok', `status ${res.json?.status}`);
    return 'status ok';
  });

  await run('GET /api/machines', async () => {
    const res = await api('/api/machines');
    assert(res.status === 200, `status ${res.status}`);
    const machines = res.json?.machines;
    assert(Array.isArray(machines) && machines.length > 0, 'nenhuma máquina cadastrada; inicie o simulador');
    machine = machines.find((item) => item.code === MACHINE_CODE) ?? machines[0];
    return `${machines.length} máquina(s); usando ${machine.code} (id ${machine.id})`;
  });

  if (machine) {
    await run(`GET /api/machines/${machine.id}/telemetry`, async () => {
      const res = await api(`/api/machines/${machine.id}/telemetry?limit=1`);
      assert(res.status === 200, `status ${res.status}`);
      assert(Array.isArray(res.json?.samples), 'campo samples ausente');
      const last = res.json.samples[0];
      if (last?.payload?.production) {
        lastProduction = last.payload.production;
      }
      return `${res.json.samples.length} amostra(s) retornada(s)`;
    });

    await run('POST /api/telemetry (payload válido)', async () => {
      const res = await api('/api/telemetry', { method: 'POST', body: validTelemetry() });
      assert(res.status === 202, `status ${res.status}: ${res.text.slice(0, 120)}`);
      assert(res.json?.status === 'accepted', `status ${res.json?.status}`);
      return `aceito em ${res.json.recordedAt}`;
    });

    await run('POST /api/telemetry (payload inválido)', async () => {
      const payload = validTelemetry();
      payload.line.evOn = true;
      payload.line.bottlePositioned = false;
      const res = await api('/api/telemetry', { method: 'POST', body: payload });
      assert(res.status === 400, `status ${res.status}`);
      assert(res.json?.error === 'invalid_payload', `error ${res.json?.error}`);
      const details = res.json?.details ?? [];
      assert(
        details.some((item) => item.includes('evOn exige')),
        'detalhe do intertravamento EV ausente'
      );
      return `${details.length} erro(s) de validação`;
    });

    await run(`GET /api/machines/${machine.id}/oee`, async () => {
      const res = await api(`/api/machines/${machine.id}/oee`);
      assert(res.status === 200, `status ${res.status}`);
      for (const field of ['availability', 'performance', 'quality', 'oee']) {
        const value = res.json?.[field];
        assert(typeof value === 'number' && value >= 0 && value <= 1, `${field} inválido: ${value}`);
      }
      return `OEE ${(res.json.oee * 100).toFixed(1)}%`;
    });

    await run(`GET /api/machines/${machine.id}/production`, async () => {
      const res = await api(`/api/machines/${machine.id}/production?bucket=hour`);
      assert(res.status === 200, `status ${res.status}`);
      assert(Array.isArray(res.json?.buckets), 'campo buckets ausente');
      assert(
        typeof res.json?.totals?.produced === 'number',
        'totals.produced ausente'
      );
      return `${res.json.buckets.length} intervalo(s), ${res.json.totals.produced} peça(s)`;
    });

    await run(`GET /api/machines/${machine.id}/alerts`, async () => {
      const res = await api(`/api/machines/${machine.id}/alerts?status=all&limit=5`);
      assert(res.status === 200, `status ${res.status}`);
      assert(Array.isArray(res.json?.alerts), 'campo alerts ausente');
      const open = res.json.alerts.filter((alert) => !alert.resolved_at).length;
      return `${res.json.alerts.length} alerta(s), ${open} aberto(s)`;
    });

    await run(`GET /api/machines/${machine.id}/maintenance`, async () => {
      const res = await api(`/api/machines/${machine.id}/maintenance`);
      assert(res.status === 200, `status ${res.status}`);
      const components = res.json?.components;
      assert(Array.isArray(components) && components.length > 0, 'nenhum componente configurado');
      for (const component of components) {
        assert(
          typeof component.usageRatio === 'number' && component.usageRatio >= 0,
          `usageRatio inválido em ${component.code}`
        );
      }
      const orders = res.json?.orders?.length ?? 0;
      return `${components.length} componente(s), ${orders} OS ativa(s)`;
    });
  }

  await run('GET /api/integrations/erp/outbox', async () => {
    const res = await api('/api/integrations/erp/outbox?limit=5');
    assert(res.status === 200, `status ${res.status}`);
    assert(Array.isArray(res.json?.outbox), 'campo outbox ausente');
    return `${res.json.outbox.length} evento(s)`;
  });

  await run('GET / (dashboard)', async () => {
    const res = await api('/');
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') || '').includes('text/html'), 'content-type não é HTML');
    return 'index.html servido';
  });

  await run('GET /api/stream (SSE)', async () => {
    return expectSseReady();
  });

  const failed = results.filter((item) => !item.ok);
  const passed = results.length - failed.length;
  console.log(`\n${passed}/${results.length} verificações OK`);

  if (failed.length > 0) {
    console.log('\nFalhas:');
    for (const item of failed) {
      console.log(`- ${item.name}: ${item.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\nErro inesperado: ${error.message}`);
  process.exitCode = 1;
});
