"""Re-fit the vertical offset model (build.js yAdj) if the renderer/fonts change.
Needs: out/boxes.json (written by build.js), ref/s-NN.png, <name>-pg-NN.png. Build with DY=0 first.
Fits  dy = a*lineHeight + b*fontSize + c  (px). Current fit: a=-0.495 b=0.549 c=2.1 (LibreOffice, Sarabun/Kodchasan)."""
import json, sys, numpy as np
from PIL import Image
name = sys.argv[1]; boxes = json.load(open('out/boxes.json')); R = []
for n, bs in boxes.items():
    a = np.asarray(Image.open(f'ref/s-{int(n):02d}.png').convert('L').resize((1920, 1080)), dtype=float)
    r = np.asarray(Image.open(f'{name}-pg-{int(n):02d}.png').convert('L').resize((1920, 1080)), dtype=float)
    for b in bs:
        if b['lines'] != 1: continue
        x0, x1 = int(max(0, b['x'] - 2)), int(min(1920, b['x'] + b['w'] + 2)); y0, y1 = int(max(0, b['y'] - 10)), int(min(1080, b['y'] + b['h'] + 10))
        if x1 - x0 < 20 or y1 - y0 < 10: continue
        pa, pr = a[y0:y1, x0:x1], r[y0:y1, x0:x1]
        ia, ir = np.abs(pa - np.median(pa)).sum(1), np.abs(pr - np.median(pr)).sum(1)
        if ia.sum() < 2000 or ir.sum() < 2000: continue
        best = None
        for s in range(-45, 46):
            u, v = (ia[s:], ir[:len(ir) - s] if s > 0 else ir) if s >= 0 else (ia[:s], ir[-s:])
            m = min(len(u), len(v)); c = np.dot(u[:m], v[:m]) / (np.linalg.norm(u[:m]) * np.linalg.norm(v[:m]) + 1e-9)
            if best is None or c > best[0]: best = (c, s)
        if best[0] > 0.5: R.append((b['size'], b['lh'], best[1]))   # shift>0 => render too high
A = np.array([[lh, sz, 1] for sz, lh, s in R]); y = np.array([s for *_, s in R], dtype=float)  # current DY=0 so needed dy = s
w = np.ones(len(y))
for _ in range(5):
    coef = np.linalg.lstsq(A * w[:, None], y * w, rcond=None)[0]; w = 1 / (1 + (np.abs(A @ coef - y) / 3) ** 2)
print('a(lineHeight), b(fontSize), c =', coef)
