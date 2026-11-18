# thai-html-slides-to-pptx

Notes + working scripts for converting a **fixed-canvas HTML slide deck** (1920×1080, one `<section>` per slide,
`.on` = active slide, `#slide-N` hash navigation) into a **.pptx** that looks the same and keeps **text editable**.

Built while converting a 67-slide Thai physiotherapy case deck (Sarabun + Kodchasan fonts). The first conversion took
a long session; this repo exists so the next one takes minutes. **Read `docs/FAST_PATH.md` first, then `docs/LESSONS.md`.**

> Contains no patient data or deck content - only tooling and notes. Keep it that way.

## Approach (native shapes + native text + a few pictures)
Per slide (`extract.js` -> `frags.json`, `build.js` -> pptx):
1. **Background PNG** - only the slide's own background colour (all nativised paint and text made transparent).
2. **Native shapes** - every element with a background/border becomes a rect / rounded rect / pill / ellipse / polygon / freeform
   in DOM order (so cards, chips, dots, bars, dividers, chevrons stay editable in PowerPoint/Canva).
3. **Pictures** - mascots, decorations, icons/svg, `<img>`, outline letters: separate transparent PNGs (move/delete freely).
4. **Native text boxes** - every text node measured in Chromium (per-character `Range` rects), one single-spacing box per
   rendered line at the exact pixel position (`LINE_MODE=line`), Canva-safe font names (see LESSONS 23-27).

`NATIVE=0 node build.js ...` is NOT a valid fallback (the background no longer contains the shapes); use `scripts` from tag v12
history if you want the old background-baked look.

## Layout of this repo
| path | purpose |
|---|---|
| `scripts/extract.js` | Playwright: per-slide `bg-NN.png` (2x) + `frags.json` (text geometry/styles) |
| `scripts/build.js` | pptxgenjs: `frags.json` + backgrounds -> `.pptx` (+ `boxes.json` for calibration) |
| `scripts/run.sh` | build -> LibreOffice PDF -> PNG pages (QA render) |
| `scripts/render_ref.js` | render the original HTML slides to PNG (ground truth for compare) |
| `scripts/compare.py` | stack original (top) over pptx render (bottom) for visual QA / subagents |
| `scripts/score_blur.py` | blurred diff (ignores text antialiasing) + count of strongly different pixels per slide |
| `scripts/applypatch.js` | apply `{slide,find,replace}` / `{slide,remove}` JSON patches to the deck HTML (content updates) |
| `scripts/score.py` | mean abs pixel diff per slide (quick numeric regression) |
| `scripts/check_text_parity.py` | every character in HTML text exists in the pptx |
| `scripts/casual_skin.js` | v10 design pass (flat bg, cream title stickers, auto-placed decorations with reserved free zones) |
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
