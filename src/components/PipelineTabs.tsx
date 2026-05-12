import { useStore } from '../state/store';

export function PipelineTabs() {
  const pipelines = useStore((s) => s.pipelines);
  const activeId = useStore((s) => s.activePipelineId);
  const setActive = useStore((s) => s.setActive);
  const newPipeline = useStore((s) => s.newPipeline);
  const removePipeline = useStore((s) => s.removePipeline);
  const renamePipeline = useStore((s) => s.renamePipeline);

  return (
    <div className="tabs">
      {pipelines.map((p) => (
        <div
          key={p.id}
          className={`tab ${p.id === activeId ? 'active' : ''}`}
          onClick={() => setActive(p.id)}
          onDoubleClick={() => {
            const name = window.prompt('Pipeline name', p.name);
            if (name) renamePipeline(p.id, name);
          }}
          title="Double-click to rename"
        >
          {p.running && <span className="running" title="Running">●</span>}
          <span>{p.name}</span>
          <button
            className="close"
            onClick={(e) => {
              e.stopPropagation();
              if (p.running) return;
              removePipeline(p.id);
            }}
            title="Close"
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" onClick={() => newPipeline()} title="New pipeline">
        + New
      </button>
    </div>
  );
}
