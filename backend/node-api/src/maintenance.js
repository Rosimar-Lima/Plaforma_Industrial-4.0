'use strict';

const fs = require('node:fs');

const DEFAULT_WARN_RATIO = 0.8;
const USAGE_SOURCES = Object.freeze(['filled', 'capped', 'total']);

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
  const mtbfCycles = Number(raw.mtbfCycles);
  const initialCycles = Number(raw.initialCycles);

  if (!code || !name || !Number.isFinite(mtbfCycles) || mtbfCycles <= 0) return null;

  return {
    code: code.slice(0, 50),
    name: name.slice(0, 120),
    kind: typeof raw.kind === 'string' && raw.kind.trim() ? raw.kind.trim() : 'component',
    source: USAGE_SOURCES.includes(raw.source) ? raw.source : 'total',
    mtbfCycles,
    initialCycles: Number.isFinite(initialCycles) ? Math.max(0, initialCycles) : 0,
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

function counterValue(production, source = 'total') {
  const value = Number(production?.[source]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function usageRatio(cycles, component) {
  if (!component || !(component.mtbfCycles > 0)) return 0;
  return Math.max(0, Number(cycles) || 0) / component.mtbfCycles;
}

function componentStatus(cycles, component, warnRatio = DEFAULT_WARN_RATIO) {
  const ratio = usageRatio(cycles, component);
  if (ratio >= 1) return 'critical';
  if (ratio >= warnRatio) return 'warning';
  return 'ok';
}

function maintenanceAlert(component, cycles) {
  const ratio = usageRatio(cycles, component);
  const status = componentStatus(cycles, component);

  if (status === 'ok') return null;

  const percent = Math.round(ratio * 100);
  return {
    sensorCode: `maintenance.${component.code}`.slice(0, 50),
    severity: status === 'critical' ? 'critical' : 'warning',
    message:
      status === 'critical'
        ? `Vida útil de ${component.name} esgotada (${cycles}/${component.mtbfCycles} ciclos).`
        : `Vida útil de ${component.name} em ${percent}% (${cycles}/${component.mtbfCycles} ciclos).`,
  };
}

function componentView(component, cycles, warnRatio = DEFAULT_WARN_RATIO) {
  const ratio = usageRatio(cycles, component);
  return {
    code: component.code,
    name: component.name,
    kind: component.kind,
    source: component.source,
    cycles,
    mtbfCycles: component.mtbfCycles,
    usageRatio: Math.round(Math.min(ratio, 1) * 10000) / 10000,
    remainingCycles: Math.max(0, component.mtbfCycles - cycles),
    status: componentStatus(cycles, component, warnRatio),
  };
}

module.exports = {
  DEFAULT_WARN_RATIO,
  USAGE_SOURCES,
  normalizeConfig,
  normalizeComponent,
  normalizePart,
  loadMaintenanceConfig,
  counterValue,
  usageRatio,
  componentStatus,
  maintenanceAlert,
  componentView,
};
