# AGENTS.md

Guia para agentes/assistentes que trabalham neste repositório.

## Contexto

Este projeto (`Plaforma_Industrial-4.0`) é derivado de um projeto original de
uma linha de envase industrial.

## Projeto de origem

- **Caminho local:** `C:\Users\rosim\OneDrive\Repositorios\Projeto_Linha_Envase`
- **Repositório:** https://github.com/Rosimar-Lima/Projeto_Linha_Envase.git
- **Documentação detalhada:** [`docs/source-project.md`](docs/source-project.md)

### Regras

- Trate o projeto de origem como **somente leitura**. Não edite nem faça commit
  nele a partir deste repositório.
- Antes de portar código do original, leia `docs/source-project.md` (estrutura,
  símbolos do PLC e mapa de migração).
- Adapte o código ao padrão deste projeto em vez de copiá-lo literalmente.
- Registre decisões de migração em `DECISIONS.md`.

## Estrutura do projeto

| Diretório | Papel |
| --- | --- |
| `simulator/` | Simulador de PLC / geração de telemetria. |
| `gateway/` | Gateway industrial (ADS, OPC-UA, Modbus TCP) para PLCs reais. |
| `backend/node-api/` | API de ingestão, regras e consultas. |
| `dashboard/frontend/` | Dashboard web. |
| `database/` | Schema e configuração do PostgreSQL. |
| `docs/` | Requisitos, indicadores, casos de uso, glossário e origem. |
| `diagrams/` | Diagramas (drawio). |

## Comandos

- Infra local: `docker compose up -d`
- Simulador: `node simulator/plc-simulator.js`
- Backend: `cd backend/node-api && npm install && npm start`
- Testes do backend: `cd backend/node-api && npm test`
- Testes do simulador: `node --test simulator/line-state.test.js`
- Gateway (simulador): `cd gateway && npm install && INDUSTRIAL_PROTOCOL=simulator npm start`
- Testes do gateway: `cd gateway && npm test`
- Dashboard: servido pelo backend em `http://localhost:3000/` (HTML/CSS/JS sem build).
- Tempo real: SSE em `GET /api/stream` (o dashboard usa SSE com fallback para polling).
- Alertas: avaliados na ingestão (limites de envase + linha parada); `GET /api/machines/:id/alerts` e `POST /api/alerts/:id/resolve`.
- Produção por hora/turno: `GET /api/machines/:id/production?bucket=hour|shift` (fuso e turnos em `PLANT_TIMEZONE`, `SHIFT_START_HOUR`, `SHIFT_HOURS`).
- Smoke test (com o ambiente no ar): `node scripts/smoke-test.js`.
