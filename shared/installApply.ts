import type { PipelineDef, PipelineGraphNode, VariableNodeData } from './types';
import type { PackageManifest, PackageVariableDefault } from './marketplace';

export class PipelineShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineShapeError';
  }
}

export interface PipelinePreview {
  pipelineId: string;
  name: string;
  elementCount: number;
  variableCount: number;
  transformCount: number;
  uniqueElements: string[];
  suspiciousElements: string[];
}

export interface AppliedVariableDefault {
  pipelineName: string;
  varName: string;
  value: string | number | boolean | null;
}

export interface InstallPlan {
  newPipelines: PipelineDef[];
  pipelinePreviews: PipelinePreview[];
  appliedDefaults: AppliedVariableDefault[];
  skippedSecretDefaults: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function newRandomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function prefixForNode(type: string): string {
  if (type === 'gstVariable') return 'v';
  if (type === 'gstTransform') return 't';
  return 'n';
}

function dedupeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

const SUSPICIOUS_RE = /(shell|exec|pipeline|^pipe$|[^a-z]pipe([^a-z]|$))/i;

export function isSuspiciousElement(name: string): boolean {
  return SUSPICIOUS_RE.test(name);
}

export function validatePipelineDefShape(raw: unknown, ctx: string): PipelineDef {
  if (!isPlainObject(raw)) {
    throw new PipelineShapeError(`${ctx}: pipeline JSON must be an object`);
  }
  const id = raw.id;
  const name = raw.name;
  const nodes = raw.nodes;
  const edges = raw.edges;
  if (typeof id !== 'string' || id.length === 0) {
    throw new PipelineShapeError(`${ctx}: pipeline missing string "id"`);
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new PipelineShapeError(`${ctx}: pipeline missing string "name"`);
  }
  if (!Array.isArray(nodes)) {
    throw new PipelineShapeError(`${ctx}: pipeline missing "nodes" array`);
  }
  if (!Array.isArray(edges)) {
    throw new PipelineShapeError(`${ctx}: pipeline missing "edges" array`);
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!isPlainObject(n)) {
      throw new PipelineShapeError(`${ctx}: nodes[${i}] must be an object`);
    }
    if (typeof n.id !== 'string') {
      throw new PipelineShapeError(`${ctx}: nodes[${i}].id must be a string`);
    }
    if (typeof n.type !== 'string') {
      throw new PipelineShapeError(`${ctx}: nodes[${i}].type must be a string`);
    }
    if (!isPlainObject(n.data)) {
      throw new PipelineShapeError(`${ctx}: nodes[${i}].data must be an object`);
    }
  }
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!isPlainObject(e)) {
      throw new PipelineShapeError(`${ctx}: edges[${i}] must be an object`);
    }
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') {
      throw new PipelineShapeError(`${ctx}: edges[${i}] must have string id/source/target`);
    }
  }
  return raw as unknown as PipelineDef;
}

function clonePipelineWithFreshIds(
  pipeline: PipelineDef,
  newName: string,
): { cloned: PipelineDef; nodeIdMap: Map<string, string> } {
  const nodeIdMap = new Map<string, string>();
  const cloned: PipelineDef = {
    id: newRandomId('pl'),
    name: newName,
    nodes: [],
    edges: [],
  };
  for (const node of pipeline.nodes) {
    const fresh = newRandomId(prefixForNode(node.type));
    nodeIdMap.set(node.id, fresh);
    cloned.nodes.push({
      ...node,
      id: fresh,
      position: { ...node.position },
      data: { ...(node.data as Record<string, unknown>) } as PipelineGraphNode['data'],
    } as PipelineGraphNode);
  }
  for (const edge of pipeline.edges) {
    const remappedSource = nodeIdMap.get(edge.source);
    const remappedTarget = nodeIdMap.get(edge.target);
    if (!remappedSource || !remappedTarget) continue;
    cloned.edges.push({
      ...edge,
      id: newRandomId('e'),
      source: remappedSource,
      target: remappedTarget,
      data: edge.data ? { ...edge.data } : edge.data,
    });
  }
  return { cloned, nodeIdMap };
}

function applyVariableDefaults(
  cloned: PipelineDef,
  variables: PackageVariableDefault[] | undefined,
): { applied: AppliedVariableDefault[]; skippedSecrets: string[] } {
  const applied: AppliedVariableDefault[] = [];
  const skippedSecrets: string[] = [];
  if (!variables || variables.length === 0) return { applied, skippedSecrets };
  const byName = new Map(variables.map((v) => [v.varName, v]));
  cloned.nodes = cloned.nodes.map((node) => {
    if (node.type !== 'gstVariable') return node;
    const vd = node.data as VariableNodeData;
    const def = byName.get(vd.varName);
    if (!def) return node;
    const currentEmpty = vd.value === '' || vd.value === null || vd.value === undefined;
    if (!currentEmpty) return node;
    if (def.default === undefined) return node;
    if (def.secret) {
      skippedSecrets.push(def.varName);
      return node;
    }
    applied.push({ pipelineName: cloned.name, varName: def.varName, value: def.default });
    return { ...node, data: { ...vd, value: def.default } };
  });
  return { applied, skippedSecrets };
}

function previewFor(pipeline: PipelineDef): PipelinePreview {
  let elementCount = 0;
  let variableCount = 0;
  let transformCount = 0;
  const uniqueElements = new Set<string>();
  for (const node of pipeline.nodes) {
    if (node.type === 'gstElement') {
      elementCount++;
      const elName = (node.data as { elementName?: string }).elementName;
      if (typeof elName === 'string' && elName.length > 0) uniqueElements.add(elName);
    } else if (node.type === 'gstVariable') {
      variableCount++;
    } else if (node.type === 'gstTransform') {
      transformCount++;
    }
  }
  const elements = [...uniqueElements].sort();
  return {
    pipelineId: pipeline.id,
    name: pipeline.name,
    elementCount,
    variableCount,
    transformCount,
    uniqueElements: elements,
    suspiciousElements: elements.filter(isSuspiciousElement),
  };
}

function fileBaseName(file: string): string {
  const last = file.split('/').pop() || file;
  return last.replace(/\.json$/i, '');
}

export interface ApplyPackageInstallInput {
  manifest: PackageManifest;
  fetchedPipelines: PipelineDef[];
  existingPipelineNames: Iterable<string>;
}

export function applyPackageInstall(input: ApplyPackageInstallInput): InstallPlan {
  const { manifest, fetchedPipelines } = input;
  if (fetchedPipelines.length !== manifest.pipelines.length) {
    throw new PipelineShapeError(
      `applyPackageInstall: expected ${manifest.pipelines.length} fetched pipeline(s), got ${fetchedPipelines.length}`,
    );
  }

  const taken = new Set<string>(input.existingPipelineNames);
  const newPipelines: PipelineDef[] = [];
  const pipelinePreviews: PipelinePreview[] = [];
  const appliedDefaults: AppliedVariableDefault[] = [];
  const skippedSecretSet = new Set<string>();

  for (let i = 0; i < manifest.pipelines.length; i++) {
    const ref = manifest.pipelines[i];
    const fetched = fetchedPipelines[i];
    const baseName =
      (ref.name && ref.name.trim()) ||
      (fetched.name && fetched.name.trim()) ||
      fileBaseName(ref.file) ||
      `${manifest.name} pipeline ${i + 1}`;
    const finalName = dedupeName(baseName, taken);
    taken.add(finalName);

    const { cloned } = clonePipelineWithFreshIds(fetched, finalName);
    const { applied, skippedSecrets } = applyVariableDefaults(cloned, manifest.variables);
    for (const a of applied) appliedDefaults.push(a);
    for (const s of skippedSecrets) skippedSecretSet.add(s);

    newPipelines.push(cloned);
    pipelinePreviews.push(previewFor(cloned));
  }

  return {
    newPipelines,
    pipelinePreviews,
    appliedDefaults,
    skippedSecretDefaults: [...skippedSecretSet],
  };
}
