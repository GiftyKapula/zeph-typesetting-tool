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

## 5. Per-book revisions — the override sidecar

Editorial fixes live in `<book>.overrides.json` next to the `.docx` (manuscript
stays pristine, fixes are version-controlled). All keys are optional and default
off, so a change only touches the books that opt in. Keys:

**Cover / metadata / images**

| Key | What it does |
|---|---|
| `isbn` | ISBN on the imprint + back cover (no barcode) |
| `coverImage` | inject a cover photo (book with no hero image); path relative to the `.docx` |
| `authors` | override the author list (e.g. split "A and B" into two so the cover reads "AUTHORS") |
| `images` | swap a source image by media filename (`{ "image12.png": { src, w } }`) |
| `setCaption` | set an image's caption, matched by `near` (existing caption) or `file` (media name) |

**Text (whole-block)**

| Key | What it does |
|---|---|
| `fill` | write a value into a dotted placeholder after a label (Edited by…) |
| `replace` | swap a paragraph containing a substring (flattens formatting) |
| `replaceExact` | like `replace` but the block's **whole trimmed text** must equal `find` |
| `remove` | delete any block containing a substring (trim a section to fit) |
| `removeRange` | delete blocks from `from` up to (not incl.) `to` — for anchors sharing text |
| `moveBefore` | lift the block containing `find` and re-insert it before the block containing `before` |

**Text (in-place, preserves run formatting)**

| Key | What it does |
|---|---|
| `edit` / `editAll` | replace/delete a substring **inside** the first / every matching block |
| `subtext` | replace a substring in **every run** containing it, keeping its bold/italic/colour |
| `retext` | change a run whose trimmed text equals `from` to `to`, keeping bold/italic/colour |
| `unbold` / `unitalic` | drop bold / italics from a run whose trimmed text matches |
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
| `pageBreakBefore` | insert a page break before the first block containing the text |
| `replaceSection` | swap a whole section body (heading → next section) for supplied `items` (markdown-ish: `**bold**`, `*italic*`, `$math$`, `## sub-head`); optional `rename`/`until` |

**Lists / questions / tables**

| Key | What it does |
|---|---|
| `setMarker` | force the list marker of a question/answer part (when a diagram throws numbering off) |
| `unlist` | convert a paragraph the importer mis-parsed as a list item back to a plain paragraph |
| `dropMath` | delete a stray math segment by exact Typst source |
| `tables` | rebuild a badly-built table as an explicit grid |

**Images:** generate with **gpt-image-2, `quality: "low"`** (cost). Prompt for
Zambian context, gender balance, disability inclusion, and youth where relevant;
keep the replacement's own file extension and a like-for-like aspect ratio.

## 6. Workflow for scaling (many books)

1. **Shared first** — theme + glossary labels + conventions live in the engine, so
   every book benefits at once. Do engine work once, not per book.
2. **Batch** — typeset every queued book to a first draft in one pass.
3. **Proofread + revise** — the user proofreads each book; fixes go in that book's
   overrides sidecar. Because the foundation is solid, expect only a few per book.

Old binary `.doc` files won't parse — convert with LibreOffice first:
`soffice --headless -env:UserInstallation=file:///C:/temp/loconv --convert-to docx --outdir <dir> "<file>.doc"`.
