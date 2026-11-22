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

## Inicialização e encerramento do dia

No primeiro acesso do dia, o dashboard abre a tela **Preparando a PI40**. Ela
verifica API, stream, gateway, CLP, telemetria e banco antes de liberar o painel.
Se a comunicação com o CLP falhar, a tela mostra o que conferir (PLC conectado no
TwinCAT XAE e runtime em `Run`) e oferece entrar em modo limitado. A data fica em
`localStorage`, então um `F5` no mesmo dia volta direto ao painel.

Para encerrar, use o botão **Encerrar dia** no topo do painel e confirme. A tela
pausa o dashboard e fecha o SSE, e pede para executar o atalho
`ENCERRAR-PI40.cmd` na raiz do projeto (o Windows solicita confirmação de
administrador). O script `scripts/pi40-dia.ps1 -Action Stop` para o gateway,
confere as amostras persistidas e roda `docker compose stop` — nunca `down -v`,
para preservar o volume do banco. Nenhum comando é escrito no CLP. O progresso
pode ser acompanhado em `GET /api/system/status`.

Para começar o dia, execute `INICIAR-PI40.cmd` (ou
`powershell -File scripts\pi40-dia.ps1 -Action Start`): ele sobe backend e
PostgreSQL, aguarda `/health`, inicia o serviço `PI40Gateway` e espera o
heartbeat e a telemetria de `Linha-01`. O simulador do Compose permanece parado
enquanto o gateway real estiver ativo.

Unidades produzidas enquanto a PI40 estiver encerrada não são recuperadas por
ADS depois — a linha física continua funcionando, apenas a coleta para.

Alertas são gerados na ingestão quando o nível de envase sai dos limites
configurados (`ALERT_FILL_PERCENT_MIN/MAX`) ou quando a linha fica parada além de
`ALERT_STOPPED_MS`. O dashboard exibe os alertas abertos em tempo real e permite
resolvê-los; o histórico fica em `GET /api/machines/:id/alerts?status=all`.

A manutenção preventiva é baseada no uso: válvulas acumulam ciclos de envase ou
tampagem, enquanto rolamento e motor da esteira acumulam **horas com o conveyor
ligado**. Cada componente entra em `warning` ao atingir 80% da vida útil, gerando
uma OS planejada; em 100% fica `critical` e a OS vira `open`. A OS reserva peças
e é publicada em uma outbox de SAP simulada. O dashboard mostra os componentes
com a unidade correta, as OS ativas e permite enviar, cancelar ou concluir a
manutenção (resetando o uso). Endpoints: `GET /api/machines/:id/maintenance`,
`POST /api/maintenance/orders/:id/send`,
`POST /api/maintenance/orders/:id/cancel`,
`POST /api/maintenance/orders/:id/complete` e
`GET /api/integrations/sap/outbox`.

O histórico de produção agrupa os contadores por hora cheia ou por turno da
planta em `GET /api/machines/:id/production?bucket=hour|shift`. Cada intervalo
traz peças produzidas, boas, refugo, tempo operando, tempo parado e
disponibilidade; o painel "Produção por período" no dashboard usa o mesmo
endpoint. Fuso e turnos são configurados por `PLANT_TIMEZONE`,
`SHIFT_START_HOUR` e `SHIFT_HOURS` (padrão: `America/Sao_Paulo`, turnos de 8 h
a partir das 06:00).

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
