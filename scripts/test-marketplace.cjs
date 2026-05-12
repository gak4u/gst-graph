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

console.log('');
if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('all marketplace tests pass');
}
