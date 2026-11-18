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

27. **Canva round 2 (measured from its PDF export): placement error ~0 px at every font size** after LINE_MODE=line, fonts
    resolved to Sarabun/Kodchasan Regular/Medium/Bold. Remaining defects found by eye and fixed:
    * Canva ignores `wrap:none`; Bold is wider than the SemiBold original, so a title wrapped ("LPM" fell onto line 2 and
      overlapped the subtitle). *Fix:* box width slack = max(60px, 30%) on every box (+60 for tracked labels).
    * Kodchasan 600 at >=40px rendered as Bold = too heavy -> use `Kodchasan Medium` for big titles (`KOD_BIG=bold` to undo);
      Sarabun 600 at >=40px (abbreviation tokens inside titles) -> Regular so the line has one visual weight.
    * Canva falls back to FreeMono / NotoSansCJK for glyphs missing in Sarabun (check marks, arrows) - same as the browser.

## Separable graphics, speed (added with the v10 'casual' redesign)
28. **Mascots/decorations must be separate pictures** if the user wants to move/delete them in Canva. `extract.js` tags
    `svg[aria-label]` (mascot) and `[data-deco]` (decorations) with `data-cap`, hides them for the background shot, then
    screenshots each one alone (`html body section.on *{visibility:hidden}` + visible override with HIGHER specificity,
    ancestors' backgrounds cleared, `omitBackground:true`) -> `el-NN-i.png`; `build.js` places them as pictures behind the text.
29. **`z-index:-1` decorations vanished behind the slide's own background** in the HTML (section was positioned, z-index:auto,
    so negative z-index children painted below its background). Fix: `section{isolation:isolate}`. The QA subagents caught this
    only because the pptx (rendered from separate PNGs) showed shapes that the HTML did not.
30. Decoration collision check must treat thin bars (height>3px) and full-width footer bars as content; keep >=48px from text.
31. **Speed:** the user complained the conversion/QA was slow. Run QA as 6 subagents x ~11 slides in ONE message (not 3 x 22),
    keep their reports under 250 words, and re-render only after all fixes are batched. Extraction (70 s) + LibreOffice (40 s)
    are the fixed costs.

32. **Font-size bump with auto-fit (casual_skin.js step 7):** body +2px, small labels +3px, headings/numerals unchanged;
    per slide it tries +2, +2 with tighter spacing, +1, +1 tight, 0 and keeps the largest size whose layout check
    (off-slide text, text outside its card, text-on-text overlap, anything below y=1040) is no worse than before.
    Text inside `clip-path` shapes (chevrons) is never enlarged - they have no measurable card and clip at the tip.

## Native shapes (v13): cards/pills/dots/bars are real pptx shapes, not baked into the background
33. User wanted to edit cards in Canva, so `extract.js` now walks the DOM in paint order (`layerFn`) and emits **layers**:
    * `shape` - any element with `background-color` and/or borders: `rect` / `roundRect` (uniform radius; pill/ellipse when
      radius >= half the side) / `custGeom` (mixed radii via cubic corners, `clip-path: polygon()` incl. `calc(100% - Npx)`).
      Uniform border -> same shape's outline inset by bw/2 (CSS border is inside the box, OOXML line is centred).
      One/two borders -> thin rect (solid) or dashed `line` per side. CSS border-triangle (one coloured side, neighbours
      transparent) -> triangle polygon. rgba/opacity -> fill transparency.
    * `pic` - things that cannot be native, each screenshotted alone (transparent PNG): mascots, `[data-deco]`, other `<svg>`,
      `<img>`, and **`data-keep` outline/vertical text**.
    Native paint is hidden for the background shot by setting INLINE `background-color/border-*-color: transparent !important`
    (inline !important beats a stylesheet !important - the earlier 'freeze currentColor' step had set inline values).
34. **Z-order trap:** everything left in the background image is covered by ANY native shape drawn later. First attempt lost the
    big outline letters (A, P, S, O) because they stayed in the background under the new white cards. Rule: nothing may stay
    in the background if it paints above a nativised element -> make it a `pic` layer, in DOM order with the shapes.
    Background image now = slide background colour only (plus rotated/transformed leftovers, none in this deck).
35. Build order per slide: deco pictures, then layers in DOM order, then text boxes. Result on a 70-slide deck: ~780 AUTO_SHAPE,
    34 FREEFORM (polygons), 73 pictures, ~1760 text boxes; blurred diff vs HTML stays ~2/255 (`scripts/score_blur.py`).
36. `survey` tip: before writing a converter, histogram computed-style features over all slides (bg colour, border sides,
    radius, clip-path, shadow, gradient, pseudo-elements, transform). This deck had no gradients, shadows or pseudo-elements,
    which is why a pure-shape conversion was feasible.

## Content-update pipeline (new source document supersedes the old one)
37. Diff old docx vs new docx text (`diff.txt`), list conflicts + removed facts + new sections, split by slide range into
    ~6 subagents that each return JSON patches `{slide, find, replace}` / `{slide, remove}` (substring edits on exact text
    nodes). `scripts/applypatch.js` applies them to the pre-skin HTML; structural edits (new slides cloned from similar ones,
    renumbering, label changes) go in a small `structural.js`. Then re-run the skin (`casual_skin.js`) so the fit loop re-fits
    font sizes, render all slides, run `audit.js` (off-slide / escape / bottom checks), look at the worst slides yourself.
    Gotchas fixed after QA: (a) `||1e9` in the CSS radius-overlap scale factor zeroed every mixed radius (use sum>0 ? len/sum : 1);
    (b) a square card inside an `overflow:hidden` rounded ancestor inherits the ancestor's corner radius where corners coincide;
    a painted child sticking OUT of a clipping ancestor becomes a `piece` picture (screenshot is clipped by the browser);
    (c) paint order is not just DOM order: elements with `clip-path`/transform/opacity/position+z-index form stacking contexts
    and paint above normal-flow siblings - layers are sorted by (z-index, stacking-context?, DOM index); a chevron label with
    `clip-path` over a card with negative margin vanished until this was done.
38. If new content does not fit even at +0 font, shorten the text (merge bullets) - the fit loop cannot invent space.

## Known remaining differences
* Text ~1-3% narrower (no Thai letter-spacing). Subscript "₂" slightly different size/weight.
* Native shapes: opacity of overlapping translucent shapes is per-shape (CSS group opacity differs slightly); box-shadows/gradients
  would still need `pic` layers (none in this deck).
* Not converted: animations/step builds, count-up, slide transitions, speaker notes (add notes in build.js if needed).
* QA was via LibreOffice only; PowerPoint may shift text a few px vertically (formula was fitted to LO).
