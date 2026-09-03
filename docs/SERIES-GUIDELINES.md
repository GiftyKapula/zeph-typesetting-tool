# ZEPH series typesetting guidelines

The working rules we follow when typesetting a **Zambia Educational Publishing
House (ZEPH) secondary-school book** with this engine (the `english` theme /
`series` layout). They are distilled from a **human-typeset reference** and from
review feedback, and are meant to keep every book in the series consistent and
print-ready. New books in the series should follow this checklist.

> **Reusable vs. per-book.** The **mechanics** here are reusable for *every* book —
> page size, margins, fonts/roles, front-matter order, roman/arabic numbering,
> paragraph spacing, signature room, numbered lessons, sticky headings, per-book
> output folders, editorial overrides, and the verify-visually workflow. The
> **colour palette and the cover/layout design are unique to each book**; where a
> specific colour (yellow/teal) or cover treatment is mentioned below, it is the
> *English* example, not a prescription — pick a fresh identity per book.

> The companion engine reference is [`TYPESETTING.md`](TYPESETTING.md) (themes,
> variants, the import pipeline). This file is the *editorial / house-style* side.

---

## 0. Ground truth: study the reference first

Before typesetting a new series book, **study a human-typeset book from the same
series** (e.g. `reference/English Language Form 3_ LB_.pdf`) the way an editor
would — front matter order, where roman vs. arabic numbering starts, margins,
cover, headings, how activities are laid out. The reference is the design
authority; we match its *intent*, then improve where it helps.

Render reference/output pages to images to actually **look** at them (we use
`pdfjs-dist` + `canvas` to rasterise pages, then read the PNG) — never assume,
verify visually.

## 1. Print specifications

*(Reusable across every book unless noted as per-book.)*

- **Trim size: B5 (176 × 250 mm).** These books print at B5 ("slightly smaller
  than A4"). Typeset at the **true** B5 size — do **not** lay out on A4 and hope
  the printer rescales. (`paper: "iso-b5"`.)
- **Margins:** **top 19 mm, bottom 16 mm, left/right 17 mm** (set on the `series`
  layout). The running header sits in the top margin; the `~ n ~` footer in the
  bottom margin.
- **Fonts (roles, reusable):** a serif (Times New Roman) for the running header;
  a **sans body** (Arial); a **modern sans display face** (Segoe UI) for the cover
  + title page. The exact faces can vary per book, but keep the roles.
- **Each book outputs into its own folder:** `output/<book name>/` (the PDF plus
  a `_source.typ` for inspection).
- **Colour & cover design are _per book_** (not reusable). Each subject has its
  own palette and a distinct cover. For reference, English uses teal `#2f9e8c`
  (interior) + amber `#e0922f` accent, with a **signature cover colour** of yellow
  `#f6c324` that fills the whole cover (see §5) — set per theme via the `signature`
  field. A new book chooses its own.

## 2. Front matter — order & page numbering

Order: **cover → title page → copyright/imprint → Table of Contents → The
Authors → Foreword → Preface → Acknowledgements → Introduction → (body)**.

- The **title page** repeats the book name (subject, Form, "Learner's Book"),
  authors and publisher — the page right after the cover.
- **Page numbers are roman in the front matter, arabic in the body:**
  - Roman counting begins **silently on the title page = i**. The title,
    copyright and contents pages **count** (i, ii, iii…) but **print no number**.
  - The number becomes **visible** at the first prose page — **The Authors**,
    which lands around **v** — and runs roman to the end of the front matter.
  - The **body restarts at arabic 1** on the **first UNIT**.
- Footers are centred and tilde-wrapped: `~ v ~`, `~ 1 ~`.
- The **Table of Contents is regenerated** by the engine (real outline, correct
  leaders + page numbers); the manuscript's own typed TOC is dropped. Top-level
  entries are amber bold; lessons are black sub-entries.
- Front-matter pages use **airier paragraph spacing** than the body (the body
  resets to normal spacing at the first unit).

## 3. Signatures

On **Foreword, Preface and Acknowledgements**, leave **~16 mm of clear space
above the signatory's name** (the name carries a trailing honorific such as
`(Dr)`, `(Ms.)`, `(PhD)`) so a real signature can be added. (The Authors page is
a list of bios, not a signed letter — no signature gap there.) The signatory's
**name is set bold**; the title and organisation lines below it keep their normal
weight, and the whole signoff is held together as one tightly-spaced block.

## 4. Body — units, lessons, flow

- **`UNIT n: …`** opens with a solid **teal banner** and always starts a fresh
  page.
- The **lessons under each unit** (Listening & Speaking, Listening
  Comprehension, Composition, …) are **auto-numbered 1, 2, 3…**, restarting at
  every unit, and shown as **teal headings** with a short amber underline.
- **No callout boxes.** Activities / Exercises / Tasks are **teal headings**,
  with their content flowing beneath — this series reads as continuous text, not
  boxed furniture (matching the reference).
- **Headings breathe and never strand:** generous space above every heading, and
  headings are *sticky* — if a heading would sit at the very foot of a page with
  no room for its content, it **moves to the next page** with it.
- **Callout boxes are breakable** (Learning Activities, Exercises, Assessments,
  Key Points…). A long box **flows across a page boundary** (the tint/border
  continues on the next page) instead of overflowing and clipping/jumbling the
  text at the page foot. This applies to **every** layout/book — the `titledbox`
  default in `generic-template.typ` is `breakable: true`; only pass
  `breakable: false` for a short box that must stay whole.

## 5. Cover & back cover

*(The visual **design** here is the English example and is **per-book** — choose a
fresh one. What's reusable: a front cover, a repeated title page, a back cover
with a **reserved (un-drawn) ISBN/barcode box**, and the publisher logo on both
covers.)*

- **Front cover:** a **diagonal / geometric** design in modern sans — the page is
  filled with the **subject's signature colour** (yellow for English) so it
  dominates the whole cover, with the subject set large in **deep teal** directly
  on it, a "FORM n" tag, a tilted photo panel, an authors tag, and teal corner
  wedges.
- **Back cover (last page):** mirrors the front geometry and carries the book
  identity + publisher branding. It leaves a **reserved, empty box** for the
  **ISBN + barcode** — we deliberately do **not** draw them, because the press
  adds them at print time. Don't make the back cover *only* a barcode block;
  keep the branding.
- **Publisher logo:** the ZEPH logo (`zeph-logo/image.png`) is placed on the
  **front cover** and **back cover** (above the publisher name). It is added as a
  fixed asset for every series book — not pulled from the manuscript.

## 7. Per-book editorial overrides

Small, book-specific editorial edits (filling a placeholder, swapping a wrong
paragraph) live in a **sidecar `books-to-typeset/<book>.overrides.json`** — *not*
in the `.docx` — so the manuscript stays pristine and the edits are version
controlled. Two kinds:

```json
{
  "isbn": "978-9982-01-762-5",
  "images": { "image8.jpeg": "../images/eng-debate.png" },
  "fill":    [{ "after": "Edited by", "text": "…" }],
  "replace": [{ "find": "Special thanks are due to facilitators", "with": "…" }]
}
```

- **`fill`** writes a value into the dotted placeholder line that follows a label
  (e.g. the `Edited by:` / `Illustrated by:` / `Cover and Book Layout:` lines on
  the imprint page). The ISBN line is left blank for the press.
  - The **`Cover and Book Layout:`** line is filled automatically for *every*
    book (engine default `fillLayoutCredit` in `typeset-docx.js` → **Gift Kapula**,
    the typesetter). You do not need a per-book override for it; add one only to
    override the default.
- **`replace`** swaps a paragraph that contains the given text.
- **`images`** swaps a specific source image for a contextualised one. The key is
  the manuscript's media filename (e.g. `image8.jpeg` — find it by mapping each
  embedded image to its caption); the value is a path to the replacement, resolved
  relative to the `.docx` (keep the file under the tracked `images/` folder, e.g.
  `"../images/eng-debate.png"`). The override stands in for the original
  everywhere — its bytes are copied **and** its true aspect ratio is read from it,
  so a like-for-like aspect avoids distortion. The replacement keeps its **own**
  extension in the output name (a `.png` must not masquerade under a `.jpeg` name —
  Typst decodes by extension and a mismatch fails the whole compile). Generate
  replacements with **gpt-image-2 at `quality: "low"`** to keep cost down; prompt
  for the right context (e.g. Zambian setting, gender balance, and inclusion —
  wheelchair, albinism, walking cane/blind, hearing aid/deaf — and youth where the
  audience is out-of-school youths).

Correct obvious typos when transcribing an instruction into the book (it is being
printed) and tell the user what you changed.

## 6. General principles

- **Be faithful to the manuscript.** Don't invent body content, blurbs, or
  marketing copy; carry the author's words. Where the source has a defect (e.g.
  two headings glued together), keep it rather than guess a fix — flag it.
- **Stray typing artifacts are dropped automatically.** A paragraph whose entire
  content is just punctuation (`.`, `/`, `•`) or a single isolated letter (e.g. a
  lone `s` left below a heading) is never real content, so the importer skips it.
  These are mechanical leftovers, not authorial words — distinct from the
  faithfulness rule above.
- **Don't draw what the press adds later** (ISBN, barcode).
- **Verify visually** after every change — render the affected pages and look at
  them; confirm the other books still compile unchanged before committing.
- **Keep the repo clean:** never commit `.env`, `.docx`/`.pdf` outputs, or scratch
  tooling; `output/` is git-ignored and regenerable.
