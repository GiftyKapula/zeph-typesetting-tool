// Damaged-picture guard.
//
// A manuscript sometimes carries a PNG whose compressed data is corrupt (a bad
// download or a Word save gone wrong). Word shows a blank or partly drawn picture,
// but Typst refuses the whole book ("failed to decode image"). pngDamaged() spots
// such a file; placeholderPng() draws a same-size grey panel naming the picture,
// so the book still builds and the gap is obvious on the page for the author to resupply.

const zlib = require("zlib");

// True when the file is a PNG whose image data does not decode cleanly.
function pngDamaged(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return false; // not a PNG
  try {
    let p = 8, w = 0, h = 0, bd = 8, ct = 6, il = 0;
    const idat = [];
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
      const d = buf.subarray(p + 8, p + 8 + len);
      if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; }
      if (type === "IDAT") idat.push(d);
      if (type === "IEND") break;
      p += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat)); // throws on a bad checksum / stream
    if (il) return false;
    // Every scanline starts with a filter byte 0-4; anything else means garbage data.
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct] || 4;
    const stride = Math.ceil((w * ch * bd) / 8) + 1;
    if (raw.length < stride * h) return true;
    for (let y = 0; y < h; y++) if (raw[y * stride] > 4) return true;
    return false;
  } catch (e) {
    return true;
  }
}

// PNG size from the IHDR chunk (falls back to a 4:3 panel).
function pngSize(buf) {
  try { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; } catch (e) { return { w: 800, h: 600 }; }
}

// A light-grey panel of the same size with a dashed border and a short label.
// Returns null when `canvas` isn't installed (the caller then drops the picture).
function placeholderPng(buf, name) {
  let createCanvas;
  try { ({ createCanvas } = require("canvas")); } catch (e) { return null; }
  const { w, h } = pngSize(buf);
  const cv = createCanvas(w, h), ctx = cv.getContext("2d");
  ctx.fillStyle = "#eeeeee"; ctx.fillRect(0, 0, w, h);
  const lw = Math.max(2, Math.round(Math.min(w, h) / 120));
  ctx.strokeStyle = "#999999"; ctx.lineWidth = lw; ctx.setLineDash([lw * 4, lw * 3]);
  ctx.strokeRect(lw, lw, w - 2 * lw, h - 2 * lw);
  const fs = Math.max(14, Math.round(w / 22));
  ctx.fillStyle = "#555555"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.fillText("Picture damaged in manuscript", w / 2, h / 2 - fs * 0.7);
  ctx.font = `${Math.round(fs * 0.8)}px sans-serif`;
  ctx.fillText(`(${name}) - please resupply`, w / 2, h / 2 + fs * 0.7);
  return cv.toBuffer("image/png");
}

module.exports = { pngDamaged, placeholderPng };
