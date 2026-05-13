import { create } from 'zustand';
import type {
  GroupBoundaryPad,
  GroupDef,
  GroupParameter,
  GstElementSummary,
  GstElementDetail,
  IteratorColumn,
  IteratorRow,
  PipelineDef,
  PipelineGraphNode,
  PipelineNodeData,
  RunLogEntry,
  RunStatus,
  TransformInput,
  TransformKind,
  TransformNodeData,
  VariableKvValue,
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
  history: Record<string, { past: PipelineDef[]; future: PipelineDef[] }>;
  undo: () => boolean;
  redo: () => boolean;
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
  updateVariableValue: (
    nodeId: string,
    value: string | number | boolean | string[] | number[] | boolean[] | null,
  ) => void;
  updateVariableValueIn: (
    pipelineId: string,
    nodeId: string,
    value: string | number | boolean | string[] | number[] | boolean[] | null,
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
  // Loop groups
  createGroup: (memberNodeIds: string[], position: { x: number; y: number }) => string | null;
  ungroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  setGroupIterator: (groupId: string, variableNodeId: string) => void;
  addGroupParameter: (groupId: string, param: GroupParameter) => void;
  removeGroupParameter: (groupId: string, targetNodeId: string, propertyKey: string) => void;
  // Record-list iterator (variable) editing
  addIteratorColumn: (variableNodeId: string, name: string, kind: IteratorColumn['kind']) => void;
  removeIteratorColumn: (variableNodeId: string, name: string) => void;
  renameIteratorColumn: (variableNodeId: string, oldName: string, newName: string) => void;
  setIteratorColumnKind: (variableNodeId: string, name: string, kind: IteratorColumn['kind']) => void;
  addIteratorRow: (variableNodeId: string) => void;
  addIteratorRowIn: (pipelineId: string, variableNodeId: string) => void;
  removeIteratorRow: (variableNodeId: string, index: number) => void;
  removeIteratorRowIn: (pipelineId: string, variableNodeId: string, index: number) => void;
  setIteratorCell: (
    variableNodeId: string,
    rowIndex: number,
    column: string,
    value: string | number | boolean | null,
  ) => void;
  setIteratorCellIn: (
    pipelineId: string,
    variableNodeId: string,
    rowIndex: number,
    column: string,
    value: string | number | boolean | null,
  ) => void;
  // KV variable editing
  setKvEntry: (variableNodeId: string, key: string, value: string) => void;
  setKvEntryIn: (pipelineId: string, variableNodeId: string, key: string, value: string) => void;
  removeKvEntry: (variableNodeId: string, key: string) => void;
  removeKvEntryIn: (pipelineId: string, variableNodeId: string, key: string) => void;
  renameKvKey: (variableNodeId: string, oldKey: string, newKey: string) => void;
  // Iterator column variable-ref edits (only for kind === 'variable' columns)
  setIteratorColumnVariableRef: (
    variableNodeId: string,
    columnName: string,
    kvNodeId: string,
  ) => void;
  // Group parameter template (alternative to sourceColumn)
  setGroupParameterTemplate: (
    groupId: string,
    targetNodeId: string,
    propertyKey: string,
    template: string | undefined,
  ) => void;
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

/** Max snapshots retained per pipeline. */
const MAX_HISTORY = 50;

/** Return a normalized JSON signature of the pipeline that ignores transient state:
 *  node positions, selection flags, runtime status, and log buffers. Two pipelines
 *  that produce the same signature are considered identical for undo purposes. */
function historySignature(p: Pipeline): string {
  return JSON.stringify({
    id: p.id,
    name: p.name,
    nodes: p.nodes.map((n) => {
      const copy: PipelineGraphNode & { selected?: boolean } = { ...n };
      copy.position = { x: 0, y: 0 };
      delete (copy as { selected?: boolean }).selected;
      return copy;
    }),
    edges: p.edges.map((e) => {
      const copy = { ...e } as typeof e & { selected?: boolean };
      delete copy.selected;
      return copy;
    }),
    groups: p.groups,
  });
}

/** Strip the live Pipeline down to a persistable PipelineDef snapshot for history. */
function snapshotForHistory(p: Pipeline): PipelineDef {
  return {
    id: p.id,
    name: p.name,
    nodes: p.nodes.map((n) => ({ ...n, position: { ...n.position } })),
    edges: p.edges.map((e) => ({ ...e })),
    groups: p.groups ? p.groups.map((g) => ({ ...g })) : undefined,
  };
}

/** Replace the structural slice of a Pipeline with a snapshot while preserving live
 *  runtime state (running/pid/exitCode/logs). */
function mergeSnapshotInto(live: Pipeline, snap: PipelineDef): Pipeline {
  return {
    ...live,
    name: snap.name,
    nodes: snap.nodes,
    edges: snap.edges,
    groups: snap.groups,
  };
}

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
  history: {},

  setView: (v) => set({ view: v }),

  // Undo/redo restore the previous PipelineDef snapshot for the active pipeline.
  // Position/selection drift is excluded from history signatures so dragging a node
  // around the canvas doesn't burn ring-buffer slots; only meaningful structural and
  // value changes (node add/remove, edge changes, property edits, group ops,
  // iterator schema/rows) push entries.
  undo: () => {
    const id = get().activePipelineId;
    if (!id) return false;
    const h = get().history[id];
    if (!h || h.past.length === 0) return false;
    const last = h.past[h.past.length - 1];
    const past = h.past.slice(0, -1);
    const current = get().pipelines.find((p) => p.id === id);
    if (!current) return false;
    const future = [...h.future, snapshotForHistory(current)].slice(-MAX_HISTORY);
    set((s) => ({
      pipelines: s.pipelines.map((p) =>
        p.id === id ? mergeSnapshotInto(p, last) : p,
      ),
      history: { ...s.history, [id]: { past, future } },
    }));
    return true;
  },

  redo: () => {
    const id = get().activePipelineId;
    if (!id) return false;
    const h = get().history[id];
    if (!h || h.future.length === 0) return false;
    const next = h.future[h.future.length - 1];
    const future = h.future.slice(0, -1);
    const current = get().pipelines.find((p) => p.id === id);
    if (!current) return false;
    const past = [...h.past, snapshotForHistory(current)].slice(-MAX_HISTORY);
    set((s) => ({
      pipelines: s.pipelines.map((p) =>
        p.id === id ? mergeSnapshotInto(p, next) : p,
      ),
      history: { ...s.history, [id]: { past, future } },
    }));
    return true;
  },

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
    set((s) => {
      const prev = s.pipelines.find((p) => p.id === id);
      if (!prev) return s;
      const prevSig = historySignature(prev);
      const nextPipelines = s.pipelines.map((p) => {
        if (p.id !== id) return p;
        const copy = { ...p, nodes: [...p.nodes], edges: [...p.edges] };
        mut(copy);
        return copy;
      });
      const next = nextPipelines.find((p) => p.id === id);
      if (!next) return { pipelines: nextPipelines };
      const nextSig = historySignature(next);
      if (prevSig === nextSig) {
        // Position-only / selection-only / runtime status change — don't burn history.
        return { pipelines: nextPipelines };
      }
      const h = s.history[id] || { past: [], future: [] };
      const past = [...h.past, snapshotForHistory(prev)].slice(-MAX_HISTORY);
      return {
        pipelines: nextPipelines,
        history: { ...s.history, [id]: { past, future: [] } },
      };
    }),

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

  // ===== Loop groups =====
  // A group is metadata: it points to existing member nodes by id and holds a parameter
  // table + boundary handles. Members keep living in pipeline.nodes; only the container
  // is added to nodes[] (rendered as a `gstGroup` xyflow node).
  createGroup: (memberNodeIds, position) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return null;
    const memberSet = new Set(memberNodeIds);
    if (memberSet.size === 0) return null;
    // Reject if any member is already in another group (no nested groups in v1)
    const existingGroups = active.groups || [];
    for (const g of existingGroups) {
      for (const m of g.memberNodeIds) {
        if (memberSet.has(m)) {
          get().toast(`"${active.nodes.find((n) => n.id === m)?.data && (active.nodes.find((n) => n.id === m)!.data as PipelineNodeData).instanceName || m}" is already in a group`, 'err');
          return null;
        }
      }
    }
    // Accept any node type except another group container. Variables and transforms
    // can live inside; their binding/value edges replicate per iteration alongside
    // stream edges. The iterator variable must NOT be a member — it would get cloned
    // along with the prototype and stop being addressable as a single iterator.
    for (const m of memberNodeIds) {
      const node = active.nodes.find((n) => n.id === m);
      if (!node) {
        get().toast('Group member not found', 'err');
        return null;
      }
      if (node.type === 'gstGroup') {
        get().toast('Nested groups are not supported yet', 'err');
        return null;
      }
    }
    const groupId = `g_${Math.random().toString(36).slice(2, 10)}`;
    const boundary = computeGroupBoundary(active, memberSet);
    const groupNode: PipelineGraphNode = {
      id: groupId,
      type: 'gstGroup',
      position,
      data: { groupId },
    };
    const newGroup: GroupDef = {
      id: groupId,
      name: 'Loop',
      memberNodeIds,
      iteratorVarId: '',
      parameters: [],
      boundary,
    };
    // Reroute any edges that cross the boundary to terminate at the group container.
    // Internal edges stay on member nodes; we don't touch them.
    get().updatePipeline(active.id, (p) => {
      p.nodes = [...p.nodes, groupNode];
      p.groups = [...existingGroups, newGroup];
      p.edges = p.edges.map((e) => {
        const srcInside = memberSet.has(e.source);
        const tgtInside = memberSet.has(e.target);
        if (srcInside && tgtInside) return e; // internal — keep as-is
        if (!srcInside && !tgtInside) return e; // outside — keep as-is
        if (tgtInside) {
          // outside → member: redirect to group container
          const b = boundary.find(
            (bd) =>
              bd.direction === 'sink' &&
              bd.memberNodeId === e.target &&
              `sink:${bd.memberPadName}` === e.targetHandle,
          );
          if (!b) return e;
          return { ...e, target: groupId, targetHandle: b.handleId };
        }
        // srcInside, !tgtInside: member → outside
        const b = boundary.find(
          (bd) =>
            bd.direction === 'src' &&
            bd.memberNodeId === e.source &&
            `src:${bd.memberPadName}` === e.sourceHandle,
        );
        if (!b) return e;
        return { ...e, source: groupId, sourceHandle: b.handleId };
      });
    });
    return groupId;
  },

  ungroup: (groupId) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    const group = (active.groups || []).find((g) => g.id === groupId);
    if (!group) return;
    get().updatePipeline(active.id, (p) => {
      // Restore boundary edges back to member-node targets
      p.edges = p.edges
        .map((e) => {
          if (e.source === groupId) {
            const b = group.boundary.find(
              (bd) => bd.direction === 'src' && bd.handleId === e.sourceHandle,
            );
            if (!b) return null;
            return { ...e, source: b.memberNodeId, sourceHandle: `src:${b.memberPadName}` };
          }
          if (e.target === groupId) {
            const b = group.boundary.find(
              (bd) => bd.direction === 'sink' && bd.handleId === e.targetHandle,
            );
            if (!b) return null;
            return { ...e, target: b.memberNodeId, targetHandle: `sink:${b.memberPadName}` };
          }
          return e;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      // Drop the container node
      p.nodes = p.nodes.filter((n) => n.id !== groupId);
      p.groups = (p.groups || []).filter((g) => g.id !== groupId);
    });
  },

  renameGroup: (groupId, name) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.groups = (p.groups || []).map((g) => (g.id === groupId ? { ...g, name } : g));
    });
  },

  setGroupIterator: (groupId, variableNodeId) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    const group = (active.groups || []).find((g) => g.id === groupId);
    if (group && variableNodeId && group.memberNodeIds.includes(variableNodeId)) {
      get().toast(
        'Iterator variable must live outside this group — it drives the loop, so it cannot be one of the cloned members.',
        'err',
      );
      return;
    }
    get().updatePipeline(active.id, (p) => {
      p.groups = (p.groups || []).map((g) =>
        g.id === groupId ? { ...g, iteratorVarId: variableNodeId } : g,
      );
    });
  },

  addGroupParameter: (groupId, param) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.groups = (p.groups || []).map((g) => {
        if (g.id !== groupId) return g;
        const exists = g.parameters.some(
          (x) => x.targetNodeId === param.targetNodeId && x.propertyKey === param.propertyKey,
        );
        return exists ? g : { ...g, parameters: [...g.parameters, param] };
      });
    });
  },

  removeGroupParameter: (groupId, targetNodeId, propertyKey) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.groups = (p.groups || []).map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              parameters: g.parameters.filter(
                (x) => !(x.targetNodeId === targetNodeId && x.propertyKey === propertyKey),
              ),
            },
      );
    });
  },

  // ===== Record-list iterator (schema + rows) =====
  // The schema lists column names + types; rows hold the per-iteration cell values keyed
  // by column name. Schema-side edits backfill rows so we never end up with a row missing
  // a column key (which would yield empty strings at unroll time and silent miswiring).
  addIteratorColumn: (variableNodeId, name, kind) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    get().updatePipeline(active.id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const schema = d.schema ? [...d.schema] : [];
        if (schema.some((c) => c.name === trimmed)) return n;
        schema.push({ name: trimmed, kind });
        const rows = (Array.isArray(d.value) ? (d.value as IteratorRow[]) : []).map((r) => ({
          ...r,
          [trimmed]: kind === 'boolean' ? false : kind === 'number' ? 0 : '',
        }));
        return { ...n, data: { ...d, valueKind: 'record-list', schema, value: rows } };
      });
    });
  },

  removeIteratorColumn: (variableNodeId, name) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const schema = (d.schema || []).filter((c) => c.name !== name);
        const rows = (Array.isArray(d.value) ? (d.value as IteratorRow[]) : []).map((r) => {
          const next = { ...r };
          delete next[name];
          return next;
        });
        return { ...n, data: { ...d, schema, value: rows } };
      });
      // Any group parameters that referenced this column lose their sourceColumn so the
      // diagnostic surfaces "binds to column which is no longer in the iterator schema"
      p.groups = (p.groups || []).map((g) =>
        g.iteratorVarId !== variableNodeId
          ? g
          : {
              ...g,
              parameters: g.parameters.map((pr) =>
                pr.sourceColumn === name ? { ...pr, sourceColumn: undefined } : pr,
              ),
            },
      );
    });
  },

  renameIteratorColumn: (variableNodeId, oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const schema = (d.schema || []).map((c) =>
          c.name === oldName ? { ...c, name: trimmed } : c,
        );
        const rows = (Array.isArray(d.value) ? (d.value as IteratorRow[]) : []).map((r) => {
          if (!(oldName in r)) return r;
          const next: IteratorRow = { ...r };
          next[trimmed] = next[oldName];
          delete next[oldName];
          return next;
        });
        return { ...n, data: { ...d, schema, value: rows } };
      });
      p.groups = (p.groups || []).map((g) =>
        g.iteratorVarId !== variableNodeId
          ? g
          : {
              ...g,
              parameters: g.parameters.map((pr) =>
                pr.sourceColumn === oldName ? { ...pr, sourceColumn: trimmed } : pr,
              ),
            },
      );
    });
  },

  setIteratorColumnKind: (variableNodeId, name, kind) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const schema = (d.schema || []).map((c) => (c.name === name ? { ...c, kind } : c));
        return { ...n, data: { ...d, schema } };
      });
    });
  },

  addIteratorRow: (variableNodeId) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().addIteratorRowIn(id, variableNodeId);
  },

  addIteratorRowIn: (pipelineId, variableNodeId) => {
    get().updatePipeline(pipelineId, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const schema = d.schema || [];
        const blankRow: IteratorRow = {};
        for (const c of schema) {
          blankRow[c.name] = c.kind === 'boolean' ? false : c.kind === 'number' ? 0 : '';
        }
        const rows = Array.isArray(d.value) ? [...(d.value as IteratorRow[]), blankRow] : [blankRow];
        return { ...n, data: { ...d, valueKind: 'record-list', value: rows } };
      });
    });
  },

  removeIteratorRow: (variableNodeId, index) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().removeIteratorRowIn(id, variableNodeId, index);
  },

  removeIteratorRowIn: (pipelineId, variableNodeId, index) => {
    get().updatePipeline(pipelineId, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const rows = Array.isArray(d.value) ? [...(d.value as IteratorRow[])] : [];
        if (index < 0 || index >= rows.length) return n;
        rows.splice(index, 1);
        return { ...n, data: { ...d, value: rows } };
      });
    });
  },

  setIteratorCell: (variableNodeId, rowIndex, column, value) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().setIteratorCellIn(id, variableNodeId, rowIndex, column, value);
  },

  setIteratorCellIn: (pipelineId, variableNodeId, rowIndex, column, value) => {
    get().updatePipeline(pipelineId, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const rows = Array.isArray(d.value) ? [...(d.value as IteratorRow[])] : [];
        if (rowIndex < 0 || rowIndex >= rows.length) return n;
        rows[rowIndex] = { ...rows[rowIndex], [column]: value };
        return { ...n, data: { ...d, value: rows } };
      });
    });
  },

  // ===== KV variable (flat string→string map) =====
  // A kv variable stores presets keyed by name (e.g. service → endpoint URL). Iterator
  // columns of kind 'variable' reference one and present its keys as a dropdown per cell.
  setKvEntry: (variableNodeId, key, value) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().setKvEntryIn(id, variableNodeId, key, value);
  },

  setKvEntryIn: (pipelineId, variableNodeId, key, value) => {
    if (!key.trim()) return;
    get().updatePipeline(pipelineId, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const map: VariableKvValue =
          d.value && typeof d.value === 'object' && !Array.isArray(d.value)
            ? { ...(d.value as VariableKvValue) }
            : {};
        map[key] = value;
        return { ...n, data: { ...d, valueKind: 'kv', value: map } };
      });
    });
  },

  removeKvEntry: (variableNodeId, key) => {
    const id = get().activePipelineId;
    if (!id) return;
    get().removeKvEntryIn(id, variableNodeId, key);
  },

  removeKvEntryIn: (pipelineId, variableNodeId, key) => {
    get().updatePipeline(pipelineId, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        if (!d.value || typeof d.value !== 'object' || Array.isArray(d.value)) return n;
        const map: VariableKvValue = { ...(d.value as VariableKvValue) };
        delete map[key];
        return { ...n, data: { ...d, value: map } };
      });
    });
  },

  renameKvKey: (variableNodeId, oldKey, newKey) => {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        if (!d.value || typeof d.value !== 'object' || Array.isArray(d.value)) return n;
        const map = { ...(d.value as VariableKvValue) };
        if (!(oldKey in map)) return n;
        map[trimmed] = map[oldKey];
        delete map[oldKey];
        return { ...n, data: { ...d, value: map } };
      });
      // Update any iterator rows that used the renamed key as a cell value in a column
      // referencing this kv variable. Without this, the rename silently breaks
      // existing iterator cells.
      for (const iter of p.nodes) {
        if (iter.type !== 'gstVariable') continue;
        const d = iter.data as VariableNodeData;
        if (d.valueKind !== 'record-list') continue;
        const schema = d.schema || [];
        const cols = schema.filter((c) => c.kind === 'variable' && c.variableRef === variableNodeId);
        if (cols.length === 0) continue;
        if (!Array.isArray(d.value)) continue;
        const rows = (d.value as IteratorRow[]).map((row) => {
          const next: IteratorRow = { ...row };
          for (const c of cols) {
            if (next[c.name] === oldKey) next[c.name] = trimmed;
          }
          return next;
        });
        iter.data = { ...d, value: rows } as VariableNodeData;
      }
    });
  },

  setIteratorColumnVariableRef: (variableNodeId, columnName, kvNodeId) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.nodes = p.nodes.map((n) => {
        if (n.id !== variableNodeId || n.type !== 'gstVariable') return n;
        const d = n.data as VariableNodeData;
        const schema = (d.schema || []).map((c) =>
          c.name === columnName ? { ...c, kind: 'variable' as const, variableRef: kvNodeId } : c,
        );
        return { ...n, data: { ...d, schema } };
      });
    });
  },

  setGroupParameterTemplate: (groupId, targetNodeId, propertyKey, template) => {
    const active = get().pipelines.find((p) => p.id === get().activePipelineId);
    if (!active) return;
    get().updatePipeline(active.id, (p) => {
      p.groups = (p.groups || []).map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              parameters: g.parameters.map((pr) =>
                pr.targetNodeId === targetNodeId && pr.propertyKey === propertyKey
                  ? { ...pr, template }
                  : pr,
              ),
            },
      );
    });
  },
}));

/** Walk a pipeline's edges and synthesize a stable list of boundary pads for a member set.
 *  Each boundary pad keeps the inner pad name; we rename only the handle ID prefix to make
 *  the container's handles distinct (`<dir>:<member>_<pad>`).
 *  Re-run any time member edges change so cached boundary[] stays in sync.
 *
 *  Only stream edges contribute to boundary handles. Binding edges (`prop:<name>`) and
 *  value edges (`in:<input>`) crossing the boundary aren't supported in v1 — they're
 *  silently dropped from the boundary calc; the editor surfaces them as detached if the
 *  user makes that mistake. */
function computeGroupBoundary(
  pipeline: PipelineDef,
  memberSet: Set<string>,
): GroupBoundaryPad[] {
  const boundary: GroupBoundaryPad[] = [];
  const seenIds = new Set<string>();
  const isStreamEdge = (e: PipelineDef['edges'][number]) =>
    e.sourceHandle?.startsWith('src:') &&
    e.targetHandle?.startsWith('sink:') &&
    e.data?.edgeKind !== 'binding' &&
    e.data?.edgeKind !== 'value';
  for (const e of pipeline.edges) {
    if (!isStreamEdge(e)) continue;
    const srcInside = memberSet.has(e.source);
    const tgtInside = memberSet.has(e.target);
    if (srcInside === tgtInside) continue; // internal or external
    if (tgtInside) {
      const padName = e.targetHandle.startsWith('sink:') ? e.targetHandle.slice(5) : 'sink';
      const handleId = `sink:${e.target}_${padName}`;
      if (seenIds.has(handleId)) continue;
      seenIds.add(handleId);
      boundary.push({
        handleId,
        direction: 'sink',
        memberNodeId: e.target,
        memberPadName: padName,
      });
    } else {
      const padName = e.sourceHandle.startsWith('src:') ? e.sourceHandle.slice(4) : 'src';
      const handleId = `src:${e.source}_${padName}`;
      if (seenIds.has(handleId)) continue;
      seenIds.add(handleId);
      boundary.push({
        handleId,
        direction: 'src',
        memberNodeId: e.source,
        memberPadName: padName,
      });
    }
  }
  return boundary;
}

function stripForPersist(p: Pipeline): PipelineDef {
  return {
    id: p.id,
    name: p.name,
    nodes: p.nodes,
    edges: p.edges,
    groups: p.groups,
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
