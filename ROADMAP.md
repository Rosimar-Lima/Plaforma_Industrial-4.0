# Roadmap

## Fase 0 — Fundação

- [x] Criação do repositório
- [x] Estrutura de diretórios
- [x] Documentação inicial
- [ ] Definição de requisitos
- [ ] Definição dos indicadores industriais
- [ ] Arquitetura inicial validada
- [ ] Infraestrutura local (Docker Compose + PostgreSQL)

---

## Fase 1 — Simulador e Ingestão

Objetivo:
Criar uma fonte de dados industriais independente de hardware.

- [x] Simulador de PLC
- [x] Geração de telemetria industrial
- [x] API de ingestão
- [x] Validação de payload
- [x] Persistência inicial no PostgreSQL
- [x] Modelagem do banco de dados

Entregável:

- Simulador enviando dados para o banco

---

## Fase 2 — Indicadores Industriais

Objetivo:
Transformar dados brutos em informação.

- [x] Produção total
- [ ] Produção por hora
- [ ] Produção por turno
- [ ] Tempo operando
- [ ] Tempo parado
- [x] Disponibilidade
- [x] Performance
- [x] Qualidade
- [x] OEE consolidado

Entregável:

- API retornando indicadores calculados

---

## Fase 3 — Dashboard

Objetivo:
Visualização operacional em tempo real.

- [x] Dashboard Web
- [x] Visão por máquina
- [ ] Histórico de produção
- [x] Filtros de período
- [x] Indicadores em tempo real
- [ ] Painel consolidado de OEE

Entregável:

- Dashboard totalmente funcional

---

## Fase 4 — Integração Industrial

Objetivo:
Substituir o simulador por equipamentos reais.

- [x] Gateway Industrial
- [x] Integração TwinCAT ADS
- [x] Integração OPC-UA
- [x] Integração Modbus TCP

Entregável:

- Plataforma recebendo dados de PLC real

---

## Fase 5 — Alertas

Objetivo:
Detectar eventos industriais relevantes.

- [x] Alarmes
- [x] Limites operacionais
- [x] Notificações
- [x] Histórico de eventos

Entregável:

- Central de alarmes

---

## Fase 6 — Evolução Indústria 4.0

Objetivo:
Adicionar inteligência e análise avançada.

- [ ] Redis
- [ ] Analytics
- [ ] Grafana
- [ ] Tendências
- [ ] Predição de produção
- [ ] IA aplicada

Entregável:

- Plataforma Industrial 4.0 completa