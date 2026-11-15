'use strict';

const { Pool } = require('pg');

const { loadConfig, loadEnvFiles } = require('./src/config');
const { createRepository } = require('./src/repository');
const { createApp } = require('./src/app');

loadEnvFiles();

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const repository = createRepository(pool, { alertSettings: config.alertSettings });
const app = createApp({
  repository,
  nominalCapacityPerHour: config.nominalCapacityPerHour,
  dashboardDir: config.dashboardDir,
});

const server = app.listen(config.port, config.host, () => {
  console.log(`API de ingestão em http://${config.host}:${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} recebido; encerrando.`);
  app.locals.streamHub?.closeAll();
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
