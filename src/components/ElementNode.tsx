import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStore } from '../state/store';
import type { GstPadTemplate, PipelineNodeData } from '@shared/types';

interface NodeDataRender extends PipelineNodeData {
  __detail?: never;
}

function isPlaceholder(name: string): boolean {
  return /%/.test(name);
}

// Pads referenced by edges that touch this node but aren't in the static template list
// (e.g. tee's `src_%u` template instantiated as `src_0`, `src_1`, `src_2`). Render a
// handle for each one so xyflow can anchor the edge — otherwise the edge appears with
// no terminator and looks like a missing connector.
function buildEffectivePads(
  templates: GstPadTemplate[],
  direction: 'src' | 'sink',
  referencedPads: Set<string>,
): GstPadTemplate[] {
  const fromTemplates = templates.filter((p) => p.direction === direction);
  const known = new Set(fromTemplates.map((p) => p.name));
  const extras: GstPadTemplate[] = [];
  for (const name of referencedPads) {
    if (known.has(name)) continue;
    if (isPlaceholder(name)) continue;
    extras.push({
      name,
      direction,
      availability: 'request',
      caps: [],
      capsRaw: '',
    });
  }
  return [...fromTemplates, ...extras];
}

export const ElementNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as unknown as NodeDataRender;
  const detail = useStore((s) => s.details[d.elementName]);
  const toggleBindings = useStore((s) => s.toggleNodeBindings);
  const bindings = useStore((s) => {
    const pl = s.pipelines.find((p) => p.id === s.activePipelineId);
    if (!pl) return new Set<string>();
    const set = new Set<string>();
    for (const e of pl.edges) {
      if (e.target === id && e.data?.bindingProperty) set.add(e.data.bindingProperty);
    }
    return set;
  });

  const { referencedSrcPads, referencedSinkPads } = useStore((s) => {
    const pl = s.pipelines.find((p) => p.id === s.activePipelineId);
    const srcSet = new Set<string>();
    const sinkSet = new Set<string>();
    if (!pl) return { referencedSrcPads: srcSet, referencedSinkPads: sinkSet };
    for (const e of pl.edges) {
      if (e.source === id && e.sourceHandle?.startsWith('src:')) {
        srcSet.add(e.sourceHandle.slice(4));
      }
      if (e.target === id && e.targetHandle?.startsWith('sink:')) {
        sinkSet.add(e.targetHandle.slice(5));
      }
    }
    return { referencedSrcPads: srcSet, referencedSinkPads: sinkSet };
  });

  const padTemplates = detail?.padTemplates || [];
  const sinks = useMemo(
    () => buildEffectivePads(padTemplates, 'sink', referencedSinkPads),
    [padTemplates, referencedSinkPads],
  );
  const srcs = useMemo(
    () => buildEffectivePads(padTemplates, 'src', referencedSrcPads),
    [padTemplates, referencedSrcPads],
  );
  const writableProps = useMemo(
    () => (detail?.properties || []).filter((p) => p.writable && p.name !== 'parent' && p.kind !== 'object'),
    [detail],
  );
  const showBindings = !!d.showBindings;
  const visibleBindProps = showBindings
    ? writableProps
    : writableProps.filter((p) => bindings.has(p.name));

  return (
    <div className={`elem-node ${selected ? 'selected' : ''}`}>
      <div className="elem-node-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="nm" style={{ flex: 1 }}>{d.elementName}</span>
          <button
            className="bind-toggle"
            title={showBindings ? 'Hide property bindings' : 'Show property bindings'}
            onClick={(e) => {
              e.stopPropagation();
              toggleBindings(id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {showBindings ? '◂' : '▸'}
          </button>
        </div>
        <span className="iname">{d.instanceName}</span>
      </div>
      <div className="elem-node-body">
        <div className="elem-node-pads sink">
          {sinks.length === 0 && <div className="elem-node-pads empty">no sink</div>}
          {sinks.map((p) => (
            <div key={p.name} className={`elem-node-pad ${p.availability}`}>
              <Handle
                type="target"
                id={`sink:${p.name}`}
                position={Position.Left}
                className={`sink-handle ${p.availability !== 'always' ? 'dashed' : ''}`}
                style={{ left: -6, top: '50%', transform: 'translate(0, -50%)' }}
                isConnectable
              />
              <span className="pad-name">{p.name}</span>
            </div>
          ))}
        </div>
        <div className="elem-node-pads src">
          {srcs.length === 0 && <div className="elem-node-pads empty">no src</div>}
          {srcs.map((p) => (
            <div key={p.name} className={`elem-node-pad ${p.availability}`}>
              <span className="pad-name">{p.name}</span>
              <Handle
                type="source"
                id={`src:${p.name}`}
                position={Position.Right}
                className={`src-handle ${p.availability !== 'always' ? 'dashed' : ''}`}
                style={{ right: -6, top: '50%', transform: 'translate(0, -50%)' }}
                isConnectable
              />
            </div>
          ))}
        </div>
      </div>
      {visibleBindProps.length > 0 && (
        <div className="elem-node-bindings">
          <div className="elem-node-bindings-title">
            properties{!showBindings && ` · ${bindings.size} bound`}
          </div>
          {visibleBindProps.map((p) => (
            <div
              key={p.name}
              className={`elem-node-bind-row ${bindings.has(p.name) ? 'bound' : ''}`}
            >
              <Handle
                type="target"
                id={`prop:${p.name}`}
                position={Position.Left}
                className="prop-handle"
                style={{ left: -6, top: '50%', transform: 'translate(0, -50%)' }}
                isConnectable
              />
              <span className="bind-name">{p.name}</span>
              <span className="bind-kind">{p.typeName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

ElementNode.displayName = 'ElementNode';
