import type { GstCapsStruct, GstElementDetail, GstPadTemplate } from '@shared/types';

export function findSrcPad(detail: GstElementDetail, name: string): GstPadTemplate | undefined {
  return detail.padTemplates.find((p) => p.direction === 'src' && p.name === name);
}
export function findSinkPad(detail: GstElementDetail, name: string): GstPadTemplate | undefined {
  return detail.padTemplates.find((p) => p.direction === 'sink' && p.name === name);
}

function parseField(value: string): string[] | string {
  const trimmed = value.trim();
  const listMatch = trimmed.match(/^\{(.+)\}/s);
  if (listMatch) {
    return listMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^\(string\)/, '').replace(/^"|"$/g, ''));
  }
  return trimmed.replace(/^\(string\)/, '').replace(/^"|"$/g, '');
}

function structsCompatible(a: GstCapsStruct, b: GstCapsStruct): boolean {
  if (a.media !== b.media && a.media !== 'ANY' && b.media !== 'ANY') return false;
  for (const k of Object.keys(a.fields)) {
    if (!(k in b.fields)) continue;
    const av = parseField(a.fields[k]);
    const bv = parseField(b.fields[k]);
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (!av.some((x) => bv.includes(x))) return false;
    } else if (Array.isArray(av) && typeof bv === 'string') {
      if (!av.includes(bv)) return false;
    } else if (Array.isArray(bv) && typeof av === 'string') {
      if (!bv.includes(av)) return false;
    } else if (typeof av === 'string' && typeof bv === 'string') {
      if (/^\d/.test(av) && /^\d/.test(bv)) continue;
      if (av !== bv) return false;
    }
  }
  return true;
}

export function capsCompatible(src: GstPadTemplate, sink: GstPadTemplate): boolean {
  if (src.direction !== 'src' || sink.direction !== 'sink') return false;
  if (!src.caps.length || !sink.caps.length) return true;
  for (const a of src.caps) {
    for (const b of sink.caps) {
      if (structsCompatible(a, b)) return true;
    }
  }
  return false;
}
