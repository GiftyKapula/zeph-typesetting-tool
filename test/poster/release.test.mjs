import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// a throw-away book: books-to-typeset/<name>.docx (+ sidecar) and output/<Grade>/<name>/
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeph-release-"));
process.env.ZEPH_OUTPUT_DIR = path.join(tmp, "output");      // before qa.mjs is loaded
process.env.ZEPH_DB = path.join(tmp, "zeph.db");               // never the real zeph.db
const { release, latestQa } = await import("../../tools/poster/release.mjs");
const { createRequire } = await import("module");
const { db: zdb } = createRequire(import.meta.url)("../../tools/db.js");
const { bookInfo } = await import("../../tools/poster/lib/book.mjs");

function book(name, qaJson, { qaOlder = false } = {}) {
  const docx = path.join(tmp, "books", `${name}.docx`);
  fs.mkdirSync(path.dirname(docx), { recursive: true });
  fs.writeFileSync(docx, "not really a docx");
  fs.writeFileSync(docx.replace(/\.docx$/, ".overrides.json"), JSON.stringify({ subject: "Icibemba" }, null, 2));
  const dir = path.join(tmp, "output", "Grade 4", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_source.typ"), '#cover(("ICIBEMBA GRADE 4", "Teacher\'s Guide",), ("A. Author",), none, none, none)\n');
  const pdf = path.join(dir, `${name} - typeset.pdf`);
  if (qaJson) fs.writeFileSync(path.join(dir, "qa.json"), JSON.stringify(qaJson));
  fs.writeFileSync(pdf, "%PDF-1.7");
  const t = Date.now() / 1000;
  if (qaJson) fs.utimesSync(path.join(dir, "qa.json"), t + (qaOlder ? -100 : 100), t + (qaOlder ? -100 : 100));
  return docx;
}
const ov = (docx) => JSON.parse(fs.readFileSync(docx.replace(/\.docx$/, ".overrides.json"), "utf8"));
const PASS = { book: "x", score: 99.6, qualifies: true, blockers: [], warnings: [] };
const FAIL = { book: "x", score: 97.1, qualifies: false, blockers: ["text outside the 9 mm safe area"], warnings: [] };

test("a book whose latest QA fails is not released, and nothing is written", async () => {
  const d = book("Fail Book Grade 4 TG", FAIL);
  let made = 0;
  const r = await release(d, { posters: async () => { made++; } });
  assert.equal(r.released, false);
  assert.equal(made, 0);
  assert.equal(ov(d).releasedForPrint, undefined);
});

test("a book whose latest QA qualifies is marked released (with the date) and gets posters", async () => {
  const d = book("Pass Book Grade 4 TG", PASS);
  let made = 0;
  const r = await release(d, { posters: async () => { made++; return { qualifies: true }; } });
  assert.equal(r.released, true);
  assert.equal(made, 1);
  assert.equal(ov(d).releasedForPrint, true);
  assert.match(ov(d).releasedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(ov(d).subject, "Icibemba", "existing overrides kept");
  assert.equal(bookInfo(d).released, true);
});

test("a qa.json older than the PDF is stale: QA is run again first", async () => {
  const d = book("Stale Book Grade 4 TG", PASS, { qaOlder: true });
  let ran = 0;
  const r = await latestQa(bookInfo(d), { runQa: async () => { ran++; return FAIL; } });
  assert.equal(ran, 1);
  assert.equal(r.result.qualifies, false);
});

test("--force releases below the gate and records why", async () => {
  const d = book("Forced Book Grade 4 TG", FAIL);
  const r = await release(d, { force: "approved by the editor in writing", posters: async () => ({ qualifies: true }) });
  assert.equal(r.released, true);
  assert.equal(ov(d).releaseForced.reason, "approved by the editor in writing");
  assert.equal(ov(d).releaseForced.score, 97.1);
});

test("release moves the book to 'approved' in zeph and keeps the released PDF as a version", async () => {
  const d = book("Zeph Book Grade 4 TG", PASS);
  zdb.prepare("INSERT INTO book (id,title,state) VALUES (?,?,?)").run("zeph-book-tg", "Zeph Book", "applying-corrections");
  zdb.prepare("INSERT INTO version (book_id,kind,original_name,stored_path) VALUES (?,?,?,?)").run("zeph-book-tg", "manuscript", path.basename(d), d);
  const r = await release(d, { posters: async () => ({ qualifies: true, sets: [] }) });
  assert.equal(r.zephId, "zeph-book-tg");
  assert.equal(zdb.prepare("SELECT state FROM book WHERE id=?").get("zeph-book-tg").state, "approved");
  assert.match(zdb.prepare("SELECT note FROM version WHERE book_id=? AND kind='typeset_pdf'").get("zeph-book-tg").note, /^released for print/);
});

test("a book zeph does not know is still released; zeph is left alone", async () => {
  const d = book("Unknown Book Grade 4 TG", PASS);
  const r = await release(d, { posters: async () => ({ qualifies: true, sets: [] }) });
  assert.equal(r.released, true);
  assert.equal(r.zephId, null);
});

test("no typeset PDF: release refuses", async () => {
  const d = path.join(tmp, "books", "Never Built Grade 4 TG.docx");
  fs.writeFileSync(d, "x");
  await assert.rejects(() => release(d), /no typeset PDF/);
});

test.after(() => { zdb.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
