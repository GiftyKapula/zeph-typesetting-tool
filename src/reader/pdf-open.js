// Open a PDF with pdfjs so that every canvas (ours and pdfjs's own, for pictures) is a
// node-canvas canvas. pdfjs 4.0 uses node-canvas by default; later 4.x versions use
// @napi-rs/canvas, whose images node-canvas cannot draw ("Image or Canvas expected").
const fs = require("fs");
const { createCanvas } = require("canvas");

class NodeCanvasFactory {
  constructor() {}
  create(width, height) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc, width, height) { cc.canvas.width = Math.ceil(width); cc.canvas.height = Math.ceil(height); }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null; }
  _createCanvas(width, height) { return createCanvas(Math.ceil(width), Math.ceil(height)); }
}

async function openPdf(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0, CanvasFactory: NodeCanvasFactory, canvasFactory: new NodeCanvasFactory() }).promise;
}

module.exports = { openPdf, NodeCanvasFactory };
