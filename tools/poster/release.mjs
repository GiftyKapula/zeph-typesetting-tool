#!/usr/bin/env node
// Release a book for print, then make its marketing posters — see docs/POSTERS.md.
//
//   npm run release -- "books-to-typeset/…/<book>.docx"
//   npm run release -- "<book>.docx" --force "CDC approved the 98.6 score in writing"
//
// Proceeds only when the book's LATEST QA passes: its qa.json (written by `npm run qa` /
// `npm run batch` beside the PDF) must be newer than the PDF and say `qualifies: true`.
// A missing or stale qa.json is re-run here first. On a pass the book's overrides get
//   "releasedForPrint": true, "releasedAt": "YYYY-MM-DD"
// and the posters are made. `--force "<reason>"` releases a book that does not qualify and
// records the reason, the score and the blockers in the overrides as `releaseForced`.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { qa, summary as qaSummary } from "../qa/qa.mjs";
import { bookInfo, readOverrides } from "./lib/book.mjs";

const today = () => new Date().toISOString().slice(0, 10);

// The QA result to release on: qa.json when it is newer than the PDF, otherwise a fresh run.
export async function latestQa(book, { runQa = qa } = {}) {
  if (!book.pdf) throw new Error(`no typeset PDF for "${book.base}" — build it first (npm run typeset:docx)`);
  const qj = path.join(book.dir, "qa.json");
  const fresh = fs.existsSync(qj) && fs.statSync(qj).mtimeMs >= fs.statSync(book.pdf).mtimeMs;
  if (fresh) return { result: JSON.parse(fs.readFileSync(qj, "utf8")), ran: false };
  if (!fs.existsSync(book.docx)) throw new Error(`QA is ${fs.existsSync(qj) ? "older than the PDF" : "missing"} and the manuscript is not here to re-run it: ${book.docx}`);
  return { result: await runQa(book.docx), ran: true };
}

// Decide and record. Returns { released, reason, qa }.
export async function release(docx, { force = null, runQa, posters } = {}) {
  const book = bookInfo(docx);
  const { result, ran } = await latestQa(book, { runQa });
  if (!result.qualifies && !force) return { released: false, qa: result, ran, reason: "QA does not qualify" };
  const { path: ovPath, ov } = readOverrides(book.docx);
  ov.releasedForPrint = true;
  ov.releasedAt = today();
  if (!result.qualifies) ov.releaseForced = { reason: force, score: result.score, blockers: result.blockers || [], date: today() };
  else delete ov.releaseForced;
  fs.writeFileSync(ovPath, JSON.stringify(ov, null, 2) + "\n");
  const made = posters ? await posters(book.docx) : null;
  return { released: true, qa: result, ran, posters: made, forced: !result.qualifies };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--force");
  const force = fi >= 0 ? args[fi + 1] : null;
  if (fi >= 0 && (!force || force.startsWith("--"))) { console.error('--force needs a reason: --force "why this book goes out below the gate"'); process.exit(1); }
  const docx = args.find((a, i) => !a.startsWith("--") && !(fi >= 0 && i === fi + 1));
  if (!docx) { console.error('usage: npm run release -- "<book>.docx" [--force "reason"]'); process.exit(1); }
  const { makePosters } = await import("./poster.mjs");
  const { summary } = await import("./lib/check.mjs");
  try {
    const r = await release(path.resolve(docx), { force, posters: (d) => makePosters(d) });
    console.log(qaSummary(r.qa));
    if (!r.released) {
      console.log(`\n✗ NOT RELEASED — the latest QA does not qualify (score ${r.qa.score}, ${r.qa.blockers.length} blocker(s)). Fix it, re-run \`npm run qa\`, then release again.`);
      process.exit(1);
    }
    console.log(`\n✓ RELEASED FOR PRINT${r.forced ? ` (forced: ${force})` : ""} — recorded in the overrides`);
    console.log(summary(r.posters));
    process.exit(r.posters.qualifies ? 0 : 1);
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}
