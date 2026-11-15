# Simulador de PLC

Simulador que reproduz o ciclo de controle da linha de envase (derivado do
`MAIN.st` do projeto original) e publica a telemetria resultante para o backend.

## Uso

```bash
node simulator/plc-simulator.js
```

Comandos no terminal: `start`, `stop`, `reset`.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `BACKEND_URL` | `http://localhost:3000` | URL do backend. |
| `MACHINE_ID` | `machine-01` | Identificador da máquina simulada. |
| `TICK_MS` | `100` | Intervalo do ciclo de simulação. |
| `PUBLISH_MS` | `1000` | Intervalo de publicação da telemetria. |
| `AUTO_START` | `true` | Liga a linha automaticamente ao iniciar. |
| `PLC_VERSION` | `1.0.0` | Versão reportada do PLC. |

## Ciclo simulado

O estado da linha é modelado em `line-state.js`, espelhando as etapas do PLC:

| Etapa | Descrição | Duração |
| --- | --- | --- |
| `0` | Transporte inicial até S1 | 3270 ms |
| `1` | S1 acusa a garrafa e a esteira para | 460 ms |
| `2` | Esteira parada: EV envasá S1 e AT tampa S2 | 2000 / 1200 ms |
| `3` | Garrafa cheia sai e a próxima entra | 2770 ms |

Regras preservadas:

- EV (`evOn`) só atua com `sensorS1` e esteira parada, e enquanto o envase não
  terminou.
- AT (`atOn`) só desce com `sensorS2` e esteira parada, e enquanto não tampou.
- `stop` pausa preservando etapa, tempo e nível de envase; `reset` só zera com a
  linha parada.

## Telemetria publicada

`POST {BACKEND_URL}/api/telemetry`

```json
{
  "machineId": "machine-01",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "plcVersion": "1.0.0",
  "line": {
    "step": 2,
    "running": true,
    "conveyorOn": false,
    "evOn": true,
    "atOn": false,
    "sensorS1": true,
    "sensorS2": false,
    "bottlePositioned": true,
    "evInterlock": true,
    "atInterlock": false,
    "fillPercent": 42
  },
  "production": {
    "filled": 10,
    "capped": 9,
    "total": 9
  }
}
```

## Testes

```bash
node --test simulator/line-state.test.js
```
