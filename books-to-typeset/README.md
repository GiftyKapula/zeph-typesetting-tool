# books-to-typeset/ — the manuscripts

File every manuscript by **Subject → Level → date received**:

```
books-to-typeset/
  Mathematics II/
    Form 2/
      2026-09-25/
        form II Maths II LEARNERS BOOK 24.09.2026 Ready for Typesetting.docx
        form II Maths II LEARNERS BOOK 24.09.2026 Ready for Typesetting.overrides.json
        form II Maths II TEACHERS GUIDE 24.09.2026 Ready for Typeseting.docx
    Form 4/
      2026-07-02/ …
  Physics/
    Form 4/
      2026-06-26/
        fig-fixes/            ← a book's own helper files sit next to it
        Form 4 Physics Learner's Book Final Copy 17 May.docx
  Travel and Tourism/
    Syllabus (TED)/
      2026-09-21/ …           ← syllabi use the level "Syllabus" / "Syllabus (TED)"
```

## Rules

- **Never rename the `.docx`.** The output folder (`output/<Form|Grade>/<name>/`)
  and the `.overrides.json` sidecar are both keyed on the file name. Move *folders*
  freely, never rename the file.
- **Subject** = the full subject name (`Creative and Technology Studies`, not `CTS`);
  **Level** = `Form N` / `Grade N` / `Syllabus`; **date** = `YYYY-MM-DD`, the day the
  manuscript reached us. A new draft of the same book goes in a new date folder, so
  every draft stays side by side.
- The `.overrides.json` sidecar always sits next to its `.docx` (same name).
- In an overrides file, point at **shared** images with the repo-root alias
  `"@/books-to-typeset/media/cover.png"` or `"@/images/…"`. It works however deep
  the book sits. Point at the book's **own** files relatively (`"fig-fixes/fig09.png"`).

## Moving an existing book into this layout

The older folders (`Form 4 Books/`, `Grade 6 Book/`, …) still work. To re-file a book,
**don't drag it in Explorer**: its overrides' image paths and your zeph database would
still point at the old place. Use the tool instead. It moves the `.docx` + `.overrides.json`
(+ `.doc`) together, fixes the paths, and updates `data/zeph.db`:

```bash
node tools/refile-book.js "books-to-typeset/Form 4 Books/My Book.docx" "Physics" "Form 4" 2026-06-26 --dry
node tools/refile-book.js "books-to-typeset/Form 4 Books/My Book.docx" "Physics" "Form 4" 2026-06-26
#   add  --with fig-fixes   to bring a helper folder along
```

Then typeset it once and look at the PDF. Commit the moved `.overrides.json` on a
branch (see `CONTRIBUTING.md`). The `.docx` itself is never committed.

## Typesetting

```bash
node src/typeset/typeset-docx.js "books-to-typeset/Physics/Form 4/2026-06-26/My Book.docx"
node src/typeset/typeset-docx.js "…/My Book.docx" --theme tech     # choose a palette
npm run zeph -- build <book-id>                                     # or through zeph
```

The PDF lands in `output/<Form|Grade>/<name>/<name> - typeset.pdf`. Themes live in
`../src/typeset/themes.js`. If you don't pass `--theme`, one is chosen from the file
name, or you can set `"theme"` in the book's `.overrides.json`.

> Manuscripts (`.docx`/`.doc`) are git-ignored; `.overrides.json` files and a book's
> helper images are tracked.
