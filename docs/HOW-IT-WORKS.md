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
| **Our parser** (`import-docx.js`) | ~2,700 lines of our own JavaScript | Reads the unzipped XML and recognises structure (headings, boxes, tables, images…) using rules/heuristics we wrote | No |
| **Our theme config** (`themes.js`) | Plain data | Colours, font, layout variant per book | No |
| **Our clean-up + emitter** (`typeset-docx.js` → `passes/`, `overrides.js`, `emit.js`) | Our JavaScript | Turns the recognised structure into Typst markup | No |
| **Typst** (`@myriaddreamin/typst-ts-node-compiler`) | A modern typesetting engine, written in **Rust** | The real workhorse: paginates, lays out, embeds fonts, renders the **PDF** | No |
| **System fonts** (Times New Roman / Century Gothic) | Font files on the PC | Provide the actual letterforms | No |

The other npm packages support the tooling around the engine:

- **`docx`** — writes the author-facing corrections-log report
  (`tools/gen-corrections-log.js`, `npm run report`).
- **`canvas`** + **`pdfjs-dist`** — image clean-up and rendering PDF pages to
  PNG so you can look at them (`tools/dev/pdf-render.mjs`).
- **LibreOffice** (headless `soffice`, installed on the machine) — converts an
  old `.doc` manuscript to `.docx` before it is typeset.

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
        → typeset-docx.js (passes/ + overrides.js → emit.js)       [no AI]

6. Typst lays it out and renders the PDF
        → Typst engine (Rust)                                     [no AI]

7. PDF written to output/
        → Node.js file write                                      [no AI]
```

Every runtime step is deterministic code. **No step calls an AI model.**

## So where *is* AI, exactly?

Two or three places — and the first is the only one that touches *this* engine:

1. **Building the engine (design time, not run time).** Claude wrote the parser,
   the heuristics, the Typst template, the themes, and fixed the reported bugs.
   That intelligence is now "frozen" into plain code. Once written, it runs
   forever without AI. This is the big one: **AI was the author of the tool, not
   a component of it.**

2. **Replacement pictures (optional, separate).** A book's images normally come
   embedded in the author's `.docx`. When one is unusable (too small, a
   screenshot, missing) a replacement may be drawn or generated separately and
   wired in through the book's `.overrides.json`. That is a one-time content
   step, completely outside the typesetting pipeline.

3. **Never the author's text.** The manuscript is the author's own work — the
   engine only re-lays it out; AI doesn't write or alter a word of it.

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
