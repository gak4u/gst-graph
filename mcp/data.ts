import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type {
  PersistedPipelines,
  PipelineDef,
} from '../shared/types';

export const DATA_DIR = path.join(os.homedir(), '.gst-graph');
export const PIPELINES_FILE = path.join(DATA_DIR, 'pipelines.json');
export const RUNS_FILE = path.join(DATA_DIR, 'runs.json');
export const PLUGIN_CACHE_FILE = path.join(DATA_DIR, 'plugin-cache.json');
export const MCP_PORT_FILE = path.join(DATA_DIR, 'mcp-http.json');

export interface RunsFile {
  runs: Record<
    string,
    { pid: number; source: 'mcp' | 'electron'; startedAt: number; command: string }
  >;
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readPipelines(): PipelineDef[] {
  try {
    const buf = fs.readFileSync(PIPELINES_FILE, 'utf8');
    const parsed = JSON.parse(buf) as PersistedPipelines;
    if (!parsed || !Array.isArray(parsed.pipelines)) return [];
    return parsed.pipelines;
  } catch {
    return [];
  }
}

export function writePipelines(pipelines: PipelineDef[]): void {
  ensureDataDir();
  const tmp = `${PIPELINES_FILE}.tmp`;
  const bak = `${PIPELINES_FILE}.bak`;
  fs.writeFileSync(tmp, JSON.stringify({ pipelines }, null, 2));
  try {
    fs.copyFileSync(PIPELINES_FILE, bak);
  } catch {
    // first write, no existing file
  }
  fs.renameSync(tmp, PIPELINES_FILE);
}

export function updatePipeline(
  id: string,
  mutator: (p: PipelineDef) => void,
): PipelineDef | null {
  const all = readPipelines();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const cloned = JSON.parse(JSON.stringify(all[idx])) as PipelineDef;
  mutator(cloned);
  all[idx] = cloned;
  writePipelines(all);
  return cloned;
}

export function findPipeline(id: string): PipelineDef | null {
  const all = readPipelines();
  return all.find((p) => p.id === id) || null;
}

export function readRuns(): RunsFile {
  try {
    const buf = fs.readFileSync(RUNS_FILE, 'utf8');
    const parsed = JSON.parse(buf) as RunsFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.runs) return { runs: {} };
    return parsed;
  } catch {
    return { runs: {} };
  }
}

export function writeRuns(data: RunsFile): void {
  ensureDataDir();
  const tmp = `${RUNS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, RUNS_FILE);
}

export function setRun(
  pipelineId: string,
  info: { pid: number; source: 'mcp' | 'electron'; command: string },
): void {
  const data = readRuns();
  data.runs[pipelineId] = { ...info, startedAt: Date.now() };
  writeRuns(data);
}

export function clearRun(pipelineId: string): void {
  const data = readRuns();
  delete data.runs[pipelineId];
  writeRuns(data);
}

export function pruneDeadRuns(): void {
  const data = readRuns();
  let changed = false;
  for (const [id, info] of Object.entries(data.runs)) {
    if (!isPidAlive(info.pid)) {
      delete data.runs[id];
      changed = true;
    }
  }
  if (changed) writeRuns(data);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
