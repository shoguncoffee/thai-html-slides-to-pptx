"""Every non-space character extracted from HTML must exist in the pptx (per slide).
usage: python3 check_text_parity.py out/frags.json deck.pptx"""
import sys, json, re
from collections import Counter
from pptx import Presentation
fr = json.load(open(sys.argv[1])); P = Presentation(sys.argv[2]); bad = []
n = lambda x: Counter(re.sub(r'\s', '', x))
for i, s in enumerate(P.slides, 1):
    t = ''.join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame)
    h = ''.join((f['text'].upper() if f['style']['upper'] else f['text']) for f in fr[str(i)]['frags'])
    if n(t) != n(h): bad.append(i)
print('slides', len(P.slides), 'mismatches', bad)
