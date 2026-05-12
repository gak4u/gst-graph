import { create } from 'zustand';
import type {
  GstElementSummary,
  GstElementDetail,
  PipelineDef,
  PipelineGraphNode,
  PipelineNodeData,
  RunLogEntry,
  RunStatus,
  TransformInput,
  TransformKind,
  TransformNodeData,
  VariableNodeData,
  VariableValueKind,
} from '@shared/types';
import { makeInstanceName } from '../lib/instanceName';
import { clonePipelineWithFreshIds } from '@shared/installApply';

export interface Pipeline extends PipelineDef {
  running: boolean;
  pid?: number;
  exitCode?: number | null;
  logs: RunLogEntry[];
}

interface ToastMsg {
  id: number;
  kind: 'info' | 'err' | 'warn';
  text: string;
}

export type AppView = 'home' | 'editor' | 'marketplace';

interface State {
  elements: GstElementSummary[];
  details: Record<string, GstElementDetail>;
  loadingElements: boolean;
  gstVersion: string;
  pipelines: Pipeline[];
  activePipelineId: string | null;
  selectedNodeId: string | null;
  view: AppView;
  hydrated: boolean;
  persistenceEnabled: boolean;
  loadError: string | null;
  dataDir: string;
  toasts: ToastMsg[];
  setView: (v: AppView) => void;
  hydrate: () => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  setElements: (els: GstElementSummary[]) => void;
  setLoadingElements: (l: boolean) => void;
  setGstVersion: (v: string) => void;
  upsertDetail: (d: GstElementDetail) => void;
  ensureDetail: (name: string) => Promise<GstElementDetail | null>;
  newPipeline: (name?: string) => string;
  clonePipelineFrom: (sourceId: string, name?: string) => string | null;
  importPipeline: (raw: unknown, fileName?: string) => Promise<string | null>;
  removePipeline: (id: string) => void;
  setActive: (id: string) => void;
  openPipeline: (id: string) => void;
  renamePipeline: (id: string, name: string) => void;
  updatePipeline: (id: string, mut: (p: Pipeline) => void) => void;
  selectNode: (id: string | null) => void;
  addNodeFromElement: (el: GstElementSummary, position: { x: number; y: number }) => Promise<void>;
  updateNodeProps: (nodeId: string, key: string, value: string | number | boolean | null) => void;
  updateInstanceName: (nodeId: string, name: string) => void;
  toggleNodeBindings: (nodeId: string) => void;
  addVariableNode: (position: { x: number; y: number }) => void;
  updateVariableName: (nodeId: string, name: string) => void;
  updateVariableLabel: (nodeId: string, label: string) => void;
  toggleVariableHidden: (nodeId: string) => void;
  updateVariableValue: (nodeId: string, value: string | number | boolean | null) => void;
  updateVariableValueIn: (
    pipelineId: string,
    nodeId: string,
    value: string | number | boolean | null,
  ) => void;
  updateVariableKind: (nodeId: string, kind: VariableValueKind) => void;
  inferVariableForBinding: (variableId: string, elementNodeId: string, propertyName: string) => void;
  addTransformNode: (kind: TransformKind, position: { x: number; y: number }) => void;
  updateTransformLabel: (nodeId: string, label: string) => void;
  updateTransformExpression: (nodeId: string, expression: string) => void;
  addTransformInput: (nodeId: string) => void;
  renameTransformInput: (nodeId: string, inputId: string, name: string) => void;
  removeTransformInput: (nodeId: string, inputId: string) => void;
  appendLog: (entry: RunLogEntry) => void;
  setStatus: (status: RunStatus) => void;
  toast: (text: string, kind?: ToastMsg['kind']) => void;
  dismissToast: (id: number) => void;
}

function newPipelineDef(name: string): Pipeline {
  return {
    id: `pl_${Math.random().toString(36).slice(2, 9)}`,
    name,
    nodes: [],
    edges: [],
    running: false,
    logs: [],
  };
}

let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  elements: [],
  details: {},
  loadingElements: false,
  gstVersion: '',
  pipelines: [],
  activePipelineId: null,
  selectedNodeId: null,
  view: 'home',
  hydrated: false,
  persistenceEnabled: false,
  loadError: null,
  dataDir: '',
  toasts: [],

  setView: (v) => set({ view: v }),

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const dataDir = await window.gst.getDataDir();
      const loaded = await window.gst.loadPipelines();
      if (!loaded.ok) {
        set({
          hydrated: true,
          persistenceEnabled: false,
          loadError: loaded.error || 'Unknown load error',
          dataDir,
        });
        get().toast(
          `Could not load saved pipelines (${loaded.error}). Autosave is disabled to protect the file at ${loaded.path}.`,
          'err',
        );
        return;
      }
      const fromDisk = (loaded.pipelines || []).map<Pipeline>((p) => ({
        ...p,
        running: false,
        logs: [],
      }));
      set({
        pipelines: fromDisk,
        activePipelineId: fromDisk[0]?.id ?? null,
        hydrated: true,
        persistenceEnabled: true,
        loadError: null,
        dataDir,
      });
    } catch (e) {
      set({ hydrated: true, persistenceEnabled: false, loadError: (e as Error).message });
      console.error('Failed to hydrate pipelines', e);
    }
  },

  reloadFromDisk: async () => {
    try {
      const loaded = await window.gst.loadPipelines();
      if (!loaded.ok) return;
      suspendAutosaveUntil = Date.now() + 1000;
      cancelPendingAutosave();
      const state = get();
      const stillRunning = new Map(
        state.pipelines
          .filter((p) => p.running)
          .map((p) => [p.id, { pid: p.pid }] as const),
      );
      const fromDisk = (loaded.pipelines || []).map<Pipeline>((p) => ({
        ...p,
        running: stillRunning.has(p.id),
        pid: stillRunning.get(p.id)?.pid,
        logs: state.pipelines.find((existing) => existing.id === p.id)?.logs || [],
      }));
      let nextActive = state.activePipelineId;
      if (!fromDisk.some((p) => p.id === nextActive)) {
        nextActive = fromDisk[0]?.id ?? null;
      }
      set({ pipelines: fromDisk, activePipelineId: nextActive });
      get().toast('Pipelines reloaded from disk', 'info');
    } catch (e) {
      console.error('reloadFromDisk failed', e);
    }
  },

  setElements: (els) => set({ elements: els }),
  setLoadingElements: (l) => set({ loadingElements: l }),
  setGstVersion: (v) => set({ gstVersion: v }),
  upsertDetail: (d) => set((s) => ({ details: { ...s.details, [d.name]: d } })),

  ensureDetail: async (name) => {
    const cached = get().details[name];
    if (cached) return cached;
    const d = await window.gst.inspectElement(name);
    if (d) set((s) => ({ details: { ...s.details, [d.name]: d } }));
    return d;
  },

  newPipeline: (name) => {
    const idx = get().pipelines.length + 1;
    const np = newPipelineDef(name || `Pipeline ${idx}`);
    set((s) => ({ pipelines: [...s.pipelines, np], activePipelineId: np.id }));
    return np.id;
  },

  clonePipelineFrom: (sourceId, name) => {
    const source = get().pipelines.find((p) => p.id === sourceId);
    if (!source) return null;
    const taken = new Set(get().pipelines.map((p) => p.name));
    let baseName = name?.trim() || `${source.name} (copy)`;
    let finalName = baseName;
    let suffix = 2;
    while (taken.has(finalName)) finalName = `${baseName} ${suffix++}`;
    const { cloned } = clonePipelineWithFreshIds(
      { id: source.id, name: source.name, nodes: source.nodes, edges: source.edges },
      finalName,
    );
    const np: Pipeline = { ...cloned, running: false, logs: [] };
    set((s) => ({ pipelines: [...s.pipelines, np], activePipelineId: np.id }));
    return np.id;
  },

  importPipeline: async (raw, fileName) => {
    if (!raw || typeof raw !== 'object') {
      get().toast('Invalid pipeline file', 'err');
      return null;
    }
    const obj = raw as {
      id?: string;
      name?: string;
      nodes?: PipelineGraphNode[];
      edges?: Pipeline['edges'];
    };
    const id = `pl_${Math.random().toString(36).slice(2, 9)}`;
    const taken = new Set(get().pipelines.map((p) => p.name));
    let baseName = obj.name?.trim() || fileName?.replace(/\.json$/i, '') || 'Imported';
    let name = baseName;
    let suffix = 2;
    while (taken.has(name)) name = `${baseName} (${suffix++})`;
    const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
    const edges = Array.isArray(obj.edges) ? obj.edges : [];
    const imported: Pipeline = {
      id,
      name,
      nodes,
      edges,
      running: false,
      logs: [],
    };
    set((s) => ({ pipelines: [...s.pipelines, imported], activePipelineId: id }));
    const ensure = get().ensureDetail;
    const elementNames = new Set<string>();
    for (const n of nodes) {
      if (n.type === 'gstElement') {
        const elName = (n.data as PipelineNodeData).elementName;
        if (elName) elementNames.add(elName);
      }
    }
    await Promise.all(Array.from(elementNames).map((n) => ensure(n).catch(() => null)));
    get().toast(`Imported ${name}`, 'info');
    return id;
  },

  removePipeline: (id) =>
    set((s) => {
      const filtered = s.pipelines.filter((p) => p.id !== id);
      const newActive =
        s.activePipelineId === id ? filtered[0]?.id || null : s.activePipelineId;
      return {
        pipelines: filtered,
        activePipelineId: newActive ?? (filtered[0]?.id || null),
      };
    }),

  setActive: (id) => set({ activePipelineId: id, selectedNodeId: null }),

  openPipeline: (id) => set({ activePipelineId: id, selectedNodeId: null, view: 'editor' }),

  renamePipeline: (id, name) =>
    set((s) => ({
      pipelines: s.pipelines.map((p) => (p.id === id ? { ...p, name } : p)),
    })),

  updatePipeline: (id, mut) =>
    set((s) => ({
      pipelines: s.pipelines.map((p) => {
        if (p.id !== id) return p;
        const copy = { ...p, nodes: [...p.nodes], edges: [...p.edges] };
        mut(copy);
        return copy;
      }),
    })),

  selectNode: (id) => set({ selectedNodeId: id }),

  addNodeFromElement: async (el, position) => {
    const detail = await get().ensureDetail(el.name);
    if (!detail) {
      get().toast(`Failed to inspect element ${el.name}`, 'err');
      return;
    }
    const active = get().pipelines.find((p) => p.id === get().activePipelineId)
      || get().pipelines[0];
    if (!active) return;
    const taken = new Set<string>(
      active.nodes
        .filter((n) => n.type === 'gstElement')
        .map((n) => (n.data as PipelineNodeData).instanceName),
    );
    const instanceName = makeInstanceName(el.name, taken);
    const initialProps: Record<string, string | number | boolean | null> = {};
    for (const p of detail.properties) {
      if (!p.writable) continue;
      if (p.name === 'name' || p.name === 'parent') continue;
      if (p.kind === 'object') continue;
    }
    const node: PipelineGraphNode = {
      id: `n_${Math.random().toString(36).slice(2, 10)}`,
      type: 'gstElement',
      position,
      data: {
        elementName: el.name,
        instanceName,
        properties: initialProps,
      } satisfies PipelineNodeData,
    };
    get().updatePipeline(active.id, (p) => {
      p.nodes.push(node);
    });
    set({ activePipelineId: active.id, selectedNodeId: node.id });
  },

  updateNodeProps: (nodeId, key, value) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstElement') return n;
        const props = { ...(n.data as PipelineNodeData).properties };
        if (value === '' || value === null) delete props[key];
        else props[key] = value;
        return { ...n, data: { ...n.data, properties: props } };
      });
    });
  },

  updateInstanceName: (nodeId, name) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstElement') return n;
        return { ...n, data: { ...n.data, instanceName: name } };
      });
    });
  },

  toggleNodeBindings: (nodeId) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstElement') return n;
        return { ...n, data: { ...n.data, showBindings: !n.data.showBindings } };
      });
    });
  },

  addVariableNode: (position) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId)
      || get().pipelines[0];
    if (!active) return;
    const taken = new Set(
      active.nodes
        .filter((n) => n.type === 'gstVariable')
        .map((n) => (n.data as VariableNodeData).varName),
    );
    let name = 'var';
    for (let i = 0; i < 9999; i++) {
      const candidate = `var${i + 1}`;
      if (!taken.has(candidate)) {
        name = candidate;
        break;
      }
    }
    const node: PipelineGraphNode = {
      id: `v_${Math.random().toString(36).slice(2, 10)}`,
      type: 'gstVariable',
      position,
      data: { varName: name, valueKind: 'string', value: '' } satisfies VariableNodeData,
    };
    get().updatePipeline(active.id, (p) => {
      p.nodes.push(node);
    });
    set({ activePipelineId: active.id, selectedNodeId: node.id });
  },

  updateVariableName: (nodeId, name) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstVariable') return n;
        return { ...n, data: { ...n.data, varName: name } };
      });
    });
  },

  updateVariableLabel: (nodeId, label) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstVariable') return n;
        return { ...n, data: { ...n.data, label } };
      });
    });
  },

  toggleVariableHidden: (nodeId) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstVariable') return n;
        return { ...n, data: { ...n.data, hidden: !n.data.hidden } };
      });
    });
  },

  updateVariableValue: (nodeId, value) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updateVariableValueIn(id, nodeId, value);
  },

  updateVariableValueIn: (pipelineId, nodeId, value) => {
    get().updatePipeline(pipelineId, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstVariable') return n;
        return { ...n, data: { ...n.data, value } };
      });
    });
  },

  inferVariableForBinding: (variableId, elementNodeId, propertyName) => {
    const state = get();
    const active = state.pipelines.find((p) => p.id === state.activePipelineId);
    if (!active) return;
    const elNode = active.nodes.find((n) => n.id === elementNodeId);
    if (!elNode || elNode.type !== 'gstElement') return;
    const detail = state.details[(elNode.data as PipelineNodeData).elementName];
    if (!detail) return;
    const prop = detail.properties.find((p) => p.name === propertyName);
    if (!prop) return;

    let kind: VariableValueKind = 'string';
    let seedValue: string | number | boolean | null = null;
    switch (prop.kind) {
      case 'boolean':
        kind = 'boolean';
        seedValue = prop.defaultValue === 'true';
        break;
      case 'integer':
      case 'integer64':
      case 'uinteger':
      case 'uinteger64':
      case 'float':
      case 'double': {
        kind = 'number';
        const n = Number(prop.defaultValue);
        seedValue = Number.isFinite(n) ? n : 0;
        break;
      }
      case 'enum':
        kind = 'string';
        seedValue = prop.defaultValue || prop.enumValues?.[0]?.nick || '';
        break;
      default:
        kind = 'string';
        seedValue = prop.defaultValue || '';
    }

    state.updatePipeline(active.id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableId || n.type !== 'gstVariable') return n;
        const vd = n.data as VariableNodeData;
        const cur = vd.value;
        const isEmpty = cur === null || cur === undefined || cur === '';
        let newValue: VariableNodeData['value'];
        if (kind === 'boolean') {
          newValue = isEmpty ? (seedValue as boolean) : cur === true || cur === 'true';
        } else if (kind === 'number') {
          if (isEmpty) newValue = seedValue as number;
          else {
            const num = typeof cur === 'number' ? cur : Number(cur);
            newValue = Number.isFinite(num) ? num : (seedValue as number);
          }
        } else {
          newValue = isEmpty ? (seedValue as string) : String(cur);
        }
        const isDefaultName = /^var\d+$/i.test(vd.varName);
        const newName = isDefaultName ? propertyName.replace(/[^a-zA-Z0-9_]/g, '_') : vd.varName;
        return {
          ...n,
          data: { ...vd, valueKind: kind, value: newValue, varName: newName },
        };
      });
    });
  },

  addTransformNode: (kind, position) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId)
      || get().pipelines[0];
    if (!active) return;
    const inputs: TransformInput[] = kind === 'concat'
      ? [
          { id: `i_${Math.random().toString(36).slice(2, 7)}`, name: 'a' },
          { id: `i_${Math.random().toString(36).slice(2, 7)}`, name: 'b' },
        ]
      : [
          { id: `i_${Math.random().toString(36).slice(2, 7)}`, name: 'a' },
          { id: `i_${Math.random().toString(36).slice(2, 7)}`, name: 'b' },
        ];
    const expression = kind === 'concat' ? '${a}${b}' : 'a + b';
    const node: PipelineGraphNode = {
      id: `t_${Math.random().toString(36).slice(2, 10)}`,
      type: 'gstTransform',
      position,
      data: { kind, inputs, expression } satisfies TransformNodeData,
    };
    get().updatePipeline(active.id, (p) => {
      p.nodes.push(node);
    });
    set({ activePipelineId: active.id, selectedNodeId: node.id });
  },

  updateTransformLabel: (nodeId, label) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstTransform') return n;
        return { ...n, data: { ...n.data, label } };
      });
    });
  },

  updateTransformExpression: (nodeId, expression) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstTransform') return n;
        return { ...n, data: { ...n.data, expression } };
      });
    });
  },

  addTransformInput: (nodeId) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstTransform') return n;
        const used = new Set(n.data.inputs.map((i) => i.name));
        const alphabet = 'abcdefghijklmnopqrstuvwxyz';
        let nextName = '';
        for (const ch of alphabet) {
          if (!used.has(ch)) {
            nextName = ch;
            break;
          }
        }
        if (!nextName) nextName = `x${n.data.inputs.length + 1}`;
        const newInput: TransformInput = {
          id: `i_${Math.random().toString(36).slice(2, 7)}`,
          name: nextName,
        };
        return { ...n, data: { ...n.data, inputs: [...n.data.inputs, newInput] } };
      });
    });
  },

  renameTransformInput: (nodeId, inputId, name) => {
    const id = get().activePipelineId;
    if (!id) return;
    const clean = name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstTransform') return n;
        return {
          ...n,
          data: {
            ...n.data,
            inputs: n.data.inputs.map((i) => (i.id === inputId ? { ...i, name: clean || i.name } : i)),
          },
        };
      });
    });
  },

  removeTransformInput: (nodeId, inputId) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstTransform') return n;
        return {
          ...n,
          data: { ...n.data, inputs: n.data.inputs.filter((i) => i.id !== inputId) },
        };
      });
      p.edges = p.edges.filter(
        (e) =>
          !(e.target === nodeId && (
            e.data?.transformInputId === inputId || e.targetHandle === `in:${inputId}`
          )),
      );
    });
  },

  updateVariableKind: (nodeId, kind) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().updatePipeline(id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== nodeId || n.type !== 'gstVariable') return n;
        let value = n.data.value as unknown;
        if (kind === 'boolean') value = value === true || value === 'true';
        else if (kind === 'number') value = typeof value === 'number' ? value : Number(value) || 0;
        else value = value == null ? '' : String(value);
        return {
          ...n,
          data: { ...n.data, valueKind: kind, value: value as VariableNodeData['value'] },
        };
      });
    });
  },

  appendLog: (entry) => {
    set((s) => ({
      pipelines: s.pipelines.map((p) =>
        p.id === entry.pipelineId
          ? { ...p, logs: [...p.logs.slice(-1999), entry] }
          : p,
      ),
    }));
  },

  setStatus: (status) => {
    set((s) => ({
      pipelines: s.pipelines.map((p) =>
        p.id === status.pipelineId
          ? { ...p, running: status.running, pid: status.pid, exitCode: status.exitCode }
          : p,
      ),
    }));
  },

  toast: (text, kind = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function stripForPersist(p: Pipeline): PipelineDef {
  return {
    id: p.id,
    name: p.name,
    nodes: p.nodes,
    edges: p.edges,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized = '';
let pendingPayload: { pipelines: ReturnType<typeof stripForPersist>[] } | null = null;
let suspendAutosaveUntil = 0;

function cancelPendingAutosave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingPayload = null;
}

async function flushSaveNow(): Promise<void> {
  if (!pendingPayload) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const payload = pendingPayload;
  pendingPayload = null;
  try {
    await window.gst.savePipelines(payload);
  } catch (e) {
    console.error('Failed to flush pipelines', e);
  }
}

useStore.subscribe((state) => {
  if (!state.hydrated || !state.persistenceEnabled) return;
  if (Date.now() < suspendAutosaveUntil) return;
  const next = JSON.stringify({ pipelines: state.pipelines.map(stripForPersist) });
  if (next === lastSerialized) return;
  lastSerialized = next;
  pendingPayload = { pipelines: state.pipelines.map(stripForPersist) };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSaveNow();
  }, 300);
});

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gstStore = useStore;
  window.addEventListener('beforeunload', () => {
    if (pendingPayload) {
      try {
        void window.gst.savePipelines(pendingPayload);
      } catch (e) {
        console.error('beforeunload save failed', e);
      }
    }
  });
}
