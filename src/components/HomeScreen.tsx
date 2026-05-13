import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { NewPipelineModal } from './NewPipelineModal';
import type { Pipeline } from '../state/store';
import type { IteratorColumn, IteratorRow, VariableNodeData } from '@shared/types';

function VariableTileRow({
  pipelineId,
  nodeId,
  data,
  refCount,
}: {
  pipelineId: string;
  nodeId: string;
  data: VariableNodeData;
  refCount: number;
}) {
  const updateVariableValueIn = useStore((s) => s.updateVariableValueIn);
  const displayLabel = data.label?.trim() || data.varName;
  const handleChange = (val: string | number | boolean | null) => {
    updateVariableValueIn(pipelineId, nodeId, val);
  };

  if (data.valueKind === 'record-list') {
    return (
      <IteratorTileTable
        pipelineId={pipelineId}
        nodeId={nodeId}
        data={data}
        refCount={refCount}
        displayLabel={displayLabel}
      />
    );
  }

  if (data.valueKind === 'kv') {
    return (
      <KvTileEditor
        pipelineId={pipelineId}
        nodeId={nodeId}
        data={data}
        refCount={refCount}
        displayLabel={displayLabel}
      />
    );
  }

  if (data.valueKind === 'list') {
    return (
      <ListTileEditor
        pipelineId={pipelineId}
        nodeId={nodeId}
        data={data}
        refCount={refCount}
        displayLabel={displayLabel}
      />
    );
  }

  return (
    <div className="home-var-row">
      <div className="home-var-meta">
        <span className="home-var-label">{displayLabel}</span>
        <span className="home-var-name">${data.varName}</span>
        <span className="home-var-bindings">
          {refCount === 0 ? 'unbound' : `${refCount} binding${refCount === 1 ? '' : 's'}`}
        </span>
      </div>
      {data.valueKind === 'boolean' ? (
        <label className="home-var-bool">
          <input
            type="checkbox"
            checked={data.value === true || data.value === 'true'}
            onChange={(e) => handleChange(e.target.checked)}
          />
          <span>{data.value === true || data.value === 'true' ? 'true' : 'false'}</span>
        </label>
      ) : data.valueKind === 'number' ? (
        <input
          className="home-var-input"
          type="number"
          value={
            typeof data.value === 'number'
              ? data.value
              : data.value == null
                ? ''
                : String(data.value)
          }
          placeholder="value"
          onChange={(e) => handleChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      ) : (
        <input
          className="home-var-input"
          type="text"
          value={data.value == null ? '' : String(data.value)}
          placeholder="value"
          onChange={(e) => handleChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** Inline kv editor on the Home pipeline tile — same key=value table as the modal but
 *  compact. Edits flow through the per-pipeline setKvEntryIn / removeKvEntryIn actions
 *  so the right pipeline is mutated regardless of which one is active. */
function KvTileEditor({
  pipelineId,
  nodeId,
  data,
  refCount,
  displayLabel,
}: {
  pipelineId: string;
  nodeId: string;
  data: VariableNodeData;
  refCount: number;
  displayLabel: string;
}) {
  const setEntry = useStore((s) => s.setKvEntryIn);
  const removeEntry = useStore((s) => s.removeKvEntryIn);
  const renameKey = useStore((s) => s.renameKvKey);
  const map =
    data.value && typeof data.value === 'object' && !Array.isArray(data.value)
      ? (data.value as Record<string, string>)
      : {};
  const keys = Object.keys(map);
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');

  function commit() {
    if (!draftKey.trim()) return;
    setEntry(pipelineId, nodeId, draftKey.trim(), draftValue);
    setDraftKey('');
    setDraftValue('');
  }

  return (
    <div className="home-iter-row">
      <div className="home-var-meta">
        <span className="home-var-label">{displayLabel}</span>
        <span className="home-var-name">${data.varName}</span>
        <span className="home-var-bindings">
          {keys.length} entr{keys.length === 1 ? 'y' : 'ies'} ·{' '}
          {refCount === 0 ? 'unbound' : `${refCount} reference${refCount === 1 ? '' : 's'}`}
        </span>
      </div>
      {keys.length === 0 ? (
        <div className="muted home-iter-empty">
          No entries yet. Add a key + value below.
        </div>
      ) : (
        <div className="home-iter-table-wrap">
          <table className="home-iter-table">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>key</th>
                <th>value</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <td>
                    <input
                      defaultValue={k}
                      onBlur={(e) =>
                        e.target.value !== k && renameKey(nodeId, k, e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={map[k]}
                      onChange={(e) => setEntry(pipelineId, nodeId, k, e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      className="ghost"
                      title={`Remove "${k}"`}
                      onClick={() => removeEntry(pipelineId, nodeId, k)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        <input
          placeholder="new key"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          style={{ width: '30%', minWidth: 100 }}
        />
        <input
          placeholder="value"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          style={{ flex: 1, minWidth: 160 }}
        />
        <button disabled={!draftKey.trim()} onClick={commit}>
          + entry
        </button>
      </div>
    </div>
  );
}

/** Inline editor for the scalar `list` variable kind (single-column iterator). Renders
 *  the items as a textarea (one per line) — same shape as the Properties Panel. */
function ListTileEditor({
  pipelineId,
  nodeId,
  data,
  refCount,
  displayLabel,
}: {
  pipelineId: string;
  nodeId: string;
  data: VariableNodeData;
  refCount: number;
  displayLabel: string;
}) {
  const updateVariableValueIn = useStore((s) => s.updateVariableValueIn);
  const items: Array<string | number | boolean> = Array.isArray(data.value)
    ? (data.value as Array<string | number | boolean>)
    : [];

  return (
    <div className="home-iter-row">
      <div className="home-var-meta">
        <span className="home-var-label">{displayLabel}</span>
        <span className="home-var-name">${data.varName}</span>
        <span className="home-var-bindings">
          {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
          {refCount === 0 ? 'unbound' : `${refCount} reference${refCount === 1 ? '' : 's'}`}
        </span>
      </div>
      <textarea
        rows={Math.max(3, Math.min(items.length + 1, 6))}
        placeholder={'One value per line'}
        value={items.map((v) => String(v)).join('\n')}
        onChange={(e) => {
          const lines = e.target.value
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
          updateVariableValueIn(pipelineId, nodeId, lines);
        }}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }}
      />
    </div>
  );
}

function IteratorTileTable({
  pipelineId,
  nodeId,
  data,
  refCount,
  displayLabel,
}: {
  pipelineId: string;
  nodeId: string;
  data: VariableNodeData;
  refCount: number;
  displayLabel: string;
}) {
  const setCell = useStore((s) => s.setIteratorCellIn);
  const addRow = useStore((s) => s.addIteratorRowIn);
  const removeRow = useStore((s) => s.removeIteratorRowIn);
  const schema: IteratorColumn[] = data.schema || [];
  const rows: IteratorRow[] = Array.isArray(data.value) ? (data.value as IteratorRow[]) : [];

  return (
    <div className="home-iter-row">
      <div className="home-var-meta">
        <span className="home-var-label">{displayLabel}</span>
        <span className="home-var-name">${data.varName}</span>
        <span className="home-var-bindings">
          {rows.length} row{rows.length === 1 ? '' : 's'} ·{' '}
          {refCount === 0 ? 'unbound' : `${refCount} group binding${refCount === 1 ? '' : 's'}`}
        </span>
      </div>
      {schema.length === 0 ? (
        <div className="muted home-iter-empty">
          No columns yet — open in editor to define this iterator's schema.
        </div>
      ) : (
        <div className="home-iter-table-wrap">
          <table className="home-iter-table">
            <thead>
              <tr>
                <th style={{ width: 22 }}>#</th>
                {schema.map((c) => (
                  <th key={c.name} title={`${c.name} (${c.kind})`}>
                    {c.name}
                  </th>
                ))}
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={schema.length + 2} className="muted" style={{ padding: 4 }}>
                    No iterations.
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  {schema.map((c) => {
                    const v = row[c.name];
                    return (
                      <td key={c.name}>
                        {c.kind === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={v === true || v === 'true'}
                            onChange={(e) =>
                              setCell(pipelineId, nodeId, i, c.name, e.target.checked)
                            }
                          />
                        ) : c.kind === 'number' ? (
                          <input
                            type="number"
                            value={v === null || v === undefined ? '' : Number(v)}
                            onChange={(e) =>
                              setCell(
                                pipelineId,
                                nodeId,
                                i,
                                c.name,
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                          />
                        ) : (
                          <input
                            type="text"
                            value={v === null || v === undefined ? '' : String(v)}
                            onChange={(e) => setCell(pipelineId, nodeId, i, c.name, e.target.value)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button
                      className="ghost"
                      title="Delete row"
                      onClick={() => removeRow(pipelineId, nodeId, i)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        <button disabled={schema.length === 0} onClick={() => addRow(pipelineId, nodeId)}>
          + add row
        </button>
      </div>
    </div>
  );
}

function PipelineTile({ pipeline }: { pipeline: Pipeline }) {
  const openPipeline = useStore((s) => s.openPipeline);
  const removePipeline = useStore((s) => s.removePipeline);
  const renamePipeline = useStore((s) => s.renamePipeline);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(pipeline.name);

  // Iterator-kind variables (list / record-list / kv) are by design meant to be
  // configured by end users on the home tile, so they're always shown regardless of
  // the `hidden` flag. Scalar variables (string / number / boolean) still respect it
  // — that flag was originally for internal constants the developer doesn't want
  // surfaced on the home screen.
  const isIteratorKind = (k: VariableNodeData['valueKind']) =>
    k === 'list' || k === 'record-list' || k === 'kv';
  const variables = useMemo(
    () =>
      pipeline.nodes
        .filter((n) => n.type === 'gstVariable')
        .map((n) => ({ id: n.id, data: n.data as VariableNodeData }))
        .filter((v) => isIteratorKind(v.data.valueKind) || !v.data.hidden),
    [pipeline.nodes],
  );

  const hiddenCount = useMemo(
    () =>
      pipeline.nodes.filter(
        (n) =>
          n.type === 'gstVariable' &&
          (n.data as VariableNodeData).hidden &&
          !isIteratorKind((n.data as VariableNodeData).valueKind),
      ).length,
    [pipeline.nodes],
  );

  const elementCount = pipeline.nodes.filter((n) => n.type === 'gstElement').length;

  const bindingsByVarId = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of pipeline.edges) {
      if (e.data?.edgeKind === 'binding' || e.sourceHandle === 'out') {
        m.set(e.source, (m.get(e.source) || 0) + 1);
      }
    }
    return m;
  }, [pipeline.edges]);

  const lastError = useMemo(() => {
    for (let i = pipeline.logs.length - 1; i >= 0; i--) {
      const log = pipeline.logs[i];
      if (log.stream === 'stderr' && /ERROR|WARNING: erroneous/i.test(log.line)) {
        return log.line;
      }
    }
    return null;
  }, [pipeline.logs]);

  async function start() {
    if (busy || pipeline.running) return;
    if (elementCount === 0) {
      toast('Pipeline has no elements — open it to build first', 'warn');
      return;
    }
    setBusy(true);
    try {
      const res = await window.gst.runPipeline({
        id: pipeline.id,
        name: pipeline.name,
        nodes: pipeline.nodes,
        edges: pipeline.edges,
      });
      if (!res.ok) toast(res.error || 'Failed to start pipeline', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!pipeline.running) return;
    setBusy(true);
    try {
      await window.gst.stopPipeline(pipeline.id);
    } finally {
      setBusy(false);
    }
  }

  function commitName() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== pipeline.name) renamePipeline(pipeline.id, trimmed);
    else setDraftName(pipeline.name);
    setEditingName(false);
  }

  return (
    <div className={`home-tile ${pipeline.running ? 'running' : ''}`}>
      <div className="home-tile-head">
        <div className="home-tile-title">
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setDraftName(pipeline.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <h3 onDoubleClick={() => setEditingName(true)} title="Double-click to rename">
              {pipeline.name}
            </h3>
          )}
          <div className="home-tile-sub">
            {elementCount} element{elementCount === 1 ? '' : 's'} · {variables.length} variable
            {variables.length === 1 ? '' : 's'}
            {hiddenCount > 0 && (
              <span className="home-tile-hidden-count">
                {' '}
                · {hiddenCount} hidden
              </span>
            )}
          </div>
        </div>
        <div className={`home-status ${pipeline.running ? 'on' : 'off'}`}>
          <span className="home-status-dot" />
          {pipeline.running
            ? `Running${pipeline.pid ? ` (pid ${pipeline.pid})` : ''}`
            : pipeline.exitCode != null
              ? `Exited (${pipeline.exitCode})`
              : 'Stopped'}
        </div>
      </div>

      <div className="home-tile-body">
        {variables.length === 0 ? (
          <div className="home-tile-empty">
            {hiddenCount > 0
              ? 'All variables in this pipeline are hidden constants.'
              : 'No variables defined. Open the editor to add some.'}
          </div>
        ) : (
          variables.map((v) => (
            <VariableTileRow
              key={v.id}
              pipelineId={pipeline.id}
              nodeId={v.id}
              data={v.data}
              refCount={bindingsByVarId.get(v.id) || 0}
            />
          ))
        )}
        {lastError && !pipeline.running && (
          <div className="home-tile-error" title={lastError}>
            {lastError}
          </div>
        )}
      </div>

      <div className="home-tile-actions">
        {pipeline.running ? (
          <button className="danger" onClick={stop} disabled={busy}>
            ■ Stop
          </button>
        ) : (
          <button className="primary" onClick={start} disabled={busy || elementCount === 0}>
            ▶ Start
          </button>
        )}
        <button onClick={() => openPipeline(pipeline.id)}>Configure</button>
        <button
          onClick={() => {
            const data = JSON.stringify(
              {
                id: pipeline.id,
                name: pipeline.name,
                nodes: pipeline.nodes,
                edges: pipeline.edges,
              },
              null,
              2,
            );
            const blob = new Blob([data], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${pipeline.name.replace(/\s+/g, '_')}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          title="Export to JSON file"
        >
          Export
        </button>
        <span className="spacer" />
        <button
          className="home-tile-delete"
          title="Delete pipeline"
          onClick={() => {
            if (pipeline.running) {
              toast('Stop the pipeline before deleting it', 'warn');
              return;
            }
            if (confirm(`Delete pipeline "${pipeline.name}"?`)) removePipeline(pipeline.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function HomeScreen() {
  const pipelines = useStore((s) => s.pipelines);
  const newPipeline = useStore((s) => s.newPipeline);
  const openPipeline = useStore((s) => s.openPipeline);
  const importPipeline = useStore((s) => s.importPipeline);
  const setView = useStore((s) => s.setView);
  const toast = useStore((s) => s.toast);
  const dataDir = useStore((s) => s.dataDir);
  const gstVersion = useStore((s) => s.gstVersion);
  const persistenceEnabled = useStore((s) => s.persistenceEnabled);
  const loadError = useStore((s) => s.loadError);
  const hydrated = useStore((s) => s.hydrated);
  const [showNewModal, setShowNewModal] = useState(false);

  function create() {
    setShowNewModal(true);
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;
      for (const f of files) {
        try {
          const text = await f.text();
          const obj = JSON.parse(text);
          await importPipeline(obj, f.name);
        } catch (e) {
          toast(`Import failed for ${f.name}: ${(e as Error).message}`, 'err');
        }
      }
    };
    input.click();
  }

  return (
    <div className="home">
      <div className="home-header">
        <div>
          <h1>GStreamer Pipelines</h1>
          <div className="home-meta">
            {pipelines.length} saved · {gstVersion || 'detecting GStreamer...'}
            {dataDir && <span className="home-data-dir"> · {dataDir}</span>}
            {hydrated && (
              <span
                className={`home-persist-badge ${persistenceEnabled ? 'ok' : 'off'}`}
                title={
                  persistenceEnabled
                    ? 'Changes are written to disk automatically'
                    : loadError
                      ? `Autosave disabled: ${loadError}. Existing disk file is being protected from overwrite.`
                      : 'Autosave disabled'
                }
              >
                {persistenceEnabled ? 'autosave on' : 'autosave OFF'}
              </span>
            )}
          </div>
        </div>
        <div className="home-header-actions">
          <button onClick={() => setView('marketplace')} title="Browse the package marketplace">
            🛒 Marketplace
          </button>
          <button onClick={importJson} title="Import pipeline JSON files">
            ↑ Import
          </button>
          <button className="primary" onClick={create}>
            + New Pipeline
          </button>
        </div>
      </div>
      {pipelines.length === 0 ? (
        <div className="home-empty">
          <div className="home-empty-icon">▸</div>
          <h2>No pipelines yet</h2>
          <p>
            Create a new pipeline, or import any JSON files you previously exported with
            the old Save button.
          </p>
          <div className="home-empty-actions">
            <button onClick={importJson}>↑ Import JSON</button>
            <button className="primary" onClick={create}>
              + New Pipeline
            </button>
          </div>
        </div>
      ) : (
        <div className="home-grid">
          {pipelines.map((p) => (
            <PipelineTile key={p.id} pipeline={p} />
          ))}
        </div>
      )}
      {showNewModal ? <NewPipelineModal onClose={() => setShowNewModal(false)} /> : null}
    </div>
  );
}
