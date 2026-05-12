import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { clearRun, isPidAlive, pruneDeadRuns, readRuns, setRun } from '../../mcp/data';
import type {
  PipelineDef,
  PipelineGraphNode,
  PipelineNodeData,
  RunLogEntry,
  RunStatus,
  TransformNodeData,
  VariableNodeData,
} from '../../shared/types';

const GST_LAUNCH = process.env.GST_LAUNCH_BIN || 'gst-launch-1.0';

type Token =
  | { kind: 'word'; value: string }
  | { kind: 'prop'; key: string; value: string }
  | { kind: 'link' };

function describeNode(def: PipelineDef, id: string): string {
  const n = def.nodes.find((x) => x.id === id);
  if (!n) return id;
  if (n.type === 'gstVariable') {
    const d = n.data as VariableNodeData;
    return `variable $${d.varName}`;
  }
  if (n.type === 'gstTransform') {
    const d = n.data as TransformNodeData;
    return `${d.kind} ${d.label || ''}`.trim();
  }
  const d = n.data as PipelineNodeData;
  return `${d.elementName}${d.instanceName ? ` (${d.instanceName})` : ''}`;
}

function sanitizePipeline(def: PipelineDef): { def: PipelineDef; warnings: string[] } {
  const warnings: string[] = [];
  const validNodes: PipelineDef['nodes'] = [];
  const validIds = new Set<string>();
  for (const n of def.nodes || []) {
    if (!n || typeof n !== 'object' || !n.id) {
      warnings.push('Skipped node without id');
      continue;
    }
    if (n.type === 'gstElement') {
      const d = (n.data || {}) as Partial<PipelineNodeData>;
      if (!d.elementName || typeof d.elementName !== 'string') {
        warnings.push(`Skipped element node ${n.id} with missing elementName`);
        continue;
      }
      if (!d.instanceName || typeof d.instanceName !== 'string') {
        warnings.push(`Skipped element node ${n.id} (${d.elementName}) with missing instanceName`);
        continue;
      }
      validNodes.push(n);
      validIds.add(n.id);
    } else if (n.type === 'gstVariable') {
      validNodes.push(n);
      validIds.add(n.id);
    } else if (n.type === 'gstTransform') {
      const d = (n.data || {}) as Partial<TransformNodeData>;
      if (d.kind !== 'concat' && d.kind !== 'math') {
        warnings.push(`Skipped transform node ${n.id} with unknown kind ${String(d.kind)}`);
        continue;
      }
      if (!Array.isArray(d.inputs)) {
        warnings.push(`Skipped transform node ${n.id} (${d.kind}) without inputs`);
        continue;
      }
      validNodes.push(n);
      validIds.add(n.id);
    } else {
      const bad = n as { id?: string; type?: unknown };
      warnings.push(`Skipped node ${String(bad.id)} with unrecognized type ${String(bad.type)}`);
    }
  }
  const validEdges: PipelineDef['edges'] = [];
  for (const e of def.edges || []) {
    if (!e || !e.id || !e.source || !e.target) {
      warnings.push('Skipped malformed edge');
      continue;
    }
    if (!validIds.has(e.source) || !validIds.has(e.target)) {
      warnings.push(`Skipped edge ${e.id} referencing missing node`);
      continue;
    }
    if (!e.sourceHandle || !e.targetHandle) {
      warnings.push(`Skipped edge ${e.id} without handles`);
      continue;
    }
    validEdges.push(e);
  }
  return { def: { ...def, nodes: validNodes, edges: validEdges }, warnings };
}

function variableRawValue(d: VariableNodeData): string | number | boolean | null {
  if (d.value === null || d.value === undefined) return null;
  if (d.valueKind === 'boolean') return d.value === true || d.value === 'true';
  if (d.valueKind === 'number') {
    if (typeof d.value === 'number') return Number.isFinite(d.value) ? d.value : null;
    const n = Number(d.value);
    return Number.isFinite(n) ? n : null;
  }
  return String(d.value);
}

function rawToStringOrNull(v: string | number | boolean | null): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([\w]+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

const MATH_EXPR_RE = /^[\w\s+\-*/%().,]+$/;

function evalMathExpression(expr: string, inputs: Record<string, number>): number | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  if (!MATH_EXPR_RE.test(trimmed)) return null;
  const keys = Object.keys(inputs);
  const vals = keys.map((k) => inputs[k]);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, 'Math', `"use strict"; return (${trimmed});`);
    const result = fn(...vals, Math);
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

interface ValueGraph {
  resolve(nodeId: string): string | number | boolean | null;
}

function buildValueGraph(def: PipelineDef): ValueGraph {
  const nodeById = new Map<string, PipelineGraphNode>();
  for (const n of def.nodes) nodeById.set(n.id, n);

  const cache = new Map<string, string | number | boolean | null>();
  const visiting = new Set<string>();

  function feedingEdgeFor(nodeId: string, inputId: string) {
    return def.edges.find(
      (e) =>
        e.target === nodeId &&
        (e.data?.transformInputId === inputId || e.targetHandle === `in:${inputId}`),
    );
  }

  function resolve(nodeId: string): string | number | boolean | null {
    if (cache.has(nodeId)) return cache.get(nodeId) ?? null;
    if (visiting.has(nodeId)) return null;
    visiting.add(nodeId);
    const node = nodeById.get(nodeId);
    let result: string | number | boolean | null = null;
    if (!node) result = null;
    else if (node.type === 'gstVariable') {
      result = variableRawValue(node.data as VariableNodeData);
    } else if (node.type === 'gstTransform') {
      const d = node.data as TransformNodeData;
      const inputs = d.inputs || [];
      if (d.kind === 'concat') {
        const vars: Record<string, string> = {};
        for (const inp of inputs) {
          const edge = feedingEdgeFor(nodeId, inp.id);
          const upstream = edge ? resolve(edge.source) : null;
          vars[inp.name] = rawToStringOrNull(upstream) ?? '';
        }
        result = applyTemplate(d.expression || '', vars);
      } else if (d.kind === 'math') {
        const vars: Record<string, number> = {};
        let missing = false;
        for (const inp of inputs) {
          const edge = feedingEdgeFor(nodeId, inp.id);
          const upstream = edge ? resolve(edge.source) : null;
          if (upstream === null) {
            missing = true;
            break;
          }
          const num = typeof upstream === 'number' ? upstream : Number(upstream);
          if (!Number.isFinite(num)) {
            missing = true;
            break;
          }
          vars[inp.name] = num;
        }
        result = missing ? null : evalMathExpression(d.expression || '', vars);
      }
    }
    visiting.delete(nodeId);
    cache.set(nodeId, result);
    return result;
  }

  return { resolve };
}

function* walkTokens(def: PipelineDef): Generator<Token> {
  const elementNodes = def.nodes.filter(
    (n): n is Extract<PipelineGraphNode, { type: 'gstElement' }> => {
      if (n.type !== 'gstElement') return false;
      const d = n.data as PipelineNodeData | undefined;
      return !!d && typeof d.elementName === 'string' && d.elementName.length > 0;
    },
  );
  const valueGraph = buildValueGraph(def);
  const nodeMap = new Map(elementNodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of elementNodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  function isStreamEdge(e: PipelineDef['edges'][number]): boolean {
    if (e.data?.edgeKind === 'binding' || e.data?.edgeKind === 'value') return false;
    if (!e.sourceHandle?.startsWith('src:')) return false;
    if (!e.targetHandle?.startsWith('sink:')) return false;
    return nodeMap.has(e.source) && nodeMap.has(e.target);
  }
  function isPropertyBindingEdge(e: PipelineDef['edges'][number]): boolean {
    if (e.targetHandle?.startsWith('prop:')) return true;
    if (e.data?.edgeKind === 'binding') return true;
    return false;
  }

  for (const e of def.edges) {
    if (!isStreamEdge(e)) continue;
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }

  const bindingByTarget = new Map<string, Map<string, string>>();
  for (const e of def.edges) {
    if (!isPropertyBindingEdge(e)) continue;
    if (!nodeMap.has(e.target)) continue;
    const propName =
      e.data?.bindingProperty || (e.targetHandle?.startsWith('prop:') ? e.targetHandle.slice(5) : null);
    if (!propName) continue;
    const raw = valueGraph.resolve(e.source);
    const val = rawToStringOrNull(raw);
    if (val === null) continue;
    if (!bindingByTarget.has(e.target)) bindingByTarget.set(e.target, new Map());
    bindingByTarget.get(e.target)!.set(propName, val);
  }

  const sourceNodes = elementNodes.filter((n) => (incoming.get(n.id) || []).length === 0);
  const visited = new Set<string>();

  function instanceNameOf(id: string): string | null {
    const n = nodeMap.get(id);
    if (!n) return null;
    const d = n.data as PipelineNodeData;
    return d.instanceName && d.instanceName.length > 0 ? d.instanceName : null;
  }

  function* emitNode(id: string): Generator<Token> {
    const n = nodeMap.get(id);
    if (!n) return;
    const data = n.data as PipelineNodeData;
    if (!data.elementName) return;
    const bindings = bindingByTarget.get(id) || new Map<string, string>();
    yield { kind: 'word', value: data.elementName };
    if (data.instanceName) yield { kind: 'prop', key: 'name', value: data.instanceName };

    const seen = new Set<string>();
    for (const [k, v] of Object.entries(data.properties || {})) {
      if (k === 'name') continue;
      seen.add(k);
      if (bindings.has(k)) {
        yield { kind: 'prop', key: k, value: bindings.get(k)! };
        continue;
      }
      if (v === '' || v === null || v === undefined) continue;
      let val: string;
      if (typeof v === 'boolean') val = v ? 'true' : 'false';
      else val = String(v);
      yield { kind: 'prop', key: k, value: val };
    }
    for (const [k, val] of bindings) {
      if (seen.has(k)) continue;
      yield { kind: 'prop', key: k, value: val };
    }
  }

  function* walk(id: string, withPrefixLink: boolean): Generator<Token> {
    if (!nodeMap.has(id)) return;
    if (visited.has(id)) {
      const inst = instanceNameOf(id);
      if (!inst) return;
      if (withPrefixLink) yield { kind: 'link' };
      yield { kind: 'word', value: `${inst}.` };
      return;
    }
    visited.add(id);
    if (withPrefixLink) yield { kind: 'link' };
    yield* emitNode(id);
    const outs = (outgoing.get(id) || []).filter((next) => nodeMap.has(next));
    if (outs.length === 0) return;
    if (outs.length === 1) {
      yield* walk(outs[0], true);
      return;
    }
    const inst = instanceNameOf(id);
    if (!inst) {
      for (const next of outs) yield* walk(next, true);
      return;
    }
    for (const next of outs) {
      yield { kind: 'word', value: `${inst}.` };
      yield* walk(next, true);
    }
  }

  for (const s of sourceNodes) yield* walk(s.id, false);
  for (const n of elementNodes) {
    if (!visited.has(n.id)) yield* walk(n.id, false);
  }
}

export function buildArgs(def: PipelineDef): string[] {
  const args: string[] = [];
  for (const tok of walkTokens(def)) {
    if (tok.kind === 'link') {
      args.push('!');
    } else if (tok.kind === 'word') {
      if (typeof tok.value !== 'string' || tok.value.length === 0) continue;
      args.push(tok.value);
    } else {
      if (!tok.key) continue;
      args.push(`${tok.key}=${tok.value ?? ''}`);
    }
  }
  return collapseLinks(args);
}

export function diagnoseBindings(def: PipelineDef): string[] {
  const elementIds = new Set(
    def.nodes
      .filter((n) => n.type === 'gstElement' && (n.data as PipelineNodeData).elementName)
      .map((n) => n.id),
  );
  const valueGraph = buildValueGraph(def);
  const messages: string[] = [];
  for (const e of def.edges) {
    const isBinding =
      e.data?.edgeKind === 'binding' || e.targetHandle?.startsWith('prop:');
    if (!isBinding) continue;
    if (!elementIds.has(e.target)) continue;
    const propName =
      e.data?.bindingProperty || (e.targetHandle?.startsWith('prop:') ? e.targetHandle.slice(5) : null);
    if (!propName) continue;
    const raw = valueGraph.resolve(e.source);
    const val = rawToStringOrNull(raw);
    if (val === null) {
      messages.push(
        `Property "${propName}" on ${describeNode(def, e.target)} not applied — ${describeNode(def, e.source)} did not resolve to a value (unwired input or invalid expression)`,
      );
    }
  }
  return messages;
}

function collapseLinks(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p === '!' && out[out.length - 1] === '!') continue;
    out.push(p);
  }
  while (out[0] === '!') out.shift();
  while (out[out.length - 1] === '!') out.pop();
  return out;
}

function shellQuoteIfNeeded(value: string): string {
  if (value === '') return '""';
  if (/[\s"!=,()*?<>$`|;&\\\[\]{}]/.test(value)) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return value;
}

export function buildCommand(def: PipelineDef): string {
  const parts: string[] = [];
  for (const tok of walkTokens(def)) {
    if (tok.kind === 'link') {
      parts.push('!');
    } else if (tok.kind === 'word') {
      if (typeof tok.value !== 'string' || tok.value.length === 0) continue;
      parts.push(tok.value);
    } else {
      if (!tok.key) continue;
      parts.push(`${tok.key}=${shellQuoteIfNeeded(tok.value ?? '')}`);
    }
  }
  return collapseLinks(parts).join(' ');
}

class Runner extends EventEmitter {
  private procs = new Map<string, ChildProcessWithoutNullStreams>();

  start(def: PipelineDef): { ok: boolean; error?: string; pid?: number; command: string } {
    const { def: cleanDef, warnings } = sanitizePipeline(def);
    const display = buildCommand(cleanDef);
    if (this.procs.has(def.id)) {
      return { ok: false, error: 'Pipeline already running', command: display };
    }
    const rawArgs = buildArgs(cleanDef);
    const args = ['-e', '-v', ...rawArgs.filter((a) => typeof a === 'string' && a.length > 0)];
    if (args.length === 2) {
      return { ok: false, error: 'Pipeline has no runnable elements', command: display };
    }
    try {
      const child = spawn(GST_LAUNCH, args, {
        env: { ...process.env, GST_DEBUG: process.env.GST_DEBUG || '2' },
      });
      this.procs.set(def.id, child);
      try {
        setRun(def.id, { pid: child.pid!, source: 'electron', command: display });
      } catch (e) {
        console.error('Failed to record run', e);
      }
      this.emit('status', {
        pipelineId: def.id,
        running: true,
        pid: child.pid,
        startedAt: Date.now(),
      } satisfies RunStatus);
      this.emit('log', {
        pipelineId: def.id,
        stream: 'meta',
        line: `$ ${GST_LAUNCH} -e -v ${display}`,
        ts: Date.now(),
      } satisfies RunLogEntry);
      this.emit('log', {
        pipelineId: def.id,
        stream: 'meta',
        line: `argv: ${JSON.stringify(args)}`,
        ts: Date.now(),
      } satisfies RunLogEntry);
      for (const w of warnings) {
        this.emit('log', {
          pipelineId: def.id,
          stream: 'stderr',
          line: `[pipeline] ${w}`,
          ts: Date.now(),
        } satisfies RunLogEntry);
      }
      for (const w of diagnoseBindings(cleanDef)) {
        this.emit('log', {
          pipelineId: def.id,
          stream: 'stderr',
          line: `[binding] ${w}`,
          ts: Date.now(),
        } satisfies RunLogEntry);
      }

      child.stdout.on('data', (buf: Buffer) => {
        for (const line of buf.toString('utf8').split(/\r?\n/)) {
          if (line.length === 0) continue;
          this.emit('log', { pipelineId: def.id, stream: 'stdout', line, ts: Date.now() });
        }
      });
      child.stderr.on('data', (buf: Buffer) => {
        for (const line of buf.toString('utf8').split(/\r?\n/)) {
          if (line.length === 0) continue;
          this.emit('log', { pipelineId: def.id, stream: 'stderr', line, ts: Date.now() });
        }
      });
      child.on('close', (code) => {
        this.procs.delete(def.id);
        try {
          clearRun(def.id);
        } catch {
          // non-fatal
        }
        this.emit('status', {
          pipelineId: def.id,
          running: false,
          exitCode: code,
          endedAt: Date.now(),
        } satisfies RunStatus);
        this.emit('log', {
          pipelineId: def.id,
          stream: 'meta',
          line: `Process exited with code ${code}`,
          ts: Date.now(),
        });
      });
      child.on('error', (err) => {
        this.emit('log', {
          pipelineId: def.id,
          stream: 'stderr',
          line: `spawn error: ${err.message}`,
          ts: Date.now(),
        });
      });
      return { ok: true, pid: child.pid, command: display };
    } catch (e) {
      return { ok: false, error: (e as Error).message, command: display };
    }
  }

  stop(pipelineId: string): boolean {
    const p = this.procs.get(pipelineId);
    if (p) {
      try {
        p.kill('SIGINT');
      } catch {
        return false;
      }
      return true;
    }
    // Fallback: maybe an MCP-started run. Look it up in the shared registry.
    try {
      pruneDeadRuns();
      const external = readRuns().runs[pipelineId];
      if (external && isPidAlive(external.pid)) {
        process.kill(external.pid, 'SIGINT');
        clearRun(pipelineId);
        return true;
      }
    } catch (e) {
      console.error('cross-process stop failed', e);
    }
    return false;
  }

  listExternalRuns(): Array<{ pipelineId: string; pid: number; source: 'mcp' | 'electron'; startedAt: number; command: string }> {
    pruneDeadRuns();
    const out: ReturnType<Runner['listExternalRuns']> = [];
    const runs = readRuns().runs;
    for (const [id, info] of Object.entries(runs)) {
      if (this.procs.has(id)) continue;
      out.push({ pipelineId: id, ...info });
    }
    return out;
  }
}

export const runner = new Runner();
