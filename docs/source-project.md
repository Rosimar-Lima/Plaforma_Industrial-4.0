# Projeto de Origem — Linha de Envase

Documento de referência que registra **de onde** a Plataforma Industrial 4.0
está sendo derivada e **como** cada parte do projeto original se mapeia para a
nova arquitetura.

## Localização

| Item | Valor |
| --- | --- |
| Caminho local | `C:\Users\rosim\OneDrive\Repositorios\Projeto_Linha_Envase` |
| Repositório | https://github.com/Rosimar-Lima/Projeto_Linha_Envase.git |
| Branch base | `main` |
| Último commit observado | `ebd3b48` — "refactor: modulariza servidor e IHM sem alterar comportamento" |

> O projeto original é **somente leitura** para esta plataforma. Não altere nem
> faça commit nele a partir daqui.

## O que é o projeto original

IHM web de uma **linha de envase didática** (projeto de Engenharia Mecatrônica —
UFBRA). Integra:

- **PLC TwinCAT/BSD** — sequência de transporte, envase e tampagem em Structured
  Text (`PLC/MAIN.st`, `PLC/GVL_HMI.st`).
- **Ponte Node.js** — servidor Express + WebSocket que lê/escreve símbolos do PLC
  via ADS (`ads-client`).
- **IHM web** — HTML/CSS/JS (ES Modules) que consome o estado em tempo real e
  envia comandos.

### Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Controle | TwinCAT/BSD, Structured Text, ADS |
| Servidor | Node.js, Express 5, `ws`, `ads-client` |
| Frontend | HTML5, CSS3, JavaScript (ES Modules) |
| Deploy | PowerShell (Windows) e shell (BSD) |

### Estrutura relevante

```text
server.js              Ponte ADS/HTTP/WebSocket
src/config.js          Leitura/validação de .env + plc.config.json
src/state.js           Estado inicial, limites e intertravamentos
plc.config.json        Conexão ADS e mapa de símbolos do PLC
IHM/index.html         Estrutura da IHM
IHM/js/app.mjs         Comunicação, animação e eventos
IHM/js/status.mjs      Apresentação dos estados da máquina
PLC/MAIN.st            Ciclo de controle do PLC
PLC/GVL_HMI.st         Interface de variáveis PLC ↔ IHM
deploy/                Bootstrap, serviço e autostart (BSD/Windows)
test/                  Testes com node:test
```

### Símbolos do PLC (`plc.config.json`)

Comandos: `bCmdStart`, `bCmdStop`, `bCmdReset`.
Estado: `bRunning`, `bSensorS1`, `bSensorS2`, `bBottlePositioned`,
`bConveyorOn`, `bEvOn`, `bAtOn`, `nFillPercent`, `nBottlesFilled`,
`nBottlesCapped`, `nProductionTotal`, `sPlcVersion`.

Endereço ADS padrão: `39.90.64.65.1.1`, porta `851`, polling `200 ms`.

### Regras de negócio relevantes

- **EV (envase):** só atua com `bSensorS1` (garrafa presente) **e** esteira
  parada. Garantido em PLC, ponte Node e IHM (três camadas).
- **AT (tampagem):** só desce com `bSensorS2` **e** esteira parada; espelha a EV.
- **Produção total:** `min(envasadas, tampadas)` na ponte.
- Comandos só habilitados quando o runtime do PLC está em `Run`.

## Mapa de migração

| Original (`Projeto_Linha_Envase`) | Plataforma (`Plaforma_Industrial-4.0`) | Observação |
| --- | --- | --- |
| `PLC/MAIN.st`, `PLC/GVL_HMI.st` | `simulator/` + `gateway/` | Simulação da linha e gateway ADS/OPC-UA/Modbus para PLC real. |
| `server.js` (ponte ADS/WebSocket) | `backend/node-api/` | Separar ingestão, regras e consultas em API REST. |
| `src/state.js` (intertravamentos) | `backend/node-api/` | Regras de segurança e validação viram camada de domínio. |
| `IHM/` (index + js + css) | `dashboard/frontend/` | Evoluir para dashboard com histórico e indicadores. |
| `plc.config.json` | `gateway/plc.config.json` | Mapa de símbolos vira configuração do gateway. |
| Testes `test/` | `backend/`, `simulator/` | Migrar/expandir testes. |
| — | `database/` | Novo: PostgreSQL para telemetria e indicadores. |

## O que a plataforma acrescenta

- Persistência histórica (PostgreSQL) — o original só mantém estado em memória.
- Indicadores (OEE, disponibilidade, performance, qualidade) e histórico.
- Simulador desacoplado do PLC real.
- Infraestrutura reproduzível via Docker Compose.

## Como usar esta referência

1. Leia este documento antes de portar qualquer módulo.
2. Consulte os arquivos originais no caminho indicado (sem copiar cegamente).
3. Registre decisões de adaptação em [`DECISIONS.md`](../DECISIONS.md).
