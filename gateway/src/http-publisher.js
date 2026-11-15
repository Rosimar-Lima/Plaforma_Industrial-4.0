'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHttpPublisher({
  backendUrl,
  fetchImpl = globalThis.fetch,
  maxRetries = 3,
  retryDelayMs = 500,
  timeoutMs = 5000,
} = {}) {
  if (!backendUrl) throw new Error('backendUrl é obrigatório');
  if (typeof fetchImpl !== 'function') throw new Error('fetch não disponível');

  const url = `${String(backendUrl).replace(/\/+$/, '')}/api/telemetry`;

  async function post(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function publish(payload) {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await post(payload);

        if (response.ok) {
          return await response.json().catch(() => ({}));
        }

        const text = await response.text().catch(() => '');
        const error = new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`);
        error.status = response.status;
        if (response.status < 500) throw error;
        lastError = error;
      } catch (error) {
        lastError = error;
        if (error.status && error.status < 500) throw error;
      }

      if (attempt < maxRetries) {
        await sleep(retryDelayMs * (attempt + 1));
      }
    }

    throw lastError ?? new Error('falha ao publicar telemetria');
  }

  return { publish, url };
}

module.exports = {
  sleep,
  createHttpPublisher,
};
