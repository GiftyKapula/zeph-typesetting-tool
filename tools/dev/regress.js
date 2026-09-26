#!/usr/bin/env node
// Regression check for the typesetting engine.
//
// Builds every manuscript under books-to-typeset/ into a throw-away folder (the real
// output/ is never touched) and records, per book, the md5 of the generated Typst
// source and the PDF byte size. Run it once BEFORE a refactor to take a snapshot,
// then again AFTER and compare: identical Typst + identical PDF size means the
// refactor changed nothing on the page (PDF bytes themselves differ by timestamp).
//
//   node tools/dev/regress.js snapshot before.json     # take a snapshot
//   node tools/dev/regress.js snapshot after.json
//   node tools/dev/regress.js compare before.json after.json
//
// Options: --jobs N (parallel builds, default 3), --only <substring> (filter books),
//          --dir <folder> (repeatable; default books-to-typeset/), --engine <typeset-docx.js>
//          (build with another copy of the engine, e.g. a git worktree of main).

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
let ENGINE = path.join(ROOT, "src", "typeset", "typeset-docx.js");

function findDocx(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findDocx(p, out);
    else if (/\.docx$/i.test(e.name) && !e.name.startsWith("~$")) out.push(p);
  }
  return out;
}

function findFile(dir, re) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, re); if (r) return r; }
    else if (re.test(e.name)) return p;
  }
  return null;
}

function buildOne(docx, outDir) {
  return new Promise((resolve) => {
    const env = { ...process.env, ZEPH_OUTPUT_DIR: outDir };
    const ch = spawn(process.execPath, [ENGINE, docx], { env, cwd: ROOT });
    let log = "";
    ch.stdout.on("data", (d) => (log += d));
    ch.stderr.on("data", (d) => (log += d));
    ch.on("close", (code) => resolve({ code, log }));
  });
}

async function snapshot(file, jobs, only, dirs) {
  const books = dirs.flatMap((d) => findDocx(path.resolve(d))).filter((f) => !only || f.includes(only));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeph-regress-"));
  const result = {};
  let next = 0, done = 0;
  async function worker() {
    while (next < books.length) {
      const docx = books[next++];
      // basename + content hash: stable when a manuscript moves folder, unique when two
      // different manuscripts share a filename
      const key = `${path.basename(docx, ".docx")} [${crypto.createHash("md5").update(fs.readFileSync(docx)).digest("hex").slice(0, 8)}]`;
      const outDir = path.join(tmp, String(next));
      const { code, log } = await buildOne(docx, outDir);
      const typ = fs.existsSync(outDir) ? findFile(outDir, /^_source\.typ$/) : null;
      const pdf = fs.existsSync(outDir) ? findFile(outDir, /- typeset\.pdf$/) : null;
      result[key] = typ
        ? { typ: crypto.createHash("md5").update(fs.readFileSync(typ)).digest("hex"), pdfBytes: pdf ? fs.statSync(pdf).size : 0 }
        : { error: (log.trim().split("\n").pop() || `exit ${code}`).slice(0, 300) };
      done++;
      console.log(`[${done}/${books.length}] ${result[key].error ? "FAIL" : "ok  "} ${key}`);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`\nSnapshot of ${books.length} books -> ${file}`);
}

function compare(a, b) {
  const A = JSON.parse(fs.readFileSync(a, "utf8"));
  const B = JSON.parse(fs.readFileSync(b, "utf8"));
  let same = 0, diff = 0;
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[k], y = B[k];
    if (!x || !y) { console.log(`${!x ? "NEW    " : "MISSING"} ${k}`); diff++; continue; }
    if (JSON.stringify(x) === JSON.stringify(y)) { same++; continue; }
    diff++;
    console.log(`CHANGED ${k}\n   before: ${JSON.stringify(x)}\n   after:  ${JSON.stringify(y)}`);
  }
  console.log(`\n${same} identical, ${diff} different`);
  process.exit(diff ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest.splice(i, 2)[1] : d; };
const jobs = Number(flag("--jobs", 3));
const only = flag("--only", null);
ENGINE = path.resolve(flag("--engine", ENGINE));
const dirs = [];
for (let d; (d = flag("--dir", null)); ) dirs.push(d);
if (!dirs.length) dirs.push(path.join(ROOT, "books-to-typeset"));
if (cmd === "snapshot" && rest[0]) snapshot(path.resolve(rest[0]), jobs, only, dirs);
else if (cmd === "compare" && rest[1]) compare(rest[0], rest[1]);
else console.log("usage: regress.js snapshot <out.json> [--jobs N] [--only text] | compare <a.json> <b.json>");
