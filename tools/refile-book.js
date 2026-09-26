#!/usr/bin/env node
// Re-file a manuscript into the house layout  books-to-typeset/<Subject>/<Level>/<YYYY-MM-DD>/
// WITHOUT breaking it. In one step it:
//   1. moves the .docx together with its sidecars (<name>.overrides.json, <name>.doc) —
//      the file NAME never changes (output/ folders are keyed on it);
//   2. rewrites every path inside the .overrides.json that pointed at a real file: shared
//      assets become "@/…" (repo-root alias, depth-proof), the book's own files stay relative
//      (pass --with <folder> to move a helper folder such as fig-fixes/ along with it);
//   3. updates data/zeph.db so zeph still finds every moved file.
//
//   node tools/refile-book.js "books-to-typeset/Form 4 Books/My Book.docx" "Physics" "Form 4" 2026-06-26
//   node tools/refile-book.js "<docx>" "<Subject>" "<Level>" <date> --with fig-fixes
//   add --dry to only print what would happen.
const fs = require("fs");
const path = require("path");
const { ROOT } = require("../src/typeset/paths.js");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const withDirs = [];
for (let i = args.indexOf("--with"); i >= 0; i = args.indexOf("--with")) withDirs.push(args.splice(i, 2)[1]);
const [docxArg, subject, level, date] = args.filter((a) => a !== "--dry");
if (!docxArg || !subject || !level || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
  console.error('usage: node tools/refile-book.js "<path/to/book.docx>" "<Subject>" "<Level>" YYYY-MM-DD [--with <folder>] [--dry]');
  process.exit(1);
}
const docx = path.resolve(docxArg);
if (!fs.existsSync(docx)) { console.error("not found:", docx); process.exit(1); }
const oldDir = path.dirname(docx);
const newDir = path.join(ROOT, "books-to-typeset", subject, level, date);
const stem = path.basename(docx).replace(/\.docx$/i, "");

const moves = [[docx, path.join(newDir, path.basename(docx))]];
for (const ext of [".overrides.json", ".doc"]) {
  const f = path.join(oldDir, stem + ext);
  if (fs.existsSync(f)) moves.push([f, path.join(newDir, stem + ext)]);
}
for (const d of withDirs) {
  const src = path.resolve(oldDir, d);
  if (!fs.existsSync(src)) { console.error("--with folder not found:", src); process.exit(1); }
  moves.push([src, path.join(newDir, path.basename(src))]);
}
for (const [, to] of moves) if (fs.existsSync(to)) { console.error("already exists:", to); process.exit(1); }

const mapPath = (p) => {
  const n = path.resolve(p);
  for (const [from, to] of moves) {
    if (n === from) return to;
    if (n.startsWith(from + path.sep)) return to + n.slice(from.length);
  }
  return n;
};

// rewrite the overrides' file paths (computed from the OLD location)
const ovOld = path.join(oldDir, stem + ".overrides.json");
let ovText = null;
const changes = [];
if (fs.existsSync(ovOld)) {
  ovText = fs.readFileSync(ovOld, "utf8");
  const strings = new Set();
  (function walk(v) { if (typeof v === "string") strings.add(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); })(JSON.parse(ovText));
  for (const s of strings) {
    if (path.isAbsolute(s) || /^@[\\/]/.test(s) || !/[\\/]|\.(png|jpe?g|gif|svg|emf|wmf|docx?|pdf)$/i.test(s)) continue;
    const target = path.resolve(oldDir, s);
    if (!fs.existsSync(target)) continue;
    const nt = mapPath(target);
    const rel = nt.startsWith(newDir + path.sep)
      ? path.relative(newDir, nt).split(path.sep).join("/")
      : "@/" + path.relative(ROOT, nt).split(path.sep).join("/");
    if (rel === s) continue;
    ovText = ovText.split(JSON.stringify(s)).join(JSON.stringify(rel));
    changes.push(`${s}  ->  ${rel}`);
  }
}

console.log(`${DRY ? "[dry run] " : ""}refiling into ${path.relative(ROOT, newDir)}`);
for (const [f, t] of moves) console.log(`  move ${path.relative(ROOT, f)}\n    -> ${path.relative(ROOT, t)}`);
for (const c of changes) console.log(`  override path ${c}`);
if (DRY) process.exit(0);

fs.mkdirSync(newDir, { recursive: true });
for (const [f, t] of moves) fs.renameSync(f, t);
if (ovText !== null && changes.length) fs.writeFileSync(path.join(newDir, stem + ".overrides.json"), ovText);

// zeph.db: repoint any registered version at its new place
const dbFile = process.env.ZEPH_DB || path.join(ROOT, "data", "zeph.db");
if (fs.existsSync(dbFile)) {
  const { db } = require("./db.js");
  let n = 0;
  for (const r of db.prepare("SELECT id, stored_path FROM version").all()) {
    if (!r.stored_path) continue;
    const np = mapPath(r.stored_path);
    if (np !== path.resolve(r.stored_path)) { db.prepare("UPDATE version SET stored_path = ? WHERE id = ?").run(np, r.id); n++; }
  }
  console.log(`  zeph.db: ${n} path(s) updated`);
}
console.log("done — typeset it once to check:  node src/typeset/typeset-docx.js \"" + path.relative(ROOT, moves[0][1]) + "\"");
