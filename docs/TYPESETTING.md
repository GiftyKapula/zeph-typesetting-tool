# Typesetting & print-readiness

The typeset edition is produced by the **Typst** engine (a real, modern
typesetting system) — not by Word/LibreOffice. This is what makes the output
look human-typeset rather than "a PDF from a word processor".

## How to build it

```bash
npm run typeset      # -> output/TYPESET - Topic 5.1 ....pdf
```

Driven by `src/typeset/typst-build.js`, which:
1. captures the topic's content as semantic blocks (`capture.js` — see
   `ARCHITECTURE.md`),
2. emits Typst markup that calls the design functions in `template.typ`,
3. compiles to PDF with `@myriaddreamin/typst-ts-node-compiler`.

`build(topicFile, no, title, outName, { showAnswers })` — set `showAnswers:false`
for a clean print version (current default) or `true` to keep the
yellow-highlighted possible answers (e.g. a teacher/answer copy).

## Typeset ANY Word document (`npm run typeset:docx`)

The same engine can typeset arbitrary, **non-typeset** `.docx` books — not just
the books this project generates. Drop a Word document in `input/` or
`books-to-typeset/` and run:

```bash
npm run typeset:docx                              # every .docx in those folders
node src/typeset/typeset-docx.js "My Book.docx"   # a single file
node src/typeset/typeset-docx.js "My Book.docx" --theme tech   # pick a palette
```

Each book is written to **its own folder**: `output/<name>/<name> - typeset.pdf`
(plus a `_source.typ` next to it, the exact Typst markup that produced the PDF,
for inspection).

### How it works
1. `src/typeset/import-docx.js` — `importDocx(path)` unzips the docx **in
   process** (JSZip, so it runs the same on Windows/PowerShell as on bash) and
   parses `word/document.xml` into **structure-aware** semantic blocks. It does
   not just dump tables as grids — it recognises the book's furniture:
   - the **cover** (title lines + the hero image on page 1), the **imprint**
     page (kept centred), and the **table of contents** (the source's
     mis-paginated/duplicated TOC is dropped and rebuilt — see below);
   - topic openers (`TOPIC N: …`) and front-matter / sub-topic / section headings
     (Word Heading styles; bold-coloured *or* bold-black lines as section
     headings, with trailing-colon lines like `Specific Competence:` kept as
     labels);
   - **Learning Activity / Exercise / Key Points / Did You Know / Assessment**
     boxes — detected by their **title text** (e.g. `LEARNING ACTIVITY`,
     `Exercise 1`, `…ASSESSMENT`), so it works across books that box these with
     *different* (or inconsistent) fill colours;
   - **side-by-side images** (multiple pictures in one paragraph are laid out in
     a row, proportional to their real widths), single images sized from their
     real width, figures + `Figure N:` captions, real multi-column data tables,
     bullet lists, paragraph alignment, and per-run **bold**/*italic*/colour.
   The **table of contents** is regenerated with Typst's real `outline()` from
   hidden, outlined headings, so the page numbers and dot leaders are correct
   for *our* pagination (not the original Word one).
2. `src/typeset/typeset-docx.js` — copies the embedded images into a temp
   workspace, injects the chosen **theme** dict, emits Typst markup against
   `generic-template.typ`, and compiles the PDF.

### Themes — one engine, many looks
`src/typeset/themes.js` holds named themes; the template reads every colour, the
**font**, and a **`variant`** (which switches the LAYOUT) from the injected `T`
dict, so each book keeps its own identity — not just a recolour:

| Theme | Font(s) | Variant | Paper | Look | For |
|---|---|---|---|---|---|
| `navy` | Times New Roman | classic | A4 | navy `#1f3864` + gold `#c79a3b` | Physical Education |
| `tech` | Century Gothic | modern | A4 | blue `#13579f` + orange `#f29230` | Technology Studies |
| `lit` | Times New Roman | literary | A4 | burgundy `#6b2737` + gold `#b68a3e` | Literature in Lunda |
| `cinyanja` | Times New Roman | panel | A4 | forest green `#1f5c45` + amber `#d98b2b` | Cinyanja Form 1 |
| `english` | Segoe UI (display) / Arial (body) | series | **B5** | teal `#2f9e8c` interior + **yellow `#f6c324` cover signature** | English Language Form 4 (ZEPH house style) |
| `physics` | Segoe UI (display) / Arial (body) | science | **B5** | deep indigo `#26346b` + amber `#f0a32e` | Physics Form 4 (ZEPH house style, boxed) |
| `biology` | Segoe UI (display) / Arial (body) | science | **B5** | deep emerald `#17633a` + amber `#e8a020` | Biology Form 4 (ZEPH house style, boxed) |

- **classic** — serif, compact number-block topic opener, solid sub-topic band,
  accent-bar section heads, fully-bordered boxes.
- **modern** — full-width topic banner, light sub-topic *tab*, underlined section
  heads, left-stripe boxes.
- **literary** — burgundy masthead cover, centred chapter titles flanked by gold
  rules, header-bar boxes; an elegant book-like feel for language/literature.
- **panel** — photo-top cover, editorial chapter banners, solid-colour "chip"
  sub-headings, accent-square section heads, filled ruled boxes.
- **series** — the **ZEPH secondary house style** (see next section): B5, a
  diagonal/geometric modern-sans cover, a repeated title page, roman front
  matter → arabic body, and a flowing layout where activities/exercises are
  **teal headings, not boxes**.
- **science** — the ZEPH house style for a hands-on lab subject (Physics,
  Biology): the same B5 mechanics as `series` (front matter, roman/arabic
  numbering, designed cover/title/back cover) but it **KEEPS the callout boxes**
  (Learning Activities + Exercises are boxed), uses **numbered TOPIC banners**
  (the topic number in a chip). Each science book keeps its own colour and a
  cover **`motif`** (theme field): `physics` → atom/orbit, `biology` → cell
  (membrane + nucleus + organelles). The importer's house-style flags are
  decoupled: `{ styled, flat, textCover }` (so `science` = styled + textCover,
  but **not** flat).

A theme may set `bodyFont` and `displayFont` separately from `font` (the series
theme uses a serif running header, a sans body, and a sans display face), and a
`paper` (defaults to `a4`; the series theme is `iso-b5`).

Pick one with `--theme NAME`; otherwise it's inferred from the file name. Add a
theme by copying a block in `themes.js` (add a new `variant` branch in
`generic-template.typ` if you want a new layout). The shared layout (no
paragraph indent, the boxes, designed cover, real TOC, figures, zebra data
tables, running header + page-number footer) lives in
`src/typeset/generic-template.typ`.

> **Callout boxes are breakable.** `titledbox` (and therefore Learning Activity /
> Exercise / Assessment / Key Points / generic boxes) defaults to
> `breakable: true`, so a box taller than the remaining page **flows onto the
> next page** rather than overflowing the bottom margin (which clips/jumbles the
> text). Keep this for any new box; pass `breakable: false` only for a short box
> that must stay whole.

### The ZEPH "series" layout (B5 secondary house style)

The `english` theme + `series` variant reproduce the Zambia Educational
Publishing House O-level house style, reverse-engineered from a **human-typeset
reference** (`reference/English Language Form 3_ LB_.pdf`). New ZEPH secondary
books in the same series should use it — see the editorial checklist in
[`SERIES-GUIDELINES.md`](SERIES-GUIDELINES.md). What it adds on top of the shared
engine:

- **B5 trim (176 × 250 mm).** These books print at B5 — "slightly smaller than
  A4" — so we typeset at the true B5 size (`paper: "iso-b5"`), which is what the
  print house expects. Do **not** fake A4.
- **Front-matter sequence:** cover → a **title page** that repeats the book name
  → copyright/imprint → **Table of Contents** → Authors / Foreword / Preface /
  Acknowledgements / Introduction. `typeset-docx.js` rebuilds this from the raw
  manuscript via `applySeriesFront()` (it inserts the title page after the cover
  and the `titlestart` / `showpage` / `bodystart` page-numbering markers).
- **Page numbering:** roman counting begins (silently) on the **title page = i**,
  so the title/copyright/contents pages count as *i, ii, iii…* but print **no**
  number; the number becomes **visible** at the first prose front-matter page (so
  *The Authors* lands on ≈ *v*) and runs roman through the front matter; the body
  **restarts at arabic 1** on the first `UNIT`. Numbering is driven by the page's
  *native* `numbering` pattern (so the generated outline formats roman/arabic
  correctly); the centred `~ n ~` footer is gated by `pgvisible`. The markers
  pagebreak **first**, then reset the counter so it lands on the new page.
- **Flowing, box-free body** (`importDocx(path, { series: true })`): Activity /
  Exercise / Task lines become **teal headings**, not coloured callout boxes;
  `UNIT n:` gets a solid teal banner; the **lessons (sub-sections) under each
  unit are auto-numbered 1, 2, 3…**, restarting at every unit (via `lessonctr` /
  `unitseen`). Word **Heading styles** drive the levels (the colour/size heading
  heuristics are disabled for series, which are reliably styled).
- **Spacing & widows:** lesson headings get extra space before them and are
  `sticky` (a heading is never left stranded at the foot of a page — it moves to
  the next page with its content); units always open a fresh page.
- **Signature room:** on Foreword / Preface / Acknowledgements a 16 mm gap is
  left above the signatory's name (detected by a trailing honorific like
  `(Dr)` / `(Ms.)` / `(PhD)`, whether the name is a plain or a bold line) for a
  hand signature.
- **Back cover:** a final page that echoes the front cover's geometry (mirrored
  teal band + cyan slice + corner wedges, modern sans), carrying the book
  identity and publisher branding, with a **reserved, empty box** where the press
  adds the **ISBN + barcode** at print time (we deliberately do not draw them).
- **Cover & title page:** a diagonal/geometric design in modern sans (Segoe UI) —
  an angled band, a big subject, a "FORM n" tag, a tilted photo panel, an authors
  tag, corner wedges. The running header stays a refined serif italic.
- **Subject signature colour dominates the covers:** the **front and back covers
  are filled** with the subject's signature colour (the dominant field) — the
  title sits **directly on it in deep teal** (no contrasting band), with a small
  teal accent rule and teal geometric corner wedges. The **interior stays teal**.
  **English = yellow** (`#f6c324`), set via the theme's `signature` field
  (defaults to `primary` for themes that don't override it).

> Note: Typst array literals — an **empty** list must be emitted as `()`, never
> `(,)` (a lone comma is a parse error). The emit helpers in `typeset-docx.js`
> handle this; keep it in mind if you add new array-valued blocks.

## The design (`src/typeset/template.typ`)

- **Body face:** Times New Roman, justified, optimised line breaks + hyphenation.
- **Colour scheme:** navy `#1f3864` + gold `#c79a3b`.
- **Page furniture on every page:**
  - a **full-bleed navy top band** with a gold hairline,
  - a **running header** ("Form 5 · Physical Education and Sport" | topic title),
  - a **decorated footer** (book name · page number in a navy pill · topic no.).
- **Topic opener:** a navy **number block** with a gold "TOPIC" eyebrow + the big
  number, the title in large serif with a **gold underline**, and the opener
  image in a **gold keyline frame**.
- **Sub-topic headings:** navy band with a gold leading edge.
- **Section headings:** navy text with a small accent bar.
- **Boxes:** Learning Activity (blue), Exercise (green), Key Points (amber),
  Did You Know? (teal) — matching the Word edition.

## Previewing a Typst PDF

`pdftoppm`/ImageMagick are not installed here, so to *see* a page: render the
document to SVG with the compiler's `.svg()`, drop it in a tiny HTML `<img>`,
and screenshot it with headless Chrome:

```js
const { NodeCompiler } = require("@myriaddreamin/typst-ts-node-compiler");
const c = NodeCompiler.create({ workspace: process.cwd() });
fs.writeFileSync("_doc.svg", c.svg({ mainFileContent: doc }));
```
then `chrome --headless --screenshot=out.png --window-size=W,H file://…/page.html`.

## Print-readiness — where we stand

Benchmarked against a **human-typeset** Form 3 PE book (made in Adobe InDesign,
same publisher). That book did **not** use PDF/X, an ICC profile, or a full CMYK
conversion (its images stayed RGB); it only added **bleed**. So the bar is lower
than a textbook "ideal", and we meet it:

| Item | Human Form 3 book | This system |
|---|---|---|
| Fonts embedded + subset | ✅ | ✅ (Times New Roman R/B/I) |
| Bleed | ✅ | ✅ **3 mm** (page = 216 × 303 mm) |
| PDF/X export | ❌ | ❌ (not required) |
| ICC output profile | ❌ | ❌ |
| Colour | mixed RGB + CMYK | RGB |
| Images | RGB | RGB |

**Bottom line:** finished in Typst, the book is print-ready to the same standard
as the human-typeset book.

### Optional polish (only if a specific press insists)
- **Image DPI** — in-content images are ~296 DPI (fine); the full-width opener is
  ~230 DPI. Regenerate openers at ≥2048 px for a true 300 DPI.
- **CMYK** — convert with Ghostscript/Acrobat at the end if the press requires it.
- **TrimBox** — Typst doesn't emit a TrimBox; the printer trims to the known A4
  size from the bleed, or add one in a quick post-process.
- **Font licence** — Times New Roman is Microsoft/Monotype. For commercial print,
  consider a free near-identical serif (Tinos / Liberation Serif).
