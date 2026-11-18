# Fast path (target: < 15 min wall-clock, mostly waiting)

```bash
# 0. one-time per container
npm i pptxgenjs sharp playwright          # pptxgenjs is NOT globally resolvable by default; install in the work dir
bash scripts/setup_fonts.sh               # Sarabun + Kodchasan TTFs -> ~/.fonts (needed for faithful QA renders)

# 1. extract (67 slides ~70 s with 4 parallel pages)
node scripts/extract.js deck.html out            # optional 3rd arg: "5,26,34" to test a few slides
node scripts/render_ref.js deck.html ref         # ground truth PNGs (can run in parallel with step 1)

# 2. build + render (~40 s: LibreOffice is the slow part)
export SOFFICE="python3 <pptx-skill>/scripts/office/soffice.py"   # sandbox wrapper
DY=0 ./scripts/run.sh final
python3 scripts/score.py final 1,2,3,...         # numeric sanity, mean ~3.4 expected
python3 scripts/check_text_parity.py out/frags.json final.pptx

# 3. QA
python3 scripts/compare.py ref final-pg cmp      # c-NN.png = original over pptx
#   -> spawn 3 subagents x ~22 slides with docs/QA_PROMPT.md (they only Read images; ~30 s each)

# 4. package
cp final.pptx deck.pptx && zip -dq deck.pptx '*/'   # remove folder entries (cloud services choke on them)
python3 <pptx-skill>/scripts/office/validate.py deck.pptx
```
Ship the pptx **together with the font files** - fonts cannot be embedded in pptx by pptxgenjs.

## Target app matters
* Canva import: default settings (`FONT_MODE=canva`, `LINE_MODE=line`). After import, export the deck as PDF and run
  `scripts/fit_offset_from_pdf.py` if text still looks shifted.
* PowerPoint with Sarabun/Kodchasan installed: `FONT_MODE=static` gives exact weights; verify placement (untested).

## Time sinks last time (avoid)
* Trying `charSpacing` on Thai text, then debugging garbled marks (see LESSONS #1) - it is already handled.
* Calibrating vertical offset by trial (-5/-8/-11/...) - the fitted formula is already in `yAdj()` in build.js.
* Re-running all 67 slides after every tweak: use the 3rd arg of extract.js and `score.py` with a subset.
* Downloading fonts with a broken `tr -d 'url()'` pipeline (deletes the letters u,r,l from the URL).
* Forgetting that the HTML itself may need re-running its own build chain after edits - convert only a FINAL html.
