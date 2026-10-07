# Local-language books (and ECE)

The engine never "reads" a book. It lays a book out by recognising WORDING: a box
title such as `LEARNING ACTIVITY 3`, a front-matter heading such as `FOREWORD`, a unit
banner such as `UNIT 2`. For a book written in a Zambian language it needs that
language's own words for the same things (`Musebezi 3`, `MAZU ATACHI`, `KISHINA 2`).
Those words live in one word list per language, filled in by the authors themselves.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Author form | `npm run lexicon:form` → `admin/local-language-forms/ZEPH Local Language Words Form.docx` | One short Word form for every language: 38 common words (cover, front matter, headings, boxes, back matter) in two columns, *English* / *How you write it*. |
| Returned forms | `admin/local-language-forms/Received Filled-in Forms/*.docx` | What the authors send back. `admin/` is git-ignored: forms carry authors' phone numbers. |
| Importer | `npm run lexicon:import` | Reads every returned form (and the hand-typed ones in `tools/lexicon/manual/`, for scanned PDFs) and writes `src/typeset/lexicon/<language>.json`. Phone numbers are dropped. |
| Corrections | `tools/lexicon/corrections.json` | Wordings we deliberately drop (one author's slip, a word given for two different boxes). Each entry says why. Delete an entry to bring the word back. |
| Word lists | `src/typeset/lexicon/<language>.json` | Every wording any author gave for each concept, plus the words the engine already knew. |
| Engine side | `src/typeset/lexicon/index.js` | Loads the list for the book's language and answers questions such as "is this a box title, and which kind?" or "is this a front-matter heading?". |

The concept list (what each code means, e.g. `activity`, `foreword`, `unit`) is
`tools/lexicon/terms.js`.

## Which language a book uses

Picked automatically from the theme (`nyanja`, `tonga`, `lunda`, `luvale`, `bemba`,
`silozi`, `kaonde`), which itself is picked from the file name. Force it in the book's
overrides with `"language": "kaonde"`. English books load no list, so nothing about
them changes.

## What the word lists switch on

- **Boxes**: a box title in the book's language becomes the right box (activity,
  exercise, end-of-topic assessment, key points, did you know).
- **Front matter**: the language's Author / Foreword / Preface / Acknowledgement /
  Introduction / Competences / Acronyms headings get their own pages and are put into
  the house order (see `orderFrontMatter`). A word that appears many times in the book
  ("Kalambula bwalo" opening every chapter) is NOT treated as the book's Introduction.
- **Units**: a heading, or a short paragraph followed by a number ("KISHINA 1: …"),
  that starts with the language's UNIT word opens a new unit page. When a language
  has a Unit word (Chitonga CIPATI holds several MUTWE topics) only that word is top
  level; when a book uses two Unit words, the less frequent one is the top level.
- **Contents and back matter**: the language's "Table of Contents", "Glossary" and
  "References" headings.

## Adding or fixing a language

1. Send the author the form (`npm run lexicon:form`).
2. Save the returned `.docx` into `admin/local-language-forms/Received Filled-in Forms/`.
   (A scanned PDF: type it into a JSON file in `tools/lexicon/manual/`, copying an
   existing one.)
3. `npm run lexicon:import`, and read its report: it lists any word given for two
   different boxes. Decide, and record the decision in `corrections.json`.
4. A word found in a manuscript but missing from the forms (e.g. the book's own word
   for "Contents") goes into `tools/lexicon/manual/` too, then import again.

## Early Childhood Education (ECE) books

- Detected from the file name (`ECE`, `Early Childhood`). The cover eyebrow reads
  "Early Childhood Education Level" with an `ECE` tag where other books show "Form 1".
- CDC (Table 13, ECE spec): Learner's Book **Avant Garde 18pt** (we use Century Gothic,
  the standard equivalent), 64–112 pages; Teacher's Guide **Arial / Times New Roman
  12pt**, 50–100 pages. Output goes to `output/ECE/`.
- Hand-typed footers ("Page | 4") are removed: the book prints its own page numbers.

### Per-book options built for ECE / local-language books (all opt-in)

| Option | Example | Use |
|---|---|---|
| `untableImages` | `true` | Picture books lay pages out with Word tables. Unpack them: pictures full size, short labels as headings (no boxes). |
| `uniformImages` | `95` | Every picture at the same height (mm); a very wide one fills the width instead. |
| `termPages` | `"^TEMU\\s*\\d+$"` | A matching line ("TEMU 1" = Term 1) gets a page of its own in large type. |
| `centreSection` | `["NEMBI"]` | Centre a whole front-matter page. |
| `keepHeadsWithUnit` | `true` | Headings just before a unit heading open the unit's page with it. |
| `lessonLabels` | `true` | Lesson-plan Teacher's Guides: bold "LABEL:" lines, MUTWE lines as headings, numbered steps restart under each label and nest (i., ii. one level further). |
| `boxStripe` | `false` | No thick left border on activity / exercise / assessment boxes (house preference). |
| `localLabels` | `true` | Cover, title page and running header in the book's language, from its word list: level (`level_primary`…), `grade` / `form`, `teachers_guide` / `learners_book`, `authors_label` (Chitonga: LWIIYO LWA PULAIMALI · GILEDI 1 · BBUKU LYABAYI · BALEMBI). A label missing from the list stays English. Check the words first: a level phrase that contains the Form word (Lunda's "…Fomu 1 -4") breaks the cover. |

Every Teacher's Guide is black and white inside with a colour cover (the engine's
default for TG file names).
