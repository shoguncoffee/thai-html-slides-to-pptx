// Extract per-slide: (1) text-free background PNG, (2) text blocks with exact geometry/style.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SRC = process.argv[2];
const OUT = process.argv[3];
const ONLY = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const DSF = Number(process.env.DSF || 2);
fs.mkdirSync(OUT, { recursive: true });

function pageFn() {
  const s = document.querySelector('section.on');
  const sb = s.getBoundingClientRect();
  const scale = sb.width / 1920;
  const frags = [];
  const warn = [];
  const tw = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
  const blockOf = (el) => {
    let e = el;
    while (e && e !== s) {
      const d = getComputedStyle(e).display;
      if (d !== 'inline' && d !== 'contents' && d !== 'inline-block') return e;
      e = e.parentElement;
    }
    return s;
  };
  const effOpacity = (el) => {
    let o = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  };
  const parseColor = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return { hex: '000000', a: 1 };
    const p = m[1].split(',').map((x) => parseFloat(x));
    const h = (n) => Math.round(n).toString(16).padStart(2, '0');
    return { hex: (h(p[0]) + h(p[1]) + h(p[2])).toUpperCase(), a: p.length > 3 ? p[3] : 1 };
  };
  let node;
  let nodeId = 0;
  while ((node = tw.nextNode())) {
    const el = node.parentElement;
    if (!el || el.closest('svg,script,style,.bar')) continue;
    const txt = node.nodeValue;
    if (!txt.trim()) continue;
    const op = effOpacity(el);
    if (op < 0.05) continue;
    const cs = getComputedStyle(el);
    let rot = 0;
    // rotation check
    for (let e = el; e && e !== s; e = e.parentElement) {
      const t = getComputedStyle(e).transform;
      if (t && t !== 'none') {
        const m = t.match(/matrix\(([^)]+)\)/);
        if (m) {
          const v = m[1].split(',').map(Number);
          if (Math.abs(v[1]) > 0.01) { warn.push('rotated text: ' + txt.trim().slice(0, 20)); rot = Math.round(Math.atan2(v[1], v[0]) * 180 / Math.PI * 10) / 10; }
        }
      }
    }
    if ((parseFloat(cs.webkitTextStrokeWidth) || 0) > 0 && parseColor(cs.webkitTextFillColor).a < 0.05) { el.setAttribute('data-keep', '1'); el.style.setProperty('color', cs.color, 'important'); el.style.setProperty('-webkit-text-fill-color', cs.webkitTextFillColor, 'important'); continue; }
    if (cs.writingMode.startsWith('vertical')) { el.setAttribute('data-keep', '1'); el.style.setProperty('color', cs.color, 'important'); el.style.setProperty('-webkit-text-fill-color', cs.webkitTextFillColor, 'important'); continue; }
    const col = parseColor(cs.color);
    const fs = parseFloat(cs.fontSize);
    const style = {
      color: col.hex,
      alpha: col.a * op,
      size: fs,
      weight: parseInt(cs.fontWeight, 10) || 400,
      italic: cs.fontStyle === 'italic',
      family: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
      ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0,
      underline: (cs.textDecorationLine || '').includes('underline'),
      upper: cs.textTransform === 'uppercase',
      rot,
      strokeW: parseFloat(cs.webkitTextStrokeWidth) || 0,
      strokeC: parseColor(cs.webkitTextStrokeColor).hex,
      fillTransparent: parseColor(cs.webkitTextFillColor).a < 0.05,
      lh: cs.lineHeight === 'normal' ? fs * 1.5 : parseFloat(cs.lineHeight),
    };
    const block = blockOf(el);
    const bcs = getComputedStyle(block);
    const range = document.createRange();
    let cur = null;
    const flush = () => { if (cur && cur.text.trim()) frags.push(cur); cur = null; };
    for (let i = 0; i < txt.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rs = [...range.getClientRects()];
      if (/[\u0E31\u0E33-\u0E3A\u0E47-\u0E4E]/.test(txt[i]) && cur) { cur.text += txt[i]; if (rs.length && txt[i] === '\u0E33') cur.right = Math.max(cur.right, (rs[0].right - sb.left) / scale); continue; }
      if (!rs.length) continue;
      const r = rs[0];
      const ch = txt[i];
      const isSpace = /\s/.test(ch);
      if (isSpace && r.width < 0.5) continue;
      const L = (r.left - sb.left) / scale, R = (r.right - sb.left) / scale;
      const T = (r.top - sb.top) / scale, B = (r.bottom - sb.top) / scale;
      const cy = (T + B) / 2;
      if (cur) {
        const newLine = Math.abs(cy - cur.cy) > fs * 0.45 || L < cur.right - fs * 0.6;
        if (newLine) flush();
      }
      if (!cur) cur = { id: nodeId, block: null, text: '', left: L, right: R, top: T, bottom: B, cy, style, blk: block, ta: bcs.textAlign };
      cur.text += ch === ' ' ? ' ' : ch;
      cur.right = Math.max(cur.right, R);
      cur.left = Math.min(cur.left, L);
      cur.top = Math.min(cur.top, T);
      cur.bottom = Math.max(cur.bottom, B);
    }
    flush();
    nodeId++;
  }
  // assign block ids
  const blocks = new Map();
  frags.forEach((f) => {
    if (!blocks.has(f.blk)) blocks.set(f.blk, blocks.size);
    f.block = blocks.get(f.blk);
    delete f.blk;
  });
  const pseudos = [];
  let pq = 0;
  s.querySelectorAll('*').forEach((el) => {
    ['::before', '::after'].forEach((ps) => {
      const pcs = getComputedStyle(el, ps);
      const ct = pcs.content;
      if (!ct || ct === 'none' || ct === 'normal') return;
      const inner = ct.replace(/^["']|["']$/g, '');
      if (!inner.trim()) return;
      if (!el.hasAttribute('data-pq')) el.setAttribute('data-pq', String(pq++));
      pseudos.push({ id: el.getAttribute('data-pq'), ps, color: pcs.color, fill: pcs.webkitTextFillColor });
    });
  });
  s.querySelectorAll('*').forEach((el) => {
    if (getComputedStyle(el).display !== 'list-item') return;
    const mcs = getComputedStyle(el, '::marker');
    if (!el.hasAttribute('data-pq')) el.setAttribute('data-pq', String(pq++));
    pseudos.push({ id: el.getAttribute('data-pq'), ps: '::marker', color: mcs.color, fill: mcs.color });
  });
  return { frags, warn, pseudos };
}

(async () => {
  const b = await chromium.launch();
  const count = await (async () => {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    await p.goto('file://' + path.resolve(SRC));
    const n = await p.evaluate(() => document.querySelectorAll('section').length);
    await p.close();
    return n;
  })();
  console.log('sections', count);
  const todo = [];
  for (let n = 1; n <= count; n++) if (!ONLY || ONLY.includes(n)) todo.push(n);
  const results = {};
  async function doSlide(n) {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DSF, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('ERR', n, e.message));
    await p.goto('file://' + path.resolve(SRC) + '#slide-' + n);
    await p.evaluate(() => document.fonts.ready);
    await p.addStyleTag({ content: '.bar{display:none!important}[data-step].pending{opacity:1!important;transform:none!important;visibility:visible!important}' });
    await p.waitForTimeout(1600);
    const idx = await p.evaluate(() => [...document.querySelectorAll('section')].indexOf(document.querySelector('section.on')) + 1);
    if (idx !== n) console.log('WARN slide index mismatch', n, idx);
    const data = await p.evaluate(pageFn);
    // freeze currentColor-derived paints (bullet dots, borders, svg fills) before text colour is hidden
    await p.evaluate(() => {
      const s = document.querySelector('section.on');
      [s, ...s.querySelectorAll('*')].forEach((el) => {
        const cs = getComputedStyle(el);
        const imp = (k, v) => el.style.setProperty(k, v, 'important');
        if (el instanceof SVGElement) { if (cs.fill && cs.fill !== 'none') imp('fill', cs.fill); if (cs.stroke && cs.stroke !== 'none') imp('stroke', cs.stroke); return; }
        if (!/rgba\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(cs.backgroundColor)) imp('background-color', cs.backgroundColor);
        ['Top', 'Right', 'Bottom', 'Left'].forEach((sd) => { if (cs['border' + sd + 'Style'] !== 'none' && parseFloat(cs['border' + sd + 'Width']) > 0) imp('border-' + sd.toLowerCase() + '-color', cs['border' + sd + 'Color']); });
        if (cs.outlineStyle !== 'none') imp('outline-color', cs.outlineColor);
        if (cs.boxShadow !== 'none') imp('box-shadow', cs.boxShadow);
      });
    });
    // keep pseudo-element glyphs (bullets etc.) in the background
    if (data.pseudos.length) await p.addStyleTag({ content: data.pseudos.map((q) => `[data-pq="${q.id}"]${q.ps}{color:${q.color}!important;-webkit-text-fill-color:${q.fill}!important}`).join('\n') });
    // separable graphics (mascots, decorations) -> own transparent PNGs so they can be moved/deleted in Canva/PowerPoint
    const sep = await p.evaluate(() => {
      const s = document.querySelector('section.on'); const sb = s.getBoundingClientRect(); const out = [];
      const add = (e, kind, name) => { const r = e.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return; const i = out.length; e.setAttribute('data-cap', String(i)); out.push({ i, kind, name, x: r.left - sb.left, y: r.top - sb.top, w: r.width, h: r.height }); };
      s.querySelectorAll('[data-deco]').forEach((e) => add(e, 'deco', 'Decoration'));
      s.querySelectorAll('svg[aria-label]').forEach((e) => { if (!e.closest('[data-deco]')) add(e, 'mascot', 'Mascot'); });
      return out;
    });
    // text-free background
    await p.addStyleTag({ content: 'section.on *:not([data-keep]):not([data-keep] *), section.on{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important;-webkit-text-stroke-color:transparent!important}' });
    const box = await p.evaluate(() => { const r = document.querySelector('section.on').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    const f = path.join(OUT, 'bg-' + String(n).padStart(2, '0') + '.png');
    await p.addStyleTag({ content: '[data-cap]{visibility:hidden!important}' });
    await p.screenshot({ path: f, clip: box });
    // transparent per-element captures (everything else hidden, ancestors' backgrounds cleared)
    await p.evaluate(() => { let e = document.querySelector('section.on'); while (e && e !== document.documentElement.parentNode) { e.style.setProperty('background', 'transparent', 'important'); e.style.setProperty('box-shadow', 'none', 'important'); e = e.parentElement; } });
    const els = [];
    for (const it of sep) {
      const css = await p.addStyleTag({ content: `html body section.on *{visibility:hidden!important}html body section.on [data-cap="${it.i}"],html body section.on [data-cap="${it.i}"] *{visibility:visible!important}` });
      const x0 = Math.max(0, it.x), y0 = Math.max(0, it.y), x1 = Math.min(1920, it.x + it.w), y1 = Math.min(1080, it.y + it.h);
      if (x1 - x0 < 8 || y1 - y0 < 8) { await css.evaluate((e) => e.remove()); continue; }
      const ef = path.join(OUT, 'el-' + String(n).padStart(2, '0') + '-' + it.i + '.png');
      await p.screenshot({ path: ef, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, omitBackground: true });
      await css.evaluate((e) => e.remove());
      els.push({ file: path.basename(ef), kind: it.kind, name: it.name, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    // reference screenshot with text (for QA compare)
    await p.addStyleTag({ content: 'section.on, section.on *{color:revert!important;-webkit-text-fill-color:revert!important}' });
    await ctx.close();
    results[n] = { box, els, ...data };
  }
  const Q = 4;
  for (let i = 0; i < todo.length; i += Q) await Promise.all(todo.slice(i, i + Q).map(doSlide));
  fs.writeFileSync(path.join(OUT, 'frags.json'), JSON.stringify(results));
  const w = Object.entries(results).filter(([, v]) => v.warn.length);
  console.log('slides', Object.keys(results).length, 'warnings', w.map(([k, v]) => k + ':' + v.warn.join(';')).join(' | '));
  await b.close();
})();
