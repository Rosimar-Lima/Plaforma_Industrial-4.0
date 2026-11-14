const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const MACHINE_ID = process.env.MACHINE_ID || 'machine-01';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 2000);

let producedCount = 0;

function reading(min, max, decimals = 2) {
  return Number((Math.random() * (max - min) + min).toFixed(decimals));
}

function nextTelemetry() {
  producedCount += Math.round(reading(1, 5, 0));
  const goodCount = Math.max(0, producedCount - Math.round(producedCount * 0.02));

  return {
    machineId: MACHINE_ID,
    timestamp: new Date().toISOString(),
    sensors: {
      temperature: reading(60, 90),
      pressure: reading(4, 8),
      speed: reading(1200, 1800, 0),
    },
    production: {
      produced: producedCount,
      good: goodCount,
    },
  };
}

async function send(payload) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Falha ao enviar telemetria: HTTP ${response.status}`);
      return;
    }

    console.log(`Telemetria enviada (${payload.machineId})`);
  } catch (error) {
    console.error(`Erro de conexão: ${error.message}`);
  }
}

console.log(`Simulador iniciado: ${MACHINE_ID} -> ${BACKEND_URL} (${INTERVAL_MS}ms)`);

setInterval(() => {
  send(nextTelemetry());
}, INTERVAL_MS);
