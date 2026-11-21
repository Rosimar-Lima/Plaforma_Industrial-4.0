-- Contadores da Linha de Envase zeram quando a linha é resetada. A PI40 deve
-- continuar mostrando o contador atual zerado, mas não pode perder a produção
-- já acumulada. Esta tabela guarda o total consolidado por máquina.

CREATE TABLE IF NOT EXISTS production_totals (
    machine_id           BIGINT PRIMARY KEY REFERENCES machines (id) ON DELETE CASCADE,
    accumulated_produced BIGINT NOT NULL DEFAULT 0,
    accumulated_good     BIGINT NOT NULL DEFAULT 0,
    last_counter         BIGINT NOT NULL DEFAULT 0,
    last_good_counter    BIGINT NOT NULL DEFAULT 0,
    last_reset_at        TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Volumes que já receberam telemetria não começam do zero: o acumulado inicial
-- é o último contador conhecido. As amostras antigas permanecem em `production`.
INSERT INTO production_totals (
    machine_id, accumulated_produced, accumulated_good,
    last_counter, last_good_counter, updated_at
)
SELECT machine_id,
       COALESCE(MAX(produced), 0),
       COALESCE(MAX(good), 0),
       COALESCE(MAX(produced), 0),
       COALESCE(MAX(good), 0),
       MAX(recorded_at)
  FROM production
 GROUP BY machine_id
ON CONFLICT (machine_id) DO NOTHING;
