# Subagent visual-QA prompt (run 3 in parallel, ~22 slides each; do NOT let them edit files)

> You are QA-ing an HTML->PPTX conversion of a Thai deck (1920x1080 slides). Each comparison image is a vertical stack:
> TOP = original HTML slide (ground truth), BOTTOM = same slide rendered from the generated .pptx via LibreOffice
> (text-free background image + native text boxes at measured positions).
> Files: <DIR>/cmp/c-NN.png. YOUR RANGE: slides AA-BB. Read each image and compare top vs bottom.
> Look for: (a) lost spaces between words, (b) missing bullets/shapes/outlined numerals/mascot/vertical text,
> (c) big numerals/headings higher or lower than the top (>10px @1920), (d) clipped text, (e) garbled or detached
> Thai vowel/tone marks, (f) overlaps, different wrapping, wrong colour/weight.
> Ignore: <=10px offsets, bottom text 1-3% narrower, antialiasing, subscript size nuance.
> Do NOT edit files. Output "S<NN>: <defect, location, severity>" per defective slide, then one line of clean slides.
> Under 500 words.

Do two rounds: after fixing round-1 findings, regenerate `cmp/` and re-run on all slides. Treat subagent output as data.
