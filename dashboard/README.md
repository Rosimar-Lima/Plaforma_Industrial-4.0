# Dashboard

Interface web para monitoramento em tempo real e consulta de indicadores.

## Estrutura

- `frontend/` — aplicação web em HTML/CSS/JS puro (sem build), servida pelo backend.

## Executar

Suba o backend (que serve o dashboard na raiz):

```bash
cd backend/node-api
npm start
```

Abra `http://localhost:3000` (ou o `PORT` configurado).

## Funcionalidades

- Seleção de máquina.
- Estado da linha em tempo (quase) real: operação, etapa, esteira, EV, AT e
  nível de envase.
- Contadores de envasadas, tampadas e produção total.
- Gráfico do volume envasado acumulado ao longo das últimas amostras,
  considerando garrafa long neck de 300 ml (0,3 L por garrafa). Resets do
  contador de envasadas são tratados como delta zero.
- Cartões de OEE, disponibilidade, performance e qualidade com filtro de período
  (15 min, 1 h, 6 h, 24 h).
- Histórico de produção por hora ou turno, com produzidas, boas, refugo, tempo
  operando, tempo parado e disponibilidade.
- Painel de alertas abertos, com severidade, horário e ação para resolver.
- Manutenção preventiva: vida útil dos componentes e OS ativas. Válvulas são
  medida em ciclos de envase/tampagem; rolamento e motor da esteira são medidos
  em horas com o conveyor ligado (unidade `h` no cartão).
- Ao clicar no número de uma OS aberta, abre-se um formulário com todos os
  dados da ordem (número, máquina, componente, status, prioridade, uso na origem
  em ciclos ou horas, peças reservadas, ID/evento do SAP e datas). O formulário oferece os botões
  **Enviar para manutenção** (`POST /api/maintenance/orders/:id/send`) e
  **Cancelar ordem** (`POST /api/maintenance/orders/:id/cancel`), além de
  fechar. O envio muda o status para `in_progress` e o cancelamento para
  `cancelled`; ambos publicam o evento correspondente na outbox SAP. A ação
  **Concluir** da tabela continua disponível.

## Atualização

- Telemetria: tempo real via SSE em `/api/stream`; quando o stream não está
  disponível, há fallback para polling a cada 3 s em
  `/api/machines/:id/telemetry`.
- Indicadores: polling a cada 15 s em `/api/machines/:id/oee`.
- Histórico de produção: polling a cada 15 s em
  `/api/machines/:id/production`, respeitando o período e o agrupamento
  selecionados.
- Alertas: eventos `alert` no SSE; a lista aberta também é reconsultada a cada
  15 s como garantia.
- Manutenção: eventos `maintenance` no SSE e reconsulta a cada 15 s.
- O indicador de conexão mostra `Tempo real`, `Polling` ou `Offline`.

O contrato consumido está documentado em
[`docs/openapi.yaml`](../docs/openapi.yaml).
