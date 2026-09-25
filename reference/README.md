# reference/

Source inputs you're typesetting from — the official syllabus, a house-style
reference book, sample PDFs, anything you want on hand while working. **Not
committed** (usually large and/or third-party copyrighted): put your own copies
here.

## The syllabus demo book

`Travel and Tourism TED Syllabus - DEMO BOOK.pdf` is the **reference book for
the CDC landscape syllabus family** — the one every new syllabus on this branch
is built to match. Its front-matter order and section structure are written up
in `docs/HOUSE-STYLE.md` §2a, and the engine enforces them; open the PDF
alongside a new book and compare page by page before calling it done.

Only its typeset PDF exists (there is no `.docx` for it on this machine), so it
can be read and compared but not re-typeset — use another syllabus for an
end-to-end regression run after an engine change.

Like everything else here it is **not committed** (size/copyright); copy it back
in from a finished book if a fresh clone is missing it.

Extract text from a PDF with: `pdftotext -layout "file.pdf" out.txt`
(`-raw` instead of `-layout` when you need reading order through a table —
`-layout` interleaves the columns and breaks up each cell's text.)
