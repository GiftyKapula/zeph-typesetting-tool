// CDC comments out of a reviewed PDF: each comment's page, the text it highlights and
// the reviewer's note, as JSON — the list a retypeset book's corrections are made from.
//
//   node tools/cdc-comments.mjs <reviewed.pdf> <comments.json> [--print]
//
// Works for highlight + pop-up notes (Word/Acrobat), FreeText boxes (CorelDRAW PDFs)
// and sticky notes. `hl` is the highlighted text (empty for a sticky note or FreeText).
// --print also lists them: "p56 [highlighted text] => note".
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfjs = await import('file:///' + require.resolve('pdfjs-dist/legacy/build/pdf.mjs').replace(/\\/g, '/'));

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) { console.log('usage: node tools/cdc-comments.mjs <reviewed.pdf> <comments.json> [--print]'); process.exit(1); }
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(SRC)), verbosity: 0 }).promise;
const out = [];
for (let p = 1; p <= doc.numPages; p++) {
  const pg = await doc.getPage(p);
  const items = (await pg.getTextContent()).items.filter((i) => i.str);
  for (const a of await pg.getAnnotations()) {
    if (['Link', 'Widget', 'Popup'].includes(a.subtype)) continue;
    // quad points come as [[{x,y} ×4], …] (one quad per highlighted line) or a flat list
    const q = a.quadPoints
      ? (Array.isArray(a.quadPoints[0]) ? a.quadPoints.flatMap((qq) => qq.flatMap((pt) => [pt.x, pt.y])) : Array.from(a.quadPoints))
      : [];
    const words = [];
    for (let k = 0; k + 8 <= q.length; k += 8) {
      const xs = [q[k], q[k + 2], q[k + 4], q[k + 6]], ys = [q[k + 1], q[k + 3], q[k + 5], q[k + 7]];
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (const it of items) {
        const y = it.transform[5], h = it.height || 8, x = it.transform[4], w = it.width || 1;
        if (y + h * 0.3 < y0 || y + h * 0.3 > y1 || x + w < x0 || x > x1) continue;
        // only the characters inside the quad (proportional to the run's width)
        const n = it.str.length, c0 = Math.max(0, Math.floor((x0 - x) / w * n)), c1 = Math.min(n, Math.ceil((x1 - x) / w * n));
        words.push(it.str.slice(c0, c1));
      }
    }
    const note = (a.contentsObj?.str || a.contents || '').trim();
    if (a.subtype === 'Highlight' && !note && !words.length) continue;
    out.push({ page: p, type: a.subtype, hl: words.join(' ').replace(/\s+/g, ' ').trim(), note });
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`${out.length} comment(s) -> ${OUT}`);
if (process.argv.includes('--print'))
  for (const c of out) console.log(`p${c.page} [${c.hl.slice(0, 80)}] => ${c.note.replace(/\s*\n\s*/g, ' / ').slice(0, 200)}`);
