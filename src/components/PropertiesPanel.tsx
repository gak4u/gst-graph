import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { PropertyEditor } from './PropertyEditor';
import type {
  GstElementDetail,
  GstPropertyDef,
  IteratorColumn,
  IteratorRow,
  VariableNodeData,
} from '@shared/types';

function effectivePropValue(
  detail: GstElementDetail,
  current: Record<string, string | number | boolean | null>,
  name: string,
): string {
  if (name in current && current[name] !== null && current[name] !== undefined && current[name] !== '') {
    return String(current[name]);
  }
  const def = detail.properties.find((p) => p.name === name);
  return def?.defaultValue ?? '';
}

function evaluateRequirements(
  prop: GstPropertyDef,
  detail: GstElementDetail,
  current: Record<string, string | number | boolean | null>,
): { active: boolean; unmet: { property: string; values: string[]; current: string }[] } {
  if (!prop.requires?.length) return { active: true, unmet: [] };
  const unmet: { property: string; values: string[]; current: string }[] = [];
  for (const req of prop.requires) {
    const cur = effectivePropValue(detail, current, req.property);
    if (!req.values.includes(cur)) {
      unmet.push({ property: req.property, values: req.values, current: cur });
    }
  }
  return { active: unmet.length === 0, unmet };
}

function elementInitial(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

interface SectionProps {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ label, count, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="props-section">
      <div className="props-section-head" onClick={() => setOpen((v) => !v)}>
        <span className={`chev ${open ? 'open' : ''}`}>▶</span>
        <span className="label">{label}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </div>
      {open && <div className="props-section-body">{children}</div>}
    </div>
  );
}

export function PropertiesPanel() {
  const activeId = useStore((s) => s.activePipelineId);
  const pipeline = useStore((s) => s.pipelines.find((p) => p.id === activeId));
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const details = useStore((s) => s.details);
  const ensureDetail = useStore((s) => s.ensureDetail);
  const updateNodeProps = useStore((s) => s.updateNodeProps);
  const updateInstanceName = useStore((s) => s.updateInstanceName);
  const [search, setSearch] = useState('');
  const [showOnlySet, setShowOnlySet] = useState(false);

  const node = useMemo(
    () => pipeline?.nodes.find((n) => n.id === selectedNodeId) || null,
    [pipeline, selectedNodeId],
  );
  const isElementNode = node?.type === 'gstElement';
  const detail = isElementNode ? details[(node!.data as { elementName: string }).elementName] : null;

  const bindingMap = useMemo(() => {
    const m = new Map<string, { varName: string; value: string; kind: 'variable' | 'transform'; resolved: boolean }>();
    if (!pipeline || !node || !isElementNode) return m;
    const pl = pipeline;

    const nodeById = new Map(pl.nodes.map((n) => [n.id, n]));
    const cache = new Map<string, string | null>();
    const visiting = new Set<string>();

    function feedingEdgeFor(nodeId: string, inputId: string) {
      return pl.edges.find(
        (e) =>
          e.target === nodeId &&
          (e.data?.transformInputId === inputId || e.targetHandle === `in:${inputId}`),
      );
    }

    const MATH_RE = /^[\w\s+\-*/%().,]+$/;

    function resolve(nodeId: string): string | null {
      if (cache.has(nodeId)) return cache.get(nodeId) ?? null;
      if (visiting.has(nodeId)) return null;
      visiting.add(nodeId);
      const n = nodeById.get(nodeId);
      let result: string | null = null;
      if (!n) result = null;
      else if (n.type === 'gstVariable') {
        const vd = n.data as VariableNodeData;
        if (vd.value === null || vd.value === undefined || vd.value === '') result = null;
        else if (typeof vd.value === 'boolean') result = vd.value ? 'true' : 'false';
        else result = String(vd.value);
      } else if (n.type === 'gstTransform') {
        const d = n.data as import('@shared/types').TransformNodeData;
        if (d.kind === 'concat') {
          const vars: Record<string, string> = {};
          for (const inp of d.inputs || []) {
            const edge = feedingEdgeFor(nodeId, inp.id);
            const upstream = edge ? resolve(edge.source) : null;
            vars[inp.name] = upstream ?? '';
          }
          result = (d.expression || '').replace(/\$\{([\w]+)\}/g, (mm, name) =>
            Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : mm,
          );
        } else if (d.kind === 'math') {
          const vars: Record<string, number> = {};
          let missing = false;
          for (const inp of d.inputs || []) {
            const edge = feedingEdgeFor(nodeId, inp.id);
            const upstream = edge ? resolve(edge.source) : null;
            if (upstream === null) {
              missing = true;
              break;
            }
            const num = Number(upstream);
            if (!Number.isFinite(num)) {
              missing = true;
              break;
            }
            vars[inp.name] = num;
          }
          if (!missing) {
            const expr = (d.expression || '').trim();
            if (expr && MATH_RE.test(expr)) {
              try {
                const keys = Object.keys(vars);
                const vals = keys.map((k) => vars[k]);
                // eslint-disable-next-line no-new-func
                const fn = new Function(...keys, 'Math', `"use strict"; return (${expr});`);
                const out = fn(...vals, Math);
                if (typeof out === 'number' && Number.isFinite(out)) result = String(out);
              } catch {
                result = null;
              }
            }
          }
        }
      }
      visiting.delete(nodeId);
      cache.set(nodeId, result);
      return result;
    }

    for (const e of pl.edges) {
      if (e.target !== node.id) continue;
      const prop = e.data?.bindingProperty;
      if (!prop) continue;
      const src = nodeById.get(e.source);
      if (!src) continue;
      if (src.type === 'gstVariable') {
        const vd = src.data as VariableNodeData;
        const resolved = resolve(src.id);
        m.set(prop, {
          varName: vd.label?.trim() || vd.varName,
          value: resolved ?? '',
          kind: 'variable',
          resolved: resolved !== null,
        });
      } else if (src.type === 'gstTransform') {
        const td = src.data as import('@shared/types').TransformNodeData;
        const resolved = resolve(src.id);
        const tag = td.label?.trim() || (td.kind === 'concat' ? 'concat' : 'math');
        m.set(prop, {
          varName: tag,
          value: resolved ?? '',
          kind: 'transform',
          resolved: resolved !== null,
        });
      }
    }
    return m;
  }, [pipeline, node, isElementNode]);

  useEffect(() => {
    if (isElementNode && node && !detail) ensureDetail((node.data as { elementName: string }).elementName);
  }, [node, detail, isElementNode, ensureDetail]);

  if (!node) {
    return (
      <div className="props">
        <div className="props-empty">
          <div style={{ fontSize: 24, opacity: 0.4, marginBottom: 8 }}>⚙</div>
          Select a node in the graph to view and edit its element properties.
        </div>
      </div>
    );
  }

  if (node.type === 'gstVariable') {
    const vd = node.data as VariableNodeData;
    const refCount =
      pipeline?.edges.filter((e) => e.source === node.id && e.data?.edgeKind === 'binding').length ||
      0;
    return (
      <div className="props">
        <div className="props-head">
          <div className="row1">
            <div className="icon" style={{ color: 'var(--accent-2)' }}>V</div>
            <div className="title-block">
              <h3>
                Variable
                <span className="elem-id">{vd.varName}</span>
              </h3>
              <div className="sub">{vd.valueKind}</div>
            </div>
          </div>
          <div className="props-tags">
            <span className="tag">{refCount} binding{refCount === 1 ? '' : 's'}</span>
            <span className="tag accent">{vd.valueKind}</span>
          </div>
        </div>
        <div className="props-body" style={{ padding: 12 }}>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">label</span>
              <span className="prop-type">Display name</span>
            </div>
            <input
              placeholder="e.g. Stream key, Bitrate"
              value={vd.label ?? ''}
              onChange={(e) => useStore.getState().updateVariableLabel(node.id, e.target.value)}
            />
          </div>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">identifier</span>
              <span className="prop-type">String</span>
            </div>
            <input
              value={vd.varName}
              onChange={(e) =>
                useStore
                  .getState()
                  .updateVariableName(node.id, e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))
              }
            />
          </div>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">value</span>
              <span className="prop-type">{vd.valueKind}</span>
            </div>
            {vd.valueKind === 'boolean' ? (
              <label className="radio-option">
                <input
                  type="checkbox"
                  checked={vd.value === true || vd.value === 'true'}
                  onChange={(e) => useStore.getState().updateVariableValue(node.id, e.target.checked)}
                />
                <span className="nick">{vd.value === true || vd.value === 'true' ? 'true' : 'false'}</span>
              </label>
            ) : vd.valueKind === 'number' ? (
              <input
                type="number"
                value={typeof vd.value === 'number' ? vd.value : vd.value == null ? '' : String(vd.value)}
                onChange={(e) =>
                  useStore
                    .getState()
                    .updateVariableValue(node.id, e.target.value === '' ? null : Number(e.target.value))
                }
              />
            ) : vd.valueKind === 'list' ? (
              <textarea
                rows={4}
                placeholder={'One value per line, e.g.\nrtmp://a/1\nrtmp://b/2\nrtmp://c/3'}
                value={
                  Array.isArray(vd.value)
                    ? (vd.value as Array<string | number | boolean>).map(String).join('\n')
                    : ''
                }
                onChange={(e) => {
                  const lines = e.target.value
                    .split('\n')
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0);
                  useStore.getState().updateVariableValue(node.id, lines);
                }}
              />
            ) : vd.valueKind === 'record-list' ? (
              <IteratorTableEditor variableNodeId={node.id} data={vd} />
            ) : (
              <input
                value={vd.value == null ? '' : String(vd.value)}
                onChange={(e) => useStore.getState().updateVariableValue(node.id, e.target.value)}
              />
            )}
          </div>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">kind</span>
              <span className="prop-type">Enum</span>
            </div>
            <select
              value={vd.valueKind}
              onChange={(e) =>
                useStore
                  .getState()
                  .updateVariableKind(node.id, e.target.value as VariableNodeData['valueKind'])
              }
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="list">list (single-column iterator)</option>
              <option value="record-list">record list (multi-column iterator)</option>
            </select>
          </div>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">visibility</span>
              <span className="prop-type">Home screen</span>
            </div>
            <label className="radio-option" style={{ width: 'auto', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!vd.hidden}
                onChange={() => useStore.getState().toggleVariableHidden(node.id)}
              />
              <span className="nick">
                {vd.hidden ? 'Hidden (internal constant)' : 'Shown on home screen'}
              </span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (node.type === 'gstGroup') {
    const group = pipeline?.groups?.find((g) => g.id === node.id);
    if (!group) {
      return (
        <div className="props">
          <div className="props-empty">Group container has no definition.</div>
        </div>
      );
    }
    const listVars = (pipeline?.nodes || []).filter(
      (n): n is Extract<typeof n, { type: 'gstVariable' }> => {
        if (n.type !== 'gstVariable') return false;
        const k = (n.data as VariableNodeData).valueKind;
        return k === 'list' || k === 'record-list';
      },
    );
    const memberNodes = group.memberNodeIds
      .map((mid) => pipeline?.nodes.find((n) => n.id === mid))
      .filter(
        (n): n is Extract<NonNullable<typeof n>, { type: 'gstElement' }> =>
          !!n && n.type === 'gstElement',
      );
    const iteratorVar = listVars.find((v) => v.id === group.iteratorVarId);
    const iteratorData = iteratorVar ? (iteratorVar.data as VariableNodeData) : null;
    const iteratorLen =
      iteratorData && Array.isArray(iteratorData.value)
        ? (iteratorData.value as unknown[]).length
        : 0;
    const iteratorColumns: IteratorColumn[] =
      iteratorData?.valueKind === 'record-list'
        ? iteratorData.schema || []
        : iteratorData?.valueKind === 'list'
          ? [{ name: 'value', kind: 'string' }]
          : [];

    return (
      <div className="props">
        <div className="props-head">
          <div className="row1">
            <div className="icon" style={{ color: '#ffd789' }}>×</div>
            <div className="title-block">
              <h3>
                Group
                <span className="elem-id">{group.name}</span>
              </h3>
              <div className="sub">
                {memberNodes.length} member{memberNodes.length === 1 ? '' : 's'} · × {iteratorLen}
              </div>
            </div>
          </div>
        </div>
        <div className="props-body" style={{ padding: 12 }}>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">name</span>
              <span className="prop-type">String</span>
            </div>
            <input
              value={group.name}
              onChange={(e) => useStore.getState().renameGroup(group.id, e.target.value)}
            />
          </div>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">iterator variable</span>
              <span className="prop-type">list</span>
            </div>
            <select
              value={group.iteratorVarId}
              onChange={(e) =>
                useStore.getState().setGroupIterator(group.id, e.target.value)
              }
            >
              <option value="">(none — group won't run)</option>
              {listVars.map((v) => {
                const vd = v.data as VariableNodeData;
                const len = Array.isArray(vd.value) ? (vd.value as unknown[]).length : 0;
                return (
                  <option key={v.id} value={v.id}>
                    ${vd.varName} ({len} item{len === 1 ? '' : 's'})
                  </option>
                );
              })}
            </select>
            {listVars.length === 0 && (
              <div className="muted" style={{ marginTop: 4 }}>
                No list variables in this pipeline yet. Add a Variable node and set its kind
                to "list" to feed this group.
              </div>
            )}
          </div>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">parameters</span>
              <span className="prop-type">per-iteration property</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.parameters.length === 0 && (
                <div className="muted">
                  No parameters yet. Each parameter binds one member node's property
                  (e.g. <code>rtmp2sink.location</code>) to the iterator's per-iteration value.
                </div>
              )}
              {group.parameters.map((p) => {
                const member = memberNodes.find((m) => m.id === p.targetNodeId);
                const col =
                  p.sourceColumn ||
                  (iteratorColumns.length === 1 ? iteratorColumns[0].name : undefined);
                return (
                  <div
                    key={`${p.targetNodeId}:${p.propertyKey}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <code style={{ flex: 1 }}>
                      {member ? member.data.instanceName : '???'}.{p.propertyKey}
                      {col && (
                        <span className="muted">
                          {' '}
                          ← <code>${col}</code>
                        </span>
                      )}
                    </code>
                    <button
                      className="ghost"
                      onClick={() =>
                        useStore.getState().removeGroupParameter(
                          group.id,
                          p.targetNodeId,
                          p.propertyKey,
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <GroupParameterAdder
                groupId={group.id}
                memberNodes={memberNodes}
                existing={group.parameters}
                iteratorColumns={iteratorColumns}
              />
            </div>
          </div>
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">members</span>
              <span className="prop-type">{memberNodes.length} elements</span>
            </div>
            <div className="muted">
              {memberNodes.map((m) => m.data.instanceName).join(' → ') || 'none'}
            </div>
          </div>
          <div className="prop-row">
            <button onClick={() => useStore.getState().ungroup(group.id)}>
              Ungroup (restore members to canvas)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (node.type !== 'gstElement') {
    return (
      <div className="props">
        <div className="props-empty">Transform node selected. Edit it inline on the canvas.</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="props">
        <div className="props-empty">Loading element details…</div>
      </div>
    );
  }

  const elementData = node.data;
  const writableProps = detail.properties.filter(
    (p) => p.writable && p.name !== 'parent' && p.kind !== 'object',
  );

  const filtered = writableProps.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.blurb.toLowerCase().includes(q)) return false;
    }
    if (showOnlySet) {
      const v = elementData.properties[p.name];
      if (v === undefined || v === null || v === '') return false;
    }
    return true;
  });

  const setCount = writableProps.filter((p) => {
    const v = elementData.properties[p.name];
    return v !== undefined && v !== null && v !== '';
  }).length;

  return (
    <div className="props">
      <div className="props-head">
        <div className="row1">
          <div className="icon">{elementInitial(detail.name)}</div>
          <div className="title-block">
            <h3>
              {detail.longName}
              <span className="elem-id">{detail.name}</span>
            </h3>
            <div className="sub">{detail.klass || 'GstElement'}</div>
          </div>
        </div>
        <div className="props-tags">
          <span className="tag accent">{detail.plugin}</span>
          {detail.rank > 0 && <span className="tag">rank {detail.rank}</span>}
          {detail.padTemplates.some((p) => p.availability !== 'always') && (
            <span className="tag warn">dynamic pads</span>
          )}
          <span className="tag dot">{setCount} set</span>
        </div>
        {detail.description && <div className="desc">{detail.description}</div>}
      </div>

      <div className="props-body">
        <Section label="Instance">
          <div className="prop-row">
            <div className="prop-head">
              <span className="prop-name">name</span>
              <span className="prop-type">String</span>
            </div>
            <input
              value={elementData.instanceName}
              onChange={(e) =>
                updateInstanceName(node.id, e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))
              }
            />
          </div>
        </Section>

        <Section label="Pad Templates" count={detail.padTemplates.length}>
          {detail.padTemplates.map((p) => (
            <div className="pad-row" key={`${p.direction}:${p.name}`}>
              <span className={`pad-dir ${p.direction}`}>{p.direction}</span>
              <span className="pad-name">{p.name}</span>
              <span className="pad-meta">
                {p.availability}
                {p.caps.length ? ` · ${p.caps.map((c) => c.media).slice(0, 2).join(', ')}` : ''}
              </span>
            </div>
          ))}
        </Section>

        <Section label="Properties" count={writableProps.length}>
          <div className="props-search" style={{ position: 'static', padding: 0, marginBottom: 8, background: 'transparent', border: 'none' }}>
            <input
              placeholder={`Search ${writableProps.length} properties…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 6,
                fontSize: 11,
                color: 'var(--text-dim)',
              }}
            >
              <input
                type="checkbox"
                checked={showOnlySet}
                onChange={(e) => setShowOnlySet(e.target.checked)}
              />
              Only show modified ({setCount})
            </label>
          </div>

          {filtered.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '8px 0' }}>
              No properties match.
            </div>
          )}

          {filtered.map((p) => {
            const nd = node.data as { properties: Record<string, string | number | boolean | null> };
            const { active, unmet } = evaluateRequirements(p, detail, nd.properties);
            const binding = bindingMap.get(p.name);
            return (
              <div
                key={p.name}
                className={`prop-row ${active ? '' : 'inactive'} ${binding ? 'bound' : ''}`}
              >
                {binding ? (
                  <>
                    <div className="prop-head">
                      <span className="prop-name">{p.name}</span>
                      <span className="prop-type">{p.typeName}</span>
                    </div>
                    <div className={`bound-display ${binding.resolved ? '' : 'unresolved'}`}>
                      <span className={`bound-pill ${binding.kind}`}>
                        {binding.kind === 'transform' ? `f(${binding.varName})` : binding.varName}
                      </span>
                      <span className="bound-arrow">→</span>
                      <code className="bound-value">
                        {binding.resolved ? binding.value || '∅' : 'unresolved'}
                      </code>
                    </div>
                    {p.blurb && <div className="blurb">{p.blurb}</div>}
                  </>
                ) : (
                  <PropertyEditor
                    prop={p}
                    value={nd.properties[p.name]}
                    onChange={(val) => updateNodeProps(node.id, p.name, val)}
                  />
                )}
                {!active &&
                  unmet.map((u) => (
                    <div key={u.property} className="req-hint">
                      requires <code>{u.property}</code>
                      <span>=</span>
                      {u.values.map((v) => (
                        <code key={v}>{v}</code>
                      ))}
                      <span className="req-current">currently {u.current || '∅'}</span>
                      {u.values.length === 1 && (
                        <button onClick={() => updateNodeProps(node.id, u.property, u.values[0])}>
                          set
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}

interface IteratorTableEditorProps {
  variableNodeId: string;
  data: VariableNodeData;
}

function IteratorTableEditor({ variableNodeId, data }: IteratorTableEditorProps) {
  const addColumn = useStore((s) => s.addIteratorColumn);
  const removeColumn = useStore((s) => s.removeIteratorColumn);
  const renameColumn = useStore((s) => s.renameIteratorColumn);
  const setKind = useStore((s) => s.setIteratorColumnKind);
  const addRow = useStore((s) => s.addIteratorRow);
  const removeRow = useStore((s) => s.removeIteratorRow);
  const setCell = useStore((s) => s.setIteratorCell);

  const schema: IteratorColumn[] = data.schema || [];
  const rows: IteratorRow[] = Array.isArray(data.value) ? (data.value as IteratorRow[]) : [];

  const [newColName, setNewColName] = useState('');
  const [newColKind, setNewColKind] = useState<IteratorColumn['kind']>('string');

  function commitColumn() {
    if (!newColName.trim()) return;
    addColumn(variableNodeId, newColName, newColKind);
    setNewColName('');
  }

  return (
    <div className="iter-editor">
      {schema.length === 0 ? (
        <div className="muted" style={{ marginBottom: 8 }}>
          No columns yet. Add at least one to define what each iteration row holds.
        </div>
      ) : (
        <div className="iter-table-wrap">
          <table className="iter-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                {schema.map((c) => (
                  <th key={c.name}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <input
                        defaultValue={c.name}
                        onBlur={(e) =>
                          e.target.value !== c.name &&
                          renameColumn(variableNodeId, c.name, e.target.value)
                        }
                        style={{ fontWeight: 600 }}
                      />
                      <select
                        value={c.kind}
                        onChange={(e) =>
                          setKind(variableNodeId, c.name, e.target.value as IteratorColumn['kind'])
                        }
                      >
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                      </select>
                    </div>
                  </th>
                ))}
                <th style={{ width: 36 }}></th>
              </tr>
              <tr>
                <th></th>
                {schema.map((c) => (
                  <th key={`${c.name}-drop`} style={{ textAlign: 'right' }}>
                    <button
                      className="ghost"
                      title={`Remove column ${c.name}`}
                      onClick={() => removeColumn(variableNodeId, c.name)}
                    >
                      ✕
                    </button>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={schema.length + 2} className="muted" style={{ padding: 8 }}>
                    No rows yet. Click <code>+ add row</code> below.
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  {schema.map((c) => (
                    <td key={c.name}>
                      <IteratorCellInput
                        column={c}
                        value={row[c.name]}
                        onChange={(v) => setCell(variableNodeId, i, c.name, v)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className="ghost"
                      title="Delete row"
                      onClick={() => removeRow(variableNodeId, i)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          placeholder="new column name"
          value={newColName}
          onChange={(e) => setNewColName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitColumn();
          }}
          style={{ flex: 1 }}
        />
        <select
          value={newColKind}
          onChange={(e) => setNewColKind(e.target.value as IteratorColumn['kind'])}
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
        </select>
        <button disabled={!newColName.trim()} onClick={commitColumn}>
          + column
        </button>
      </div>
      <div style={{ marginTop: 6 }}>
        <button disabled={schema.length === 0} onClick={() => addRow(variableNodeId)}>
          + add row
        </button>
      </div>
    </div>
  );
}

interface IteratorCellInputProps {
  column: IteratorColumn;
  value: string | number | boolean | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
}

function IteratorCellInput({ column, value, onChange }: IteratorCellInputProps) {
  if (column.kind === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value === true || value === 'true'}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (column.kind === 'number') {
    return (
      <input
        type="number"
        value={value === null || value === undefined ? '' : Number(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }
  return (
    <input
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface GroupParameterAdderProps {
  groupId: string;
  memberNodes: Array<Extract<import('@shared/types').PipelineGraphNode, { type: 'gstElement' }>>;
  existing: Array<{ targetNodeId: string; propertyKey: string }>;
  iteratorColumns: IteratorColumn[];
}

function GroupParameterAdder({
  groupId,
  memberNodes,
  existing,
  iteratorColumns,
}: GroupParameterAdderProps) {
  const details = useStore((s) => s.details);
  const addGroupParameter = useStore((s) => s.addGroupParameter);
  const [memberId, setMemberId] = useState('');
  const [propKey, setPropKey] = useState('');
  const [column, setColumn] = useState('');

  const memberDetail = memberNodes.find((m) => m.id === memberId);
  const detail = memberDetail ? details[memberDetail.data.elementName] : null;
  const candidateProps = (detail?.properties || []).filter(
    (p) =>
      p.writable &&
      p.name !== 'name' &&
      p.name !== 'parent' &&
      p.kind !== 'object' &&
      !existing.some((x) => x.targetNodeId === memberId && x.propertyKey === p.name),
  );

  const needsColumnPick = iteratorColumns.length > 1;

  function add() {
    if (!memberId || !propKey) return;
    if (needsColumnPick && !column) return;
    addGroupParameter(groupId, {
      targetNodeId: memberId,
      propertyKey: propKey,
      // Single-column iterators auto-pick on unroll; we still record the column name
      // when there's one, so renaming a column later updates the parameter automatically.
      sourceColumn: column || (iteratorColumns.length === 1 ? iteratorColumns[0].name : undefined),
    });
    setPropKey('');
    setColumn('');
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        value={memberId}
        onChange={(e) => {
          setMemberId(e.target.value);
          setPropKey('');
        }}
        style={{ flex: 1, minWidth: 120 }}
      >
        <option value="">- pick member -</option>
        {memberNodes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.data.instanceName}
          </option>
        ))}
      </select>
      <select
        value={propKey}
        onChange={(e) => setPropKey(e.target.value)}
        disabled={!memberId}
        style={{ flex: 1, minWidth: 120 }}
      >
        <option value="">- property -</option>
        {candidateProps.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      {needsColumnPick && (
        <select
          value={column}
          onChange={(e) => setColumn(e.target.value)}
          style={{ flex: 1, minWidth: 100 }}
          title="Which iterator column drives this property"
        >
          <option value="">- column -</option>
          {iteratorColumns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.kind})
            </option>
          ))}
        </select>
      )}
      <button
        disabled={!memberId || !propKey || (needsColumnPick && !column)}
        onClick={add}
      >
        + add
      </button>
    </div>
  );
}
