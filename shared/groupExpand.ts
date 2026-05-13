// Loop-group unroll pre-pass. Pure function: takes a PipelineDef with groups[] and returns
// a flat PipelineDef where each group's members have been duplicated N times (N = iterator
// variable's list length), parameter properties substituted per iteration, internal edges
// replicated, and boundary edges (outside → group.handle) expanded into N edges that target
// each clone's corresponding pad.

import type {
  GroupBoundaryPad,
  GroupDef,
  PipelineDef,
  PipelineGraphNode,
  PipelineNodeData,
  VariableNodeData,
  VariableListValue,
} from './types';

export class GroupExpansionError extends Error {
  constructor(
    message: string,
    public readonly groupId: string,
  ) {
    super(message);
    this.name = 'GroupExpansionError';
  }
}

type StreamEdge = PipelineDef['edges'][number];

function isListValue(v: unknown): v is VariableListValue {
  return Array.isArray(v);
}

/** Pull the iterator list off the named variable node. Throws GroupExpansionError on
 *  any structural problem so callers can surface it. */
function resolveIteratorList(def: PipelineDef, group: GroupDef): VariableListValue {
  const varNode = def.nodes.find((n) => n.id === group.iteratorVarId);
  if (!varNode) {
    throw new GroupExpansionError(
      `Group "${group.name}" references iterator variable that no longer exists`,
      group.id,
    );
  }
  if (varNode.type !== 'gstVariable') {
    throw new GroupExpansionError(
      `Group "${group.name}" iterator must be a variable node`,
      group.id,
    );
  }
  const data = varNode.data as VariableNodeData;
  if (data.valueKind !== 'list' || !isListValue(data.value)) {
    throw new GroupExpansionError(
      `Group "${group.name}" iterator variable "${data.varName}" must hold a list value`,
      group.id,
    );
  }
  return data.value;
}

/** Suffix an instance name with `_i`, preserving uniqueness across iterations. The cloned
 *  member nodes need fresh element instance names so gst-launch's `name=` flags don't collide. */
function suffixInstance(name: string, i: number): string {
  return `${name}_${i}`;
}

/** Clone a member node into iteration `i`, with a fresh id and (for element nodes) a
 *  suffixed instance name. Parameter values are substituted later. */
function cloneMember(
  node: PipelineGraphNode,
  i: number,
  idMap: Map<string, string>,
): PipelineGraphNode {
  const freshId = `${node.id}__i${i}`;
  idMap.set(node.id, freshId);
  if (node.type === 'gstElement') {
    const d = node.data as PipelineNodeData;
    return {
      ...node,
      id: freshId,
      position: { ...node.position },
      data: {
        ...d,
        instanceName: d.instanceName ? suffixInstance(d.instanceName, i) : d.instanceName,
        properties: { ...(d.properties || {}) },
      },
    };
  }
  if (node.type === 'gstVariable') {
    return {
      ...node,
      id: freshId,
      position: { ...node.position },
      data: { ...node.data, value: (node.data as VariableNodeData).value } as VariableNodeData,
    };
  }
  // gstTransform
  return {
    ...node,
    id: freshId,
    position: { ...node.position },
    data: { ...node.data, inputs: [...node.data.inputs] },
  };
}

/** Convert a primitive list element to the property-value shape PipelineNodeData expects. */
function listElementToProperty(v: string | number | boolean): string | number | boolean {
  return v;
}

interface ExpandedGroupInternals {
  /** Per-iteration map of `original member id → clone id`. Indexed by iteration `i`. */
  idMapPerIter: Map<string, string>[];
  /** Iteration count. */
  count: number;
}

function expandSingleGroup(
  def: PipelineDef,
  group: GroupDef,
  intoNodes: PipelineGraphNode[],
  intoEdges: StreamEdge[],
): ExpandedGroupInternals {
  const list = resolveIteratorList(def, group);
  const count = list.length;
  if (count === 0) {
    return { idMapPerIter: [], count: 0 };
  }
  const memberSet = new Set(group.memberNodeIds);
  const memberNodes = def.nodes.filter((n) => memberSet.has(n.id));
  const internalEdges = def.edges.filter(
    (e) => memberSet.has(e.source) && memberSet.has(e.target),
  );

  const idMapPerIter: Map<string, string>[] = [];

  for (let i = 0; i < count; i += 1) {
    const idMap = new Map<string, string>();
    // Clone each member, then apply per-iteration parameter substitution
    for (const m of memberNodes) {
      const cloned = cloneMember(m, i, idMap);
      intoNodes.push(cloned);
    }
    // Apply parameter substitution: for each parameter row, set the cloned target node's
    // property to list[i]. The "iterator value" is shared across all parameters in v1 —
    // every parameter row uses the same iterator. If multiple parameters need independent
    // lists, that's a future feature (zipped lists or list-of-records).
    const iterValue = list[i];
    for (const param of group.parameters) {
      const clonedId = idMap.get(param.targetNodeId);
      if (!clonedId) continue;
      const clonedNode = intoNodes.find((n) => n.id === clonedId);
      if (!clonedNode || clonedNode.type !== 'gstElement') continue;
      const data = clonedNode.data as PipelineNodeData;
      data.properties[param.propertyKey] = listElementToProperty(iterValue);
    }
    // Replicate internal edges
    for (const e of internalEdges) {
      const newSource = idMap.get(e.source);
      const newTarget = idMap.get(e.target);
      if (!newSource || !newTarget) continue;
      intoEdges.push({
        ...e,
        id: `${e.id}__i${i}`,
        source: newSource,
        target: newTarget,
      });
    }
    idMapPerIter.push(idMap);
  }

  return { idMapPerIter, count };
}

/** True if the handle resolves to the boundary pad's exposed `handleId`. */
function edgeHitsBoundary(
  edgeHandle: string | undefined | null,
  boundaryHandleId: string,
): boolean {
  return edgeHandle === boundaryHandleId;
}

/** Look up a boundary pad on a group by handle id. */
function findBoundary(
  group: GroupDef,
  handleId: string,
  direction: 'src' | 'sink',
): GroupBoundaryPad | null {
  return (
    group.boundary.find(
      (b) => b.handleId === handleId && b.direction === direction,
    ) || null
  );
}

/** Translate an inner pad name to a wire handle id (sink:pad / src:pad). */
function memberHandle(direction: 'src' | 'sink', padName: string): string {
  return `${direction}:${padName}`;
}

/** Replicate one boundary edge: outside→group becomes N edges outside→clone_i.
 *  - Direction: incoming if the target is the group container (and we're looking up
 *    by target side); outgoing if the source is the group container. */
function expandBoundaryEdges(
  def: PipelineDef,
  groups: GroupDef[],
  groupIdSet: Set<string>,
  idMapsByGroup: Map<string, ExpandedGroupInternals>,
  intoEdges: StreamEdge[],
): void {
  for (const e of def.edges) {
    const srcIsGroup = groupIdSet.has(e.source);
    const tgtIsGroup = groupIdSet.has(e.target);
    if (!srcIsGroup && !tgtIsGroup) {
      // Edge doesn't touch any group container — leave it as-is for the normal walker.
      intoEdges.push(e);
      continue;
    }
    if (srcIsGroup && tgtIsGroup) {
      // Group-to-group connection. v1: replicate per matching iteration index by position.
      // For now, treat as not supported and drop, but keep the structure so we can extend
      // later. Surfacing as an error here would block the pipeline; quietly skip and let
      // it surface as a missing edge in the canvas.
      continue;
    }
    if (srcIsGroup) {
      const group = groups.find((g) => g.id === e.source)!;
      const boundary = findBoundary(group, e.sourceHandle, 'src');
      if (!boundary) continue;
      const info = idMapsByGroup.get(group.id);
      if (!info) continue;
      for (let i = 0; i < info.count; i += 1) {
        const clonedId = info.idMapPerIter[i].get(boundary.memberNodeId);
        if (!clonedId) continue;
        intoEdges.push({
          ...e,
          id: `${e.id}__src${i}`,
          source: clonedId,
          sourceHandle: memberHandle('src', boundary.memberPadName),
        });
      }
      continue;
    }
    // tgtIsGroup
    const group = groups.find((g) => g.id === e.target)!;
    const boundary = findBoundary(group, e.targetHandle, 'sink');
    if (!boundary) continue;
    const info = idMapsByGroup.get(group.id);
    if (!info) continue;
    for (let i = 0; i < info.count; i += 1) {
      const clonedId = info.idMapPerIter[i].get(boundary.memberNodeId);
      if (!clonedId) continue;
      intoEdges.push({
        ...e,
        id: `${e.id}__tgt${i}`,
        // Source-side handle (sourceHandle) is left untouched, so when the upstream
        // is a `tee` with a `src_%u` template the parser auto-allocates a fresh
        // request pad per replicated edge — this matches the existing shared-sink fix.
        target: clonedId,
        targetHandle: memberHandle('sink', boundary.memberPadName),
      });
    }
  }
}

/** Drop the group container nodes (and their member prototypes) from the final node list —
 *  only the per-iteration clones survive. Members of zero-count groups are also dropped. */
function dropGroupArtifacts(
  def: PipelineDef,
  groups: GroupDef[],
  groupIdSet: Set<string>,
  finalNodes: PipelineGraphNode[],
): void {
  const allMemberIds = new Set<string>();
  for (const g of groups) for (const m of g.memberNodeIds) allMemberIds.add(m);
  for (const n of def.nodes) {
    if (groupIdSet.has(n.id)) continue;
    if (allMemberIds.has(n.id)) continue;
    finalNodes.push(n);
  }
}

/** Expand all groups in the pipeline into a flat PipelineDef.
 *  Returns a *new* def — never mutates the input. */
export function expandGroups(def: PipelineDef): PipelineDef {
  const groups = def.groups || [];
  if (groups.length === 0) {
    return { ...def, groups: [] };
  }
  const groupIdSet = new Set(groups.map((g) => g.id));
  const expandedNodes: PipelineGraphNode[] = [];
  const expandedEdges: StreamEdge[] = [];
  const idMapsByGroup = new Map<string, ExpandedGroupInternals>();

  for (const group of groups) {
    const info = expandSingleGroup(def, group, expandedNodes, expandedEdges);
    idMapsByGroup.set(group.id, info);
  }

  // Pass-through non-group, non-member nodes
  dropGroupArtifacts(def, groups, groupIdSet, expandedNodes);

  // Expand or pass through edges
  expandBoundaryEdges(def, groups, groupIdSet, idMapsByGroup, expandedEdges);

  return {
    id: def.id,
    name: def.name,
    nodes: expandedNodes,
    edges: expandedEdges,
    groups: [],
  };
}

/** Lighter-weight validation pass that yields one error message per misconfigured group,
 *  without throwing. Use this for the editor's diagnostics panel. */
export function diagnoseGroups(def: PipelineDef): string[] {
  const out: string[] = [];
  for (const g of def.groups || []) {
    try {
      const list = resolveIteratorList(def, g);
      if (list.length === 0) {
        out.push(`Group "${g.name}" has an empty iterator list — no instances will run.`);
      }
      for (const p of g.parameters) {
        const member = def.nodes.find((n) => n.id === p.targetNodeId);
        if (!member) {
          out.push(
            `Group "${g.name}" parameter targets a node that no longer exists.`,
          );
        }
      }
    } catch (e) {
      if (e instanceof GroupExpansionError) out.push(e.message);
      else throw e;
    }
  }
  return out;
}
