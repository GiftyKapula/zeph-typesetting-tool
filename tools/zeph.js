#!/usr/bin/env node
// zeph — book proofreading workflow CLI (local, SQLite-backed).
//
//   npm run zeph -- <command> [args]        (adds --experimental-sqlite for you)
//
// Lifecycle:  drafting → typesetting → sent-for-proofread → returned
//             → applying-corrections → approved → published
//
// Commands
//   import <dir>            register every .docx (+overrides) under <dir>, in place
//   list [--state s]        list books (optionally filter by state)
//   show <book>             book detail: versions, rounds, comment tallies
//   where <book>            print latest file paths for a book
//   add <book> <file>       attach any file (pdf/docx/log) as a version
//   build <book>            typeset the latest manuscript (runs the engine)
//   send <book> [pdf]       open a proofread round; mark sent-for-proofread
//   return <book> <file>    ingest annotated file, extract comments into the round
//   comments <book> [--open]  list the latest round's comments
//   resolve <comment-id> [--action "…"] [--flag] [--wontfix]
//   state <book> [newstate] get or set a book's lifecycle state
//   merge <src> <dst>       fold book <src> into <dst> (reconcile split identities)
//   export                  write books.json (committable DB snapshot)

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { db, ROOT, STATES } = require("./db.js");
const { metaForDocx, hashFile, gradeOf, kindOf, detectNameOf } = require("./lib/meta.js");

const rel = (p) => path.relative(ROOT, p) || p;
const die = (m) => { console.error(m); process.exit(1); };
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

// ---------- flags ----------
function parseFlags(args) {
  const flags = {}; const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) { flags[k] = args[++i]; }
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

// ---------- db helpers ----------
const getBook = (id) => db.prepare("SELECT * FROM book WHERE id=?").get(id);

function requireBook(id) {
  const b = getBook(id);
  if (b) return b;
  // fuzzy: unique prefix / substring match on id
  const all = db.prepare("SELECT id FROM book").all().map((r) => r.id);
  const hits = all.filter((x) => x.includes(id));
  if (hits.length === 1) return getBook(hits[0]);
  if (hits.length > 1) die(`ambiguous "${id}":\n  ${hits.join("\n  ")}`);
  die(`no such book: ${id}`);
}

function upsertBook(m) {
  const row = getBook(m.id);
  if (row) {
    db.prepare(`UPDATE book SET title=?,grade=?,subject=?,kind=?,author=?,theme=?,updated_at=? WHERE id=?`)
      .run(m.title, m.grade, m.subject, m.kind, m.author, m.theme, now(), m.id);
    return false;
  }
  db.prepare(`INSERT INTO book (id,title,grade,subject,kind,author,theme) VALUES (?,?,?,?,?,?,?)`)
    .run(m.id, m.title, m.grade, m.subject, m.kind, m.author, m.theme);
  return true;
}

function addVersion(bookId, kind, filePath, note = null) {
  const hash = hashFile(filePath);
  const dup = db.prepare("SELECT id FROM version WHERE book_id=? AND kind=? AND hash=?").get(bookId, kind, hash);
  if (dup) return dup.id;
  const r = db.prepare(`INSERT INTO version (book_id,kind,original_name,stored_path,hash,note,ingested_at) VALUES (?,?,?,?,?,?,?)`)
    .run(bookId, kind, path.basename(filePath), path.resolve(filePath), hash, note, now());
  return Number(r.lastInsertRowid);
}

const setState = (id, s) =>
  db.prepare("UPDATE book SET state=?, updated_at=? WHERE id=?").run(s, now(), id);

const latestVersion = (bookId, kind) =>
  db.prepare("SELECT * FROM version WHERE book_id=? AND kind=? ORDER BY id DESC LIMIT 1").get(bookId, kind);

const latestRound = (bookId) =>
  db.prepare("SELECT * FROM round WHERE book_id=? ORDER BY number DESC LIMIT 1").get(bookId);

// classify an arbitrary file into a version kind
function versionKindFor(file) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file).toLowerCase();
  if (ext === ".pdf") return /comment|review|annotat|markup|edited/.test(name) ? "annotated_pdf" : "typeset_pdf";
  if (ext === ".docx") return "manuscript";
  if (ext === ".json") return "overrides";
  return "attachment";
}

// ---------- commands ----------

function walkDocx(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDocx(p, out);
    else if (/\.docx$/i.test(e.name) && !/^~\$/.test(e.name)) out.push(p);
  }
  return out;
}

function cmdImport(dir) {
  const root = path.resolve(dir || "books-to-typeset");
  if (!fs.existsSync(root)) die("no such dir: " + root);
  const docs = walkDocx(root);
  let nb = 0, nv = 0;
  for (const d of docs) {
    const m = metaForDocx(d);
    if (upsertBook(m)) nb++;
    if (typeof addVersion(m.id, "manuscript", d) === "number") nv++;
    if (m.ovPath) addVersion(m.id, "overrides", m.ovPath);
  }
  console.log(`Scanned ${docs.length} .docx under ${rel(root)}`);
  console.log(`  ${nb} new book(s); versions registered in place (nothing moved).`);
}

function cmdList(flags) {
  let sql = `SELECT b.*, (SELECT COUNT(*) FROM version v WHERE v.book_id=b.id) vers,
             (SELECT COUNT(*) FROM comment c JOIN round r ON c.round_id=r.id
                WHERE r.book_id=b.id AND c.status='pending') open_comments
             FROM book b`;
  const p = [];
  if (flags.state) { sql += " WHERE b.state=?"; p.push(flags.state); }
  sql += " ORDER BY b.grade, b.subject, b.kind";
  const books = db.prepare(sql).all(...p);
  if (!books.length) return console.log("No books. Run:  npm run zeph -- import books-to-typeset");
  const w = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  console.log(w("ID", 36), w("GRADE", 8), w("K", 3), w("STATE", 20), w("V", 3), "OPEN");
  console.log("-".repeat(82));
  for (const b of books)
    console.log(w(b.id, 36), w(b.grade, 8), w(b.kind, 3), w(b.state, 20), w(b.vers, 3), b.open_comments || "");
  console.log(`\n${books.length} book(s).`);
}

function cmdShow(id) {
  const b = requireBook(id);
  console.log(`${b.title}  [${b.id}]`);
  console.log(`  grade=${b.grade}  subject=${b.subject}  kind=${b.kind}  theme=${b.theme}`);
  console.log(`  author=${b.author || "-"}  state=${b.state}`);
  const vers = db.prepare("SELECT * FROM version WHERE book_id=? ORDER BY id").all(b.id);
  console.log(`\n  versions (${vers.length}):`);
  for (const v of vers)
    console.log(`    #${v.id} ${v.kind.padEnd(14)} ${v.hash}  ${rel(v.stored_path)}`);
  const rounds = db.prepare("SELECT * FROM round WHERE book_id=? ORDER BY number").all(b.id);
  if (rounds.length) {
    console.log(`\n  proofread rounds:`);
    for (const r of rounds) {
      const c = db.prepare("SELECT status, COUNT(*) n FROM comment WHERE round_id=? GROUP BY status").all(r.id);
      const tally = c.map((x) => `${x.n} ${x.status}`).join(", ") || "no comments";
      console.log(`    round ${r.number} [${r.status}]  sent=${r.sent_at || "-"}  returned=${r.returned_at || "-"}  (${tally})`);
    }
  }
}

function cmdWhere(id) {
  const b = requireBook(id);
  for (const kind of ["manuscript", "overrides", "typeset_pdf", "annotated_pdf", "corrections_log"]) {
    const v = latestVersion(b.id, kind);
    if (v) console.log(`${kind.padEnd(15)} ${v.stored_path}`);
  }
}

function cmdAdd(id, file) {
  const b = requireBook(id);
  if (!file || !fs.existsSync(file)) die("file not found: " + file);
  const kind = versionKindFor(file);
  const vid = addVersion(b.id, kind, file);
  console.log(`+ ${kind} #${vid} → ${b.id}  (${rel(path.resolve(file))})`);
}

function cmdBuild(id) {
  const b = requireBook(id);
  const m = latestVersion(b.id, "manuscript");
  if (!m) die("no manuscript version for " + b.id);
  if (b.state === "drafting") setState(b.id, "typesetting");
  console.log(`Typesetting ${b.title}\n  ${rel(m.stored_path)}\n`);
  const r = spawnSync(process.execPath, ["src/typeset/typeset-docx.js", m.stored_path],
    { cwd: ROOT, stdio: "inherit" });
  process.exit(r.status || 0);
}

function cmdSend(id, pdf) {
  const b = requireBook(id);
  const prev = latestRound(b.id);
  const number = prev ? prev.number + 1 : 1;
  let sentVid = null;
  if (pdf) { if (!fs.existsSync(pdf)) die("pdf not found: " + pdf); sentVid = addVersion(b.id, "typeset_pdf", pdf); }
  db.prepare("INSERT INTO round (book_id,number,sent_version,sent_at,status) VALUES (?,?,?,?, 'open')")
    .run(b.id, number, sentVid, now());
  setState(b.id, "sent-for-proofread");
  console.log(`Round ${number} opened for ${b.title} — sent for proofread${pdf ? " (pdf recorded)" : ""}.`);
}

async function cmdReturn(id, file) {
  const b = requireBook(id);
  if (!file || !fs.existsSync(file)) die("file not found: " + file);
  const ext = path.extname(file).toLowerCase();
  const vkind = ext === ".pdf" ? "annotated_pdf" : "manuscript";
  const vid = addVersion(b.id, vkind, file, "returned from proofread");

  let round = db.prepare("SELECT * FROM round WHERE book_id=? AND status='open' ORDER BY number DESC LIMIT 1").get(b.id);
  if (!round) {
    const prev = latestRound(b.id);
    const number = prev ? prev.number + 1 : 1;
    const r = db.prepare("INSERT INTO round (book_id,number,sent_at,status) VALUES (?,?,?, 'open')").run(b.id, number, now());
    round = db.prepare("SELECT * FROM round WHERE id=?").get(Number(r.lastInsertRowid));
  }
  db.prepare("UPDATE round SET returned_version=?, returned_at=? WHERE id=?").run(vid, now(), round.id);

  // extract comments
  let comments = [];
  try {
    if (ext === ".pdf") comments = await require("./lib/pdf-comments.js").extractPdfComments(file);
    else comments = await require("./lib/docx-comments.js").extractDocxComments(file);
  } catch (e) { console.warn("!  comment extraction failed:", e.message); }

  const ins = db.prepare("INSERT INTO comment (round_id,page_ref,anchor,note,status) VALUES (?,?,?,?, 'pending')");
  for (const c of comments) ins.run(round.id, c.page || null, c.anchor || null, c.note || null);
  setState(b.id, "returned");
  console.log(`Round ${round.number}: ingested ${rel(path.resolve(file))}`);
  console.log(`  extracted ${comments.length} comment(s) → status 'returned'.`);
  if (comments.length) console.log(`  review with:  npm run zeph -- comments ${b.id}`);
}

function cmdComments(id, flags) {
  const b = requireBook(id);
  const round = latestRound(b.id);
  if (!round) die("no rounds for " + b.id);
  let sql = "SELECT * FROM comment WHERE round_id=?"; const p = [round.id];
  if (flags.open) sql += " AND status='pending'";
  sql += " ORDER BY id";
  const cs = db.prepare(sql).all(...p);
  console.log(`${b.title} — round ${round.number} — ${cs.length} comment(s)\n`);
  for (const c of cs) {
    const mark = { pending: "☐", done: "☑", flagged: "⚑", wontfix: "✗" }[c.status] || "•";
    console.log(`  ${mark} #${c.id} ${c.page_ref || ""} ${c.status}`);
    if (c.anchor) console.log(`      on: ${JSON.stringify(c.anchor.slice(0, 100))}`);
    if (c.note)   console.log(`      note: ${c.note.slice(0, 200)}`);
    if (c.action) console.log(`      → ${c.action}`);
  }
}

function cmdResolve(cid, flags) {
  const c = db.prepare("SELECT * FROM comment WHERE id=?").get(+cid);
  if (!c) die("no such comment: " + cid);
  const status = flags.wontfix ? "wontfix" : flags.flag ? "flagged" : "done";
  db.prepare("UPDATE comment SET status=?, action=? WHERE id=?")
    .run(status, flags.action || c.action || null, c.id);
  console.log(`comment #${c.id} → ${status}${flags.action ? `  (${flags.action})` : ""}`);
}

function cmdState(id, newState) {
  const b = requireBook(id);
  if (!newState) return console.log(`${b.id}: ${b.state}`);
  if (!STATES.includes(newState)) die(`unknown state "${newState}". one of: ${STATES.join(", ")}`);
  setState(b.id, newState);
  console.log(`${b.id}: ${b.state} → ${newState}`);
}

function cmdMerge(srcId, dstId) {
  const src = requireBook(srcId), dst = requireBook(dstId);
  if (src.id === dst.id) die("cannot merge a book into itself");
  db.prepare("UPDATE version SET book_id=? WHERE book_id=?").run(dst.id, src.id);
  db.prepare("UPDATE round SET book_id=? WHERE book_id=?").run(dst.id, src.id);
  db.prepare("DELETE FROM book WHERE id=?").run(src.id);
  console.log(`Merged ${src.id} → ${dst.id} (versions + rounds moved, ${src.id} removed).`);
}

function cmdExport() {
  const data = {
    books: db.prepare("SELECT * FROM book ORDER BY id").all(),
    versions: db.prepare("SELECT * FROM version ORDER BY id").all(),
    rounds: db.prepare("SELECT * FROM round ORDER BY id").all(),
    comments: db.prepare("SELECT * FROM comment ORDER BY id").all(),
  };
  const out = path.join(ROOT, "books.json");
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`Wrote ${rel(out)} (${data.books.length} books, ${data.versions.length} versions, ${data.comments.length} comments).`);
}

// ---------- dispatch ----------
(async () => {
  const [cmd, ...rawArgs] = process.argv.slice(2);
  const { flags, rest } = parseFlags(rawArgs);
  switch (cmd) {
    case "import":   cmdImport(rest[0]); break;
    case "list":     cmdList(flags); break;
    case "show":     cmdShow(rest[0]); break;
    case "where":    cmdWhere(rest[0]); break;
    case "add":      cmdAdd(rest[0], rest[1]); break;
    case "build":    cmdBuild(rest[0]); break;
    case "send":     cmdSend(rest[0], rest[1]); break;
    case "return":   await cmdReturn(rest[0], rest[1]); break;
    case "comments": cmdComments(rest[0], flags); break;
    case "resolve":  cmdResolve(rest[0], flags); break;
    case "state":    cmdState(rest[0], rest[1]); break;
    case "merge":    cmdMerge(rest[0], rest[1]); break;
    case "export":   cmdExport(); break;
    default:
      console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 24).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      process.exit(cmd ? 1 : 0);
  }
})();
