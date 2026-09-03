// Extract reviewer comments from an annotated PDF (highlights, sticky notes,
// text markups). Returns [{ page, kind, note, anchor }]. Built on pdfjs-dist
// (ESM) loaded dynamically from this CommonJS module.

const fs = require("node:fs");

function txt(o) {
  if (!o) return "";
  if (typeof o === "string") return o;
  if (o.str) return o.str;
  if (o.html) {
    const walk = (n) => {
      if (!n) return "";
      if (typeof n === "string") return n;
      if (n.value) return n.value;
      let s = "";
      if (Array.isArray(n.children)) for (const c of n.children) s += walk(c);
      if (n.html) s += walk(n.html);
      return s;
    };
    return walk(o).trim();
  }
  return "";
}

// Reconstruct readable text from page items in reading order, inserting a space
// where there is a horizontal gap and between lines (pdf.js drops most spaces).
function joinItems(items) {
  const sorted = items.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
  let out = "", prev = null;
  for (const it of sorted) {
    if (prev) {
      const sameLine = Math.abs(it.y - prev.y) < 4;
      if (!sameLine) out += " ";
      else if (it.x - (prev.x + prev.w) > 1.2) out += " ";
    }
    out += it.s;
    prev = it;
  }
  return out.replace(/\s+/g, " ").trim();
}

async function extractPdfComments(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const d = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    useSystemFonts: true,
  }).promise;

  const out = [];
  for (let p = 1; p <= d.numPages; p++) {
    const pg = await d.getPage(p);
    const anns = (await pg.getAnnotations())
      .filter((a) => !["Link", "Widget", "Popup"].includes(a.subtype));
    if (!anns.length) continue;

    const tc = await pg.getTextContent();
    const items = tc.items
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height }))
      .filter((it) => it.s && it.s.trim());

    for (const a of anns) {
      const note = txt(a.contentsObj) || txt(a.contents) || txt(a.richText);
      let anchor = "";
      if (a.quadPoints && a.quadPoints.length) {
        // highlight/markup: text under the highlighted quads
        const xs = a.quadPoints.flat().map((q) => q.x);
        const ys = a.quadPoints.flat().map((q) => q.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const y0 = Math.min(...ys), y1 = Math.max(...ys);
        anchor = joinItems(items.filter((it) =>
          it.x + it.w > x0 - 2 && it.x < x1 + 2 && it.y > y0 - 3 && it.y < y1 + 3));
      } else if (a.rect) {
        // sticky note / freetext callout: the icon sits at the target paragraph.
        // Recover the paragraph by reading the lines from the icon down a few lines.
        const yTop = a.rect[3], xL = a.rect[0];
        anchor = joinItems(items.filter((it) =>
          it.y <= yTop + 4 && it.y >= yTop - 52 && it.x >= xL - 6));
      }
      if (!note && !anchor) continue;
      out.push({ page: `p${p}`, kind: a.subtype, note, anchor: anchor.slice(0, 400) });
    }
  }
  return out;
}

module.exports = { extractPdfComments };
