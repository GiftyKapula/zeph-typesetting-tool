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
// Only the changed words are shaded: `words` names them (they may run over a line end);
// without it the comment's own text is used when it stands in those lines (a reviewer
// usually writes the new wording). If neither is found, or the item sets `lines: true` (a
// moved or rewritten passage), every line from `from` to `to` is shaded.
// A round that did not come from the CDC sets `label` and `copy` on the plan, e.g.
// { "label": "Author", "copy": "the author's marked copy", "items": [...] }.
import fs from 'fs';
import { createRequire } from 'module';
import { PDFDocument, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import canvasPkg from 'canvas';
const { createCanvas } = canvasPkg;
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

// the font of a PDF font ("BEUNZW+Arial-BoldMT" -> bold, "Arial"), to measure its letters
const cssFont = (pg, id) => {
  let name = '';
  try { name = pg.commonObjs.get(id).name || ''; } catch { /* not loaded */ }
  const base = name.replace(/^[A-Z]{6}\+/, '');
  const fam = base.split(/[-,]/)[0].replace(/(PS)?MT$/, '').replace(/PS$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2') || 'Arial';
  return { pre: `${/Italic|Oblique/i.test(base) ? 'italic ' : ''}${/Bold|Black|Heavy/i.test(base) ? 'bold ' : ''}`, fam };
};
const measure = createCanvas(10, 10).getContext('2d');
// x extent of every character of a text item: each letter at its real width in the item's
// font, and any stretch from justification shared out over the spaces
const charXs = (it) => {
  if (it.xs) return it.xs;
  measure.font = `${it.font.pre}${it.size}px "${it.font.fam}"`;
  const chars = [...it.s];
  const pre = [0]; let acc = '';
  for (const c of chars) { acc += c; pre.push(measure.measureText(acc).width); }
  const nat = pre[chars.length] || 1, spaces = chars.filter((c) => c === ' ').length;
  const extra = it.w - nat;
  const useSpaces = spaces > 0 && extra > 0;
  const scale = useSpaces ? 1 : it.w / nat;
  let sp = 0;
  it.xs = chars.map((c, j) => {
    const x0 = it.x + pre[j] * scale + (useSpaces ? extra * sp / spaces : 0);
    if (c === ' ') sp++;
    const x1 = it.x + pre[j + 1] * scale + (useSpaces ? extra * sp / spaces : 0);
    return [x0, c === ' ' ? x1 : Math.min(x1, x0 + (pre[j + 1] - pre[j]) * scale)];
  });
  return it.xs;
};

// every text line of every page: { p, y, x0, x1, h, text }, in reading order
const lines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const pg = await doc.getPage(p);
  const [, , , H] = pg.view;
  const its = (await pg.getTextContent()).items.filter((i) => i.str && i.str.trim());
  await pg.getOperatorList(); // loads the page's fonts, so their real names can be read
  const rows = new Map();
  for (const it of its) {
    const y = it.transform[5], key = Math.round(y / 2.5);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x: it.transform[4], w: it.width, y, h: it.height || 9, s: it.str,
      size: Math.hypot(it.transform[0], it.transform[1]), font: cssFont(pg, it.fontName) });
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

// where `phrase` sits in lines a..b (it may run on into the next lines): one span per line,
// { k, x0, x1 }. Spaces are ignored in the match (a word split across two styled runs reads
// as two pieces), but it must start and end on a word boundary. Each character's x is taken
// in proportion along its text item.
const LETTER = /[a-zÀ-ɏ]/i;
const fold = (c) => c.toLowerCase().replace(/[‘’‛`]/, "'").replace(/[“”]/, '"').replace(/[–—]/, '-');
const wordSpans = (phrase, a, b) => {
  const want = [...phrase].filter((c) => !/\s/.test(c)).map(fold).join('');
  if (want.replace(/[^a-zÀ-ɏ0-9]/gi, '').length < 3) return null;
  const cs = [];
  for (let k = a; k <= Math.min(lines.length - 1, b + 3); k++) {
    let sb = true;
    for (const it of lines[k].items) {
      const xs = charXs(it);
      [...it.s].forEach((c, j) => {
        if (/\s/.test(c)) { sb = true; return; }
        cs.push({ c: fold(c), k, x0: xs[j][0], x1: xs[j][1], sb });
        sb = false;
      });
      sb = true;
    }
  }
  const s = cs.map((x) => x.c).join('');
  for (let i = s.indexOf(want); i >= 0; i = s.indexOf(want, i + 1)) {
    const e = i + want.length;
    if (cs[i].k > b) break;
    const okL = cs[i].sb || !LETTER.test(cs[i - 1].c) || !LETTER.test(cs[i].c);
    const okR = e >= cs.length || cs[e].sb || !LETTER.test(cs[e].c) || !LETTER.test(cs[e - 1].c);
    if (!okL || !okR) continue;
    const per = new Map();
    for (const x of cs.slice(i, e)) {
      const p = per.get(x.k) || { k: x.k, x0: x.x0, x1: x.x1 };
      p.x0 = Math.min(p.x0, x.x0); p.x1 = Math.max(p.x1, x.x1); per.set(x.k, p);
    }
    return [...per.values()];
  }
  return null;
};
const warnWords = [];

const out = await PDFDocument.load(new Uint8Array(bytes));
const pages = out.getPages();
const add = (p, quads, note, title) => {
  const xs = quads.flatMap((q) => [q.x0, q.x1]), ys = quads.flatMap((q) => [q.y0, q.y1]);
  const R = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  // a real highlight annotation (what a reviewer's highlighter makes): its own appearance
  // paints the purple over the line, multiplied so the black text stays black, and it
  // prints (F 4). The page itself is not touched. Several comments can point at one line:
  // only the first paints it, so its purple stays even; the others carry their notes.
  const fresh = quads.filter((q) => !painted.has(`${p}:${q.y0.toFixed(1)}:${q.x0.toFixed(0)}`));
  for (const q of fresh) painted.add(`${p}:${q.y0.toFixed(1)}:${q.x0.toFixed(0)}`);
  const ops = fresh.length
    ? `/GS0 gs ${HL.join(' ')} rg ` + fresh.map((q) => `${q.x0.toFixed(2)} ${q.y0.toFixed(2)} ${(q.x1 - q.x0).toFixed(2)} ${(q.y1 - q.y0).toFixed(2)} re f`).join(' ')
    : '';
  const ap = out.context.stream(ops, {
    Type: 'XObject', Subtype: 'Form', BBox: R.map(PDFNumber.of),
    Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 1 } } },
  });
  const dict = out.context.obj({
    Type: 'Annot', Subtype: 'Highlight',
    Rect: R.map(PDFNumber.of),
    AP: { N: out.context.register(ap) },
    QuadPoints: out.context.obj(quads.flatMap((q) => [q.x0, q.y1, q.x1, q.y1, q.x0, q.y0, q.x1, q.y0]).map(PDFNumber.of)),
    Contents: lit(note), T: lit(title), M: PDFString.of('D:20261021000000Z'),
    C: HL.map(PDFNumber.of), CA: PDFNumber.of(1), F: PDFNumber.of(4),
  });
  const node = pages[p - 1].node;
  let annots = node.lookup(PDFName.of('Annots'));
  if (!annots) { annots = out.context.obj([]); node.set(PDFName.of('Annots'), annots); }
  annots.push(out.context.register(dict));
};
// highlighter colour: purple (the house colour for corrections, 2026-10-26)
const HL = [0.8, 0.66, 1];
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
  // shade only the changed words: `words` if the item gives them, else the comment's own text
  // when it stands in the corrected lines (a reviewer usually writes the new wording); a
  // moved or rewritten passage, or a deletion, keeps every line of it shaded
  const spans = (it.words && wordSpans(it.words, a, b)) || (it.lines ? null : wordSpans(it.comment || '', a, b));
  if (it.words && !spans) warnWords.push(`${it.n}: words "${it.words}" (whole lines shaded)`);
  const byPage = new Map();
  const put = (l, x0, x1) => {
    if (!byPage.has(l.p)) byPage.set(l.p, []);
    byPage.get(l.p).push({ x0: x0 - 1, x1: x1 + 1, y0: l.y - l.h * 0.28, y1: l.y + l.h * 0.98 });
  };
  if (spans) for (const s of spans) put(lines[s.k], s.x0, s.x1);
  else for (let k = a; k <= b; k++) put(lines[k], lines[k].x0, lines[k].x1);
  let first = true;
  for (const [p, quads] of byPage) {
    add(p, quads, first ? note : `(continued) ${note}`, plan.author || 'ZEPH');
    first = false;
  }
  ok++; report.push(`${it.n}\tsheet ${[...byPage.keys()].join(',')}\t${spans ? 'words' : `${b - a + 1} line(s)`}`);
}
fs.writeFileSync(OUT, await out.save());
console.log(report.join('\n'));
console.log(`\n${ok}/${plan.items.length} corrections highlighted -> ${OUT}`);
if (warnWords.length) console.log('WORDS NOT FOUND:\n  ' + warnWords.join('\n  '));
if (misses.length) { console.log('NOT FOUND:\n  ' + misses.join('\n  ')); process.exitCode = 1; }
