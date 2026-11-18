# thai-html-slides-to-pptx

Notes + working scripts for converting a **fixed-canvas HTML slide deck** (1920×1080, one `<section>` per slide,
`.on` = active slide, `#slide-N` hash navigation) into a **.pptx** that looks the same and keeps **text editable**.

Built while converting a 67-slide Thai physiotherapy case deck (Sarabun + Kodchasan fonts). The first conversion took
a long session; this repo exists so the next one takes minutes. **Read `docs/FAST_PATH.md` first, then `docs/LESSONS.md`.**

> Contains no patient data or deck content - only tooling and notes. Keep it that way.

## Approach (hybrid)
Per slide:
1. **Background PNG** - screenshot of the slide with all text made transparent (shapes, gradients, SVG mascots,
   bullets, outline numerals, vertical text stay in the image).
2. **Native text boxes** - every text node is measured in Chromium (per-character `Range` rects), grouped into
   lines/paragraphs/runs and re-created at the exact pixel position with the same font/size/colour/weight.
   `wrap:none`, one single-spacing box per rendered line (default `LINE_MODE=line`) so wrapping and vertical placement
   do not depend on the app's line-spacing rules (see LESSONS 23-26: Canva vs LibreOffice differ).

Why not fully native shapes? Cards/gradients/SVG/shadows/clip-paths do not map 1:1 to OOXML; the hybrid gave
near-pixel fidelity and editable text. Trade-off: shapes are not individually editable.

## Layout of this repo
| path | purpose |
|---|---|
| `scripts/extract.js` | Playwright: per-slide `bg-NN.png` (2x) + `frags.json` (text geometry/styles) |
| `scripts/build.js` | pptxgenjs: `frags.json` + backgrounds -> `.pptx` (+ `boxes.json` for calibration) |
| `scripts/run.sh` | build -> LibreOffice PDF -> PNG pages (QA render) |
| `scripts/render_ref.js` | render the original HTML slides to PNG (ground truth for compare) |
| `scripts/compare.py` | stack original (top) over pptx render (bottom) for visual QA / subagents |
| `scripts/score.py` | mean abs pixel diff per slide (quick numeric regression) |
| `scripts/check_text_parity.py` | every character in HTML text exists in the pptx |
| `scripts/fit_offset_from_pdf.py` | measure text placement of any renderer (Canva/PowerPoint PDF export) vs the HTML |
| `scripts/calibrate_y.py` | re-fit the vertical-offset model if fonts/renderer change |
| `scripts/setup_fonts.sh` | install Sarabun + Kodchasan locally for faithful QA renders |
| `docs/FAST_PATH.md` | the minimal command sequence + time budget |
| `docs/LESSONS.md` | every gotcha hit, with cause and fix |
| `docs/QA_PROMPT.md` | ready-to-paste subagent prompt for the visual comparison |

## Result achieved (reference numbers)
67 slides, ~4,100 text boxes, file ~14 MB (JPEG q92 backgrounds at 2x), validator pass, text parity 0 mismatches,
mean pixel diff ~3.4/255 vs the HTML render, 2 rounds of 3-subagent visual QA -> clean.

## Adapting to another deck
`extract.js` assumes: `section` elements, active one has class `.on`, navigable with `#slide-N`, optional step
reveals via `[data-step].pending`, a nav bar `.bar` to hide, fonts Sarabun/Kodchasan (see `fontFor()` in build.js).
Change those selectors/font names first.
