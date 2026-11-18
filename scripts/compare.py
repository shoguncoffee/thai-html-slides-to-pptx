"""Stack ORIGINAL (top) over PPTX render (bottom) for visual QA.
usage: python3 compare.py ref_dir render_prefix outdir   (render files: <prefix>-NN.png from pdftoppm -r 144)"""
import sys, glob, os
from PIL import Image
ref, pref, out = sys.argv[1:4]; os.makedirs(out, exist_ok=True)
n = len(glob.glob(os.path.join(ref, 's-*.png')))
for i in range(1, n + 1):
    a = Image.open(f'{ref}/s-{i:02d}.png').convert('RGB').resize((1280, 720))
    b = Image.open(f'{pref}-{i:02d}.png').convert('RGB').resize((1280, 720))
    w = Image.new('RGB', (1280, 1450), 'white'); w.paste(a, (0, 0)); w.paste(b, (0, 730)); w.save(f'{out}/c-{i:02d}.png')
print('wrote', n)
