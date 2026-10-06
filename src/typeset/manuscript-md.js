#!/usr/bin/env node
// Convert a .docx manuscript to plain-text markdown, next to the .docx as
// "<book>.manuscript.md".
//
// This is a READING AID, not a step in the typesetting pipeline: the engine still
// parses the .docx itself. Its purpose is the rule in CLAUDE.md — check what the
// manuscript actually says before "fixing" how it renders — which is far easier
// against a searchable markdown rendering of the whole book than against raw OOXML
// read in 2000-character slices.
//
// Pandoc is the preferred converter but is not installed on every machine, so this
// does the same job with the JSZip dependency the repo already carries. It reads the
// author's own text: no overrides are applied, nothing is renamed or renumbered.
//
//   node src/typeset/manuscript-md.js "books-to-typeset/My Book.docx"   # one book
//   node src/typeset/manuscript-md.js books-to-typeset                  # every book under a folder
//
// typeset-docx.js calls writeManuscriptMd() at the start of every build, so the
// markdown is always there and always current without anyone remembering to run it.

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

// --- tiny XML helpers -------------------------------------------------------
// document.xml is machine-written and well-formed, so a regex walk is enough here
// and keeps the tool free of an XML-parser dependency.
const unesc = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
   .replace(/&amp;/g, "&");

const attrOf = (tag, name) => {
  const m = tag.match(new RegExp("\\s" + name + '="([^"]*)"'));
  return m ? unesc(m[1]) : null;
};

// Pull the direct children of `tag` out of a block of XML, keeping nesting straight
// (a table cell holds paragraphs; a table can hold another table). Returns each
// child's inner XML together with its own opening tag, which carries the attributes.
function children(xml, tag) {
  const out = [];
  const open = new RegExp("<" + tag + "(?:\\s[^>]*?)?(/?)>", "g");
  let m;
  while ((m = open.exec(xml))) {
    if (m[1] === "/") { out.push({ open: m[0], inner: "" }); continue; }
    const step = new RegExp("<" + tag + "(?:\\s[^>]*?)?(/?)>|</" + tag + ">", "g");
    step.lastIndex = open.lastIndex;
    let depth = 1, s;
    while (depth > 0 && (s = step.exec(xml))) {
      if (s[0].charAt(1) === "/") depth--;
      else if (s[1] !== "/") depth++;
    }
    if (!s) break;
    out.push({ open: m[0], inner: xml.slice(open.lastIndex, s.index) });
    open.lastIndex = step.lastIndex;
  }
  return out;
}

// --- runs -------------------------------------------------------------------
function runText(run) {
  let t = "";
  const body = run.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, "");
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:noBreakHyphen\s*\/>/g;
  for (const m of body.matchAll(re)) {
    if (m[1] !== undefined) t += unesc(m[1]);
    else if (m[0].indexOf("<w:tab") === 0) t += "\t";
    else if (m[0].indexOf("<w:br") === 0) t += "\n";
    else t += "-";
  }
  return t;
}

function paraText(p) {
  let out = "";
  // The paragraph's runs in document order, with any drawing sitting between them.
  const re = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>|<w:drawing>[\s\S]*?<\/w:drawing>|<w:pict>[\s\S]*?<\/w:pict>/g;
  for (const m of p.matchAll(re)) {
    if (m[1] === undefined) { out += "![image]()"; continue; }
    const run = m[1];
    const rPr = (run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || ["", ""])[1];
    const bold = /<w:b\b(?![^>]*w:val="(?:0|false)")/.test(rPr);
    const ital = /<w:i\b(?![^>]*w:val="(?:0|false)")/.test(rPr);
    let t = runText(run);
    if (!t) continue;
    // The markers go OUTSIDE the run's own leading/trailing spaces, or markdown
    // ignores them.
    const lead = t.match(/^\s*/)[0];
    const tail = t.slice(lead.length).match(/\s*$/)[0];
    t = t.slice(lead.length, t.length - tail.length);
    if (t) {
      if (bold) t = "**" + t + "**";
      if (ital) t = "*" + t + "*";
    }
    out += lead + t + tail;
  }
  return out.replace(/[ \t]+$/, "");
}

// --- numbering --------------------------------------------------------------
// Only one question matters for plain text: bullet or number. numbering.xml maps
// numId -> abstractNumId -> a numFmt per level.
function numberingMap(xml) {
  if (!xml) return {};
  const abstract = {};
  for (const a of children(xml, "w:abstractNum")) {
    const id = attrOf(a.open, "w:abstractNumId");
    const fmts = {};
    for (const lvl of children(a.inner, "w:lvl")) {
      const ilvl = attrOf(lvl.open, "w:ilvl");
      const fmt = attrOf((lvl.inner.match(/<w:numFmt[^>]*\/>/) || [""])[0], "w:val");
      if (ilvl != null) fmts[ilvl] = fmt;
    }
    if (id != null) abstract[id] = fmts;
  }
  const byNum = {};
  for (const n of children(xml, "w:num")) {
    const numId = attrOf(n.open, "w:numId");
    const aid = attrOf((n.inner.match(/<w:abstractNumId[^>]*\/>/) || [""])[0], "w:val");
    if (numId != null) byNum[numId] = abstract[aid] || {};
  }
  return byNum;
}

// --- blocks -----------------------------------------------------------------
function paraMd(p, nums, counters) {
  const pPr = (p.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || ["", ""])[1];
  const style = attrOf((pPr.match(/<w:pStyle[^>]*\/>/) || [""])[0], "w:val") || "";
  const text = paraText(p).trim();
  if (!text) return "";

  const numPr = (pPr.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/) || ["", ""])[1];
  if (numPr) {
    const numId = attrOf((numPr.match(/<w:numId[^>]*\/>/) || [""])[0], "w:val");
    const ilvl = attrOf((numPr.match(/<w:ilvl[^>]*\/>/) || [""])[0], "w:val") || "0";
    const fmt = (nums[numId] || {})[ilvl] || "bullet";
    const pad = "  ".repeat(+ilvl);
    if (fmt === "bullet") return pad + "- " + text;
    // A deeper level restarts whenever the level above it moves on.
    for (const k of Object.keys(counters)) {
      const parts = k.split(":");
      if (parts[0] === numId && +parts[1] > +ilvl) delete counters[k];
    }
    const key = numId + ":" + ilvl;
    counters[key] = (counters[key] || 0) + 1;
    return pad + counters[key] + ". " + text;
  }

  const h = style.match(/^Heading\s*(\d)$/i);
  if (h) return "#".repeat(Math.min(6, +h[1])) + " " + text;
  if (/^Title$/i.test(style)) return "# " + text;
  if (/^Subtitle$/i.test(style)) return "## " + text;
  return text;
}

function tableMd(tbl) {
  const rows = [];
  for (const tr of children(tbl, "w:tr")) {
    const cells = children(tr.inner, "w:tc").map((tc) => {
      const parts = [];
      for (const p of children(tc.inner, "w:p")) {
        const t = paraText(p.inner).trim();
        if (t) parts.push(t);
      }
      return parts.join(" ").replace(/\|/g, "\\|");
    });
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return "";
  const width = Math.max.apply(null, rows.map((r) => r.length));
  const line = (r) => {
    const cols = [];
    for (let i = 0; i < width; i++) cols.push(r[i] || "");
    return "| " + cols.join(" | ") + " |";
  };
  const out = [line(rows[0]), "| " + Array(width).fill("---").join(" | ") + " |"];
  for (const r of rows.slice(1)) out.push(line(r));
  return out.join("\n");
}

function docxToMarkdown(doc, numbering) {
  const body = (doc.match(/<w:body>([\s\S]*)<\/w:body>/) || ["", doc])[1];
  const nums = numberingMap(numbering);
  const counters = {};
  const out = [];
  // Walk the body's top level in document order: paragraphs and tables interleave.
  const re = /<w:p(?:\s[^>]*?)?(\/?)>|<w:tbl(?:\s[^>]*?)?>/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] === "/") continue;
    const tag = m[0].indexOf("<w:tbl") === 0 ? "w:tbl" : "w:p";
    const step = new RegExp("<" + tag + "(?:\\s[^>]*?)?(/?)>|</" + tag + ">", "g");
    step.lastIndex = re.lastIndex;
    let depth = 1, s;
    while (depth > 0 && (s = step.exec(body))) {
      if (s[0].charAt(1) === "/") depth--;
      else if (s[1] !== "/") depth++;
    }
    if (!s) break;
    const inner = body.slice(re.lastIndex, s.index);
    const md = tag === "w:tbl" ? tableMd(inner) : paraMd(inner, nums, counters);
    if (md) out.push(md);
    re.lastIndex = step.lastIndex;
  }
  // A blank line between blocks, except between consecutive list items.
  const isItem = (s) => /^\s*(?:-|\d+\.)\s/.test(s);
  const text = [];
  for (let i = 0; i < out.length; i++) {
    text.push(out[i]);
    if (i + 1 < out.length && !(isItem(out[i]) && isItem(out[i + 1]))) text.push("");
  }
  return text.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function writeManuscriptMd(docxPath) {
  const md = path.join(
    path.dirname(docxPath),
    path.basename(docxPath).replace(/\.docx$/i, "") + ".manuscript.md"
  );
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
    const doc = await zip.file("word/document.xml").async("string");
    const numFile = zip.file("word/numbering.xml");
    const numbering = numFile ? await numFile.async("string") : null;
    fs.writeFileSync(md, docxToMarkdown(doc, numbering), "utf8");
    return md;
  } catch (e) {
    // A reading aid must never be the thing that stops a book being typeset.
    console.warn("!  could not write the plain-text manuscript:", e.message);
    return null;
  }
}

module.exports = { writeManuscriptMd, docxToMarkdown };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: node src/typeset/manuscript-md.js <book.docx | folder>");
    process.exit(1);
  }
  const targets = [];
  const walk = (p) => {
    if (fs.statSync(p).isDirectory()) {
      for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    } else if (/\.docx$/i.test(p) && path.basename(p).indexOf("~$") !== 0) {
      targets.push(p);
    }
  };
  for (const a of args) walk(path.resolve(a));
  (async () => {
    for (const t of targets) {
      const md = await writeManuscriptMd(t);
      if (md) console.log("wrote", path.relative(process.cwd(), md));
    }
  })();
}
