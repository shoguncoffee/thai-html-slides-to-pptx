#!/bin/bash
# Install Sarabun + Kodchasan (static TTF from Google Fonts) so LibreOffice/Chromium QA renders match.
# NOTE: do NOT use `tr -d 'url()'` to strip the css url() wrapper - it deletes the letters u/r/l inside the URL.
set -e; mkdir -p fonts ~/.fonts; cd fonts
for fam in "Kodchasan:wght@500;600;700" "Sarabun:ital,wght@0,400;0,500;0,600;0,700;1,400"; do
  curl -sS -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=$fam" -o css.txt   # old UA => TTF urls
  python3 - <<'PY'
import re, subprocess
t = open('css.txt').read()
for blk in re.findall(r'@font-face\s*{[^}]*}', t):
    fam = re.search(r"font-family: '([^']+)'", blk).group(1); st = re.search(r'font-style: (\w+)', blk).group(1)
    w = re.search(r'font-weight: (\d+)', blk).group(1); u = re.search(r'url\(([^)]+)\)', blk).group(1)
    subprocess.run(['curl', '-sS', '-f', u, '-o', f'{fam}-{w}-{st}.ttf'], check=True)
PY
done
cp *.ttf ~/.fonts/ && fc-cache -f && fc-list | grep -ci "sarabun\|kodchasan"
