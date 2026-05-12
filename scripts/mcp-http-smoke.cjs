const path = require('path');
const { startHttpMcpServer } = require(path.join(
  __dirname,
  '..',
  'dist-electron',
  'mcp',
  'http.js',
));

(async () => {
  const info = await startHttpMcpServer();
  console.log('[mcp-http-smoke] listening:', info);

  const res = await fetch(`http://127.0.0.1:${info.port}/healthz`);
  const data = await res.json();
  console.log('[mcp-http-smoke] /healthz:', res.status, data);

  // open SSE briefly to confirm session establishment
  const controller = new AbortController();
  const sseResp = await fetch(`http://127.0.0.1:${info.port}/sse`, {
    signal: controller.signal,
    headers: { Accept: 'text/event-stream' },
  });
  console.log('[mcp-http-smoke] /sse status:', sseResp.status, 'ctype:', sseResp.headers.get('content-type'));

  setTimeout(() => {
    controller.abort();
    process.exit(0);
  }, 500);
})().catch((e) => {
  console.error('[mcp-http-smoke] FAIL', e);
  process.exit(1);
});
