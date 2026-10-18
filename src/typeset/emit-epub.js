#!/usr/bin/env node
// emit-epub.js — turn a ZEPH eBook bundle (dist-ebooks/<id>/, made by emit-ebook.js)
// into a standard EPUB 3 that any e-reader opens: Google Play Books, Apple Books, Kobo,
// Kindle (via Send-to-Kindle), Thorium, Calibre.
//
// The bundle is the book's semantic model as the PRINT pipeline finished it (build it
// with `emit-ebook.js --from-print`), so the EPUB carries every correction the printed
// book does. Text reflows; each topic is its own chapter; the cover is the printed
// cover itself (page 1 of the typeset PDF, rendered), so the two editions match.
//
// Usage:
//   node src/typeset/emit-epub.js dist-ebooks/<id> "<book - typeset.pdf>" "<out.epub>" \
//        [--author "A, B"] [--lang en-GB]
//
// Block types handled are those in docs/EBOOK-FORMAT.md; anything unknown falls back to
// its plain text, so no content is ever silently dropped.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[++i];
    else a._.push(argv[i]);
  }
  return a;
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const br = (s) => esc(s).replace(/\n/g, "<br/>");

// Rich text: segments of { t, b, it, u, c } (math segments carry an SVG file).
function segsHtml(segs, fallback) {
  if (!Array.isArray(segs) || !segs.length) return br(fallback || "");
  return segs.map((s) => {
    if (!s) return "";
    if (s.m) return s.svg ? `<img class="math" src="math/${esc(s.svg)}" alt="${esc(s.alt || "")}"/>` : esc(s.alt || "");
    let h = br(s.t);
    if (s.u) h = `<u>${h}</u>`;
    if (s.it) h = `<em>${h}</em>`;
    if (s.b) h = `<strong>${h}</strong>`;
    return h;
  }).join("");
}
const plain = (b) => b.text || b.title || b.heading || (b.segs || []).map((s) => (s && s.t) || "").join("") || "";

function figureHtml(file, caption, media) {
  if (!file || !media.has(file)) return caption ? `<p class="caption">${esc(caption)}</p>` : "";
  return `<figure><img src="images/${esc(file)}" alt="${esc(caption || "")}"/>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
}

// exercise / assessment parts: { kind: "q"|"lead"|"table"|"image"…, q, qseg, marker, depth }
function partsHtml(items, media) {
  let h = "";
  for (const p of items || []) {
    if (!p) continue;
    if (p.kind === "q") {
      const ind = p.depth ? ` style="margin-left:${1.4 * p.depth}em"` : "";
      h += `<p class="q"${ind}>${p.marker ? `<span class="mk">${esc(p.marker)}</span> ` : ""}${segsHtml(p.qseg, p.q)}</p>`;
    } else if (p.kind === "lead") {
      h += `<p class="lead">${segsHtml(p.qseg, p.q)}</p>`;
    } else if (p.kind === "table") {
      h += tableHtml(p.rows);
    } else if (p.kind === "image") {
      for (const im of p.images || []) h += figureHtml(im.file, im.caption, media);
    } else if (p.q || p.qseg) {
      h += `<p>${segsHtml(p.qseg, p.q)}</p>`;
    }
  }
  return h;
}

function tableHtml(rows, noHeader) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const cell = (c, tag) => `<${tag}>${c && c.segs ? segsHtml(c.segs, c.text) : br(c && c.text)}</${tag}>`;
  const [head, ...rest] = rows;
  const headIsHeader = !noHeader && head.every((c) => c && (c.segs || []).some((s) => s && s.b));
  let h = "<table>";
  if (headIsHeader) h += `<thead><tr>${head.map((c) => cell(c, "th")).join("")}</tr></thead>`;
  h += "<tbody>" + (headIsHeader ? rest : rows).map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("") + "</tbody>";
  return h + "</table>";
}

function blocksHtml(blocks, media, ids) {
  let h = "";
  let listOpen = false;
  const closeList = () => { if (listOpen) { h += "</ul>"; listOpen = false; } };
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type !== "listitem") closeList();
    switch (b.type) {
      case "cover": case "backcover": break;   // the cover page is the printed cover image
      case "topic": h += `<h1 id="${ids.next()}">${esc(b.text)}</h1>`; break;
      case "subtopic": h += `<h2 id="${esc(b.anchor || ids.next())}">${esc(b.text)}</h2>`; break;
      case "h3": h += `<h3>${esc(b.text)}</h3>`; break;
      case "label": h += `<p class="label">${esc(b.text)}</p>`; break;
      case "para": h += `<p${b.align === "center" ? ' class="c"' : ""}>${segsHtml(b.segs, b.text)}</p>`; break;
      case "listitem":
        if (!listOpen) { h += "<ul>"; listOpen = true; }
        h += `<li${b.marker && b.marker !== "•" ? ` data-marker="${esc(b.marker)}"` : ""}>${b.marker && b.marker !== "•" ? `<span class="mk">${esc(b.marker)}</span> ` : ""}${segsHtml(b.segs, b.text)}</li>`;
        break;
      case "caption": h += `<p class="caption">${esc(b.text)}</p>`; break;
      case "figure": h += figureHtml(b.file, b.caption, media); break;
      case "imagerow": for (const im of b.images || []) h += figureHtml(im.file, im.caption, media); break;
      case "signature":
        h += `<div class="sig">${(b.lines || []).map((l) => `<p>${l.bold ? `<strong>${esc(l.text)}</strong>` : esc(l.text)}</p>`).join("")}</div>`;
        break;
      case "activity":
        h += `<aside class="box act"><p class="bt">${esc(b.title)}</p>${blocksHtml(b.body, media, ids)}</aside>`; break;
      case "fact":
        h += `<aside class="box fact"><p class="bt">Did You Know?</p>${blocksHtml(b.body, media, ids)}</aside>`; break;
      case "keypoints":
        h += `<aside class="box kp">${b.title ? `<p class="bt">${esc(b.title)}</p>` : ""}<ul>${(b.points || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul></aside>`; break;
      case "box": case "framedsection": case "lessonmeta":
        h += `<aside class="box">${b.title ? `<p class="bt">${esc(b.title)}</p>` : ""}${blocksHtml(b.body, media, ids)}</aside>`; break;
      case "exercise":
        h += `<aside class="box ex"><p class="bt">${esc(b.heading)}</p>${partsHtml(b.items, media)}</aside>`; break;
      case "assessment":
        h += `<aside class="box asmt"><p class="bt">${esc(b.title)}</p>${blocksHtml(b.intro, media, ids)}${partsHtml(b.items, media)}${blocksHtml(b.extra, media, ids)}</aside>`; break;
      case "table": h += tableHtml(b.rows, b.noHeader); break;
      case "colgrid":
        h += tableHtml((b.rows || []).map((r) => (r.cells || r).map((c) => ({ text: typeof c === "string" ? c : (c && c.text) || "" }))), true); break;
      default: { const t = plain(b); if (t) h += `<p>${br(t)}</p>`; }
    }
  }
  closeList();
  return h;
}

const CSS = `
body { font-family: serif; line-height: 1.45; margin: 0 4%; }
h1 { font-family: sans-serif; color: #4a3582; font-size: 1.5em; margin: 1.2em 0 .6em; page-break-before: always; }
h2 { font-family: sans-serif; color: #4a3582; font-size: 1.2em; margin: 1.2em 0 .4em; border-bottom: 2px solid #d9a22b; }
h3 { font-family: sans-serif; font-size: 1.05em; margin: 1em 0 .3em; }
p { margin: .35em 0; text-align: left; }
p.c { text-align: center; }
p.label { font-weight: bold; margin-top: .8em; }
.mk { font-weight: bold; color: #4a3582; }
ul { margin: .3em 0 .3em 1.2em; padding: 0; }
li { margin: .2em 0; }
li[data-marker] { list-style: none; }
figure { margin: 1em 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
figcaption, p.caption { font-size: .85em; font-style: italic; text-align: center; color: #444; }
aside.box { border-left: 4px solid #6b53a8; background: #f1eef8; padding: .5em .8em; margin: 1em 0; }
aside.ex { border-color: #2f8f8a; background: #eaf5f4; }
aside.asmt { border-color: #d9a22b; background: #fbf3e2; }
aside.fact { border-color: #2f8f8a; }
p.bt { font-family: sans-serif; font-weight: bold; color: #4a3582; margin-top: 0; }
aside.ex p.bt { color: #2f8f8a; } aside.asmt p.bt { color: #9a6c10; }
p.q { margin: .3em 0 .3em 0; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: .9em; }
th, td { border: 1px solid #999; padding: .25em .4em; vertical-align: top; text-align: left; }
th { background: #4a3582; color: #fff; }
.sig p { margin: 0; }
img.math { vertical-align: middle; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; }
`;

async function renderCover(pdfPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = require("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 1600 / base.height });
  const c = createCanvas(Math.round(vp.width), Math.round(vp.height));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c.toBuffer("image/jpeg", 90);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [bundleDir, pdfPath, outPath] = args._;
  if (!bundleDir || !outPath) { console.error("usage: node src/typeset/emit-epub.js <bundle dir> <typeset.pdf> <out.epub> [--author …]"); process.exit(1); }
  const book = JSON.parse(fs.readFileSync(path.join(bundleDir, "book.json"), "utf8"));
  const lang = args.lang || "en-GB";
  const mediaDir = path.join(bundleDir, "media");
  const media = new Set(fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []);
  const coverBlock = (book.sections[0] && book.sections[0].blocks || []).find((b) => b.type === "cover");
  const author = args.author || (coverBlock && coverBlock.byline && coverBlock.byline.join(", ")) || book.author || "ZEPH";
  const uid = "urn:uuid:" + crypto.createHash("sha1").update("zeph:" + book.id).digest("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file("OEBPS/style.css", CSS);

  const xhtml = (title, body, extraHead = "") => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/>${extraHead}</head>
<body>${body}</body></html>`;

  const manifest = [], spine = [];
  // cover
  if (pdfPath && fs.existsSync(pdfPath)) {
    zip.file("OEBPS/images/cover.jpg", await renderCover(pdfPath));
    manifest.push(`<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
    zip.file("OEBPS/cover.xhtml", xhtml("Cover", `<div class="cover"><img src="images/cover.jpg" alt="${esc(book.title)}"/></div>`));
    manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="cover" linear="yes"/>`);
  }
  // images actually used
  for (const f of media) {
    const ext = path.extname(f).toLowerCase();
    const mt = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".svg" ? "image/svg+xml" : "image/jpeg";
    zip.file(`OEBPS/images/${f}`, fs.readFileSync(path.join(mediaDir, f)));
    manifest.push(`<item id="img-${f.replace(/[^A-Za-z0-9]/g, "_")}" href="images/${esc(f)}" media-type="${mt}"/>`);
  }
  const mathDir = path.join(bundleDir, "math");
  if (fs.existsSync(mathDir)) for (const f of fs.readdirSync(mathDir)) {
    zip.file(`OEBPS/math/${f}`, fs.readFileSync(path.join(mathDir, f)));
    manifest.push(`<item id="m-${f.replace(/[^A-Za-z0-9]/g, "_")}" href="math/${f}" media-type="image/svg+xml"/>`);
  }
  // one chapter per section
  const navItems = [];
  let n = 0;
  book.sections.forEach((sec, si) => {
    const file = `ch${String(si + 1).padStart(2, "0")}.xhtml`;
    let k = 0;
    const ids = { next: () => `x${si}-${k++}` };
    const body = blocksHtml(sec.blocks, media, ids);
    if (!body.trim()) return;
    zip.file(`OEBPS/${file}`, xhtml(sec.title || book.title, body));
    manifest.push(`<item id="c${si}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${si}"/>`);
    const tocEntry = book.toc.find((t) => t.section === sec.id);
    const label = si === 0 ? "Title and copyright" : (tocEntry ? tocEntry.title : sec.title);
    const kids = (tocEntry && tocEntry.children || []).map((c) => ({ title: c.title, href: `${file}#${c.anchor}` }));
    navItems.push({ title: label, href: file, kids });
    n++;
  });
  const navOl = (items) => `<ol>${items.map((i) => `<li><a href="${esc(i.href)}">${esc(i.title)}</a>${i.kids && i.kids.length ? navOl(i.kids) : ""}</li>`).join("")}</ol>`;
  zip.file("OEBPS/nav.xhtml", xhtml("Contents", `<nav epub:type="toc" id="toc"><h1>Contents</h1>${navOl(navItems)}</nav>`));
  manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  // EPUB 2 NCX, for older readers (and Kindle conversion)
  let play = 0;
  const ncxPoints = (items) => items.map((i) => `<navPoint id="np${++play}" playOrder="${play}"><navLabel><text>${esc(i.title)}</text></navLabel><content src="${esc(i.href)}"/>${i.kids ? ncxPoints(i.kids) : ""}</navPoint>`).join("");
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head>
<docTitle><text>${esc(book.title)}</text></docTitle><navMap>${ncxPoints(navItems)}</navMap></ncx>`);
  manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  manifest.push(`<item id="css" href="style.css" media-type="text/css"/>`);

  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
    <dc:publisher>Zambia Educational Publishing House</dc:publisher>
    <dc:language>${lang}</dc:language>
    <dc:subject>${esc(book.subject || "")}</dc:subject>
    <dc:description>${esc(`${book.level || ""} ${book.subject || ""} ${book.bookType === "TG" ? "Teacher's Guide" : "Learner's Book"} — Secondary Education Ordinary Level, Zambia.`.trim())}</dc:description>
    <meta property="dcterms:modified">${modified}</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${spine.join("\n    ")}
  </spine>
</package>`);

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/epub+zip" });
  fs.writeFileSync(outPath, buf);
  console.log(`EPUB: ${path.basename(outPath)} — ${n} chapters, ${media.size} images, ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
