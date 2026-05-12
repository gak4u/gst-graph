import http from 'node:http';
import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerGstGraphTools } from './tools';
import { ensureDataDir, MCP_PORT_FILE } from './data';

interface HttpInfo {
  url: string;
  port: number;
  pid: number;
  startedAt: number;
}

export async function startHttpMcpServer(opts?: { port?: number }): Promise<HttpInfo> {
  ensureDataDir();
  const sessions = new Map<string, SSEServerTransport>();
  const httpServer = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res);
        const mcp = new Server(
          { name: 'gst-graph', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );
        registerGstGraphTools(mcp);
        sessions.set(transport.sessionId, transport);
        res.on('close', () => sessions.delete(transport.sessionId));
        await mcp.connect(transport);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/messages') {
        const sid = url.searchParams.get('sessionId');
        if (!sid) {
          res.statusCode = 400;
          res.end('Missing sessionId');
          return;
        }
        const transport = sessions.get(sid);
        if (!transport) {
          res.statusCode = 404;
          res.end('Unknown session');
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[gst-graph MCP HTTP]', e);
      try {
        res.statusCode = 500;
        res.end((e as Error).message);
      } catch {
        // already sent
      }
    }
  });

  return new Promise<HttpInfo>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts?.port ?? 0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine bound port'));
        return;
      }
      const port = address.port;
      const info: HttpInfo = {
        url: `http://127.0.0.1:${port}/sse`,
        port,
        pid: process.pid,
        startedAt: Date.now(),
      };
      try {
        fs.writeFileSync(MCP_PORT_FILE, JSON.stringify(info, null, 2));
      } catch {
        // non-fatal
      }
      resolve(info);
    });
  });
}
