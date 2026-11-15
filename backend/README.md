# Backend

API responsável por ingestão de telemetria, cálculo de indicadores e consultas.

## Estrutura

- `node-api/` — API Node.js + Express + PostgreSQL.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/health` | Verificação de saúde do serviço. |
| `POST` | `/api/telemetry` | Recebe telemetria de uma máquina. |
| `GET` | `/api/machines` | Lista as máquinas cadastradas. |
| `GET` | `/api/machines/:id/telemetry` | Telemetria histórica da máquina. |
| `GET` | `/api/machines/:id/oee` | Disponibilidade, performance, qualidade e OEE. |
| `GET` | `/api/stream` | Stream SSE de telemetria em tempo real. |
| `GET` | `/api/machines/:id/alerts` | Alertas da máquina (`status=open\|all`). |
| `POST` | `/api/alerts/:id/resolve` | Resolve um alerta aberto. |

`POST /api/telemetry` responde `202` quando a amostra é aceita e `400` com
`details` quando o payload é inválido.

`GET /api/machines/:id/telemetry` aceita `from`, `to` (datas ISO) e `limit`
(padrão `100`, máximo `1000`) e retorna as amostras mais recentes primeiro.

`GET /api/machines/:id/oee` aceita `from`, `to` (datas ISO) e
`nominalCapacityPerHour` (padrão via `NOMINAL_CAPACITY_PER_HOUR`, `400`). Retorna
`availability`, `performance`, `quality`, `oee` (0–1), `produced`, `good`,
`operatingTimeMs` e `plannedTimeMs`.

`GET /api/stream` mantém uma conexão `text/event-stream`, envia `event: ready`
ao conectar e `event: telemetry` a cada amostra aceita em `POST /api/telemetry`.
Alertas criados/resolvidos também são publicados como `event: alert`.
Heartbeats (`: keep-alive`) mantêm a conexão viva.

Cálculo:

- **Disponibilidade:** tempo com `line.running = true` / período analisado.
- **Performance:** peças produzidas / (capacidade nominal × horas operando).
- **Qualidade:** peças boas / peças produzidas.
- **OEE:** produto dos três fatores.

Os contadores são cumulativos: a produção do período é `última - primeira`
amostra.

## Alertas

Os alertas são avaliados na ingestão, dentro da mesma transação da telemetria:

- `fillPercent` fora de `ALERT_FILL_PERCENT_MIN`/`ALERT_FILL_PERCENT_MAX` durante
  a etapa de envase (etapa 2).
- `lineStopped` quando a linha está parada há mais de `ALERT_STOPPED_MS` desde a
  última amostra com `running = true`.

Cada sensor/máquina tem no máximo um alerta aberto. Quando a condição normaliza
(leitura volta aos limites ou a linha volta a operar), o alerta é resolvido
automaticamente. Também é possível resolver manualmente por
`POST /api/alerts/:id/resolve`.

## Executar localmente

```bash
cd backend/node-api
npm install
npm start
```

Variáveis: `HOST` (padrão `0.0.0.0`), `PORT`/`BACKEND_PORT` (padrão `3000`),
`DATABASE_URL`, `NOMINAL_CAPACITY_PER_HOUR` (padrão `400`),
`ALERT_FILL_PERCENT_MIN` (padrão `0`), `ALERT_FILL_PERCENT_MAX` (padrão `100`),
`ALERT_STOPPED_MS` (padrão `60000`) e `DASHBOARD_DIR` (padrão
`dashboard/frontend`). Para rodar fora do Docker, use um `DATABASE_URL`
apontando para `localhost` (ex.:
`postgresql://industrial:change-me@localhost:5432/industrial`).

O backend também serve o dashboard estático na raiz (`/`), a partir de
`DASHBOARD_DIR`. O contrato da API está em [`docs/openapi.yaml`](../docs/openapi.yaml).

## Testes

```bash
cd backend/node-api
npm test
npm run check
```

## Docker

O serviço `backend` do `docker-compose.yml` usa `backend/node-api/Dockerfile` e
depende do PostgreSQL saudável. A ingestão usa transação e cria a máquina
automaticamente (`machines.code`) na primeira amostra.
