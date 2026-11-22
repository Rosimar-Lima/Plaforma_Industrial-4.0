'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeConfig,
  counterValue,
  usageSignal,
  hourDelta,
  nextHourUsage,
  formatUsage,
  usageRatio,
  componentStatus,
  maintenanceAlert,
  componentView,
} = require('../src/maintenance');

const valve = {
  code: 'fill-valve',
  name: 'Válvula de envase',
  sapControlNumber: '1001013',
  kind: 'valve',
  metric: 'cycles',
  source: 'filled',
  unit: 'ciclos',
  mtbf: 400,
  initial: 0,
  parts: [],
};

const bearing = {
  code: 'conveyor-bearing',
  name: 'Rolamento da esteira',
  sapControlNumber: '1001011',
  kind: 'bearing',
  metric: 'hours',
  source: 'conveyor',
  unit: 'h',
  mtbf: 200,
  initial: 160,
  parts: [],
};

test('normaliza configuração e descarta componentes inválidos', () => {
  const config = normalizeConfig({
    warnRatio: 0.7,
    components: [
      { code: 'fill-valve', name: 'Válvula', metric: 'cycles', source: 'filled', mtbfCycles: 400 },
      { code: 'sem-mtbf', name: 'Inválido', mtbfCycles: 0 },
      { name: 'Sem código', mtbfCycles: 10 },
    ],
  });

  assert.equal(config.warnRatio, 0.7);
  assert.equal(config.components.length, 1);
  assert.equal(config.components[0].code, 'fill-valve');
  assert.equal(config.components[0].metric, 'cycles');
  assert.equal(config.components[0].unit, 'ciclos');
  assert.equal(config.components[0].parts.length, 0);
});

test('cada componente recebe um número de controle SAP fixo de 7 dígitos', () => {
  const config = normalizeConfig({
    components: [
      {
        code: 'fill-valve',
        name: 'Válvula de envase',
        sapControlNumber: '1001013',
        metric: 'cycles',
        mtbfCycles: 400,
      },
      {
        code: 'cap-valve',
        name: 'Válvula de tampagem',
        sapControlNumber: 1001014,
        metric: 'cycles',
        mtbfCycles: 350,
      },
      {
        code: 'conveyor-bearing',
        name: 'Rolamento sem número informado',
        metric: 'hours',
        mtbfHours: 200,
      },
      {
        code: 'desconhecido',
        name: 'Sem número cadastrado',
        metric: 'cycles',
        mtbfCycles: 100,
      },
    ],
  });

  assert.deepEqual(
    config.components.map((component) => component.sapControlNumber),
    ['1001013', '1001014', '1001011', null]
  );
});

test('limita warnRatio e usa padrão quando inválido', () => {
  assert.equal(normalizeConfig({ warnRatio: 2 }).warnRatio, 0.99);
  assert.equal(normalizeConfig({ warnRatio: 0 }).warnRatio, 0.1);
  assert.equal(normalizeConfig({}).warnRatio, 0.8);
});

test('normaliza componente de horas com origem da esteira', () => {
  const config = normalizeConfig({
    components: [
      {
        code: 'conveyor-bearing',
        name: 'Rolamento',
        metric: 'hours',
        source: 'conveyor',
        mtbfHours: 200,
        initialHours: 160,
      },
    ],
  });

  assert.equal(config.components[0].metric, 'hours');
  assert.equal(config.components[0].source, 'conveyor');
  assert.equal(config.components[0].unit, 'h');
  assert.equal(config.components[0].mtbf, 200);
  assert.equal(config.components[0].initial, 160);
  assert.equal(config.components[0].timeScale, 1);
});

test('normaliza a escala virtual de tempo para horas', () => {
  const config = normalizeConfig({
    components: [
      {
        code: 'conveyor-motor',
        name: 'Motor',
        metric: 'hours',
        mtbfHours: 300,
        timeScale: 60,
      },
    ],
  });

  assert.equal(config.components[0].timeScale, 60);
});

test('componente de horas ignora campos de ciclos e vice-versa', () => {
  const config = normalizeConfig({
    components: [
      { code: 'a', name: 'A', metric: 'hours', mtbfCycles: 10, initialCycles: 5 },
      { code: 'b', name: 'B', mtbfHours: 10, initialHours: 5 },
    ],
  });

  assert.equal(config.components.length, 0);
});

test('lê o contador conforme a fonte do componente', () => {
  const production = { filled: 10, capped: 8, total: 9 };

  assert.equal(counterValue(production, 'filled'), 10);
  assert.equal(counterValue(production, 'capped'), 8);
  assert.equal(counterValue(production, 'total'), 9);
  assert.equal(counterValue(production, 'desconhecida'), 0);
  assert.equal(counterValue(undefined, 'filled'), 0);
});

test('sinal de uso por horas vem da esteira ou da linha', () => {
  const line = { conveyorOn: true, running: false };

  assert.equal(usageSignal(line, 'conveyor'), true);
  assert.equal(usageSignal(line, 'running'), false);
  assert.equal(usageSignal(line, 'outra'), false);
  assert.equal(usageSignal(undefined, 'conveyor'), false);
});

test('acumula horas somente se a amostra anterior estava acionada', () => {
  const timestamp = '2026-01-01T01:00:00.000Z';
  const previous = {
    lastActive: true,
    lastTimestamp: '2026-01-01T00:30:00.000Z',
  };

  assert.equal(hourDelta(previous, timestamp), 0.5);
  assert.equal(hourDelta({ ...previous, lastActive: false }, timestamp), 0);
  assert.equal(hourDelta({ ...previous, lastTimestamp: timestamp }, timestamp), 0);
  assert.equal(hourDelta({ ...previous, lastTimestamp: 'invalida' }, timestamp), 0);
});

test('aplica a escala virtual ao intervalo entre amostras', () => {
  const previous = {
    lastActive: true,
    lastTimestamp: '2026-01-01T00:00:00.000Z',
  };
  const timestamp = '2026-01-01T00:00:01.000Z';

  assert.equal(hourDelta(previous, timestamp), 1 / 3600);
  assert.equal(hourDelta(previous, timestamp, 60), 60 / 3600);
});

test('limita a 1 hora o intervalo entre amostras', () => {
  const delta = hourDelta(
    { lastActive: true, lastTimestamp: '2026-01-01T00:00:00.000Z' },
    '2026-01-05T00:00:00.000Z',
    60
  );

  assert.equal(delta, 1);
});

test('usa horas iniciais quando a linha vem do modelo antigo', () => {
  const migratedRow = {
    hours: 0,
    lastTimestamp: null,
    lastActive: false,
  };

  assert.equal(
    nextHourUsage(migratedRow, bearing, '2026-01-01T01:00:00.000Z'),
    160
  );
  assert.equal(nextHourUsage(null, bearing, '2026-01-01T01:00:00.000Z'), 160);
});

test('acumula horas a partir de uma linha já inicializada', () => {
  const row = {
    hours: 160,
    lastTimestamp: '2026-01-01T00:30:00.000Z',
    lastActive: true,
  };

  assert.equal(
    nextHourUsage(row, bearing, '2026-01-01T01:00:00.000Z'),
    160.5
  );
});

test('acumula horas com a escala virtual do componente', () => {
  const row = {
    hours: 160,
    lastTimestamp: '2026-01-01T00:00:00.000Z',
    lastActive: true,
  };

  assert.equal(
    nextHourUsage(row, { ...bearing, timeScale: 60 }, '2026-01-01T00:00:01.000Z'),
    160 + 60 / 3600
  );
});

test('formata uso conforme a unidade do componente', () => {
  assert.equal(formatUsage(340, valve), '340 ciclos');
  assert.equal(formatUsage(160.25, bearing), '160,3 h');
  assert.equal(formatUsage(200, bearing), '200,0 h');
});

test('classifica vida útil em ok, atenção e crítico', () => {
  assert.equal(componentStatus(100, valve), 'ok');
  assert.equal(componentStatus(319, valve), 'ok');
  assert.equal(componentStatus(320, valve), 'warning');
  assert.equal(componentStatus(399, valve), 'warning');
  assert.equal(componentStatus(400, valve), 'critical');
  assert.equal(componentStatus(500, valve), 'critical');
});

test('gera alerta de vida útil apenas a partir da atenção', () => {
  assert.equal(maintenanceAlert(valve, 100), null);

  const warning = maintenanceAlert(valve, 340);
  assert.equal(warning.sensorCode, 'maintenance.fill-valve');
  assert.equal(warning.severity, 'warning');
  assert.match(warning.message, /85%/);
  assert.match(warning.message, /340 ciclos\/400 ciclos/);

  const critical = maintenanceAlert(valve, 400);
  assert.equal(critical.severity, 'critical');
  assert.match(critical.message, /esgotada/);
});

test('alerta de componente de horas usa horas na mensagem', () => {
  const warning = maintenanceAlert(bearing, 170);

  assert.equal(warning.severity, 'warning');
  assert.match(warning.message, /170,0 h\/200,0 h/);
  assert.doesNotMatch(warning.message, /ciclos/);
});

test('monta visão do componente com razão e uso restante', () => {
  const view = componentView(valve, 350);

  assert.equal(view.usageRatio, 0.875);
  assert.equal(view.remaining, 50);
  assert.equal(view.sapControlNumber, '1001013');
  assert.equal(view.unit, 'ciclos');
  assert.equal(view.metric, 'cycles');
  assert.equal(view.status, 'warning');
  assert.equal(usageRatio(350, valve), 0.875);
});

test('monta visão de horas com unidade correta', () => {
  const view = componentView(bearing, 170);

  assert.equal(view.usageRatio, 0.85);
  assert.equal(view.remaining, 30);
  assert.equal(view.unit, 'h');
  assert.equal(view.metric, 'hours');
  assert.equal(view.status, 'warning');
});

test('limita a razão exibida a 100%', () => {
  const view = componentView(valve, 500);

  assert.equal(view.usageRatio, 1);
  assert.equal(view.remaining, 0);
  assert.equal(view.status, 'critical');
});
