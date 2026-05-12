import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { listElements, inspectElement, getGstVersion } from './gst/inspect';
import { runner, buildCommand } from './gst/runner';
import { startHttpMcpServer } from '../mcp/http';
import type { LoadPipelinesResult, PersistedPipelines, PipelineDef } from '../shared/types';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const CACHE_SCHEMA = 4;
const DATA_DIR = path.join(os.homedir(), '.gst-graph');
const cacheFile = path.join(DATA_DIR, 'plugin-cache.json');
const pipelinesFile = path.join(DATA_DIR, 'pipelines.json');

function ensureDataDir(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create data dir', DATA_DIR, e);
  }
}

interface PluginCache {
  schema: number;
  version: string;
  elements: Awaited<ReturnType<typeof listElements>>;
  details: Record<string, Awaited<ReturnType<typeof inspectElement>>>;
}

let cache: PluginCache | null = null;

async function loadCache(): Promise<void> {
  try {
    const buf = await fs.promises.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(buf) as PluginCache;
    if (parsed.schema !== CACHE_SCHEMA) {
      cache = null;
      return;
    }
    cache = parsed;
  } catch {
    cache = null;
  }
}

async function saveCache(): Promise<void> {
  if (!cache) return;
  try {
    await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.promises.writeFile(cacheFile, JSON.stringify(cache));
  } catch (e) {
    console.error('Cache save failed', e);
  }
}

async function readPipelinesFile(): Promise<LoadPipelinesResult> {
  let fileExists = false;
  try {
    await fs.promises.access(pipelinesFile, fs.constants.R_OK);
    fileExists = true;
  } catch {
    fileExists = false;
  }
  if (!fileExists) {
    return { ok: true, fileExists: false, pipelines: [], path: pipelinesFile };
  }
  try {
    const buf = await fs.promises.readFile(pipelinesFile, 'utf8');
    const parsed = JSON.parse(buf) as PersistedPipelines;
    if (!parsed || !Array.isArray(parsed.pipelines)) {
      return {
        ok: false,
        fileExists: true,
        pipelines: [],
        path: pipelinesFile,
        error: 'pipelines.json did not contain a pipelines array',
      };
    }
    return { ok: true, fileExists: true, pipelines: parsed.pipelines, path: pipelinesFile };
  } catch (e) {
    return {
      ok: false,
      fileExists: true,
      pipelines: [],
      path: pipelinesFile,
      error: (e as Error).message,
    };
  }
}

let pendingSave: Promise<void> | null = null;

async function writePipelinesFile(data: PersistedPipelines): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(pipelinesFile), { recursive: true });
    const tmp = `${pipelinesFile}.tmp`;
    const bak = `${pipelinesFile}.bak`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
    try {
      await fs.promises.copyFile(pipelinesFile, bak);
    } catch {
      // first write, nothing to back up
    }
    lastSelfWriteAt = Date.now();
    await fs.promises.rename(tmp, pipelinesFile);
  } catch (e) {
    console.error('Pipelines save failed', e);
    throw e;
  }
}

function enqueueSave(data: PersistedPipelines): Promise<void> {
  const task = (pendingSave || Promise.resolve()).then(() => writePipelinesFile(data));
  pendingSave = task.catch(() => undefined);
  return task;
}

async function ensureCache(): Promise<PluginCache> {
  const version = await getGstVersion();
  if (cache && cache.schema === CACHE_SCHEMA && cache.version === version && cache.elements?.length) {
    return cache;
  }
  const elements = await listElements();
  cache = { schema: CACHE_SCHEMA, version, elements, details: {} };
  await saveCache();
  return cache;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'GStreamer Graph Editor',
    backgroundColor: '#1a1d24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  runner.on('log', (entry) => {
    win.webContents.send('gst:log', entry);
  });
  runner.on('status', (status) => {
    win.webContents.send('gst:status', status);
  });

  windowsForBroadcast.add(win);
  win.on('closed', () => windowsForBroadcast.delete(win));
}

const windowsForBroadcast = new Set<BrowserWindow>();
let lastSelfWriteAt = 0;

function broadcastExternalChange(): void {
  for (const win of windowsForBroadcast) {
    try {
      win.webContents.send('gst:pipelinesChanged', { at: Date.now() });
    } catch {
      // window probably destroyed
    }
  }
}

function watchPipelinesFile(): void {
  try {
    fs.watch(DATA_DIR, { persistent: false }, (_event, filename) => {
      if (!filename) return;
      if (filename !== 'pipelines.json') return;
      const now = Date.now();
      if (now - lastSelfWriteAt < 750) return;
      broadcastExternalChange();
    });
  } catch (e) {
    console.error('Failed to watch pipelines file', e);
  }
}

app.whenReady().then(async () => {
  ensureDataDir();
  await loadCache();
  watchPipelinesFile();
  startHttpMcpServer()
    .then((info) => {
      console.log(`[gst-graph MCP HTTP] listening on ${info.url}`);
    })
    .catch((e) => console.error('[gst-graph MCP HTTP] failed to start', e));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  if (pendingSave) {
    e.preventDefault();
    quitting = true;
    try {
      await pendingSave;
    } catch (err) {
      console.error('Save flush before quit failed', err);
    }
    app.quit();
  }
});

ipcMain.handle('gst:list', async () => {
  const c = await ensureCache();
  return c.elements;
});

ipcMain.handle('gst:inspect', async (_evt, name: string) => {
  const c = await ensureCache();
  if (c.details[name]) return c.details[name];
  const detail = await inspectElement(name);
  c.details[name] = detail;
  await saveCache();
  return detail;
});

ipcMain.handle('gst:version', async () => {
  return getGstVersion();
});

ipcMain.handle('gst:build', async (_evt, def: PipelineDef) => {
  return buildCommand(def);
});

ipcMain.handle('gst:run', async (_evt, def: PipelineDef) => {
  return runner.start(def);
});

ipcMain.handle('gst:stop', async (_evt, id: string) => {
  return { ok: runner.stop(id) };
});

ipcMain.handle('gst:loadPipelines', async (): Promise<LoadPipelinesResult> => {
  return readPipelinesFile();
});

ipcMain.handle('gst:savePipelines', async (_evt, data: PersistedPipelines) => {
  try {
    await enqueueSave(data);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('gst:getDataDir', async () => DATA_DIR);

ipcMain.handle('gst:listExternalRuns', async () => runner.listExternalRuns());
