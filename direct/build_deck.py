"""Build the case-presentation deck directly as .pptx (python-pptx) from the Word record. No HTML step.
usage: python3 build_deck.py src.docx out.pptx"""
import sys, re, os
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from pptlib import *
import pptlib

SRC = sys.argv[1] if len(sys.argv) > 1 else 'src.docx'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'deck.pptx'
doc = Document(SRC)
CH = list(doc.element.body.iterchildren())


def para(i):
    return Paragraph(CH[i], doc).text.strip()


def tbl(i):
    t = Table(CH[i], doc)
    rows = []
    for r in t.rows:
        seen, cells = [], []
        for c in r.cells:
            if c._tc in seen: continue
            seen.append(c._tc)
            cells.append('\n'.join(p.text.strip() for p in c.paragraphs if p.text.strip()))
        rows.append(cells)
    return rows


def rng(a, b, skip_ph=True):
    out = []
    for i in range(a, b + 1):
        if CH[i].tag.endswith('}p'):
            t = para(i)
            if t and not (skip_ph and '[ระบุ' in t) and not (skip_ph and '[ตรวจสอบ' in t): out.append(t)
    return out


def clean(t):
    return re.sub(r'\s+', ' ', t).strip()


def strip_num(t):
    return re.sub(r'^\s*\d+\s*[.)]\s*', '', t).strip()


D = Deck()
W, H = 13.333, 7.5
MX = 0.55
CW = W - 2 * MX  # 12.23
ABN = re.compile(r'↓|Absent|absent|decreased|Decreased|Dullness|Flatness|fine crep|↑|High|Low|Tachy|tachy|Slightly|Maximal|Poor|Mild')


def std(label, bg='blue', sub=None, size=30):
    s = D.slide(bg, label)
    title(s, label, sub=sub, size=size)
    return s


def group(s, specs, max_pt=22, min_pt=10, face='Sarabun', tight=False):
    """cards on one slide share one font size (the smallest that fits all)"""
    pts = []
    for sp in specs:
        m = sp.get('margins', (0.28, 0.2, 0.28, 0.16))
        pts.append(fit_pt(to_paras(sp['paras']), sp['w'] - m[0] - m[2], sp['h'] - m[1] - m[3], max_pt, min_pt, face))
    pt = min(pts)
    hh = None
    if tight:  # shrink all cards of the row to the tallest content (+ breathing room), keep them equal
        need = []
        for sp in specs:
            m = sp.get('margins', (0.28, 0.2, 0.28, 0.16))
            need.append(measure(to_paras(sp['paras']), pt, sp['w'] - m[0] - m[2], face) + m[1] + m[3] + 0.35)
        hh = min(max(need), max(sp['h'] for sp in specs))
    out = []
    for sp in specs:
        kw = {k: v for k, v in sp.items() if k not in ('x', 'y', 'w', 'h', 'paras')}
        out.append(card(s, sp['x'], sp['y'], sp['w'], hh or sp['h'], sp['paras'], pt=pt, **kw)[0])
    return pt


def interp_paras(lines, pt_scale=1.0, bullets=True):
    out = []
    for ln in lines:
        out.append(P.lab(ln, bullet=bullets))
    return out


# ------------------------------------------------------------------ table panel (blue card > yellow inner > table)
def panel(s, x, y, w, h, heading, rows, interp=None, col_w=None, hl=None, align=None, max_pt=17, bold_first_col=False, outer='blue', inner='yellow',
          interp_pt=15, spans=None, header=1, hl_fill=C['hl'], force=None):
    if sum(col_w) > w - 0.7:
        k = (w - 0.7) / sum(col_w); col_w = [c * k for c in col_w]
    outer_sh = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=outer, radius=0.3, name='Panel')
    max_pt = min(22, max_pt * 1.25); interp_pt = min(19, interp_pt * 1.2)
    if force: max_pt, interp_pt = force
    cy = y + 0.18
    if heading:
        text(s, x + 0.2, cy, w - 0.4, 0.45, P((heading, True), align=PP_ALIGN.CENTER), pt=20, name='Panel heading', fit=True, min_pt=12)
        cy += 0.55
    ih = 0.0
    ip = None
    dry_keep = False
    if interp:
        ip = [P.lab(interp)] if isinstance(interp, str) else interp
        ipt = interp_pt
        while ipt > 10 and measure(ip, ipt, w - 0.6) > h * 0.34: ipt -= 0.5
        if force: ipt = min(ipt, force[1])
        ih = measure(ip, ipt, w - 0.6) + 0.1
    avail = y + h - cy - ih - 0.45
    tw = sum(col_w)
    # table inside inner card
    gs, pt, total = table(s, x + (w - tw) / 2, cy + 0.2, col_w, rows, header=header, max_pt=max_pt, min_pt=8, max_h=avail - 0.2, hl=hl, align=align,
                          bold_first_col=bold_first_col, spans=spans, hl_fill=hl_fill)
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x + (w - tw) / 2 - 0.2, cy, tw + 0.4, total + 0.4, fill=inner, radius=0.25, name='Table backdrop')
    # backdrop must sit behind table: move element before the table graphicFrame
    sp = s.shapes._spTree
    bd = sp[-1]; sp.remove(bd); sp.insert(list(sp).index(gs._element), bd)
    used = (cy + 0.2 + total + 0.25 + ih + 0.3 + (0.3 if ip else 0)) - y
    if ip:
        text(s, x + 0.3, cy + total + 0.55, w - 0.6, ih, ip, pt=ipt, name='Interpretation')
    if used < h - 0.1 and not dry_keep:
        outer_sh.height = Inches(used)
    return pt, (ipt if ip else interp_pt)


_SCR = Deck()


def panels(s, specs):
    """draw several panels with one shared table font and one shared interpretation font"""
    pts = []
    for sp in specs:
        sc = _SCR.slide('white')
        pts.append(panel(sc, **sp))
    ft = min(p[0] for p in pts)
    fi = min(p[1] for p in pts)
    for sp in specs:
        panel(s, force=(ft, fi), **sp)


def hl_cols(cols, pat=ABN):
    return lambda r, c, t: c in cols and bool(pat.search(t))


# ================================================================== 1 cover
s = D.slide('cream', 'Cover')
shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 8.3, -0.3, 5.3, 7.9, fill='lime', radius=0.5, name='Lime block')
shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 0.7, 0.75, 9.9, 6.0, fill='blue', radius=0.5, name='Blue panel')
star(s, 9.7, 0.45, 1.6)
star(s, 0.3, 6.0, 1.2, color='lime')
text(s, 1.1, 1.2, 9.2, 2.5, P(('case', True), align=PP_ALIGN.CENTER), pt=120, face='Kodchasan', name='Cover title 1', anchor=MSO_ANCHOR.MIDDLE)
text(s, 1.1, 3.6, 9.2, 1.5, P(('Presentation', True), align=PP_ALIGN.CENTER), pt=66, face='Kodchasan', name='Cover title 2', anchor=MSO_ANCHOR.MIDDLE)
text(s, 1.1, 5.2, 9.2, 0.6, P(('Cardiopulmonary case · Semi-ICU', True), align=PP_ALIGN.CENTER), pt=26, name='Cover subtitle')
nm = clean(re.sub(r'^ชื่อนิสิต\s*', '', para(3)))  # "อานันตญา สุวรรณมงคล อาจารย์ผู้ควบคุม PT Thitiwut"
m = re.match(r'(.*?)\s*อาจารย์ผู้ควบคุม\s*(.*)', nm)
text(s, 1.1, 5.75, 9.2, 0.9, [P('โดย ' + (m.group(1) if m else nm), align=PP_ALIGN.CENTER, after=0.1), P('อาจารย์ผู้ควบคุม ' + (m.group(2) if m else ''), align=PP_ALIGN.CENTER)], pt=18, name='Cover names')
picture(s, 'mascot_lung.png', 10.6, 3.9, 2.2, 2.6, name='Mascot (delete or move)')

# ================================================================== 2 patient
s = D.slide('lav', 'Patient')
text(s, MX, 0.38, 6, 0.4, P(('ผู้ป่วยและประวัติ', True), color=C['red']), pt=18, name='Eyebrow')
text(s, MX, 0.8, 12, 1.0, P('ผู้ป่วยที่มีปัญหาทั้งปอดและก้านสมอง'), pt=38, name='Title')
age = re.search(r'อายุ\s*(\d+)\s*ปี', para(5)).group(1)
job = re.search(r'อาชีพ\s*(.*)', para(5)).group(1).strip()
wt = re.search(r'น้ำหนัก\s*([\d.]+)', para(6)).group(1)
ht = re.search(r'ส่วนสูง\s*([\d.]+)', para(6)).group(1)
bmi = re.search(r'ดัชนีมวลกาย\s*([\d.]+)', para(6)).group(1)
text(s, 0.75, 2.4, 3, 0.4, P(('ผู้ป่วย', True), color=C['navy']), pt=16, name='Label')
text(s, 0.75, 2.7, 6.5, 1.6, P(('ชายไทยคู่', True), color=C['navy']), pt=60, name='Patient')
text(s, 0.75, 4.25, 6.0, 1.1, [P('อายุ ' + age + ' ปี', after=0.2), P(job)], pt=22, name='Age and job')
for k, (lab, val, unit, x0) in enumerate([('น้ำหนัก', wt, 'kg', 0.75), ('ส่วนสูง', ht, 'cm', 2.95), ('BMI', bmi, 'kg/m²', 5.0)]):
    text(s, x0, 5.45, 1.8, 0.4, P(lab), pt=17, name='Stat label')
    text(s, x0, 5.85, 2.9, 0.8, P((val + ' ', True), (unit, False), color=C['navy']), pt=30, name='Stat value')
rows = [('ประเภทผู้ป่วยทาง PT', 'Semi-ICU'), ('วันที่รับไว้ในโรงพยาบาล', para(9).split(':', 1)[1].strip()), ('วันแรกรับนิสิตกายภาพบำบัด', para(10).split(':', 1)[1].strip())]
for k, (a, b) in enumerate(rows):
    y0 = 2.55 + k * 1.15
    text(s, 6.6, y0, 3.7, 0.9, P(a), pt=19, name='Info label', fit=True, min_pt=13)
    text(s, 10.3, y0, 2.7, 0.9, P((b, True)), pt=22, name='Info value', fit=True, min_pt=13)
picture(s, 'mascot_lung.png', 11.2, 5.5, 1.6, 1.9, name='Mascot (delete or move)')

# ================================================================== 3 key diagnoses (pills)
s = D.slide('yellow', 'Diagnoses')
star(s, 10.6, -1.0, 2.8)
items = [para(11), para(12), para(13), para(53)]
items[3] = items[3].replace('ประวัติโรคประจำตัว', 'โรคประจำตัว')
pt = 24
while True:
    sizes = []
    for it in items:
        ps = [P.lab(clean(it), align=PP_ALIGN.CENTER, after=0)]
        w = 11.3
        sizes.append((w, max(0.9, measure(ps, pt, w - 0.7) + 0.35), ps))
    if sum(h for _, h, _ in sizes) + 0.35 * 3 < 5.6 or pt <= 18: break
    pt -= 1
y = 1.15
for w, h, ps in sizes:
    card(s, (W - w) / 2, y, w, h, ps, fill='blue', radius=h / 2, pt=pt, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, name='Pill', margins=(0.35, 0.1, 0.35, 0.1))
    y += h + 0.35

# ================================================================== 4 precautions
s = std('ข้อห้าม / ข้อควรระวัง', 'cream', sub='Contraindications / Precautions')
items = rng(15, 20)
cw = (CW - 0.4) / 2
ch = 1.62
specs = []
for k, it in enumerate(items):
    r, c = divmod(k, 2)
    specs.append(dict(x=MX + c * (cw + 0.4), y=1.75 + r * (ch + 0.22), w=cw, h=ch, paras=[P.lab(it)], fill=['white', 'blue'][(r + c) % 2], anchor=MSO_ANCHOR.MIDDLE, name='Precaution'))
group(s, specs, 21, 12)

# ================================================================== 5-9 history of present illness
entries = []
cur = None
DATE = re.compile(r'^(กรกฎาคม|\d{1,2}(\s*[–-]\s*\d{1,2})?\s+(ตุลาคม|พฤศจิกายน))')
for i in range(30, 52):
    if not CH[i].tag.endswith('}p'): continue
    t = Paragraph(CH[i], doc).text
    if not t.strip(): continue
    lines = [l.strip() for l in t.split('\n') if l.strip()]
    if DATE.match(lines[0]) and len(lines[0]) < 40:
        cur = [lines[0], ' '.join(lines[1:])]
        entries.append(cur)
    elif cur is not None:
        cur[1] = (cur[1] + ' ' + ' '.join(lines)).strip()
groups = [[0, 1], [2, 3], [4, 5], [6, 7], [8]]
for g in groups:
    es = [entries[k] for k in g if k < len(entries)]
    if not es: continue
    s = std('ประวัติปัจจุบัน', 'blue', sub='History of present illness')
    wts = [max(len(e[1]), 120) ** 0.7 for e in es]
    tot = sum(wts)
    avail = CW - 0.4 * (len(es) - 1)
    x = MX
    specs = []
    for e, wgt, fill in zip(es, wts, ['white', 'cream']):
        w = avail * wgt / tot if len(es) > 1 else 8.0
        if len(es) == 1: x = (W - w) / 2
        body = e[1]
        parts = [clean(p_) for p_ in re.split(r'\s(?=วันที่ \d)', body)] if 'วันที่ ' in body and len(body) > 250 else [clean(body)]
        ps = [P((e[0], True), align=PP_ALIGN.CENTER, scale=1.1, after=0.5)] + [P(p_, bullet=True) for p_ in parts]
        specs.append(dict(x=x, y=1.95, w=w, h=4.95, paras=ps, fill=fill, name='Timeline card ' + e[0]))
        x += w + 0.4
    group(s, specs, 27, 12, tight=True)

# ================================================================== 10 past history
s = std('ประวัติอดีต', 'cream', sub='Past history')
left = [P.lab(t, bullet=True) for t in rng(53, 58)]
card(s, MX, 1.75, 7.4, 5.2, left, fill='white', max_pt=21, min_pt=12, name='Past history')
card(s, 8.3, 1.75, 4.48, 1.35, [P.lab(para(59))], fill='blue', max_pt=19, min_pt=12, name='Family history', anchor=MSO_ANCHOR.MIDDLE)
card(s, 8.3, 3.3, 4.48, 3.65, [P.lab(para(60))], fill='yellow', max_pt=19, min_pt=12, name='Social history')
s = D.slide('cream', 'Status')
title(s, 'Status เดิม', sub='ก่อนเจ็บป่วย')
card(s, 2.0, 2.3, 9.3, 2.9, [P.lab(para(61))], fill='white', max_pt=32, min_pt=14, anchor=MSO_ANCHOR.MIDDLE, name='Status')
picture(s, 'mascot_lung.png', 10.4, 5.0, 1.9, 2.3, name='Mascot (delete or move)')

# ================================================================== drug history (table 64)
rows = tbl(64)
hdr, body = rows[0], rows[1:]
per = 8
for k in range(0, len(body), per):
    s = std('Drug history', 'lav', sub='ประวัติยาที่ใช้ในปัจจุบัน')
    chunk = body[k:k + per]
    table(s, MX, 1.7, [3.9, 4.35, 3.98], [hdr] + chunk, max_pt=16, min_pt=9, max_h=5.4, align=['l', 'l', 'l'], bold_first_col=True, name='Drug table')

# ================================================================== labs
for (hi, ti, ii0, ii1, ttl) in [(67, 68, 69, 72, 'Hematology (13/11/69)'), (73, 74, 75, 79, 'Blood Biochemistry (13/11/69)')]:
    rows = tbl(ti)
    interp = [t for t in rng(ii0, ii1) if not t.startswith('การแปลผล') and len(t) > 15]
    s = std('Lab investigation', 'cream', sub=ttl)
    if len(rows[0]) == 4:   # hematology: table left, interpretation right
        gs, pt, tot = table(s, MX, 1.6, [2.7, 1.3, 1.6, 1.8], rows, max_pt=15, min_pt=9, max_h=5.4, cell_m=(0.08, 0.025), align=['l', 'c', 'c', 'c'],
                            hl=lambda r, c, t: c == 1 and bool(re.search(r'[↓↑]', t)), name='Lab table')
        card(s, 8.1, 1.6, 4.68, 5.4, [P((' การแปลผล', True), after=0.5)] + [P(t, bullet=True) for t in interp], fill='blue', max_pt=17, min_pt=11, name='Interpretation')
    else:
        gs, pt, tot = table(s, MX, 1.6, [2.0, 2.2, 2.2, 2.2, 3.63], rows, max_pt=15, min_pt=9, max_h=3.3, align=['l', 'c', 'c', 'c', 'l'],
                            hl=lambda r, c, t: c in (1, 4) and bool(re.search(r'[↓↑]|High|Slightly', t)), name='Lab table')
        card(s, MX, 1.6 + tot + 0.3, CW, 7.1 - (1.6 + tot + 0.3), [P((' การแปลผล', True), after=0.3)] + [P(t, bullet=True) for t in interp], fill='blue', max_pt=17, min_pt=11, name='Interpretation')

# ================================================================== special investigation
rows0 = [r for r in tbl(103) if r and r[0].strip() and r[0] != '[]' and len(r) >= 2]
spans = {(k, 1): 2 for k, r in enumerate(rows0) if len(r) == 2}
rows = [(r + [''] * 3)[:3] for r in rows0]
s = std('Special Investigation', 'lav', sub='Chest X-ray (12/11/69) · ' + para(102))
picture(s, 'cxr.png', MX, 1.6, 3.6, 5.4, name='Chest X-ray', border='FFFFFF')
gs, pt, tot = table(s, 4.4, 1.6, [2.2, 3.1, 3.08], rows, max_pt=14, min_pt=9, max_h=3.4, align=['l', 'l', 'l'], bold_first_col=True, name='CXR findings', cell_m=(0.08, 0.03), spans=spans)
interp = rng(105, 106)
card(s, 4.4, 1.6 + tot + 0.25, 8.38, 7.05 - (1.6 + tot + 0.25), [P((' แปลผล', True), after=0.3)] + [P(t, bullet=True) for t in interp], fill='white', max_pt=17, min_pt=11, name='Interpretation')

s = std('Special Investigation', 'lav', sub='CT chest')
picture(s, 'ct.jpg', MX + 0.2, 1.7, 7.2, 5.3, name='CT chest', border='FFFFFF')
ctt = [t for t in rng(30, 51) if 'CT chest' in t]
ctline = ''
for t in ctt:
    m = re.search(r'(Sputum culture.*)', t.replace('\n', ' '))
    ctline = m.group(1) if m else t
card(s, 8.1, 1.7, 4.68, 5.3, [P((' ผล CT chest', True), after=0.3), P('(จากประวัติ 18–26/10/69)', after=0.5), P(re.sub(r'^.*?ผล U/S chest และ CT chest\s*', '', ctline))], fill='white', max_pt=24, min_pt=12, name='CT note', anchor=MSO_ANCHOR.MIDDLE)

# ================================================================== vital signs
s = std('Vital signs', 'cream', sub=para(113))
rows = tbl(114)
panel(s, MX, 1.65, CW, 5.4, None, rows, interp=para(115), col_w=[2.1, 2.1, 1.5, 3.7, 2.6], hl=lambda r, c, t: c in (3, 4) and r > 0 and rows[r][4].strip().lower() not in ('normal', '-', ''), max_pt=20, interp_pt=20)

# ================================================================== objective: observation
s = std('Objective examination', 'cream', sub='1. Observation (13/11/69)')
obs = rng(119, 152)
lens = [len(t) + 40 for t in obs]
half = min(range(1, len(obs)), key=lambda k: abs(sum(lens[:k]) - sum(lens[k:])))
group(s, [dict(x=MX, y=1.7, w=6.05, h=5.35, paras=[P.lab(t, bullet=True) for t in obs[:half]], fill='white', name='Observation 1'),
          dict(x=MX + 6.18, y=1.7, w=6.05, h=5.35, paras=[P.lab(t, bullet=True) for t in obs[half:]], fill='blue', name='Observation 2')], 19, 11)
s = std('Body chart', 'lav')
picture(s, 'bodychart.png', 0.9, 1.6, 11.5, 5.5, name='Body chart', border='FFFFFF')

# ================================================================== palpation
s = std('Palpation', 'cream', sub='2. Palpation (13/11/69)')
card(s, MX, 1.7, 4.2, 5.35, [P(t, bullet=True) for t in rng(156, 159)], fill='white', max_pt=22, min_pt=12, name='Palpation findings', anchor=MSO_ANCHOR.MIDDLE)
rows = tbl(161)
panel(s, 4.95, 1.7, 7.83, 5.35, para(160), rows, interp=para(162) if para(162) else para(163), col_w=[2.3, 2.3, 2.3], hl=hl_cols([1, 2]), max_pt=20)

s = std('Palpation', 'cream', sub='Chest movement · Chest expansion')
rows = tbl(167)
rows2_ = tbl(172)
panels(s, [dict(x=MX, y=1.7, w=6.05, h=5.35, heading=para(166), rows=rows, interp=para(168), col_w=[1.6, 3.6], hl=hl_cols([1]), align=['c', 'l'], max_pt=16, interp_pt=14),
           dict(x=MX + 6.18, y=1.7, w=6.05, h=5.35, heading=para(170) + ' ' + para(171), rows=rows2_, interp=para(173), col_w=[1.45, 0.9, 0.9, 1.05, 1.15], hl=lambda r, c, t: c == 3 and r > 0, max_pt=16, interp_pt=14)])

# ================================================================== percussion
s = std('Percussion', 'cream', sub='3. Percussion')
rows1, rows2 = tbl(176), tbl(180)
panels(s, [dict(x=MX, y=1.7, w=6.05, h=5.35, heading=para(175), rows=rows1, interp=para(177), col_w=[1.6, 1.8, 1.8], hl=hl_cols([1, 2], re.compile('Dullness|Flatness')), max_pt=18, interp_pt=14),
           dict(x=MX + 6.18, y=1.7, w=6.05, h=5.35, heading=para(179), rows=rows2, interp=para(181), col_w=[1.6, 1.8, 1.8], hl=hl_cols([1, 2], re.compile('Dullness|Flatness')), max_pt=18, interp_pt=14)])

# ================================================================== auscultation (pairs)
def aus(i_head, i_tbl, i_int):
    return (clean(para(i_head)), tbl(i_tbl), para(i_int))


def interp_of(i_tbl):
    for j in range(i_tbl + 1, i_tbl + 4):
        if CH[j].tag.endswith('}p') and para(j) and ('แปลผล' in para(j)): return para(j)
    return ''


for pair in [(185, 186, 188, 189), (200, 201, 204, 205), (219, 220, 223, 224)]:
    s = std('Auscultation', 'cream', sub='4. Auscultation')
    panels(s, [dict(x=MX + k * 6.18, y=1.7, w=6.05, h=5.35, heading=clean(para(ih)), rows=tbl(it), interp=interp_of(it), col_w=[1.2, 2.1, 2.1], hl=hl_cols([1, 2], re.compile('↓|Absent|fine crep')), max_pt=16, interp_pt=14, align=['c', 'c', 'c'])
               for k, (ih, it) in enumerate([(pair[0], pair[1]), (pair[2], pair[3])])])

# ================================================================== ROM, muscle strength
s = std('Range of motion', 'cream', sub='5. ' + para(239))
panel(s, 2.6, 1.7, 8.1, 5.35, None, tbl(241), interp=para(240), col_w=[3.6, 2.0, 2.0], max_pt=18)
s = std('Muscle strength', 'cream', sub='6. MMT (13/11/69)')
mm = tbl(245)
rows = [['Muscle group', 'Lt.', 'Rt.', 'Muscle group', 'Lt.', 'Rt.']] + [r for r in mm[2:] if len(r) >= 6]
panel(s, MX, 1.7, CW, 5.35, None, rows, interp=para(247), col_w=[3.0, 0.9, 0.9, 3.0, 0.9, 0.9], align=['l', 'c', 'c', 'l', 'c', 'c'], max_pt=15, interp_pt=15)

# ================================================================== bed mobility
s = std('Bed mobility', 'cream', sub='7. Bed mobility')
panels(s, [dict(x=MX + k * 6.18, y=1.7, w=6.05, h=5.35, heading=clean(para(ih)), rows=tbl(it), interp=para(ii), col_w=[2.6, 2.6], hl=hl_cols([1], re.compile('Maximal')), align=['l', 'c'], max_pt=17, interp_pt=14)
           for k, (ih, it, ii) in enumerate([(250, 251, 252), (254, 255, 256)])])

# ================================================================== function assessment
s = std('Function assessment', 'cream', sub='8–12')
panel(s, MX, 2.0, CW, 4.2, para(259), tbl(260), col_w=[1.6, 1.6, 1.6, 6.6], hl=hl_cols([1, 2], re.compile('Poor')), align=['c', 'c', 'c', 'l'], max_pt=18)
s = std('Function assessment', 'cream', sub='9–12')
aer = para(263).split(':', 1)[-1].strip() if para(263) else ''
cards4 = [('9. Aerobic capacity', [aer]), ('10. ADL (13/11/69)', rng(265, 268)), ('11. Functional mobility', [t.split(':', 1)[-1].strip() for t in rng(270, 270)]), ('12. Outcome measures', rng(272, 273))]
mk = lambda k: [P((cards4[k][0], True), after=0.4)] + [P.lab(t, bullet=(len(cards4[k][1]) > 1), after=0.25) for t in cards4[k][1]]
group(s, [dict(x=MX + (k % 2) * 6.2, y=1.8 + (k // 2) * 2.7, w=6.03, h=2.5, paras=mk(k), fill=['white', 'yellow', 'blue', 'lav'][k], name='Function card') for k in range(4)], 26, 12, tight=True)

# ================================================================== ICF
s = std('ICF Model', 'blue', sub='สรุปปัญหาทางกายภาพบำบัด')
icf = tbl(277)
hc = icf[0][0].replace('\n', ' ')
card(s, MX, 1.6, CW, 1.05, [P((hc.split(' ', 2)[0] + ' ' + hc.split(' ', 2)[1] + ': ', True), (hc.split(' ', 2)[2], False), color='FFFFFF', align=PP_ALIGN.CENTER)], fill=C['navy'], max_pt=20, min_pt=11, anchor=MSO_ANCHOR.MIDDLE, name='Health condition', radius=0.4)
cols = icf[2]
heads = icf[1]
wcol = [5.0, 3.9, 3.13]
x = MX
specs = []
for k in range(3):
    ps = [P((heads[k], True), align=PP_ALIGN.CENTER, after=0.5, color=C['navy'])] + [P(t.strip('-• ').strip(), bullet=True, after=0.3) for t in cols[k].split('\n') if t.strip()]
    specs.append(dict(x=x, y=2.8, w=wcol[k], h=4.3, paras=ps, fill='white', name=heads[k], margins=(0.22, 0.18, 0.2, 0.1)))
    x += wcol[k] + 0.1
group(s, specs, 19, 10)
s = std('ICF Model', 'blue', sub='Environmental · Personal factors')
env = tbl(279)
specs = []
for k in range(2):
    ps = [P((env[0][k], True), align=PP_ALIGN.CENTER, after=0.5, color=C['navy'])] + [P(t.strip('-• ').strip(), bullet=True, after=0.4) for t in env[1][k].split('\n') if t.strip()]
    specs.append(dict(x=MX + k * 6.2, y=1.8, w=6.03, h=5.2, paras=ps, fill=['cream', 'yellow'][k], name=env[0][k]))
group(s, specs, 26, 12, tight=True)

# ================================================================== problem list
rows = tbl(281)
hdr, body = rows[0], rows[1:]
colw = [2.4, 4.6, 5.23]


def row_h(r, pt):
    mm = 0
    for ci, t in enumerate(r):
        paras_ = [P((ln, False), after=0) for ln in t.split('\n')]
        mm = max(mm, measure(paras_, pt, colw[ci] - 0.16, 'Sarabun', 0))
    return mm + 0.1


pack, curp, ch_ = [], [], 0.4
for r in body:
    hh = row_h(r, 13)
    if curp and ch_ + hh > 5.4:
        pack.append(curp); curp, ch_ = [], 0.4
    curp.append(r); ch_ += hh
if curp: pack.append(curp)
for k, pr in enumerate(pack):
    s = std('Problem list', 'cream', sub='%d / %d' % (k + 1, len(pack)))
    table(s, MX, 1.6, colw, [hdr] + pr, max_pt=15, min_pt=9, max_h=5.45, align=['l', 'l', 'l'], bold_first_col=True, name='Problem table')

# ================================================================== goals
s = std('เป้าหมายการรักษา', 'cream', sub='Goals')
card(s, MX, 1.7, 5.2, 1.55, [P.lab(para(285))], fill='white', max_pt=19, min_pt=11, name='Patient goal', anchor=MSO_ANCHOR.MIDDLE)
card(s, MX, 3.45, 5.2, 3.6, [P.lab(para(286))], fill='yellow', max_pt=22, min_pt=11, name='Long term goal', anchor=MSO_ANCHOR.MIDDLE)
card(s, 6.0, 1.7, 6.78, 5.35, [P((para(287), True), after=0.5)] + [P(t, bullet=True) for t in rng(288, 294)], fill='pink', max_pt=19, min_pt=11, name='Short term goals')

# ================================================================== plan of care
rows = tbl(297)
hdr, body = rows[0], rows[1:]
colw = [3.5, 8.73]
pack, curp, ch_ = [], [], 0.4
for r in body:
    hh = row_h(r, 15)
    if curp and ch_ + hh > 5.3:
        pack.append(curp); curp, ch_ = [], 0.4
    curp.append(r); ch_ += hh
if curp: pack.append(curp)
for k, pr in enumerate(pack):
    s = std('Plan of care', 'blue', sub='%d / %d' % (k + 1, len(pack)))
    table(s, MX, 1.65, colw, [hdr] + pr, max_pt=22, min_pt=10, max_h=5.45, align=['l', 'l'], bold_first_col=True, name='Plan table')

# ================================================================== treatment 13/11
s_items = []
i = 301
while i <= 318:
    t = para(i)
    if re.match(r'^\d+\.', t):
        s_items.append([t, []])
    elif t and s_items:
        s_items[-1][1].append(t)
    i += 1
for k in range(0, len(s_items), 3):
    s = std('การรักษาทางกายภาพบำบัด', 'lav', sub=para(300))
    chunk = s_items[k:k + 3]
    wc = (CW - 0.5) / 3
    specs = []
    for j, (h_, lines) in enumerate(chunk):
        ps = [P((h_, True), after=0.5, scale=1.1)] + [P.lab(l_) if l_.startswith('วัตถุประสงค์') else P(l_, after=0.5) for l_ in lines]
        specs.append(dict(x=MX + j * (wc + 0.25), y=1.8, w=wc, h=5.2, paras=ps, fill=['white', 'cream', 'blue'][j], name='Treatment'))
    group(s, specs, 24, 11, tight=True)
s = std('การประเมินผลการรักษา', 'cream', sub='13/11/69')
card(s, 1.6, 2.0, 10.1, 4.2, [P(t, bullet=True) for t in rng(320, 322)], fill='white', max_pt=26, min_pt=14, anchor=MSO_ANCHOR.MIDDLE, name='Evaluation')


# ================================================================== SOAP
def soap_day(hd, s_i, vs_head, vs_tbl, vs_int, extra_tbls, aus_head, aus_tbl, others, assess, tx_head, tx, reass, plan, bg='blue'):
    day = clean(para(hd))
    plan = clean(plan.replace(', ,', ','))
    s = std('SOAP', bg, sub=day)
    card(s, MX, 1.7, CW, 1.1, [P(('Subjective:  ', True), (rng(s_i, s_i)[0], False))], fill='white', max_pt=24, min_pt=12, name='Subjective', anchor=MSO_ANCHOR.MIDDLE)
    rows = tbl(vs_tbl)
    panel(s, 1.6, 3.0, 10.13, 4.1, clean(para(vs_head)), rows, interp=para(vs_int), col_w=[1.6, 1.8, 1.2, 3.0, 2.2], hl=lambda r, c, t: c in (3, 4) and r > 0 and rows[r][4].strip().lower() not in ('normal', '-', ''), max_pt=17, interp_pt=15)
    if extra_tbls:
        eh, et, ei = extra_tbls[0]
        s = std('SOAP', bg, sub=day + ' · Palpation')
        panel(s, 2.0, 1.7, 9.33, 5.0, clean(para(eh)), tbl(et), interp=para(ei), col_w=[2.0, 1.4, 1.4, 1.5, 1.6], hl=lambda r, c, t: c == 3 and r > 0, max_pt=18, interp_pt=16)
    s = std('SOAP', bg, sub=day + ' · Objective')
    panel(s, MX, 1.7, 6.6, 5.35, clean(para(aus_head)), tbl(aus_tbl), interp=interp_of(aus_tbl), col_w=[1.3, 2.3, 2.3], hl=hl_cols([1, 2], re.compile('↓|Absent|fine crep')), max_pt=15, interp_pt=14)
    card(s, 7.3, 1.7, 5.48, 5.35, [P((' การตรวจอื่น ๆ', True), after=0.4)] + [P.lab(t, bullet=True) for t in others], fill='white', max_pt=18, min_pt=10, name='Other findings')
    s = std('SOAP', bg, sub=day + ' · Assessment')
    card(s, MX, 1.75, CW, 5.3, [P.lab(t, bullet=True, after=0.6) for t in assess], fill='white', max_pt=21, min_pt=11, name='Assessment', anchor=MSO_ANCHOR.MIDDLE)
    s = std('SOAP', bg, sub=day + ' · Treatment')
    wc = [3.6, 4.3, 4.0]
    x = MX
    cols_ = [([P((tx_head, True), after=0.4)] + [P(t) for t in tx], 'yellow'), ([P(('Reassessment', True), after=0.4)] + [P(t, bullet=True) for t in reass], 'white'), ([P(('Plan', True), after=0.4), P(re.sub(r'^Plan:\s*', '', plan))], 'cream')]
    specs = []
    for k, (ps, fl) in enumerate(cols_):
        specs.append(dict(x=x, y=1.75, w=wc[k], h=5.3, paras=ps, fill=fl, name='SOAP ' + str(k)))
        x += wc[k] + 0.22
    group(s, specs, 22, 11, tight=True)


soap_day(325, 327, 330, 331, 332, [(334, 335, 336)], 338, 339, [t for t in rng(343, 349)], rng(351, 354), 'การรักษาวันนี้', rng(356, 360), rng(362, 364), para(366))
soap_day(368, 370, 373, 374, 375, None, 378, 379, rng(382, 388), rng(390, 395), 'การรักษาวันนี้', rng(397, 403), rng(405, 406), para(411), bg='lav')

# 18/11: placeholders skipped -> only what the record actually contains
s = std('SOAP', 'cream', sub=clean(para(432)) + ' · Auscultation')
panels(s, [dict(x=MX, y=1.7, w=6.05, h=5.35, heading=clean(para(442)), rows=tbl(443), interp=interp_of(443), col_w=[1.2, 2.1, 2.1], hl=hl_cols([1, 2], re.compile('↓|Absent|fine crep')), max_pt=16, interp_pt=14),
           dict(x=MX + 6.18, y=1.7, w=6.05, h=5.35, heading=clean(para(472)), rows=tbl(473), interp=para(474), col_w=[1.2, 2.1, 2.1], hl=hl_cols([1, 2], re.compile('↓|Absent|fine crep')), max_pt=16, interp_pt=14)])
s = std('SOAP', 'cream', sub=clean(para(432)) + ' · Assessment')
card(s, MX, 1.75, CW, 5.3, [P.lab(t, bullet=True, after=0.6) for t in rng(454, 456)], fill='white', max_pt=21, min_pt=11, name='Assessment', anchor=MSO_ANCHOR.MIDDLE)
s = std('SOAP', 'cream', sub=clean(para(432)) + ' · Treatment & plan')
group(s, [dict(x=MX, y=1.75, w=4.6, h=5.3, paras=[P(('การรักษาวันนี้', True), after=0.4)] + [P(t) for t in rng(459, 465)], fill='yellow', name='Treatment'),
          dict(x=MX + 4.82, y=1.75, w=7.41, h=5.3, paras=[P(('Plan', True), after=0.4), P(re.sub(r'^Plan:\s*', '', para(475)).replace(', ,', ','))], fill='cream', name='Plan')], 21, 11)

# ================================================================== end
s = D.slide('cream', 'Q&A')
shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 2.2, 1.5, 8.9, 4.4, fill='blue', radius=0.5, name='Panel')
star(s, 9.8, 0.9, 1.5)
star(s, 1.7, 5.2, 1.2, color='lime')
text(s, 2.2, 2.2, 8.9, 2.0, P(('Q & A', True), align=PP_ALIGN.CENTER), pt=90, face='Kodchasan', name='Q&A', anchor=MSO_ANCHOR.MIDDLE)
text(s, 2.2, 4.1, 8.9, 0.8, P('ขอบคุณค่ะ', align=PP_ALIGN.CENTER), pt=30, name='Thanks')
picture(s, 'mascot_lung.png', 10.3, 4.5, 2.2, 2.6, name='Mascot (delete or move)')

D.save(OUT)
bad = [l for l in pptlib._LOG if l[5]]
print('slides', D.n, 'overflow-risk items', len(bad))
for b in bad: print('  OVER', b)
