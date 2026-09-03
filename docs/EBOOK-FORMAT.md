# ZEPH Learn eBook bundle — format contract (schemaVersion 1)

The stable contract between the **typesetting tool** (producer, via `src/typeset/emit-ebook.js`)
and the **ZEPH Learn app** (consumer). Build each side against this; every book that passes
through the tool follows it. Both the print PDF and this eBook are outputs of the SAME
`importDocx()` semantic model — the eBook stays in sync with the printed book by construction.

## The `.zephbook` bundle

A `.zephbook` is a ZIP with this layout (also written unzipped to `dist-ebooks/<id>/`):

```
manifest.json        what the app's learn_books row needs (metadata only)
book.json            the full book: toc + sections + blocks (below)
media/<name>         referenced figures/images, by filename (png/jpg/webp)
math/<hash>.svg      equations pre-rendered to SVG via the Typst engine (print parity)
```

## manifest.json

```jsonc
{
  "schemaVersion": 1,
  "id": "form-1-chemistry-form-1-learner-s-book", // stable slug (zeph.db book id)
  "title": "Form 1 Chemistry Form 1 Learner's Book",
  "subject_name": "Chemistry",
  "form_level": "Form 1",
  "book_type": "LB",                              // LB | TG
  "price_zmw": 50,
  "reader_format": "reflow",
  "counts": { "blocks": 760, "sections": 15, "media": 45, "equations": 7 }
}
```

## book.json

```jsonc
{
  "schemaVersion": 1,
  "id": "...", "title": "...", "subject": "Chemistry",
  "level": "Form 1", "bookType": "LB", "author": "ZEPH",
  "toc": [ { "title": "TOPIC 1.1: ...", "section": "s1-...", "children": [
             { "title": "Sub-Topic 1.1.1: ...", "section": "s1-...", "anchor": "s1-...-sub0" } ] } ],
  "sections": [ { "id": "front|s1-...", "title": "...", "blocks": [ /* Block[] */ ] } ]
}
```

Sections split at each **topic** (`topic` block). Content before the first topic is section `front`.

## Rich text: the `segs` array

Every text-bearing field is an array of segments. A plain segment:

```jsonc
{ "t": "text", "b": true?, "it": true?, "u": true?, "c": "1F3864"? }  // bold/italic/underline/colour hex
```

A **math** segment references a pre-rendered SVG in `math/` (raw Typst source kept as `alt`):

```jsonc
{ "m": true, "svg": "eq_ab12cd.svg", "w": 66, "h": 8, "display": false, "alt": "frac(1, 100)" }
```
`w`/`h` are the SVG's intrinsic size in pt (for inline sizing). `display:true` = block equation.

## Block types (the `blocks` array, in reading order)

| `type`        | fields                                   | render as |
|---------------|------------------------------------------|-----------|
| `cover`       | `lines[]`, `byline[]`, `hero?`, `logo?`  | title page |
| `backcover`   | `lines[]`, `logo?`, `isbn?`              | back cover |
| `topic`       | `text`                                   | H1 + TOC top-level, starts a section |
| `subtopic`    | `text`, `anchor?`                        | H2 (navy band) + TOC child |
| `h3`          | `text`                                   | content sub-heading |
| `label`       | `text`, `color?`                         | bold label line |
| `para`        | `segs[]`, `align?`                        | paragraph |
| `listitem`    | `segs[]`, `marker`                       | bulleted/numbered item |
| `caption`     | `text`                                    | figure caption |
| `figure`      | `file`, `w`, `h`, `tall`, `caption`      | `media/<file>` + caption |
| `imagerow`    | `images[]` of `{file,w,tall,caption}`    | row of images |
| `activity`    | `title`, `body[]` of Block               | LEARNING ACTIVITY box (navy) |
| `fact`        | `body[]` of Block                        | "Did You Know?" box (teal) |
| `keypoints`   | `title?`, `points[]`                     | "Key Points" box (amber) |
| `box`         | `body[]` of Block                        | generic shaded box |
| `framedsection`| `kind`, `title`, `body[]`               | framed section |
| `lessonmeta`  | `title`, `body[]`                        | teacher-guide lesson meta (TG only) |
| `exercise`    | `heading`, `items[]` of Part             | green exercise box |
| `assessment`  | `title`, `intro[]`, `items[]`, `extra[]` | end-of-topic assessment |
| `table`       | `rows[][]` of Cell, `noHeader?`          | data table |
| `colgrid`     | `rows[]`, `ncol`, `hasMarker`, `header?` | multi-column word-list grid |
| `colsum`      | `rows[]`, `answer[]`                      | column-sum math layout |
| `numbond`     | `whole`, `a`, `b`                        | number-bond |

**Cell** = `{ text, segs?, imgs?[{file,w}], subs? }`.
**Part** (questions) = `{ kind:"q", q, qseg[], marker, depth, a?, aseg? }` |
`{ kind:"lead", q, qseg[], indent }` | `{ kind:"table", rows, marker }` |
`{ kind:"image", images[], marker }` | `{ kind:"colsum"|"colgrid", ... }`.

## Learner-Book rule

When `bookType === "LB"`, the exporter **omits answers**: question Parts carry no `a`/`aseg`,
and the "Answers" divider lead is dropped. Teacher's Guides (`TG`) keep them.

## Adding a book

`node --experimental-sqlite src/typeset/emit-ebook.js --book <zeph.db-id>` — reads the registered
manuscript, runs `importDocx()`, writes `dist-ebooks/<id>.zephbook`. No reader changes needed for a
new book; it arrives in this same shape. The app admin uploads the `.zephbook` via the UI.
