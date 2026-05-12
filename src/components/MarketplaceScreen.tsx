import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type {
  MarketplacePackageCard,
  MarketplaceSearchResult,
} from '../../shared/marketplace';

export function MarketplaceScreen(): JSX.Element {
  const setView = useStore((s) => s.setView);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [result, setResult] = useState<MarketplaceSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(force = false): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await window.gst.marketplaceSearch({ query: submittedQuery, forceRefresh: force });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runSearch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedQuery]);

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  }

  const cards = result?.cards || [];
  const compatibleCount = useMemo(() => cards.filter((c) => c.compatibility.compatible).length, [cards]);

  return (
    <div className="marketplace">
      <div className="marketplace-header">
        <div className="marketplace-title-block">
          <button className="ghost back-btn" onClick={() => setView('home')}>
            ← Home
          </button>
          <div>
            <h1>Package Marketplace</h1>
            <div className="marketplace-meta">
              Search public GitHub repos tagged with <code>gst-graph-package</code>
              {result ? (
                <>
                  {' · '}
                  {cards.length} package{cards.length === 1 ? '' : 's'} ({compatibleCount} compatible)
                  {result.cached ? <span className="muted"> · cached</span> : null}
                </>
              ) : null}
              {result?.rateLimit ? (
                <span className="muted">
                  {' · '}
                  {result.rateLimit.remaining}/{result.rateLimit.limit} GitHub API requests left
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="marketplace-header-actions">
          <button onClick={() => runSearch(true)} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      <form className="marketplace-search" onSubmit={onSubmit}>
        <input
          type="text"
          placeholder="Search packages — e.g. rtmp, hls, screen recorder…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="primary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error ? <div className="marketplace-error">{error}</div> : null}
      {result && result.warnings.length > 0 ? (
        <details className="marketplace-warnings">
          <summary>{result.warnings.length} warning(s)</summary>
          <ul>
            {result.warnings.slice(0, 50).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {!loading && cards.length === 0 ? (
        <div className="marketplace-empty">
          {submittedQuery
            ? `No packages found matching "${submittedQuery}".`
            : 'No packages found. Be the first to publish one!'}
          <div className="marketplace-empty-hint">
            Publish a package by creating a public GitHub repo with topic{' '}
            <code>gst-graph-package</code> and a <code>gst-package.json</code> file at the root
            (or under <code>packages/&lt;id&gt;/</code>).
          </div>
        </div>
      ) : (
        <div className="marketplace-grid">
          {cards.map((card) => (
            <PackageCard key={`${card.repo}#${card.packageId}`} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

function PackageCard({ card }: { card: MarketplacePackageCard }): JSX.Element {
  const { manifest, compatibility } = card;
  const tags = manifest.tags || [];
  const repoUrl = `https://github.com/${card.repo}`;
  const compatLabel = compatibility.compatible
    ? 'Ready to install'
    : `Missing ${compatibility.missingRequired.length} plugin${compatibility.missingRequired.length === 1 ? '' : 's'}`;
  return (
    <div className={`marketplace-card ${compatibility.compatible ? 'ok' : 'warn'}`}>
      <div className="marketplace-card-head">
        <div className="marketplace-card-title">
          <h3>{manifest.name}</h3>
          {card.featured ? <span className="marketplace-pill featured">{card.featured}</span> : null}
        </div>
        <span className={`marketplace-pill ${compatibility.compatible ? 'ok' : 'warn'}`}>
          {compatLabel}
        </span>
      </div>
      <div className="marketplace-card-sub">
        <span>{card.repo}</span>
        <span className="dot">·</span>
        <span>v{manifest.version}</span>
        <span className="dot">·</span>
        <span>★ {card.repoStars}</span>
      </div>
      {manifest.summary || card.repoDescription ? (
        <div className="marketplace-card-body">{manifest.summary || card.repoDescription}</div>
      ) : null}
      {tags.length > 0 ? (
        <div className="marketplace-tags">
          {tags.slice(0, 8).map((t) => (
            <span key={t} className="marketplace-tag">
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {compatibility.missingRequired.length > 0 ? (
        <div className="marketplace-missing">
          <strong>Missing required plugins:</strong>{' '}
          {compatibility.missingRequired.map((m) => m.name).join(', ')}
        </div>
      ) : null}
      {compatibility.missingOptional.length > 0 ? (
        <div className="marketplace-missing optional">
          <strong>Optional (won't block install):</strong>{' '}
          {compatibility.missingOptional.map((m) => m.name).join(', ')}
        </div>
      ) : null}
      {compatibility.gstreamerNote && !compatibility.gstreamerOk ? (
        <div className="marketplace-missing">{compatibility.gstreamerNote}</div>
      ) : null}
      <div className="marketplace-card-actions">
        <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="ghost">
          View on GitHub ↗
        </a>
        <button className="primary" disabled title="Install ships in the next milestone">
          Install
        </button>
      </div>
    </div>
  );
}
