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
    const cv = canvasLib.createCanvas(w, h);
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(w, h);
    const rowSize = Math.floor((bpp * w + 31) / 32) * 4, bpB = bpp / 8;
    for (let y = 0; y < h; y++) {
      let sp = bits + (bottomUp ? (h - 1 - y) : y) * rowSize, dp = y * w * 4;
      for (let x = 0; x < w; x++) {
        img.data[dp] = buf[sp + 2]; img.data[dp + 1] = buf[sp + 1]; img.data[dp + 2] = buf[sp];
        img.data[dp + 3] = bpp === 32 ? buf[sp + 3] : 255;
        sp += bpB; dp += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toBuffer("image/png");
  } catch (_) { return null; }
}

module.exports = { enhanceLineArt, cropImage, emfToPng };
