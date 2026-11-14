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