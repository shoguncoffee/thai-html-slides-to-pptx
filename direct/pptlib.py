"""Tiny layer over python-pptx for building simple, fully native Canva-style slides.
Everything is a real shape / text / table (nothing baked into images except real pictures).
Text fitting uses PIL font metrics so cards and tables are sized before PowerPoint/Canva ever sees them."""
import os, re, copy
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree
from PIL import ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_FILES = {('Sarabun', False): 'Sarabun-400-normal.ttf', ('Sarabun', True): 'Sarabun-700-normal.ttf',
              ('Kodchasan', False): 'Kodchasan-500-normal.ttf', ('Kodchasan', True): 'Kodchasan-700-normal.ttf'}
_fc = {}


def _font(face, bold):
    k = (face, bold)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(os.path.join(HERE, FONT_FILES[k]), 200)
    return _fc[k]


def text_w(text, pt, face='Sarabun', bold=False):
    """width in inches"""
    return _font(face, bold).getlength(text) / 200.0 * pt / 72.0


# ---------------------------------------------------------------- palette (taken from the example slides)
C = dict(cream='FFF8E4', blue='DDE6FD', yellow='FAFBA0', lav='E6DEFD', lime='E0E552', orange='F7863B', white='FFFFFF',
         ink='161616', navy='2D55AD', red='C8323C', grey='D9D9D9', hl='FF9F55', peach='FDE6C8', pink='F9B8BD', mint='CDEBE3')
LH = 1.38  # exact line pitch = LH * font size (Sarabun has tall Thai marks)
SLACK = 0.93  # use only this share of the box width when predicting line breaks (renderers break at word boundaries)
LEAD = set('เแโใไ')
MARKS = set('ัิีึืฺุู็่้๊๋์ํ๎')


def rgb(h):
    return RGBColor.from_string(h)


# ---------------------------------------------------------------- paragraphs
class P:
    """paragraph = list of (text, bold) runs; bullet; size multiplier; colour; align"""

    def __init__(self, *runs, bullet=False, scale=1.0, color=None, align=None, after=0.28, face=None):
        rr = []
        for r in runs:
            rr.append((r, False) if isinstance(r, str) else r)
        self.runs, self.bullet, self.scale, self.color, self.align, self.after, self.face = rr, bullet, scale, color, align, after, face

    @staticmethod
    def lab(text, bullet=False, **kw):
        """'Label: rest' -> bold label"""
        m = re.match(r'^([^:]{1,70}?:)(.*)$', text, re.S)
        if m and not text.startswith('http'):
            return P((m.group(1), True), (m.group(2), False), bullet=bullet, **kw)
        return P(text, bullet=bullet, **kw)

    def plain(self):
        return ''.join(t for t, _ in self.runs)


def _breaks(s):
    """allowed break indexes inside a string (after spaces; between Thai letters not splitting marks/leading vowels)"""
    out = []
    for i in range(1, len(s)):
        a, b = s[i - 1], s[i]
        if a == ' ':
            out.append(i)
        elif '฀' <= b <= '๿' and b not in MARKS and a not in LEAD and '฀' <= a <= '๿':
            out.append(i)
        elif b == ' ':
            pass
    return out


def wrap_lines(runs, pt, width_in, face):
    """greedy wrap of mixed bold/regular runs -> number of lines"""
    # flatten to chars with bold flag
    chars = [(ch, b) for t, b in runs for ch in t]
    if not chars:
        return 1
    avail = width_in * SLACK
    lines, cur_w, last_break, line_start = 1, 0.0, None, 0
    widths = [text_w(ch, pt, face, b) for ch, b in chars]
    brk = set()
    s = ''.join(c for c, _ in chars)
    for i in _breaks(s):
        brk.add(i)
    i = 0
    n = len(chars)
    cur_w = 0.0
    last_break = None
    while i < n:
        if chars[i][0] == '\n':
            lines += 1; cur_w = 0.0; last_break = None; line_start = i + 1; i += 1; continue
        if i in brk:
            last_break = i
        w = widths[i]
        if cur_w + w > avail and chars[i][0] != ' ' and i > line_start:
            # wrap
            lines += 1
            if last_break is not None and last_break > line_start:
                i = last_break
            line_start = i
            cur_w = 0.0
            last_break = None
            continue
        cur_w += w
        i += 1
    return lines


def measure(paras, pt, width_in, face='Sarabun', bullet_in=0.28):
    h = 0.0
    for p in paras:
        f = p.face or face
        size = pt * p.scale
        w = width_in - (bullet_in if p.bullet else 0)
        ln = wrap_lines(p.runs, size, w, f)
        h += ln * size * LH / 72.0 + size * p.after / 72.0
    return h


def longest_token(paras, pt, face='Sarabun', bullet_in=0.28):
    """widest run of characters that has no allowed break point (a long Latin word breaks mid-word if wider than the line)"""
    worst = 0.0
    for q in paras:
        s = ''.join(t for t, _ in q.runs)
        bold = any(b for _, b in q.runs)
        idx = [0] + _breaks(s) + [len(s)]
        for a_, b_ in zip(idx, idx[1:]):
            seg = s[a_:b_].strip()
            if seg and not re.search(r'[\u0e00-\u0e7f]', seg):
                worst = max(worst, text_w(seg, pt * q.scale, q.face or face, bold))
    return worst


def fit_pt(paras, w_in, h_in, max_pt, min_pt, face='Sarabun'):
    pt = max_pt
    while pt > min_pt and (measure(paras, pt, w_in, face) > h_in or longest_token(paras, pt, face) > (w_in - 0.3) * 0.97):
        pt -= 0.5
    return pt


# ---------------------------------------------------------------- xml helpers
def _set_fonts(rPr, face):
    for tag in ('a:latin', 'a:ea', 'a:cs'):
        for e in rPr.findall(qn(tag)):
            rPr.remove(e)
    for tag in ('a:latin', 'a:ea', 'a:cs'):
        e = etree.SubElement(rPr, qn(tag))
        e.set('typeface', face)
    rPr.set('lang', 'th-TH')


def fill_tf(tf, paras, pt, face='Sarabun', align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, margins=(0.2, 0.12, 0.2, 0.12), color=C['ink']):
    tf.word_wrap = True
    tf.auto_size = None
    tf.margin_left, tf.margin_top, tf.margin_right, tf.margin_bottom = [Inches(m) for m in margins]
    tf.vertical_anchor = anchor
    first = True
    for p in paras:
        para = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        size = pt * p.scale
        para.alignment = p.align if p.align is not None else align
        para.line_spacing = Pt(round(size * LH, 1))
        para.space_after = Pt(round(size * p.after, 1))
        para.space_before = Pt(0)
        pPr = para._p.get_or_add_pPr()
        if p.bullet:
            ind = int(Inches(0.28))
            pPr.set('marL', str(ind)); pPr.set('indent', str(-ind))
            bc = etree.SubElement(pPr, qn('a:buClr')); sc = etree.SubElement(bc, qn('a:srgbClr')); sc.set('val', p.color or color)
            bf = etree.SubElement(pPr, qn('a:buFont')); bf.set('typeface', 'Arial')
            bu = etree.SubElement(pPr, qn('a:buChar')); bu.set('char', '•')
        else:
            pPr.set('marL', '0'); pPr.set('indent', '0')
            etree.SubElement(pPr, qn('a:buNone'))
        for text, bold in p.runs:
            r = para.add_run()
            r.text = text
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.color.rgb = rgb(p.color or color)
            _set_fonts(r._r.get_or_add_rPr(), p.face or face)


def to_paras(x):
    if isinstance(x, P): return [x]
    if isinstance(x, str): return [P(x)]
    return list(x)


# ---------------------------------------------------------------- deck
class Deck:
    def __init__(self):
        self.prs = Presentation()
        self.prs.slide_width = Inches(13.333)
        self.prs.slide_height = Inches(7.5)
        self.blank = self.prs.slide_layouts[6]
        self.n = 0
        self.log = []

    def slide(self, bg='blue', name=''):
        s = self.prs.slides.add_slide(self.blank)
        s.background.fill.solid(); s.background.fill.fore_color.rgb = rgb(C.get(bg, bg))
        self.n += 1
        s._name_ = name
        return s

    def save(self, path):
        self.prs.save(path)


def shape(slide, kind, x, y, w, h, fill=None, line=None, lw=0.75, name=None, radius=None, alpha=None):
    sh = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill:
        sh.fill.solid(); sh.fill.fore_color.rgb = rgb(C.get(fill, fill))
    else: sh.fill.background()
    if line:
        sh.line.color.rgb = rgb(C.get(line, line)); sh.line.width = Pt(lw)
    else: sh.line.fill.background()
    sh.shadow.inherit = False
    if radius is not None and kind == MSO_SHAPE.ROUNDED_RECTANGLE:
        sh.adjustments[0] = min(0.5, radius / min(w, h))
    if name: sh.name = name
    return sh


def star(slide, x, y, size, color='orange', name='Starburst'):
    sh = shape(slide, MSO_SHAPE.STAR_10_POINT, x, y, size, size, fill=color, name=name)
    try: sh.adjustments[0] = 0.30
    except Exception: pass
    return sh


def card(slide, x, y, w, h, paras, fill='white', max_pt=22, min_pt=11, pt=None, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         radius=0.28, line=None, name='Card', margins=(0.28, 0.2, 0.28, 0.16), color=C['ink'], face='Sarabun'):
    paras = to_paras(paras)
    sh = shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=fill, line=line, radius=radius, name=name)
    iw, ih = w - margins[0] - margins[2], h - margins[1] - margins[3]
    size = pt or fit_pt(paras, iw, ih, max_pt, min_pt, face)
    need = measure(paras, size, iw, face)
    deck_log(slide, name, size, need, ih)
    fill_tf(sh.text_frame, paras, size, face, align, anchor, margins, color)
    return sh, size


_LOG = []
def deck_log(slide, name, size, need, avail):
    _LOG.append((getattr(slide, '_name_', ''), name, round(size, 1), round(need, 2), round(avail, 2), need > avail + 0.02))


def text(slide, x, y, w, h, paras, pt=20, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, color=C['ink'], face='Sarabun', name='Text', fit=False, min_pt=11):
    paras = to_paras(paras)
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tb.name = name
    size = fit_pt(paras, w, h, pt, min_pt, face) if fit else pt
    deck_log(slide, name, size, measure(paras, size, w, face), h)
    fill_tf(tb.text_frame, paras, size, face, align, anchor, (0.0, 0.0, 0.0, 0.0), color)
    return tb, size


def title(slide, label, x=0.6, y=0.38, sub=None, size=30, fill='lime', star_color='orange', max_w=9.2):
    tw = text_w(label, size, 'Sarabun', True)
    w = min(max_w, tw / 0.74 + 0.7)
    h = 0.98 if size >= 28 else 0.8
    sh = shape(slide, MSO_SHAPE.OVAL, x + 0.55, y, w, h, fill=fill, line=C['ink'], lw=0.5, name='Title sticker')
    pt = size
    while text_w(label, pt, 'Sarabun', True) > w * 0.78 and pt > 16: pt -= 1
    fill_tf(sh.text_frame, [P((label, True), align=PP_ALIGN.CENTER)], pt, 'Sarabun', PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, (0.05, 0.0, 0.05, 0.0))
    star(slide, x, y - 0.12, 1.0 if size >= 28 else 0.85)
    if sub:
        text(slide, x + 0.55 + w + 0.25, y + 0.28, 12.8 - (x + 0.55 + w + 0.25), 0.5, P(sub, color='444444'), pt=17, name='Subtitle', fit=True, min_pt=12)
    return w


# ---------------------------------------------------------------- tables
def _border(cell, color='000000', w=0.75):
    tcPr = cell._tc.get_or_add_tcPr()
    for tag in ('a:lnL', 'a:lnR', 'a:lnT', 'a:lnB'):
        for e in tcPr.findall(qn(tag)): tcPr.remove(e)
    for i, tag in enumerate(('a:lnL', 'a:lnR', 'a:lnT', 'a:lnB')):
        ln = etree.Element(qn(tag)); ln.set('w', str(int(w * 12700))); ln.set('cap', 'flat'); ln.set('cmpd', 'sng'); ln.set('algn', 'ctr')
        sf = etree.SubElement(ln, qn('a:solidFill')); c = etree.SubElement(sf, qn('a:srgbClr')); c.set('val', color)
        etree.SubElement(ln, qn('a:prstDash')).set('val', 'solid')
        tcPr.insert(i, ln)


def table(slide, x, y, col_w, rows, header=1, max_pt=18, min_pt=9, max_h=5.0, hl=None, align=None, bold_first_col=False,
          hl_fill=C['hl'], head_fill=C['grey'], body_fill='FFFFFF', name='Table', cell_m=(0.08, 0.04), spans=None, face='Sarabun'):
    """rows: list of lists of str ('\n' = line break). hl(r,c,text)->bool highlights a cell. align: list per column 'l'/'c'.
    returns (shape, pt, height_in)"""
    nr, nc = len(rows), len(col_w)
    align = align or ['c'] * nc

    def cell_paras(txt, bold):
        return [P((ln, bold), after=0) for ln in str(txt).split('\n')]

    def heights(pt):
        hs = []
        for ri, row in enumerate(rows):
            m = 0.0
            for ci, txt in enumerate(row):
                bold = ri < header or (bold_first_col and ci == 0)
                span_w = col_w[ci]
                if spans and (ri, ci) in spans: span_w = sum(col_w[ci:ci + spans[(ri, ci)]])
                hh = measure(cell_paras(txt, bold), pt, span_w - 2 * cell_m[0], face, 0)
                m = max(m, hh)
            hs.append(m + 2 * cell_m[1])
        return hs

    pt = max_pt
    while pt > min_pt and sum(heights(pt)) > max_h: pt -= 0.5
    hs = heights(pt)
    total = sum(hs)
    gs = slide.shapes.add_table(nr, nc, Inches(x), Inches(y), Inches(sum(col_w)), Inches(total))
    gs.name = name
    tbl = gs.table
    tblPr = tbl._tbl.tblPr
    for a in ('firstRow', 'bandRow', 'firstCol', 'lastRow', 'lastCol', 'bandCol'): tblPr.set(a, '0')
    sid = tblPr.find(qn('a:tableStyleId'))
    if sid is not None: sid.text = '{5940675A-B579-460E-94D1-54222C63F5DA}'  # "No Style, Table Grid"
    for ci, w in enumerate(col_w): tbl.columns[ci].width = Inches(w)
    for ri, h in enumerate(hs): tbl.rows[ri].height = Inches(h)
    skip = set()
    if spans:
        for (ri, ci), n in spans.items():
            tbl.cell(ri, ci).merge(tbl.cell(ri, ci + n - 1))
            for k in range(1, n): skip.add((ri, ci + k))
    for ri, row in enumerate(rows):
        for ci in range(nc):
            if (ri, ci) in skip: continue
            txt = row[ci] if ci < len(row) else ''
            cell = tbl.cell(ri, ci)
            isH = ri < header
            fillc = head_fill if isH else (hl_fill if (hl and hl(ri, ci, txt)) else body_fill)
            cell.fill.solid(); cell.fill.fore_color.rgb = rgb(fillc)
            _border(cell)
            cell.margin_left = cell.margin_right = Inches(cell_m[0]); cell.margin_top = cell.margin_bottom = Inches(cell_m[1])
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            al = PP_ALIGN.CENTER if (isH or align[ci] == 'c') else PP_ALIGN.LEFT
            fill_tf(cell.text_frame, cell_paras(txt, isH or (bold_first_col and ci == 0)), pt, face, al, MSO_ANCHOR.MIDDLE, (cell_m[0], cell_m[1], cell_m[0], cell_m[1]))
            # fill_tf resets margins on text_frame; cell margins live on tcPr so re-apply
            cell.margin_left = cell.margin_right = Inches(cell_m[0]); cell.margin_top = cell.margin_bottom = Inches(cell_m[1])
    deck_log(slide, name, pt, total, max_h)
    return gs, pt, total


def picture(slide, path, x, y, w, h, name='Picture', border=None):
    from PIL import Image
    im = Image.open(path)
    iw, ih = im.size
    r = min(w / iw, h / ih)
    pw, ph = iw * r, ih * r
    px, py = x + (w - pw) / 2, y + (h - ph) / 2
    pic = slide.shapes.add_picture(path, Inches(px), Inches(py), Inches(pw), Inches(ph))
    pic.name = name
    if border:
        pic.line.color.rgb = rgb(border); pic.line.width = Pt(1.5)
    return pic, (px, py, pw, ph)
