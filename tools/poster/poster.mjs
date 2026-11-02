#!/usr/bin/env node
// Marketing posters for released books — see docs/POSTERS.md.
//
//   npm run poster -- "books-to-typeset/…/<book>.docx" [--theme cream|complement|deep|silver]
//   npm run poster:all                      # every book with "releasedForPrint": true
//
// Writes to output/_marketing/<book>/:
//   <book> - poster 1080x1350.png  (+ "HD" 2160x2700)   WhatsApp / Facebook feed
//   <book> - poster 1080x1080.png  (+ "HD" 2160x2160)   square
//   <book> - poster A4 print.pdf                        A4 + 3 mm bleed, TrimBox/BleedBox set
//   front-cover.png, poster-qa.json
//
// Uses ONLY the book's front cover (page 1 of its typeset PDF) and its cover words and
// metadata. Never interior pages, never admin/, no network.

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { bookInfo, releasedBooks, ROOT } from "./lib/book.mjs";
import { renderFrontCover, loadImage } from "./lib/cover.mjs";
import { bookMockup } from "./lib/mockup.mjs";
import { dominantColours, meanColour, pickTheme, hex } from "./lib/colour.mjs";
import { buildPoster } from "./lib/layout.mjs";
import { compilePdf, pdfToPng, inspectPdf } from "./lib/render.mjs";
import { checkPoster, summary } from "./lib/check.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument } = require("pdf-lib");
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "poster-config.json"), "utf8"));
const LOGO = path.join(ROOT, "zeph-logo", "image.png");
const MM = 72 / 25.4;

export function marketingDir(base) {
  const out = process.env.ZEPH_OUTPUT_DIR ? path.resolve(process.env.ZEPH_OUTPUT_DIR) : path.join(ROOT, "output");
  return path.join(out, "_marketing", base);
}

// Mark the trimmed page for the printer: BleedBox = the whole sheet, TrimBox = inside the bleed.
async function printBoxes(pdfBuf, bleedPt, title) {
  const doc = await PDFDocument.load(pdfBuf);
  const p = doc.getPage(0);
  const { width, height } = p.getSize();
  p.setBleedBox(0, 0, width, height);
  p.setTrimBox(bleedPt, bleedPt, width - 2 * bleedPt, height - 2 * bleedPt);
  p.setArtBox(bleedPt, bleedPt, width - 2 * bleedPt, height - 2 * bleedPt);
  doc.setTitle(title); doc.setAuthor("Zambia Educational Publishing House"); doc.setCreator("ZEPH poster tool");
  return Buffer.from(await doc.save());
}

// Every book gets TWO separate poster sets, side by side, to choose from:
//   A  "flat"  the book standing square-on; the cover is placed as a VECTOR page (cut from
//              page 1 of the book's PDF), so its words — the authors too — stay sharp
//   B  "3d"    the book turned towards the viewer, as in the approved sample (a picture)
// `bookStyle` ("flat" | "3d", CLI --book) makes one set only.
export const STYLES = { flat: { letter: "A", name: "flat book" }, "3d": { letter: "B", name: "3D book" } };

export async function makePosters(docx, { theme: themeArg, bookStyle } = {}) {
  const book = bookInfo(docx);
  if (!book.pdf) throw new Error(`no typeset PDF for "${book.base}" — build the book first`);
  if (bookStyle && !STYLES[bookStyle]) throw new Error(`unknown book style "${bookStyle}" (flat or 3d)`);
  const dir = marketingDir(book.base);

  const cover = await renderFrontCover(book.pdf, { targetWidth: 3000, authors: book.fields.authors });
  // a landscape book is a CDC syllabus: it is not sold, so it gets no advert
  if (cover.aspect < 1) return { book: book.base, sets: [], qualifies: true, skipped: "a landscape syllabus — posters are made for Learner's Books and Teacher's Guides" };
  fs.mkdirSync(dir, { recursive: true });
  const coverInfo = { mean: meanColour(cover.pixels), dominant: dominantColours(cover.pixels, 5) };
  const { theme, ranked, forced } = pickTheme(coverInfo, themeArg || book.ov.posterTheme);
  const logoImg = await loadImage(LOGO);
  const spine = hex((coverInfo.dominant[0] || { rgb: coverInfo.mean }).rgb);
  fs.writeFileSync(path.join(dir, "front-cover.png"), cover.png);

  const sets = [];
  for (const style of bookStyle ? [bookStyle] : Object.keys(STYLES)) {
    const { letter } = STYLES[style];
    // what is placed on the poster, and what the QA measures it against
    let placed, shown, files;
    if (style === "3d") {
      const m = await bookMockup(cover.png, { spine });
      placed = { file: "cover.png", aspect: m.aspect, spine, mockup: true };
      shown = { ...cover, aspect: m.aspect, width: m.width, authorShare: cover.authorShare ? cover.authorShare * m.nearShare : null };
      files = { "cover.png": m.png, "logo.png": fs.readFileSync(LOGO) };
    } else {
      placed = { file: "cover.pdf", aspect: cover.aspect, spine };
      shown = { ...cover, vector: true };
      files = { "cover.pdf": cover.vector, "logo.png": fs.readFileSync(LOGO) };
    }
    const results = [], written = [];
    for (const f of CONFIG.formats) {
      const bleed = f.kind === "pdf" ? (f.bleedMm || 0) * MM : 0;
      const lay = buildPoster({ W: f.w, H: f.h, bleed }, theme, book.fields, CONFIG,
        placed, { file: "logo.png", aspect: logoImg.height / logoImg.width });
      let pdf = compilePdf(lay.src, files);
      const qa = checkPoster({ format: f, inspected: await inspectPdf(pdf), regions: lay.regions, fields: book.fields,
        cover: shown, coverMean: coverInfo.mean, theme, book: lay.book });
      results.push(qa);
      const stem = path.join(dir, `${book.base} - poster ${letter} ${f.name}`);
      if (f.kind === "pdf") {
        pdf = await printBoxes(pdf, bleed, `${book.fields.title} — poster ${letter}`);
        fs.writeFileSync(`${stem} print.pdf`, pdf); written.push(`${stem} print.pdf`);
      } else {
        fs.writeFileSync(`${stem}.png`, await pdfToPng(pdf, f.w, f.h)); written.push(`${stem}.png`);
        if (f.hd) { fs.writeFileSync(`${stem} HD.png`, await pdfToPng(pdf, f.w * f.hd, f.h * f.hd)); written.push(`${stem} HD.png`); }
      }
    }
    const res = {
      book: book.base, set: letter, bookStyle: style, fields: book.fields, theme: theme.name, themeForced: forced,
      themes: ranked.map((t) => ({ name: t.name, standout: t.score })),
      cover: { width: cover.width, height: cover.height, fromSpread: cover.spread, vector: style === "flat" },
      qualifies: results.every((r) => r.qualifies), formats: results,
      files: written.map((p) => path.basename(p)), made: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, `poster-qa-${letter}.json`), JSON.stringify(res, null, 2));
    sets.push(res);
  }
  return { book: book.base, sets, qualifies: sets.every((s) => s.qualifies) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const ti = args.indexOf("--theme");
  const theme = ti >= 0 ? args[ti + 1] : undefined;
  const bi = args.indexOf("--book");
  const bookStyle = bi >= 0 ? args[bi + 1] : undefined;
  const books = all ? releasedBooks() : args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--theme" && args[i - 1] !== "--book");
  if (!books.length) { console.error(all ? "no released books (\"releasedForPrint\": true) found" : "usage: npm run poster -- <book.docx> [--theme name] [--book flat|3d]  (default: both sets, A flat and B 3D)"); process.exit(all ? 0 : 1); }
  let bad = 0;
  for (const b of books) {
    try {
      if (!all) { const info = bookInfo(b); if (!info.released) console.log(`(note: ${info.base} is not marked released for print)`); }
      const r = await makePosters(b, { theme, bookStyle });
      if (r.skipped) { console.log(`– ${r.book}: no posters, ${r.skipped}`); continue; }
      for (const s of r.sets) console.log(summary(s));
      console.log(`   -> ${path.relative(ROOT, marketingDir(r.book))}`);
      if (!r.qualifies) bad++;
    } catch (e) { bad++; console.log(`✗ ${path.basename(b)}: ${e.message}`); }
  }
  process.exit(bad ? 1 : 0);
}
