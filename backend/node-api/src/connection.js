'use strict';

// Um heartbeat é considerado válido por pouco mais que o intervalo de polling
// do gateway. Depois disso o backend trata a linha como sem comunicação, mesmo
// que o gateway tenha caído sem avisar.
const DEFAULT_STALE_MS = 10000;

function createConnectionTracker({
  staleMs = DEFAULT_STALE_MS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();

  function chave(machineId) {
    return String(machineId);
  }

  function view(machineId, currentTime = now()) {
    const id = chave(machineId);
    const entry = entries.get(id);
    const base = {
      machineId: id,
      state: 'unknown',
      connected: false,
      running: null,
      lastReadAt: null,
      lastStatusAt: null,
      reportedAt: null,
      failures: 0,
      error: null,
    };

    if (!entry) return base;

    const expired = currentTime - entry.updatedAt > staleMs;

    return {
      ...base,
      state: expired || !entry.connected ? 'offline' : 'online',
      connected: !expired && entry.connected,
      running: expired ? null : entry.running,
      lastReadAt: entry.lastReadAt,
      lastStatusAt: new Date(entry.updatedAt).toISOString(),
      reportedAt: entry.reportedAt,
      failures: entry.failures,
      error: expired ? 'heartbeat expirado' : entry.error,
    };
  }

  function update(machineId, status, currentTime = now()) {
    const id = chave(machineId);
    const previous = view(id, currentTime);

    entries.set(id, {
      connected: Boolean(status.connected),
      running: typeof status.running === 'boolean' ? status.running : null,
      lastReadAt: status.lastReadAt ?? null,
      reportedAt: status.timestamp ?? null,
      failures: Number(status.failures) || 0,
      error: status.error ?? null,
      updatedAt: currentTime,
    });

    const next = view(id, currentTime);
    return { view: next, events: transicoes(previous.state, next.state) };
  }

  function transicoes(anterior, atual) {
    if (anterior === 'offline' && atual === 'online') return ['connection.restored'];
    if (anterior === 'online' && atual === 'offline') return ['connection.lost'];
    return [];
  }

  // Detecta gateway parado sem aviso. Não altera o timestamp do heartbeat:
  // assim, quando o status voltar, a transição offline → online é disparada.
  function sweep(ids = [...entries.keys()], currentTime = now()) {
    const resultados = [];

    for (const id of ids) {
      const entry = entries.get(id);
      if (!entry || !entry.connected) continue;

      if (currentTime - entry.updatedAt > staleMs) {
        entries.set(id, { ...entry, connected: false });
        resultados.push({
          machineId: id,
          events: ['connection.lost'],
          view: view(id, currentTime),
        });
      }
    }

    return resultados;
  }

  return { update, view, sweep };
}

module.exports = {
  DEFAULT_STALE_MS,
  createConnectionTracker,
};
