// Typst emission: turns the block list into Typst markup for generic-template.typ.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)


// Escape a JS string for a Typst double-quoted string literal.
const S = (s) => '"' + String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

// Typst array literal: a trailing-comma list, but EMPTY must be "()" not "(,)"
// (a lone comma is a syntax error). `el` formats each element.
const arr = (xs, el) => (xs.length ? "(" + xs.map(el).join(", ") + ",)" : "()");

// A fill-in blank is a run of underscores the author typed for the learner to write
// on. Underscores carry NO break opportunity in Typst, so a run of ordinary length
// is a single atomic token: it either stays put or, if it doesn't fit, moves whole
// to the next line — never splits (reviewers want the blank on one line, not spread
// across two). Only a pathologically long run needs help: past SAFE_ATOMIC_MAX it
// could be wider than the whole column and shoot off the page margin with nowhere to
// wrap to, so beyond that length we fall back to a zero-width space (U+200B, no
// width) after every underscore, letting it wrap internally rather than overflow.
const zwspBlanks = (t) => t.replace(/_+/g, (run) => {
  const SAFE_ATOMIC_MAX = 50;
  return run.length <= SAFE_ATOMIC_MAX ? run : Array.from(run).join("\u200B");
});

// segments [{t,b,it,c}] -> Typst array of dicts. A math segment carries Typst
// math source (m: true) rendered via eval(mode: "math"); display: true is a
// block equation.
const segArr = (segs) => arr(segs, (s) =>
  s.fr ? `(fr: true)`
  : s.brk ? `(brk: true)`
  : s.m ? `(m: true, display: ${s.display ? "true" : "false"}, t: ${S(s.t)})`
      : `(t: ${S(zwspBlanks(s.t))}, b: ${s.b ? "true" : "false"}, it: ${s.it ? "true" : "false"}, c: ${s.c ? S(s.c) : "none"}${s.u ? ", u: true" : ""}${s.hw ? ", hw: true" : ""}${s.mono ? ", mono: true" : ""})`);

const strArr = (a) => arr(a, S);

// A box title/heading is USUALLY plain text (-> a Typst string literal via S()).
// But when the title paragraph carried a real embedded equation, import-docx.js
// hands through the paragraph's original formatted segs (`*Segs`) instead of the
// flattened plain mirror — render those with the template's `segs()` (the same
// math-aware per-segment renderer a normal paragraph body uses) so the equation
// typesets instead of its raw Typst math source leaking onto the page as text.
const titleContent = (text, segs) => (segs && segs.length) ? `segs(${segArr(segs)})` : S(text);

// A multi-column word-list grid built from space-separated columns (see columnizeLists).
// rows: [{ marker, cells:[...], style }]. Emits marker + cells for the Typst colgrid.
const colgridArg = (b) => `rows: ${arr(b.rows, (r) => `(marker: ${S(r.marker || "")}, cells: ${strArr(r.cells)})`)}, ncol: ${b.ncol}, hasMarker: ${b.hasMarker ? "true" : "false"}${b.header ? `, header: ${strArr(b.header)}` : ""}`;

const EMPTY_CELL = { text: "", imgs: [] };

const cellImgs = (imgs) => arr(imgs || [], (im) => `(file: ${S("_media/" + im.file)}, w: ${im.w || 0})`);

// Rich table cell: text plus any images it contains (and rich segments with
// math when the cell holds an equation).
const cellArr = (c) => `(text: ${S(c.text || "")}, imgs: ${cellImgs(c.imgs)}${c.segs ? `, seg: ${segArr(c.segs)}` : ""}${c.colsum ? `, colsum: (rows: ${strArr(c.colsum.rows)}, answer: ${strArr(c.colsum.answer)})` : ""}${c.subs && c.subs.length ? `, subs: (${c.subs.map(rowArr).join(", ")},)` : ""})`;

const normRows = (rows) => { const n = Math.max(0, ...rows.map((r) => r.length)); return rows.map((r) => r.concat(Array(n - r.length).fill(EMPTY_CELL))); };

const rowArr = (rows) => arr(normRows(rows), (r) => arr(r, cellArr));

const imgArr = (imgs) => arr(imgs, (im) => `(file: ${S("_media/" + im.file)}, w: ${im.w || 0}, tall: ${im.tall ? "true" : "false"}, cap: ${im.caption ? S(im.caption) : "none"}, hmm: ${im.hmm || 0})`);

// Ordered questions + lead-ins + reference tables + diagrams (preserves position).
const partsArr = (parts) => arr(parts, (p) =>
  p.kind === "colsum" ? `(kind: "colsum", rows: ${strArr(p.rows || [])}, answer: ${strArr(p.answerRows || [])}, marker: ${S(p.marker || "")})`
  : p.kind === "table" ? `(kind: "table", r: ${rowArr(p.rows)}, marker: ${S(p.marker || "")})`
  : p.kind === "image" ? `(kind: "image", images: ${imgArr(p.images)}, marker: ${S(p.marker || "")})`
  : p.kind === "lead" ? `(kind: "lead", q: ${S(p.q)}, qseg: ${segArr(p.qseg || [])}, indent: ${p.indent ? "true" : "false"}${p.align ? `, align: ${S(p.align)}` : ""})`
  // a run of space-separated columns inside an exercise (e.g. a place-value chart:
  // "352 ___ ___ ___") that columnizeLists turned into a grid — emit it as a colgrid
  // part so qaparts renders the aligned columns instead of dropping to an empty q.
  : (p.k === "colgrid" || p.kind === "colgrid") ? `(kind: "colgrid", ${colgridArg(p)})`
  : `(kind: "q", q: ${S(p.q)}, qseg: ${segArr(p.qseg || [])}, a: ${S(p.a)}, aseg: ${segArr(p.aseg || [])}, marker: ${S(p.marker || "")}, depth: ${p.depth || 0})`);

// Mixed box body: paragraphs, sub-headings, list items, images and nested
// tables, in order. (Sub-headings/list items appear when a flowing section — a
// primary Teacher's Guide activity — is boxed after import.)
// Mark sub-lists inside a box body. Authors write a question ("2. Copy the following
// words…") and then answer options as a SEPARATE Word list, which restarts at 1. Word
// keeps both at outline level 0 (only the numId differs), so nothing in the manuscript
// says "nested" — but a numbered list that restarts at 1 directly under an earlier
// numbered item is, in reading terms, that item's sub-list. Indent it one step so it
// sits under its question instead of looking like a sibling.
function markSubLists(blks) {
  // classify a list marker: a number ("1.", "(2)"), a letter ("a)", "b.") or bullet.
  const parse = (b) => {
    const mk = ((b && b.marker) || "").trim();
    let m;
    if ((m = mk.match(/^\(?(\d+)[.)]?$/))) return { kind: "num", n: +m[1] };
    if ((m = mk.match(/^\(?([A-Za-z])[.)]?$/))) return { kind: "alpha", n: m[1].toLowerCase().charCodeAt(0) - 96 };
    return null;
  };
  const isList = (b) => b && (b.t === "listitem" || (b.t === "para" && b.marker && b.isList));
  // only a heading or a fresh box resets the grouping; a plain paragraph, image or
  // table can sit between a question and its options ("Look at the picture" + image
  // + a/b/c) without ending the question.
  // A short, fully-BOLD paragraph is a run-in sub-heading — "Individual Work",
  // "Group Work", "Task 2: Extracting a Compressed Folder" — even though it never
  // became a real heading block, and it ends the list above it exactly as a heading
  // would. Without this, an activity's second list was read as a sub-list of its
  // first and indented one level, leaving two sibling lists in one box at different
  // left edges. This catches what the numId/depth test below cannot: the ICT Form 2
  // Teacher's Guide writes one activity's "Individual Work" list at Word ilvl 0 and
  // its "Group Work" list at ilvl 1, so by depth alone the second looks nested.
  // Requires EVERY run to be bold, so a bold lead-in on ordinary prose
  // ("Teacher's Role: Provide each learner with…") is not mistaken for a heading.
  const boldHead = (b) => {
    if (!b || b.t !== "para" || !Array.isArray(b.segs) || !b.segs.length) return false;
    const txt = b.segs.map((s) => s.t || "").join("").trim();
    if (!txt || txt.length > 60) return false;
    return b.segs.every((s) => !(s.t || "").trim() || s.b);
  };
  const breaks = (b) => b && (b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t)
    || b.t === "framedsection" || b.t === "activity" || b.t === "box"|| boldHead(b));
  // A "1." arriving while a top-level list is still open is USUALLY a sub-list
  // restarting underneath it ("1. … a) … 1. 2."). It is NOT when Word says the item
  // belongs to a different numbered list (its own numId) and that list is not
  // NESTED under the open one. A Teacher's Guide activity does this constantly: an
  // "Individual Work" run of 1., 2., 3., a bold lead-in, then a "Group Work" run
  // that starts again at 1. Treating the second run as a sub-list indented it one
  // level, so two top-level lists in the same box marched down the page at
  // different left edges.
  //
  // Depth is compared RELATIVELY (`lvl <= topLvl`), never against zero. Word's ilvl
  // is not a reliable absolute in hand-built manuscripts: the ICT Form 2 Teacher's
  // Guide writes one activity's two lists at ilvl 0 and the next activity's two at
  // ilvl 1, both meaning "top level here". What does hold either way is that a
  // genuinely nested list sits DEEPER than the list it hangs off, so an item no
  // deeper than the open top-level run is a sibling list, not a child of it.
  const newList = (b, topId, topLvl) => b.numId != null && topId != null
    && b.numId !== topId && (b.lvl == null || topLvl == null || b.lvl <= topLvl);
  let top = 0;   // last TOP-level number seen (0 = none / reset)
  let sub = 0;   // last sub-level index (numeric value or letter position); 0 = not in a sub-list
  let topId = null, topLvl = null;   // Word numId/ilvl of the open top-level list
  for (const b of blks) {
    if (!b || typeof b !== "object") continue;
    if (!isList(b)) { if (breaks(b)) { top = 0; sub = 0; topId = null; topLvl = null; } continue; }
    const p = parse(b);
    if (!p) { if (top > 0) b._sub = 1; continue; }                 // a bullet under a numbered parent is a sub-item
    if (p.kind === "alpha") {                                       // letters are always the sub level
      if (top > 0 || sub > 0) { b._sub = 1; sub = p.n; }
      continue;
    }
    if (sub > 0 && p.n === sub + 1) { b._sub = 1; sub = p.n; continue; }   // continues a numeric sub-list
    if (top > 0 && p.n === 1 && !newList(b, topId, topLvl)) { b._sub = 1; sub = 1; continue; }   // numeric sub-list restarting at 1
    top = p.n; sub = 0;                                                    // a top-level item
    if (b.numId != null) { topId = b.numId; topLvl = b.lvl != null ? b.lvl : null; }
  }
  return blks;
}

const bodyArr = (blks) => arr(markSubLists(blks), (b) =>
  b.t === "table" ? `(k: "table", r: ${rowArr(b.rows)}${b.noHeader ? ", nohdr: true" : ""})`
  : (b.t === "img" || b.t === "imagerow") ? `(k: "img", images: ${imgArr(b.images)})`
  : b.t === "image" ? `(k: "img", images: ${imgArr([{ file: b.file, w: b.w, tall: b.tall, caption: b.caption, hmm: b.hmm }])})`
  : (b.t === "head" || b.t === "label" || b.t === "h3") ? `(k: "head", t: ${S(b.text || "")}${b.align === "center" ? ", center: true" : ""})`
  : b.t === "figcaption" ? `(k: "para", s: ${segArr([{ t: b.text || "", b: false, it: false, c: null }])})`
  : b.t === "listitem" ? `(k: "list", marker: ${S(b.marker || "•")}, s: ${segArr(b.segs)}${b._sub ? `, indent: ${b._sub}` : ""})`
  // a paragraph the writer made a real Word list item (a numbered activity question
  // or a bullet) keeps its marker instead of flattening to a plain line.
  : (b.t === "para" && b.marker && b.isList) ? `(k: "list", marker: ${S(b.marker)}, s: ${segArr(b.segs)}${b._sub ? `, indent: ${b._sub}` : ""})`
  : (b.k === "colgrid" || b.t === "colgrid") ? `(k: "colgrid", ${colgridArg(b)})`
  : b.t === "colsum" ? `(k: "colsum", rows: ${strArr(b.rows || [])}, answer: ${strArr(b.answerRows || [])})`
  : `(k: "para", s: ${segArr(b.segs || [])})`);

// Tolerates the colon landing on either side of the number ("TOPIC 1.4: Title" —
// the house form — as well as a manuscript that instead types "TOPIC: 1.4 Title").
const TOPIC_RE = /^TOPIC\s*:?\s*([\d.]+)\s*:?\s*(.+)$/i;

// A paragraph that is PURELY worked math (every segment is an equation) — the
// continuation lines of a numbered solution step, which should indent under it.
const isPureMath = (b) => (b.t === "para") && Array.isArray(b.segs) && b.segs.length > 0
  && b.segs.every((s) => s && s.m) && !b.align;

function emit(blocks) {
  let out = "";
  // Tracks whether the current run still belongs under a numbered list item, so a
  // following stand-alone equation is indented under that step rather than reset to
  // the left margin. A numeric/lettered marker opens the run; a pure-math paragraph
  // continues it; anything else closes it.
  let underStep = false;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const nextB = blocks[bi + 1];
    // A figure directly follows this block? Used to keep a short label with its
    // picture. Restricted to genuine figure LABELS — "(a) Histogram", "Fig 2:",
    // "Diagram B" — because a lesson/section heading stuck to a tall illustration
    // drags the whole group to the next page and leaves a near-empty page behind
    // the unit banner (the heading is already `sticky` in its own right).
    const FIGLABEL = /^(\(?[a-z]\)|fig(ure)?\.?\s*\d+|diagram\s*\w?|table\s*\d+|picture\s*\d+)\b/i;
    const nextIsImg = nextB && (nextB.t === "image" || nextB.t === "imagerow");
    const stickyWrap = (s) => `#block(sticky: true)[${s.trim()}]\n`;
    // Indent a pure-math continuation under the numbered step it belongs to.
    if (underStep && isPureMath(b)) { out += `#contmath(${segArr(b.segs)})\n`; continue; }
    if (b.t === "listitem" && b.marker && b.marker !== "•") underStep = true;
    else if (b.t !== "vspace" && b.t !== "pagebreak") underStep = false;
    switch (b.t) {
      case "cover": {
        const logo = b.logo ? `(file: ${S(b.logo.file)})` : "none";
        const hero = b.hero ? `(file: ${S(b.hero.file)}, w: ${b.hero.w || 0}, h: ${b.hero.h || 0})` : "none";
        out += `#cover(${strArr(b.lines)}, ${strArr(b.byline || [])}, ${hero}, ${logo}, ${b.isbn ? S(b.isbn) : "none"}, finished: ${b.finished ? "true" : "false"})\n`; break;
      }
      case "toc": out += `#tableofcontents()\n`; break;
      case "titlepage": {
        const hero = b.hero ? `(file: ${S(b.hero.file)})` : "none";
        const logo = b.logo ? `(file: ${S(b.logo.file)})` : "none";
        out += `#titlepage(${strArr(b.lines || [])}, ${strArr(b.byline || [])}, hero: ${hero}, logo: ${logo})\n`; break;
      }
      case "imprint": out += `#imprint(${S(String(b.year || ""))}, ${b.isbn ? S(b.isbn) : "none"})\n`; break;
      case "divider": out += `#divider(${S(b.text || "")})\n`; break;
      // pagebreak FIRST so the counter/numbering reset lands on the NEW page, not
      // the trailing previous one. Roman counting begins (silently) on the title
      // page = i; it becomes VISIBLE at the first prose front-matter page (so the
      // title/copyright/contents pages count as i, ii, iii… but print no number,
      // and e.g. The Authors lands on v); the body restarts arabic at 1 on Unit 1.
      case "titlestart": out += `#pagebreak(weak: true)\n#counter(page).update(1)\n#set page(numbering: "i")\n`; break;
      // the prose front matter (Authors onward) gets a clear gap between
      // paragraphs; applied here (not on the title page, whose designed title
      // block must keep its own spacing) and reset to normal at the first unit.
      case "showpage": out += `#pagebreak(weak: true)\n#pgvisible.update(true)\n#set par(spacing: ${b.spacing || "1.9em"})\n`; break;
      case "bodystart": out += `#pagebreak(weak: true)\n#counter(page).update(1)\n#set page(numbering: "1")\n#set par(spacing: 0.86em)\n`; break;
      case "sigspace": out += `#sigspace()\n`; break;
      case "signature": out += `#signature(${arr(b.lines, (l) => `(text: ${S(l.text)}, bold: ${l.bold ? "true" : "false"})`)})\n`; break;
      case "backcover": out += `#backcover(${strArr(b.lines || [])}, ${b.logo ? `(file: ${S(b.logo.file)})` : "none"}, ${b.isbn ? S(b.isbn) : "none"})\n`; break;
      case "h1": {
        const m = b.text.match(TOPIC_RE);
        if (m) out += `#topicbanner(${S(m[1].replace(/\.+$/, ""))}, ${S(m[2].trim())}, ${S(b.text)})\n`;
        else out += `#sectionhead(${S(b.text)})\n`;
        break;
      }
      case "h2": out += `#subhead(${S(b.text.replace(/^Sub[-\s‐-―]*Topic\s*:?\s*/i, "Sub-Topic ").replace(/^(Sub-?Topic\s+\d+(?:\.\d+)*)\.(\s)/i, "$1$2"))}${b.nobreak ? ", nobrk: true" : ""})\n`; break;
      case "h3": case "head": {
        // A head marked as a styled (but page-break-free, un-outlined) section — e.g. a
        // front-matter ACRONYMS / COMPETENCES heading that must share the page below the
        // table it follows — renders with the section-heading look, not a plain sub-head.
        if (b.styleSection) { out += `#sectionhead(${S(b.text)}, brk: false, outlined: false)\n`; break; }
        const h = `#head(${S(b.text)}${b.align === "center" ? `, al: "center"` : ""}${b.black ? `, black: true` : ""}${b.headColor ? `, col: ${S(b.headColor)}` : ""})\n`;
        // A short figure label ("(a) Histogram", "Figure 1") right before its picture
        // must not be orphaned at a page break — stick it to the image that follows.
        out += (nextIsImg && FIGLABEL.test((b.text || "").trim()) && (b.text || "").trim().length <= 60) ? stickyWrap(h) : h;
        break;
      }
      case "pagebreak": out += `#pagebreak(weak: true)\n`; break;
      case "label": out += `#lbl(${S(b.text)}${b.labelColor ? `, col: ${S(b.labelColor)}` : ""})\n`; break;
      case "para": {
        const p = `#para(${segArr(b.segs)}${b.align ? `, align: ${S(b.align)}` : ""}${b.drop ? `, drop: true` : ""}${b.hyphenate === false ? `, hyphenate: false` : ""}${b.sylIndent ? `, indent: true` : ""})\n`;
        // Same for a short label paragraph (e.g. "(b) Frequency Polygon") sitting just
        // above its diagram — keep the two on the same page.
        const plain = (b.segs || []).map((s) => s.t || "").join("").trim();
        out += (nextIsImg && FIGLABEL.test(plain) && plain.length > 0 && plain.length <= 60) ? stickyWrap(p) : p;
        break;
      }
      case "colsum": out += `#colsum(${strArr(b.rows || [])}, ${strArr(b.answerRows || [])})\n`; break;
      case "numbond": out += `#numbond(${S(b.whole)}, ${S(b.a)}, ${S(b.b)})\n`; break;
      case "vspace": out += `#v(${b.h || "6mm"})\n`; break;
      case "listitem": out += `#listitem(${segArr(b.segs)}, ${S(b.marker || "•")})\n`; break;
      case "figcaption": out += `#figcaption(${S(b.text)})\n`; break;
      case "loentry": out += `#loentry(${S(b.num)}, ${S(b.title)}, ${S(b.page)})\n`; break;
      case "image": {
        // Keep a picture with the heading that titles it. Only a SUB-heading (h3/head)
        // counts: sticking an image to the next lesson/unit heading (h1/h2) dragged the
        // image and that heading onto the following page together, leaving the unit
        // banner alone on a near-empty page. A picture belongs with the heading ABOVE
        // it; the heading below starts new material and can break freely.
        // A LARGE picture is never made sticky: the heading below it is itself sticky
        // to its own content, so the chain (image + heading + body) grows taller than
        // a page and migrates as a unit, stranding the unit banner on a near-empty
        // page. Only a small picture — one that plausibly shares a page with the
        // heading it titles — is pinned.
        const nb = nextB;
        const big = (b.w || 0) >= 400 || b.tall;
        const sticky = !big && nb && (nb.t === "head" || nb.t === "h3" || nb.t === "para");
        out += `#figimg(${S("_media/" + b.file)}, ${b.w || 0}, ${b.tall ? "true" : "false"}, ${b.caption ? S(b.caption) : "none"}, sticky: ${sticky ? "true" : "false"}, hmm: ${b.hmm || 0})\n`; break;
      }
      case "imagerow": out += `#imagerow(${imgArr(b.images)})\n`; break;
      case "sidefig": out += `#sidefig(${S(b.side)}, ${b.frac || 0.4}, ${imgArr(b.images)}, ${bodyArr(b.body)})\n`; break;
      case "activity": out += `#activity(${titleContent(b.title, b.titleSegs)}, ${bodyArr(b.body)}, force: ${b.forceFreshPage ? "true" : "false"})\n`; break;
      case "fact": out += `#fact(${bodyArr(b.body)})\n`; break;
      case "keypoints": out += `#keypoints(${b.title ? titleContent(b.title, b.titleSegs) : "none"}, ${strArr(b.points)})\n`; break;
      case "exercise": out += `#exercise(${titleContent(b.heading, b.headingSegs)}, ${partsArr(b.parts || [])}, force: ${b.forceFreshPage ? "true" : "false"})\n`; break;
      case "assessment": out += `#assessment(${titleContent(b.title, b.titleSegs)}, ${strArr(b.intro || [])}, ${partsArr(b.parts || [])}, ${strArr(b.extra || [])}, force: ${b.forceFreshPage ? "true" : "false"})\n`; break;
      case "box": out += `#genericbox(${bodyArr(b.body)})\n`; break;
      case "framedsection": out += `#framedsection(${S(b.kind)}, ${S(b.title)}, ${bodyArr(b.body)})\n`; break;
      case "lessonmeta": out += `#lessonmeta(${S(b.title)}, ${bodyArr(b.body)})\n`; break;
      case "table": out += `#dtable(${rowArr(b.rows)}${b.noHeader ? ", noHeader: true" : ""})\n`; break;
      case "colgrid": out += `#colgrid(${colgridArg(b)})\n`; break;
      default: break;
    }
  }
  return out;
}

module.exports = { S, arr, zwspBlanks, segArr, strArr, titleContent, colgridArg, EMPTY_CELL, cellImgs, cellArr, normRows, rowArr, imgArr, partsArr, markSubLists, bodyArr, TOPIC_RE, isPureMath, emit };
