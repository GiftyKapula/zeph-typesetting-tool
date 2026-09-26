// Resolving file paths written in a book's .overrides.json sidecar.
//
//   "@/images/cov-maths.png"   -> <repo root>/images/cov-maths.png   (shared assets)
//   "fig-fixes/fig09.png"      -> next to the manuscript             (the book's own files)
//   "C:/abs/path.png"          -> used as-is
//
// Prefer "@/…" for anything outside the book's own folder (images/, zeph-logo/, …): it
// keeps working however deep the manuscript sits in books-to-typeset/, so books can be
// re-filed without breaking their pictures. Plain relative paths still work as before.
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function resolveBookPath(docxPath, p) {
  if (/^@[\\/]/.test(p)) return path.join(ROOT, p.slice(2));
  return path.isAbsolute(p) ? p : path.resolve(path.dirname(docxPath), p);
}

module.exports = { ROOT, resolveBookPath };
