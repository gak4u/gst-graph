import type { GstCapsStruct } from '../../shared/types';

const ANY = 'ANY';

export function parseField(value: string): string[] | string {
  const trimmed = value.trim();
  const listMatch = trimmed.match(/^\{(.+)\}/s);
  if (listMatch) {
    return listMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^\(string\)/, '').replace(/^"|"$/g, ''));
  }
  return trimmed.replace(/^\(string\)/, '').replace(/^"|"$/g, '');
}

function mediaMatch(a: string, b: string): boolean {
  if (a === ANY || b === ANY) return true;
  return a === b;
}

export function structsCompatible(a: GstCapsStruct, b: GstCapsStruct): boolean {
  if (!mediaMatch(a.media, b.media)) return false;
  for (const k of Object.keys(a.fields)) {
    if (!(k in b.fields)) continue;
    const av = parseField(a.fields[k]);
    const bv = parseField(b.fields[k]);
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (!av.some((x) => bv.includes(x))) return false;
    } else if (Array.isArray(av)) {
      if (typeof bv === 'string' && !av.includes(bv)) return false;
    } else if (Array.isArray(bv)) {
      if (typeof av === 'string' && !bv.includes(av)) return false;
    } else if (typeof av === 'string' && typeof bv === 'string') {
      if (/^\d/.test(av) && /^\d/.test(bv)) continue;
      if (av !== bv) return false;
    }
  }
  return true;
}

export function capsCompatible(srcCaps: GstCapsStruct[], sinkCaps: GstCapsStruct[]): boolean {
  if (!srcCaps.length || !sinkCaps.length) return true;
  for (const a of srcCaps) {
    for (const b of sinkCaps) {
      if (structsCompatible(a, b)) return true;
    }
  }
  return false;
}
