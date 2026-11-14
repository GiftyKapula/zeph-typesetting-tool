# Working in this repo

This is the ZEPH typesetting engine + `zeph` workflow tool. Read
`docs/HOW-IT-WORKS.md` and `docs/ARCHITECTURE.md` first if you haven't touched
this codebase before — they explain the pipeline (`import-docx.js` →
`typeset-docx.js` → `generic-template.typ` → Typst → PDF) and where `zeph`
fits on top of it.

## FIRST: which branch are you on? Portrait and landscape never mix

The work lives on **three permanently separate branches**, one per book family:

| Branch | Format | Books | House style |
|---|---|---|---|
| `landscape-syllabus` | A4 landscape | the CDC curriculum syllabuses (the 5-column matrix family) | `docs/HOUSE-STYLE.md` §2a |
| `portrait-books` | portrait B5 | the English-language learner's/teacher's books — Geography, Physics, ICT, RE, Home Economics, Food & Nutrition, Musical Arts … | that branch's `docs/HOUSE-STYLE.md` |
| `main` | portrait B5 | the local-language and ECE books (Chitonga, Cinyanja, Icibemba, Lunda, Luvale, Silozi, Kiikaonde …) | that branch's HOUSE-STYLE + `LOCAL-LANGUAGE-GLOSSARY.md` + `presets/` |

All three also follow `docs/SHARED-RULES.md` (printer, imprint, back cover,
credits, delivery). Each branch keeps its own copy of it.

If the book you were asked about doesn't belong to the branch you're on, stop
and say so before touching anything.

**Never merge them, and never offer to.** The engine rules for the two families
are different and must not be mixed — page geometry, front-matter structure,
heading levels, cover construction and table styling all diverge. The two
branches *will* drift apart, and that drift is the intended state, not a
problem to go and fix.

- Check the branch before you touch `src/typeset/`. If you are on
  `portrait-books`, do not edit syllabus rules; if you are on
  `landscape-syllabus`, do not edit portrait rules.
- Don't port a fix from one branch to the other on your own initiative. If a
  fix is shared *plumbing* rather than layout (something in `import-docx.js`,
  the override primitives, image handling) say so and let the human decide —
  don't cherry-pick across.
- If asked how to "tell apart", "differentiate" or "call" the two families,
  that is a question about naming and which branch to be on. It is **not** a
  request to merge them or to make one branch serve both.
- One book = one branch = one PR, based on the family branch. Never base a
  book's PR on another book's branch (stacked PRs #99, #102, #174, #194 all
  had to be closed or retargeted).

## Before the first edit (every session)

1. Say which branch you're on and which family it serves (table above).
2. Say whether the book has been typeset already — `npm run zeph -- show`,
   then check `output/` and Downloads (the DB can be stale, see below).
3. Name the job: first typeset / reviewer or CDC round / read-through. The job
   decides how far you may go (next section).
4. Read the house rules for the family before measuring the book. A written
   house rule beats any pattern you measure from the book itself.

## How far to go

- **Reviewer or CDC round:** change only the spots that were marked, in the
  reviewer's exact words — never soften or "improve" them. A spelling fix may
  go book-wide. Anything else you notice goes on a list for Teddy, unchanged.
- **First typeset or read-through:** the house rules apply in full. Settle the
  judgement calls with evidence; leave nothing open except what only a human
  can decide.
- **Only the book named.** No rebuilding other books after an engine change
  unless asked. A change asked for on one book goes in that book's sidecar.

## Never change without asking

- Engine defaults that reach every book: the layout credit, signatory names
  and offices, cover colours, the spine and back cover, fonts, presets.
- `docs/SHARED-RULES.md`, `docs/HOUSE-STYLE.md`, this file, and on `main`
  `presets/` and `lexicon/`.
- Another branch, in any way.
- The manuscript `.docx`, except a typo Teddy confirms.

## Stop and ask when

- the branch is wrong or unclear;
- a change would reach every book, or another branch;
- a reviewer's comment can't be applied as written, or two reviewers disagree;
- a local-language word isn't in the word list (never invent one);
- the docs and the code disagree (say which says what);
- an ISBN, copyright owner, credit or signatory isn't in the manuscript or
  the sidecar.

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
- Pin every `edit` / `subtext` override (`after`, `near`) so it can match only
  one place. An unpinned edit took the first match and changed the wrong page
  (Silozi G4 LB p48, reverted in #109).
- Write code and JSON with the Edit/Write tools, never through a shell heredoc:
  heredocs ate regex backslashes twice (Luvale G1 LB).

## `zeph` is the source of truth for "what's already been done" — but verify it

`zeph.db` can go stale (a book typeset outside the tracked flow, a merge that
didn't happen, a state nobody updated). Before reporting on a book's status,
cross-check `npm run zeph -- show <id>` against what's actually in `output/`
— don't repeat a stale DB state as fact. On this branch the database is the
root `zeph.db`. `main`'s code opens `data/zeph.db` instead, so a `data/zeph.db`
in this folder is left over from a `main` checkout — don't read status from it.

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

## Done means all of these

1. The build log is clean: **"numbering check: N matrix table(s), clean"**, no
   override entry that matched nothing.
2. The PDF's fonts are the house fonts only (`pdffonts`): no Libertinus, New
   Computer Modern, Segoe UI Emoji / MDL2 Assets, Yu Gothic fallbacks; no
   private-use characters (U+E000–U+F8FF) or U+FFFD in `pdftotext` output —
   they are glyphs the manuscript typed in Symbol/Wingdings that printed wrong.
3. Render and look at: the cover spread, title page, copyright/imprint page,
   contents, the first matrix page, every page you changed, the last page.
4. Go through the house rules for the family one by one (for a syllabus:
   HOUSE-STYLE §2a — front-matter order, signatories, year, level page,
   SUB-TOPIC header, page breaks, spine over 112 pages).
5. No placeholders: no `xxx`, `INSERT`, `TBC`. An ISBN not known yet prints as
   dots.
6. Commit, push, open the PR yourself (`gh`). Name any unmerged PR this PDF
   depends on.
7. Deliver ONE PDF, cover spread as page 1, to the top of Downloads; check it
   is still there.
8. Update `zeph` (state, round, comments). Delete scratch files.
