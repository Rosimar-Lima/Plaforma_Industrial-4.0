# Banco de Dados

PostgreSQL como banco principal da plataforma.

## Estrutura

- `schema.sql` — schema inicial (máquinas, sensores, telemetria e alertas).
- `postgres/` — configuração e scripts auxiliares do PostgreSQL.

## Aplicando o schema

```bash
psql -h localhost -U postgres -d industrial -f schema.sql
```
