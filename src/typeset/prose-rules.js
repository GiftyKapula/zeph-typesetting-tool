// Book-wide prose rules a reviewer asks for "throughout", each switched on by its own
// sidecar key so no other book changes:
//
//   "curlyQuotes": true     straight " and ' become “ ” ‘ ’ (apostrophes ’) everywhere
//   "serialComma": false    no comma before the last "and"/"or" of a list ("A, B, and C"
//                           -> "A, B and C"); "serialCommaKeep": ["…"] names clause commas to keep
//   "emphasis": "italic"    in the body (first TOPIC/UNIT heading up to the GLOSSARY or
//                           REFERENCES), scripture references and key terms are set in
//                           italics: a bold or author-coloured run becomes italic, plain
//                           weight, body colour, and a scripture reference typed upright is
//                           italicised. Labels ending in a colon ("Scenario:") stay bold.
//   "captionStop": false    no full stop at the end of a figure caption
//
// Each rule works across a block's runs without flattening them, so bold/italic/colour
// on the surrounding words is kept.

const SEG_ARRAYS = ["segs", "qseg", "aseg"];
// A scripture reference with chapter and verse: "Luke 5:27–30", "1 Corinthians 10:24–25",
// "Qur’an 4:58", "Bhagavad Gita 3:8", "Matthew 22:22, 37–40".
const SCRIPTURE = new RegExp("(?:[1-3] )?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|" +
  "Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|" +
  "Joel|Amos|Obadiah|Jonah|Micah|Habakkuk|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|" +
  "Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation|" +
  "Qur[’']an|Bhagavad Gita) \\d+:\\d+(?:[–-]\\d+)?(?:, ?\\d+(?::\\d+)?(?:[–-]\\d+)?)*");
const STRING_KEYS = ["text", "caption", "title", "q", "a", "plain", "label"];

const isSeg = (x) => x && typeof x === "object" && typeof x.t === "string" && !x.segs &&
  ("b" in x || "it" in x || "c" in x || "m" in x);
const isSegArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isSeg);

// Visit every run list and every plain string field in the block tree.
function walk(node, onSegs, onString, cellStrings = false) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === "string") { if (!cellStrings) continue; const r = onString(node[i]); if (r !== node[i]) node[i] = r; }
      else walk(node[i], onSegs, onString, cellStrings);
    }
    return;
  }
  if (node.t === "raw" || node.raw) return;           // literal Typst: never touch
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (isSegArray(v)) onSegs(v, node, k);
    else if (typeof v === "string" && STRING_KEYS.includes(k)) { const r = onString(v); if (r !== v) node[k] = r; }
    else if (Array.isArray(v) && (k === "rows" || k === "cells")) walk(v, onSegs, onString, true);
    else if (v && typeof v === "object") walk(v, onSegs, onString);
  }
}

// Rewrite the joined text of a run list. `fn` returns either a string of the SAME
// length (characters swapped in place) or a Set of indices to delete. Each run keeps
// its own formatting; returns the number of characters changed.
function editRuns(segs, fn) {
  const live = segs.filter((s) => !s.m);
  const joined = live.map((s) => s.t).join("");
  const out = fn(joined);
  const del = out instanceof Set ? out : null;
  if (!del && (out === joined || out.length !== joined.length)) return 0;
  if (del && !del.size) return 0;
  let i = 0, changed = 0;
  for (const s of live) {
    let nt = "";
    for (let k = 0; k < s.t.length; k++, i++) {
      if (del) { if (del.has(i)) changed++; else nt += joined[i]; }
      else { if (out[i] !== joined[i]) changed++; nt += out[i]; }
    }
    s.t = nt;
  }
  return changed;
}

function curly(str) {
  return str
    .replace(/(^|[\s(\[{—–\-\/])"/g, "$1“")
    .replace(/"/g, "”")
    .replace(/(^|[\s(\[{—–\/“])'(?=[A-Za-z0-9])/g, "$1‘")
    .replace(/'/g, "’");
}

// "A, B, and C" -> "A, B and C": drop the comma before a sentence's final "and"/"or"
// when the same sentence already has a comma before it (so it closes a list, rather
// than joining two clauses: "Mukuka accepted the apology, and they continued").
function serialCommaIndices(str, log, keep = []) {
  const del = new Set();
  const re = /, (?=(?:and|or) )/g;
  let m;
  while ((m = re.exec(str))) {
    // "serialCommaKeep": a comma joining two clauses that the test below would take
    // for a list ("…where people need to work together, and explain how…")
    if (keep.some((k) => { const at = str.indexOf(k); return at >= 0 && m.index >= at && m.index < at + k.length; })) continue;
    const before = str.slice(0, m.index);
    const ends = [...before.matchAll(/[.?!:](?=\s|[A-Z“"])/g)];
    const sentence = ends.length ? before.slice(ends[ends.length - 1].index + 1) : before;
    if (!sentence.includes(",")) continue;
    del.add(m.index);
    if (log) log.push(str.slice(Math.max(0, m.index - 50), m.index + 12));
  }
  return del;
}
function dropSerialComma(str, log, keep) {
  const del = serialCommaIndices(str, log, keep);
  return str.split("").filter((_, i) => !del.has(i)).join("");
}

function applyProseRules(blocks, ov, opts = {}) {
  const report = [];
  if (ov.curlyQuotes) {
    let n = 0;
    walk(blocks, (segs) => { n += editRuns(segs, curly); }, (s) => { const r = curly(s); if (r !== s) n++; return r; });
    if (n) report.push(`curly quotes: ${n} mark(s)`);
  }
  if (ov.serialComma === false) {
    const log = [], keep = ov.serialCommaKeep || [];
    walk(blocks, (segs) => { editRuns(segs, (s) => serialCommaIndices(s, log, keep)); }, (s) => dropSerialComma(s, log, keep));
    if (log.length) report.push(`serial comma: ${log.length} dropped`);
    if (opts.verbose) for (const l of log) console.log("      ,and  " + l.replace(/\s+/g, " "));
  }
  if (ov.captionStop === false) {
    let n = 0;
    const strip = (o) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(strip);
      if (typeof o.caption === "string" && /[^.]\.\s*$/.test(o.caption)) { o.caption = o.caption.replace(/\.\s*$/, ""); n++; }
      for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object") strip(o[k]);
    };
    strip(blocks);
    if (n) report.push(`caption full stops: ${n} removed`);
  }
  if (ov.emphasis === "italic") {
    const textOf = (b) => (b && (b.text || b.title || (b.segs || []).map((s) => s.t).join(""))) || "";
    const startIdx = blocks.findIndex((b) => /^(TOPIC|UNIT)\b/i.test(textOf(b).trim()));
    const glossTitle = (ov.glossaryTitle || "GLOSSARY").toUpperCase();
    let endIdx = blocks.findIndex((b, i) => i > startIdx && (textOf(b).trim().toUpperCase() === glossTitle || /^REFERENCES$/i.test(textOf(b).trim())));
    if (endIdx < 0) endIdx = blocks.length;
    let n = 0;
    const SKIP = new Set(["table", "dtable", "h1", "h2", "h3", "head", "label", "toc", "cover"]);
    const visit = (o) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(visit);
      if (Array.isArray(o.rows)) {                       // table: only its scripture references
        for (const row of o.rows) for (const cell of Array.isArray(row) ? row : []) {
          if (!cell || typeof cell !== "object" || typeof cell.text !== "string" || cell.segs) continue;
          const R = new RegExp(SCRIPTURE.source, "g");
          if (!R.test(cell.text)) continue;
          R.lastIndex = 0;
          const segs = []; let last = 0, r;
          while ((r = R.exec(cell.text))) {
            if (r.index > last) segs.push({ t: cell.text.slice(last, r.index), b: false, it: false, c: null });
            segs.push({ t: r[0], b: false, it: true, c: null }); n++;
            last = r.index + r[0].length;
          }
          if (last < cell.text.length) segs.push({ t: cell.text.slice(last), b: false, it: false, c: null });
          cell.segs = segs;
        }
        return;
      }
      if (SKIP.has(o.t)) return;
      for (const k of SEG_ARRAYS) if (isSegArray(o[k])) {
        const segs = o[k];
        const words = segs.filter((s) => !s.m && s.t.trim());
        // a run list that is bold from end to end is a heading/label line, not a term
        if (words.length && words.every((s) => s.b)) continue;
        for (const s of segs) {
          if (s.m) continue;
          const coloured = s.c && !/^(FFFFFF|000000)$/i.test(s.c);
          if (!s.b && !coloured) continue;
          const tt = s.t.trim();
          if (s.b && /:$/.test(tt)) continue;          // "Scenario:" label stays bold
          if (/[A-Za-z0-9]/.test(tt)) s.it = true;     // a lone comma or space is not italicised
          s.b = false; s.c = null; n++;
        }
        // a scripture reference typed upright ("Bhagavad Gita 3:8 teaches …") is
        // italicised too: the run is split around it, the rest keeps its own style
        const out = [];
        for (const s of segs) {
          if (s.m || s.it || s.b) { out.push(s); continue; }
          const R = new RegExp(SCRIPTURE.source, "g");
          let last = 0, r;
          while ((r = R.exec(s.t))) {
            if (r.index > last) out.push({ ...s, t: s.t.slice(last, r.index) });
            out.push({ ...s, t: r[0], it: true }); n++;
            last = r.index + r[0].length;
          }
          out.push(last ? { ...s, t: s.t.slice(last) } : s);
        }
        if (out.length !== segs.length) o[k] = out.filter((s) => s.m || s.t !== "");
      }
      for (const k of Object.keys(o)) if (!SEG_ARRAYS.includes(k) && o[k] && typeof o[k] === "object") visit(o[k]);
    };
    if (startIdx >= 0) for (let i = startIdx; i < endIdx; i++) visit(blocks[i]);
    if (n) report.push(`emphasis: ${n} bold/coloured run(s) set in italics`);
  }
  for (const r of report) console.log("   " + r);
}

module.exports = { applyProseRules, curly, dropSerialComma, SCRIPTURE };
