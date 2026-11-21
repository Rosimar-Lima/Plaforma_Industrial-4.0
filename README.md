# Plataforma Industrial 4.0

Plataforma para coleta, processamento e visualização de dados industriais (telemetria de máquinas, indicadores de produção e alertas), seguindo os princípios da Indústria 4.0.

A plataforma nasceu como evolução do projeto Linha de Envase desenvolvido no curso de Engenharia Mecatrônica, ampliando o foco do controle da máquina para monitoramento, armazenamento histórico, indicadores operacionais e análise de desempenho industrial.

O projeto foi concebido para funcionar tanto com equipamentos reais quanto com simuladores, permitindo demonstração, testes e desenvolvimento sem dependência de hardware industrial.

## Visão geral

| Diretório | Descrição |
| --- | --- |
| `simulator/` | Simulador de PLC que publica telemetria de sensores. |
| `gateway/` | Gateway industrial (ADS, OPC-UA, Modbus TCP) para PLCs reais. |
| `backend/` | API de ingestão, regras de negócio e consultas. |
| `dashboard/` | Interface web para monitoramento e indicadores. |
| `database/` | Schema e configuração do PostgreSQL. |
| `docs/` | Requisitos, casos de uso, indicadores e glossário. |
| `diagrams/` | Diagramas de arquitetura, sequência e implantação. |

## Documentação

| Documento | Descrição |
| --- | --- |
| [PROJECT_CHARTER.md](PROJECT_CHARTER.md) | Objetivos, escopo e stakeholders. |
| [ROADMAP.md](ROADMAP.md) | Fases e entregas planejadas. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Visão arquitetural. |
| [DECISIONS.md](DECISIONS.md) | Registro de decisões de arquitetura (ADR). |
| [docs/source-project.md](docs/source-project.md) | Projeto de origem e mapa de migração. |
| [docs/openapi.yaml](docs/openapi.yaml) | Contrato da API (OpenAPI 3). |
| [docs/acceptance-test.md](docs/acceptance-test.md) | Roteiro de aceitação do MVP. |
| [gateway/README.md](gateway/README.md) | Gateway industrial (ADS, OPC-UA, Modbus TCP). |
| [docs/](docs/) | Requisitos, indicadores, casos de uso e glossário. |

## Começando

```bash
cp .env.example .env
docker compose up -d
```

Dashboard: `http://localhost:3000` (servido pelo backend). A telemetria chega em
tempo real por SSE (`/api/stream`), com fallback para polling. Para rodar sem
Docker, use `cd backend/node-api && npm install && npm start` e o simulador com
`node simulator/plc-simulator.js`.

Alertas são gerados na ingestão quando o nível de envase sai dos limites
configurados (`ALERT_FILL_PERCENT_MIN/MAX`) ou quando a linha fica parada além de
`ALERT_STOPPED_MS`. O dashboard exibe os alertas abertos em tempo real e permite
resolvê-los; o histórico fica em `GET /api/machines/:id/alerts?status=all`.

A manutenção preventiva é baseada no uso: cada componente virtual acumula
ciclos de envase, tampagem ou total e entra em `warning` ao atingir 80% da vida
útil, gerando uma OS planejada; em 100% fica `critical` e a OS vira `open`. A OS
reserva peças e é publicada em uma outbox de ERP simulada. O dashboard mostra os
componentes, as OS ativas e permite concluir a manutenção (resetando o contador).
Endpoints: `GET /api/machines/:id/maintenance`,
`POST /api/maintenance/orders/:id/complete` e
`GET /api/integrations/erp/outbox`.

Para usar um PLC real, o `gateway/` lê ADS, OPC-UA ou Modbus TCP e publica na
mesma API. O adaptador `simulator` permite testar o gateway sem hardware:

```bash
cd gateway && npm install
INDUSTRIAL_PROTOCOL=simulator npm start
```

## Testes

```bash
cd backend/node-api && npm test        # backend
cd gateway && npm test                 # gateway
node --test simulator/line-state.test.js
```

Com o ambiente no ar, o smoke test valida a API de ponta a ponta sem
dependências:

```bash
node scripts/smoke-test.js             # ou: node scripts/smoke-test.js http://localhost:3000
```

O roteiro manual de aceitação está em
[docs/acceptance-test.md](docs/acceptance-test.md).

## Licença

MIT — consulte [LICENSE](LICENSE).
