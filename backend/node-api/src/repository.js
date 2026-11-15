'use strict';

const { computeOee } = require('./indicators');
const {
  normalizeSettings,
  evaluateFillAlert,
  buildStoppedAlert,
} = require('./alerts');

function createRepository(pool, { alertSettings } = {}) {
  const settings = normalizeSettings(alertSettings);

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

        await client.query('COMMIT');

        return { machineId, recordedAt: record.timestamp, alerts };
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
  };
}

module.exports = {
  createRepository,
};
