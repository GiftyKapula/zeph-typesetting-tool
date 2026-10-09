#!/usr/bin/env node
// Print the opening paragraphs of manuscripts (title, authors, cover words) and their
// heading outline — the facts needed to write a new book's overrides.
//   node tools/qa/peek.mjs <docx…> [--lines 40] [--outline]
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const args = process.argv.slice(2);
const n = +(args[args.indexOf("--lines") + 1] || 40);
const outline = args.includes("--outline");
for (const f of args.filter((a, i) => a.endsWith(".docx"))) {
  const z = await JSZip.loadAsync(fs.readFileSync(f));
  let x = (await z.file("word/document.xml").async("string")).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const paras = x.split("</w:p>").map((p) => ({
    t: [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").replace(/\s+/g, " ").trim(),
    st: (p.match(/w:pStyle w:val="([^"]+)"/) || [])[1] || "",
    toc: /w:pStyle w:val="TOC|w:anchor="_Toc|PAGEREF/.test(p),
    img: /<a:blip /.test(p),
  })).filter((p) => p.t || p.img);
  console.log(`\n===== ${path.basename(f)}  (${paras.length} paragraphs, ${paras.filter((p) => p.img).length} with pictures)`);
  paras.slice(0, n).forEach((p, i) => console.log(`${String(i).padStart(3)} ${p.st.padEnd(14).slice(0, 14)} ${p.img ? "[img] " : ""}${p.t.slice(0, 110)}`));
  if (outline) {
    console.log("  -- outline (Heading styles / CAPS lines) --");
    paras.forEach((p, i) => { if (!p.toc && p.t && (/^Heading/.test(p.st) || (p.t.length < 70 && p.t === p.t.toUpperCase() && /[A-Z]{3}/.test(p.t)))) console.log(`  ${String(i).padStart(4)} ${p.st.padEnd(10).slice(0, 10)} ${p.t.slice(0, 90)}`); });
  }
}
