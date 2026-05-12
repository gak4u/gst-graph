import type {
  CompatibilityIssue,
  CompatibilityReport,
  PackageElementRequirement,
  PackageManifest,
} from './marketplace';

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestParseError';
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ManifestParseError(`${ctx}: expected non-empty string field "${key}"`);
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new ManifestParseError(`expected string field "${key}", got ${typeof v}`);
  }
  return v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseElementList(
  raw: unknown,
  ctx: string,
): PackageElementRequirement[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ManifestParseError(`${ctx}: expected an array`);
  }
  const out: PackageElementRequirement[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry === 'string') {
      out.push({ name: entry });
      continue;
    }
    if (!isPlainObject(entry)) {
      throw new ManifestParseError(`${ctx}[${i}]: expected string or object`);
    }
    const name = requireString(entry, 'name', `${ctx}[${i}]`);
    const rationale = optionalString(entry, 'rationale');
    out.push({ name, rationale });
  }
  return out;
}

export function parseManifest(input: unknown, sourceLabel = 'gst-package.json'): PackageManifest {
  if (!isPlainObject(input)) {
    throw new ManifestParseError(`${sourceLabel}: root must be a JSON object`);
  }
  const schemaVersion = input.schemaVersion;
  if (schemaVersion !== 1) {
    throw new ManifestParseError(
      `${sourceLabel}: schemaVersion must be 1 (got ${JSON.stringify(schemaVersion)})`,
    );
  }

  const id = requireString(input, 'id', sourceLabel);
  if (!ID_PATTERN.test(id)) {
    throw new ManifestParseError(
      `${sourceLabel}: id must match [a-z0-9][a-z0-9._-]* (got ${JSON.stringify(id)})`,
    );
  }
  const name = requireString(input, 'name', sourceLabel);
  const version = requireString(input, 'version', sourceLabel);
  if (!/^\d+\.\d+\.\d+(?:[-+.][\w.-]+)?$/.test(version)) {
    throw new ManifestParseError(
      `${sourceLabel}: version must be semver-ish (got ${JSON.stringify(version)})`,
    );
  }

  const summary = optionalString(input, 'summary');
  const description = optionalString(input, 'description');
  const preview = optionalString(input, 'preview');
  const license = optionalString(input, 'license');

  let author: PackageManifest['author'];
  if (input.author !== undefined && input.author !== null) {
    if (!isPlainObject(input.author)) {
      throw new ManifestParseError(`${sourceLabel}: author must be an object`);
    }
    author = {
      name: optionalString(input.author, 'name'),
      url: optionalString(input.author, 'url'),
    };
  }

  let tags: string[] | undefined;
  if (input.tags !== undefined && input.tags !== null) {
    if (!Array.isArray(input.tags) || !input.tags.every((t) => typeof t === 'string')) {
      throw new ManifestParseError(`${sourceLabel}: tags must be an array of strings`);
    }
    tags = input.tags as string[];
  }

  let requires: PackageManifest['requires'];
  if (input.requires !== undefined && input.requires !== null) {
    if (!isPlainObject(input.requires)) {
      throw new ManifestParseError(`${sourceLabel}: requires must be an object`);
    }
    requires = {
      gstreamer: optionalString(input.requires, 'gstreamer'),
      elements: parseElementList(input.requires.elements, `${sourceLabel}: requires.elements`),
    };
  }

  let optional: PackageManifest['optional'];
  if (input.optional !== undefined && input.optional !== null) {
    if (!isPlainObject(input.optional)) {
      throw new ManifestParseError(`${sourceLabel}: optional must be an object`);
    }
    optional = {
      elements: parseElementList(input.optional.elements, `${sourceLabel}: optional.elements`),
    };
  }

  if (!Array.isArray(input.pipelines) || input.pipelines.length === 0) {
    throw new ManifestParseError(`${sourceLabel}: pipelines must be a non-empty array`);
  }
  const pipelines: PackageManifest['pipelines'] = [];
  for (let i = 0; i < input.pipelines.length; i++) {
    const entry = input.pipelines[i];
    if (!isPlainObject(entry)) {
      throw new ManifestParseError(`${sourceLabel}: pipelines[${i}] must be an object`);
    }
    const file = requireString(entry, 'file', `${sourceLabel}: pipelines[${i}]`);
    if (file.includes('..') || file.startsWith('/')) {
      throw new ManifestParseError(
        `${sourceLabel}: pipelines[${i}].file must be a relative path inside the package (got ${JSON.stringify(file)})`,
      );
    }
    pipelines.push({ file, name: optionalString(entry, 'name') });
  }

  let variables: PackageManifest['variables'];
  if (input.variables !== undefined && input.variables !== null) {
    if (!Array.isArray(input.variables)) {
      throw new ManifestParseError(`${sourceLabel}: variables must be an array`);
    }
    variables = [];
    for (let i = 0; i < input.variables.length; i++) {
      const entry = input.variables[i];
      if (!isPlainObject(entry)) {
        throw new ManifestParseError(`${sourceLabel}: variables[${i}] must be an object`);
      }
      const varName = requireString(entry, 'varName', `${sourceLabel}: variables[${i}]`);
      const label = optionalString(entry, 'label');
      const description = optionalString(entry, 'description');
      const secret = entry.secret === undefined ? undefined : Boolean(entry.secret);
      const rawDefault = entry.default;
      let def: string | number | boolean | null | undefined;
      if (
        rawDefault === undefined ||
        rawDefault === null ||
        typeof rawDefault === 'string' ||
        typeof rawDefault === 'number' ||
        typeof rawDefault === 'boolean'
      ) {
        def = rawDefault as typeof def;
      } else {
        throw new ManifestParseError(
          `${sourceLabel}: variables[${i}].default must be string|number|boolean|null`,
        );
      }
      variables.push({ varName, label, description, default: def, secret });
    }
  }

  return {
    schemaVersion: 1,
    id,
    name,
    version,
    summary,
    description,
    author,
    tags,
    license,
    preview,
    requires,
    optional,
    pipelines,
    variables,
  };
}

export interface CompatibilityInput {
  installedElements: Iterable<string>;
  installedGstreamerVersion?: string;
}

export function normalizeGstreamerVersion(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : undefined;
}

interface SemverPart {
  major: number;
  minor: number;
  patch: number;
}

function parseSemverLoose(version: string): SemverPart | null {
  const m = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: m[2] ? Number(m[2]) : 0,
    patch: m[3] ? Number(m[3]) : 0,
  };
}

export function compareSemverLoose(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemverLoose(a);
  const pb = parseSemverLoose(b);
  if (!pa || !pb) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

const RANGE_PATTERN = /^\s*(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})\s*$/;

export function satisfiesRange(version: string, range: string): boolean {
  const clauses = range.trim().split(/\s+/);
  for (const clause of clauses) {
    const m = clause.match(RANGE_PATTERN);
    if (!m) return false;
    const op = (m[1] || '=') as '>=' | '<=' | '>' | '<' | '=';
    const target = m[2];
    const cmp = compareSemverLoose(version, target);
    let ok = false;
    switch (op) {
      case '>=':
        ok = cmp >= 0;
        break;
      case '<=':
        ok = cmp <= 0;
        break;
      case '>':
        ok = cmp > 0;
        break;
      case '<':
        ok = cmp < 0;
        break;
      case '=':
        ok = cmp === 0;
        break;
    }
    if (!ok) return false;
  }
  return true;
}

export function checkCompatibility(
  manifest: PackageManifest,
  input: CompatibilityInput,
): CompatibilityReport {
  const have = new Set<string>();
  for (const name of input.installedElements) have.add(name);

  const missingRequired: CompatibilityIssue[] = [];
  for (const req of manifest.requires?.elements ?? []) {
    if (!have.has(req.name)) {
      missingRequired.push({
        kind: 'missing_element',
        name: req.name,
        detail: req.rationale,
      });
    }
  }

  const missingOptional: CompatibilityIssue[] = [];
  for (const opt of manifest.optional?.elements ?? []) {
    if (!have.has(opt.name)) {
      missingOptional.push({
        kind: 'missing_optional_element',
        name: opt.name,
        detail: opt.rationale,
      });
    }
  }

  let gstreamerOk = true;
  let gstreamerNote: string | undefined;
  const range = manifest.requires?.gstreamer;
  if (range) {
    const installed = normalizeGstreamerVersion(input.installedGstreamerVersion);
    if (!installed) {
      gstreamerOk = false;
      gstreamerNote = `GStreamer version unknown; package requires ${range}`;
    } else if (!satisfiesRange(installed, range)) {
      gstreamerOk = false;
      gstreamerNote = `Installed GStreamer ${installed} does not satisfy ${range}`;
    } else {
      gstreamerNote = `GStreamer ${installed} satisfies ${range}`;
    }
  }

  const compatible = missingRequired.length === 0 && gstreamerOk;
  return { compatible, missingRequired, missingOptional, gstreamerOk, gstreamerNote };
}
