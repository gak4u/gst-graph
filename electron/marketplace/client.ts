import {
  PACKAGE_INDEX_FILE,
  PACKAGE_MANIFEST_FILE,
  PACKAGE_TOPIC,
  type MarketplaceRateLimitInfo,
  type PackageManifest,
  type PackagePipelineRef,
  type PackageRepoIndex,
} from '../../shared/marketplace';
import { parseManifest } from '../../shared/marketplaceCheck';
import { validatePipelineDefShape } from '../../shared/installApply';
import type { PipelineDef } from '../../shared/types';

export const FEATURED_REPO = 'gak4u/gst-graph-featured';
export const FEATURED_INDEX_FILE = 'index.json';

const USER_AGENT = 'gst-graph-marketplace';

export interface GhRepoSummary {
  fullName: string;
  description: string | null;
  stargazersCount: number;
  defaultBranch: string;
  pushedAt: string;
}

export interface GhSearchResponse {
  repos: GhRepoSummary[];
  rateLimit?: MarketplaceRateLimitInfo;
}

export interface ResolvedPackageOnRepo {
  packageId: string;
  manifestPath: string;
  pipelinesPath: string;
  manifest: PackageManifest;
}

export interface RepoPackages {
  repo: string;
  sha: string;
  defaultBranch: string;
  packages: ResolvedPackageOnRepo[];
  warnings: string[];
}

function defaultHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function rateLimitFromHeaders(headers: Headers): MarketplaceRateLimitInfo | undefined {
  const remaining = headers.get('x-ratelimit-remaining');
  const limit = headers.get('x-ratelimit-limit');
  const reset = headers.get('x-ratelimit-reset');
  if (!remaining || !limit || !reset) return undefined;
  return {
    remaining: Number(remaining),
    limit: Number(limit),
    resetAt: Number(reset) * 1000,
  };
}

export class RateLimitedError extends Error {
  constructor(public resetAt: number) {
    super('GitHub API rate limit exceeded');
    this.name = 'RateLimitedError';
  }
}

async function ghJson<T>(url: string, token: string | undefined): Promise<{ data: T; rateLimit?: MarketplaceRateLimitInfo }> {
  const res = await fetch(url, { headers: defaultHeaders(token) });
  const rateLimit = rateLimitFromHeaders(res.headers);
  if (res.status === 403 && rateLimit && rateLimit.remaining === 0) {
    throw new RateLimitedError(rateLimit.resetAt);
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as T;
  return { data, rateLimit };
}

async function ghRaw(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub raw ${res.status}: ${url}`);
  return res.text();
}

interface SearchReposGhResp {
  items: Array<{
    full_name: string;
    description: string | null;
    stargazers_count: number;
    default_branch: string;
    pushed_at: string;
  }>;
}

export async function searchRepos(
  query: string,
  token: string | undefined,
): Promise<GhSearchResponse> {
  const q = `topic:${PACKAGE_TOPIC}${query.trim() ? ` ${query.trim()}` : ''}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
  const { data, rateLimit } = await ghJson<SearchReposGhResp>(url, token);
  const repos = data.items.map((it) => ({
    fullName: it.full_name,
    description: it.description,
    stargazersCount: it.stargazers_count,
    defaultBranch: it.default_branch,
    pushedAt: it.pushed_at,
  }));
  return { repos, rateLimit };
}

async function getRepoSha(
  fullName: string,
  branch: string,
  token: string | undefined,
): Promise<string | undefined> {
  try {
    const { data } = await ghJson<{ sha: string }>(
      `https://api.github.com/repos/${fullName}/commits/${encodeURIComponent(branch)}`,
      token,
    );
    return data.sha;
  } catch {
    return undefined;
  }
}

function rawUrl(repo: string, sha: string, file: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${file}`;
}

async function readJsonFromRepo<T>(repo: string, sha: string, file: string): Promise<T | null> {
  const raw = await ghRaw(rawUrl(repo, sha, file));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`Invalid JSON at ${file} in ${repo}@${sha.slice(0, 7)}: ${(e as Error).message}`);
  }
}

interface ContentsEntry {
  type: 'dir' | 'file';
  name: string;
}

async function listDirIfExists(
  repo: string,
  sha: string,
  dir: string,
  token: string | undefined,
): Promise<ContentsEntry[] | null> {
  const url = `https://api.github.com/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(sha)}`;
  const res = await fetch(url, { headers: defaultHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub contents ${res.status}: ${url}`);
  return (await res.json()) as ContentsEntry[];
}

export async function resolveRepoPackages(
  repo: string,
  defaultBranch: string,
  token: string | undefined,
): Promise<RepoPackages | null> {
  const sha = (await getRepoSha(repo, defaultBranch, token)) || defaultBranch;
  const warnings: string[] = [];

  // 1) Try gst-package.json at root (single-package layout)
  const rootManifestRaw = await ghRaw(rawUrl(repo, sha, PACKAGE_MANIFEST_FILE));
  if (rootManifestRaw !== null) {
    try {
      const parsed = JSON.parse(rootManifestRaw);
      const manifest = parseManifest(parsed, `${repo}/${PACKAGE_MANIFEST_FILE}`);
      return {
        repo,
        sha,
        defaultBranch,
        packages: [
          {
            packageId: manifest.id,
            manifestPath: PACKAGE_MANIFEST_FILE,
            pipelinesPath: '',
            manifest,
          },
        ],
        warnings,
      };
    } catch (e) {
      warnings.push((e as Error).message);
      return { repo, sha, defaultBranch, packages: [], warnings };
    }
  }

  // 2) Try gst-index.json + packages/<id>/gst-package.json
  const index = await readJsonFromRepo<PackageRepoIndex>(repo, sha, PACKAGE_INDEX_FILE);
  const candidates: Array<{ id?: string; path: string }> = [];
  if (index && Array.isArray(index.packages)) {
    for (const e of index.packages) {
      if (typeof e.path === 'string') candidates.push({ id: e.id, path: e.path.replace(/^\/+/, '') });
    }
  } else {
    // 3) Fall back to listing packages/ directory
    const entries = await listDirIfExists(repo, sha, 'packages', token);
    if (entries) {
      for (const entry of entries) {
        if (entry.type === 'dir') candidates.push({ path: `packages/${entry.name}` });
      }
    }
  }

  if (candidates.length === 0) {
    return { repo, sha, defaultBranch, packages: [], warnings };
  }

  const packages: ResolvedPackageOnRepo[] = [];
  for (const cand of candidates) {
    const manifestPath = `${cand.path}/${PACKAGE_MANIFEST_FILE}`;
    const raw = await ghRaw(rawUrl(repo, sha, manifestPath));
    if (raw === null) {
      warnings.push(`Missing ${manifestPath} in ${repo}`);
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      const manifest = parseManifest(parsed, `${repo}/${manifestPath}`);
      packages.push({
        packageId: manifest.id,
        manifestPath,
        pipelinesPath: cand.path,
        manifest,
      });
    } catch (e) {
      warnings.push((e as Error).message);
    }
  }
  return { repo, sha, defaultBranch, packages, warnings };
}

export async function resolveRepoAtSha(
  repo: string,
  sha: string,
  defaultBranch: string,
  token: string | undefined,
): Promise<RepoPackages | null> {
  const warnings: string[] = [];

  const rootManifestRaw = await ghRaw(rawUrl(repo, sha, PACKAGE_MANIFEST_FILE));
  if (rootManifestRaw !== null) {
    try {
      const parsed = JSON.parse(rootManifestRaw);
      const manifest = parseManifest(parsed, `${repo}/${PACKAGE_MANIFEST_FILE}`);
      return {
        repo,
        sha,
        defaultBranch,
        packages: [
          {
            packageId: manifest.id,
            manifestPath: PACKAGE_MANIFEST_FILE,
            pipelinesPath: '',
            manifest,
          },
        ],
        warnings,
      };
    } catch (e) {
      warnings.push((e as Error).message);
      return { repo, sha, defaultBranch, packages: [], warnings };
    }
  }

  const index = await readJsonFromRepo<PackageRepoIndex>(repo, sha, PACKAGE_INDEX_FILE);
  const candidates: Array<{ id?: string; path: string }> = [];
  if (index && Array.isArray(index.packages)) {
    for (const e of index.packages) {
      if (typeof e.path === 'string') candidates.push({ id: e.id, path: e.path.replace(/^\/+/, '') });
    }
  } else {
    const entries = await listDirIfExists(repo, sha, 'packages', token);
    if (entries) {
      for (const entry of entries) {
        if (entry.type === 'dir') candidates.push({ path: `packages/${entry.name}` });
      }
    }
  }

  if (candidates.length === 0) {
    return { repo, sha, defaultBranch, packages: [], warnings };
  }

  const packages: ResolvedPackageOnRepo[] = [];
  for (const cand of candidates) {
    const manifestPath = `${cand.path}/${PACKAGE_MANIFEST_FILE}`;
    const raw = await ghRaw(rawUrl(repo, sha, manifestPath));
    if (raw === null) {
      warnings.push(`Missing ${manifestPath} in ${repo}`);
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      const manifest = parseManifest(parsed, `${repo}/${manifestPath}`);
      packages.push({
        packageId: manifest.id,
        manifestPath,
        pipelinesPath: cand.path,
        manifest,
      });
    } catch (e) {
      warnings.push((e as Error).message);
    }
  }
  return { repo, sha, defaultBranch, packages, warnings };
}

export async function fetchPackagePipelines(args: {
  repo: string;
  sha: string;
  pipelinesPath: string;
  pipelines: PackagePipelineRef[];
}): Promise<PipelineDef[]> {
  const { repo, sha, pipelinesPath, pipelines } = args;
  const results: PipelineDef[] = [];
  for (const ref of pipelines) {
    if (ref.file.includes('..') || ref.file.startsWith('/')) {
      throw new Error(`Pipeline file rejected (path traversal): ${ref.file}`);
    }
    const fullPath = pipelinesPath ? `${pipelinesPath}/${ref.file}` : ref.file;
    const raw = await ghRaw(rawUrl(repo, sha, fullPath));
    if (raw === null) {
      throw new Error(`Pipeline file not found in ${repo}@${sha.slice(0, 7)}: ${fullPath}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON in ${fullPath} (${repo}@${sha.slice(0, 7)}): ${(e as Error).message}`);
    }
    results.push(validatePipelineDefShape(parsed, `${repo}/${fullPath}`));
  }
  return results;
}

export async function fetchFeaturedIndex(token: string | undefined): Promise<{
  entries: Array<{ repo: string; packageId?: string; highlight?: string }>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const sha = (await getRepoSha(FEATURED_REPO, 'main', token)) || 'main';
  const raw = await ghRaw(rawUrl(FEATURED_REPO, sha, FEATURED_INDEX_FILE));
  if (!raw) return { entries: [], warnings };
  try {
    const parsed = JSON.parse(raw) as { featured?: Array<{ repo: string; packageId?: string; highlight?: string }> };
    return { entries: Array.isArray(parsed.featured) ? parsed.featured : [], warnings };
  } catch (e) {
    warnings.push(`Featured index parse error: ${(e as Error).message}`);
    return { entries: [], warnings };
  }
}
