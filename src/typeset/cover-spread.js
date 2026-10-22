// The printer's cover spread for a B5 book: BACK | SPINE | FRONT on one sheet.
//
// House rule (publisher, 2026-10-19): a book of more than 112 interior pages gets a
// spine. The front and back covers are already typeset as the book PDF's first and
// last pages, in whichever of the template's cover designs the book uses, so they are
// taken from there as they are rather than drawn a second time; only the spine is new
// (`spine()` in generic-template.typ). The three are laid side by side with pdf-lib.
//
// Spine width: one sheet of 80 gsm paper is about 0.10 mm, two pages to a sheet, so
// ceil(interior pages / 2) x 0.10 mm. The printer's own figure, when known, goes in the
// book's sidecar as `spineWidth` (mm) and wins.
const fs = require("fs");
const { PDFDocument, rgb } = require("pdf-lib");

const SPINE_FROM = 112;          // more interior pages than this -> a spine
const MM_PER_LEAF = 0.10;        // 80 gsm text paper
const PT_PER_MM = 72 / 25.4;
const B5 = { w: 176, h: 250 };   // the covers' own page size, in mm

// interior pages = the whole book minus its front and back cover
const interiorPages = (total) => Math.max(0, total - 2);
const spineWidthMm = (interior, override) =>
  override > 0 ? Number(override) : Math.ceil(interior / 2) * MM_PER_LEAF;

// Returns null when the book is too thin for a spine (nothing written), otherwise
// { interior, width, outPath }.
async function writeCoverSpread({ pdf, compiler, prefix, lines, logo, spineWidth, fieldHex, outPath, bookOutPath }) {
  const book = await PDFDocument.load(pdf);
  const total = book.getPageCount();
  const interior = interiorPages(total);
  if (interior <= SPINE_FROM) return null;
  const width = Math.round(spineWidthMm(interior, spineWidth) * 100) / 100;

  const spineDoc = `${prefix}\n#spine((${(lines || []).map((l) => JSON.stringify(String(l))).join(", ")},), ${logo ? `(file: ${JSON.stringify(logo.file)})` : "none"}, ${width})\n`;
  const spinePdf = await PDFDocument.load(Buffer.from(compiler.pdf({ mainFileContent: spineDoc })));

  const out = await PDFDocument.create();
  const W = B5.w * PT_PER_MM, H = B5.h * PT_PER_MM, S = width * PT_PER_MM;
  const [front, back] = await out.embedPdf(book, [0, total - 1]);
  // the template's spine document may carry a blank page before the spine; take the last
  const [sp] = await out.embedPdf(spinePdf, [spinePdf.getPageCount() - 1]);
  const page = out.addPage([2 * W + S, H]);
  // the whole sheet in the cover colour first: three pictures butted edge to edge
  // otherwise show hairline seams down both folds where their anti-aliased edges meet
  if (/^[0-9a-f]{6}$/i.test(fieldHex || "")) {
    const [r, g, b] = [0, 2, 4].map((k) => parseInt(fieldHex.slice(k, k + 2), 16) / 255);
    page.drawRectangle({ x: 0, y: 0, width: 2 * W + S, height: H, color: rgb(r, g, b) });
  }
  page.drawPage(back, { x: 0, y: 0, width: W, height: H });
  page.drawPage(sp, { x: W, y: 0, width: S, height: H });
  page.drawPage(front, { x: W + S, y: 0, width: W, height: H });
  out.setTitle(`${book.getTitle() || ""} - cover spread`.trim());
  fs.writeFileSync(outPath, await out.save());
  // The book as ONE file for the printer (user, 2026-10-22: "the cover spread is
  // separate from the book, don't separate them, they should be one thing"): the spread
  // as page 1, then the interior from the title page on — the separate front and back
  // cover pages are already on the spread — and a blank leaf at the end when the
  // interior runs to an odd number of pages. The same layout as the Food and Nutrition
  // Form 2 Teacher's Guide copy that came back from proofreading.
  let withCoverPath = null;
  if (bookOutPath) {
    const one = await PDFDocument.create();
    const [spreadCopy] = await one.copyPages(out, [0]);
    one.addPage(spreadCopy);
    const inner = await one.copyPages(book, Array.from({ length: interior }, (_, i) => i + 1));
    for (const p of inner) one.addPage(p);
    if (interior % 2) one.addPage([W, H]);
    one.setTitle(book.getTitle() || "");
    fs.writeFileSync(bookOutPath, await one.save());
    withCoverPath = bookOutPath;
  }
  return { interior, width, outPath, withCoverPath };
}

module.exports = { writeCoverSpread, SPINE_FROM, spineWidthMm, interiorPages };
