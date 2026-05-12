import type { GstPropertyDef } from '@shared/types';

interface Props {
  prop: GstPropertyDef;
  value: string | number | boolean | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
}

function Head({
  prop,
  rangeText,
}: {
  prop: GstPropertyDef;
  rangeText?: string;
}) {
  return (
    <div className="prop-head">
      <span className="prop-name">
        {prop.name}
        {prop.deprecated && (
          <span className="tag warn" style={{ marginLeft: 6, fontSize: 9 }}>
            deprecated
          </span>
        )}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {rangeText && <span className="prop-range">{rangeText}</span>}
        <span className="prop-type">{prop.typeName}</span>
      </span>
    </div>
  );
}

export function PropertyEditor({ prop, value, onChange }: Props) {
  const v = value ?? prop.defaultValue ?? '';

  if (!prop.writable) {
    return (
      <>
        <Head prop={prop} />
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>read-only</div>
      </>
    );
  }

  if (prop.kind === 'boolean') {
    const checked = typeof value === 'boolean' ? value : prop.defaultValue === 'true';
    return (
      <>
        <div className="prop-head" style={{ alignItems: 'center' }}>
          <label
            htmlFor={`prop-${prop.name}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              id={`prop-${prop.name}`}
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="prop-name">{prop.name}</span>
          </label>
          <span className="prop-type">Bool</span>
        </div>
        {prop.blurb && <div className="blurb">{prop.blurb}</div>}
      </>
    );
  }

  if (prop.kind === 'enum' && prop.enumValues?.length) {
    const cur = String(v);
    return (
      <>
        <Head prop={prop} />
        {prop.enumValues.length <= 5 ? (
          <div className="radio-group">
            {prop.enumValues.map((ev) => (
              <label key={ev.nick} className="radio-option">
                <input
                  type="radio"
                  name={`prop-${prop.name}`}
                  checked={cur === ev.nick || cur === String(ev.value)}
                  onChange={() => onChange(ev.nick)}
                />
                <span className="nick">{ev.nick}</span>
                {ev.desc && <span className="desc">— {ev.desc}</span>}
              </label>
            ))}
          </div>
        ) : (
          <select value={cur} onChange={(e) => onChange(e.target.value)}>
            {prop.enumValues.map((ev) => (
              <option key={ev.nick} value={ev.nick}>
                {ev.nick} — {ev.desc}
              </option>
            ))}
          </select>
        )}
        {prop.blurb && <div className="blurb">{prop.blurb}</div>}
      </>
    );
  }

  if (prop.kind === 'flags' && prop.flagValues?.length) {
    const cur = String(v)
      .split(/[+|,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const toggle = (nick: string) => {
      const set = new Set(cur);
      if (set.has(nick)) set.delete(nick);
      else set.add(nick);
      const arr = Array.from(set);
      onChange(arr.length ? arr.join('+') : null);
    };
    return (
      <>
        <Head prop={prop} />
        <div className="flag-group">
          {prop.flagValues.map((ev) => (
            <label key={ev.nick} className="flag-option">
              <input
                type="checkbox"
                checked={cur.includes(ev.nick)}
                onChange={() => toggle(ev.nick)}
              />
              <span className="nick">{ev.nick}</span>
              {ev.desc && <span className="desc">— {ev.desc}</span>}
            </label>
          ))}
        </div>
        {prop.blurb && <div className="blurb">{prop.blurb}</div>}
      </>
    );
  }

  if (
    prop.kind === 'integer' ||
    prop.kind === 'integer64' ||
    prop.kind === 'uinteger' ||
    prop.kind === 'uinteger64' ||
    prop.kind === 'float' ||
    prop.kind === 'double'
  ) {
    const step = prop.kind === 'float' || prop.kind === 'double' ? 'any' : '1';
    const rangeText =
      prop.min !== undefined && prop.max !== undefined ? `[${prop.min}, ${prop.max}]` : undefined;
    return (
      <>
        <Head prop={prop} rangeText={rangeText} />
        <input
          type="number"
          step={step}
          value={typeof v === 'boolean' ? '' : String(v)}
          placeholder={prop.defaultValue}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {prop.blurb && <div className="blurb">{prop.blurb}</div>}
      </>
    );
  }

  return (
    <>
      <Head prop={prop} />
      <input
        value={typeof v === 'boolean' ? '' : String(v)}
        placeholder={prop.defaultValue}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
      {prop.blurb && <div className="blurb">{prop.blurb}</div>}
    </>
  );
}
