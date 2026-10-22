# Book QA gate and parallel typesetting

Two tools in `tools/qa/` check typeset books against their manuscripts and the house rules,
so several books can be typeset at once and each one is **qualified** before a human looks at it.

```
node tools/qa/batch.mjs "<folder or .docx>" […] [--jobs 5] [--no-build] [--only text]
node tools/qa/qa.mjs "<book>.docx"            # one already-built book
```

`batch.mjs` builds every `.docx` under the given folders in parallel, saves each console log
as `build.log` beside its PDF, and puts every book through the gate. The table and details are
also saved to `output/_qa/<date>-<time>.md`. A build starts only when there's enough free memory
(about 0.5 GB plus 40× the .docx size), and memory promised to builds that just started is
counted, so a burst of starts can't overload the machine. A lone build always runs.

## What the gate checks

| Group | Checks | Effect |
|---|---|---|
| **Blockers** | overlapping text · text outside the 9 mm safe area · placeholder text left in (INSERT A PICTURE / ANSWERS / TEXT, PUT A … PICTURE, XXX) · no designed cover or title page · page numbers missing on body pages · body numbered in roman to the end (units / terms not recognised) · TG not black & white · `boxStripe` not false · no spine on a book over 112 pages | any one fails the book |
| **Fidelity** | % of the manuscript's words that reach the PDF (case-insensitive, hyphenation undone). The author's typed contents list, the cover/imprint lines the engine rebuilds, words the overrides change on purpose (remove, phraseFix, sourceFix, setHeading, spelling rules) and `qaIgnore` words are excluded | score |
| **Layout** | % of numbered pages with no defect: overlap, out of margin, heading or label stranded at the foot of a page (a picture below it doesn't count), large empty space not explained by a section break | score |
| **Warnings** | list numbering that jumps (1, 2, 3, 5), sub-topic numbers that skip or repeat, override entries that matched nothing, fewer pictures placed than in the manuscript | listed for a person |

**Score = min(fidelity, layout).** A book **qualifies** when the score is at least 99 and it has no blockers.

What the gate can't judge: whether a heading was read at the right level, whether the cover
words are the author's, whether a picture suits the text. Always look at the cover and a
contact sheet before sending.

## Helpers

- `tools/qa/peek.mjs <docx…> [--lines N] [--outline]`: a manuscript's opening lines and heading outline (cover words, authors, structure) for writing a new book's overrides.
- `tools/qa/find.mjs <docx> "<regex>" [--pdf]`: where a word occurs in the manuscript (style, table, text box, contents list) and how often in the PDF. Use it to chase a "missing words" finding.

## Presets

`"preset": "zl-tg"` / `"zl-lb"` in an overrides file pulls in the shared house settings from
`src/typeset/presets/`. The book's own keys win.

## Parallel working rules

1. Each book changes only its own overrides. Engine changes are opt-in options.
2. After any engine change, rebuild the affected folders with `batch.mjs`. Every book that drops below the gate is checked before going further.
3. The workflow database (`data/zeph.db`) waits up to 20 s for a lock, so parallel builds don't fail with "database is locked".
