# Getting started — from `git clone` to a delivered book

A full walkthrough for someone new to this tool. If you just need the command
reference, `README.md` and `docs/WORKFLOW.md` are shorter; this doc is the
hand-holding version, done once.

## 1. Install

```bash
git clone https://github.com/GiftyKapula/zeph-typesetting-tool.git
cd zeph-typesetting-tool
npm install
```

You also need **LibreOffice** installed (used headless, in the background — you
won't open the app). Get it from <https://www.libreoffice.org/download/>.

Two places in the codebase have a Windows path to `soffice.exe` hard-coded:
search for `soffice.exe` in `tools/gen-corrections-log.js` and
`tools/lib/pdf-comments.js`. If your install isn't at
`C:\Program Files\LibreOffice\program\soffice.exe`, update it there. (The core
`typeset:docx` path doesn't call LibreOffice at all — only the corrections-log
report and some PDF comment extraction do.)

That's the whole setup. **Typst** (the actual typesetting engine) ships as an
npm dependency — nothing else to install.

## 2. Typeset your first book

Drop a `.docx` manuscript into `books-to-typeset/`, then:

```bash
npm run typeset:docx
```

This typesets *every* `.docx` in that folder. To do just one file, or to pick a
theme explicitly instead of letting the engine guess one from the filename:

```bash
node src/typeset/typeset-docx.js "books-to-typeset/My Book.docx"
node src/typeset/typeset-docx.js "books-to-typeset/My Book.docx" --theme tech
```

Open `output/<Book Name>/<Book Name> - typeset.pdf`. **Look at it** — at least
the cover, the table of contents, and a page with a boxed activity/exercise —
before trusting it. Typical first-pass issues and where to fix them:

| You see... | Fix in... |
|---|---|
| Wrong palette/font | `--theme <name>` flag, or add a `theme` override, or teach `autoTheme()` in `src/typeset/themes.js` to recognise this filename pattern |
| A heading in the wrong colour/size, or not picked up as a heading at all | Usually a per-book fix via `<book>.overrides.json` (see `docs/HOUSE-STYLE.md` for every key) |
| An "Activity"/"Exercise" heading not boxed | Check its exact wording against `boxKindFromTitle()` in `src/typeset/import-docx.js` — if it's a real gap in the recognised patterns, that's an engine fix, not an override |
| Blank cover, duplicated title lines, wrong author | `coverImage` / `authors` / `synthesiseCover` overrides |
| A whole book in the wrong colour scheme (should be black & white) | `blackWhite: true` override |

## 3. Fix it with an override, not by hand-editing the manuscript

Create `books-to-typeset/My Book.overrides.json` (same name as the `.docx`,
`.overrides.json` instead of `.docx`):

```json
{
  "coverImage": "../../images/cov-my-book.png",
  "blackWhite": true,
  "recase": [{ "startsWith": "Specific Competence", "to": "sentence" }]
}
```

Re-run `npm run typeset:docx` (or the single-file command above) and check the
PDF again. **This loop — typeset, look at the actual rendered pages, adjust the
override, repeat — is the whole job.** The manuscript itself stays untouched;
every fix is visible, version-controlled JSON sitting next to it. See
`docs/HOUSE-STYLE.md` §5 for the full key reference, and
`docs/SERIES-GUIDELINES.md` if this is a ZEPH series book (the `english`
theme's house style checklist).

## 4. Track it with `zeph` once you're juggling more than one book

Filenames stop being a reliable identity fast ("Draft 4", "sent for review",
"final FINAL"). `zeph` gives every book a stable id and tracks its whole life:

```bash
npm run zeph -- import books-to-typeset   # register everything you have, in place
npm run zeph -- list                      # every book + its lifecycle state
npm run zeph -- build <book-id>           # typeset the latest manuscript (same as step 2, but tracked)
```

Book ids can be abbreviated to any unique substring
(`npm run zeph -- show my-book`). Full command reference and the proofreading
round lifecycle: `docs/WORKFLOW.md`.

## 5. Send it out, get it back, work the comments

```bash
npm run zeph -- send   <book-id> "output/.../My Book - typeset.pdf"
# reviewer marks it up (PDF highlights+notes, or Word comments/tracked changes)
# ... drop the returned file in proofread-books/, then:
npm run zeph -- return <book-id> "proofread-books/My Book - reviewed.pdf"
npm run zeph -- comments <book-id> --open
```

Work through the list. For each comment, fix it (almost always via an override
— see step 3) and close it out with what you actually did:

```bash
npm run zeph -- resolve 42 --action "blackWhite override applied"
```

Rebuild (`npm run zeph -- build <book-id>`) and re-check the PDF after fixes,
the same as step 2.

## 6. Send the author a corrections log

```bash
npm run report -- <book-id>
#   → proofread-books/<Book Title> - corrections log.docx
```

A tidy Word table — page, the passage in the book, their comment, what was
done — with real *printed* page numbers (not raw PDF page indices) and plain
language (no internal jargon like override key names). Details:
`docs/WORKFLOW.md`.

## 7. Snapshot your work

```bash
npm run zeph -- export     # writes books.json — commit this
git add books-to-typeset/*.overrides.json books.json
git commit -m "Typeset My Book"
```

`zeph.db` itself is git-ignored (it's a local database file); `books.json` is
the committable, human-readable snapshot of it.

## Troubleshooting

- **"Cannot find module..."** — run `npm install` again; if it's a native
  module (`canvas`, the Typst compiler), make sure you're on a supported
  Node version (v18+) and platform.
- **A `.doc` (old binary Word format) won't parse** — convert it first:
  `soffice --headless -env:UserInstallation=file:///C:/temp/loconv --convert-to docx --outdir <dir> "<file>.doc"`.
- **Can't overwrite/regenerate a `.docx`** — Word leaves a `~$…` lock file next
  to any document it has open. Close it in Word first.
- **The typeset PDF looks right in your PDF viewer but wrong when I check
  page numbers** — front matter is numbered in roman numerals and the body
  restarts at 1, so a raw PDF page index and the number printed at the foot of
  the page are different things. `zeph`'s corrections-log report handles this
  conversion for you; if you're checking by hand, read the number printed on
  the page, not the PDF viewer's page counter.
- **Something looks subtly wrong and you're not sure why** — check the actual
  manuscript's raw XML before guessing. A `.docx` is a zip; the quickest way
  in Node:
  ```bash
  node -e "const JSZip=require('jszip'),fs=require('fs'); \
    JSZip.loadAsync(fs.readFileSync('books-to-typeset/My Book.docx')) \
      .then(z=>z.file('word/document.xml').async('string')) \
      .then(xml=>console.log(xml.slice(0,2000)))"
  ```
  Formatting bugs are often exactly what the XML says and nothing like what
  you'd assume from how it looks in Word.

## Working with Claude Code

If you're driving this tool through Claude Code rather than typing every
command by hand, see **`CLAUDE.md`** at the repo root — it's read automatically
and covers the same loop (typeset → look at the actual PDF → fix via override →
repeat) plus the habits that matter when an AI agent is the one running the
commands.
