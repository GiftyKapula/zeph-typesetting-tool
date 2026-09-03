# zeph-typesetting-tool

A **drop-a-`.docx`, get-a-typeset-PDF** engine, plus **`zeph`** — the local
workflow tool that tracks every book through drafting → typesetting →
proofreading → corrections → approval.

Give it any Word manuscript and it lays the whole book out into a designed,
print-ready PDF (running heads, decorated footers, a real table of contents,
themed colour palettes, boxed activities/exercises/assessments) — using
**Typst**, a real typesetting engine, not a PDF export of the Word file.

---

## Quick start

```bash
npm install

# 1. Drop a manuscript in books-to-typeset/, then:
npm run typeset:docx                                   # typeset every book in there
node src/typeset/typeset-docx.js "My Book.docx"         # just one file
node src/typeset/typeset-docx.js "My Book.docx" --theme tech   # choose a palette

# 2. Track it with zeph (recommended once you're juggling more than one book)
npm run zeph -- import books-to-typeset    # register every book, in place
npm run zeph -- list                       # every book + its lifecycle state
npm run zeph -- build <book-id>            # typeset the latest manuscript
npm run zeph -- send   <book-id> [pdf]     # open a proofread round
npm run zeph -- return <book-id> <file>    # ingest the marked-up copy back
npm run zeph -- comments <book-id>         # work through the comment list
npm run zeph -- resolve <comment-id> --action "fixed via overrides"
```

Each book is typeset into its own folder under `output/`. See
`books-to-typeset/README.md` and `input/README.md` for the drop-folder details,
and `docs/WORKFLOW.md` for the full `zeph` lifecycle.

**New to this tool?** `docs/GETTING-STARTED.md` is the full walkthrough —
install, first typeset, fixing issues with overrides, tracking with `zeph`,
sending proofread rounds, the corrections-log report, and troubleshooting —
done step by step instead of as a command reference.

**Using Claude Code (or another AI agent) to drive this tool?** `CLAUDE.md` at
the repo root is loaded automatically and covers the habits that matter when
an agent is the one running the commands: always look at the actual rendered
PDF rather than trusting a clean exit code, verify a manuscript's raw XML
before guessing why something renders oddly, fix engine bugs in the engine
(not around them in one book's overrides), and don't fabricate provenance data
(dates, "who reviewed what") that isn't actually recoverable from the repo.

### Requirements
- **Node.js** (v18+).
- **LibreOffice** — used headless to convert `.docx` to PDF and to compute
  table-of-contents page numbers where needed. On Windows the path is
  hard-coded to `C:\Program Files\LibreOffice\program\soffice.exe` in a couple
  of places — update that if yours is installed elsewhere.
- The **Typst** engine ships as an npm dependency — no separate install.

---

## Repository layout

```
.
├── README.md
├── CLAUDE.md                  # loaded automatically by Claude Code
├── package.json
├── docs/                      # read these, in this order:
│   ├── GETTING-STARTED.md     #   full step-by-step walkthrough (clone -> delivered book)
│   ├── HOW-IT-WORKS.md        #   plain-English tour of the toolchain
│   ├── ARCHITECTURE.md        #   how a .docx becomes a typeset PDF
│   ├── HOUSE-STYLE.md         #   THE authoritative typesetting rules (gospel)
│   ├── SERIES-GUIDELINES.md   #   ZEPH series house-style checklist
│   ├── TYPESETTING.md         #   the Typst design + print-readiness details
│   ├── WORKFLOW.md            #   the zeph tool: books, versions, proofread rounds
│   ├── LOCAL-LANGUAGE-GLOSSARY.md  # local-language structural term mappings
│   └── EBOOK-FORMAT.md        #   the ZEPH Learn eBook export contract
├── src/typeset/                # THE ENGINE
│   ├── typeset-docx.js         #   drop-a-docx -> typeset PDF runner (entry point)
│   ├── import-docx.js          #   reads ANY .docx -> structure-aware blocks
│   ├── themes.js                #   colour palettes / house styles per book
│   ├── generic-template.typ    #   the themed Typst design
│   ├── image-enhance.js        #   line-art cleanup, crop, EMF->PNG
│   ├── omml.js                  #   Office-Math -> Typst math
│   └── emit-ebook.js           #   export a typeset book -> ZEPH Learn eBook bundle
├── tools/                       # THE WORKFLOW TOOL (zeph)
│   ├── zeph.js                  #   CLI: import / build / send / return / comments / resolve
│   ├── db.js                    #   schema (book / version / round / comment)
│   ├── gen-corrections-log.js  #   author-facing "what was done" report
│   └── lib/                     #   metadata + comment extractors (pdf & docx)
├── zeph-logo/image.png          # publisher logo, used on auto-synthesised covers
├── books-to-typeset/            # drop whole manuscripts here (git-ignored, see its README)
├── input/                       # drop a single .docx here (git-ignored, see its README)
├── proofread-books/             # drop annotated returns here (git-ignored, see its README)
├── output/                      # generated typeset PDFs (git-ignored)
├── zeph.db                      # local workflow database (git-ignored)
└── reference/                   # your own syllabus/reference PDFs (git-ignored)
```

## The big idea

1. **`import-docx.js`** reads any Word manuscript and turns it into a
   structure-aware tree of blocks — headings, paragraphs, boxes (Activity /
   Exercise / Key Points / Assessment, detected by title text), tables,
   figures, lists — regardless of how the author styled it in Word.
2. **`themes.js`** picks (or is told) a palette + font + layout variant for the
   book — a `theme`.
3. **`typeset-docx.js`** emits that block tree as Typst markup against
   **`generic-template.typ`**, styled by the chosen theme, and compiles it with
   the Typst engine into a print-ready PDF in `output/`.
4. **`zeph`** (`tools/zeph.js`) sits on top of all that: it gives every book a
   stable identity (not a filename), tracks every version by content hash, and
   models the real publishing loop — typeset → send for proofread → return
   with comments → apply corrections → approve.

See **`docs/HOW-IT-WORKS.md`** for a fuller plain-English walkthrough, and
**`docs/HOUSE-STYLE.md`** before typesetting your first real book — it's the
authoritative rulebook this engine was built to satisfy.
