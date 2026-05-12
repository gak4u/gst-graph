import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type {
  InstalledPackage,
  MarketplaceInstallPreview,
  MarketplacePackageCard,
  MarketplaceSearchResult,
} from '../../shared/marketplace';

export function MarketplaceScreen(): JSX.Element {
  const setView = useStore((s) => s.setView);
  const toast = useStore((s) => s.toast);
  const reloadFromDisk = useStore((s) => s.reloadFromDisk);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [result, setResult] = useState<MarketplaceSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<{ card: MarketplacePackageCard } | null>(null);
  const [installedKeys, setInstalledKeys] = useState<Set<string>>(new Set());

  async function refreshInstalled(): Promise<void> {
    try {
      const list = await window.gst.marketplaceListInstalled();
      setInstalledKeys(new Set(list.map((p) => p.key)));
    } catch (e) {
      console.error('listInstalled failed', e);
    }
  }

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

  useEffect(() => {
    void refreshInstalled();
  }, []);

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  }

  async function onInstalled(addedNames: string[]): Promise<void> {
    setInstalling(null);
    await refreshInstalled();
    await reloadFromDisk();
    const summary = addedNames.length === 1
      ? `Installed "${addedNames[0]}"`
      : `Installed ${addedNames.length} pipelines`;
    toast(summary, 'info');
    setView('home');
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
                  Search API: {result.rateLimit.remaining}/{result.rateLimit.limit}
                  {result.rateLimit.limit > 10 ? '/min' : '/min (anon)'}
                </span>
              ) : null}
              {result?.auth ? (
                <span className="muted">
                  {' · '}
                  {result.auth.authenticated
                    ? `auth: ${result.auth.source ?? 'token'}`
                    : (
                      <>
                        anonymous —{' '}
                        <span title="Run `gh auth login` in your terminal to get 30/min search + 5000/hr core">
                          run <code>gh auth login</code> for higher limits
                        </span>
                      </>
                    )}
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
            <PackageCard
              key={`${card.repo}#${card.packageId}`}
              card={card}
              installed={installedKeys.has(`${card.repo}#${card.packageId}`)}
              onInstall={() => setInstalling({ card })}
            />
          ))}
        </div>
      )}

      {installing ? (
        <InstallModal
          card={installing.card}
          onClose={() => setInstalling(null)}
          onInstalled={onInstalled}
        />
      ) : null}
    </div>
  );
}

function PackageCard({
  card,
  installed,
  onInstall,
}: {
  card: MarketplacePackageCard;
  installed: boolean;
  onInstall: () => void;
}): JSX.Element {
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
          {installed ? <span className="marketplace-pill installed">Installed</span> : null}
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
        <button className="primary" onClick={onInstall}>
          {installed ? 'Reinstall…' : 'Install…'}
        </button>
      </div>
    </div>
  );
}

interface InstallModalProps {
  card: MarketplacePackageCard;
  onClose: () => void;
  onInstalled: (addedNames: string[]) => Promise<void> | void;
}

function InstallModal({ card, onClose, onInstalled }: InstallModalProps): JSX.Element {
  const [preview, setPreview] = useState<MarketplaceInstallPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [acceptedRisks, setAcceptedRisks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const res = await window.gst.marketplaceInstallPreview({
          repo: card.repo,
          packageId: card.packageId,
          sha: card.sha,
          defaultBranch: card.defaultBranch,
        });
        if (cancelled) return;
        if (!res.ok) {
          setPreviewError(res.error);
        } else {
          setPreview(res);
        }
      } catch (e) {
        if (!cancelled) setPreviewError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.repo, card.packageId, card.sha, card.defaultBranch]);

  async function onConfirm(): Promise<void> {
    if (!preview) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await window.gst.marketplaceInstall({
        repo: card.repo,
        packageId: card.packageId,
        sha: preview.sha,
        defaultBranch: card.defaultBranch,
      });
      if (!res.ok) {
        setInstallError(res.error || 'Install failed');
        return;
      }
      await onInstalled(res.addedPipelineNames || []);
    } catch (e) {
      setInstallError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  }

  const hasMissing = !!preview && preview.compatibility.missingRequired.length > 0;
  const hasSuspicious = !!preview && preview.pipelines.some((p) => p.suspiciousElements.length > 0);
  const requiresAck = hasMissing || hasSuspicious;
  const canInstall = !!preview && !installing && (!requiresAck || acceptedRisks);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal install-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Install {card.manifest.name}</h2>
          <button className="ghost" onClick={onClose} disabled={installing}>
            ✕
          </button>
        </div>

        <div className="install-source">
          <div>
            <span className="muted">From</span> <code>{card.repo}</code>
            <span className="dot"> · </span>
            <span className="muted">commit</span> <code>{card.sha.slice(0, 7)}</code>
            <span className="dot"> · </span>
            <span className="muted">v</span>
            <code>{card.manifest.version}</code>
          </div>
          {preview?.alreadyInstalled ? (
            <div className="install-warn-line">
              ⚠ This package is already installed (v{preview.alreadyInstalled.version},{' '}
              {new Date(preview.alreadyInstalled.installedAt).toLocaleDateString()}). Re-installing will
              add a fresh copy with new pipeline IDs.
            </div>
          ) : null}
        </div>

        {busy ? <div className="install-loading">Loading package contents…</div> : null}

        {previewError ? <div className="marketplace-error">{previewError}</div> : null}

        {preview ? (
          <>
            <section className="install-section">
              <h3>Pipelines to add ({preview.pipelines.length})</h3>
              <ul className="install-pipelines">
                {preview.pipelines.map((p) => (
                  <li key={p.name}>
                    <div className="install-pipeline-name">{p.name}</div>
                    <div className="install-pipeline-stats muted">
                      {p.elementCount} element{p.elementCount === 1 ? '' : 's'}
                      {' · '}
                      {p.variableCount} variable{p.variableCount === 1 ? '' : 's'}
                      {p.transformCount > 0 ? ` · ${p.transformCount} transform${p.transformCount === 1 ? '' : 's'}` : ''}
                    </div>
                    {p.uniqueElements.length > 0 ? (
                      <div className="install-pipeline-elements">
                        {p.uniqueElements.map((el) => (
                          <code
                            key={el}
                            className={p.suspiciousElements.includes(el) ? 'install-element suspicious' : 'install-element'}
                            title={p.suspiciousElements.includes(el) ? 'Worth a closer look' : ''}
                          >
                            {el}
                          </code>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            {preview.appliedDefaults.length > 0 ? (
              <section className="install-section">
                <h3>Variable defaults to apply</h3>
                <ul className="install-defaults">
                  {preview.appliedDefaults.map((d, i) => (
                    <li key={`${d.pipelineName}:${d.varName}:${i}`}>
                      <code>{d.varName}</code> = <code>{JSON.stringify(d.value)}</code>
                      <span className="muted"> · {d.pipelineName}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {preview.skippedSecretDefaults.length > 0 ? (
              <section className="install-section">
                <h3>Skipped secret defaults</h3>
                <div className="muted">
                  The following variables are marked <code>secret</code> and ship with default values in
                  the manifest. We did not apply them — set them yourself after install:
                </div>
                <ul className="install-defaults">
                  {preview.skippedSecretDefaults.map((v) => (
                    <li key={v}><code>{v}</code></li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="install-section">
              <h3>Compatibility</h3>
              {preview.compatibility.compatible ? (
                <div className="install-ok">All required elements present.</div>
              ) : (
                <div className="install-warn">
                  <strong>Missing required plugins:</strong>{' '}
                  {preview.compatibility.missingRequired.map((m) => m.name).join(', ')}
                </div>
              )}
              {preview.compatibility.missingOptional.length > 0 ? (
                <div className="muted">
                  Optional (won't block):{' '}
                  {preview.compatibility.missingOptional.map((m) => m.name).join(', ')}
                </div>
              ) : null}
              {preview.compatibility.gstreamerNote ? (
                <div className={preview.compatibility.gstreamerOk ? 'muted' : 'install-warn'}>
                  {preview.compatibility.gstreamerNote}
                </div>
              ) : null}
            </section>

            {requiresAck ? (
              <label className="install-ack">
                <input
                  type="checkbox"
                  checked={acceptedRisks}
                  onChange={(e) => setAcceptedRisks(e.target.checked)}
                />
                I understand{hasMissing ? ' the pipelines may not run without the missing plugins' : ''}
                {hasMissing && hasSuspicious ? ' and' : ''}
                {hasSuspicious ? ' want to install pipelines that include flagged elements' : ''}.
              </label>
            ) : null}
          </>
        ) : null}

        {installError ? <div className="marketplace-error">{installError}</div> : null}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={installing}>
            Cancel
          </button>
          <button className="primary" onClick={onConfirm} disabled={!canInstall}>
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
      </div>
    </div>
  );
}
