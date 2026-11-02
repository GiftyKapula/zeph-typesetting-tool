// The book's FRONT COVER as a picture — rendered from page 1 of the typeset PDF and nothing
// else. With `coversInBook` page 1 is the printer's sheet (back | spine | front, 2 mm trim
// allowance all round); the front panel is cropped from its right-hand side. Interior pages
// are never rendered: page 2 is opened only to read its trimmed size (no content).

import fs from "fs";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
let napi;
try { napi = require("@napi-rs/canvas"); } catch {
  throw new Error("posters need @napi-rs/canvas (installed with pdfjs-dist): run `npm install`");
}
export const { createCanvas, loadImage } = napi;

// Where the front cover sits on page 1, in PDF points: { x, y, w, h } from the top-left.
// `page1` and `page2` are [width, height]; page 2 is the trimmed book page.
export function frontPanel(page1, page2) {
  const [W1, H1] = page1;
  if (!page2 || W1 < H1 * 1.2) return { x: 0, y: 0, w: W1, h: H1, spread: false };
  const [W, H] = page2;
  const B = Math.max(0, (H1 - H) / 2);            // trim allowance, from the sheet itself
  return { x: W1 - B - W, y: B, w: W, h: H, spread: true };
}

// Render the front cover. Returns { png, width, height, aspect, pixels } where `pixels`
// is a small RGBA copy (about 120 px wide) for the colour analysis.
export async function renderFrontCover(pdfPath, { targetWidth = 1600, authors = [] } = {}) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
  const p1 = await doc.getPage(1);
  const v1 = p1.getViewport({ scale: 1 });
  let size2 = null;
  if (doc.numPages > 1 && v1.width > v1.height * 1.2) {
    const v2 = (await doc.getPage(2)).getViewport({ scale: 1 });   // size only — never rendered
    size2 = [v2.width, v2.height];
  }
  const fp = frontPanel([v1.width, v1.height], size2);
  const scale = targetWidth / fp.w;
  const vp = p1.getViewport({ scale });
  const full = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = full.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, full.width, full.height);
  await p1.render({ canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
  const w = Math.round(fp.w * scale), h = Math.round(fp.h * scale);
  const out = createCanvas(w, h);
  out.getContext("2d").drawImage(full, Math.round(fp.x * scale), Math.round(fp.y * scale), w, h, 0, 0, w, h);
  // how tall the author names are printed on the cover, as a share of the cover's height
  // (read from page 1's own text, inside the front panel) — the poster QA turns this into
  // pixels on the poster to tell whether the names can be read
  let authorShare = null;
  const names = (authors || []).map((a) => a.toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean);
  if (names.length) {
    const tc = await p1.getTextContent();
    const sizes = tc.items.filter((it) => {
      const x = it.transform[4], s = (it.str || "").toLowerCase().replace(/\s+/g, " ").trim();
      return s.length > 1 && x >= fp.x - 1 && x <= fp.x + fp.w && names.some((n) => n.includes(s) || s.includes(n));
    }).map((it) => Math.hypot(it.transform[2], it.transform[3]));
    if (sizes.length) authorShare = Math.min(...sizes) / fp.h;
  }
  const sw = 120, sh = Math.max(1, Math.round(sw * h / w));
  const small = createCanvas(sw, sh);
  small.getContext("2d").drawImage(out, 0, 0, sw, sh);
  await doc.destroy();
  return { png: out.toBuffer("image/png"), width: w, height: h, aspect: h / w, pixels: small.getContext("2d").getImageData(0, 0, sw, sh).data, spread: fp.spread, authorShare };
}
