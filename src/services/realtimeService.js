// Server-Sent Events (SSE) Hub for instant real-time synchronization across all tabs and clients
const sseClients = new Set();

export const subscribeSSE = (req, res) => {
  const origin = req.headers.origin || 'https://crm.prittal.com';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true'
  });
  if (res.flushHeaders) {
    res.flushHeaders();
  }

  // Send immediate initial connection ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);

  sseClients.add(res);

  // Keep-alive comment every 20 seconds to prevent proxy/browser connection timeout
  const keepAliveTimer = setInterval(() => {
    try {
      res.write(`: keep-alive ${Date.now()}\n\n`);
    } catch {
      clearInterval(keepAliveTimer);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    sseClients.delete(res);
  });
};

export const broadcastRealtimeUpdate = (type = 'DATA_UPDATED', payload = {}) => {
  const data = `data: ${JSON.stringify({ type, payload, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
};
