// Block text helpers: read/replace a block's plain text or rich segments.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { arr } = require("./emit.js");

// A block's runs live under `segs` (paragraphs) or `qseg` (exercise/assessment
// question parts); plain-text blocks (headings/labels) carry `text`.
const segKey = (b) => (b.segs ? "segs" : b.qseg ? "qseg" : null);

// Plain text of a block. Figure/table captions live on an image block's `caption`
// (or, for side-by-side rows, on each `images[].caption`), so surface those too —
// otherwise an override can never reach a caption's text (e.g. a mis-numbered "Fig. N:").
// A Learning Activity/Exercise/Assessment BOX's own title lives on `.title`
// (activity/assessment) or `.heading` (exercise) — a plain string field the box
// itself carries, separate from the `.body`/`.parts` content nested inside it.
// `recase` already had to special-case this (see its own comment); surfacing it
// here too lets every other text-editing override (`edit`, `editAll`, …) reach a
// typo in a box's own title instead of silently no-op'ing on it.
const titleKey = (b) => (b.t === "exercise" ? "heading" : (b.t === "activity" || b.t === "assessment") ? "title" : null);

const blockPlain = (b) => {
  const k = segKey(b);
  if (k) return b[k].map((s) => s.t).join("");
  if (typeof b.text === "string" && b.text) return b.text;
  if (typeof b.caption === "string") return b.caption;
  if (b.t === "imagerow" && Array.isArray(b.images)) return b.images.map((im) => im.caption || "").join(" ");
  const tk = titleKey(b);
  if (tk && typeof b[tk] === "string") return b[tk];
  return "";
};

function setBlockText(b, text) {
  const k = segKey(b);
  if (k) b[k] = [{ t: text, b: false, it: false, c: null }];
  else if (typeof b.text !== "string" && typeof b.caption === "string") b.caption = text;
  else b.text = text;
}

// Like setBlockText, but the replacement carries lightweight markup (**bold**,
// *italic*, $math$) parsed into runs — used where a rewrite must KEEP formatting
// (e.g. a bold label with an inserted colon). Falls back to plain for text-only
// blocks (headings/captions) that have no run array.
function setBlockSegs(b, segs) {
  const k = segKey(b);
  if (k) b[k] = segs;
  else setBlockText(b, segs.map((s) => s.t).join(""));
}

// Replace a substring WITHIN a block, preserving the formatting of every run
// that lies outside the edited span (unlike setBlockText, which flattens the
// whole block). `repl` may be "" to delete the span.
function editBlockText(b, find, repl) {
  const k = segKey(b);
  if (!k) {
    if (typeof b.text === "string" && b.text.includes(find)) { b.text = b.text.replace(find, repl); return; }
    if (typeof b.caption === "string" && b.caption.includes(find)) { b.caption = b.caption.replace(find, repl); return; }
    if (b.t === "imagerow" && Array.isArray(b.images)) {
      for (const im of b.images) if (typeof im.caption === "string" && im.caption.includes(find)) { im.caption = im.caption.replace(find, repl); return; }
    }
    const tk = titleKey(b);
    if (tk && typeof b[tk] === "string" && b[tk].includes(find)) { b[tk] = b[tk].replace(find, repl); return; }
    return;
  }
  const full = b[k].map((s) => s.t).join("");
  const start = full.indexOf(find);
  if (start < 0) return;
  const end = start + find.length;
  const out = [];
  let pos = 0, inserted = false;
  for (const s of b[k]) {
    const segStart = pos, segEnd = pos + s.t.length; pos = segEnd;
    if (segEnd <= start || segStart >= end) { out.push(s); continue; }   // outside the span
    const pre = s.t.slice(0, Math.max(0, start - segStart));
    const post = s.t.slice(Math.max(0, end - segStart));
    if (pre) out.push({ ...s, t: pre });
    // Keep THIS run's own styling (bold/italic/colour) on the replacement text
    // instead of resetting it to plain — a substring replaced inside an
    // italicised (or bold/coloured) run must stay italic, not revert to plain.
    if (!inserted && repl) { out.push({ ...s, t: repl }); inserted = true; }
    if (post) out.push({ ...s, t: post });
  }
  b[k] = out.filter((s) => s.t !== "");
}

// Like editBlockText, but targets a qa PART'S OWN ANSWER (`.a`/`.aseg`) instead of its
// question (`.qseg`/`.text`) — `segKey()`/`blockPlain()` never look at the answer side,
// so `edit`/`editAll` can't reach it. Needed for a stray leftover option letter the
// manuscript's own answer text carries (e.g. "C use of basso continuo" on a question
// that isn't even a lettered multiple-choice), which lives only in this field.
function editBlockAnswerText(b, find, repl) {
  if (Array.isArray(b.aseg) && b.aseg.length) {
    const full = b.aseg.map((s) => s.t).join("");
    const start = full.indexOf(find);
    if (start < 0) return false;
    const end = start + find.length;
    const out = [];
    let pos = 0, inserted = false;
    for (const s of b.aseg) {
      const segStart = pos, segEnd = pos + s.t.length; pos = segEnd;
      if (segEnd <= start || segStart >= end) { out.push(s); continue; }
      const pre = s.t.slice(0, Math.max(0, start - segStart));
      const post = s.t.slice(Math.max(0, end - segStart));
      if (pre) out.push({ ...s, t: pre });
      // Keep this run's own styling on the replacement (see editBlockText).
      if (!inserted && repl) { out.push({ ...s, t: repl }); inserted = true; }
      if (post) out.push({ ...s, t: post });
    }
    b.aseg = out.filter((s) => s.t !== "");
    return true;
  }
  if (typeof b.a === "string" && b.a.includes(find)) { b.a = b.a.replace(find, repl); return true; }
  return false;
}

// Per-book editorial overrides, kept in a sidecar `<book>.overrides.json` so the
// manuscript itself stays pristine:
//   fill:    [{ after: "Edited by", text: "…" }]  — write a value into the dotted
//            placeholder line that follows a label.
//   replace: [{ find: "substring", with: "…" }]   — swap a paragraph that contains
//            the given text for new text.
// Every block that carries editable text, INCLUDING those nested inside an
// activity/box `body` or an exercise/assessment `parts`/`intro`/`extra`. Returned
// as live references, so mutating one edits the document in place. `edit`/`replace`
// use this so a fix reaches text the writer buried inside a boxed activity.
function allTextBlocks(blocks) {
  const out = [];
  const visit = (arr) => {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      const tk = titleKey(b);
      if (b.segs || b.qseg || typeof b.text === "string" || typeof b.caption === "string" || b.t === "imagerow" || b.t === "image" || (tk && typeof b[tk] === "string")) out.push(b);
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k]) && b[k].some((x) => x && typeof x === "object" &&
            (x.segs || x.qseg || typeof x.text === "string" || x.body || x.parts))) visit(b[k]);
      }
    }
  };
  visit(blocks);
  return out;
}

// Parse a lightweight markup string into runs: **bold**, *italic*, and $typst math$.
// Everything else is a plain run. Used by `replaceSection` so author-supplied
// replacement content (e.g. references with italic titles) keeps its formatting.
function mkSegs(str) {
  const segs = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\$([^$]+)\$|([^*$]+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1] != null) segs.push({ t: m[1], b: true, it: false, c: null });
    else if (m[2] != null) segs.push({ t: m[2], b: false, it: true, c: null });
    else if (m[3] != null) segs.push({ t: m[3], m: true, display: false, b: false, it: false, c: null });
    else segs.push({ t: m[4], b: false, it: false, c: null });
  }
  return segs.length ? segs : [{ t: str, b: false, it: false, c: null }];
}

// Return a copy of `segs` with the first `n` characters bolded (splitting the
// seg that straddles the boundary), leaving formatting/colour otherwise intact.
function boldPrefix(segs, n) {
  const out = [];
  let remaining = n;
  for (const s of segs) {
    if (remaining <= 0) { out.push(s); continue; }
    if (s.t.length <= remaining) { out.push({ ...s, b: true }); remaining -= s.t.length; continue; }
    out.push({ ...s, t: s.t.slice(0, remaining), b: true });
    out.push({ ...s, t: s.t.slice(remaining) });
    remaining = 0;
  }
  return out;
}

module.exports = { segKey, titleKey, blockPlain, setBlockText, setBlockSegs, editBlockText, editBlockAnswerText, allTextBlocks, mkSegs, boldPrefix };
