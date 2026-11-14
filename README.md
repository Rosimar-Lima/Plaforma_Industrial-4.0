# Plataforma Industrial 4.0

Plataforma para coleta, processamento e visualização de dados industriais (telemetria de máquinas, indicadores de produção e alertas), seguindo os princípios da Indústria 4.0.

A plataforma nasceu como evolução do projeto Linha de Envase desenvolvido no curso de Engenharia Mecatrônica, ampliando o foco do controle da máquina para monitoramento, armazenamento histórico, indicadores operacionais e análise de desempenho industrial.

O projeto foi concebido para funcionar tanto com equipamentos reais quanto com simuladores, permitindo demonstração, testes e desenvolvimento sem dependência de hardware industrial.

Plataforma para coleta, processamento e visualização de dados industriais
(telemetria de máquinas, indicadores de produção e alertas), seguindo os
princípios da Indústria 4.0.

## Visão geral

| Diretório | Descrição |
| --- | --- |
| `simulator/` | Simulador de PLC que publica telemetria de sensores. |
| `backend/` | API de ingestão, regras de negócio e consultas. |
| `dashboard/` | Interface web para monitoramento e indicadores. |
| `database/` | Schema e configuração do PostgreSQL. |
| `docs/` | Requisitos, casos de uso, indicadores e glossário. |
| `diagrams/` | Diagramas de arquitetura, sequência e implantação. |

## Documentação

| Documento | Descrição |
| --- | --- |
| [PROJECT_CHARTER.md](PROJECT_CHARTER.md) | Objetivos, escopo e stakeholders. |
| [ROADMAP.md](ROADMAP.md) | Fases e entregas planejadas. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Visão arquitetural. |
| [DECISIONS.md](DECISIONS.md) | Registro de decisões de arquitetura (ADR). |
| [docs/](docs/) | Requisitos, indicadores, casos de uso e glossário. |

## Começando

```bash
cp .env.example .env
docker compose up -d
```

## Licença

MIT — consulte [LICENSE](LICENSE).
