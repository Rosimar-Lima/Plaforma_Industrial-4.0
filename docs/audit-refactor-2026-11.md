# Auditoria e refatoração — novembro de 2026

Branch: `integracao/linha-envase-pi40`  
Base: `d494b0a` (`Revert "Adiciona atalho unico..."`)  
Objetivo: simplificar o código sem perder funcionalidade, eliminando
redundâncias e registrando toda mudança observável em `DECISIONS.md`.

## Invariantes preservados

- Projeto de origem `Projeto_Linha_Envase` tratado como somente leitura.
- ADS somente leitura; gateway no host Windows; simulador do Compose parado na
  operação com CLP real.
- Encerramento: um clique verifica `/api/machines/1/connection`; somente
  `state=offline` autoriza. Linha parada com heartbeat bloqueia. Uso exclusivo
  de `docker compose stop` — nunca `down -v` — com a contagem de amostras antes
  de parar os containers.
- Boot gradual de 6 estágios, `BOOT_STAGE_REVEAL_MS=1100`, mínimo de 9 s e
  autoentrada; sem badge de linha na topbar.
- SAP por componente, 7 dígitos, sem prefixo: `1001011`, `1001012`, `1001013`,
  `1001014`.
- Atalhos explícitos `INICIAR-PI40.cmd` e `ENCERRAR-PI40.cmd`; o atalho único
  rejeitado continua revertido.
- Migrações `001`–`005`, tabelas `production`/`sensors`, endpoints e ADRs
  anteriores mantidos.

## Linha de base e resultado dos testes

| Camada | Antes | Depois |
| --- | --- | --- |
| Backend (`backend/node-api`) | 114/114 | 116/116 |
| Dashboard (`dashboard/frontend/test`) | 12/12 | 17/17 |
| Gateway (`gateway`) | 45/45 | 50/50 |
| Simulador (`simulator`) | 6/6 | 6/6 |

Comandos usados:

```bash
cd backend/node-api && npm test && npm run check
cd ../../dashboard/frontend && node --test test/app.render.test.js
cd ../../gateway && npm test && npm run check
cd .. && node --test simulator/line-state.test.js
```

## Achados corrigidos

| Camada | Achado | Correção | Registro |
| --- | --- | --- | --- |
| Dashboard | Estágio `api` marcado `done` mesmo com `/health` falhando | `monitoring.apiHealthy` tri-state usado no diagnóstico e no boot | ADR-030 |
| Dashboard | Duplo clique podia disparar duas ordens de parada | Guard `shutdown.verifying` com liberação no `finally` | ADR-030 |
| Dashboard | `innerHTML` com título/detalhe externos sem escape | `escapeHtml()` em eventos e etapas | ADR-030 |
| Dashboard | Troca de máquina podia mostrar dados antigos se a recarga falhasse | `renderMachinePlaceholder()` centraliza a limpeza | ADR-030 |
| Dashboard | Mapas e formatação repetidos | Constantes compartilhadas, `setProgress()`, `bindModalClose()`, formatters cacheados | ADR-030 |
| Backend | `maintenanceAlert()` ignorava `warnRatio` | Parâmetro propagado até a geração do alerta | ADR-031 |
| Backend | Erro do repositório sem cobertura de `500` | Teste de `GET /api/machines` com falha + middleware Express 5 | ADR-031 |
| Backend | Validação de id e rotas de OS repetidas | `parsePositiveId()` e `registerOrderAction()` (eventos preservados) | ADR-031 |
| Backend | `try/catch` redundante em 13 rotas assíncronas | Removidos; Express 5 encaminha rejeições ao middleware | ADR-031 |
| Gateway | `running` divergia entre heartbeat e telemetria | `normalizeRunning()` compartilhada com `buildTelemetry()` | ADR-032 |
| Gateway | Filho morto por sinal mantinha o agente "ocupado" | `isBusy()` também verifica `signalCode` | ADR-032 |
| Gateway | Metadados ADS não recarregados na reconexão da biblioteca | `cacheMetadata()` no `connect()` e no evento `reconnect` | ADR-032 |
| Gateway | Primeira leitura do simulador podia avançar minutos em um tick | Limite `maxTickMs = config.pollMs` e `now()` injetável | ADR-032 |
| Scripts | Mojibake nas mensagens dos `.ps1` sob PowerShell 5.1 | BOM UTF-8 nos três scripts versionados | ADR-033 |
| Scripts | `docker compose ps` dependia do diretório chamador | `Get-ComposeRunningServices()` via `Invoke-Docker` | ADR-033 |
| Scripts | Usuário/banco do PostgreSQL fixos no Stop | `psql` com `$POSTGRES_USER`/`$POSTGRES_DB` dentro do container | ADR-033 |
| Scripts | Atalho manual reportava sucesso antes do UAC | `Start-Process -Wait -PassThru` com `ExitCode` | ADR-033 |
| Docs | Badge removido ainda descrito no README do dashboard | Texto do card **Operação** atualizado | — |
| Docs | `docker compose up -d` parecia caminho de produção | Seção rotulada como desenvolvimento/MVP | — |
| Docs | Roteiro de aceitação antigo lido como atual | Aviso de documento histórico no topo | — |

Redução de código: `app.js` do backend perdeu cerca de 190 linhas líquidas e o
`app.js` do dashboard cerca de 40, sem remover rotas nem comportamentos.

## Validado sem efeito colateral

- `pi40-dia.ps1 -Action Status`: leu o JSON sem iniciar ou parar nada.
- Parser do PowerShell 5.1: os três `.ps1` versionados sem erros de sintaxe.
- `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" ...'`:
  contagem de amostras retornada com sucesso no ambiente atual.
- `git diff --check`: sem erros; CRLF preservado nos arquivos versionados.
- `docker compose config` e o estado dos containers foram consultados; o volume
  `postgres-data` não foi removido.

Não foram executados `Start`/`Stop` reais nem aceito/recusado UAC durante a
refatoração: o host possui telemetria real e o gateway ADS permanece somente
leitura.

## Achados documentados, não alterados nesta rodada

| Item | Motivo da não alteração |
| --- | --- |
| OpenAPI incompleto (`POST /api/gateway/status`, `/connection`, `/production/total`, eventos `connection`/`production`) | É contrato público: mudança permite ADR específica e comparação automatizada com `app.js`. |
| Diagramas drawio e `ARCHITECTURE.md` desatualizados | Atualização visual ampla; sem risco operacional, pode ser feita separadamente. |
| `SIMULATOR_INTERVAL_MS` e `API_BASE_URL` sem consumo | Remoção de variáveis de `.env.example` pode afetar instalações existentes; melhor anotar como legado primeiro. |
| CI inexistente, mas citado como "quando disponível" | Texto já correto; criar workflow com smoke test contra `Linha-01` poluiria o acumulado sem isolamento. |
| Regex de processos remanescentes em `pi40-dia.ps1` | Ampliar para qualquer `node server.js` causaria falsos positivos; a checagem do Compose já cobre a condição normal. |
| Variáveis operacionais repetidas entre PowerShell/XML/`.env` | Centralizar entre linguagens exigiria mudar XML do WinSW e paths de bind mount; fora do escopo desta refatoração. |
| Invariantes do Compose (volume nomeado, bind mounts, healthchecks) | São intencionais, não redundâncias. Documentados para evitar simplificação incorreta. |

## Próximo passo recomendado

Atualizar `docs/openapi.yaml` com as rotas e eventos já implementados, em ADR
separado, e revisar os diagramas com a topologia real
`CLP → gateway no host → API/Compose → Postgres + dashboard`.
