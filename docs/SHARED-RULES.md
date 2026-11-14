# Shared rules — every book family

These rules are the same for the syllabuses (`landscape-syllabus`), the
English-language books (`portrait-books`) and the local-language and ECE books
(`main`). Each branch keeps its **own copy** of this file; the branches are
never merged. Change a rule here only when Teddy asks, and say in the PR
that the other two copies need the same change.

Each rule ends with where it stands on **this branch** (`main`).

## Printer

- **Spine** on any book of more than 112 interior pages (the cover spread not
  counted). B5 books: width = interior pages × 0.055 mm + 1 mm (80 gsm), the
  printer's own figure (`spineWidth`) when given. Decided 2026-11-14.
  *This branch:* done (pages × 0.055 mm + 1 mm, `spineMmPerPage`).
- **Trim allowance:** the printer trims covers by 2 mm on every side, so the B5
  cover spread is 2 mm larger all round (`coverTrimMm`). Decided 2026-11-14.
  *This branch:* done (`coverTrimMm`).
- **Even page count:** an odd interior gets a blank last page.

## Back cover

- Plain: the cover colour, the ISBN box, the ZEPH logo and
  **"Published by / Zambia Educational Publishing House"** — in a
  local-language book, the word list's own words for "Published by". No title,
  level, form/grade or book type. (User rule 2026-10-22.)
  *This branch:* the engine still prints "Printed by" unless a sidecar's
  `printedBy` gives the local words — to change to "Published by" (pending).

## Copyright / imprint page

- One page, never spilling onto a second.
- Order (the Silozi G4 LB model): © line → rights → editor → illustrator →
  Cover and Book Layout → publisher and address → ISBN → printer.
- Copyright line: **"© <owner> (<year>)"**, e.g. "© ZEPH (2026)". The owner is
  the manuscript's (some books are the Ministry of Education's).
- Layout credit: **"Cover and Book Layout: Ng`ambi Teddy (B.Sc)"** on every
  book's imprint unless the sidecar's `layoutCredit` says otherwise.
- *This branch:* the `imprint` builder exists but is opt-in; making it the
  default with this order is pending. The release QA blocks placeholders.

## Placeholders

- Nothing goes out with `xxx`, `INSERT`, `TBC` or a bracketed note to the
  typesetter. An ISBN not known yet prints as dots. A name not known yet (an
  illustrator, an editor) is left out and asked for — never invented.

## Fonts and characters

- Only the family's house fonts may appear in the PDF (`pdffonts`). A fallback
  font (Libertinus Serif, New Computer Modern, Segoe UI Emoji, Segoe MDL2
  Assets, Yu Gothic) means a character the house fonts lack — find it.
- No private-use characters (U+E000–U+F8FF) or U+FFFD in the text. They come
  from a manuscript that typed a bullet, tick or degree sign in Symbol,
  Wingdings or Segoe UI Symbol.

## Delivery

- ONE PDF per book: the cover spread as page 1, then the interior from the
  title page. To the top level of Downloads.
- No "FOR PROOFREADING" watermark; "for proofreading" goes in the file name.
- An e-book request means EPUB (`--epub`).

## Pictures

- Groups of more than three people include a learner with albinism, one in a
  wheelchair and one with a hearing aid; boys and girls balanced.
- A cover picture is cropped to a part with no words — lettering is never
  painted out.
