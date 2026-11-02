# Marketing posters

Every book gets its marketing posters automatically at the moment it is **released for
print**. Nobody makes them by hand. The poster copies the approved ZEPH advert (the
Icibemba Grade 4 sample, November 2026): same wording, same layout. Only the colours change,
chosen so the book's cover stands out.

## The three commands

```bash
npm run release -- "books-to-typeset/Grade 4 Books/ICIBEMBA GRADE 4 TG.docx"   # release + posters
npm run poster  -- "books-to-typeset/Grade 4 Books/ICIBEMBA GRADE 4 TG.docx"   # posters again
npm run poster:all                                                            # every released book
```

You can give the `.docx` or its `.overrides.json`; the book must have been typeset first
(`npm run typeset:docx`).

### `npm run release`

1. Finds the book's latest QA result: `qa.json` beside its PDF (written by `npm run qa` or
   `npm run batch`). If there is none, or it is older than the PDF, QA is run again first.
2. **Stops** unless the book qualifies (score ≥ 99 and no blockers; see [QA.md](QA.md)). It
   prints the QA summary so you can see what to fix.
3. On a pass, writes into the book's overrides:
   ```json
   "releasedForPrint": true,
   "releasedAt": "2026-11-02"
   ```
   then makes the posters. Commit the overrides change: it is the record of the release.

A book may go out below the gate only with a written reason, which is kept in the overrides:

```bash
npm run release -- "<book>.docx" --force "CDC accepted the layout in writing (letter 14 Nov)"
# -> "releaseForced": { "reason": "…", "score": 97.1, "blockers": [ … ], "date": "…" }
```

### `npm run poster` / `npm run poster:all`

Remakes the posters, for example after changing the wording or the colour theme. `poster:all`
does every book whose overrides say `"releasedForPrint": true`. `poster` works on any typeset
book (it notes when the book is not released yet), so you can preview before releasing.

## What you get

Everything goes to `output/_marketing/<book name>/`:

| File | Size | Use |
|---|---|---|
| `… - poster 1080x1350.png` | 1080 × 1350 px (4:5) | WhatsApp status, Facebook / Instagram feed |
| `… - poster 1080x1350 HD.png` | 2160 × 2700 px | the same, sharp on high-density phones |
| `… - poster 1080x1080.png` | 1080 × 1080 px | square posts |
| `… - poster 1080x1080 HD.png` | 2160 × 2160 px | the same, HD |
| `… - poster A4 print.pdf` | A4 + 3 mm bleed | the printer |
| `front-cover.png` | about 2000 px wide | the cover picture the poster used |
| `poster-qa.json` | | the poster QA (below) |

**Print file specification.** A4 (210 × 297 mm) with 3 mm bleed on every side (sheet
216 × 303 mm). Backgrounds and bands run into the bleed, and all text stays at least 5 mm
inside the trim. TrimBox and BleedBox are set in the PDF, so the printer's software knows
where to cut. All fonts are embedded. The cover is at least 300 pixels per inch at its
printed size. The PDF is RGB; most print shops convert it, but ask if yours needs CMYK.

## What goes on a poster, and what never does

**Only the front cover and the book's metadata.**

- The cover picture is rendered from **page 1** of the book's typeset PDF. When the book opens
  on its cover sheet (`coversInBook`), the front panel is cut out of it. Page 2 is opened only
  to read its trimmed size. **No interior page is ever rendered.**
- The words are the ones printed on the cover: subject, level, book type and authors. They
  come from the cover line of the built book's `_source.typ`, and the labels come in the
  book's own language where it has them (for example *Geledi 4 · Icitabo Cakwa Kafundisha ·
  Bakalemba*). Other books fall back to English (*Form 2 · Learner's Book · Authors*).
- The ZEPH logo (`zeph-logo/image.png`).
- The fixed wording and ZEPH's published contact lines, from `tools/poster/poster-config.json`.

**Never:** anything in `admin/` (the authors' forms carry their private phone numbers), the
manuscript text, or interior pages. Nothing is uploaded and no network call is made. A test
(`test/poster/confidential.test.mjs`) fails if the poster code ever reaches for `admin/`, the
network, or a page other than the cover.

## The book: flat or 3D

Two styles of book, to choose per book:

| Style | Look |
|---|---|
| `flat` (default) | the book standing square-on, with page edges and a shadow; the largest cover, so the cover's words (authors too) read best |
| `3d` | the book turned towards the viewer, as in the approved sample: spine on the left, page block on the right, soft shadow; a little smaller |

```bash
npm run poster -- "<book>.docx" --book 3d
```
```json
"posterBook": "3d"
```

The 3D files are named `… - poster 3D 1080x1350.png` and so on (with `poster-qa-3d.json`), so
both styles can sit side by side while you choose.

## Colours

The background is chosen so the **cover stands out**. The tool measures the cover's colours
(its average colour, plus its dominant colours from k-means clustering), then scores four
themes on how far each background sits from the cover in lightness and round the colour
wheel:

| Theme | Background | Good for |
|---|---|---|
| `complement` | light tint of the colour opposite the cover's | most covers (a blue cover on warm peach) |
| `cream` | warm cream, navy band: the sample's look | blue, green, purple covers |
| `silver` | cool light grey | busy, many-coloured covers |
| `deep` | dark shade of the opposite colour, white text | pale or white covers |

The best-scoring theme is used. The contact band takes a dark shade of the cover's own hue,
which ties the poster to the book. A soft glow behind the book, a drop shadow and page edges
lift it off the background.

To choose a theme yourself, either for one run or permanently in the book's overrides:

```bash
npm run poster -- "<book>.docx" --theme cream
```
```json
"posterTheme": "deep"
"posterTheme": { "bg1": "#fdf6ec", "bg2": "#f3e2c7", "band": "#123456" }
```

An object replaces only the colours it names (keys: `bg1` `bg2` `halo` `ink` `band`
`bandInk` `accent` `tag` `badge` `strip` `stripInk` `bannerInk`).

## Poster QA

Every poster is checked on the **rendered** file, and the results are reported like the book QA:
blockers fail the poster, warnings are listed for a person. The results are printed and saved
in `poster-qa.json`.

| Check | Blocker when |
|---|---|
| overflow | any text runs outside its box, off the page, or (print) into the 5 mm margin |
| overlap | two lines of text run into each other |
| contrast | any text against its background is below WCAG 4.5:1 (3:1 for large text) |
| distortion | the cover is placed more than 0.5 % off its own proportions |
| resolution | (print) the cover is under 300 pixels per inch at its printed size |
| fields | the cover's words lack the subject, level or book type, or the cover or logo is missing |

Warnings: text the fitting had to shrink below 60 % of its design size, a cover that may not
stand out from the background, and a book with no author names on its cover. The poster then
shows none; that is allowed, because some books are published without author credits.

Long text never overflows: it shrinks to fit. Still look at the 1080 × 1350 PNG before
posting it.

**Author names.** The book is shown as large as the layout allows (about 56 % of the width),
and there is no caption under it: the title, level and author names are the ones printed on
the cover itself, as in the approved sample. `poster-qa.json` reports how tall the cover's
author names come out (`authorText`), measured from the cover's own text. On the
Icibemba Grade 4 TG they are 11 px on the 1080 × 1350 (22 px in HD), 9 px on the square and
6.4 pt on the A4 print. A warning appears below 12 px, or 6 pt on the print: readable when
zoomed, but small on a phone screen.

## Changing the wording

The wording is fixed by the approved sample. If marketing changes it (for example, the
Christmas line after the season), edit `tools/poster/poster-config.json`, run
`npm run poster:all`, and check `poster-qa.json`: a longer line may trigger a "shrunk" warning.

## For developers

```
tools/poster/
  release.mjs          npm run release: QA gate, marks the overrides, then posters
  poster.mjs           npm run poster / poster:all: makes and checks every format
  poster-config.json   wording, contact lines, fonts, output formats
  poster.typ           Typst drawing helpers (megaphone, seals, icons, the 3D book)
  lib/book.mjs         cover words + metadata (cover line of _source.typ, overrides)
  lib/cover.mjs        renders the front cover from page 1
  lib/colour.mjs       contrast, dominant colours, themes
  lib/layout.mjs       one poster page (Typst source) + its text boxes
  lib/render.mjs       Typst -> PDF, PDF -> PNG, reads a rendered page back
  lib/check.mjs        poster QA
test/poster/           npm test (Node's built-in runner, no extra packages)
```

The poster is laid out in Typst, by the same compiler and system fonts as the books, at the
target size in points (1 pt = 1 px for the PNGs). The PNGs are drawn at twice the size and
scaled down for clean edges. Only opaque gradients are used, because the PNG rasteriser
(pdfjs) draws see-through gradients as solid. Sizes scale with the page width; a taller page
(A4) gives the bands, the badges and the book a little more room but never a different
arrangement.
