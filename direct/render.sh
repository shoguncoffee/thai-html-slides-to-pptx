#!/bin/bash
SK=/root/.claude/skills/synced/15355cc7-8b9d-48b2-98c6-d4effbcae5f6_f29711a7-6256-4f3e-9e31-b0a2c93d9744/pptx
N=${1:-deck}
rm -rf r_$N && mkdir r_$N
python3 $SK/scripts/office/soffice.py --headless --convert-to pdf --outdir r_$N $N.pptx >/dev/null 2>&1
pdftoppm -png -r 72 r_$N/$N.pdf r_$N/p
ls r_$N | wc -l
