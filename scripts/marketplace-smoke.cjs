/* eslint-disable */
const path = require('path');
const { searchMarketplace } = require(path.join(__dirname, '..', 'dist-electron', 'electron', 'marketplace', 'index.js'));

(async () => {
  console.log('[marketplace-smoke] searching topic:gst-graph-package …');
  const res = await searchMarketplace({
    query: '',
    installedElements: ['videotestsrc', 'fakesink'],
    installedGstreamerVersion: '1.28.2',
    forceRefresh: true,
  });
  console.log(`  cards: ${res.cards.length}`);
  console.log(`  warnings: ${res.warnings.length}`);
  for (const w of res.warnings) console.log('   -', w);
  if (res.rateLimit) {
    console.log(`  rate limit remaining: ${res.rateLimit.remaining}/${res.rateLimit.limit}`);
  }
  for (const c of res.cards.slice(0, 5)) {
    console.log(`  • ${c.repo}#${c.packageId} v${c.manifest.version}  ${c.compatibility.compatible ? '(ready)' : '(missing ' + c.compatibility.missingRequired.length + ')'}`);
  }
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
