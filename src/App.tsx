import { useEffect } from 'react';
import { ElementPalette } from './components/ElementPalette';
import { PipelineGraph } from './components/PipelineGraph';
import { PipelineTabs } from './components/PipelineTabs';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ConsolePanel } from './components/ConsolePanel';
import { Toolbar } from './components/Toolbar';
import { HomeScreen } from './components/HomeScreen';
import { MarketplaceScreen } from './components/MarketplaceScreen';
import { useStore } from './state/store';

export function App() {
  const appendLog = useStore((s) => s.appendLog);
  const setStatus = useStore((s) => s.setStatus);
  const hydrate = useStore((s) => s.hydrate);
  const reloadFromDisk = useStore((s) => s.reloadFromDisk);
  const view = useStore((s) => s.view);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    hydrate();
    const offLog = window.gst.onLog((entry) => appendLog(entry));
    const offStatus = window.gst.onStatus((status) => setStatus(status));
    const offChanged = window.gst.onPipelinesChanged?.(() => reloadFromDisk());
    return () => {
      offLog();
      offStatus();
      offChanged?.();
    };
  }, [appendLog, setStatus, hydrate, reloadFromDisk]);

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
