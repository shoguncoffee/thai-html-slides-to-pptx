// Render the ORIGINAL HTML deck to PNGs (reference for comparing against the pptx render).
// usage: node render_ref.js deck.html outdir   -> outdir/s-01.png ...
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const [src, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const probe = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await probe.goto('file://' + path.resolve(src));
  const n = await probe.evaluate(() => document.querySelectorAll('section').length); await probe.close();
  for (let i = 1; i <= n; i++) {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    await p.goto('file://' + path.resolve(src) + '#slide-' + i); await p.evaluate(() => document.fonts.ready);
    await p.addStyleTag({ content: '.bar{display:none!important}[data-step].pending{opacity:1!important;transform:none!important;visibility:visible!important}' });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(out, 's-' + String(i).padStart(2, '0') + '.png') }); await p.close();
  }
  await b.close(); console.log('rendered', n);
})();
