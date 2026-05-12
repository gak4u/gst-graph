import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { InstalledPackage } from '../../shared/marketplace';

interface NewPipelineModalProps {
  onClose: () => void;
}

interface TemplateEntry {
  installed: InstalledPackage;
  pipeline: { id: string; name: string; elementCount: number; variableCount: number };
}

export function NewPipelineModal({ onClose }: NewPipelineModalProps): JSX.Element {
  const pipelines = useStore((s) => s.pipelines);
  const newPipeline = useStore((s) => s.newPipeline);
  const clonePipelineFrom = useStore((s) => s.clonePipelineFrom);
  const openPipeline = useStore((s) => s.openPipeline);
  const toast = useStore((s) => s.toast);

  const [installed, setInstalled] = useState<InstalledPackage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.gst.marketplaceListInstalled();
        if (!cancelled) setInstalled(list);
      } catch (e) {
        if (!cancelled) toast(`Could not load installed packages: ${(e as Error).message}`, 'err');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const templates = useMemo<TemplateEntry[]>(() => {
    const byId = new Map(pipelines.map((p) => [p.id, p]));
    const rows: TemplateEntry[] = [];
    for (const pkg of installed) {
      for (const pipelineId of pkg.pipelineIds) {
        const p = byId.get(pipelineId);
        if (!p) continue; // orphaned record — pipeline was deleted manually
        rows.push({
          installed: pkg,
          pipeline: {
            id: p.id,
            name: p.name,
            elementCount: p.nodes.filter((n) => n.type === 'gstElement').length,
            variableCount: p.nodes.filter((n) => n.type === 'gstVariable').length,
          },
        });
      }
    }
    return rows;
  }, [installed, pipelines]);

  function startBlank(): void {
    const id = newPipeline();
    openPipeline(id);
    onClose();
  }

  function startFromTemplate(sourceId: string): void {
    const id = clonePipelineFrom(sourceId);
    if (!id) {
      toast('Could not clone that template', 'err');
      return;
    }
    openPipeline(id);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal new-pipeline-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>New Pipeline</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <section className="new-pipeline-blank">
          <button className="new-pipeline-blank-btn" onClick={startBlank}>
            <div className="new-pipeline-blank-icon">＋</div>
            <div>
              <div className="new-pipeline-blank-title">Blank pipeline</div>
              <div className="new-pipeline-blank-sub">
                Start from an empty canvas. Drag elements from the palette.
              </div>
            </div>
          </button>
        </section>

        <section className="new-pipeline-templates">
          <h3>Start from an installed package</h3>
          {loading ? (
            <div className="muted">Loading installed packages…</div>
          ) : templates.length === 0 ? (
            <div className="new-pipeline-empty">
              No installed packages yet. Visit the{' '}
              <button
                className="link-btn"
                onClick={() => {
                  onClose();
                  useStore.getState().setView('marketplace');
                }}
              >
                Marketplace
              </button>{' '}
              to install one, and it'll show up here as a template.
            </div>
          ) : (
            <ul className="new-pipeline-list">
              {templates.map((t) => (
                <li key={`${t.installed.key}:${t.pipeline.id}`}>
                  <button
                    className="new-pipeline-tpl"
                    onClick={() => startFromTemplate(t.pipeline.id)}
                  >
                    <div className="new-pipeline-tpl-head">
                      <span className="new-pipeline-tpl-name">{t.pipeline.name}</span>
                      <span className="new-pipeline-tpl-source muted">
                        from <code>{t.installed.packageId}</code>
                      </span>
                    </div>
                    <div className="new-pipeline-tpl-stats muted">
                      {t.pipeline.elementCount} element
                      {t.pipeline.elementCount === 1 ? '' : 's'} ·{' '}
                      {t.pipeline.variableCount} variable
                      {t.pipeline.variableCount === 1 ? '' : 's'} · v{t.installed.version}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
