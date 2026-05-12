import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

export function ConsolePanel() {
  const pipeline = useStore((s) => s.pipelines.find((p) => p.id === s.activePipelineId));
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | 'stderr' | 'stdout' | 'meta'>('all');
  const [autoscroll, setAutoscroll] = useState(true);

  useEffect(() => {
    if (autoscroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [pipeline?.logs.length, autoscroll]);

  const logs = pipeline?.logs.filter((l) => filter === 'all' || l.stream === filter) || [];

  return (
    <div className="console">
      <div className="console-header">
        <span className="title">Console</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">all</option>
          <option value="meta">meta</option>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
        </select>
        <label style={{ display: 'flex', gap: 4, fontSize: 11, color: 'var(--text-dim)', width: 'auto' }}>
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
            style={{ width: 'auto' }}
          />
          auto-scroll
        </label>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {pipeline ? `${pipeline.logs.length} lines` : ''}
        </span>
      </div>
      <div className="console-body" ref={ref}>
        {logs.map((l, i) => (
          <div key={i} className={`line ${l.stream}`}>
            {l.line}
          </div>
        ))}
      </div>
    </div>
  );
}
