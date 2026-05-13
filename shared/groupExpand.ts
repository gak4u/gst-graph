// Loop-group unroll pre-pass. Pure function: takes a PipelineDef with groups[] and returns
// a flat PipelineDef where each group's members have been duplicated N times (N = iterator
// variable's list length), parameter properties substituted per iteration, internal edges
// replicated, and boundary edges (outside → group.handle) expanded into N edges that target
// each clone's corresponding pad.

import type {
  GroupBoundaryPad,
  GroupDef,
  GroupParameter,
  IteratorColumn,
  IteratorRow,
  PipelineDef,
  PipelineGraphNode,
  PipelineNodeData,
  VariableKvValue,
  VariableNodeData,
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

/** The iterator's shape after resolution: a uniform list of rows, plus a schema. A scalar
 *  `list` iterator is normalized to a single anonymous-column schema (column name '__value'). */
interface ResolvedIterator {
  schema: IteratorColumn[];
  rows: IteratorRow[];
}

const SCALAR_LIST_COLUMN = '__value';

/** Resolve the runtime value of an iterator cell — applying kv lookups for
 *  variable-kind columns. Returns the raw cell value for scalar-kind columns. */
function resolveCellValue(
  def: PipelineDef,
  group: GroupDef,
  column: IteratorColumn,
  cell: string | number | boolean | null | undefined,
): string | number | boolean | null {
  if (cell === undefined) return null;
  if (column.kind !== 'variable') return cell ?? null;
  if (!column.variableRef) {
    throw new GroupExpansionError(
      `Group "${group.name}" column "${column.name}" is a variable-kind column without a kv variable reference`,
      group.id,
    );
  }
  const kvNode = def.nodes.find((n) => n.id === column.variableRef);
  if (!kvNode || kvNode.type !== 'gstVariable') {
    throw new GroupExpansionError(
      `Group "${group.name}" column "${column.name}" references a missing kv variable`,
      group.id,
    );
  }
  const data = kvNode.data as VariableNodeData;
  if (data.valueKind !== 'kv' || typeof data.value !== 'object' || data.value === null || Array.isArray(data.value)) {
    throw new GroupExpansionError(
      `Group "${group.name}" column "${column.name}" references "${data.varName}" which is not a kv-kind variable`,
      group.id,
    );
  }
  const map = data.value as VariableKvValue;
  if (cell === null) return null;
  const key = String(cell);
  if (!(key in map)) {
    // Unknown key — emit empty string so the property is left effectively unset
    // rather than crashing the unroll. Diagnostics surface this separately.
    return '';
  }
  return map[key];
}

/** Apply `${col}` substitution against a per-row map of resolved column values. Unknown
 *  placeholders are kept verbatim so the user can spot typos in the Show-command preview. */
function evaluateTemplate(
  template: string,
  resolved: Record<string, string | number | boolean | null>,
): string {
  return template.replace(/\$\{(\w+)\}/g, (m, name: string) => {
    if (!(name in resolved)) return m;
    const v = resolved[name];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}

/** Pull the iterator off the named variable node and normalize to (schema, rows). Throws
 *  GroupExpansionError on any structural problem so callers can surface it. */
function resolveIterator(def: PipelineDef, group: GroupDef): ResolvedIterator {
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
  if (data.valueKind === 'list') {
    if (!Array.isArray(data.value)) {
      throw new GroupExpansionError(
        `Group "${group.name}" iterator variable "${data.varName}" must hold a list value`,
        group.id,
      );
    }
    const rows: IteratorRow[] = (data.value as Array<string | number | boolean>).map((v) => ({
      [SCALAR_LIST_COLUMN]: v,
    }));
    return {
      schema: [{ name: SCALAR_LIST_COLUMN, kind: 'string' }],
      rows,
    };
  }
  if (data.valueKind === 'record-list') {
    const schema = data.schema || [];
    if (schema.length === 0) {
      throw new GroupExpansionError(
        `Group "${group.name}" iterator "${data.varName}" has no columns — add at least one`,
        group.id,
      );
    }
    if (!Array.isArray(data.value)) {
      throw new GroupExpansionError(
        `Group "${group.name}" iterator "${data.varName}" must hold a list of rows`,
        group.id,
      );
    }
    const rows = data.value as IteratorRow[];
    return { schema, rows };
  }
  throw new GroupExpansionError(
    `Group "${group.name}" iterator "${data.varName}" must be a list or record-list variable`,
    group.id,
  );
}

/** Determine which iterator column drives a given parameter. With one column we auto-pick;
 *  with multiple columns the parameter must specify `sourceColumn` and it must be in schema. */
function resolveParameterColumn(
  group: GroupDef,
  iter: ResolvedIterator,
  param: GroupParameter,
): IteratorColumn {
  if (iter.schema.length === 1) return iter.schema[0];
  if (!param.sourceColumn) {
    throw new GroupExpansionError(
      `Group "${group.name}" parameter for ${param.propertyKey} needs a column — iterator has multiple`,
      group.id,
    );
  }
  const col = iter.schema.find((c) => c.name === param.sourceColumn);
  if (!col) {
    throw new GroupExpansionError(
      `Group "${group.name}" parameter for ${param.propertyKey} binds to column "${param.sourceColumn}" which is no longer in the iterator schema`,
      group.id,
    );
  }
  return col;
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
    const d = node.data;
    const cloned: PipelineGraphNode = {
      id: freshId,
      type: 'gstElement',
      position: { ...node.position },
      data: {
        ...d,
        instanceName: d.instanceName ? suffixInstance(d.instanceName, i) : d.instanceName,
        properties: { ...(d.properties || {}) },
      },
    };
    return cloned;
  }
  if (node.type === 'gstVariable') {
    const d = node.data;
    const cloned: PipelineGraphNode = {
      id: freshId,
      type: 'gstVariable',
      position: { ...node.position },
      data: { ...d },
    };
    return cloned;
  }
  if (node.type === 'gstTransform') {
    const d = node.data;
    const cloned: PipelineGraphNode = {
      id: freshId,
      type: 'gstTransform',
      position: { ...node.position },
      data: { ...d, inputs: [...d.inputs] },
    };
    return cloned;
  }
  // gstGroup — shouldn't end up as a member of another group in v1, but handle gracefully
  const cloned: PipelineGraphNode = {
    id: freshId,
    type: 'gstGroup',
    position: { ...node.position },
    data: { ...node.data },
  };
  return cloned;
}

/** Coerce a cell value into the right scalar type for a property assignment. Lenient: empty /
 *  null cells become empty string (skipped by the runner anyway). */
function coerceCellToProperty(
  raw: string | number | boolean | null | undefined,
  kind: IteratorColumn['kind'],
): string | number | boolean {
  if (raw === null || raw === undefined) return '';
  if (kind === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    return raw === 'true' || raw === '1' || raw === 1;
  }
  if (kind === 'number') {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return String(raw);
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
  const iter = resolveIterator(def, group);
  const count = iter.rows.length;
  if (count === 0) {
    return { idMapPerIter: [], count: 0 };
  }
  // Pre-resolve each parameter to its driving column. This throws early if a multi-column
  // iterator is missing a `sourceColumn` on any parameter, so we never produce a partial unroll.
  // Template-mode parameters skip the column requirement — they pull from any (or all)
  // columns at interpolation time.
  const paramColumns = group.parameters.map((p) => ({
    param: p,
    column: p.template ? null : resolveParameterColumn(group, iter, p),
  }));

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
    const row = iter.rows[i] || {};
    // Pre-resolve every column's effective value for this row once, so kv lookups don't
    // run more than once even if multiple parameters template against the same column.
    const resolvedRow: Record<string, string | number | boolean | null> = {};
    for (const col of iter.schema) {
      resolvedRow[col.name] = resolveCellValue(def, group, col, row[col.name]);
    }
    for (const { param, column } of paramColumns) {
      const clonedId = idMap.get(param.targetNodeId);
      if (!clonedId) continue;
      const clonedNode = intoNodes.find((n) => n.id === clonedId);
      if (!clonedNode || clonedNode.type !== 'gstElement') continue;
      const data = clonedNode.data as PipelineNodeData;
      if (param.template) {
        data.properties[param.propertyKey] = evaluateTemplate(param.template, resolvedRow);
      } else if (column) {
        const raw = resolvedRow[column.name];
        // For 'variable' kind columns the resolved value is always a string (the kv lookup),
        // so use 'string' coercion; for scalar columns use the column's declared kind.
        const coerceKind: 'string' | 'number' | 'boolean' =
          column.kind === 'variable' ? 'string' : column.kind;
        data.properties[param.propertyKey] = coerceCellToProperty(raw, coerceKind);
      }
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
      const iter = resolveIterator(def, g);
      if (iter.rows.length === 0) {
        out.push(`Group "${g.name}" has an empty iterator list — no instances will run.`);
      }
      for (const p of g.parameters) {
        const member = def.nodes.find((n) => n.id === p.targetNodeId);
        if (!member) {
          out.push(
            `Group "${g.name}" parameter targets a node that no longer exists.`,
          );
          continue;
        }
        // Template parameters skip the column requirement; they pull from arbitrary
        // ${col} placeholders. Diagnose missing columns referenced in the template
        // for sharper hints, but don't block.
        if (p.template) {
          const refs = [...p.template.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
          const missing = refs.filter((r) => !iter.schema.some((c) => c.name === r));
          if (missing.length) {
            out.push(
              `Group "${g.name}" parameter for ${p.propertyKey} template references unknown column(s): ${missing.join(', ')}.`,
            );
          }
          continue;
        }
        if (iter.schema.length > 1 && !p.sourceColumn) {
          out.push(
            `Group "${g.name}" parameter for ${p.propertyKey} needs a column pick — iterator has multiple.`,
          );
          continue;
        }
        if (p.sourceColumn && !iter.schema.some((c) => c.name === p.sourceColumn)) {
          out.push(
            `Group "${g.name}" parameter for ${p.propertyKey} binds to column "${p.sourceColumn}" which is no longer in the iterator schema.`,
          );
        }
      }
      // Surface kv-column issues so the user knows when a referenced kv variable
      // is missing or has been retyped — even though resolveCellValue would throw
      // at expand time, this gives a non-blocking inspector-friendly message.
      for (const col of iter.schema) {
        if (col.kind !== 'variable') continue;
        if (!col.variableRef) {
          out.push(
            `Group "${g.name}" column "${col.name}" is a variable column without a kv reference.`,
          );
          continue;
        }
        const kvNode = def.nodes.find((n) => n.id === col.variableRef);
        if (!kvNode || kvNode.type !== 'gstVariable') {
          out.push(
            `Group "${g.name}" column "${col.name}" references a kv variable that's no longer in the pipeline.`,
          );
          continue;
        }
        const d = kvNode.data as VariableNodeData;
        if (d.valueKind !== 'kv') {
          out.push(
            `Group "${g.name}" column "${col.name}" references "${d.varName}", which is no longer a kv variable.`,
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
