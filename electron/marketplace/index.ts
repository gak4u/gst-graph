import {
  fetchFeaturedIndex,
  RateLimitedError,
  resolveRepoPackages,
  searchRepos,
} from './client';
import { readSearch, writeSearch, clear as clearCache } from './cache';
import { checkCompatibility } from '../../shared/marketplaceCheck';
import type {
  MarketplacePackageCard,
  MarketplaceSearchResult,
} from '../../shared/marketplace';

export interface SearchInput {
  query: string;
  installedElements: string[];
  installedGstreamerVersion?: string;
  githubToken?: string;
  forceRefresh?: boolean;
}

const REPO_PARALLELISM = 4;

async function mapWithLimit<T, U>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function rescoreCards(
  cards: MarketplacePackageCard[],
  installedElements: Iterable<string>,
  installedGstreamerVersion: string | undefined,
): MarketplacePackageCard[] {
  const installedSet = new Set(installedElements);
  const rescored = cards.map((card) => ({
    ...card,
    compatibility: checkCompatibility(card.manifest, {
      installedElements: installedSet,
      installedGstreamerVersion,
    }),
  }));
  rescored.sort((a, b) => {
    if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
    if (a.compatibility.compatible !== b.compatibility.compatible)
      return a.compatibility.compatible ? -1 : 1;
    return b.repoStars - a.repoStars;
  });
  return rescored;
}

export async function searchMarketplace(input: SearchInput): Promise<MarketplaceSearchResult> {
  const authed = !!input.githubToken;
  if (!input.forceRefresh) {
    const hit = readSearch(input.query, authed);
    if (hit) {
      // rateLimit on the cached hit is the value at fetch time, which goes
      // stale within seconds (search bucket refills every minute). Strip it
      // here so the UI doesn't display a misleading "X/Y left" — fresh fetch
      // via Refresh repopulates it.
      const { rateLimit: _staleLimit, ...rest } = hit;
      return {
        ...rest,
        cards: rescoreCards(hit.cards, input.installedElements, input.installedGstreamerVersion),
      };
    }
  }

  const warnings: string[] = [];
  const installedSet = new Set(input.installedElements);

  let rateLimit;
  let cards: MarketplacePackageCard[] = [];

  try {
    const [featured, search] = await Promise.all([
      fetchFeaturedIndex(input.githubToken).catch((e) => {
        warnings.push(`Featured index unavailable: ${(e as Error).message}`);
        return { entries: [], warnings: [] };
      }),
      searchRepos(input.query, input.githubToken),
    ]);
    rateLimit = search.rateLimit;

    const featuredMap = new Map<string, string>(); // repo -> highlight (or '' if anyPackage)
    for (const entry of featured.entries) {
      featuredMap.set(entry.repo, entry.highlight || 'Featured');
    }
    warnings.push(...featured.warnings);

    // Include featured repos even if they didn't match search (for empty queries, primarily)
    const reposToFetch = new Map(
      search.repos.map((r) => [
        r.fullName,
        {
          fullName: r.fullName,
          description: r.description,
          stargazersCount: r.stargazersCount,
          defaultBranch: r.defaultBranch,
          pushedAt: r.pushedAt,
        },
      ]),
    );
    if (input.query.trim().length === 0) {
      for (const entry of featured.entries) {
        if (!reposToFetch.has(entry.repo)) {
          reposToFetch.set(entry.repo, {
            fullName: entry.repo,
            description: null,
            stargazersCount: 0,
            defaultBranch: 'main',
            pushedAt: new Date(0).toISOString(),
          });
        }
      }
    }

    const repoList = [...reposToFetch.values()];
    const resolved = await mapWithLimit(repoList, REPO_PARALLELISM, async (r) => {
      try {
        const result = await resolveRepoPackages(r.fullName, r.defaultBranch, input.githubToken);
        return { repo: r, result };
      } catch (e) {
        warnings.push(`${r.fullName}: ${(e as Error).message}`);
        return { repo: r, result: null };
      }
    });

    for (const { repo, result } of resolved) {
      if (!result) continue;
      warnings.push(...result.warnings);
      const highlight = featuredMap.get(repo.fullName);
      for (const pkg of result.packages) {
        const compat = checkCompatibility(pkg.manifest, {
          installedElements: installedSet,
          installedGstreamerVersion: input.installedGstreamerVersion,
        });
        cards.push({
          repo: repo.fullName,
          packageId: pkg.packageId,
          packagePath: pkg.pipelinesPath,
          manifest: pkg.manifest,
          repoStars: repo.stargazersCount,
          repoDescription: repo.description ?? undefined,
          defaultBranch: repo.defaultBranch,
          pushedAt: repo.pushedAt,
          sha: result.sha,
          featured: highlight,
          compatibility: compat,
        });
      }
    }

    cards.sort((a, b) => {
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      if (a.compatibility.compatible !== b.compatibility.compatible)
        return a.compatibility.compatible ? -1 : 1;
      return b.repoStars - a.repoStars;
    });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      const min = Math.max(1, Math.ceil((e.resetAt - Date.now()) / 60_000));
      warnings.push(`GitHub API rate limit hit. Resets in ~${min} minute(s). Add a token to raise the limit.`);
    } else {
      warnings.push(`Marketplace error: ${(e as Error).message}`);
    }
  }

  const result: MarketplaceSearchResult = {
    cards,
    warnings,
    rateLimit,
    fetchedAt: Date.now(),
    cached: false,
  };
  writeSearch(input.query, result, authed);
  return result;
}

export function invalidateMarketplaceCache(): void {
  clearCache();
}
