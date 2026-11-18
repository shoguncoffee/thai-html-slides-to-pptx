// Build editable pptx: text-free background image + native text boxes at exact geometry.
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2];
const OUTFILE = process.argv[3];
const DY = Number(process.env.DY || 0); // global vertical nudge (px, CSS space)
const DX = Number(process.env.DX || 0);
const DYK = Number(process.env.DYK || 0);
// LINE_MODE=line (default): one single-spacing text box per rendered line, box top = Chrome glyph-box top.
//   Renderer-independent (Canva/PowerPoint/LibreOffice all put the first baseline at top+ascent).
// LINE_MODE=para: one box per paragraph with exact line spacing (editable paragraphs, but renderer-dependent y).
const LINE_MODE = process.env.LINE_MODE || 'line';
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'frags.json'), 'utf8'));
const PX = 1 / 144; // 1920 css px -> 13.333in
const PT = 0.5; // css px -> pt

// FONT_MODE=canva (default): only family names Canva/Google Docs/Keynote know: regular + bold (+Kodchasan Medium).
//   Sarabun   : <600 -> Sarabun, >=600 -> Sarabun bold
//   Kodchasan : <=500 -> Kodchasan Medium, >=600 -> Kodchasan bold (KOD600=medium to use Medium instead)
// FONT_MODE=static : exact static-font names (Sarabun Medium / SemiBold ...) - only right if those fonts are installed.
const FONT_MODE = process.env.FONT_MODE || 'canva';
function fontFor(st) {
  const fam = /kodchasan/i.test(st.family) ? 'Kodchasan' : 'Sarabun';
  const w = st.weight;
  if (FONT_MODE === 'static') {
    if (fam === 'Kodchasan') {
      if (w >= 700) return { face: 'Kodchasan', bold: true };
      if (w >= 600) return { face: 'Kodchasan SemiBold', bold: false };
      return { face: 'Kodchasan Medium', bold: false };
    }
    if (w >= 700) return { face: 'Sarabun', bold: true };
    if (w >= 600) return { face: 'Sarabun SemiBold', bold: false };
    if (w >= 500) return { face: 'Sarabun Medium', bold: false };
    return { face: 'Sarabun', bold: false };
  }
  if (fam === 'Kodchasan') {
    if (w >= 700 || (w >= 600 && process.env.KOD600 !== 'medium' && !(st.size >= 40 && process.env.KOD_BIG !== 'bold'))) return { face: 'Kodchasan', bold: true };
    return { face: 'Kodchasan Medium', bold: false };
  }
  // Sarabun 600 at headline size (e.g. abbreviations inside a Kodchasan title) -> Regular so it matches Kodchasan Medium
  if (w === 600 && st.size >= 40 && process.env.KOD_BIG !== 'bold') return { face: 'Sarabun', bold: false };
  return { face: 'Sarabun', bold: w >= 600 };
}

function runOpts(st, align, text) {
  const f = fontFor(st);
  const o = {
    fontFace: f.face,
    fontSize: Math.round(st.size * PT * 100) / 100,
    color: st.color,
    bold: f.bold,
    italic: st.italic,
    align,
  };
  if (st.ls > 0.3 && text && !/[\u0E00-\u0E7F]/.test(text)) o.charSpacing = Math.round(st.ls * PT * 100) / 100;
  if (st.underline) o.underline = { style: 'sng' };
  if (st.alpha < 0.98) o.transparency = Math.round((1 - st.alpha) * 100);
  if (st.strokeW > 0 && st.fillTransparent) {
    o.color = 'FFFFFF';
    o.transparency = 100;
    o.outline = { size: Math.max(0.25, Math.round(st.strokeW * PT * 100) / 100), color: st.strokeC };
  }
  return o;
}
const styleKey = (st) => [st.color, st.alpha.toFixed(2), st.size, st.weight, st.italic, st.family, st.ls, st.underline, st.strokeW, st.strokeC].join('|');
const txt = (f) => (f.style.upper ? f.text.toUpperCase() : f.text);

function yAdj(b) {
  const sz = Math.max(...b.lines[0].map((r) => r.st.size));
  // line mode: Canva and LibreOffice (measured independently) both land ~0.055em + 1.75px above Chrome's glyph-box top
  if (LINE_MODE === 'line') return 0.055 * sz + 1.75 + DY;
  return -0.495 * b.lh + 0.549 * sz + 2.1 + DY;
}
function buildBoxes(frags) {
  const boxes = [];
  // rotated text: merge whole node group into one box
  const rotated = frags.filter((f) => f.style.rot);
  const normal = frags.filter((f) => !f.style.rot);
  const rotGroups = new Map();
  rotated.forEach((f) => { const k = f.block + ':' + f.id; (rotGroups.get(k) || rotGroups.set(k, []).get(k)).push(f); });
  for (const g of rotGroups.values()) {
    const st = g[0].style;
    const L = Math.min(...g.map((f) => f.left)), R = Math.max(...g.map((f) => f.right));
    const T = Math.min(...g.map((f) => f.top)), B = Math.max(...g.map((f) => f.bottom));
    const th = (st.rot * Math.PI) / 180;
    const len = (R - L) / Math.cos(th) - st.size * 0.1;
    const h = LINE_MODE === 'line' ? st.size * 1.3 : st.lh;
    const cx = (L + R) / 2, cy = (T + B) / 2;
    boxes.push({ x: cx - len / 2 - 6, y: cy - h / 2, w: len + 12, h, lines: [g.map((f) => ({ text: txt(f), st: f.style }))], align: 'center', lh: h, rot: st.rot });
  }
  // group by block
  const byBlock = new Map();
  normal.forEach((f) => (byBlock.get(f.block) || byBlock.set(f.block, []).get(f.block)).push(f));
  for (const fr of byBlock.values()) {
    fr.sort((a, b) => a.cy - b.cy || a.left - b.left);
    // cluster lines
    const lines = [];
    for (const f of fr) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(f.cy - last.cy) <= Math.max(f.style.size, last.fs) * 0.45) {
        last.frags.push(f);
        last.cy = (last.cy * (last.frags.length - 1) + f.cy) / last.frags.length;
        last.fs = Math.max(last.fs, f.style.size);
      } else lines.push({ frags: [f], cy: f.cy, fs: f.style.size });
    }
    lines.forEach((l) => l.frags.sort((a, b) => a.left - b.left));
    // segments per line
    let multi = false;
    lines.forEach((l) => {
      l.segs = [[l.frags[0]]];
      for (let i = 1; i < l.frags.length; i++) {
        const gap = l.frags[i].left - l.frags[i - 1].right;
        if (gap > l.fs * 1.5 || gap < -l.fs * 0.3) l.segs.push([l.frags[i]]);
        else l.segs[l.segs.length - 1].push(l.frags[i]);
      }
      if (l.segs.length > 1) multi = true;
      l.left = Math.min(...l.frags.map((f) => f.left));
      l.right = Math.max(...l.frags.map((f) => f.right));
      l.top = Math.min(...l.frags.map((f) => f.top));
      l.bottom = Math.max(...l.frags.map((f) => f.bottom));
    });
    // alignment
    let align = null;
    if (!multi) {
      if (lines.length === 1) align = 'left';
      else {
        const tol = 3;
        const ls = lines.map((l) => l.left), rs = lines.map((l) => l.right), cs = lines.map((l) => (l.left + l.right) / 2);
        const rng = (a) => Math.max(...a) - Math.min(...a);
        // last line of a left-aligned paragraph is shorter: compare lefts first
        if (rng(ls) <= tol) align = 'left';
        else if (rng(cs) <= tol * 2) align = 'center';
        else if (rng(rs.slice(0)) <= tol) align = 'right';
      }
    }
    const mkRuns = (frs) => {
      // merge by style
      const runs = [];
      frs.forEach((f, fi) => {
        const k = styleKey(f.style);
        let t = txt(f);
        if (fi > 0) {
          const pv = frs[fi - 1];
          const gap = f.left - pv.right;
          if (gap > f.style.size * 0.15 && !/\s$/.test(pv.text) && !/^\s/.test(t)) t = ' ' + t;
        }
        if (runs.length && runs[runs.length - 1].k === k) runs[runs.length - 1].text += t;
        else runs.push({ k, text: t, st: f.style });
      });
      runs[0].text = runs[0].text.replace(/^\s+/, '');
      runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
      return runs.filter((r) => r.text.length);
    };
    if (LINE_MODE === 'line') {
      lines.forEach((l) => l.segs.forEach((sg) => {
        const L = Math.min(...sg.map((f) => f.left)), R = Math.max(...sg.map((f) => f.right));
        const T = Math.min(...sg.map((f) => f.top)), B = Math.max(...sg.map((f) => f.bottom));
        boxes.push({ x: L, y: T, w: R - L, h: B - T, lh: B - T, align: align || 'left', lines: [mkRuns(sg)], single: true });
      }));
    } else if (align) {
      const pitch = lines.length > 1 ? (lines[lines.length - 1].cy - lines[0].cy) / (lines.length - 1) : null;
      const lh = pitch || Math.max(...lines[0].frags.map((f) => f.style.lh));
      const L = Math.min(...lines.map((l) => l.left)), R = Math.max(...lines.map((l) => l.right));
      boxes.push({
        x: L, y: lines[0].cy - lh / 2, w: R - L, h: lh * lines.length, lh, align,
        lines: lines.map((l) => mkRuns(l.frags)),
      });
    } else {
      lines.forEach((l) => l.segs.forEach((sg) => {
        const lh = Math.max(...sg.map((f) => f.style.lh));
        const L = Math.min(...sg.map((f) => f.left)), R = Math.max(...sg.map((f) => f.right));
        const cy = sg.reduce((a, f) => a + f.cy, 0) / sg.length;
        boxes.push({ x: L, y: cy - lh / 2, w: R - L, h: lh, lh, align: 'left', lines: [mkRuns(sg)] });
      }));
    }
  }
  return boxes.filter((b) => b.lines.every((l) => l.length) || true);
}


// ---- native shapes -------------------------------------------------------------
const K = 0.5523;
function pathPts(w, h, rs) { // rounded rect with per-corner radii -> custGeom points (inches, relative to box)
  const [tl, tr, br, bl] = rs.map((v) => v * PX); w *= PX; h *= PX;
  const P = [{ x: tl, y: 0, moveTo: true }, { x: w - tr, y: 0 }];
  const cv = (x1, y1, x2, y2, x, y) => P.push({ x, y, curve: { type: 'cubic', x1, y1, x2, y2 } });
  if (tr) cv(w - tr + tr * K, 0, w, tr - tr * K, w, tr); P.push({ x: w, y: h - br });
  if (br) cv(w, h - br + br * K, w - br + br * K, h, w - br, h); P.push({ x: bl, y: h });
  if (bl) cv(bl - bl * K, h, 0, h - bl + bl * K, 0, h - bl); P.push({ x: 0, y: tl });
  if (tl) cv(0, tl - tl * K, tl - tl * K, 0, tl, 0);
  P.push({ close: true });
  return P;
}
function shapeName(L) {
  const m = Math.min(L.w, L.h), M = Math.max(L.w, L.h);
  if (L.geom.kind === 'poly') return 'Shape';
  if (m <= 24 && M <= 24) return 'Dot';
  if (m <= 8) return 'Line';
  if (L.geom.kind === 'round' && L.geom.r >= m / 2 - 1) return 'Pill';
  if (L.w >= 1880 && L.h >= 1040) return 'Panel';
  return L.fill || L.line ? 'Card' : 'Shape';
}
function addNative(pres, slide, L, idx) {
  const nm = shapeName(L) + ' ' + idx;
  const lineOf = (q, extra) => ({ color: q.color, width: Math.max(0.25, q.w * PT), transparency: Math.round((1 - q.a) * 100), dashType: q.st === 'dotted' ? 'sysDot' : q.st === 'dashed' ? 'dash' : 'solid', ...extra });
  let { x, y, w, h } = L;
  let ln = null;
  if (L.line) { const bw = L.line.w; x += bw / 2; y += bw / 2; w -= bw; h -= bw; ln = lineOf({ color: L.line.color, w: bw, a: L.line.a, st: L.line.st }); }
  const inset = L.line ? L.line.w / 2 : 0;
  const o = { x: x * PX, y: y * PX, w: w * PX, h: h * PX, objectName: nm, line: ln || { type: 'none' }, fill: L.fill ? { color: L.fill, transparency: Math.round((1 - L.fa) * 100) } : { type: 'none' } };
  if (o.fill.transparency === 0) delete o.fill.transparency;
  const g = L.geom;
  if (g.kind === 'rect') slide.addShape(pres.ShapeType.rect, o);
  else if (g.kind === 'round') {
    const r = Math.max(0, g.r - inset);
    if (r >= Math.min(w, h) / 2 - 0.5 && Math.abs(w - h) < 1.5) slide.addShape(pres.ShapeType.ellipse, o);
    else slide.addShape(pres.ShapeType.roundRect, { ...o, rectRadius: Math.min(r, Math.min(w, h) / 2) * PX });
  } else if (g.kind === 'path') slide.addShape(pres.ShapeType.custGeom, { ...o, points: pathPts(w, h, g.radii.map((v) => Math.max(0, v - inset))) });
  else if (g.kind === 'poly') {
    const pts = g.pts.map((p, i) => ({ x: p[0] * PX, y: p[1] * PX, ...(i === 0 ? { moveTo: true } : {}) }));
    pts.push({ close: true });
    slide.addShape(pres.ShapeType.custGeom, { ...o, points: pts });
  }
  (L.sideBars || []).forEach((sb, k) => {
    const bw = sb.w, side = sb.side; // 0 top,1 right,2 bottom,3 left
    const q = { color: sb.color, w: bw, a: sb.a, st: sb.st };
    if (sb.st === 'solid') {
      const bx = side === 1 ? L.x + L.w - bw : L.x, by = side === 2 ? L.y + L.h - bw : L.y;
      const bwid = side === 1 || side === 3 ? bw : L.w, bhei = side === 0 || side === 2 ? bw : L.h;
      slide.addShape(pres.ShapeType.rect, { x: bx * PX, y: by * PX, w: bwid * PX, h: bhei * PX, fill: { color: sb.color, ...(sb.a < 0.99 ? { transparency: Math.round((1 - sb.a) * 100) } : {}) }, line: { type: 'none' }, objectName: (side % 2 ? 'Bar ' : 'Rule ') + idx + '.' + k });
    } else {
      const horiz = side === 0 || side === 2;
      const lx = side === 1 ? L.x + L.w - bw / 2 : side === 3 ? L.x + bw / 2 : L.x, ly = side === 2 ? L.y + L.h - bw / 2 : side === 0 ? L.y + bw / 2 : L.y;
      slide.addShape(pres.ShapeType.line, { x: lx * PX, y: ly * PX, w: horiz ? L.w * PX : 0, h: horiz ? 0 : L.h * PX, line: lineOf(q), objectName: 'Divider ' + idx + '.' + k });
    }
  });
}

(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'Cardiopulmonary Case Deck';
  pres.theme = { headFontFace: 'Kodchasan', bodyFontFace: 'Sarabun' };
  const ids = Object.keys(data).map(Number).sort((a, b) => a - b);
  let nBoxes = 0, nShapes = 0;
  for (const n of ids) {
    const d = data[n];
    const slide = pres.addSlide();
    const bgPng = path.join(DIR, 'bg-' + String(n).padStart(2, '0') + '.png');
    const buf = await sharp(bgPng).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    slide.background = { data: 'image/jpeg;base64,' + buf.toString('base64') };
    const raw = await sharp(bgPng).raw().toBuffer({ resolveWithObject: true });
    const sampleBg = (x, y) => {
      const k = raw.info.width / 1920;
      const px = Math.max(0, Math.min(raw.info.width - 1, Math.round(x * k))), py = Math.max(0, Math.min(raw.info.height - 1, Math.round(y * k)));
      const o = (py * raw.info.width + px) * raw.info.channels;
      return [raw.data[o], raw.data[o + 1], raw.data[o + 2]];
    };
    // layers in DOM order: decorations first, then native shapes / pictures as they stack in the HTML
    const layers = d.layers || (d.els || []).map((e) => ({ ...e, t: 'pic' }));
    const ordered = [...layers.filter((l) => l.t === 'pic' && l.kind === 'deco'), ...layers.filter((l) => !(l.t === 'pic' && l.kind === 'deco'))];
    ordered.forEach((L, i) => {
      if (L.t === 'shape') { if (process.env.NATIVE !== '0') { addNative(pres, slide, L, i + 1); nShapes++; } return; }
      const alt = { mascot: 'ตัวการ์ตูนปอด (ลบหรือย้ายได้)', deco: 'รูปทรงตกแต่ง (ลบหรือย้ายได้)', icon: 'ไอคอน (ลบหรือย้ายได้)', piece: 'ลวดลายตกแต่ง (ลบหรือย้ายได้)', text: 'ตัวอักษรเส้นขอบขนาดใหญ่ (เป็นรูปภาพ ลบหรือย้ายได้)', image: 'รูปภาพ' }[L.kind] || 'รูปภาพ';
      slide.addImage({ path: path.join(DIR, L.file), x: L.x * PX, y: L.y * PX, w: L.w * PX, h: L.h * PX, altText: alt, objectName: (L.name || 'Picture') + ' ' + (i + 1) });
    });
    const boxes = buildBoxes(d.frags);
    // reading order: top-to-bottom, left-to-right
    boxes.sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
    boxes.forEach((b, i) => {
      const slack = b.align === 'left' && b.lines.length === 1 ? 10 : 0;
      const runs = [];
      b.lines.forEach((ln, li) => {
        ln.forEach((r, ri) => {
          const o = runOpts(r.st, b.align, r.text);
          if (o.transparency && o.charSpacing && o.transparency < 100) {
            // LibreOffice clips alpha text with tracking; bake the alpha against the sampled background instead
            const bgc = sampleBg(b.x - 6, b.y + b.lh / 2);
            const a = 1 - o.transparency / 100;
            const fg = [0, 2, 4].map((i) => parseInt(o.color.slice(i, i + 2), 16));
            o.color = fg.map((v, i) => Math.round(v * a + bgc[i] * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase();
            delete o.transparency;
          }
          if (ri === ln.length - 1 && li < b.lines.length - 1) o.breakLine = true;
          runs.push({ text: r.text, options: o });
        });
      });
      let x = b.x + DX, w = b.w;
      const wide = b.lines.some((ln) => ln.some((r) => r.st.ls > 0.3 && !/[\u0E00-\u0E7F]/.test(r.text)));
      // generous width slack: Canva ignores wrap:none (a bold run wider than the SemiBold original wrapped "LPM" onto a 2nd line)
      const extra = Math.max(60, w * 0.3) + (wide ? 60 : 0);
      if (b.align === 'center') x -= extra / 2; else if (b.align === 'right') x -= extra;
      w += extra;
      const opts = {
        x: x * PX, y: (b.y + yAdj(b)) * PX, w: w * PX, h: b.h * PX,
        margin: 0, valign: 'top', wrap: !!wide, fit: 'none', isTextBox: true,
        paraSpaceAfter: 0, paraSpaceBefore: 0,
        objectName: `Text ${i + 1}`,
      };
      if (LINE_MODE !== 'line') opts.lineSpacing = Math.round(b.lh * PT * 100) / 100;
      if (b.rot) opts.rotate = b.rot < 0 ? 360 + b.rot : b.rot;
      slide.addText(runs, opts);
      nBoxes++;
      (global.DUMP || (global.DUMP = {}))[n] = (global.DUMP[n] || []).concat([{ x: b.x, y: b.y + yAdj(b), w: b.w, h: b.h, lh: b.lh, size: b.lines[0][0].st.size, lines: b.lines.length }]);
    });
  }
  await pres.writeFile({ fileName: OUTFILE });
  fs.writeFileSync(path.join(DIR, 'boxes.json'), JSON.stringify(global.DUMP));
  console.log('slides', ids.length, 'text boxes', nBoxes, 'native shapes', nShapes);
})();
