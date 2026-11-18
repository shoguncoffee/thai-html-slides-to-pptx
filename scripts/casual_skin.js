// v10 "casual" skin: flat colour, few shapes, title stickers, hand-placed bold decorations (auto-placed in empty zones).
// usage: node casual.js in.html out.html
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(process.argv[2] || 'cardiopulmonary-case-deck-v10pre.html');
const OUT = path.resolve(process.argv[3] || 'cardiopulmonary-case-deck-v10.html');

const PAL = { BG: '#e4edfb', INK: '#161616', CREAM: '#fde6c8', CORAL: '#f27b86', RED: '#c2303b', PINK: '#f6b3b9', WHITE: '#ffffff', BLUE: '#3a6be0' };

function transform(PAL) {
  const canvas = document.getElementById('canvas');
  const secs = [...canvas.querySelectorAll(':scope > section')];
  const log = [];
  // seeded rng
  const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const rgbParse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };

  // ---------- decoration shapes (svg strings) ----------
  const shapes = {
    asterisk: (c, r) => { const arms = [0, 60, 120].map((a, i) => `<rect x="-17" y="${-100 + r() * 14}" width="34" height="${190 + r() * 20}" rx="9" transform="rotate(${a})" fill="${c}"/>`).join(''); return `<svg viewBox="-110 -110 220 220" width="100%" height="100%">${arms}</svg>`; },
    hourglass: (c) => `<svg viewBox="0 0 200 270" width="100%" height="100%"><path d="M0 0 H200 A100 100 0 0 1 0 0 Z" transform="translate(0 0)" fill="${c}"/><path d="M0 270 A100 100 0 0 1 200 270 Z" transform="translate(0 -135)" fill="${c}"/></svg>`,
    scallop: (c) => { let d = ''; const n = 9; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; d += `<circle cx="${100 + 62 * Math.cos(a)}" cy="${100 + 62 * Math.sin(a)}" r="34" fill="${c}"/>`; } return `<svg viewBox="0 0 200 200" width="100%" height="100%">${d}<circle cx="100" cy="100" r="64" fill="${c}"/></svg>`; },
    ring: (c) => `<svg viewBox="0 0 200 200" width="100%" height="100%"><path d="M0 0 H200 V0 A200 200 0 0 1 0 200 Z M0 70 A70 70 0 0 0 70 0 H0 Z" fill="${c}" fill-rule="evenodd" transform="translate(0 0)"/></svg>`,
    squiggle: (c) => `<svg viewBox="0 0 300 80" width="100%" height="100%"><path d="M10 50 Q40 0 70 40 T130 40 T190 40 T250 36 T290 44" fill="none" stroke="${c}" stroke-width="16" stroke-linecap="round"/></svg>`,
    blob: (c) => `<svg viewBox="0 0 200 200" width="100%" height="100%"><path d="M40 60 Q60 8 120 22 Q190 30 176 98 Q190 168 118 180 Q50 192 26 130 Q10 92 40 60 Z" fill="${c}"/></svg>`,
    spark: (c) => `<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M50 2 L61 39 L98 50 L61 61 L50 98 L39 61 L2 50 L39 39 Z" fill="${c}"/></svg>`,
  };
  const kinds = ['asterisk', 'hourglass', 'scallop', 'ring', 'squiggle', 'blob', 'spark'];
  const colors = [PAL.RED, PAL.PINK, PAL.CREAM, PAL.CORAL, PAL.WHITE];
  // candidate zones: [left, top, size, rotRange]
  const ZONES = [
    [1560, -150, 430], [1400, -190, 380], [-150, -170, 380], [1640, 780, 420], [1480, 840, 360], [-170, 760, 400],
    [-200, 300, 360], [1740, 380, 340], [1000, -210, 300], [1000, 940, 300],
  ];

  secs.forEach((s, idx) => {
    const kind = s.getAttribute('data-kind');
    const label = s.getAttribute('data-label') || '';
    const isDivider = kind === 'divider';
    s.style.background = PAL.BG;
    s.style.isolation = 'isolate';   // z-index:-1 decorations must paint ABOVE the slide background but BELOW content
    s.style.setProperty('--ink', PAL.INK);
    s.style.setProperty('--muted', '#4a4a4a');
    s.style.setProperty('--stage', PAL.BG);
    s.classList.add('on');
    // 0. no tilted elements anywhere (user: no rotation). Keep 45/90deg geometry only.
    [s, ...s.querySelectorAll('*')].forEach((e) => {
      if (e instanceof SVGElement) return;
      const st = e.getAttribute('style'); if (!st || !/rotate\(/.test(st)) return;
      e.setAttribute('style', st.replace(/rotate\((-?[\d.]+)deg\)/g, (m, a) => (Math.abs(parseFloat(a)) < 30 && parseFloat(a) !== 0 ? '' : (parseFloat(a) === 45 ? '' : m))));
      if (/rotate\(45deg\)/.test(st) && e.children.length === 0 && !e.textContent.trim()) e.style.borderRadius = '50%';
    });
    // 1. drop old decorative circles
    [...s.children].forEach((c) => { const st = c.getAttribute('style') || ''; if (/z-index:\s*-1/.test(st)) c.remove(); });
    // 2. flatten: shadows off, gradients -> first colour, tinted borders off
    [s, ...s.querySelectorAll('*')].forEach((e) => {
      if (e instanceof SVGElement) return;
      const cs = getComputedStyle(e);
      if (cs.boxShadow !== 'none') e.style.boxShadow = 'none';
      if (cs.backgroundImage.includes('gradient') && e !== s) {
        const m = /rgba?\([^)]*\)/.exec(cs.backgroundImage);
        e.style.backgroundImage = 'none';
        if (m) e.style.backgroundColor = m[0];
      }
      if (e !== s && parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'dashed') {
        const bw = parseFloat(cs.borderTopWidth);
        if (bw <= 2) { e.style.borderColor = 'transparent'; }
      }
      // near-black tinted ink -> neutral black
      const col = rgbParse(cs.color);
      if (col && col.r < 80 && col.g < 90 && col.b < 120 && Math.max(col.r, col.g, col.b) - Math.min(col.r, col.g, col.b) < 60 && col.a > 0.7) {
        if (cs.webkitTextFillColor === cs.color || true) e.style.color = PAL.INK;
      }
    });
    // 2b. big white card + side bar (cover / dividers / index / thank-you) -> bare slide; outline panel -> bare
    [...s.children].forEach((c) => {
      const r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
      if (r.width > 1600 && r.height > 800 && c.children.length >= 2) {
        c.style.background = 'transparent'; c.style.boxShadow = 'none'; c.style.borderRadius = '0';
        [...c.children].forEach((x) => { const xr = x.getBoundingClientRect(); const xs = getComputedStyle(x); if (Math.abs(xr.width - 120) < 4 && xr.height > 700) x.remove(); });
      }
      if (Math.abs(r.width - 560) < 4 && r.height > 900 && /fill|rgb\(5[0-9], 9[0-9]|rgb\(53/.test(c.getAttribute('style') || '') ) {
        c.style.background = 'transparent'; c.style.color = PAL.INK;
        [...c.children].forEach((x) => { if (/position:\s*absolute/.test(x.getAttribute('style') || '')) x.remove(); });
        const lab = c.querySelector('span'); if (lab) { lab.style.color = PAL.RED; lab.style.opacity = '1'; }
      }
    });
    // 2c. divider / cover labels -> red sticker, stepper removed
    if (isDivider || /Cover|Part|Thank|Appendix/i.test(label)) {
      s.querySelectorAll('*').forEach((sp) => {
        if (sp.children.length) return;
        const t = sp.textContent.trim(); const st = sp.getAttribute('style') || '';
        if (/^PART [A-Z]+$/.test(t)) {
          sp.style.cssText += `;display:inline-block;background:${PAL.RED};color:#fff;border-radius:999px;padding:4px 30px 8px;letter-spacing:.14em;opacity:1;align-self:flex-start;`;
        }
      });
      [...s.querySelectorAll('div')].forEach((d) => { const t = d.textContent; if (d.children.length >= 6 && /Investigation/.test(t) && /ตรวจร่างกาย/.test(t) && !d.closest('[data-keepstep]')) d.remove(); });
    }
    s.querySelectorAll('*').forEach((sp) => { if (!sp.children.length && /^\s*CASE REPORT\s*$/.test(sp.textContent)) { sp.style.color = PAL.RED; sp.style.opacity = '1'; sp.style.display = 'inline-block'; } });
    // 3. tracker row -> small coral text label
    const tracker = [...s.children].find((c) => c.children.length >= 5 && [...c.children].every((x) => x.tagName === 'SPAN' && /999px/.test(x.getAttribute('style') || '')));
    if (tracker) {
      const pills = [...tracker.children];
      const act = pills.find((p) => (p.textContent || '').replace(/[0-9\s✓]/g, '').length > 1) || pills[0];
      const txt = (act.textContent || '').replace(/\s+/g, ' ').trim();
      tracker.innerHTML = '';
      const lab = document.createElement('span');
      lab.textContent = txt;
      lab.setAttribute('style', `display:inline-block;font-weight:700;font-size:26px;letter-spacing:.06em;color:${PAL.RED};`);
      tracker.appendChild(lab);
      tracker.style.gap = '0';
    }
    // 4. title sticker (cream pill)
    if (!isDivider) {
      const titleRow = [...s.children].find((c) => c !== tracker && c.children.length && /align-items:\s*baseline/.test(c.getAttribute('style') || ''));
      const h = titleRow && titleRow.children[0];
      if (h && h.textContent.trim().length > 2) {
        h.style.background = PAL.CREAM;
        h.style.borderRadius = '46px';
        h.style.padding = '4px 38px 12px';
        h.style.marginLeft = '-38px';
        h.style.color = PAL.INK;
        h.style.display = 'inline-block';
        
        h.setAttribute('data-sticker', '1');
      }
    }
    // 5. rounder white cards, less tint
    [...s.querySelectorAll('*')].forEach((e) => {
      if (e instanceof SVGElement || e.hasAttribute('data-sticker')) return;
      const cs = getComputedStyle(e);
      const bg = rgbParse(cs.backgroundColor);
      const rad = parseFloat(cs.borderTopLeftRadius);
      const r = e.getBoundingClientRect();
      if (bg && bg.a > 0.5 && rad >= 12 && r.width > 160 && r.height > 60 && r.height < 700 && !/%/.test(cs.borderTopLeftRadius)) {
        e.style.borderRadius = Math.min(34, r.height / 2) + 'px';
      }
    });
    // 6. mascots: casual tilt
    log.push(idx);
    s.classList.remove('on');
  });
  return log.length;
}

function decorate({ PAL, shapesSrc }) {
  // placed after transform; needs layout => runs per section with .on
  const canvas = document.getElementById('canvas');
  const secs = [...canvas.querySelectorAll(':scope > section')];
  const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const shapes = eval('(' + shapesSrc + ')');
  const kinds = ['asterisk', 'hourglass', 'scallop', 'ring', 'squiggle', 'blob', 'spark'];
  const colors = [PAL.RED, PAL.PINK, PAL.CREAM, PAL.CORAL, PAL.WHITE];
  const ZONES = [[1560, -150, 430], [1400, -190, 380], [-150, -170, 380], [1640, 780, 420], [1480, 840, 360], [-170, 760, 400], [-200, 300, 360], [1740, 380, 340], [1000, -210, 300], [1000, 940, 300], [1720, -120, 280], [-110, 900, 260], [1780, 900, 260], [-120, -110, 260], [1300, 960, 260], [560, 960, 240]];
  const res = [];
  secs.forEach((s, idx) => {
    const isDivider = s.getAttribute('data-kind') === 'divider';
    s.classList.add('on');
    const sb = s.getBoundingClientRect(); const k = sb.width / 1920;
    // content rects (text + media + coloured blocks)
    const rects = [];
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    let n; const rg = document.createRange();
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim() || n.parentElement.closest('svg')) continue;
      rg.selectNodeContents(n);
      [...rg.getClientRects()].forEach((r) => { if (r.width > 2) rects.push([(r.left - sb.left) / k, (r.top - sb.top) / k, (r.right - sb.left) / k, (r.bottom - sb.top) / k]); });
    }
    s.querySelectorAll('img,svg,canvas').forEach((e) => { if (e.closest('[data-deco]')) return; const r = e.getBoundingClientRect(); if (r.width > 4) rects.push([(r.left - sb.left) / k, (r.top - sb.top) / k, (r.right - sb.left) / k, (r.bottom - sb.top) / k]); });
    s.querySelectorAll('*').forEach((e) => {
      if (e instanceof SVGElement || e.closest('[data-deco]')) return;
      const cs = getComputedStyle(e); const bg = cs.backgroundColor;
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && cs.borderTopColor !== 'rgba(0, 0, 0, 0)') { const r0 = e.getBoundingClientRect(); if (r0.width > 6 && r0.height > 3 && !(r0.width > 1800 && r0.height > 900)) rects.push([(r0.left - sb.left) / k, (r0.top - sb.top) / k, (r0.right - sb.left) / k, (r0.bottom - sb.top) / k]); }
      if (/rgba?\(/.test(bg) && !/, 0\)$/.test(bg) && !/rgba\(0, 0, 0, 0\)/.test(bg)) { const r = e.getBoundingClientRect(); if (r.width > 6 && r.height > 3 && !(r.width > 1800 && r.height > 900)) rects.push([(r.left - sb.left) / k, (r.top - sb.top) / k, (r.right - sb.left) / k, (r.bottom - sb.top) / k]); }
    });
    const rand = rng(idx * 7919 + 13);
    const want = isDivider ? 2 : (idx % 3 === 0 ? 0 : 1);   // few decorations: user adds own graphics in Canva
    const GAP = 48;   // keep decorations at least 48px away from any text/media/card
    const overlaps = (x0, y0, x1, y1) => rects.some((r) => Math.min(x1, r[2] + GAP) - Math.max(x0, r[0] - GAP) > 0 && Math.min(y1, r[3] + GAP) - Math.max(y0, r[1] - GAP) > 0);
    // reserve the biggest content-free zone as an empty "sticker space"
    const freeZ = ZONES.map((z, i) => [i, z]).filter(([i, z]) => !overlaps(z[0], z[1], z[0] + z[2], z[1] + z[2]));
    freeZ.sort((a, b) => b[1][2] - a[1][2]);
    const reserved = freeZ.length ? freeZ[0][0] : -1;
    const used = reserved >= 0 ? [[ZONES[reserved][0], ZONES[reserved][1], ZONES[reserved][0] + ZONES[reserved][2], ZONES[reserved][1] + ZONES[reserved][2]]] : [];
    const order = ZONES.map((z, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).filter((i) => i !== reserved);
    let placed = 0;
    for (const zi of order) {
      if (placed >= want) break;
      let [zx, zy, zs] = ZONES[zi];
      const sz = zs * (0.7 + rand() * 0.4);
      const x0 = zx, y0 = zy, x1 = zx + sz, y1 = zy + sz;
      if (overlaps(x0, y0, x1, y1)) continue;
      const vis = (Math.min(x1, 1920) - Math.max(x0, 0)) * (Math.min(y1, 1080) - Math.max(y0, 0)) / (sz * sz);
      if (vis < 0.5) continue;   // no stray slivers: at least half of every shape stays on the slide
      if (used.some((u) => Math.min(x1, u[2]) - Math.max(x0, u[0]) > -40 && Math.min(y1, u[3]) - Math.max(y0, u[1]) > -40)) continue;
      const kind = kinds[Math.floor(rand() * kinds.length)];
      let col = colors[Math.floor(rand() * colors.length)];
      if (kind === 'squiggle' && col === PAL.WHITE) col = PAL.RED;
      const d = document.createElement('div');
      d.setAttribute('data-deco', kind);
      const w = kind === 'squiggle' ? sz * 1.1 : (kind === 'hourglass' ? sz * 0.7 : sz);
      const h = kind === 'squiggle' ? sz * 0.3 : (kind === 'hourglass' ? sz * 0.95 : sz);
      d.setAttribute('style', `position:absolute;left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;z-index:-1;pointer-events:none;`);
      d.innerHTML = shapes[kind](col, rand);
      s.insertBefore(d, s.firstChild);
      used.push([x0, y0, x1, y1]);
      placed++;
    }
    if (reserved >= 0) s.setAttribute('data-free', reserved + ':' + ZONES[reserved].join(','));
    res.push(idx + ':' + placed);
    s.classList.remove('on');
  });
  return res.join(' ');
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  await p.goto('file://' + SRC);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  // stop runtime from toggling classes while we edit
  const shapesSrc = await p.evaluate(() => 0);
  const n = await p.evaluate(transform, PAL);
  console.log('transformed', n);
  // serialise shapes factory as source to run inside page
  const shapesFactory = `{
    asterisk: (c, r) => { const arms = [0, 60, 120].map((a, i) => '<rect x="-17" y="' + (-100 + r() * 14) + '" width="34" height="' + (190 + r() * 20) + '" rx="9" transform="rotate(' + a + ')" fill="' + c + '"/>').join(''); return '<svg viewBox="-110 -110 220 220" width="100%" height="100%">' + arms + '</svg>'; },
    hourglass: (c) => '<svg viewBox="0 0 200 270" width="100%" height="100%"><path d="M0 0 H200 A100 100 0 0 1 0 0 Z" fill="' + c + '"/><path d="M0 135 A100 100 0 0 1 200 135 Z" transform="translate(0 135)" fill="' + c + '"/></svg>',
    scallop: (c) => { let d = ''; const n = 9; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; d += '<circle cx="' + (100 + 62 * Math.cos(a)) + '" cy="' + (100 + 62 * Math.sin(a)) + '" r="34" fill="' + c + '"/>'; } return '<svg viewBox="0 0 200 200" width="100%" height="100%">' + d + '<circle cx="100" cy="100" r="64" fill="' + c + '"/></svg>'; },
    ring: (c) => '<svg viewBox="0 0 200 200" width="100%" height="100%"><path d="M0 0 H200 A200 200 0 0 1 0 200 Z M0 70 A70 70 0 0 0 70 0 H0 Z" fill="' + c + '" fill-rule="evenodd"/></svg>',
    squiggle: (c) => '<svg viewBox="0 0 300 80" width="100%" height="100%"><path d="M10 50 Q40 0 70 40 T130 40 T190 40 T250 36 T290 44" fill="none" stroke="' + c + '" stroke-width="16" stroke-linecap="round"/></svg>',
    blob: (c) => '<svg viewBox="0 0 200 200" width="100%" height="100%"><path d="M40 60 Q60 8 120 22 Q190 30 176 98 Q190 168 118 180 Q50 192 26 130 Q10 92 40 60 Z" fill="' + c + '"/></svg>',
    spark: (c) => '<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M50 2 L61 39 L98 50 L61 61 L50 98 L39 61 L2 50 L39 39 Z" fill="' + c + '"/></svg>'
  }`;
  const placed = await p.evaluate(decorate, { PAL, shapesSrc: shapesFactory }).catch((e) => 'ERR ' + e.message);
  console.log('placed', placed);
  // write file: splice like the main pipeline
  const inner = await p.evaluate(() => { const c = document.getElementById('canvas'); c.querySelectorAll(':scope > section').forEach((s) => { s.classList.remove('on'); if (!s.getAttribute('class')) s.removeAttribute('class'); }); return c.innerHTML; });
  const f = fs.readFileSync(SRC, 'utf8');
  const a = f.indexOf('<div class="canvas" id="canvas">') + '<div class="canvas" id="canvas">'.length;
  const barAt = f.indexOf('<div class="bar"'); const z = f.lastIndexOf('</div></div>', barAt);
  const head = f.slice(0, a);
  const tail = f.slice(z);
  fs.writeFileSync(OUT, head + '\n' + inner + '\n' + tail);
  console.log('wrote', OUT);
  await b.close();
})();
