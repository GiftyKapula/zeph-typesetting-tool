#!/usr/bin/env node
// reader:import — turn a supplementary reader or novel (a PDF with a text layer, or a Word
// file) into a book folder the typesetter works from:
//
//   <out>/<Title>/<Title>.docx         the manuscript in the reader styles (edit this in Word)
//   <out>/<Title>/<Title>.reader.json  title page facts, family, trim, cover design
//   <out>/<Title>/images/              pictures cropped from the PDF at 300 dpi
//   <out>/<Title>/import-report.txt    what was found, and what to check by eye
//
// Usage:
//   npm run reader:import -- "<book.pdf|book.docx>" [--out <folder>] [--language Icibemba]
//        [--family novel|reader|poetry] [--design sunrise] [--palette terracotta]
//        [--title "..."] [--name "<folder name>"]
const fs = require("fs");
const path = require("path");
const { extractBook } = require("./pdf-extract.js");
const { writeDocx } = require("./to-docx.js");
const { readDocx } = require("./read-docx.js");
const { defaults } = require("./settings.js");

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; o[k] = v; }
    else o._.push(a);
  }
  return o;
}
const safe = (s) => s.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, " ").trim();
// ALL-CAPS title page words -> title case; short joining words stay small ("Muzibe za Muleneñi")
const SMALL = new Set(["a", "an", "and", "the", "of", "in", "on", "for", "to", "za", "ya", "wa", "na", "ni", "mwa", "ku", "kwa", "ba", "la", "lya", "ca", "cha", "fya", "pa", "mu", "ne", "no", "nu", "ka", "u", "i"]);
const titleCase = (s) => {
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/(\s+)/).map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[(“"'.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()))).join("");
};

// Page size: the same size the original typesetter used (read from the source), snapped
// to the nearest standard size; A5 when it cannot be read. --trim 148x210 forces a size.
const SIZES = [["A5", 148, 210], ["130 x 190 mm", 130, 190], ["B5", 176, 250], ["A4", 210, 297], ["B-format", 129, 198], ["Demy", 138, 216]];
function pickTrim(measured, forced) {
  if (forced) { const m = String(forced).match(/(\d+)\s*[x×]\s*(\d+)/); if (m) return { trim: [+m[1], +m[2]], how: "set by --trim" }; }
  if (measured && measured[0] > 90 && measured[1] > 120) {
    const [w, h] = measured;
    const near = SIZES.find(([, sw, sh]) => Math.abs(sw - w) <= 4 && Math.abs(sh - h) <= 4);
    if (near) return { trim: [near[1], near[2]], how: `${near[0]}, as in the source` };
    return { trim: [Math.round(w), Math.round(h)], how: `${Math.round(w)} x ${Math.round(h)} mm, as in the source (not a standard size: check)` };
  }
  return { trim: [148, 210], how: "A5 (the source size could not be read)" };
}
// a Word file's page size (w:pgSz, twips) from its last section
async function docxTrim(file) {
  try {
    const JSZip = require("jszip");
    const xml = await (await JSZip.loadAsync(fs.readFileSync(file))).file("word/document.xml").async("string");
    const all = [...xml.matchAll(/<w:pgSz\b[^>]*?w:w="(\d+)"[^>]*?w:h="(\d+)"/g)];
    if (!all.length) return null;
    const [, tw, th] = all[all.length - 1];
    const w = +tw / 1440 * 25.4, h = +th / 1440 * 25.4;
    return [Math.min(w, h), Math.max(w, h)];
  } catch (_) { return null; }
}

async function main() {
  const a = args(process.argv.slice(2));
  const src = a._[0];
  if (!src || !fs.existsSync(src)) { console.log('usage: npm run reader:import -- "<book.pdf|book.docx>" [--out <folder>] [--language ...] [--family ...] [--trim 148x210]'); process.exit(1); }
  const outRoot = a.out || path.dirname(src);
  const report = [];
  const log = (s) => { report.push(s); console.log("  " + s); };
  let model;
  const tmp = path.join(outRoot, "_import-" + process.pid);
  if (/\.pdf$/i.test(src)) {
    model = await extractBook(src, { outDir: tmp, log });
  } else if (/\.docx$/i.test(src)) {
    model = await readDocx(src, { mediaDir: path.join(tmp, "images") });
    for (const b of [...model.body, ...model.front.flatMap((f) => f.blocks || [])]) if (b.t === "fig") b.file = b.file.replace(/^media\//, "images/");
    model.meta.source = path.basename(src);
    model.meta.trim = await docxTrim(src);
    log(`Word file read by look: ${model.body.filter((b) => b.t === "h1").length} chapters, ${model.body.filter((b) => b.t === "fig").length} pictures`);
  } else { console.log("only .pdf and .docx can be imported"); process.exit(1); }
  if (a.title) model.meta.title = a.title;
  const size = pickTrim(model.meta.trim, a.trim);
  model.meta.trim = size.trim;
  log(`page size: ${size.how}`);
  const name = safe(a.name || titleCase(model.meta.title || path.basename(src, path.extname(src))));
  const dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  // move pictures into the book folder
  if (fs.existsSync(path.join(tmp, "images"))) {
    fs.mkdirSync(path.join(dir, "images"), { recursive: true });
    for (const f of fs.readdirSync(path.join(tmp, "images"))) fs.renameSync(path.join(tmp, "images", f), path.join(dir, "images", f));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const settings = defaults(model.meta, { language: a.language, family: a.family, design: a.design, palette: a.palette });
  if (model.meta.contentsTitle) settings.contentsTitle = titleCase(model.meta.contentsTitle);
  settings.title = titleCase(settings.title);
  settings.author = titleCase(settings.author);
  settings.outName = name;
  // the "art" cover design uses the biggest picture in the book unless one is named
  if (settings.cover.design === "art" && !settings.cover.art) {
    const figs = model.body.filter((x) => x.t === "fig").sort((p, q) => (q.wpt * q.hpt) - (p.wpt * p.hpt));
    if (figs[0]) settings.cover.art = figs[0].file; else { settings.cover.design = "sunrise"; log("no pictures for the art cover: using sunrise"); }
  }
  const sfile = path.join(dir, name + ".reader.json");
  if (fs.existsSync(sfile) && !a.force) {
    log(`kept the existing settings file (${path.basename(sfile)}); use --force to replace it`);
  } else fs.writeFileSync(sfile, JSON.stringify(settings, null, 2));
  const docx = path.join(dir, name + ".docx");
  await writeDocx(model, docx, dir);
  // report
  const h1 = model.body.filter((b) => b.t === "h1");
  const untitled = h1.filter((b) => !b.title && !b.label).length;
  report.push("", `Title: ${settings.title}`, `Author: ${settings.author || "(not found: fill in the settings file)"}`, `ISBN: ${settings.isbn || "(not found)"}`,
    `Chapters: ${h1.length}${untitled ? ` (${untitled} without a title: chapter breaks found from drop capitals)` : ""}`,
    `Section headings: ${model.body.filter((b) => b.t === "h2").length}`, `Pictures: ${model.body.filter((b) => b.t === "fig").length}`,
    `Paragraphs: ${model.body.filter((b) => b.t === "p").length}`, "",
    "CHECK BY EYE (open the source PDF beside the Word file):",
    " 1. Every chapter heading is in style Heading 1 (chapter numbers in style Chapter Number).",
    " 2. No paragraph is broken in two, and no two paragraphs are joined.",
    " 3. Pictures are in the right places; captions use style Caption.",
    " 4. Songs and poems use style Centred (or each line its own paragraph).",
    " 5. Front matter: Book Title, Book Author and Imprint lines are right.");
  if (!h1.length) report.push(" NOTE: no chapters were found. If the book has chapters, mark each heading as Heading 1 in Word.");
  fs.writeFileSync(path.join(dir, "import-report.txt"), report.join("\r\n"));
  console.log(`\n${name}: ${docx}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
