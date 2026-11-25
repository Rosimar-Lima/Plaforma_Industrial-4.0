# Registro de Decisões de Arquitetura (ADR)

Este documento registra as decisões arquiteturais relevantes da Plataforma Industrial 4.0 (PI40).

Formato:

- Contexto
- Decisão
- Consequências

---

# ADR-001 — Separação entre Linha de Envase e Plataforma Industrial

**Status:** Aceita

**Contexto:**

A Linha de Envase desenvolvida anteriormente já possui sua própria arquitetura de controle composta por PLC TwinCAT, comunicação ADS, gateway Node.js e IHM operacional.

**Decisão:**

A Plataforma Industrial 4.0 será desenvolvida como um sistema independente da Linha de Envase.

**Consequências:**

- Separação entre sistema de controle e sistema de monitoramento.
- A plataforma poderá evoluir sem modificar a linha de produção.
- Falhas da plataforma não interrompem a operação da máquina.
- A arquitetura fica mais próxima de ambientes industriais reais.

---

# ADR-002 — Plataforma somente para monitoramento

**Status:** Aceita

**Contexto:**

Sistemas de Indústria 4.0 normalmente atuam em camadas superiores de supervisão, análise e tomada de decisão.

**Decisão:**

A Plataforma Industrial 4.0 não enviará comandos operacionais para o PLC.

A plataforma apenas:

- coleta dados
- armazena dados
- processa indicadores
- gera dashboards
- produz relatórios

**Consequências:**

- Menor risco operacional.
- Menor acoplamento entre sistemas.
- Maior segurança.
- Facilidade para homologação e demonstração.

---

# ADR-003 — Suporte a PLC Real e Simulado

**Status:** Aceita

**Contexto:**

Nem sempre haverá acesso ao PLC TwinCAT durante o desenvolvimento ou durante apresentações para a banca.

**Decisão:**

O sistema deverá operar em dois modos:

### Modo Simulação

Utiliza um PLC Simulado executado localmente.

### Modo Produção

Utiliza um PLC TwinCAT real através do gateway industrial.

**Consequências:**

- Desenvolvimento independente de hardware.
- Facilidade de demonstração para banca avaliadora.
- Facilidade de testes automatizados.
- Maior portabilidade do projeto.

---

# ADR-004 — Simulador separado do backend

**Status:** Aceita

**Contexto:**

O simulador deve ser substituído futuramente pelo PLC real sem impacto na arquitetura principal.

**Decisão:**

Manter o simulador em um componente independente localizado em:

```text
simulator/
```

O simulador se comunica com o backend pela mesma interface prevista para o PLC
real, permitindo trocar a fonte de dados sem alterar a plataforma.

**Consequências:**

- O backend não conhece detalhes do simulador nem do PLC real.
- A troca entre simulação e produção é feita por configuração.
- O simulador pode evoluir e ser testado isoladamente.

---

# ADR-005 — Simulador reproduz o ciclo do PLC original

**Status:** Aceita

**Contexto:**

O projeto original controla a linha em `PLC/MAIN.st`, com etapas, tempos e
intertravamentos bem definidos (EV e AT). A plataforma precisa gerar telemetria
realista antes de integrar um PLC real.

**Decisão:**

Modelar o ciclo em `simulator/line-state.js`, reproduzindo as etapas 0–3, os
tempos do `MAIN.st` e os intertravamentos da EV/AT. O driver em
`simulator/plc-simulator.js` apenas executa o ciclo e publica a telemetria.

**Consequências:**

- Telemetria coerente com o comportamento real da linha.
- Lógica de simulação testável isoladamente:
  `node --test simulator/line-state.test.js`.
- O modelo pode ser substituído por um adaptador OPC-UA/ADS no futuro.

---

# ADR-006 — API de ingestão em Node.js, Express e PostgreSQL

**Status:** Aceita

**Contexto:**

A plataforma precisa receber telemetria do simulador (e futuramente do PLC
real), validar o payload e persistir as amostras com segurança.

**Decisão:**

Implementar a API em `backend/node-api/` com:

- Express para HTTP e `express.json` para o corpo da requisição.
- Validação explícita em `src/validation.js`, incluindo os intertravamentos da
  EV/AT (`evOn` exige `bottlePositioned`; `atOn` exige `sensorS2`).
- Repositório em `src/repository.js` com `pg`, transação por amostra e criação
  automática da máquina (`machines.code`) via `INSERT ... ON CONFLICT`.
- `POST /api/telemetry` retornando `202` para amostras aceitas.

**Consequências:**

- Payload inválido é rejeitado com `400` e lista de erros, sem gravar dados.
- A ingestão é transacional: telemetria e produção são gravadas juntas.
- O simulador e o PLC real compartilham o mesmo contrato de entrada.
- O serviço roda localmente via `npm start` ou no Docker Compose.

---

# ADR-007 — Cálculo de OEE a partir da telemetria

**Status:** Aceita

**Contexto:**

A telemetria publicada pelo simulador já contém o estado da linha
(`line.running`) e os contadores cumulativos de produção (`production.filled` e
`production.total`). A plataforma precisa derivar disponibilidade, performance,
qualidade e OEE sem depender de dados adicionais do PLC.

**Decisão:**

Calcular os indicadores em `src/indicators.js` a partir das amostras do período:

- Disponibilidade = tempo com `running = true` entre amostras / duração do
  período.
- Performance = (produção do período) / (capacidade nominal × horas operando),
  limitada a 1.
- Qualidade = peças boas / peças produzidas, limitada a 1.
- OEE = disponibilidade × performance × qualidade.
- Produção do período = `última amostra - primeira amostra` (contadores
  cumulativos); quedas de contador são tratadas como zero.

A capacidade nominal é configurável por `NOMINAL_CAPACITY_PER_HOUR` (padrão
`400`) ou pelo parâmetro `nominalCapacityPerHour` na consulta.

**Consequências:**

- OEE derivado apenas dos dados já ingeridos, sem novo contrato de entrada.
- A capacidade nominal pode ser ajustada sem alterar o código.
- A janela sem amostras suficientes retorna indicadores zerados.

---

# ADR-008 — Dashboard estático servido pelo backend

**Status:** Aceita

**Contexto:**

O dashboard precisa consumir a mesma origem da API, sem introduzir etapa de
build ou dependências de frontend para a demonstração e avaliação.

**Decisão:**

Implementar o dashboard em `dashboard/frontend/` com HTML/CSS/JS puro e servi-lo
pelo Express via `express.static`, configurável por `DASHBOARD_DIR`.

- Atualização por polling: telemetria a cada 3 s e OEE a cada 15 s.
- O gráfico é desenhado em `canvas`, sem bibliotecas externas.
- O contrato consumido é o documentado em `docs/openapi.yaml`.

**Consequências:**

- Nenhuma dependência ou build adicional no frontend.
- Mesma origem da API, sem CORS.
- A troca para SSE/WebSocket pode ser feita depois sem alterar a API existente.

---

# ADR-009 — Tempo real via SSE com fallback de polling

**Status:** Aceita

**Contexto:**

O dashboard precisa refletir a telemetria assim que ela é ingerida, mantendo a
operação simples e sem dependências adicionais.

**Decisão:**

Expor `GET /api/stream` no formato Server-Sent Events (SSE).

- O hub em `src/stream.js` mantém os clientes conectados e envia `event: ready`
  na conexão e `event: telemetry` a cada amostra ingerida.
- Heartbeat (`: keep-alive`) periódico e `retry` orientam a reconexão.
- A amostra é publicada somente após o `INSERT` transacional ser concluído.
- O dashboard usa `EventSource` e, se o stream cair, volta ao polling de 3 s;
  o selo de conexão indica `Tempo real`, `Polling` ou `Offline`.

**Consequências:**

- Baixa latência sem WebSocket nem bibliotecas adicionais.
- Funciona com HTTP/1.1 e atrás de proxies que suportem streaming.
- Clientes lentos são descartados no momento da escrita, sem bloquear a
  ingestão.

---

# ADR-010 — Alertas avaliados na ingestão

**Status:** Aceita

**Contexto:**

RF-08 e UC-04 exigem alertas quando leituras excedem limites, além de histórico
e notificação no dashboard. A avaliação precisa ser simples, determinística e
não comprometer a persistência da telemetria.

**Decisão:**

Avaliar alertas durante a ingestão, na mesma transação da telemetria, com
`SAVEPOINT` para que falhas na avaliação não desfaçam a amostra.

- Limites de envase configuráveis por `ALERT_FILL_PERCENT_MIN`/`MAX`, avaliados
  apenas na etapa de envase (etapa 2).
- Alerta de linha parada após `ALERT_STOPPED_MS` desde a última amostra com
  `running = true`.
- No máximo um alerta aberto por máquina/sensor; a normalização da condição
  resolve automaticamente. Resolução manual via `POST /api/alerts/:id/resolve`.
- Criação e resolução publicam `event: alert` no SSE.

**Consequências:**

- Sem job/agendador adicional; o estado é derivado da telemetria.
- Histórico permanece em `alerts` (aberto/resolvido) para consulta.
- A deduplicação é garantida por `NOT EXISTS` na transação; uma restrição única
  parcial poderia ser adicionada se houver ingestão concorrente intensa.

---

# ADR-011 — Gateway industrial desacoplado e multi-protocolo

**Status:** Aceita

**Contexto:**

A Fase 4 exige ler PLCs reais por TwinCAT ADS, OPC-UA e Modbus TCP sem alterar a
API de ingestão. Cada protocolo tem biblioteca, configuração e ciclo de conexão
próprios, e o gateway deve rodar próximo ao equipamento (edge), não no servidor
central.

**Decisão:**

Criar `gateway/` com um núcleo independente de protocolo e adaptadores
intercambiáveis.

- O núcleo lê valores, normaliza para o contrato de telemetria e publica em
  `POST /api/telemetry`.
- Adaptadores: `ads` (`ads-client`), `opcua` (`node-opcua`), `modbus`
  (`modbus-serial`) e `simulator` (reutiliza `simulator/line-state.js`).
- Bibliotecas de protocolo são `optionalDependencies`; o gateway só exige a do
  protocolo configurado.
- Reconexão em falha de leitura/conexão e novas tentativas para `5xx`/rede na
  publicação; `4xx` não é repetido.
- O mapa de símbolos fica em `plc.config.json` (ADS/OPC-UA) ou
  `modbus.config.json` (registradores).

**Consequências:**

- Backend e dashboard permanecem inalterados; o gateway é mais um publicador.
- É possível testar o fluxo completo com `INDUSTRIAL_PROTOCOL=simulator`.
- O gateway pode ser executado no host/edge junto ao PLC, sem entrar no Docker
  Compose central.
- A etapa (`step`) é opcional no mapa e estimada quando o PLC não a expõe;
  recomenda-se expô-la no GVL para maior precisão.

---

# ADR-012 — Manutenção preventiva baseada em uso e SAP simulado

**Status:** Aceita

**Contexto:**

O MVP precisa demonstrar manutenção sem depender de sensores de vibração,
temperatura ou de um SAP real. A plataforma é somente de monitoramento
(ADR-002) e não deve enviar comandos ao PLC.

**Decisão:**

Modelar manutenção preventiva a partir dos contadores de produção já ingeridos.

- Cada componente virtual declara `metric`, `source`, vida útil e peças de
  reposição em `backend/node-api/config/maintenance.json` (ADR-017 detalha as
  unidades por tipo de componente).
- O uso é acumulado em `component_usage`; ao atingir `warnRatio` (padrão 80%) o
  componente entra em `warning`, e em 100% em `critical`.
- A ingestão gera alerta (`maintenance.<componente>`) e garante uma única OS
  ativa por componente, com status `planned` (warning) ou `open` (critical).
- A OS reserva peças em `maintenance_order_parts` e publica o evento
  `maintenance_order.created` em `sap_outbox`, simulando a integração com SAP.
- Concluir a OS (`POST /api/maintenance/orders/:id/complete`) reseta o contador
  do componente e resolve o alerta correspondente.
- Os ciclos iniciais da configuração são calibrados para a demonstração; em
  produção devem iniciar em zero.

**Consequências:**

- Nenhum hardware ou SAP adicional é necessário para a demo.
- A regra é determinística e testável com os contadores existentes.
- A troca da outbox simulada por um SAP real fica isolada em
  `sap_outbox`/webhook.
- A manutenção é preventiva (baseada em uso), não preditiva.
- Os status `in_progress` e `cancelled` foram acrescentados depois (ADR-016).

---

# ADR-013 — Histórico de produção por hora/turno com fuso da planta

**Status:** Aceita

**Contexto:**

As fases 2 e 3 exigem produção por hora e por turno, tempo operando/parado e
histórico no dashboard. As amostras são gravadas em UTC, mas a planta opera em
fuso local e os turnos precisam de limites estáveis e configuráveis.

**Decisão:**

Calcular os intervalos em `backend/node-api/src/production.js` a partir das
amostras já persistidas:

- agrupamento por hora cheia ou por turno (`bucket=hour|shift`);
- fuso em `PLANT_TIMEZONE` (padrão `America/Sao_Paulo`) e turnos em
  `SHIFT_START_HOUR`/`SHIFT_HOURS` (padrão 06:00, 8 h);
- a produção do intervalo é atribuída ao bucket da amostra final; contadores
  que diminuem são tratados como reset (zero);
- tempo operando = sobreposição dos intervalos com `line.running = true`,
  limitada à janela pedida; o restante é tempo parado;
- endpoint `GET /api/machines/:id/production` e painel "Produção por período"
  no dashboard, atualizado a cada 15 s.

**Consequências:**

- Nenhuma tabela nova: o histórico é derivado da telemetria existente.
- Consultas longas são limitadas a 1000 intervalos (`range_too_large`).
- O cálculo usa o fuso da planta, não o do navegador.
- Períodos sem telemetria aparecem como tempo parado; uma queda longa do
  backend pode inflar esse tempo, o que é aceitável no MVP e deve ser
  observado em produção.

---

# ADR-014 — Gráfico de volume envasado no dashboard

**Status:** Aceita

**Contexto:**

O gráfico do dashboard mostrava `line.fillPercent`, o nível instantâneo do
tanque, que não representa a produção de bebida. O projeto não especificava o
volume da garrafa; a planta usa long neck de 300 ml.

**Decisão:**

Substituir o gráfico por `volume envasado acumulado`:

- a cada amostra, usar o contador `production.filled` (envasadas);
- converter para litros com `BOTTLE_VOLUME_ML = 300` no frontend;
- acumular deltas entre amostras; contadores que diminuem são tratados como
  reset (delta zero), mesma regra do OEE e do histórico de produção;
- o eixo Y passa a ser litros, com escala automática, e o cabeçalho exibe o
  total das últimas amostras.

**Consequências:**

- Nenhuma mudança de payload, schema ou endpoint: o gráfico continua usando a
  telemetria já recebida via SSE/polling.
- O volume é uma convenção do dashboard; se a planta mudar o tamanho da garrafa,
  basta alterar `BOTTLE_VOLUME_ML` (ou torná-lo configurável depois).
- O valor é o volume acumulado desde a origem do contador, não o volume da
  janela de tempo selecionada no filtro de período.

---

# ADR-015 — Nomenclatura SAP para a integração simulada

**Status:** Aceita

**Contexto:**

A integração simulada de manutenção era chamada genericamente de ERP. O sistema
corporativo adotado pela planta é SAP, e o código, a API e os documentos devem
usar o mesmo nome.

**Decisão:**

Renomear toda a superfície da integração de ERP para SAP:

- endpoint `GET /api/integrations/sap/outbox` (antes `/erp/outbox`);
- tabela `sap_outbox` e índice `idx_sap_outbox_order`;
- métodos `insertSapOutbox` / `listSapOutbox` e campo `sap` nos pedidos de
  manutenção (antes `erp`);
- prefixo `SAP-<id>-<sufixo>` nos IDs externos e chave `sapOrderId` no payload;
- textos, ADR-012 e documentação atualizados.

**Consequências:**

- Clientes que chamavam a rota antiga precisam ser atualizados; não mantenhamos
  alias para evitar manter duas nomenclaturas.
- Volumes antigos exigem `database/migrations/001_rename_erp_to_sap.sql`; o
  schema novo já cria `sap_outbox`.
- Eventos antigos têm IDs e payloads convertidos pela migração.

---

# ADR-016 — Detalhe e ações da ordem de serviço no dashboard

**Status:** Aceita

**Contexto:**

A tabela de OS do dashboard só permitia concluir a ordem. O número da OS não
era clicável e não havia uma tela com as informações completas da ordem nem
a possibilidade de enviá-la para manutenção ou cancelá-la.

**Decisão:**

Abrir um modal ao clicar no número da OS ativa, com todos os dados disponíveis
(número, máquina, componente, status, prioridade, ciclos na origem, peças
reservadas, ID/evento/envio SAP e datas de criação, previsão, atualização e
conclusão) e três ações: **Enviar para manutenção**, **Cancelar ordem** e
**Fechar**.

- `POST /api/maintenance/orders/:id/send` → status `in_progress` + evento
  `maintenance_order.sent` na outbox SAP.
- `POST /api/maintenance/orders/:id/cancel` → status `cancelled` + evento
  `maintenance_order.cancelled` na outbox SAP.
- `POST /api/maintenance/orders/:id/complete` permanece como conclusão, com
  consumo de peças e reset do contador do componente.
- Transições só valem para OS ativas (`planned`, `open`, `in_progress`); o
  modal desabilita ações já aplicáveis (envio em `in_progress`).
- O modal fecha com o botão Fechar, com o backdrop ou com `Esc`, e também é
  fechado automaticamente se a OS deixar de aparecer na lista (ex.: conclusão
  pela ação da tabela).

**Consequências:**

- Nenhuma tabela nova: os status cabem na coluna `VARCHAR(20)` existente e a
  unique index de OS ativa continua cobrindo `planned`/`open`/`in_progress`.
- Cancelar uma OS permite que a próxima telemetria gere uma nova OS para o
  mesmo componente, se a condição de uso persistir.
- Histórico de envio/cancelamento fica registrado na outbox SAP, sem alterar o
  contrato de leitura `GET /api/machines/:id/maintenance`.
- O modal é apenas uma camada de UI; qualquer cliente pode chamar as rotas
  diretamente.
- IDs de OS são convertidos para inteiro na API (o `pg` devolve `BIGINT` como
  string) e o dashboard compara IDs como string, para que o clique no número
  abra o modal mesmo se um cliente receber o ID em texto.

---

# ADR-017 — Desgaste por horas na esteira e por ciclos nas válvulas

**Status:** Aceita

**Contexto:**

O modelo inicial media todos os componentes por contadores de produção
(`filled`, `capped`, `total`). Isso é razoável para válvulas de envase e
tampagem, mas não para rolamento e motor da esteira: eles desgastam pelo tempo
em que o conveyor está acionado, não pela quantidade de garrafas.

**Decisão:**

Diferenciar o critério de uso por componente em
`backend/node-api/config/maintenance.json`:

- `metric: "cycles"` (padrão, válvulas): uso é o delta do contador de produção,
  com `mtbfCycles`/`initialCycles`.
- `metric: "hours"` (rolamento e motor): uso é a soma dos intervalos entre
  amostras em que `source: "conveyor"` (`line.conveyorOn = true`) estava ativo,
  com `mtbfHours`/`initialHours`. Também é aceito `source: "running"` para
  componentes que desgastam com a linha ligada.
- O intervalo só conta quando a amostra anterior indicava acionamento ligado e
  é limitado a 1 hora, para não transformar paradas longas em desgaste.
- `timeScale` acelera o relógio virtual: `60` significa 1 s real = 1 min virtual.
  O padrão é `1` (tempo real); no demo, rolamento e motor usam `60` para que o
  uso seja perceptível sem alterar a unidade `h`.
- `component_usage` ganha `hours`, `last_timestamp` e `last_active`; a coluna
  `cycles` continua para as válvulas. `hours` e `source_usage` usam 6 casas
  decimais para não perder incrementos de amostras de 1 s.
- `maintenance_orders.source_cycles` passa a ser `source_usage` (numérico), com
  a unidade resolvida pelo componente.
- A API devolve `metric`, `source`, `usage`, `mtbf`, `remaining` e `unit` em vez
  dos antigos `cycles`/`mtbfCycles`/`remainingCycles`.
- O dashboard exibe `ciclos` ou `h` conforme `unit`, inclusive no detalhe da OS.

**Consequências:**

- O limiar de 80%/100% continua igual; muda apenas o que é acumulado.
- Em instalações novas o schema já traz as colunas. Volumes antigos aplicam
  `002_maintenance_hours.sql` e, se já estavam nesse modelo, a migração de
  precisão `003_maintenance_hours_precision.sql`. Linhas sem `last_timestamp`
  são inicializadas com `initialHours`/`initialCycles` na primeira telemetria.
- Clientes que liam `cycles`/`mtbfCycles` devem migrar para `usage`/`mtbf`;
  não mantivemos alias para evitar ambiguidade de unidade.
- O uso por horas depende da periodicidade da telemetria e de `timeScale`. Com
  amostras a cada 1 s e `timeScale: 60`, o rolamento evolui cerca de 0,01 h a
  cada 12 s de conveyor ligado; os valores iniciais calibram a demonstração
  (rolamento já em 80%, motor em 60%).
- O reset ao concluir a OS zera `hours` para componentes de horas e `cycles`
  para os de ciclos.

---

# ADR-018 — Integração ADS com a Linha de Envase em somente leitura

**Status:** Aceita

**Contexto:**

A Linha de Envase original expõe seus símbolos pelo TwinCAT/ADS. O gateway da
PI40 precisa ler esse estado para refletir a operação real da linha. O projeto
de origem também possui símbolos de comando (`bCmdStart`, `bCmdStop`,
`bCmdReset`), que não fazem parte da responsabilidade da plataforma conforme a
ADR-002.

A conexão confirmada para o ensaio é `39.90.64.65.1.1:851`, com o gateway
executando no mesmo host do TwinCAT. O `ads-client` devolve o resultado de
`readValue()` como `{ value, rawValue, dataType, symbol }`; usar esse objeto
diretamente zerava a telemetria no mapeamento da PI40.

**Decisão:**

- O adaptador ADS da PI40 apenas lê símbolos. Nenhum comando de start, stop ou
  reset será escrito no CLP.
- `readValue()` é desembrulhado: o gateway extrai `result.value` quando o retorno
  for um objeto de leitura, mantendo compatibilidade com leituras escalares.
- Após conectar (e após cada reconexão), o adaptador chama `cacheSymbols()` e
  `cacheDataTypes()`, como no projeto de origem, para evitar consulta de
  metadados a cada amostra.
- O mapa de símbolos permanece em `gateway/plc.config.json`, com os nomes
  originais `GVL_HMI.*`.
- A telemetria gerada pelo gateway continua usando o contrato já validado de
  `POST /api/telemetry`; nenhuma alteração de contrato é necessária no backend.
- Qualquer mudança futura que permita escrita no CLP exige uma nova ADR que
  revogue esta e a ADR-002.

**Consequências:**

- A PI40 não pode parar, iniciar ou reiniciar a linha; a operação permanece na
  IHM original.
- A causa raiz da telemetria zerada está eliminada, inclusive em leituras de
  booleanos, contadores e versão do PLC.
- A conexão real depende de rota ADS válida e do runtime do TwinCAT. Falta de
  resposta deve ser tratada como **sem comunicação**, não como "linha parada".
- O diagnóstico de símbolos pode ser feito sem publicar dados no backend.

---

# ADR-019 — Produção acumulada resistente ao reset da linha

**Status:** Aceita

**Contexto:**

O usuário confirmou que, ao resetar a Linha de Envase, os contadores
`nBottlesFilled`, `nBottlesCapped` e `nProductionTotal` voltam a zero. A PI40
deve continuar exibindo o contador atual zerado, sem apagar a produção já
registrada. O código anterior tratava queda de contador apenas como delta zero
no OEE, no histórico por hora/turno e na manutenção, mas não mantinha um total
acumulado explícito nem registrava o reset como evento.

**Decisão:**

- Criar a tabela `production_totals`, com `accumulated_produced`,
  `accumulated_good`, `last_counter`, `last_good_counter`, `last_reset_at` e
  `updated_at`, uma linha por máquina.
- A cada amostra:
  - se os contadores atuais forem maiores ou iguais aos anteriores, somar apenas
    o delta ao acumulado;
  - se qualquer contador diminuir, manter o acumulado, registrar `last_reset_at`
    e emitir o evento `production.reset`;
  - atualizar os últimos contadores para os valores atuais, mesmo após reset.
- O histórico em `telemetry` e `production` permanece intacto. Nenhuma linha
  antiga é apagada ou reescrita.
- A API expõe `GET /api/machines/:id/production/total` e publica eventos SSE
  `production` com `action: 'update' | 'reset'`.
- O dashboard mostra o contador atual da linha e, separadamente, o **acumulado
  no banco**; o reset é visível no título do card.
- Volumes existentes aplicam `database/migrations/004_production_totals.sql`,
  que inicializa o acumulado com o último contador conhecido do histórico.

**Consequências:**

- Reset da linha não zera a produção acumulada da PI40, nem distorce OEE,
  histórico por hora/turno ou manutenção por ciclos.
- A primeira amostra após um reset pode chegar com `0`; ela é aceita e passa a
  ser a nova base dos deltas.
- Como a tabela é por máquina e a ingestão usa `FOR UPDATE` na transação,
  amostras concorrentes não perdem incrementos.
- Eventos `production.reset` permitem montar, no futuro, um histórico de resets
  sem consultar o payload bruto.
- Esta decisão não altera o contrato de `POST /api/telemetry`.

---

# ADR-020 — Estado de comunicação da linha no dashboard

**Status:** Aceita

**Contexto:**

Com a telemetria real ativa, o gateway publica amostras somente quando consegue
ler o CLP. Se o ADS cair ou o TwinCAT desligar, o backend para de receber dados,
mas o dashboard continuava exibindo a última amostra — sem distinguir **linha
parada** (`bRunning = false`, com o CLP respondendo) de **sem comunicação**.

**Decisão:**

- O gateway publica um heartbeat leve em `POST /api/gateway/status` a cada ciclo
  de polling, com `connected`, `running`, `lastReadAt`, `timestamp`, `failures` e
  `error`. O status é enviado mesmo quando a leitura falha.
- O backend rastreia o heartbeat em memória (`createConnectionTracker`) e
  considera a conexão expirada após 10 s sem sinal. Um `sweep` periódico emite
  `connection.lost` quando o gateway para sem avisar.
- A API expõe `GET /api/machines/:id/connection`, resolvendo o código da máquina
  (`Linha-01`) a partir do id numérico da URL.
- O stream SSE publica eventos `connection` com `action: 'update'`,
  `'connection.lost'` e `'connection.restored'`.
- O dashboard mostra um badge separado: **Linha: operando** (verde),
  **Linha: parada** (âmbar, CLP responde) e **Linha: sem comunicação** (vermelho).
  O badge antigo “Tempo real” (dashboard↔API) foi removido por ser redundante:
  o badge **Linha** já mostra o estado relevante da comunicação. O fallback para
  polling continua ativo quando o SSE falha, apenas sem indicador visual próprio.
- O card principal **Operação** reflete o mesmo estado, com prioridade para a
  comunicação: `Linha sem comunicação` (vermelho), `Operação Parada` (âmbar) ou
  `Linha em operação` (verde). Assim a perda de comunicação não passa despercebida
  no indicador principal. O texto usa fonte menor e quebra de linha para não
  ultrapassar as bordas do card.
- O status não é persistido em banco: ele representa o estado atual da sessão,
  não um histórico de falhas.

**Consequências:**

- “Linha parada” e “sem comunicação” deixam de ser ambíguos no painel.
- Reset da aplicação ou desligamento dos motores com o CLP ainda respondendo
  continuam sendo `Parada` — não são falha de comunicação. O reset de produção
  é sinalizado separadamente pelo evento `production.reset`.
- Se o backend cair, o gateway continua publicando telemetria quando volta; o
  heartbeat expirado é corrigido no primeiro status recebido.
- O tracking é em memória: após reiniciar o backend, o estado volta a
  `unknown` até o próximo heartbeat (no máximo 1 s com o gateway ativo).
- Nenhum comando é escrito no CLP; ADR-002 e ADR-018 permanecem válidas.

---

# ADR-021 — Reconexão ADS sem vazamento de portas locais

**Status:** Aceita

**Contexto:**

Após o TwinCAT entrar em modo config e voltar, o gateway continuou offline para
sempre, mesmo com a linha produzindo. O diagnóstico mostrava 5580 falhas e o
erro `Connecting to 127.0.0.1:48898 failed - socket ended by remote (is the ADS
port "0" already in use?)`. O processo do gateway mantinha **948 sockets**.

Cada `Client` do `ads-client` registra uma porta ADS local no router. O gateway
marcava `connected = false` quando a leitura falhava, mas **não fechava o cliente
antigo**; no poll seguinte chamava `connect()` de novo. Isso criava um cliente
por segundo, com `autoReconnect` ainda ativo, até esgotar as portas do
router. O backend e o dashboard apenas refletiam esse estado: não havia nova
telemetria para mostrar.

**Decisão:**

- Toda falha de `connect()` ou `readTags()` chama `adapter.close()` antes da
  próxima tentativa (`descartarConexao()` no gateway).
- `createAdsAdapter()` usa `autoReconnect: false` por padrão. A reconexão passa
  a ser de responsabilidade exclusiva do gateway, em cada poll — sem duas
  máquinas de estado competindo pela mesma porta local.
- `connect()` fecha qualquer cliente existente antes de criar outro e, se falhar
  (inclusive no `cacheSymbols()`/`cacheDataTypes()`), fecha o cliente parcial.
- `close()` libera a referência antes de chamar `disconnect(true)`; como não há
  subscrições ADS, o desligamento forçado é seguro e garantido mesmo quando o
  router não responde ao desregistro gracioso.
- Ao perder a leitura, o gateway também limpa `running` para `null`: sem
  comunicação, o último estado da linha não é mais considerado conhecido.

**Consequências:**

- A volta do TwinCAT é reconhecida no primeiro poll seguinte, sem reiniciar o
  gateway e sem acumular sockets.
- O número de conexões locais permanece constante (observado em 6 após a
  correção, contra 948 antes).
- Unidades produzidas durante a janela em que o ADS estava fora **não** são
  enviadas retroativamente: a PI40 só ingere o que o CLP expõe quando a leitura
  volta. Se o contador do CLP tiver sido zerado nesse intervalo, esse incremento
  não pode ser recuperado por ADS.
- Nenhum comando é escrito no CLP; ADR-002 e ADR-018 permanecem válidas.

---

# ADR-022 - Gateway real como serviço Windows no host

**Status:** Aceita

**Contexto:**

O gateway ADS rodava como processo destacado no host. Após um reinício da
máquina, a telemetria real parava e o dashboard passava a `Sem comunicação` até
alguém iniciar o processo manualmente. A rota ADS estática para
`39.90.64.65.1.1` vive no router do TwinCAT instalado no Windows, então mover o
gateway para um container Linux do Compose exigiria recriar essa rota e mudar a
forma de conexão, sem ganho operacional neste cenário.

**Decisão:**

- O gateway de produção continua no host e passa a ser um serviço Windows
  (`PI40Gateway`) usando WinSW 2.13.0 como wrapper.
- A configuração `gateway/service/PI40-Gateway.xml` é versionada: entrypoint
  `src/index.js`, diretório de trabalho `gateway/`, início automático atrasado,
  reinício após falha, logs rotacionados em `gateway/service/logs/` e variáveis
  de ambiente explícitas (protocolo, backend, máquina, polling e ADS).
- `gateway/scripts/install-service.ps1` instala, remove, inicia, para, reinicia
  e consulta o serviço. Exige PowerShell elevado, verifica Node.js, dependências
  e o arquivo de configuração, baixa o WinSW e valida o SHA-256 publicado antes
  de usar o binário. O `.exe` baixado não é versionado.
- As variáveis do serviço são a fonte de configuração em produção e têm
  prioridade sobre `gateway/.env`; desenvolvimento local continua com `npm start`.
- O serviço usa a conta `LocalSystem` (padrão do WinSW), que enxerga a rota ADS
  de máquina e o backend em `localhost`.
- O simulador do Compose permanece parado enquanto o gateway real estiver ativo,
  para não publicar telemetria sintética na mesma máquina.

**Consequências:**

- O gateway sobe automaticamente com o Windows e volta após falha, sem depender
  de sessão interativa nem de inicialização manual.
- Instalar, atualizar ou remover o serviço exige direitos de administrador; o
  binário do wrapper é verificado por hash e atualizado apenas pelo instalador.
- Trocar protocolo, NetId, porta ou backend exige editar o XML e reinstalar o
  serviço; um `gateway/.env` local não altera o serviço já instalado.
- O `<executable>` assume Node.js em `C:\Program Files\nodejs\node.exe`; em
  instalações diferentes, o XML deve ser ajustado antes de instalar.
- A topologia permanece: PLC/linha como fonte da verdade, gateway no host/edge,
  backend e banco no Compose. ADR-002, ADR-018, ADR-020 e ADR-021 continuam
  válidas; nenhum comando é escrito no CLP.

---

# ADR-023 - Heartbeat com estado da linha desconhecido

**Status:** Aceita

**Contexto:**

A ADR-021 passou a limpar `running` para `null` quando a leitura ADS falha, para
não mostrar um estado obsoleto da linha. Porém a validação
`POST /api/gateway/status` aceitava `running` apenas como booleano quando o
campo estava presente. Com o gateway rodando como serviço e o TwinCAT fora do
modo `Run`, o backend respondia `400 invalid_payload` a cada heartbeat. O
tracker nunca era atualizado e o dashboard ficava preso em `unknown` em vez de
mostrar `Sem comunicação`.

**Decisão:**

- `running: null` é aceito no heartbeat como "estado da linha desconhecido";
  valores diferentes de `null` e de booleano continuam sendo rejeitados.
- O gateway mantém o comportamento da ADR-021: envia `null` enquanto não consegue
  ler o CLP, independentemente de a causa ser ADS fora, TwinCAT em config ou
  CLP desligado.
- `createConnectionTracker` já normaliza `null` para o estado desconhecido;
  nenhuma mudança foi necessária no contrato SSE, no dashboard ou na telemetria.

**Consequências:**

- O heartbeat com falha de leitura volta a ser registrado: o dashboard mostra
  `Sem comunicação` com o erro real do ADS, e a transição `online → offline`
  volta a ser emitida no stream.
- `unknown` continua sendo apenas o estado antes do primeiro heartbeat; com o
  serviço ativo, ele dura no máximo um ciclo de polling.
- A validação continua estrita para valores inválidos como `1`, `'true'` ou
  objeto; apenas `null` foi acrescentado ao contrato do heartbeat.

---

---

# ADR-024 - Padronização dos códigos de linha como `Linha-NN`

**Status:** Aceita

**Contexto:**

O código `machine-01` veio do simulador original e foi usado como padrão no
gateway, no Compose, na API e na documentação. Ele é apenas um identificador de
texto — não tem relação com o NetId ADS nem com o CLP — mas não escala quando a
PI40 passa a receber telemetria de mais de uma linha. Além disso, o gateway
publica sempre o mesmo `machineId`, e o backend cria uma nova linha na tabela
`machines` sempre que recebe um código ainda não visto; trocar só a configuração
do gateway criaria uma máquina nova (id 2) e deixaria todo o histórico no id 1.

**Decisão:**

- O código da linha de envase passa a ser `Linha-01`. O padrão para linhas
  adicionais é `Linha-NN` (`Linha-02`, `Linha-03`, ...), com `name` igual ao
  `code`.
- O valor é configurável por `GATEWAY_MACHINE_ID` no XML do serviço, por
  `MACHINE_ID`/`GATEWAY_MACHINE_ID` no `.env` e por `SMOKE_MACHINE_ID` no smoke
  test; `Linha-01` é apenas o padrão.
- Na implantação com dados existentes, o gateway foi parado, o registro foi
  renomeado com `UPDATE machines SET code = 'Linha-01', name = 'Linha-01' WHERE
  code = 'machine-01'` e o serviço foi reiniciado. O `id` numérico (1) foi
  mantido, preservando telemetria, produção, alertas, manutenção e o acumulado.
- Nenhum símbolo ADS, rota estática ou comando para o CLP foi alterado.

**Consequências:**

- O dashboard mostra uma única máquina, agora chamada `Linha-01`, e o acumulado
  continua associado ao id 1.
- Outras linhas podem ser adicionadas apontando um gateway com outro
  `GATEWAY_MACHINE_ID`; cada código gera sua própria linha, heartbeat, série de
  telemetria e acumulado.
- A URL da API continua usando o id numérico; o texto `Linha-NN` aparece como
  `code`/`name` e no payload de telemetria.
- A troca em um host com dados exige parar o gateway antes do `UPDATE`, para não
  recriar a linha antiga com o código antigo no próximo ciclo de polling.

---

# ADR-025 — Telas de inicialização e encerramento seguro da PI40

**Status:** Aceita

**Contexto:**

A PI40 passou a ser operada diariamente e o painel passou a ser a interface
principal da plataforma. A prontidão já era calculada no modal de diagnóstico,
mas o operador precisava abrir esse modal para entender por que o painel estava
sem dados; e o desligamento dependia de uma sequência manual de comandos
(Docker + serviço Windows), sem confirmação de que os dados tinham sido
persistidos. O navegador não pode parar um serviço Windows nem containers, e o
backend roda em um container Linux, sem acesso direto ao PowerShell do host.

**Decisão:**

- O dashboard ganha uma tela de inicialização em tela cheia. Ela reaproveita os
  seis estágios já existentes (API, stream, gateway, CLP, telemetria e banco),
  mostra progresso, eventos e ações de diagnóstico, nova tentativa e entrada em
  modo limitado. Quando todos os estágios ficam `done`, o painel é aberto
  automaticamente, sem exigir clique. A data é guardada em `localStorage`
  (`pi40.boot.date`); `INICIAR-PI40.cmd` abre `?boot=1` para repetir a tela a cada
  inicialização, enquanto um `F5` no mesmo dia volta direto ao painel.
- Ao clicar em **Encerrar dia**, o modal consulta imediatamente
  `/api/machines/:id/connection`. Se estiver `offline` (sem leitura ADS), o
  encerramento começa no mesmo clique, sem checkbox nem segunda confirmação.
  Com heartbeat ativo — inclusive com `running=false` (linha apenas parada) — o
  modal mostra o bloqueio e repete a verificação a cada 2 s, liberando
  automaticamente assim que a linha for desligada. O botão **Verificar
  novamente** força uma checagem imediata. Ao liberar, ele pausa o dashboard,
  fecha o SSE e mostra as cinco etapas com o mesmo componente de estágios do
  diagnóstico.
- Quem executa as operações é o script local `scripts/pi40-dia.ps1`, com ações
  `Start`, `Stop` e `Status`. O gateway, já rodando como serviço Windows sob
  `LocalSystem`, vigia o arquivo `runtime/system-command.json` e dispara o script
  de forma destacada. O backend expõe `POST /api/system/stop` e
  `POST /api/system/start`, que escrevem esse pedido com token e expiração de
  60 s em um diretório compartilhado por bind mount; exigem ainda o cabeçalho
  `x-pi40-control: 1` e um `Origin` local (defesa contra form cross-origin).
  Nenhuma porta é aberta: neste ambiente Docker/WSL o container não consegue
  alcançar portas do host Windows, então a troca é feita por arquivo.
  O script escreve `dashboard/frontend/system-status.json`, lido por
  `GET /api/system/status`.
- Os atalhos `INICIAR-PI40.cmd` e `ENCERRAR-PI40.cmd` permanecem como caminho
  manual alternativo, útil se o agente estiver indisponível. O de encerramento
  usa `scripts/encerrar-pi40.ps1` e aplica a mesma regra do botão: consulta o
  heartbeat e só dispara o Stop com a linha `offline`.
- O encerramento usa `docker compose stop` para **todos** os serviços (backend,
  PostgreSQL e simulador), nunca `down -v`. Antes de parar os containers, o
  script conta as amostras persistidas; depois, verifica se sobrou algum processo
  da PI40. Não há escrita no CLP. Ao concluir, o dashboard tenta fechar a aba e,
  se o navegador bloquear `window.close()`, substitui a página por `about:blank`.
- Como o backend é parado no penúltimo passo, o dashboard infere a conclusão
  quando o endpoint deixa de responder logo após a etapa `containers` ficar
  ativa; a validação final de containers parados é feita pelo próprio script.

**Consequências:**

- O operador vê o motivo da ausência de dados já na abertura, com instrução
  específica para o erro de ADS/TwinCAT encontrado na integração real.
- O desligamento deixa de depender de decorar comandos. Só acontece quando o CLP
  não responde (linha desligada pelo operador), para todos os containers e
  processos, sem apagar volume nem histórico, e fecha a página do dashboard.
- O botão passou a acionar o encerramento diretamente, sem pedir que o operador
  execute o atalho. Não há execução remota irrestrita: nenhuma porta é aberta,
  o arquivo de comando exige token e expira, e o endpoint do backend exige
  cabeçalho customizado e origem local. O atalho manual continua disponível como
  fallback.
- Unidades produzidas com a PI40 parada continuam não recuperáveis por ADS
  (consequência já registrada na ADR-021).

---

# ADR-026 — Apresentação gradual da abertura da PI40

**Status:** Aceita

**Contexto:**

Com API, gateway e CLP já disponíveis, as seis verificações da tela
**Preparando a PI40** terminavam em poucos milissegundos. O painel era aberto
antes de o operador conseguir acompanhar as etapas, dando a impressão de que a
inicialização não tinha feito nada.

**Decisão:**

- As verificações reais continuam sendo executadas normalmente e imediatamente
  (`/health`, SSE, heartbeat, leitura ADS, telemetria e banco).
- A tela revela os estágios um a um, a cada `BOOT_STAGE_REVEAL_MS` (1,1 s), e
  mantém a barra de progresso coerente apenas com o que já foi revelado.
- A entrada automática no painel exige: todas as verificações reais `done`,
  todos os estágios revelados e no mínimo `BOOT_MIN_VISIBLE_MS` (9 s) desde o
  início da tela. Até lá o botão fica desabilitado com “Finalizando abertura...”.
- Falhas continuam liberando o modo limitado na etapa em que aparecem; o limite
  de 25 s para entrada manual também permanece.

**Consequências:**

- O operador acompanha a sequência de prontidão sem retardar serviços nem a
  coleta de telemetria: apenas a apresentação é cadenciada.
- Um serviço que ainda não responde continua sendo refletido na etapa real
  correspondente; revelar uma etapa não a marca como `done`.
- O fluxo de encerramento e o acumulado no banco não foram alterados.

---

# ADR-027 — Remoção do indicador de linha na topbar

**Status:** Aceita

**Contexto:**

O card principal **Operação** passou a mostrar `Linha sem comunicação`,
`Operação Parada` ou `Linha em operação` com a mesma informação do badge da
topbar. Manter os dois indicadores, um deles ao lado do botão **Encerrar dia**,
era redundante e ocupava espaço na barra de controles.

**Decisão:**

- Remover `#line-connection` da topbar e a lógica que atualizava esse badge.
- Manter `state.lineConnection`, `renderOperation()` e os estágios de
  monitoramento: apenas a apresentação duplicada foi eliminada.
- Remover também as regras CSS `.badge` e `.badge.line-*` que ficaram sem uso.
- O estado da linha continua disponível no card **Operação**, no diagnóstico e
  no modal de encerramento, que exibe a checagem de `offline` antes de parar a
  PI40.

**Consequências:**

- A topbar fica mais limpa; não há duas leituras diferentes para o mesmo estado.
- O backdrop do modal e o fluxo de encerramento não mudaram; a verificação de
  heartbeat continua sendo feita em `/api/machines/:id/connection`.

---

# ADR-028 — Número de controle SAP por componente

**Status:** Aceita

**Contexto:**

A outbox SAP simulada usava `SAP-<id da OS>-<sufixo temporal>`, por exemplo
`SAP-16-MWRYB92B`. O número identificava a OS, não o componente, e não havia
uma correspondência estável entre a válvula de envase e a de tampagem. O
operador pediu um identificador apenas numérico, de 7 dígitos, crescente na
configuração e exclusivo de cada componente cadastrado.

**Decisão:**

- Cada componente em `backend/node-api/config/maintenance.json` passa a ter
  `sapControlNumber`, uma string de exatamente 7 dígitos, maior que 100:
  rolamento `1001011`, motor `1001012`, válvula de envase `1001013` e válvula
  de tampagem `1001014`.
- `normalizeComponent` valida o formato e mantém um mapa padrão por código, de
  modo que um componente conhecido nunca fique sem número. O valor é exposto em
  `GET /api/machines/:id/maintenance` e no payload da outbox.
- `insertSapOutbox` usa esse número como `external_id` e como `sapOrderId`; o
  payload também inclui `component.sapControlNumber`. Não há mais prefixo,
  sufixo temporal nem contador por OS.
- A migração `005_sap_control_numbers.sql` converte os eventos já persistidos
  com base no `component_code` da OS, preservando o histórico.

**Consequências:**

- Válvula de envase e válvula de tampagem têm números próprios e permanentes;
  novas OS do mesmo componente reutilizam o mesmo número de controle.
- O formato passa a ser previsível (`^[0-9]{7}$`), sem ambiguidade entre OS e
  componente.
- Nenhum comando é enviado ao CLP e o acumulado de produção não é alterado.

---

# ADR-029 — Atalho único para iniciar ou encerrar a PI40

**Status:** Aceita

**Contexto:**

Já existiam `INICIAR-PI40.cmd` e `ENCERRAR-PI40.cmd`, mas o operador
precisava escolher qual comando executar. O pedido foi simplificar para um único
clique, sem digitar nem decidir entre dois atalhos.

**Decisão:**

- Criar `PI40.cmd` e `scripts/pi40-toggle.ps1`, com um atalho `PI40.lnk` na área
  de trabalho apontando para o `.cmd`.
- O toggle consulta `GET /health`: sem resposta, chama
  `pi40-dia.ps1 -Action Start`; com resposta, chama `encerrar-pi40.ps1`, que só
  encerra quando a linha está `offline`.
- Antes de iniciar, verifica se o Docker/Rancher Desktop está disponível e, se
  não estiver, orienta abrir o Rancher Desktop sem tentar subir os containers.
- Os scripts existentes continuam como caminhos explícitos e o UAC continua
  aparecendo apenas na ação que precisa de elevação.

**Consequências:**

- Um único atalho cobre o ciclo diário; a decisão é feita pelo estado real da
  plataforma, não pelo operador.
- A regra de segurança do encerramento não foi enfraquecida: linha com heartbeat
  (mesmo parada) continua bloqueando o Stop.
- O atalho é local ao perfil do Windows e não é versionado; o `.cmd` e o script
  que ele chama são versionados.

---
