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

Volumes criados antes do desgaste por horas precisam da migração 002. Ela acrescenta
`hours`, `last_timestamp` e `last_active` em `component_usage` e renomeia
`source_cycles` para `source_usage` em `maintenance_orders`:

```bash
psql -h localhost -U postgres -d industrial -f migrations/002_maintenance_hours.sql
```

A migração 001 deve ser aplicada antes da 002 em volumes antigos. Em instalações
novas, `schema.sql` já traz tudo e nenhuma migração é necessária.
