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

- [ ] Simulador de PLC
- [ ] Geração de telemetria industrial
- [ ] API de ingestão
- [ ] Validação de payload
- [ ] Persistência inicial no PostgreSQL
- [ ] Modelagem do banco de dados

Entregável:

- Simulador enviando dados para o banco

---

## Fase 2 — Indicadores Industriais

Objetivo:
Transformar dados brutos em informação.

- [ ] Produção total
- [ ] Produção por hora
- [ ] Produção por turno
- [ ] Tempo operando
- [ ] Tempo parado
- [ ] Disponibilidade
- [ ] Performance
- [ ] Qualidade
- [ ] OEE consolidado

Entregável:

- API retornando indicadores calculados

---

## Fase 3 — Dashboard

Objetivo:
Visualização operacional em tempo real.

- [ ] Dashboard Web
- [ ] Visão por máquina
- [ ] Histórico de produção
- [ ] Filtros de período
- [ ] Indicadores em tempo real
- [ ] Painel consolidado de OEE

Entregável:

- Dashboard totalmente funcional

---

## Fase 4 — Integração Industrial

Objetivo:
Substituir o simulador por equipamentos reais.

- [ ] Gateway Industrial
- [ ] Integração TwinCAT ADS
- [ ] Integração OPC-UA
- [ ] Integração Modbus TCP

Entregável:

- Plataforma recebendo dados de PLC real

---

## Fase 5 — Alertas

Objetivo:
Detectar eventos industriais relevantes.

- [ ] Alarmes
- [ ] Limites operacionais
- [ ] Notificações
- [ ] Histórico de eventos

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