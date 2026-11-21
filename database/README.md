# Banco de Dados

PostgreSQL como banco principal da plataforma.

## Estrutura

- `schema.sql` — schema inicial (máquinas, telemetria, alertas e manutenção).
- `migrations/` — ajustes aplicados a volumes já existentes.
- `postgres/` — configuração e scripts auxiliares do PostgreSQL.

## Aplicando o schema

```bash
psql -h localhost -U postgres -d industrial -f schema.sql
```

## Migrando volumes existentes

Volumes criados antes da renomeação da outbox de ERP para SAP precisam rodar a
migração uma vez. Ela renomeia a tabela e o índice e converte os identificadores
e payloads antigos:

```bash
psql -h localhost -U postgres -d industrial -f migrations/001_rename_erp_to_sap.sql
```

Em instalações novas, `schema.sql` já cria `sap_outbox` e não precisa de
migração.
