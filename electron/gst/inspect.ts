import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  GstElementDetail,
  GstElementSummary,
  GstPropertyDef,
  GstPropertyKind,
  GstPropertyRequirement,
  GstPadTemplate,
  GstCapsStruct,
  GstEnumValue,
} from '../../shared/types';

const execFileAsync = promisify(execFile);

const GST_INSPECT = process.env.GST_INSPECT_BIN || 'gst-inspect-1.0';

async function runInspect(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GST_INSPECT, args, {
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
  });
  return stdout;
}

export async function getGstVersion(): Promise<string> {
  try {
    const out = await runInspect(['--gst-version']);
    return out.trim();
  } catch {
    return 'unknown';
  }
}

export async function listElements(): Promise<GstElementSummary[]> {
  const out = await runInspect([]);
  const lines = out.split('\n');
  const elements: GstElementSummary[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith('Total count:')) break;
    const m = line.match(/^([^\s:]+):\s+([^:]+):\s*(.*)$/);
    if (!m) continue;
    const [, plugin, name, description] = m;
    if (name.includes(' ')) continue;
    elements.push({
      name: name.trim(),
      longName: description.trim(),
      klass: '',
      description: description.trim(),
      plugin: plugin.trim(),
      rank: 0,
    });
  }
  const seen = new Set<string>();
  return elements.filter((e) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

function detectKind(typeLine: string): { kind: GstPropertyKind; typeName: string } {
  const t = typeLine.trim();
  if (/^Boolean\./i.test(t)) return { kind: 'boolean', typeName: 'Boolean' };
  if (/^Enum\b/i.test(t)) return { kind: 'enum', typeName: 'Enum' };
  if (/^Flags\b/i.test(t)) return { kind: 'flags', typeName: 'Flags' };
  if (/^Unsigned Integer64\./i.test(t)) return { kind: 'uinteger64', typeName: 'UInt64' };
  if (/^Integer64\./i.test(t)) return { kind: 'integer64', typeName: 'Int64' };
  if (/^Unsigned Integer\./i.test(t)) return { kind: 'uinteger', typeName: 'UInt' };
  if (/^Integer\./i.test(t)) return { kind: 'integer', typeName: 'Int' };
  if (/^Float\./i.test(t)) return { kind: 'float', typeName: 'Float' };
  if (/^Double\./i.test(t)) return { kind: 'double', typeName: 'Double' };
  if (/^String\./i.test(t)) return { kind: 'string', typeName: 'String' };
  if (/^Fraction\./i.test(t)) return { kind: 'fraction', typeName: 'Fraction' };
  if (/^Object of type/i.test(t)) return { kind: 'object', typeName: 'Object' };
  return { kind: 'other', typeName: t.split('.')[0] || 'Other' };
}

function parseRangeAndDefault(line: string): { min?: string; max?: string; def?: string } {
  const out: { min?: string; max?: string; def?: string } = {};
  const r = line.match(/Range:\s*(\S+)\s*-\s*(\S+)/);
  if (r) {
    out.min = r[1];
    out.max = r[2];
  }
  const d = line.match(/Default:\s*("[^"]*"|\S+)/);
  if (d) out.def = d[1].replace(/^"|"$/g, '');
  return out;
}

function mergeRequirements(list: GstPropertyRequirement[]): GstPropertyRequirement[] {
  const merged = new Map<string, Set<string>>();
  for (const c of list) {
    if (!merged.has(c.property)) merged.set(c.property, new Set());
    for (const v of c.values) merged.get(c.property)!.add(v);
  }
  return Array.from(merged, ([property, values]) => ({ property, values: Array.from(values) }));
}

const CONDITIONAL_CLAUSE = new RegExp(
  [
    '\\bonly\\s+(?:used|applies|applicable|valid|effective|in\\s+effect|considered|honou?red|works|relevant)\\b',
    '\\b(?:used|applies|applicable|valid|effective|considered|honou?red|works|relevant)\\s+only\\b',
    '\\brequire(?:s|d)\\b',
    '\\bdepends?\\s+on\\b',
    '\\bn/a\\s+(?:if|unless)\\b',
    '\\bonly\\s+(?:if|when|with|for|by)\\b',
  ].join('|'),
  'i',
);

const PROP_EQ_RE =
  /["']?([a-zA-Z][\w-]+)["']?\s*=\s*["']?([a-zA-Z0-9][\w-]*)["']?/g;
const PROP_IS_RE =
  /["']?([a-zA-Z][\w-]+)["']?\s+is(?:\s+set\s+to)?\s+["']?([a-zA-Z0-9][\w-]*)["']?/gi;

const STOP_VALUES = new Set([
  'true', 'false', 'greater', 'less', 'than', 'set', 'a', 'an', 'the', 'nonzero',
  'zero', 'not', 'and', 'or', 'but', 'used', 'only', 'enabled', 'disabled',
  'valid', 'applicable', 'value', 'values',
]);
const RESERVED_PROPS = new Set([
  'this', 'it', 'there', 'that', 'what', 'such', 'these', 'those', 'we', 'they', 'i',
]);

function pushReq(out: GstPropertyRequirement[], prop: string, val: string): void {
  const property = prop.toLowerCase();
  if (RESERVED_PROPS.has(property)) return;
  if (!/[a-z]/.test(property)) return;
  const value = val.trim();
  if (!value) return;
  out.push({ property, values: [/^(?:true|false)$/i.test(value) ? value.toLowerCase() : value] });
}

function parseRequirementsFromBlurb(blurb: string): GstPropertyRequirement[] {
  if (!blurb) return [];
  const out: GstPropertyRequirement[] = [];

  const forMatch = blurb.match(/^\s*For\s+(.+?)(?:[.;]|$)/i);
  if (forMatch) {
    const part = forMatch[1];
    for (const m of part.matchAll(PROP_EQ_RE)) pushReq(out, m[1], m[2]);
  }

  for (const clauseRaw of blurb.split(/[.;]/)) {
    const clause = clauseRaw.trim();
    if (!clause) continue;
    if (!CONDITIONAL_CLAUSE.test(clause)) continue;
    PROP_EQ_RE.lastIndex = 0;
    for (const m of clause.matchAll(PROP_EQ_RE)) {
      if (STOP_VALUES.has(m[2].toLowerCase())) {
        if (!/^(?:true|false)$/i.test(m[2])) continue;
      }
      pushReq(out, m[1], m[2]);
    }
    PROP_IS_RE.lastIndex = 0;
    for (const m of clause.matchAll(PROP_IS_RE)) {
      const val = m[2];
      if (STOP_VALUES.has(val.toLowerCase()) && !/^(?:true|false)$/i.test(val)) continue;
      pushReq(out, m[1], val);
    }
    const fuzzy = clause.matchAll(
      /\b(?:used|applies|applicable|valid|effective)\s+only\s+(?:by|with|in)\s+([A-Z][A-Z0-9_]{1,}|[a-z][a-z0-9_-]{1,})(?:\s+mode)?\b/g,
    );
    for (const m of fuzzy) {
      out.push({ property: '*fuzzy', values: [m[1]] });
    }
  }

  return mergeRequirements(out);
}

function fuzzyResolveEnum(
  detail: GstElementDetail,
  raw: string,
  contextPropName: string,
): { propName: string; nick: string } | null {
  const variations = new Set<string>();
  const lower = raw.toLowerCase();
  variations.add(lower);
  variations.add(lower.replace(/_/g, '-'));
  const parts = lower.split(/[_-]/).filter(Boolean);
  for (const part of parts) variations.add(part);
  if (parts.length >= 2) variations.add(parts.slice(1).join('-'));
  if (parts.length >= 2) variations.add(parts.slice(-1)[0]);

  const contextTokens = contextPropName.toLowerCase().split(/[_-]/).filter((t) => t.length >= 3);
  const candidates: Array<{ propName: string; nick: string; score: number }> = [];

  for (const prop of detail.properties) {
    if (prop.kind !== 'enum') continue;
    for (const ev of prop.enumValues || []) {
      if (!variations.has(ev.nick.toLowerCase())) continue;
      let score = 0;
      const propTokens = prop.name.toLowerCase().split(/[_-]/);
      for (const t of contextTokens) if (propTokens.includes(t)) score += 10;
      if (/mode|type|method|format/i.test(prop.name)) score += 1;
      candidates.push({ propName: prop.name, nick: ev.nick, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { propName: candidates[0].propName, nick: candidates[0].nick };
}

function validateRequirements(detail: GstElementDetail): void {
  const propIndex = new Map(detail.properties.map((p) => [p.name.toLowerCase(), p]));
  for (const p of detail.properties) {
    if (!p.requires?.length) continue;
    const kept: GstPropertyRequirement[] = [];
    for (const req of p.requires) {
      if (req.property === '*fuzzy') {
        for (const candidate of req.values) {
          const hit = fuzzyResolveEnum(detail, candidate, p.name);
          if (hit && hit.propName !== p.name) {
            kept.push({ property: hit.propName, values: [hit.nick] });
          }
        }
        continue;
      }
      if (req.property === p.name.toLowerCase()) continue;
      const ref = propIndex.get(req.property);
      if (!ref) continue;
      const valid: string[] = [];
      for (const v of req.values) {
        const lv = v.toLowerCase();
        if (ref.kind === 'boolean') {
          if (lv === 'true' || lv === 'false') valid.push(lv);
        } else if (ref.kind === 'enum') {
          const nick = ref.enumValues?.find(
            (e) => e.nick.toLowerCase() === lv || String(e.value) === lv,
          )?.nick;
          if (nick) valid.push(nick);
        } else if (ref.kind === 'flags') {
          const nick = ref.flagValues?.find(
            (e) => e.nick.toLowerCase() === lv || String(e.value) === lv,
          )?.nick;
          if (nick) valid.push(nick);
        } else if (ref.kind === 'string') {
          valid.push(v);
        }
      }
      if (valid.length) kept.push({ property: ref.name, values: Array.from(new Set(valid)) });
    }
    const merged = new Map<string, Set<string>>();
    for (const k of kept) {
      if (!merged.has(k.property)) merged.set(k.property, new Set());
      for (const v of k.values) merged.get(k.property)!.add(v);
    }
    p.requires = merged.size
      ? Array.from(merged, ([property, values]) => ({ property, values: Array.from(values) }))
      : undefined;
  }
}

function parsePropertyBlock(name: string, blurb: string, body: string[]): GstPropertyDef {
  const flagsLine = body.find((l) => /^\s*flags:/i.test(l)) || '';
  const flags = flagsLine.replace(/^\s*flags:/i, '').trim();
  const readable = /readable/.test(flags);
  const writable = /writable/.test(flags);
  const controllable = /controllable/.test(flags);
  const deprecated = /deprecated/.test(flags);

  const typeLineIdx = body.findIndex(
    (l) =>
      !/^\s*flags:/i.test(l) &&
      (/^\s*(Boolean|Enum|Flags|Integer|Unsigned Integer|Integer64|Unsigned Integer64|Float|Double|String|Fraction|Object of type)/.test(
        l,
      )),
  );
  const typeLine = typeLineIdx >= 0 ? body[typeLineIdx].trim() : '';
  const { kind, typeName } = detectKind(typeLine);
  const { min, max, def } = parseRangeAndDefault(typeLine);

  let enumValues: GstEnumValue[] | undefined;
  let flagValues: GstEnumValue[] | undefined;

  if (kind === 'enum' || kind === 'flags') {
    const collected: GstEnumValue[] = [];
    for (let i = typeLineIdx + 1; i < body.length; i++) {
      const l = body[i];
      const m = l.match(/^\s*\(\s*(0x[0-9a-fA-F]+|-?\d+)\s*\)\s*:\s*([^\s-]+)\s*-?\s*(.*)$/);
      if (m) {
        const v = m[1].startsWith('0x') ? parseInt(m[1], 16) : parseInt(m[1], 10);
        collected.push({ value: v, nick: m[2].trim(), desc: m[3].trim() });
      }
    }
    if (kind === 'enum') enumValues = collected;
    else flagValues = collected;
  }

  let defaultValue = def ?? '';
  if (kind === 'enum') {
    const dm = typeLine.match(/Default:\s*(\d+)\s*,\s*"([^"]+)"/);
    if (dm) defaultValue = dm[2];
  }

  const requires = parseRequirementsFromBlurb(blurb);
  return {
    name,
    blurb: blurb.trim(),
    kind,
    typeName,
    readable,
    writable,
    controllable,
    deprecated,
    defaultValue,
    min,
    max,
    enumValues,
    flagValues,
    requires: requires.length ? requires : undefined,
  };
}

function parseProperties(section: string[]): GstPropertyDef[] {
  const props: GstPropertyDef[] = [];
  let i = 0;
  while (i < section.length) {
    const line = section[i];
    const m = line.match(/^\s{2}([a-zA-Z][\w\-]*)\s*:\s*(.*)$/);
    if (m && !/^\s{4,}/.test(line)) {
      const name = m[1];
      const blurb = m[2];
      const body: string[] = [];
      i++;
      while (i < section.length) {
        const l = section[i];
        if (/^\s{2}[a-zA-Z][\w\-]*\s*:/.test(l) && !/^\s{4,}/.test(l)) break;
        if (/^\S/.test(l) && l.trim() !== '') break;
        body.push(l);
        i++;
      }
      props.push(parsePropertyBlock(name, blurb, body));
      continue;
    }
    i++;
  }
  return props;
}

function parseCapsBlock(block: string[]): GstCapsStruct[] {
  const result: GstCapsStruct[] = [];
  let current: GstCapsStruct | null = null;
  for (const raw of block) {
    const line = raw.replace(/\s+$/g, '');
    if (!line.trim()) continue;
    const mediaMatch = line.match(/^\s{6}([a-zA-Z][\w\-\/\.\+]+)\s*$/);
    if (mediaMatch) {
      if (current) result.push(current);
      current = { media: mediaMatch[1].trim(), fields: {} };
      continue;
    }
    const fieldMatch = line.match(/^\s{17,}([a-zA-Z][\w\-]*)\s*:\s*(.*)$/);
    if (fieldMatch && current) {
      current.fields[fieldMatch[1]] = fieldMatch[2].trim();
      continue;
    }
  }
  if (current) result.push(current);
  return result;
}

function parsePadTemplates(section: string[]): GstPadTemplate[] {
  const pads: GstPadTemplate[] = [];
  let i = 0;
  while (i < section.length) {
    const line = section[i];
    const m = line.match(/^\s{2}(SRC|SINK)\s+template:\s*'([^']+)'/i);
    if (m) {
      const direction = (m[1].toLowerCase() === 'src' ? 'src' : 'sink') as 'src' | 'sink';
      const name = m[2];
      let availability: GstPadTemplate['availability'] = 'always';
      const block: string[] = [];
      i++;
      while (i < section.length) {
        const l = section[i];
        if (/^\s{2}(SRC|SINK)\s+template:/i.test(l)) break;
        if (/^\S/.test(l) && l.trim() !== '') break;
        const avail = l.match(/^\s{4}Availability:\s*(\w+)/i);
        if (avail) {
          const v = avail[1].toLowerCase();
          availability =
            v === 'always' ? 'always' : v === 'sometimes' ? 'sometimes' : 'request';
        }
        block.push(l);
        i++;
      }
      const caps = parseCapsBlock(block);
      pads.push({
        name,
        direction,
        availability,
        caps,
        capsRaw: block.join('\n'),
      });
      continue;
    }
    i++;
  }
  return pads;
}

function extractSection(lines: string[], header: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.startsWith(header)) {
      inside = true;
      continue;
    }
    if (inside) {
      if (/^[A-Z][^\n]*:$/.test(line) && !line.startsWith(' ')) {
        break;
      }
      if (/^\S/.test(line) && line.trim() !== '' && !line.startsWith(header)) {
        break;
      }
      out.push(line);
    }
  }
  return out;
}

export async function inspectElement(name: string): Promise<GstElementDetail | null> {
  let stdout: string;
  try {
    stdout = await runInspect([name]);
  } catch {
    return null;
  }
  const lines = stdout.split('\n');

  const longName = (lines.find((l) => /^\s+Long-name\s+/.test(l)) || '').replace(/^\s+Long-name\s+/, '').trim();
  const klass = (lines.find((l) => /^\s+Klass\s+/.test(l)) || '').replace(/^\s+Klass\s+/, '').trim();
  const description = (lines.find((l) => /^\s+Description\s+/.test(l)) || '').replace(/^\s+Description\s+/, '').trim();
  const plugin = (lines.find((l) => /^\s+Name\s+/.test(l)) || '').replace(/^\s+Name\s+/, '').trim();
  const rankLine = (lines.find((l) => /^\s+Rank\s+/.test(l)) || '').replace(/^\s+Rank\s+/, '').trim();
  const rank = parseInt((rankLine.match(/\((\d+)\)/) || [, '0'])[1], 10);

  const hierarchy: string[] = [];
  for (const l of lines) {
    const hm = l.match(/^\s*\+----(.+)$/);
    if (hm) hierarchy.push(hm[1].trim());
  }

  const padSection = extractSection(lines, 'Pad Templates:');
  const propsSection = extractSection(lines, 'Element Properties:');

  const detail: GstElementDetail = {
    name,
    longName: longName || name,
    klass,
    description,
    plugin,
    rank,
    hierarchy,
    padTemplates: parsePadTemplates(padSection),
    properties: parseProperties(propsSection),
  };
  validateRequirements(detail);
  return detail;
}
