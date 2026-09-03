# input/ — drop documents to typeset

Put any **non-typeset** Word `.docx` file in this folder, then run:

```bash
npm run typeset:docx          # typesets every .docx in this folder
# or a single file:
node src/typeset/typeset-docx.js "path/to/My Book.docx"
```

The typeset PDF is written to `../output/<name> - typeset.pdf`.

## What gets carried over
- Headings (Word Heading 1/2/3 styles) -> styled topic / section / sub-section headings
- Body paragraphs, with **bold** and *italic* preserved
- Bulleted / numbered list items
- Embedded images
- Tables

The design (Times New Roman, navy/gold, running header + page numbers) lives in
`../src/typeset/generic-template.typ` — edit that to change the look.

> Files in this folder are git-ignored (except this README).
