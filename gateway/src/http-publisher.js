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

  const baseUrl = String(backendUrl).replace(/\/+$/, '');
  const url = `${baseUrl}/api/telemetry`;
  const statusUrl = `${baseUrl}/api/gateway/status`;

  async function post(endpoint, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function postWithRetry(endpoint, payload, failureMessage) {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await post(endpoint, payload);

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

    throw lastError ?? new Error(failureMessage);
  }

  async function publish(payload) {
    return postWithRetry(url, payload, 'falha ao publicar telemetria');
  }

  // O status é um heartbeat leve. Não usa o mesmo esquema de retry longo da
  // telemetria: se o backend estiver fora, o próprio timeout do heartbeat no
  // backend trata a linha como sem comunicação.
  async function publishStatus(payload) {
    return postWithRetry(statusUrl, payload, 'falha ao publicar status');
  }

  return { publish, publishStatus, url, statusUrl };
}

module.exports = {
  sleep,
  createHttpPublisher,
};
