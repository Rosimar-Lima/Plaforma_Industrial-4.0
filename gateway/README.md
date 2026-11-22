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

## Serviço Windows (integração real)

A integração com o TwinCAT depende do router ADS instalado no host, por isso o
gateway de produção roda como serviço Windows, e não no Docker Compose. O
wrapper WinSW fica em `gateway/service/`; o instalador valida o hash SHA-256 do
binário baixado e o arquivo `.exe` não é versionado.

Em um PowerShell **elevado (Administrador)**:

```powershell
cd gateway
npm install
.\scripts\install-service.ps1 -Action Install
.\scripts\install-service.ps1 -Action Status
```

Outras ações: `Start`, `Stop`, `Restart`, `Uninstall`. O serviço é
`PI40Gateway`, com início automático (atrasado), reinício em 10 s após falha e
logs rotacionados em `gateway/service/logs/`.

```powershell
Get-Content .\service\logs\PI40-Gateway.out.log -Tail 50
Get-Content .\service\logs\PI40-Gateway.err.log -Tail 50
```

A configuração do serviço está em `gateway/service/PI40-Gateway.xml`. Edite os
elementos `<env>` para trocar protocolo, AMS NetId ou URL do backend e rode
`-Action Install` novamente. As variáveis do serviço têm prioridade sobre um
eventual `gateway/.env`: para desenvolvimento local, use `npm start`, sem o
serviço. O `<executable>` assume Node.js em `C:\Program Files\nodejs\node.exe`;
ajuste esse caminho no XML se a instalação for diferente.

Com o gateway ADS ativo, mantenha o serviço `simulator` do Compose parado para
não publicar telemetria sintética na mesma máquina.

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

### Diagnóstico ADS (somente leitura)

Antes de publicar telemetria, valide a conexão e os símbolos sem escrever no CLP
nem chamar o backend:

```powershell
npm install
npm run diagnostico -- --ams 39.90.64.65.1.1 --port 851 --timeout 5000
```

O script `gateway/scripts/diagnostico-ads.js` conecta pelo router ADS local, lê o
runtime (`readPlcRuntimeState`), carrega o cache de símbolos/tipos e imprime o
valor de cada símbolo do mapa configurado. Use `--symbols` para testar outro
arquivo de mapa.

O AMS Net ID `39.90.64.65.1.1` é uma rota ADS estática configurada no host; ele
não deve ser usado como endereço IP (`ping 39.90.64.65` falha). Em caso de
falha, confira a rota no TwinCAT e se o runtime está em `Run`.

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
