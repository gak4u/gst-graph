import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { buildCommand, buildArgs, diagnoseBindings } from '../electron/gst/runner';
import { setRun, clearRun, readRuns, pruneDeadRuns, isPidAlive } from './data';
import type { PipelineDef } from '../shared/types';

const GST_LAUNCH = process.env.GST_LAUNCH_BIN || 'gst-launch-1.0';

interface ActiveRun {
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  command: string;
  logBuffer: string[];
}

const active = new Map<string, ActiveRun>();

function pushLog(run: ActiveRun, line: string): void {
  run.logBuffer.push(line);
  while (run.logBuffer.length > 500) run.logBuffer.shift();
}

export function startPipeline(def: PipelineDef): {
  ok: boolean;
  error?: string;
  pid?: number;
  command: string;
  warnings: string[];
} {
  pruneDeadRuns();
  if (active.has(def.id)) {
    const a = active.get(def.id)!;
    return {
      ok: false,
      error: `Pipeline ${def.id} is already running in this MCP session (pid ${a.child.pid})`,
      command: a.command,
      warnings: [],
    };
  }
  const existing = readRuns().runs[def.id];
  if (existing && isPidAlive(existing.pid)) {
    return {
      ok: false,
      error: `Pipeline ${def.id} is already running externally (pid ${existing.pid}, source ${existing.source})`,
      command: existing.command,
      warnings: [],
    };
  }
  const command = buildCommand(def);
  const rawArgs = buildArgs(def);
  const args = ['-e', '-v', ...rawArgs.filter((a) => typeof a === 'string' && a.length > 0)];
  if (args.length === 2) {
    return { ok: false, error: 'Pipeline has no runnable elements', command, warnings: [] };
  }
  try {
    const child = spawn(GST_LAUNCH, args, {
      env: { ...process.env, GST_DEBUG: process.env.GST_DEBUG || '2' },
    });
    const run: ActiveRun = { child, startedAt: Date.now(), command, logBuffer: [] };
    active.set(def.id, run);
    pushLog(run, `$ ${GST_LAUNCH} -e -v ${command}`);
    for (const w of diagnoseBindings(def)) pushLog(run, `[binding] ${w}`);
    setRun(def.id, { pid: child.pid!, source: 'mcp', command });
    child.stdout.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line) pushLog(run, line);
      }
    });
    child.stderr.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line) pushLog(run, line);
      }
    });
    child.on('close', (code) => {
      pushLog(run, `[exit] process exited with code ${code}`);
      active.delete(def.id);
      clearRun(def.id);
    });
    child.on('error', (err) => {
      pushLog(run, `[error] ${err.message}`);
    });
    return { ok: true, pid: child.pid, command, warnings: diagnoseBindings(def) };
  } catch (e) {
    return { ok: false, error: (e as Error).message, command, warnings: [] };
  }
}

export function stopPipeline(pipelineId: string): { ok: boolean; error?: string; source?: string } {
  pruneDeadRuns();
  const local = active.get(pipelineId);
  if (local) {
    try {
      local.child.kill('SIGINT');
      return { ok: true, source: 'mcp' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const external = readRuns().runs[pipelineId];
  if (external && isPidAlive(external.pid)) {
    try {
      process.kill(external.pid, 'SIGINT');
      clearRun(pipelineId);
      return { ok: true, source: external.source };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  return { ok: false, error: `Pipeline ${pipelineId} is not running` };
}

export function getRunStatus(pipelineId?: string): Array<{
  pipelineId: string;
  pid: number;
  source: 'mcp' | 'electron';
  startedAt: number;
  command: string;
  alive: boolean;
  recentLogs?: string[];
}> {
  pruneDeadRuns();
  const runs = readRuns().runs;
  const out: ReturnType<typeof getRunStatus> = [];
  for (const [id, info] of Object.entries(runs)) {
    if (pipelineId && id !== pipelineId) continue;
    const alive = isPidAlive(info.pid);
    const localLogs = active.get(id)?.logBuffer?.slice(-50);
    out.push({
      pipelineId: id,
      pid: info.pid,
      source: info.source,
      startedAt: info.startedAt,
      command: info.command,
      alive,
      recentLogs: localLogs,
    });
  }
  return out;
}
