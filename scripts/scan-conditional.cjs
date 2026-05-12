const path = require('path');
const { listElements, inspectElement } = require(path.join(
  __dirname,
  '..',
  'dist-electron',
  'electron',
  'gst',
  'inspect.js',
));

(async () => {
  const els = await listElements();
  const matched = [];
  const candidates = [];
  let propCount = 0;
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    let d;
    try {
      d = await inspectElement(el.name);
    } catch {
      continue;
    }
    if (!d) continue;
    for (const p of d.properties) {
      propCount++;
      if (p.requires?.length) {
        matched.push({ el: el.name, prop: p.name, blurb: p.blurb, requires: p.requires });
        continue;
      }
      const b = (p.blurb || '').toLowerCase();
      const hints = [
        /\bonly\b.*\b(used|valid|applies|applicable|relevant|effective|works|in effect|honoured|honored|considered)\b/,
        /\bused only\b/,
        /\bif\s+\w+\s+is\b/,
        /\bdepends? on\b/,
        /\brequires?\b.*\bset\b/,
        /\bignored\b.*(if|when|unless)\b/,
        /\bhas no effect\b/,
        /\beffective\s+only\b/,
        /\bmust be\b.*\bbefore\b/,
        /\bn\/a if\b/,
      ];
      for (const re of hints) {
        if (re.test(b)) {
          candidates.push({ el: el.name, prop: p.name, blurb: p.blurb });
          break;
        }
      }
    }
  }

  console.log(`Scanned ${els.length} elements, ${propCount} properties.`);
  console.log(`Matched by current parser: ${matched.length}`);
  for (const m of matched) {
    console.log(`  ${m.el}.${m.prop} :: ${m.requires.map((r) => `${r.property}=${r.values.join('|')}`).join(' & ')}`);
  }
  console.log(`\nCandidates with conditional-looking blurbs NOT matched: ${candidates.length}`);
  for (const c of candidates.slice(0, 30)) {
    console.log(`  ${c.el}.${c.prop}`);
    console.log(`    blurb: ${c.blurb}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
