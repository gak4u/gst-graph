export type GstPropertyKind =
  | 'boolean'
  | 'enum'
  | 'flags'
  | 'integer'
  | 'integer64'
  | 'uinteger'
  | 'uinteger64'
  | 'float'
  | 'double'
  | 'string'
  | 'fraction'
  | 'object'
  | 'other';

export interface GstEnumValue {
  value: number;
  nick: string;
  desc: string;
}

export interface GstPropertyRequirement {
  property: string;
  values: string[];
}

export interface GstPropertyDef {
  name: string;
  blurb: string;
  kind: GstPropertyKind;
  typeName: string;
  readable: boolean;
  writable: boolean;
  controllable: boolean;
  deprecated: boolean;
  defaultValue: string;
  min?: number | string;
  max?: number | string;
  enumValues?: GstEnumValue[];
  flagValues?: GstEnumValue[];
  requires?: GstPropertyRequirement[];
}

export type PadDirection = 'src' | 'sink';
export type PadAvailability = 'always' | 'sometimes' | 'request';

export interface GstCapsStruct {
  media: string;
  fields: Record<string, string>;
}

export interface GstPadTemplate {
  name: string;
  direction: PadDirection;
  availability: PadAvailability;
  caps: GstCapsStruct[];
  capsRaw: string;
}

export interface GstElementSummary {
  name: string;
  longName: string;
  klass: string;
  description: string;
  plugin: string;
  rank: number;
}

export interface GstElementDetail extends GstElementSummary {
  hierarchy: string[];
  padTemplates: GstPadTemplate[];
  properties: GstPropertyDef[];
}

export interface PipelineNodeProps {
  [propName: string]: string | number | boolean | null;
}

export interface PipelineNodeData {
  elementName: string;
  instanceName: string;
  properties: PipelineNodeProps;
  showBindings?: boolean;
  [k: string]: unknown;
}

export type VariableValueKind = 'string' | 'number' | 'boolean' | 'list' | 'record-list' | 'kv';

// A list-typed variable holds an array of primitives. Items must be all strings, all numbers,
// or all booleans (we don't support mixed-type lists). Used as the iterator for a GroupDef.
export type VariableListValue = string[] | number[] | boolean[];

/** A flat key→string lookup table. Used to express preset libraries (e.g. RTMP endpoints
 *  per streaming service) that an iterator row can pick from. */
export type VariableKvValue = Record<string, string>;

/** One column of a record-list iterator.
 *  - `string` / `number` / `boolean`: cell is a literal scalar of that type.
 *  - `variable`: cell is a key into the kv variable referenced by `variableRef`. At unroll
 *    the cell resolves to the kv variable's value for that key.
 */
export interface IteratorColumn {
  /** Identifier used as the column name in rows. Also shown in the group's parameter picker. */
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'variable';
  /** When kind === 'variable', the node id of the referenced kv-typed Variable node. */
  variableRef?: string;
}

/** A row in a record-list iterator: cell value keyed by column name. */
export type IteratorRow = Record<string, string | number | boolean | null>;

export interface VariableNodeData {
  varName: string;
  label?: string;
  valueKind: VariableValueKind;
  /** For 'string' / 'number' / 'boolean': the scalar value.
   *  For 'list':         an array of primitives — single anonymous column iterator.
   *  For 'record-list':  an array of IteratorRow (one per iteration); schema lives in `schema`.
   *  For 'kv':           a flat string→string map (lookup table for iterator cells). */
  value: string | number | boolean | VariableListValue | IteratorRow[] | VariableKvValue | null;
  /** Column definitions for 'record-list' kind. Ignored for other kinds. */
  schema?: IteratorColumn[];
  description?: string;
  hidden?: boolean;
  [k: string]: unknown;
}

export type TransformKind = 'concat' | 'math';

export interface TransformInput {
  id: string;
  name: string;
}

export interface TransformNodeData {
  kind: TransformKind;
  label?: string;
  inputs: TransformInput[];
  expression: string;
  [k: string]: unknown;
}

export interface PipelineEdgeData {
  sourcePad?: string;
  targetPad?: string;
  bindingProperty?: string;
  transformInputId?: string;
  edgeKind?: 'stream' | 'binding' | 'value';
  capsFilter?: string;
}

/** Display-only data on a group container node. The authoritative state lives in the
 *  parent PipelineDef.groups[] entry — this just carries the groupId so the renderer can
 *  look it up. */
export interface GroupNodeData {
  groupId: string;
  [k: string]: unknown;
}

export type PipelineGraphNode =
  | {
      id: string;
      type: 'gstElement';
      position: { x: number; y: number };
      data: PipelineNodeData;
    }
  | {
      id: string;
      type: 'gstVariable';
      position: { x: number; y: number };
      data: VariableNodeData;
    }
  | {
      id: string;
      type: 'gstTransform';
      position: { x: number; y: number };
      data: TransformNodeData;
    }
  | {
      id: string;
      type: 'gstGroup';
      position: { x: number; y: number };
      data: GroupNodeData;
    };

/** A property on a member node whose value varies per iteration of a loop group.
 *  At unroll time, the i-th clone's `data.properties[propertyKey]` is set from the
 *  iterator's i-th row.
 *  - For a scalar 'list' iterator the i-th element is used directly.
 *  - For a 'record-list' iterator with one column, that column's i-th cell is used
 *    automatically (no `sourceColumn` needed).
 *  - For a multi-column 'record-list' iterator, `sourceColumn` picks which column
 *    drives this property; expansion errors out if it's missing or unknown. */
export interface GroupParameter {
  /** Member node whose property is varied. */
  targetNodeId: string;
  /** Property name on that node (e.g. "location"). */
  propertyKey: string;
  /** Column name in the iterator's schema; only meaningful for multi-column iterators. */
  sourceColumn?: string;
  /** Template string with `${col}` placeholders evaluated against the iterator's resolved
   *  row values (kv-typed columns are resolved to their kv lookup value first). When set,
   *  the template's evaluated result is assigned to the target property instead of using
   *  `sourceColumn`. Useful for stitching multiple columns into a single property without
   *  a transform node, e.g. `${endpoint}${key}` → full RTMP URL. */
  template?: string;
}

/** A pad on the group container that forwards to a member node's pad on unroll.
 *  Cached on disk so the renderer can place handles without re-scanning every edge. */
export interface GroupBoundaryPad {
  /** Handle ID exposed on the group container, e.g. "sink:video_in" / "src:out_0".
   *  Must be unique within a group. */
  handleId: string;
  direction: PadDirection;
  /** Which member node this boundary handle forwards to. */
  memberNodeId: string;
  /** Pad name on that member node (e.g. "video"). For request-pad templates the
   *  group emits N edges that omit the source-pad suffix at unroll, letting
   *  gst-launch auto-allocate fresh request pads on the upstream tee. */
  memberPadName: string;
}

export interface GroupDef {
  id: string;
  name: string;
  /** Element & variable nodes that belong to this group's prototype. */
  memberNodeIds: string[];
  /** ID of a gstVariable node whose value is a list. Count = list.length. */
  iteratorVarId: string;
  /** Property bindings varied per iteration. Each parameter is one column;
   *  iteration i gets element i of the iterator list. */
  parameters: GroupParameter[];
  /** Cached boundary pads exposed on the container — derived from edges that
   *  cross the boundary. */
  boundary: GroupBoundaryPad[];
}

export interface PipelineDef {
  id: string;
  name: string;
  nodes: PipelineGraphNode[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    data?: PipelineEdgeData;
    className?: string;
    animated?: boolean;
  }>;
  /** Loop groups defined on this pipeline. Absent on legacy pipelines. */
  groups?: GroupDef[];
}

export interface RunStatus {
  pipelineId: string;
  running: boolean;
  pid?: number;
  exitCode?: number | null;
  startedAt?: number;
  endedAt?: number;
}

export interface RunLogEntry {
  pipelineId: string;
  stream: 'stdout' | 'stderr' | 'meta';
  line: string;
  ts: number;
}

export interface PersistedPipelines {
  pipelines: PipelineDef[];
}

export interface LoadPipelinesResult {
  ok: boolean;
  pipelines: PipelineDef[];
  error?: string;
  fileExists: boolean;
  path?: string;
}

export type GstreamerPlatform = 'darwin' | 'linux' | 'win32' | 'unknown';

export interface GstreamerInstallStatus {
  installed: boolean;
  version?: string;
  binaryPath?: string;
  platform: GstreamerPlatform;
  downloadUrl: string;
  installCommands: Array<{ label: string; command: string }>;
  diagnostic?: string;
}

export interface GstIpcApi {
  listElements(): Promise<GstElementSummary[]>;
  inspectElement(name: string): Promise<GstElementDetail | null>;
  getGstVersion(): Promise<string>;
  checkGstreamerInstall(): Promise<GstreamerInstallStatus>;
  runPipeline(def: PipelineDef): Promise<{ ok: boolean; error?: string; pid?: number; command: string }>;
  stopPipeline(pipelineId: string): Promise<{ ok: boolean }>;
  buildCommand(def: PipelineDef): Promise<string>;
  loadPipelines(): Promise<LoadPipelinesResult>;
  savePipelines(data: PersistedPipelines): Promise<{ ok: boolean; error?: string }>;
  getDataDir(): Promise<string>;
  onLog(cb: (entry: RunLogEntry) => void): () => void;
  onStatus(cb: (status: RunStatus) => void): () => void;
  onPipelinesChanged(cb: () => void): () => void;
  listExternalRuns(): Promise<
    Array<{ pipelineId: string; pid: number; source: 'mcp' | 'electron'; startedAt: number; command: string }>
  >;
  marketplaceSearch(input: { query: string; forceRefresh?: boolean }): Promise<import('./marketplace').MarketplaceSearchResult>;
  marketplaceClearCache(): Promise<{ ok: boolean }>;
  marketplaceInstallPreview(
    input: import('./marketplace').MarketplaceInstallTarget,
  ): Promise<
    import('./marketplace').MarketplaceInstallPreview | import('./marketplace').MarketplaceInstallPreviewError
  >;
  marketplaceInstall(
    input: import('./marketplace').MarketplaceInstallTarget,
  ): Promise<import('./marketplace').MarketplaceInstallResult>;
  marketplaceListInstalled(): Promise<import('./marketplace').InstalledPackage[]>;
  marketplaceAuthStatus(): Promise<import('./marketplace').MarketplaceAuthState>;
}

declare global {
  interface Window {
    gst: GstIpcApi;
  }
}
