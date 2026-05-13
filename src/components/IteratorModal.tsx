import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import type {
  IteratorColumn,
  IteratorRow,
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

  if (!data) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Iterator</h2>
            <button className="ghost" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">Variable not found.</div>
        </div>
      </div>
    );
  }

  // If the user opened this modal on a non-record-list variable, offer one-click conversion.
  if (data.valueKind !== 'record-list') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Iterator setup</h2>
            <button className="ghost" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <p>
              <code>${data.varName}</code> is currently a <code>{data.valueKind}</code> variable.
              An iterator needs multiple columns + rows.
            </p>
            <button
              className="primary"
              onClick={() => {
                updateVariableKind(variableNodeId, 'record-list');
              }}
            >
              Convert to record-list iterator
            </button>
          </div>
        </div>
      </div>
    );
  }

  const schema: IteratorColumn[] = data.schema || [];
  const rows: IteratorRow[] = Array.isArray(data.value) ? (data.value as IteratorRow[]) : [];

  function commitColumn() {
    if (!newColName.trim()) return;
    addColumn(variableNodeId, newColName, newColKind);
    setNewColName('');
  }

  return (
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
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <input
                              defaultValue={c.name}
                              onBlur={(e) =>
                                e.target.value !== c.name &&
                                renameColumn(variableNodeId, c.name, e.target.value)
                              }
                              style={{ fontWeight: 600 }}
                            />
                            <select
                              value={c.kind}
                              onChange={(e) =>
                                setKind(
                                  variableNodeId,
                                  c.name,
                                  e.target.value as IteratorColumn['kind'],
                                )
                              }
                            >
                              <option value="string">string</option>
                              <option value="number">number</option>
                              <option value="boolean">boolean</option>
                            </select>
                          </div>
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
                              {c.kind === 'boolean' ? (
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
    </div>
  );
}
