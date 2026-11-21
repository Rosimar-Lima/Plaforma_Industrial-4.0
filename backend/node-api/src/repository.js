'use strict';

const { computeOee } = require('./indicators');
const { computeProductionBuckets } = require('./production');
const {
  normalizeSettings,
  evaluateFillAlert,
  buildStoppedAlert,
} = require('./alerts');
const {
  counterValue,
  usageSignal,
  nextHourUsage,
  componentStatus,
  maintenanceAlert,
  componentView,
} = require('./maintenance');

function createRepository(pool, { alertSettings, maintenanceConfig } = {}) {
  const settings = normalizeSettings(alertSettings);
  const maintenance =
    maintenanceConfig && Array.isArray(maintenanceConfig.components)
      ? maintenanceConfig
      : null;

  async function lastRunningAt(client, machineId, timestamp) {
    const result = await client.query(
      `SELECT max(recorded_at) AS last_running
       FROM telemetry
       WHERE machine_id = $1
         AND recorded_at <= $2
         AND COALESCE((payload->'line'->>'running')::boolean, false) = true`,
      [machineId, timestamp]
    );

    return result.rows[0]?.last_running ?? null;
  }

  async function applyAlert(client, machineId, sensorCode, condition, timestamp) {
    if (condition) {
      const result = await client.query(
        `INSERT INTO alerts (machine_id, sensor_code, message, severity, created_at)
         SELECT $1::bigint, $2::varchar, $3::text, $4::varchar, $5::timestamptz
         WHERE NOT EXISTS (
           SELECT 1
           FROM alerts
           WHERE machine_id = $1 AND sensor_code = $2 AND resolved_at IS NULL
         )
         RETURNING id, machine_id, sensor_code, message, severity, created_at, resolved_at`,
        [machineId, sensorCode, condition.message, condition.severity, timestamp]
      );

      return result.rows[0] ? { action: 'created', alert: result.rows[0] } : null;
    }

    const result = await client.query(
      `UPDATE alerts
       SET resolved_at = $3
       WHERE machine_id = $1 AND sensor_code = $2 AND resolved_at IS NULL
       RETURNING id, machine_id, sensor_code, message, severity, created_at, resolved_at`,
      [machineId, sensorCode, timestamp]
    );

    return result.rows[0] ? { action: 'resolved', alert: result.rows[0] } : null;
  }

  async function syncAlerts(client, machineId, record) {
    const events = [];

    await client.query('SAVEPOINT alerts_sync');

    try {
      const fillCondition = evaluateFillAlert(record, settings);
      const fillEvent = await applyAlert(
        client,
        machineId,
        'fillPercent',
        fillCondition,
        record.timestamp
      );
      if (fillEvent) events.push(fillEvent);

      let stoppedCondition = null;
      if (!record.line.running) {
        const lastRunning = await lastRunningAt(client, machineId, record.timestamp);
        if (lastRunning) {
          const stoppedMs = new Date(record.timestamp).getTime() - new Date(lastRunning).getTime();
          stoppedCondition = buildStoppedAlert(stoppedMs, settings);
        }
      }

      const stoppedEvent = await applyAlert(
        client,
        machineId,
        'lineStopped',
        stoppedCondition,
        record.timestamp
      );
      if (stoppedEvent) events.push(stoppedEvent);

      await client.query('RELEASE SAVEPOINT alerts_sync');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT alerts_sync').catch(() => {});
      console.error('Falha ao avaliar alertas:', error);
      return [];
    }

    return events;
  }

  async function upsertComponentUsage(client, machineId, component, record) {
    const timestamp = record.timestamp;

    if (component.metric === 'hours') {
      const previous = await client.query(
        `SELECT hours, last_timestamp, last_active
         FROM component_usage
         WHERE machine_id = $1 AND component_code = $2
         FOR UPDATE`,
        [machineId, component.code]
      );

      const row = previous.rows[0];
      const active = usageSignal(record.line, component.source);
      const hours = nextHourUsage(
        row
          ? {
              hours: row.hours,
              lastTimestamp: row.last_timestamp,
              lastActive: row.last_active,
            }
          : null,
        component,
        record.timestamp
      );

      await client.query(
        `INSERT INTO component_usage
           (machine_id, component_code, hours, last_timestamp, last_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $4)
         ON CONFLICT (machine_id, component_code) DO UPDATE
           SET hours = EXCLUDED.hours,
               last_timestamp = EXCLUDED.last_timestamp,
               last_active = EXCLUDED.last_active,
               updated_at = EXCLUDED.updated_at`,
        [machineId, component.code, hours, timestamp, active]
      );

      return hours;
    }

    const counter = counterValue(record.production, component.source);
    const result = await client.query(
      `INSERT INTO component_usage (machine_id, component_code, cycles, last_counter, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (machine_id, component_code) DO UPDATE
         SET cycles = component_usage.cycles
               + GREATEST(0, EXCLUDED.last_counter - component_usage.last_counter),
             last_counter = EXCLUDED.last_counter,
             updated_at = EXCLUDED.updated_at
       RETURNING cycles`,
      [machineId, component.code, component.initial, counter, timestamp]
    );

    return Number(result.rows[0]?.cycles ?? component.initial);
  }

  async function syncMaintenanceAlert(client, machineId, component, usage, timestamp) {
    const condition = maintenanceAlert(component, usage);
    if (!condition) return null;

    const existing = await client.query(
      `SELECT id
       FROM alerts
       WHERE machine_id = $1 AND sensor_code = $2 AND resolved_at IS NULL
       FOR UPDATE`,
      [machineId, condition.sensorCode]
    );

    if (existing.rows[0]) {
      const updated = await client.query(
        `UPDATE alerts
         SET message = $2, severity = $3
         WHERE id = $1
           AND (severity IS DISTINCT FROM $3 OR message IS DISTINCT FROM $2)
         RETURNING id, machine_id, sensor_code, message, severity, created_at, resolved_at`,
        [existing.rows[0].id, condition.message, condition.severity]
      );

      return updated.rows[0] ? { action: 'updated', alert: updated.rows[0] } : null;
    }

    const inserted = await client.query(
      `INSERT INTO alerts (machine_id, sensor_code, message, severity, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, machine_id, sensor_code, message, severity, created_at, resolved_at`,
      [machineId, condition.sensorCode, condition.message, condition.severity, timestamp]
    );

    return { action: 'created', alert: inserted.rows[0] };
  }

  async function insertSapOutbox(client, order, component, eventType) {
    const parts = await client.query(
      `SELECT part_code, part_name, quantity
       FROM maintenance_order_parts
       WHERE order_id = $1
       ORDER BY id`,
      [order.id]
    );

    const externalId = `SAP-${order.id}-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      event: eventType,
      sapOrderId: externalId,
      machineId: order.machine_id,
      order: {
        id: order.id,
        componentCode: order.component_code,
        status: order.status,
        priority: order.priority,
        sourceUsage: order.source_usage,
        sourceUnit: component.unit,
        dueAt: order.due_at,
      },
      component: {
        code: component.code,
        name: component.name,
        metric: component.metric,
        mtbf: component.mtbf,
        unit: component.unit,
      },
      parts: parts.rows.map((part) => ({
        code: part.part_code,
        name: part.part_name,
        quantity: part.quantity,
      })),
    };

    await client.query(
      `INSERT INTO sap_outbox (order_id, event_type, payload, status, external_id, sent_at)
       VALUES ($1, $2, $3::jsonb, 'sent', $4, now())`,
      [order.id, eventType, JSON.stringify(payload), externalId]
    );

    return externalId;
  }

  async function ensureMaintenanceOrder(client, machineId, component, usage, status, timestamp) {
    if (status === 'ok') return null;

    const existing = await client.query(
      `SELECT id, status, priority, source_usage, due_at
       FROM maintenance_orders
       WHERE machine_id = $1
         AND component_code = $2
         AND status IN ('planned', 'open', 'in_progress')
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [machineId, component.code]
    );

    const desiredStatus = status === 'critical' ? 'open' : 'planned';
    const desiredPriority = status === 'critical' ? 'critical' : 'high';

    if (existing.rows[0]) {
      const current = existing.rows[0];

      if (status !== 'critical' || current.status === 'in_progress') return null;
      if (current.status === 'open' && current.priority === 'critical') return null;

      const updated = await client.query(
        `UPDATE maintenance_orders
         SET status = $2,
             priority = $3,
             source_usage = GREATEST(source_usage, $4),
             due_at = LEAST(due_at, $5::timestamptz + interval '1 day'),
             updated_at = $5
         WHERE id = $1
         RETURNING id, machine_id, component_code, status, priority, source_usage, due_at,
                   created_at, updated_at, completed_at`,
        [current.id, desiredStatus, desiredPriority, usage, timestamp]
      );

      await insertSapOutbox(client, updated.rows[0], component, 'maintenance_order.escalated');

      return { action: 'escalated', order: updated.rows[0] };
    }

    const inserted = await client.query(
      `INSERT INTO maintenance_orders
         (machine_id, component_code, status, priority, source_usage, due_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz + interval '7 days', $6, $6)
       RETURNING id, machine_id, component_code, status, priority, source_usage, due_at,
                 created_at, updated_at, completed_at`,
      [machineId, component.code, desiredStatus, desiredPriority, usage, timestamp]
    );
    const order = inserted.rows[0];

    const parts = [];
    for (const part of component.parts) {
      const partResult = await client.query(
        `INSERT INTO maintenance_order_parts (order_id, part_code, part_name, quantity)
         VALUES ($1, $2, $3, $4)
         RETURNING id, part_code, part_name, quantity, status`,
        [order.id, part.code, part.name, part.quantity]
      );
      parts.push(partResult.rows[0]);
    }

    await insertSapOutbox(client, order, component, 'maintenance_order.created');

    return { action: 'created', order, parts };
  }

  async function syncMaintenance(client, machineId, record) {
    const result = { alerts: [], orders: [] };
    if (!maintenance) return result;

    await client.query('SAVEPOINT maintenance_sync');

    try {
      for (const component of maintenance.components) {
        const usage = await upsertComponentUsage(client, machineId, component, record);
        const status = componentStatus(usage, component, maintenance.warnRatio);

        if (status === 'ok') continue;

        const alertEvent = await syncMaintenanceAlert(
          client,
          machineId,
          component,
          usage,
          record.timestamp
        );
        if (alertEvent) result.alerts.push(alertEvent);

        const orderEvent = await ensureMaintenanceOrder(
          client,
          machineId,
          component,
          usage,
          status,
          record.timestamp
        );
        if (orderEvent) result.orders.push(orderEvent);
      }

      await client.query('RELEASE SAVEPOINT maintenance_sync');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT maintenance_sync').catch(() => {});
      console.error('Falha ao avaliar manutenção preventiva:', error);
    }

    return result;
  }

  async function changeMaintenanceOrderStatus(orderId, status, eventType) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT id, machine_id, component_code, status, priority, source_usage,
                due_at, created_at, updated_at, completed_at
         FROM maintenance_orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );
      const order = result.rows[0];

      if (!order) {
        await client.query('ROLLBACK');
        return null;
      }

      if (order.status === status) {
        await client.query('COMMIT');
        return order;
      }

      if (!['planned', 'open', 'in_progress'].includes(order.status)) {
        await client.query('ROLLBACK');
        return null;
      }

      const updated = await client.query(
        `UPDATE maintenance_orders
         SET status = $2, updated_at = now(), completed_at = NULL
         WHERE id = $1
         RETURNING id, machine_id, component_code, status, priority, source_usage,
                   due_at, created_at, updated_at, completed_at`,
        [orderId, status]
      );

      const component = maintenance?.components?.find(
        (item) => item.code === order.component_code
      ) ?? {
        code: order.component_code,
        name: order.component_code,
        metric: 'cycles',
        mtbf: 0,
        unit: 'ciclos',
        parts: [],
      };
      await insertSapOutbox(client, updated.rows[0], component, eventType);

      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async ingestTelemetry(record) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const machineResult = await client.query(
          `INSERT INTO machines (code, name)
           VALUES ($1, $1)
           ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
           RETURNING id`,
          [record.machineId]
        );
        const machineId = machineResult.rows[0].id;

        await client.query(
          `INSERT INTO telemetry (machine_id, recorded_at, payload)
           VALUES ($1, $2, $3::jsonb)`,
          [machineId, record.timestamp, JSON.stringify(record.raw)]
        );

        await client.query(
          `INSERT INTO production (machine_id, recorded_at, produced, good)
           VALUES ($1, $2, $3, $4)`,
          [machineId, record.timestamp, record.production.filled, record.production.total]
        );

        const alerts = await syncAlerts(client, machineId, record);
        const maintenanceEvents = await syncMaintenance(client, machineId, record);

        await client.query('COMMIT');

        return {
          machineId,
          recordedAt: record.timestamp,
          alerts: [...alerts, ...maintenanceEvents.alerts],
          maintenance: maintenanceEvents.orders,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async listMachines() {
      const result = await pool.query(
        `SELECT id, code, name, location, created_at
         FROM machines
         ORDER BY code`
      );
      return result.rows;
    },

    async listTelemetry(machineId, { from, to, limit = 100 } = {}) {
      const conditions = ['machine_id = $1'];
      const values = [machineId];

      if (from) {
        values.push(from);
        conditions.push(`recorded_at >= $${values.length}`);
      }
      if (to) {
        values.push(to);
        conditions.push(`recorded_at <= $${values.length}`);
      }

      values.push(limit);

      const result = await pool.query(
        `SELECT id, recorded_at, payload
         FROM telemetry
         WHERE ${conditions.join(' AND ')}
         ORDER BY recorded_at DESC
         LIMIT $${values.length}`,
        values
      );
      return result.rows;
    },

    async getOee(machineId, { from, to, nominalCapacityPerHour = 400 } = {}) {
      const conditions = ['machine_id = $1'];
      const values = [machineId];

      if (from) {
        values.push(from);
        conditions.push(`recorded_at >= $${values.length}`);
      }
      if (to) {
        values.push(to);
        conditions.push(`recorded_at <= $${values.length}`);
      }

      const result = await pool.query(
        `SELECT recorded_at,
                COALESCE((payload->'line'->>'running')::boolean, false) AS running,
                COALESCE((payload->'production'->>'filled')::integer, 0) AS produced,
                COALESCE((payload->'production'->>'total')::integer, 0) AS good
         FROM telemetry
         WHERE ${conditions.join(' AND ')}
         ORDER BY recorded_at ASC`,
        values
      );

      return computeOee(result.rows, { nominalCapacityPerHour });
    },

    async getProductionHistory(
      machineId,
      { from, to, bucket = 'hour', timeZone, shiftStartHour, shiftHours, now } = {}
    ) {
      const columns = `recorded_at,
              COALESCE((payload->'line'->>'running')::boolean, false) AS running,
              COALESCE((payload->'production'->>'filled')::integer, 0) AS produced,
              COALESCE((payload->'production'->>'total')::integer, 0) AS good`;

      const conditions = ['machine_id = $1'];
      const values = [machineId];

      if (from) {
        values.push(from);
        conditions.push(`recorded_at >= $${values.length}`);
      }
      if (to) {
        values.push(to);
        conditions.push(`recorded_at <= $${values.length}`);
      }

      const baseline = from
        ? (
            await pool.query(
              `SELECT ${columns}
               FROM telemetry
               WHERE machine_id = $1 AND recorded_at < $2
               ORDER BY recorded_at DESC
               LIMIT 1`,
              [machineId, from]
            )
          ).rows
        : [];

      const result = await pool.query(
        `SELECT ${columns}
         FROM telemetry
         WHERE ${conditions.join(' AND ')}
         ORDER BY recorded_at ASC`,
        values
      );

      return computeProductionBuckets([...baseline, ...result.rows], {
        from,
        to,
        bucket,
        timeZone,
        shiftStartHour,
        shiftHours,
        now,
      });
    },

    async listAlerts(machineId, { status = 'open', limit = 20 } = {}) {
      const conditions = ['machine_id = $1'];
      const values = [machineId];

      if (status === 'open') {
        conditions.push('resolved_at IS NULL');
      }

      values.push(limit);

      const result = await pool.query(
        `SELECT id, machine_id, sensor_code, message, severity, created_at, resolved_at
         FROM alerts
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length}`,
        values
      );

      return result.rows;
    },

    async resolveAlert(id) {
      const result = await pool.query(
        `UPDATE alerts
         SET resolved_at = now()
         WHERE id = $1 AND resolved_at IS NULL
         RETURNING id, machine_id, sensor_code, message, severity, created_at, resolved_at`,
        [id]
      );

      return result.rows[0] ?? null;
    },

    async getMaintenanceOverview(machineId) {
      if (!maintenance) {
        return { machineId, warnRatio: 0, components: [], orders: [] };
      }

      const [usageResult, ordersResult] = await Promise.all([
        pool.query(
          `SELECT component_code, cycles, hours
           FROM component_usage
           WHERE machine_id = $1`,
          [machineId]
        ),
        pool.query(
          `SELECT id, machine_id, component_code, status, priority, source_usage,
                  due_at, created_at, updated_at, completed_at
           FROM maintenance_orders
           WHERE machine_id = $1
             AND status IN ('planned', 'open', 'in_progress')
           ORDER BY created_at DESC, id DESC`,
          [machineId]
        ),
      ]);

      const usage = new Map(
        usageResult.rows.map((row) => [row.component_code, row])
      );
      const orders = ordersResult.rows;

      const componentConfig = new Map(
        maintenance.components.map((component) => [component.code, component])
      );

      if (orders.length > 0) {
        const orderIds = orders.map((order) => order.id);
        const [partsResult, outboxResult] = await Promise.all([
          pool.query(
            `SELECT order_id, part_code, part_name, quantity, status
             FROM maintenance_order_parts
             WHERE order_id = ANY($1::bigint[])
             ORDER BY id`,
            [orderIds]
          ),
          pool.query(
            `SELECT DISTINCT ON (order_id)
                    order_id, event_type, status, external_id, sent_at, created_at
             FROM sap_outbox
             WHERE order_id = ANY($1::bigint[])
             ORDER BY order_id, id DESC`,
            [orderIds]
          ),
        ]);

        const partsByOrder = new Map();
        for (const part of partsResult.rows) {
          const key = String(part.order_id);
          if (!partsByOrder.has(key)) partsByOrder.set(key, []);
          partsByOrder.get(key).push({
            code: part.part_code,
            name: part.part_name,
            quantity: part.quantity,
            status: part.status,
          });
        }

        const sapByOrder = new Map(
          outboxResult.rows.map((row) => [
            String(row.order_id),
            {
              event: row.event_type,
              status: row.status,
              external_id: row.external_id,
              sent_at: row.sent_at,
            },
          ])
        );

        for (const order of orders) {
          const key = String(order.id);
          order.parts = partsByOrder.get(key) ?? [];
          order.sap = sapByOrder.get(key) ?? null;
        }
      }

      for (const order of orders) {
        order.source_usage = Number(order.source_usage) || 0;
        order.source_unit = componentConfig.get(order.component_code)?.unit ?? 'ciclos';
      }

      const ordersByComponent = new Map(
        orders.map((order) => [order.component_code, order])
      );

      const components = maintenance.components.map((component) => {
        const row = usage.get(component.code);
        const current =
          component.metric === 'hours'
            ? Number(row?.hours ?? component.initial)
            : Number(row?.cycles ?? component.initial);
        const view = componentView(component, current, maintenance.warnRatio);
        const order = ordersByComponent.get(component.code);

        return {
          ...view,
          order: order
            ? {
                id: order.id,
                status: order.status,
                priority: order.priority,
                source_usage: Number(order.source_usage) || 0,
                source_unit: componentConfig.get(order.component_code)?.unit ?? component.unit,
                due_at: order.due_at,
                parts: order.parts ?? [],
                sap: order.sap ?? null,
              }
            : null,
        };
      });

      return {
        machineId,
        warnRatio: maintenance.warnRatio,
        components,
        orders,
      };
    },

    async sendMaintenanceOrder(orderId) {
      return changeMaintenanceOrderStatus(
        orderId,
        'in_progress',
        'maintenance_order.sent'
      );
    },

    async cancelMaintenanceOrder(orderId) {
      return changeMaintenanceOrderStatus(
        orderId,
        'cancelled',
        'maintenance_order.cancelled'
      );
    },

    async completeMaintenanceOrder(orderId) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `SELECT id, machine_id, component_code, status, priority, source_usage,
                  due_at, created_at, updated_at, completed_at
           FROM maintenance_orders
           WHERE id = $1
           FOR UPDATE`,
          [orderId]
        );
        const order = result.rows[0];

        if (!order) {
          await client.query('ROLLBACK');
          return null;
        }

        if (order.status === 'completed') {
          await client.query('COMMIT');
          return order;
        }

        if (!['planned', 'open', 'in_progress'].includes(order.status)) {
          await client.query('ROLLBACK');
          return null;
        }

        const updated = await client.query(
          `UPDATE maintenance_orders
           SET status = 'completed', completed_at = now(), updated_at = now()
           WHERE id = $1
           RETURNING id, machine_id, component_code, status, priority, source_usage,
                     due_at, created_at, updated_at, completed_at`,
          [orderId]
        );

        await client.query(
          `UPDATE maintenance_order_parts
           SET status = 'consumed'
           WHERE order_id = $1`,
          [orderId]
        );

        const component = maintenance?.components?.find(
          (item) => item.code === order.component_code
        );
        if (component?.metric === 'hours') {
          await client.query(
            `UPDATE component_usage
             SET hours = 0, updated_at = now()
             WHERE machine_id = $1 AND component_code = $2`,
            [order.machine_id, order.component_code]
          );
        } else {
          await client.query(
            `UPDATE component_usage
             SET cycles = 0, updated_at = now()
             WHERE machine_id = $1 AND component_code = $2`,
            [order.machine_id, order.component_code]
          );
        }

        await client.query(
          `UPDATE alerts
           SET resolved_at = now()
           WHERE machine_id = $1
             AND sensor_code = $2
             AND resolved_at IS NULL`,
          [order.machine_id, `maintenance.${order.component_code}`.slice(0, 50)]
        );

        await client.query('COMMIT');

        return updated.rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async listSapOutbox({ limit = 20 } = {}) {
      const result = await pool.query(
        `SELECT id, order_id, event_type, status, external_id, payload, created_at, sent_at
         FROM sap_outbox
         ORDER BY id DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows;
    },
  };
}

module.exports = {
  createRepository,
};
