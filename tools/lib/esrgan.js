"use strict";
/*
 * esrgan.js — Real-ESRGAN upscaling, shared by upscale-images.js and genimage.js.
 *
 * Lifted verbatim out of upscale-images.js when genimage.js needed the same thing;
 * the awkward parts below were paid for once there and should not be rediscovered.
 * The binary is the ncnn-vulkan build named in CLAUDE.md.
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ESRGAN = process.env.REALESRGAN
  || "C:\\Users\\biine stores\\Desktop\\REAL-\\realesrgan-ncnn-vulkan.exe";

const IMGOP = path.join(__dirname, "..", "_imgop.js");

// Dimensions straight from the file header — cheaper than decoding the picture.
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
//
// 400000 was measured when this machine had more headroom. It is the knob to turn
// when a run is being killed: this is a 4GB box, and how much of that is actually
// free varies a lot with what else is open, so a figure that worked once is not a
// guarantee. Smaller pieces mean more of them and a slower run, but a lower peak.
// Override without editing the file:  REALESRGAN_MAX_PIECE_PX=150000
const MAX_PIECE_PX = Number(process.env.REALESRGAN_MAX_PIECE_PX) || 400000;

// Upscale `src` by the model's native 4x into `dst`, splitting it first if it is
// too big to survive in one pass. Pieces are cut with an overlap and the overlap
// is trimmed back off when they are stitched, so the ESRGAN edge effect at each
// cut never reaches the visible part of the picture and the seams don't show.
// `outW`, when given, is the width the stitch writes straight out at.
function esrganUpscale(src, dst, scale, tile, work, tag, outW) {
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
  // stitch straight into the final width — see the note in _imgop.js: assembling the
  // whole 4x frame first is the allocation that gets a long run killed.
  fs.writeFileSync(spec, JSON.stringify({ out: dst, w: d.w * scale, h: d.h * scale, outW, pieces }));
  imgop(["stitch", spec]);
  for (const p of pieces) { try { fs.unlinkSync(p.file); } catch (_) { /* ignore */ } }
  fs.unlinkSync(spec);
  process.stdout.write("\r");
  return cols * rows;
}

// Bring `file` up to `targetW` pixels wide, in place: 4x through Real-ESRGAN and
// then back down to exactly the width asked for. Going up and back down still pays
// over a plain resize, because ESRGAN reconstructs edges rather than interpolating
// them. A picture already at or above the target is left exactly as it is.
// Returns { from, to } widths, or null when nothing was needed.
function upscaleTo(file, targetW, work, tag, tile) {
  const before = dims(fs.readFileSync(file));
  if (!before) throw new Error("cannot read image dimensions: " + path.basename(file));
  if (before.w >= targetW) return null;
  const big = path.join(work, path.basename(file, ".png") + "_4x.png");
  esrganUpscale(file, big, 4, tile || 64, work, tag, targetW);
  // A single-pass upscale ignores outW (only the stitch honours it), so bring the
  // result down here; when the stitch already did it this is a cheap no-op copy.
  const got = dims(fs.readFileSync(big));
  if (got && got.w !== targetW) resample(big, file, targetW);
  else fs.copyFileSync(big, file);
  try { fs.unlinkSync(big); } catch (_) { /* ignore */ }
  const after = dims(fs.readFileSync(file));
  return { from: `${before.w}x${before.h}`, to: `${after.w}x${after.h}` };
}

module.exports = { ESRGAN, dims, imgop, resample, esrganUpscale, upscaleTo, MAX_PIECE_PX };
