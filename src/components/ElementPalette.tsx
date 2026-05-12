import { useMemo, useState, useEffect } from 'react';
import { useStore } from '../state/store';
import type { GstElementSummary } from '@shared/types';

export function ElementPalette() {
  const elements = useStore((s) => s.elements);
  const loading = useStore((s) => s.loadingElements);
  const setElements = useStore((s) => s.setElements);
  const setLoading = useStore((s) => s.setLoadingElements);
  const setVersion = useStore((s) => s.setGstVersion);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [els, ver] = await Promise.all([
          window.gst.listElements(),
          window.gst.getGstVersion(),
        ]);
        if (cancelled) return;
        setElements(els);
        setVersion(ver);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (elements.length === 0) load();
    return () => {
      cancelled = true;
    };
  }, [elements.length, setElements, setLoading, setVersion]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return elements;
    return elements.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.plugin.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [elements, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, GstElementSummary[]>();
    for (const e of filtered) {
      const k = e.plugin || 'other';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function onDragStart(evt: React.DragEvent, name: string) {
    evt.dataTransfer.setData('application/gst-element', name);
    evt.dataTransfer.effectAllowed = 'move';
  }

  return (
    <>
      <div className="palette-header">
        <input
          placeholder={`Search ${elements.length} elements...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="palette-list">
        {loading && <div className="palette-group-title">Loading plugins...</div>}
        {!loading && elements.length === 0 && (
          <div className="palette-group-title">No GStreamer plugins found.</div>
        )}
        {grouped.map(([plugin, list]) => (
          <div className="palette-group" key={plugin}>
            <div className="palette-group-title">
              {plugin} ({list.length})
            </div>
            {list.map((el) => (
              <div
                key={el.name}
                className="palette-item"
                draggable
                onDragStart={(e) => onDragStart(e, el.name)}
                title={el.description}
              >
                <span className="pname">{el.name}</span>
                <span className="pdesc">{el.description}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
