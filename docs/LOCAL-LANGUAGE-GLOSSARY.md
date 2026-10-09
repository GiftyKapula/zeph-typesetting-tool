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


### More per-book options (local-language Form 1 / ECE batches, October 2026)

| Option | Example | Use |
|---|---|---|
| `untableImages` | `true` | Picture book laid out in Word tables: pictures full size, short labels as headings, a "LABEL:" cell (learning outcomes) as a bold label with plain lines under it. |
| `uniformImages` | `95` | Every picture the same height (mm). |
| `termPages` | `"^TEMU\s*\d+$"` | A matching line gets a page of its own in large type. |
| `keepHeadsWithUnit` | `true` | Headings just before a unit heading open the unit's page with it. |
| `strandPages` | `true` | Each strand with its learning outcomes opens a fresh page (picture books). |
| `restartNumbering` | `true` | Numbered items restart at 1 after each heading; hand-typed "2. …" / "a. …" lines join the list. |
| `imprintSpacing` | `"0.5em"` | Fit a long copyright page on one page (tighter gaps, same text size). |
| `colourHeads` | `["007BB8"]` | Lines the author marked as headings only by colouring them become plain black headings. |
| `lessonLabels` | `true` | Lesson-plan Teacher's Guides ("LABEL: text" lines). |
| `boxStripe` | `false` | No thick left border on boxes (house preference, every new book). |
| `indentLists` | `true` | Every numbered / lettered / roman item indented with its text in one column, including lines the author typed by hand ("1. …", "a………" answer blanks); letters and romans under a numbered question sit one step further in. |
| `imprint` | `{ copyright, rights, isbn, groups: [{ label, lines }] }` | Rewrite a messy copyright page in the house layout (bold "… by:" labels, names centred under them). |
| `glossaryColumns` | `true` | The glossary's tab-separated word list (English word, local word) becomes a two-column list with the "ENGLISH / <LANGUAGE>" titles over their columns; bold "Word: local word" lines become plain entries. |
| `coverWords` | `{ "eyebrow": "Lufunjisho Lwa Sekondali", "form": "Fomu", "booktype": "Buuku wa Mufunjishi", "authors": "Banembi", "contents": "Bijimo", "printedBy": "Walupwilwa naba" }` | The author's own-language words for the cover, spine, title page, contents title and back cover. The running-header pill stays in English. |
| `topSections` | `"^MUTU\s*1\s*\.\s*\d\s*:"` | The book's top level is a numbered topic line the word list does not treat as a unit (Literature in Cinyanja's "MUTU 1.3: …"): each match opens a new top-level section. Contents entries ending in a page number are skipped. |
| `wordFix` | `{ "Culliculum": "Curriculum", "Beatlice": "Beatrice" }` | Whole-word repairs everywhere (text, tables, cover), keeping formatting. For damage from an author's find-and-replace (the Literature in Cinyanja Form 1 TG had every "r" changed to "l", English words included). |
| `subtopicsOnly` | `true` | Only real sub-topics (English "Sub-topic N.N" or the book language's own sub-topic word) stay sub-topics; other Word Heading 2 lines become ordinary headings and leave the contents. |
| `topSectionsMatchCase` | `true` | With `topSections`: match the titles' case exactly (ALL-CAPS topic titles whose words also recur in ordinary case in the text). |
| `phraseFix` | `[["Weruzani tanthauzo ili", "Wunguzani tanthauzo ili"]]` | An author's wording corrections, applied inside every text run (boxes, tables, lists), keeping bold/italic. Runs after the other overrides. |
| `spelling` | `{ "rules": { "ch": "c", "r": "l" }, "keep": ["Literature", "Terry"] }` | A book-wide spelling rule (Zambian Cinyanja writes "c" for "ch" and "l" for "r"). `keep` lists English words and names to leave alone; "ch" after "n"/"t" ("nchito") is never changed. Build `keep` from the book's words that our English books also use, then take out real local words. |
| `listLabels` | `["Mtundu wa otengamo mbali:"]` | A line the author numbered as a list's first item is really its label: it becomes a plain line and the items after it count from the start again. |
| `sourceFix` | `[["ZHAKWALI", "ZHAKWILA"]]` | Correct the manuscript's own text BEFORE anything is recognised from it, so a misspelt box title is still boxed like the others. |
| `insertPictures` | `[{ "find": "INSERT A PICTURE SHOWING…", "file": "generated-images/x.png" }]` | Replace the author's "insert a picture" note with a picture (generated with gpt-image-2, medium, per CONTENT-RULES §9; kept in the book's `generated-images/`). |
| `colonAfterNumber` | `true` | Headings put the colon after the number: "Mutwe Wachihande 1.2.1.1: Kutanga…", "CHIHANDA 3: KUSEKASANA" (also fixes a "1:1.2.4.1" typo). |
| `subSections` | `"^(Chihande\s*:?\s*\d)"` | Make every line matching the regex a sub-topic heading, however the author styled it. |
| `headingCase` | `{ "h1": "upper", "h2": "upper", "head": "sentence", "h3": "sentence" }` | One casing per heading level whatever the author typed (`upper` / `sentence` / `title`). Sentence case also capitalises after a "Vyakulinga 2:" colon. `caseKeep: ["HIV", "Zambia"]` protects names and acronyms. |
| `labelStyle` | `"sentence"` | Lesson labels (Seteko yakunangakana:, Vinoma:…) in bold sentence case at body size with space above. Also converts the same labels typed as headings or as plain capital-letter lines. |
| `tableWidths` | `[{ "find": "Ola (hour)", "widths": [1.25, 1.6, 1] }]` | Fix the column proportions of a table containing `find`. |
| `unboldRange` | `[{ "from": "…", "through": "…" }]` | Un-bold a run of blocks (`from` is inclusive; `after` starts after the match). |

