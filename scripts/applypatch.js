// usage: node applypatch.js in.html out.html patch1.json patch2.json ...
// ops: {slide, find, replace} substring of ONE text node; {slide, remove} remove node's block element
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const SRC = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]);
const ops = []; const struct = [];
for (const f of process.argv.slice(4)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); (j.ops || []).forEach((o) => ops.push({ ...o, from: path.basename(f) })); }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + SRC); await p.waitForTimeout(500);
  const res = await p.evaluate((ops) => {
    const secs = [...document.querySelectorAll('#canvas > section')]; const rep = [];
    for (const o of ops) {
      const s = secs[o.slide - 1]; if (!s) { rep.push(['NOSLIDE', o]); continue; }
      const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT); let n; const hits = [];
      const key = o.find != null ? o.find : o.remove;
      while ((n = w.nextNode())) { if (o.find != null ? n.nodeValue.includes(key) : n.nodeValue.trim() === key.trim()) hits.push(n); }
      if (hits.length !== 1) { rep.push([hits.length ? 'MULTI' : 'MISS', o]); continue; }
      const node = hits[0];
      if (o.find != null) { node.nodeValue = node.nodeValue.replace(key, o.replace); rep.push(['OK', o]); }
      else {
        let e = node.parentElement; const txt = node.nodeValue.trim();
        while (e.parentElement && e.parentElement !== s && e.parentElement.textContent.trim() === txt) e = e.parentElement;
        e.remove(); rep.push(['OK', o]);
      }
    }
    // serialise like casual.js
    const c = document.getElementById('canvas'); c.querySelectorAll(':scope > section').forEach((x) => { x.classList.remove('on'); if (!x.getAttribute('class')) x.removeAttribute('class'); });
    return { rep, inner: c.innerHTML };
  }, ops);
  const f = fs.readFileSync(SRC, 'utf8');
  const a = f.indexOf('<div class="canvas" id="canvas">') + '<div class="canvas" id="canvas">'.length;
  const barAt = f.indexOf('<div class="bar"'); const z = f.lastIndexOf('</div></div>', barAt);
  fs.writeFileSync(OUT, f.slice(0, a) + '\n' + res.inner + '\n' + f.slice(z));
  const bad = res.rep.filter((r) => r[0] !== 'OK');
  console.log('ops', ops.length, 'ok', res.rep.length - bad.length, 'failed', bad.length);
  bad.forEach((r) => console.log(r[0], 'slide', r[1].slide, JSON.stringify((r[1].find || r[1].remove || '').slice(0, 70)), r[1].from));
  await b.close();
})();
