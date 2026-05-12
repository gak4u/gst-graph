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

export type VariableValueKind = 'string' | 'number' | 'boolean';

export interface VariableNodeData {
  varName: string;
  label?: string;
  valueKind: VariableValueKind;
  value: string | number | boolean | null;
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
    };

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

export interface GstIpcApi {
  listElements(): Promise<GstElementSummary[]>;
  inspectElement(name: string): Promise<GstElementDetail | null>;
  getGstVersion(): Promise<string>;
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
}

declare global {
  interface Window {
    gst: GstIpcApi;
  }
}
