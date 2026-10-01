// Plain-text rendering of a manuscript, written before the book is typeset.
//
// The house rule is that a manuscript is converted to plain text BEFORE typesetting
// starts, so that "check the actual manuscript, don't guess" (CLAUDE.md) is a matter
// of reading a markdown file rather than slicing raw OOXML through JSZip. The
// conversion is a READING AID only: the pipeline still parses the .docx itself, so
// nothing here can change how a book is typeset.
//
// pandoc is the preferred converter and is used whenever it is on PATH. It is not
// installed everywhere, though, so a built-in fallback renders the same document
// from the OOXML directly using the JSZip dependency the repo already carries. The
// fallback is deliberately plain — headings, lists, tables, emphasis and image
// placeholders — because its job is to be read and grepped, not to round-trip.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const JSZip = require("jszip");

// --- pandoc -----------------------------------------------------------------

// Resolved once per process: `null` until looked up, then the command string or
// `false` when pandoc isn't available. Probing on every book would cost a process
// spawn per build for no reason.
let PANDOC = null;
function pandocCmd() {
  if (PANDOC !== null) return PANDOC;
  for (const cmd of ["pandoc", "pandoc.exe"]) {
    try {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf8", windowsHide: true });
      if (!r.error && r.status === 0) return (PANDOC = cmd);
    } catch (e) { /* try the next spelling */ }
  }
  return (PANDOC = false);
}

function viaPandoc(docxPath, outPath) {
  const cmd = pandocCmd();
  if (!cmd) return false;
  // `--wrap=none` keeps one source paragraph on one line, which is what makes the
  // result greppable — pandoc's default reflow would split a sentence across lines
  // and hide it from a plain search. gfm gives usable pipe tables.
  const r = spawnSync(cmd, [docxPath, "-f", "docx", "-t", "gfm", "--wrap=none", "-o", outPath],
    { encoding: "utf8", windowsHide: true });
  return !r.error && r.status === 0 && fs.existsSync(outPath);
}

// --- built-in fallback ------------------------------------------------------

const DEC = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unxml = (s) => String(s || "").replace(/&(amp|lt|gt|quot|apos);/g, (m) => DEC[m]);

// Everything a <w:p> contributes as text, in document order: run text, tabs and
// explicit breaks. Field codes (`<w:instrText>`) are skipped — a TOC's PAGEREF
// instructions are machinery, not manuscript, and dumping them buries the content.
function paraText(xml) {
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += unxml(m[1]);
    else if (m[0].startsWith("<w:tab")) out += "\t";
    else out += " ";
  }
  return out;
}

// Markdown is whitespace- and punctuation-sensitive; a manuscript that happens to
// contain `*`, `_`, `#` or a pipe would otherwise read as formatting.
const esc = (s) => String(s || "").replace(/([\\`*_{}\[\]#|])/g, "\\$1");

function headingLevel(pXml) {
  const st = (pXml.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || "";
  const m = st.match(/^Heading(\d)$/i);
  if (m) return Number(m[1]);
  if (/^Title$/i.test(st)) return 1;
  return 0;
}

function isListItem(pXml) {
  return /<w:numPr\b/.test(pXml);
}

// A table becomes a GFM pipe table. The first row is treated as the header, which is
// what these manuscripts actually do; when it isn't, the table still reads fine.
function tableMd(tblXml) {
  const rows = [...tblXml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
    [...r[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) =>
      [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
        .map((p) => paraText(p[0]).trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
    )
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => { const c = r.slice(); while (c.length < width) c.push(""); return c; };
  const line = (cells) => "| " + pad(cells).map((c) => esc(c) || " ").join(" | ") + " |";
  const out = [line(rows[0]), "|" + " --- |".repeat(width)];
  for (const r of rows.slice(1)) out.push(line(r));
  return out.join("\n");
}

function viaBuiltin(docxPath, outPath) {
  const zip = new JSZip();
  return zip.loadAsync(fs.readFileSync(docxPath))
    .then((z) => {
      const f = z.file("word/document.xml");
      if (!f) throw new Error("no word/document.xml");
      return f.async("string");
    })
    .then((xml) => {
      const body = (xml.match(/<w:body[ >]([\s\S]*)<\/w:body>/) || [, xml])[1];
      // Walk top-level paragraphs and tables in document order. A paragraph nested
      // inside a table is consumed by the table branch, so match them alternately
      // rather than collecting each kind separately (which would duplicate cells).
      const re = /<w:tbl[ >][\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p[ >][\s\S]*?<\/w:p>/g;
      const out = [];
      let m;
      let lastWasList = false;
      while ((m = re.exec(body))) {
        const chunk = m[0];
        if (chunk.startsWith("<w:tbl")) {
          const t = tableMd(chunk);
          if (t) { out.push("", t, ""); }
          lastWasList = false;
          continue;
        }
        const txt = paraText(chunk).replace(/\s+/g, " ").trim();
        const hasImg = /<(w:drawing|w:pict|v:imagedata)\b/.test(chunk);
        if (!txt) {
          if (hasImg) { out.push("", "![image]()", ""); lastWasList = false; }
          continue;
        }
        const h = headingLevel(chunk);
        if (h) {
          out.push("", "#".repeat(Math.min(h, 6)) + " " + esc(txt), "");
          lastWasList = false;
        } else if (isListItem(chunk)) {
          out.push("- " + esc(txt));
          lastWasList = true;
        } else {
          if (lastWasList) out.push("");
          out.push(esc(txt), "");
          lastWasList = false;
        }
        if (hasImg) out.push("![image]()", "");
      }
      // Collapse the runs of blank lines the push-pattern above leaves behind.
      const md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
      fs.writeFileSync(outPath, md, "utf8");
      return true;
    });
}

// --- entry point ------------------------------------------------------------

// Writes a markdown rendering of `docxPath` to `outPath`. Never throws: a manuscript
// that defeats the converter must not stop the book from being typeset, since this
// file is only a reading aid. Resolves to a short description of what happened.
async function writeManuscriptMarkdown(docxPath, outPath) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (viaPandoc(docxPath, outPath)) return { ok: true, how: "pandoc" };
    await viaBuiltin(docxPath, outPath);
    return { ok: true, how: "built-in" };
  } catch (e) {
    return { ok: false, how: null, error: e.message };
  }
}

module.exports = { writeManuscriptMarkdown, pandocCmd };
