import { memo, useEffect, useLayoutEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useStore } from '../state/store';
import type {
  GroupDef,
  GroupNodeData,
  PipelineNodeData,
  VariableNodeData,
} from '@shared/types';

/** Renders a loopable-group container: a card with the group's name, a "× N" badge
 *  derived from the bound iterator variable's list length, and boundary handles on
 *  the left/right that forward to inner member-node pads on unroll. */
export const GroupNode = memo(({ id, selected }: NodeProps) => {
  const pipeline = useStore((s) => s.pipelines.find((p) => p.id === s.activePipelineId));
  const group: GroupDef | undefined = pipeline?.groups?.find((g) => g.id === id);
  const updateNodeInternals = useUpdateNodeInternals();

  // Tell xyflow to remeasure this node every time the boundary changes. Without this,
  // boundary handles that arrive after the initial mount (hydration, post-edit, or
  // the `add-input-queues` patch script) are registered too late for the edges that
  // point at them — they render as floating lines that don't anchor and new drag
  // connections onto them silently fail. We fire on both `useLayoutEffect` (so it
  // runs before paint, catching the initial mount) and `useEffect` + rAF (so we
  // re-fire after the browser has actually laid the handles out in the DOM).
  const boundaryKey = useMemo(
    () =>
      (group?.boundary || []).map((b) => `${b.direction}:${b.handleId}`).join('|'),
    [group?.boundary],
  );
  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [id, boundaryKey, updateNodeInternals]);
  useEffect(() => {
    const handle = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(handle);
  }, [id, boundaryKey, updateNodeInternals]);

  const iteratorMeta = useMemo(() => {
    if (!group || !pipeline) return { count: 0, label: 'no iterator', warn: true };
    if (!group.iteratorVarId) return { count: 0, label: 'no iterator picked', warn: true };
    const v = pipeline.nodes.find((n) => n.id === group.iteratorVarId);
    if (!v || v.type !== 'gstVariable') {
      return { count: 0, label: 'iterator missing', warn: true };
    }
    const data = v.data as VariableNodeData;
    if (data.valueKind === 'list' && Array.isArray(data.value)) {
      return { count: data.value.length, label: `$${data.varName}`, warn: data.value.length === 0 };
    }
    if (data.valueKind === 'record-list' && Array.isArray(data.value)) {
      const count = data.value.length;
      const cols = (data.schema || []).length;
      return {
        count,
        label: `$${data.varName} · ${cols} col${cols === 1 ? '' : 's'}`,
        warn: count === 0 || cols === 0,
      };
    }
    return { count: 0, label: `iterator $${data.varName} is not a list`, warn: true };
  }, [pipeline, group]);

  const memberPreview = useMemo(() => {
    if (!group || !pipeline) return [] as string[];
    return group.memberNodeIds
      .map((mid) => pipeline.nodes.find((n) => n.id === mid))
      .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'gstElement')
      .map((n) => (n.data as PipelineNodeData).elementName);
  }, [pipeline, group]);

  if (!group) {
    return (
      <div className={`group-node missing ${selected ? 'selected' : ''}`}>
        <span>Group (missing definition)</span>
      </div>
    );
  }

  const sinkBoundary = group.boundary.filter((b) => b.direction === 'sink');
  const srcBoundary = group.boundary.filter((b) => b.direction === 'src');

  return (
    <div className={`group-node ${selected ? 'selected' : ''} ${iteratorMeta.warn ? 'warn' : ''}`}>
      <div className="group-node-head">
        <span className="group-node-name">{group.name}</span>
        <span className={`group-node-badge ${iteratorMeta.warn ? 'warn' : ''}`}>
          × {iteratorMeta.count}
        </span>
      </div>
      <div className="group-node-meta">{iteratorMeta.label}</div>
      {/* React `key` on the body forces unmount + remount of every Handle child when the
          boundary signature changes. xyflow's Handle component registers itself in the
          flow store on mount and de-registers on unmount, so a fresh mount cycle wipes
          any stale handle entry left over from an earlier boundary spec. */}
      <div className="group-node-body" key={boundaryKey}>
        <div className="group-node-pads sink">
          {sinkBoundary.length === 0 && <div className="group-node-pads empty">no sink</div>}
          {sinkBoundary.map((b) => (
            <div key={b.handleId} className="group-node-pad">
              <Handle
                type="target"
                id={b.handleId}
                position={Position.Left}
                className="sink-handle"
                style={{ left: -6, top: '50%', transform: 'translate(0, -50%)' }}
                isConnectable
              />
              <span className="pad-name">{b.memberPadName}</span>
            </div>
          ))}
        </div>
        <div className="group-node-pads src">
          {srcBoundary.length === 0 && <div className="group-node-pads empty">no src</div>}
          {srcBoundary.map((b) => (
            <div key={b.handleId} className="group-node-pad">
              <span className="pad-name">{b.memberPadName}</span>
              <Handle
                type="source"
                id={b.handleId}
                position={Position.Right}
                className="src-handle"
                style={{ right: -6, top: '50%', transform: 'translate(0, -50%)' }}
                isConnectable
              />
            </div>
          ))}
        </div>
      </div>
      <div className="group-node-members">
        {memberPreview.length === 0 && <span className="muted">no members</span>}
        {memberPreview.length > 0 && (
          <span className="muted">{memberPreview.join(' → ')}</span>
        )}
      </div>
    </div>
  );
});

GroupNode.displayName = 'GroupNode';

// Re-export for ergonomics
export type { GroupNodeData };
