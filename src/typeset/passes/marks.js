// Question marks: glue "[N marks]" tags to their text and set them flush right.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { arr } = require("../emit.js");

// A mark allocation ("[2]", "[1 mark]") reads as an orphan when it wraps alone onto
// a new line with nothing visibly attaching it to the sentence it scores — which a
// plain breakable space invites the moment the line is nearly full. Glue it to
// whatever immediately precedes it with a NON-breaking space instead, so it always
// travels down together with the last word rather than isolated on its own line.
const MARK_BRACKET = /\[\s*\d+(?:\s*marks?)?\s*\]/i;

// Some manuscripts type the mark bracket with NO space at all before it ("...good
// conductor of heat.[1] It transfers...", "...gained kinetic energy,[1] moved...") -
// the old regex only fired when a space/tab was already there to collapse, so a
// directly-glued bracket like that sailed straight through untouched. Match the
// bracket with its (possibly EMPTY) run of leading whitespace and always normalise
// to exactly one non-breaking space, except right at the start of the string - a
// mark bracket opening a seg is a deliberate join point another pass glues in from
// the previous seg/paragraph, not a spot to inject a stray leading space of our own.
const glueMarkTail = (t) => t.replace(/([ \t]*)(\[\s*\d+(?:\s*marks?)?\s*\])/gi,
  (m, sp, bracket, offset) => offset === 0 ? bracket : " " + bracket);

// Split every segment carrying a mark-allocation bracket into pieces around that
// bracket, with a `{fr: true}` filler segment (seg() in generic-template.typ
// renders it as `h(1fr)`) inserted right before it — consuming whatever room is
// left on the CURRENT line so the bracket lands flush against the column's right
// edge and whatever text follows it wraps onto a fresh line, exam-paper style.
// normaliseSpacing() above already guaranteed exactly one glued space (or none,
// at a segment's own start) immediately before every bracket; that leading space
// is dropped here since the fractional space replaces it visually. Must run LAST,
// once no further pass needs every segment to carry a plain `.t` string — several
// earlier passes (splitAnswerLabels, normaliseQuestionMarkBold, box detection…)
// read `.t` on every segment in a run.
const MARK_BRACKET_G = /[ \t]?\[\s*\d+(?:\s*marks?)?\s*\]/gi;

function splitMarksToFr(segs) {
  if (!Array.isArray(segs)) return segs;
  // First pass: flatten into a linear stream of {mark:false, seg} text pieces and
  // {mark:true, seg} bracket pieces, in order, across every original segment —
  // needed so the second pass can tell whether a bracket has any REAL text still
  // to come anywhere later in the run, not just later within its own segment.
  const pieces = [];
  for (const s of segs) {
    if (!s || typeof s.t !== "string" || s.m || !MARK_BRACKET.test(s.t)) { pieces.push({ mark: false, seg: s }); continue; }
    let last = 0, m;
    MARK_BRACKET_G.lastIndex = 0;
    while ((m = MARK_BRACKET_G.exec(s.t))) {
      const before = s.t.slice(last, m.index);
      if (before) pieces.push({ mark: false, seg: { ...s, t: before } });
      pieces.push({ mark: true, seg: { ...s, t: m[0].replace(/^[ \t]+/, "") } });
      last = m.index + m[0].length;
    }
    const rest = s.t.slice(last);
    if (rest) pieces.push({ mark: false, seg: { ...s, t: rest } });
  }
  // Second pass: a mark with more real (non-whitespace) text still coming later in
  // the run forces a line break right after it — so it always lands at the column's
  // edge with whatever follows starting fresh below it, even mid-sentence — while a
  // mark that's the last real content just gets the flush-right treatment with no
  // break (no trailing blank line under the final mark of an answer).
  const out = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!p.mark) { out.push(p.seg); continue; }
    out.push({ fr: true });
    out.push(p.seg);
    const hasMoreText = pieces.slice(i + 1).some((q) => !q.mark && (q.seg.t || "").trim());
    if (hasMoreText) {
      out.push({ brk: true });
      // Drop the leading space the manuscript had between the bracket and the next
      // word (it belonged to the old inline layout) — the forced break already
      // starts a fresh line, so that space would otherwise indent the line's start.
      const nxt = pieces[i + 1];
      if (nxt && !nxt.mark && typeof nxt.seg.t === "string") nxt.seg = { ...nxt.seg, t: nxt.seg.t.replace(/^[ \t]+/, "") };
    }
  }
  return out;
}

function applyMarkFlushRight(blocks) {
  const walk = (arr) => {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (Array.isArray(b.segs)) b.segs = splitMarksToFr(b.segs);
      if (Array.isArray(b.qseg)) b.qseg = splitMarksToFr(b.qseg);
      if (Array.isArray(b.s)) b.s = splitMarksToFr(b.s);
      if (Array.isArray(b.aseg)) b.aseg = splitMarksToFr(b.aseg);
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) walk(b[k]);
    }
  };
  walk(blocks);
}

module.exports = { MARK_BRACKET, glueMarkTail, MARK_BRACKET_G, splitMarksToFr, applyMarkFlushRight };
