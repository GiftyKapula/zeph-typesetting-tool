// Shrink a typeset PDF by storing its photographs as JPEG instead of lossless Flate.
//
// Typst embeds every PNG picture losslessly (deflated raw pixels). For the Real-ESRGAN
// photographs our books are full of, that is about 4 MB a picture — the Cinyanja G1 LB
// came out at 425 MB with 130 pictures. Re-encoding the colour data as a high-quality
// JPEG at the SAME pixel size (no downsampling: print resolution is kept) cuts that by
// roughly a factor of ten with no visible change at print size.
//
// Only 8-bit RGB / grey image streams are touched. Transparency (an /SMask) is a separate
// stream and stays lossless; text, vectors and fonts are never touched. A picture whose
// JPEG would not be smaller keeps its original stream.
//
// Per book: "jpegQuality": 90 in the overrides runs this on the finished PDF(s).
// Any PDF:  node src/typeset/compress-pdf.js "<in>.pdf" ["<out>.pdf"] [--q 90]
//           (no <out>: writes "<in> - compressed.pdf" next to it)

const fs = require("fs");
const zlib = require("zlib");
const { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFArray } = require("pdf-lib");
const { createCanvas } = require("canvas");

// Colour components of an image's /ColorSpace (3 RGB, 1 grey), or 0 when it is anything
// else (indexed, CMYK, Lab, separation…), which is left alone.
function components(ctx, cs) {
  cs = ctx.lookup(cs);
  if (!cs) return 0;
  const name = cs.toString();
  if (name === "/DeviceRGB") return 3;
  if (name === "/DeviceGray") return 1;
  if (cs instanceof PDFArray && cs.size() === 2 && cs.get(0).toString() === "/ICCBased") {
    const icc = ctx.lookup(cs.get(1));
    const n = icc && icc.dict && icc.dict.get(PDFName.of("N"));
    const v = n ? Number(n.toString()) : 0;
    return v === 3 || v === 1 ? v : 0;
  }
  return 0;
}

async function compressPdfBytes(bytes, { quality = 90, minBytes = 50000 } = {}) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  let before = 0, after = 0, done = 0;
  // Transparency masks (/SMask, /Mask) must stay lossless DeviceGray: a logo's real alpha
  // channel is big enough to pass `minBytes`, and a mask turned into an RGB JPEG is invalid.
  const masks = new Set();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    for (const k of ["SMask", "Mask"]) {
      const m = obj.dict.get(PDFName.of(k));
      if (m && m.objectNumber !== undefined) masks.add(m.objectNumber);
    }
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (masks.has(ref.objectNumber)) continue;
    const d = obj.dict;
    const st = d.get(PDFName.of("Subtype"));
    if (!st || st.toString() !== "/Image") continue;
    const f = d.get(PDFName.of("Filter"));
    if (!f || f.toString() !== "/FlateDecode") continue;          // already JPEG, or unusual
    if (d.get(PDFName.of("DecodeParms")) || d.get(PDFName.of("Decode"))) continue;
    if (d.get(PDFName.of("ImageMask"))) continue;
    if (String(d.get(PDFName.of("BitsPerComponent"))) !== "8") continue;
    if (obj.contents.length < minBytes) continue;                  // masks, icons: not worth it
    const n = components(ctx, d.get(PDFName.of("ColorSpace")));
    if (!n) continue;
    const w = Number(d.get(PDFName.of("Width")).toString());
    const h = Number(d.get(PDFName.of("Height")).toString());
    let raw;
    try { raw = zlib.inflateSync(obj.contents); } catch (_) { continue; }
    if (raw.length !== w * h * n) continue;                        // not plain samples: skip
    const cv = createCanvas(w, h);
    const g = cv.getContext("2d");
    const img = g.createImageData(w, h);
    const px = img.data;
    for (let i = 0, j = 0; i < w * h; i++, j += n) {
      const o = i * 4;
      if (n === 3) { px[o] = raw[j]; px[o + 1] = raw[j + 1]; px[o + 2] = raw[j + 2]; }
      else { px[o] = px[o + 1] = px[o + 2] = raw[j]; }
      px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // (no chroma subsampling: keeps lettering and coloured edges inside pictures crisp)
    const jpg = cv.toBuffer("image/jpeg", { quality: quality / 100, chromaSubsampling: false });
    if (jpg.length >= obj.contents.length) continue;
    before += obj.contents.length; after += jpg.length; done++;
    const nd = d.clone(ctx);
    nd.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    nd.set(PDFName.of("Length"), PDFNumber.of(jpg.length));
    // a grey picture was encoded as RGB above (canvas JPEGs are always 3-channel)
    if (n === 1) nd.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    ctx.assign(ref, PDFRawStream.of(nd, jpg));
  }
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, pictures: done, before, after };
}

// Compress a PDF file in place (or to `outPath`); returns a one-line summary.
async function compressPdfFile(inPath, outPath = inPath, opts = {}) {
  const inBytes = fs.readFileSync(inPath);
  const r = await compressPdfBytes(inBytes, opts);
  fs.writeFileSync(outPath, r.bytes);
  const mb = (b) => (b / 1e6).toFixed(1) + " MB";
  return `${r.pictures} pictures as JPEG q${opts.quality || 90}: ${mb(inBytes.length)} -> ${mb(r.bytes.length)}`;
}

module.exports = { compressPdfBytes, compressPdfFile };

if (require.main === module) {
  const a = process.argv.slice(2);
  const qi = a.indexOf("--q");
  const quality = qi >= 0 ? Number(a.splice(qi, 2)[1]) : 90;
  const [inPath, outArg] = a;
  if (!inPath) { console.error('usage: node src/typeset/compress-pdf.js "<in>.pdf" ["<out>.pdf"] [--q 90]'); process.exit(1); }
  const outPath = outArg || inPath.replace(/\.pdf$/i, "") + " - compressed.pdf";
  compressPdfFile(inPath, outPath, { quality })
    .then((s) => console.log(s, "->", outPath))
    .catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
