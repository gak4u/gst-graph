import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const TTL_MS = 60 * 60 * 1000;
const PROBE_PATHS = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];

interface CachedAuth {
  token: string | null;
  source: 'gh' | null;
  fetchedAt: number;
}

let cached: CachedAuth | null = null;

export interface MarketplaceAuth {
  token?: string;
  source?: 'gh';
}

async function tryGhCli(): Promise<string | null> {
  for (const candidate of PROBE_PATHS) {
    try {
      const { stdout } = await exec(candidate, ['auth', 'token'], { timeout: 3000 });
      const token = stdout.trim();
      if (token) return token;
    } catch {
      // path not found, gh not installed, or not logged in — try next
    }
  }
  return null;
}

export async function getMarketplaceAuth(forceRefresh = false): Promise<MarketplaceAuth> {
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < TTL_MS) {
    if (cached.token) return { token: cached.token, source: cached.source ?? undefined };
    return {};
  }
  const token = await tryGhCli();
  cached = {
    token: token ?? null,
    source: token ? 'gh' : null,
    fetchedAt: Date.now(),
  };
  if (token) return { token, source: 'gh' };
  return {};
}

export function clearMarketplaceAuthCache(): void {
  cached = null;
}
