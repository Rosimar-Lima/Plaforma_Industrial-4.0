'use strict';

const POLL_TELEMETRY_MS = 3000;
const POLL_OEE_MS = 15000;
const POLL_ALERTS_MS = 15000;
const POLL_MAINTENANCE_MS = 15000;
const POLL_PRODUCTION_MS = 15000;
const TELEMETRY_LIMIT = 120;
const BOTTLE_VOLUME_ML = 300;
const MONITORING_EVENT_LIMIT = 10;
const MONITORING_TRANSITION_MS = 1800;
const MONITORING_STEP_MS = 70;
const BOOT_DATE_KEY = 'pi40.boot.date';
const BOOT_LIMIT_MS = 25000;
const SYSTEM_STATUS_POLL_MS = 1000;

const SHUTDOWN_STEPS = [
  { id: 'dashboard', label: 'Pausar dashboard e stream' },
  { id: 'gateway', label: 'Parar serviço PI40Gateway' },
  { id: 'persistence', label: 'Confirmar últimos dados no banco' },
  { id: 'containers', label: 'Parar backend e PostgreSQL' },
  { id: 'safe', label: 'Nenhum container ativo' },
];

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
  cancelled: 'Cancelada',
};

const PRIORITY_LABELS = {
  high: 'Alta',
  critical: 'Crítica',
};

const MONITORING_STAGES = [
  { id: 'api', label: 'API de ingestão', detail: 'Saúde do backend verificada.' },
  { id: 'stream', label: 'Stream de eventos', detail: 'Canal SSE pronto para receber eventos.' },
  { id: 'gateway', label: 'Heartbeat do gateway', detail: 'Aguardando status do gateway.' },
  { id: 'plc', label: 'Comunicação com o CLP', detail: 'Aguardando leitura ADS.' },
  { id: 'telemetry', label: 'Telemetria chegando', detail: 'Aguardando primeira amostra.' },
  { id: 'database', label: 'Persistência no banco', detail: 'Acumulado de produção carregado.' },
];

function createStageState() {
  return MONITORING_STAGES.map((stage) => ({
    ...stage,
    status: 'pending',
    detail: stage.detail,
  }));
}

const state = {
  machines: [],
  machineId: null,
  machineCode: null,
  periodMinutes: 60,
  productionBucket: 'hour',
  samples: [],
  lastSamples: [],
  alerts: [],
  orders: [],
  maintenanceNames: new Map(),
  selectedOrderId: null,
  stream: null,
  streamOnline: false,
  lineConnection: null,
  monitoring: {
    enabled: false,
    mode: 'off',
    progress: 0,
    targetProgress: 0,
    stages: createStageState(),
    events: [],
  },
  boot: {
    active: false,
    allowEnter: false,
    autoEntered: false,
    timer: null,
  },
  shutdown: {
    status: null,
    phase: 'confirm',
    timer: null,
    lineTimer: null,
    lineState: 'unknown',
    lineConfirmed: false,
    closeScheduled: false,
    startedAt: 0,
    apiLost: false,
    triggered: false,
  },
};

const el = {
  bootScreen: document.getElementById('boot-screen'),
  bootPercent: document.getElementById('boot-percent'),
  bootTrack: document.getElementById('boot-track'),
  bootBar: document.getElementById('boot-bar'),
  bootStages: document.getElementById('boot-stages'),
  bootHint: document.getElementById('boot-hint'),
  bootEnter: document.getElementById('boot-enter'),
  bootRetry: document.getElementById('boot-retry'),
  bootDiagnostic: document.getElementById('boot-diagnostic'),
  shutdownOpen: document.getElementById('shutdown-open'),
  shutdownModal: document.getElementById('shutdown-modal'),
  shutdownClose: document.getElementById('shutdown-close'),
  shutdownDismiss: document.getElementById('shutdown-dismiss'),
  shutdownConfirm: document.getElementById('shutdown-confirm'),
  shutdownCopy: document.getElementById('shutdown-copy'),
  shutdownStatus: document.getElementById('shutdown-status'),
  shutdownMessage: document.getElementById('shutdown-message'),
  shutdownSteps: document.getElementById('shutdown-steps'),
  shutdownInstruction: document.getElementById('shutdown-instruction'),
  shutdownFinal: document.getElementById('shutdown-final'),
  shutdownLineTitle: document.getElementById('shutdown-line-title'),
  shutdownLineDetail: document.getElementById('shutdown-line-detail'),
  shutdownLineConfirm: document.getElementById('shutdown-line-confirm'),
  shutdownLineCheckbox: document.getElementById('shutdown-line-checkbox'),
  machineSelect: document.getElementById('machine-select'),
  periodSelect: document.getElementById('period-select'),
  refresh: document.getElementById('refresh'),
  diagnosticOpen: document.getElementById('diagnostic-open'),
  lineConnection: document.getElementById('line-connection'),
  diagnosticModal: document.getElementById('diagnostic-modal'),
  diagnosticClose: document.getElementById('diagnostic-close'),
  diagnosticDismiss: document.getElementById('diagnostic-dismiss'),
  warningModal: document.getElementById('warning-modal'),
  warningClose: document.getElementById('warning-close'),
  warningDismiss: document.getElementById('warning-dismiss'),
  warningMessage: document.getElementById('warning-message'),
  monitoringStatus: document.getElementById('monitoring-status'),
  monitoringToggle: document.getElementById('monitoring-toggle'),
  monitoringHint: document.getElementById('monitoring-hint'),
  monitoringPercent: document.getElementById('monitoring-percent'),
  monitoringTrack: document.getElementById('monitoring-track'),
  monitoringBar: document.getElementById('monitoring-bar'),
  monitoringStages: document.getElementById('monitoring-stages'),
  monitoringEvents: document.getElementById('monitoring-events'),
  monitoringEventsCount: document.getElementById('monitoring-events-count'),
  lastUpdate: document.getElementById('last-update'),
  running: document.getElementById('stat-running'),
  filled: document.getElementById('prod-filled'),
  capped: document.getElementById('prod-capped'),
  total: document.getElementById('prod-total'),
  accumulated: document.getElementById('prod-accumulated'),
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
  orderModal: document.getElementById('order-modal'),
  orderModalTitle: document.getElementById('order-modal-title'),
  orderModalBody: document.getElementById('order-modal-body'),
  orderModalClose: document.getElementById('order-modal-close'),
  orderModalDismiss: document.getElementById('order-modal-dismiss'),
  orderSend: document.getElementById('order-send'),
  orderCancel: document.getElementById('order-cancel'),
};

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  return response.json();
}

function stageById(id) {
  return state.monitoring.stages.find((stage) => stage.id === id);
}

function monitoringDoneCount() {
  return state.monitoring.stages.filter((stage) => stage.status === 'done').length;
}

function monitoringPercent() {
  return Math.round((monitoringDoneCount() / state.monitoring.stages.length) * 100);
}

function setStage(id, status, detail) {
  const stage = stageById(id);
  if (!stage) return false;

  const changed = stage.status !== status || (detail && stage.detail !== detail);
  stage.status = status;
  if (detail) stage.detail = detail;
  return changed;
}

function addMonitoringEvent(title, detail = '', level = 'info') {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    title,
    detail,
    level,
  };
  state.monitoring.events.unshift(event);
  state.monitoring.events = state.monitoring.events.slice(0, MONITORING_EVENT_LIMIT);
  renderMonitoringEvents();
}

function renderMonitoringEvents() {
  el.monitoringEventsCount.textContent = `${state.monitoring.events.length} evento${
    state.monitoring.events.length === 1 ? '' : 's'
  }`;

  if (state.monitoring.events.length === 0) {
    el.monitoringEvents.innerHTML =
      '<li class="event info"><span class="event-time">—</span><div class="event-body"><span class="event-title">Nenhum evento ainda</span><span class="event-detail">Ligue o monitoramento para ver a atividade da plataforma.</span></div></li>';
    return;
  }

  el.monitoringEvents.innerHTML = state.monitoring.events
    .map((event) => {
      const time = new Date(event.at).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      return `
        <li class="event ${event.level}">
          <span class="event-time">${time}</span>
          <div class="event-body">
            <span class="event-title">${event.title}</span>
            ${event.detail ? `<span class="event-detail">${event.detail}</span>` : ''}
          </div>
        </li>
      `;
    })
    .join('');
}

function renderStagesInto(target, stages) {
  target.innerHTML = stages
    .map((stage) => {
      const stateLabel = {
        done: 'ok',
        active: 'em andamento',
        pending: 'pendente',
        error: 'falha',
      }[stage.status] || 'pendente';
      return `
        <li class="stage ${stage.status}">
          <span class="stage-dot" aria-hidden="true"></span>
          <div>
            <span class="stage-name">${stage.label}</span>
            <span class="stage-detail">${stage.detail}</span>
          </div>
          <span class="stage-state">${stateLabel}</span>
        </li>
      `;
    })
    .join('');
}

function renderMonitoringStages() {
  renderStagesInto(el.monitoringStages, state.monitoring.stages);
}

function renderMonitoring() {
  const percent = Math.round(state.monitoring.progress);
  el.monitoringPercent.textContent = `${percent}%`;
  el.monitoringBar.style.width = `${percent}%`;
  el.monitoringTrack.setAttribute('aria-valuenow', String(percent));

  const status = el.monitoringStatus;
  status.classList.remove('off', 'starting', 'on', 'stopping');
  el.diagnosticModal.classList.remove('off', 'starting', 'on', 'stopping');
  el.monitoringToggle.classList.remove('off', 'starting', 'on', 'stopping');

  const configs = {
    off: {
      pill: 'Desligado',
      button: 'Ligar monitoramento',
      hint: 'Ao ligar, a PI40 verifica API, gateway, CLP, telemetria e banco antes de declarar prontidão.',
    },
    starting: {
      pill: 'Iniciando',
      button: 'Desligar monitoramento',
      hint: 'A barra avança conforme cada etapa de prontidão é confirmada.',
    },
    on: {
      pill: 'Monitorando',
      button: 'Desligar monitoramento',
      hint: 'Plataforma pronta. Os eventos reais continuam sendo registrados abaixo.',
    },
    stopping: {
      pill: 'Desligando',
      button: 'Aguarde, desligando...',
      hint: 'Encerrando a sessão de monitoramento com segurança. O histórico permanece no banco.',
    },
  };

  const current = configs[state.monitoring.mode] || configs.off;

  status.textContent = current.pill;
  status.classList.add(state.monitoring.mode);
  el.diagnosticModal.classList.add(state.monitoring.mode);
  el.monitoringToggle.classList.add(state.monitoring.mode);
  el.monitoringToggle.setAttribute('aria-label', current.button);
  el.monitoringToggle.setAttribute('title', current.button);
  el.monitoringHint.textContent = current.hint;
  el.monitoringToggle.disabled = state.monitoring.mode === 'stopping';

  renderMonitoringStages();
  if (state.boot.active) renderBoot();
}

function animateMonitoringProgress(target, { duration = MONITORING_TRANSITION_MS, onDone } = {}) {
  const from = state.monitoring.progress;
  const to = Math.max(0, Math.min(100, target));
  const startedAt = performance.now();

  if (state.monitoring.animationFrame) {
    cancelAnimationFrame(state.monitoring.animationFrame);
    state.monitoring.animationFrame = null;
  }

  const step = (now) => {
    const t = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    state.monitoring.progress = from + (to - from) * eased;
    renderMonitoring();

    if (t < 1) {
      state.monitoring.animationFrame = requestAnimationFrame(step);
    } else {
      state.monitoring.progress = to;
      state.monitoring.animationFrame = null;
      renderMonitoring();
      if (onDone) onDone();
    }
  };

  state.monitoring.animationFrame = requestAnimationFrame(step);
}

function syncMonitoringProgress() {
  if (!state.monitoring.enabled || state.monitoring.mode === 'stopping') return;
  const target = monitoringPercent();
  if (target !== state.monitoring.targetProgress) {
    state.monitoring.targetProgress = target;
    animateMonitoringProgress(target, { duration: 900 });
  }
  if (target === 100 && state.monitoring.mode === 'starting') {
    state.monitoring.mode = 'on';
    renderMonitoring();
    addMonitoringEvent('Plataforma pronta', 'Todas as etapas de prontidão foram confirmadas.', 'ok');
  }
}

function updateMonitoringStages() {
  if (!state.monitoring.enabled) return;

  const apiOk = state.monitoring.mode !== 'off';
  if (setStage('api', apiOk ? 'done' : 'pending', apiOk ? 'Backend respondeu com sucesso.' : 'Aguardando inicialização.')) {
    if (apiOk) addMonitoringEvent('API de ingestão verificada', 'O backend respondeu ao /health.', 'ok');
  }

  const streamStatus = state.streamOnline ? 'done' : 'active';
  const streamDetail = state.streamOnline
    ? 'Conectado ao SSE /api/stream.'
    : 'SSE indisponível; usando polling automático.';
  if (setStage('stream', streamStatus, streamDetail)) {
    addMonitoringEvent(
      state.streamOnline ? 'Stream de eventos conectado' : 'Stream em fallback',
      streamDetail,
      state.streamOnline ? 'ok' : 'warn'
    );
  }

  const connection = state.lineConnection;
  let gatewayStatus = 'active';
  let gatewayDetail = 'Aguardando heartbeat do gateway.';
  if (connection && connection.state !== 'unknown') {
    gatewayStatus = connection.state === 'offline' ? 'error' : 'done';
    gatewayDetail = connection.lastStatusAt
      ? `Último heartbeat: ${new Date(connection.lastStatusAt).toLocaleTimeString('pt-BR')}.`
      : 'Heartbeat recebido.';
  }
  if (setStage('gateway', gatewayStatus, gatewayDetail)) {
    if (gatewayStatus === 'done') addMonitoringEvent('Gateway reportou heartbeat', gatewayDetail, 'ok');
    if (gatewayStatus === 'error') addMonitoringEvent('Gateway sem comunicação', connection?.error || gatewayDetail, 'error');
  }

  let plcStatus = 'pending';
  let plcDetail = 'Aguardando leitura ADS válida.';
  if (connection?.state === 'offline') {
    plcStatus = 'error';
    plcDetail = 'Sem comunicação com o CLP.';
  } else if (connection?.state === 'online') {
    plcStatus = 'done';
    plcDetail = connection.running ? 'CLP respondendo; linha em operação.' : 'CLP respondendo; linha parada.';
  }
  if (setStage('plc', plcStatus, plcDetail)) {
    if (plcStatus === 'done') addMonitoringEvent('CLP acessível', plcDetail, 'ok');
    if (plcStatus === 'error') addMonitoringEvent('CLP inacessível', plcDetail, 'error');
  }

  const hasTelemetry = state.samples.length > 0;
  const telemetryDetail = hasTelemetry
    ? `Última amostra: ${new Date(state.samples[0].recorded_at).toLocaleTimeString('pt-BR')}.`
    : 'Aguardando primeira amostra de telemetria.';
  if (setStage('telemetry', hasTelemetry ? 'done' : 'active', telemetryDetail)) {
    if (hasTelemetry) addMonitoringEvent('Telemetria recebida', telemetryDetail, 'ok');
  }

  syncMonitoringProgress();
  renderMonitoring();
}

function markDatabaseStage(ok, detail) {
  if (!state.monitoring.enabled) return;
  const changed = setStage('database', ok ? 'done' : 'error', detail);
  if (changed) {
    addMonitoringEvent(
      ok ? 'Banco de dados sincronizado' : 'Falha ao consultar banco',
      detail,
      ok ? 'ok' : 'error'
    );
  }
  syncMonitoringProgress();
  renderMonitoring();
}

async function startMonitoring() {
  if (state.monitoring.enabled) return;

  state.monitoring.enabled = true;
  state.monitoring.mode = 'starting';
  state.monitoring.progress = 0;
  state.monitoring.targetProgress = 0;
  state.monitoring.stages = createStageState();
  state.monitoring.events = [];
  renderMonitoringEvents();
  addMonitoringEvent('Monitoramento ligado', 'Iniciando verificação de prontidão da plataforma.', 'info');
  renderMonitoring();
  animateMonitoringProgress(8, { duration: 500 });

  connectStream();

  try {
    await getJson('/health');
    setStage('api', 'done', 'Backend respondeu com sucesso.');
  } catch (error) {
    setStage('api', 'error', 'Não foi possível consultar /health.');
    addMonitoringEvent('Falha ao consultar API', error.message, 'error');
  }

  await loadMachines();
  refreshAll();
  updateMonitoringStages();
}

function stopMonitoring() {
  if (!state.monitoring.enabled || state.monitoring.mode === 'stopping') return;

  state.monitoring.mode = 'stopping';
  addMonitoringEvent('Desligando monitoramento', 'A sessão será encerrada; o histórico permanece no banco.', 'warn');
  renderMonitoring();

  animateMonitoringProgress(0, {
    duration: MONITORING_TRANSITION_MS,
    onDone: () => {
      state.monitoring.enabled = false;
      state.monitoring.mode = 'off';
      state.monitoring.targetProgress = 0;
      state.monitoring.stages = createStageState();
      state.monitoring.stages.forEach((stage) => {
        stage.status = 'pending';
        stage.detail = 'Monitoramento desligado.';
      });
      if (state.stream) {
        state.stream.close();
        state.stream = null;
      }
      state.streamOnline = false;
      addMonitoringEvent('Monitoramento desligado', 'Nenhum dado histórico foi apagado.', 'info');
      renderMonitoring();
    },
  });
}

function localDayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function shouldShowBoot() {
  // O atalho de inicialização abre a URL com ?boot=1 para repetir a abertura
  // mesmo quando o dashboard já foi visto neste dia.
  try {
    const params = new URLSearchParams(window.location?.search || '');
    if (params.get('boot') === '1') return true;
    return localStorage?.getItem(BOOT_DATE_KEY) !== localDayKey();
  } catch (error) {
    return true;
  }
}

function markBootDone() {
  try {
    localStorage?.setItem(BOOT_DATE_KEY, localDayKey());
  } catch (error) {
    // Armazenamento bloqueado: a tela reaparece no próximo acesso.
  }
}

function renderBoot() {
  const stages = state.monitoring.stages;
  const percent = monitoringPercent();
  const hasError = stages.some((stage) => stage.status === 'error');
  const ready = percent === 100;
  const canEnter = ready || hasError || state.boot.allowEnter;

  el.bootPercent.textContent = `${percent}%`;
  el.bootBar.style.width = `${percent}%`;
  el.bootTrack.setAttribute('aria-valuenow', String(percent));
  renderStagesInto(el.bootStages, stages);

  el.bootEnter.disabled = !canEnter;
  el.bootEnter.textContent = ready ? 'Entrar no painel' : 'Entrar em modo limitado';
  el.bootRetry.hidden = !hasError;

  let hint = 'Aguardando as verificações iniciais...';
  if (ready) {
    hint = 'Plataforma pronta. O painel está sendo atualizado em tempo real.';
  } else if (hasError) {
    const gateway = stageById('gateway');
    const plc = stageById('plc');
    hint =
      gateway?.status === 'error' || plc?.status === 'error'
        ? 'Aguardando o CLP — verifique se o PLC está conectado no TwinCAT XAE e se o runtime está em Run.'
        : 'Algumas verificações falharam. Tente novamente ou entre em modo limitado.';
  } else if (state.boot.allowEnter) {
    hint = 'A prontidão está demorando mais que o esperado. Você pode entrar em modo limitado.';
  }

  el.bootHint.textContent = hint;
  el.bootHint.classList.remove('error');
  if (hasError) el.bootHint.classList.add('error');

  if (ready && !state.boot.autoEntered) {
    state.boot.autoEntered = true;
    addMonitoringEvent('Prontidão confirmada', 'Abrindo o painel automaticamente.', 'ok');
    enterDashboard();
  }
}

function enterDashboard() {
  if (!state.boot.active) return;

  if (state.boot.timer) {
    clearTimeout(state.boot.timer);
    state.boot.timer = null;
  }

  const ready = monitoringPercent() === 100;
  markBootDone();
  state.boot.active = false;
  el.bootScreen.hidden = true;

  if (!ready) {
    addMonitoringEvent(
      'Entrada em modo limitado',
      'A plataforma foi aberta antes de todas as verificações.',
      'warn'
    );
    renderMonitoring();
  }
  refreshAll();
}

function retryBoot() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  state.streamOnline = false;
  state.monitoring.enabled = false;
  state.monitoring.mode = 'off';
  state.monitoring.progress = 0;
  state.monitoring.targetProgress = 0;
  state.monitoring.stages = createStageState();
  state.boot.allowEnter = false;
  state.boot.autoEntered = false;
  el.bootRetry.hidden = true;
  void startMonitoring();
  addMonitoringEvent('Nova tentativa de inicialização', 'Reverificando a prontidão da plataforma.', 'info');
}

function enterBoot() {
  state.boot.active = true;
  state.boot.allowEnter = false;
  state.boot.autoEntered = false;
  el.bootScreen.hidden = false;
  renderBoot();

  state.boot.timer = setTimeout(() => {
    state.boot.allowEnter = true;
    renderBoot();
    addMonitoringEvent('Prontidão demorou', 'A plataforma pode ser aberta em modo limitado.', 'warn');
  }, BOOT_LIMIT_MS);

  void startMonitoring();
}

function openDiagnosticModal() {
  el.diagnosticModal.hidden = false;
}

function closeDiagnosticModal() {
  el.diagnosticModal.hidden = true;
}

function openWarningModal(message) {
  el.warningMessage.textContent = message;
  el.warningModal.hidden = false;
  el.warningDismiss.focus();
}

function closeWarningModal() {
  el.warningModal.hidden = true;
}

function shutdownStepStatus(value) {
  if (value === 'done') return 'done';
  if (value === 'active' || value === 'running') return 'active';
  if (value === 'error') return 'error';
  return 'pending';
}

function renderShutdown(status) {
  const byId = new Map((status?.steps || []).map((step) => [step.id, step]));
  const labels = {
    done: 'ok',
    active: 'em andamento',
    pending: 'pendente',
    error: 'falha',
  };

  el.shutdownSteps.innerHTML = SHUTDOWN_STEPS.map((step, index) => {
    const data = byId.get(step.id) || {};
    const stepStatus = shutdownStepStatus(data.status);
    const detail = data.detail || (stepStatus === 'pending' ? 'Aguardando' : '');
    return `
      <li class="stage ${stepStatus}">
        <span class="stage-dot" aria-hidden="true"></span>
        <div>
          <span class="stage-name">${index + 1}. ${data.label || step.label}</span>
          <span class="stage-detail">${detail}</span>
        </div>
        <span class="stage-state">${labels[stepStatus]}</span>
      </li>
    `;
  }).join('');

  const stateName = status?.state || 'idle';
  const pill = {
    done: ['on', 'Concluído'],
    error: ['off', 'Falha'],
    running: ['starting', 'Encerrando'],
  }[stateName] || ['off', 'Confirmando'];

  el.shutdownStatus.classList.remove('on', 'off', 'starting', 'stopping');
  el.shutdownStatus.classList.add(pill[0]);
  el.shutdownStatus.textContent = pill[1];
  el.shutdownMessage.textContent =
    status?.message || 'Nenhuma operação de sistema em andamento.';

  const finished = stateName === 'done' || stateName === 'error';
  el.shutdownFinal.hidden = stateName !== 'done';
  const manualFallback = state.shutdown.phase === 'progress' && !state.shutdown.triggered;
  el.shutdownInstruction.hidden = !manualFallback || finished;
  el.shutdownCopy.hidden = !manualFallback;
  const canConfirm =
    state.shutdown.phase === 'confirm' &&
    state.shutdown.lineState === 'offline' &&
    state.shutdown.lineConfirmed;
  el.shutdownConfirm.disabled = !canConfirm;
  el.shutdownConfirm.textContent =
    state.shutdown.phase === 'confirm' ? 'Encerrar a PI40' : 'Encerramento iniciado';
  el.shutdownDismiss.textContent = state.shutdown.phase === 'confirm' ? 'Cancelar' : 'Fechar';

  if (stateName === 'done' && !state.shutdown.closeScheduled) {
    state.shutdown.closeScheduled = true;
    el.shutdownFinal.textContent = 'PI40 encerrada. Fechando esta página...';
    scheduleBrowserClose();
  }
}

function scheduleBrowserClose() {
  if (typeof window === 'undefined' || !window.close || !window.location) return;
  setTimeout(() => {
    try {
      window.close();
    } catch (error) {
      // Navegadores bloqueiam close() em abas abertas pelo usuário.
    }
    setTimeout(() => {
      try {
        if (!window.closed) window.location.replace('about:blank');
      } catch (error) {
        // Ambiente sem navegação programática (testes, por exemplo).
      }
    }, 1000);
  }, 2500);
}

function copyShutdownCommand() {
  const command =
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\\scripts\\pi40-dia.ps1" -Action Stop';
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(command);
      el.shutdownCopy.textContent = 'Comando copiado';
    }
  } catch (error) {
    el.shutdownCopy.textContent = 'Copiar comando';
  }
}

function stopSystemStatusPolling() {
  if (state.shutdown.timer) {
    clearInterval(state.shutdown.timer);
    state.shutdown.timer = null;
  }
}

function startSystemStatusPolling() {
  if (state.shutdown.timer) return;
  state.shutdown.timer = setInterval(() => void pollSystemStatus(), SYSTEM_STATUS_POLL_MS);
}

async function pollSystemStatus() {
  try {
    const response = await fetch('/api/system/status');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body?.action !== 'Stop') return;

    const updatedAt = body.updatedAt ? Date.parse(body.updatedAt) : 0;
    if (Number.isFinite(updatedAt) && updatedAt < state.shutdown.startedAt - 2000) return;

    state.shutdown.status = body;
    state.shutdown.apiLost = false;
    renderShutdown(body);
    if (body.state === 'done' || body.state === 'error') stopSystemStatusPolling();
    return;
  } catch (error) {
    // O backend é parado no penúltimo passo; o script já validou os containers.
  }

  const current = state.shutdown.status;
  if (current?.action !== 'Stop' || current?.state !== 'running') {
    renderShutdown(current);
    return;
  }

  const containers = (current.steps || []).find((step) => step.id === 'containers');
  const elapsed = Date.now() - state.shutdown.startedAt;
  if (containers?.status !== 'active' && elapsed < 15000) {
    renderShutdown(current);
    return;
  }

  const fallback = {
    ...current,
    state: 'done',
    message: 'Backend parado; a confirmação final veio do script local.',
    steps: (current.steps || []).map((step) => {
      if (step.id === 'containers') {
        return { ...step, status: 'done', detail: 'Backend e PostgreSQL parados; volume preservado.' };
      }
      if (step.id === 'safe') {
        return { ...step, status: 'done', detail: 'É seguro desligar o computador.' };
      }
      return step;
    }),
  };
  state.shutdown.status = fallback;
  state.shutdown.apiLost = true;
  renderShutdown(fallback);
  stopSystemStatusPolling();
}

function renderShutdownLineState(connection) {
  const lineState = state.shutdown.lineState;
  el.shutdownLineConfirm.hidden = lineState !== 'offline';

  if (lineState === 'offline') {
    el.shutdownLineTitle.textContent = 'Linha desligada';
    el.shutdownLineTitle.className = 'line-offline';
    el.shutdownLineDetail.textContent =
      'O CLP não responde. Confirme que a linha física foi desligada antes de encerrar a PI40.';
  } else if (lineState === 'online') {
    el.shutdownLineTitle.textContent =
      connection?.running === false ? 'Linha apenas parada' : 'Linha em operação';
    el.shutdownLineTitle.className =
      connection?.running === false ? 'line-stopped' : 'line-online';
    el.shutdownLineDetail.textContent =
      'O CLP ainda responde. Desligue a linha física: encerrar com a linha apenas parada não é permitido.';
  } else {
    el.shutdownLineTitle.textContent = 'Estado da linha não confirmado';
    el.shutdownLineTitle.className = 'line-unknown';
    el.shutdownLineDetail.textContent =
      'Aguardando heartbeat do gateway. Não é possível liberar o encerramento sem essa leitura.';
  }

  if (lineState !== 'offline') {
    state.shutdown.lineConfirmed = false;
    el.shutdownLineCheckbox.checked = false;
  }
  renderShutdown(null);
}

function applyShutdownLineState(connection) {
  const reported = connection?.state;
  state.shutdown.lineState =
    reported === 'offline' ? 'offline' : reported === 'online' ? 'online' : 'unknown';
  state.lineConnection = connection ?? null;
  renderShutdownLineState(connection);
}

async function refreshShutdownLineState() {
  let connection = state.lineConnection;
  if (state.machineId) {
    try {
      connection = await getJson(`/api/machines/${state.machineId}/connection`);
    } catch (error) {
      // Mantém a última leitura conhecida; o estado só libera o botão se for offline.
    }
  }
  applyShutdownLineState(connection);
}

function startLineStatePolling() {
  if (state.shutdown.lineTimer) return;
  state.shutdown.lineTimer = setInterval(() => {
    if (state.shutdown.phase === 'confirm' && !el.shutdownModal.hidden) {
      void refreshShutdownLineState();
    }
  }, 2000);
}

function stopLineStatePolling() {
  if (state.shutdown.lineTimer) {
    clearInterval(state.shutdown.lineTimer);
    state.shutdown.lineTimer = null;
  }
}

function openShutdownModal() {
  state.shutdown.phase = 'confirm';
  state.shutdown.apiLost = false;
  state.shutdown.triggered = false;
  state.shutdown.closeScheduled = false;
  state.shutdown.lineState = 'unknown';
  state.shutdown.lineConfirmed = false;
  state.shutdown.status = null;
  el.shutdownLineCheckbox.checked = false;
  el.shutdownFinal.textContent = 'É seguro desligar o computador.';
  el.shutdownModal.hidden = false;
  renderShutdown(null);
  startLineStatePolling();
  void refreshShutdownLineState();
  el.shutdownConfirm.focus();
}

function closeShutdownModal() {
  el.shutdownModal.hidden = true;
  stopLineStatePolling();
  stopSystemStatusPolling();
}

async function triggerSystemAction() {
  el.shutdownMessage.textContent = 'Acionando o encerramento no host...';
  try {
    const response = await fetch('/api/system/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pi40-control': '1' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.shutdown.triggered = true;
    el.shutdownInstruction.hidden = true;
    el.shutdownMessage.textContent = 'Encerramento iniciado. Acompanhando o progresso...';
  } catch (error) {
    state.shutdown.triggered = false;
    el.shutdownInstruction.hidden = false;
    el.shutdownMessage.textContent =
      'Não foi possível acionar o serviço local. Execute o atalho ENCERRAR-PI40.cmd.';
  }
}

function confirmShutdown() {
  if (state.shutdown.phase !== 'confirm') return;
  if (state.shutdown.lineState !== 'offline' || !state.shutdown.lineConfirmed) return;

  stopLineStatePolling();
  state.shutdown.phase = 'progress';
  state.shutdown.startedAt = Date.now();
  state.shutdown.status = {
    state: 'running',
    action: 'Stop',
    message: 'Dashboard pausado. Aguardando a confirmação do encerramento no host.',
    steps: [
      {
        id: 'dashboard',
        label: SHUTDOWN_STEPS[0].label,
        status: 'done',
        detail: 'Dashboard pausado e stream fechado.',
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  stopMonitoring();
  renderShutdown(state.shutdown.status);
  startSystemStatusPolling();
  void triggerSystemAction();
}

function renderLineConnection(connection) {
  state.lineConnection = connection ?? null;
  renderOperation();
  updateMonitoringStages();

  const badge = el.lineConnection;
  badge.classList.remove('line-online', 'line-stopped', 'line-offline', 'line-unknown');

  if (!connection || connection.state === 'unknown') {
    badge.textContent = 'Linha: —';
    badge.title = 'Aguardando heartbeat do gateway';
    badge.classList.add('line-unknown');
    return;
  }

  const reportedAt = connection.lastReadAt
    ? new Date(connection.lastReadAt).toLocaleTimeString('pt-BR')
    : null;

  if (connection.state === 'offline') {
    badge.textContent = 'Linha: sem comunicação';
    badge.title = connection.error
      ? `Falha: ${connection.error}`
      : 'Gateway sem heartbeat; CLP pode estar desligado';
    badge.classList.add('line-offline');
    return;
  }

  if (connection.running === true) {
    badge.textContent = 'Linha: operando';
    badge.title = reportedAt ? `CLP respondeu às ${reportedAt}` : 'CLP respondeu';
    badge.classList.add('line-online');
  } else if (connection.running === false) {
    badge.textContent = 'Linha: parada';
    badge.title = reportedAt ? `CLP respondeu às ${reportedAt}` : 'CLP respondeu';
    badge.classList.add('line-stopped');
  } else {
    badge.textContent = 'Linha: conectada';
    badge.title = 'CLP respondeu, mas o estado de operação é desconhecido';
    badge.classList.add('line-unknown');
  }
}

async function refreshLineConnection() {
  if (!state.machineId) {
    renderLineConnection(null);
    return;
  }

  try {
    const connection = await getJson(`/api/machines/${state.machineId}/connection`);
    renderLineConnection(connection);
  } catch (error) {
    console.error(error);
    if (state.monitoring.enabled) {
      setStage('gateway', 'error', 'Falha ao consultar /connection.');
      setStage('plc', 'error', 'Estado da linha indisponível.');
      syncMonitoringProgress();
      renderMonitoring();
    }
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

function formatMaintenanceUsage(value, unit = 'ciclos') {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return unit === 'h'
    ? `${number.toFixed(1).replace('.', ',')} h`
    : `${formatNumber(number)} ciclos`;
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

function renderOperation() {
  const connection = state.lineConnection;

  if (connection && connection.state === 'offline') {
    el.running.textContent = 'Linha sem comunicação';
    el.running.style.color = 'var(--danger)';
    el.running.title = 'O gateway não consegue ler o CLP da linha';
    return;
  }

  el.running.title = '';

  const latest = state.samples[0];
  if (!latest) {
    el.running.textContent = '—';
    el.running.style.color = 'var(--muted)';
    return;
  }

  const operando = latest.payload?.line?.running === true;
  el.running.textContent = operando ? 'Linha em operação' : 'Operação Parada';
  el.running.style.color = operando ? 'var(--ok)' : 'var(--warn)';
}

function renderPlaceholders() {
  renderOperation();
  el.filled.textContent = '0';
  el.capped.textContent = '0';
  el.total.textContent = '0';
  el.accumulated.textContent = '0';
  el.lastUpdate.textContent = 'sem dados';
}

function renderTelemetry(samples) {
  const latest = samples[0];
  if (!latest) {
    renderPlaceholders();
    drawChart([]);
    return;
  }

  const production = latest.payload?.production ?? {};

  renderOperation();

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

function renderProductionTotal(data) {
  if (!data) {
    el.accumulated.textContent = '0';
    el.accumulated.title = '';
    return;
  }

  el.accumulated.textContent = formatNumber(data.accumulatedProduced);
  const resetAt = data.lastResetAt ? new Date(data.lastResetAt) : null;
  el.accumulated.title = Number.isNaN(resetAt?.getTime())
    ? ''
    : `Último reset da linha: ${resetAt.toLocaleString('pt-BR')}`;
}

async function refreshProductionTotal() {
  if (!state.machineId) {
    renderProductionTotal(null);
    markDatabaseStage(false, 'Nenhuma máquina selecionada.');
    return;
  }

  try {
    const data = await getJson(`/api/machines/${state.machineId}/production/total`);
    renderProductionTotal(data);
    markDatabaseStage(
      true,
      `Acumulado sincronizado: ${formatNumber(data.accumulatedProduced)} produzidas.`
    );
  } catch (error) {
    console.error(error);
    renderProductionTotal(null);
    markDatabaseStage(false, 'Não foi possível consultar o acumulado de produção.');
  }
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
  if (value === null || value === undefined || value === '') return '—';
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
    const idButton = document.createElement('button');
    idButton.type = 'button';
    idButton.className = 'order-link';
    idButton.dataset.id = String(order.id);
    idButton.textContent = `#${order.id}`;
    idButton.setAttribute('aria-label', `Abrir ordem de serviço ${order.id}`);
    idCell.append(idButton);

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

    const sapCell = document.createElement('td');
    sapCell.textContent = order.sap?.external_id ?? '—';

    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'order-action';
    button.dataset.id = String(order.id);
    button.textContent = 'Concluir';
    actionCell.append(button);

    row.append(idCell, componentCell, statusCell, priorityCell, partsCell, sapCell, actionCell);
    el.maintenanceOrdersBody.append(row);
  }
}

function modalRow(label, value) {
  const row = document.createElement('div');
  row.className = 'modal-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'modal-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'modal-value';
  valueEl.textContent = value === null || value === undefined || value === '' ? '—' : value;

  row.append(labelEl, valueEl);
  return row;
}

function renderOrderModal(order) {
  const name = state.maintenanceNames.get(order.component_code) ?? order.component_code;
  const parts = order.parts ?? [];
  const partsText = parts.length
    ? parts
        .map(
          (part) =>
            `${part.quantity || 1}x ${part.code}${part.name ? ` — ${part.name}` : ''}` +
            ` (${part.status ?? 'reservado'})`
        )
        .join('\n')
    : 'Nenhuma peça reservada';

  el.orderModalTitle.textContent = `Ordem de serviço #${order.id}`;
  el.orderModalBody.innerHTML = '';

  const rows = [
    ['Número', `#${order.id}`],
    ['Máquina', state.machineCode ?? String(order.machine_id)],
    ['Componente', `${name} (${order.component_code})`],
    ['Status', MAINTENANCE_STATUS_LABELS[order.status] ?? order.status],
    ['Prioridade', PRIORITY_LABELS[order.priority] ?? order.priority],
    ['Uso na origem', formatMaintenanceUsage(order.source_usage, order.source_unit)],
    ['Peças reservadas', partsText],
    ['ID SAP', order.sap?.external_id],
    ['Evento SAP', order.sap?.event],
    ['Envio SAP', order.sap?.sent_at ? formatDateTime(order.sap.sent_at) : '—'],
    ['Previsão', formatDateTime(order.due_at)],
    ['Criada em', formatDateTime(order.created_at)],
    ['Atualizada em', formatDateTime(order.updated_at)],
    ['Concluída em', formatDateTime(order.completed_at)],
  ];

  for (const [label, value] of rows) {
    el.orderModalBody.append(modalRow(label, value));
  }

  const active = ['planned', 'open', 'in_progress'].includes(order.status);
  el.orderSend.disabled = !active || order.status === 'in_progress';
  el.orderCancel.disabled = !active;
}

function openOrderModal(orderId) {
  // IDs podem chegar como string (BIGINT) ou número; normaliza antes de comparar.
  const id = String(orderId);
  const order = state.orders.find((item) => String(item.id) === id);
  if (!order) return;

  state.selectedOrderId = id;
  renderOrderModal(order);
  el.orderModal.hidden = false;
  el.orderModalClose.focus();
}

function closeOrderModal() {
  el.orderModal.hidden = true;
  state.selectedOrderId = null;
}

async function changeSelectedOrder(action) {
  const id = state.selectedOrderId;
  if (id === null) return;

  try {
    const response = await fetch(`/api/maintenance/orders/${id}/${action}`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    closeOrderModal();
    await Promise.all([refreshMaintenance(), refreshAlerts()]);
  } catch (error) {
    console.error(error);
  }
}

function renderMaintenance(data) {
  const components = data?.components ?? [];
  const orders = data?.orders ?? [];
  const names = new Map(components.map((component) => [component.code, component.name]));

  state.orders = orders;
  state.maintenanceNames = names;
  if (
    state.selectedOrderId !== null &&
    !orders.some((order) => String(order.id) === String(state.selectedOrderId))
  ) {
    closeOrderModal();
  }

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
      `${formatMaintenanceUsage(component.usage, component.unit)} / ` +
      `${formatMaintenanceUsage(component.mtbf, component.unit)}` +
      ` · restam ${formatMaintenanceUsage(component.remaining, component.unit)}`;

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
    if (state.monitoring.enabled) updateMonitoringStages();
  } catch (error) {
    console.error(error);
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
  void refreshProductionTotal();
  void refreshLineConnection();
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
      renderProductionTotal(null);
      renderLineConnection(null);
      drawChart([]);
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
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}



el.alertsList.addEventListener('click', (event) => {
  const button = event.target.closest('.alert-resolve');
  if (!button) return;
  void resolveAlertById(button.dataset.id);
});

el.maintenanceOrdersBody.addEventListener('click', (event) => {
  const link = event.target.closest('.order-link');
  if (link) {
    openOrderModal(link.dataset.id);
    return;
  }

  const button = event.target.closest('.order-action');
  if (!button) return;
  void completeMaintenanceOrder(button.dataset.id);
});

el.orderModalClose.addEventListener('click', closeOrderModal);
el.orderModalDismiss.addEventListener('click', closeOrderModal);
el.orderModal.querySelector('[data-close-modal]').addEventListener('click', closeOrderModal);
el.warningClose.addEventListener('click', closeWarningModal);
el.warningDismiss.addEventListener('click', closeWarningModal);
el.warningModal.querySelector('[data-close-warning]').addEventListener('click', closeWarningModal);
el.bootEnter.addEventListener('click', enterDashboard);
el.bootRetry.addEventListener('click', retryBoot);
el.bootDiagnostic.addEventListener('click', openDiagnosticModal);
el.shutdownOpen.addEventListener('click', openShutdownModal);
el.shutdownClose.addEventListener('click', closeShutdownModal);
el.shutdownDismiss.addEventListener('click', closeShutdownModal);
el.shutdownModal.querySelector('[data-close-shutdown]').addEventListener('click', closeShutdownModal);
el.shutdownConfirm.addEventListener('click', confirmShutdown);
el.shutdownCopy.addEventListener('click', copyShutdownCommand);
el.shutdownLineCheckbox.addEventListener('change', () => {
  state.shutdown.lineConfirmed = el.shutdownLineCheckbox.checked;
  renderShutdown(null);
});
el.orderSend.addEventListener('click', () => void changeSelectedOrder('send'));
el.orderCancel.addEventListener('click', () => void changeSelectedOrder('cancel'));

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!state.boot.active && !el.shutdownModal.hidden) {
    closeShutdownModal();
    return;
  }
  if (!el.warningModal.hidden) {
    closeWarningModal();
    return;
  }
  if (!el.diagnosticModal.hidden) {
    closeDiagnosticModal();
    return;
  }
  if (!el.orderModal.hidden) {
    closeOrderModal();
  }
});

window.addEventListener('resize', () => {
  drawChart(state.lastSamples);
});

function connectStream() {
  if (typeof EventSource === 'undefined' || state.stream) return;

  const source = new EventSource('/api/stream');
  state.stream = source;

  source.addEventListener('open', () => {
    state.streamOnline = true;
    if (state.monitoring.enabled) {
      addMonitoringEvent('SSE conectado', 'Eventos em tempo real ativos.', 'ok');
      updateMonitoringStages();
    }
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
    if (state.monitoring.enabled) {
      const produced = payload.production?.total ?? 0;
      addMonitoringEvent(
        payload.line?.running ? 'Linha em operação' : 'Telemetria recebida',
        `Total ${formatNumber(produced)} unidades; etapa ${payload.line?.step ?? '—'}.`,
        'info'
      );
      updateMonitoringStages();
    }
  });

  source.addEventListener('production', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (!payload || payload.machineId !== state.machineCode) return;
    renderProductionTotal(payload.totals);
    if (state.monitoring.enabled) {
      markDatabaseStage(true, `Acumulado sincronizado: ${formatNumber(payload.totals?.accumulatedProduced)} produzidas.`);
      if (payload.action === 'reset') {
        addMonitoringEvent('Reset de produção detectado', 'Contador atual zerado; acumulado preservado no banco.', 'warn');
      }
    }
  });

  source.addEventListener('connection', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (!payload || payload.machineId !== state.machineCode) return;
    renderLineConnection(payload.connection ?? null);
    if (state.monitoring.enabled) {
      if (payload.action === 'lost' || payload.action === 'connection.lost') {
        addMonitoringEvent('Comunicação perdida', payload.connection?.error || 'Gateway sem heartbeat.', 'error');
      }
      if (payload.action === 'restored' || payload.action === 'connection.restored') {
        addMonitoringEvent('Comunicação restabelecida', 'O gateway voltou a responder.', 'ok');
      }
    }
  });

  source.addEventListener('alert', (event) => {
    if (state.monitoring.enabled) {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.machineId === state.machineCode) {
          addMonitoringEvent(
            payload.action === 'resolved' ? 'Alerta resolvido' : 'Novo alerta',
            payload.alert?.message || 'Evento de alerta recebido.',
            payload.action === 'resolved' ? 'ok' : 'warn'
          );
        }
      } catch {}
    }
    void refreshAlerts();
  });

  source.addEventListener('maintenance', (event) => {
    if (state.monitoring.enabled) {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.machineId === state.machineCode) {
          addMonitoringEvent(
            'Manutenção atualizada',
            `OS ${payload.order?.id ?? '—'}: ${payload.action || 'atualizada'}.`,
            'info'
          );
        }
      } catch {}
    }
    void refreshMaintenance();
    void refreshAlerts();
  });

  source.addEventListener('error', () => {
    state.streamOnline = false;
    if (state.monitoring.enabled) updateMonitoringStages();
  });
}

el.machineSelect.addEventListener('change', () => {
  const selected = state.machines.find(
    (machine) => String(machine.id) === el.machineSelect.value
  );
  state.machineId = selected ? selected.id : null;
  state.machineCode = selected ? selected.code : null;
  state.samples = [];
  state.lastSamples = [];
  if (state.monitoring.enabled) refreshAll();
});

el.periodSelect.addEventListener('change', () => {
  state.periodMinutes = Number(el.periodSelect.value) || 60;
  if (state.monitoring.enabled) {
    void refreshOee();
    void refreshProduction();
  }
});

el.productionBucket.addEventListener('change', () => {
  state.productionBucket = el.productionBucket.value === 'shift' ? 'shift' : 'hour';
  if (state.monitoring.enabled) void refreshProduction();
});

el.refresh.addEventListener('click', () => {
  if (!state.monitoring.enabled) {
    addMonitoringEvent('Monitoramento desligado', 'Ligue o monitoramento para atualizar os dados.', 'warn');
    openWarningModal('Ligue o monitoramento para atualizar os dados.');
    return;
  }
  void loadMachines().then((hasMachines) => {
    if (hasMachines) refreshAll();
  });
});

async function start() {
  renderMonitoringEvents();
  renderMonitoring();
  el.monitoringToggle.addEventListener('click', () => {
    if (state.monitoring.enabled) stopMonitoring();
    else void startMonitoring();
  });
  el.diagnosticOpen.addEventListener('click', openDiagnosticModal);
  el.diagnosticClose.addEventListener('click', closeDiagnosticModal);
  el.diagnosticDismiss.addEventListener('click', closeDiagnosticModal);
  el.diagnosticModal.querySelector('[data-close-diagnostic]').addEventListener('click', closeDiagnosticModal);

  setInterval(async () => {
    if (!state.monitoring.enabled) return;
    if (!state.machineId) {
      const found = await loadMachines();
      if (found) refreshAll();
      return;
    }
    if (!state.streamOnline) void refreshTelemetry();
  }, POLL_TELEMETRY_MS);

  setInterval(() => {
    if (state.monitoring.enabled && state.machineId) void refreshOee();
  }, POLL_OEE_MS);

  setInterval(() => {
    if (state.monitoring.enabled && state.machineId && !state.streamOnline) {
      void refreshLineConnection();
    }
  }, POLL_TELEMETRY_MS);

  setInterval(() => {
    if (state.monitoring.enabled && state.machineId) void refreshAlerts();
  }, POLL_ALERTS_MS);

  setInterval(() => {
    if (state.monitoring.enabled && state.machineId) void refreshMaintenance();
  }, POLL_MAINTENANCE_MS);

  setInterval(() => {
    if (state.monitoring.enabled && state.machineId) void refreshProduction();
  }, POLL_PRODUCTION_MS);

  if (shouldShowBoot()) enterBoot();
}

void start();
