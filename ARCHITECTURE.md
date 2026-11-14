# Arquitetura

## Visão de alto nível

```
┌────────────┐     telemetria      ┌────────────┐      SQL       ┌────────────┐
│ Simulador  │ ──────────────────▶ │  Backend   │ ─────────────▶ │ PostgreSQL │
│  (PLC)     │      HTTP/MQTT      │  (API)     │                │            │
└────────────┘                     └─────┬──────┘                └────────────┘
                                         │ REST/WebSocket
                                         ▼
                                   ┌────────────┐
                                   │ Dashboard  │
                                   │ (frontend) │
                                   └────────────┘
```

## Componentes

### Simulador (`simulator/`)

Gera leituras de sensores (temperatura, pressão, velocidade, contagem de peças)
e as publica periodicamente para o backend.

### Backend (`backend/node-api/`)

- Recebe e valida telemetria.
- Persiste amostras no banco.
- Calcula indicadores de produção.
- Expõe API REST (e, futuramente, WebSocket para tempo real).

### Banco de dados (`database/`)

PostgreSQL com tabelas para máquinas, sensores, telemetria e alertas. O schema
inicial está em `database/schema.sql`.

### Dashboard (`dashboard/frontend/`)

Aplicação web que consome a API para exibir telemetria em tempo real e
indicadores históricos.

## Decisões arquiteturais

Consulte [DECISIONS.md](DECISIONS.md).

## Diagramas

- `diagrams/architecture.drawio`
- `diagrams/sequence.drawio`
- `diagrams/deployment.drawio`

