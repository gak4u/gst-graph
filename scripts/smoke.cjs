// Minimal smoke test: load compiled electron modules and verify GStreamer parsing.
const path = require('path');
const { listElements, inspectElement, getGstVersion } = require(path.join(
  __dirname,
  '..',
  'dist-electron',
  'electron',
  'gst',
  'inspect.js',
));
const { buildCommand, buildArgs } = require(path.join(
  __dirname,
  '..',
  'dist-electron',
  'electron',
  'gst',
  'runner.js',
));
const { execFile } = require('node:child_process');

(async () => {
  const ver = await getGstVersion();
  console.log('GStreamer:', ver);

  const els = await listElements();
  console.log('Element count:', els.length);
  console.log('Sample:', els.slice(0, 3).map((e) => `${e.plugin}/${e.name}`));

  const targets = ['videotestsrc', 'videoconvert', 'autovideosink', 'fakesink', 'tee', 'queue'];
  for (const name of targets) {
    const d = await inspectElement(name);
    if (!d) {
      console.log(`[FAIL] ${name} not found`);
      continue;
    }
    const enums = d.properties.filter((p) => p.kind === 'enum').length;
    const bools = d.properties.filter((p) => p.kind === 'boolean').length;
    const ranges = d.properties.filter(
      (p) => ['integer', 'integer64', 'uinteger', 'uinteger64'].includes(p.kind),
    ).length;
    const conditional = d.properties.filter((p) => p.requires?.length);
    const srcPads = d.padTemplates.filter((p) => p.direction === 'src');
    const sinkPads = d.padTemplates.filter((p) => p.direction === 'sink');
    console.log(
      `${name}: props=${d.properties.length} enums=${enums} bools=${bools} ranges=${ranges} conditional=${conditional.length} src=${srcPads
        .map((p) => p.name)
        .join(',')} sink=${sinkPads.map((p) => p.name).join(',')}`,
    );
    for (const c of conditional) {
      console.log(
        `   • ${c.name} requires ${c.requires.map((r) => `${r.property}=[${r.values.join('|')}]`).join(' & ')}`,
      );
    }
  }

  // Sample build command
  const def = {
    id: 'p1',
    name: 'test',
    nodes: [
      {
        id: 'a',
        type: 'gstElement',
        position: { x: 0, y: 0 },
        data: {
          elementName: 'videotestsrc',
          instanceName: 'videotestsrc0',
          properties: { pattern: 'ball', 'num-buffers': 30, 'is-live': true },
        },
      },
      {
        id: 'b',
        type: 'gstElement',
        position: { x: 200, y: 0 },
        data: { elementName: 'videoconvert', instanceName: 'videoconvert0', properties: {} },
      },
      {
        id: 'c',
        type: 'gstElement',
        position: { x: 400, y: 0 },
        data: { elementName: 'autovideosink', instanceName: 'autovideosink0', properties: {} },
      },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'src:src', targetHandle: 'sink:sink' },
      { id: 'e2', source: 'b', target: 'c', sourceHandle: 'src:src', targetHandle: 'sink:sink' },
    ],
  };
  console.log('\nBuilt command:\n  ' + buildCommand(def));

  const capsDef = {
    id: 'p2',
    name: 'caps-test',
    nodes: [
      {
        id: 'a',
        type: 'gstElement',
        position: { x: 0, y: 0 },
        data: {
          elementName: 'videotestsrc',
          instanceName: 'src0',
          properties: { 'num-buffers': 10 },
        },
      },
      {
        id: 'b',
        type: 'gstElement',
        position: { x: 200, y: 0 },
        data: {
          elementName: 'capsfilter',
          instanceName: 'cf0',
          properties: { caps: 'video/x-raw,framerate=30/1,width=320,height=240' },
        },
      },
      {
        id: 'c',
        type: 'gstElement',
        position: { x: 400, y: 0 },
        data: { elementName: 'fakesink', instanceName: 'fs0', properties: {} },
      },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'src:src', targetHandle: 'sink:sink' },
      { id: 'e2', source: 'b', target: 'c', sourceHandle: 'src:src', targetHandle: 'sink:sink' },
    ],
  };
  console.log('\nCaps test argv:');
  console.log(JSON.stringify(buildArgs(capsDef), null, 2));
  console.log('Caps test display:');
  console.log('  ' + buildCommand(capsDef));

  // Variable binding test
  const varDef = {
    id: 'p3',
    name: 'var-test',
    nodes: [
      {
        id: 'v1',
        type: 'gstVariable',
        position: { x: 0, y: 0 },
        data: { varName: 'pat', valueKind: 'string', value: 'ball' },
      },
      {
        id: 'v2',
        type: 'gstVariable',
        position: { x: 0, y: 100 },
        data: { varName: 'frames', valueKind: 'number', value: 5 },
      },
      {
        id: 'a',
        type: 'gstElement',
        position: { x: 200, y: 0 },
        data: {
          elementName: 'videotestsrc',
          instanceName: 'vts',
          properties: { pattern: 'smpte' },
        },
      },
      {
        id: 'b',
        type: 'gstElement',
        position: { x: 400, y: 0 },
        data: { elementName: 'fakesink', instanceName: 'fs', properties: {} },
      },
    ],
    edges: [
      {
        id: 'b1',
        source: 'v1',
        target: 'a',
        sourceHandle: 'out',
        targetHandle: 'prop:pattern',
        data: { edgeKind: 'binding', bindingProperty: 'pattern' },
      },
      {
        id: 'b2',
        source: 'v2',
        target: 'a',
        sourceHandle: 'out',
        targetHandle: 'prop:num-buffers',
        data: { edgeKind: 'binding', bindingProperty: 'num-buffers' },
      },
      {
        id: 'e1',
        source: 'a',
        target: 'b',
        sourceHandle: 'src:src',
        targetHandle: 'sink:sink',
        data: { edgeKind: 'stream' },
      },
    ],
  };
  console.log('\nVariable binding argv:');
  console.log(JSON.stringify(buildArgs(varDef), null, 2));
  console.log('Display:');
  console.log('  ' + buildCommand(varDef));

  const mkNode = (id, elementName, instanceName, properties) => ({
    id,
    type: 'gstElement',
    position: { x: 0, y: 0 },
    data: { elementName, instanceName, properties },
  });
  const mkEdge = (src, tgt) => ({
    id: `e_${src}_${tgt}`,
    source: src,
    target: tgt,
    sourceHandle: 'src:src',
    targetHandle: 'sink:sink',
    data: { edgeKind: 'stream', sourcePad: 'src', targetPad: 'sink' },
  });
  const merge = {
    id: 'p4',
    name: 'merge-test',
    nodes: [
      mkNode('vs', 'videotestsrc', 'vts0', { 'num-buffers': 1 }),
      mkNode('mx', 'flvmux', 'flvmux0', {}),
      mkNode('as', 'audiotestsrc', 'ats0', { 'num-buffers': 1 }),
      mkNode('sink', 'fakesink', 'fs0', {}),
      { id: 'broken', type: 'gstElement', position: { x: 0, y: 0 }, data: { elementName: '', instanceName: '', properties: {} } },
    ],
    edges: [
      mkEdge('vs', 'mx'),
      mkEdge('as', 'mx'),
      mkEdge('mx', 'sink'),
      mkEdge('broken', 'sink'),
    ],
  };
  console.log('\nMerge with broken phantom node:');
  console.log('  ' + buildCommand(merge));
  console.log('  argv: ' + JSON.stringify(buildArgs(merge)));

  // Transform nodes: math + concat -> property
  const trans = {
    id: 'p5',
    name: 'transform-test',
    nodes: [
      {
        id: 'va',
        type: 'gstVariable',
        position: { x: 0, y: 0 },
        data: { varName: 'kbps', valueKind: 'number', value: 6 },
      },
      {
        id: 'vb',
        type: 'gstVariable',
        position: { x: 0, y: 50 },
        data: { varName: 'streamKey', valueKind: 'string', value: 'abcd-1234' },
      },
      {
        id: 'tm',
        type: 'gstTransform',
        position: { x: 150, y: 0 },
        data: {
          kind: 'math',
          inputs: [{ id: 'ia', name: 'a' }],
          expression: 'a * 1000',
        },
      },
      {
        id: 'tc',
        type: 'gstTransform',
        position: { x: 150, y: 100 },
        data: {
          kind: 'concat',
          inputs: [{ id: 'ic', name: 'k' }],
          expression: 'rtmp://srv/${k}',
        },
      },
      mkNode('vts', 'videotestsrc', 'vts0', { 'num-buffers': 1 }),
      mkNode('fs', 'fakesink', 'fs0', {}),
    ],
    edges: [
      // numeric flow: kbps -> math input a
      {
        id: 'em1',
        source: 'va',
        target: 'tm',
        sourceHandle: 'out',
        targetHandle: 'in:ia',
        data: { edgeKind: 'value', transformInputId: 'ia' },
      },
      // math out -> num-buffers on videotestsrc
      {
        id: 'em2',
        source: 'tm',
        target: 'vts',
        sourceHandle: 'out',
        targetHandle: 'prop:num-buffers',
        data: { edgeKind: 'binding', bindingProperty: 'num-buffers' },
      },
      // string flow: streamKey -> concat input k
      {
        id: 'ec1',
        source: 'vb',
        target: 'tc',
        sourceHandle: 'out',
        targetHandle: 'in:ic',
        data: { edgeKind: 'value', transformInputId: 'ic' },
      },
      // concat out -> fakesink's location property (just to test substitution)
      {
        id: 'ec2',
        source: 'tc',
        target: 'fs',
        sourceHandle: 'out',
        targetHandle: 'prop:location',
        data: { edgeKind: 'binding', bindingProperty: 'location' },
      },
      mkEdge('vts', 'fs'),
    ],
  };
  console.log('\nTransform nodes (math + concat):');
  console.log('  ' + buildCommand(trans));
  console.log('  argv: ' + JSON.stringify(buildArgs(trans)));

  // UI-shape scenario: 2 inputs as created by + Math button defaults.
  const uiShape = {
    id: 'p6',
    name: 'ui-shape',
    nodes: [
      {
        id: 'v1',
        type: 'gstVariable',
        position: { x: 0, y: 0 },
        data: { varName: 'a', valueKind: 'number', value: 4 },
      },
      {
        id: 'v2',
        type: 'gstVariable',
        position: { x: 0, y: 50 },
        data: { varName: 'b', valueKind: 'number', value: 7 },
      },
      {
        id: 'tm2',
        type: 'gstTransform',
        position: { x: 150, y: 0 },
        data: {
          kind: 'math',
          inputs: [
            { id: 'ia', name: 'a' },
            { id: 'ib', name: 'b' },
          ],
          expression: 'a + b',
        },
      },
      mkNode('vts', 'videotestsrc', 'vts0', { 'num-buffers': 1 }),
      mkNode('fs', 'fakesink', 'fs0', {}),
    ],
    edges: [
      {
        id: 'eA',
        source: 'v1',
        target: 'tm2',
        sourceHandle: 'out',
        targetHandle: 'in:ia',
        data: { edgeKind: 'value', transformInputId: 'ia' },
      },
      {
        id: 'eB',
        source: 'v2',
        target: 'tm2',
        sourceHandle: 'out',
        targetHandle: 'in:ib',
        data: { edgeKind: 'value', transformInputId: 'ib' },
      },
      {
        id: 'eBind',
        source: 'tm2',
        target: 'vts',
        sourceHandle: 'out',
        targetHandle: 'prop:num-buffers',
        data: { edgeKind: 'binding', bindingProperty: 'num-buffers' },
      },
      mkEdge('vts', 'fs'),
    ],
  };
  console.log('\nUI-shape transform (default 2 inputs, a+b):');
  console.log('  ' + buildCommand(uiShape));
  console.log('  argv: ' + JSON.stringify(buildArgs(uiShape)));

  // What if user did NOT pre-define the num-buffers property on the element?
  const noPreset = JSON.parse(JSON.stringify(uiShape));
  noPreset.id = 'p7';
  noPreset.nodes.find((n) => n.id === 'vts').data.properties = {}; // no preset
  console.log('\nUI-shape transform with no preset property:');
  console.log('  ' + buildCommand(noPreset));

  // Actually run it via gst-launch-1.0 to verify quoting is correct
  await new Promise((resolve) => {
    execFile('gst-launch-1.0', ['-e', ...buildArgs(capsDef)], (err, stdout, stderr) => {
      const ok = !err;
      console.log(`\nLive run (gst-launch-1.0): ${ok ? 'OK' : 'FAIL'}`);
      if (!ok) console.log(stderr.split('\n').slice(0, 5).join('\n'));
      else console.log(stdout.split('\n').filter(Boolean).slice(0, 3).join('\n'));
      resolve();
    });
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
