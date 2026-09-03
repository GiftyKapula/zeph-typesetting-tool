# Architecture

How a Word manuscript becomes a designed, print-ready PDF.

```
   your manuscript                                       output/<name>/
   books-to-typeset/*.docx                                <name> - typeset.pdf
          │                                                      ▲
          ▼                                                      │
  ┌───────────────────┐   blocks    ┌────────────────────┐  Typst markup   ┌──────────────────┐
  │  import-docx.js    │ ─────────► │  typeset-docx.js    │ ──────────────► │  Typst compiler   │
  │  (reads the .docx)  │            │  (emits + applies    │                 │  (node compiler)  │
  └───────────────────┘            │  overrides + theme)  │                 └──────────────────┘
                                     └─────────┬───────────┘                          ▲
                                                │ styled by                            │ against
                                                ▼                                       │
                                     ┌────────────────────┐                            │
                                     │     themes.js        │────────────────────────────┘
                                     │  (palette/font/       │
                                     │   layout variant)     │
                                     └────────────────────┘                 generic-template.typ
                                                                             (the Typst design)
```

## 1. Reading the manuscript — `import-docx.js`

`importDocx(path)` unzips the `.docx` and reads its raw OOXML directly (not
through Word), producing a flat array of **blocks** — plain JS objects such as
`{ t: "head", level: 1, segs: [...] }`, `{ t: "para", segs: [...] }`,
`{ t: "listitem", ... }`, `{ t: "table", rows: [...] }`, `{ t: "figure", ... }`.
Each `segs` array carries rich-text runs (bold/italic/colour/super-sub/math).

This is where the engine figures out *structure* regardless of how the author
styled things in Word:
- Word Heading styles → heading blocks with a level.
- **`boxKindFromTitle()`** classifies a table/box's title text into
  `activity` / `exercise` / `assessment` / `keypoints` / `fact` — so a
  "LEARNING ACTIVITY 3" heading is recognised as an activity box even if the
  author never used a Word style for it. Local-language equivalents are wired
  in here too (see `docs/LOCAL-LANGUAGE-GLOSSARY.md`).
- Numbered/bulleted lists, tables, embedded images, OMML equations (via
  `omml.js`) are all captured as structured blocks, not flattened to text.

## 2. Choosing a look — `themes.js`

A **theme** is a named bundle of colour palette, body font, and a `variant`
that changes layout behaviour (e.g. the ZEPH `series`/`english` layout vs a
plain `navy` layout). `autoTheme(name)` guesses a theme from the file name if
you don't pass `--theme` explicitly. Add a book's own look by adding a block to
`themes.js`.

## 3. Cleanup passes + overrides — `typeset-docx.js`

Between import and emission, a series of JS passes normalise real-world
manuscript mess: de-duplicating adjacent headings, boxifying a plain-text
"EXERCISE 4" heading that wasn't a real Word box, fixing stray formatting,
normalising unit/lesson banners, applying the ZEPH series front-matter layout,
and more (`boxifyActivities`, `normaliseUnitHeads`, `applySeriesFront`, …).

Then a book's own **`<name>.overrides.json`** (sitting next to its `.docx` in
`books-to-typeset/`) is applied — a JSON-driven set of surgical fixes for
things generic enough to have a primitive (`recase`, `moveSectionBefore`,
`replaceBlocks`, `blackWhite`, `coverImage`, `authors`, `theme`, …) but too
book-specific to bake into the engine itself. This is the main lever you reach
for when a book needs *this one thing* fixed without touching the manuscript.

## 4. Emitting Typst — `typeset-docx.js` → `generic-template.typ`

`emit(blocks)` walks the (now-cleaned) block array and writes Typst source —
one function call per block (`#para(...)`, `#activity(...)`, `#dtable(...)`,
`#figimg(...)`, …) — against **`generic-template.typ`**, which defines every
one of those functions: page geometry, running heads, the decorated footer,
the cover page, the table of contents (`tableofcontents()`), and every themed
box style (`titledbox`, used by activity/exercise/assessment/keypoints/fact —
they're the same function, only the theme's colours per "kind" differ).

The theme dict is injected as Typst variables above the template so its
functions pick up the chosen palette/font/variant.

## 5. Compiling — the Typst node compiler

`@myriaddreamin/typst-ts-node-compiler` compiles the assembled `.typ` source
(with a `_media/` folder of extracted images as its workspace) straight to
PDF — no external Typst CLI install needed. `image-enhance.js` runs first on
faint line-art or EMF images so they survive the print pipeline.

## 6. The eBook path — `emit-ebook.js` (optional)

Reuses the exact same `importDocx()` semantic model to export a **reflowable
eBook bundle** (`.zephbook`) for the ZEPH Learn app, instead of a fixed-layout
PDF — real selectable text, images, and math rendered through the same Typst
engine for pixel parity with the print edition. See `docs/EBOOK-FORMAT.md` for
the bundle format contract.

## 7. The workflow layer — `zeph` (`tools/`)

Everything above is a *pure function of a `.docx` file*. `zeph` (`tools/zeph.js`)
sits above it and tracks the real publishing loop across many books: identity
by content hash (not filename), every version (manuscript / overrides /
typeset PDF / annotated return), proofread rounds, and every reviewer comment,
in one local SQLite file (`zeph.db`). `npm run zeph -- build <book>` is just
"run everything above against this book's latest manuscript, and record the
result as a new version." See `docs/WORKFLOW.md` for the full lifecycle.
