# Arquitetura

## Visão de alto nível

```
┌────────────┐                     ┌────────────┐      SQL       ┌────────────┐
│ PLC /      │  ADS/OPC-UA/Modbus  │  Gateway   │   HTTP POST    │  Backend   │
│ Simulador  │ ──────────────────▶ │ industrial │ ─────────────▶ │  (API)     │
└────────────┘                     └────────────┘                └─────┬──────┘
                                                                      │ SQL
                                                                      ▼
                                                                ┌────────────┐
                                                                │ PostgreSQL │
                                                                └────────────┘
                                                                      ▲
                                                     REST + SSE       │
                                                                ┌─────┴──────┐
                                                                │ Dashboard  │
                                                                │ (frontend) │
                                                                └────────────┘
```

## Componentes

### Simulador (`simulator/`)

Gera leituras de sensores (temperatura, pressão, velocidade, contagem de peças)
e as publica periodicamente para o backend.

### Gateway industrial (`gateway/`)

- Lê PLCs reais por ADS (TwinCAT), OPC-UA ou Modbus TCP.
- Normaliza os sinais para o contrato de telemetria.
- Publica em `POST /api/telemetry` com novas tentativas em falhas temporárias.
- Inclui adaptador `simulator` para testes sem hardware.

### Backend (`backend/node-api/`)

- Recebe e valida telemetria.
- Persiste amostras no banco e avalia alertas.
- Calcula indicadores de produção.
- Expõe API REST e SSE (`/api/stream`) para tempo real.

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

