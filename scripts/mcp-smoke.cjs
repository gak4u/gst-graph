const path = require('path');
const { Client } = require(path.join(
  __dirname,
  '..',
  'node_modules',
  '@modelcontextprotocol',
  'sdk',
  'dist',
  'cjs',
  'client',
  'index.js',
));
const { StdioClientTransport } = require(path.join(
  __dirname,
  '..',
  'node_modules',
  '@modelcontextprotocol',
  'sdk',
  'dist',
  'cjs',
  'client',
  'stdio.js',
));

function parseOutput(res) {
  const text = res.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

(async () => {
  const serverPath = path.join(__dirname, '..', 'dist-electron', 'mcp', 'stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
  });
  const client = new Client({ name: 'gst-graph-smoke', version: '0.1.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`[mcp-smoke] tools exposed: ${tools.tools.length}`);
  for (const t of tools.tools) {
    console.log(`  - ${t.name}`);
  }

  const version = parseOutput(
    await client.callTool({ name: 'gst_version', arguments: {} }),
  );
  console.log('[mcp-smoke] gst_version:', version);

  const list = parseOutput(
    await client.callTool({ name: 'gst_list_elements', arguments: { filter: 'videotestsrc', limit: 5 } }),
  );
  console.log(`[mcp-smoke] videotestsrc matches: ${list.elements.length}`);

  const before = parseOutput(await client.callTool({ name: 'gst_list_pipelines', arguments: {} }));
  console.log(`[mcp-smoke] pipelines before: ${before.count}`);

  const created = parseOutput(
    await client.callTool({
      name: 'gst_create_pipeline',
      arguments: { name: 'mcp-smoke-test' },
    }),
  );
  const pid = created.id;
  console.log('[mcp-smoke] created pipeline:', created);

  const vts = parseOutput(
    await client.callTool({
      name: 'gst_add_element',
      arguments: { pipelineId: pid, elementName: 'videotestsrc', properties: { 'num-buffers': 1 } },
    }),
  );
  const fakesink = parseOutput(
    await client.callTool({
      name: 'gst_add_element',
      arguments: { pipelineId: pid, elementName: 'fakesink' },
    }),
  );
  console.log('[mcp-smoke] added elements:', { vts, fakesink });

  const link = parseOutput(
    await client.callTool({
      name: 'gst_link_elements',
      arguments: { pipelineId: pid, sourceId: vts.id, targetId: fakesink.id },
    }),
  );
  console.log('[mcp-smoke] link:', link);

  const variable = parseOutput(
    await client.callTool({
      name: 'gst_add_variable',
      arguments: {
        pipelineId: pid,
        varName: 'kbps',
        label: 'Bitrate (kbps)',
        valueKind: 'number',
        value: 8,
      },
    }),
  );
  console.log('[mcp-smoke] variable:', variable);

  const transform = parseOutput(
    await client.callTool({
      name: 'gst_add_transform',
      arguments: {
        pipelineId: pid,
        kind: 'math',
        label: 'kbps -> num-buffers',
        inputs: [{ name: 'a' }],
        expression: 'a * 1000',
      },
    }),
  );
  console.log('[mcp-smoke] transform:', transform);

  const wire = parseOutput(
    await client.callTool({
      name: 'gst_wire_transform_input',
      arguments: {
        pipelineId: pid,
        sourceId: variable.id,
        transformId: transform.id,
        inputId: transform.inputs[0].id,
      },
    }),
  );
  console.log('[mcp-smoke] wired transform input:', wire);

  const bind = parseOutput(
    await client.callTool({
      name: 'gst_bind_value',
      arguments: {
        pipelineId: pid,
        sourceId: transform.id,
        targetId: vts.id,
        property: 'num-buffers',
      },
    }),
  );
  console.log('[mcp-smoke] binding:', bind);

  const cmd = parseOutput(
    await client.callTool({ name: 'gst_get_command', arguments: { pipelineId: pid } }),
  );
  console.log('[mcp-smoke] command:', cmd.command);

  const run = parseOutput(
    await client.callTool({ name: 'gst_run_pipeline', arguments: { pipelineId: pid } }),
  );
  console.log('[mcp-smoke] run:', run);

  await new Promise((r) => setTimeout(r, 600));
  const status = parseOutput(
    await client.callTool({ name: 'gst_get_run_status', arguments: { pipelineId: pid } }),
  );
  console.log('[mcp-smoke] status after 600ms:', status);

  await new Promise((r) => setTimeout(r, 2000));

  const final = parseOutput(
    await client.callTool({ name: 'gst_get_run_status', arguments: { pipelineId: pid } }),
  );
  console.log('[mcp-smoke] status after 2.6s:', final);

  const deleted = parseOutput(
    await client.callTool({ name: 'gst_delete_pipeline', arguments: { pipelineId: pid } }),
  );
  console.log('[mcp-smoke] deleted:', deleted);

  await client.close();
})().catch((e) => {
  console.error('[mcp-smoke] FAIL', e);
  process.exit(1);
});
