'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRepository } = require('../src/repository');

function record({ produced, good, timestamp }) {
  return {
    machineId: 'machine-01',
    timestamp,
    plcVersion: '1.0.0',
    raw: {},
    line: {
      step: 2,
      running: true,
      conveyorOn: false,
      evOn: true,
      atOn: false,
      sensorS1: true,
      sensorS2: false,
      bottlePositioned: true,
      evInterlock: true,
      atInterlock: false,
      fillPercent: 42,
    },
    production: { filled: produced, capped: good, total: good },
  };
}

function createIngestionPool(totalRow = null) {
  const queries = [];

  const client = {
    async query(sql) {
      queries.push(sql);

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('INSERT INTO machines')) return { rows: [{ id: '1' }] };
      if (sql.includes('INSERT INTO telemetry')) return { rows: [] };
      if (sql.includes('INSERT INTO production (')) return { rows: [] };
      if (sql.includes('FROM production_totals')) {
        return { rows: totalRow ? [totalRow] : [] };
      }
      if (sql.includes('INSERT INTO production_totals')) return { rows: [] };
      if (sql.includes('SAVEPOINT') || sql.includes('RELEASE SAVEPOINT')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE alerts') || sql.includes('INSERT INTO alerts')) {
        return { rows: [] };
      }

      throw new Error(`SQL inesperado no teste: ${sql}`);
    },
    async release() {},
  };

  return {
    queries,
    pool: {
      async connect() {
        return client;
      },
      async query() {
        return { rows: [] };
      },
    },
  };
}

test('ingestão inicial registra o contador atual como acumulado', async () => {
  const { pool } = createIngestionPool();
  const repository = createRepository(pool);

  const saved = await repository.ingestTelemetry(
    record({
      produced: 100,
      good: 98,
      timestamp: '2026-11-21T19:00:00.000Z',
    })
  );

  assert.equal(saved.productionReset, false);
  assert.deepEqual(saved.productionTotal, {
    accumulatedProduced: 100,
    accumulatedGood: 98,
    lastResetAt: null,
  });
});

test('ingestão após reset preserva o acumulado e sinaliza o evento', async () => {
  const { pool } = createIngestionPool({
    accumulated_produced: '12430',
    accumulated_good: '12400',
    last_counter: '12430',
    last_good_counter: '12400',
    last_reset_at: null,
  });
  const repository = createRepository(pool);

  const saved = await repository.ingestTelemetry(
    record({
      produced: 0,
      good: 0,
      timestamp: '2026-11-21T19:05:00.000Z',
    })
  );

  assert.equal(saved.productionReset, true);
  assert.deepEqual(saved.productionTotal, {
    accumulatedProduced: 12430,
    accumulatedGood: 12400,
    lastResetAt: '2026-11-21T19:05:00.000Z',
  });
});

test('getProductionTotal devolve inteiros e a data do último reset', async () => {
  const { pool } = createIngestionPool();
  pool.query = async () => ({
    rows: [
      {
        accumulated_produced: '12430',
        accumulated_good: '12400',
        last_counter: '12',
        last_good_counter: '11',
        last_reset_at: '2026-11-21T19:05:00.000Z',
        updated_at: '2026-11-21T19:06:00.000Z',
      },
    ],
  });
  const repository = createRepository(pool);

  const totals = await repository.getProductionTotal(1);

  assert.deepEqual(totals, {
    machineId: 1,
    accumulatedProduced: 12430,
    accumulatedGood: 12400,
    lastCounter: 12,
    lastGoodCounter: 11,
    lastResetAt: '2026-11-21T19:05:00.000Z',
    updatedAt: '2026-11-21T19:06:00.000Z',
  });
});
