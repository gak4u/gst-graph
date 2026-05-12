import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStore } from '../state/store';
import type { TransformInput, TransformNodeData } from '@shared/types';

function evalConcatPreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([\w]+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

const MATH_EXPR_RE = /^[\w\s+\-*/%().,]+$/;

function evalMathPreview(expr: string, vars: Record<string, number>): string {
  const trimmed = expr.trim();
  if (!trimmed) return '—';
  if (!MATH_EXPR_RE.test(trimmed)) return 'invalid';
  const keys = Object.keys(vars);
  const vals = keys.map((k) => vars[k]);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, 'Math', `"use strict"; return (${trimmed});`);
    const result = fn(...vals, Math);
    if (typeof result !== 'number' || !Number.isFinite(result)) return 'invalid';
    return String(result);
  } catch {
    return 'invalid';
  }
}

export const TransformNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as unknown as TransformNodeData;
  const pipelineEdges = useStore(
    (s) => s.pipelines.find((p) => p.id === s.activePipelineId)?.edges || [],
  );
  const nodes = useStore(
    (s) => s.pipelines.find((p) => p.id === s.activePipelineId)?.nodes || [],
  );
  const updateTransformLabel = useStore((s) => s.updateTransformLabel);
  const updateTransformExpression = useStore((s) => s.updateTransformExpression);
  const addTransformInput = useStore((s) => s.addTransformInput);
  const renameTransformInput = useStore((s) => s.renameTransformInput);
  const removeTransformInput = useStore((s) => s.removeTransformInput);

  const inputResolved = useMemo(() => {
    const map = new Map<string, string | number | null>();
    for (const inp of d.inputs) {
      const edge = pipelineEdges.find(
        (e) =>
          e.target === id &&
          (e.data?.transformInputId === inp.id || e.targetHandle === `in:${inp.id}`),
      );
      if (!edge) {
        map.set(inp.id, null);
        continue;
      }
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) {
        map.set(inp.id, null);
        continue;
      }
      if (src.type === 'gstVariable') {
        const v = src.data as { value: string | number | boolean | null };
        if (v.value === null || v.value === undefined || v.value === '') map.set(inp.id, null);
        else if (typeof v.value === 'boolean') map.set(inp.id, v.value ? 'true' : 'false');
        else map.set(inp.id, v.value);
      } else if (src.type === 'gstTransform') {
        map.set(inp.id, '(computed)');
      } else {
        map.set(inp.id, null);
      }
    }
    return map;
  }, [d.inputs, pipelineEdges, nodes, id]);

  const preview = useMemo(() => {
    if (d.kind === 'concat') {
      const vars: Record<string, string> = {};
      for (const inp of d.inputs) {
        const v = inputResolved.get(inp.id);
        vars[inp.name] = v === null || v === undefined ? '' : String(v);
      }
      return evalConcatPreview(d.expression || '', vars);
    }
    const vars: Record<string, number> = {};
    let missing = false;
    for (const inp of d.inputs) {
      const v = inputResolved.get(inp.id);
      if (v === null || v === undefined) {
        missing = true;
        break;
      }
      const num = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(num)) {
        missing = true;
        break;
      }
      vars[inp.name] = num;
    }
    if (missing) return '—';
    return evalMathPreview(d.expression || '', vars);
  }, [d.expression, d.inputs, d.kind, inputResolved]);

  const isConcat = d.kind === 'concat';
  const badge = isConcat ? 'CONCAT' : 'MATH';
  const headerColor = isConcat ? 'concat' : 'math';

  return (
    <div className={`transform-node ${selected ? 'selected' : ''} ${headerColor}`}>
      <div className="transform-header">
        <span className="transform-badge">{badge}</span>
        <input
          className="transform-label"
          placeholder="Label"
          value={d.label ?? ''}
          onChange={(e) => updateTransformLabel(id, e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="transform-inputs">
        {d.inputs.map((inp: TransformInput) => {
          const val = inputResolved.get(inp.id);
          return (
            <div key={inp.id} className="transform-input-row">
              <Handle
                type="target"
                id={`in:${inp.id}`}
                position={Position.Left}
                className="transform-in-handle"
                style={{ left: -6, top: '50%', transform: 'translate(0, -50%)' }}
              />
              <input
                className="transform-input-name"
                value={inp.name}
                onChange={(e) => renameTransformInput(id, inp.id, e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                title="Input variable name (used in expression)"
              />
              <span className={`transform-input-val ${val === null ? 'unbound' : ''}`}>
                {val === null ? 'unbound' : String(val)}
              </span>
              {d.inputs.length > 1 && (
                <button
                  className="transform-input-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTransformInput(id, inp.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Remove input"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          className="transform-add-input"
          onClick={(e) => {
            e.stopPropagation();
            addTransformInput(id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          + input
        </button>
      </div>
      <div className="transform-expression">
        <div className="transform-expression-label">
          {isConcat ? 'Template' : 'Expression'}
        </div>
        {isConcat ? (
          <textarea
            className="transform-expression-input"
            placeholder={'e.g. rtmp://server/${a}'}
            value={d.expression}
            spellCheck={false}
            onChange={(e) => updateTransformExpression(id, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            rows={2}
          />
        ) : (
          <input
            className="transform-expression-input"
            placeholder={'e.g. a * b + 1000'}
            value={d.expression}
            spellCheck={false}
            onChange={(e) => updateTransformExpression(id, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div className="transform-preview">
        <span className="transform-preview-label">=</span>
        <code className="transform-preview-value" title={preview}>
          {preview === '' ? '∅' : preview}
        </code>
      </div>
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        className="transform-out-handle"
        style={{ right: -6, top: 24, transform: 'translate(0, 0)' }}
      />
    </div>
  );
});

TransformNode.displayName = 'TransformNode';
