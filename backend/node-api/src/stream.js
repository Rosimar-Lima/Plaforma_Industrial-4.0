'use strict';

function createStreamHub({ heartbeatMs = 20000 } = {}) {
  const clients = new Set();

  function writeEvent(client, event, data) {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function subscribe(req, res) {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('retry: 3000\n');
    res.write('event: ready\ndata: {}\n\n');

    const heartbeat = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch (error) {
        clearInterval(heartbeat);
      }
    }, heartbeatMs);
    heartbeat.unref?.();

    const client = { res, heartbeat };
    clients.add(client);

    res.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(client);
    });
  }

  function broadcast(event, data) {
    for (const client of clients) {
      try {
        writeEvent(client, event, data);
      } catch (error) {
        clearInterval(client.heartbeat);
        clients.delete(client);
      }
    }
  }

  function size() {
    return clients.size;
  }

  function closeAll() {
    for (const client of clients) {
      clearInterval(client.heartbeat);
      try {
        client.res.end();
      } catch (error) {
        // conexão já encerrada
      }
    }
    clients.clear();
  }

  return {
    subscribe,
    broadcast,
    size,
    closeAll,
  };
}

module.exports = {
  createStreamHub,
};
