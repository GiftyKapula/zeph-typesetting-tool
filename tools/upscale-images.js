#!/usr/bin/env node
"use strict";
/*
 * upscale-images.js — bring every picture in a book up to print resolution.
 *
 * CLAUDE.md requires 300 DPI at final print size. A manuscript's own pictures are
 * usually well under that (a Word document is a screen document: the ICT Form 2
 * Learner's Book sat between 102 and 268 DPI), and the shortfall is invisible on
 * screen but soft on paper.
 *
 * Measuring the shortfall is the part worth automating. The PRINTED size of a
 * picture is decided by the template, not by the manuscript, so the only honest
 * measure is the built PDF: `pdfimages -list` reports the effective ppi of every
 * placed image. That is what this tool reads, so an image is judged at the size it
 * actually prints at rather than at some assumed width.
 *
 * For each picture below the target it runs Real-ESRGAN (4x, the ncnn-vulkan build
 * named in CLAUDE.md) and then resamples the result DOWN to exactly the pixels the
 * target DPI needs. The downscale matters: most pictures only need ~1.2x, and
 * shipping the raw 4x output would bloat the book for no gain. Going up through
 * ESRGAN and back down still pays, because ESRGAN reconstructs edges and clears
 * compression artefacts rather than just interpolating — which is the difference
 * between "bigger" and "clearer".
 *
 * Output is PNG, never JPEG (CLAUDE.md: no compression artefacts in print art).
 *
 * The result is written as `images` override entries, so the manuscript is never
 * touched and the swap is version-controlled config. Only `src` is set: the on-page
 * width comes from Word's own <wp:extent> (see import-docx.js), not from the file's
 * pixel width, so replacing the bytes cannot move anything on the page.
 *
 * Usage:
 *   node tools/upscale-images.js "<book.docx>" "<book - typeset.pdf>" [options]
 *     --dpi <n>     target DPI (default 300; images are rendered a little above it)
 *     --out <dir>   where the upscaled files go (default "<docx dir>/<base>-hires")
 *     --map p<N>=<media name>   map a placed image this tool could not identify
 *                   (see "cropped pictures" below) to its source media file
 *     --dry-run     report the plan and write nothing
 *     --limit <n>   process only the n worst images (useful to sample first)
 *
 * Cropped pictures: Word stores the FULL picture plus a crop rectangle, and
 * import-docx.js applies the crop — but it deliberately does NOT crop a replacement
 * image (an override is taken as already print-ready). So a cropped picture cannot
 * be matched to its source by pixel size, and upscaling the source would reinstate
 * the cropped-away region. For those, pass --map: the tool takes the already-cropped
 * bitmap out of the PDF and upscales that, which keeps the author's crop.
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ESRGAN = process.env.REALESRGAN
  || "C:\\Users\\biine stores\\Desktop\\REAL-\\realesrgan-ncnn-vulkan.exe";

// ---- tiny image helpers (dimensions straight from the file header) ----------
function dims(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function parseArgs(argv) {
  const o = { dpi: 300, map: {}, dryRun: false, limit: 0 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dpi") o.dpi = +argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--limit") o.limit = +argv[++i];
    else if (a === "--map") {
      for (const pair of argv[++i].split(",")) {
        const [k, v] = pair.split("=");
        if (k && v) o.map[k.trim().replace(/^p/i, "")] = v.trim();
      }
    } else pos.push(a);
  }
  o.docx = pos[0]; o.pdf = pos[1];
  return o;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.docx || !opt.pdf) {
    console.error("usage: node tools/upscale-images.js <book.docx> <book.pdf> [--dpi 300] [--out dir] [--map pN=imageN.png] [--dry-run] [--limit n]");
    process.exit(2);
  }
  for (const f of [opt.docx, opt.pdf]) {
    if (!fs.existsSync(f)) { console.error("!  not found:", f); process.exit(2); }
  }
  const JSZip = require("jszip");
  const { createCanvas, loadImage } = require("canvas");

  const base = path.basename(opt.docx, path.extname(opt.docx));
  const outDir = opt.out
    ? path.resolve(opt.out)
    : path.join(path.dirname(opt.docx), base + "-hires");
  const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "upscale-"));

  // ---- 1. the manuscript's own pictures -------------------------------------
  const zip = await JSZip.loadAsync(fs.readFileSync(opt.docx));
  const byDims = new Map();           // "WxH" -> [media name]
  const srcDir = path.join(work, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith("word/media/"))) {
    const buf = await zip.file(name).async("nodebuffer");
    const d = dims(buf);
    if (!d) continue;
    const b = path.basename(name);
    fs.writeFileSync(path.join(srcDir, b), buf);
    const k = d.w + "x" + d.h;
    if (!byDims.has(k)) byDims.set(k, []);
    byDims.get(k).push(b);
  }

  // ---- 2. how big each one actually PRINTS ----------------------------------
  const listing = cp.execSync(`pdfimages -list "${opt.pdf}"`, { encoding: "utf8", maxBuffer: 1 << 28 });
  const placed = listing.split("\n").slice(2)
    .map((l) => l.trim().split(/\s+/))
    .filter((r) => r[2] === "image")
    .map((r) => ({ page: +r[0], w: +r[3], h: +r[4], ppi: +r[12] }));

  const taken = new Set();
  const jobs = [];
  const unresolved = [];
  for (const p of placed) {
    if (!isFinite(p.ppi) || p.ppi <= 0 || p.ppi >= opt.dpi) continue;
    const mapped = opt.map[String(p.page)];
    if (mapped) {
      // a cropped picture: upscale the cropped bitmap the PDF already holds
      const stem = path.join(work, "crop_p" + p.page);
      cp.execSync(`pdfimages -f ${p.page} -l ${p.page} -png "${opt.pdf}" "${stem}"`, { stdio: "ignore" });
      const cand = fs.readdirSync(work)
        .filter((f) => f.startsWith("crop_p" + p.page + "-"))
        .map((f) => ({ f, d: dims(fs.readFileSync(path.join(work, f))) }))
        .find((c) => c.d && c.d.w === p.w && c.d.h === p.h);
      if (!cand) { unresolved.push(p); continue; }
      taken.add(mapped);
      jobs.push({ name: mapped, from: path.join(work, cand.f), w: p.w, ppi: p.ppi, page: p.page, cropped: true });
      continue;
    }
    const names = (byDims.get(p.w + "x" + p.h) || []).filter((n) => !taken.has(n));
    if (!names.length) { unresolved.push(p); continue; }
    taken.add(names[0]);
    jobs.push({ name: names[0], from: path.join(srcDir, names[0]), w: p.w, ppi: p.ppi, page: p.page, cropped: false });
  }
  // Render a little above the target so rounding can never land under it.
  const head = Math.round(opt.dpi * 1.03);
  for (const j of jobs) j.target = Math.min(j.w * 4, Math.ceil(j.w * head / j.ppi));
  jobs.sort((a, b) => a.ppi - b.ppi);          // worst first — most visible gain earliest
  const run = opt.limit > 0 ? jobs.slice(0, opt.limit) : jobs;

  console.log(`${placed.length} placed image(s); ${jobs.length} below ${opt.dpi} DPI` +
    (opt.limit ? ` (processing the worst ${run.length})` : ""));
  if (unresolved.length) {
    console.log("!  could not identify (pass --map pN=<media file>): " +
      unresolved.map((p) => `p${p.page} ${p.w}x${p.h}@${p.ppi}`).join(", "));
  }
  for (const j of run) {
    console.log(`   p${String(j.page).padStart(3)}  ${j.name.padEnd(15)} ${String(j.w).padStart(5)}px @${String(j.ppi).padStart(4)} DPI -> ${j.target}px @~${Math.round(j.target / j.w * j.ppi)} DPI${j.cropped ? "  (cropped)" : ""}`);
  }
  if (opt.dryRun) { console.log("\n(dry run — nothing written)"); return; }

  // ---- 3. upscale, then resample down to exactly what the target DPI needs ---
  fs.mkdirSync(outDir, { recursive: true });
  const done = [];
  for (let i = 0; i < run.length; i++) {
    const j = run[i];
    const outFile = path.join(outDir, path.basename(j.name, path.extname(j.name)) + ".png");
    const tag = `[${i + 1}/${run.length}] ${j.name}`;
    if (fs.existsSync(outFile)) { console.log(`${tag}: already done, skipping`); done.push({ j, outFile }); continue; }
    const big = path.join(work, "up_" + path.basename(j.name, path.extname(j.name)) + ".png");
    const t0 = Date.now();
    try {
      cp.execFileSync(ESRGAN, ["-i", j.from, "-o", big, "-n", "realesrgan-x4plus"], { stdio: "ignore" });
    } catch (e) {
      console.warn(`${tag}: Real-ESRGAN failed (${e.message.split("\n")[0]}) — left as is`);
      continue;
    }
    const img = await loadImage(big);
    const w = Math.min(j.target, img.width);
    const h = Math.round(img.height * (w / img.width));
    const cv = createCanvas(w, h);
    const ctx = cv.getContext("2d");
    ctx.patternQuality = "best";
    ctx.quality = "best";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, w, h);
    fs.writeFileSync(outFile, cv.toBuffer("image/png"));
    fs.unlinkSync(big);
    console.log(`${tag}: ${j.w}px -> ${w}px  (${((Date.now() - t0) / 1000).toFixed(0)}s, ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB)`);
    done.push({ j, outFile });
  }

  // ---- 4. record the swaps as overrides -------------------------------------
  const ovPath = path.join(path.dirname(opt.docx), base + ".overrides.json");
  const ov = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, "utf8")) : {};
  ov.images = ov.images || {};
  for (const { j, outFile } of done) {
    // relative to the .docx, which is how import-docx.js resolves an override path
    ov.images[j.name] = { src: path.relative(path.dirname(opt.docx), outFile).replace(/\\/g, "/") };
  }
  fs.writeFileSync(ovPath, JSON.stringify(ov, null, 2) + "\n");
  console.log(`\nwrote ${done.length} override(s) to ${path.basename(ovPath)}`);
  console.log("re-typeset the book, then check the DPI again with:");
  console.log(`  pdfimages -list "${opt.pdf}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
