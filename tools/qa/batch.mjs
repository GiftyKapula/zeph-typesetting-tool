#!/usr/bin/env node
// Typeset several books IN PARALLEL, then put every one through the QA gate.
//
//   node tools/qa/batch.mjs "<folder or .docx>" […more] [--jobs 4] [--no-build] [--only text]
//
// Every .docx under the given folders is built (each build is its own process), with at
// most --jobs at once — and never more than free memory allows (~1.5 GB per build; a
// picture-heavy Learner's Book can need more), so the machine is not pushed into killing
// builds. Each build's console log is saved as build.log next to its PDF (the QA reads
// it for override entries that matched nothing). Then the QA gate runs on every book
// and a summary table is printed and saved to output/_qa/<date>-<time>.md.

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { qa, summary, findBookDir } from "./qa.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = path.join(ROOT, "src", "typeset", "typeset-docx.js");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const jobsWanted = +opt("--jobs", 4);
const only = opt("--only", null);
const noBuild = args.includes("--no-build");
const inputs = args.filter((a, i) => !a.startsWith("--") && !["--jobs", "--only"].includes(args[i - 1]));

const docxIn = (p) => {
  const st = fs.statSync(p);
  if (st.isFile()) return /\.docx$/i.test(p) ? [p] : [];
  return fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.name.startsWith("~$") ? [] : docxIn(path.join(p, e.name))));
};
const books = inputs.flatMap((p) => docxIn(path.resolve(p))).filter((b) => !only || b.includes(only));
if (!books.length) { console.error("no .docx found"); process.exit(1); }

// Memory a build needs, from its manuscript: ~0.5 GB base + ~40× the .docx size (the
// pictures are decoded and re-encoded). A new build starts only when that much is free —
// or when nothing else is running (a lone build always goes ahead).
const need = (docx) => 0.5e9 + 40 * fs.statSync(docx).size;
const jobs = Math.max(1, Math.min(jobsWanted, books.length));
let running = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (a build that has only just started has not taken its memory yet — count what was
// promised to builds started in the last few seconds, so a burst of starts can't all see
// the same free memory)
const promised = [];
async function memoryGate(docx) {
  const owed = () => promised.filter((p) => Date.now() - p.t < 6000).reduce((s, p) => s + p.n, 0);
  while (running > 0 && os.freemem() - owed() < need(docx)) await sleep(1000);
  promised.push({ t: Date.now(), n: need(docx) });
}
console.log(`${books.length} book(s); building ${noBuild ? "skipped" : `up to ${jobs} at a time, memory permitting`} (free memory ${(os.freemem() / 1e9).toFixed(1)} GB)\n`);

function build(docx) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ch = spawn(process.execPath, ["--max-old-space-size=4096", ENGINE, docx], { cwd: ROOT });
    let log = "";
    ch.stdout.on("data", (d) => (log += d));
    ch.stderr.on("data", (d) => (log += d));
    ch.on("close", (code) => resolve({ code, log, secs: Math.round((Date.now() - t0) / 1000) }));
  });
}

const results = [];
let next = 0;
async function worker() {
  while (next < books.length) {
    const docx = books[next++];
    const name = path.basename(docx, ".docx");
    let b = { code: 0, log: "", secs: 0 };
    if (!noBuild) {
      await memoryGate(docx);
      running++;
      console.log(`→ building ${name}  (${running} running, ${(os.freemem() / 1e9).toFixed(1)} GB free)`);
      b = await build(docx);
      running--;
      const dir = findBookDir(docx);
      if (dir) fs.writeFileSync(path.join(dir, "build.log"), b.log);
      const failed = b.code !== 0 || /^Failed on /m.test(b.log);
      console.log(`${failed ? "✗" : "✓"} built  ${name} (${b.secs}s)${failed ? "  — " + (b.log.trim().split("\n").filter((l) => /TYPST|Error|Failed/.test(l)).slice(-2).join(" | ")) : ""}`);
      if (failed) { results.push({ docx, r: { book: name, error: "build failed: " + b.log.trim().split("\n").slice(-2).join(" | ").slice(0, 200) } }); continue; }
    }
    const r = await qa(docx);
    results.push({ docx, r, secs: b.secs });
  }
}
await Promise.all(Array.from({ length: noBuild ? Math.min(4, books.length) : jobs }, worker));

results.sort((a, b) => books.indexOf(a.docx) - books.indexOf(b.docx));
const row = ({ r }) => r.error
  ? `| ${r.book} | — | — | — | — | ✗ ${r.error.slice(0, 60)} |`
  : `| ${r.book} | ${r.pages} | ${r.fidelity} | ${r.layout} | **${r.score}** | ${r.qualifies ? "✓ qualifies" : `✗ ${r.blockers.length} blocker(s)`} |`;
const table = ["| Book | Pages | Fidelity | Layout | Score | Gate |", "|---|---|---|---|---|---|", ...results.map(row)].join("\n");
const detail = results.map(({ r }) => summary(r)).join("\n\n");
console.log("\n" + table + "\n\n" + detail);
const qdir = path.join(ROOT, "output", "_qa");
fs.mkdirSync(qdir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
fs.writeFileSync(path.join(qdir, `${stamp}.md`), `# QA batch ${stamp}\n\n${table}\n\n\`\`\`\n${detail}\n\`\`\`\n`);
console.log(`\nreport: output/_qa/${stamp}.md`);
