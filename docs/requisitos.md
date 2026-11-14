# Requisitos

## Requisitos funcionais

| ID | Descrição |
| --- | --- |
| RF-01 | O simulador deve gerar telemetria periódica por máquina. |
| RF-02 | O backend deve receber e validar a telemetria. |
| RF-03 | O backend deve persistir as amostras no banco. |
| RF-04 | O sistema deve calcular disponibilidade, performance e qualidade. |
| RF-05 | O sistema deve calcular o OEE consolidado. |
| RF-06 | O dashboard deve exibir telemetria em tempo (quase) real. |
| RF-07 | O dashboard deve permitir consultar histórico por período. |
| RF-08 | O sistema deve gerar alertas quando um sensor exceder limites. |

## Requisitos não funcionais

| ID | Descrição |
| --- | --- |
| RNF-01 | Atualização do dashboard em menos de 5 segundos. |
| RNF-02 | Ingestão tolerante a falhas temporárias de rede. |
| RNF-03 | Ambiente local reproduzível via Docker Compose. |
| RNF-04 | API documentada (OpenAPI). |
| RNF-05 | Sem exposição de credenciais no código. |
