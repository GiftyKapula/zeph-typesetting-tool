# ZEPH Typesetting House Style — the authoritative guide

This is the **gospel** for typesetting every book with the engine. It is derived
strictly from how we actually typeset the reference books (English, Physics,
Biology). The **English Form 4 Learner's Book is the reference standard**: when in
doubt, match English. New books should need only a few per-book revisions because
everything below is handled by the shared engine.

See also: `TYPESETTING.md` (themes table + variants), `SERIES-GUIDELINES.md`
(ZEPH B5 front-matter detail), `LOCAL-LANGUAGE-GLOSSARY.md` (label translations).

---

## 1. One engine, per-book theme

`node src/typeset/typeset-docx.js "<book>.docx"` typesets one book. The theme is
auto-picked from the file name (`autoTheme` in `themes.js`); override with
`--theme <name>`. A theme sets colours, fonts, and a **variant** (the layout).

Build a ZEPH house-style theme with the `zeph({...})` factory in `themes.js`
(English/Physics/Biology family): pass a subject, a palette, and a variant; box
colours are derived from the palette automatically.

## 2. Variants — pick by content, not by subject

| Variant | Boxes? | Use for |
|---|---|---|
| `series` | flat (activities → headings) **but table-wrapped boxes are kept** | English; **all local-language books**; prose-heavy subjects |
| `science` | boxed (Learning Activities / Exercises in coloured boxes) | activity-heavy subjects (Physics, Biology, Maths, Computer Science, Grade 6 Science) |
| `classic` / `modern` / `literary` / `panel` | boxed, distinct identities | older standalone books (PE, Tech, earlier Lunda/Cinyanja) |

**Local languages follow English (`series`).** `series` gives the English flat
house style *and still renders a box for any activity/exercise the manuscript
puts in a table* — so we never force-flatten a real box, and never force a box
where the writer used flowing text.

## 3. ZEPH house style (shared by `series` + `science`)

- **B5** (176×250 mm); margins top 19 / bottom 16 / x 17 mm.
- **Fonts:** body + interior headings **Arial**; cover/title-page **Segoe UI**;
  running header **Times New Roman** italic. (Body text is **12 pt**.)
- **Front matter order:** cover → repeated title page → copyright/imprint → TOC →
  Authors → Foreword → Preface → Acknowledgement → Introduction → (Key
  Competences / Acronyms) → body.
- **Numbering:** silent roman from the title page, visible from ~Authors;
  arabic restarts at the first TOPIC/UNIT. Footer tilde `~ n ~`.
- **Cover by grade:** same grade = same cover **layout**, differing only by the
  theme's signature colour (centred masthead: eyebrow → big subject → accent rule
  → FORM tag → book type → hero photo → AUTHORS → logo).
- **Signatory** name is **bold**; title/org normal, kept as one tight block with
  ~16 mm signature space above.

## 4. Conventions baked into the engine (don't re-solve these)

- **Boxes are breakable** by default (long ones flow across pages); a box title is
  **sticky** so it never sits alone at the foot of a page.
- **A TOPIC always opens a new page; a SUB-TOPIC does not.** A sub-topic follows its
  topic's introduction on the same page when that introduction is short, and takes a
  fresh page only when there is no room left — which is what ordinary flow does once
  the heading is sticky. Never decide this by reading `here().position().y`: measuring
  how far down the page the layout has reached and breaking on the answer is circular,
  Typst stops converging, and the damage shows up as wrong page numbers in the footer
  rather than as a bad break. A syllabus is unaffected — its YEAR banners still open
  their own page.
- **Every heading is sticky, and the sticky belongs on the outermost block.** A heading
  wrapped in `layout(…)` or in the reservation block that guards against a heading with
  only a line or two beneath it hides its own stickiness from the flow: the flow sees
  the wrapper, so the heading can still end a page alone.
- **A numbered list reserves the same marker column for all of its items**, wide enough
  for two digits, so "1." and "10." start their text at the same place and a long list
  keeps a clean left edge. Bullets keep their own narrow column.
- **Question numbering** (exercises/assessments): top items renumber 1..N (always
  start at 1); sub-parts a/b/c reset under each parent; literal "(a)" the writer
  typed is honoured and nests; a bare number above its figure is moved above it.
- **Tables**: text at body size (12 pt; ≥5-col tables step to 10 pt). A figure
  caption "Fig N:" / "Figure N:" attaches to its image.
- **Illustrations** are kept large for accessibility (small source diagrams are
  scaled up; CDC flags tiny pictures).
- **Acronyms** render "ABBR: full" (colon), preserving the writer's bold capitals.
- **Lists** keep the writer's real markers (a/b/c, 1/2/3, i/ii), not forced bullets.
- Stray artifacts (lone punctuation / single letters) are dropped.
- **The imprint page is centred throughout** — the copyright statement, every credit
  label (ISBN, Edited by, Illustrated by, Cover and Book Layout, First Published by,
  Printed by) and every name under one. A label is bold with a gap above it however
  the manuscript styled it, including where the weight came from a Word Heading
  style; a label the manuscript styled as a Heading does **not** end the imprint, and
  a next label typed onto the tail of the ISBN's dotted placeholder is given its own
  line. The **Cover and Book Layout** credit is always ours: whoever the manuscript
  named there is replaced, whether on the label's own line or the line below it.
- **A table the author split in Word** (two `<w:tbl>` elements with a blank paragraph
  between) is glued back into one, so the header band repeats on every page the grid
  continues onto instead of the second half running on unlabelled.
- **Uniform by the book's own majority.** The Teacher's Guide section labels
  (Teaching and Learning Materials, Teacher Facilitation Procedure, …) are bold
  sub-heads everywhere, inside activity boxes included. Where a manuscript sets the
  same words sometimes as a field label and sometimes as a sub-head, whichever form
  that book uses more often wins and the stragglers are brought over to it. A bold
  line ending in a colon is a field label only if it reads like a field *name* (at
  most six words, no comma) — an instruction that happens to end in a colon is an
  ordinary sub-head.
- **A box title gets the same space-normalising every other text path gets**, so an
  author's stray run of spaces cannot survive into the largest type on the page
  ("LEARNING ACTIVITY 1:   Listening to …" beside forty headings with one space).
- **An answer that the manuscript split across two paragraphs is set in one face.** The
  tail arrives as an indented lead part after the question, which used to print roman
  under its own italic first half; an indented lead already means "this continues the
  part above", so when that part carries an answer the lead takes the answer's italic.
- **The last glossary definition never stands alone on a page.** The second-to-last
  entry is bound to the last, the same one-item-deep sticky `qaparts()` uses on a run
  of sibling answers.
- **A sticky wrapper changes where an item may break, never how it sits.** Zeroing a
  sticky block's `above`/`below` strips the spacing its unwrapped siblings keep, and
  one bullet list then prints with two different leadings.
- **A heading never capitalises a function word in the middle of itself** — "Applying
  Voice Leading Rules in Harmony", not "… In Harmony". Runs on every book, because this
  is orthography rather than a house preference: a proofreading round on the Musical
  Arts Form 5 Teacher's Guide marked about forty-five of them, and the same fault was
  then found in thirteen of the books already typeset here. Deliberately narrow — only
  articles, coordinating conjunctions and short prepositions, never a participle like
  "Using"; a heading that shouts throughout is left alone; the first and last word keep
  their capital; and only a word written "Xxx" is touched, so an acronym or an all-caps
  span inside a mixed heading survives.
- **One space after a box title's label colon.** The general space-collapsing leaves a
  double space alone, since some authors still double-space after a full stop in prose;
  right after "LEARNING ACTIVITY 3:" it is a slip, and it showed on 24 titles across ten
  books beside hundreds of siblings setting one.
- **A question is never hyphenated, and its answer is always italic.** `doc()` tunes
  `costs.hyphenation` for body prose; an exercise or assessment question is not prose
  but a short numbered instruction, so `qaparts` refuses hyphenation outright and a
  word is never split across two lines inside a box. The expected answer beneath it is
  marked by italic and by nothing else — no highlight, no "Possible answer:" label — so
  `answer()` italicises the runs themselves rather than merely asking for italic around
  them, which a manuscript's own roman runs used to override.
- **A box heading that is only a label ends without punctuation.** "EXERCISE 4.",
  "EXERCISE 2:" and "EXERCISE 3 (PROJECT)." lose the trailing mark, because nothing
  follows it and the same element would otherwise print three ways through one book. A
  heading where the colon actually introduces something ("EXERCISE 2: Match the
  columns") keeps it.
- **Exercise boxes hold their whole exercise**: the word bank of a "complete the
  sentences using the words in the box" exercise ("Paper – Collage – Glue") is box
  content, not a heading that ends the box. A multiple-choice line missing the space
  before an option letter ("Sleeping(b) Reading") is spaced out.

## 5. Per-book revisions — the override sidecar

Editorial fixes live in `<book>.overrides.json` next to the `.docx` (manuscript
stays pristine, fixes are version-controlled). All keys are optional and default
off, so a change only touches the books that opt in. Keys:

**Cover / metadata / images**

| Key | What it does |
|---|---|
| `isbn` | ISBN on the imprint + back cover (no barcode) |
| `coverImage` | inject a cover photo (book with no hero image); path relative to the `.docx` |
| `coverColor` | pin this book's cover field colour (hex, with or without `#`), overriding the theme's own. A Teacher's Guide otherwise takes a shifted version of its subject's colour automatically, so its cover is distinguishable from the Learner's Book it shares a theme with — see `tgCoverSignature()` in `themes.js`. Only the cover changes; the interior is unaffected |
| `finishedCover` | the manuscript's own cover page image is already a complete, publication-ready cover (title, book type, authors, publisher/logo all baked into the graphic) rather than a plain hero photo — render it full-bleed and skip every template overlay (title text, byline, logo, motif), which would otherwise duplicate what the image already shows. Explicit opt-in only (a full-bleed image doesn't by itself say whether it's "finished" or just a big photo); the title page and back cover still get their normal templated text, synthesised from the theme's subject as usual |
| `authors` | override the author list (e.g. split "A and B" into two so the cover reads "AUTHORS"); an empty array (`[]`) hides the author byline on the cover entirely — when omitted, the engine already falls back to the names it finds in the manuscript's own front-matter "AUTHORS" bio section (each bio's opening bold name run) if the cover page itself carried no byline, so this override is only needed to fix names the fallback got wrong or to hide the byline |
| `images` | swap a source image by media filename (`{ "image12.png": { src, w } }`) |
| | To lift a whole book to print resolution, don't hand-write these: `node tools/upscale-images.js "<book.docx>" "<typeset.pdf>"` measures every picture's *effective* DPI in the built PDF (the template decides the printed size, so the PDF is the only honest measure), runs Real-ESRGAN on the ones under 300, resamples each back down to exactly what 300 DPI needs, and writes the `images` entries itself. `--dry-run` reports the plan first. A picture Word cropped can't be matched by size and must be named with `--map pN=imageN.png`, which upscales the already-cropped bitmap so the author's crop survives. |
| `watermark` | **Off-switch only — removal is already automatic.** Pictures made by an image generator often arrive with the generator's badge burnt into a corner ("AI-Generated", "Made with AI" — a flat off-white pill with dark lettering). The engine finds these and paints them out on every book, rebuilding the pixels the badge covered from the picture around it, so nothing is cropped away and the rest of the picture is untouched (`src/typeset/dewatermark.js`). Detection is narrow by design — a flat neutral plate, neutral lettering, rounded ends, label-sized, tucked into a corner — so a coloured lozenge or a numbered step header that the artwork itself contains is left alone. Set `"watermark": false` at the top level to switch it off for a whole book. To excuse one picture, or to point at a badge the detector can't see, use that picture's entry in `images`: `{ "image3.png": { "watermark": false } }`, or `{ "image3.png": { "watermark": { "x": 1285, "y": 14, "w": 236, "h": 62 } } }` (a box, or a list of them; pixels, or `0..1` fractions of the picture so the same box still fits its upscaled twin). The build log names every picture it cleaned. |
| `embedJpeg` | **Off-switch only — the re-encode is already automatic.** Print artwork is STORED as PNG (CLAUDE.md: never JPEG, because an upscale re-encoded at every step accumulates artefacts in the file later work is done from). Embedding it in the PDF is a separate question, and the engine answers it differently: on its way into the compiler`s workspace each staged copy of a photograph is re-encoded to JPEG at quality 92 with chroma subsampling OFF (4:4:4, so coloured edges and lettering stay sharp). Nothing on disk is touched — only the copy that goes into the PDF. It matters because a 300 DPI photograph costs roughly fifteen times as much embedded losslessly: the Grade 1 CTS Learner`s Book went from 9 MB to 277 MB the moment its 81 pictures reached print resolution. Two guards decide what is converted: a picture with ANY transparency is refused (JPEG has no alpha channel, so a cut-out would come back on black), and so is a picture that does not actually shrink — which is what keeps line art, flat-colour diagrams and screenshots as PNG, since those are both the pictures PNG already codes well and the ones JPEG would ring on. Set `"embedJpeg": false` for a book that must stay lossless end to end, or `"embedJpegQuality": 96` to raise the quality. The build log names the count and the saving. |
| `britishEnglish` / `proseCheck` | **Off-switches only — both run automatically.** These books are written in British English and nothing enforced it, so a manuscript spelling "colour" on one page and "color" on the next printed both. `britishEnglish` converts every word that has ONE British counterpart — the -our and -ise families, centre/fibre/litre/theatre, defence/offence, travelled/modelled/labelled, grey, plough, mould, aluminium, jewellery, skilful, catalogue, aeroplane, maths — preserving each word`s own case, and with a stoplist so `size`, `prize`, `maize` and `seize` are never touched (`src/typeset/british-english.js`, applied in import-docx.js so every later pass that matches on wording sees the spelling that will print). The genuinely AMBIGUOUS pairs are deliberately absent and left to a human: program/programme (a computer program keeps the short form in British English too), practice/practise, licence/license, meter/metre, tire/tyre, draft/draught. `proseCheck` REPORTS — it never edits — on a short list of slips with an obvious reading: a missing "to" ("tools we use make things"), an extra one ("makes them to feel welcome"), a word typed twice, a space before a full stop, a/an against the following sound, and a line that reads as a question but carries no question mark. A missing word cannot be restored by rule, so the build log quotes the line and the correction goes in through `subtext`, where it is reviewable and version-controlled. Set either to `false` to switch it off. |
| `imageToText` | replace a pasted equation-editor screenshot with plain typeset text, by media filename (`{ "image20.png": "15° × 111 km = 1665 km" }`) — for manuscripts where the working is a raster image instead of typed text (the screenshot's baked-in ClearType fringing shows as a visible colour halo once enlarged for print) |
| `imageToTable` | replace a pasted screenshot of a **table** with a real typeset table, by media filename (`{ "image23.png": [["Broad Topic", "Example"], ["Farming", "…"]] }`, or `{ "image25.png": { "rows": [...], "noHeader": true } }`). The first row becomes the house header band unless `noHeader` is set; a cell may carry `**bold**` / `*italic*` / `$math# ZEPH Typesetting House Style — the authoritative guide

This is the **gospel** for typesetting every book with the engine. It is derived
strictly from how we actually typeset the reference books (English, Physics,
Biology). The **English Form 4 Learner's Book is the reference standard**: when in
doubt, match English. New books should need only a few per-book revisions because
everything below is handled by the shared engine.

See also: `TYPESETTING.md` (themes table + variants), `SERIES-GUIDELINES.md`
(ZEPH B5 front-matter detail), `LOCAL-LANGUAGE-GLOSSARY.md` (label translations).

---

## 1. One engine, per-book theme

`node src/typeset/typeset-docx.js "<book>.docx"` typesets one book. The theme is
auto-picked from the file name (`autoTheme` in `themes.js`); override with
`--theme <name>`. A theme sets colours, fonts, and a **variant** (the layout).

Build a ZEPH house-style theme with the `zeph({...})` factory in `themes.js`
(English/Physics/Biology family): pass a subject, a palette, and a variant; box
colours are derived from the palette automatically.

## 2. Variants — pick by content, not by subject

| Variant | Boxes? | Use for |
|---|---|---|
| `series` | flat (activities → headings) **but table-wrapped boxes are kept** | English; **all local-language books**; prose-heavy subjects |
| `science` | boxed (Learning Activities / Exercises in coloured boxes) | activity-heavy subjects (Physics, Biology, Maths, Computer Science, Grade 6 Science) |
| `classic` / `modern` / `literary` / `panel` | boxed, distinct identities | older standalone books (PE, Tech, earlier Lunda/Cinyanja) |

**Local languages follow English (`series`).** `series` gives the English flat
house style *and still renders a box for any activity/exercise the manuscript
puts in a table* — so we never force-flatten a real box, and never force a box
where the writer used flowing text.

## 3. ZEPH house style (shared by `series` + `science`)

- **B5** (176×250 mm); margins top 19 / bottom 16 / x 17 mm.
- **Fonts:** body + interior headings **Arial**; cover/title-page **Segoe UI**;
  running header **Times New Roman** italic. (Body text is **12 pt**.)
- **Front matter order:** cover → repeated title page → copyright/imprint → TOC →
  Authors → Foreword → Preface → Acknowledgement → Introduction → (Key
  Competences / Acronyms) → body.
- **Numbering:** silent roman from the title page, visible from ~Authors;
  arabic restarts at the first TOPIC/UNIT. Footer tilde `~ n ~`.
- **Cover by grade:** same grade = same cover **layout**, differing only by the
  theme's signature colour (centred masthead: eyebrow → big subject → accent rule
  → FORM tag → book type → hero photo → AUTHORS → logo).
- **Signatory** name is **bold**; title/org normal, kept as one tight block with
  ~16 mm signature space above.

## 4. Conventions baked into the engine (don't re-solve these)

- **Boxes are breakable** by default (long ones flow across pages); a box title is
  **sticky** so it never sits alone at the foot of a page.
- **A TOPIC always opens a new page; a SUB-TOPIC does not.** A sub-topic follows its
  topic's introduction on the same page when that introduction is short, and takes a
  fresh page only when there is no room left — which is what ordinary flow does once
  the heading is sticky. Never decide this by reading `here().position().y`: measuring
  how far down the page the layout has reached and breaking on the answer is circular,
  Typst stops converging, and the damage shows up as wrong page numbers in the footer
  rather than as a bad break. A syllabus is unaffected — its YEAR banners still open
  their own page.
- **Every heading is sticky, and the sticky belongs on the outermost block.** A heading
  wrapped in `layout(…)` or in the reservation block that guards against a heading with
  only a line or two beneath it hides its own stickiness from the flow: the flow sees
  the wrapper, so the heading can still end a page alone.
- **A numbered list reserves the same marker column for all of its items**, wide enough
  for two digits, so "1." and "10." start their text at the same place and a long list
  keeps a clean left edge. Bullets keep their own narrow column.
- **Question numbering** (exercises/assessments): top items renumber 1..N (always
  start at 1); sub-parts a/b/c reset under each parent; literal "(a)" the writer
  typed is honoured and nests; a bare number above its figure is moved above it.
- **Tables**: text at body size (12 pt; ≥5-col tables step to 10 pt). A figure
  caption "Fig N:" / "Figure N:" attaches to its image.
- **Illustrations** are kept large for accessibility (small source diagrams are
  scaled up; CDC flags tiny pictures).
- **Acronyms** render "ABBR: full" (colon), preserving the writer's bold capitals.
- **Lists** keep the writer's real markers (a/b/c, 1/2/3, i/ii), not forced bullets.
- Stray artifacts (lone punctuation / single letters) are dropped.
- **The imprint page is centred throughout** — the copyright statement, every credit
  label (ISBN, Edited by, Illustrated by, Cover and Book Layout, First Published by,
  Printed by) and every name under one. A label is bold with a gap above it however
  the manuscript styled it, including where the weight came from a Word Heading
  style; a label the manuscript styled as a Heading does **not** end the imprint, and
  a next label typed onto the tail of the ISBN's dotted placeholder is given its own
  line. The **Cover and Book Layout** credit is always ours: whoever the manuscript
  named there is replaced, whether on the label's own line or the line below it.
- **A table the author split in Word** (two `<w:tbl>` elements with a blank paragraph
  between) is glued back into one, so the header band repeats on every page the grid
  continues onto instead of the second half running on unlabelled.
- **Uniform by the book's own majority.** The Teacher's Guide section labels
  (Teaching and Learning Materials, Teacher Facilitation Procedure, …) are bold
  sub-heads everywhere, inside activity boxes included. Where a manuscript sets the
  same words sometimes as a field label and sometimes as a sub-head, whichever form
  that book uses more often wins and the stragglers are brought over to it. A bold
  line ending in a colon is a field label only if it reads like a field *name* (at
  most six words, no comma) — an instruction that happens to end in a colon is an
  ordinary sub-head.
- **A box title gets the same space-normalising every other text path gets**, so an
  author's stray run of spaces cannot survive into the largest type on the page
  ("LEARNING ACTIVITY 1:   Listening to …" beside forty headings with one space).
- **An answer that the manuscript split across two paragraphs is set in one face.** The
  tail arrives as an indented lead part after the question, which used to print roman
  under its own italic first half; an indented lead already means "this continues the
  part above", so when that part carries an answer the lead takes the answer's italic.
- **The last glossary definition never stands alone on a page.** The second-to-last
  entry is bound to the last, the same one-item-deep sticky `qaparts()` uses on a run
  of sibling answers.
- **A sticky wrapper changes where an item may break, never how it sits.** Zeroing a
  sticky block's `above`/`below` strips the spacing its unwrapped siblings keep, and
  one bullet list then prints with two different leadings.
- **A heading never capitalises a function word in the middle of itself** — "Applying
  Voice Leading Rules in Harmony", not "… In Harmony". Runs on every book, because this
  is orthography rather than a house preference: a proofreading round on the Musical
  Arts Form 5 Teacher's Guide marked about forty-five of them, and the same fault was
  then found in thirteen of the books already typeset here. Deliberately narrow — only
  articles, coordinating conjunctions and short prepositions, never a participle like
  "Using"; a heading that shouts throughout is left alone; the first and last word keep
  their capital; and only a word written "Xxx" is touched, so an acronym or an all-caps
  span inside a mixed heading survives.
- **One space after a box title's label colon.** The general space-collapsing leaves a
  double space alone, since some authors still double-space after a full stop in prose;
  right after "LEARNING ACTIVITY 3:" it is a slip, and it showed on 24 titles across ten
  books beside hundreds of siblings setting one.
- **A question is never hyphenated, and its answer is always italic.** `doc()` tunes
  `costs.hyphenation` for body prose; an exercise or assessment question is not prose
  but a short numbered instruction, so `qaparts` refuses hyphenation outright and a
  word is never split across two lines inside a box. The expected answer beneath it is
  marked by italic and by nothing else — no highlight, no "Possible answer:" label — so
  `answer()` italicises the runs themselves rather than merely asking for italic around
  them, which a manuscript's own roman runs used to override.
- **A box heading that is only a label ends without punctuation.** "EXERCISE 4.",
  "EXERCISE 2:" and "EXERCISE 3 (PROJECT)." lose the trailing mark, because nothing
  follows it and the same element would otherwise print three ways through one book. A
  heading where the colon actually introduces something ("EXERCISE 2: Match the
  columns") keeps it.
- **Exercise boxes hold their whole exercise**: the word bank of a "complete the
  sentences using the words in the box" exercise ("Paper – Collage – Glue") is box
  content, not a heading that ends the box. A multiple-choice line missing the space
  before an option letter ("Sleeping(b) Reading") is spaced out.

## 5. Per-book revisions — the override sidecar

Editorial fixes live in `<book>.overrides.json` next to the `.docx` (manuscript
stays pristine, fixes are version-controlled). All keys are optional and default
off, so a change only touches the books that opt in. Keys:

**Cover / metadata / images**

| Key | What it does |
|---|---|
| `isbn` | ISBN on the imprint + back cover (no barcode) |
| `coverImage` | inject a cover photo (book with no hero image); path relative to the `.docx` |
| `coverColor` | pin this book's cover field colour (hex, with or without `#`), overriding the theme's own. A Teacher's Guide otherwise takes a shifted version of its subject's colour automatically, so its cover is distinguishable from the Learner's Book it shares a theme with — see `tgCoverSignature()` in `themes.js`. Only the cover changes; the interior is unaffected |
| `finishedCover` | the manuscript's own cover page image is already a complete, publication-ready cover (title, book type, authors, publisher/logo all baked into the graphic) rather than a plain hero photo — render it full-bleed and skip every template overlay (title text, byline, logo, motif), which would otherwise duplicate what the image already shows. Explicit opt-in only (a full-bleed image doesn't by itself say whether it's "finished" or just a big photo); the title page and back cover still get their normal templated text, synthesised from the theme's subject as usual |
| `authors` | override the author list (e.g. split "A and B" into two so the cover reads "AUTHORS"); an empty array (`[]`) hides the author byline on the cover entirely — when omitted, the engine already falls back to the names it finds in the manuscript's own front-matter "AUTHORS" bio section (each bio's opening bold name run) if the cover page itself carried no byline, so this override is only needed to fix names the fallback got wrong or to hide the byline |
| `images` | swap a source image by media filename (`{ "image12.png": { src, w } }`) |
| | To lift a whole book to print resolution, don't hand-write these: `node tools/upscale-images.js "<book.docx>" "<typeset.pdf>"` measures every picture's *effective* DPI in the built PDF (the template decides the printed size, so the PDF is the only honest measure), runs Real-ESRGAN on the ones under 300, resamples each back down to exactly what 300 DPI needs, and writes the `images` entries itself. `--dry-run` reports the plan first. A picture Word cropped can't be matched by size and must be named with `--map pN=imageN.png`, which upscales the already-cropped bitmap so the author's crop survives. |
| `watermark` | **Off-switch only — removal is already automatic.** Pictures made by an image generator often arrive with the generator's badge burnt into a corner ("AI-Generated", "Made with AI" — a flat off-white pill with dark lettering). The engine finds these and paints them out on every book, rebuilding the pixels the badge covered from the picture around it, so nothing is cropped away and the rest of the picture is untouched (`src/typeset/dewatermark.js`). Detection is narrow by design — a flat neutral plate, neutral lettering, rounded ends, label-sized, tucked into a corner — so a coloured lozenge or a numbered step header that the artwork itself contains is left alone. Set `"watermark": false` at the top level to switch it off for a whole book. To excuse one picture, or to point at a badge the detector can't see, use that picture's entry in `images`: `{ "image3.png": { "watermark": false } }`, or `{ "image3.png": { "watermark": { "x": 1285, "y": 14, "w": 236, "h": 62 } } }` (a box, or a list of them; pixels, or `0..1` fractions of the picture so the same box still fits its upscaled twin). The build log names every picture it cleaned. |
| `embedJpeg` | **Off-switch only — the re-encode is already automatic.** Print artwork is STORED as PNG (CLAUDE.md: never JPEG, because an upscale re-encoded at every step accumulates artefacts in the file later work is done from). Embedding it in the PDF is a separate question, and the engine answers it differently: on its way into the compiler`s workspace each staged copy of a photograph is re-encoded to JPEG at quality 92 with chroma subsampling OFF (4:4:4, so coloured edges and lettering stay sharp). Nothing on disk is touched — only the copy that goes into the PDF. It matters because a 300 DPI photograph costs roughly fifteen times as much embedded losslessly: the Grade 1 CTS Learner`s Book went from 9 MB to 277 MB the moment its 81 pictures reached print resolution. Two guards decide what is converted: a picture with ANY transparency is refused (JPEG has no alpha channel, so a cut-out would come back on black), and so is a picture that does not actually shrink — which is what keeps line art, flat-colour diagrams and screenshots as PNG, since those are both the pictures PNG already codes well and the ones JPEG would ring on. Set `"embedJpeg": false` for a book that must stay lossless end to end, or `"embedJpegQuality": 96` to raise the quality. The build log names the count and the saving. |
| `britishEnglish` / `proseCheck` | **Off-switches only — both run automatically.** These books are written in British English and nothing enforced it, so a manuscript spelling "colour" on one page and "color" on the next printed both. `britishEnglish` converts every word that has ONE British counterpart — the -our and -ise families, centre/fibre/litre/theatre, defence/offence, travelled/modelled/labelled, grey, plough, mould, aluminium, jewellery, skilful, catalogue, aeroplane, maths — preserving each word`s own case, and with a stoplist so `size`, `prize`, `maize` and `seize` are never touched (`src/typeset/british-english.js`, applied in import-docx.js so every later pass that matches on wording sees the spelling that will print). The genuinely AMBIGUOUS pairs are deliberately absent and left to a human: program/programme (a computer program keeps the short form in British English too), practice/practise, licence/license, meter/metre, tire/tyre, draft/draught. `proseCheck` REPORTS — it never edits — on a short list of slips with an obvious reading: a missing "to" ("tools we use make things"), an extra one ("makes them to feel welcome"), a word typed twice, a space before a full stop, a/an against the following sound, and a line that reads as a question but carries no question mark. A missing word cannot be restored by rule, so the build log quotes the line and the correction goes in through `subtext`, where it is reviewable and version-controlled. Set either to `false` to switch it off. |
. Use it wherever an author pasted a Word table as a picture: as a picture it cannot pick up the header band, its rules and type clash with the real tables around it, and it is stuck at screenshot resolution. The Geography Form 2 Learner's Book had one on printed p75 sitting directly beneath a real table of the same columns, which is the uniformity rule's plainest failure. |
| `setCaption` | set an image's caption, matched by `near` (existing caption) or `file` (media name) |
| `theme` | force a theme by name, bypassing `autoTheme()`'s file-name guess (a TG whose title doesn't match its sibling LB's pattern, say) |
| `synthesiseCover` | force the engine to build a fresh cover from title/subject/booktype/author even when a cover-ish page was detected (its line shapes didn't match what the theme expects) |
| `blackWhite` | render the whole interior in black/grey (CDC's Teacher's Guide requirement) while the **cover stays full colour** — every themed colour, box fill, and table zebra-stripe is forced to black/grey/light-grey. This is now the **default for any TG** (filename carries "TG" or "teacher"), so most books never need to set it; use `blackWhite: false` for the rare TG that must stay in colour, or `blackWhite: true` to force it on a Learner's Book (which otherwise keeps its colour) |
| `orIndividually` | `false` switches off the standing rule that writes "or individually" into an activity body offering only group or pair work. Use it when a reviewer strikes that phrase out — it switches the whole book rather than the instances they happened to mark, so the book does not then say it two ways |

**Text (whole-block)**

| Key | What it does |
|---|---|
| `fill` | write a value into a dotted placeholder after a label (Edited by…) |
| `replace` | swap a paragraph containing a substring (flattens formatting) |
| `replaceExact` | like `replace` but the block's **whole trimmed text** must equal `find` |
| `remove` | delete any block containing a substring (trim a section to fit) |
| `removeRange` | delete blocks from `from` up to (not incl.) `to` — for anchors sharing text. Tree-aware: when `from` is not a top-level block the search continues into activity/exercise bodies, so a run of lines the importer absorbed into a box can be taken out without disturbing the box. `to` may then be omitted, meaning "through the last block of the list `from` is in" — trailing matter inside a box has no following sibling to anchor against. Omitting `to` on a top-level match is refused, since it would delete the rest of the book. Optional `after` starts the search only past the block containing that text, and narrows the nested scan as well as the top-level one — which is how a run duplicated *inside* a box is reached, since it is by definition identical to the copy standing before it |
| `removeWhereNext` | delete a block matching `find` only when the block right after it matches `next` (disambiguates a repeated heading) |
| `moveBefore` | lift the block containing `find` and re-insert it before the block containing `before` |
| `moveSectionBefore` | like `moveBefore` but moves a whole section (heading through to the next heading), not just one block |
| `replaceBlocks` | replace a run of blocks between two anchors with freshly built ones — blockspecs: `para`/`head`/`h1`/`listitem`/`label`/`vspace`/`raw`/`numbond`; `raw` inserts a pre-built block object verbatim (e.g. grafting a table or list from elsewhere in the same book) |
| `insertText` | insert a new paragraph/heading before an anchor (lighter-weight than `replaceBlocks` when you're only adding, not replacing) |
| `mergePara` | glue a paragraph to the one before/after it (`glue: true`) — a sentence Word split across two paragraphs |
| `splitBefore` | force a paragraph break right before a matched substring (the inverse of `mergePara`) |
| `boldFind` | bold every run whose exact text matches `find` (e.g. math symbols like `∈`, `≠` that the importer left plain) |

**Text (in-place, preserves run formatting)**

| Key | What it does |
|---|---|
| `edit` / `editAll` | replace/delete a substring **inside** the first / every matching block |
| `editAnswer` | like `editAll`, but rewrites a qa part's own **answer** text (`.a`/`.aseg`) instead of its question — for a stray leftover option letter the manuscript's answer itself carries (e.g. "C use of basso continuo" on a question that isn't even multiple-choice) |
| `subtext` | replace a substring in **every run** containing it, keeping its bold/italic/colour |
| `retext` | change a run whose trimmed text equals `from` to `to`, keeping bold/italic/colour |
| `unbold` / `unitalic` | drop bold / italics from a run whose trimmed text matches |
| `unboldBlock` | drop bold from EVERY run of any block containing the substring — "this paragraph should carry no bold at all", for a manuscript that bolds a whole cross-cutting-issue sentence inside a facilitation paragraph. It takes the punctuation fragments Word split off the bolded stretch too, which `unbold`, matching a run by its exact text, cannot |
| `unitalicBlock` | the mirror of `unboldBlock` for italics — drop italics from every run of any block containing the substring. For a manuscript that sets one Teaching Step in italic among ten roman siblings |
| `boldToItalic` | drop bold **and** set italic on a matching run |
| `recolor` | recolour runs by existing colour and/or exact text (`{ from?, to, text?, bold? }`) |
| `italiciseFrom` | italicise the value after a label prefix (GENERAL/SPECIFIC COMPETENCE…), label stays roman |

**Headings & structure**

| Key | What it does |
|---|---|
| `asHead` | reclassify a coloured section heading (h1/h2) to plain **bold-black** `head` |
| `asSection` | inverse of `asHead`: promote an inline heading to a **styled section head** (own page, accent title + rule, listed in TOC) — for back-matter GLOSSARY/REFERENCES |
| `insertHead` | insert a heading before an anchor; `as:"h2"` makes it a sub-topic (flows into TOC), `near` disambiguates a repeated anchor |
| `centre` | centre a heading matched by exact text (passage / picture / story titles) |
| `recolorHead` | give a heading (by prefix) a specific fill colour |
| `activityHeadsBlack` | render every Activity/Exercise heading bold black instead of the accent colour |
| `keepRunColours` | `true` switches OFF the uniform-run-colour pass. By default a near-black author colour (paste residue: 0A0A0A, 181818, 222222, 0F1115) gives way to the body colour, and whatever real colour is left in the book collapses onto the one it uses most — so one kind of thing cannot print blue on one page and green on another. Set this only for a manuscript whose several colours genuinely carry meaning |
| `pageBreakBefore` | insert a page break before the first block containing the text |
| `replaceSection` | swap a whole section body (heading → next section) for supplied `items` (markdown-ish: `**bold**`, `*italic*`, `$math$`, `## sub-head`); optional `rename`/`until` |
| `recase` | change a block's case (`{ startsWith, to: "sentence" \| "title" \| "upper" }`, default `"title"`) — e.g. an ALL-CAPS label the house style wants in sentence case, or a Learning Activity/Exercise/Assessment box title a manuscript left inconsistently cased (`to: "upper"`) next to sibling boxes that are ALL-CAPS |
| `headingCase` | settle a whole book's heading case in one key: `{ to: "sentence" \| "title", apply: ["boxTitle", "head"], keep: [...], skip: [...] }`. By default the engine brings a book's odd headings over to whatever case that book already uses most; reach for this when a reviewer asks for a specific one instead (the Musical Arts Form 5 Teacher's Guide came back with about forty-five separate marks lowering a word in a title). `boxTitle` touches only the description AFTER the colon, so `EXERCISE 4` and `END OF TOPIC 6 ASSESSMENT` are left alone; `head` recases a sub-topic head, or only the part after its colon when it has one. `keep` lists this book's proper nouns; `skip` lists whole heads to leave alone (`Teaching Steps`, `Specific competence`). An ALL-CAPS word inside a heading that is not itself all-caps is read as an acronym (MIDI, HIV) and kept |
| `splitBoxTitle` | `[{ find, at }]` — take the tail off a box title and make it the box's first body line, for an author who typed a box's title and its instruction as one Word paragraph. The tail takes the body's own styling (italic in every theme that boxes activities), so the box matches its siblings |
| `setHeading` | force a block to render as a specific heading kind (`as: "label"`, etc.) — for a heading the importer classified wrong |
| `centrePara` | centre a paragraph (and, inside an exercise, its "lead" part) rather than justify/left-align it — matches a manuscript's own centred diagram or ASCII layout |
| `monoLines` | render a block as monospace, preserving every literal space — for an ASCII-art diagram or aligned columns the author built with spaces in Word |
| `fixExercise` | repair a mis-parsed exercise/assessment heading: `renumber: true` renumbers it in place, `heading: "EXERCISE 9"` overwrites a wrong/missing title (matched via `match` + `near`), `parentBefore` fixes a lettered sub-part that lost its parent number |
| `tocDepth` | how many heading levels the table of contents lists (default 2: top-level + one sub-level) |
| `tocUnitsOnly` | `false` also lists front/back matter (Authors, Foreword, References, …) in the TOC, not just units/topics |

**Lists / questions / tables**

| Key | What it does |
|---|---|
| `setMarker` | force the list marker of a question/answer part (when a diagram throws numbering off) |
| `unlist` | convert a paragraph the importer mis-parsed as a list item back to a plain paragraph |
| `dropMath` | delete a stray math segment by exact Typst source |
| `tables` | rebuild a badly-built table as an explicit grid |

**Images:** generate with **gpt-image-2, `quality: "high"`** (raised from the
old `"low"` cost-saving default — print sharpness now wins over the small
per-image cost difference). Prompt for Zambian context, gender balance,
disability inclusion, and youth where relevant; keep the replacement's own
file extension and a like-for-like aspect ratio.

- **Don't hand-roll the generation.** `node tools/genimage.js "<book.docx>"`
  reads a `<book>.artprompts.json` sidecar (one prompt per figure, plus an
  optional `cover` entry), calls the model, takes each result through
  Real-ESRGAN to print resolution, and writes the `images` / `coverImage`
  entries into the book's overrides itself. It appends the standing
  requirements below to every prompt, so a spec file carries only what its
  picture must *depict*. `--dry-run` prints the plan and the full prompts
  without calling anything; `--only`, `--force` and `--no-upscale` narrow it.
  Budget the time: Real-ESRGAN splits each frame into pieces on this hardware
  and takes minutes per picture, not seconds — a 1536x1024 frame taken to
  1800px wide measured **893s (~15 min)** at the default `--tile 128`, in six
  pieces, with no tile-grid or seam artefacts in the result. `--tile` sets the
  per-pass working set; 256 and above will not allocate here. Note that tile
  size does NOT change how many pieces a frame is cut into — that is
  `MAX_PIECE_PX` in `tools/lib/esrgan.js` — so it makes each piece's passes
  cheaper, not fewer.
- **Name each figure the way the manuscript spells it in `word/media/`** —
  `image8.jpeg`, not `image8.png`. The spec key becomes the key of the
  book's `images` override, and an override keyed to a picture the manuscript
  does not contain is read by nothing: the book re-typesets with its old
  artwork while the log says every figure was generated. The generated file
  itself is always written as PNG whatever the original was. `genimage.js`
  now checks the spec against the .docx and refuses to run on a name the
  manuscript has not got.
- **Every picture is semi-realistic.** This is the house register for all
  books: believable human proportions, anatomy, lighting and perspective,
  rendered rather than photographic. It rules out the cartoon/comic end —
  flat colour, outlined figures, exaggerated features, saturated
  poster-paint shading — and it does not ask for photorealism either. Say it
  in the prompt every time, next to the context/balance/inclusion asks
  above; an unqualified prompt drifts cartoonish. A manuscript's own
  photographs already sit at or past the realistic end and are left alone.
  Because a book whose figures are half comic and half semi-realistic is
  inconsistent in exactly the way §5's uniformity rule objects to, when one
  figure is redrawn, check whether its siblings now look out of place.

- **Generate through the gpt-image-2 API directly, never the ChatGPT
  consumer app.** The ChatGPT app bakes a small visible watermark into
  every image it generates; the raw API output carries none. For a picture
  *we* are making, using the API is the fix — a clean image beats a repaired
  one, so don't generate a badged image and lean on the repair below.
- **A watermark that arrives inside a manuscript is taken off
  automatically.** Authors paste generated pictures into their manuscripts
  badge and all — a flat off-white pill reading "AI-Generated" or "Made with
  AI" stamped into a corner — and that artwork is theirs, not something we
  can regenerate. The engine detects those badges and paints them out on
  every book, rebuilding what the badge covered from the surrounding picture
  so the frame is never cropped and nothing outside the badge changes
  (`src/typeset/dewatermark.js`; the build log names each picture cleaned).
  Never crop a badge off instead — that throws away artwork and changes the
  picture's aspect. If a badge ever survives, point at it with the
  `watermark` override rather than editing the manuscript.
- **Replace any picture or illustration that isn't clear** with a sharper one
  of the same subject (via the `images` override) — don't leave a blurry
  scan, a low-res clip-art, or a muddy photo in a finished book. The same
  goes for a picture that earns no place on its page: swap it for an ideal
  one that still depicts what the original depicted, so the surrounding text
  and its caption still hold. Replace, never simply delete.
- **Every picture with people in it must include a learner with a visible
  disability** — a wheelchair user, an albino learner, a hearing aid, or a
  white cane. This holds for the **cover** as much as for a page figure, and
  a cover built as a mosaic of several pictures must carry that
  representation somewhere in the mosaic. Name the marker explicitly when
  prompting for a replacement; "inclusive" on its own does not produce it.
- **Keep male and female representation equal.** Count the people actually
  shown when assembling a cover or swapping a figure, rather than assuming a
  prompt delivered the balance it asked for.
- **The people shown must be the age the book's own grade/level actually
  serves** — not older, not younger. This is a house-style rule for *every*
  book, checked at every image swap, not a one-off:
  | Level | Depicted age |
  |---|---|
  | ECE 3-4 | 3-4 years old — mostly cartoon/very young children |
  | ECE 5-6 | 5-6 years old |
  | Grade 4 | ~10 years old |
  | Form 4 | 16-17 years old (youths) |
  | Form 5-6 | 18-19 years old (youths) |

  Grades outside this table aren't pinned to an exact age yet — treat each
  primary grade as roughly one year older than the last (Grade 1 the
  youngest, climbing toward the Grade 4 anchor above and beyond), but
  confirm with the team before treating a specific untabled grade's age as
  settled. The one exception to "match the learner's own age": an image
  illustrating a mother, father, or family scene may show adults (and
  younger siblings) — but if the image is meant to depict *the learner*
  practising the skill the page teaches (cooking, laundry, bed-making, …),
  it needs to show someone the book's own age, not a parent or a much
  younger child standing in for them.

> This table covers the overrides you'll reach for most often. The engine
> recognises many more (each is a niche, one-off fix added for a specific
> manuscript problem) — the definitive, always-current list is every
> `ov.<key>` read in `applyOverrides()` in `src/typeset/typeset-docx.js`
> (`grep -oE "ov\.[a-zA-Z]+" src/typeset/typeset-docx.js | sort -u`). If a
> problem you're hitting sounds oddly specific, search there before adding a
> new primitive — there's a decent chance it already exists.


### Rulings from proofreading rounds — what generalises and what does not

A reviewer's mark is evidence, not yet a rule. Before promoting one to the engine,
measure how many of the books already built here it would touch and look at what it
would touch — `output/*/_source.typ` is the honest corpus for that. The Musical Arts
Form 5 round is the worked example:

| The ask | Books affected | Where it went |
|---|---|---|
| A word in a question must not split across two lines | every Teacher's Guide | **engine** — `qaparts` refuses hyphenation |
| An expected answer must read as an answer | every Teacher's Guide | **engine** — `answer()` italicises its own runs |
| Headings must be consistent about small words | 13 of 27 | **engine** — `lowercaseHeadingFunctionWords` |
| One space after a box title's label colon | 10 of 27 | **engine** — `afterLabelColon` |
| A box label ends without punctuation | several | **engine** — `stripBoxLabelPunct` |
| The last glossary entry must not stand alone | any book with a glossary | **engine** — `formatGlossary` |
| Set the whole book in sentence case | this reviewer's call, not a house rule | **override** — `headingCase` |
| Un-bold the cross-cutting-issue sentences | 0 — the bold runs in other books' activity bodies are legitimate emphasis ("In this lesson, learners will…", quoted questions, role lists) | **override** — `unboldBlock` |
| Delete the unfilled "refer to … page …." placeholder | 0 — no other book carries one | **override** — `textFix`/`subtext` |
| Drop "or individually" | contested: an earlier reviewer asked for it to be ADDED | **override** — `orIndividually: false` |

The two columns that matter are the middle one and the reason behind it. A rule that
would restyle a heading somebody would defend belongs in a sidecar however often it is
asked for; a rule that only ever corrects a fault belongs in the engine even when one
book asked for it.

## 6. Workflow for scaling (many books)

1. **Shared first** — theme + glossary labels + conventions live in the engine, so
   every book benefits at once. Do engine work once, not per book.
2. **Batch** — typeset every queued book to a first draft in one pass.
3. **Proofread + revise** — the user proofreads each book; fixes go in that book's
   overrides sidecar. Because the foundation is solid, expect only a few per book.

Old binary `.doc` files won't parse — convert with LibreOffice first:
`soffice --headless -env:UserInstallation=file:///C:/temp/loconv --convert-to docx --outdir <dir> "<file>.doc"`.
