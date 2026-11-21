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
- `component_usage` ganha `hours`, `last_timestamp` e `last_active`; a coluna
  `cycles` continua para as válvulas.
- `maintenance_orders.source_cycles` passa a ser `source_usage` (numérico), com
  a unidade resolvida pelo componente.
- A API devolve `metric`, `source`, `usage`, `mtbf`, `remaining` e `unit` em vez
  dos antigos `cycles`/`mtbfCycles`/`remainingCycles`.
- O dashboard exibe `ciclos` ou `h` conforme `unit`, inclusive no detalhe da OS.

**Consequências:**

- O limiar de 80%/100% continua igual; muda apenas o que é acumulado.
- Em instalações novas o schema já traz as colunas. Volumes antigos precisam da
  migração `database/migrations/002_maintenance_hours.sql`.
- Clientes que liam `cycles`/`mtbfCycles` devem migrar para `usage`/`mtbf`;
  não mantivemos alias para evitar ambiguidade de unidade.
- O uso por horas depende da periodicidade da telemetria. Com amostras a cada
  1 s, o valor evolui devagar; os valores iniciais da configuração calibram a
  demonstração (rolamento já em 80%, motor em 60%).
- O reset ao concluir a OS zera `hours` para componentes de horas e `cycles`
  para os de ciclos.