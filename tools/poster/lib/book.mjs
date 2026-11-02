// What a poster may know about a book: its front-cover words and its metadata — nothing else.
//
// The words come from the BUILT book's own cover call in `_source.typ` (the exact lines and
// author byline the engine printed on the cover) and from the theme's `labels` table there
// (the book's own-language words for Grade / Teacher's Guide / Authors, when the book uses
// them). Only those two lines of `_source.typ` are read; the interior is never parsed.
// Falls back to the overrides + file name (tools/lib/meta.js) when the book has no build.
//
// CONFIDENTIAL: this module never opens admin/ (the authors' forms with phone numbers) and
// never reads the manuscript text.

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { findBookDir } from "../../qa/qa.mjs";

const require = createRequire(import.meta.url);
const { metaForDocx, gradeOf, detectNameOf } = require("../../lib/meta.js");

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Typst string literals in a list: ("A", "B \"q\"",) -> ["A", 'B "q"']
export function typstStrings(src) {
  return [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}

// The first `n` parenthesised arguments of a Typst call, as raw text — brackets inside
// strings ("M. Nambao (Dr.)") don't count.
export function typstArgs(call, n = 2) {
  const args = [];
  let depth = 0, start = -1, inStr = false;
  for (let i = call.indexOf("(") + 1; i < call.length && args.length < n; i++) {
    const c = call[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "(") { if (depth++ === 0) start = i + 1; }
    else if (c === ")") { if (--depth === 0) args.push(call.slice(start, i)); }
  }
  return args;
}

// The cover call and the labels table out of a built book's _source.typ.
export function coverFromSource(typ) {
  const call = typ.split("\n").find((l) => l.startsWith("#cover(")) || "";
  const a = typstArgs(call, 2);
  const m = a.length === 2 ? [null, a[0], a[1]] : null;
  const labelsLine = typ.split("\n").find((l) => /^\s*labels:\s*\(/.test(l)) || "";
  const labels = {};
  for (const [, k, v] of labelsLine.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)) labels[k] = JSON.parse(`"${v}"`);
  return m ? { lines: typstStrings(m[1]), byline: typstStrings(m[2]), labels } : { lines: [], byline: [], labels };
}

const LEVEL = /\b(grade|form)\s*\d+|\bECE(\s+(level|levo)\s+\d+)?\b/i;

// Put a cover's words together as poster fields, in the book's own words where it has them.
export function fieldsFromCover({ lines, byline, labels }, fallback = {}) {
  const L = labels || {};
  const levelLine = [...lines].reverse().find((l) => LEVEL.test(l)) || "";
  const rawLevel = (levelLine.match(LEVEL) || [""])[0] || fallback.level || "";
  const level = rawLevel.replace(/\bgrade\b/i, (w) => L.grade || w).replace(/\bform\b/i, (w) => L.form || w)
    .replace(/\b(grade|form)(?=\s)/i, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  // the subject shares the level's line ("ICIBEMBA GRADE 4") or is the line above it
  const above = lines[lines.indexOf(levelLine) - 1];
  const subject = (levelLine.replace(LEVEL, "").replace(/\s+/g, " ").trim()
    || (above && !LEVEL.test(above) && lines.indexOf(levelLine) > (lines.length > 3 ? 1 : 0) ? above : "")
    || fallback.subject || (levelLine ? "" : lines[1] || lines[0]) || "").trim();
  const typeLine = lines.length > 1 ? lines[lines.length - 1] : "";
  const rawType = LEVEL.test(typeLine) || !typeLine ? (fallback.booktype || "") : typeLine;
  const booktype = rawType.replace(/teacher['’]?s\s+guide/i, (w) => L.tg || w).replace(/learner['’]?s\s+book/i, (w) => L.lb || w);
  const eyebrow = lines.length > 2 && lines[0] !== levelLine ? lines[0] : "";
  const authors = (byline && byline.length ? byline : fallback.authors || []).filter(Boolean);
  return {
    subject, level: level.trim(), booktype: booktype.trim(), eyebrow,
    authors, authorsLabel: L.authors || (authors.length === 1 ? "Author" : "Authors"),
    title: [subject, level.trim(), booktype.trim()].filter(Boolean).join(" "),
  };
}

const sidecarOf = (docx) => docx.replace(/\.docx$/i, ".overrides.json");
export function readOverrides(docx) {
  const p = sidecarOf(docx);
  if (!fs.existsSync(p)) return { path: p, ov: {}, exists: false };
  return { path: p, ov: JSON.parse(fs.readFileSync(p, "utf8")), exists: true };
}

// Everything the poster needs about one book. `docx` may be a .docx path or its sidecar.
export function bookInfo(docx) {
  docx = path.resolve(docx.replace(/\.overrides\.json$/i, ".docx"));
  const base = path.basename(docx, ".docx");
  const { ov, path: ovPath } = readOverrides(docx);
  const dir = findBookDir(docx);
  const pdf = dir ? path.join(dir, `${base} - typeset.pdf`) : null;
  const meta = metaForDocx(docx);
  const fallback = {
    subject: ov.subject || meta.subject || "",
    level: gradeOf(detectNameOf(base)) || "",
    booktype: (ov.coverWords || {}).booktype || ov.booktype || (meta.kind === "TG" ? "Teacher's Guide" : "Learner's Book"),
    authors: Array.isArray(ov.authors) ? ov.authors : [],
  };
  const typPath = dir ? path.join(dir, "_source.typ") : null;
  const cover = typPath && fs.existsSync(typPath) ? coverFromSource(fs.readFileSync(typPath, "utf8")) : { lines: [], byline: [], labels: {} };
  return {
    base, docx, ovPath, ov, dir, pdf: pdf && fs.existsSync(pdf) ? pdf : null,
    fields: fieldsFromCover(cover, fallback),
    released: !!ov.releasedForPrint, releasedAt: ov.releasedAt || null,
  };
}

// Every book whose sidecar says it is released for print.
export function releasedBooks(root = path.join(ROOT, "books-to-typeset")) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".overrides.json")) {
        try { if (JSON.parse(fs.readFileSync(p, "utf8")).releasedForPrint) out.push(p.replace(/\.overrides\.json$/i, ".docx")); } catch {}
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}
