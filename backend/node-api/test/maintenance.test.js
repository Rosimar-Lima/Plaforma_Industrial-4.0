'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeConfig,
  counterValue,
  usageRatio,
  componentStatus,
  maintenanceAlert,
  componentView,
} = require('../src/maintenance');

const component = {
  code: 'fill-valve',
  name: 'Válvula de envase',
  kind: 'valve',
  source: 'filled',
  mtbfCycles: 400,
  initialCycles: 0,
  parts: [],
};

test('normaliza configuração e descarta componentes inválidos', () => {
  const config = normalizeConfig({
    warnRatio: 0.7,
    components: [
      component,
      { code: 'sem-mtbf', name: 'Inválido', mtbfCycles: 0 },
      { name: 'Sem código', mtbfCycles: 10 },
    ],
  });

  assert.equal(config.warnRatio, 0.7);
  assert.equal(config.components.length, 1);
  assert.equal(config.components[0].code, 'fill-valve');
  assert.equal(config.components[0].parts.length, 0);
});

test('limita warnRatio e usa padrão quando inválido', () => {
  assert.equal(normalizeConfig({ warnRatio: 2 }).warnRatio, 0.99);
  assert.equal(normalizeConfig({ warnRatio: 0 }).warnRatio, 0.1);
  assert.equal(normalizeConfig({}).warnRatio, 0.8);
});

test('lê o contador conforme a fonte do componente', () => {
  const production = { filled: 10, capped: 8, total: 9 };

  assert.equal(counterValue(production, 'filled'), 10);
  assert.equal(counterValue(production, 'capped'), 8);
  assert.equal(counterValue(production, 'total'), 9);
  assert.equal(counterValue(production, 'desconhecida'), 0);
  assert.equal(counterValue(undefined, 'filled'), 0);
});

test('classifica vida útil em ok, atenção e crítico', () => {
  assert.equal(componentStatus(100, component), 'ok');
  assert.equal(componentStatus(319, component), 'ok');
  assert.equal(componentStatus(320, component), 'warning');
  assert.equal(componentStatus(399, component), 'warning');
  assert.equal(componentStatus(400, component), 'critical');
  assert.equal(componentStatus(500, component), 'critical');
});

test('gera alerta de vida útil apenas a partir da atenção', () => {
  assert.equal(maintenanceAlert(component, 100), null);

  const warning = maintenanceAlert(component, 340);
  assert.equal(warning.sensorCode, 'maintenance.fill-valve');
  assert.equal(warning.severity, 'warning');
  assert.match(warning.message, /85%/);

  const critical = maintenanceAlert(component, 400);
  assert.equal(critical.severity, 'critical');
  assert.match(critical.message, /esgotada/);
});

test('monta visão do componente com razão e ciclos restantes', () => {
  const view = componentView(component, 350);

  assert.equal(view.usageRatio, 0.875);
  assert.equal(view.remainingCycles, 50);
  assert.equal(view.status, 'warning');
  assert.equal(usageRatio(350, component), 0.875);
});

test('limita a razão exibida a 100%', () => {
  const view = componentView(component, 500);

  assert.equal(view.usageRatio, 1);
  assert.equal(view.remainingCycles, 0);
  assert.equal(view.status, 'critical');
});
