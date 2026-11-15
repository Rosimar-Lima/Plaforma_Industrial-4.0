# Gateway Industrial

Serviço que lê os sinais de um PLC/equipamento real, normaliza para o contrato de
telemetria da plataforma e publica em `POST /api/telemetry`.

Substitui o simulador na Fase 4, sem alterar backend nem dashboard.

## Protocolos

| Protocolo | `INDUSTRIAL_PROTOCOL` | Dependência opcional |
| --- | --- | --- |
| TwinCAT ADS | `ads` | `ads-client` |
| OPC-UA | `opcua` | `node-opcua` |
| Modbus TCP | `modbus` | `modbus-serial` |
| Simulador local | `simulator` | — |

As dependências de protocolo são `optionalDependencies`: instale apenas as que
forem usadas. O adaptador `simulator` permite validar o fluxo sem hardware.

## Executar

```bash
cd gateway
npm install
INDUSTRIAL_PROTOCOL=simulator npm start
```

No PowerShell:

```powershell
cd gateway
npm install
$env:INDUSTRIAL_PROTOCOL='simulator'; npm start
```

Por padrão o gateway publica em `http://localhost:3000`. Rode o backend antes.

## Configuração

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `INDUSTRIAL_PROTOCOL` | `ads` | `ads`, `opcua`, `modbus` ou `simulator`. |
| `GATEWAY_MACHINE_ID` | `machine-01` | Código da máquina no backend. |
| `GATEWAY_POLL_MS` | `1000` | Intervalo de leitura (mínimo 100 ms). |
| `BACKEND_URL` | `http://localhost:3000` | URL do backend. |
| `PLC_VERSION` | — | Versão usada quando o PLC não expõe `plcVersion`. |
| `GATEWAY_SYMBOLS_FILE` | `gateway/plc.config.json` | Mapa de símbolos ADS/OPC-UA. |
| `MODBUS_SYMBOLS_FILE` | `gateway/modbus.config.json` | Mapa de registradores Modbus. |

### ADS

| Variável | Padrão |
| --- | --- |
| `ADS_TARGET_AMS_NET_ID` | `39.90.64.65.1.1` |
| `ADS_TARGET_PORT` | `851` |
| `ADS_TIMEOUT_MS` | `5000` |
| `ADS_AUTO_RECONNECT` | `true` |

O mapa padrão (`plc.config.json`) usa os símbolos `GVL_HMI.*` do projeto
original. O campo `step` é opcional: se o PLC expuser a etapa (recomendado,
ex.: `GVL_HMI.nStep`), adicione ao mapa; caso contrário o gateway a estima pelos
sinais de esteira, sensores e envase.

### OPC-UA

| Variável | Padrão |
| --- | --- |
| `OPCUA_ENDPOINT_URL` | `opc.tcp://localhost:4840` |
| `OPCUA_USERNAME` | — |
| `OPCUA_PASSWORD` | — |
| `OPCUA_SECURITY_MODE` | `None` |
| `OPCUA_SECURITY_POLICY` | `None` |

Use `GATEWAY_SYMBOLS_FILE` com NodeIds no lugar dos nomes ADS:

```json
{
  "symbols": {
    "running": "ns=4;s=MAIN.bRunning",
    "fillPercent": "ns=4;s=MAIN.nFillPercent",
    "filled": "ns=4;s=MAIN.nBottlesFilled",
    "capped": "ns=4;s=MAIN.nBottlesCapped",
    "total": "ns=4;s=MAIN.nProductionTotal"
  }
}
```

### Modbus TCP

| Variável | Padrão |
| --- | --- |
| `MODBUS_HOST` | `127.0.0.1` |
| `MODBUS_PORT` | `502` |
| `MODBUS_UNIT_ID` | `1` (ou `unitId` do arquivo) |

O mapa usa `type` (`coil`, `discrete`, `input`, `holding`), `address`, `words`
(1 ou 2), `signed`, `scale` e `offset`. Exemplo em `modbus.config.json`.

## Normalização

- Booleanos aceitam `true/false`, `0/1` e strings `true/on/yes/1`.
- `fillPercent` é arredondado e limitado a 0–100.
- Contadores são inteiros não negativos; `total` ausente vira
  `min(filled, capped)`.
- `bottlePositioned`, `evInterlock` e `atInterlock` são derivados dos sensores e
  da esteira quando o PLC não os expõe.
- Falhas de publicação em `5xx`/rede têm novas tentativas; erros `4xx` não.

## Testes

```bash
cd gateway
npm test
npm run check
```
