# Retypesetting a book that came back from CDC

Some books were typeset outside our engine (in Word or CorelDRAW) and came back from CDC as
PDFs with comments. There is no source file, so we make one from the PDF, typeset it with the
engine, attend to every CDC comment, and give CDC a copy with every correction highlighted.

The finished example is Technology Studies Grade 5 TG
(settings in `books-to-typeset/Grade 5 Books/`).

## 1. Convert a copy of the PDF to Word

Keep the CDC PDF as it is (it holds the comments). Convert a copy at
[ilovepdf.com](https://www.ilovepdf.com/pdf_to_word) (PDF to Word). Save the result in
`books-to-typeset/<Grade or Form> Books/`, named after the book,
for example `Technology Studies Grade 5 LB.docx`. That Word file is now the manuscript.

## 2. Start the overrides file

Next to the manuscript, `Technology Studies Grade 5 LB.overrides.json`:

```json
{
  "theme": "techstudies",
  "subject": "Technology Studies",
  "coversInBook": true,
  "boxStripe": false,
  "unwrapTextboxes": true,
  "boxActivities": true,
  "reboxExercises": true,
  "exerciseLeadsOut": true
}
```

- `unwrapTextboxes` is the key option for a converted PDF: the converter puts passages it could
  not flow into floating text boxes, which the engine would otherwise drop. It also removes the
  CDC comment notes that the converter writes into the file as text boxes.
- A Teacher's Guide adds `"blackWhite": true`.
- Use the book's own theme (`biology`, `grade6sci`, `techstudies`…). A primary book should use a
  ZEPH series theme (title page, `~ 1 ~` page numbers).
- Copyright page: set it with `imprint` (see the Technology Studies TG overrides). QA blocks a
  copyright page whose lines are part centred, part flush left.

Build: `node src/typeset/typeset-docx.js "<manuscript>.docx"`.

## 3. Clean up what the conversion broke

Look at every page. Typical repairs (all are override primitives, see `src/typeset/overrides.js`):

| Problem | Fix |
|---|---|
| The old book's contents list became empty topic pages | `removeRange` from the first contents line to the first front-matter heading |
| One paragraph split in two | `mergePara` |
| An activity title glued to its instructions, or broken into several lines | `replaceBlocks` / `replaceRange` with a `label` and a `para` |
| An assessment title lost | `replaceBlocks` with a `head` |

To write anchors, dump the blocks the overrides see:
`ZEPH_BLOCKS=blocks.txt node src/typeset/typeset-docx.js "<manuscript>.docx"` (one line per
block: index, type, text).

## 4. Attend to every CDC comment

List the comments with the text each one highlights:

```
node tools/cdc-comments.mjs "<CDC copy>.pdf" comments.json --print
```

Apply each one in the overrides: `edit` for a word or line, `replaceRange` for a whole exercise
the reviewer rewrote, `insertText` with `items` for a new exercise, `removeRange` for questions
to remove. A comment you cannot apply as written: apply the nearest faithful change and say so
in the log; never invent content.

## 5. QA, the verification copy and the log

1. `node tools/qa/qa.mjs "<manuscript>.docx"` must say QUALIFIES (score >= 99, no blockers).
2. The CDC verification copy: write a plan (one item per comment: where the correction now sits
   and what was done), then
   `node tools/cdc-verify.mjs "<book> - typeset.pdf" plan.json "<book> - CDC verification copy (corrections highlighted).pdf"`.
   Every corrected line is highlighted in purple (a real highlight mark, as a reviewer's highlighter makes) with a note "CDC comment N (page X of the CDC
   copy): … Done: …". Open it and check every highlight sits on the right text.
3. The corrections log (Word): one row per comment (number, CDC page, comment, what we did),
   then other changes and the points for the author.

Rebuild the verification copy whenever the book is rebuilt: the pages move.

The same tool serves an author's marked copy: put `"label": "Author", "copy": "the author's marked copy"`
on the plan and the notes read "Author comment N (page X of the author's marked copy)". For a phrase
that repeats through the book (a heading, a label), give the item `onPage` (the PDF page to start
looking on) instead of a chain of `after` phrases.
