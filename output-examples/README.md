# output-examples/

Two real books, typeset end-to-end with this exact engine, committed here so
you can see a finished result before you typeset your own first book. (Every
other book lands in `output/`, which is git-ignored — this folder is the one
deliberate exception.)

- **Art and Design Form 1 Learner's Book** — a clean run: manuscript in,
  overrides applied (front-matter reordering, a caption fix), typeset PDF out.
  No external assets needed.
- **English Language Form 4 Learner's Book** — the reference book named
  throughout `docs/HOUSE-STYLE.md` ("the English Form 4 Learner's Book is the
  reference standard"). One caveat: its `.overrides.json` swaps two stock
  photos for contextualised ones (`images/eng-debate.png`,
  `images/eng-youth-market.png`) that live in ZEPH's own content repo, not
  this tool repo — those two images render as the manuscript's *original*
  photos here instead of the swapped ones. The engine doesn't error or warn
  about this; a missing override-image source is a silent, graceful fallback
  to the original (see `import-docx.js`, the `useOvr` check). Everything else
  in the book is unaffected. This is exactly the kind of thing to know before
  you assume "it typeset without errors" means "it matches some other
  reference exactly" — check the actual PDF, always.

Regenerate either one yourself: drop the same manuscript in
`books-to-typeset/`, `node src/typeset/typeset-docx.js "<name>.docx"`, and
diff against what's here.
