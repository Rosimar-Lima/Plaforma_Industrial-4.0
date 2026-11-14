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
