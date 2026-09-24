# Working in this repo

This is the ZEPH typesetting engine + `zeph` workflow tool. Read
`docs/HOW-IT-WORKS.md` and `docs/ARCHITECTURE.md` first if you haven't touched
this codebase before — they explain the pipeline (`import-docx.js` →
`typeset-docx.js` → `generic-template.typ` → Typst → PDF) and where `zeph`
fits on top of it.

## The core loop — never skip the "look at it" step

1. Typeset the book (`npm run typeset:docx`, or `npm run zeph -- build <id>`).
2. **Open the actual rendered PDF and look at the pages you touched or that
   the request is about.** This tool has no test suite that checks visual
   layout — a clean exit code proves the Typst compile succeeded, nothing
   about whether the page looks right. If you don't have a way to view a PDF
   directly, render the specific page(s) to PNG and look at the image (see
   `docs/GETTING-STARTED.md` for a quick pdfjs-dist + canvas snippet) — don't
   declare something fixed on the strength of the build log alone.
3. Fix via `<book>.overrides.json` (see `docs/HOUSE-STYLE.md` §5 for every
   key), not by hand-editing the manuscript, unless the manuscript itself is
   genuinely wrong (a typo, a mis-numbered exercise) — see below.
4. Re-typeset, re-look, repeat.

## Before you fix anything: check the actual manuscript, don't guess

If something renders oddly, unzip the `.docx` and read the raw OOXML before
assuming why:

```bash
node -e "const JSZip=require('jszip'),fs=require('fs'); \
  JSZip.loadAsync(fs.readFileSync('books-to-typeset/My Book.docx')) \
    .then(z=>z.file('word/document.xml').async('string')) \
    .then(xml=>console.log(xml.slice(<offset>,<offset>+2000)))"
```

A recurring failure mode: assuming a manuscript uses some formatting
convention (monospace, centred, a particular list style) because that's what
would explain the bug, then "fixing" it — when the manuscript's actual XML
says something else entirely. Verify, then fix.

## Engine bug vs. one-off manuscript quirk — fix at the right layer

- If the bug is in how the *engine* handles a pattern that will recur across
  books (a regex that fails to match a plural form, a line-break rule that
  strands a fragment, a theme misdetecting a filename) — fix it in
  `src/typeset/` so every book benefits, and say so; don't quietly patch
  around it in one book's overrides file.
- If it's specific to *this manuscript* (a typo, this book's own numbering
  slip, a photo that needs replacing) — that's an override or, rarely, a
  direct manuscript edit, not an engine change.
- Never bake a specific book's id or content into engine code
  (`src/typeset/*.js`, `generic-template.typ`). It has happened before (a
  module-scope DB query hard-coded to one book's proofreading round used to
  crash the engine for every *other* book) — it's a real landmine, not a
  hypothetical.

## `zeph` is the source of truth for "what's already been done" — but verify it

`zeph.db` can go stale (a book typeset outside the tracked flow, a merge that
didn't happen, a state nobody updated). Before reporting on a book's status,
cross-check `npm run zeph -- show <id>` against what's actually in `output/`
— don't repeat a stale DB state as fact.

## Don't fabricate what you can't derive

File modification times, "date received," "first typeset date" and similar
provenance data are often **not reliably recoverable** — a bulk file
operation (a reorg, a re-copy) resets mtimes for everything at once, and
`output/` is git-ignored so there's no commit history to fall back on either.
If you can't derive a fact, say so and leave it blank rather than presenting a
plausible-looking guess as fact. The same goes for anything about a
proofreading round, correction, or approval that only a human reviewer would
know — that's the kind of thing `zeph.db`'s `comment.action` field and
`docs/WORKFLOW.md`'s corrections-log exist to capture, not to be inferred.

## Housekeeping while working

- Scratch scripts and rendered PNGs used to inspect a PDF are exactly that —
  scratch. Delete them when you're done; don't leave `scratch_*.js` or
  `*_p12.png` debris in the repo.
- `books-to-typeset/`, `input/`, `output/`, `proofread-books/` are drop
  folders — git-ignored except their README. Don't commit a manuscript's
  `.docx` or a generated PDF; the `.overrides.json` sidecar is the thing that
  *is* version-controlled.
- After a real engine change (anything under `src/typeset/`), re-typeset at
  least one real manuscript end-to-end before calling it done — this is a
  shared engine used by every book, and a change that looks correct in
  isolation can still break the pipeline (a missing import, a changed
  function signature another call site relied on).
## Image print-quality
Before finalizing any document, check every image's resolution
against its intended print size. Required: 300 DPI at final print
size. Calculate required pixel width as:
  (print width in inches) x 300 = minimum pixel width

If an image falls below this, it must be upscaled before use.

Use Real-ESRGAN (ncnn-vulkan build), installed at:
C:\Users\biine stores\Desktop\REAL-\realesrgan-ncnn-vulkan.exe

Command:
realesrgan-ncnn-vulkan.exe -i <input> -o <output> -n realesrgan-x4plus

This upscales 4x. Run it from within the REAL- folder, or reference
its full path if called from elsewhere.

After upscaling:
1. Convert to a print-safe format (TIFF or high-quality PNG — never
   JPEG, due to compression artifacts).
2. Confirm final DPI meets the 300 DPI requirement at intended print
   size before re-inserting into the document.
3. Re-insert the processed image into the source, replacing the
   original low-res reference.

Skip CMYK conversion unless the document is going to a commercial
printer. Always report which images were upscaled and their
original vs. new dimensions before finalizing.