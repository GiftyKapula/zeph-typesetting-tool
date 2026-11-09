// Word manuscript -> book model.
//  * A manuscript made by `reader:import` (reader styles: Book Title, Imprint, Chapter Number,
//    Heading 1...) is read exactly as styled.
//  * Any other Word file (an author's own layout, e.g. Makandauko a Imute wa Kalilo) is read
//    by look: bold centred short lines are headings, "Kauhanyo ya 1" / "Chapter 3" lines are
//    chapter numbers, a one-letter giant paragraph is a drop capital, everything before the
//    copyright line is the title page, the contents list is dropped (it is rebuilt).
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (x, tag, a = "w:val") => { const m = x.match(new RegExp(`<${tag}\\b[^>]*?${a}="([^"]*)"`)); return m ? m[1] : null; };
const flag = (rpr, tag) => { const m = rpr.match(new RegExp(`<${tag}(\\s[^>]*)?/>`)); if (!m) return null; const v = (m[1] || "").match(/w:val="([^"]*)"/); return !v || !/^(0|false|none)$/.test(v[1]); };
const CHAPTER_WORDS = /^(chapter|kapetulu|icipande|cibalo|ciputulo|chibalu|cipande|chiputulo|kauhanyo(\s+ya)?|kapitulo|mutwe|part|story|lesson)\b\s*([0-9]+|[ivxlc]+)?\b.{0,6}$/i;
const CONTENTS_WORDS = /^(contents|table of contents|ifili mukati|linaneho|linaneo|mukoloko wa litaba|vilimo|izili moomu|zili mukati|vili mukati|zamkati|zili mkati)$/i;

async function readDocx(file, { mediaDir } = {}) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml").async("string");
  const stylesXml = zip.file("word/styles.xml") ? await zip.file("word/styles.xml").async("string") : "";
  const relsXml = zip.file("word/_rels/document.xml.rels") ? await zip.file("word/_rels/document.xml.rels").async("string") : "";
  // style id -> { name, size, bold, align, basedOn }
  const styles = {};
  for (const s of stylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/g) || []) {
    const id = attr(s, "w:style", "w:styleId"); if (!id) continue;
    const rpr = (s.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
    styles[id] = { name: (attr(s, "w:name") || id).toLowerCase(), size: attr(rpr, "w:sz") ? Number(attr(rpr, "w:sz")) / 2 : null, bold: flag(rpr, "w:b"), align: attr(s, "w:jc"), basedOn: attr(s, "w:basedOn") };
  }
  const defRpr = (stylesXml.match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/) || [""])[0];
  const defSize = attr(defRpr, "w:sz") ? Number(attr(defRpr, "w:sz")) / 2 : 11;
  const sProp = (id, k) => { let s = styles[id], n = 0; while (s && n++ < 8) { if (s[k] !== null && s[k] !== undefined) return s[k]; s = styles[s.basedOn]; } return null; };
  const rels = {}; for (const r of relsXml.match(/<Relationship\b[^>]*>/g) || []) rels[attr(r, "Relationship", "Id")] = attr(r, "Relationship", "Target");
  let imgNo = 0;
  const paras = [];
  const body = xml.slice(xml.indexOf("<w:body>"));
  for (const p of body.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []) {
    const ppr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
    const sid = attr(ppr, "w:pStyle") || "Normal";
    const sname = styles[sid] ? styles[sid].name : sid.toLowerCase();
    const align = attr(ppr, "w:jc") || sProp(sid, "align") || "left";
    const pbBefore = /<w:pageBreakBefore(\s|\/)/.test(ppr);
    const runs = []; const imgs = []; let pageBreak = false; let maxSize = 0, boldChars = 0, chars = 0;
    for (const r of p.match(/<w:r\b[\s\S]*?<\/w:r>|<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/g) || []) {
      for (const rr of r.startsWith("<w:hyperlink") ? r.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [] : [r]) {
        const rpr = (rr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
        const b = flag(rpr, "w:b") ?? sProp(sid, "bold") ?? false;
        const i = flag(rpr, "w:i") ?? false;
        const size = attr(rpr, "w:sz") ? Number(attr(rpr, "w:sz")) / 2 : sProp(sid, "size") || defSize;
        if (/w:type="page"/.test(rr)) pageBreak = true;
        const emb = rr.match(/r:embed="([^"]+)"/) || rr.match(/r:id="([^"]+)"/);
        if (emb && /<w:drawing|<w:pict/.test(rr) && rels[emb[1]]) {
          const target = rels[emb[1]].replace(/^\/?word\//, "");
          const zf = zip.file("word/" + target) || zip.file(target);
          if (zf) {
            imgNo++;
            const ext = path.extname(target).toLowerCase() || ".png";
            const name = `docx-${String(imgNo).padStart(3, "0")}${ext}`;
            const ext2 = rr.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
            if (mediaDir) { fs.mkdirSync(mediaDir, { recursive: true }); fs.writeFileSync(path.join(mediaDir, name), await zf.async("nodebuffer")); }
            imgs.push({ name, wpt: ext2 ? Number(ext2[1]) / 12700 : 300, hpt: ext2 ? Number(ext2[2]) / 12700 : 200, alt: attr(rr, "wp:docPr", "descr") || "" });
          }
        }
        let t = "";
        for (const m of rr.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:noBreakHyphen\/>|<w:softHyphen\/>/g)) {
          if (m[1] !== undefined) t += dec(m[1]);
          else if (m[0].startsWith("<w:tab")) t += " ";
          else if (m[0].startsWith("<w:br")) { if (!/type="page"/.test(m[0])) t += "\n"; }
          else if (m[0].startsWith("<w:noBreakHyphen")) t += "-";
        }
        if (!t) continue;
        const pr = runs[runs.length - 1];
        if (pr && pr.b === b && pr.i === i) pr.t += t; else runs.push({ t, b, i });
        const vis = t.replace(/\s/g, "").length; chars += vis; if (b) boldChars += vis; if (vis) maxSize = Math.max(maxSize, size);
      }
    }
    const text = runs.map((r) => r.t).join("").replace(/[ \t]+/g, " ").trim();
    const indFirst = Number(attr(ppr, "w:ind", "w:firstLine") || 0);
    const framed = /<w:framePr\b/.test(ppr) || /<w:dropCap/.test(ppr);
    paras.push({ style: sid, sname, align, text, runs, imgs, pageBreak: pageBreak || pbBefore, size: maxSize || sProp(sid, "size") || defSize, bold: chars > 0 && boldChars >= chars * 0.7, indFirst, framed });
  }
  const ours = paras.some((p) => /^(book title|chapter number|imprint)$/.test(p.sname));
  return ours ? readStyled(paras) : readByLook(paras);
}

const cleanRuns = (runs) => {
  const out = [];
  for (const r of runs) { const t = r.t.replace(/[ \t]+/g, " "); const pr = out[out.length - 1]; if (pr && pr.b === r.b && pr.i === r.i) pr.t += t; else out.push({ t, b: !!r.b, i: !!r.i }); }
  if (out.length) { out[0].t = out[0].t.replace(/^\s+/, ""); out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, ""); }
  return out.filter((r) => r.t);
};
const toLines = (runs) => { const lines = [[]]; for (const r of runs) { r.t.split("\n").forEach((piece, k) => { if (k) lines.push([]); if (piece) lines[lines.length - 1].push({ ...r, t: piece }); }); } return lines.map((l) => ({ runs: cleanRuns(l) })).filter((l) => l.runs.length); };

// ---- a manuscript in the reader styles
function readStyled(paras) {
  const meta = { title: "", author: "", series: [] };
  const front = []; const body = [];
  let inFront = true, pendingLabel = null, frontSec = null, imprint = null;
  for (const p of paras) {
    const n = p.sname;
    const figs = p.imgs.map((im) => ({ t: "fig", file: "media/" + im.name, wpt: im.wpt, hpt: im.hpt }));
    if (n === "book title") { meta.title = p.text; continue; }
    if (n === "book author") { meta.author = p.text; continue; }
    if (n === "book series") { meta.series.push(p.text); continue; }
    if (n === "imprint") { if (!imprint) { imprint = { type: "imprint", lines: [] }; front.push(imprint); } imprint.lines.push(p.text); continue; }
    if (n === "front heading") { frontSec = { type: "section", blocks: [{ t: "h1", label: "", title: p.text }] }; front.push(frontSec); continue; }
    if (n === "chapter number") { pendingLabel = p.text; inFront = false; continue; }
    if (n === "heading 1") {
      inFront = false;
      // a heading that is only a number or a chapter word ("4", "CHAPTER FOUR") is the label
      const onlyLabel = !pendingLabel && (/^(\d{1,3}|[IVXLC]{1,7})[.)]?$/.test(p.text) || CHAPTER_WORDS.test(p.text) && p.text.split(/\s+/).length <= 3);
      body.push(onlyLabel ? { t: "h1", label: p.text, title: "" } : { t: "h1", label: pendingLabel || "", title: p.text });
      pendingLabel = null; continue;
    }
    const target = inFront ? (frontSec ? frontSec.blocks : null) : body;
    if (!target) { if (p.text || figs.length) { frontSec = { type: "section", blocks: [] }; front.push(frontSec); } else continue; }
    const T = inFront ? frontSec.blocks : body;
    if (figs.length) { T.push(...figs); continue; }
    if (n === "caption") { const f = [...T].reverse().find((b) => b.t === "fig"); if (f) f.caption = p.text; continue; }
    if (!p.text) continue;
    if (n === "heading 2") { T.push({ t: "h2", text: p.text }); continue; }
    if (n === "scene break") { T.push({ t: "break" }); continue; }
    if (n === "centred") { T.push({ t: "center", lines: toLines(p.runs) }); continue; }
    if (n === "verse") { T.push({ t: "verse", lines: toLines(p.runs) }); continue; }
    if (n === "right") { T.push({ t: "right", lines: toLines(p.runs) }); continue; }
    T.push({ t: "p", runs: cleanRuns(p.runs.map((r) => ({ ...r, t: r.t.replace(/\n/g, " ") }))), quote: n === "quote" });
  }
  return { meta, front, body };
}

// ---- any other Word file
function readByLook(paras) {
  const ps = paras.filter((p) => p.text || p.imgs.length);
  // drop capitals: a framed / giant 1-2 letter paragraph joins the next one
  for (let i = 0; i + 1 < ps.length; i++) {
    const p = ps[i];
    if (p.text.length <= 2 && /\p{L}/u.test(p.text) && (p.framed || p.size >= 30) && !p.imgs.length) {
      const nx = ps[i + 1]; nx.runs = [{ t: p.text, b: false, i: false }, ...nx.runs.map((r) => ({ ...r, b: false }))]; nx.text = p.text + nx.text; nx.bold = false; nx.dropcap = true;
      ps.splice(i, 1); i--;
    }
  }
  const sizes = new Map(); for (const p of ps) if (p.text.length > 60) sizes.set(p.size, (sizes.get(p.size) || 0) + p.text.length);
  const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
  const meta = { title: "", author: "", series: [] };
  const front = [];
  // title page = everything before the copyright line
  const ci = ps.findIndex((p) => /©|copyright/i.test(p.text));
  const tp = ci > 0 ? ps.slice(0, ci) : [];
  if (tp.length) {
    const big = Math.max(...tp.map((p) => p.size));
    const t = tp.filter((p) => p.size === big && p.text);
    meta.title = t.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
    meta.author = (tp.find((p) => p.size < big && p.text && !/publishing|lusaka|foundation|house/i.test(p.text)) || {}).text || "";
  }
  let i = Math.max(0, ci);
  // imprint: from the copyright line up to a contents title / a heading-looking line after a gap
  const imprint = { type: "imprint", lines: [] };
  for (; i < ps.length; i++) {
    const p = ps[i];
    if (CONTENTS_WORDS.test(p.text.trim()) || (imprint.lines.length > 3 && p.bold && p.align === "center" && !/isbn|published|printed|zambia|lusaka|house/i.test(p.text) && p.size > body)) break;
    if (p.text) imprint.lines.push(p.text);
  }
  if (imprint.lines.length) front.push(imprint);
  // contents list: skip until a heading that is not a listed title... a contents list is the
  // run of short lines after the contents title
  if (i < ps.length && CONTENTS_WORDS.test(ps[i].text.trim())) {
    i++;
    while (i < ps.length && ps[i].text.length < 70 && !ps[i].bold && !ps[i].imgs.length) i++;
  }
  const isHead = (p) => p.text && p.text.length <= 90 && !/[.,;:]["'’”]?$/.test(p.text) && (p.bold || p.size > body + 1.5) && (p.align === "center" || p.size > body + 1.5);
  const blocks = [];
  let seenChapter = false; let frontSec = null;
  for (; i < ps.length; i++) {
    const p = ps[i];
    const figs = p.imgs.map((im) => ({ t: "fig", file: "media/" + im.name, wpt: im.wpt, hpt: im.hpt }));
    const label = p.text && CHAPTER_WORDS.test(p.text.trim());
    if (label) {
      const nx = ps[i + 1];
      const title = nx && isHead(nx) && !CHAPTER_WORDS.test(nx.text.trim()) ? nx.text : "";
      if (title) i++;
      if (figs.length) blocks.push(...figs);
      blocks.push({ t: "h1", label: p.text.trim(), title });
      seenChapter = true; frontSec = null; continue;
    }
    if (isHead(p) && !figs.length) {
      if (!seenChapter) { frontSec = { type: "section", blocks: [{ t: "h1", label: "", title: p.text }] }; front.push(frontSec); continue; }
      blocks.push({ t: "h2", text: p.text }); continue;
    }
    const T = !seenChapter && frontSec ? frontSec.blocks : blocks;
    if (figs.length) T.push(...figs);
    if (!p.text) continue;
    if (/^([*•·]\s*){3,}$/.test(p.text)) { T.push({ t: "break" }); continue; }
    if (p.align === "center" && p.text.length < 80) { T.push({ t: "center", lines: toLines(p.runs) }); continue; }
    if (p.align === "right") { T.push({ t: "right", lines: toLines(p.runs) }); continue; }
    T.push({ t: "p", runs: cleanRuns(p.runs.map((r) => ({ ...r, t: r.t.replace(/\n/g, " ") }))) });
  }
  // a picture straight after a chapter heading that sat above it in Word: keep it after
  return { meta, front, body: blocks };
}

module.exports = { readDocx };
