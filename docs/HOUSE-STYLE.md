# ZEPH Typesetting House Style — the authoritative guide

This is the **gospel** for typesetting every book with the engine. It is derived
strictly from how we actually typeset the reference books (English, Physics,
Biology). The **English Form 4 Learner's Book is the reference standard**: when in
doubt, match English. New books should need only a few per-book revisions because
everything below is handled by the shared engine.

See also: `TYPESETTING.md` (themes table + variants), `SERIES-GUIDELINES.md`
(ZEPH B5 front-matter detail), `LOCAL-LANGUAGE-GLOSSARY.md` (label translations).

---

## 1. One engine, per-book theme

`node src/typeset/typeset-docx.js "<book>.docx"` typesets one book. The theme is
auto-picked from the file name (`autoTheme` in `themes.js`); override with
`--theme <name>`. A theme sets colours, fonts, and a **variant** (the layout).

Build a ZEPH house-style theme with the `zeph({...})` factory in `themes.js`
(English/Physics/Biology family): pass a subject, a palette, and a variant; box
colours are derived from the palette automatically.

## 2. Variants — pick by content, not by subject

| Variant | Boxes? | Use for |
|---|---|---|
| `series` | flat (activities → headings) **but table-wrapped boxes are kept** | English; **all local-language books**; prose-heavy subjects |
| `science` | boxed (Learning Activities / Exercises in coloured boxes) | activity-heavy subjects (Physics, Biology, Maths, Computer Science, Grade 6 Science) |
| `classic` / `modern` / `literary` / `panel` | boxed, distinct identities | older standalone books (PE, Tech, earlier Lunda/Cinyanja) |

**Local languages follow English (`series`).** `series` gives the English flat
house style *and still renders a box for any activity/exercise the manuscript
puts in a table* — so we never force-flatten a real box, and never force a box
where the writer used flowing text.

## 2a. CDC syllabuses (`syllabus`) — the demo book defines the structure

The CDC landscape curriculum syllabuses are their own book family: A4
landscape, a 5-column matrix interior (TOPIC · SUB-TOPIC · SPECIFIC COMPETENCE
· SUGGESTED LEARNING ACTIVITIES · EXPECTED STANDARD) with a grey header row
repeated on every page, and a two-panel spread cover.

**The reference ("demo") book is the Travel and Tourism TED syllabus**, kept at
`reference/Travel and Tourism TED Syllabus - DEMO BOOK.pdf`. Measure any new
syllabus against it page by page — a clean build log says nothing about whether
the structure is right. Only its typeset PDF exists (no `.docx`), so it is a
*visual* reference; pick a different book for an end-to-end regression run.

**Front matter order, which the engine now enforces for every book in the
family** (page numbering in brackets):

| Page | Content | Folio |
|---|---|---|
| 1 | Cover **spread** — back panel left, front panel right, one sheet | none |
| 2 | Title page — black-and-white echo of the cover | none |
| 3 | Copyright notice + ISBN/publisher/printer imprint | roman, hidden |
| 4– | **Table of Contents** — generated, real page numbers + dot leaders | roman, hidden |
| next | Vision / Preface / Acknowledgement / Introduction — **each on its own page** | roman, visible |
| then | Level divider page (e.g. "SECONDARY TEACHER'S DIPLOMA") | **arabic 1** |
| then | Competences & Descriptors | arabic |
| then | **A divider page for the level of the matrix that follows** (`YEAR 1`, `FORM 1`, `GRADE 1`) — a full page, set like the level divider — then that level's matrix from the head of the next page. One before each year's matrix. Standard from 2026-10-12 | arabic |

**Heading levels**, also enforced — a manuscript's own styling is normalised to
these, because two books in the family were heading their pages three different
ways:

| Level | Set as | Used for |
|---|---|---|
| **top-level** (`h1`) | **BOLD CAPS + short rule, own page**, level-1 contents entry | Vision, Preface, Acknowledgement, Background/Introduction; and at the back Appendices, Glossary, References, Prescribed Textbooks |
| **sub-section** (`h2`) | **tracked BOLD CAPS**, flows, level-2 contents entry | Rationale, Aim, Outcomes, Admission Requirements, Assessment, Course Description, Competences and Descriptors, Time Allocation … |
| year / form / grade line (`h2`, matched by name) | a **divider page** of its own (it was a filled banner over the matrix until 2026-10-12), level-1 entry | `YEAR 1` / `FIRST YEAR` / `FORM 1` / `GRADE 1` |
| data line (`label`) | plain bold, not a heading, not in contents | `Total 40%`, `CA + EXAM = 100%` |

Past the matrix a section title is only recognised when it carries **no digit** —
that is what keeps the assessment weightings out of the heading stream.

Two more rules, both automatic:

- **The contents page always sits directly after the copyright page**, before
  the prose front matter — wherever the manuscript happened to type its own.
- **A top-level front-matter section always opens a new page.** Top-level means
  one of the standard CDC divisions by name (Vision, Mission, Foreword,
  Preface, Acknowledgement(s), Background, Introduction), or — when the
  manuscript's casing distinguishes them — an ALL-CAPS heading. Everything else
  (Rationale, Aim, Outcomes, Admission Requirements, Assessment, Time
  Allocation …) flows on beneath its parent as a sub-section, exactly as the
  demo book's sub-sections flow under Introduction.

**Column casing in the tables** — normalised by the engine, because manuscripts
are inconsistent about it (one book typed its early topics in caps and its
later ones in title case; another typed its competences in title case):

| Column | Set as |
|---|---|
| matrix **TOPIC** | **BOLD UPPERCASE** |
| matrix **SUB-TOPIC** | bold title case — *not* uppercase |
| matrix SPECIFIC COMPETENCE / ACTIVITIES / EXPECTED STANDARD | sentence case |
| competences table **COMPETENCE** | a capital on each word, the rest small ("Analytical Thinking", "Creativity and Innovation") — *not* uppercase. Standard from 2026-10-12; this column only |
| competences table DESCRIPTORS | sentence case |

The competence column is found by its own header wherever it sits, so a table
that numbers its rows (`S/N | COMPETENCE | DESCRIPTORS`) is handled as well as
the reference's two-column one.

**Course-outline manuscripts** (Guidance and Counselling is the first) differ
from the full syllabuses in four ways, all handled by the engine:

- Sections are one numbered Word list (`1. COURSE NAME: …`, `3. GENERAL
  COMPETENCES AND DESCRIPTORS`, `6. ASSESSMENT METHODS AND WEIGHTING`). A
  bold-caps top-level item becomes the usual unnumbered section head; the
  weightings keep their own `6.1` / `6.1.1` numbers.
- The matrix may lead with a **TERM** column. The topic column is found by its
  header, so TERM sets narrow, bold and centred and merges down like TOPIC.
- A row merged across the matrix is lifted out of it: `YEAR 1` / `YEAR 2`
  become the YEAR banner, any other (`END OF YEAR 1 FINAL EXAMINATIONS`) a
  centred bold line under the stretch of matrix it closes.
- Clauses hand-wrapped inside a cell with line breaks and spaces are rejoined,
  and a number glued to its text (`1.1.2.1Differentiate`) gets its space. A
  real list stacked under a clause keeps its lines.

Three more, from the Autism Spectrum Disorder syllabus:

- **A short matrix row never splits across a page** (every cell 160 characters
  or fewer). A row with a long cell still breaks, as does nothing that opens a
  topic.
- **A section title that comes round twice is two sections** (`Time Allocation`
  in the front matter, `TIME ALLOCATION` again after the weightings). The
  portrait books' rule that drops a repeated heading is off for this family.
- A back-matter title naming two things (`REFERENCES/PRESCRIBED READING`) keeps
  its own wording, and a cover whose artwork imports as a *row* of pictures is
  dropped like any other cover artwork.

Six more, from the Physical Education and Sport syllabus:

- **A matrix header typed over two lines** (`EXPECTED⏎STANDARD`) is one line. With
  the break in it the first row was not taken for the header at all: no grey row,
  no repeat on each page, no topics in the contents.
- **One year's matrix typed as two Word tables** with the same header row and
  nothing between them is one matrix.
- **The activities column keeps the manuscript's own structure when a cell mixes
  bulleted and unbulleted lines.** A bulleted line is an activity. An unbulleted
  bold line is the teaching *method* the activities under it belong to
  (`Discussion method`) and sets flush left with no bullet. Any other unbulleted
  line runs on from the activity above it when it opens with a bracket, an
  ellipsis or a small letter, or is in italics (`(Bandages, scissors, GV paint…)`);
  otherwise it is an activity whose bullet was left off. A cell with no bullets
  at all, or with one on every line, is bulleted line by line as before — except
  a cell with no bullets laid out as method / activities (History Methods types
  `Research` / `Researching on …` as plain paragraphs alike): it opens on a line
  wholly in bold, ends on a plain one, every line is wholly bold or wholly plain,
  and no two bold lines stand together. Its bold lines are methods. A cell where
  the author bolded some activities (two bold lines running, a half-bold line)
  keeps every bullet. A method line drops the spaces typed in front of it.
- **The competences section is found by what it heads** when its title names no
  "descriptors" (`KEY COMPETENCES`): the heading over the COMPETENCES |
  DESCRIPTORS table opens the body (level divider, arabic page 1).
- **A SCOPE AND SEQUENCE CHART is a top-level division** (own page, level-1
  contents entry), like the reference lists; `PRESCRIBED REFERENCES` is one too.
- A signatory typed as one paragraph with line breaks (name / office / MINISTRY OF
  EDUCATION) is set like one typed as three; a topic column whose titles are all
  short is still wide enough for its longest word (`ENTREPRENEURSHIP`).

**Matrix numbers that are all Word list numbers** (none typed) are often wrong on
the page: the lists restart, change list mid-topic and go on counting in the
merged cells under a topic (topics `1.5, 1.5, 1.6, 1.12, 1.7`; a bare `1.3` in an
empty cell). Check the raw OOXML (`<w:numPr>` in the cell, no digits in its
`<w:t>`) and, if that is what the manuscript has, set `renumberMatrix` in the
sidecar (§5) and record it there for the author. Where the numbers are typed,
they stay exactly as written.

A manuscript that holds the whole syllabus twice (one copy pasted after the
other) is a per-book repair, not an engine rule: compare the two copies cell by
cell before choosing — in the Autism syllabus they differed in the matrix
numbering — and drop one with `removeRange`, recording the choice in the sidecar.

The level on the cover comes from the file name's closing clause, which may
list several (`ECE - PRIMARY - SEC.` → "Early Childhood, Primary and Secondary
Teachers' Diploma").

Four more, from the Music Methods syllabus:

- **A file named `… TED` is a syllabus** even with the word "syllabus" left out
  (`MUSIC METHODS VALIDATED TED (5)`); it used to typeset as a portrait
  learner's book. A download's copy counter (`(5)`) is dropped from the subject.
- **When the file name gives no level or year**, the sidecar's `level` and
  `year` supply them (with `subject`, they also feed the footer masthead). Take
  them from the manuscript's own cover and copyright line.
- **A section headed only `KEY COMPETENCES`** (or General / Core) opens the body
  — level divider, arabic page 1 — like `Competences and Descriptors`.
- **A topic's opening row that is taller than a page breaks** (a cell of about
  900 characters or more). Held whole it ran off the foot of the sheet.

A matrix that runs both years as one unbroken table gets its second YEAR banner
from the sidecar: `insertRow` puts a merged `YEAR 2` row before the second
year's first topic, and the merged-row rule above lifts it out as the banner.

**Cover colour — no two syllabuses share one.** The three named themes have
their own (Travel and Tourism orange, Special Education teal, Devices indigo).
Every other syllabus used to print on the generic theme's single grey; it now
takes a colour picked from a fixed palette by the subject in its file name, so
the same book always gets the same colour. Only the cover spread carries it —
the title page and interior stay black and white. Two subjects can land on the
same or a near colour: lay the covers side by side when a new syllabus comes in,
and give one of them a `coverColour` (hex) in its sidecar, as Guidance and
Counselling has.

Cover geometry: the white title band is fixed (it has to line up across the
spread), so it divides each panel into an above-band and a below-band zone, and
each zone's content is centred in it both ways. Don't reintroduce hand-tuned
`dy` offsets.

## 3. ZEPH house style (shared by `series` + `science`)

- **B5** (176×250 mm); margins top 19 / bottom 16 / x 17 mm.
- **Fonts:** body + interior headings **Arial**; cover/title-page **Segoe UI**;
  running header **Times New Roman** italic. (Body text is **12 pt**.)
- **Front matter order:** cover → repeated title page → copyright/imprint → TOC →
  Authors → Foreword → Preface → Acknowledgement → Introduction → (Key
  Competences / Acronyms) → body.
- **Numbering:** silent roman from the title page, visible from ~Authors;
  arabic restarts at the first TOPIC/UNIT. Footer tilde `~ n ~`.
- **Cover by grade:** same grade = same cover **layout**, differing only by the
  theme's signature colour (centred masthead: eyebrow → big subject → accent rule
  → FORM tag → book type → hero photo → AUTHORS → logo).
- **Signatory** name is **bold**; title/org normal, kept as one tight block with
  ~16 mm signature space above.

## 4. Conventions baked into the engine (don't re-solve these)

- **Boxes are breakable** by default (long ones flow across pages); a box title is
  **sticky** so it never sits alone at the foot of a page.
- **Question numbering** (exercises/assessments): top items renumber 1..N (always
  start at 1); sub-parts a/b/c reset under each parent; literal "(a)" the writer
  typed is honoured and nests; a bare number above its figure is moved above it.
- **Tables**: text at body size (12 pt; ≥5-col tables step to 10 pt). A figure
  caption "Fig N:" / "Figure N:" attaches to its image.
- **Illustrations** are kept large for accessibility (small source diagrams are
  scaled up; CDC flags tiny pictures).
- **Acronyms** render "ABBR: full" (colon), preserving the writer's bold capitals.
- **Lists** keep the writer's real markers (a/b/c, 1/2/3, i/ii), not forced bullets.
- Stray artifacts (lone punctuation / single letters) are dropped.

## 5. Per-book revisions — the override sidecar

Editorial fixes live in `<book>.overrides.json` next to the `.docx` (manuscript
stays pristine, fixes are version-controlled). All keys are optional and default
off, so a change only touches the books that opt in. Keys:

**Cover / metadata / images**

| Key | What it does |
|---|---|
| `isbn` | ISBN on the imprint + back cover (no barcode) |
| `coverImage` | inject a cover photo (book with no hero image); path relative to the `.docx` |
| `finishedCover` | the manuscript's own cover page image is already a complete, publication-ready cover (title, book type, authors, publisher/logo all baked into the graphic) rather than a plain hero photo — render it full-bleed and skip every template overlay (title text, byline, logo, motif), which would otherwise duplicate what the image already shows. Explicit opt-in only (a full-bleed image doesn't by itself say whether it's "finished" or just a big photo); the title page and back cover still get their normal templated text, synthesised from the theme's subject as usual |
| `authors` | override the author list (e.g. split "A and B" into two so the cover reads "AUTHORS"); an empty array (`[]`) hides the author byline on the cover entirely — when omitted, the engine already falls back to the names it finds in the manuscript's own front-matter "AUTHORS" bio section (each bio's opening bold name run) if the cover page itself carried no byline, so this override is only needed to fix names the fallback got wrong or to hide the byline |
| `images` | swap a source image by media filename (`{ "image12.png": { src, w } }`) |
| `setCaption` | set an image's caption, matched by `near` (existing caption) or `file` (media name) |
| `level` / `year` | CDC syllabus on the generic theme only: the level line ("Secondary Teachers’ Diploma") and the year, when the file name carries neither |
| `theme` | force a theme by name, bypassing `autoTheme()`'s file-name guess (a TG whose title doesn't match its sibling LB's pattern, say) |
| `synthesiseCover` | force the engine to build a fresh cover from title/subject/booktype/author even when a cover-ish page was detected (its line shapes didn't match what the theme expects) |
| `blackWhite` | render the whole interior in black/grey (CDC's Teacher's Guide requirement) while the **cover stays full colour** — every themed colour, box fill, and table zebra-stripe is forced to black/grey/light-grey. This is now the **default for any TG** (filename carries "TG" or "teacher"), so most books never need to set it; use `blackWhite: false` for the rare TG that must stay in colour, or `blackWhite: true` to force it on a Learner's Book (which otherwise keeps its colour) |

**Text (whole-block)**

| Key | What it does |
|---|---|
| `fill` | write a value into a dotted placeholder after a label (Edited by…) |
| `replace` | swap a paragraph containing a substring (flattens formatting) |
| `replaceExact` | like `replace` but the block's **whole trimmed text** must equal `find` |
| `remove` | delete any block containing a substring (trim a section to fit) |
| `removeRange` | delete blocks from `from` up to (not incl.) `to` — for anchors sharing text |
| `removeWhereNext` | delete a block matching `find` only when the block right after it matches `next` (disambiguates a repeated heading) |
| `moveBefore` | lift the block containing `find` and re-insert it before the block containing `before` |
| `moveSectionBefore` | like `moveBefore` but moves a whole section (heading through to the next heading), not just one block |
| `replaceBlocks` | replace a run of blocks between two anchors with freshly built ones — blockspecs: `para`/`head`/`h1`/`listitem`/`label`/`vspace`/`raw`/`numbond`; `raw` inserts a pre-built block object verbatim (e.g. grafting a table or list from elsewhere in the same book) |
| `insertText` | insert a new paragraph/heading before an anchor (lighter-weight than `replaceBlocks` when you're only adding, not replacing) |
| `mergePara` | glue a paragraph to the one before/after it (`glue: true`) — a sentence Word split across two paragraphs |
| `splitBefore` | force a paragraph break right before a matched substring (the inverse of `mergePara`) |
| `boldFind` | bold every run whose exact text matches `find` (e.g. math symbols like `∈`, `≠` that the importer left plain) |

**Text (in-place, preserves run formatting)**

| Key | What it does |
|---|---|
| `edit` / `editAll` | replace/delete a substring **inside** the first / every matching block |
| `subtext` | replace a substring in **every run** containing it, keeping its bold/italic/colour |
| `retext` | change a run whose trimmed text equals `from` to `to`, keeping bold/italic/colour |
| `unbold` / `unitalic` | drop bold / italics from a run whose trimmed text matches |
| `boldToItalic` | drop bold **and** set italic on a matching run |
| `recolor` | recolour runs by existing colour and/or exact text (`{ from?, to, text?, bold? }`) |
| `italiciseFrom` | italicise the value after a label prefix (GENERAL/SPECIFIC COMPETENCE…), label stays roman |

**Headings & structure**

| Key | What it does |
|---|---|
| `asHead` | reclassify a coloured section heading (h1/h2) to plain **bold-black** `head` |
| `asSection` | inverse of `asHead`: promote an inline heading to a **styled section head** (own page, accent title + rule, listed in TOC) — for back-matter GLOSSARY/REFERENCES |
| `insertHead` | insert a heading before an anchor; `as:"h2"` makes it a sub-topic (flows into TOC), `near` disambiguates a repeated anchor |
| `centre` | centre a heading matched by exact text (passage / picture / story titles) |
| `recolorHead` | give a heading (by prefix) a specific fill colour |
| `activityHeadsBlack` | render every Activity/Exercise heading bold black instead of the accent colour |
| `pageBreakBefore` | insert a page break before the first block containing the text |
| `replaceSection` | swap a whole section body (heading → next section) for supplied `items` (markdown-ish: `**bold**`, `*italic*`, `$math$`, `## sub-head`); optional `rename`/`until` |
| `recase` | change a block's case (`{ startsWith, to: "sentence" }`) — e.g. an ALL-CAPS label the house style wants in sentence case |
| `setHeading` | force a block to render as a specific heading kind (`as: "label"`, etc.) — for a heading the importer classified wrong |
| `centrePara` | centre a paragraph (and, inside an exercise, its "lead" part) rather than justify/left-align it — matches a manuscript's own centred diagram or ASCII layout |
| `monoLines` | render a block as monospace, preserving every literal space — for an ASCII-art diagram or aligned columns the author built with spaces in Word |
| `fixExercise` | repair a mis-parsed exercise/assessment heading: `renumber: true` renumbers it in place, `heading: "EXERCISE 9"` overwrites a wrong/missing title (matched via `match` + `near`), `parentBefore` fixes a lettered sub-part that lost its parent number |
| `tocDepth` | how many heading levels the table of contents lists (default 2: top-level + one sub-level) |
| `tocUnitsOnly` | `false` also lists front/back matter (Authors, Foreword, References, …) in the TOC, not just units/topics |

**Lists / questions / tables**

| Key | What it does |
|---|---|
| `setMarker` | force the list marker of a question/answer part (when a diagram throws numbering off); `after` limits the search to past the block containing that text, for a line the book gives twice |
| `unlist` | convert a paragraph the importer mis-parsed as a list item back to a plain paragraph |
| `dropMath` | delete a stray math segment by exact Typst source |
| `tables` | rebuild a badly-built table as an explicit grid |
| `removeRow` | delete a whole table row, matched by any one cell's exact text (`find`) or its opening text (`startsWith`) — for a row the author duplicated, or a clause withdrawn after validation. Never matches the header row. `remove` deletes a whole block and `editCell` only rewrites text, so this is the way to drop one row of a syllabus matrix |
| `levelPageAfterCompetences` | `true` moves a syllabus’s level page ("SECONDARY TEACHERS’ DIPLOMA") from ahead of the competences section to after its table, in front of the first YEAR matrix; arabic page 1 then opens on the competences |
| `insertRow` | put a row merged across the table, holding `text`, before the first body row with a cell matching `find` (whole text) or `startsWith` — a `YEAR 2` row in a syllabus matrix that runs both years as one table; the family lifts it out as the YEAR banner |
| `coverColour` | a 6-digit hex value (`"1f5c3a"`) — syllabus family only. The colour of the cover and back-cover field. A syllabus on the generic theme otherwise takes one from a fixed set of twelve deep colours, picked by its subject name (the same book always gets the same one; none repeats a named theme's orange, teal or indigo). Set this when two subjects land on the same or a near colour |
| `renumberMatrix` | `true` — syllabus family only. Drops every number in the TOPIC, SUB-TOPIC and COMPETENCE columns of the matrix (and of a YEARS | TOPIC | SUB-TOPIC scope-and-sequence chart) and counts them afresh from the table's structure: topic `Y.k`, sub-topic `Y.k.j`, competence `Y.k.j.m`, the year taken from the YEAR heading above the matrix or the chart's YEARS column. A cell holding a number and nothing else is emptied. For a manuscript whose matrix numbers are all broken Word list numbers (see §2a) — never for numbers the author typed |
| `editCell` | rewrite a table cell whose whole trimmed text equals `find`. Rewrites the cell's rich runs alongside its plain text, so a syllabus matrix cell (which renders its clause number from the text but its body from the runs) stays intact. With `pattern` (a regular expression) instead of `find`, every matching body cell has the match replaced — one rule for a slip repeated down a whole matrix (a year prefix typed before every number) |

**Images:** generate with **gpt-image-2, `quality: "high"`** (raised from the
old `"low"` cost-saving default — print sharpness now wins over the small
per-image cost difference). Prompt for Zambian context, gender balance,
disability inclusion, and youth where relevant; keep the replacement's own
file extension and a like-for-like aspect ratio.

- **Generate through the gpt-image-2 API directly, never the ChatGPT
  consumer app.** The ChatGPT app bakes a small visible watermark into
  every image it generates; the raw API output carries none. Using the API
  is the fix — not a crop or an edit pass afterward. If a supplied image
  ever does carry a ChatGPT (or any other) watermark, don't ship it:
  regenerate it cleanly rather than trying to paint over or crop out the
  mark.
- **Replace any picture or illustration that isn't clear** with a sharper one
  of the same subject (via the `images` override) — don't leave a blurry
  scan, a low-res clip-art, or a muddy photo in a finished book.
- **The people shown must be the age the book's own grade/level actually
  serves** — not older, not younger. This is a house-style rule for *every*
  book, checked at every image swap, not a one-off:
  | Level | Depicted age |
  |---|---|
  | ECE 3-4 | 3-4 years old — mostly cartoon/very young children |
  | ECE 5-6 | 5-6 years old |
  | Grade 4 | ~10 years old |
  | Form 4 | 16-17 years old (youths) |
  | Form 5-6 | 18-19 years old (youths) |

  Grades outside this table aren't pinned to an exact age yet — treat each
  primary grade as roughly one year older than the last (Grade 1 the
  youngest, climbing toward the Grade 4 anchor above and beyond), but
  confirm with the team before treating a specific untabled grade's age as
  settled. The one exception to "match the learner's own age": an image
  illustrating a mother, father, or family scene may show adults (and
  younger siblings) — but if the image is meant to depict *the learner*
  practising the skill the page teaches (cooking, laundry, bed-making, …),
  it needs to show someone the book's own age, not a parent or a much
  younger child standing in for them.

> This table covers the overrides you'll reach for most often. The engine
> recognises many more (each is a niche, one-off fix added for a specific
> manuscript problem) — the definitive, always-current list is every
> `ov.<key>` read in `applyOverrides()` in `src/typeset/typeset-docx.js`
> (`grep -oE "ov\.[a-zA-Z]+" src/typeset/typeset-docx.js | sort -u`). If a
> problem you're hitting sounds oddly specific, search there before adding a
> new primitive — there's a decent chance it already exists.

## 6. Workflow for scaling (many books)

1. **Shared first** — theme + glossary labels + conventions live in the engine, so
   every book benefits at once. Do engine work once, not per book.
2. **Batch** — typeset every queued book to a first draft in one pass.
3. **Proofread + revise** — the user proofreads each book; fixes go in that book's
   overrides sidecar. Because the foundation is solid, expect only a few per book.

Old binary `.doc` files won't parse — convert with LibreOffice first:
`soffice --headless -env:UserInstallation=file:///C:/temp/loconv --convert-to docx --outdir <dir> "<file>.doc"`.
