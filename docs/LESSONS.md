# Lessons / gotchas (cause -> fix). Numbers = order encountered.

## Text fidelity
1. **Thai marks garbled in pptx** ("ผู้" renders as "ู้" + overlapped consonant).
   *Cause A:* in extraction, per-character `Range` rects of Thai combining marks (U+0E31, U+0E33-0E3A, U+0E47-0E4E)
   have different top/left -> my line splitter cut them into separate fragments that then sorted out of order.
   *Fix:* append those chars to the current fragment without touching geometry (ำ U+0E33 may extend `right`).
   *Cause B:* `charSpacing` (`spc`) on Thai runs displaces marks in LibreOffice. *Fix:* never set charSpacing on runs
   containing Thai (`/[฀-๿]/`); Sarabun's 0.02em is negligible (text ends up ~2% narrower).
2. **Wide-tracked Latin labels** (letter-spacing > ~0.3px, e.g. "CHULALONGKORN UNIVERSITY") *do* need `charSpacing`
   (px*0.5 pt) or they look too narrow. Add ~60px box-width slack and use `wrap:true` for them.
3. **LibreOffice clips translucent text that has tracking** ("OUTLINE" cut to "OUTLI"): alpha text + `spc` is
   rendered into a bitmap sized without the spacing. *Fix:* bake alpha into the colour by blending with the background
   pixel sampled from `bg-NN.png`. (Plain alpha text without tracking is fine and stays native.)
4. **Lost spaces between runs** ("middleลดลง"): whitespace at DOM-node boundaries has zero-width rect and is
   skipped. *Fix:* when joining fragments in a line, if gap > 0.15*fontSize and neither side has whitespace, insert ' '.
5. Line breaks are copied from Chromium (explicit breaks, `wrap:none`) so wrapping is identical in every viewer.
   For multi-fragment lines with big gaps (table cells, flex rows) each segment becomes its own text box.
6. `text-transform:uppercase` is not in the DOM text -> apply `.toUpperCase()`; compare parity with the same rule.
7. Rotated text (e.g. speech-bubble -5deg): per-char rects fragment; merge the node, compute unrotated width
   `(R-L)/cos(theta)`, set `rotate` (negative -> 360+angle).

## Geometry
8. Scale: 1920px = 13.333in (LAYOUT_WIDE) -> **1px = 1/144 in = 0.5 pt**. Font px*0.5 -> pt. Line spacing exact pt too.
9. **Vertical offset model** (measured by cross-correlating row ink profiles of ref vs LibreOffice render over ~1,400 boxes):
   `dy = -0.495*lineHeight + 0.549*fontSize + 2.1` px added to the CSS line-box top (`y = firstLine.cy - L/2`).
   Theory: LO/PPT with exact spacing put the baseline (L-(A+D))/2 lower than Chrome (A+D ~ 1.1em). A constant offset
   (-8) is wrong for big numerals (off by up to 45px at 260px font) - use the formula. `calibrate_y.py` re-fits it.
10. Large numerals/outline text: **keep them in the background image** (see 12) instead of text boxes.

## Background image (text-free screenshot)
11. Hide text with `section.on *{color:transparent!important;-webkit-text-fill-color:transparent!important;
    text-shadow:none!important;text-decoration-color:transparent!important;-webkit-text-stroke-color:transparent!important}`.
12. **Outline-only text** (`-webkit-text-stroke` with transparent fill): LibreOffice draws it filled. Mark element
    `data-keep` during extraction, skip it in text extraction, exclude it (and descendants) from the hide rule.
    Same for `writing-mode: vertical-*` text (can't be reproduced reliably) -> `data-keep` + freeze its colour inline.
13. **`currentColor` paints vanish** when `color` is transparent: bullet dots drawn as `background:currentColor`,
    borders, outlines, box-shadow, SVG fill/stroke. *Fix:* before hiding, freeze computed values inline
    (`background-color`, `border-*-color`, `outline-color`, `box-shadow`, svg `fill`/`stroke`) with `!important`.
14. **Pseudo-elements** (`::before/::after` text) and **list `::marker`** inherit the transparent colour: record
    their computed colour in extraction (tag element `data-pq`) and re-inject `[data-pq="n"]::before{color:..!important}`.
15. Force all steps visible: `[data-step].pending{opacity:1!important;transform:none!important;visibility:visible!important}`;
    `reducedMotion:'reduce'` + ~1.6 s wait so count-up numbers reach their final value; hide the nav bar `.bar`.
16. Image size: 2x PNG = ~2.5 MB/slide (170 MB deck!). Backgrounds are smooth -> **JPEG q92, 4:4:4 via sharp = ~150 KB**.

## Fonts / packaging
17. Fonts cannot be embedded -> ship TTFs. Windows family names of static Google fonts: `Sarabun`, `Sarabun Medium`,
    `Sarabun SemiBold`, (bold = `Sarabun` + b), `Kodchasan Medium`, `Kodchasan SemiBold`, `Kodchasan` (+bold).
    `pres.theme = {headFontFace:'Kodchasan', bodyFontFace:'Sarabun'}` so newly typed text matches.
18. `pptxgenjs` was not resolvable globally in the sandbox -> `npm i pptxgenjs sharp` in the work dir.
19. pptxgenjs: text boxes need `isTextBox:true`, `margin:0`, `fit:'none'`, `valign:'top'`; hex colours without `#`;
    `transparency` is 0-100; `slide.background={data:'image/jpeg;base64,...'}` keeps the image un-selectable.
20. Output zip contains folder entries which break some cloud services: `zip -dq deck.pptx '*/'`.
21. In the Claude sandbox use the skill's `soffice.py` wrapper (bare `soffice` hangs). LibreOffice->PDF of 67 slides ~30 s.
22. Both `pdftoppm` and `pdftocairo` showed identical glyph issues -> if marks look wrong it is the PPTX content, not the rasterizer.
    A plain-text test pptx (`ttest.js` idea: same string in several fonts) quickly separates font problems from your pipeline.

## Canva import (and other non-LibreOffice renderers) - learned the hard way
23. **A pptx tuned only against LibreOffice looked wrong in Canva.** Do not trust LO alone: export the imported deck
    from Canva as PDF and measure it (`scripts/fit_offset_from_pdf.py`; `pdffonts x.pdf` shows which fonts it really used).
24. **Canva only knows some family names.** Embedded fonts in its PDF were Sarabun-Regular/Bold and
    Kodchasan-Regular/Medium/Bold. `Sarabun Medium`, `Sarabun SemiBold`, `Kodchasan SemiBold` are NOT recognised and
    silently fall back to Regular (titles looked too light). *Fix (default `FONT_MODE=canva`):* Sarabun <600 Regular,
    >=600 Bold; Kodchasan 500 -> `Kodchasan Medium`, >=600 -> `Kodchasan` bold (`KOD600=medium` for lighter).
    `FONT_MODE=static` keeps the exact static names for PowerPoint/LO with the full families installed.
25. **Exact line spacing (`spcPts`) is interpreted differently by each app.** Fitted on 1,466 single-line boxes:
    LibreOffice puts the baseline at ~`top + L - 0.13em` (extra leading above), Canva at ~`top + ascent` regardless of L
    (extra leading below), Chrome in the middle. The LO-fitted correction (`-0.495L+0.549s+2.1`) therefore moved text
    the wrong way in Canva: giant numeral "34" sank ~65px into the paragraph below, pill labels/circle digits sat high.
    *Fix (default `LINE_MODE=line`):* one **single-spacing text box per rendered line**, box top = Chrome's glyph-box
    top (+0.055em +1.75px, fitted on both Canva and LO). Without `lnSpc` all apps put the first baseline at top+ascent,
    so placement agrees everywhere. `LINE_MODE=para` keeps paragraph boxes (editable reflow) but is renderer-dependent.
26. Sarabun/Kodchasan metrics (hhea=typo, USE_TYPO_METRICS): Sarabun A=1.068 D=0.232, Kodchasan A=1.024 D=0.276 (A+D=1.3);
    win metrics are much larger (1.286/0.567) - an app using win metrics would place text ~0.2em too low.
    PowerPoint desktop was never tested - if someone has it, run the PDF-export measurement there.

## Known remaining differences
* Text ~1-3% narrower (no Thai letter-spacing). Subscript "₂" slightly different size/weight.
* Not converted: animations/step builds, count-up, slide transitions, speaker notes (add notes in build.js if needed).
* QA was via LibreOffice only; PowerPoint may shift text a few px vertically (formula was fitted to LO).
