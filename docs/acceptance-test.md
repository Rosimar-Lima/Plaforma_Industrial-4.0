# Teste de Aceitação — MVP v0.1.0 (documento histórico)

> **Atenção:** este roteiro registra a aceitação do MVP `v0.1.0`. Algumas
> expectativas refletem a interface daquela versão (por exemplo, o selo
> `Tempo real`/`Polling` e as contagens de testes), removidas ou alteradas
> depois pelas ADR-020, ADR-027 e pela auditoria de 2026-11. Para o estado
> atual, veja [`audit-refactor-2026-11.md`](audit-refactor-2026-11.md) e o
> [README](../README.md). Não renumerar os casos abaixo: eles são a prova do
> kit entregue naquela data.

**Versão avaliada:** `v0.1.0-mvp` (commit de referência no rodapé do documento)  
**Escopo:** validar o MVP acadêmico da Plataforma Industrial 4.0 com dados
simulados, sem PLC real.  
**Público:** avaliador externo, banca ou terceiro que recebeu o kit para testar.

O objetivo é confirmar que a plataforma sobe do zero, recebe telemetria, calcula
indicadores, exibe o dashboard, gera alertas, controla manutenção preventiva e
expõe a integração simulada com SAP — tudo com os comandos documentados.

---

## 1. Pré-requisitos

- Docker Desktop em execução (Docker Compose v2).
- Node.js 20 ou superior (apenas para o smoke test e testes unitários).
- Portas livres: `3000` (backend/dashboard) e `5432` (PostgreSQL).
- Repositório clonado e `.env` criado:

```powershell
cd C:\caminho\para\Plaforma_Industrial-4.0
Copy-Item .env.example .env
```

> O `.env.example` usa `POSTGRES_PASSWORD=change-me`. Para uma demonstração
> local, qualquer valor funciona; não reutilize essas credenciais fora do
> ambiente de teste.

## 2. Subida do ambiente

```powershell
docker compose up -d --build
docker compose ps
```

**Esperado:** três serviços `running`; `postgres` e `backend` com status
`healthy`. O dashboard fica em `http://localhost:3000/`.

Se algo falhar:

```powershell
docker compose logs --tail 50 postgres backend simulator
```

## 3. Parte A — Smoke test automatizado

Com o ambiente no ar, execute:

```powershell
node scripts/smoke-test.js
# ou, para outra URL:
node scripts/smoke-test.js http://localhost:3000
```

O script não tem dependências e valida:

| Verificação | Esperado |
| --- | --- |
| `GET /health` | `200` com `status: ok` |
| `GET /api/machines` | `200` com pelo menos uma máquina |
| `GET /api/machines/:id/telemetry` | `200` com amostras |
| `POST /api/telemetry` válido | `202` e amostra persistida |
| `POST /api/telemetry` inválido | `400` com erro de intertravamento EV |
| `GET /api/machines/:id/oee` | `200` com indicadores entre 0 e 1 |
| `GET /api/machines/:id/production` | `200` com intervalos e totais |
| `GET /api/machines/:id/alerts` | `200` com histórico |
| `GET /api/machines/:id/maintenance` | `200` com componentes e OS |
| `GET /api/integrations/sap/outbox` | `200` com eventos |
| `GET /` | `200` com HTML do dashboard |
| `GET /api/stream` | evento `ready` recebido |

**Esperado:** todas as verificações `OK` e saída final
`12/12 verificações OK`. O código de saída é `0` em sucesso e `1` em falha,
permitindo uso em CI.

> O smoke test grava uma amostra de telemetria por execução. Isso é intencional:
> comprova a ingestão de ponta a ponta.

## 4. Parte B — Roteiro manual

Execute os cenários na ordem. Cada um tem passos e resultado esperado.

### AT-01 — Dashboard em tempo real

1. Abra `http://localhost:3000/`.
2. Observe o selo de conexão no topo.
3. Aguarde alguns segundos.

**Esperado:** selo `Tempo real`; etapa da linha, contadores de envase/tampagem e
gráfico mudando sem recarregar a página. Se o SSE cair, o selo passa para
`Polling` e o dashboard continua atualizando a cada 3 s.

### AT-02 — OEE, histórico de produção e filtros de período

1. Selecione um período no filtro (por exemplo, últimas 24 h).
2. Compare os valores de disponibilidade, performance, qualidade e OEE.
3. No painel **Produção por período**, alterne o agrupamento entre **Hora** e
   **Turno** e confira a tabela.
4. Compare o total produzido do painel com o campo **Produzidas** do OEE.

**Esperado:** valores percentuais entre 0% e 100%; OEE = disponibilidade ×
performance × qualidade (dentro do arredondamento); o gráfico respeita o período
selecionado. A tabela mostra um intervalo por hora ou por turno (turnos de 8 h
a partir das 06:00, fuso `America/Sao_Paulo`), com produzidas, boas, refugo,
tempo operando, tempo parado e disponibilidade. A soma dos intervalos coincide
com o total do OEE, e o intervalo atual aparece destacado.

### AT-03 — Ingestão inválida é rejeitada

```powershell
$payload = @{
  machineId = 'Linha-01'
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  line = @{
    step = 2; running = $true; conveyorOn = $true; evOn = $true; atOn = $false
    sensorS1 = $true; sensorS2 = $false; bottlePositioned = $false
    evInterlock = $false; atInterlock = $false; fillPercent = 50
  }
  production = @{ filled = 1; capped = 0; total = 1 }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://localhost:3000/api/telemetry -Method Post `
  -ContentType 'application/json' -Body $payload
```

**Esperado:** `400` com `error: invalid_payload` e a mensagem
`line.evOn exige line.bottlePositioned`. Nenhuma amostra nova deve aparecer no
histórico.

### AT-04 — Alerta de envase

1. Pare o ambiente e ajuste o limite no `.env`:
   `ALERT_FILL_PERCENT_MIN=70`
2. Suba novamente: `docker compose up -d --force-recreate backend simulator`.
3. Abra o dashboard e aguarde a etapa de envase.

**Esperado:** alerta de nível de envase abaixo do mínimo, com severidade e
mensagem legíveis; o alerta aparece na lista em tempo real. Use **Resolver** no
dashboard e confirme que ele sai da lista de abertos e permanece no histórico
(`GET /api/machines/1/alerts?status=all`).

Ao final, restaure `ALERT_FILL_PERCENT_MIN=0` e recrie o backend.

### AT-05 — Alerta de linha parada

1. Configure `ALERT_STOPPED_MS=5000` no `.env` e recrie backend e simulador.
2. Envie `stop` para o simulador:

```powershell
docker attach industrial-simulator
# digite: stop
# saia sem derrubar o processo: Ctrl+P, Ctrl+Q
```

**Esperado:** após ~5 s sem amostras em operação, surge o alerta de linha
parada. Envie `start` para o simulador e confirme que a condição normaliza.

Restaurare `ALERT_STOPPED_MS=60000` ao final.

### AT-06 — Manutenção preventiva

1. No dashboard, localize o painel de manutenção preventiva.
2. Verifique a vida útil dos componentes (`conveyor-bearing`, `conveyor-motor`,
   `fill-valve`, `cap-valve`).

**Esperado:** componentes com percentual de uso, uso restante e status
`ok`/`warning`/`critical`. `fill-valve` e `cap-valve` mostram uso em **ciclos**;
`conveyor-bearing` e `conveyor-motor` mostram uso em **horas** (`h`) acumuladas
com o conveyor ligado. Componentes acima de 80% têm OS `planned`; em 100% a OS
fica `open`. A OS mostra peças reservadas e o evento enviado ao SAP simulado.

3. Clique no número de uma OS ativa (ex.: `#3`).

**Esperado:** abre um formulário com número, máquina, componente, status,
prioridade, uso na origem (em ciclos ou horas, conforme o componente), peças
reservadas, ID/evento/envio SAP e datas da ordem, com os botões **Enviar para
manutenção**, **Cancelar ordem** e **Fechar**.

4. Clique em **Enviar para manutenção**.

**Esperado:** o modal fecha, a OS passa a `in_progress` (`Em execução`) e o
evento `maintenance_order.sent` aparece na outbox SAP. O botão de envio fica
desabilitado se a OS já estiver em execução.

5. Abra novamente a OS e clique em **Cancelar ordem**.

**Esperado:** a OS sai da lista de ativas (status `cancelled`) e o evento
`maintenance_order.cancelled` aparece na outbox SAP. Se a condição de uso
persistir, uma nova OS é criada na próxima telemetria.

6. Clique em **Concluir** em uma OS ativa.

**Esperado:** a OS passa a `completed`, o contador do componente é zerado, o
status volta para `ok` e o alerta `maintenance.*` correspondente é resolvido.

> Em um banco recém-criado, o cenário de manutenção leva alguns minutos de
> telemetria para aparecer, porque os contadores partem dos valores iniciais de
> `backend/node-api/config/maintenance.json`.

### AT-07 — Outbox de SAP simulada

```powershell
Invoke-RestMethod http://localhost:3000/api/integrations/sap/outbox?limit=20
```

**Esperado:** eventos `maintenance_order.created`, `maintenance_order.sent` e
`maintenance_order.cancelled` (conforme as ações executadas em AT-06), com
`external_id` igual ao número de controle do componente — 7 dígitos, sem
prefixo: `1001011` rolamento, `1001012` motor, `1001013` válvula de envase e
`1001014` válvula de tampagem —, status `sent` e payload com os dados da OS.

### AT-08 — Gateway no modo simulador

Em outro terminal, sem parar o Compose:

```powershell
cd gateway
npm install
$env:INDUSTRIAL_PROTOCOL = 'simulator'
npm start
```

**Esperado:** o gateway publica telemetria na mesma API (`202` no log do
backend) e o dashboard continua funcionando. O gateway não substitui o
simulador do Compose; para testar isoladamente, pare o serviço `simulator`:

```powershell
docker compose stop simulator
# rode o gateway, depois:
docker compose start simulator
```

### AT-09 — Persistência após reinício

1. Anote o total de amostras de `GET /api/machines/1/telemetry?limit=1`.
2. Reinicie o backend: `docker compose restart backend`.
3. Consulte novamente.

**Esperado:** o histórico continua disponível; nenhuma amostra é perdida, pois
os dados ficam no volume `postgres-data`.

### AT-10 — Testes unitários

```powershell
cd backend/node-api
npm install
npm test

cd ../../gateway
npm test

cd ..
node --test simulator/line-state.test.js
```

**Esperado:** backend com 53 testes, gateway com 21 e simulador com 6, todos
passando (números de referência do commit avaliado).

## 5. Critérios de aceite

| Requisito | Cenário que comprova |
| --- | --- |
| RF-01 — telemetria periódica | AT-01, Parte A |
| RF-02 — receber e validar telemetria | AT-03, Parte A |
| RF-03 — persistir amostras | AT-09, Parte A |
| RF-04 — disponibilidade, performance e qualidade | AT-02, Parte A |
| RF-05 — OEE consolidado | AT-02, Parte A |
| RF-06 — dashboard em tempo quase real | AT-01 |
| RF-07 — consultar histórico por período | AT-02 |
| RF-08 — alertas por limites | AT-04, AT-05 |
| RNF-01 — dashboard em menos de 5 s | AT-01 |
| RNF-03 — ambiente reproduzível | Seção 2 |
| RNF-04 — API documentada | `docs/openapi.yaml` |

O MVP é considerado **aceito** quando a Parte A passa por completo e os cenários
AT-01, AT-02, AT-03, AT-04 e AT-06 apresentam o resultado esperado. AT-05,
AT-07, AT-08, AT-09 e AT-10 são complementares.

## 6. Registro de execução

| Cenário | Resultado | Observações |
| --- | --- | --- |
| Parte A — smoke test | | |
| AT-01 | | |
| AT-02 | | |
| AT-03 | | |
| AT-04 | | |
| AT-05 | | |
| AT-06 | | |
| AT-07 | | |
| AT-08 | | |
| AT-09 | | |
| AT-10 | | |

**Avaliador:** ______________________  
**Data:** ______________________  
**Ambiente:** Windows / Linux / macOS — Docker ______ / Node ______

## 7. Limitações conhecidas

- Gateway validado apenas com o adaptador `simulator`; ADS, OPC-UA e Modbus TCP
  ainda não foram testados com PLC real.
- Sem autenticação, TLS, backup automático ou observabilidade.
- O schema é aplicado na criação do volume; não há migrações versionadas.
- Painel consolidado de OEE multi-máquina ainda não existe.
- O histórico de produção deriva o tempo parado da ausência de amostras em
  operação; quedas longas do backend podem inflar esse tempo.
- A manutenção é preventiva por uso (contadores), não preditiva.

## 8. Como reportar problemas

Abra uma issue usando o template **Bug report** em `.github/ISSUE_TEMPLATE/` e
inclua:

- cenário (AT-xx) e passos para reproduzir;
- resultado observado e esperado;
- saída de `docker compose ps` e `docker compose logs --tail 50 backend`;
- versão do commit (`git rev-parse --short HEAD`) e sistema operacional.

---

_Commit de referência: preencher ao publicar a tag `v0.1.0-mvp`._
