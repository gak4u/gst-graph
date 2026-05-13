import { useCallback, useEffect, useState } from 'react';
import { ElementPalette } from './components/ElementPalette';
import { PipelineGraph } from './components/PipelineGraph';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ConsolePanel } from './components/ConsolePanel';
import { Toolbar } from './components/Toolbar';
import { HomeScreen } from './components/HomeScreen';
import { MarketplaceScreen } from './components/MarketplaceScreen';
import { SetupScreen } from './components/SetupScreen';
import { useStore } from './state/store';
import type { GstreamerInstallStatus } from '@shared/types';

type SetupPhase = 'checking' | 'missing' | 'ready';

export function App() {
  const appendLog = useStore((s) => s.appendLog);
  const setStatus = useStore((s) => s.setStatus);
  const hydrate = useStore((s) => s.hydrate);
  const reloadFromDisk = useStore((s) => s.reloadFromDisk);
  const view = useStore((s) => s.view);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);

  const [setupPhase, setSetupPhase] = useState<SetupPhase>('checking');
  const [installStatus, setInstallStatus] = useState<GstreamerInstallStatus | null>(null);

  const runInstallCheck = useCallback(async () => {
    const status = await window.gst.checkGstreamerInstall();
    setInstallStatus(status);
    setSetupPhase(status.installed ? 'ready' : 'missing');
  }, []);

  useEffect(() => {
    void runInstallCheck();
  }, [runInstallCheck]);

  useEffect(() => {
    if (setupPhase !== 'ready') return;
    hydrate();
    const offLog = window.gst.onLog((entry) => appendLog(entry));
    const offStatus = window.gst.onStatus((status) => setStatus(status));
    const offChanged = window.gst.onPipelinesChanged?.(() => reloadFromDisk());
    return () => {
      offLog();
      offStatus();
      offChanged?.();
    };
  }, [setupPhase, appendLog, setStatus, hydrate, reloadFromDisk]);

  // Global Cmd/Ctrl+Z (and Shift for redo). Ignore when focus is in a text input
  // so we don't intercept the browser's native input-level undo.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      const s = useStore.getState();
      const did = e.shiftKey ? s.redo() : s.undo();
      if (!did) s.toast(e.shiftKey ? 'Nothing to redo' : 'Nothing to undo', 'info');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (setupPhase === 'checking') {
    return <div className="setup-checking">Checking GStreamer installation…</div>;
  }
  if (setupPhase === 'missing' && installStatus) {
    return <SetupScreen status={installStatus} onRetry={runInstallCheck} />;
  }

  return (
    <div className={`app-root view-${view}`}>
      {view === 'home' ? (
        <HomeScreen />
      ) : view === 'marketplace' ? (
        <MarketplaceScreen />
      ) : (
        <div className="app">
          <Toolbar />
          <div className="palette">
            <ElementPalette />
          </div>
          <div className="graph">
            <PipelineGraph />
          </div>
          <PropertiesPanel />
          <ConsolePanel />
        </div>
      )}
      {toasts.map((t, i) => (
        <div
          key={t.id}
          className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'warn' ? 'warn' : ''}`}
          style={{ bottom: 16 + i * 56 }}
          onClick={() => dismissToast(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
