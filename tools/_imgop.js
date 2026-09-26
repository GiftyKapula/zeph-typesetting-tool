#!/usr/bin/env node
"use strict";
/*
 * _imgop.js — one canvas operation, then exit. Helper for upscale-images.js.
 *
 * Every operation runs as its own short-lived process on purpose. Decoding a
 * large intermediate costs tens of megabytes, and on a small machine doing that
 * inside a long-running parent grows the heap until the OS kills the run. A
 * process that exits hands the memory straight back.
 *
 *   node tools/_imgop.js crop   <src> <dst> <x> <y> <w> <h>
 *   node tools/_imgop.js resize <src> <dst> <width>
 *   node tools/_imgop.js stitch <spec.json>
 *
 * The stitch spec is { out, w, h, pieces: [{ file, dx, dy, sx, sy, sw, sh }] } —
 * each piece is drawn from its own (sx,sy,sw,sh) region to (dx,dy), which is how
 * the overlap that guards against seam artefacts gets trimmed back off.
 */
const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");

function ctxOf(w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  ctx.patternQuality = "best";
  ctx.quality = "best";
  ctx.imageSmoothingEnabled = true;
  return { cv, ctx };
}

async function main() {
  const [op, ...a] = process.argv.slice(2);
  if (op === "crop") {
    const [src, dst, x, y, w, h] = [a[0], a[1], +a[2], +a[3], +a[4], +a[5]];
    const img = await loadImage(src);
    const { cv, ctx } = ctxOf(w, h);
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    fs.writeFileSync(dst, cv.toBuffer("image/png"));
  } else if (op === "resize") {
    const [src, dst, width] = [a[0], a[1], +a[2]];
    const img = await loadImage(src);
    const w = Math.min(width, img.width);
    const h = Math.round(img.height * (w / img.width));
    const { cv, ctx } = ctxOf(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    fs.writeFileSync(dst, cv.toBuffer("image/png"));
  } else if (op === "stitch") {
    const spec = JSON.parse(fs.readFileSync(a[0], "utf8"));
    const { cv, ctx } = ctxOf(spec.w, spec.h);
    for (const p of spec.pieces) {
      const img = await loadImage(p.file);
      ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.sw, p.sh);
    }
    fs.writeFileSync(spec.out, cv.toBuffer("image/png"));
  } else {
    console.error("unknown op: " + op);
    process.exit(2);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
