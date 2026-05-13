import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
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
import { GroupNode } from './GroupNode';
import { capsCompatible } from '../lib/caps';

const nodeTypes = {
  gstElement: ElementNode,
  gstVariable: VariableNode,
  gstTransform: TransformNode,
  gstGroup: GroupNode,
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

  const ungroup = useStore((s) => s.ungroup);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!pipeline) return;
      // Intercept removals of group containers and route them through `ungroup` so the
      // member nodes are surfaced back to the canvas (and their edges restored) rather
      // than orphaned inside pipeline.nodes with no rendering path.
      const remainingChanges: NodeChange[] = [];
      for (const c of changes) {
        if (c.type === 'remove') {
          const node = pipeline.nodes.find((n) => n.id === c.id);
          if (node?.type === 'gstGroup') {
            ungroup(c.id);
            continue;
          }
        }
        remainingChanges.push(c);
      }
      if (remainingChanges.length > 0) {
        updatePipeline(pipeline.id, (p) => {
          p.nodes = applyNodeChanges(remainingChanges, p.nodes as unknown as Node[]) as unknown as typeof p.nodes;
        });
      }
      for (const c of changes) {
        if (c.type === 'select' && c.selected) {
          selectNode(c.id);
        }
        if (c.type === 'remove') {
          if (useStore.getState().selectedNodeId === c.id) selectNode(null);
        }
      }
    },
    [pipeline, updatePipeline, selectNode, ungroup],
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
      // Group containers are allowed on either side. Caps compat is checked against
      // the inner member node's pad (via the boundary mapping) so two groups talking
      // to each other still validates correctly.
      const isElementOrGroup = (t: typeof srcNode.type) => t === 'gstElement' || t === 'gstGroup';
      if (!isElementOrGroup(srcNode.type) || !isElementOrGroup(tgtNode.type)) return false;

      const resolveElementPad = (
        node: typeof srcNode,
        handle: string,
        direction: 'src' | 'sink',
      ): { elementName: string; padName: string } | null => {
        const padPrefix = direction === 'src' ? 'src:' : 'sink:';
        if (node.type === 'gstElement') {
          return {
            elementName: node.data.elementName,
            padName: handle.startsWith(padPrefix) ? handle.slice(padPrefix.length) : '',
          };
        }
        if (node.type === 'gstGroup') {
          const group = pipeline?.groups?.find((g) => g.id === node.data.groupId);
          if (!group) return null;
          const boundary = group.boundary.find(
            (b) => b.handleId === handle && b.direction === direction,
          );
          if (!boundary) return null;
          const member = pipeline?.nodes.find((n) => n.id === boundary.memberNodeId);
          if (!member || member.type !== 'gstElement') return null;
          return { elementName: member.data.elementName, padName: boundary.memberPadName };
        }
        return null;
      };

      const srcResolved = resolveElementPad(srcNode, conn.sourceHandle, 'src');
      const tgtResolved = resolveElementPad(tgtNode, conn.targetHandle, 'sink');
      if (!srcResolved || !tgtResolved) return true; // can't resolve — be permissive
      const srcDetail = details[srcResolved.elementName];
      const tgtDetail = details[tgtResolved.elementName];
      if (!srcDetail || !tgtDetail) return true;
      const srcPad = srcDetail.padTemplates.find(
        (p) => p.direction === 'src' && p.name === srcResolved.padName,
      );
      const tgtPad = tgtDetail.padTemplates.find(
        (p) => p.direction === 'sink' && p.name === tgtResolved.padName,
      );
      if (!srcPad || !tgtPad) return true; // unknown pad name — allow (template-style)
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

  const nodes = useMemo<Node[]>(() => {
    if (!pipeline) return [];
    // Collapsed-only group rendering: hide every member node, the container stands in
    // for the whole prototype on the canvas. Inspector lets the user edit members.
    const memberIds = new Set<string>();
    for (const g of pipeline.groups || []) {
      for (const m of g.memberNodeIds) memberIds.add(m);
    }
    return pipeline.nodes.filter((n) => !memberIds.has(n.id)) as unknown as Node[];
  }, [pipeline]);
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
        // Left-mouse drag on empty canvas = rubber-band select. Middle / right mouse
        // (button 1 / 2) pans, scroll/pinch zooms. Avoids the xyflow Shift+drag
        // ambiguity where the pan handler eats the event before selection sees it.
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
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
