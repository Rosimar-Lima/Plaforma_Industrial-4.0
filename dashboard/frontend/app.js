'use strict';

const POLL_TELEMETRY_MS = 3000;
const POLL_OEE_MS = 15000;
const POLL_ALERTS_MS = 15000;
const POLL_MAINTENANCE_MS = 15000;
const POLL_PRODUCTION_MS = 15000;
const TELEMETRY_LIMIT = 120;
const BOTTLE_VOLUME_ML = 300;

const SEVERITY_LABELS = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Info',
};

const MAINTENANCE_STATUS_LABELS = {
  ok: 'OK',
  warning: 'Atenção',
  critical: 'Crítico',
  planned: 'Planejada',
  open: 'Aberta',
  in_progress: 'Em execução',
  completed: 'Concluída',
};

const PRIORITY_LABELS = {
  high: 'Alta',
  critical: 'Crítica',
};

const state = {
  machines: [],
  machineId: null,
  machineCode: null,
  periodMinutes: 60,
  productionBucket: 'hour',
  samples: [],
  lastSamples: [],
  alerts: [],
  stream: null,
  streamOnline: false,
  pollOk: false,
};

const el = {
  machineSelect: document.getElementById('machine-select'),
  periodSelect: document.getElementById('period-select'),
  refresh: document.getElementById('refresh'),
  connection: document.getElementById('connection'),
  lastUpdate: document.getElementById('last-update'),
  running: document.getElementById('stat-running'),
  filled: document.getElementById('prod-filled'),
  capped: document.getElementById('prod-capped'),
  total: document.getElementById('prod-total'),
  chart: document.getElementById('chart'),
  chartEmpty: document.getElementById('chart-empty'),
  chartSummary: document.getElementById('chart-summary'),
  oeePeriod: document.getElementById('oee-period'),
  oee: document.getElementById('oee-value'),
  oeeBar: document.getElementById('oee-bar'),
  availability: document.getElementById('oee-availability'),
  availabilityBar: document.getElementById('oee-availability-bar'),
  performance: document.getElementById('oee-performance'),
  performanceBar: document.getElementById('oee-performance-bar'),
  quality: document.getElementById('oee-quality'),
  qualityBar: document.getElementById('oee-quality-bar'),
  produced: document.getElementById('oee-produced'),
  good: document.getElementById('oee-good'),
  operating: document.getElementById('oee-operating'),
  capacity: document.getElementById('oee-capacity'),
  productionBucket: document.getElementById('production-bucket'),
  productionSummary: document.getElementById('production-summary'),
  productionBody: document.getElementById('production-body'),
  productionEmpty: document.getElementById('production-empty'),
  alertsList: document.getElementById('alerts-list'),
  alertsCount: document.getElementById('alerts-count'),
  alertsEmpty: document.getElementById('alerts-empty'),
  maintenanceSummary: document.getElementById('maintenance-summary'),
  maintenanceComponents: document.getElementById('maintenance-components'),
  maintenanceEmpty: document.getElementById('maintenance-empty'),
  maintenanceOrdersBody: document.getElementById('maintenance-orders-body'),
  maintenanceOrdersEmpty: document.getElementById('maintenance-orders-empty'),
};

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  return response.json();
}

function updateConnection() {
  let label = 'Offline';
  let mode = 'offline';

  if (state.streamOnline) {
    label = 'Tempo real';
    mode = 'online';
  } else if (state.pollOk) {
    label = 'Polling';
    mode = 'polling';
  }

  el.connection.textContent = label;
  el.connection.classList.remove('online', 'polling', 'offline');
  el.connection.classList.add(mode);
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

function formatPercent(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return '—';
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '0 min';
  const totalMinutes = Math.round(value / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function setRatio(valueEl, barEl, ratio) {
  const safe = Number.isFinite(Number(ratio)) ? Math.max(0, Math.min(1, Number(ratio))) : 0;
  valueEl.textContent = formatPercent(safe);
  barEl.style.width = `${(safe * 100).toFixed(1)}%`;
}

function setBoolean(elmt, active, activeLabel, inactiveLabel) {
  elmt.textContent = active ? activeLabel : inactiveLabel;
  elmt.style.color = active ? 'var(--ok)' : 'var(--muted)';
}

function renderPlaceholders() {
  el.running.textContent = '—';
  el.filled.textContent = '0';
  el.capped.textContent = '0';
  el.total.textContent = '0';
  el.lastUpdate.textContent = 'sem dados';
}

function renderTelemetry(samples) {
  const latest = samples[0];
  if (!latest) {
    renderPlaceholders();
    drawChart([]);
    return;
  }

  const line = latest.payload?.line ?? {};
  const production = latest.payload?.production ?? {};

  setBoolean(el.running, line.running, 'Em operação', 'Parada');

  el.filled.textContent = formatNumber(production.filled);
  el.capped.textContent = formatNumber(production.capped);
  el.total.textContent = formatNumber(production.total);

  const recordedAt = new Date(latest.recorded_at);
  el.lastUpdate.textContent = Number.isNaN(recordedAt.getTime())
    ? 'agora'
    : `atualizado às ${recordedAt.toLocaleTimeString('pt-BR')}`;

  const ascending = [...samples].reverse();
  state.lastSamples = ascending;
  drawChart(ascending);
}

function formatLiters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const formatted = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 1,
  }).format(number);
  return `${formatted} L`;
}

function niceCeil(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function volumePoints(samples) {
  const points = [];
  let lastCount = null;
  let totalBottles = 0;

  for (const sample of samples) {
    const count = Number(sample.payload?.production?.filled);
    if (!Number.isFinite(count)) continue;

    if (lastCount === null) totalBottles = count;
    else if (count >= lastCount) totalBottles += count - lastCount;
    lastCount = count;

    const at = Date.parse(sample.recorded_at);
    points.push({
      at: Number.isNaN(at) ? null : at,
      liters: (totalBottles * BOTTLE_VOLUME_ML) / 1000,
    });
  }

  return points;
}

function drawChart(samples) {
  const canvas = el.chart;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 600;
  const height = 180;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const points = volumePoints(samples);
  el.chartEmpty.style.display = points.length > 0 ? 'none' : 'block';
  el.chartSummary.textContent = points.length
    ? `últimas ${points.length} amostras · ${formatLiters(points[points.length - 1].liters)}`
    : '—';
  if (points.length === 0) return;

  const pad = { left: 58, right: 16, top: 16, bottom: 26 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const axisMax = niceCeil(Math.max(...points.map((point) => point.liters)));

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;

  for (const level of [0, 25, 50, 75, 100]) {
    const y = pad.top + (1 - level / 100) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(formatLiters((axisMax * level) / 100), 6, y + 4);
  }

  const x = (index) =>
    pad.left +
    (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value) =>
    pad.top + (1 - Math.max(0, Math.min(axisMax, value)) / axisMax) * plotHeight;

  ctx.beginPath();
  points.forEach((point, index) => {
    const px = x(index);
    const py = y(point.liters);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(x(points.length - 1), pad.top + plotHeight);
  ctx.lineTo(x(0), pad.top + plotHeight);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotHeight);
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
  gradient.addColorStop(1, 'rgba(56, 189, 248, 0.02)');
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    const px = x(index);
    const py = y(point.liters);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.stroke();

  const timeLabel = (at) =>
    at === null
      ? ''
      : new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  ctx.fillText(timeLabel(points[0].at), pad.left, height - 7);
  ctx.textAlign = 'right';
  ctx.fillText(timeLabel(points[points.length - 1].at), width - pad.right, height - 7);
  ctx.textAlign = 'left';
}

function renderOee(data) {
  setRatio(el.oee, el.oeeBar, data.oee);
  setRatio(el.availability, el.availabilityBar, data.availability);
  setRatio(el.performance, el.performanceBar, data.performance);
  setRatio(el.quality, el.qualityBar, data.quality);

  el.produced.textContent = formatNumber(data.produced);
  el.good.textContent = formatNumber(data.good);
  el.operating.textContent = formatDuration(data.operatingTimeMs);
  el.capacity.textContent = `${formatNumber(data.nominalCapacityPerHour)} peças/h`;
  el.oeePeriod.textContent = `últimos ${state.periodMinutes} min`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ratioClass(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return '';
  if (value >= 0.85) return 'high';
  if (value >= 0.6) return 'mid';
  return 'low';
}

function renderProduction(data) {
  const buckets = data?.buckets ?? [];
  const totals = data?.totals ?? null;

  el.productionBody.innerHTML = '';
  el.productionEmpty.style.display = buckets.length === 0 ? 'block' : 'none';

  if (!totals || totals.plannedTimeMs === 0) {
    el.productionSummary.textContent = '—';
  } else {
    el.productionSummary.textContent =
      `${formatNumber(totals.produced)} peças · ` +
      `${formatPercent(totals.availability)} disponibilidade · ` +
      `${formatPercent(totals.quality)} qualidade`;
  }

  const now = Date.now();
  buckets.forEach((bucket, index) => {
    const row = document.createElement('tr');
    if (index === buckets.length - 1 && new Date(bucket.end).getTime() > now) {
      row.className = 'current';
    }

    const period = document.createElement('td');
    period.textContent = bucket.label;

    const produced = document.createElement('td');
    produced.className = 'numeric';
    produced.textContent = formatNumber(bucket.produced);

    const good = document.createElement('td');
    good.className = 'numeric';
    good.textContent = formatNumber(bucket.good);

    const scrap = document.createElement('td');
    scrap.className = `numeric scrap${bucket.scrap > 0 ? ' positive' : ''}`;
    scrap.textContent = formatNumber(bucket.scrap);

    const operating = document.createElement('td');
    operating.className = 'numeric';
    operating.textContent = formatDuration(bucket.operatingTimeMs);

    const stopped = document.createElement('td');
    stopped.className = 'numeric';
    stopped.textContent = formatDuration(bucket.stoppedTimeMs);

    const availability = document.createElement('td');
    availability.className = `numeric ratio ${ratioClass(bucket.availability)}`;
    availability.textContent = formatPercent(bucket.availability);

    row.append(period, produced, good, scrap, operating, stopped, availability);
    el.productionBody.append(row);
  });
}

async function refreshProduction() {
  if (!state.machineId) {
    renderProduction({ buckets: [] });
    return;
  }

  const to = new Date();
  const from = new Date(to.getTime() - state.periodMinutes * 60000);
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    bucket: state.productionBucket,
  });

  try {
    const data = await getJson(`/api/machines/${state.machineId}/production?${params}`);
    renderProduction(data);
  } catch (error) {
    console.error(error);
  }
}

function renderAlerts(alerts) {
  state.alerts = alerts;
  el.alertsList.innerHTML = '';

  const count = alerts.length;
  el.alertsCount.textContent =
    count === 0 ? 'nenhum ativo' : `${count} ativo${count === 1 ? '' : 's'}`;
  el.alertsEmpty.style.display = count === 0 ? 'block' : 'none';

  for (const alert of alerts) {
    const item = document.createElement('li');
    item.className = `alert-item ${alert.severity || 'warning'}`;

    const main = document.createElement('div');
    main.className = 'alert-main';

    const severity = document.createElement('span');
    severity.className = 'alert-severity';
    severity.textContent = SEVERITY_LABELS[alert.severity] ?? alert.severity ?? 'Alerta';

    const message = document.createElement('p');
    message.className = 'alert-message';
    message.textContent = alert.message;

    const time = document.createElement('span');
    time.className = 'alert-time';
    time.textContent = formatDateTime(alert.created_at);

    main.append(severity, message, time);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alert-resolve';
    button.dataset.id = String(alert.id);
    button.textContent = 'Resolver';

    item.append(main, button);
    el.alertsList.append(item);
  }
}

async function refreshAlerts() {
  if (!state.machineId) {
    renderAlerts([]);
    return;
  }

  try {
    const data = await getJson(
      `/api/machines/${state.machineId}/alerts?status=open&limit=20`
    );
    renderAlerts(data.alerts || []);
  } catch (error) {
    console.error(error);
  }
}

async function resolveAlertById(id) {
  try {
    const response = await fetch(`/api/alerts/${id}/resolve`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await refreshAlerts();
  } catch (error) {
    console.error(error);
  }
}

function renderMaintenanceOrders(orders, names) {
  el.maintenanceOrdersBody.innerHTML = '';
  el.maintenanceOrdersEmpty.style.display = orders.length === 0 ? 'block' : 'none';

  for (const order of orders) {
    const row = document.createElement('tr');

    const idCell = document.createElement('td');
    idCell.textContent = `#${order.id}`;

    const componentCell = document.createElement('td');
    componentCell.textContent = names.get(order.component_code) ?? order.component_code;

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = `status-pill ${order.status}`;
    status.textContent = MAINTENANCE_STATUS_LABELS[order.status] ?? order.status;
    statusCell.append(status);

    const priorityCell = document.createElement('td');
    priorityCell.textContent = PRIORITY_LABELS[order.priority] ?? order.priority;

    const partsCell = document.createElement('td');
    partsCell.textContent = (order.parts ?? [])
      .map((part) => `${part.quantity}x ${part.code}`)
      .join(', ') || '—';

    const erpCell = document.createElement('td');
    erpCell.textContent = order.erp?.external_id ?? '—';

    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'order-action';
    button.dataset.id = String(order.id);
    button.textContent = 'Concluir';
    actionCell.append(button);

    row.append(idCell, componentCell, statusCell, priorityCell, partsCell, erpCell, actionCell);
    el.maintenanceOrdersBody.append(row);
  }
}

function renderMaintenance(data) {
  const components = data?.components ?? [];
  const orders = data?.orders ?? [];
  const names = new Map(components.map((component) => [component.code, component.name]));

  el.maintenanceComponents.innerHTML = '';
  el.maintenanceEmpty.style.display = components.length === 0 ? 'block' : 'none';

  const attention = components.filter((component) => component.status !== 'ok').length;
  el.maintenanceSummary.textContent =
    components.length === 0
      ? '—'
      : `${components.length} componentes · ${attention} em atenção`;

  for (const component of components) {
    const card = document.createElement('article');
    card.className = `maintenance-card ${component.status}`;

    const head = document.createElement('div');
    head.className = 'maintenance-card-head';

    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = component.name;

    const status = document.createElement('span');
    status.className = 'maintenance-status';
    status.textContent = MAINTENANCE_STATUS_LABELS[component.status] ?? component.status;

    head.append(label, status);

    const value = document.createElement('strong');
    value.textContent = `${Math.round(component.usageRatio * 100)}%`;

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('span');
    fill.style.width = `${(component.usageRatio * 100).toFixed(1)}%`;
    bar.append(fill);

    const meta = document.createElement('p');
    meta.className = 'maintenance-meta';
    meta.textContent =
      `${formatNumber(component.cycles)} / ${formatNumber(component.mtbfCycles)} ciclos` +
      ` · restam ${formatNumber(component.remainingCycles)}`;

    card.append(head, value, bar, meta);
    el.maintenanceComponents.append(card);
  }

  renderMaintenanceOrders(orders, names);
}

async function refreshMaintenance() {
  if (!state.machineId) {
    renderMaintenance({ components: [], orders: [] });
    return;
  }

  try {
    const data = await getJson(`/api/machines/${state.machineId}/maintenance`);
    renderMaintenance(data);
  } catch (error) {
    console.error(error);
  }
}

async function completeMaintenanceOrder(id) {
  try {
    const response = await fetch(`/api/maintenance/orders/${id}/complete`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await Promise.all([refreshMaintenance(), refreshAlerts()]);
  } catch (error) {
    console.error(error);
  }
}

async function refreshTelemetry() {
  if (!state.machineId) return;
  try {
    const data = await getJson(
      `/api/machines/${state.machineId}/telemetry?limit=${TELEMETRY_LIMIT}`
    );
    state.samples = data.samples || [];
    renderTelemetry(state.samples);
    state.pollOk = true;
    updateConnection();
  } catch (error) {
    console.error(error);
    state.pollOk = false;
    updateConnection();
  }
}

async function refreshOee() {
  if (!state.machineId) return;
  const from = new Date(Date.now() - state.periodMinutes * 60000).toISOString();
  try {
    const data = await getJson(
      `/api/machines/${state.machineId}/oee?from=${encodeURIComponent(from)}`
    );
    renderOee(data);
  } catch (error) {
    console.error(error);
  }
}

function refreshAll() {
  void refreshTelemetry();
  void refreshOee();
  void refreshAlerts();
  void refreshMaintenance();
  void refreshProduction();
}

async function loadMachines() {
  try {
    const data = await getJson('/api/machines');
    state.machines = data.machines || [];

    const select = el.machineSelect;
    select.innerHTML = '';

    if (state.machines.length === 0) {
      select.add(new Option('Nenhuma máquina', ''));
      select.disabled = true;
      state.machineId = null;
      state.machineCode = null;
      state.samples = [];
      renderPlaceholders();
      renderOee({ nominalCapacityPerHour: 0 });
      renderAlerts([]);
      renderMaintenance({ components: [], orders: [] });
      renderProduction({ buckets: [] });
      drawChart([]);
      state.pollOk = true;
      updateConnection();
      return false;
    }

    select.disabled = false;
    for (const machine of state.machines) {
      select.add(new Option(machine.name || machine.code, String(machine.id)));
    }

    const selected =
      state.machines.find((machine) => String(machine.id) === select.value) ?? state.machines[0];
    state.machineId = selected.id;
    state.machineCode = selected.code;
    state.pollOk = true;
    updateConnection();
    return true;
  } catch (error) {
    console.error(error);
    state.pollOk = false;
    updateConnection();
    return false;
  }
}

el.machineSelect.addEventListener('change', () => {
  const selected = state.machines.find(
    (machine) => String(machine.id) === el.machineSelect.value
  );
  state.machineId = selected ? selected.id : null;
  state.machineCode = selected ? selected.code : null;
  state.samples = [];
  state.lastSamples = [];
  refreshAll();
});

el.periodSelect.addEventListener('change', () => {
  state.periodMinutes = Number(el.periodSelect.value) || 60;
  void refreshOee();
  void refreshProduction();
});

el.productionBucket.addEventListener('change', () => {
  state.productionBucket = el.productionBucket.value === 'shift' ? 'shift' : 'hour';
  void refreshProduction();
});

el.refresh.addEventListener('click', () => {
  void loadMachines().then((hasMachines) => {
    if (hasMachines) refreshAll();
  });
});

el.alertsList.addEventListener('click', (event) => {
  const button = event.target.closest('.alert-resolve');
  if (!button) return;
  void resolveAlertById(button.dataset.id);
});

el.maintenanceOrdersBody.addEventListener('click', (event) => {
  const button = event.target.closest('.order-action');
  if (!button) return;
  void completeMaintenanceOrder(button.dataset.id);
});

window.addEventListener('resize', () => {
  drawChart(state.lastSamples);
});

function connectStream() {
  if (typeof EventSource === 'undefined') return;

  const source = new EventSource('/api/stream');
  state.stream = source;

  source.addEventListener('open', () => {
    state.streamOnline = true;
    updateConnection();
  });

  source.addEventListener('telemetry', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (!payload || payload.machineId !== state.machineCode) return;

    state.samples = [
      { recorded_at: payload.timestamp, payload },
      ...state.samples,
    ].slice(0, TELEMETRY_LIMIT);
    renderTelemetry(state.samples);
    state.streamOnline = true;
    updateConnection();
  });

  source.addEventListener('alert', () => {
    void refreshAlerts();
  });

  source.addEventListener('maintenance', () => {
    void refreshMaintenance();
    void refreshAlerts();
  });

  source.addEventListener('error', () => {
    state.streamOnline = false;
    updateConnection();
  });
}

async function start() {
  const hasMachines = await loadMachines();
  if (hasMachines) refreshAll();

  connectStream();

  setInterval(async () => {
    if (!state.machineId) {
      const found = await loadMachines();
      if (found) refreshAll();
      return;
    }
    if (!state.streamOnline) void refreshTelemetry();
  }, POLL_TELEMETRY_MS);

  setInterval(() => {
    if (state.machineId) void refreshOee();
  }, POLL_OEE_MS);

  setInterval(() => {
    if (state.machineId) void refreshAlerts();
  }, POLL_ALERTS_MS);

  setInterval(() => {
    if (state.machineId) void refreshMaintenance();
  }, POLL_MAINTENANCE_MS);

  setInterval(() => {
    if (state.machineId) void refreshProduction();
  }, POLL_PRODUCTION_MS);
}

void start();
