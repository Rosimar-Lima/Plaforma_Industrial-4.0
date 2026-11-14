# Backend

API responsável por ingestão de telemetria, cálculo de indicadores e consultas.

## Estrutura

- `node-api/` — aplicação Node.js (a ser inicializada).

## Endpoints previstos

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/telemetry` | Recebe telemetria de uma máquina. |
| `GET` | `/api/machines` | Lista máquinas cadastradas. |
| `GET` | `/api/machines/:id/telemetry` | Telemetria histórica. |
| `GET` | `/api/machines/:id/oee` | Indicadores de OEE. |
