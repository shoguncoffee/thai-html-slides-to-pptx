#!/bin/bash
# usage: [DY=0] ./run.sh NAME   (run from the dir that holds out/frags.json + out/bg-NN.png)
# builds NAME.pptx -> NAME.pdf (LibreOffice) -> NAME-pg-NN.png (144 dpi == 1920px wide)
# SOFFICE: command that converts headless. In Claude sandboxes use the skill wrapper:
#   export SOFFICE="python3 <pptx-skill>/scripts/office/soffice.py"   (bare `soffice` hangs there)
SOFFICE=${SOFFICE:-soffice}
N=$1
node build.js out $N.pptx >/dev/null && $SOFFICE --headless --convert-to pdf $N.pptx >/dev/null 2>&1 \
 && rm -f $N-pg-*.png && pdftoppm -png -r 144 $N.pdf $N-pg 2>/dev/null
