import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MarketplaceSearchResult } from '../../shared/marketplace';

const CACHE_FILE = path.join(os.homedir(), '.gst-graph', 'marketplace-cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheShape {
  schemaVersion: 2;
  search: Record<string, MarketplaceSearchResult>;
}

// Bump this when MarketplacePackageCard / MarketplaceSearchResult shape changes
// in a way that older cached entries can't be safely served from. (e.g. v2 added
// `packagePath`; pre-v2 cards had no path so the GitHub deep-link fell back to
// the repo root, masking the change.)
const SCHEMA_VERSION = 2 as const;

function emptyCache(): CacheShape {
  return { schemaVersion: SCHEMA_VERSION, search: {} };
}

let cache: CacheShape | null = null;

function load(): CacheShape {
  if (cache) return cache;
  try {
    const buf = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(buf) as CacheShape;
    if (parsed && parsed.schemaVersion === SCHEMA_VERSION) {
      cache = parsed;
      return cache;
    }
  } catch {
    // first run or corrupt; start fresh
  }
  cache = emptyCache();
  return cache;
}

function flush(): void {
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch (e) {
    console.error('[marketplace-cache] flush failed', e);
  }
}

export function normalizeQuery(q: string, authed = false): string {
  const base = q.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${authed ? 'auth' : 'anon'}:${base}`;
}

export function readSearch(query: string, authed = false): MarketplaceSearchResult | null {
  const c = load();
  const key = normalizeQuery(query, authed);
  const hit = c.search[key];
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > CACHE_TTL_MS) return null;
  return { ...hit, cached: true };
}

export function writeSearch(query: string, result: MarketplaceSearchResult, authed = false): void {
  const c = load();
  c.search[normalizeQuery(query, authed)] = result;
  flush();
}

export function clear(): void {
  cache = emptyCache();
  flush();
}
