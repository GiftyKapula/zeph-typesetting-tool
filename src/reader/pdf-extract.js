// Supplementary readers and novels: read a typeset PDF (with a text layer) into a
// structured book model { meta, front, body } that to-docx.js turns into an editable
// manuscript. Nothing is invented: every word comes from the PDF; pictures are cropped
// from the page at print resolution.
//
// Steps: 1. per page: text lines (baseline groups, bold/italic runs) + pictures (ink left
// after the text is masked out); 2. book statistics (body size, margins, indent, leading);
// 3. strip page numbers and running heads; 4. split front matter (title page, imprint,
// contents, preface...) from the main text; 5. join lines into paragraphs across pages,
// classify headings, centred blocks, quotes and captions.
const fs = require("fs");
const path = require("path");

const ROMAN = /^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const isNum = (s) => /^\d{1,3}$/.test(s) || ROMAN.test(s);
const median = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const pct = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
function mode(a, step = 1) { const m = new Map(); for (const v of a) { const k = Math.round(v / step) * step; m.set(k, (m.get(k) || 0) + 1); } let best = null, n = -1; for (const [k, c] of m) if (c > n) { best = k; n = c; } return best; }
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

const { openPdf } = require("./pdf-open.js");

// ---------- 1. pages ----------
async function readPages(file, opts = {}) {

  const { createCanvas } = require("canvas");
  const doc = await openPdf(file);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    await pg.getOperatorList();
    const tc = await pg.getTextContent();
    const fontInfo = {};
    const items = [];
    for (const it of tc.items) {
      if (it.str === undefined || it.str === "") continue;
      const [a, b, c, d, e, f] = it.transform;
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue; // rotated text (spines, stamps)
      if (!fontInfo[it.fontName]) {
        let name = ""; try { name = pg.commonObjs.get(it.fontName).name || ""; } catch (_) {}
        fontInfo[it.fontName] = { name, bold: /bold|black|heavy|semibold|demi/i.test(name), italic: /italic|oblique/i.test(name) };
      }
      const fi = fontInfo[it.fontName];
      const size = Math.abs(d) || Math.hypot(c, d);
      items.push({ x: e, y: H - f, w: it.width, size, str: it.str, bold: fi.bold, italic: fi.italic, font: fi.name.replace(/^[A-Z]{6}\+/, "") });
    }
    // drop capitals: one giant letter beside the first lines of a paragraph. Taken out here and
    // put back in front of the line it stands beside.
    const sizes = items.filter((it) => it.str.trim().length > 2).map((it) => it.size).sort((a, b) => a - b);
    const typical = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11;
    const drops = [];
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      if (/^\s*[\p{Lu}\p{Ll}]{1,2}\s*$/u.test(it.str) && it.size >= typical * 2.2 && it.size < 120) { drops.push(it); items.splice(k, 1); }
    }
    // lines: group by baseline
    items.sort((p, q) => p.y - q.y || p.x - q.x);
    const lines = [];
    for (const it of items) {
      if (!it.str.trim() && !lines.length) continue;
      let L = null;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
        const c = lines[k];
        if (Math.abs(c.y - it.y) < Math.max(2, Math.min(c.size, it.size) * 0.45)) { L = c; break; }
      }
      if (!L) { L = { y: it.y, size: it.size, parts: [] }; lines.push(L); }
      L.parts.push(it);
      if (it.str.trim()) L.size = Math.max(L.size, it.size);
    }
    const outLines = [];
    for (const L of lines) {
      const parts = L.parts.filter((p) => p.str !== "").sort((p, q) => p.x - q.x);
      const runs = [];
      let text = "", lastEnd = null, lastSize = L.size;
      for (const p of parts) {
        let s = p.str;
        if (lastEnd !== null && text && !/\s$/.test(text) && !/^\s/.test(s) && p.x - lastEnd > Math.min(lastSize, p.size) * 0.14) s = " " + s;
        text += s;
        const prev = runs[runs.length - 1];
        const b = p.bold, i = p.italic;
        if (prev && (prev.b === b && prev.i === i || !s.trim())) prev.t += s; else runs.push({ t: s, b, i });
        if (p.str.trim()) { lastEnd = p.x + p.w; lastSize = p.size; }
      }
      let clean = text.replace(/_{2,}/g, " ").replace(/\s+/g, " ").trim();
      for (const r of runs) r.t = r.t.replace(/_{2,}/g, " ");
      if (!clean) continue;
      // letter-spaced display lines ("K A U H A N Y O  Y A  1") read as words again
      const toks = text.trim().split(/ +/);
      if (toks.length >= 5 && toks.filter((t) => t.length === 1).length >= toks.length * 0.75) {
        const words = text.trim().split(/ {2,}/).map((w) => w.replace(/ /g, ""));
        clean = words.join(" ");
        runs.length = 0; runs.push({ t: clean, b: parts[0].bold, i: parts[0].italic });
      }
      const ink = parts.filter((p) => p.str.trim());
      const x = Math.min(...ink.map((p) => p.x)), xe = Math.max(...ink.map((p) => p.x + p.w));
      const chars = ink.reduce((s, p) => s + p.str.trim().length, 0);
      const boldChars = ink.filter((p) => p.bold).reduce((s, p) => s + p.str.trim().length, 0);
      const italChars = ink.filter((p) => p.italic).reduce((s, p) => s + p.str.trim().length, 0);
      const fonts = {}; for (const p of ink) fonts[p.font] = (fonts[p.font] || 0) + p.str.length;
      outLines.push({ page: n, y: L.y, x, xe, size: Math.round(L.size * 10) / 10, text: clean, runs: tidyRuns(runs),
        bold: boldChars > chars * 0.6, italic: italChars > chars * 0.6, font: Object.entries(fonts).sort((p, q) => q[1] - p[1])[0][0], items: ink });
    }
    for (const dc of drops) {
      const top = dc.y - dc.size * 0.75;
      const beside = outLines.filter((L) => L.y > top - 2 && L.y < dc.y + 4 && L.x > dc.x + dc.w * 0.4).sort((a, b) => a.y - b.y);
      const L = beside[0];
      if (!L) continue;
      const letter = dc.str.trim();
      L.text = letter + L.text; L.runs[0].t = letter + L.runs[0].t; L.dropcap = true;
      for (const B of beside) B.x = Math.min(B.x, dc.x); // lines beside the capital are not indented
      L.items.push({ ...dc });
    }
    // pictures: render, mask out text, look for remaining ink
    const figs = opts.noFigures ? [] : findFigures(pg, vp, outLines, createCanvas);
    pages.push({ n, W, H, lines: outLines, figs: await figs, pg });
  }
  return { doc, pages };
}

function tidyRuns(runs) {
  const out = [];
  for (const r of runs) {
    const t = r.t.replace(/\s+/g, " ");
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev && prev.b === r.b && prev.i === r.i) prev.t += t; else out.push({ t, b: r.b, i: r.i });
  }
  if (out.length) { out[0].t = out[0].t.replace(/^\s+/, ""); out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, ""); }
  return out.filter((r) => r.t);
}

async function findFigures(pg, vp, lines, createCanvas) {
  const S = 1.5;
  const v = pg.getViewport({ scale: S });
  const cw = Math.ceil(v.width), ch = Math.ceil(v.height);
  const cv = createCanvas(cw, ch); const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch);
  await pg.render({ canvasContext: g, viewport: v }).promise;
  g.fillStyle = "#fff";
  for (const L of lines) for (const p of L.items) g.fillRect((p.x - 1) * S, (p.y - p.size * 0.9) * S, (p.w + 2) * S, p.size * 1.25 * S);
  const data = g.getImageData(0, 0, cw, ch).data;
  const C = 4; const gw = Math.ceil(cw / C), gh = Math.ceil(ch / C);
  const ink = new Uint8Array(gw * gh);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const o = (y * cw + x) * 4; const lum = 0.3 * data[o] + 0.59 * data[o + 1] + 0.11 * data[o + 2];
    if (lum < 215) ink[Math.floor(y / C) * gw + Math.floor(x / C)]++;
  }
  const on = new Uint8Array(gw * gh); for (let i = 0; i < on.length; i++) on[i] = ink[i] >= 2 ? 1 : 0;
  // dilate by D cells so the strokes of one drawing join up
  const D = 4; const dil = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (on[y * gw + x])
    for (let yy = Math.max(0, y - D); yy <= Math.min(gh - 1, y + D); yy++) for (let xx = Math.max(0, x - D); xx <= Math.min(gw - 1, x + D); xx++) dil[yy * gw + xx] = 1;
  const seen = new Uint8Array(gw * gh); const comps = [];
  for (let i = 0; i < dil.length; i++) {
    if (!dil[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cnt = 0, cells = 0;
    while (st.length) {
      const k = st.pop(); const x = k % gw, y = (k / gw) | 0;
      if (on[k]) { cnt++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      cells++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nk = ny * gw + nx; if (dil[nk] && !seen[nk]) { seen[nk] = 1; st.push(nk); }
      }
    }
    if (x1 < 0) continue;
    const pt = C / S; // points per cell
    const box = { x: x0 * pt, y: y0 * pt, xe: (x1 + 1) * pt, ye: (y1 + 1) * pt };
    const w = box.xe - box.x, h = box.ye - box.y;
    const density = cnt / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (w < 40 || h < 30) continue;                             // rules, ornaments, specks
    if (density < 0.04) continue;                               // page frames, thin boxes
    if (w > vp.width * 0.97 && h > vp.height * 0.97) continue;  // full-page tint
    comps.push(box);
  }
  // merge overlapping boxes
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < comps.length && !merged; a++) for (let b = a + 1; b < comps.length; b++) {
      const A = comps[a], B = comps[b];
      if (A.x < B.xe + 6 && B.x < A.xe + 6 && A.y < B.ye + 6 && B.y < A.ye + 6) {
        comps[a] = { x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), xe: Math.max(A.xe, B.xe), ye: Math.max(A.ye, B.ye) };
        comps.splice(b, 1); merged = true; break;
      }
    }
  }
  return comps.sort((p, q) => p.y - q.y);
}

async function cropFigure(pg, box, file, dpi = 300) {
  const { createCanvas } = require("canvas");
  const S = dpi / 72; const pad = 3;
  const v = pg.getViewport({ scale: S });
  const x = Math.max(0, (box.x - pad) * S), y = Math.max(0, (box.y - pad) * S);
  const w = Math.min(v.width - x, (box.xe - box.x + 2 * pad) * S), h = Math.min(v.height - y, (box.ye - box.y + 2 * pad) * S);
  const cv = createCanvas(Math.ceil(w), Math.ceil(h)); const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  g.translate(-x, -y);
  await pg.render({ canvasContext: g, viewport: v }).promise;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cv.toBuffer("image/png"));
  return { wpx: cv.width, hpx: cv.height };
}

// ---------- 2-5. analysis ----------
async function extractBook(file, { outDir, imgDir = "images", log = () => {} } = {}) {
  const { doc, pages } = await readPages(file);
  const all = pages.flatMap((p) => p.lines);
  const W = median(pages.map((p) => p.W)), H = median(pages.map((p) => p.H));
  // body size = size carrying most characters
  const bySize = new Map(); for (const L of all) bySize.set(L.size, (bySize.get(L.size) || 0) + L.text.length);
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const isBodySize = (L) => Math.abs(L.size - body) <= Math.max(0.6, body * 0.06);
  const bodyLines = all.filter(isBodySize);
  const bodyBold = bodyLines.filter((L) => L.bold).length > bodyLines.length * 0.5;
  // margins per page parity (books may mirror margins)
  const margin = {};
  for (const par of [0, 1]) {
    const ls = bodyLines.filter((L) => L.page % 2 === par);
    const src = ls.length > 20 ? ls : bodyLines;
    margin[par] = { left: mode(src.map((L) => L.x), 1), right: pct(src.map((L) => L.xe), 0.9) };
  }
  const M = (L) => margin[L.page % 2];
  // leading
  const gaps = [];
  for (const p of pages) { const ls = p.lines.filter(isBodySize); for (let i = 1; i < ls.length; i++) { const d = ls[i].y - ls[i - 1].y; if (d > body * 0.8 && d < body * 2.5) gaps.push(d); } }
  const leading = median(gaps) || body * 1.2;
  // paragraph indent
  const offs = bodyLines.map((L) => L.x - M(L).left).filter((d) => d > 4 && d < 60);
  const indent = offs.length > bodyLines.length * 0.03 ? mode(offs, 1) : 0;
  log(`body ${body}pt${bodyBold ? " bold" : ""}, leading ${leading.toFixed(1)}, margins ${Math.round(margin[1].left)}-${Math.round(margin[1].right)} / ${Math.round(margin[0].left)}-${Math.round(margin[0].right)}, indent ${indent}`);

  // --- page numbers: number-only lines at the top or bottom edge whose value follows the page sequence
  const cand = [];
  for (const p of pages) {
    const ls = p.lines; if (!ls.length) continue;
    for (const L of [ls[0], ls[ls.length - 1]]) if (isNum(L.text.replace(/[\s\-–—]/g, "")) && L.size <= body + 3.5 && (L.y > p.H * 0.75 || L.y < p.H * 0.16)) cand.push(L);
  }
  const offsets = cand.filter((L) => /^\d+$/.test(L.text.trim())).map((L) => L.page - Number(L.text.trim()));
  let pnOffset = offsets.length ? mode(offsets) : null;
  if (pnOffset !== null && offsets.filter((o) => o === pnOffset).length < pages.length * 0.3) pnOffset = null; // chapter numbers, not folios
  for (const L of cand) {
    const t = L.text.replace(/[\s\-–—]/g, "");
    if (/^\d+$/.test(t)) { if (pnOffset !== null && Math.abs(L.page - Number(t) - pnOffset) <= 1) L.drop = "folio"; }
    else if (ROMAN.test(t)) L.drop = "folio";
  }
  const firstMainPage = pnOffset !== null ? pnOffset + 1 : null;
  // --- running heads: the same short text at the top/bottom edge of many pages
  const edge = new Map();
  for (const p of pages) {
    const ls = p.lines.filter((L) => !L.drop); if (ls.length < 3) continue;
    for (const L of [ls[0], ls[ls.length - 1]]) { const k = norm(L.text.replace(/\d+/g, "")); if (k && k.length < 70) { if (!edge.has(k)) edge.set(k, []); edge.get(k).push(L); } }
  }
  for (const [k, ls] of edge) if (ls.length >= 4 && ls.length >= pages.length * 0.15) for (const L of ls) L.drop = "running head";

  // --- contents pages
  const leaderRe = /(\.{4,}|…{2,}|(\. ){4,}|_{4,})\s*\d*\s*$/;
  const tocTitles = [];
  let contentsTitle = "";
  for (const p of pages) {
    if (p.n > Math.max(12, pages.length * 0.15)) break;
    const ls = p.lines.filter((L) => !L.drop);
    const lead = ls.filter((L) => leaderRe.test(L.text) || /\s\d{1,3}$/.test(L.text) && L.xe > M(L).right - 15).length;
    const titled = ls.length && /^(contents|ifili mukati|linaneho|linaneo|mukoloko wa litaba|vilimo|izili moomu|zili mukati|vili mukati|ifyalimo|ifilimo|ifilimu|ifili muli|izilimo|zilimo|zilimu|litaba za mwa buka|zamkati|zili mkati|mitwe)\b/i.test(ls[0].text);
    if (lead >= 3 && lead >= ls.length * 0.4 || titled) {
      p.contents = true;
      if (titled && !contentsTitle) contentsTitle = ls[0].text.trim();
      for (const L of ls) {
        const m = L.text.replace(leaderRe, "").replace(/\s+\d{1,3}$/, "").trim();
        const t = m.replace(/^(\d+|[ivxlc]+)[.)]?\s+/i, "").trim();
        if (t && L !== ls[0]) tocTitles.push(norm(t));
      }
    }
  }
  const tocSet = new Set(tocTitles);

  // --- find where the main text starts
  let mainStart = null;
  if (firstMainPage && firstMainPage >= 1 && firstMainPage <= pages.length * 0.3) mainStart = firstMainPage;
  if (!mainStart) {
    for (const p of pages) {
      if (p.contents) continue;
      const ls = p.lines.filter((L) => !L.drop);
      const txt = ls.map((L) => L.text).join(" ");
      if (/©|isbn|first published|all rights reserved|reprinted/i.test(txt)) continue;
      const full = ls.filter((L) => isBodySize(L) && L.xe > M(L).right - 12).length;
      if (full >= 6 && p.n > 1) { mainStart = p.n; break; }
    }
  }
  if (!mainStart) mainStart = 1;
  // front-matter signals (title page, imprint, contents) push the start later; a page that
  // opens with a chapter number or chapter word between them and the folio guess pulls it earlier
  const LABEL_RE = /^(chapter|kapetulu|icipande|cibalo|ciputulo|chibalu|cipande|chiputulo|kauhanyo|kapitulo|mutwe|part)\b|^(\d{1,2}|[IVXL]{1,5})[.)]?(\s+\S.*)?$/i;
  let lastFront = 0;
  for (const p of pages) {
    if (p.n > Math.max(10, pages.length * 0.2)) break;
    const ls = p.lines.filter((L) => !L.drop);
    const txt = ls.map((L) => L.text).join(" ");
    const titleLike = ls.length && ls.length <= 8 && ls.filter((L) => Math.abs((L.x + L.xe) / 2 - p.W / 2) < 14).length >= ls.length * 0.7 && !ls.some((L) => isBodySize(L) && L.xe - L.x > (M(L).right - M(L).left) * 0.8);
    if (p.contents || /©|isbn|first published|all rights reserved/i.test(txt) || titleLike || !ls.length && p.n <= 4) lastFront = p.n;
  }
  if (mainStart <= lastFront) mainStart = lastFront + 1;
  for (const p of pages) {
    if (p.n <= lastFront || p.n >= mainStart) continue;
    const ls = p.lines.filter((L) => !L.drop);
    if (ls.length && LABEL_RE.test(ls[0].text.trim()) && ls[0].text.length < 60) { mainStart = p.n; break; }
  }
  log(`main text starts on PDF page ${mainStart}${firstMainPage === mainStart ? " (folio 1)" : ""}`);
  // poetry books: nearly every line is short
  const textW = W - 2 * margin[1].left;
  const verseBook = (margin[1].right - margin[1].left) < textW * 0.78;
  if (verseBook) log("poetry layout (short lines kept as lines)");
  // ragged-right setting: a short line does not end a paragraph
  const fullish = bodyLines.filter((L) => L.xe > M(L).right - 3).length;
  const ragged = !verseBook && fullish < bodyLines.length * 0.45;
  if (ragged) log("ragged-right text (paragraphs found by indents and gaps)");

  // ---------- front matter ----------
  const meta = { source: path.basename(file), trim: [Math.round(W / 72 * 25.4), Math.round(H / 72 * 25.4)], bodySize: body, title: "", author: "", series: [], isbn: "", contentsTitle };
  const front = [];
  let titleFound = false;
  for (const p of pages.slice(0, mainStart - 1)) {
    const ls = p.lines.filter((L) => !L.drop);
    if (!ls.length || p.contents) continue;
    const txt = ls.map((L) => L.text).join("\n");
    if (/©|isbn|first published|all rights reserved|printed (in|by)|reprinted|typeset/i.test(txt)) {
      front.push({ type: "imprint", lines: ls.map((L) => L.text) });
      const m = txt.match(/ISBN[:\s]*([0-9Xx][0-9Xx\- ]{8,20}[0-9Xx])/); if (m && !meta.isbn) meta.isbn = m[1].replace(/\s+/g, "");
      continue;
    }
    const big = Math.max(...ls.map((L) => L.size));
    const centred = ls.filter((L) => Math.abs((L.x + L.xe) / 2 - p.W / 2) < 20).length;
    if (!titleFound && (big >= body * 1.6 || centred >= ls.length * 0.7 && ls.length <= 14 && (big > body * 1.25 || ls.length <= 6))) {
      // title page: biggest line(s) = title; a name-like line = author; series lines above the title
      titleFound = true;
      const ti = ls.findIndex((L) => L.size === big);
      const titleLines = [ls[ti].text];
      for (let k = ti + 1; k < ls.length && ls[k].size >= big * 0.72 && ls[k].y - ls[k - 1].y < big * 2.6 && !/publishing|prepared|written|illustrated/i.test(ls[k].text) && !/\b\p{Lu}\.\s?\p{Lu}/u.test(ls[k].text); k++) titleLines.push(ls[k].text);
      meta.title = titleLines.join(" ").replace(/\s+/g, " ").trim();
      const sub = meta.title.match(/^(.*\S)\s*\(([^)]+)\)$/); if (sub) { meta.title = sub[1]; meta.subtitle = sub[2]; }
      meta.series = ls.slice(0, ti).map((L) => L.text).filter((t) => !/publishing|lusaka/i.test(t));
      const rest = ls.slice(ti + titleLines.length).map((L) => L.text).filter((t) => !/publishing|foundation|lusaka|neczam|longman|macmillan|press|ltd|house|curriculum|prepared|written/i.test(t) && !/^\(.*\)$/.test(t));
      meta.author = rest.find((t) => /^[\p{Lu}][\p{L}.'’ -]+$/u.test(t) && t.split(/\s+/).length <= 5 && !norm(meta.title).includes(norm(t))) || "";
      meta.publisherLines = ls.filter((L) => /publishing|foundation|lusaka|neczam|longman|macmillan/i.test(L.text)).map((L) => L.text);
      continue;
    }
    if (ls.length <= 3 && !titleFound) { // half title (title alone, maybe author)
      if (!meta.title) meta.title = ls[0].text;
      continue;
    }
    if (ls.length <= 6 && titleFound && norm(ls.map((L) => L.text).join(" ")).includes(norm(meta.title))) continue; // repeated half title
    // dedication / preface / foreword
    front.push({ type: "section", blocks: buildBlocks([p], { M, body, bodyBold, leading, indent, isBodySize, tocSet, front: true, verseBook, ragged }) });
  }
  // the half title's author, when the title page had none
  if (!meta.author) {
    for (const p of pages.slice(0, mainStart - 1)) {
      const ls = p.lines.filter((L) => !L.drop);
      if (ls.length >= 2 && ls.length <= 4 && norm(ls[0].text) === norm(meta.title)) {
        const a = ls.slice(1).map((L) => L.text).find((t) => /^[\p{Lu}][\p{L}.'’ -]+$/u.test(t) && t.split(/\s+/).length <= 5 && !/publishing|lusaka/i.test(t));
        if (a) { meta.author = a; break; }
      }
    }
  }
  // a book without a separate title page: first big line on page 1
  if (!meta.title && pages[0].lines.length) meta.title = [...pages[0].lines].sort((a, b) => b.size - a.size)[0].text;

  // ---------- main matter ----------
  const mainPages = pages.filter((p) => p.n >= mainStart && !p.contents);
  // crop pictures
  let figNo = 0;
  for (const p of mainPages) {
    // a "picture" that is only a decorative frame round a big chapter title: keep the title
    p.figs = p.figs.filter((f) => {
      const inside = p.lines.filter((L) => { const cx = (L.x + L.xe) / 2, cy = L.y - L.size * 0.3; return cx > f.x && cx < f.xe && cy > f.y && cy < f.ye; });
      const bigArea = inside.filter((L) => L.size >= body * 1.3).reduce((s, L) => s + (L.xe - L.x) * L.size, 0);
      return !(bigArea > (f.xe - f.x) * (f.ye - f.y) * 0.12);
    });
    for (const f of p.figs) {
      figNo++;
      const name = `p${String(p.n).padStart(3, "0")}-${figNo}.png`;
      if (outDir) { const r = await cropFigure(p.pg, f, path.join(outDir, imgDir, name)); f.wpx = r.wpx; f.hpx = r.hpx; }
      f.file = `${imgDir}/${name}`;
      // text inside the picture belongs to the picture
      for (const L of p.lines) { const cx = (L.x + L.xe) / 2, cy = L.y - L.size * 0.3; if (cx > f.x && cx < f.xe && cy > f.y && cy < f.ye) L.drop = "in picture"; }
    }
  }
  const bodyBlocks = buildBlocks(mainPages, { M, body, bodyBold, leading, indent, isBodySize, tocSet, verseBook, ragged });
  const h1s = bodyBlocks.filter((b) => b.t === "h1");
  meta.chapterNewPage = h1s.length ? h1s.filter((b) => b.firstOnPage).length >= h1s.length * 0.6 : true;
  meta.verse = verseBook;
  // hyphenated line ends: drop the hyphen only when the joined word is used elsewhere in the book
  const words = new Set((all.map((L) => L.text).join(" ").toLowerCase().match(/[\p{L}']+/gu)) || []);
  const fixHyph = (blocks) => { for (const b of blocks) if (b.runs) for (const r of b.runs) r.t = r.t.replace(/([\p{L}]+)-\u0001([\p{L}]+)/gu, (m, a, c) => (words.has((a + c).toLowerCase()) ? a + c : a + "-" + c)); };
  fixHyph(bodyBlocks); for (const f of front) if (f.blocks) fixHyph(f.blocks);
  // a short "heading" with nothing under it (end of a section, or just before a chapter) is a
  // signature such as "EDITOR" or "The Author": set it to the right
  const signOff = (blocks) => blocks.forEach((b, k) => {
    const nx = blocks[k + 1];
    if (b.t === "h2" && (!nx || nx.t === "h1") && b.text.split(/\s+/).length <= 4) blocks[k] = { t: "right", lines: [{ runs: [{ t: b.text, i: true }] }], page: b.page };
  });
  signOff(bodyBlocks); for (const f of front) if (f.blocks) signOff(f.blocks);
  const stats = { pages: pages.length, mainStart, body, leading, indent, figures: figNo, headings: bodyBlocks.filter((b) => b.t === "h1" || b.t === "h2").length };
  try { await doc.destroy(); } catch (_) {}
  return { meta, front, body: bodyBlocks, stats };
}

const LABEL_LINE = /^(chapter|kapetulu|icipande|cibalo|ciputulo|chibalu|cipande|chikunyi|chiputulo|kauhanyo|kapitulo|mutwe|part)\b(\s+\S+){0,3}\s*$/iu;
const NUMWORD = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";

// Join lines into blocks (paragraphs, headings, centred blocks, pictures).
function buildBlocks(pages, ctx) {
  const { M, body, bodyBold, leading, indent, isBodySize, tocSet } = ctx;
  const out = [];
  let cur = null; // current paragraph being built
  let prev = null; // previous kept line
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (const p of pages) {
    const stream = [];
    for (const L of p.lines) if (!L.drop) stream.push({ kind: "line", y: L.y - L.size * 0.8, L });
    for (const f of p.figs || []) if (f.file) stream.push({ kind: "fig", y: f.y, f });
    stream.sort((a, b) => a.y - b.y);
    let firstOnPage = true;
    let lastFig = null;
    for (const s of stream) {
      if (s.kind === "fig") {
        flush();
        lastFig = { t: "fig", file: s.f.file, wpt: s.f.xe - s.f.x, hpt: s.f.ye - s.f.y, wpx: s.f.wpx, hpx: s.f.hpx, page: p.n, top: firstOnPage, ye: s.f.ye };
        out.push(lastFig); firstOnPage = false; continue;
      }
      const L = s.L; const m = M(L);
      const width = m.right - m.left;
      const centre = (L.x + L.xe) / 2, pageCentre = (m.left + m.right) / 2;
      const atIndent = indent && Math.abs(L.x - m.left - indent) < 2.5;
      const centred = !atIndent && Math.abs(centre - pageCentre) < Math.max(6, body * 0.6) && L.x > m.left + Math.max(body * 1.2, width * 0.1) && L.xe < m.right - Math.max(body * 1.2, width * (ctx.ragged ? 0.1 : 0));
      // a short line just under a picture (centred, italic or smaller) is its caption; an
      // upper-case or chapter line there is the chapter heading under an opening picture
      if (lastFig && (centred || L.italic || L.size < body - 0.4) && L.y - lastFig.ye < L.size * 2.6 && L.text.length < 120 && out[out.length - 1] === lastFig && !LABEL_LINE.test(L.text) && !(L.text === L.text.toUpperCase() && /\p{Lu}{3}/u.test(L.text))) {
        lastFig.caption = (lastFig.caption ? lastFig.caption + " " : "") + L.text; lastFig.ye = L.y + 2; continue;
      }
      lastFig = null;
      const rightAligned = L.xe > m.right - 6 && L.x > m.left + width * 0.45;
      const big = L.size > body * 1.12 + 0.3;
      const boldHead = L.bold && !bodyBold;
      const indented = indent ? L.x - m.left > indent * 0.6 && L.x - m.left < indent * 2.5 : L.x - m.left > body * 0.8 && L.x - m.left < body * 4;
      const kind = big ? "big" : centred ? "centre" : rightAligned ? "right" : "text";
      let newBlock = true;
      if (ctx.verseBook && kind === "text") {
        // poetry: a stanza is a run of lines without a gap; every line stays a line
        const gap = cur && prev && prev.page === L.page ? L.y - prev.y : 1e9;
        newBlock = !(cur && cur.kind === "verse" && gap < leading * 1.45 && Math.abs(L.size - prev.size) <= 1 && L.bold === prev.bold);
        if (L.bold && !bodyBold && L.text.length < 70) newBlock = true;
        if (newBlock) { flush(); cur = { kind: L.bold && !bodyBold ? "text" : "verse", lines: [], page: L.page, firstOnPage, firstIndented: false, size: L.size, y0: L.y }; }
        cur.lines.push(L); prev = L; firstOnPage = false; continue;
      }
      const labelLine = L.text.length < 40 && LABEL_LINE.test(L.text.trim());
      if (cur && prev && cur.kind === kind && !labelLine && !prev.labelLine) {
        const samePage = prev.page === L.page;
        const gap = samePage ? L.y - prev.y : leading;
        const prevShort = ctx.ragged
          ? prev.xe < M(prev).right - (M(prev).right - M(prev).left) * 0.3 && /[.!?:"'’”]$/.test(prev.text)
          : prev.xe < M(prev).right - body * 1.6;
        if (kind === "text") {
          newBlock = gap > leading * 1.55 || indented || (prevShort && !(cur.lines.length === 1 && cur.firstIndented === false && false)) || Math.abs(L.size - prev.size) > 1 || (boldHead !== (prev.bold && !bodyBold) && (L.text.length < 60 || prev.text.length < 60));
          if (!samePage && !indented && !prevShort && Math.abs(L.size - prev.size) <= 1) newBlock = false;
        } else if (kind === "centre" || kind === "big") {
          newBlock = gap > leading * 1.9 || Math.abs(L.size - prev.size) > 1 || (L.bold !== prev.bold);
        } else newBlock = gap > leading * 1.55;
      }
      if (newBlock) {
        flush();
        cur = { kind, lines: [], page: L.page, firstOnPage, firstIndented: indented, size: L.size, y0: L.y, gapBefore: prev && prev.page === L.page ? L.y - prev.y : null };
      }
      cur.lines.push(L);
      L.labelLine = labelLine;
      prev = L; firstOnPage = false;
    }
  }
  flush();
  // classify
  const blocks = [];
  for (const b of out) {
    if (b.t === "fig") { blocks.push(b); continue; }
    const text = b.lines.map((L) => L.text).join(" ").replace(/\s+/g, " ").trim();
    const allBold = b.lines.every((L) => L.bold) && !bodyBold;
    const short = text.length <= 90 && b.lines.length <= 3;
    const endsSentence = /[.,;:]["'’”]?$/.test(text) && !/^\d+[.)]?$/.test(text);
    if (/^([*•·.]\s*){3,}$|^[*]{3,}$/.test(text)) { blocks.push({ t: "break" }); continue; }
    if (b.kind === "verse") { blocks.push({ t: "verse", lines: b.lines.map((L) => ({ runs: L.runs })), page: b.page, firstOnPage: b.firstOnPage }); continue; }
    const label = /^(chapter|kapetulu|icipande|cibalo|ciputulo|chibalu|cipande|chikunyi|chiputulo|kauhanyo|kapitulo|mutwe|lesson|story|part)\b.{0,12}$/i.test(text) || /^(\d{1,2}|[IVXL]{1,6})[.)]?$/.test(text);
    const inToc = tocSet.has(norm(text.replace(/^(\d+|[ivxlc]+)[.)]?\s+/i, "")));
    const headLike = short && !endsSentence && !b.lines[0].dropcap && (b.kind === "big" || allBold || (b.kind === "centre" && (text === text.toUpperCase() && /\p{Lu}/u.test(text))) || inToc);
    if (label && (b.kind === "big" || b.kind === "centre" || allBold || b.firstOnPage)) { blocks.push({ t: "label", text, size: b.size, firstOnPage: b.firstOnPage, page: b.page, y0: b.y0 }); continue; }
    if (headLike) { blocks.push({ t: "head", text, size: b.size, firstOnPage: b.firstOnPage, inToc, page: b.page, centred: b.kind === "centre", y0: b.y0, y1: b.lines[b.lines.length - 1].y, upper: text === text.toUpperCase() }); continue; }
    if (b.kind === "centre") { blocks.push({ t: "center", lines: b.lines.map((L) => ({ runs: L.runs })), page: b.page }); continue; }
    if (b.kind === "right") { blocks.push({ t: "right", lines: b.lines.map((L) => ({ runs: L.runs })), page: b.page }); continue; }
    // paragraph: join lines, keep bold/italic runs; mark line-end hyphens for the hyphen check
    const runs = [];
    b.lines.forEach((L, k) => {
      const rr = L.runs.map((r) => ({ ...r }));
      if (k < b.lines.length - 1) {
        const last = rr[rr.length - 1];
        if (/[\p{L}]-$/u.test(last.t)) last.t += "\u0001"; else last.t += " ";
      }
      for (const r of rr) { const pr = runs[runs.length - 1]; if (pr && pr.b === r.b && pr.i === r.i) pr.t += r.t; else runs.push(r); }
    });
    for (const r of runs) { r.t = r.t.replace(/\u0001 ?/g, "\u0001").replace(/ {2,}/g, " "); if (bodyBold) r.b = false; }
    blocks.push({ t: "p", runs, indent: b.firstIndented, page: b.page, dropcap: !!b.lines[0].dropcap, firstOnPage: b.firstOnPage, quote: b.lines.length > 1 && b.lines.slice(1).every((L) => L.x > M(L).left + 8 && L.xe < M(L).right - 8) });
  }
  // a heading set on two lines that came out as two headings: one heading
  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i], c = blocks[i + 1];
    const bothBig = a.size > body * 1.3 && c.size > body * 1.3;
    if (a.t === "head" && c.t === "head" && a.page === c.page && (Math.abs(a.size - c.size) < 0.5 && a.upper === c.upper || bothBig) && c.y0 - a.y1 < Math.max(leading * 1.5, a.size * 1.6) && !/[.!?:]$/.test(a.text)) {
      a.text += " " + c.text; a.y1 = c.y1; blocks.splice(i + 1, 1); i--;
    }
  }
  // bare numbers are section numbers when chapters carry a chapter word
  const wordLabels = blocks.filter((b) => b.t === "label" && /\p{L}{3,}/u.test(b.text)).length;
  if (wordLabels >= 2) for (const b of blocks) if (b.t === "label" && !/\p{L}{3,}/u.test(b.text)) { b.t = "head"; b.firstOnPage = false; b.small = true; }
  // fold: label + head -> chapter; levels
  const res = [];
  const headSizes = blocks.filter((b) => b.t === "head").map((b) => b.size);
  const maxHead = headSizes.length ? Math.max(...headSizes) : 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "label") {
      const nx = blocks[i + 1];
      if (nx && nx.t === "head" && nx.page === b.page && !nx.small) { res.push({ t: "h1", label: b.text, title: nx.text, firstOnPage: b.firstOnPage }); i++; }
      else res.push({ t: "h1", label: b.text, title: "", firstOnPage: b.firstOnPage });
      continue;
    }
    if (b.t === "head") {
      const cw = b.text.match(new RegExp(`^((?:chapter|kapetulu|kauhanyo(?: ya)?|icipande)\\s+(?:\\d+|[ivxlc]+|${NUMWORD}))[.:]?\\s+(\\S.*)$`, "i"));
      if (cw) { res.push({ t: "h1", label: cw[1], title: cw[2], firstOnPage: b.firstOnPage }); continue; }
      const m = b.text.match(/^(\d{1,2}|[IVXL]{1,6})[.)]?\s+(\S.*)$/);
      const lvl1 = !b.small && (b.firstOnPage || (b.size >= maxHead - 0.3 && b.size > body * 1.12) || (ctx.front && res.length === 0));
      if (lvl1) res.push(m ? { t: "h1", label: m[1], title: m[2], firstOnPage: b.firstOnPage } : { t: "h1", label: "", title: b.text, firstOnPage: b.firstOnPage });
      else res.push({ t: "h2", text: b.text });
      continue;
    }
    res.push(b);
  }
  // "7. MUOLI NI BUFUMU" set as a smaller heading but numbered straight after chapter 6: a chapter
  let lastNo = 0;
  for (const b of res) {
    if (b.t === "h1" && /^\d+$/.test(b.label)) lastNo = Number(b.label);
    else if (b.t === "h2" && lastNo) {
      const m = b.text.match(/^(\d{1,2})[.)]\s*(\S.*)$/);
      if (m && Number(m[1]) === lastNo + 1) { b.t = "h1"; b.label = m[1]; b.title = m[2]; delete b.text; lastNo++; }
    }
  }
  // an opening picture at the top of a page that is followed by the chapter heading goes after it
  for (let i = 0; i + 1 < res.length; i++) if (res[i].t === "fig" && res[i].top && res[i + 1].t === "h1") { const f = res[i]; res[i] = res[i + 1]; res[i + 1] = f; i++; }
  // a paragraph cut in two by a picture (text continues after it, not indented, no sentence
  // end before it) is joined again and the picture follows the paragraph
  for (let i = 0; i < res.length; i++) {
    if (res[i].t !== "p") continue;
    let j = i + 1; while (j < res.length && res[j].t === "fig") j++;
    if (j === i + 1 || j >= res.length || res[j].t !== "p" || res[j].indent) continue;
    const a = res[i], b = res[j];
    const tail = a.runs.map((r) => r.t).join("").trim();
    const head = b.runs.map((r) => r.t).join("").trim();
    if (/[.!?]["'’”)]?$/.test(tail) && !/^\p{Ll}/u.test(head)) continue;
    const figs = res.slice(i + 1, j);
    a.runs[a.runs.length - 1].t += /-$/.test(tail) ? "\u0001" : " ";
    for (const r of b.runs) { const pr = a.runs[a.runs.length - 1]; if (pr.b === r.b && pr.i === r.i) pr.t += r.t; else a.runs.push(r); }
    res.splice(i + 1, j - i, ...figs);
  }
  // no chapter headings, but chapters open with a drop capital: an untitled chapter break there
  if (!res.some((b) => b.t === "h1" || b.t === "h2")) {
    for (let i = res.length - 1; i >= 0; i--) if (res[i].t === "p" && res[i].dropcap) res.splice(i, 0, { t: "h1", label: "", title: "", firstOnPage: !!res[i].firstOnPage });
  }
  // no h1 at all but h2s: the h2s are the chapters
  if (!res.some((b) => b.t === "h1") && res.some((b) => b.t === "h2")) for (const b of res) if (b.t === "h2") { b.t = "h1"; b.label = ""; b.title = b.text; delete b.text; }
  return res;
}

module.exports = { extractBook, readPages };
