// Book model -> editable Word manuscript with the reader styles. The typesetter reads
// these styles back (read-docx.js), so this docx is the single source the typesetter
// uses: fix spelling, move a picture or change a heading in Word, then typeset again.
//
// Styles (Word style name -> meaning):
//   Book Title / Book Author / Book Series   title page facts
//   Imprint                                  one line of the imprint (copyright) page
//   Front Heading                            heading of a preface, dedication, foreword
//   Chapter Number + Heading 1               chapter opener ("1", "KAPETULU I"...) and title
//   Heading 2                                section heading inside a chapter
//   Normal                                   body paragraph
//   Centred / Right / Quote                  centred lines (songs, poems), right lines (signatures), indented block
//   Scene Break                              * * *
//   Picture + Caption                        a picture and its caption
const fs = require("fs");
const path = require("path");
const docx = require("docx");
const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, PageBreak } = docx;

const STYLES = [
  ["BookTitle", "Book Title", { size: 48, bold: true }, { alignment: "center", spacing: { after: 200 } }],
  ["BookAuthor", "Book Author", { size: 28 }, { alignment: "center", spacing: { after: 200 } }],
  ["BookSeries", "Book Series", { size: 24, italics: true }, { alignment: "center" }],
  ["Imprint", "Imprint", { size: 20 }, { alignment: "center" }],
  ["FrontHeading", "Front Heading", { size: 28, bold: true }, { alignment: "center", spacing: { before: 240, after: 200 }, pageBreakBefore: true }],
  ["ChapterNumber", "Chapter Number", { size: 28, bold: true, color: "7a4b1e" }, { alignment: "center", spacing: { before: 240 }, pageBreakBefore: true, keepNext: true }],
  ["Centred", "Centred", {}, { alignment: "center" }],
  ["Verse", "Verse", {}, { indent: { left: 567 }, spacing: { after: 160 } }],
  ["RightLine", "Right", {}, { alignment: "right" }],
  ["QuoteBlock", "Quote", {}, { indent: { left: 567, right: 567 } }],
  ["SceneBreak", "Scene Break", {}, { alignment: "center", spacing: { before: 120, after: 120 } }],
  ["Picture", "Picture", {}, { alignment: "center", keepNext: true }],
  ["CaptionLine", "Caption", { italics: true, size: 20 }, { alignment: "center", spacing: { after: 160 } }],
];

function runsOf(runs) {
  return (runs || []).filter((r) => r.t).map((r) => new TextRun({ text: r.t.replace(/\u0001/g, ""), bold: r.b || undefined, italics: r.i || undefined }));
}
const P = (style, children, extra = {}) => new Paragraph({ style, children, ...extra });

function linesPara(style, lines) {
  const kids = [];
  lines.forEach((l, k) => { if (k) kids.push(new TextRun({ break: 1 })); kids.push(...runsOf(l.runs)); });
  return P(style, kids);
}

function blockParas(b, baseDir, chapterSeen) {
  switch (b.t) {
    case "h1": {
      const out = [];
      if (b.label && b.title) out.push(P("ChapterNumber", [new TextRun(b.label)]));
      out.push(new Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new TextRun(b.title || b.label)], pageBreakBefore: !(b.label && b.title) && chapterSeen }));
      return out;
    }
    case "h2": return [new Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: [new TextRun(b.text)] })];
    case "p": return [P(b.quote ? "QuoteBlock" : undefined, runsOf(b.runs))];
    case "center": return [linesPara("Centred", b.lines)];
    case "verse": return [linesPara("Verse", b.lines)];
    case "right": return [linesPara("RightLine", b.lines)];
    case "break": return [P("SceneBreak", [new TextRun("* * *")])];
    case "fig": {
      const file = path.join(baseDir, b.file);
      if (!fs.existsSync(file)) return [P("Caption", [new TextRun(`[missing picture ${b.file}]`)])];
      const wpt = Math.min(b.wpt || 300, 330), scale = wpt / (b.wpt || 300);
      const out = [P("Picture", [new ImageRun({ type: /\.jpe?g$/i.test(file) ? "jpg" : /\.gif$/i.test(file) ? "gif" : /\.bmp$/i.test(file) ? "bmp" : "png", data: fs.readFileSync(file), transformation: { width: Math.round(wpt * 96 / 72), height: Math.round((b.hpt || 200) * scale * 96 / 72) }, altText: { name: b.file, description: b.file, title: b.file } })])];
      if (b.caption) out.push(P("CaptionLine", [new TextRun(b.caption)]));
      return out;
    }
    default: return [];
  }
}

async function writeDocx(model, file, baseDir) {
  const kids = [];
  const m = model.meta;
  if (m.series && m.series.length) for (const s of m.series) kids.push(P("BookSeries", [new TextRun(s)]));
  kids.push(P("BookTitle", [new TextRun(m.title || "")]));
  if (m.author) kids.push(P("BookAuthor", [new TextRun(m.author)]));
  for (const f of model.front) {
    if (f.type === "imprint") {
      kids.push(new Paragraph({ children: [new PageBreak()] }));
      for (const l of f.lines) kids.push(P("Imprint", [new TextRun(l)]));
    } else if (f.type === "section") {
      let first = true;
      for (const b of f.blocks) {
        if (b.t === "h1" && first) { kids.push(P("FrontHeading", [new TextRun([b.label, b.title].filter(Boolean).join(" "))])); first = false; continue; }
        if (first) { kids.push(new Paragraph({ children: [new PageBreak()] })); first = false; }
        kids.push(...blockParas(b, baseDir, false));
      }
    }
  }
  let chapterSeen = false;
  for (const b of model.body) {
    if (b.t === "h1") { kids.push(...blockParas(b, baseDir, true)); chapterSeen = true; continue; }
    kids.push(...blockParas(b, baseDir, chapterSeen));
  }
  const doc = new Document({
    creator: "ZEPH reader import",
    title: m.title,
    styles: {
      default: { document: { run: { font: "Arial", size: 22 }, paragraph: { spacing: { after: 60, line: 300 } } },
        heading1: { run: { font: "Century Gothic", size: 32, bold: true, color: "3b2414" }, paragraph: { alignment: "center", spacing: { before: 240, after: 280 }, keepNext: true } },
        heading2: { run: { font: "Century Gothic", size: 24, bold: true, color: "3b2414" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } } },
      paragraphStyles: STYLES.map(([id, name, run, para]) => ({ id, name, basedOn: "Normal", next: "Normal", quickFormat: true, run, paragraph: { ...para, alignment: para.alignment === "center" ? AlignmentType.CENTER : para.alignment === "right" ? AlignmentType.RIGHT : undefined } })),
    },
    sections: [{ properties: { page: { size: { width: Math.round(m.trim[0] / 25.4 * 1440), height: Math.round(m.trim[1] / 25.4 * 1440) }, margin: { top: 1000, bottom: 1000, left: 900, right: 900 } } }, children: kids }],
  });
  fs.writeFileSync(file, await Packer.toBuffer(doc));
}

module.exports = { writeDocx, STYLE_NAMES: Object.fromEntries(STYLES.map(([id, name]) => [id, name])) };
