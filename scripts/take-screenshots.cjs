/* eslint-disable */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PROJECT = path.resolve(__dirname, '..');
const FAKE_HOME = path.join(os.tmpdir(), 'gst-graph-screenshots-home');
const DATA_DIR = path.join(FAKE_HOME, '.gst-graph');
const PIPELINES = path.join(DATA_DIR, 'pipelines.json');
const OUT_DIR = path.join(PROJECT, 'docs', 'screenshots');

function rid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function elementNode(name, instance, props, x, y) {
  return {
    id: rid('n'),
    type: 'gstElement',
    position: { x, y },
    data: { elementName: name, instanceName: instance, properties: props || {} },
  };
}
function variableNode(varName, label, valueKind, value, x, y, hidden) {
  return {
    id: rid('v'),
    type: 'gstVariable',
    position: { x, y },
    data: { varName, label, valueKind, value, hidden: !!hidden },
  };
}
function transformNode(kind, label, inputs, expression, x, y) {
  return {
    id: rid('t'),
    type: 'gstTransform',
    position: { x, y },
    data: { kind, label, inputs, expression },
  };
}
function streamEdge(source, target) {
  return {
    id: rid('e'),
    source,
    target,
    sourceHandle: 'src',
    targetHandle: 'sink',
    data: { sourcePad: 'src', targetPad: 'sink', edgeKind: 'stream' },
  };
}
function bindingEdge(source, target, property) {
  return {
    id: rid('e'),
    source,
    target,
    sourceHandle: 'out',
    targetHandle: `prop:${property}`,
    data: { bindingProperty: property, edgeKind: 'binding' },
    className: 'binding',
  };
}
function transformInputEdge(source, target, inputId) {
  return {
    id: rid('e'),
    source,
    target,
    sourceHandle: 'out',
    targetHandle: `in:${inputId}`,
    data: { transformInputId: inputId, edgeKind: 'value' },
    className: 'value',
  };
}

function buildLivePipeline() {
  const host = variableNode('host', 'RTMP Host', 'string', 'live.example.com', 60, 80);
  const key = variableNode('streamKey', 'Stream Key', 'string', 'demo-secret-key', 60, 200);
  const bitrate = variableNode('kbps', 'Video Bitrate (kbps)', 'number', 2500, 60, 320);
  const audio = variableNode('audioKbps', 'Audio Bitrate (kbps)', 'number', 128, 60, 440, true);

  const url = transformNode(
    'concat',
    'RTMP URL',
    [
      { id: rid('i'), name: 'host' },
      { id: rid('i'), name: 'key' },
    ],
    'rtmp://${host}/live/${key}',
    320,
    140,
  );
  const bps = transformNode(
    'math',
    'Video bps',
    [{ id: rid('i'), name: 'kbps' }],
    'kbps * 1000',
    320,
    320,
  );

  const src = elementNode('videotestsrc', 'videotestsrc0', { pattern: 'smpte', 'is-live': true }, 620, 120);
  const conv = elementNode('videoconvert', 'videoconvert0', {}, 820, 120);
  const enc = elementNode('x264enc', 'x264enc0', { 'tune': 'zerolatency', bitrate: 2500 }, 1000, 120);
  const mux = elementNode('flvmux', 'flvmux0', { streamable: true }, 1200, 200);
  const aac = elementNode('voaacenc', 'voaacenc0', { bitrate: 128000 }, 1000, 320);
  const asrc = elementNode('audiotestsrc', 'audiotestsrc0', { 'is-live': true, wave: 'sine' }, 620, 320);
  const sink = elementNode('rtmpsink', 'rtmpsink0', { location: 'rtmp://example/live/stream' }, 1400, 200);

  return {
    id: rid('pl'),
    name: 'RTMP Livestream',
    nodes: [host, key, bitrate, audio, url, bps, src, conv, enc, mux, aac, asrc, sink],
    edges: [
      streamEdge(src.id, conv.id),
      streamEdge(conv.id, enc.id),
      streamEdge(enc.id, mux.id),
      streamEdge(asrc.id, aac.id),
      streamEdge(aac.id, mux.id),
      streamEdge(mux.id, sink.id),
      transformInputEdge(host.id, url.id, url.data.inputs[0].id),
      transformInputEdge(key.id, url.id, url.data.inputs[1].id),
      transformInputEdge(bitrate.id, bps.id, bps.data.inputs[0].id),
      bindingEdge(url.id, sink.id, 'location'),
      bindingEdge(bps.id, enc.id, 'bitrate'),
      bindingEdge(audio.id, aac.id, 'bitrate'),
    ],
  };
}

function buildTranscodePipeline() {
  const input = variableNode('inputPath', 'Input File', 'string', '/tmp/clip.mp4', 60, 100);
  const output = variableNode('outputPath', 'Output File', 'string', '/tmp/out.webm', 60, 220);
  const crf = variableNode('crf', 'Quality (CRF)', 'number', 32, 60, 340);

  const src = elementNode('filesrc', 'filesrc0', { location: '/tmp/clip.mp4' }, 360, 140);
  const decode = elementNode('decodebin', 'decodebin0', {}, 540, 140);
  const conv = elementNode('videoconvert', 'videoconvert0', {}, 720, 140);
  const enc = elementNode('vp9enc', 'vp9enc0', { 'cpu-used': 4 }, 900, 140);
  const mux = elementNode('webmmux', 'webmmux0', {}, 1080, 200);
  const sink = elementNode('filesink', 'filesink0', { location: '/tmp/out.webm' }, 1260, 200);

  return {
    id: rid('pl'),
    name: 'File Transcode (MP4 → WebM)',
    nodes: [input, output, crf, src, decode, conv, enc, mux, sink],
    edges: [
      streamEdge(src.id, decode.id),
      streamEdge(decode.id, conv.id),
      streamEdge(conv.id, enc.id),
      streamEdge(enc.id, mux.id),
      streamEdge(mux.id, sink.id),
      bindingEdge(input.id, src.id, 'location'),
      bindingEdge(output.id, sink.id, 'location'),
    ],
  };
}

function buildPreviewPipeline() {
  const pattern = variableNode('pattern', 'Test pattern', 'string', 'ball', 60, 100);
  const fps = variableNode('fps', 'Framerate', 'number', 30, 60, 220);
  const src = elementNode('videotestsrc', 'videotestsrc0', { pattern: 'ball', 'is-live': true }, 320, 140);
  const conv = elementNode('videoconvert', 'videoconvert0', {}, 520, 140);
  const sink = elementNode('autovideosink', 'autovideosink0', { sync: true }, 720, 140);
  return {
    id: rid('pl'),
    name: 'Preview (videotestsrc → autovideosink)',
    nodes: [pattern, fps, src, conv, sink],
    edges: [
      streamEdge(src.id, conv.id),
      streamEdge(conv.id, sink.id),
      bindingEdge(pattern.id, src.id, 'pattern'),
    ],
  };
}

(async () => {
  fs.rmSync(FAKE_HOME, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Prime the fake HOME's plugin cache from the real one to avoid a slow
  // first-run gst-inspect (saves ~20s and lets the marketplace render with
  // accurate compatibility data).
  const realCache = path.join(os.homedir(), '.gst-graph', 'plugin-cache.json');
  if (fs.existsSync(realCache)) {
    fs.copyFileSync(realCache, path.join(DATA_DIR, 'plugin-cache.json'));
  }

  const fixture = {
    pipelines: [buildLivePipeline(), buildTranscodePipeline(), buildPreviewPipeline()],
  };
  fs.writeFileSync(PIPELINES, JSON.stringify(fixture, null, 2));

  const electronBin = path.join(PROJECT, 'node_modules', '.bin', 'electron');
  const env = {
    ...process.env,
    HOME: FAKE_HOME,
    USERPROFILE: FAKE_HOME,
    GST_GRAPH_SCREENSHOTS_DIR: OUT_DIR,
    ELECTRON_DISABLE_GPU: '1',
  };

  console.log('[screenshots] launching electron with HOME=' + FAKE_HOME);
  const child = spawn(electronBin, ['.'], { cwd: PROJECT, env, stdio: 'inherit' });
  const exitCode = await new Promise((resolve) => child.on('exit', (code) => resolve(code)));

  fs.rmSync(FAKE_HOME, { recursive: true, force: true });

  if (exitCode !== 0) {
    console.error('[screenshots] electron exit code:', exitCode);
    process.exit(exitCode || 1);
  }

  const produced = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.png'));
  console.log('[screenshots] produced:', produced);
})();
