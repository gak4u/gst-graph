import { useState } from 'react';
import { useStore } from '../state/store';

export function Toolbar() {
  const pipeline = useStore((s) => s.pipelines.find((p) => p.id === s.activePipelineId));
  const gstVersion = useStore((s) => s.gstVersion);
  const toast = useStore((s) => s.toast);
  const elements = useStore((s) => s.elements);
  const addVariableNode = useStore((s) => s.addVariableNode);
  const addTransformNode = useStore((s) => s.addTransformNode);
  const setView = useStore((s) => s.setView);
  const [cmdPreview, setCmdPreview] = useState<string | null>(null);

  async function run() {
    if (!pipeline) return;
    if (pipeline.nodes.length === 0) {
      toast('Pipeline is empty', 'warn');
      return;
    }
    const res = await window.gst.runPipeline(pipeline);
    if (!res.ok) toast(res.error || 'Failed to start pipeline', 'err');
  }

  async function stop() {
    if (!pipeline) return;
    await window.gst.stopPipeline(pipeline.id);
  }

  async function preview() {
    if (!pipeline) return;
    const cmd = await window.gst.buildCommand(pipeline);
    setCmdPreview(cmd);
  }

  function exportJson() {
    if (!pipeline) return;
    const data = JSON.stringify(
      { id: pipeline.id, name: pipeline.name, nodes: pipeline.nodes, edges: pipeline.edges },
      null,
      2,
    );
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pipeline.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;
      const importFn = useStore.getState().importPipeline;
      for (const f of files) {
        try {
          const text = await f.text();
          const obj = JSON.parse(text);
          await importFn(obj, f.name);
        } catch (e) {
          toast(`Import failed for ${f.name}: ${(e as Error).message}`, 'err');
        }
      }
    };
    input.click();
  }

  return (
    <>
      <div className="toolbar">
        <button className="home-back" onClick={() => setView('home')} title="Back to home">
          ← Home
        </button>
        <span className="title">{pipeline?.name || 'GStreamer Graph Editor'}</span>
        <button
          className="primary"
          onClick={run}
          disabled={!pipeline || pipeline.running || pipeline.nodes.length === 0}
        >
          ▶ Run
        </button>
        <button className="danger" onClick={stop} disabled={!pipeline?.running}>
          ■ Stop
        </button>
        <button onClick={preview} disabled={!pipeline || pipeline.nodes.length === 0}>
          Show command
        </button>
        <button
          onClick={() => addVariableNode({ x: 80 + Math.random() * 80, y: 80 + Math.random() * 80 })}
          title="Add a variable node"
        >
          + Variable
        </button>
        <button
          onClick={() =>
            addTransformNode('concat', { x: 80 + Math.random() * 80, y: 160 + Math.random() * 80 })
          }
          title="Add a string concatenation node"
        >
          + Concat
        </button>
        <button
          onClick={() =>
            addTransformNode('math', { x: 80 + Math.random() * 80, y: 240 + Math.random() * 80 })
          }
          title="Add a math node"
        >
          + Math
        </button>
        <button onClick={exportJson} disabled={!pipeline} title="Export pipeline to a JSON file">
          ↓ Export
        </button>
        <button onClick={importJson} title="Import pipelines from JSON files">
          ↑ Import
        </button>
        <span className="spacer" />
        <span className="meta">
          {elements.length} elements · {gstVersion || 'detecting GStreamer...'}
        </span>
      </div>
      {cmdPreview !== null && (
        <div
          className="toast"
          style={{ left: 16, right: 16, bottom: 220, maxWidth: 'unset', whiteSpace: 'pre-wrap' }}
          onClick={() => setCmdPreview(null)}
        >
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
            gst-launch-1.0 (click to dismiss)
          </div>
          <code style={{ fontFamily: "'SF Mono', Menlo, monospace", fontSize: 11 }}>
            {cmdPreview}
          </code>
        </div>
      )}
    </>
  );
}
