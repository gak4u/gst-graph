import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import type {
  IteratorColumn,
  IteratorRow,
  VariableKvValue,
  VariableNodeData,
} from '@shared/types';

interface IteratorModalProps {
  pipelineId: string;
  variableNodeId: string;
  onClose: () => void;
}

/** Full-width schema + rows editor for a record-list iterator. Opened from the canvas
 *  Variable node or the Group inspector. The Home pipeline tile keeps its inline
 *  mini-table for fast tweaks; this modal is for the heavier "set up the schema" pass. */
export function IteratorModal({ pipelineId, variableNodeId, onClose }: IteratorModalProps): JSX.Element | null {
  const pipeline = useStore((s) => s.pipelines.find((p) => p.id === pipelineId));
  const variable = pipeline?.nodes.find((n) => n.id === variableNodeId);
  const data = variable && variable.type === 'gstVariable' ? (variable.data as VariableNodeData) : null;

  const addColumn = useStore((s) => s.addIteratorColumn);
  const removeColumn = useStore((s) => s.removeIteratorColumn);
  const renameColumn = useStore((s) => s.renameIteratorColumn);
  const setKind = useStore((s) => s.setIteratorColumnKind);
  const addRow = useStore((s) => s.addIteratorRowIn);
  const removeRow = useStore((s) => s.removeIteratorRowIn);
  const setCell = useStore((s) => s.setIteratorCellIn);
  const updateVariableKind = useStore((s) => s.updateVariableKind);
  const renameVariable = useStore((s) => s.updateVariableLabel);

  const [newColName, setNewColName] = useState('');
  const [newColKind, setNewColKind] = useState<IteratorColumn['kind']>('string');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Render through a portal to document.body. xyflow node containers apply a CSS
  // `transform` to position each node, which creates a new containing block for any
  // `position: fixed` descendant. Without the portal, our overlay would be sized to
  // the variable node's transformed bounding box (and clipped to the canvas viewport),
  // not to the page viewport.
  if (!data) {
    return createPortal(
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Iterator</h2>
            <button className="ghost" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">Variable not found.</div>
        </div>
      </div>,
      document.body,
    );
  }

  // kv-typed variable: render the key-value editor instead of the iterator schema/rows.
  if (data.valueKind === 'kv') {
    return createPortal(
      <KvEditorContent
        pipelineId={pipelineId}
        variableNodeId={variableNodeId}
        data={data}
        renameVariable={renameVariable}
        onClose={onClose}
      />,
      document.body,
    );
  }

  // If the user opened this modal on a scalar variable, offer conversion to either
  // record-list (iterator) or kv (lookup table).
  if (data.valueKind !== 'record-list') {
    return createPortal(
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Iterator setup</h2>
            <button className="ghost" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <p>
              <code>${data.varName}</code> is currently a <code>{data.valueKind}</code> variable.
              Pick what you'd like to turn it into:
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="primary"
                onClick={() => updateVariableKind(variableNodeId, 'record-list')}
              >
                Record-list iterator (schema + rows)
              </button>
              <button
                onClick={() => updateVariableKind(variableNodeId, 'kv')}
              >
                Key-value lookup table
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const schema: IteratorColumn[] = data.schema || [];
  const rows: IteratorRow[] = Array.isArray(data.value) ? (data.value as IteratorRow[]) : [];

  // All kv-kind Variable nodes in this pipeline. Used to populate column
  // sub-pickers when a column's kind is 'variable'.
  const kvVariables = useMemo(() => {
    return (pipeline?.nodes || []).filter(
      (n): n is Extract<typeof n, { type: 'gstVariable' }> =>
        n.type === 'gstVariable' && (n.data as VariableNodeData).valueKind === 'kv',
    );
  }, [pipeline]);

  function commitColumn() {
    if (!newColName.trim()) return;
    addColumn(variableNodeId, newColName, newColKind);
    setNewColName('');
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal iterator-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            Iterator&nbsp;<code>${data.varName}</code>
            <span className="muted" style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>
              {schema.length} column{schema.length === 1 ? '' : 's'} · {rows.length} row{rows.length === 1 ? '' : 's'}
            </span>
          </h2>
          <button className="ghost" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="modal-body iterator-modal-body">
          <div className="iter-modal-section">
            <div className="iter-modal-section-head">Label</div>
            <input
              placeholder="Display name (e.g. RTMP Targets)"
              value={data.label ?? ''}
              onChange={(e) => renameVariable(variableNodeId, e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="iter-modal-section">
            <div className="iter-modal-section-head">Columns &amp; rows</div>
            {schema.length === 0 ? (
              <div className="muted" style={{ padding: '8px 0' }}>
                No columns yet. Each column becomes a parameter you can wire to a member
                property inside the loop group. Add at least one column before adding rows.
              </div>
            ) : (
              <div className="iter-table-wrap">
                <table className="iter-table">
                  <thead>
                    <tr>
                      <th style={{ width: 26 }}>#</th>
                      {schema.map((c) => (
                        <th key={c.name}>
                          <ColumnHeaderEditor
                            column={c}
                            variableNodeId={variableNodeId}
                            kvVariables={kvVariables}
                          />
                        </th>
                      ))}
                      <th style={{ width: 40 }}></th>
                    </tr>
                    <tr>
                      <th></th>
                      {schema.map((c) => (
                        <th key={`${c.name}-drop`} style={{ textAlign: 'right' }}>
                          <button
                            className="ghost"
                            title={`Remove column "${c.name}"`}
                            onClick={() => removeColumn(variableNodeId, c.name)}
                          >
                            ✕
                          </button>
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={schema.length + 2} className="muted" style={{ padding: 8 }}>
                          No rows. Click <code>+ add row</code> below.
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
                              {c.kind === 'variable' ? (
                                <KvKeyDropdown
                                  pipelineId={pipelineId}
                                  variableRef={c.variableRef}
                                  value={v}
                                  onChange={(picked) =>
                                    setCell(pipelineId, variableNodeId, i, c.name, picked)
                                  }
                                />
                              ) : c.kind === 'boolean' ? (
                                <input
                                  type="checkbox"
                                  checked={v === true || v === 'true'}
                                  onChange={(e) =>
                                    setCell(pipelineId, variableNodeId, i, c.name, e.target.checked)
                                  }
                                />
                              ) : c.kind === 'number' ? (
                                <input
                                  type="number"
                                  value={v === null || v === undefined ? '' : Number(v)}
                                  onChange={(e) =>
                                    setCell(
                                      pipelineId,
                                      variableNodeId,
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
                                  onChange={(e) =>
                                    setCell(pipelineId, variableNodeId, i, c.name, e.target.value)
                                  }
                                />
                              )}
                            </td>
                          );
                        })}
                        <td>
                          <button
                            className="ghost"
                            title="Delete row"
                            onClick={() => removeRow(pipelineId, variableNodeId, i)}
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
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                placeholder="new column name"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitColumn();
                }}
                style={{ flex: 1, minWidth: 160 }}
              />
              <select
                value={newColKind}
                onChange={(e) => setNewColKind(e.target.value as IteratorColumn['kind'])}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="variable" disabled={kvVariables.length === 0}>
                  variable (kv lookup)
                </option>
              </select>
              <button disabled={!newColName.trim()} onClick={commitColumn}>
                + column
              </button>
              <button disabled={schema.length === 0} onClick={() => addRow(pipelineId, variableNodeId)}>
                + row
              </button>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Column header editor (with kind dropdown that includes the 'variable' option)
// ---------------------------------------------------------------------------
function ColumnHeaderEditor({
  column,
  variableNodeId,
  kvVariables,
}: {
  column: IteratorColumn;
  variableNodeId: string;
  kvVariables: Array<{ id: string; data: VariableNodeData }>;
}) {
  const renameColumn = useStore((s) => s.renameIteratorColumn);
  const setKind = useStore((s) => s.setIteratorColumnKind);
  const setRef = useStore((s) => s.setIteratorColumnVariableRef);
  const removeColumn = useStore((s) => s.removeIteratorColumn);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <input
        defaultValue={column.name}
        onBlur={(e) =>
          e.target.value !== column.name &&
          renameColumn(variableNodeId, column.name, e.target.value)
        }
        style={{ fontWeight: 600 }}
      />
      <select
        value={column.kind}
        onChange={(e) =>
          setKind(variableNodeId, column.name, e.target.value as IteratorColumn['kind'])
        }
      >
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="variable" disabled={kvVariables.length === 0}>
          variable (kv lookup)
        </option>
      </select>
      {column.kind === 'variable' && (
        <select
          value={column.variableRef ?? ''}
          onChange={(e) => setRef(variableNodeId, column.name, e.target.value)}
          title="Which kv variable this column draws keys from"
        >
          <option value="">- pick kv variable -</option>
          {kvVariables.map((v) => (
            <option key={v.id} value={v.id}>
              ${(v.data as VariableNodeData).varName}
            </option>
          ))}
        </select>
      )}
      <button
        className="ghost"
        title={`Remove column "${column.name}"`}
        onClick={() => removeColumn(variableNodeId, column.name)}
        style={{ fontSize: 10 }}
      >
        ✕ remove
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell editor for a kv-kind column — a dropdown of the kv variable's keys.
// ---------------------------------------------------------------------------
function KvKeyDropdown({
  pipelineId,
  variableRef,
  value,
  onChange,
}: {
  pipelineId: string;
  variableRef: string | undefined;
  value: string | number | boolean | null | undefined;
  onChange: (key: string) => void;
}) {
  const pipeline = useStore((s) => s.pipelines.find((p) => p.id === pipelineId));
  const kvNode = pipeline?.nodes.find((n) => n.id === variableRef);
  const map: VariableKvValue | null =
    kvNode &&
    kvNode.type === 'gstVariable' &&
    (kvNode.data as VariableNodeData).valueKind === 'kv' &&
    (kvNode.data as VariableNodeData).value &&
    typeof (kvNode.data as VariableNodeData).value === 'object' &&
    !Array.isArray((kvNode.data as VariableNodeData).value)
      ? ((kvNode.data as VariableNodeData).value as VariableKvValue)
      : null;
  if (!map) {
    return <span className="muted" style={{ fontSize: 10 }}>no kv ref</span>;
  }
  const keys = Object.keys(map);
  return (
    <select value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)}>
      <option value="">- pick -</option>
      {keys.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// KV editor modal body — a simple key=value table with add/remove rows.
// ---------------------------------------------------------------------------
function KvEditorContent({
  pipelineId,
  variableNodeId,
  data,
  renameVariable,
  onClose,
}: {
  pipelineId: string;
  variableNodeId: string;
  data: VariableNodeData;
  renameVariable: (id: string, label: string) => void;
  onClose: () => void;
}) {
  const setEntry = useStore((s) => s.setKvEntryIn);
  const removeEntry = useStore((s) => s.removeKvEntryIn);
  const renameKey = useStore((s) => s.renameKvKey);

  const map: VariableKvValue =
    data.value && typeof data.value === 'object' && !Array.isArray(data.value)
      ? (data.value as VariableKvValue)
      : {};
  const keys = Object.keys(map);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  function commitEntry() {
    if (!newKey.trim()) return;
    setEntry(pipelineId, variableNodeId, newKey.trim(), newValue);
    setNewKey('');
    setNewValue('');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal iterator-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            Key-value lookup&nbsp;<code>${data.varName}</code>
            <span className="muted" style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>
              {keys.length} entr{keys.length === 1 ? 'y' : 'ies'}
            </span>
          </h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body iterator-modal-body">
          <div className="iter-modal-section">
            <div className="iter-modal-section-head">Label</div>
            <input
              placeholder="Display name (e.g. RTMP Endpoints)"
              value={data.label ?? ''}
              onChange={(e) => renameVariable(variableNodeId, e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div className="iter-modal-section">
            <div className="iter-modal-section-head">Entries</div>
            {keys.length === 0 ? (
              <div className="muted" style={{ padding: '8px 0' }}>
                No entries yet. Each entry is a name → string mapping (for example
                <code> youtube → rtmp://a.rtmp.youtube.com/live2/</code>). Iterator
                columns referencing this kv pick from these keys per row.
              </div>
            ) : (
              <div className="iter-table-wrap">
                <table className="iter-table">
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>key</th>
                      <th>value</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k}>
                        <td>
                          <input
                            defaultValue={k}
                            onBlur={(e) =>
                              e.target.value !== k && renameKey(variableNodeId, k, e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            value={map[k]}
                            onChange={(e) =>
                              setEntry(pipelineId, variableNodeId, k, e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="ghost"
                            title={`Remove "${k}"`}
                            onClick={() => removeEntry(pipelineId, variableNodeId, k)}
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
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                placeholder="new key (e.g. youtube)"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEntry();
                }}
                style={{ width: 200 }}
              />
              <input
                placeholder="value (e.g. rtmp://a.rtmp.youtube.com/live2/)"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEntry();
                }}
                style={{ flex: 1, minWidth: 240 }}
              />
              <button disabled={!newKey.trim()} onClick={commitEntry}>
                + entry
              </button>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
