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
 *     --tile <n>    Real-ESRGAN tile size (default 64)
 *
 * Memory: this is the binding constraint, not speed. A 4x pass over a ~1.4MP
 * picture produces a ~22MP intermediate, and decoding that to resample it costs
 * ~90MB on its own — enough to get the process killed on a small machine (it was,
 * on a 4GB one). Two things keep the footprint flat: Real-ESRGAN runs with a small
 * `-t` tile so it never allocates the whole frame at once, and the resample runs in
 * a SHORT-LIVED CHILD process, so the intermediate is freed the moment it is
 * written rather than accumulating across a long run. Runs are resumable, so a
 * process that dies anyway can simply be started again.
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

const IMGOP = path.join(__dirname, "_imgop.js");

// Every canvas operation runs as its own short-lived process (see _imgop.js).
function imgop(args) {
  const r = cp.spawnSync(process.execPath, [IMGOP, ...args.map(String)],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || "image op failed").trim());
}
const resample = (src, dst, width) => imgop(["resize", src, dst, width]);

// The largest source area we will hand Real-ESRGAN in one go. It allocates per
// whole frame, so on a small machine the run is killed above a certain size —
// measured at roughly 1MP here (0.73MP images went through, 1.05MP ones were
// killed three times running). Stay well under it.
const MAX_PIECE_PX = 400000;

// Upscale `src` by `scale`, splitting it first if it is too big to survive in one
// pass. Pieces are cut with an overlap and the overlap is trimmed back off when
// they are stitched, so the ESRGAN edge effect at each cut never reaches the
// visible part of the picture and the seams don't show.
function esrganUpscale(src, dst, scale, tile, work, tag) {
  const d = dims(fs.readFileSync(src));
  // ALWAYS the model's native 4x, and resample down afterwards ourselves.
  //
  // Asking the binary for `-s 2` looks like the obvious saving — most pictures are
  // only ~1.2x short, and it quarters the intermediate. It is a trap: on this
  // hardware that path returns the frame as a visible patchwork, each tile a
  // slightly different brightness, in a grid that tracks `-t` exactly (checked at
  // 64 and 192, both bad; 256 and above will not allocate at all). The native 4x
  // path over the same picture is clean. So the scale is not a knob to tune —
  // memory is controlled by splitting the picture instead (see MAX_PIECE_PX).
  const run = (i, o) => cp.execFileSync(ESRGAN,
    ["-i", i, "-o", o, "-n", "realesrgan-x4plus", "-s", "4", "-t", String(tile)],
    { stdio: "ignore" });
  scale = 4;

  if (!d || d.w * d.h <= MAX_PIECE_PX) { run(src, dst); return 1; }

  // Choose a grid whose pieces each come in under the cap, keeping them squarish.
  const parts = Math.ceil((d.w * d.h) / MAX_PIECE_PX);
  let cols = Math.ceil(Math.sqrt(parts * (d.w / d.h)));
  let rows = Math.ceil(parts / cols);
  while (Math.ceil(d.w / cols) * Math.ceil(d.h / rows) > MAX_PIECE_PX) {
    if (d.w / cols >= d.h / rows) cols++; else rows++;
  }
  const OV = 24;                                   // source-pixel overlap per cut
  const pieces = [];
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((d.w * c) / cols), x1 = Math.floor((d.w * (c + 1)) / cols);
      const y0 = Math.floor((d.h * r) / rows), y1 = Math.floor((d.h * (r + 1)) / rows);
      const cx = Math.max(0, x0 - OV), cy = Math.max(0, y0 - OV);
      const cw = Math.min(d.w, x1 + OV) - cx, ch = Math.min(d.h, y1 + OV) - cy;
      const cut = path.join(work, `pc_${n}_cut.png`);
      const up = path.join(work, `pc_${n}_up.png`);
      imgop(["crop", src, cut, cx, cy, cw, ch]);
      run(cut, up);
      fs.unlinkSync(cut);
      pieces.push({
        file: up,
        sx: (x0 - cx) * scale, sy: (y0 - cy) * scale,          // trim the overlap
        sw: (x1 - x0) * scale, sh: (y1 - y0) * scale,
        dx: x0 * scale, dy: y0 * scale,
      });
      n++;
      process.stdout.write(`\r      ${tag}: piece ${n}/${cols * rows}   `);
    }
  }
  const spec = path.join(work, "stitch.json");
  fs.writeFileSync(spec, JSON.stringify({ out: dst, w: d.w * scale, h: d.h * scale, pieces }));
  imgop(["stitch", spec]);
  for (const p of pieces) { try { fs.unlinkSync(p.file); } catch (_) { /* ignore */ } }
  fs.unlinkSync(spec);
  process.stdout.write("\r");
  return cols * rows;
}

function parseArgs(argv) {
  const o = { dpi: 300, map: {}, dryRun: false, limit: 0, tile: 64 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dpi") o.dpi = +argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--limit") o.limit = +argv[++i];
    else if (a === "--tile") o.tile = +argv[++i];
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

  const base = path.basename(opt.docx, path.extname(opt.docx));
  const outDir = opt.out
    ? path.resolve(opt.out)
    : path.join(path.dirname(opt.docx), base + "-hires");
  const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "upscale-"));

  // ---- 1. the manuscript's own pictures -------------------------------------
  let zip = await JSZip.loadAsync(fs.readFileSync(opt.docx));
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
  zip = null;                      // the whole .docx is held in here; let it go

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
  for (const j of jobs) {
    j.target = Math.min(j.w * 4, Math.ceil(j.w * head / j.ppi));
  }
  jobs.sort((a, b) => a.ppi - b.ppi);          // worst first — most visible gain earliest
  const run = opt.limit > 0 ? jobs.slice(0, opt.limit) : jobs;

  console.log(`${placed.length} placed image(s); ${jobs.length} below ${opt.dpi} DPI` +
    (opt.limit ? ` (processing the worst ${run.length})` : ""));
  if (unresolved.length) {
    console.log("!  could not identify (pass --map pN=<media file>): " +
      unresolved.map((p) => `p${p.page} ${p.w}x${p.h}@${p.ppi}`).join(", "));
  }
  for (const j of run) {
    console.log(`   p${String(j.page).padStart(3)}  ${j.name.padEnd(15)} ${String(j.w).padStart(5)}px @${String(j.ppi).padStart(4)} DPI -> ${j.target}px @~${Math.round(j.target / j.w * j.ppi)} DPI${j.cropped ? ", cropped" : ""}`);
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
    let nPieces = 1;
    try {
      nPieces = esrganUpscale(j.from, big, 4, opt.tile, work, j.name);
    } catch (e) {
      console.warn(`${tag}: Real-ESRGAN failed (${e.message.split("\n")[0]}) — left as is`);
      continue;
    }
    try {
      resample(big, outFile, j.target);
    } catch (e) {
      console.warn(`${tag}: resample failed (${e.message.split("\n")[0]}) — left as is`);
      try { fs.unlinkSync(big); } catch (_) { /* ignore */ }
      continue;
    }
    try { fs.unlinkSync(big); } catch (_) { /* ignore */ }
    const d = dims(fs.readFileSync(outFile));
    console.log(`${tag}: ${j.w}px -> ${d ? d.w : "?"}px  (${((Date.now() - t0) / 1000).toFixed(0)}s, ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB${nPieces > 1 ? ", " + nPieces + " pieces" : ""})`);
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
