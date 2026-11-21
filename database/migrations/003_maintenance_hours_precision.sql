-- Amostras de telemetria a cada 1 s produzem incrementos de horas menores que
-- 0,001 h. A precisão de 3 casas perdia esses incrementos e o cartão parecia
-- parado. Em volumes que já aplicaram a migração 002, ampliar para 6 casas.

ALTER TABLE component_usage
    ALTER COLUMN hours TYPE NUMERIC(14,6);

ALTER TABLE maintenance_orders
    ALTER COLUMN source_usage TYPE NUMERIC(14,6);
