"""Measure how ANY renderer (Canva export, PowerPoint export, Keynote...) places text vs the HTML original.
Workflow: export the imported deck as PDF from that app -> render pages to 1920x1080 PNGs ->
    pdftoppm -png -scale-to-x 1920 -scale-to-y 1080 their.pdf pdfpng/pg
python3 fit_offset_from_pdf.py ref_dir pdfpng out/boxes.json
Prints median vertical error per font-size bucket (positive = their text is too HIGH) from SINGLE-LINE boxes.
Use it to tune yAdj() in build.js (line mode: dy = 0.055*size + 1.75 was fitted to Canva and LibreOffice)."""
import sys, json, numpy as np, collections
from PIL import Image
ref, png, boxes_json = sys.argv[1:4]
boxes = json.load(open(boxes_json)); g = collections.defaultdict(list)
for n, bs in boxes.items():
    a = np.asarray(Image.open(f'{ref}/s-{int(n):02d}.png').convert('L').resize((1920, 1080)), dtype=float)
    r = np.asarray(Image.open(f'{png}/pg-{int(n):02d}.png').convert('L').resize((1920, 1080)), dtype=float)
    for b in bs:
        x0, x1 = int(max(0, b['x'] - 2)), int(min(1920, b['x'] + b['w'] + 2)); y0, y1 = int(max(0, b['y'] - 12)), int(min(1080, b['y'] + b['h'] + 12))
        if x1 - x0 < 20 or y1 - y0 < 10: continue
        pa, pr = a[y0:y1, x0:x1], r[y0:y1, x0:x1]
        ia, ir = np.abs(pa - np.median(pa)).sum(1), np.abs(pr - np.median(pr)).sum(1)
        if ia.sum() < 2000 or ir.sum() < 2000: continue
        best = None
        for s in range(-60, 61):
            u, v = (ia[s:], ir[:len(ir) - s] if s > 0 else ir) if s >= 0 else (ia[:s], ir[-s:])
            m = min(len(u), len(v)); c = np.dot(u[:m], v[:m]) / (np.linalg.norm(u[:m]) * np.linalg.norm(v[:m]) + 1e-9)
            if best is None or c > best[0]: best = (c, s)
        if best[0] > 0.5: g[round(b['size'] / 8) * 8].append(best[1])
for k in sorted(g): print('font px ~', k, 'n', len(g[k]), 'median error px', float(np.median(g[k])))
