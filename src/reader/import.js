#!/usr/bin/env node
// reader:import — turn a supplementary reader or novel (a PDF with a text layer, or a Word
// file) into a book folder the typesetter works from:
//
//   <out>/<Title>/<Title>.docx         the manuscript in the reader styles (edit this in Word)
//   <out>/<Title>/<Title>.reader.json  title page facts, family, trim, cover design
//   <out>/<Title>/images/              pictures cropped from the PDF at 300 dpi
//   <out>/<Title>/cover/               the book's own cover, when a cover PDF is given
//   <out>/<Title>/import-report.txt    what was found, and what to check by eye
//
// Usage:
//   npm run reader:import -- "<book.pdf|book.docx>" [--out <folder>] [--language Icibemba]
//        [--family novel|reader|poetry] [--cover "<covers.pdf>"] [--design sunrise] [--palette terracotta]
//        [--title "..."] [--name "<folder name>"] [--cover-rotate 90|180|270]
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

// covers: page 1 = front, page 2 = back (a one-page scan is the front only); white margins
// around the scan are trimmed off
// opts.rotate: turn the scan (90, 180, 270 degrees clockwise) before cropping.
// A one-page scan that is clearly wider than tall after cropping is taken as the whole
// spread (back | front) and split down the middle.
async function importCover(pdfFile, dir, opts = {}) {
  const { openPdf } = require("./pdf-open.js");
  const { createCanvas } = require("canvas");
  const doc = await openPdf(pdfFile);
  const out = {};
  const save = (cc, which) => {
    fs.mkdirSync(dir, { recursive: true });
    const name = `cover-${which}.jpg`;
    fs.writeFileSync(path.join(dir, name), cc.toBuffer("image/jpeg", { quality: 0.92 }));
    out[which] = { file: "cover/" + name, w: cc.width, h: cc.height, landscape: cc.width > cc.height };
  };
  for (let n = 1; n <= Math.min(2, doc.numPages); n++) {
    const pg = await doc.getPage(n);
    const v = pg.getViewport({ scale: 300 / 72, rotation: ((pg.rotate || 0) + (+opts.rotate || 0)) % 360 });
    const c = createCanvas(Math.ceil(v.width), Math.ceil(v.height)); const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, viewport: v }).promise;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // scanner background: the lightest corner; the cover is whatever differs clearly from it
    const avg = (x0, y0, w, h) => { let r = 0, gg = 0, b = 0, n = 0; for (let y = y0; y < y0 + h; y += 4) for (let x = x0; x < x0 + w; x += 4) { const o = (y * c.width + x) * 4; r += d[o]; gg += d[o + 1]; b += d[o + 2]; n++; } return [r / n, gg / n, b / n]; };
    const cw = Math.floor(c.width * 0.04), ch = Math.floor(c.height * 0.04);
    const corners = [avg(0, 0, cw, ch), avg(c.width - cw, 0, cw, ch), avg(0, c.height - ch, cw, ch), avg(c.width - cw, c.height - ch, cw, ch)];
    const bg = corners.sort((p, q) => (q[0] + q[1] + q[2]) - (p[0] + p[1] + p[2]))[0];
    // (light, colourless pixels are scanner lid or shadow, never cover)
    const ink = (x, y) => {
      const o = (y * c.width + x) * 4; const r = d[o], gg = d[o + 1], b = d[o + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (mn > 175 && mx - mn < 22) return false;
      return Math.abs(r - bg[0]) + Math.abs(gg - bg[1]) + Math.abs(b - bg[2]) > 75;
    };
    const rowInk = (y, x0 = 0, x1 = c.width) => { let n = 0; for (let x = x0; x < x1; x += 3) if (ink(x, y)) n++; return n / ((x1 - x0) / 3); };
    const colInk = (x, y0, y1) => { let n = 0; for (let y = y0; y < y1; y += 3) if (ink(x, y)) n++; return n / ((y1 - y0) / 3); };
    let x0 = 0, x1 = c.width - 1; while (x0 < x1 && colInk(x0, 0, c.height) < 0.3) x0++; while (x1 > x0 && colInk(x1, 0, c.height) < 0.3) x1--;
    let y0 = 0, y1 = c.height - 1; while (y0 < y1 && rowInk(y0, x0, x1) < 0.5) y0++; while (y1 > y0 && rowInk(y1, x0, x1) < 0.5) y1--;
    // a coloured cover: grey strips at the edges are the scanner lid or its shadow
    const sat = (x, y) => { const o = (y * c.width + x) * 4; return Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]) > 40; };
    const satFrac = (ax, ay, bx, by) => { let s = 0, k = 0; for (let y = ay; y <= by; y += 6) for (let x = ax; x <= bx; x += 6) { k++; if (sat(x, y)) s++; } return k ? s / k : 0; };
    const mx = Math.round((x1 - x0) * 0.25), my = Math.round((y1 - y0) * 0.25);
    if (satFrac(x0 + mx, y0 + my, x1 - mx, y1 - my) > 0.5) {
      const step = 3;
      while (x1 - x0 > 200 && satFrac(x1 - step, y0, x1, y1) < 0.2) x1 -= step;
      while (x1 - x0 > 200 && satFrac(x0, y0, x0 + step, y1) < 0.2) x0 += step;
      while (y1 - y0 > 200 && satFrac(x0, y1 - step, x1, y1) < 0.2) y1 -= step;
      while (y1 - y0 > 200 && satFrac(x0, y0, x1, y0 + step) < 0.2) y0 += step;
    }
    // a hair inside the edge, so no scanner shadow line is left
    const cut = Math.round(Math.min(x1 - x0, y1 - y0) * 0.006); x0 += cut; x1 -= cut; y0 += cut; y1 -= cut;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const cc = createCanvas(w, h); cc.getContext("2d").drawImage(c, x0, y0, w, h, 0, 0, w, h);
    if (n === 1 && doc.numPages === 1 && w > h * 1.25) {
      // the whole spread on one page: back on the left, front on the right
      const half = Math.floor(w / 2);
      for (const [which, sx] of [["back", 0], ["front", w - half]]) {
        const hc = createCanvas(half, h); hc.getContext("2d").drawImage(cc, sx, 0, half, h, 0, 0, half, h); save(hc, which);
      }
      out.spread = true;
    } else save(cc, n === 1 ? "front" : "back");
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const src = a._[0];
  if (!src || !fs.existsSync(src)) { console.log('usage: npm run reader:import -- "<book.pdf|book.docx>" [--out <folder>] [--language ...] [--family ...] [--cover "<covers.pdf>"]'); process.exit(1); }
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
    model.meta.trim = [148, 210];
    log(`Word file read by look: ${model.body.filter((b) => b.t === "h1").length} chapters, ${model.body.filter((b) => b.t === "fig").length} pictures`);
  } else { console.log("only .pdf and .docx can be imported"); process.exit(1); }
  if (a.title) model.meta.title = a.title;
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
  if (a.cover) {
    const cv = await importCover(a.cover, path.join(dir, "cover"), { rotate: a["cover-rotate"] });
    if (cv.front) { settings.cover.front = cv.front.file; settings.cover.design = "original"; }
    if (cv.back) settings.cover.back = cv.back.file;
    log(`own cover: ${["front", "back"].filter((k) => cv[k]).join(" + ")}${cv.spread ? " (one scan of the whole spread, split in two)" : ""} (check the crop in cover/)`);
    if (cv.front && cv.front.landscape) log("NOTE: the front cover scan is wider than tall: it may hold front and back side by side, or be turned. Import again with --cover-rotate 90 (or 270) if it is turned.");
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
