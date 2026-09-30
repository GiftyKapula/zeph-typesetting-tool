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
 *     --map p<N>=<media name>   name the source of the picture on PDF page N yourself,
 *                   overriding the automatic match (rarely needed — see below)
 *     --dry-run     report the plan and write nothing
 *     --only a.png,b.png   process just these (the pictures whose WORDS need it)
 *     --limit <n>   process only the n worst images (useful to sample first)
 *     --tile <n>    Real-ESRGAN tile size (default 128 — its per-pass working
 *                   set; 256 and above will not allocate here). It does NOT change
 *                   how many pieces a frame is cut into (that is MAX_PIECE_PX in
 *                   lib/esrgan.js), only the cost of each piece.
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
 * What gets upscaled is always the bitmap in the PDF, never the manuscript's own
 * media file. Word stores the FULL picture plus a crop rectangle and import-docx.js
 * applies that crop — but it deliberately does NOT crop a REPLACEMENT image (an
 * override is taken as already print-ready). Upscaling the media file would therefore
 * hand the book back whatever the author had cropped away; on one book that restored
 * an "AI-Generated" badge in a corner the crop had removed. The PDF's copy is already
 * cropped, so building the replacement from it keeps the author's framing.
 *
 * Which picture is which: pixel size FIRST, colour signature only to break a tie.
 * Neither alone is enough. Size alone fails when a book carries a dozen pictures all
 * exactly 1536x1024 (the RE Form 2 Learner's Book carries eleven). A colour signature
 * alone (a 4x4x4 histogram of a thumbnail, via `_imgop.js hist`) fails just as badly
 * the other way: the Geography Form 2 Learner's Book carries a dozen pasted
 * equation screenshots that are all black-on-white, so their histograms are nearly
 * identical and the matcher confidently handed several pages the wrong source — which
 * would have swapped one figure for another in a printed book.
 *
 * So a placement is matched only against the media files of EXACTLY its pixel size,
 * and the signature decides between them when there are several. Only a placement
 * whose size matches nothing — a Word crop, which changes the size but keeps the
 * palette — falls back to scoring against every remaining picture. A match weaker
 * than the confidence threshold is reported rather than used silently, and --map
 * still lets you name any page's source yourself.
 *
 * One picture placed on several pages is ONE job, not several. Word stores it once and
 * Typst places the same XObject twice, so the two placements are byte-identical; they
 * are grouped by content hash and upscaled once, to whatever the most demanding
 * placement needs. Without that the second placement lost the race for the (already
 * claimed) media name and was handed some other picture's file instead.
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

// Real-ESRGAN and the canvas helpers now live in tools/lib/esrgan.js, so
// genimage.js can drive the same upscaler over the art it generates.
const { dims, imgop, resample, esrganUpscale } = require("./lib/esrgan.js");

// …the same as imgop, for the one op that answers on stdout.
function imgopOut(args) {
  const IMGOP = path.join(__dirname, "_imgop.js");
  const r = cp.spawnSync(process.execPath, [IMGOP, ...args.map(String)],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error((r.stderr || "image op failed").trim());
  return r.stdout;
}

function parseArgs(argv) {
  const o = { dpi: 300, map: {}, dryRun: false, limit: 0, tile: 128 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dpi") o.dpi = +argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--limit") o.limit = +argv[++i];
    else if (a === "--only") o.only = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
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
    console.error("usage: node tools/upscale-images.js <book.docx> <book.pdf> [--dpi 300] [--out dir] [--map pN=imageN.png] [--only a.png,b.png] [--dry-run] [--limit n]");
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
  // `zip.files` lists DIRECTORY entries too ("word/media/" itself), and JSZip's
  // .file() answers null for a directory — which crashed the whole run on any
  // manuscript whose .docx happens to store that entry. Keep only real files.
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n].dir)) {
    const entry = zip.file(name);
    if (!entry) continue;
    const buf = await entry.async("nodebuffer");
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

  // Lift every under-target picture out of the PDF. That copy — never the manuscript's
  // own media file — is what gets upscaled. Word stores the FULL picture plus a crop
  // rectangle and import-docx.js applies the crop, but it deliberately does NOT crop a
  // REPLACEMENT image, so upscaling the media file hands the book back whatever the
  // author cropped away (on one book that restored an "AI-Generated" badge sitting in
  // a corner the crop had removed). The PDF's copy is already cropped, so a
  // replacement built from it keeps the author's framing by construction.
  const unresolved = [];
  const shots = [];
  for (const p of placed) {
    if (!isFinite(p.ppi) || p.ppi <= 0 || p.ppi >= opt.dpi) continue;
    const stem = path.join(work, "pdf_p" + p.page);
    cp.execSync(`pdfimages -f ${p.page} -l ${p.page} -png "${opt.pdf}" "${stem}"`, { stdio: "ignore" });
    const cand = fs.readdirSync(work)
      .filter((f) => f.startsWith("pdf_p" + p.page + "-"))
      .map((f) => ({ f, d: dims(fs.readFileSync(path.join(work, f))) }))
      .find((c) => c.d && c.d.w === p.w && c.d.h === p.h);
    if (!cand) { unresolved.push(p); continue; }
    shots.push({ p, file: path.join(work, cand.f) });
  }

  // One picture used on several pages is stored once by Word and placed twice by Typst,
  // so the two placements come out of the PDF byte-identical. Group them by content hash
  // BEFORE matching: they are one picture and must end up with one media name. Matching
  // them separately made the second placement lose the race for the (already claimed)
  // name and take some other picture's file instead — a silent figure swap. The group
  // keeps the WORST ppi, so the single upscale satisfies every page it appears on.
  const crypto = require("crypto");
  const groups = new Map();               // content hash -> { file, w, h, ppi, pages[] }
  for (const s of shots) {
    const h = crypto.createHash("sha1").update(fs.readFileSync(s.file)).digest("hex");
    const g = groups.get(h);
    if (g) { g.ppi = Math.min(g.ppi, s.p.ppi); g.pages.push(s.p.page); }
    else groups.set(h, { file: s.file, w: s.p.w, h: s.p.h, ppi: s.p.ppi, pages: [s.p.page] });
  }

  // Identify each picture by pixel size FIRST, colour signature only as the tie-break.
  // A placement is scored ONLY against the media files of exactly its own size; the
  // signature (a coarse 4x4x4 histogram) then says which of those it is. Size alone
  // cannot do it — a book will happily carry a dozen pictures all exactly 1536x1024 (the
  // RE Form 2 book carries eleven) — but neither can the signature alone: this book's
  // pasted equation screenshots are all black-on-white, so their histograms are nearly
  // identical and the matcher confidently gave several pages the wrong source. Only a
  // placement whose size matches NO media file — a Word crop, which changes the size but
  // keeps the palette — is scored against every remaining picture, as before.
  const WEAK = 0.6;                       // above this, say so rather than quietly guess
  const sig = new Map();
  const sigOf = (f) => { if (!sig.has(f)) sig.set(f, JSON.parse(imgopOut(["hist", f]))); return sig.get(f); };
  const sigDist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s; };
  const mediaNames = [...byDims.values()].flat();
  // A picture the book's own overrides have already turned into text or a real table is
  // no longer in the PDF at all, so it cannot be any placement's source either. Without
  // this it stays a free candidate and a cropped placement will happily take it: p122 of
  // the Geography Form 2 Learner's Book (a cropped map) claimed image16.png, an equation
  // screenshot that imageToText had already replaced.
  const ovFile = path.join(path.dirname(opt.docx), base + ".overrides.json");
  const bookOv = fs.existsSync(ovFile) ? JSON.parse(fs.readFileSync(ovFile, "utf8")) : {};
  const converted = new Set([
    ...Object.keys(bookOv.imageToText || {}),
    ...Object.keys(bookOv.imageToTable || {}),
  ]);
  const taken = new Set([...Object.values(opt.map), ...converted]);
  const named = (g) => g.pages.some((pg) => opt.map[String(pg)]);
  // A media file whose exact pixel size appears among the PLACED images is already
  // accounted for — it is that placement's source, whether or not that placement needs
  // upscaling. So it cannot also be the source of a CROPPED placement, whose size by
  // definition matches nothing. Holding those back stopped p130 of the Geography Form 2
  // Learner's Book (a cropped map) from taking image18.png, a grid-squares diagram that
  // sits on p69 at 576 DPI and was therefore never claimed as a job of its own.
  const sizesPlaced = new Set(placed.map((q) => q.w + "x" + q.h));
  const spokenFor = new Set(mediaNames.filter((n) => {
    const d = dims(fs.readFileSync(path.join(srcDir, n)));
    return d && sizesPlaced.has(d.w + "x" + d.h);
  }));
  // Two rounds: every same-size candidate set is settled first, and only then do the
  // cropped placements (which can match anything) get to pick from what is left.
  const claimed = new Map();
  for (const sized of [true, false]) {
    const pairs = [];
    for (const g of groups.values()) {
      if (named(g) || claimed.has(g)) continue;
      const exact = byDims.get(g.w + "x" + g.h) || [];
      if (sized !== exact.length > 0) continue;
      // The cropped round prefers pictures no placement has already spoken for, and only
      // falls back to the whole list if that leaves it nothing to choose from.
      let pool = exact;
      if (!exact.length) {
        pool = mediaNames.filter((n) => !taken.has(n) && !spokenFor.has(n));
        if (!pool.length) pool = mediaNames;
      }
      for (const n of pool) {
        if (taken.has(n)) continue;
        pairs.push({ d: sigDist(sigOf(g.file), sigOf(path.join(srcDir, n))), g, n, sized: exact.length > 0 });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    for (const { d, g, n, sized: bySize } of pairs) {
      if (claimed.has(g) || taken.has(n)) continue;
      claimed.set(g, { name: n, score: d, bySize });
      taken.add(n);
    }
  }
  const jobs = [];
  for (const g of groups.values()) {
    const forced = g.pages.map((pg) => opt.map[String(pg)]).find(Boolean);
    const got = forced ? { name: forced, score: 0, bySize: true } : claimed.get(g);
    if (!got) { unresolved.push({ page: g.pages[0], w: g.w, h: g.h, ppi: g.ppi }); continue; }
    // A size-confirmed match needs no hedging: the signature only chose between pictures
    // that are already the right shape. Warn only where size could not vouch for it.
    if (!got.bySize && got.score > WEAK) {
      console.log(`!  p${g.pages[0]} looks like ${got.name} but only weakly (${got.score.toFixed(2)}) —` +
        ` check that figure, or name it yourself with --map p${g.pages[0]}=<media file>`);
    }
    jobs.push({ name: got.name, from: g.file, w: g.w, ppi: g.ppi, page: g.pages[0], pages: g.pages, score: got.score });
  }
  // Render a little above the target so rounding can never land under it.
  const head = Math.round(opt.dpi * 1.03);
  for (const j of jobs) {
    j.target = Math.min(j.w * 4, Math.ceil(j.w * head / j.ppi));
  }
  jobs.sort((a, b) => a.ppi - b.ppi);          // worst first — most visible gain earliest
  // A full book is hours of Real-ESRGAN, and most of that buys nothing a reader would
  // notice: the pictures where the shortfall really shows are the ones with WORDS in
  // them (a diagram's captions and speech bubbles go mushy long before a photograph
  // does). `--only` names the ones worth the time; `--limit` takes the N worst by DPI.
  const run = (opt.only ? jobs.filter((j) => opt.only.has(j.name)) : jobs)
    .slice(0, opt.limit > 0 ? opt.limit : undefined);

  console.log(`${placed.length} placed image(s); ${jobs.length} below ${opt.dpi} DPI` +
    (opt.limit ? ` (processing the worst ${run.length})` : ""));
  if (unresolved.length) {
    console.log("!  no bitmap in the PDF for (name it with --map pN=<media file>): " +
      unresolved.map((p) => `p${p.page} ${p.w}x${p.h}@${p.ppi}`).join(", "));
  }
  for (const j of run) {
    const where = j.pages && j.pages.length > 1 ? ` (also p${j.pages.slice(1).join(", p")})` : "";
    console.log(`   p${String(j.page).padStart(3)}  ${j.name.padEnd(15)} ${String(j.w).padStart(5)}px @${String(j.ppi).padStart(4)} DPI -> ${j.target}px @~${Math.round(j.target / j.w * j.ppi)} DPI${where}`);
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
      nPieces = esrganUpscale(j.from, big, 4, opt.tile, work, j.name, j.target);
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
