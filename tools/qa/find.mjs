#!/usr/bin/env node
// Where does a word/phrase occur — in the manuscript (by paragraph, with style, and
// whether it sits in a table / text box) and in the typeset PDF (by printed page)?
//   node tools/qa/find.mjs <docx> "<regex>" [--pdf]
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { findBookDir } from "./qa.mjs";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const [docx, pat] = process.argv.slice(2);
const re = new RegExp(pat, "gi");
const z = await JSZip.loadAsync(fs.readFileSync(docx));
let x = (await z.file("word/document.xml").async("string")).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
let inTbl = 0, inBox = 0, n = 0, i = 0;
const where = {};
for (const chunk of x.split("</w:p>")) {
  i++;
  inTbl += (chunk.match(/<w:tbl>/g) || []).length - (chunk.match(/<\/w:tbl>/g) || []).length;
  const box = /<w:txbxContent/.test(chunk);
  const t = [...chunk.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
  const k = (t.match(re) || []).length;
  if (!k) continue;
  n += k;
  const st = (chunk.match(/w:pStyle w:val="([^"]+)"/) || [])[1] || "-";
  const toc = /TOC|_Toc|PAGEREF/.test(chunk);
  const tag = `${toc ? "contents" : st}${inTbl > 0 ? " [table]" : ""}${box ? " [textbox]" : ""}`;
  where[tag] = (where[tag] || 0) + k;
}
console.log("manuscript:", n, where);
if (process.argv.includes("--pdf")) {
  const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const dir = findBookDir(path.resolve(docx));
  const pdf = fs.readdirSync(dir).find((f) => / - typeset\.pdf$/.test(f));
  const d = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, pdf))), verbosity: 0 }).promise;
  let m = 0;
  for (let p = 1; p <= d.numPages; p++) m += ((await (await d.getPage(p)).getTextContent()).items.map((q) => q.str).join(" ").match(re) || []).length;
  console.log("pdf:", m);
}
