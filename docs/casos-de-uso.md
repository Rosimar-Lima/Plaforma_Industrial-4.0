# Casos de Uso

## UC-01 — Monitorar telemetria em tempo real

- **Ator:** Operador
- **Pré-condição:** Máquina cadastrada e simulador em execução.
- **Fluxo:** O operador abre o dashboard, seleciona a máquina e visualiza as
  leituras atualizadas dos sensores.
- **Pós-condição:** Telemetria exibida em tempo (quase) real.

## UC-02 — Consultar histórico de produção

- **Ator:** Gestão
- **Fluxo:** Seleciona máquina e período; o sistema retorna as séries históricas
  e os indicadores consolidados.

## UC-03 — Visualizar OEE

- **Ator:** Gestão
- **Fluxo:** O sistema calcula e exibe disponibilidade, performance, qualidade e
  OEE por máquina e por turno.

## UC-04 — Receber alerta de sensor

- **Ator:** Operação
- **Fluxo:** Quando uma leitura excede o limite configurado, o sistema gera um
  alerta e o exibe no dashboard.

## UC-05 — Simular uma máquina

- **Ator:** Desenvolvedor
- **Fluxo:** Executa o simulador apontando para o backend, que passa a receber
  telemetria como se fosse um dispositivo real.
