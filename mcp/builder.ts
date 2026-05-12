import type {
  PipelineDef,
  PipelineGraphNode,
  PipelineNodeData,
  TransformInput,
  TransformKind,
  TransformNodeData,
  VariableNodeData,
  VariableValueKind,
} from '../shared/types';

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newPipelineDef(name: string): PipelineDef {
  return { id: rid('pl'), name, nodes: [], edges: [] };
}

export function addElementNode(
  pipeline: PipelineDef,
  args: {
    elementName: string;
    instanceName?: string;
    properties?: Record<string, string | number | boolean | null>;
    position?: { x: number; y: number };
  },
): { id: string; instanceName: string } {
  const taken = new Set(
    pipeline.nodes
      .filter((n) => n.type === 'gstElement')
      .map((n) => (n.data as PipelineNodeData).instanceName),
  );
  let instanceName = args.instanceName;
  if (!instanceName) {
    let i = 0;
    do {
      instanceName = `${args.elementName.replace(/[^a-zA-Z0-9_]/g, '_')}${i}`;
      i++;
    } while (taken.has(instanceName));
  }
  const id = rid('n');
  const node: PipelineGraphNode = {
    id,
    type: 'gstElement',
    position: args.position || { x: 80 + Math.random() * 240, y: 80 + Math.random() * 240 },
    data: {
      elementName: args.elementName,
      instanceName,
      properties: args.properties || {},
    },
  };
  pipeline.nodes.push(node);
  return { id, instanceName };
}

export function addVariableNode(
  pipeline: PipelineDef,
  args: {
    varName: string;
    label?: string;
    valueKind: VariableValueKind;
    value?: string | number | boolean | null;
    hidden?: boolean;
    position?: { x: number; y: number };
  },
): { id: string } {
  const id = rid('v');
  const node: PipelineGraphNode = {
    id,
    type: 'gstVariable',
    position: args.position || { x: 60 + Math.random() * 80, y: 60 + Math.random() * 200 },
    data: {
      varName: args.varName.replace(/[^a-zA-Z0-9_]/g, '_'),
      label: args.label,
      valueKind: args.valueKind,
      value: args.value === undefined ? null : args.value,
      hidden: args.hidden,
    },
  };
  pipeline.nodes.push(node);
  return { id };
}

export function addTransformNode(
  pipeline: PipelineDef,
  args: {
    kind: TransformKind;
    label?: string;
    inputs?: { name: string }[];
    expression?: string;
    position?: { x: number; y: number };
  },
): { id: string; inputs: TransformInput[] } {
  const inputs: TransformInput[] =
    args.inputs && args.inputs.length > 0
      ? args.inputs.map((i) => ({ id: rid('i'), name: i.name }))
      : [
          { id: rid('i'), name: 'a' },
          { id: rid('i'), name: 'b' },
        ];
  const expression =
    args.expression ?? (args.kind === 'concat' ? '${a}${b}' : 'a + b');
  const id = rid('t');
  const data: TransformNodeData = {
    kind: args.kind,
    label: args.label,
    inputs,
    expression,
  };
  const node: PipelineGraphNode = {
    id,
    type: 'gstTransform',
    position: args.position || { x: 120 + Math.random() * 240, y: 100 + Math.random() * 240 },
    data,
  };
  pipeline.nodes.push(node);
  return { id, inputs };
}

export function removeNode(pipeline: PipelineDef, nodeId: string): boolean {
  const before = pipeline.nodes.length;
  pipeline.nodes = pipeline.nodes.filter((n) => n.id !== nodeId);
  pipeline.edges = pipeline.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return pipeline.nodes.length < before;
}

export function linkElements(
  pipeline: PipelineDef,
  args: {
    sourceId: string;
    targetId: string;
    sourcePad?: string;
    targetPad?: string;
  },
): { id: string } {
  const sourcePad = args.sourcePad || 'src';
  const targetPad = args.targetPad || 'sink';
  const id = rid('e');
  pipeline.edges.push({
    id,
    source: args.sourceId,
    target: args.targetId,
    sourceHandle: `src:${sourcePad}`,
    targetHandle: `sink:${targetPad}`,
    data: { edgeKind: 'stream', sourcePad, targetPad },
  });
  return { id };
}

export function bindValueToProperty(
  pipeline: PipelineDef,
  args: { sourceId: string; targetId: string; property: string },
): { id: string } {
  pipeline.edges = pipeline.edges.filter(
    (e) => !(e.target === args.targetId && e.data?.bindingProperty === args.property),
  );
  const id = rid('e');
  pipeline.edges.push({
    id,
    source: args.sourceId,
    target: args.targetId,
    sourceHandle: 'out',
    targetHandle: `prop:${args.property}`,
    data: { edgeKind: 'binding', bindingProperty: args.property },
    className: 'binding',
    animated: true,
  });
  return { id };
}

export function wireTransformInput(
  pipeline: PipelineDef,
  args: { sourceId: string; transformId: string; inputId: string },
): { id: string } {
  pipeline.edges = pipeline.edges.filter(
    (e) => !(e.target === args.transformId && e.data?.transformInputId === args.inputId),
  );
  const id = rid('e');
  pipeline.edges.push({
    id,
    source: args.sourceId,
    target: args.transformId,
    sourceHandle: 'out',
    targetHandle: `in:${args.inputId}`,
    data: { edgeKind: 'value', transformInputId: args.inputId },
    className: 'binding',
    animated: true,
  });
  return { id };
}

export function setElementProperty(
  pipeline: PipelineDef,
  nodeId: string,
  property: string,
  value: string | number | boolean | null,
): boolean {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'gstElement') return false;
  const d = node.data;
  d.properties = { ...d.properties, [property]: value };
  return true;
}

export function setVariableValue(
  pipeline: PipelineDef,
  ref: string,
  value: string | number | boolean | null,
): boolean {
  const node = pipeline.nodes.find(
    (n) =>
      n.type === 'gstVariable' &&
      (n.id === ref || (n.data as VariableNodeData).varName === ref),
  );
  if (!node || node.type !== 'gstVariable') return false;
  node.data = { ...node.data, value };
  return true;
}

export function setTransformExpression(
  pipeline: PipelineDef,
  nodeId: string,
  expression: string,
): boolean {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'gstTransform') return false;
  node.data = { ...node.data, expression };
  return true;
}

export function pipelineSummary(p: PipelineDef): {
  id: string;
  name: string;
  elementCount: number;
  variableCount: number;
  transformCount: number;
  edgeCount: number;
  variables: Array<{ id: string; varName: string; label?: string; value: unknown; valueKind: string; hidden?: boolean }>;
} {
  const variables = p.nodes
    .filter((n) => n.type === 'gstVariable')
    .map((n) => {
      const d = n.data as VariableNodeData;
      return {
        id: n.id,
        varName: d.varName,
        label: d.label,
        value: d.value,
        valueKind: d.valueKind,
        hidden: d.hidden,
      };
    });
  return {
    id: p.id,
    name: p.name,
    elementCount: p.nodes.filter((n) => n.type === 'gstElement').length,
    variableCount: variables.length,
    transformCount: p.nodes.filter((n) => n.type === 'gstTransform').length,
    edgeCount: p.edges.length,
    variables,
  };
}
