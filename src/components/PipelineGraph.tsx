import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
  useReactFlow,
} from '@xyflow/react';
import { useStore } from '../state/store';
import { ElementNode } from './ElementNode';
import { VariableNode } from './VariableNode';
import { TransformNode } from './TransformNode';
import { capsCompatible } from '../lib/caps';

const nodeTypes = {
  gstElement: ElementNode,
  gstVariable: VariableNode,
  gstTransform: TransformNode,
};

function GraphInner() {
  const activeId = useStore((s) => s.activePipelineId);
  const pipeline = useStore((s) => s.pipelines.find((p) => p.id === activeId));
  const details = useStore((s) => s.details);
  const ensureDetail = useStore((s) => s.ensureDetail);
  const elements = useStore((s) => s.elements);
  const updatePipeline = useStore((s) => s.updatePipeline);
  const selectNode = useStore((s) => s.selectNode);
  const addNodeFromElement = useStore((s) => s.addNodeFromElement);
  const inferVariableForBinding = useStore((s) => s.inferVariableForBinding);
  const toast = useStore((s) => s.toast);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();

  useEffect(() => {
    if (!pipeline) return;
    const names = new Set(
      pipeline.nodes
        .filter((n) => n.type === 'gstElement')
        .map((n) => (n.data as { elementName: string }).elementName),
    );
    names.forEach((n) => {
      if (!details[n]) ensureDetail(n);
    });
  }, [pipeline, details, ensureDetail]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!pipeline) return;
      updatePipeline(pipeline.id, (p) => {
        p.nodes = applyNodeChanges(changes, p.nodes as unknown as Node[]) as unknown as typeof p.nodes;
      });
      for (const c of changes) {
        if (c.type === 'select' && c.selected) {
          selectNode(c.id);
        }
        if (c.type === 'remove') {
          if (useStore.getState().selectedNodeId === c.id) selectNode(null);
        }
      }
    },
    [pipeline, updatePipeline, selectNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!pipeline) return;
      updatePipeline(pipeline.id, (p) => {
        p.edges = applyEdgeChanges(changes, p.edges as Edge[]) as typeof p.edges;
      });
    },
    [pipeline, updatePipeline],
  );

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return false;
      if (conn.source === conn.target) return false;
      const srcNode = pipeline?.nodes.find((n) => n.id === conn.source);
      const tgtNode = pipeline?.nodes.find((n) => n.id === conn.target);
      if (!srcNode || !tgtNode) return false;

      const isValueOut =
        (srcNode.type === 'gstVariable' || srcNode.type === 'gstTransform') &&
        conn.sourceHandle === 'out';
      const isPropTarget = conn.targetHandle.startsWith('prop:');
      const isInputTarget = conn.targetHandle.startsWith('in:');
      if (isValueOut && isPropTarget && tgtNode.type === 'gstElement') return true;
      if (isValueOut && isInputTarget && tgtNode.type === 'gstTransform') return true;
      if (isValueOut || isPropTarget || isInputTarget) return false;
      if (srcNode.type !== 'gstElement' || tgtNode.type !== 'gstElement') return false;

      const srcDetail = details[srcNode.data.elementName];
      const tgtDetail = details[tgtNode.data.elementName];
      if (!srcDetail || !tgtDetail) return true;
      const srcPadName = conn.sourceHandle.replace(/^src:/, '');
      const tgtPadName = conn.targetHandle.replace(/^sink:/, '');
      const srcPad = srcDetail.padTemplates.find((p) => p.direction === 'src' && p.name === srcPadName);
      const tgtPad = tgtDetail.padTemplates.find((p) => p.direction === 'sink' && p.name === tgtPadName);
      if (!srcPad || !tgtPad) return false;
      return capsCompatible(srcPad, tgtPad);
    },
    [pipeline, details],
  );

  const onConnect: OnConnect = useCallback(
    (conn) => {
      if (!pipeline) return;
      if (!isValidConnection(conn)) {
        toast('Incompatible connection refused', 'err');
        return;
      }
      const id = `e_${Math.random().toString(36).slice(2, 10)}`;
      const isBinding =
        conn.sourceHandle === 'out' && conn.targetHandle?.startsWith('prop:');
      const isValueWire =
        conn.sourceHandle === 'out' && conn.targetHandle?.startsWith('in:');
      const targetProp = isBinding
        ? conn.targetHandle!.replace(/^prop:/, '')
        : undefined;
      const targetInputId = isValueWire ? conn.targetHandle!.slice(3) : undefined;
      updatePipeline(pipeline.id, (p) => {
        let edges = p.edges;
        if (isBinding && targetProp) {
          edges = edges.filter(
            (e) => !(e.target === conn.target && e.data?.bindingProperty === targetProp),
          );
        }
        if (isValueWire && targetInputId) {
          edges = edges.filter(
            (e) => !(e.target === conn.target && e.data?.transformInputId === targetInputId),
          );
        }
        const edgeData = isBinding
          ? { edgeKind: 'binding' as const, bindingProperty: targetProp }
          : isValueWire
            ? { edgeKind: 'value' as const, transformInputId: targetInputId }
            : {
                edgeKind: 'stream' as const,
                sourcePad: conn.sourceHandle!.replace(/^src:/, ''),
                targetPad: conn.targetHandle!.replace(/^sink:/, ''),
              };
        p.edges = [
          ...edges,
          {
            id,
            source: conn.source!,
            target: conn.target!,
            sourceHandle: conn.sourceHandle!,
            targetHandle: conn.targetHandle!,
            data: edgeData,
            ...(isBinding || isValueWire
              ? { className: 'binding', animated: true }
              : {}),
          },
        ];
      });
      if (isBinding && targetProp) {
        inferVariableForBinding(conn.source!, conn.target!, targetProp);
      }
    },
    [pipeline, updatePipeline, isValidConnection, toast, inferVariableForBinding],
  );

  const onDrop = useCallback(
    (evt: React.DragEvent) => {
      evt.preventDefault();
      const elementName = evt.dataTransfer.getData('application/gst-element');
      if (!elementName) return;
      const el = elements.find((e) => e.name === elementName);
      if (!el) return;
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const position = rf.screenToFlowPosition({
        x: evt.clientX - (bounds?.left || 0),
        y: evt.clientY - (bounds?.top || 0),
      });
      addNodeFromElement(el, position);
    },
    [elements, addNodeFromElement, rf],
  );

  const nodes = useMemo<Node[]>(() => (pipeline?.nodes as unknown as Node[]) || [], [pipeline]);
  const edges = useMemo<Edge[]>(() => (pipeline?.edges as unknown as Edge[]) || [], [pipeline]);

  if (!pipeline) return <div className="empty-state">No pipeline selected.</div>;

  return (
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '100%' }}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="#2c303a" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#2a2e38" maskColor="rgba(10,12,16,0.6)" />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="empty-state">Drag elements from the left palette to build a pipeline.</div>
      )}
    </div>
  );
}

export function PipelineGraph() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
