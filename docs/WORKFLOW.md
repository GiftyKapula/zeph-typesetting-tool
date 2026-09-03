# Book workflow — the `zeph` tool

Once you typeset many books that go out for proofreading and come back marked
up, filenames stop being a reliable identity ("Draft 4", "sent for review",
"…(2)", "final FINAL"). `zeph` gives every book a stable identity and records
its whole life in a single local SQLite file (`zeph.db`).

- **Local, zero-install.** Uses Node's built-in SQLite (`node:sqlite`). No
  server, no cloud, no Supabase. The DB is one file at the repo root.
- **Register in place.** `zeph` never moves or copies your files. It stores the
  *path* to where each file already sits, plus a content hash so the same book
  under a new name is recognised as a new *version*, not a new book.
- **Version control.** `zeph.db` is git-ignored; run `zeph export` to write
  `books.json`, a human-readable snapshot you commit alongside the code.

Run everything through npm (it adds the required `--experimental-sqlite` flag):

```bash
npm run zeph -- <command> [args]
```

## The data model

| table     | what it is                                                            |
|-----------|-----------------------------------------------------------------------|
| `book`    | one row per book (stable id, grade, subject, kind LB/TG, theme, state)|
| `version` | every file that belongs to a book — manuscript, overrides, typeset PDF, annotated PDF, corrections log — identified by content hash |
| `round`   | one proofreading cycle: what was sent, what came back, when           |
| `comment` | one reviewer note in a round: page, anchored text, note, status       |

Book id is derived from `grade + subject + kind`, so every draft of the same
book collapses onto one identity and becomes another `version`. When two files
disagree on the subject string and split into two books, fold them back with
`zeph merge`.

## Lifecycle

```
drafting → typesetting → sent-for-proofread → returned
        → applying-corrections → approved → published
```

`build` moves a book from `drafting` to `typesetting`; `send` to
`sent-for-proofread`; `return` to `returned`. Set any state by hand with
`zeph state <book> <state>`.

## Commands

| command | what it does |
|---------|--------------|
| `import <dir>` | walk `<dir>`, register every `.docx` (+ its `.overrides.json`) as a book, in place |
| `list [--state s]` | list all books, their state, version count, open comment count |
| `show <book>` | full detail: versions, rounds, comment tallies |
| `where <book>` | print the latest file path of each kind for a book |
| `add <book> <file>` | attach any file (pdf/docx/log) to a book as a version |
| `build <book>` | typeset the latest manuscript (runs `src/typeset/typeset-docx.js`) |
| `send <book> [pdf]` | open a new proofread round; record the sent PDF if given |
| `return <book> <file>` | ingest the marked-up copy; auto-extract its comments into the round |
| `comments <book> [--open]` | list the latest round's comments (`--open` = only unresolved) |
| `resolve <comment-id> [--action "…"] [--flag] [--wontfix]` | close a comment |
| `state <book> [newstate]` | get or set a book's lifecycle state |
| `merge <src> <dst>` | fold book `src` into `dst` (reconcile a split identity) |
| `export` | write `books.json` (commit this) |

Book ids can be abbreviated to any unique substring, e.g.
`npm run zeph -- show technology-studies-tg`.

## Comment extraction

`return` reads reviewer feedback directly from the returned file:

- **Annotated PDF** — highlights, sticky notes and text markups, with the
  highlighted text captured as the comment's anchor and the reviewer's note as
  the comment. (`tools/lib/pdf-comments.js`, via `pdfjs-dist`.)
- **Word `.docx`** — Word review *comments* (`word/comments.xml`) *and* tracked
  changes (insertions/deletions). (`tools/lib/docx-comments.js`, via `jszip`.)

Extraction is best-effort: it captures what the file actually contains. Review
the results with `zeph comments`, then resolve each one, recording how you fixed
it (usually an overrides key) in the `--action`.

## Corrections log — the report you send back to the author

After a round is worked, send the author a document showing every comment they
left and, in plain English, what was done about it:

```bash
npm run report -- <book-id>
#   → proofread-books/<Book Title> - corrections log.docx
```

It reads the comments straight from `zeph.db` and produces a tidy 4-column Word
table: **Page · Passage in the book · Your comment · What was done**. Two things
it does for you automatically:

- **Real printed page numbers.** A reviewer's note is anchored to the *physical*
  PDF page (stored in `comment.page_ref`), which is not the number printed at the
  foot of the page (front matter is roman; the body starts at 1 several leaves
  in). The tool opens the typeset PDF, reads the actual footer on every page, and
  prints the number the author will actually see. The physical→printed offset is
  *measured* from the PDF, so it is correct for any book.
- **Plain language.** Our internal resolution notes (override primitive names,
  "verified p42" breadcrumbs, `~N~` footer notation…) are stripped, so the author
  reads "Removed the whole STEPS block as requested." not `deleteRun: …`.

Options: `--pdf <path>` (force which typeset PDF to read footers from — otherwise
it finds the book's `… - typeset.pdf` under `output/`), `--reviewers "A, B"`
(defaults to the book's recorded authors), `--out <path>` (defaults to
`proofread-books/`). The generated `.docx` is git-ignored; regenerate it any time
from the database. Implementation: `tools/gen-corrections-log.js`.

## Viewing the database directly

`zeph.db` is an ordinary SQLite file, so you can inspect it any way you like:

- **Through zeph (no extra tools).** `npm run zeph -- list`, `show <book>`,
  `comments <book>` cover most day-to-day needs.
- **A GUI (easiest for browsing).** Install **DB Browser for SQLite**
  (free, <https://sqlitebrowser.org>) and open `zeph.db`. The *Browse Data* tab
  lets you page through the `book` / `version` / `round` / `comment` tables and
  run filters without writing SQL. (In VS Code, the *SQLite Viewer* extension
  does the same inside the editor.)
- **Ad-hoc SQL from Node** (already installed, no new dependency):

  ```bash
  node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite'); \
    const db=new DatabaseSync('./zeph.db'); \
    console.table(db.prepare('SELECT id,title,state FROM book').all());"
  ```

  Handy queries: all comments for a book —
  `SELECT page_ref,note,action FROM comment WHERE round_id IN (SELECT id FROM round WHERE book_id='…')`;
  open comments only — add `AND status='pending'`.

> The `~$…` files Word leaves next to an open `.docx` are lock files — you can't
> overwrite or delete a document (e.g. re-run `npm run report`) while it is open
> in Word. Close it first.

## A typical run

```bash
# first time: register everything you already have
npm run zeph -- import books-to-typeset

# take a book through a round
npm run zeph -- build  grade-3-...-tg
npm run zeph -- send   grade-3-...-tg "output/…/… - typeset.pdf"
#   (reviewer marks it up, sends it back)
npm run zeph -- return grade-3-...-tg "C:/Users/…/Downloads/… with comments.pdf"
npm run zeph -- comments grade-3-...-tg --open
npm run zeph -- resolve 42 --action "setCaption override on fig 3.2"
npm run report -- grade-3-...-tg          # corrections log for the author
npm run zeph -- export                    # snapshot -> books.json, commit it
```
