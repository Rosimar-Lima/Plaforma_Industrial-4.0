'use strict';

const fs = require('node:fs');

const DEFAULT_WARN_RATIO = 0.8;
const USAGE_METRICS = Object.freeze(['cycles', 'hours']);
const COUNTER_SOURCES = Object.freeze(['filled', 'capped', 'total']);
const HOUR_SOURCES = Object.freeze(['conveyor', 'running']);
const MAX_HOURS_PER_SAMPLE = 1;

function toRatio(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(0.99, Math.max(0.1, number));
}

function normalizePart(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const quantity = Number(raw.quantity);

  if (!code || !name || !Number.isInteger(quantity) || quantity < 1) return null;

  return { code: code.slice(0, 50), name: name.slice(0, 120), quantity };
}

function normalizeComponent(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const metric = USAGE_METRICS.includes(raw.metric) ? raw.metric : 'cycles';
  const sources = metric === 'hours' ? HOUR_SOURCES : COUNTER_SOURCES;
  const source = sources.includes(raw.source) ? raw.source : sources[0];

  const rawMtbf = metric === 'hours' ? raw.mtbfHours : raw.mtbfCycles;
  const rawInitial = metric === 'hours' ? raw.initialHours : raw.initialCycles;
  const mtbf = Number(rawMtbf);

  if (!code || !name || !Number.isFinite(mtbf) || mtbf <= 0) return null;

  const initial = Number(rawInitial);

  return {
    code: code.slice(0, 50),
    name: name.slice(0, 120),
    kind: typeof raw.kind === 'string' && raw.kind.trim() ? raw.kind.trim() : 'component',
    metric,
    source,
    unit: metric === 'hours' ? 'h' : 'ciclos',
    mtbf,
    initial: Number.isFinite(initial) ? Math.max(0, initial) : 0,
    parts: Array.isArray(raw.parts) ? raw.parts.map(normalizePart).filter(Boolean) : [],
  };
}

function normalizeConfig(raw) {
  return {
    warnRatio: toRatio(raw?.warnRatio, DEFAULT_WARN_RATIO),
    components: Array.isArray(raw?.components)
      ? raw.components.map(normalizeComponent).filter(Boolean)
      : [],
  };
}

function loadMaintenanceConfig(filePath) {
  if (!filePath) return null;

  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    console.warn(`Configuração de manutenção indisponível (${filePath}): ${error.message}`);
    return null;
  }
}

function counterValue(production, source = 'filled') {
  const value = Number(production?.[source]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// Componentes de esteira desgastam com o movimento, não com garrafas produzidas.
// A origem "conveyor" usa a esteira ligada; "running" usa a linha em operação.
function usageSignal(line, source = 'conveyor') {
  if (source === 'running') return Boolean(line?.running);
  if (source === 'conveyor') return Boolean(line?.conveyorOn);
  return false;
}

// Considera o intervalo entre amostras como tempo de uso quando a amostra
// anterior indicava o acionamento ligado. O limite evita contar paradas longas.
function hourDelta(previous, timestamp) {
  const last = new Date(previous?.lastTimestamp);
  const current = new Date(timestamp);
  if (!previous?.lastActive) return 0;
  if (Number.isNaN(last.getTime()) || Number.isNaN(current.getTime())) return 0;

  const elapsedMs = current.getTime() - last.getTime();
  if (elapsedMs <= 0) return 0;

  return Math.min(elapsedMs / 3600000, MAX_HOURS_PER_SAMPLE);
}

function formatUsage(value, component) {
  const number = Number(value) || 0;
  return component?.metric === 'hours'
    ? `${number.toFixed(1).replace('.', ',')} h`
    : `${Math.round(number)} ciclos`;
}

function usageRatio(usage, component) {
  if (!component || !(component.mtbf > 0)) return 0;
  return Math.max(0, Number(usage) || 0) / component.mtbf;
}

function componentStatus(usage, component, warnRatio = DEFAULT_WARN_RATIO) {
  const ratio = usageRatio(usage, component);
  if (ratio >= 1) return 'critical';
  if (ratio >= warnRatio) return 'warning';
  return 'ok';
}

function maintenanceAlert(component, usage) {
  const ratio = usageRatio(usage, component);
  const status = componentStatus(usage, component);

  if (status === 'ok') return null;

  const percent = Math.round(ratio * 100);
  const used = formatUsage(usage, component);
  const limit = formatUsage(component.mtbf, component);

  return {
    sensorCode: `maintenance.${component.code}`.slice(0, 50),
    severity: status === 'critical' ? 'critical' : 'warning',
    message:
      status === 'critical'
        ? `Vida útil de ${component.name} esgotada (${used}/${limit}).`
        : `Vida útil de ${component.name} em ${percent}% (${used}/${limit}).`,
  };
}

function componentView(component, usage, warnRatio = DEFAULT_WARN_RATIO) {
  const ratio = usageRatio(usage, component);
  const value = Math.max(0, Number(usage) || 0);

  return {
    code: component.code,
    name: component.name,
    kind: component.kind,
    metric: component.metric,
    source: component.source,
    unit: component.unit,
    usage: value,
    mtbf: component.mtbf,
    usageRatio: Math.round(Math.min(ratio, 1) * 10000) / 10000,
    remaining: Math.max(0, component.mtbf - value),
    status: componentStatus(value, component, warnRatio),
  };
}

module.exports = {
  DEFAULT_WARN_RATIO,
  USAGE_METRICS,
  COUNTER_SOURCES,
  HOUR_SOURCES,
  normalizeConfig,
  normalizeComponent,
  normalizePart,
  loadMaintenanceConfig,
  counterValue,
  usageSignal,
  hourDelta,
  formatUsage,
  usageRatio,
  componentStatus,
  maintenanceAlert,
  componentView,
};
