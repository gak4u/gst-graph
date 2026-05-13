import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStore } from '../state/store';
import type { IteratorRow, VariableNodeData } from '@shared/types';
import { IteratorModal } from './IteratorModal';

export const VariableNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as unknown as VariableNodeData;
  const updateVariableLabel = useStore((s) => s.updateVariableLabel);
  const updateVariableValue = useStore((s) => s.updateVariableValue);
  const updateVariableKind = useStore((s) => s.updateVariableKind);
  const toggleVariableHidden = useStore((s) => s.toggleVariableHidden);
  const activePipelineId = useStore((s) => s.activePipelineId);
  const [modalOpen, setModalOpen] = useState(false);

  const isList = d.valueKind === 'list';
  const isRecord = d.valueKind === 'record-list';
  const isKv = d.valueKind === 'kv';
  const isIterator = isList || isRecord || isKv;

  return (
    <div className={`var-node ${selected ? 'selected' : ''} ${d.hidden ? 'hidden' : ''}`}>
      <div className="var-node-header">
        <span className="var-badge">{d.hidden ? 'CONST' : isIterator ? 'ITER' : 'VAR'}</span>
        <div className="var-name-block">
          <input
            className="var-label-input"
            placeholder={d.hidden ? 'Internal constant' : 'Label (e.g. Stream key)'}
            value={d.label ?? ''}
            spellCheck={false}
            onChange={(e) => updateVariableLabel(id, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="var-name-display" title="Variable identifier">
            ${d.varName}
          </span>
        </div>
        <button
          className={`var-hide-toggle ${d.hidden ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleVariableHidden(id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title={d.hidden ? 'Hidden from home screen (click to expose)' : 'Visible on home screen (click to hide)'}
        >
          {d.hidden ? 'hidden' : 'shown'}
        </button>
      </div>
      <div className="var-node-body">
        <div className="var-node-kind-row">
          <span className="var-node-kind-label">type</span>
          <div className="var-node-kind-pills">
            {(['string', 'number', 'boolean', 'list', 'record-list', 'kv'] as const).map((k) => (
              <button
                key={k}
                className={`var-node-kind-pill ${d.valueKind === k ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  updateVariableKind(id, k);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title={`Set variable type to ${k}`}
              >
                {k === 'string'
                  ? 'str'
                  : k === 'number'
                    ? 'num'
                    : k === 'boolean'
                      ? 'bool'
                      : k === 'list'
                        ? 'list'
                        : k === 'record-list'
                          ? 'rows'
                          : 'kv'}
              </button>
            ))}
          </div>
        </div>
        {/* Scalar value editors for str/num/bool; iterator kinds get a summary + open-modal button.
            Falling back to String(d.value) for an array/object value was producing
            "[object Object],..." in the input field. */}
        {d.valueKind === 'boolean' ? (
          <label className="var-bool">
            <input
              type="checkbox"
              checked={d.value === true || d.value === 'true'}
              onChange={(e) => updateVariableValue(id, e.target.checked)}
            />
            <span>{d.value === true || d.value === 'true' ? 'true' : 'false'}</span>
          </label>
        ) : d.valueKind === 'number' ? (
          <input
            className="var-value-input"
            type="number"
            placeholder="value"
            value={typeof d.value === 'number' ? d.value : d.value == null ? '' : String(d.value)}
            onChange={(e) =>
              updateVariableValue(id, e.target.value === '' ? null : Number(e.target.value))
            }
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : isList ? (
          <div className="var-iter-summary">
            <span className="muted">
              {Array.isArray(d.value) ? `${(d.value as unknown[]).length} item${(d.value as unknown[]).length === 1 ? '' : 's'}` : 'no items'}
            </span>
            <button
              className="var-configure-btn"
              onClick={(e) => {
                e.stopPropagation();
                setModalOpen(true);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              Configure…
            </button>
          </div>
        ) : isRecord ? (
          <div className="var-iter-summary">
            <span className="muted">
              {(d.schema || []).length} col{(d.schema || []).length === 1 ? '' : 's'} ·{' '}
              {Array.isArray(d.value) ? (d.value as IteratorRow[]).length : 0} row
              {Array.isArray(d.value) && (d.value as IteratorRow[]).length === 1 ? '' : 's'}
            </span>
            <button
              className="var-configure-btn"
              onClick={(e) => {
                e.stopPropagation();
                setModalOpen(true);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              Configure…
            </button>
          </div>
        ) : isKv ? (
          <div className="var-iter-summary">
            <span className="muted">
              {d.value && typeof d.value === 'object' && !Array.isArray(d.value)
                ? Object.keys(d.value as Record<string, string>).length
                : 0}{' '}
              entries
            </span>
            <button
              className="var-configure-btn"
              onClick={(e) => {
                e.stopPropagation();
                setModalOpen(true);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              Configure…
            </button>
          </div>
        ) : (
          <input
            className="var-value-input"
            type="text"
            placeholder="value"
            value={d.value == null ? '' : String(d.value)}
            onChange={(e) => updateVariableValue(id, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        className="var-handle"
        style={{ right: -6, top: '50%', transform: 'translate(0, -50%)' }}
      />
      {modalOpen && activePipelineId && (
        <IteratorModal
          pipelineId={activePipelineId}
          variableNodeId={id}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
});

VariableNode.displayName = 'VariableNode';
