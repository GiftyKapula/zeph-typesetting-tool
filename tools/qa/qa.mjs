#!/usr/bin/env node
// Book QA gate — checks a TYPESET book against its manuscript and the house rules, and
// scores it. Run after a build:
//
//   node tools/qa/qa.mjs "<book>.docx" [--json]
//
// Results are split four ways:
//   BLOCKERS  — any one fails the gate: overlapping text, text outside the page's safe
//               area, placeholder text left in ("INSERT ANSWERS"), house-rule breaks
//               (TG not black & white, missing spine on a >112-page book…).
//   FIDELITY  — % of the manuscript's words that reach the PDF (multiset match, case-
//               insensitive, hyphenation undone). Words the book's overrides deliberately
//               change or drop (remove / phraseFix / imprint …) and `qaIgnore` words are
//               counted as explained.
//   LAYOUT    — % of body pages with no layout defect (overlap, out of margin, a heading
//               or label stranded at the foot of a page, a big unexplained empty space).
//   WARNINGS  — listed for a human, not scored: list numbering that jumps (1,2,3,5),
//               sub-topic numbers that skip or repeat, override entries that matched
//               nothing in the build log, fewer pictures placed than the manuscript has.
//
// SCORE = min(FIDELITY, LAYOUT). The book QUALIFIES when SCORE >= 99 and there are no
// blockers. A report is written next to the PDF as qa.json.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
const JSZip = require("jszip");

const MM = 72 / 25.4;
const SAFE = 9 * MM;                  // nothing may print within 9 mm of the trimmed edge
const OUT = process.env.ZEPH_OUTPUT_DIR ? path.resolve(process.env.ZEPH_OUTPUT_DIR) : path.join(ROOT, "output");

const words = (s) => (s.toLowerCase().match(/[\p{L}\p{M}'’]+/gu) || []).map((w) => w.replace(/['’]/g, "")).filter((w) => w.length >= 2);
const bag = (arr) => { const m = new Map(); for (const w of arr) m.set(w, (m.get(w) || 0) + 1); return m; };

export function findBookDir(docx) {
  const base = path.basename(docx, ".docx");
  const hits = [];
  const walk = (d, depth) => {
    if (depth > 3 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (e.name === base && fs.existsSync(path.join(p, "_source.typ"))) hits.push(p);
      else walk(p, depth + 1);
    }
  };
  walk(OUT, 0);
  hits.sort((a, b) => fs.statSync(path.join(b, "_source.typ")).mtimeMs - fs.statSync(path.join(a, "_source.typ")).mtimeMs);
  return hits[0] || null;
}

// ---- manuscript -----------------------------------------------------------
async function manuscript(docx) {
  const zip = await JSZip.loadAsync(fs.readFileSync(docx));
  let xml = await zip.file("word/document.xml").async("string");
  xml = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const paras = xml.split(/<\/w:p>/);
  const text = [];
  for (const p of paras) {
    // the author's own contents list (the book prints its own): TOC-styled lines, and any
    // line that links into the contents field
    if (/<w:pStyle w:val="(TOC\d|TOCHeading)"/.test(p) || /w:anchor="_Toc|PAGEREF/.test(p)) continue;
    const t = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    // a contents line typed by hand ("Kutachika Kudiza Kutaṅa………… 12") — dropped on purpose
    if (/[.…]{5,}\s*[0-9ivxlc]*\s*$/i.test(t.trim()) && t.trim().length < 120) continue;
    // …or with a tab before its page number ("Umutwe: Amashina[tab]9")
    if (/<w:tab\/>(?:(?!<w:tab\/>)[\s\S])*<w:t(?:\s[^>]*)?>\s*[0-9ivxlc]{1,4}\s*<\/w:t>(?:(?!<w:t[ >])[\s\S])*$/i.test(p) && t.trim().length < 120) continue;
    if (t.trim()) text.push(t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  const blips = new Set([...xml.matchAll(/<a:blip r:embed="([^"]+)"/g)].map((m) => m[1]));
  return { text, images: blips.size };
}

// ---- typeset PDF ----------------------------------------------------------
async function readPdf(pdfPath) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= d.numPages; i++) {
    const p = await d.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    const items = tc.items.filter((x) => x.str && x.str.trim()).map((x) => ({
      s: x.str, x0: x.transform[4], x1: x.transform[4] + x.width, y: x.transform[5], h: Math.abs(x.transform[3]) || 10,
    }));
    const ops = await p.getOperatorList();
    let imgs = 0, imgBottom = Infinity;
    // follow the drawing transform so each picture's position is known (its lowest edge
    // tells whether a heading is really the last thing on the page)
    const stack = []; let ctm = [1, 0, 0, 1, 0, 0];
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      if (fn === pdfjs.OPS.save) { stack.push(ctm); continue; }
      if (fn === pdfjs.OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
      if (fn === pdfjs.OPS.transform) { ctm = mul(ctm, ops.argsArray[k]); continue; }
      if (fn !== pdfjs.OPS.paintImageXObject) continue;
      imgBottom = Math.min(imgBottom, ctm[5], ctm[5] + ctm[3]);
      // (a picture used on several pages lives in the shared store "g_…"; never wait forever)
      const id = ops.argsArray[k][0];
      const store = String(id).startsWith("g_") ? p.commonObjs : p.objs;
      try {
        const o = await Promise.race([new Promise((r) => store.get(id, r)), new Promise((r) => setTimeout(() => r(null), 1500))]);
        if (!o || (o.width >= 150 && o.height >= 150)) imgs++;
      } catch { imgs++; }
    }
    const all = items.map((x) => x.s).join(" ");
    pages.push({ i, W: vp.width, H: vp.height, items, imgs, imgBottom, pn: (all.match(/~\s*([0-9ivxlc]+)\s*~/i) || [])[1] || null });
  }
  return pages;
}

// lines of a page, top to bottom (items sharing a baseline)
function lines(pg) {
  const L = [];
  for (const it of [...pg.items].sort((a, b) => b.y - a.y || a.x0 - b.x0)) {
    const l = L.find((q) => Math.abs(q.y - it.y) < Math.min(q.h, it.h) * 0.5);
    if (l) { l.items.push(it); l.text += " " + it.s; } else L.push({ y: it.y, h: it.h, items: [it], text: it.s });
  }
  return L;
}

function pdfText(pages) {
  let out = "";
  for (const pg of pages) for (const l of lines(pg)) {
    const t = l.items.sort((a, b) => a.x0 - b.x0).map((x) => x.s).join(" ");
    out = /[\p{L}]-$/u.test(out) ? out.slice(0, -1) + t : out + " " + t;   // undo end-of-line hyphenation
  }
  return out;
}

// ---- headings / lists from the Typst source -------------------------------
function typInfo(typ) {
  const heads = [];
  for (const m of typ.matchAll(/^#(sectionhead|subhead|head|lbl|termpage)\("((?:[^"\\]|\\.)*)"/gm)) heads.push({ kind: m[1], text: m[2].replace(/\\(.)/g, "$1") });
  const listWarn = [];
  let run = null;
  const val = (mk) => {
    const s = mk.replace(/[().\s]/g, "");
    if (/^\d+$/.test(s)) return { kind: "n", v: +s };
    if (/^[ivxl]+$/i.test(s) && s.length > 1) return { kind: "r", v: roman(s) };
    if (/^[a-z]$/i.test(s)) return { kind: "a", v: s.toLowerCase().charCodeAt(0) - 96 };
    if (/^[ivx]$/i.test(s)) return { kind: "ar", v: s.toLowerCase().charCodeAt(0) - 96, rv: roman(s) };
    return null;
  };
  const lines = typ.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#listitem\(.*, "([^"]{1,8})", lvl: (\d)/);
    if (!m) { if (!/^#listitem/.test(lines[i]) && lines[i].trim()) run = null; continue; }
    const v = val(m[1]); const lvl = +m[2];
    if (!v) continue;
    if (run && run.lvl === lvl && run.kind[0] === v.kind[0] || (run && run.lvl === lvl && (run.kind === "r" || run.kind === "ar") && v.kind === "ar")) {
      const prev = run.v, cur = run.kind === "r" || (run.kind === "ar" && run.rom) ? (v.rv || v.v) : v.v;
      if (cur !== prev + 1 && !(cur === 1)) listWarn.push(`list jumps ${run.mk} → ${m[1]} (near "${(lines[i].match(/t: "([^"]{0,40})/) || [])[1] || ""}")`);
      run = { lvl, kind: run.kind, v: cur, mk: m[1], rom: run.rom };
    } else run = { lvl, kind: v.kind, v: v.v, mk: m[1], rom: false };
  }
  const numWarn = [];
  let last = null;
  for (const h of heads.filter((h) => h.kind === "subhead" || h.kind === "sectionhead")) {
    const m = h.text.match(/\b(\d+(?:\.\d+)+)\b/);
    if (!m) continue;
    const n = m[1].split(".").map(Number);
    if (last && last.length === n.length && last.slice(0, -1).join(".") === n.slice(0, -1).join(".")) {
      const d = n[n.length - 1] - last[last.length - 1];
      if (d === 0) numWarn.push(`sub-topic ${m[1]} repeats`);
      else if (d > 1) numWarn.push(`sub-topic numbers skip ${last.join(".")} → ${m[1]}`);
    }
    last = n;
  }
  return { heads, listWarn, numWarn };
}
function roman(s) { const R = { i: 1, v: 5, x: 10, l: 50 }; let t = 0; s = s.toLowerCase(); for (let i = 0; i < s.length; i++) { const a = R[s[i]], b = R[s[i + 1]] || 0; t += a < b ? -a : a; } return t; }

// ---- the gate --------------------------------------------------------------
export async function qa(docx, opts = {}) {
  const dir = opts.bookDir || findBookDir(docx);
  if (!dir) return { book: path.basename(docx, ".docx"), error: "no build found (run the typesetter first)" };
  const pdfPath = fs.readdirSync(dir).filter((f) => /- typeset\.pdf$/.test(f)).map((f) => path.join(dir, f))[0];
  const typ = fs.readFileSync(path.join(dir, "_source.typ"), "utf8");
  const ovPath = docx.replace(/\.docx$/i, ".overrides.json");
  let ov = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, "utf8").replace(/^﻿/, "")) : {};
  for (const name of [].concat(ov.preset || [])) {
    const pp = path.join(ROOT, "src", "typeset", "presets", `${name}.json`);
    if (fs.existsSync(pp)) ov = { ...JSON.parse(fs.readFileSync(pp, "utf8")), ...ov };
  }
  const log = fs.existsSync(path.join(dir, "build.log")) ? fs.readFileSync(path.join(dir, "build.log"), "utf8") : "";
  const isTG = /\b(TG|teacher'?s?\s*guide)\b/i.test(path.basename(docx));

  const ms = await manuscript(docx);
  const pages = await readPdf(pdfPath);
  const info = typInfo(typ);
  const blockers = [], warnings = [];
  const pageDefects = new Map();
  const flag = (pg, what) => { const k = pg.pn || `sheet ${pg.i}`; if (!pageDefects.has(k)) pageDefects.set(k, []); pageDefects.get(k).push(what); };

  const body = pages.filter((p) => !(p.W > p.H * 1.2));            // drop the cover spread
  const headTexts = new Set(info.heads.map((h) => h.text.replace(/\s+/g, " ").trim().toLowerCase()));

  for (const pg of body) {
    const it = pg.items;
    // placeholder left in (the running footer's page number — "~ xxx ~" — is not one)
    const txt = it.map((x) => x.s).join(" ").replace(/~\s*[0-9ivxlc]+\s*~/gi, " ");
    const ph = txt.match(/\b(INSERT\s+(A\s+)?(PICTURE|PICTUERE|ANSWERS?|IMAGE|PHOTO|TABLE|DIAGRAM|TEXT)|PUT\s+A\s+[A-Z ]*PICTURE|PICTURE\s+HERE|TO\s?DO|XXX+|lorem ipsum)\b/i);
    if (ph) blockers.push(`p${pg.pn || `sheet ${pg.i}`}: placeholder "${ph[0]}"`);
    // pages without a page number (cover, title page, blank verso) are designed pages,
    // not text flow — the layout checks below are for the numbered pages
    if (!pg.pn) continue;
    // overlap
    for (let a = 0; a < it.length; a++) for (let b = a + 1; b < it.length; b++) {
      const A = it[a], B = it[b];
      if (Math.abs(A.y - B.y) > Math.min(A.h, B.h) * 0.5) continue;
      if (Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 2 && A.s.trim().length > 1 && B.s.trim().length > 1) { flag(pg, `overlap "${A.s.slice(0, 20)}" / "${B.s.slice(0, 20)}"`); a = it.length; break; }
    }
    // outside the safe area
    const out = it.find((x) => x.x0 < SAFE - 1 || x.x1 > pg.W - SAFE + 1 || x.y < SAFE * 0.6 || x.y > pg.H - SAFE * 0.6);
    if (out) flag(pg, `text outside margin "${out.s.slice(0, 25)}"`);
    // stranded heading / label at the foot of the page
    const L = lines(pg).filter((l) => !/^~\s*[0-9ivxlc]+\s*~$/i.test(l.text.trim()));
    const lastLine = L.length ? L.reduce((m, l) => (l.y < m.y ? l : m)) : null;
    // does the NEXT page open a new section (unit, topic, term page, front-matter section)?
    // Then this page legitimately ends early, and its last line (a foreword's signature
    // "ZAMBIA EDUCATIONAL PUBLISHING HOUSE") ends a section rather than being stranded.
    const nxt = body[body.indexOf(pg) + 1];
    const nxtTop = nxt ? lines(nxt).find((l) => !/secondary education|early childhood|teacher'?s guide|learner'?s book|^~/i.test(l.text)) : null;
    // (an unnumbered next page — a term page, blank verso or the back cover — is a break too)
    const opensSection = (!!nxt && !nxt.pn) || !!nxtTop && info.heads.some((h) => /^(sectionhead|subhead|termpage)$/.test(h.kind) && h.text.toLowerCase().startsWith(nxtTop.text.trim().toLowerCase().slice(0, 15)));
    if (lastLine && L.length > 3 && !(pg.imgBottom < lastLine.y - 5) && !opensSection) {   // (a picture below it means it is not the last thing)
      const t = lastLine.text.replace(/\s+/g, " ").trim().toLowerCase();
      if (t.length >= 4 && [...headTexts].some((h) => h === t || (h.startsWith(t) && t.length > 12))) flag(pg, `heading/label stranded at page foot "${lastLine.text.trim().slice(0, 30)}"`);
    }
    // big unexplained empty space: body ends above 55% of the page, and the next page
    // does not open a new unit/topic (a section break legitimately ends a page early)
    if (lastLine && nxt) {
      const usedFrac = (pg.H - Math.min(lastLine.y, pg.imgBottom)) / pg.H;
      if (usedFrac < 0.55 && pg.imgs === 0 && !opensSection && nxt.imgs === 0) flag(pg, `large empty space (page ${Math.round(usedFrac * 100)}% used)`);
    }
  }
  for (const [k, v] of pageDefects) if (v.some((d) => /^overlap|^text outside/.test(d))) blockers.push(`p${k}: ${v.find((d) => /^overlap|^text outside/.test(d))}`);

  // fidelity: manuscript words that reach the page
  // the book's spelling rule (Cinyanja "ch"→"c", "r"→"l") respells the manuscript on
  // purpose — expect the respelt words, exactly as the engine makes them
  let msText = ms.text.join(" ");
  if (ov.spelling && ov.spelling.rules) {
    const keep = new Set((ov.spelling.keep || []).map((w) => w.toLowerCase()));
    const rules = Object.entries(ov.spelling.rules);
    msText = msText.replace(/[A-Za-z’']+/g, (w) => {
      if (keep.has(w.toLowerCase().replace(/[’']/g, "'"))) return w;
      for (const [from, to] of rules) w = w.replace(from.length > 1 ? new RegExp(`(?<![nNtT])${from}`, "gi") : new RegExp(from, "gi"), to);
      return w;
    });
  }
  const expect = bag(words(msText));
  const got = bag(words(pdfText(pages)));
  const explained = new Set();
  const collect = (o) => { if (typeof o === "string") words(o).forEach((w) => explained.add(w)); else if (Array.isArray(o)) o.forEach(collect); else if (o && typeof o === "object") Object.entries(o).forEach(([k, v]) => { if (!/^(imprint|coverWords|authors)$/.test(k)) collect(v); }); };
  collect({ remove: ov.remove, deleteExact: ov.deleteExact, phraseFix: (ov.phraseFix || []).map((p) => p[0]), sourceFix: (ov.sourceFix || []).map((p) => p[0]), setHeading: (ov.setHeading || []).map((s) => s.find), qaIgnore: ov.qaIgnore, removeRange: ov.removeRange, deleteRun: ov.deleteRun });
  let total = 0, hit = 0, expl = 0;
  const missing = [];
  // front matter the engine rebuilds itself (cover page, imprint) is not counted: the
  // manuscript's own first lines up to the copyright/rights block
  const frontEnd = ms.text.findIndex((t) => /©|copyright|isbn/i.test(t));
  const frontBag = bag(words(ms.text.slice(0, frontEnd >= 0 ? Math.min(frontEnd + 12, 40) : 0).join(" ")));
  for (const [w, n] of expect) {
    const f = Math.min(frontBag.get(w) || 0, n);
    const need = n - f;
    if (need <= 0) continue;
    total += need;
    const g = Math.min(got.get(w) || 0, need);
    hit += g;
    if (g < need) { if (explained.has(w)) expl += need - g; else missing.push([w, need - g]); }
  }
  const fidelity = total ? (100 * (hit + expl)) / total : 100;

  // layout
  const numbered = body.filter((p) => p.pn);
  const clean = numbered.filter((p) => !pageDefects.has(p.pn)).length;
  const layout = numbered.length ? (100 * clean) / numbered.length : 100;

  // page furniture: a designed cover + title page, and page numbers on the body pages (a
  // book whose front matter was not recognised comes out bare — no cover, no running
  // header or numbers — yet every word is present, so fidelity alone can't see it)
  if (!/^#cover\(/m.test(typ)) blockers.push("no designed cover (the front matter / copyright page was not recognised)");
  if (!/^#titlepage\(/m.test(typ)) blockers.push("no title page");
  const firstNum = body.findIndex((p) => p.pn);
  const unnumbered = firstNum < 0 ? body.length : body.slice(firstNum).filter((p) => !p.pn).length;
  if (firstNum < 0 || unnumbered > 0.15 * (body.length - firstNum)) blockers.push(`page numbers missing on ${unnumbered} of ${body.length - Math.max(firstNum, 0)} body pages`);

  // the body must switch to arabic page numbers at the first unit: a book numbered in
  // roman to the end had its units/terms not recognised (everything taken as front matter)
  const nums = body.filter((p) => p.pn);
  const romanN = nums.filter((p) => /^[ivxlc]+$/i.test(p.pn)).length;
  if (nums.length > 20 && romanN > 0.6 * nums.length) blockers.push(`body numbered in roman (${romanN} of ${nums.length} pages) — the units / terms were not recognised`);

  // house rules
  const cover = pages[0];
  const pagesTotal = pages.length;
  if (isTG && ov.blackWhite === false) blockers.push("house rule: Teacher's Guide must be black & white inside (blackWhite)");
  if (ov.boxStripe !== false) blockers.push('house rule: "boxStripe": false is missing');
  if (!ov.coversInBook) warnings.push("covers are not page 1 of the book (coversInBook)");
  if (ov.coversInBook && cover && pagesTotal > 112 && !(cover.W > 2.05 * (body[0] || cover).W)) blockers.push("house rule: over 112 pages but the cover has no spine");

  // warnings
  info.listWarn.slice(0, 30).forEach((w) => warnings.push(w));
  if (info.listWarn.length > 30) warnings.push(`… ${info.listWarn.length - 30} more list-numbering jumps`);
  info.numWarn.forEach((w) => warnings.push(w));
  for (const m of log.matchAll(/^!\s+(.*)$/gm)) warnings.push(`build: ${m[1].slice(0, 140)}`);
  const placed = body.reduce((s, p) => s + p.imgs, 0);
  if (placed < ms.images - 2) warnings.push(`pictures: manuscript has ${ms.images}, ${placed} placed (check for dropped pictures)`);

  const score = Math.min(fidelity, layout);
  const res = {
    book: path.basename(docx, ".docx"), dir, pages: pagesTotal,
    score: +score.toFixed(2), fidelity: +fidelity.toFixed(2), layout: +layout.toFixed(2),
    qualifies: score >= 99 && blockers.length === 0,
    blockers, warnings,
    pageDefects: Object.fromEntries(pageDefects),
    missingWords: missing.sort((a, b) => b[1] - a[1]).slice(0, 40),
    images: { manuscript: ms.images, placed },
  };
  fs.writeFileSync(path.join(dir, "qa.json"), JSON.stringify(res, null, 2));
  return res;
}

export function summary(r) {
  if (r.error) return `✗ ${r.book}: ${r.error}`;
  const L = [];
  L.push(`${r.qualifies ? "✓ QUALIFIES" : "✗ NOT YET"}  ${r.book}  — score ${r.score} (fidelity ${r.fidelity}, layout ${r.layout}), ${r.pages} pp`);
  r.blockers.slice(0, 12).forEach((b) => L.push(`   BLOCKER  ${b}`));
  const pd = Object.entries(r.pageDefects);
  if (pd.length) L.push(`   page defects (${pd.length}): ` + pd.slice(0, 8).map(([k, v]) => `p${k} ${v[0]}`).join("; "));
  if (r.missingWords.length) L.push(`   missing words: ` + r.missingWords.slice(0, 12).map(([w, n]) => `${w}×${n}`).join(", "));
  r.warnings.slice(0, 10).forEach((w) => L.push(`   warn  ${w}`));
  if (r.warnings.length > 10) L.push(`   … ${r.warnings.length - 10} more warnings (qa.json)`);
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  for (const a of args.filter((x) => !x.startsWith("--"))) {
    const r = await qa(path.resolve(a));
    console.log(json ? JSON.stringify(r, null, 2) : summary(r));
  }
}
