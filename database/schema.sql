-- Schema inicial da Plataforma Industrial 4.0

CREATE TABLE IF NOT EXISTS machines (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(50) NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    location    VARCHAR(120),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sensors (
    id          BIGSERIAL PRIMARY KEY,
    machine_id  BIGINT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
    code        VARCHAR(50) NOT NULL,
    unit        VARCHAR(20),
    min_value   NUMERIC(12, 4),
    max_value   NUMERIC(12, 4),
    UNIQUE (machine_id, code)
);

CREATE TABLE IF NOT EXISTS telemetry (
    id          BIGSERIAL PRIMARY KEY,
    machine_id  BIGINT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL,
    payload     JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_machine_time
    ON telemetry (machine_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS production (
    id           BIGSERIAL PRIMARY KEY,
    machine_id   BIGINT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
    recorded_at  TIMESTAMPTZ NOT NULL,
    produced     INTEGER NOT NULL DEFAULT 0,
    good         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_production_machine_time
    ON production (machine_id, recorded_at DESC);

-- Acumulado que sobrevive ao reset dos contadores da linha. A tabela
-- `production` continua guardando o histórico por amostra; aqui fica o total
-- consolidado exibido no dashboard.
CREATE TABLE IF NOT EXISTS production_totals (
    machine_id           BIGINT PRIMARY KEY REFERENCES machines (id) ON DELETE CASCADE,
    accumulated_produced BIGINT NOT NULL DEFAULT 0,
    accumulated_good     BIGINT NOT NULL DEFAULT 0,
    last_counter         BIGINT NOT NULL DEFAULT 0,
    last_good_counter    BIGINT NOT NULL DEFAULT 0,
    last_reset_at        TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
    id          BIGSERIAL PRIMARY KEY,
    machine_id  BIGINT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
    sensor_code VARCHAR(50) NOT NULL,
    message     TEXT NOT NULL,
    severity    VARCHAR(20) NOT NULL DEFAULT 'warning',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_machine
    ON alerts (machine_id, created_at DESC);

-- =====================================================
-- Manutenção preventiva baseada em uso
-- =====================================================

CREATE TABLE IF NOT EXISTS component_usage (
    machine_id     BIGINT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
    component_code VARCHAR(50) NOT NULL,
    cycles         BIGINT NOT NULL DEFAULT 0,
    last_counter   BIGINT NOT NULL DEFAULT 0,
    hours          NUMERIC(14,6) NOT NULL DEFAULT 0,
    last_timestamp TIMESTAMPTZ,
    last_active    BOOLEAN NOT NULL DEFAULT false,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (machine_id, component_code)
);

CREATE TABLE IF NOT EXISTS maintenance_orders (
    id             BIGSERIAL PRIMARY KEY,
    machine_id     BIGINT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
    component_code VARCHAR(50) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'planned',
    priority       VARCHAR(20) NOT NULL DEFAULT 'high',
    source_usage   NUMERIC(14,6) NOT NULL DEFAULT 0,
    due_at         TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_maintenance_orders_machine
    ON maintenance_orders (machine_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_orders_active
    ON maintenance_orders (machine_id, component_code)
    WHERE status IN ('planned', 'open', 'in_progress');

CREATE TABLE IF NOT EXISTS maintenance_order_parts (
    id         BIGSERIAL PRIMARY KEY,
    order_id   BIGINT NOT NULL REFERENCES maintenance_orders (id) ON DELETE CASCADE,
    part_code  VARCHAR(50) NOT NULL,
    part_name  VARCHAR(120) NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 1,
    status     VARCHAR(20) NOT NULL DEFAULT 'reserved',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_parts_order
    ON maintenance_order_parts (order_id, id);

CREATE TABLE IF NOT EXISTS sap_outbox (
    id          BIGSERIAL PRIMARY KEY,
    order_id    BIGINT NOT NULL REFERENCES maintenance_orders (id) ON DELETE CASCADE,
    event_type  VARCHAR(60) NOT NULL,
    payload     JSONB NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'sent',
    external_id VARCHAR(80),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sap_outbox_order
    ON sap_outbox (order_id, created_at DESC);
