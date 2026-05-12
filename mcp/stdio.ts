import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerGstGraphTools } from './tools';
import { ensureDataDir } from './data';

async function main(): Promise<void> {
  ensureDataDir();
  const server = new Server(
    { name: 'gst-graph', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registerGstGraphTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`[gst-graph MCP] fatal: ${(e as Error).stack || e}`);
  process.exit(1);
});
