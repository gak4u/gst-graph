import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStore } from '../state/store';
import type { VariableNodeData } from '@shared/types';

export const VariableNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as unknown as VariableNodeData;
  const updateVariableLabel = useStore((s) => s.updateVariableLabel);
  const updateVariableValue = useStore((s) => s.updateVariableValue);
  const updateVariableKind = useStore((s) => s.updateVariableKind);
  const toggleVariableHidden = useStore((s) => s.toggleVariableHidden);

  return (
    <div className={`var-node ${selected ? 'selected' : ''} ${d.hidden ? 'hidden' : ''}`}>
      <div className="var-node-header">
        <span className="var-badge">{d.hidden ? 'CONST' : 'VAR'}</span>
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
            {(['string', 'number', 'boolean'] as const).map((k) => (
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
                {k === 'string' ? 'str' : k === 'number' ? 'num' : 'bool'}
              </button>
            ))}
          </div>
        </div>
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
    </div>
  );
});

VariableNode.displayName = 'VariableNode';
