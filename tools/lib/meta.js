// Metadata derivation for zeph — turns a manuscript filename + its overrides
// sidecar into a stable book identity. Mirrors the engine's own filename logic
// (src/typeset/typeset-docx.js) so a book gets the same grade/theme here as when
// it is typeset.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { autoTheme, THEMES } = require("../../src/typeset/themes.js");

// "G2" / "G 2" → "Grade 2" for grade/theme detection (engine does the same).
const detectNameOf = (base) =>
  base.replace(/(^|[^A-Za-z])[Gg]\s*([1-7])(?![0-9])/g, "$1Grade $2");

function gradeOf(name) {
  const g = name.match(/(?:^|[^a-z])grade\s*(\d+)/i);
  if (g && +g[1] >= 1 && +g[1] <= 7) return `Grade ${g[1]}`;
  const f = name.match(/(?:^|[^a-z])form\s*(\d+)/i);
  if (f) return `Form ${f[1]}`;
  return null;
}

const kindOf = (base) =>
  /(?:^|[^a-z])TG(?:[^a-z]|$)|teacher/i.test(base) ? "TG" : "LB";

// Strip workflow/status noise to get a clean human title.
function titleOf(base, grade, subject, kind) {
  if (grade && subject) return `${grade} ${subject} ${kind}`;
  const t = base
    .replace(/[-_ ]*\b(sent for (typesetting|independent review)|ready for typesetting|advanced copy|advanced draft|final draft|reviewed and edited|cleaned after review|typeset)\b.*$/i, "")
    .replace(/\bdraft\s*\d+\b/gi, "")
    .replace(/\b\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/gi, "")
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-]+$/, "")
    .trim();
  return t || base;
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Given a .docx path, derive the book identity + adjacent overrides path.
function metaForDocx(docxPath) {
  const base = path.basename(docxPath).replace(/\.docx$/i, "");
  const detect = detectNameOf(base);
  const theme = autoTheme(detect);
  const grade = gradeOf(detect);
  const kind = kindOf(base);

  let ov = {};
  const ovPath = docxPath.replace(/\.docx$/i, ".overrides.json");
  const hasOv = fs.existsSync(ovPath);
  if (hasOv) { try { ov = JSON.parse(fs.readFileSync(ovPath, "utf8")); } catch {} }

  const subject = ov.subject || (THEMES[theme] || {}).subject || null;
  const author = Array.isArray(ov.authors) ? ov.authors.join(", ") : null;
  const title = titleOf(base, grade, subject, kind);
  const id = slug(grade && subject ? `${grade}-${subject}-${kind}` : title);

  return { id, title, grade, subject, kind, author, theme, ovPath: hasOv ? ovPath : null };
}

// Best-effort book id for an arbitrary returned file (pdf/docx) whose name may
// carry status noise. Used to auto-match a returned file to an existing book.
function guessBookId(anyPath) {
  const base = path.basename(anyPath).replace(/\.(docx|pdf)$/i, "");
  const detect = detectNameOf(base);
  const grade = gradeOf(detect);
  const kind = kindOf(base);
  return { grade, kind, base, detect };
}

const hashFile = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);

module.exports = {
  detectNameOf, gradeOf, kindOf, titleOf, slug,
  metaForDocx, guessBookId, hashFile,
};
