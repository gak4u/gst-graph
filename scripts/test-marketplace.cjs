/* eslint-disable */
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(PROJECT, '.test-build');

function build() {
  const tscBin = path.join(PROJECT, 'node_modules', '.bin', 'tsc');
  const result = spawnSync(
    tscBin,
    [
      '--outDir',
      BUILD_DIR,
      '--module',
      'commonjs',
      '--target',
      'es2020',
      '--esModuleInterop',
      '--strict',
      path.join(PROJECT, 'shared', 'marketplace.ts'),
      path.join(PROJECT, 'shared', 'marketplaceCheck.ts'),
      path.join(PROJECT, 'shared', 'installApply.ts'),
      path.join(PROJECT, 'shared', 'groupExpand.ts'),
      path.join(PROJECT, 'shared', 'types.ts'),
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error('[test-marketplace] tsc compile failed');
    process.exit(result.status || 1);
  }
}

build();

const { parseManifest, ManifestParseError, checkCompatibility, satisfiesRange, compareSemverLoose, normalizeGstreamerVersion } = require(path.join(
  BUILD_DIR,
  'marketplaceCheck.js',
));
const {
  applyPackageInstall,
  validatePipelineDefShape,
  isSuspiciousElement,
  normalizeStreamEdgeHandle,
  PipelineShapeError,
} = require(path.join(BUILD_DIR, 'installApply.js'));
const { expandGroups, diagnoseGroups, GroupExpansionError } = require(path.join(
  BUILD_DIR,
  'groupExpand.js',
));

let failures = 0;
function assert(ok, label) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}
function group(name) {
  console.log(`\n== ${name} ==`);
}
function throws(fn, matcher, label) {
  try {
    fn();
    console.log(`  FAIL ${label} (no throw)`);
    failures++;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (matcher && !matcher.test(msg)) {
      console.log(`  FAIL ${label} (wrong msg: ${msg})`);
      failures++;
    } else {
      console.log(`  ok  ${label} -> ${msg.slice(0, 80)}`);
    }
  }
}

group('parseManifest happy path');
const good = {
  schemaVersion: 1,
  id: 'rtmp-livestream',
  name: 'RTMP Livestream',
  version: '1.0.0',
  summary: 'Stream to RTMP',
  author: { name: 'gak4u', url: 'https://github.com/gak4u' },
  tags: ['rtmp', 'livestream'],
  license: 'MIT',
  preview: 'preview.png',
  requires: {
    gstreamer: '>=1.20',
    elements: ['videotestsrc', { name: 'x264enc', rationale: 'H264 encoder' }],
  },
  optional: { elements: ['nvh264enc'] },
  pipelines: [{ file: 'pipelines/livestream.json', name: 'Livestream' }],
  variables: [
    { varName: 'host', label: 'Host', default: 'live.twitch.tv/app' },
    { varName: 'streamKey', label: 'Stream Key', secret: true },
  ],
};
const parsed = parseManifest(good);
assert(parsed.id === 'rtmp-livestream', 'id parsed');
assert(parsed.requires.elements.length === 2, 'requires.elements parsed');
assert(parsed.requires.elements[0].name === 'videotestsrc', 'shorthand string element parsed');
assert(parsed.requires.elements[1].rationale === 'H264 encoder', 'object element rationale parsed');
assert(parsed.optional.elements[0].name === 'nvh264enc', 'optional element parsed');
assert(parsed.pipelines.length === 1, 'pipelines parsed');
assert(parsed.variables[1].secret === true, 'variable secret flag parsed');

group('parseManifest rejects bad input');
throws(() => parseManifest(null), /JSON object/, 'rejects null');
throws(() => parseManifest({ schemaVersion: 2 }), /schemaVersion/, 'rejects wrong schemaVersion');
throws(() => parseManifest({ ...good, id: 'Bad ID' }), /id must match/, 'rejects bad id');
throws(() => parseManifest({ ...good, version: 'v1' }), /version must be semver/, 'rejects non-semver version');
throws(() => parseManifest({ ...good, pipelines: [] }), /non-empty array/, 'rejects empty pipelines');
throws(
  () => parseManifest({ ...good, pipelines: [{ file: '../etc/passwd' }] }),
  /relative path inside the package/,
  'rejects path traversal',
);
throws(
  () => parseManifest({ ...good, pipelines: [{ file: '/etc/passwd' }] }),
  /relative path inside the package/,
  'rejects absolute path',
);

group('semver helpers');
assert(compareSemverLoose('1.20.0', '1.20.0') === 0, 'eq');
assert(compareSemverLoose('1.20.0', '1.21.0') === -1, 'minor lt');
assert(compareSemverLoose('1.20.0', '1.19.99') === 1, 'minor gt');
assert(compareSemverLoose('1', '1.0.0') === 0, 'short eq');
assert(normalizeGstreamerVersion('GStreamer Core Library version 1.28.2') === '1.28.2', 'normalize from gst-launch banner');
assert(normalizeGstreamerVersion('1.20') === '1.20', 'normalize bare');
assert(normalizeGstreamerVersion(undefined) === undefined, 'normalize undefined');

group('satisfiesRange');
assert(satisfiesRange('1.20.5', '>=1.20') === true, 'gte minor');
assert(satisfiesRange('1.19.99', '>=1.20') === false, 'gte minor fail');
assert(satisfiesRange('1.20.0', '>=1.20 <2.0') === true, 'compound passes');
assert(satisfiesRange('2.0.0', '>=1.20 <2.0') === false, 'compound upper fail');
assert(satisfiesRange('1.20.0', '=1.20.0') === true, 'exact');
assert(satisfiesRange('1.20.1', '=1.20.0') === false, 'exact fail');
assert(satisfiesRange('1.20.0', '1.20.0') === true, 'bare bare');

group('checkCompatibility');
const installedElements = new Set([
  'videotestsrc',
  'videoconvert',
  'x264enc',
  'flvmux',
  'rtmpsink',
  'audiotestsrc',
  'voaacenc',
]);
let report = checkCompatibility(parsed, {
  installedElements,
  installedGstreamerVersion: '1.28.2',
});
assert(report.compatible === true, 'compatible when all required present');
assert(report.missingRequired.length === 0, 'no missing required');
assert(report.missingOptional.length === 1, 'flags missing optional nvh264enc');
assert(report.gstreamerOk === true, 'gst version satisfied');

const partial = new Set(installedElements);
partial.delete('x264enc');
report = checkCompatibility(parsed, {
  installedElements: partial,
  installedGstreamerVersion: '1.28.2',
});
assert(report.compatible === false, 'incompatible when required element missing');
assert(report.missingRequired.length === 1, 'missing required listed');
assert(report.missingRequired[0].name === 'x264enc', 'missing name correct');

report = checkCompatibility(parsed, {
  installedElements,
  installedGstreamerVersion: '1.18.0',
});
assert(report.compatible === false, 'incompatible on gst version');
assert(report.gstreamerOk === false, 'gst version flagged');
assert(/1.18.0/.test(report.gstreamerNote), 'note mentions installed version');

report = checkCompatibility(parsed, {
  installedElements,
  installedGstreamerVersion: undefined,
});
assert(report.gstreamerOk === false, 'unknown version is treated as failure');

const noGst = { ...parsed, requires: { ...parsed.requires, gstreamer: undefined } };
report = checkCompatibility(noGst, {
  installedElements,
});
assert(report.compatible === true, 'no gstreamer range means compatible');

group('validatePipelineDefShape');
throws(() => validatePipelineDefShape(null, 'x'), /must be an object/, 'rejects null');
throws(() => validatePipelineDefShape({}, 'x'), /missing string "id"/, 'rejects missing id');
throws(
  () => validatePipelineDefShape({ id: 'a', name: 'b', nodes: 'no', edges: [] }, 'x'),
  /missing "nodes" array/,
  'rejects non-array nodes',
);
throws(
  () => validatePipelineDefShape({ id: 'a', name: 'b', nodes: [], edges: 'no' }, 'x'),
  /missing "edges" array/,
  'rejects non-array edges',
);
const validPipeline = {
  id: 'pl_src',
  name: 'Source Pipeline',
  nodes: [{ id: 'n1', type: 'gstElement', position: { x: 0, y: 0 }, data: { elementName: 'videotestsrc', instanceName: 'v0', properties: {} } }],
  edges: [],
};
const validated = validatePipelineDefShape(validPipeline, 'x');
assert(validated === validPipeline, 'returns same object on success');

group('isSuspiciousElement');
assert(isSuspiciousElement('shellrun') === true, 'flags shell substring');
assert(isSuspiciousElement('exec') === true, 'flags exec');
assert(isSuspiciousElement('pipeline-dot-q') === true, 'flags pipeline');
assert(isSuspiciousElement('videotestsrc') === false, 'safe element passes');
assert(isSuspiciousElement('x264enc') === false, 'safe encoder passes');

group('applyPackageInstall');
const installManifest = parseManifest({
  schemaVersion: 1,
  id: 'rtmp-livestream',
  name: 'RTMP Livestream',
  version: '1.0.0',
  pipelines: [{ file: 'pipelines/p.json', name: 'Stream' }],
  variables: [
    { varName: 'host', label: 'Host', default: 'live.twitch.tv/app' },
    { varName: 'streamKey', label: 'Stream Key', secret: true, default: 'leaked-key' },
    { varName: 'bitrate', label: 'Bitrate', default: 4500 },
  ],
});
const sourcePipeline = {
  id: 'pl_orig',
  name: 'Stream',
  nodes: [
    { id: 'v_host', type: 'gstVariable', position: { x: 10, y: 10 }, data: { varName: 'host', valueKind: 'string', value: '' } },
    { id: 'v_streamKey', type: 'gstVariable', position: { x: 10, y: 60 }, data: { varName: 'streamKey', valueKind: 'string', value: '' } },
    { id: 'v_br', type: 'gstVariable', position: { x: 10, y: 110 }, data: { varName: 'bitrate', valueKind: 'number', value: 9000 } },
    { id: 'n_src', type: 'gstElement', position: { x: 200, y: 10 }, data: { elementName: 'videotestsrc', instanceName: 'src0', properties: {} } },
    { id: 'n_enc', type: 'gstElement', position: { x: 360, y: 10 }, data: { elementName: 'x264enc', instanceName: 'enc0', properties: {} } },
    { id: 't_fmt', type: 'gstTransform', position: { x: 520, y: 10 }, data: { kind: 'concat', inputs: [{ id: 'in1', name: 'host' }], expression: '${host}' } },
  ],
  edges: [
    { id: 'e1', source: 'n_src', target: 'n_enc', sourceHandle: 'src', targetHandle: 'sink', data: { edgeKind: 'stream' } },
    { id: 'e2', source: 'v_host', target: 't_fmt', sourceHandle: 'value', targetHandle: 'in1', data: { transformInputId: 'in1', edgeKind: 'value' } },
  ],
};

const installInput = {
  manifest: installManifest,
  fetchedPipelines: [sourcePipeline],
  existingPipelineNames: ['Other Pipeline'],
};
const installInputSnapshot = JSON.stringify(installInput);
const plan = applyPackageInstall(installInput);

assert(plan.newPipelines.length === 1, 'one pipeline produced');
const built = plan.newPipelines[0];
assert(built.id !== sourcePipeline.id, 'pipeline id remapped');
assert(built.id.startsWith('pl_'), 'pipeline id has pl_ prefix');
assert(built.name === 'Stream', 'pipeline name retained when not duplicate');

const allNewIds = new Set(built.nodes.map((n) => n.id));
const allOldIds = new Set(sourcePipeline.nodes.map((n) => n.id));
let anyOverlap = false;
for (const id of allNewIds) if (allOldIds.has(id)) anyOverlap = true;
assert(anyOverlap === false, 'no node id leaked from source');
assert(allNewIds.size === sourcePipeline.nodes.length, 'all nodes remapped uniquely');

const variableNode = built.nodes.find((n) => n.type === 'gstVariable' && n.data.varName === 'host');
assert(!!variableNode, 'host variable preserved');
assert(variableNode.data.value === 'live.twitch.tv/app', 'host default applied');

const streamKeyNode = built.nodes.find((n) => n.type === 'gstVariable' && n.data.varName === 'streamKey');
assert(!!streamKeyNode, 'streamKey variable preserved');
assert(streamKeyNode.data.value === '', 'secret default NOT applied');
assert(plan.skippedSecretDefaults.includes('streamKey'), 'skippedSecretDefaults lists streamKey');

const bitrateNode = built.nodes.find((n) => n.type === 'gstVariable' && n.data.varName === 'bitrate');
assert(bitrateNode.data.value === 9000, 'existing non-empty variable value preserved');

assert(plan.appliedDefaults.length === 1, 'one default applied');
assert(plan.appliedDefaults[0].varName === 'host', 'applied default is host');
assert(plan.appliedDefaults[0].value === 'live.twitch.tv/app', 'applied default value matches');

const builtEdges = built.edges;
assert(builtEdges.length === 2, 'edges preserved');
for (const e of builtEdges) {
  const sourceRemapped = allNewIds.has(e.source);
  const targetRemapped = allNewIds.has(e.target);
  assert(sourceRemapped, `edge ${e.id} source points to a fresh node id`);
  assert(targetRemapped, `edge ${e.id} target points to a fresh node id`);
}
const valueEdge = builtEdges.find((e) => e.data && e.data.transformInputId === 'in1');
assert(!!valueEdge, 'transformInputId preserved on cloned edge');

const previewItem = plan.pipelinePreviews[0];
assert(previewItem.elementCount === 2, 'preview element count');
assert(previewItem.variableCount === 3, 'preview variable count');
assert(previewItem.transformCount === 1, 'preview transform count');
assert(previewItem.uniqueElements.includes('x264enc'), 'preview unique elements');
assert(previewItem.suspiciousElements.length === 0, 'no suspicious elements in safe pipeline');

assert(JSON.stringify(installInput) === installInputSnapshot, 'applyPackageInstall does not mutate input');

const dupPlan = applyPackageInstall({
  manifest: installManifest,
  fetchedPipelines: [sourcePipeline],
  existingPipelineNames: ['Stream'],
});
assert(dupPlan.newPipelines[0].name === 'Stream (2)', 'dedupe appends (2) on collision');

const suspiciousPipeline = {
  ...sourcePipeline,
  id: 'pl_susp',
  nodes: [
    ...sourcePipeline.nodes,
    { id: 'n_shell', type: 'gstElement', position: { x: 700, y: 10 }, data: { elementName: 'shellexec', instanceName: 'shell0', properties: {} } },
  ],
};
const suspPlan = applyPackageInstall({
  manifest: installManifest,
  fetchedPipelines: [suspiciousPipeline],
  existingPipelineNames: [],
});
assert(suspPlan.pipelinePreviews[0].suspiciousElements.includes('shellexec'), 'flags shellexec as suspicious');

throws(
  () => applyPackageInstall({
    manifest: installManifest,
    fetchedPipelines: [],
    existingPipelineNames: [],
  }),
  /expected 1 fetched pipeline/,
  'rejects mismatched pipeline count',
);

group('normalizeStreamEdgeHandle');
assert(normalizeStreamEdgeHandle('src', 'source', 'src') === 'src:src', 'bare src → src:src');
assert(normalizeStreamEdgeHandle('sink', 'target', 'sink') === 'sink:sink', 'bare sink → sink:sink');
assert(normalizeStreamEdgeHandle('src:video_%u', 'source', 'video_0') === 'src:video_%u', 'already-prefixed kept');
assert(normalizeStreamEdgeHandle(null, 'source', 'video_0') === 'src:video_0', 'null handle uses pad');
assert(normalizeStreamEdgeHandle(null, 'target', undefined) === 'sink:sink', 'null handle + no pad defaults to sink:sink');

group('applyPackageInstall normalizes stream edge handles');
const stripeManifest = parseManifest({
  schemaVersion: 1,
  id: 'preview',
  name: 'Preview',
  version: '1.0.0',
  pipelines: [{ file: 'pipelines/p.json', name: 'Preview' }],
});
const legacyPipeline = {
  id: 'pl_legacy',
  name: 'Preview',
  nodes: [
    { id: 'n_src', type: 'gstElement', position: { x: 0, y: 0 }, data: { elementName: 'videotestsrc', instanceName: 'src0', properties: {} } },
    { id: 'n_conv', type: 'gstElement', position: { x: 100, y: 0 }, data: { elementName: 'videoconvert', instanceName: 'conv0', properties: {} } },
    { id: 'v_p', type: 'gstVariable', position: { x: 0, y: 100 }, data: { varName: 'pattern', valueKind: 'string', value: 'ball' } },
  ],
  edges: [
    { id: 'e1', source: 'n_src', target: 'n_conv', sourceHandle: 'src', targetHandle: 'sink', data: { sourcePad: 'src', targetPad: 'sink', edgeKind: 'stream' } },
    { id: 'e2', source: 'v_p', target: 'n_src', sourceHandle: 'out', targetHandle: 'prop:pattern', data: { bindingProperty: 'pattern', edgeKind: 'binding' } },
  ],
};
const legacyPlan = applyPackageInstall({
  manifest: stripeManifest,
  fetchedPipelines: [legacyPipeline],
  existingPipelineNames: [],
});
const builtLegacy = legacyPlan.newPipelines[0];
const streamEdge = builtLegacy.edges.find((e) => e.data && e.data.edgeKind === 'stream');
assert(streamEdge.sourceHandle === 'src:src', 'stream edge sourceHandle prefixed');
assert(streamEdge.targetHandle === 'sink:sink', 'stream edge targetHandle prefixed');
const bindingEdge = builtLegacy.edges.find((e) => e.data && e.data.edgeKind === 'binding');
assert(bindingEdge.sourceHandle === 'out', 'binding edge sourceHandle untouched');
assert(bindingEdge.targetHandle === 'prop:pattern', 'binding edge targetHandle untouched');

const inferredPipeline = {
  id: 'pl_inferred',
  name: 'Inferred',
  nodes: legacyPipeline.nodes,
  edges: [
    // No edgeKind in data, but both ends are gstElement → infer stream
    { id: 'e1', source: 'n_src', target: 'n_conv', sourceHandle: 'src', targetHandle: 'sink', data: { sourcePad: 'src', targetPad: 'sink' } },
  ],
};
const inferredPlan = applyPackageInstall({
  manifest: stripeManifest,
  fetchedPipelines: [inferredPipeline],
  existingPipelineNames: ['Preview'],
});
const inferredStream = inferredPlan.newPipelines[0].edges[0];
assert(inferredStream.sourceHandle === 'src:src', 'inferred stream edge sourceHandle prefixed');
assert(inferredStream.targetHandle === 'sink:sink', 'inferred stream edge targetHandle prefixed');

const prefixedPipeline = {
  id: 'pl_prefixed',
  name: 'Prefixed',
  nodes: legacyPipeline.nodes,
  edges: [
    { id: 'e1', source: 'n_src', target: 'n_conv', sourceHandle: 'src:src', targetHandle: 'sink:sink', data: { sourcePad: 'src', targetPad: 'sink', edgeKind: 'stream' } },
  ],
};
const prefixedPlan = applyPackageInstall({
  manifest: stripeManifest,
  fetchedPipelines: [prefixedPipeline],
  existingPipelineNames: ['Preview', 'Preview (2)'],
});
const prefixedStream = prefixedPlan.newPipelines[0].edges[0];
assert(prefixedStream.sourceHandle === 'src:src', 'already-prefixed stream edge kept');
assert(prefixedStream.targetHandle === 'sink:sink', 'already-prefixed stream edge kept');

// ===========================================================================
// Loop groups (expandGroups)
// ===========================================================================
group('loop-group unroll');

function el(id, name, inst, props = {}) {
  return {
    id,
    type: 'gstElement',
    position: { x: 0, y: 0 },
    data: { elementName: name, instanceName: inst, properties: props },
  };
}
function varNode(id, varName, valueKind, value) {
  return {
    id,
    type: 'gstVariable',
    position: { x: 0, y: 0 },
    data: { varName, valueKind, value },
  };
}
function mkStreamEdge(id, src, dst, srcPad = 'src', sinkPad = 'sink') {
  return {
    id,
    source: src,
    target: dst,
    sourceHandle: `src:${srcPad}`,
    targetHandle: `sink:${sinkPad}`,
    data: { edgeKind: 'stream', sourcePad: srcPad, targetPad: sinkPad },
  };
}

// Three-instance fanout: vtee → flvmux+queue+rtmp2sink × 3 (the user's actual case)
function buildFanoutDef(locations) {
  const groupId = 'g_rtmp';
  return {
    id: 'pl_fanout',
    name: 'Fanout',
    nodes: [
      el('vtee', 'tee', 'vtee'),
      varNode('var_locs', 'locations', 'list', locations),
      // Group members — one prototype branch
      el('flv', 'flvmux', 'flvmux1', { streamable: true }),
      el('q', 'queue', 'queue1'),
      el('rtmp', 'rtmp2sink', 'rtmp2sink1', { location: '<placeholder>' }),
      // Group container — addressed by groupId, only the boundary handles matter
      {
        id: groupId,
        type: 'gstElement', // container is rendered separately; for the def shape we leave the
                            // container as a non-member element node to allow `def.edges` to
                            // reference it. (Renderer treats it as a `gstGroup` based on data.)
        position: { x: 0, y: 0 },
        data: { elementName: '__group__', instanceName: groupId, properties: {} },
      },
    ],
    edges: [
      // External edge: vtee → group container's "video_in" boundary handle
      {
        id: 'e_video',
        source: 'vtee',
        target: groupId,
        sourceHandle: 'src:src_%u',
        targetHandle: 'sink:video_in',
        data: { edgeKind: 'stream' },
      },
      // Internal edges between member nodes
      mkStreamEdge('e_flv_q', 'flv', 'q'),
      mkStreamEdge('e_q_rtmp', 'q', 'rtmp'),
    ],
    groups: [
      {
        id: groupId,
        name: 'RTMP Out',
        memberNodeIds: ['flv', 'q', 'rtmp'],
        iteratorVarId: 'var_locs',
        parameters: [{ targetNodeId: 'rtmp', propertyKey: 'location' }],
        boundary: [
          {
            handleId: 'sink:video_in',
            direction: 'sink',
            memberNodeId: 'flv',
            memberPadName: 'video',
          },
        ],
      },
    ],
  };
}

// Three-iteration case
{
  const def = buildFanoutDef(['rtmp://a/1', 'rtmp://b/2', 'rtmp://c/3']);
  const expanded = expandGroups(def);
  // Container + 3 prototype members should be gone; 3×3 = 9 cloned element nodes plus
  // the unchanged vtee and the variable node should remain.
  const elementClones = expanded.nodes.filter(
    (n) => n.type === 'gstElement' && n.data.elementName !== '__group__',
  );
  assert(elementClones.length === 10, `3-iter: cloned + non-group elements = 10 (got ${elementClones.length})`);
  // The original member nodes ('flv','q','rtmp') should not survive
  assert(
    !expanded.nodes.some((n) => n.id === 'flv' || n.id === 'q' || n.id === 'rtmp'),
    '3-iter: original member ids removed',
  );
  // Container should not survive
  assert(!expanded.nodes.some((n) => n.id === 'g_rtmp'), '3-iter: container removed');
  // Three cloned rtmp2sink nodes with location property set
  const rtmpClones = elementClones.filter(
    (n) => n.data.elementName === 'rtmp2sink',
  );
  assert(rtmpClones.length === 3, `3-iter: three rtmp2sink clones (got ${rtmpClones.length})`);
  const locations = rtmpClones.map((n) => n.data.properties.location).sort();
  assert(
    JSON.stringify(locations) === JSON.stringify(['rtmp://a/1', 'rtmp://b/2', 'rtmp://c/3']),
    '3-iter: each clone gets unique location',
  );
  // Instance names suffixed
  const muxClones = elementClones.filter((n) => n.data.elementName === 'flvmux');
  const muxNames = muxClones.map((n) => n.data.instanceName).sort();
  assert(
    JSON.stringify(muxNames) === JSON.stringify(['flvmux1_0', 'flvmux1_1', 'flvmux1_2']),
    '3-iter: flvmux instance names suffixed',
  );
  // Internal edges replicated: flv→q and q→rtmp per iteration = 6 total
  const internalReplicated = expanded.edges.filter(
    (e) => /__i\d+$/.test(e.id),
  );
  assert(internalReplicated.length === 6, `3-iter: 6 internal-edge clones (got ${internalReplicated.length})`);
  // Boundary edge expanded to 3 — one per iteration, each pointing at a flvmux clone
  const boundaryReplicated = expanded.edges.filter((e) => /__tgt\d+$/.test(e.id));
  assert(boundaryReplicated.length === 3, `3-iter: 3 boundary-edge clones (got ${boundaryReplicated.length})`);
  // Each boundary clone targets a flvmux clone with sink:video
  const targetsAllMux = boundaryReplicated.every(
    (e) => e.targetHandle === 'sink:video' && expanded.nodes.find((n) => n.id === e.target)?.data.elementName === 'flvmux',
  );
  assert(targetsAllMux, '3-iter: boundary edges land on flvmux.video');
  // Source side untouched so the parser auto-allocates fresh tee src pads
  const sourcesUntouched = boundaryReplicated.every((e) => e.source === 'vtee' && e.sourceHandle === 'src:src_%u');
  assert(sourcesUntouched, '3-iter: boundary edge sources kept (parser auto-allocates)');
}

// Zero-iteration case: empty list yields a no-op group (members dropped, edges dropped)
{
  const def = buildFanoutDef([]);
  const expanded = expandGroups(def);
  const elementClones = expanded.nodes.filter(
    (n) => n.type === 'gstElement' && n.data.elementName !== '__group__',
  );
  // Only the vtee element survives among element nodes
  assert(elementClones.length === 1, `0-iter: only outside element (vtee) survives (got ${elementClones.length})`);
  // Diagnostics flag empty iterator
  const diag = diagnoseGroups(def);
  assert(diag.some((m) => /empty iterator/i.test(m)), '0-iter: diagnoseGroups flags empty list');
}

// Missing iterator: throws GroupExpansionError
{
  const def = buildFanoutDef(['rtmp://a/1']);
  // Remove iterator var
  def.nodes = def.nodes.filter((n) => n.id !== 'var_locs');
  let threw = null;
  try {
    expandGroups(def);
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof GroupExpansionError, 'missing iterator: throws GroupExpansionError');
  // diagnoseGroups should surface a message, not throw
  const diag = diagnoseGroups(def);
  assert(diag.length >= 1, 'missing iterator: diagnoseGroups surfaces message');
}

// Non-list value: caught
{
  const def = buildFanoutDef(['rtmp://a/1']);
  // Replace the iterator var with a scalar
  const v = def.nodes.find((n) => n.id === 'var_locs');
  v.data.valueKind = 'string';
  v.data.value = 'rtmp://a/1';
  let threw = null;
  try {
    expandGroups(def);
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof GroupExpansionError, 'scalar iterator: throws GroupExpansionError');
}

// One-iteration: behaves like ungrouped (1 of each cloned element)
{
  const def = buildFanoutDef(['rtmp://only/one']);
  const expanded = expandGroups(def);
  const muxClones = expanded.nodes.filter((n) => n.type === 'gstElement' && n.data.elementName === 'flvmux');
  assert(muxClones.length === 1, `1-iter: one flvmux clone (got ${muxClones.length})`);
  const rtmpClones = expanded.nodes.filter((n) => n.type === 'gstElement' && n.data.elementName === 'rtmp2sink');
  assert(rtmpClones.length === 1, `1-iter: one rtmp2sink clone (got ${rtmpClones.length})`);
  assert(rtmpClones[0].data.properties.location === 'rtmp://only/one', '1-iter: location set to single list value');
  const boundary = expanded.edges.filter((e) => /__tgt0$/.test(e.id));
  assert(boundary.length === 1, '1-iter: one boundary clone edge');
}

// No groups: pass-through (deep copy semantics not required, but groups[] must be empty)
{
  const def = {
    id: 'pl', name: 'plain',
    nodes: [el('a', 'videotestsrc', 'src0'), el('b', 'autovideosink', 'sink0')],
    edges: [mkStreamEdge('e', 'a', 'b')],
  };
  const out = expandGroups(def);
  assert(out.nodes.length === 2, 'no-groups: nodes unchanged');
  assert(out.edges.length === 1, 'no-groups: edges unchanged');
  assert((out.groups || []).length === 0, 'no-groups: groups[] empty');
}

console.log('');
if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('all marketplace tests pass');
}
