import { useCallback, useEffect, useState } from 'react';
import { ElementPalette } from './components/ElementPalette';
import { PipelineGraph } from './components/PipelineGraph';
import { PipelineTabs } from './components/PipelineTabs';
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
          <PipelineTabs />
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
