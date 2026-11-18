# direct/ - build the deck straight to .pptx (no HTML step)

`python3 build_deck.py record.docx out.pptx` reads the Word record with python-docx and writes native slides with python-pptx:
rounded cards (text lives inside the shape), real tables, title stickers, a few pictures. Text is *pasted from the docx* programmatically.

* `pptlib.py` - theme, PIL-based text measuring (`measure`, `fit_pt`), `card`, `table`, `panel`, `group` (sibling cards share one font size, `tight=True` shrinks to content).
* `build_deck.py` - slide list; adapt paragraph/table indexes to your docx (`python-docx` index dump helps).
* `coverage.py` - reports docx text that never reached the deck (headings/identifiers only is the expected result).
* `render.sh` - LibreOffice -> PDF -> PNG for a quick look. Needs the Sarabun/Kodchasan TTFs next to `pptlib.py` (see `scripts/setup_fonts.sh`).

Lessons: set latin+ea+cs font on every run (Thai uses the complex-script slot); use exact line spacing (1.38x) so Canva/PowerPoint/LibreOffice agree;
table row height init must be 0 not 1 (cost me an hour); a long Latin token wider than the card breaks mid-word, so `fit_pt` also checks the longest unbreakable token.
Never put names/HN/AN on slides; crop identifiers out of CXR/CT screenshots.
