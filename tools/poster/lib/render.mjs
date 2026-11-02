// Typst -> PDF (the same compiler and system fonts as the book engine), and PDF -> PNG.

import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { createCanvas } from "./cover.mjs";

const require = createRequire(import.meta.url);
const { NodeCompiler } = require("@myriaddreamin/typst-ts-node-compiler");
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);

const FONT_PATHS = [
  "C:/Windows/Fonts", "/Library/Fonts", "/System/Library/Fonts", "/usr/share/fonts", "/usr/local/share/fonts",
  path.join(process.env.LOCALAPPDATA || "", "Microsoft/Windows/Fonts"),
].filter((p) => { try { return p && fs.existsSync(p); } catch { return false; } });

// files: { "cover.png": Buffer, … } are placed beside the source for image() to find.
export function compilePdf(src, files) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "zeph-poster-"));
  try {
    for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(ws, name), buf);
    const compiler = NodeCompiler.create({ workspace: ws, fontArgs: [{ fontPaths: FONT_PATHS }] });
    let pdf;
    try { pdf = compiler.pdf({ mainFileContent: src }); }
    catch (e) {
      const diag = compiler.fetchDiagnostics ? JSON.stringify(compiler.fetchDiagnostics(e)).slice(0, 800) : "";
      throw new Error(`poster did not compile: ${e.message || e} ${diag}`);
    }
    return Buffer.from(pdf);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

// Rasterise page 1 to exactly w x h pixels (drawn at 2x, then scaled down for clean edges).
export async function pdfToPng(pdfBuf, w, h) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const v = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: (2 * w) / v.width });
  const big = createCanvas(Math.round(vp.width), Math.round(vp.height));
  const ctx = big.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, big.width, big.height);
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
  const out = createCanvas(w, h);
  const o = out.getContext("2d");
  o.imageSmoothingEnabled = true; o.imageSmoothingQuality = "high";
  o.drawImage(big, 0, 0, w, h);
  await doc.destroy();
  return out.toBuffer("image/png");
}

// What is on the poster page: text runs (with their boxes) and every picture's placed box.
export async function inspectPdf(pdfBuf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const v = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const texts = tc.items.filter((i) => i.str && i.str.trim()).map((i) => {
    const [a, b, , , e, f] = i.transform;
    const size = Math.hypot(a, b);
    return { str: i.str, x: e, y: v.height - f - size * 0.8, w: i.width, h: size, size, angle: Math.atan2(b, a) * 180 / Math.PI };
  });
  const ol = await page.getOperatorList();
  const images = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const O = pdfjs.OPS;
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], args = ol.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, args);
    else if (fn === O.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) && args[0].length === 6) ctm = mul(ctm, args[0]);
      // an embedded PDF page (the vector front cover) arrives as a form with a bounding box
      const bb = args[1];
      if (bb && bb.length === 4) {
        const w = Math.abs(bb[2] - bb[0]) * Math.hypot(ctm[0], ctm[1]), h = Math.abs(bb[3] - bb[1]) * Math.hypot(ctm[2], ctm[3]);
        if (w > 20 && h > 20) images.push({ w, h, x: ctm[4] + bb[0] * ctm[0], y: v.height - (ctm[5] + bb[3] * ctm[3]), form: true });
      }
    }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
      const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]);
      images.push({ w, h, x: ctm[4], y: v.height - ctm[5] - h, px: args[1], py: args[2] });
    }
  }
  await doc.destroy();
  return { width: v.width, height: v.height, texts, images };
}
