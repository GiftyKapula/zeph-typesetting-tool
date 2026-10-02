// Faint line-art rescue for imported manuscript figures.
//
// Many Word manuscripts embed geometry/diagram drawings whose strokes are very
// pale (light-blue squares, thin green rays, gray lettering). Copied verbatim they
// print faint and hard to read. This module deepens ONLY those faint line drawings
// — it leaves photographs, crisp black-on-white diagrams, and cut-out graphics
// (transparency) untouched — by pushing every off-white pixel proportionally away
// from white so the ink reads at full strength while the white background stays
// clean. If `canvas` is unavailable, callers fall back to a plain copy.

let canvasLib = null;
try { canvasLib = require("canvas"); } catch (_) { /* enhancement disabled */ }

// Only raster formats we can decode + re-encode losslessly to PNG.
function isRaster(name) { return /\.(png|jpe?g)$/i.test(name); }

// Measure the image: average luminance, share of genuinely dark ("ink") pixels,
// and share of transparent pixels — enough to tell faint line-art from a photo.
function analyze(data, w, h) {
  let n = 0, sum = 0, dark = 0, transp = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) { transp++; continue; }
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n++; sum += lum; if (lum < 60) dark++;
  }
  return { mean: n ? sum / n : 0, darkPct: n ? 100 * dark / n : 0, transpPct: 100 * transp / (w * h) };
}

// A pixel-value lookup that moves each channel `k`× further from white (255).
function inkLut(k) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.round(255 - (255 - v) * k));
  return lut;
}

// Enhance srcPath -> destPath. Returns true if the image was deepened, false if it
// was copied unchanged (photo, crisp diagram, transparent graphic, or no canvas).
function enhanceLineArt(srcPath, destPath, fs) {
  // We re-encode as PNG, so the destination must be a .png to keep the bytes and the
  // filename's format in sync (Typst resolves image format from the extension).
  if (!canvasLib || !isRaster(srcPath) || !/\.png$/i.test(destPath)) return false;
  try {
    const img = new canvasLib.Image();
    img.src = fs.readFileSync(srcPath);
    const w = img.width, h = img.height;
    if (!w || !h) return false;
    const c = canvasLib.createCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const st = analyze(id.data, w, h);
    // Faint line-art: a near-white canvas (mean high), little transparency, and few
    // already-dark pixels. Photos (low mean) and cut-outs (transparent) are excluded.
    const qualifies = st.mean > 225 && st.transpPct < 5 && st.darkPct < 20;
    if (!qualifies) return false;
    // The fainter the drawing, the stronger the push.
    const k = st.darkPct < 3 ? 2.4 : st.darkPct < 8 ? 1.9 : 1.5;
    const lut = inkLut(k);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(id, 0, 0);
    fs.writeFileSync(destPath, c.toBuffer("image/png"));
    return true;
  } catch (_) { return false; }
}

// Crop srcPath -> destPath to the region {l,t,r,b} (edge-trim fractions from a Word
// <a:srcRect>). destPath must be .png (we re-encode). Returns true on success.
function cropImage(srcPath, destPath, crop, fs) {
  if (!canvasLib || !crop || !/\.png$/i.test(destPath)) return false;
  try {
    const img = new canvasLib.Image();
    img.src = fs.readFileSync(srcPath);
    const W = img.width, H = img.height;
    if (!W || !H) return false;
    const cx = Math.round(crop.l * W), cy = Math.round(crop.t * H);
    const cw = Math.max(1, Math.round((1 - crop.l - crop.r) * W));
    const ch = Math.max(1, Math.round((1 - crop.t - crop.b) * H));
    const c = canvasLib.createCanvas(cw, ch);
    c.getContext("2d").drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
    fs.writeFileSync(destPath, c.toBuffer("image/png"));
    return true;
  } catch (_) { return false; }
}

// Bake a picture's Word rotation into the pixels: srcPath -> destPath turned `rot`
// degrees clockwise (quarter turns only). A Word <a:srcRect> crop is applied FIRST when
// present, because srcRect addresses the picture in its own, unrotated coordinate space
// — cropping after the turn would trim the wrong two edges. destPath must be .png (we
// re-encode). Returns true on success, false when there is nothing to do or canvas is off.
function rotateImage(srcPath, destPath, rot, crop, fs) {
  const turns = ((Math.round(rot / 90) % 4) + 4) % 4;
  if (!canvasLib || !turns || !destPath.toLowerCase().endsWith(".png")) return false;
  try {
    const img = new canvasLib.Image();
    img.src = fs.readFileSync(srcPath);
    const W = img.width, H = img.height;
    if (!W || !H) return false;
    const sx = crop ? Math.round(crop.l * W) : 0, sy = crop ? Math.round(crop.t * H) : 0;
    const sw = crop ? Math.max(1, Math.round((1 - crop.l - crop.r) * W)) : W;
    const sh = crop ? Math.max(1, Math.round((1 - crop.t - crop.b) * H)) : H;
    const swap = turns % 2 === 1;
    const c = canvasLib.createCanvas(swap ? sh : sw, swap ? sw : sh);
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    fs.writeFileSync(destPath, c.toBuffer("image/png"));
    return true;
  } catch (_) { return false; }
}

// Extract the embedded raster from an EMF that wraps a bitmap via EMR_STRETCHDIBITS /
// EMR_SETDIBITSTODEVICE. Word stores many pasted pictures as such EMFs; Typst cannot
// read EMF, so without this the picture is dropped ("picture missing"). Returns a PNG
// buffer, or null if the EMF is genuine vector art (no embedded DIB) or canvas is off.
function emfToPng(buf) {
  if (!canvasLib) return null;
  try {
    let best = null;
    for (let o = 0; o + 8 <= buf.length; ) {
      const type = buf.readUInt32LE(o);
      const size = buf.readUInt32LE(o + 4);
      if (size < 8 || o + size > buf.length) break;
      if (type === 81 /*STRETCHDIBITS*/ || type === 80 /*SETDIBITSTODEVICE*/) {
        const offBmi = buf.readUInt32LE(o + 48), cbBmi = buf.readUInt32LE(o + 52);
        const offBits = buf.readUInt32LE(o + 56), cbBits = buf.readUInt32LE(o + 60);
        if (cbBmi >= 40 && offBmi > 0 && cbBits > 0 && o + offBits + cbBits <= buf.length) {
          const bmi = o + offBmi;
          const w = buf.readInt32LE(bmi + 4), h = buf.readInt32LE(bmi + 8), bpp = buf.readUInt16LE(bmi + 14);
          if (w > 0 && Math.abs(h) > 0 && (bpp === 24 || bpp === 32) && (!best || w * Math.abs(h) > best.w * Math.abs(best.h)))
            best = { w, h, bpp, bits: o + offBits };
        }
      }
      o += size;
    }
    if (!best) return null;
    const { w, bpp, bits } = best, h = Math.abs(best.h), bottomUp = best.h > 0;
    const rowSize = Math.floor((bpp * w + 31) / 32) * 4, bpB = bpp / 8;
    // A 32bpp DIB's 4th byte is only REAL alpha for a genuine cut-out graphic; for a
    // plain screenshot/diagram exported as BI_RGB (the common case reaching this
    // function), it's reserved padding that exporters typically leave at 0 — reading it
    // as alpha then renders the whole picture fully transparent (invisible, not "blank
    // white": the RGB data is intact, only unseen). Distinguish the two by checking
    // whether the byte varies across pixels: real transparency has a mix of values,
    // reserved padding is uniformly one value (almost always 0, but treat any constant
    // the same way) — in that case treat every pixel as fully opaque instead.
    let hasVaryingAlpha = false;
    if (bpp === 32) {
      let first = null;
      outer: for (let y = 0; y < h; y++) {
        let sp = bits + (bottomUp ? (h - 1 - y) : y) * rowSize + 3;
        for (let x = 0; x < w; x++) {
          if (first === null) first = buf[sp];
          else if (buf[sp] !== first) { hasVaryingAlpha = true; break outer; }
          sp += bpB;
        }
      }
    }
    const cv = canvasLib.createCanvas(w, h);
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      let sp = bits + (bottomUp ? (h - 1 - y) : y) * rowSize, dp = y * w * 4;
      for (let x = 0; x < w; x++) {
        img.data[dp] = buf[sp + 2]; img.data[dp + 1] = buf[sp + 1]; img.data[dp + 2] = buf[sp];
        img.data[dp + 3] = bpp === 32 && hasVaryingAlpha ? buf[sp + 3] : 255;
        sp += bpB; dp += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toBuffer("image/png");
  } catch (_) { return null; }
}

// ---- embedding a 300 DPI picture without embedding a 300 DPI PNG ------------
//
// Print artwork is STORED as PNG — CLAUDE.md requires it, because an upscale that
// is re-encoded at every step accumulates compression artefacts in the file that
// later work is done from. Embedding it in the PDF is a different question: that
// is the last step, nothing is ever read back out of it, and a lossless PNG of a
// photograph costs about fifteen times what the same picture costs as a
// high-quality JPEG. The Grade 1 CTS Learner's Book made the difference concrete
// — once its 81 pictures were upscaled to 300 DPI the book went from 9 MB to
// 277 MB, which is not a file anyone can send to a proofreader.
//
// So: re-encode the STAGED COPY on its way into the workspace, never the stored
// artwork, and only where the trade is clearly worth it.
//
// Quality 92 with chroma subsampling OFF (4:4:4). Subsampling is what actually
// shows on paper — it halves the colour resolution, which smears exactly the
// coloured edges a diagram's labels and a cover's lettering are made of — and
// turning it off costs little once the luma quality is this high.
//
// Two guards decide whether a picture is converted at all:
//
//   TRANSPARENCY. JPEG has no alpha channel, so a cut-out graphic would come back
//   with its transparent ground filled black. Any pixel that is not fully opaque
//   rules the picture out.
//
//   THE SIZE TEST ITSELF. A photograph shrinks enormously; line art, flat colour
//   and screenshots barely shrink at all, because PNG's lossless prediction is
//   already the right coder for them — and those are precisely the pictures where
//   JPEG ringing round a hard edge would show. Requiring a real saving therefore
//   sorts the two cases apart on the evidence rather than on a guess about what
//   kind of picture this is, and refuses the conversion exactly where it would be
//   both pointless and harmful.
//
// Returns the JPEG's size in bytes when it wrote one worth keeping, else 0 (and
// writes nothing, leaving the staged PNG in place).
function toPrintJpeg(pngPath, jpegPath, fs, quality) {
  if (!canvasLib || !/\.png$/i.test(pngPath)) return 0;
  try {
    const pngSize = fs.statSync(pngPath).size;
    if (pngSize < 150 * 1024) return 0;              // too small for the trade to matter
    const img = new canvasLib.Image();
    img.src = fs.readFileSync(pngPath);
    const w = img.width, h = img.height;
    if (!w || !h) return 0;
    const cv = canvasLib.createCanvas(w, h);
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return 0;   // has alpha
    const buf = cv.toBuffer("image/jpeg", { quality: (quality || 92) / 100, chromaSubsampling: false });
    if (buf.length > pngSize * 0.6) return 0;        // not a photograph — keep the PNG
    fs.writeFileSync(jpegPath, buf);
    return buf.length;
  } catch (_) { return 0; }
}

module.exports = { enhanceLineArt, cropImage, rotateImage, emfToPng, toPrintJpeg };
