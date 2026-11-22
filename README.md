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

Ao abrir o dashboard, a tela **Preparando a PI40** aparece primeiro e verifica
API, stream, gateway, CLP, telemetria e banco. Quando todas as verificações
passam, o painel é aberto automaticamente, sem precisar clicar. Se a comunicação
com o CLP falhar, a tela mostra o que conferir (PLC conectado no TwinCAT XAE e
runtime em `Run`) e oferece entrar em modo limitado. O atalho
`INICIAR-PI40.cmd` abre `http://localhost:3000/?boot=1` para forçar a tela de
abertura; um `F5` no mesmo dia volta direto ao painel.

Para encerrar, **desligue a linha física primeiro** e clique em **Encerrar dia**
no topo do painel. O primeiro clique já consulta
`/api/machines/1/connection`: se o CLP estiver sem comunicação, o encerramento é
disparado na hora, sem confirmação adicional. Se ainda houver heartbeat — mesmo
com `running=false` (linha apenas parada) — o modal mostra o bloqueio e continua
verificando a cada 2 s; basta desligar a linha, sem clicar de novo. Ao liberar, a
tela pausa o dashboard, fecha o SSE e aciona o encerramento diretamente: o
backend escreve o pedido em `runtime/system-command.json` (bind mount
compartilhado com o host) e o gateway, rodando como serviço Windows elevado,
dispara `scripts/pi40-dia.ps1 -Action Stop`. O script para o gateway e todos os
containers (`docker compose stop` — nunca `down -v`, para preservar o volume do
banco), confere as amostras persistidas e verifica se sobrou algum processo da
PI40. Nenhum comando é escrito no CLP. Ao concluir, a página
`http://localhost:3000/` é fechada automaticamente. O progresso pode ser
acompanhado em `GET /api/system/status`.

Nenhuma porta é aberta para essa ponte: o container e o host trocam apenas o
arquivo em `runtime/`. O pedido carrega o token `SYSTEM_CONTROL_TOKEN`, o mesmo
definido como `PI40_CONTROL_TOKEN` no XML do serviço, e expira em 60 s. O
endpoint do backend exige ainda o cabeçalho `x-pi40-control: 1` e um `Origin`
local, para impedir que um site externo dispare a ação. Se o acionamento
automático falhar, o modal oferece o atalho `ENCERRAR-PI40.cmd` como alternativa
manual.

Para começar o dia, execute `INICIAR-PI40.cmd` (ou
`powershell -File scripts\pi40-dia.ps1 -Action Start`): ele sobe backend e
PostgreSQL, aguarda `/health`, inicia o serviço `PI40Gateway` e espera o
heartbeat e a telemetria de `Linha-01`. O simulador do Compose permanece parado
enquanto o gateway real estiver ativo.

Unidades produzidas enquanto a PI40 estiver encerrada não são recuperadas por
ADS depois — por isso a linha física precisa estar desligada antes do
encerramento.

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
