-- Diferencia o desgaste por ciclos (válvulas) do desgaste por horas de esteira.
-- Aplicar uma vez em volumes criados antes desta mudança. Em instalações novas,
-- database/schema.sql já traz as colunas abaixo.

ALTER TABLE component_usage
    ADD COLUMN IF NOT EXISTS hours NUMERIC(14,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_timestamp TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_active BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'maintenance_orders'
          AND column_name = 'source_cycles'
    ) THEN
        ALTER TABLE maintenance_orders RENAME COLUMN source_cycles TO source_usage;
    END IF;
END $$;

ALTER TABLE maintenance_orders
    ALTER COLUMN source_usage TYPE NUMERIC(14,3);

-- O valor antigo de source_cycles permanece como uso na origem.
-- O código decide a unidade (ciclos ou horas) pelo componente da OS.
