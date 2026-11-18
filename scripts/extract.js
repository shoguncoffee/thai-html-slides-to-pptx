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


// Collect paint layers in DOM order: native shapes (cards, pills, dots, bars, borders, clip-path polygons)
// and pictures (mascots, decorations, icons/svg, <img>) that cannot be native.
function layerFn() {
  const s = document.querySelector('section.on');
  const sb = s.getBoundingClientRect();
  const scale = sb.width / 1920;
  const out = [];
  let capN = 0;
  const parseC = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(parseFloat); const h = (n) => Math.round(n).toString(16).padStart(2, '0');
    return { hex: (h(p[0]) + h(p[1]) + h(p[2])).toUpperCase(), a: p.length > 3 ? p[3] : 1 };
  };
  const effOp = (el) => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= parseFloat(cs.opacity); } return o; };
  const lenOf = (tok, ref) => { // "12px" | "50%" | "calc(100% - 40px)"
    tok = tok.trim().replace(/^calc\(/, '').replace(/\)$/, '');
    const parts = tok.match(/[+-]?\s*[\d.]+(?:px|%)?|[+-]/g) || [];
    let sum = 0, sign = 1;
    for (let p of parts) {
      p = p.replace(/\s+/g, '');
      if (p === '+') { sign = 1; continue; } if (p === '-') { sign = -1; continue; }
      const m = p.match(/^([+-]?[\d.]+)(px|%)?$/); if (!m) continue;
      let v = parseFloat(m[1]); if (m[2] === '%') v = v * ref / 100;
      sum += sign * v; sign = 1;
    }
    return sum;
  };
  const addPic = (e, kind, name) => {
    const r = e.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const i = capN++;
    e.setAttribute('data-cap', String(i));
    out.push({ t: 'pic', i, kind, name, sk: stackKey(e), dom: out.length, x: (r.left - sb.left) / scale, y: (r.top - sb.top) / scale, w: r.width / scale, h: r.height / scale });
  };
  const stackKey = (e) => { // approx CSS painting order: negative z, normal flow, positioned/stacking-context (z-index), by DOM order
    let z = 0, pos = 0, outerZ = null;
    for (let a = e; a && a !== s; a = a.parentElement) {
      const c = getComputedStyle(a);
      const positioned = c.position !== 'static' || parseFloat(c.opacity) < 1 || c.transform !== 'none' || c.clipPath !== 'none' || c.filter !== 'none' || c.isolation === 'isolate';
      if (positioned) pos = 1;
      if (c.position !== 'static' && c.zIndex !== 'auto') outerZ = parseInt(c.zIndex, 10); // outermost wins (loop goes upward)
    }
    if (outerZ !== null) z = outerZ;
    return [z, pos];
  };
  s.querySelectorAll('[data-deco]').forEach((e) => { addPic(e, 'deco', 'Decoration'); });
  const nDeco = out.length;
  let skip = null;
  const all = [...s.querySelectorAll('*')];
  for (const e of all) {
    if (skip && skip.contains(e)) continue;
    skip = null;
    if (e.closest('.bar') || (e instanceof SVGElement && e.tagName !== 'svg')) continue;
    if (e.hasAttribute('data-cap')) { skip = e; continue; }
    const cs = getComputedStyle(e);
    const op = effOp(e);
    if (op < 0.03) continue;
    if (e.hasAttribute('data-keep')) { addPic(e, 'text', 'Outline text'); skip = e; continue; }
    if (e.tagName === 'svg') { addPic(e, e.hasAttribute('aria-label') ? 'mascot' : 'icon', e.hasAttribute('aria-label') ? 'Mascot' : 'Icon'); skip = e; continue; }
    if (e.tagName === 'IMG' || e.tagName === 'CANVAS') { addPic(e, 'image', 'Image'); skip = e; continue; }
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const tf = cs.transform;
    if (tf !== 'none' && !/^matrix\(1, 0, 0, 1, /.test(tf)) continue; // rotated/scaled paint stays in the background image
    if (cs.backgroundImage !== 'none') continue;
    const X = (r.left - sb.left) / scale, Y = (r.top - sb.top) / scale, W = r.width / scale, H = r.height / scale;
    // ancestors that clip (overflow != visible): a shape sticking out of them cannot be native -> picture;
    // otherwise square corners that coincide with a rounded ancestor corner inherit that radius
    const clipAnc = [];
    let sticks = false;
    for (let a = e.parentElement; a && a !== s; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      if (r.left < ar.left - 1.5 || r.right > ar.right + 1.5 || r.top < ar.top - 1.5 || r.bottom > ar.bottom + 1.5) sticks = true;
      const rad = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => Math.max(0, lenOf(acs['border' + k + 'Radius'].split(' ')[0], k.includes('Left') || k.includes('Right') ? ar.width : ar.height)));
      clipAnc.push({ ar, rad });
    }
    if (sticks && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(cs['border' + k + 'Width']) > 0))) { addPic(e, 'piece', 'Clipped piece'); skip = e; continue; }
    const bg = parseC(cs.backgroundColor);
    const hasBg = bg && bg.a * op > 0.01;
    { // CSS border-triangle (one coloured side, both neighbours transparent) -> native triangle polygon
      const raw = ['Top', 'Right', 'Bottom', 'Left'].map((k) => ({ w: parseFloat(cs['border' + k + 'Width']) || 0, st: cs['border' + k + 'Style'], c: parseC(cs['border' + k + 'Color']) }));
      const col = raw.map((q, k) => (q.w > 0 && q.st === 'solid' && q.c && q.c.a > 0.01 ? k : -1)).filter((k) => k >= 0);
      const tr = raw.map((q) => q.w > 0 && q.st === 'solid' && (!q.c || q.c.a < 0.01));
      if (!hasBg && col.length === 1 && tr[(col[0] + 1) % 4] && tr[(col[0] + 3) % 4]) {
        const k = col[0];
        const pts = [[[0, 0], [W, 0], [W / 2, H]], [[W, 0], [0, H / 2], [W, H]], [[0, H], [W, H], [W / 2, 0]], [[0, 0], [W, H / 2], [0, H]]][k];
        ['top', 'right', 'bottom', 'left'].forEach((n) => e.style.setProperty('border-' + n + '-color', 'transparent', 'important'));
        out.push({ t: 'shape', x: X, y: Y, w: W, h: H, geom: { kind: 'poly', pts }, fill: raw[k].c.hex, fa: raw[k].c.a * op, line: null, sideBars: [], sk: stackKey(e), dom: out.length });
        continue;
      }
    }
    const sd = ['Top', 'Right', 'Bottom', 'Left'].map((k) => {
      const w = parseFloat(cs['border' + k + 'Width']) || 0; const st = cs['border' + k + 'Style']; const c = parseC(cs['border' + k + 'Color']);
      return (w > 0 && (st === 'solid' || st === 'dotted' || st === 'dashed') && c && c.a * op > 0.01) ? { w, st, c } : null;
    });
    const uniform = sd.every(Boolean) && sd.every((q) => q.w === sd[0].w && q.st === sd[0].st && q.c.hex === sd[0].c.hex && q.c.a === sd[0].c.a);
    const sideBars = [];
    if (!uniform) sd.forEach((q, k) => { if (q) sideBars.push({ side: k, w: q.w, st: q.st, color: q.c.hex, a: q.c.a * op }); });
    if (!hasBg && !uniform && !sideBars.length) continue;
    // geometry
    let geom;
    const clip = cs.clipPath;
    if (clip && clip.startsWith('polygon(')) {
      const inner = clip.slice(8, -1);
      const pts = inner.split(/,(?![^(]*\))/).map((q) => { const t = q.trim().match(/calc\([^)]*\)|[^\s]+/g); return [lenOf(t[0], W), lenOf(t[1], H)]; });
      geom = { kind: 'poly', pts };
    } else if (clip && clip !== 'none') continue;
    else {
      const rr = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => { const v = cs['border' + k + 'Radius'].split(' ')[0]; return Math.max(0, lenOf(v, k.includes('Left') || k.includes('Right') ? W : H)); });
      // CSS scales radii down when they overlap
      const lim = (len, sum) => (sum > 0 ? len / sum : 1);
      const f = Math.min(1, lim(W, rr[0] + rr[1]), lim(W, rr[3] + rr[2]), lim(H, rr[0] + rr[3]), lim(H, rr[1] + rr[2]));
      const rs = rr.map((v) => v * f);
      const cor = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]];
      clipAnc.forEach(({ ar, rad }) => {
        const ac = [[ar.left, ar.top], [ar.right, ar.top], [ar.right, ar.bottom], [ar.left, ar.bottom]];
        for (let k = 0; k < 4; k++) if (rad[k] > rs[k] && Math.abs(cor[k][0] - ac[k][0]) < 2.5 && Math.abs(cor[k][1] - ac[k][1]) < 2.5) rs[k] = rad[k];
      });
      if (rs.every((v) => v < 0.5)) geom = { kind: 'rect' };
      else if (rs.every((v) => Math.abs(v - rs[0]) < 0.5)) geom = { kind: 'round', r: rs[0] };
      else geom = { kind: 'path', radii: rs };
    }
    const it = { t: 'shape', x: X, y: Y, w: W, h: H, geom, fill: hasBg ? bg.hex : null, fa: hasBg ? bg.a * op : 0, line: null, sideBars, sk: stackKey(e), dom: out.length };
    if (uniform) it.line = { w: sd[0].w, st: sd[0].st, color: sd[0].c.hex, a: sd[0].c.a * op };
    if (hasBg) e.style.setProperty('background-color', 'transparent', 'important');
    if (uniform || sideBars.length) ['Top', 'Right', 'Bottom', 'Left'].forEach((k) => e.style.setProperty('border-' + k.toLowerCase() + '-color', 'transparent', 'important'));
    out.push(it);
  }
  out.forEach((l, i) => { if (l.kind === 'deco') l.sk = [-1, 0]; l.ord = i; });
  out.sort((a, b) => a.sk[0] - b.sk[0] || a.sk[1] - b.sk[1] || a.ord - b.ord);
  return out;
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
    // paint layers: native shapes (hidden from the background shot) + pictures (svg/img/decorations, captured alone)
    const layers = await p.evaluate(layerFn);
    // text-free background
    await p.addStyleTag({ content: 'section.on *:not([data-keep]):not([data-keep] *), section.on{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important;-webkit-text-stroke-color:transparent!important}' });
    const box = await p.evaluate(() => { const r = document.querySelector('section.on').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    const f = path.join(OUT, 'bg-' + String(n).padStart(2, '0') + '.png');
    await p.addStyleTag({ content: '[data-cap]{visibility:hidden!important}' });
    await p.screenshot({ path: f, clip: box });
    // transparent per-element captures (everything else hidden, ancestors' backgrounds cleared)
    await p.evaluate(() => { let e = document.querySelector('section.on'); while (e && e !== document.documentElement.parentNode) { e.style.setProperty('background', 'transparent', 'important'); e.style.setProperty('box-shadow', 'none', 'important'); e = e.parentElement; } });
    const els = [];
    for (const it of layers) {
      if (it.t !== 'pic') continue;
      const css = await p.addStyleTag({ content: `html body section.on *{visibility:hidden!important}html body section.on [data-cap="${it.i}"],html body section.on [data-cap="${it.i}"] *{visibility:visible!important}` });
      const x0 = Math.max(0, it.x), y0 = Math.max(0, it.y), x1 = Math.min(1920, it.x + it.w), y1 = Math.min(1080, it.y + it.h);
      if (x1 - x0 < 8 || y1 - y0 < 8) { await css.evaluate((e) => e.remove()); it.skip = true; continue; }
      const ef = path.join(OUT, 'el-' + String(n).padStart(2, '0') + '-' + it.i + '.png');
      await p.screenshot({ path: ef, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, omitBackground: true });
      await css.evaluate((e) => e.remove());
      Object.assign(it, { file: path.basename(ef), x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    // reference screenshot with text (for QA compare)
    await p.addStyleTag({ content: 'section.on, section.on *{color:revert!important;-webkit-text-fill-color:revert!important}' });
    await ctx.close();
    results[n] = { box, layers: layers.filter((l) => !l.skip), ...data };
  }
  const Q = 4;
  for (let i = 0; i < todo.length; i += Q) await Promise.all(todo.slice(i, i + Q).map(doSlide));
  fs.writeFileSync(path.join(OUT, 'frags.json'), JSON.stringify(results));
  const w = Object.entries(results).filter(([, v]) => v.warn.length);
  console.log('slides', Object.keys(results).length, 'warnings', w.map(([k, v]) => k + ':' + v.warn.join(';')).join(' | '));
  await b.close();
})();
