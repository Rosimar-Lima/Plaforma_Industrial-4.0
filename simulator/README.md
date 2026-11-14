# Simulador de PLC

Simulador que gera telemetria de sensores industriais e a envia ao backend,
substituindo um PLC real durante o desenvolvimento.

## Uso

```bash
node plc-simulator.js
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `BACKEND_URL` | `http://localhost:3000` | URL do backend. |
| `MACHINE_ID` | `machine-01` | Identificador da máquina simulada. |
| `INTERVAL_MS` | `2000` | Intervalo entre leituras. |

## Telemetria gerada

- Temperatura (°C)
- Pressão (bar)
- Velocidade (rpm)
- Contagem de peças (produzidas/boas)
