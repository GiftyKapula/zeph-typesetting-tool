// CDC verification copy: highlight, in the corrected book, every place a CDC comment
// was attended to, with a note saying which comment it answers and what was done, so
// the CDC reviewers can check each one quickly. The print copy is not touched.
//
//   node tools/cdc-verify.mjs <book.pdf> <plan.json> <out.pdf>
//
// plan.json: { "items": [ { "n": 8, "page": 56, "comment": "REPLACE ENTIRE EXERCISE…",
//   "done": "Replaced Exercise 1 …", "from": "How many sides does a pentagon",
//   "to": "Draw and label one example", "after": "…", "extra": 0 } ] }
// `from` alone highlights the line holding that phrase; with `to`, every line from the `from` line through
// the `to` line (across pages) is highlighted; `extra` adds that many lines after `to`.
// `after`: start looking only past this phrase. The search starts at the first body page
// ("~ 1 ~"), so the contents page never catches an anchor (`front: true` searches from the
// first page instead, for a correction in the front matter). `onPage`: start looking at the top
// of that PDF page (sheet number, 1 = first page of the file), for a phrase that repeats through
// the book. Phrases are case-insensitive, single-line, and dashes/quotes/spaces are normalised.
// A round that did not come from the CDC sets `label` and `copy` on the plan, e.g.
// { "label": "Author", "copy": "the author's marked copy", "items": [...] }.
import fs from 'fs';
import { createRequire } from 'module';
import { PDFDocument, PDFName, PDFString, PDFNumber, rgb, BlendMode } from 'pdf-lib';
const require = createRequire(import.meta.url);
const pdfjs = await import('file:///' + require.resolve('pdfjs-dist/legacy/build/pdf.mjs').replace(/\\/g, '/'));

const [SRC, PLAN, OUT] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const bytes = fs.readFileSync(SRC);
const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;

// pdf-lib writes Latin-1: keep notes ASCII
const ascii = (s) => s.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/[•●]/g, '-').replace(/…/g, '...').replace(/[ ]/g, ' ').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
// a PDF literal string: backslash and brackets must be escaped (a note quoting an ASCII drawing)
const lit = (s) => PDFString.of(ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'));
const norm = (s) => ascii(s).toLowerCase().replace(/\s+/g, ' ').trim();

// every text line of every page: { p, y, x0, x1, h, text }, in reading order
const lines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const pg = await doc.getPage(p);
  const [, , , H] = pg.view;
  const its = (await pg.getTextContent()).items.filter((i) => i.str && i.str.trim());
  const rows = new Map();
  for (const it of its) {
    const y = it.transform[5], key = Math.round(y / 2.5);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x: it.transform[4], w: it.width, y, h: it.height || 9, s: it.str });
  }
  [...rows.values()].map((r) => r.sort((a, b) => a.x - b.x))
    .sort((a, b) => b[0].y - a[0].y)
    .forEach((r) => {
      const y = Math.min(...r.map((i) => i.y));
      // page furniture (running head, page number) is never part of a correction
      if (y > H * 0.93 || y < H * 0.05) return;
      lines.push({ p, y, x0: Math.min(...r.map((i) => i.x)), x1: Math.max(...r.map((i) => i.x + i.w)),
        h: Math.max(...r.map((i) => i.h)), text: r.map((i) => i.s).join(' '), items: r });
    });
}
// the search starts on the first body page (its footer reads "~ 1 ~")
let start = 0;
{
  for (let p = 1; p <= doc.numPages; p++) {
    const t = (await (await doc.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ');
    if (/~\s*1\s*~/.test(t)) { start = lines.findIndex((l) => l.p === p); break; }
  }
}
const pageStart = (p) => lines.findIndex((l) => l.p >= p);
const find = (phrase, from) => { const t = norm(phrase); for (let i = from; i < lines.length; i++) if (norm(lines[i].text).includes(t)) return i; return -1; };

const out = await PDFDocument.load(new Uint8Array(bytes));
const pages = out.getPages();
const add = (p, quads, note, title) => {
  const xs = quads.flatMap((q) => [q.x0, q.x1]), ys = quads.flatMap((q) => [q.y0, q.y1]);
  const R = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  // the green itself is painted on the page (below); the annotation carries the note and
  // draws nothing, so a viewer that shows annotations does not paint the line twice
  const ap = out.context.stream('', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, R[2] - R[0], R[3] - R[1]],
    Matrix: [1, 0, 0, 1, R[0], R[1]],
  });
  const dict = out.context.obj({
    Type: 'Annot', Subtype: 'Highlight',
    Rect: R.map(PDFNumber.of),
    AP: { N: out.context.register(ap) },
    QuadPoints: out.context.obj(quads.flatMap((q) => [q.x0, q.y1, q.x1, q.y1, q.x0, q.y0, q.x1, q.y0]).map(PDFNumber.of)),
    Contents: lit(note), T: lit(title), M: PDFString.of('D:20261021000000Z'),
    C: [0.62, 0.92, 0.58].map(PDFNumber.of), CA: PDFNumber.of(1), F: PDFNumber.of(4),
  });
  const node = pages[p - 1].node;
  let annots = node.lookup(PDFName.of('Annots'));
  if (!annots) { annots = out.context.obj([]); node.set(PDFName.of('Annots'), annots); }
  annots.push(out.context.register(dict));
  // and painted on the page itself (multiplied, so the text stays black): a viewer that
  // ignores annotations still shows every corrected line
  // several comments can point at one line: paint it once, so its green stays even
  for (const q of quads) {
    const key = `${p}:${q.y0.toFixed(1)}`;
    if (painted.has(key)) continue;
    painted.add(key);
    pages[p - 1].drawRectangle({ x: q.x0, y: q.y0, width: q.x1 - q.x0, height: q.y1 - q.y0, color: rgb(0.62, 0.92, 0.58), blendMode: BlendMode.Multiply });
  }
};
const painted = new Set();

let ok = 0; const misses = []; const report = [];
for (const it of plan.items) {
  const from0 = it.onPage ? pageStart(it.onPage) : it.front ? 0 : start;
  const base = it.after ? find(it.after, from0) : from0;
  if (base < 0) { misses.push(`${it.n}: after "${it.after}"`); continue; }
  const a = find(it.from, base);
  if (a < 0) { misses.push(`${it.n}: from "${it.from}"`); continue; }
  let b = a;
  if (it.to) { b = find(it.to, a); if (b < 0) { misses.push(`${it.n}: to "${it.to}"`); continue; } }
  b = Math.min(lines.length - 1, b + (it.extra || 0));
  const note = `${plan.label || 'CDC'} comment ${it.n} (page ${it.page} of ${plan.copy || 'the CDC copy'}): ${it.comment}\n\nDone: ${it.done}`;
  // one highlight per page, one quad per line
  const byPage = new Map();
  for (let k = a; k <= b; k++) {
    const l = lines[k];
    const bx = { x0: l.x0, x1: l.x1 };
    if (!byPage.has(l.p)) byPage.set(l.p, []);
    byPage.get(l.p).push({ x0: bx.x0 - 1, x1: bx.x1 + 1, y0: l.y - l.h * 0.28, y1: l.y + l.h * 0.98 });
  }
  let first = true;
  for (const [p, quads] of byPage) {
    add(p, quads, first ? note : `(continued) ${note}`, plan.author || 'ZEPH');
    first = false;
  }
  ok++; report.push(`${it.n}\tsheet ${[...byPage.keys()].join(',')}\t${b - a + 1} line(s)`);
}
fs.writeFileSync(OUT, await out.save());
console.log(report.join('\n'));
console.log(`\n${ok}/${plan.items.length} corrections highlighted -> ${OUT}`);
if (misses.length) { console.log('NOT FOUND:\n  ' + misses.join('\n  ')); process.exitCode = 1; }
