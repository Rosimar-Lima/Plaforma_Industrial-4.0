# Project Charter — Plataforma Industrial 4.0

## 1. Objetivo

Construir uma plataforma que centralize a coleta de telemetria de máquinas
industriais, calcule indicadores de produção e disponibilize um dashboard para
monitoramento em tempo (quase) real.

## 2. Justificativa

Ambientes industriais geram grandes volumes de dados de sensores que, sem
integração, permanecem isolados. A plataforma centraliza esses dados e os
transforma em informação acionável (OEE, disponibilidade, alertas).

## 3. Escopo

### Incluído

- Simulador de PLC que publica telemetria.
- API de ingestão e consulta de dados.
- Persistência em PostgreSQL.
- Dashboard com indicadores e histórico.
- Alertas básicos por limite de sensor.
- Infraestrutura local via Docker Compose.

### Excluído (por enquanto)

- Integração direta com PLCs reais (OPC-UA/Modbus).
- Autenticação e controle de acesso avançado.
- Aplicativo móvel.
- Machine learning preditivo.

## 4. Stakeholders

| Papel | Interesse |
| --- | --- |
| Operação industrial | Visibilidade da produção e alertas. |
| Engenharia de automação | Integração com equipamentos. |
| Gestão | Indicadores e relatórios. |
| Desenvolvimento | Manutenção e evolução da plataforma. |

## 5. Métricas de sucesso

- Ingestão contínua de telemetria sem perda de amostras.
- Dashboard atualizado em menos de 5 segundos.
- Cálculo de OEE e disponibilidade validado com a operação.
- Ambiente local reproduzível com um único comando.

## 6. Premissas e restrições

- PostgreSQL como banco principal.
- Comunicação em JSON sobre HTTP/MQTT.
- Execução local via Docker.
