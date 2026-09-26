// Final polish passes: list columns, spacing, answer labels, column maths, primary scaffold, bold fixes.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { S, arr, TOPIC_RE } = require("../emit.js");
const { MARK_BRACKET, glueMarkTail } = require("./marks.js");

// between the columns ("bug          6. hobby"). Typst — like HTML — collapses runs
// of spaces to one, so those columns can never render from spaces; they collapse to
// "bug 6. hobby". Detect a run of consecutive list/para lines that each split on a
// 3+ space gap into the SAME number of chunks, and convert the run into a real,
// evenly-spaced grid so the columns line up. Runs BEFORE normaliseSpacing (which
// would otherwise erase the gaps). Applies to top-level blocks and box bodies.
function columnizeLists(blocks) {
  const GAP = /\s{3,}/;
  const splitCols = (b) => {
    // Plain-text runs only (no maths / images). Authors often break a line into
    // several runs — a bold "1." then the words — so JOIN all plain segments into one
    // string; only bail if any run is a math segment (columns are word lists, never math).
    const segs = b.segs || b.s || b.qseg;
    if (!Array.isArray(segs) || segs.length === 0) return null;
    if (segs.some((x) => !x || x.m || typeof x.t !== "string")) return null;
    const s = { t: segs.map((x) => x.t).join(""), b: segs[0].b, it: segs[0].it, c: segs[0].c };
    let parts = s.t.replace(/\t/g, "    ").split(GAP).map((x) => x.trim()).filter((x) => x !== "");
    // The author often puts spaces AFTER a number too ("8.     Buy pie"), so the number
    // splits off as its own chunk. Re-join a chunk that is only a marker ("8.", "9)")
    // with the chunk that follows, so "8." + "Buy pie" become one cell "8. Buy pie".
    const merged = [];
    for (let k = 0; k < parts.length; k++) {
      if (/^\(?\d+[.)]?$/.test(parts[k]) && k + 1 < parts.length) { merged.push(parts[k] + " " + parts[k + 1]); k++; }
      else merged.push(parts[k]);
    }
    parts = merged;
    if (parts.length < 2 || parts.length > 6) return null;
    // guard: a "word = ____" segmentation prompt is NOT a two-column word list — the
    // author typed a wide gap before the "=" so the learner has room to write the blend
    // ("large        ="). A cell that is just "=" (optionally trailing underscores/blank)
    // means this is a fill-in line; keep it a single list item so the "=" stays beside
    // the word instead of being flung to a second column on the far right.
    if (parts.some((p) => /^=[_\s]*$/.test(p))) return null;
    // guard: a normal sentence with one stray double-gap shouldn't columnize —
    // require every chunk to be short (a word list), not prose
    if (parts.some((p) => p.length > 22 || p.trim().split(/\s+/).length > 4)) return null;
    // guard: a cell that's NOTHING but a mark-allocation bracket ("[1]") isn't a
    // real data column — it's a manuscript's own manual spacing to shove a mark
    // over to the right (the exact pattern glueMarkTail/splitMarksToFr already
    // collapse into a proper flush-right mark elsewhere). Reading it as tabular
    // data instead dropped the row out of the exercise's own italic/indented
    // qaparts styling entirely and into a plain, unstyled, non-flush-right grid
    // cell (Physics Form 2 TG's Exercise 3: "Heat (thermal energy)     [1]" /
    // "Sound energy     [1]" rendered as a bare two-column table).
    if (parts.some((p) => MARK_BRACKET.test(p) && !p.replace(MARK_BRACKET, "").trim())) return null;
    // Derive the row marker consistently: prefer the block's own list marker; else if
    // the first cell starts with a number ("1. Bright light"), lift that number out as
    // the marker so it aligns in the marker column like the other rows.
    // For a `kind:"q"` row the block marker is an exercise-question NUMBER assigned by
    // import (and often off-by-one because an instruction line took "1."), not a label the
    // author wants down the side of a word grid — ignore it. Only surface a number the
    // author actually typed INTO the row ("1. Bright light"). Non-q rows (TG paragraph
    // lists) keep the block's own marker as before.
    const isQ = b.kind === "q";
    // A q-row's NUMERIC marker is an import-assigned question number (the fallback
    // is always `${n}.`, often off-by-one because an instruction line took "1."), not
    // a label the author wants down the side of a grid — ignore it. An ALPHA marker
    // ("a)", "b)", "c)") is never that fallback — it only comes from a real Word
    // lettered list the author typed, whether it's a depth>0 sub-item (e.g. the three
    // rows of a place-value chart) or the top-level lettering of the row itself (e.g.
    // "a) vil/lage ___", "b) of/fice ___") — keep it either way so the columns line up
    // under their letters.
    const keepQMarker = isQ && b.marker && /^\(?[A-Za-z][.)]?$/.test(b.marker.trim());
    let marker = ((!isQ || keepQMarker) && b.marker && b.marker !== "•") ? b.marker : "";
    if (!marker) {
      const fm = parts[0].match(/^(\(?\d+[.)])\s+(.*)$/);
      if (fm) { marker = fm[1]; parts = [fm[2], ...parts.slice(1)]; }
    }
    return { marker, cells: parts, style: { b: s.b, it: s.it, c: s.c } };
  };
  const walk = (arr, inBody) => {
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      for (const k of ["body", "parts", "items"]) if (Array.isArray(b[k])) walk(b[k], true);
      const isRow = (x) => x && (x.t === "listitem" || (x.t === "para" && x.segs) || (x.k === "list") || (x.k === "para") || (x.kind === "q" && Array.isArray(x.qseg)));
      if (!isRow(b)) continue;
      const first = splitCols(b);
      if (!first) continue;
      const run = [{ i, cols: first }];
      let j = i + 1;
      while (j < arr.length && isRow(arr[j])) {
        const c = splitCols(arr[j]);
        if (!c || c.cells.length !== first.cells.length) break;
        run.push({ i: j, cols: c }); j++;
      }
      if (run.length < 2) continue;                       // a single line isn't a column block
      const hasMarker = run.some((r) => r.cols.marker);
      const ncol = first.cells.length + (hasMarker ? 1 : 0);
      const rows = run.map((r) => ({
        marker: r.cols.marker, cells: r.cols.cells, style: r.cols.style,
      }));
      const grid = inBody
        ? { k: "colgrid", rows, ncol, hasMarker }
        : { t: "colgrid", rows, ncol, hasMarker };
      arr.splice(i, run.length, grid);
      // Fold a preceding header line ("Hundreds Tens Ones") into the grid as an aligned
      // header row when it carries exactly one short word per body column — otherwise it
      // floats above the grid, unaligned (place-value / T-O charts). Only a non-row line
      // (a lead/label/para, never another data row) is eligible.
      const prev = arr[i - 1];
      if (prev && !isRow(prev) && (prev.kind === "lead" || prev.kind === "label" || prev.t === "para" || prev.t === "label" || prev.k === "para")) {
        const ptxt = ((prev.qseg || prev.segs || prev.s || []).map((s) => (s && s.t) || "").join("") || prev.q || prev.text || "").trim();
        const words = ptxt.split(/\s+/).filter(Boolean);
        if (words.length === first.cells.length && words.every((w) => w.length <= 12 && /^[A-Za-z]/.test(w))) {
          // If every row's first cell is a given number glued to its first blank by a
          // single space ("352 _____"), split that number into its own leading column so
          // the labelled blanks form clean equal columns and each header word sits over
          // its own blank (place-value chart: 352 | __ H | __ T | __ O).
          const numBlank = /^(\S+)\s+(_+.*)$/;
          if (grid.rows.every((r) => numBlank.test(r.cells[0]))) {
            for (const r of grid.rows) {
              const m = r.cells[0].match(numBlank);
              r.cells = [m[1], m[2], ...r.cells.slice(1)];
            }
            grid.ncol += 1;
            grid.header = ["", ...words];
          } else {
            grid.header = words;
          }
          arr.splice(i - 1, 1);
          i--;
        }
      }
    }
  };
  walk(blocks, false);
}

// House style: a mark allocation sits flush against the right edge of the text
// column, not glued inline right after the sentence — see splitMarksToFr below,
// which runs last (right before the Typst source is built) and turns the single
// glued space this function leaves before each bracket into a `{fr: true}` filler
// segment the template renders as `h(1fr)`, consuming the rest of the current
// line so the bracket lands at its edge and whatever follows wraps to a new line.
function normaliseSpacing(blocks) {
  const fix = (segs) => {
    if (!Array.isArray(segs) || !segs.length) return;
    // drop leading whitespace-only runs
    while (segs.length && typeof segs[0].t === "string" && /^\s+$/.test(segs[0].t) && segs.length > 1) segs.shift();
    for (const s of segs) {
      if (!s || typeof s.t !== "string") continue;
      s.t = glueMarkTail(s.t.replace(/[ \t]{3,}/g, " ").replace(/\t/g, " "));
    }
    if (typeof segs[0].t === "string") segs[0].t = segs[0].t.replace(/^[ \t]+/, "");
    const last = segs[segs.length - 1];
    if (last && typeof last.t === "string") last.t = last.t.replace(/[ \t]+$/, "");
    // A mark can also land in its OWN seg right after a formatting boundary (e.g. the
    // sentence in one run, "[2]" in the next) — glueMarkTail only sees inside one seg,
    // so also glue across a seg boundary when one seg ends in a bare space and the
    // next begins with the mark bracket.
    for (let k = 0; k < segs.length - 1; k++) {
      const cur = segs[k], nxt = segs[k + 1];
      if (!cur || !nxt || typeof cur.t !== "string" || typeof nxt.t !== "string") continue;
      if (/ $/.test(cur.t) && MARK_BRACKET.test(nxt.t.replace(/^[ \t]+/, "").slice(0, 20)) && /^[ \t]*\[/.test(nxt.t)) {
        cur.t = cur.t.replace(/ $/, " ");
      }
    }
  };
  const walk = (arr) => {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (Array.isArray(b.segs)) fix(b.segs);
      if (Array.isArray(b.qseg)) fix(b.qseg);
      if (Array.isArray(b.s)) fix(b.s);
      // An exercise/assessment answer (`aseg`/`a`) is rendered inside `highlight()` (the
      // "Possible answer" callout) — an author who padded the answer with a long run of
      // literal spaces to hand-align a trailing mark ("...m/s²)          [2]") gets that
      // run highlighted right along with the text, rendering as a bare colour bar with
      // nothing in it, often bleeding well past the box into the margin. `segs`/`qseg`/`s`
      // already get this same space-collapsing; `aseg`/`a` need it too.
      if (Array.isArray(b.aseg)) fix(b.aseg);
      if (typeof b.q === "string") b.q = glueMarkTail(b.q.replace(/[ \t]{3,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, ""));
      if (typeof b.text === "string") b.text = glueMarkTail(b.text.replace(/[ \t]{3,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, ""));
      if (typeof b.a === "string") b.a = glueMarkTail(b.a.replace(/[ \t]{3,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, ""));
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) walk(b[k]);
    }
  };
  walk(blocks);
}

// Inside an End-of-Unit Assessment the paper is split into skill sections
// ("Listening and speaking", "Reading and writing"). Authors type these as ordinary
// sentences, so they render at body weight and the learner cannot see where one
// section ends and the next begins. Bold them wherever they stand alone as a line
// inside an assessment box. Runs for EVERY book.
// Teacher's Guides write each exercise/assessment answer INLINE after the question,
// tagged with a bold "Possible Answer:" / "Expected Answer:" / "Answer:" label — so the
// question, label and answer glue into one run of prose that a teacher can't scan. Split
// each question's runs at that label: the question stays in `qseg`, and everything after
// the label moves to `aseg` (the label itself is dropped — the answer renderer re-adds a
// "Possible answer:" tag and sets the answer on its own highlighted line). Runs for every
// exercise/assessment question (and answer-bearing lead-in, promoted to a question).
function splitAnswerLabels(blocks) {
  // a run that is ENTIRELY the answer label (its own bold run, e.g. "Possible Answer:")
  const LABEL_FULL = /^\s*(possible|expected|sample|suggested|model)?\s*(answers?|responses?)\s*:?\s*$/i;
  // the label appearing INLINE inside a run ("…life? Possible Answer: Art is…"). The
  // prefix word is REQUIRED here so a bare "answer:" inside a question never trips it.
  const LABEL_INLINE = /\b(possible|expected|sample|suggested|model)\s*(answers?|responses?)\s*:\s*/i;
  const plainOf = (segs) => segs.map((s) => s.t).join("");
  // Split a run array at the answer label into [questionSegs, answerSegs] (label dropped),
  // or null when the runs carry no answer to peel off.
  const cut = (segs) => {
    let qSegs = null, aSegs = null;
    const idx = segs.findIndex((s) => s && !s.m && LABEL_FULL.test(s.t || ""));
    if (idx >= 0) {
      qSegs = segs.slice(0, idx);
      aSegs = segs.slice(idx + 1);
    } else {
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]; if (!s || s.m) continue;
        const m = (s.t || "").match(LABEL_INLINE);
        if (!m) continue;
        const before = s.t.slice(0, m.index);
        // The label only marks a real inline Q&A split when it follows an actual
        // question/prompt (ending ., ?, or !) or nothing at all — not when it's mid-
        // phrase inside the manuscript's own prose. E.g. a "How to Use This Guide" step
        // labelled "Use possible answers:" (the whole phrase is the manuscript's OWN
        // bold list-item label) matched here, splitting the sentence-fragment "Use" off
        // as a bogus question and mangling the plural "answers" to look like an
        // answer-key tag. Require terminal punctuation right before the match.
        const priorTrim = (segs.slice(0, i).map((x) => x.t || "").join("") + before).trim();
        if (priorTrim && !/[.?!]$/.test(priorTrim)) continue;
        const after = s.t.slice(m.index + m[0].length);
        qSegs = segs.slice(0, i).concat(before.trim() ? [{ ...s, t: before }] : []);
        aSegs = (after.trim() ? [{ ...s, b: false, t: after }] : []).concat(segs.slice(i + 1));
        break;
      }
    }
    // A label whose only "remainder" is trailing whitespace (a manuscript's stray
    // spaces after a bold heading run, e.g. "Expected Responses  " typed as its own
    // box subheading with two trailing spaces as a separate, non-bold run) is not a
    // real inline answer — treating a non-empty-but-blank aSegs as one promoted this
    // heading to its own "q" with a visibly empty "Possible answer:" line floating
    // under it (Physics Form 2 TG's four-stroke-cycle exercise). Require actual text.
    if (!aSegs || !aSegs.map((s) => s.t || "").join("").trim()) return null;
    if (qSegs.length) qSegs[qSegs.length - 1] = { ...qSegs[qSegs.length - 1], t: qSegs[qSegs.length - 1].t.replace(/\s+$/, "") };
    // The label's colon is sometimes typed as the START of the NEXT run instead of
    // the end of the label run itself (a formatting-boundary quirk: bold "Answer",
    // then non-bold ": Angola shows..."). idx-branch only strips the label RUN, so
    // that leading colon survives onto aSegs[0] and leaks through as "Possible
    // answer: : Angola shows...". Strip it along with any leading whitespace.
    aSegs[0] = { ...aSegs[0], t: aSegs[0].t.replace(/^\s*:?\s*/, "") };
    return [qSegs, aSegs];
  };
  // An exercise/assessment question part: move the answer runs to `aseg` (the template
  // then sets them on their own highlighted "Possible answer:" line).
  // A question whose runs END with the answer label and nothing after it — the answer
  // is the list that FOLLOWS, not text on the same line ("State two advantages of using
  // this technique before sending the report.Expected answer:" with the two advantages
  // as the next list items). cut() rightly refuses that (its remainder is empty), but
  // the label was then left in the question and printed, so one exercise showed answers
  // unlabelled for most of its items and a stray "Expected answer:" on the one item
  // whose answer was a list. Trim the label off; the answer below still reads as the
  // answer. Deliberately narrow: only when real question text ending in terminal
  // punctuation precedes the label, which is what keeps a manuscript's own standalone
  // "Expected Responses" box heading (Physics Form 2 TG) out of scope.
  const trimTrailingLabel = (segs) => {
    if (!Array.isArray(segs) || !segs.length) return null;
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i]; if (!s || s.m || typeof s.t !== "string") continue;
      const m = s.t.match(LABEL_INLINE);
      if (!m) { if (s.t.trim()) return null; continue; }   // label must be in the LAST text run
      if (s.t.slice(m.index + m[0].length).trim()) return null;      // text after it → cut() handles
      if (segs.slice(i + 1).some((x) => (x && x.t || "").trim())) return null;
      const before = s.t.slice(0, m.index);
      const prior = (segs.slice(0, i).map((x) => x.t || "").join("") + before).trim();
      if (!prior || !/[.?!]$/.test(prior)) return null;
      const out = segs.slice(0, i);
      if (before.trim()) out.push({ ...s, t: before.replace(/\s+$/, "") });
      return out.length ? out : null;
    }
    return null;
  };
  const splitPart = (p) => {
    if (!Array.isArray(p.qseg) || !p.qseg.length) return;
    if (Array.isArray(p.aseg) && p.aseg.length) return;             // already split
    const c = cut(p.qseg);
    if (!c) {
      const trimmed = trimTrailingLabel(p.qseg);
      if (trimmed) { p.qseg = trimmed; p.q = plainOf(trimmed); }
      return;
    }
    p.qseg = c[0]; p.q = plainOf(c[0]);
    p.aseg = c[1]; p.a = plainOf(c[1]);
    // a lead-in that turned out to carry its own answer is really a question — promote it
    // so the answer path (which only runs for "q" parts) actually renders it.
    if (p.kind === "lead") { p.kind = "q"; if (p.marker == null) p.marker = ""; }
  };
  // A plain paragraph / list item that reads "Question? Possible Answer: text" (an
  // assessment the manuscript left un-boxed, as flowing numbered paragraphs): keep it one
  // block, but break the answer onto its own line — bold "Possible answer:" tag, italic
  // answer — so it reads like the boxed exercises instead of one glued sentence.
  const splitPara = (b) => {
    const segs = b.segs;
    if (!Array.isArray(segs) || !segs.length) return;
    const c = cut(segs);
    if (!c) return;
    const [qSegs, aSegs] = c;
    const tag = { t: "\nPossible answer: ", b: true, it: false, c: null };
    const ans = aSegs.map((s) => (s.m ? s : { ...s, it: true }));
    b.segs = qSegs.concat([tag], ans);
  };
  const walk = (arr) => {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if ((b.t === "exercise" || b.t === "assessment") && Array.isArray(b.parts)) {
        for (let i = 0; i < b.parts.length; i++) {
          const p = b.parts[i];
          if (!p || (p.kind !== "q" && p.kind !== "lead")) continue;
          const wasLead = p.kind === "lead";
          splitPart(p);
          // A "lead" whose ENTIRE content was just the bare label ("Answer:" as its
          // own run, nothing of its own before it) has no real question text —
          // splitPart still promotes it to "kind: q" so the answer path renders it,
          // which left a phantom row: an EMPTY question line (its own marker gutter
          // and v(qgap) gap) sitting between the real question above and its answer,
          // the "big gap" a manuscript that writes the label as its own paragraph
          // (rather than gluing it onto the question) triggers. Glue the answer onto
          // the immediately preceding un-answered question instead, and drop this
          // now-redundant phantom part, so the gap matches every other question.
          if (wasLead && p.kind === "q" && !(p.q || "").trim() && Array.isArray(p.aseg) && p.aseg.length) {
            const prev = b.parts[i - 1];
            if (prev && prev.kind === "q" && !prev.a && !(prev.aseg && prev.aseg.length)) {
              prev.a = p.a;
              prev.aseg = p.aseg;
              b.parts.splice(i, 1);
              i--;
            }
          }
        }
        // A manuscript sometimes tucks a SECOND, unnumbered question into an already-
        // answered exercise item (e.g. item 3's box also asks "How can communities
        // encourage...?" right after item 3's own Q&A) — with the label "Answer:"
        // typed as its OWN paragraph rather than glued onto that second question. The
        // question survives the loop above as a bare `lead` (nothing in its own runs
        // to cut), while its answer paragraph — label and all — becomes its own blank-
        // marker `q` (the label-cut above promotes any lead-that-turns-out-to-carry-an-
        // answer to kind "q"). The earlier merge only reattaches such a blank answer to
        // an UNANSWERED preceding question, so when the preceding one is already
        // answered (our case) the two sit as separate rows with a `lead`-sized gap
        // between them meant for a genuine section intro, not a tight Q&A pair. Glue a
        // real-text, still-unanswered lead directly to the very next blank-question
        // answer instead, so it reads as one question/answer pair like its siblings.
        for (let i = 0; i < b.parts.length - 1; i++) {
          const lead = b.parts[i], next = b.parts[i + 1];
          if (lead.kind !== "lead" || lead.divider || !(lead.q || "").trim()) continue;
          if (next.kind !== "q" || (next.q || "").trim() || !(next.aseg && next.aseg.length)) continue;
          b.parts[i] = { kind: "q", q: lead.q, qseg: lead.qseg, a: next.a, aseg: next.aseg, marker: "", depth: 0 };
          b.parts.splice(i + 1, 1);
        }
      } else if ((b.t === "para" || b.t === "listitem") && Array.isArray(b.segs)) {
        splitPara(b);
      }
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) walk(b[k]);
    }
  };
  walk(blocks);
}

// Primary Learner's Books: strip the teacher/curriculum scaffolding young readers do
// not need — Sub-Topic headings, the "Specific Competence" blocks (label + "In this
// section you will learn to:" + the numbered competence codes), and the ACRONYMS /
// GLOSSARY / LIST OF FIGURES / REFERENCES sections (each an h1 running to the next h1).
// The main TOPIC headings and all real teaching content are kept. Returns a new list;
// a no-op for anything not present. Author-facing content in TEACHER'S guides is left
// untouched (the caller only invokes this for Learner's Books).
// Vertical column arithmetic. The author stacks the sum in a matrix over a fraction
// bar — `frac(mat(delim: #none, H T O; 1 1; 3 6 7; 1 3 5), 4 0 2)` — which renders as
// tiny italic INLINE math (a fraction shrinks its numerator/denominator), hard for a
// young learner to read or align. Detect that shape and convert it to a `colsum` block
// that lays the numbers out right-aligned, at full size, with a rule above the answer.
function displayifyColumnMath(blocks) {
  const parse = (t) => {
    const m = (t || "").match(/^\s*frac\(mat\(delim:\s*#none,\s*([\s\S]*)$/);
    if (!m) return null;
    const rest = m[1];
    let depth = 1, i = 0;
    for (; i < rest.length; i++) { if (rest[i] === "(") depth++; else if (rest[i] === ")") { depth--; if (!depth) break; } }
    if (depth) return null;
    const rows = rest.slice(0, i).split(";").map((s) => s.trim().replace(/^""$/, "")).filter(Boolean);
    const answer = rest.slice(i + 1).replace(/^\s*,\s*/, "").replace(/\)\s*$/, "").trim().replace(/^""$/, "");
    // The denominator can itself be a bare matrix — expanded-notation addition stacks
    // the sum over the total, e.g. frac(mat(…addends…), mat(delim:#none, 50+ 9; =59)).
    // Flatten it into several answer lines that all sit right-aligned below the rule.
    let answerRows = [answer].filter(Boolean);
    const am = answer.match(/^mat\(delim:\s*#none,\s*([\s\S]*)\)$/);
    if (am) answerRows = am[1].split(";").map((s) => s.trim().replace(/^""$/, "")).filter(Boolean);
    return rows.length ? { rows, answerRows } : null;
  };
  const walk = (arr) => {
    for (const b of arr) {
      // rows of a table are themselves arrays (of cells) — descend so column math
      // living in a table cell is reached too.
      if (Array.isArray(b)) { walk(b); continue; }
      if (!b || typeof b !== "object") continue;
      // a standalone column-arithmetic equation as its own paragraph/list item
      if ((b.t === "para" || b.t === "listitem") && b.segs && b.segs.length === 1 && b.segs[0].m) {
        const p = parse(b.segs[0].t);
        if (p) { b.t = "colsum"; b.rows = p.rows; b.answerRows = p.answerRows; delete b.segs; delete b.marker; delete b.isList; delete b.numId; delete b.lvl; }
      }
      // column arithmetic sitting in a TABLE CELL (a regrouping worksheet stacks the
      // problem — "T O / 4 2 / -1 8" — in one cell). A cell has no `t`/`kind`; give it a
      // `colsum` so it renders as aligned column arithmetic instead of tiny inline math.
      if (!b.t && !b.kind && Array.isArray(b.imgs) && b.segs && b.segs.length === 1 && b.segs[0].m) {
        const p = parse(b.segs[0].t);
        if (p) { b.colsum = { rows: p.rows, answer: p.answerRows }; delete b.segs; b.text = ""; }
      }
      // the same equation living INSIDE an exercise/assessment part (its qseg is a single
      // math run) — e.g. an answer key's vertical subtraction. Convert the part to a
      // colsum kind so it renders as a right-aligned column sum with a rule, KEEPING the
      // part's marker ("1.", "3.") so the answer stays numbered.
      if (b.kind && b.qseg && b.qseg.length === 1 && b.qseg[0].m) {
        const p = parse(b.qseg[0].t);
        if (p) { b.kind = "colsum"; b.rows = p.rows; b.answerRows = p.answerRows; delete b.qseg; delete b.q; }
      }
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) walk(b[k]);
    }
  };
  walk(blocks);
}

function stripPrimaryScaffold(blocks) {
  const textOf = (b) => ((b.text) || (b.segs ? b.segs.map((s) => s.t).join("") : "")).trim();
  const SECTION = /^(ACRONYMS|GLOSSARY|LIST OF FIGURES|REFERENCES|BIBLIOGRAPHY)\b/i;
  // the label may be preceded by its competence code ("2.1.3 SUBTOPIC:") or followed
  // by it ("Sub-Topic: 2.5.1") — allow an optional leading number either way.
  const SUBTOPIC = /^(?:[\d.]+\s+)?sub[-\s‐-―]*topic\b/i;
  const SPECIFIC = /^(?:[\d.]+\s+)?specific competences?\b/i;
  const INTRO = /^in this (section|sub-?topic|topic|unit),? you will\b/i;
  const CODE = /^\d+\.\d+(?:\.\d+)*\b/;                 // competence code, e.g. "2.1.1.1"
  const isHeadish = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label";
  // some manuscripts leave these headings as bold PARAGRAPHS; treat a paragraph that
  // carries a competence code as a scaffold heading too (so an explanatory bullet like
  // "specific competence – the competences to be acquired", which has no code, stays).
  const isScaffoldHead = (b, t) => isHeadish(b) || (b.t === "para" && /\d+\.\d+/.test(t));
  // a section's body ends at the next MAJOR heading — a TOPIC (h1, or a head still
  // awaiting promotion), or another named section. (Its own entry labels/paras don't
  // count, so the whole section is swept.)
  const isBoundary = (x) => x.t === "h1" || (isHeadish(x) && (SECTION.test(textOf(x)) || TOPIC_RE.test(textOf(x))));
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], t = textOf(b);
    // a whole named front/back-matter section: from its heading to the next major heading
    if (isHeadish(b) && SECTION.test(t)) {
      let j = i + 1;
      while (j < blocks.length && !isBoundary(blocks[j])) j++;
      i = j - 1;
      continue;
    }
    // a Sub-Topic heading (kept: the parent TOPIC heading)
    if (isScaffoldHead(b, t) && SUBTOPIC.test(t)) continue;
    // a Specific Competence block: its label, the "you will learn to:" intro, and the
    // numbered competence-code paragraphs that immediately follow it
    if (isScaffoldHead(b, t) && SPECIFIC.test(t)) {
      let j = i + 1;
      while (j < blocks.length && blocks[j].t === "para") {
        const jt = textOf(blocks[j]);
        if (INTRO.test(jt) || CODE.test(jt)) { j++; continue; }
        break;
      }
      i = j - 1;
      continue;
    }
    out.push(b);
  }
  return out;
}

function proofPolish(blocks) {
  const textOf = (b) => (b.text || (b.segs ? b.segs.map((s) => s.t).join("") : "")).trim();
  const isHead = (b) => b.t === "head" || b.t === "label";
  // recurring sub-topic labels that must be bold black sub-heads everywhere
  const LABEL = /^(Introduction|General\s+Competences?|Specific\s+Competences?|Expected\s+Standards?|Teaching and Learning Materials|Teacher.?s?\s*Facilitation Procedure|Facilitation Procedure|Teacher.?s?\s*Notes?|Take note of responses.*)$/i;
  // labels whose VALUE lines are set in italics (competences, competence codes,
  // expected-standard outcomes) — matching each other across the whole book.
  const VALSEC = /^(General\s+Competences?|Specific\s+Competences?|Expected\s+Standards?)\b/i;
  // the recurring lead-in sentences stay regular body text (never a heading)
  const LEADIN = /^(In this sub-?topic|By the end of this sub-?topic)\b/i;
  // "General/Specific Competence(s)" is a fixed structural label, not manuscript prose —
  // its display case is a house-style rule, so normalise it to title case ("General
  // Competences", "Specific Competence") no matter how a given author typed it (some
  // manuscripts use ALL-CAPS, e.g. a Lunda book needed a one-off `recase` override for
  // this exact heading; a Physics Form 2 LB proofread round asked for "Specific
  // competence" — sentence case, the engine's older default — to read "Specific
  // Competence" instead). Only the "General/Specific Competence(s)" words themselves are
  // touched; a trailing code, colon or value is left exactly as written.
  const fixCompetenceCase = (t) => t.replace(/^(General|Specific)\s+(Competences?)\b/i,
    (_, w1, w2) => `${w1.charAt(0).toUpperCase()}${w1.slice(1).toLowerCase()} ${w2.charAt(0).toUpperCase()}${w2.slice(1).toLowerCase()}`);
  // 0) force the lead-in sentences to plain regular paragraphs
  for (const b of blocks) {
    if (LEADIN.test(textOf(b))) {
      const t = textOf(b);
      delete b.text; delete b.marker;
      b.t = "para";
      b.segs = [{ t, b: false, it: false, c: null }];
    }
  }
  // 1) normalise the known labels to bold sub-heads (regardless of source style)
  for (const b of blocks) {
    if ((b.t === "para" || b.t === "listitem") && LABEL.test(textOf(b))) {
      b.text = fixCompetenceCase(textOf(b)); b.t = "head"; delete b.segs; delete b.marker;
    }
  }
  // 1f) The language-skill COMPONENT strand that opens a lesson ("LISTENING AND SPEAKING",
  // "READING AND WRITING") and a phonics "REVISION: /x/ - …" line must read as bold
  // component sub-heads. The manuscript bolds them inconsistently — a non-bold one imports
  // as a plain paragraph and renders at body weight, unlike its bold siblings (e.g. the /z/
  // revision on the G2 English TG p121 was plain while the /ee/ one on p41 was bold). Promote
  // any standalone strand or REVISION paragraph to a head so every lesson opener matches.
  // (A strand line carrying "LESSON N" is a full lesson banner handled by normaliseLessonBanners.)
  const STRAND = /^(LISTENING\s+AND\s+SPEAKING|READING\s+AND\s+WRITING)\s*\.?$/i;
  const REVISION = /^REVISION\s*[:.]/i;
  for (const b of blocks) {
    if (!(b.t === "para" || b.t === "listitem")) continue;
    const t = textOf(b);
    if (STRAND.test(t) || REVISION.test(t)) { b.text = t; b.t = "head"; delete b.segs; delete b.marker; }
  }
  // 1b) A lesson-spec field the author left EMPTY ("VOCABULARY:", "SUGGESTED TEACHING
  // AND LEARNING RESOURCES:") is imported as a value-less `label` — rendered in teal
  // small-caps, jarringly unlike its valued siblings ("COMPONENT: Listening and
  // Speaking") which stay bold-black inline paragraphs. Recognise the recurring
  // lesson-plan field names and render an empty one as the SAME bold-black label
  // paragraph, so a Teacher's Guide lesson header reads uniformly whether or not the
  // author filled every field in.
  const SPEC = /^(Component|Topic|Sub[-\s]?Topic|General\s+Competences?|Specific\s+Competences?|Expected\s+Standards?|Vocabulary|Structure|Teaching\s+Methodology|Suggested\s+Teaching\s+and\s+Learning\s+(?:Resources?|Materials?)|Teaching\s+and\s+Learning\s+(?:Resources?|Materials?)|Key\s*words?|Learning\s+Outcomes?)\s*:?\s*$/i;
  for (const b of blocks) {
    if (b.t === "label" && SPEC.test((b.text || "").trim())) {
      const t = (b.text || "").trim().replace(/\s*:?\s*$/, ":");
      b.t = "para"; b.segs = [{ t, b: true, it: false, c: null }];
      delete b.text; delete b.labelColor;
    }
  }
  // 1a) A lesson-spec field that carries its value inline ("COMPONENT: Listening and
  // Speaking") but was imported as a coloured head/label reads inconsistently beside its
  // bold-black paragraph siblings. Convert any spec field that HAS a value after the
  // colon to a uniform bold-label + regular-value paragraph. (The value-LESS ones are
  // handled by steps 1/1b; the two are disjoint.)
  const SPECV = /^(Component|Topic|Sub[-\s]?Topic|General\s+Competences?|Specific\s+Competences?|Expected\s+Standards?|Vocabulary|Structure|Teaching\s+Methodology|Suggested\s+Teaching\s+and\s+Learning\s+(?:Resources?|Materials?)|Teaching\s+and\s+Learning\s+(?:Resources?|Materials?)|Key\s*words?|Learning\s+Outcomes?)\s*:\s*\S/i;
  for (const b of blocks) {
    if (!(b.t === "head" || b.t === "label")) continue;
    const t = (b.text || "").trim();
    if (!SPECV.test(t)) continue;
    const ci = t.indexOf(":");
    const label = t.slice(0, ci).trim();
    const val = t.slice(ci + 1).trim();
    b.t = "para";
    b.segs = [{ t: `${label}:`, b: true, it: false, c: null }, { t: ` ${val}`, b: false, it: false, c: null }];
    delete b.text; delete b.labelColor;
  }
  // 1c) The code goes INSIDE the label, before the colon — "TOPIC 2.11: Comprehension"
  // (not "TOPIC: 2.11 Comprehension"), matching the Learner's Book and how a curriculum
  // states a topic. Applies to the numbered lesson-header fields (Topic / Sub-Topic and
  // any competence/standard carrying a code). Operates on the inline bold-label para.
  const NUMFIELD = /^(Component|Topic|Sub[-\s]?Topic|General\s+Competences?|Specific\s+Competences?|Expected\s+Standards?)\s*:/i;
  for (const b of blocks) {
    if (!(b.t === "para" || b.t === "listitem") || !b.segs || !b.segs.length) continue;
    const full = b.segs.map((s) => s.t).join("");
    if (!NUMFIELD.test(full.trim())) continue;
    const ci = full.indexOf(":");
    if (ci < 0) continue;
    const label = full.slice(0, ci).trim();
    const value = full.slice(ci + 1).trim();
    const m = value.match(/^(\d+(?:\.\d+)*[a-z]?)\b[\s.:–—-]*([\s\S]*)$/i);
    if (!m || !m[1]) continue;                       // no leading code — leave as-is
    const rest = m[2].trim();
    b.segs = [
      { t: `${label} ${m[1]}:`, b: true, it: false, c: null },
      ...(rest ? [{ t: ` ${rest}`, b: false, it: false, c: null }] : []),
    ];
  }
  // 1d) The lesson-header field labels read in SENTENCE case, never uppercase
  // ("Expected standard:", "Teaching methodology:", "Suggested teaching and learning
  // resources:", "Vocabulary:", "Structure:", "Component:"), whatever the manuscript's
  // (inconsistent) casing. Only the label part up to the colon is recased — the numeric
  // code and the value stay untouched. (Topic / Sub-Topic are proper identifiers kept in
  // Title Case by step 1e, so excluded; General/Specific Competence(s) is title-cased by
  // fixCompetenceCase below instead of sentence-cased here.)
  const CASEFIELD = /^(expected\s+standards?|teaching\s+methodology|suggested\s+teaching\s+and\s+learning\s+(?:resources?|materials?)|teaching\s+and\s+learning\s+(?:resources?|materials?)|vocabulary|structure|component|key\s*words?|learning\s+outcomes?)\b/i;
  const COMPFIELD = /^(General|Specific)\s+Competences?\b/i;
  const sentenceLabel = (t) => {
    const ci = t.indexOf(":");
    const head = ci >= 0 ? t.slice(0, ci) : t;
    const tail = ci >= 0 ? t.slice(ci) : "";
    return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase() + tail;
  };
  for (const b of blocks) {
    if ((b.t === "head" || b.t === "label") && CASEFIELD.test((b.text || "").trim())) {
      b.text = sentenceLabel(b.text);
    } else if ((b.t === "head" || b.t === "label") && COMPFIELD.test((b.text || "").trim())) {
      b.text = fixCompetenceCase(b.text);
    } else if ((b.t === "para" || b.t === "listitem") && b.segs && b.segs.length) {
      const lead = b.segs.find((s) => s.t.trim());
      if (lead && CASEFIELD.test(lead.t.trim())) lead.t = sentenceLabel(lead.t);
      else if (lead && COMPFIELD.test(lead.t.trim())) lead.t = fixCompetenceCase(lead.t);
    }
  }
  // 1e) The three structural identifiers (Component / Topic / Sub-Topic) name the lesson
  // itself, so the author wants the WHOLE line bold — label AND value — reading like a
  // sub-heading, stronger than the label-only bold used for competences/vocabulary/etc.
  const BOLDFIELD = /^(Component|Topic|Sub[-\s]?Topic)\b/i;
  for (const b of blocks) {
    if (!(b.t === "para" || b.t === "listitem") || !b.segs || !b.segs.length) continue;
    const lead = b.segs.find((s) => s.t.trim());
    if (lead && BOLDFIELD.test(lead.t.trim())) b.segs = b.segs.map((s) => ({ ...s, b: true }));
  }
  // 2) italicise the value lines under those labels (but keep a lead-in sentence
  // ending in a colon — e.g. "In this sub-topic, learners will learn to:" —
  // regular), and bold the author's name.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (isHead(b) && VALSEC.test(textOf(b))) {
      for (let j = i + 1; j < blocks.length; j++) {
        const y = blocks[j];
        if (isHead(y) || /^h[123]$/.test(y.t)) break;
        // A new inline field label (a bold lead segment with a colon — e.g. "Teaching
        // methodology:", "Vocabulary:") starts the NEXT field, so the expected-standard
        // value italics must stop here; those fields' values stay regular.
        const lead = y.segs && y.segs.find((s) => s.t.trim());
        if (lead && lead.b && /:/.test(lead.t)) break;
        if (/:\s*$/.test(textOf(y))) continue;   // a lead-in sentence stays regular
        if (y.segs) y.segs = y.segs.map((s) => ({ ...s, it: true }));
      }
    }
    if (isHead(b) && /^(THE\s+)?AUTHORS?$/i.test(textOf(b))) {
      const y = blocks[i + 1];
      if (y && y.t === "para" && y.segs && y.segs.length && !y.segs[0].b) {
        const full = y.segs.map((s) => s.t).join("");
        const m = full.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z.'’-]+){1,3})\b([\s\S]*)$/);
        if (m) y.segs = [{ t: m[1], b: true, it: false, c: null }, { t: m[2], b: false, it: false, c: null }];
      }
    }
  }
  // 3) A Teacher's Guide states each lesson's General/Specific Competence and Expected
  // Standard as an INLINE bold-label paragraph ("SPECIFIC COMPETENCE: 2.1.8.1 Use
  // appropriate language…"), which step 2 (scanning blocks FOLLOWING a head-type label) never
  // reaches. Italicise the VALUE after the colon while leaving the bold label upright,
  // and carry the italics onto any continuation lines (extra competence codes the
  // author put on their own paragraph) up to the next label/head.
  const VALLABEL = /^(General\s+Competences?|Specific\s+Competences?|Expected\s+Standards?)\b[\s\d.]*:/i;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!(b.t === "para" || b.t === "listitem") || !b.segs || !b.segs.length) continue;
    if (!VALLABEL.test(b.segs.map((s) => s.t).join("").trim())) continue;
    // recase the leading "General/Specific Competence(s)" label in place — the fix only
    // ever changes letter case, so it's length-preserving and safe to redistribute back
    // across the original segments (keeping each run's own bold/italic intact).
    {
      const full = b.segs.map((s) => s.t).join("");
      const fixedFull = fixCompetenceCase(full);
      if (fixedFull !== full) {
        let pos = 0;
        b.segs = b.segs.map((s) => { const t = fixedFull.slice(pos, pos + s.t.length); pos += s.t.length; return { ...s, t }; });
      }
    }
    let passed = false;
    const out = [];
    for (const s of b.segs) {
      if (passed) { out.push({ ...s, it: true }); continue; }
      const ci = s.t.indexOf(":");
      if (ci < 0) { out.push(s); continue; }
      passed = true;
      out.push({ ...s, t: s.t.slice(0, ci + 1) });
      const after = s.t.slice(ci + 1);
      if (after) out.push({ ...s, t: after, it: true });
    }
    b.segs = out;
    for (let j = i + 1; j < blocks.length; j++) {
      const y = blocks[j];
      if (isHead(y) || /^h[123]$/.test(y.t) || !(y.t === "para" || y.t === "listitem") || !y.segs) break;
      const lead = y.segs.find((s) => s.t.trim());
      if (lead && lead.b && /:/.test(lead.t)) break;                       // a new inline label
      if (/:\s*$/.test(y.segs.map((s) => s.t).join(""))) break;           // a lead-in / other label
      y.segs = y.segs.map((s) => ({ ...s, it: true }));
    }
  }
}

function normaliseQuestionMarkBold(blocks) {
  const fixSegs = (segs) => {
    if (!Array.isArray(segs) || segs.length === 0) return;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!s || !s.t) continue;
      if (s.b) {
        if (/^\s*\?+\s*$/.test(s.t) || /^\s*\?+[\s"”']*$/.test(s.t)) {
          const prevNonSpace = segs.slice(0, i).reverse().find((p) => p && p.t && p.t.trim().length > 0);
          if (prevNonSpace && !prevNonSpace.b) {
            s.b = false;
          }
        }
      }
    }
  };

  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (Array.isArray(b.segs)) fixSegs(b.segs);
      if (Array.isArray(b.qseg)) fixSegs(b.qseg);
      if (Array.isArray(b.parts)) {
        for (const p of b.parts) {
          if (p && Array.isArray(p.qseg)) fixSegs(p.qseg);
          if (p && Array.isArray(p.segs)) fixSegs(p.segs);
        }
      }
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) walk(b[k]);
      }
    }
  };
  walk(blocks);
}

module.exports = { columnizeLists, normaliseSpacing, splitAnswerLabels, displayifyColumnMath, stripPrimaryScaffold, proofPolish, normaliseQuestionMarkBold };
