# How it works — the tools behind the engine (and where AI is / isn't)

A plain-English walkthrough of what actually runs when you typeset a book, which
engines do the work, and exactly where AI is involved.

## The most important thing to understand

**The typesetting engine itself contains no AI.** When you run
`npm run typeset:docx`, no AI model is called, nothing goes to the cloud, and the
output is 100% deterministic — the same `.docx` always produces the same PDF.
It's ordinary software: a parser plus a typesetting engine.

AI's role is **building** this software (Claude writing the code with the author)
and, separately and optionally, **generating illustrations**. Those are different
from the engine *running*.

> Think of it like a coffee machine: an engineer (AI, at design time) built it;
> but when you press the button (run the tool), it's pure mechanics — no engineer
> inside.

## The runtime toolchain (what actually executes)

| Tool / engine | What it is | What it does here | AI? |
|---|---|---|---|
| **Node.js** | JavaScript runtime | Runs all our scripts | No |
| **JSZip** (`jszip`) | Zip library | A `.docx` is a zip file; this unpacks it in memory | No |
| **Our parser** (`import-docx.js`) | ~500 lines of our own JavaScript | Reads the unzipped XML and recognises structure (headings, boxes, tables, images…) using rules/heuristics we wrote | No |
| **Our theme config** (`themes.js`) | Plain data | Colours, font, layout variant per book | No |
| **Our emitter** (`typeset-docx.js`) | Our JavaScript | Turns the recognised structure into Typst markup | No |
| **Typst** (`@myriaddreamin/typst-ts-node-compiler`) | A modern typesetting engine, written in **Rust** | The real workhorse: paginates, lays out, embeds fonts, renders the **PDF** | No |
| **System fonts** (Times New Roman / Century Gothic) | Font files on the PC | Provide the actual letterforms | No |

The other npm packages are for the *separate* "generate the PE book from code"
path, not the import path:

- **`docx`** — builds Word `.docx` files programmatically (used by `assemble.js`
  to author the Form 5 PE books).
- **LibreOffice** (headless `soffice`, installed on the machine) — converts those
  generated `.docx` files to PDF and scans page numbers for their table of
  contents.

## Step by step — which tool, and is AI involved?

```
1. You drop a .docx in books-to-typeset/
        → no tool, just a file                                    [no AI]

2. JSZip unzips it → raw Word XML
        → jszip                                                   [no AI]

3. Our parser reads the XML and labels everything
   (cover, headings, Activity/Exercise boxes, tables, images…)
        → import-docx.js (our hand-written rules)                 [no AI]

4. A theme is chosen (colours, font, layout)
        → themes.js + filename/flag                               [no AI]

5. The structure is turned into Typst markup
        → typeset-docx.js                                         [no AI]

6. Typst lays it out and renders the PDF
        → Typst engine (Rust)                                     [no AI]

7. PDF written to output/
        → Node.js file write                                      [no AI]
```

Every runtime step is deterministic code. **No step calls an AI model.**

## So where *is* AI, exactly?

Three places — and the first is the only one that touches *this* engine:

1. **Building the engine (design time, not run time).** Claude wrote the parser,
   the heuristics, the Typst template, the themes, and fixed the reported bugs.
   That intelligence is now "frozen" into plain code. Once written, it runs
   forever without AI. This is the big one: **AI was the author of the tool, not
   a component of it.**

2. **Illustrations (optional, separate).** For the **PE Form 5** book,
   `genimage.js` calls **OpenAI's image model (`gpt-image-2`)** to generate the
   photographs/diagrams. That *is* a live AI call — but it's a one-time
   content-creation step, completely outside the typesetting pipeline. For the
   **Grade 4 Technology** book, the images came already embedded in the `.docx`,
   so **no AI images were involved there at all.**

3. **Authoring the text (only for books we wrote).** The PE Form 5
   learner/teacher *content* was written with AI assistance. For the Grade 4
   book, the manuscript was the author's existing text — AI didn't write or alter
   a word of it; the engine only re-laid it out.

## One-line summary

> **Typst** (a Rust typesetting engine) does the actual page rendering; **our own
> JavaScript** (with JSZip) does the reading and structuring; **AI built that
> software and, optionally, draws illustrations** — but the engine that turns a
> `.docx` into a designed PDF runs with **zero AI in the loop**.

## Does it work for books in a local language?

**Yes.** The engine never tries to "understand" the language — it works from the
document's *structure* (Word styles, table shapes, box labels, image positions),
not the meaning of the words. Body text, headings and paragraphs are copied
through verbatim and rendered by Typst, which has full Unicode support. So a book
in Bemba, Nyanja, Tonga, Lozi, etc. typesets the same way an English one does.

Two practical things to keep in mind:

1. **Box detection is keyed on English labels.** Boxes are currently recognised
   by titles like `LEARNING ACTIVITY`, `Exercise`, `ASSESSMENT`, `Key Points`,
   `Did You Know`. If a local-language book labels these in that language (e.g.
   *"Nchito"* instead of *"Activity"*), those boxes would fall back to plain
   tables until we add the local words to the matcher in `import-docx.js`
   (`boxKindFromTitle`). This is a quick, one-line-per-label addition.

2. **Fonts must cover the characters used.** Standard Zambian-language text uses
   the normal Latin alphabet, so Times New Roman / Century Gothic already cover
   it. Only if a language needs special diacritics or a non-Latin script would we
   point the theme at a font that includes those glyphs (a one-line change in
   `themes.js`).

Neither limitation is about the engine "not knowing" the language — both are just
small configuration additions (a few label words, or a font name).
