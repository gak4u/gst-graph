import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listElements, inspectElement, getGstVersion } from '../electron/gst/inspect';
import { buildCommand } from '../electron/gst/runner';
import {
  readPipelines,
  writePipelines,
  findPipeline,
  updatePipeline as updatePipelineFile,
} from './data';
import {
  addElementNode,
  addTransformNode,
  addVariableNode,
  bindValueToProperty,
  linkElements,
  newPipelineDef,
  pipelineSummary,
  removeNode,
  setElementProperty,
  setTransformExpression,
  setVariableValue,
  wireTransformInput,
} from './builder';
import { getRunStatus, startPipeline, stopPipeline } from './runner';
import type { PipelineDef } from '../shared/types';

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function ok<T>(data: T): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown) => Promise<ToolResult>;
}

function defineTool<S extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  schema: S;
  inputSchema: Record<string, unknown>;
  handler: (input: z.infer<S>) => Promise<ToolResult>;
}): ToolDef {
  return def as unknown as ToolDef;
}

// JSON Schema shorthands keep MCP listTools light and explicit. Avoids zod-to-json conversion at runtime.
const jsonStr = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const jsonNum = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });
const jsonBool = (description?: string) => ({ type: 'boolean', ...(description ? { description } : {}) });
const jsonAny = (description?: string) => ({
  ...(description ? { description } : {}),
  oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
});
const jsonObject = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});
const jsonOptional = (props: Record<string, unknown>) => ({
  type: 'object',
  properties: props,
  additionalProperties: false,
});
const positionJson = {
  type: 'object',
  description: 'Optional graph position { x, y } in flow coordinates',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const positionSchema = z.object({ x: z.number(), y: z.number() }).optional();

const tools: ToolDef[] = [
  defineTool({
    name: 'gst_version',
    description: 'Return the detected GStreamer toolchain version (from gst-inspect-1.0 --gst-version).',
    schema: z.object({}).optional(),
    inputSchema: jsonOptional({}),
    handler: async () => ok({ version: await getGstVersion() }),
  }),

  defineTool({
    name: 'gst_list_elements',
    description:
      'List GStreamer elements known to gst-inspect-1.0. Supports a case-insensitive substring filter and klass filter, limited to N results.',
    schema: z.object({
      filter: z.string().optional(),
      klass: z.string().optional(),
      limit: z.number().int().positive().max(2000).optional(),
    }),
    inputSchema: jsonOptional({
      filter: jsonStr('Substring matched case-insensitively against name, longName, or description'),
      klass: jsonStr('Klass filter, e.g. "Source/Video"'),
      limit: jsonNum('Maximum results to return (default 200)'),
    }),
    handler: async ({ filter, klass, limit }) => {
      const max = limit ?? 200;
      const els = await listElements();
      const needle = filter?.toLowerCase();
      const filtered = els.filter((e) => {
        if (klass && !e.klass.toLowerCase().includes(klass.toLowerCase())) return false;
        if (!needle) return true;
        return (
          e.name.toLowerCase().includes(needle) ||
          e.longName.toLowerCase().includes(needle) ||
          e.description.toLowerCase().includes(needle)
        );
      });
      return ok({
        total: filtered.length,
        returned: Math.min(max, filtered.length),
        elements: filtered.slice(0, max),
      });
    },
  }),

  defineTool({
    name: 'gst_inspect_element',
    description:
      'Detailed metadata for a single GStreamer element: properties (kind, default, range, enum values, conditional requirements), pad templates with caps, class hierarchy.',
    schema: z.object({ name: z.string() }),
    inputSchema: jsonObject({ name: jsonStr('Element name, e.g. "videotestsrc"') }, ['name']),
    handler: async ({ name }) => {
      const detail = await inspectElement(name);
      if (!detail) return err(`Element "${name}" not found`);
      return ok(detail);
    },
  }),

  defineTool({
    name: 'gst_list_pipelines',
    description:
      'List saved pipelines with summary statistics and exposed variable values. Use gst_get_pipeline for the full graph.',
    schema: z.object({}).optional(),
    inputSchema: jsonOptional({}),
    handler: async () => {
      const pipelines = readPipelines();
      return ok({ count: pipelines.length, pipelines: pipelines.map(pipelineSummary) });
    },
  }),

  defineTool({
    name: 'gst_get_pipeline',
    description: 'Return the full JSON of a pipeline (nodes, edges, variables, transforms).',
    schema: z.object({ pipelineId: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr() }, ['pipelineId']),
    handler: async ({ pipelineId }) => {
      const p = findPipeline(pipelineId);
      if (!p) return err(`Pipeline ${pipelineId} not found`);
      return ok(p);
    },
  }),

  defineTool({
    name: 'gst_get_command',
    description:
      'Build the gst-launch-1.0 command line for a pipeline (with variable substitutions and transform evaluations applied). Useful for previewing what gst_run_pipeline will execute.',
    schema: z.object({ pipelineId: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr() }, ['pipelineId']),
    handler: async ({ pipelineId }) => {
      const p = findPipeline(pipelineId);
      if (!p) return err(`Pipeline ${pipelineId} not found`);
      return ok({ command: buildCommand(p) });
    },
  }),

  defineTool({
    name: 'gst_create_pipeline',
    description: 'Create a new empty pipeline. Returns the new pipeline id.',
    schema: z.object({ name: z.string() }),
    inputSchema: jsonObject({ name: jsonStr('Display name for the pipeline') }, ['name']),
    handler: async ({ name }) => {
      const all = readPipelines();
      const taken = new Set(all.map((p) => p.name));
      let unique = name;
      let suffix = 2;
      while (taken.has(unique)) unique = `${name} (${suffix++})`;
      const p = newPipelineDef(unique);
      all.push(p);
      writePipelines(all);
      return ok({ id: p.id, name: p.name });
    },
  }),

  defineTool({
    name: 'gst_delete_pipeline',
    description: 'Delete a pipeline by id.',
    schema: z.object({ pipelineId: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr() }, ['pipelineId']),
    handler: async ({ pipelineId }) => {
      const all = readPipelines();
      const before = all.length;
      const next = all.filter((p) => p.id !== pipelineId);
      if (next.length === before) return err(`Pipeline ${pipelineId} not found`);
      writePipelines(next);
      return ok({ deleted: pipelineId });
    },
  }),

  defineTool({
    name: 'gst_rename_pipeline',
    description: 'Rename a pipeline. Refuses if the new name collides with an existing pipeline.',
    schema: z.object({ pipelineId: z.string(), name: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr(), name: jsonStr() }, ['pipelineId', 'name']),
    handler: async ({ pipelineId, name }) => {
      const all = readPipelines();
      if (all.some((p) => p.name === name && p.id !== pipelineId)) {
        return err(`Another pipeline already has the name "${name}"`);
      }
      const result = updatePipelineFile(pipelineId, (p) => {
        p.name = name;
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      return ok({ id: result.id, name: result.name });
    },
  }),

  defineTool({
    name: 'gst_import_pipeline',
    description:
      'Import a pipeline from raw JSON (the same shape produced by gst_get_pipeline or the UI export button). Adds a unique name suffix if needed.',
    schema: z.object({ json: z.string() }),
    inputSchema: jsonObject({ json: jsonStr('Stringified pipeline JSON') }, ['json']),
    handler: async ({ json }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (e) {
        return err(`Invalid JSON: ${(e as Error).message}`);
      }
      if (!parsed || typeof parsed !== 'object') return err('JSON must be an object');
      const obj = parsed as Partial<PipelineDef>;
      if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
        return err('JSON must contain "nodes" and "edges" arrays');
      }
      const all = readPipelines();
      const taken = new Set(all.map((p) => p.name));
      const baseName = obj.name?.trim() || 'Imported';
      let name = baseName;
      let suffix = 2;
      while (taken.has(name)) name = `${baseName} (${suffix++})`;
      const id = `pl_${Math.random().toString(36).slice(2, 10)}`;
      const imported: PipelineDef = { id, name, nodes: obj.nodes, edges: obj.edges };
      all.push(imported);
      writePipelines(all);
      return ok({ id, name });
    },
  }),

  defineTool({
    name: 'gst_add_element',
    description:
      'Add a GStreamer element node to a pipeline. Returns the new node id and instance name (auto-generated if not given).',
    schema: z.object({
      pipelineId: z.string(),
      elementName: z.string(),
      instanceName: z.string().optional(),
      properties: z.record(valueSchema).optional(),
      position: positionSchema,
    }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        elementName: jsonStr('GStreamer element name, e.g. "videotestsrc"'),
        instanceName: jsonStr('Optional unique instance name; auto-generated when omitted'),
        properties: {
          type: 'object',
          description: 'Property values keyed by property name',
          additionalProperties: jsonAny(),
        },
        position: positionJson,
      },
      ['pipelineId', 'elementName'],
    ),
    handler: async ({ pipelineId, elementName, instanceName, properties, position }) => {
      let added: { id: string; instanceName: string } | null = null;
      const result = updatePipelineFile(pipelineId, (p) => {
        added = addElementNode(p, { elementName, instanceName, properties, position });
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      return ok(added!);
    },
  }),

  defineTool({
    name: 'gst_set_property',
    description: 'Set a property value on an element node. Use null to clear and fall back to the element default.',
    schema: z.object({
      pipelineId: z.string(),
      nodeId: z.string(),
      property: z.string(),
      value: valueSchema,
    }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        nodeId: jsonStr(),
        property: jsonStr(),
        value: jsonAny('New property value (string/number/boolean/null)'),
      },
      ['pipelineId', 'nodeId', 'property', 'value'],
    ),
    handler: async ({ pipelineId, nodeId, property, value }) => {
      let success = false;
      const result = updatePipelineFile(pipelineId, (p) => {
        success = setElementProperty(p, nodeId, property, value);
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      if (!success) return err(`Node ${nodeId} is not an element node`);
      return ok({ nodeId, property, value });
    },
  }),

  defineTool({
    name: 'gst_link_elements',
    description:
      'Connect two element nodes with a stream edge. Source/target pad names default to "src" and "sink" if not provided.',
    schema: z.object({
      pipelineId: z.string(),
      sourceId: z.string(),
      targetId: z.string(),
      sourcePad: z.string().optional(),
      targetPad: z.string().optional(),
    }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        sourceId: jsonStr(),
        targetId: jsonStr(),
        sourcePad: jsonStr('Source pad name; default "src"'),
        targetPad: jsonStr('Target pad name; default "sink"'),
      },
      ['pipelineId', 'sourceId', 'targetId'],
    ),
    handler: async ({ pipelineId, sourceId, targetId, sourcePad, targetPad }) => {
      let edgeId = '';
      const result = updatePipelineFile(pipelineId, (p) => {
        edgeId = linkElements(p, { sourceId, targetId, sourcePad, targetPad }).id;
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      return ok({ edgeId });
    },
  }),

  defineTool({
    name: 'gst_remove_node',
    description: 'Remove a node and any edges referencing it.',
    schema: z.object({ pipelineId: z.string(), nodeId: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr(), nodeId: jsonStr() }, ['pipelineId', 'nodeId']),
    handler: async ({ pipelineId, nodeId }) => {
      let removed = false;
      const result = updatePipelineFile(pipelineId, (p) => {
        removed = removeNode(p, nodeId);
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      if (!removed) return err(`Node ${nodeId} not found`);
      return ok({ removed: nodeId });
    },
  }),

  defineTool({
    name: 'gst_remove_edge',
    description: 'Remove a single edge by id.',
    schema: z.object({ pipelineId: z.string(), edgeId: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr(), edgeId: jsonStr() }, ['pipelineId', 'edgeId']),
    handler: async ({ pipelineId, edgeId }) => {
      let removed = false;
      const result = updatePipelineFile(pipelineId, (p) => {
        const before = p.edges.length;
        p.edges = p.edges.filter((e) => e.id !== edgeId);
        removed = p.edges.length < before;
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      if (!removed) return err(`Edge ${edgeId} not found`);
      return ok({ removed: edgeId });
    },
  }),

  defineTool({
    name: 'gst_add_variable',
    description:
      'Add a variable node. Variables can be wired to element properties (gst_bind_value) or used as transform inputs (gst_wire_transform_input). Set hidden=true to keep them off the Home screen as internal constants.',
    schema: z.object({
      pipelineId: z.string(),
      varName: z.string(),
      label: z.string().optional(),
      valueKind: z.enum(['string', 'number', 'boolean']),
      value: valueSchema.optional(),
      hidden: z.boolean().optional(),
      position: positionSchema,
    }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        varName: jsonStr('Identifier (letters/digits/underscore). Used in expressions like ${name}.'),
        label: jsonStr('Human-readable label shown on the Home tile'),
        valueKind: { type: 'string', enum: ['string', 'number', 'boolean'] },
        value: jsonAny(),
        hidden: jsonBool('If true the variable is treated as an internal constant and hidden from Home'),
        position: positionJson,
      },
      ['pipelineId', 'varName', 'valueKind'],
    ),
    handler: async ({ pipelineId, ...args }) => {
      let added: { id: string } | null = null;
      const result = updatePipelineFile(pipelineId, (p) => {
        added = addVariableNode(p, args);
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      return ok({ id: added!.id, varName: args.varName });
    },
  }),

  defineTool({
    name: 'gst_set_variable',
    description: "Set a variable's value. Accepts either the variable node id or its $varName identifier.",
    schema: z.object({ pipelineId: z.string(), variable: z.string(), value: valueSchema }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        variable: jsonStr('Variable node id or $name'),
        value: jsonAny(),
      },
      ['pipelineId', 'variable', 'value'],
    ),
    handler: async ({ pipelineId, variable, value }) => {
      let success = false;
      const result = updatePipelineFile(pipelineId, (p) => {
        success = setVariableValue(p, variable, value);
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      if (!success) return err(`Variable "${variable}" not found in pipeline`);
      return ok({ variable, value });
    },
  }),

  defineTool({
    name: 'gst_add_transform',
    description:
      'Add a transform node. "concat" uses a template like "rtmp://${host}/live", "math" evaluates an arithmetic expression with named inputs as variables ("a * 1000"). Defaults to two inputs ["a","b"] and expression "${a}${b}" / "a + b" when omitted.',
    schema: z.object({
      pipelineId: z.string(),
      kind: z.enum(['concat', 'math']),
      label: z.string().optional(),
      inputs: z.array(z.object({ name: z.string() })).optional(),
      expression: z.string().optional(),
      position: positionSchema,
    }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        kind: { type: 'string', enum: ['concat', 'math'] },
        label: jsonStr(),
        inputs: {
          type: 'array',
          items: jsonObject({ name: jsonStr() }, ['name']),
        },
        expression: jsonStr('Template (concat) or arithmetic expression (math)'),
        position: positionJson,
      },
      ['pipelineId', 'kind'],
    ),
    handler: async ({ pipelineId, ...args }) => {
      let added: { id: string; inputs: Array<{ id: string; name: string }> } | null = null;
      const result = updatePipelineFile(pipelineId, (p) => {
        added = addTransformNode(p, args);
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      return ok(added!);
    },
  }),

  defineTool({
    name: 'gst_set_transform_expression',
    description: "Set a transform's expression/template.",
    schema: z.object({ pipelineId: z.string(), nodeId: z.string(), expression: z.string() }),
    inputSchema: jsonObject(
      { pipelineId: jsonStr(), nodeId: jsonStr(), expression: jsonStr() },
      ['pipelineId', 'nodeId', 'expression'],
    ),
    handler: async ({ pipelineId, nodeId, expression }) => {
      let success = false;
      const result = updatePipelineFile(pipelineId, (p) => {
        success = setTransformExpression(p, nodeId, expression);
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      if (!success) return err(`Node ${nodeId} is not a transform node`);
      return ok({ nodeId, expression });
    },
  }),

  defineTool({
    name: 'gst_wire_transform_input',
    description: "Wire a variable or transform output into a transform's input slot. inputId comes from gst_add_transform's response.",
    schema: z.object({
      pipelineId: z.string(),
      sourceId: z.string(),
      transformId: z.string(),
      inputId: z.string(),
    }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        sourceId: jsonStr('Variable or transform node id'),
        transformId: jsonStr(),
        inputId: jsonStr('Input slot id'),
      },
      ['pipelineId', 'sourceId', 'transformId', 'inputId'],
    ),
    handler: async ({ pipelineId, sourceId, transformId, inputId }) => {
      let edgeId = '';
      const result = updatePipelineFile(pipelineId, (p) => {
        edgeId = wireTransformInput(p, { sourceId, transformId, inputId }).id;
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      return ok({ edgeId });
    },
  }),

  defineTool({
    name: 'gst_bind_value',
    description:
      'Bind a variable or transform output to an element property. The bound value overrides the static property at runtime.',
    schema: z.object({
      pipelineId: z.string(),
      sourceId: z.string(),
      targetId: z.string(),
      property: z.string(),
    }),
    inputSchema: jsonObject(
      {
        pipelineId: jsonStr(),
        sourceId: jsonStr('Variable or transform node id'),
        targetId: jsonStr('Element node id'),
        property: jsonStr(),
      },
      ['pipelineId', 'sourceId', 'targetId', 'property'],
    ),
    handler: async ({ pipelineId, sourceId, targetId, property }) => {
      let edgeId = '';
      const result = updatePipelineFile(pipelineId, (p) => {
        edgeId = bindValueToProperty(p, { sourceId, targetId, property }).id;
      });
      if (!result) return err(`Pipeline ${pipelineId} not found`);
      return ok({ edgeId });
    },
  }),

  defineTool({
    name: 'gst_run_pipeline',
    description:
      'Run a pipeline via gst-launch-1.0. Returns the process id; logs are buffered and retrievable via gst_get_run_status.',
    schema: z.object({ pipelineId: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr() }, ['pipelineId']),
    handler: async ({ pipelineId }) => {
      const p = findPipeline(pipelineId);
      if (!p) return err(`Pipeline ${pipelineId} not found`);
      const r = startPipeline(p);
      if (!r.ok) return err(r.error || 'failed to start');
      return ok({ pid: r.pid, command: r.command, warnings: r.warnings });
    },
  }),

  defineTool({
    name: 'gst_stop_pipeline',
    description: 'Stop a running pipeline (sends SIGINT). Works for runs started by either MCP or the Electron UI.',
    schema: z.object({ pipelineId: z.string() }),
    inputSchema: jsonObject({ pipelineId: jsonStr() }, ['pipelineId']),
    handler: async ({ pipelineId }) => {
      const r = stopPipeline(pipelineId);
      if (!r.ok) return err(r.error || 'failed to stop');
      return ok({ stopped: pipelineId, source: r.source });
    },
  }),

  defineTool({
    name: 'gst_get_run_status',
    description:
      'List currently running pipelines with PID, source (mcp / electron), uptime, and recent log lines (for runs started by this MCP server).',
    schema: z.object({ pipelineId: z.string().optional() }),
    inputSchema: jsonOptional({ pipelineId: jsonStr() }),
    handler: async ({ pipelineId }) => ok(getRunStatus(pipelineId)),
  }),
];

export function registerGstGraphTools(server: Server): void {
  const byName = new Map<string, ToolDef>();
  for (const t of tools) byName.set(t.name, t);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    let result: ToolResult;
    if (!tool) {
      result = err(`Unknown tool: ${req.params.name}`);
    } else {
      let parsed: unknown;
      try {
        parsed = tool.schema.parse(req.params.arguments ?? {});
      } catch (e) {
        if (e instanceof z.ZodError) {
          result = err(
            `Invalid arguments: ${e.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`,
          );
        } else {
          result = err((e as Error).message);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return result as any;
      }
      try {
        result = await tool.handler(parsed);
      } catch (e) {
        result = err((e as Error).message);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  });
}
