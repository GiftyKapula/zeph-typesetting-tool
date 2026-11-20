// emit-epub.js — write a reflowable EPUB 3 from the FINAL block list typeset-docx.js
// prints the PDF from (after every engine pass and the book's own overrides), so the
// e-book carries the same text, fixes and numbering as the printed book by construction.
//
// Called from the end of typesetOne() when `--epub` is passed:
//   node src/typeset/typeset-docx.js "<book>.docx" --epub
// Writes <book>.epub beside the PDF. Nothing here runs without the flag.
//
// It is the reading-app sibling of emit-ebook.js (the ZEPH Learn .zephbook): that one
// re-imports the raw manuscript and does not see a book's overrides; this one does.
//
// Layout-only blocks (page breaks, roman/arabic counters, the printed contents page,
// the back cover) have no meaning in a reflowable book and are dropped; the reader's own
// table of contents (nav.xhtml / toc.ncx) replaces the printed one. The cover is the
// printed cover itself, rendered from page 1 of the PDF.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Runs -> inline XHTML. A run is { t, b, it, u?, m? } (m = math source, set as text).
function runs(segs) {
  let out = "";
  for (const s of segs || []) {
    if (!s) continue;
    let t = typeof s.t === "string" ? s.t : (typeof s.m === "string" ? s.m : "");
    if (!t) continue;
    t = esc(t).replace(/\n/g, "<br/>");
    if (s.u) t = `<u>${t}</u>`;
    if (s.it) t = `<em>${t}</em>`;
    if (s.b) t = `<strong>${t}</strong>`;
    out += t;
  }
  return out.replace(/^(<br\/>)+|(<br\/>)+$/g, "");
}
const plainOf = (b) => (b.segs ? b.segs.map((s) => s.t || "").join("") : b.text || "").trim();

// The same normalisation emit() applies for the printed banner / sub-topic heads.
const TOPIC_RE = /^(?:TOPIC|UNIT|CHAPTER)\s*([\d.]+)\s*[:.\-–—]?\s*(.*)$/i;
const topicTitle = (t) => { const m = (t || "").match(TOPIC_RE); return m ? { no: m[1].replace(/[.:]+$/, ""), name: m[2].trim() } : null; };
const subTitle = (t) => (t || "").replace(/^Sub[-\s‐-―]*Topic\s*:?\s*/i, "Sub-Topic ").replace(/^(Sub-?Topic\s+\d+(?:\.\d+)*)[.:](\s)/i, "$1$2").trim();

// A paragraph that is a list item (Word list or the engine's own marker).
const isListPara = (b) => b && (b.t === "listitem" || (b.t === "para" && b.marker));
function listItem(b) {
  const mk = b.marker || "•";
  const depth = Math.max(0, (b.depth || b.lvl || 0) | 0);
  return `<p class="li${depth ? " d" + Math.min(depth, 3) : ""}"><span class="mk">${esc(mk)}</span> ${runs(b.segs)}</p>`;
}

function table(rows) {
  if (!rows || !rows.length) return "";
  const cell = (c) => (c && c.segs ? runs(c.segs) : esc(c && c.text != null ? c.text : c || "").replace(/\n/g, "<br/>"));
  // A one-cell table is a framed answer box in print; set it as one here too.
  if (rows.length === 1 && rows[0].length === 1) return `<div class="box"><p>${cell(rows[0][0])}</p></div>`;
  const head = rows.length > 1 ? `<thead><tr>${rows[0].map((c) => `<th>${cell(c)}</th>`).join("")}</tr></thead>` : "";
  const body = rows.slice(rows.length > 1 ? 1 : 0).map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

// Question/answer parts of an exercise or assessment. Answers are set in italic, as in print.
function parts(ps) {
  let out = "";
  for (const p of ps || []) {
    if (!p) continue;
    if (p.kind === "lead") { out += `<p class="lead">${runs(p.qseg) || esc(p.q)}</p>`; continue; }
    if (p.kind === "table") { out += table(p.rows); continue; }
    if (p.kind === "image") continue;
    const depth = Math.min(3, Math.max(0, p.depth | 0));
    const q = runs(p.qseg) || esc(p.q);
    if (q || p.marker) out += `<p class="q${depth ? " d" + depth : ""}">${p.marker ? `<span class="mk">${esc(p.marker)}</span> ` : ""}${q}</p>`;
    const a = p.aseg && p.aseg.length ? runs(p.aseg.map((s) => ({ ...s, it: true }))) : (p.a ? `<em>${esc(p.a)}</em>` : "");
    if (a) out += `<p class="ans${depth ? " d" + depth : ""}">${a}</p>`;
  }
  return out;
}

const body = (bs, warn) => (bs || []).map((b) => block(b, warn)).join("");

function block(b, warn) {
  if (!b || typeof b !== "object") return "";
  switch (b.t) {
    case "para": {
      if (isListPara(b)) return listItem(b);
      const inner = runs(b.segs);
      if (!inner) return "";
      return `<p${b.align === "center" ? ` class="c"` : ""}>${inner}</p>`;
    }
    case "listitem": return listItem(b);
    case "head": case "h3": return `<h3${b.align === "center" ? ` class="c"` : ""}>${esc(b.text || plainOf(b))}</h3>`;
    case "label": return `<p class="label">${esc(b.text || plainOf(b))}</p>`;
    case "table": return table(b.rows);
    case "activity": return `<div class="activity"><p class="boxtitle">${esc(b.title)}</p>${body(b.body, warn)}</div>`;
    case "box": case "framedsection": case "keypoints": case "fact":
      return `<div class="box">${b.title ? `<p class="boxtitle">${esc(b.title)}</p>` : ""}${body(b.body, warn)}</div>`;
    case "exercise": return `<div class="exercise"><p class="boxtitle">${esc(b.heading)}</p>${parts(b.parts)}</div>`;
    case "assessment": return `<div class="exercise"><p class="boxtitle">${esc(b.title)}</p>${body(b.intro, warn)}${parts(b.parts)}${body(b.extra, warn)}</div>`;
    case "signature": return `<p class="sig">${(b.lines || []).map((l) => (l.bold ? `<strong>${esc(l.text)}</strong>` : esc(l.text))).join("<br/>")}</p>`;
    case "image": case "imagerow": case "img": {
      const imgs = b.images || (b.file ? [b] : []);
      return imgs.map((im) => (im.file ? `<p class="fig"><img src="images/${esc(im.file)}" alt=""/></p>` : "")).join("");
    }
    case "figcaption": return `<p class="cap">${runs(b.segs) || esc(b.text)}</p>`;
    // layout-only in print
    case "vspace": case "pagebreak": case "titlestart": case "showpage": case "bodystart":
    case "sigspace": case "toc": case "backcover": case "imprint": case "divider":
      return "";
    default: {
      const t = plainOf(b);
      warn(`emit-epub: block type "${b.t}" set as plain text`);
      return t ? `<p>${esc(t)}</p>` : "";
    }
  }
}

const xhtml = (title, inner) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${inner}
</body>
</html>
`;

const CSS = `
body { font-family: serif; line-height: 1.45; margin: 0 4%; }
h1 { font-family: sans-serif; font-size: 1.45em; margin: 1.2em 0 .8em; padding: .5em .6em; background: #222; color: #fff; }
h1 .no { display: block; font-size: .6em; letter-spacing: .25em; opacity: .85; }
h1.sec { background: none; color: #222; padding: 0; border-bottom: 2px solid #222; }
h2 { font-family: sans-serif; font-size: 1.15em; margin: 1.4em 0 .6em; text-transform: uppercase; }
h3 { font-family: sans-serif; font-size: 1.02em; margin: 1.1em 0 .4em; }
p { margin: .35em 0; text-align: left; }
p.c, h3.c { text-align: center; }
p.label { font-weight: bold; margin-top: .8em; }
p.li, p.q { margin: .2em 0 .2em 1.6em; text-indent: -1.2em; }
p.ans { margin: .1em 0 .3em 1.6em; }
p.d1 { margin-left: 3em; } p.d2 { margin-left: 4.4em; } p.d3 { margin-left: 5.8em; }
.mk { font-style: normal; }
p.lead { margin: .4em 0; font-style: italic; }
div.activity, div.exercise, div.box { margin: 1em 0; padding: .5em .8em; background: #f1f1f1; border-left: 4px solid #555; }
div.box { border: 1px solid #999; background: #fafafa; }
p.boxtitle { font-family: sans-serif; font-weight: bold; margin: 0 0 .4em; }
div.activity p { font-style: italic; }
div.activity p.boxtitle { font-style: normal; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: .92em; }
th, td { border: 1px solid #777; padding: .25em .4em; vertical-align: top; text-align: left; }
th { background: #222; color: #fff; }
p.sig { margin-top: 1em; }
p.fig { text-align: center; } p.fig img { max-width: 100%; }
div.cover { text-align: center; margin: 0; padding: 0; } div.cover img { max-width: 100%; max-height: 100%; }
div.titlepage { text-align: center; margin-top: 2em; } div.titlepage p { text-align: center; }
div.titlepage .big { font-size: 1.8em; font-weight: bold; font-family: sans-serif; }
div.imprint p { text-align: center; font-size: .9em; }
nav ol { list-style: none; padding-left: 1em; } nav > ol { padding-left: 0; }
`;

// The printed cover, rendered from page 1 of the PDF, as the e-book's cover image.
async function renderCover(pdfPath) {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = require("@napi-rs/canvas");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
    const p = await doc.getPage(1);
    const v = p.getViewport({ scale: 1600 / p.getViewport({ scale: 1 }).height });
    const c = createCanvas(Math.round(v.width), Math.round(v.height));
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: x, viewport: v }).promise;
    return c.toBuffer("image/jpeg", 90);
  } catch (e) { console.warn("!  emit-epub: cover not rendered from the PDF:", e.message); return null; }
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()).replace(/[’']S\b/g, (m) => m.toLowerCase());

async function writeEpub({ blocks, workspace, outPath, pdfPath }) {
  const warned = new Set();
  const warn = (m) => { if (!warned.has(m)) { warned.add(m); console.warn("!  " + m); } };
  const cover = blocks.find((b) => b.t === "cover") || {};
  const titleBits = (cover.lines || []).filter((l) => !/education level$/i.test(l));
  const bookTitle = titleCase(titleBits.join(" ").replace(/\s+/g, " ").trim()) || path.basename(outPath, ".epub");
  const authors = (cover.byline || []).filter(Boolean);

  // ---- split into chapters: title page + imprint, then one per front-matter section
  // and one per topic (every h1) -------------------------------------------------------
  const chapters = [];
  let cur = null;
  const open = (title, navTitle) => { cur = { id: `ch${String(chapters.length + 1).padStart(2, "0")}`, title, navTitle, html: "", nav: [] }; chapters.push(cur); };
  const iTitle = blocks.findIndex((b) => b.t === "titlepage");
  const iToc = blocks.findIndex((b) => b.t === "toc");
  if (iTitle >= 0) {
    const tp = blocks[iTitle];
    open("Title page", null);
    cur.html += `<div class="titlepage">${(tp.lines || []).map((l) => `<p class="${/education$/i.test(l) || l === tp.lines[1] ? "big" : "c"}">${esc(l)}</p>`).join("")}`
      + (authors.length ? `<p class="c"><strong>${authors.length > 1 ? "AUTHORS" : "AUTHOR"}</strong><br/>${authors.map(esc).join("<br/>")}</p>` : "")
      + `<p class="c"><strong>Zambia Educational Publishing House</strong><br/>Lusaka</p></div>`;
    const end = iToc > iTitle ? iToc : iTitle + 1;
    const imp = body(blocks.slice(iTitle + 1, end), warn);
    if (imp.trim()) cur.html += `<div class="imprint">${imp}</div>`;
  }
  let anchorN = 0;
  for (let i = (iToc >= 0 ? iToc + 1 : 0); i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || b.t === "cover" || b.t === "titlepage") continue;
    if (b.t === "h1") {
      const tt = topicTitle(b.text);
      if (tt) { open(`Topic ${tt.no}: ${tt.name}`, `TOPIC ${tt.no}: ${tt.name}`); cur.html += `<h1><span class="no">TOPIC ${esc(tt.no)}</span>${esc(tt.name)}</h1>`; }
      else { open(b.text, b.text); cur.html += `<h1 class="sec">${esc(b.text)}</h1>`; }
      continue;
    }
    if (!cur) open("Front matter", null);
    if (b.t === "h2") {
      const t = subTitle(b.text); const a = `s${++anchorN}`;
      cur.nav.push({ title: t, anchor: a });
      cur.html += `<h2 id="${a}">${esc(t)}</h2>`;
      continue;
    }
    cur.html += block(b, warn);
  }

  // ---- assemble the package ---------------------------------------------------------
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
  const manifest = [], spine = [];
  zip.file("OEBPS/style.css", CSS); manifest.push(`<item id="css" href="style.css" media-type="text/css"/>`);

  const coverJpg = pdfPath && fs.existsSync(pdfPath) ? await renderCover(pdfPath) : null;
  if (coverJpg) {
    zip.file("OEBPS/images/cover.jpg", coverJpg);
    manifest.push(`<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
    zip.file("OEBPS/cover.xhtml", xhtml(bookTitle, `<div class="cover"><img src="images/cover.jpg" alt="${esc(bookTitle)}"/></div>`));
    manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="cover" linear="yes"/>`);
  }

  // pictures referenced by the text, from the workspace's staged (cropped/enhanced) copies
  const imgRefs = new Set();
  for (const ch of chapters) for (const m of ch.html.matchAll(/src="images\/([^"]+)"/g)) imgRefs.add(m[1]);
  for (const f of imgRefs) {
    const src = [path.join(workspace, "_media", f), path.join(workspace, f)].find((p) => fs.existsSync(p));
    if (!src) { warn(`emit-epub: picture ${f} not found`); continue; }
    const ext = path.extname(f).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".svg" ? "image/svg+xml" : "image/jpeg";
    zip.file(`OEBPS/images/${f}`, fs.readFileSync(src));
    manifest.push(`<item id="img-${f.replace(/[^\w]/g, "_")}" href="images/${esc(f)}" media-type="${type}"/>`);
  }

  for (const ch of chapters) {
    zip.file(`OEBPS/${ch.id}.xhtml`, xhtml(ch.title, ch.html));
    manifest.push(`<item id="${ch.id}" href="${ch.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${ch.id}"/>`);
  }

  // the reader's table of contents: each section/topic, its sub-topics beneath it
  const navChapters = chapters.filter((c) => c.navTitle);
  const navOl = navChapters.map((c) => `<li><a href="${c.id}.xhtml">${esc(c.navTitle)}</a>${c.nav.length ? `<ol>${c.nav.map((s) => `<li><a href="${c.id}.xhtml#${s.anchor}">${esc(s.title)}</a></li>`).join("")}</ol>` : ""}</li>`).join("\n");
  zip.file("OEBPS/nav.xhtml", xhtml("Contents", `<nav epub:type="toc" id="toc"><h1 class="sec">Contents</h1><ol>\n${navOl}\n</ol></nav>`));
  manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);

  const h = crypto.createHash("sha1").update(bookTitle + "|" + authors.join(",")).digest("hex");
  const uid = `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  let play = 0;
  const ncxPoints = navChapters.map((c) => `<navPoint id="np${++play}" playOrder="${play}"><navLabel><text>${esc(c.navTitle)}</text></navLabel><content src="${c.id}.xhtml"/>${c.nav.map((s) => `<navPoint id="np${++play}" playOrder="${play}"><navLabel><text>${esc(s.title)}</text></navLabel><content src="${c.id}.xhtml#${s.anchor}"/></navPoint>`).join("")}</navPoint>`).join("\n");
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="2"/></head>
<docTitle><text>${esc(bookTitle)}</text></docTitle>
<navMap>
${ncxPoints}
</navMap>
</ncx>
`);
  manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);

  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${esc(bookTitle)}</dc:title>
${authors.map((a) => `    <dc:creator>${esc(a)}</dc:creator>`).join("\n")}
    <dc:publisher>Zambia Educational Publishing House</dc:publisher>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
${coverJpg ? `    <meta name="cover" content="cover-image"/>\n` : ""}  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${spine.join("\n    ")}
  </spine>
</package>
`);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, mimeType: "application/epub+zip" });
  fs.writeFileSync(outPath, buf);
  return { chapters: chapters.length, pictures: imgRefs.size, cover: !!coverJpg };
}

module.exports = { writeEpub };
