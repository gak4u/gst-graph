import { contextBridge, ipcRenderer } from 'electron';
import type {
  GstIpcApi,
  PersistedPipelines,
  PipelineDef,
  RunLogEntry,
  RunStatus,
} from '../shared/types';

const api: GstIpcApi = {
  listElements: () => ipcRenderer.invoke('gst:list'),
  inspectElement: (name: string) => ipcRenderer.invoke('gst:inspect', name),
  getGstVersion: () => ipcRenderer.invoke('gst:version'),
  runPipeline: (def: PipelineDef) => ipcRenderer.invoke('gst:run', def),
  stopPipeline: (id: string) => ipcRenderer.invoke('gst:stop', id),
  buildCommand: (def: PipelineDef) => ipcRenderer.invoke('gst:build', def),
  loadPipelines: () => ipcRenderer.invoke('gst:loadPipelines'),
  savePipelines: (data: PersistedPipelines) => ipcRenderer.invoke('gst:savePipelines', data),
  getDataDir: () => ipcRenderer.invoke('gst:getDataDir'),
  onLog: (cb: (entry: RunLogEntry) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, entry: RunLogEntry) => cb(entry);
    ipcRenderer.on('gst:log', listener);
    return () => ipcRenderer.removeListener('gst:log', listener);
  },
  onStatus: (cb: (status: RunStatus) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: RunStatus) => cb(status);
    ipcRenderer.on('gst:status', listener);
    return () => ipcRenderer.removeListener('gst:status', listener);
  },
  onPipelinesChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('gst:pipelinesChanged', listener);
    return () => ipcRenderer.removeListener('gst:pipelinesChanged', listener);
  },
  listExternalRuns: () => ipcRenderer.invoke('gst:listExternalRuns'),
  marketplaceSearch: (input: { query: string; forceRefresh?: boolean }) =>
    ipcRenderer.invoke('gst:marketplaceSearch', input),
  marketplaceClearCache: () => ipcRenderer.invoke('gst:marketplaceClearCache'),
};

contextBridge.exposeInMainWorld('gst', api);
