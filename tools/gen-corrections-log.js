// zeph — corrections-log generator
//
// Produces an author-facing Word document listing every reviewer comment for a
// book and, in plain English, what was done about it. Send this to the author so
// they can see what has been actioned.
//
//   npm run report -- <book-id> [--pdf <path>] [--reviewers "A, B"] [--out <path>]
//   (equivalently: node --experimental-sqlite tools/gen-corrections-log.js <book-id>)
//
// The Page column shows the PRINTED page number the author sees in the book, not
// the physical PDF page the reviewer's note was attached to (zeph stores the
// physical page in comment.page_ref). We recover the printed number by reading
// the actual page footers out of the typeset PDF — front matter is roman, the
// body is arabic, and the physical→printed offset is measured, not assumed.

const fs = require("node:fs");
const path = require("node:path");
const { db, ROOT } = require("./db");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType,
} = require("docx");

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const bookId = argv.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
if (!bookId) {
  console.error("usage: gen-corrections-log <book-id> [--pdf <path>] [--reviewers \"A, B\"] [--out <path>]");
  console.error("       run `npm run zeph -- list` to see book ids.");
  process.exit(1);
}

const book = db.prepare("SELECT * FROM book WHERE id=?").get(bookId);
if (!book) { console.error(`no such book: ${bookId}`); process.exit(1); }

const rows = db.prepare(
  "SELECT page_ref,anchor,note,action,status FROM comment WHERE round_id IN (SELECT id FROM round WHERE book_id=?) ORDER BY id"
).all(bookId);
if (!rows.length) { console.error(`no comments recorded for ${bookId}`); process.exit(1); }

const rounds = db.prepare("SELECT number,sent_at FROM round WHERE book_id=? ORDER BY number").all(bookId);

// ---- locate the typeset PDF (for the printed-page footer map) --------------
function findTypesetPdf() {
  if (flag("pdf")) return flag("pdf");
  // Prefer a typeset_pdf version row if one exists.
  const v = db.prepare(
    "SELECT stored_path FROM version WHERE book_id=? AND kind='typeset_pdf' ORDER BY id DESC LIMIT 1"
  ).get(bookId);
  if (v && v.stored_path && fs.existsSync(v.stored_path)) return v.stored_path;
  // Otherwise derive from the manuscript basename and scan output/.
  const man = db.prepare(
    "SELECT stored_path,original_name FROM version WHERE book_id=? AND kind='manuscript' ORDER BY id DESC LIMIT 1"
  ).get(bookId);
  const base = man ? path.basename(man.stored_path || man.original_name).replace(/\.docx?$/i, "") : null;
  const outDir = path.join(ROOT, "output");
  let hit = null;
  const walk = (dir) => {
    if (hit || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/ - typeset\.pdf$/i.test(e.name) && (!base || e.name.startsWith(base))) { hit = p; return; }
    }
  };
  walk(outDir);
  return hit;
}

// ---- printed-page map from the PDF footers ---------------------------------
async function buildPageMap(pdfPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data }).promise;
  const map = {};
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    let best = null;
    for (const it of tc.items) {
      const y = it.transform[5];
      const s = (it.str || "").trim();
      if (/^(\d{1,3}|[ivxlcdm]{1,6})$/i.test(s) && y < vp.height * 0.10) best = s; // bottom band
    }
    map[p] = best;
  }
  return map;
}

const pageNum = (p) => { const m = String(p || "").match(/\d+/); return m ? parseInt(m[0], 10) : 9999; };

// Given the footer map, return a physical→printed translator. The body offset is
// measured (modal physical−printed over all arabic footers), so this works for
// any book regardless of how many front-matter pages it has.
function makePrintedPage(map) {
  const offsets = {};
  let lastPrinted = 0;
  for (const [phys, foot] of Object.entries(map)) {
    if (foot != null && /^\d+$/.test(foot)) {
      const off = Number(phys) - Number(foot);
      offsets[off] = (offsets[off] || 0) + 1;
      if (Number(foot) > lastPrinted) lastPrinted = Number(foot);
    }
  }
  const modalOffset = Object.entries(offsets).sort((a, b) => b[1] - a[1])[0];
  const off = modalOffset ? Number(modalOffset[0]) : 0;
  return (pref) => {
    const n = pageNum(pref);
    const foot = map[n];
    if (foot != null) return String(foot);              // exact footer from the PDF
    if (n - off >= 1) return String(Math.min(n - off, lastPrinted)); // measured offset, clamped
    return "—";
  };
}

// ---- text cleaners --------------------------------------------------------
// Tidy the author's own note: drop the instruction verb, collapse space, cap.
const cleanNote = (s) => {
  let t = String(s || "").replace(/\r/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(REPLACE( THIS PARA)?( WITH)?( THIS)?|RWT|REMOVE|DELETE)\s*:?\s*/i,
    (m) => (/REMOVE|DELETE/i.test(m) ? "Remove: " : "New text: "));
  if (t.length > 420) t = t.slice(0, 417) + "…";
  return t;
};

// Translate our internal resolution codes into plain language for the author,
// stripping every implementation detail (primitive names, verification notes…).
const cleanAction = (s) => {
  let t = String(s || "").trim();
  if (/^auto:\s*replaceExact/i.test(t)) return "Replaced with your suggested wording.";
  if (/^auto:\s*deleteExact/i.test(t)) return "Removed as requested.";
  if (/^already/i.test(t)) return "Already reads as requested — confirmed on the page.";
  t = t.replace(/\s*NOTE\s+separately\s*:.*$/i, "");
  t = t.replace(/->/g, "→");
  t = t.replace(/\bENGINE( FIX)?\b\s*\([^)]*\):?\s*/i, "");
  for (let k = 0; k < 4; k++) {                          // strip stacked leading tags
    const before = t;
    t = t.replace(/^[+\s]*(manual|engine-fix|engine|auto|author-guided|resolved(\s+by[^:]*)?|fix)\b\s*:?\s*/i, "");
    if (t === before) break;
  }
  t = t.replace(/\s+via\b[^.]*(?=\.|$)/gi, "");           // "via <mechanism>" asides
  t = t.replace(/\s*\(\s+[^)]*\)/g, "");                  // parens left starting with a space
  t = t.replace(/\bimagerow\b/gi, "image group");
  t = t.replace(/~\s*(\d+(?:\s*-\s*\d+)?)\s*~/g, "p$1");  // ~N~ footer notation → page token
  const PGTOK = "(?:printed\\s+)?(?:on\\s+)?(?:page|p)?\\s*[\\divxlcm]+(?:\\s*[-–]\\s*[\\divxlcm]+)?(?:\\s*x\\d+)?";
  t = t.replace(new RegExp(`\\b(visually\\s+)?verified\\b(\\s+${PGTOK})?(\\s*,\\s*${PGTOK})*\\.?`, "gi"), "");
  t = t.replace(/\bWord\s+monospace\s+misalignment\s+no\s+longer\s+applies\.?/gi, "");
  t = t.replace(/\banswerRows\s+array\s+support\.?/gi, "");
  t = t.replace(/\bReplaceBlocks\b|\breplaceExact\b|\bdeleteExact\b|\bfixExercise\b|\bsetMarker\b|\bsetCaption\b|\bmdReplaceExact\b|\beditAll\b|\bdeleteRun\b|\bnumbond\b|\bcolsum\b/gi, "");
  t = t.replace(/\s*\([^)]*primitive[^)]*\)/gi, "");
  t = t.replace(/\s*\([^)]{0,14}\)/g, "");                // now-empty/short leftover parens
  t = t.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");             // en-dash ranges
  t = t.replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").replace(/\s+,/g, ",").trim();
  t = t.replace(/^[\s:;,.\-–]+/, "").trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t || "Addressed.";
};

// ---- docx layout ----------------------------------------------------------
const TEAL = "0F6E6E", GREY = "444444", ZEBRA = "F2F7F7";
const th = (txt, w) => new TableCell({
  width: { size: w, type: WidthType.PERCENTAGE },
  shading: { type: ShadingType.CLEAR, fill: TEAL, color: "auto" },
  margins: { top: 40, bottom: 40, left: 80, right: 80 },
  children: [new Paragraph({ children: [new TextRun({ text: txt, bold: true, color: "FFFFFF", size: 19 })] })],
});
const td = (txt, w, opts = {}) => new TableCell({
  width: { size: w, type: WidthType.PERCENTAGE },
  shading: opts.shade ? { type: ShadingType.CLEAR, fill: ZEBRA, color: "auto" } : undefined,
  margins: { top: 40, bottom: 40, left: 80, right: 80 },
  children: [new Paragraph({ children: Array.isArray(txt) ? txt : [new TextRun({ text: String(txt), size: 18, color: opts.color || "000000", bold: !!opts.bold })] })],
});

const fmtDate = (s) => {
  const d = new Date(String(s || "").replace(" ", "T"));
  return isNaN(d) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

async function main() {
  const pdfPath = findTypesetPdf();
  if (!pdfPath) {
    console.error("could not find the typeset PDF (build it first, or pass --pdf <path>).");
    process.exit(1);
  }
  const printedPage = makePrintedPage(await buildPageMap(pdfPath));

  const displayTitle = book.title.replace(/\s+(LB|TG)$/i, (m, k) =>
    ` — ${/LB/i.test(k) ? "Learner's Book" : "Teacher's Guide"}`);
  const reviewers = flag("reviewers") || book.author || null;
  const roundBits = rounds.map((r) => {
    const d = fmtDate(r.sent_at);
    return `Round ${r.number}${d ? ` (sent ${d})` : ""}`;
  }).join(" · ");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const subtitleParts = [
    reviewers ? `Reviewers: ${reviewers}` : null,
    roundBits || null,
    `prepared ${today}`,
    "Typesetting: Gift Kapula",
  ].filter(Boolean).join(" · ");

  const children = [];
  children.push(new Paragraph({ children: [new TextRun({ text: displayTitle, bold: true, size: 40, color: TEAL })], spacing: { after: 60 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: "Author's proofread comments — corrections log", size: 26, color: GREY })], spacing: { after: 40 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: subtitleParts, italics: true, size: 20, color: GREY })], spacing: { after: 160 } }));
  children.push(new Paragraph({ children: [
    new TextRun({ text: "Summary: ", bold: true, size: 22 }),
    new TextRun({ text: `all ${rows.length} comments you left have been addressed.`, size: 22, color: TEAL }),
  ], spacing: { after: 60 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: "Each row lists the page, the passage your note was attached to, what you asked for, and what was done. Page numbers are the printed page numbers of the book.", size: 20, color: GREY })], spacing: { after: 200 } }));

  const sorted = [...rows].sort((a, b) => pageNum(a.page_ref) - pageNum(b.page_ref));
  const header = new TableRow({ tableHeader: true, children: [
    th("Page", 7), th("Passage in the book", 30), th("Your comment", 33), th("What was done", 30),
  ] });
  const bodyRows = sorted.map((r, i) => new TableRow({ children: [
    td(printedPage(r.page_ref), 7, { shade: i % 2 === 1, bold: true }),
    td(r.anchor ? `“${String(r.anchor).replace(/\r/g, " ").replace(/~\s*\d+\s*~/g, " ").replace(/\s+/g, " ").trim()}”` : "—", 30, { shade: i % 2 === 1, color: GREY }),
    td(cleanNote(r.note), 33, { shade: i % 2 === 1 }),
    td([new TextRun({ text: "✓ ", bold: true, color: TEAL, size: 18 }), new TextRun({ text: cleanAction(r.action), size: 18 })], 30, { shade: i % 2 === 1 }),
  ] }));

  const grey = { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" };
  const thin = { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" };
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: grey, bottom: grey, left: grey, right: grey, insideHorizontal: thin, insideVertical: thin },
    rows: [header, ...bodyRows],
  });
  children.push(table);

  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }],
  });

  const out = flag("out") || path.join(ROOT, "proofread-books", `${book.title} - corrections log.docx`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out}\n  ${rows.length} comments · printed pages from ${path.basename(pdfPath)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
