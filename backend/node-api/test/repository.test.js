'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeConfig } = require('../src/maintenance');
const { createRepository, toApiMaintenanceOrder } = require('../src/repository');

const maintenanceConfig = normalizeConfig({
  warnRatio: 0.8,
  components: [
    {
      code: 'conveyor-bearing',
      name: 'Rolamento da esteira',
      metric: 'hours',
      source: 'conveyor',
      mtbfHours: 200,
      initialHours: 160,
    },
  ],
});

function createFakePool() {
  return {
    async query(sql) {
      if (sql.includes('FROM component_usage')) {
        return {
          rows: [
            {
              component_code: 'conveyor-bearing',
              cycles: '0',
              hours: '160.500',
            },
          ],
        };
      }

      if (sql.includes('FROM maintenance_orders')) {
        return {
          rows: [
            {
              id: '11',
              machine_id: '1',
              component_code: 'conveyor-bearing',
              status: 'planned',
              priority: 'high',
              source_usage: '160.500',
              due_at: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              completed_at: null,
            },
          ],
        };
      }

      if (sql.includes('FROM maintenance_order_parts')) return { rows: [] };
      if (sql.includes('FROM sap_outbox')) return { rows: [] };

      throw new Error(`SQL inesperado no teste: ${sql}`);
    },
  };
}

test('converte BIGINT string da OS para inteiro na API', () => {
  const order = toApiMaintenanceOrder({
    id: '11',
    machine_id: '1',
    source_usage: '160.500',
    status: 'planned',
  });

  assert.equal(order.id, 11);
  assert.equal(order.machine_id, 1);
  assert.equal(order.source_usage, 160.5);
  assert.equal(order.status, 'planned');
  assert.equal(toApiMaintenanceOrder(null), null);
});

test('getMaintenanceOverview devolve id numérico na OS e no componente', async () => {
  const repository = createRepository(createFakePool(), { maintenanceConfig });

  const overview = await repository.getMaintenanceOverview(1);

  assert.equal(overview.orders.length, 1);
  assert.equal(overview.orders[0].id, 11);
  assert.equal(overview.orders[0].machine_id, 1);
  assert.equal(overview.components[0].order.id, 11);
});
