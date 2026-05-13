import type {
  GroupBoundaryPad,
  GroupDef,
  GroupParameter,
  IteratorColumn,
  IteratorRow,
  PipelineDef,
  PipelineGraphNode,
  PipelineNodeData,
  TransformInput,
  TransformKind,
  TransformNodeData,
  VariableKvValue,
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

// ===========================================================================
// Loop groups, iterators (record-list), kv variables
// ===========================================================================

/** Boundary pads inferred from edges crossing a member set, mirroring the
 *  computeGroupBoundary helper in src/state/store.ts. Skips binding/value edges. */
function computeBoundaryFromEdges(
  pipeline: PipelineDef,
  memberSet: Set<string>,
): GroupBoundaryPad[] {
  const boundary: GroupBoundaryPad[] = [];
  const seen = new Set<string>();
  const isStream = (e: PipelineDef['edges'][number]) =>
    !!e.sourceHandle &&
    !!e.targetHandle &&
    e.sourceHandle.startsWith('src:') &&
    e.targetHandle.startsWith('sink:') &&
    e.data?.edgeKind !== 'binding' &&
    e.data?.edgeKind !== 'value';
  for (const e of pipeline.edges) {
    if (!isStream(e)) continue;
    const srcInside = memberSet.has(e.source);
    const tgtInside = memberSet.has(e.target);
    if (srcInside === tgtInside) continue;
    if (tgtInside) {
      const padName = e.targetHandle.startsWith('sink:') ? e.targetHandle.slice(5) : 'sink';
      const handleId = `sink:${e.target}_${padName}`;
      if (seen.has(handleId)) continue;
      seen.add(handleId);
      boundary.push({
        handleId,
        direction: 'sink',
        memberNodeId: e.target,
        memberPadName: padName,
      });
    } else {
      const padName = e.sourceHandle.startsWith('src:') ? e.sourceHandle.slice(4) : 'src';
      const handleId = `src:${e.source}_${padName}`;
      if (seen.has(handleId)) continue;
      seen.add(handleId);
      boundary.push({
        handleId,
        direction: 'src',
        memberNodeId: e.source,
        memberPadName: padName,
      });
    }
  }
  return boundary;
}

export function createGroup(
  pipeline: PipelineDef,
  args: {
    memberNodeIds: string[];
    name?: string;
    iteratorVarId?: string;
    position?: { x: number; y: number };
  },
): { groupId: string; boundary: GroupBoundaryPad[] } | { error: string } {
  if (args.memberNodeIds.length === 0) return { error: 'memberNodeIds is empty' };
  for (const mid of args.memberNodeIds) {
    const n = pipeline.nodes.find((x) => x.id === mid);
    if (!n) return { error: `Member node ${mid} not found` };
    if (n.type === 'gstGroup') return { error: 'Nested groups are not supported' };
  }
  // No node may already belong to another group
  for (const g of pipeline.groups || []) {
    for (const m of g.memberNodeIds) {
      if (args.memberNodeIds.includes(m)) {
        return { error: `Node ${m} is already in group ${g.id}` };
      }
    }
  }
  const memberSet = new Set(args.memberNodeIds);
  const boundary = computeBoundaryFromEdges(pipeline, memberSet);
  const groupId = rid('g');
  const container: PipelineGraphNode = {
    id: groupId,
    type: 'gstGroup',
    position: args.position || { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
    data: { groupId },
  };
  const group: GroupDef = {
    id: groupId,
    name: args.name || 'Loop',
    memberNodeIds: [...args.memberNodeIds],
    iteratorVarId: args.iteratorVarId || '',
    parameters: [],
    boundary,
  };
  pipeline.nodes.push(container);
  pipeline.groups = [...(pipeline.groups || []), group];
  // Reroute outside↔member edges to point at the container's boundary handles
  pipeline.edges = pipeline.edges.map((e) => {
    const srcInside = memberSet.has(e.source);
    const tgtInside = memberSet.has(e.target);
    if (srcInside && tgtInside) return e;
    if (!srcInside && !tgtInside) return e;
    if (tgtInside) {
      const b = boundary.find(
        (bd) =>
          bd.direction === 'sink' &&
          bd.memberNodeId === e.target &&
          `sink:${bd.memberPadName}` === e.targetHandle,
      );
      if (!b) return e;
      return { ...e, target: groupId, targetHandle: b.handleId };
    }
    const b = boundary.find(
      (bd) =>
        bd.direction === 'src' &&
        bd.memberNodeId === e.source &&
        `src:${bd.memberPadName}` === e.sourceHandle,
    );
    if (!b) return e;
    return { ...e, source: groupId, sourceHandle: b.handleId };
  });
  return { groupId, boundary };
}

export function ungroupGroup(pipeline: PipelineDef, groupId: string): boolean {
  const group = (pipeline.groups || []).find((g) => g.id === groupId);
  if (!group) return false;
  pipeline.edges = pipeline.edges
    .map((e) => {
      if (e.source === groupId) {
        const b = group.boundary.find(
          (bd) => bd.direction === 'src' && bd.handleId === e.sourceHandle,
        );
        if (!b) return null;
        return { ...e, source: b.memberNodeId, sourceHandle: `src:${b.memberPadName}` };
      }
      if (e.target === groupId) {
        const b = group.boundary.find(
          (bd) => bd.direction === 'sink' && bd.handleId === e.targetHandle,
        );
        if (!b) return null;
        return { ...e, target: b.memberNodeId, targetHandle: `sink:${b.memberPadName}` };
      }
      return e;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  pipeline.nodes = pipeline.nodes.filter((n) => n.id !== groupId);
  pipeline.groups = (pipeline.groups || []).filter((g) => g.id !== groupId);
  return true;
}

function findGroup(pipeline: PipelineDef, groupId: string): GroupDef | null {
  return (pipeline.groups || []).find((g) => g.id === groupId) || null;
}

function mutateGroup(
  pipeline: PipelineDef,
  groupId: string,
  mut: (g: GroupDef) => void,
): boolean {
  if (!pipeline.groups) return false;
  const idx = pipeline.groups.findIndex((g) => g.id === groupId);
  if (idx < 0) return false;
  const copy: GroupDef = {
    ...pipeline.groups[idx],
    memberNodeIds: [...pipeline.groups[idx].memberNodeIds],
    parameters: pipeline.groups[idx].parameters.map((p) => ({ ...p })),
    boundary: pipeline.groups[idx].boundary.map((b) => ({ ...b })),
  };
  mut(copy);
  pipeline.groups[idx] = copy;
  return true;
}

export function setGroupIterator(
  pipeline: PipelineDef,
  groupId: string,
  iteratorVarId: string,
): boolean | { error: string } {
  const group = findGroup(pipeline, groupId);
  if (!group) return false;
  if (iteratorVarId && group.memberNodeIds.includes(iteratorVarId)) {
    return { error: 'Iterator variable must not be a member of this group' };
  }
  return mutateGroup(pipeline, groupId, (g) => {
    g.iteratorVarId = iteratorVarId;
  });
}

export function renameGroup(pipeline: PipelineDef, groupId: string, name: string): boolean {
  return mutateGroup(pipeline, groupId, (g) => {
    g.name = name;
  });
}

export function addGroupParameter(
  pipeline: PipelineDef,
  groupId: string,
  param: GroupParameter,
): boolean {
  return mutateGroup(pipeline, groupId, (g) => {
    const dup = g.parameters.some(
      (p) => p.targetNodeId === param.targetNodeId && p.propertyKey === param.propertyKey,
    );
    if (!dup) g.parameters.push(param);
  });
}

export function removeGroupParameter(
  pipeline: PipelineDef,
  groupId: string,
  targetNodeId: string,
  propertyKey: string,
): boolean {
  return mutateGroup(pipeline, groupId, (g) => {
    g.parameters = g.parameters.filter(
      (p) => !(p.targetNodeId === targetNodeId && p.propertyKey === propertyKey),
    );
  });
}

export function setGroupParameterTemplate(
  pipeline: PipelineDef,
  groupId: string,
  targetNodeId: string,
  propertyKey: string,
  template: string | undefined,
): boolean {
  return mutateGroup(pipeline, groupId, (g) => {
    g.parameters = g.parameters.map((p) =>
      p.targetNodeId === targetNodeId && p.propertyKey === propertyKey
        ? { ...p, template }
        : p,
    );
  });
}

// ---------------------------------------------------------------------------
// Record-list iterator (schema + rows)
// ---------------------------------------------------------------------------

function mutateVariable(
  pipeline: PipelineDef,
  variableRef: string,
  mut: (d: VariableNodeData) => VariableNodeData,
): boolean {
  const node = pipeline.nodes.find(
    (n) =>
      n.type === 'gstVariable' &&
      (n.id === variableRef || (n.data as VariableNodeData).varName === variableRef),
  );
  if (!node || node.type !== 'gstVariable') return false;
  node.data = mut(node.data);
  return true;
}

export function addIteratorColumn(
  pipeline: PipelineDef,
  variableRef: string,
  column: IteratorColumn,
): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const schema = d.schema ? [...d.schema] : [];
    if (schema.some((c) => c.name === column.name)) return d; // no-op on dup
    schema.push({ ...column });
    const rows = (Array.isArray(d.value) ? (d.value as IteratorRow[]) : []).map((r) => ({
      ...r,
      [column.name]: column.kind === 'boolean' ? false : column.kind === 'number' ? 0 : '',
    }));
    return { ...d, valueKind: 'record-list', schema, value: rows };
  });
}

export function removeIteratorColumn(
  pipeline: PipelineDef,
  variableRef: string,
  name: string,
): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const schema = (d.schema || []).filter((c) => c.name !== name);
    const rows = (Array.isArray(d.value) ? (d.value as IteratorRow[]) : []).map((r) => {
      const next = { ...r };
      delete next[name];
      return next;
    });
    return { ...d, schema, value: rows };
  });
}

export function renameIteratorColumn(
  pipeline: PipelineDef,
  variableRef: string,
  oldName: string,
  newName: string,
): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const schema = (d.schema || []).map((c) =>
      c.name === oldName ? { ...c, name: newName } : c,
    );
    const rows = (Array.isArray(d.value) ? (d.value as IteratorRow[]) : []).map((r) => {
      if (!(oldName in r)) return r;
      const next: IteratorRow = { ...r };
      next[newName] = next[oldName];
      delete next[oldName];
      return next;
    });
    return { ...d, schema, value: rows };
  });
}

export function setIteratorColumnKind(
  pipeline: PipelineDef,
  variableRef: string,
  name: string,
  kind: IteratorColumn['kind'],
  variableRefForColumn?: string,
): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const schema = (d.schema || []).map((c) =>
      c.name === name ? { ...c, kind, variableRef: variableRefForColumn } : c,
    );
    return { ...d, schema };
  });
}

export function addIteratorRow(pipeline: PipelineDef, variableRef: string): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const schema = d.schema || [];
    const blank: IteratorRow = {};
    for (const c of schema) {
      blank[c.name] = c.kind === 'boolean' ? false : c.kind === 'number' ? 0 : '';
    }
    const rows = Array.isArray(d.value) ? [...(d.value as IteratorRow[]), blank] : [blank];
    return { ...d, valueKind: 'record-list', value: rows };
  });
}

export function removeIteratorRow(
  pipeline: PipelineDef,
  variableRef: string,
  index: number,
): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const rows = Array.isArray(d.value) ? [...(d.value as IteratorRow[])] : [];
    if (index < 0 || index >= rows.length) return d;
    rows.splice(index, 1);
    return { ...d, value: rows };
  });
}

export function setIteratorCell(
  pipeline: PipelineDef,
  variableRef: string,
  rowIndex: number,
  column: string,
  value: string | number | boolean | null,
): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const rows = Array.isArray(d.value) ? [...(d.value as IteratorRow[])] : [];
    if (rowIndex < 0 || rowIndex >= rows.length) return d;
    rows[rowIndex] = { ...rows[rowIndex], [column]: value };
    return { ...d, value: rows };
  });
}

// ---------------------------------------------------------------------------
// kv variable
// ---------------------------------------------------------------------------

function asKv(d: VariableNodeData): VariableKvValue {
  if (d.value && typeof d.value === 'object' && !Array.isArray(d.value)) {
    return { ...(d.value as VariableKvValue) };
  }
  return {};
}

export function setKvEntry(
  pipeline: PipelineDef,
  variableRef: string,
  key: string,
  value: string,
): boolean {
  if (!key.trim()) return false;
  return mutateVariable(pipeline, variableRef, (d) => {
    const map = asKv(d);
    map[key] = value;
    return { ...d, valueKind: 'kv', value: map };
  });
}

export function removeKvEntry(
  pipeline: PipelineDef,
  variableRef: string,
  key: string,
): boolean {
  return mutateVariable(pipeline, variableRef, (d) => {
    const map = asKv(d);
    delete map[key];
    return { ...d, value: map };
  });
}

export function renameKvKey(
  pipeline: PipelineDef,
  variableRef: string,
  oldKey: string,
  newKey: string,
): boolean {
  if (!newKey.trim() || newKey === oldKey) return false;
  let renamed = false;
  // Rename the entry on the kv variable
  const ok = mutateVariable(pipeline, variableRef, (d) => {
    const map = asKv(d);
    if (!(oldKey in map)) return d;
    map[newKey] = map[oldKey];
    delete map[oldKey];
    renamed = true;
    return { ...d, value: map };
  });
  if (!ok || !renamed) return ok;
  // Cascade-update any record-list iterator rows that referenced the old key in
  // a variable-kind column pointing at this kv.
  const kvNode = pipeline.nodes.find(
    (n) =>
      n.type === 'gstVariable' &&
      (n.id === variableRef || (n.data as VariableNodeData).varName === variableRef),
  );
  if (!kvNode || kvNode.type !== 'gstVariable') return ok;
  const kvId = kvNode.id;
  for (const node of pipeline.nodes) {
    if (node.type !== 'gstVariable') continue;
    const d = node.data as VariableNodeData;
    if (d.valueKind !== 'record-list') continue;
    const schema = d.schema || [];
    const cols = schema.filter((c) => c.kind === 'variable' && c.variableRef === kvId);
    if (cols.length === 0) continue;
    if (!Array.isArray(d.value)) continue;
    const rows = (d.value as IteratorRow[]).map((row) => {
      const next: IteratorRow = { ...row };
      for (const c of cols) if (next[c.name] === oldKey) next[c.name] = newKey;
      return next;
    });
    node.data = { ...d, value: rows } as VariableNodeData;
  }
  return ok;
}

/** Generalized setter that accepts complex shapes for list / record-list / kv variables.
 *  Falls back to the scalar setVariableValue for primitives. */
export function setVariableValueGeneric(
  pipeline: PipelineDef,
  ref: string,
  args: {
    valueKind?: VariableValueKind;
    value?: unknown;
    schema?: IteratorColumn[];
  },
): boolean {
  return mutateVariable(pipeline, ref, (d) => {
    const next: VariableNodeData = { ...d };
    if (args.valueKind) next.valueKind = args.valueKind;
    if (args.schema !== undefined) next.schema = args.schema;
    if (args.value !== undefined) {
      next.value = args.value as VariableNodeData['value'];
    }
    return next;
  });
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
