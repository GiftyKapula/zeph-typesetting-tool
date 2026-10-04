#!/usr/bin/env node
// genimage.js — regenerate a book's figures with gpt-image-2.
//
// Reads a per-book art spec (`<book>.artprompts.json`, sitting next to the .docx
// like the overrides sidecar does), calls OpenAI's image model once per figure,
// writes the results into `<book>-art/`, and adds the `images` entries to the
// book's `.overrides.json` so the next typeset run picks them up. Nothing about
// the typesetting pipeline changes — this is a one-time content step that runs
// outside it, exactly like the PE Form 5 illustrations were done.
//
//   node tools/genimage.js "<book.docx>"                 # generate what's missing
//   node tools/genimage.js "<book.docx>" --dry-run       # print the plan, call nothing
//   node tools/genimage.js "<book.docx>" --only image3,image9
//   node tools/genimage.js "<book.docx>" --force         # regenerate even if the file exists
//   node tools/genimage.js "<book.docx>" --no-upscale    # skip the Real-ESRGAN pass
//
// Needs OPENAI_API_KEY in the environment. Every prompt is sent with the house
// style appended (see STYLE below and docs/HOUSE-STYLE.md §5), so a spec file
// carries only what its picture must DEPICT, never the standing requirements.
//
// The model returns about 1536px on the long edge, which is short of CLAUDE.md's
// 300 DPI at the size these pictures actually print (142mm of text width needs
// ~1677px; a cover needs more). So every generated picture goes straight through
// Real-ESRGAN at the model's native 4x and is resampled back down to the width
// the spec asks for — the same path tools/upscale-images.js uses for a
// manuscript's own pictures, sharing its code in tools/lib/esrgan.js. Output stays
// PNG throughout; nothing is ever written as JPEG.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { upscaleTo, imgop, dims } = require("./lib/esrgan.js");

// The standing requirements, appended to every prompt so no spec can forget them.
// Keep this in step with docs/HOUSE-STYLE.md §5.
const STYLE = [
  "Style: semi-realistic illustration — believable human proportions, anatomy,",
  "lighting and perspective, rendered rather than photographic. Not cartoon or",
  "comic: no flat colour, no outlined figures, no exaggerated features. Not",
  "photorealistic either.",
  "Setting: Zambia. People, clothing, buildings, vegetation and light should read",
  "as Zambian.",
  "People: equal numbers of male and female figures. Where people appear, one of",
  "them must visibly be a person with a disability — a wheelchair user, an albino",
  "learner, a hearing aid, or a white cane — shown taking part, not set apart.",
  "No lettering, captions, labels, watermarks, signatures or logos anywhere in the",
  "image.",
].join(" ");

const API = "https://api.openai.com/v1/images/generations";
// What the model will actually render at; a spec's `aspect` picks one of these.
const SIZES = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" };
// Pixels across, after upscaling, when a spec entry doesn't say. 142mm of text
// width at 300 DPI is 1677px; 1800 clears it with a margin.
const DEFAULT_TARGET_W = 1800;

async function mediaNames(docx) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(docx));
  return new Set(Object.keys(zip.files)
    .filter((f) => f.startsWith("word/media/"))
    .map((f) => path.posix.basename(f)));
}

function die(msg) { console.error("!  " + msg); process.exit(1); }

function parseArgs(argv) {
  // tile 128: Real-ESRGAN's per-pass working set. Bigger tiles mean fewer passes
  // and a faster run; the ceiling is what the GPU will allocate (the note in
  // lib/esrgan.js records 256 and above refusing to allocate on this machine).
  const out = { docx: null, only: null, dryRun: false, force: false, quality: "high", upscale: true, tile: 128 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-upscale") out.upscale = false;
    else if (a === "--tile") out.tile = Number(argv[++i]) || 64;
    else if (a === "--force") out.force = true;
    else if (a === "--only") out.only = new Set((argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--quality") out.quality = argv[++i];
    else if (!a.startsWith("--") && !out.docx) out.docx = a;
    else die("unrecognised argument: " + a);
  }
  if (!out.docx) die('usage: node tools/genimage.js "<book.docx>" [--dry-run] [--only imageN,...] [--force]');
  return out;
}

async function generate(prompt, size, quality, key) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model: "gpt-image-2", prompt, size, quality, n: 1 }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body && body.error ? body.error.message : res.statusText;
    throw new Error(`image API ${res.status}: ${detail}`);
  }
  const b64 = body && body.data && body.data[0] && body.data[0].b64_json;
  if (!b64) throw new Error("image API returned no image data");
  return Buffer.from(b64, "base64");
}

(async () => {
  const opt = parseArgs(process.argv.slice(2));
  const docx = path.resolve(opt.docx);
  if (!fs.existsSync(docx)) die("no such .docx: " + docx);

  const specPath = docx.replace(/\.docx$/i, ".artprompts.json");
  if (!fs.existsSync(specPath)) die("no art spec beside the .docx: " + path.basename(specPath));
  let spec;
  try { spec = JSON.parse(fs.readFileSync(specPath, "utf8")); }
  catch (e) { die("art spec is not valid JSON: " + e.message); }
  const figures = spec.figures || {};

  const artDir = docx.replace(/\.docx$/i, "-art");
  const ovPath = docx.replace(/\.docx$/i, ".overrides.json");
  const key = process.env.OPENAI_API_KEY;
  if (!opt.dryRun && !key) die("OPENAI_API_KEY is not set — run with --dry-run to see the plan without it");

  // A spec key is the manuscript picture the generated art replaces, so it must
  // be spelled exactly as the .docx spells it — image8.jpeg, not image8.png. The
  // overrides map is keyed by that name, so a key the manuscript does not have
  // writes an entry nothing ever reads: the book would re-typeset unchanged and
  // look, from the log, as though it had worked.
  const media = await mediaNames(docx);
  const strayKeys = Object.keys(figures).filter((n) => n !== "cover" && !media.has(n));
  if (strayKeys.length) {
    const sameStem = (n) => [...media].filter((m) => m.replace(/.[^.]+$/, "") === n.replace(/.[^.]+$/, ""));
    for (const n of strayKeys) {
      const alt = sameStem(n);
      console.error("!  " + n + ": the manuscript has no such picture" + (alt.length ? " — did you mean " + alt.join(", ") + "?" : ""));
    }
    die("art spec names pictures the manuscript does not contain");
  }

  const names = Object.keys(figures).filter((n) => !opt.only || opt.only.has(n) || opt.only.has(n.replace(/\.(png|jpe?g)$/i, "")));
  if (!names.length) die("nothing to do (no figures matched)");

  fs.mkdirSync(artDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "genimage-"));
  const written = [];
  const upscaled = [];
  const failed = [];
  for (const name of names) {
    const fig = figures[name];
    // `cover` is not a manuscript picture: it fills the book's coverImage slot.
    const isCover = name === "cover";
    const outName = (isCover ? "cover" : name.replace(/\.(png|jpe?g)$/i, "")) + ".png";
    const outPath = path.join(artDir, outName);
    const size = SIZES[fig.aspect || "landscape"] || SIZES.landscape;
    const targetW = fig.targetWidthPx || DEFAULT_TARGET_W;
    const prompt = `${fig.prompt}\n\n${STYLE}`;

    if (fs.existsSync(outPath) && !opt.force) { console.log(`=  ${name}: already generated, skipping (--force to redo)`); written.push([name, outName, isCover]); continue; }
    if (opt.dryRun) {
      const crop = fig.cropTo ? `, centre-cropped to ${fig.cropTo.w}x${fig.cropTo.h}` : "";
      console.log(`\n--- ${name}  [${size}, quality ${opt.quality}] -> ${path.relative(process.cwd(), outPath)}`);
      console.log(`    then Real-ESRGAN 4x, resampled to ${targetW}px wide${crop}`);
      console.log(prompt);
      written.push([name, outName, isCover]);
      continue;
    }
    process.stdout.write(`   ${name} … `);
    try {
      const buf = await generate(prompt, size, opt.quality, key);
      fs.writeFileSync(outPath, buf);
      process.stdout.write(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
      // Up to print resolution, then trimmed to the exact frame if one is asked for.
      if (opt.upscale) {
        const moved = upscaleTo(outPath, targetW, work, name, opt.tile);
        if (moved) { upscaled.push([name, moved.from, moved.to]); process.stdout.write(` → ESRGAN ${moved.from} → ${moved.to}`); }
      }
      if (fig.cropTo) {
        const d = dims(fs.readFileSync(outPath));
        const cw = Math.min(d.w, fig.cropTo.w), ch = Math.min(d.h, fig.cropTo.h);
        imgop(["crop", outPath, outPath, Math.round((d.w - cw) / 2), Math.round((d.h - ch) / 2), cw, ch]);
        process.stdout.write(` → cropped ${cw}x${ch}`);
      }
      console.log(` -> ${outName}`);
      written.push([name, outName, isCover]);
    } catch (e) {
      console.log("FAILED");
      console.error("     " + e.message);
      failed.push([name, e.message]);
    }
  }
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  // Wire the results into the book's overrides, leaving every other key alone.
  if (!opt.dryRun && written.length) {
    let ov = {};
    if (fs.existsSync(ovPath)) { try { ov = JSON.parse(fs.readFileSync(ovPath, "utf8")); } catch (e) { die("overrides file is not valid JSON: " + e.message); } }
    const rel = path.basename(artDir);
    for (const [name, outName, isCover] of written) {
      if (isCover) { ov.coverImage = `${rel}/${outName}`; continue; }
      ov.images = ov.images || {};
      const entry = ov.images[name] && typeof ov.images[name] === "object" ? ov.images[name] : {};
      ov.images[name] = { ...entry, src: `${rel}/${outName}` };
    }
    fs.writeFileSync(ovPath, JSON.stringify(ov, null, 2) + "\n");
    console.log(`\n   wrote ${written.length} override(s) into ${path.basename(ovPath)}`);
  }
  if (upscaled.length) {
    console.log("\n   Real-ESRGAN (original -> new):");
    for (const [n, from, to] of upscaled) console.log(`     ${n}: ${from} -> ${to}`);
  }
  if (failed.length) {
    // A failed run must not read like a finished one. Every figure failing is
    // the ordinary shape of an expired key or an account out of credit, and the
    // exit code is the only part of this a caller or a wrapper script notices.
    console.error("");
    console.error("!  " + failed.length + " of " + names.length + " figure(s) failed: " + failed.map((f) => f[0]).join(", "));
    console.error("!  " + failed[0][1]);
    if (!written.length) die("nothing was generated");
    console.error("!  the figures that did succeed are wired into the overrides; re-run to pick up the rest");
    process.exit(1);
  }
  console.log(opt.dryRun ? "\n(dry run — nothing was generated)" : "\nNow re-typeset the book and look at the pages that changed.");
})();
