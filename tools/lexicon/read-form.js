#!/usr/bin/env node
// Read a returned "Local Language Words" form (.docx) and print / return its answers:
// the header lines (Language, Your name, Book and grade) and every table row
// [English word, how the author writes it]. Used by import-forms.js.
//
//   node tools/lexicon/read-form.js <form.docx> [--json]

const fs = require("fs");
const JSZip = require("jszip");

const text = (xml) => (xml.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
  .map((t) => (t === "<w:tab/>" ? " " : t === "<w:br/>" ? " / " : t.replace(/<[^>]+>/g, "")))
  .join("").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\s+/g, " ").trim();

async function readForm(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml").async("string");
  const header = {};
  for (const p of xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, "").split(/<\/w:p>/)) {
    const m = text(p).match(/^(Language|Your name|Book and grade)\s*:\s*(.*)$/i);
    if (m) header[m[1].toLowerCase()] = m[2].replace(/_+/g, "").trim();
  }
  const rows = [];
  for (const tbl of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []) {
    for (const tr of tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
      const cells = (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(text);
      rows.push(cells);
    }
  }
  return { header, rows };
}

module.exports = { readForm };

if (require.main === module) {
  readForm(process.argv[2]).then((r) => {
    if (process.argv.includes("--json")) return console.log(JSON.stringify(r, null, 1));
    console.log(r.header);
    for (const c of r.rows) console.log(c.map((x) => x.padEnd(32)).join(" | "));
  });
}
