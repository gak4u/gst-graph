import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { listElements, inspectElement, getGstVersion } from './gst/inspect';
import { runner, buildCommand } from './gst/runner';
import { startHttpMcpServer } from '../mcp/http';
import { invalidateMarketplaceCache, searchMarketplace } from './marketplace';
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

const SCREENSHOT_DIR = process.env.GST_GRAPH_SCREENSHOTS_DIR;
const SCREENSHOT_MODE = !!SCREENSHOT_DIR;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'GStreamer Graph Editor',
    backgroundColor: '#1a1d24',
    show: !SCREENSHOT_MODE,
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

  if (SCREENSHOT_MODE) {
    runScreenshotHarness(win, SCREENSHOT_DIR!).catch((e) => {
      console.error('[screenshot] FAIL', e);
      app.exit(1);
    });
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

async function runScreenshotHarness(win: BrowserWindow, outDir: string): Promise<void> {
  await fs.promises.mkdir(outDir, { recursive: true });
  await new Promise<void>((resolve) => {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => resolve());
    } else {
      resolve();
    }
  });
  // Give React + xyflow + IPC hydrate a moment to render.
  await new Promise((r) => setTimeout(r, 2200));

  async function snap(name: string): Promise<void> {
    const image = await win.webContents.capturePage();
    const target = path.join(outDir, name);
    await fs.promises.writeFile(target, image.toPNG());
    console.log(`[screenshot] wrote ${target}`);
  }

  await snap('home.png');

  // Marketplace screenshot — switch to marketplace view and wait for it to fetch
  await win.webContents.executeJavaScript(
    `window.__gstStore.getState().setView('marketplace')`,
  );
  // Wait for cards to render (the marketplace fetches lazily)
  for (let i = 0; i < 30; i++) {
    const ready = await win.webContents.executeJavaScript(
      `(() => { const el = document.querySelector('.marketplace-grid'); return el ? el.children.length : 0; })()`,
    );
    if (ready > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 400));
  await snap('marketplace.png');
  await win.webContents.executeJavaScript(
    `window.__gstStore.getState().setView('home')`,
  );
  await new Promise((r) => setTimeout(r, 600));

  const firstPipelineId = (await win.webContents.executeJavaScript(
    `(() => { const s = window.__gstStore && window.__gstStore.getState(); if (!s) return null; const p = s.pipelines && s.pipelines[0]; return p ? p.id : null; })()`,
  )) as string | null;

  if (firstPipelineId) {
    await win.webContents.executeJavaScript(
      `window.__gstStore.getState().openPipeline(${JSON.stringify(firstPipelineId)})`,
    );
    await new Promise((r) => setTimeout(r, 2000));
    await win.webContents.executeJavaScript(
      `(() => { try { const rf = document.querySelector('.react-flow__viewport'); if (rf) rf.style.transition='none'; } catch {} })()`,
    );
    // Fit the view so the pipeline graph is centered.
    await win.webContents.executeJavaScript(
      `(() => { const btn = document.querySelector('button[title="fit view" i], .react-flow__controls-fitview'); if (btn) btn.click(); })()`,
    );
    await new Promise((r) => setTimeout(r, 800));
    await snap('editor.png');

    const firstElementNodeId = (await win.webContents.executeJavaScript(
      `(() => { const s = window.__gstStore && window.__gstStore.getState(); if (!s) return null; const p = s.pipelines.find((p) => p.id === ${JSON.stringify(firstPipelineId)}); const n = p && p.nodes.find((n) => n.type === 'gstElement'); return n ? n.id : null; })()`,
    )) as string | null;
    if (firstElementNodeId) {
      await win.webContents.executeJavaScript(
        `window.__gstStore.getState().selectNode(${JSON.stringify(firstElementNodeId)})`,
      );
      await new Promise((r) => setTimeout(r, 1000));
      await snap('properties.png');
    }
  }

  app.exit(0);
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

ipcMain.handle(
  'gst:marketplaceSearch',
  async (_evt, input: { query: string; forceRefresh?: boolean }) => {
    const c = await ensureCache();
    return searchMarketplace({
      query: input.query,
      installedElements: c.elements.map((e) => e.name),
      installedGstreamerVersion: c.version,
      forceRefresh: !!input.forceRefresh,
    });
  },
);

ipcMain.handle('gst:marketplaceClearCache', async () => {
  invalidateMarketplaceCache();
  return { ok: true };
});
