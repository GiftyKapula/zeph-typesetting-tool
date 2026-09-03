# books-to-typeset/ — drop whole books here

Put any **non-typeset** Word `.docx` book in this folder and run:

```bash
npm run typeset:docx                                  # typeset every book here
node src/typeset/typeset-docx.js "My Book.docx"       # a single file
node src/typeset/typeset-docx.js "My Book.docx" --theme tech   # choose a palette
```

The typeset PDF is written to `../output/<name> - typeset.pdf`.

## Themes (palette + font + layout)
Each book can have its own professional look — colours, font, and a `variant`
that changes the layout. Themes live in `../src/typeset/themes.js`:

- **navy** — Times New Roman, navy + gold, classic layout (Physical Education)
- **tech** — Century Gothic, blue + orange, modern layout (Technology Studies)

If you don't pass `--theme`, one is chosen from the file name (e.g. a name
containing "Technology" uses **tech**). Add your own theme by copying a block in
`themes.js`.

## Front matter handled automatically
- a designed **cover** (subject + grade + book type + the hero image on page 1)
- the **imprint** page (kept centred)
- a freshly built **table of contents** with correct page numbers and dot
  leaders (the source TOC's original page numbers don't match the new layout, so
  they're recomputed)

## What the engine recognises automatically
- Topic openers (`TOPIC N: …` headings) and front-matter headings
- Sub-topic and section headings (Word Heading styles)
- **Learning Activity / Exercise / Key Points / Did You Know / Assessment** boxes
  — detected by their title text, so it works across books that use different
  colours
- Figures + captions, real data tables, bold/italic, bullet lists

> Files in this folder are git-ignored (except this README).
