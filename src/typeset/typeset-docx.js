// Generic "drop a .docx, get a typeset PDF" runner.
//
//   node src/typeset/typeset-docx.js "path/to/file.docx"          # one file
//   node src/typeset/typeset-docx.js                              # scan folders
//   node src/typeset/typeset-docx.js "file.docx" --theme tech     # pick a palette
//
// It reads any (non-typeset) Word document with import-docx.js, emits Typst
// markup against generic-template.typ (styled by a theme from themes.js), and
// compiles a clean, professionally laid-out PDF into output/.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { NodeCompiler } = require("@myriaddreamin/typst-ts-node-compiler");
const { importDocx } = require("./import-docx.js");
const { THEMES, autoTheme, themeTypst } = require("./themes.js");
const { enhanceLineArt, cropImage, emfToPng } = require("./image-enhance.js");

const ROOT = path.join(__dirname, "..", "..");
const INPUT_DIRS = [path.join(ROOT, "input"), path.join(ROOT, "books-to-typeset")];
const OUTPUT_DIR = path.join(ROOT, "output");

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
  s.m ? `(m: true, display: ${s.display ? "true" : "false"}, t: ${S(s.t)})`
      : `(t: ${S(zwspBlanks(s.t))}, b: ${s.b ? "true" : "false"}, it: ${s.it ? "true" : "false"}, c: ${s.c ? S(s.c) : "none"}${s.u ? ", u: true" : ""}${s.hw ? ", hw: true" : ""}${s.mono ? ", mono: true" : ""})`);

const strArr = (a) => arr(a, S);
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
  const breaks = (b) => b && (b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t)
    || b.t === "framedsection" || b.t === "activity" || b.t === "box");
  let top = 0;   // last TOP-level number seen (0 = none / reset)
  let sub = 0;   // last sub-level index (numeric value or letter position); 0 = not in a sub-list
  for (const b of blks) {
    if (!b || typeof b !== "object") continue;
    if (!isList(b)) { if (breaks(b)) { top = 0; sub = 0; } continue; }
    const p = parse(b);
    if (!p) { if (top > 0) b._sub = 1; continue; }                 // a bullet under a numbered parent is a sub-item
    if (p.kind === "alpha") {                                       // letters are always the sub level
      if (top > 0 || sub > 0) { b._sub = 1; sub = p.n; }
      continue;
    }
    if (sub > 0 && p.n === sub + 1) { b._sub = 1; sub = p.n; continue; }   // continues a numeric sub-list
    if (top > 0 && p.n === 1) { b._sub = 1; sub = 1; continue; }           // numeric sub-list restarting at 1
    top = p.n; sub = 0;                                                    // a top-level item
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
const TOPIC_RE = /^TOPIC\s+([\d.]+)\s*:?\s*(.+)$/i;

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
        out += `#cover(${strArr(b.lines)}, ${strArr(b.byline || [])}, ${hero}, ${logo}, ${b.isbn ? S(b.isbn) : "none"})\n`; break;
      }
      case "toc": out += `#tableofcontents()\n`; break;
      case "titlepage": out += `#titlepage(${strArr(b.lines || [])}, ${strArr(b.byline || [])})\n`; break;
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
      case "h2": out += `#subhead(${S(b.text.replace(/^Sub[-\s‐-―]*Topic\s*/i, "Sub-Topic ").replace(/^(Sub-?Topic\s+\d+(?:\.\d+)*)\.(\s)/i, "$1$2"))})\n`; break;
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
        const p = `#para(${segArr(b.segs)}${b.align ? `, align: ${S(b.align)}` : ""}${b.drop ? `, drop: true` : ""})\n`;
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
      case "activity": out += `#activity(${S(b.title)}, ${bodyArr(b.body)}, force: ${b.forceFreshPage ? "true" : "false"})\n`; break;
      case "fact": out += `#fact(${bodyArr(b.body)})\n`; break;
      case "keypoints": out += `#keypoints(${b.title ? S(b.title) : "none"}, ${strArr(b.points)})\n`; break;
      case "exercise": out += `#exercise(${S(b.heading)}, ${partsArr(b.parts || [])}, force: ${b.forceFreshPage ? "true" : "false"})\n`; break;
      case "assessment": out += `#assessment(${S(b.title)}, ${strArr(b.intro || [])}, ${partsArr(b.parts || [])}, ${strArr(b.extra || [])}, force: ${b.forceFreshPage ? "true" : "false"})\n`; break;
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

// A clean running-header title. Prefer the cover's subject line(s); otherwise
// clean the file name (drop anything after " - " and trailing codes/dates).
function deriveTitle(blocks, fallback) {
  const cover = blocks.find((b) => b.t === "cover");
  if (cover && cover.lines && cover.lines.length) {
    // e.g. ["TECHNOLOGY STUDIES", "GRADE 4", "LEARNER'S BOOK"] -> "Grade 4 Technology Studies"
    const subject = cover.lines[0];
    const grade = cover.lines.find((l) => /\bgrade\s+\d/i.test(l));
    const t = grade ? `${grade} ${subject}` : subject;
    return titleCase(t);
  }
  return titleCase(fallback.split(/\s+-\s+/)[0].replace(/[_\d]+\s*(LB|TB)?\s*$/i, "").trim());
}
function titleCase(s) {
  const small = new Set(["and", "of", "the", "in", "to", "for", "a"]);
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// For the ZEPH "series" layout, restructure the front matter to match the house
// style: a repeated title page after the cover (where silent roman counting
// begins at i), then the Table of Contents, then the prose front matter where
// the roman number becomes visible (so The Authors lands on ~v), then the body
// restarting at arabic page 1 on the first unit. Also leaves room for a hand
// signature above the signatory's name on Foreword/Preface/Acknowledgements.
// Wrap each Learning Activity / Exercise / End-of-Topic Assessment (and its
// following content) in a bordered box. Used for primary Teacher's Guides whose
// writers left these as plain flowing text. A box starts at an activity/exercise/
// assessment heading and runs until the next such heading, the next topic/
// sub-topic, or a fresh content heading — internal labels (Teaching and Learning
// Materials, Teacher Facilitation Procedure, Teacher Notes, …) stay inside it.
function boxifyActivities(blocks, opts = {}) {
  // `looseStarts` (per-book): also treat a `para`/`listitem`/`h2` block as an
  // activity/exercise/assessment box START (not just a real head/label) and absorb a
  // single content sub-heading the manuscript placed right under the title. For books
  // whose author left activities as plain paragraphs or coloured sub-heads.
  // `mergeColon` (per-book): a bare "ACTIVITY N" title pulls the box's first short
  // instruction line up into the title as "ACTIVITY N: <instruction>".
  // `boxHeads` (per-book): [{find, kind}] — extra heading texts that START a box even
  // though they are not the usual ACTIVITY/EXERCISE/ASSESSMENT words (e.g. a Grade-2
  // "Dictation (Spelling)" strand that should box its following blanks). Default kind
  // is "ex". Matched on exact trimmed plain text.
  const { looseStarts = false, mergeColon = false, boxHeads = [] } = opts;
  const boxHeadMap = new Map(boxHeads.map((h) => [String(h.find).replace(/\s+/g, " ").trim(), h.kind || "ex"]));
  // Real section headings are ALL-CAPS and either numbered ("EXERCISE 1",
  // "LEARNING ACTIVITY 2") or the whole line is the assessment title
  // ("END-OF-TOPIC ASSESSMENT"). This must NOT match glossary entries like
  // "Exercise – Physical activity…" or "Assessment – A method…" (Title-case, a
  // dash, then a definition).
  // English plus local-language "learning activity" labels (Lunda: Zhakwila,
  // Bemba: Ifyakucita, Nyanja: Nchito, Silozi: Musebezi, Luvale: Vyakulinga,
  // Tonga: Cakucita, Kaonde: Mwingilo wakuuba) — a numbered activity heading the
  // manuscript left un-boxed, so it becomes a titled activity box (T.act colour).
  const ACT = /^(LEARNING\s+(ACTIVITY|MODELS?)|LEARNING|ACTIVITY|MODELS?|Zhakwila(\s+atudizi)?|Ifyakucita|Nchito|Musebezi|Vyakulinga|Cakucita|Mwingilo\s+wakuuba)\s+\d/i;
  // "EXERCISE 1" or a bare "Exercise" (many Learner's Books number neither), or a
  // plural range heading ("EXERCISES 1 - 4") some books use instead — the isDefn
  // guard below still excludes a glossary line like "Exercise – Physical…". No \b
  // after "EXERCISE" alone: it would also require a boundary before a literal "S",
  // and "E"/"S" are both word characters, so "EXERCISES" would never match.
  const EX = /^EXERCISES?\b/i;
  // "END-OF-TOPIC ASSESSMENT", "TOPIC ASSESSMENT", "ASSESSMENT [N]" — nothing
  // (except an optional number/colon) may follow, so a "Assessment – …" glossary
  // line is excluded. Also accepts "(END OF) TOPIC EXERCISE" — a whole-topic wrap-up
  // some books title "Exercise" instead of "Assessment"; it must box to the topic end
  // exactly like an assessment (a BARE "EXERCISE" is still a normal lesson exercise,
  // caught earlier by EX, since the TOPIC prefix is required for the exercise variant).
  // Also accepts UNIT as well as TOPIC ("End of Unit Assessment", the wording used
  // in the primary Learner's Books) and a plural "Assessments" — without those the
  // heading was not recognised and the whole end-of-unit section stayed un-boxed.
  const ASMT = /^(((END[\s-]*OF[\s-]*)?(TOPIC|UNIT)[\s-]*)?ASSESSMENTS?|(END[\s-]*OF[\s-]*)?(TOPIC|UNIT)[\s-]*EXERCISE)(\s+\d+)?\s*:?\s*$/i;
  // a glossary definition line ("Term – meaning") is never a box heading
  const isDefn = (t) => /\s[–-]\s/.test(t);
  // A Teacher's Guide answer section ("Exercise – Expected Answers", "Assessment –
  // Expected Responses") reads like a "Term – meaning" glossary line to isDefn, but is
  // really an exercise box that should frame the answers below it. Recognise it FIRST,
  // tolerating the dash type, plural/typo forms ("Exercises", "EXERCSE"), case and a
  // trailing period, so every answer key is boxed like the other exercises.
  const EXPECT = /^(EXERC\w*|ASSESSMENTS?)\s*[–—-]\s*EXPECTED\s+(ANSWER|RESPONSE)/i;
  const kindOf = (t) => (EXPECT.test(t) ? "ex" : isDefn(t) ? null : ACT.test(t) ? "act" : EX.test(t) ? "ex" : ASMT.test(t) ? "asmt" : null);
  const INTERNAL = /^(teaching and learning materials|teacher.?s?\s*facilitation procedure|facilitation procedure|teacher.?s?\s*notes?|take note of responses|expected responses?|possible answers?|materials?|answers?|procedure)\b/i;
  // The recurring teaching PHASES inside a single activity (the 3Ps / lesson-cycle
  // structure: Introduction, Presentation/Present, Practice, Production/Produce,
  // Conclusion, plus common variants). They are sub-steps of ONE activity, not a new
  // section, so an "act" box must ABSORB them and keep running to the next real
  // activity/topic/lesson — otherwise the box ends at the first phase heading and the
  // rest of the activity spills out unboxed.
  const ACTPHASE = /^(introduction|presentation|present|practi[sc]e|production|produce|conclusion|development|application|reflection|closure|warm[\s-]?up|starter|plenary|main\s+activity|lesson\s+development)\s*:?\s*$/i;
  // An "ALTERNATIVE (LEARNING) ACTIVITY: …" heading (e.g. "…: INDIVIDUAL WORK") is an
  // extension of the SAME activity for learners working alone — it must stay inside the
  // box above it, not end it and float out as a stray heading.
  const ALTACT = /^ALTERNATIVE\s+(LEARNING\s+)?ACTIVIT/i;
  const BACKMATTER = /^(GLOSSARY|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX|ACRONYMS)\b/i;
  const isHead = (b) => b && (b.t === "head" || b.t === "label");
  const ht = (b) => (b.text || "").trim();
  // A pre-built box / already-framed block (from the importer or an earlier pass): its
  // presence always ENDS an open box — the orphan content before it belongs to the box,
  // but the box itself is a sibling, never absorbed.
  const BOXBLOCK = new Set(["exercise", "activity", "assessment", "framedsection", "keypoints", "fact", "box"]);
  // The text used to test whether a block STARTS a box. Real heads/labels use their
  // .text; with looseStarts a paragraph/list-item/sub-head uses its plain text so an
  // activity the author typed as body text ("Activity 1: …") or a coloured sub-head
  // ("ACTIVITY", an h2) is still recognised.
  const startText = (b) => {
    if (b.t === "head" || b.t === "label") return (b.text || "").trim();
    if (looseStarts && (b.t === "h2" || b.t === "para" || b.t === "listitem")) return blockPlain(b).trim();
    return null;
  };
  // A bold "header" the manuscript styled INLINE (a bold paragraph, not a real
  // heading) — a local-language topic/sub-topic ("MUTU WANSAÑU: 1.2.4") or a
  // numbered section opener ("1.2 KUTAÑA"). It begins a new section, so it must
  // end an activity box rather than be swallowed as activity content.
  // Match the local-language sub-topic keyword ("MUTU WANSAÑU …") or a numbered
  // section opener whose number is followed by an UPPER-CASE title ("1.2 KUTAÑA") —
  // case-sensitive so an English numbered list item ("2.1 apples") never matches.
  const HEADPARA = /^(MUTU\s+WANSAÑU|MUTU\s+WAUNG['’]ONO|\d+\.\d+\.?\s+[A-ZÑ])/;
  const isHeaderPara = (b) => (b.t === "para" || b.t === "listitem")
    && (b.segs || []).some((s) => s.b) && HEADPARA.test((b.segs || []).map((s) => s.t).join("").trim());
  // A lesson/strand banner ("READING AND WRITING: LESSON 2", "LISTENING AND
  // SPEAKING: LESSON 1") always begins a NEW lesson section, so it must close an
  // open activity/exercise box even when the manuscript styled it as a bold
  // paragraph rather than a real heading. Without this the next lesson's banner
  // is swallowed into the previous exercise's box and reads as "missing".
  const LESSONBANNER = /^.+?:\s*LESSON\s+\d+\s*$/i;
  const isLessonBanner = (b) => LESSONBANNER.test(blockPlain(b).trim());
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // A boxHead (per-book) starts a box regardless of the usual keyword patterns.
    const bhKey = (b.t === "head" || b.t === "label" || b.t === "h2" || b.t === "h3" || b.t === "para")
      ? blockPlain(b).replace(/\s+/g, " ").trim() : null;
    const bhKind = bhKey && boxHeadMap.has(bhKey) ? boxHeadMap.get(bhKey) : null;
    const st = bhKind ? blockPlain(b).trim() : startText(b);
    let k = bhKind || (st ? kindOf(st) : null);
    // The length guard stops a long prose paragraph being mistaken for a bare-word
    // box start ("Exercise …", "Assessment …"). An "ACTIVITY N:" prefix is
    // distinctive enough that a long activity title (a full instruction sentence,
    // e.g. "Activity 1: Stating different religious groups that use …") is still a
    // genuine box start, so the cap is waived for the "act" kind only. A boxHead is
    // an explicit per-book opt-in, so it is never length-capped.
    if (k && !bhKind && k !== "act" && st.length > 90) k = null;
    if (!k) { out.push(b); continue; }
    const body = [];
    let j = i + 1;
    // A "Read the story/passage/poem…" activity is followed by the passage itself —
    // a story TITLE heading plus its paragraphs. Once the box's instruction says to
    // read a passage, a following NON-box content heading (the story title) is part
    // of the passage, not the start of a new section, so the box absorbs it instead
    // of ending. Only for act/ex boxes, and never past a real topic (h1), a lesson
    // banner, a header-para, back matter, or the next box.
    let readmode = false;
    // Set once the "ALTERNATIVE …ACTIVITY" heading has been absorbed and its single
    // instruction line pushed — general reinforcement prose that follows (no heading of
    // its own) is regular body text, not part of the alternative activity, so the box
    // must stop there rather than swallowing it indefinitely.
    let altActDone = false;
    let altActPending = false;
    while (j < blocks.length) {
      const y = blocks[j];
      if (altActDone) break;
      if (BOXBLOCK.has(y.t)) break;                                  // a pre-built box (exercise/activity/…) always ends this one
      if (isLessonBanner(y)) break;                                  // "<STRAND>: LESSON N" always starts a new lesson
      if (isHeaderPara(y)) break;                                    // a bold inline section header
      if (isHead(y) && BACKMATTER.test(ht(y))) break;               // never absorb back matter (GLOSSARY/
      //   REFERENCES/…) into a box — even an "End of Topic Assessment" that otherwise runs to the topic
      //   end. Left inside the box these headings escape the primary-LB scaffold strip (which only scans
      //   TOP-LEVEL blocks); broken out here, they become top-level headings the strip can remove.
      // leadAbsorb: when a loose para/h2 activity/exercise title is immediately
      // followed by ITS content sub-heading ("Read and blend the words",
      // "Recite the poem", …) and the box is still empty, pull that heading in as
      // the box's first line instead of letting it terminate the box before it starts.
      const contentHead = (y.t === "h2" || y.t === "h3" || (isHead(y) && !kindOf(ht(y))));
      const leadAbsorb = body.length === 0 && (k === "act" || k === "ex") && contentHead;
      const passageHead = readmode && (k === "act" || k === "ex")
        && (y.t === "h2" || y.t === "h3" || (isHead(y) && !kindOf(ht(y))));
      // a teaching-phase sub-heading (Introduction / Present / Practice / Produce /
      // Conclusion …) is part of THIS activity — absorb it, don't end the box.
      const phaseHead = k === "act"
        && ACTPHASE.test((y.text || blockPlain(y) || "").trim())
        && (y.t === "h2" || y.t === "h3" || isHead(y)
          || ((y.t === "para" || y.t === "listitem") && (y.segs || []).some((s) => s.b)));
      const altActHead = (k === "act" || k === "ex")
        && ALTACT.test((y.text || blockPlain(y) || "").trim())
        && (y.t === "h2" || y.t === "h3" || isHead(y)
          || ((y.t === "para" || y.t === "listitem") && (y.segs || []).some((s) => s.b)));
      if (altActPending && !isHead(y)) { body.push(y); j++; altActDone = true; break; }
      if (!passageHead && !leadAbsorb && !phaseHead && !altActHead) {
        if (y.t === "h1" || y.t === "h2" || y.t === "h3") break;     // topic / sub-topic / sub-sub-heading
        if (isHead(y)) {
          const yt = ht(y);
          if (kindOf(yt)) break;                                     // the next box starts
          // Activities/exercises end at a fresh content heading. An "End of Topic
          // Assessment" runs to the END of the topic, though — its interior SECTION
          // labels and little matching-table headers ("Organ Work", "Disease Symptom")
          // are part of the assessment, so only a real topic/sub-topic (h1/h2/h3), the
          // next box, or a header-paragraph ends it — never an inner sub-heading.
          if (k !== "asmt" && !INTERNAL.test(yt)) break;
        }
      }
      body.push(y);
      if (altActHead) altActPending = true;
      if (!readmode && (k === "act" || k === "ex") && READINSTR.test(blockPlain(y))) readmode = true;
      j++;
    }
    // mergeColon: fold a bare "ACTIVITY N" title's first short instruction line
    // up into the title as "ACTIVITY N: <instruction>".
    let title = st;
    if (mergeColon && /^(LEARNING\s+ACTIVITY|ACTIVITY|Activity)\s+\d+$/.test(title.trim()) && body.length) {
      // An instruction line the manuscript split off from "Activity 1" folds up: a
      // HEADING-styled sub-head, OR a short paragraph that reads as an imperative
      // instruction ("Read the words", "Blend the sounds…"). A plain paragraph that
      // is NOT an instruction is real content (a chant, an example) and stays in the
      // box body — so p32's "Story time, story time." is never pulled into the title.
      const INSTR = /^(Read|Write|Blend|Make|Recite|Tell|Say|Sort|Interpret|Work out|Match|Fill|Complete|Draw|Colou?r|Circle|Underline|Copy|Look|Listen|Sing|Answer|Choose|Name|Mention|Describe|Discuss|Act|Point|Count|Arrange|Spell|Trace|Join|Identify|Group|Practi[sc]e|Repeat|Study|Use|Find)\b/i;
      const f = body[0];
      const ft = blockPlain(f).trim();
      const headish = f.t === "h2" || f.t === "head" || f.t === "h3";
      const instrPara = (f.t === "para" || f.t === "listitem") && INSTR.test(ft);
      if ((headish || instrPara) && ft && ft.length <= 70 && !/^\d+[.)]/.test(ft)) {
        title = `${title.trim()}: ${ft}`;
        body.shift();
      }
    }
    out.push({ t: "framedsection", kind: k, title, body });
    i = j - 1;
  }
  return out;
}

// A manuscript sometimes repeats a short bold sub-heading on two consecutive
// paragraphs by mistake (a copy-paste slip, e.g. "First Aid" / "First Aid" back to
// back before the real intro sentence). Drop the immediate duplicate — same
// trimmed text (case-insensitively), both a heading-ish block (head/label/h2/h3) —
// keeping the first (it usually carries the more distinctive styling: colour/size).
function dedupeAdjacentHeadings(blocks) {
  const HEADISH = new Set(["head", "label", "h2", "h3"]);
  // When a manuscript types the same sub-topic name twice back-to-back at two
  // different styles (a plain bold line, then a properly styled Heading2/3), keep
  // the STRUCTURALLY STRONGER one — h2/h3, which get the sub-topic's real styling
  // AND count toward sequential numbering — not just whichever came first. Keeping
  // the weaker `head`/`label` copy left a sub-topic silently unstyled AND (since it
  // no longer counted) skewed every later sub-topic's number by one.
  const RANK = { h2: 2, h3: 2, head: 1, label: 1 };
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (prev && HEADISH.has(prev.t) && HEADISH.has(b.t)) {
      const a = (prev.text || "").trim().toLowerCase();
      const c = (b.text || "").trim().toLowerCase();
      if (a && a === c) {
        if ((RANK[b.t] || 0) > (RANK[prev.t] || 0)) out[out.length - 1] = b;
        continue; // skip the duplicate
      }
    }
    out.push(b);
  }
  return out;
}

// Some manuscripts style a craft/skill GROUP name ("Plaiting", "Weaving",
// "Educational Gymnastics (Tumbling and Stunts)") with Word's Heading1 — the same
// style as the real "TOPIC N: …" opener — even though it is really a sub-topic-level
// label, not a new unit. Left as h1 it wrongly (a) gets its own contents-page entry,
// bloating the TOC with dozens of non-topic names, and (b) forces an unwanted page
// break as if it were a fresh front-matter section. Two authoring patterns show up:
//  - the group h1 is immediately followed by an h2/h3 sub-topic heading with the
//    EXACT same text (the author typed the name twice, once as each level) — the h1
//    is a pure duplicate, so remove it outright.
//  - the group h1's exact text recurs LATER as its own heading again (repeated
//    before each of several sub-topics it covers, e.g. gymnastics before both
//    "Tumbling Activities" and "Simple Stunts Activities") — keep only the first
//    occurrence and remove the repeats.
// Anything else (no exact match either way) is demoted to h2 rather than removed, so
// its text is kept but it stops polluting the TOC / forcing a page break.
function fixStrayBodyH1s(blocks) {
  const UNIT = /^(TOPIC|UNIT|CHAPTER|CHIBALU|CIPATI)\b/i;
  const FRONTBACK = /^((THE\s+)?AUTHORS?|EDITORS?|FOREW(O|A)RD|PREFACE|ACKNOWLEDGEMENTS?|INTRODUCTION|HOW\s+TO\s+USE(\s+THIS\s+BOOK)?|KEY\s+COMPETEN\w*(\s+TO\s+BE\s+DEVELOPED)?|ACRONYMS|LIST\s+OF\s+(TABLES|FIGURES)|GLOSSARY(\s+OF\s+TERMS)?|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX|TABLE\s+OF\s+CONTENTS)$/i;
  const isStray = (b) => b.t === "h1" && !UNIT.test((b.text || "").trim()) && !FRONTBACK.test((b.text || "").trim());
  const seen = new Set();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!isStray(b)) continue;
    const t = (b.text || "").trim().toLowerCase();
    let nextH = null;
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j].t === "h1" || blocks[j].t === "h2" || blocks[j].t === "h3") { nextH = blocks[j]; break; }
    }
    const dupOfNext = nextH && (nextH.t === "h2" || nextH.t === "h3") && (nextH.text || "").trim().toLowerCase() === t;
    const dupOfEarlier = seen.has(t);
    if (dupOfNext || dupOfEarlier) { blocks.splice(i, 1); i--; continue; }
    seen.add(t);
    b.t = "h2";
  }
}

// A reviewer/editor sometimes leaves an instruction-to-self IN the manuscript instead
// of actually deleting the content ("FROM LEARNING ACTIVITY 1-3 DELETE COMPLETELY",
// "ACTIVITY 3 IS COMPLETELY REMOVED") — always red text, never meant for the printed
// book. Left in, its wording ("ACTIVITY 3…") can even fool the ACT/EX/ASMT box
// detector into treating the note itself as a new activity heading, swallowing real
// content that follows as its "body". Strip these notes out before boxing runs.
function stripEditorialComments(blocks) {
  const COMMENT = /\b(DELETE(D)?\s+COMPLETELY|COMPLETELY\s+(DELETE(D)?|REMOVE(D)?)|REMOVE(D)?\s+COMPLETELY|CHANGED?\s+THIS\s+PICTURE)\b/i;
  const isComment = (b) => {
    const t = (b.text || (b.segs ? b.segs.map((s) => s.t || "").join("") : "") || "").trim();
    return t.length > 0 && t.length < 100 && COMMENT.test(t);
  };
  const filterArr = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      if (isComment(b)) { arr.splice(i, 1); continue; }
      if (Array.isArray(b.body)) filterArr(b.body);
      if (Array.isArray(b.parts)) filterArr(b.parts);
    }
  };
  filterArr(blocks);
}

// An author occasionally leaves a whole passage in red text — leftover reviewer/draft
// formatting, never an intentional house style (the book has no other use of red for
// student-facing content). Reset it to the normal ink colour everywhere: top-level
// paragraphs/list items, box bodies/parts (exercise & assessment questions use
// qseg/aseg, not segs), and table cells.
function clearStrayRed(blocks) {
  const RED = /^FF0000$/i;
  const fixSegs = (segs) => { if (Array.isArray(segs)) for (const s of segs) if (s && RED.test(s.c || "")) s.c = null; };
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      fixSegs(b.segs);
      fixSegs(b.qseg);
      fixSegs(b.aseg);
      if (Array.isArray(b.rows)) {
        for (const row of b.rows) {
          if (!Array.isArray(row)) continue;
          for (const cell of row) if (cell && Array.isArray(cell.segs)) fixSegs(cell.segs);
        }
      }
      if (Array.isArray(b.body)) walk(b.body);
      if (Array.isArray(b.parts)) walk(b.parts);
    }
  };
  walk(blocks);
}

// Inside an activity/exercise box, an author frequently leaves the "SAFETY FIRST"
// notice and each "Step N:" instruction line un-bolded even though they read as
// mini sub-headers within the box — inconsistent with the boxes where the SAME
// phrases WERE bolded. Force them bold everywhere so every box reads consistently,
// scanning top-level blocks and recursing into box bodies/parts.
function boldSafetyAndSteps(blocks) {
  const SAFETY = /^SAFETY\s+FIRST$/i;
  const STEP = /^(Step\s+\d+\s*:)(\s*)/i;
  const ALTACTLINE = /^ALTERNATIVE\s+(LEARNING\s+)?ACTIVIT/i;
  const WHATTODO = /^WHAT\s+TO\s+DO$/i;
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if ((b.t === "para" || b.t === "listitem") && Array.isArray(b.segs)) {
        const plain = b.segs.map((s) => s.t || "").join("").trim();
        if (SAFETY.test(plain) || ALTACTLINE.test(plain) || WHATTODO.test(plain)) {
          for (const s of b.segs) s.b = true;
        } else if (STEP.test(plain)) {
          // bold only the "Step N:" marker, not the rest of the instruction —
          // split the first segment that carries it.
          const first = b.segs.find((s) => (s.t || "").trim());
          if (first && !first.b) {
            const m = first.t.match(STEP);
            if (m) {
              const idx = b.segs.indexOf(first);
              const markerSeg = { ...first, t: m[1], b: true };
              const restSeg = { ...first, t: first.t.slice(m[1].length) };
              b.segs.splice(idx, 1, markerSeg, restSeg);
            }
          }
        }
      }
      if (Array.isArray(b.body)) walk(b.body);
      if (Array.isArray(b.parts)) walk(b.parts);
    }
  };
  walk(blocks);
}

// Some manuscripts style a lesson banner ("LISTENING AND SPEAKING: LESSON 2") as
// a centred bold PARAGRAPH instead of a heading like its siblings. Left as a para
// it renders centred and — unlike a head — is not sticky, so it orphans at the
// foot of a page while its lesson content flows to the next. Convert any bold
// block whose whole text is a "<STRAND>: LESSON N" banner into a proper head so it
// matches the other lesson headings (left-aligned, sticky, ink-coloured).
function normaliseLessonBanners(blocks) {
  const RE = /^.+?:\s*LESSON\s+\d+\s*$/i;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== "para" && b.t !== "listitem") continue;
    const t = blockPlain(b).trim();
    if (t.length > 60 || !RE.test(t)) continue;
    if (!(b.segs || []).some((s) => s.b)) continue;   // only a bold banner, never plain body text
    blocks[i] = { t: "head", text: t };
  }
}

// Primary Teacher's Guides mark each unit inconsistently: some as a bare "UNIT N"
// banner with the theme split onto the next line ("THEME: Gender") or a following
// paragraph, some already combined ("UNIT 10: SPECIAL AND INCLUSIVE EDUCATION"), one
// as a mis-levelled sub-heading carrying a stray list number ("1. UNIT 11: DRUG…").
// Normalise every unit opener to ONE banner "UNIT N: Theme" — matching the Learner's
// Book — by pulling the theme up from the next block when it was split off and
// dropping the redundant "THEME:" word. Also promotes a mis-levelled unit banner to a
// real unit (h1) and demotes any OTHER stray body sub-heading (h2) to a plain lesson
// head, so the table of contents lists units only (no sub-topics), like the LB.
// Returns the numbers of units whose theme the manuscript never supplied (to flag).
function normaliseUnitHeads(blocks) {
  const UNITRE = /^\s*(?:\d+\.\s*)?UNIT\s+(\d+)\b\s*(.*)$/i;
  const isHeadish = (b) => b && (b.t === "h1" || b.t === "h2" || b.t === "h3" || b.t === "head" || b.t === "label");
  const missing = [];
  let seenUnit = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!isHeadish(b) || typeof b.text !== "string") continue;
    const m = b.text.match(UNITRE);
    if (m) {
      const num = m[1];
      let theme = (m[2] || "").trim().replace(/^[:\-–—]\s*/, "").replace(/^THEME\s*:\s*/i, "").trim();
      if (!theme) {
        // The theme was split onto a following block ("THEME: X" head/para). It is
        // usually the very next block, but some units slot a "WEEK 1" head between the
        // banner and the theme — so scan the next few blocks, skipping such heads, and
        // stop at real body content or the next unit so we never borrow another unit's.
        for (let j = i + 1; j <= i + 4 && j < blocks.length; j++) {
          const nb = blocks[j];
          const plain = blockPlain(nb).trim();
          if (UNITRE.test(plain)) break;                       // reached the next unit
          const tm = plain.match(/^THEME\s*:?\s*(.+)$/i);
          if (tm) { theme = tm[1].trim(); blocks.splice(j, 1); break; }
          if (!/^WEEK\s+\d+\b/i.test(plain)) break;            // real content — stop looking
        }
      }
      b.t = "h1";
      b.text = theme ? `UNIT ${num}: ${theme}` : `UNIT ${num}`;
      delete b.segs; delete b.marker; delete b.isList; delete b.numId; delete b.lvl; delete b.noPromote;
      if (!theme) missing.push(num);
      seenUnit = true;
      continue;
    }
    // any OTHER body sub-heading (h2) → a plain lesson head, so it stays off the
    // units-only contents page and matches the LB lesson styling. Also strip a stray
    // list "N." prefix and repair a colon-less strand banner ("STRAND LESSON 1").
    if (seenUnit && b.t === "h2") {
      let t = (b.text || "").replace(/^\s*\d+\.\s*/, "").trim();
      t = t.replace(/^(.+?)\s+(LESSON\s+\d+)\s*$/i, "$1: $2");
      b.t = "head"; b.text = t; delete b.segs; delete b.marker;
    }
  }
  return missing;
}

// Force each unit banner to a supplied theme (a map { "8": "HIV/AIDS", … }), overriding
// whatever the manuscript did. Used to SYNC a Teacher's Guide's unit themes to its Learner's
// Book when the TG manuscript formats themes inconsistently — a bare heading with no "THEME:"
// prefix, or no theme line at all. Runs AFTER normaliseUnitHeads. Also drops a stray duplicate
// theme heading the manuscript left right under the banner (e.g. a "DRUG AND SUBSTANCE ABUSE"
// Heading2 that had no "THEME:" prefix, so it would otherwise repeat as a body head).
function forceUnitThemes(blocks, map) {
  const UNITRE = /^\s*(?:\d+\.\s*)?UNIT\s+(\d+)\b\s*:?\s*(.*)$/i;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== "h1" || typeof b.text !== "string") continue;
    const m = b.text.match(UNITRE);
    if (!m) continue;
    const theme = map[m[1]];
    if (!theme) continue;
    b.text = `UNIT ${m[1]}: ${theme}`;
    const nb = blocks[i + 1];
    if (nb && (nb.t === "head" || nb.t === "h2") && typeof nb.text === "string"
        && nb.text.trim().toUpperCase() === String(theme).trim().toUpperCase()) {
      blocks.splice(i + 1, 1);
    }
  }
}

// A reading-lesson activity ("Activity 2: Read the story") is followed in the
// manuscript by the passage itself — a story TITLE (a `head`/h2/h3) plus its
// paragraphs. boxifyActivities normally ends an activity box at the next content
// heading, so only the "Read the story" instruction stays in the box while the
// story orphans as top-level text (often onto the next page). When a box's
// instruction matches this, its box is allowed to absorb the following passage
// title + body (see boxifyActivities).
const READINSTR = /\bread\b[^.]*\b(stor(y|ies)|passage|text|poem|paragraph|dialogue|conversation|letter|note|sentences?)\b/i;

function formatGrade3EngFrontMatter(blocks, detectName) {
  if (!/grade\s*3.*eng/i.test(detectName) && !/eng.*grade\s*3/i.test(detectName)) return;

  const covIdx = blocks.findIndex((b) => b && b.t === "cover");
  if (covIdx < 0) return;

  const imprintBlocks = [
    { t: "showpage" },
    { t: "para", segs: [{ t: "© Zambia Educational Publishing House, 2026.", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    {
      t: "para",
      segs: [{
        t: "All rights reserved. No part of this publication may be reproduced, stored in a retrieval system or transmitted in any form or any means, electronic, mechanical, photocopying, recording, or otherwise, without the prior written permission of the copyright owner or publisher.",
        b: false,
        it: false
      }],
      align: "center"
    },
    { t: "vspace", h: "3mm" },
    { t: "para", segs: [{ t: "ISBN ........", b: false, it: false }], align: "center" },
    { t: "vspace", h: "5mm" },
    { t: "para", segs: [{ t: "Edited by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Bridget Moya and Agness Mumba Wilkins", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    { t: "para", segs: [{ t: "Illustrated by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Njekwa Njekwa", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    { t: "para", segs: [{ t: "Cover and book layout by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Gift Kapula", b: false, it: false }], align: "center" },
    { t: "vspace", h: "5mm" },
    { t: "para", segs: [{ t: "First Published 2026 by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Zambia Educational Publishing House\nP. O. Box 32664\nLusaka, Zambia", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    { t: "para", segs: [{ t: "Printed by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Zambia Educational Publishing House\nLusaka, Zambia", b: false, it: false }], align: "center" },
    { t: "showpage" }
  ];

  const authorHeadIdx = blocks.findIndex((b) => b && (b.t === "h1" || b.t === "head") && /THE\s+AUTHOR/i.test(b.text || ""));

  if (authorHeadIdx > covIdx) {
    blocks.splice(covIdx + 1, authorHeadIdx - (covIdx + 1), ...imprintBlocks);
  }

  const newAuthorHeadIdx = blocks.findIndex((b) => b && (b.t === "h1" || b.t === "head") && /THE\s+AUTHOR/i.test(b.text || ""));
  if (newAuthorHeadIdx >= 0 && newAuthorHeadIdx + 1 < blocks.length) {
    const bioBlk = blocks[newAuthorHeadIdx + 1];
    let bioText = "";
    if (typeof bioBlk === "string") bioText = bioBlk;
    else if (bioBlk.text) bioText = bioBlk.text;
    else if (Array.isArray(bioBlk.segs)) bioText = bioBlk.segs.map((s) => s.t || "").join("");

    if (/Njekwa Njekwa/i.test(bioText)) {
      const colIdx = bioText.indexOf(":");
      const prefix = colIdx >= 0 ? bioText.slice(0, colIdx + 1) : "Njekwa Njekwa:";
      const restText = colIdx >= 0 ? bioText.slice(colIdx + 1) : bioText.replace(/Njekwa Njekwa:?/i, "");
      blocks[newAuthorHeadIdx + 1] = {
        t: "para",
        noPromote: true,
        segs: [
          { t: prefix, b: true, it: false, c: null },
          { t: restText, b: false, it: false, c: null }
        ]
      };
    }
  }
}

function applySeriesFront(blocks, { numberLessons = true, fmSpacing = "1.9em" } = {}, detectName = "") {
  formatGrade3EngFrontMatter(blocks, detectName);
  const isUnit = (x) => x.t === "h1" && /^(UNIT|TOPIC|CHAPTER|CHIBALU|CIPATI)\b/i.test(x.text || "");
  // Front-matter section names — English plus local-language equivalents
  // (e.g. Lunda: ANSONEKI=Authors, MAZU ATACHI=Foreword, KULEMA …WUNU=Preface,
  // KUSAKILILA=Acknowledgement, KULUMBULULA=Introduction).
  const FM = /^(THE\s+)?AUTHORS?$|^EDITORS?$|^FOREW(O|A)RD$|^PREFACE$|^ACKNOWLEDG|^INTRODUCTION$|^KEY COMPETENCES|^(LIST OF )?ACRONYMS\b|^ANSONEKI$|^MAZU ATACHI$|^KULEMA\b.*\bWUNU$|^KUSAKILILA$|^KULUMBULULA$/i;
  // promote a stray front-matter section name (e.g. an un-styled "INTRODUCTION",
  // or one the source put in a bulleted list) to a real heading so it gets its
  // own page. Accept label/head AND listitem/para blocks.
  const fmText = (x) => (x.segs ? x.segs.map((s) => s.t).join("") : (x.text || "")).trim();
  const firstUnit0 = blocks.findIndex(isUnit);
  let b = blocks.map((x, i) =>
    (firstUnit0 < 0 || i < firstUnit0) && !x.noPromote &&
    (x.t === "label" || x.t === "head" || x.t === "listitem" || x.t === "para") &&
    FM.test(fmText(x))
      ? { t: "h1", text: fmText(x) } : x);
  // we place our own table of contents, so drop any auto/imported one
  b = b.filter((x) => x.t !== "toc");

  // leave signature room before the signatory's name on Foreword/Preface/Ack.
  // The name can arrive as a plain paragraph OR (when bold in the source) as a
  // `head` block, so accept both.
  // Section headings that carry a signatory — English plus local-language
  // equivalents (Lunda: MAZU ATACHI=Foreword, KULEMA…WUNU=Preface,
  // KUSAKILILA=Acknowledgement) so every book's signatory groups identically.
  const SIGSEC = /FOREW|PREFACE|ACKNOWLEDG|MAZU ATACHI|KULEMA\b.*\bWUNU|KUSAKILILA/i;
  // a signatory's name: a trailing honorific "… (Dr)" / "… (Ms.)", OR a leading
  // one "Dr. Name" / "Prof. Name" / "Dr Name" (the period is optional).
  // Trailing parenthetical honorific — allow internal dots/spaces so "(Ph.D.)",
  // "(Ed.D.)", "(M.Ed.)" match as well as "(Dr)" / "(PhD)" — OR a leading title.
  const SIGNAME = /\(\s*(?:dr|ms|mr|mrs|prof|hon|ph\.?\s?d|ed\.?\s?d|m\.?\s?ed|phd)\.?\s*\)\s*$|^(?:dr|prof|mr|mrs|ms|hon)\.?\s+[A-Z]/i;
  // An honorific appearing ANYWHERE (used to catch a run-on signatory that the
  // source glued into one paragraph, e.g. "Noriana Muneku (Ms.)Permanent
  // Secretary…MINISTRY OF EDUCATION").
  const SIGINLINE = /\(\s*(?:dr|ms|mr|mrs|prof|hon|ph\.?\s?d|ed\.?\s?d|m\.?\s?ed|phd)\.?\s*\)/i;
  const plainOfBlk = (x) => (x.t === "head" || x.t === "label" ? (x.text || "") : (x.segs || []).map((s) => s.t).join("")).trim();
  // An organisation line in a signatory block (e.g. "Ministry of Education",
  // "Zambia Educational Publishing House") is set BOLD and UPPERCASE — the house
  // style the all-caps orgs already follow. Build one signature line, marking the
  // name (bold), all-caps lines (bold), and organisation lines (bold + uppercased).
  const SIGORG = /\b(ministr(y|ies)|publishing house|educational publishing|examinations? council|curriculum development)\b/i;
  const sigLine = (txt, isName) => {
    const isAllCaps = /[A-Z]/.test(txt) && !/[a-z]/.test(txt);
    const isOrg = SIGORG.test(txt);
    return { text: isOrg ? txt.toUpperCase() : txt, bold: isName || isAllCaps || isOrg };
  };
  const isText = (x) => x && (x.t === "para" || x.t === "head" || x.t === "label");
  const isBold = (x) => x.t === "head" || x.t === "label" || (x.segs ? x.segs.some((s) => s.b) : false);
  {
    let section = "", done = false, withSig = [];
    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      if (x.t === "h1") { section = x.text || ""; done = false; withSig.push(x); continue; }
      const plain = plainOfBlk(x);
      // A run-on signatory: one paragraph that carries the honorific inline and
      // has SEVERAL runs (bold name / plain role / bold organisation) glued with no
      // separating space — the manuscript typed name+title+org as one paragraph
      // whose ONLY formatting break is the run boundary. Multiple non-empty runs is
      // the real signal (a clean single-run name-only line, handled by the next
      // branch below, never has more than one); a trailing "(PhD)" honorific OR a
      // leading "Dr./Prof./…" prefix both count — SIGNAME alone would wrongly
      // exclude the leading-honorific style ("Dr. Beatrice Chirwa…") since it reads
      // as a plausible standalone name line even though it is not one here.
      const runonSig = !done && SIGSEC.test(section) && x.t === "para" && Array.isArray(x.segs)
        && (SIGINLINE.test(plain) || /^(?:dr|prof|mr|mrs|ms|hon)\.?\s+[A-Z]/i.test(plain))
        && x.segs.filter((s) => s.t.trim()).length >= 2;
      if (runonSig) {
        withSig.push({ t: "sigspace" });
        const lines = x.segs.filter((s) => s.t.trim()).map((s, k) => sigLine(s.t.trim(), k === 0));
        withSig.push({ t: "signature", lines });
        done = true;
        continue;
      }
      // A signatory NAME line is short ("Agness Mumba Wilkins (PhD)"); a prose sentence that
      // merely starts with an honorific ("Mr. Eustace Panga Museka wrote the book…") is not a
      // signature, so cap the length or it steals the block from the real signatory below it.
      if (!done && SIGSEC.test(section) && isText(x) && SIGNAME.test(plain) && plain.length <= 60) {
        // Leave room for a hand signature, then render the signatory block (name,
        // title, organisation) as a dedicated block whose lines are EVENLY spaced
        // — consistent across every book (the template controls the gap).
        withSig.push({ t: "sigspace" });
        let j = i;
        const lines = [];
        while (j < b.length && isText(b[j])) {
          // The signatory's name (the first line) is always bold; an all-caps
          // organisation line (e.g. "ZAMBIA EDUCATIONAL PUBLISHING HOUSE") is bold
          // too; the title line (e.g. "Board Chairperson") is always regular weight.
          lines.push(sigLine(plainOfBlk(b[j]), j === i));
          j++;
        }
        withSig.push({ t: "signature", lines });
        done = true;
        i = j - 1;
        continue;
      }
      withSig.push(x);
    }
    b = withSig;
  }

  // number the lessons (h2) within each body unit (1, 2, 3…), restarting per
  // unit, by baking the number into the heading text — so it shows in BOTH the
  // body and the generated table of contents. (Skipped when the manuscript's
  // sub-topics are already numbered, e.g. Physics "Sub-Topic 4.1.1: …".)
  if (numberLessons) {
    // A back-matter section (APPENDICES, GLOSSARY, REFERENCES…) after the last unit
    // is not itself a unit and its own h2 sub-headings are not lesson components —
    // stop numbering there, or a heading like "STANDARD PERFORMANCE LEVELS (CBC)"
    // wrongly inherits the LAST unit's running count ("4." tacked onto the first
    // back-matter h2, continuing from that unit's own 1/2/3).
    const BACKMATTER = /^(GLOSSARY|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX|ACRONYMS)\b/i;
    let n = 0, inUnit = false;
    for (const x of b) {
      if (isUnit(x)) { inUnit = true; n = 0; }
      else if (inUnit && (x.t === "h1" || x.t === "head" || x.t === "label") && BACKMATTER.test((x.text || "").trim())) { inUnit = false; }
      // Skip sub-topics the manuscript already numbers ("SUB-TOPIC 3.1.1: …" or a
      // bare "3.1.1 …") — only auto-number named lessons (the English gospel).
      // No \b after TOPIC here: a manuscript sometimes glues the number straight onto the
      // word ("Sub- Topic1.1.2"), and \b never fires between a letter and a following
      // digit (both are "word" characters, so there is no boundary to match).
      // "Introduction" and "Tumbling Activities" are excluded book-wide: an author
      // round explicitly asked for these two to carry NO number (CTS Grade 3 LB —
      // "remove this number" on both), while every other numbered h2 in this book
      // was left alone/wanted renumbered, not stripped. Excluded from the COUNT too
      // (not just unlabelled), so a later sibling doesn't skip a number.
      else if (inUnit && x.t === "h2" && /^(introduction|tumbling activities)$/i.test((x.text || "").trim())) {
        // no-op: leave unnumbered, don't advance n
      } else if (inUnit && x.t === "h2" && !/^(SUB[-\s‐-―]*TOPIC|TOPIC)\s*[\d.]/i.test(x.text) && !/^\d+(\.\d+)+\b/.test(x.text)) {
        n += 1; x.text = `${n}. ${x.text}`;
      }
    }
  }

  const coverIdx = b.findIndex((x) => x.t === "cover");
  const unitIdx = b.findIndex(isUnit);
  // first front-matter heading = first h1 before the body units (else the units)
  const frontI = b.findIndex((x, i) => x.t === "h1" && (unitIdx < 0 || i < unitIdx));
  const out = [];
  for (let i = 0; i < b.length; i++) {
    if (coverIdx >= 0 && i === coverIdx + 1) { out.push({ t: "titlestart" }); out.push({ t: "titlepage", lines: b[coverIdx].lines, byline: b[coverIdx].byline }); }
    if (frontI >= 0 && i === frontI) { out.push({ t: "toc" }); out.push({ t: "showpage", spacing: fmSpacing }); }
    if (unitIdx >= 0 && i === unitIdx) out.push({ t: "bodystart" });
    out.push(b[i]);
  }
  // a back cover as the very last page (echoes the front; barcode/ISBN reserved)
  if (coverIdx >= 0) out.push({ t: "backcover", lines: b[coverIdx].lines, logo: b[coverIdx].logo });
  return out;
}

// A block's runs live under `segs` (paragraphs) or `qseg` (exercise/assessment
// question parts); plain-text blocks (headings/labels) carry `text`.
const segKey = (b) => (b.segs ? "segs" : b.qseg ? "qseg" : null);
// Plain text of a block. Figure/table captions live on an image block's `caption`
// (or, for side-by-side rows, on each `images[].caption`), so surface those too —
// otherwise an override can never reach a caption's text (e.g. a mis-numbered "Fig. N:").
const blockPlain = (b) => {
  const k = segKey(b);
  if (k) return b[k].map((s) => s.t).join("");
  if (typeof b.text === "string" && b.text) return b.text;
  if (typeof b.caption === "string") return b.caption;
  if (b.t === "imagerow" && Array.isArray(b.images)) return b.images.map((im) => im.caption || "").join(" ");
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
    if (!inserted && repl) { out.push({ t: repl, b: false, it: false, c: null }); inserted = true; }
    if (post) out.push({ ...s, t: post });
  }
  b[k] = out.filter((s) => s.t !== "");
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
      if (b.segs || b.qseg || typeof b.text === "string" || typeof b.caption === "string" || b.t === "imagerow" || b.t === "image") out.push(b);
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

function applyOverrides(blocks, ov) {
  const flat = allTextBlocks(blocks);
  // textFix: [{ find, with }] — a blunt, whole-tree literal replacement applied to
  // EVERY text string anywhere in the block tree: segment runs, plain-text mirrors
  // (an exercise part's `q` alongside its `qseg`), headings, captions and table
  // cells. `editAll` only reaches blocks that `blockPlain` can see and rewrites one
  // span per block, so a recurring typo can survive inside boxed activity bodies and
  // in the plain mirrors. Use this for spelling repairs ("reallife" -> "real-life")
  // where every occurrence must change; use `edit`/`editAll` when the surrounding
  // run formatting matters or only one occurrence should change.
  for (const tf of ov.textFix || []) {
    if (!tf || typeof tf.find !== "string" || !tf.find) continue;
    const repl = tf.with != null ? String(tf.with) : "";
    let n = 0;
    const walk = (o) => {
      if (o == null || typeof o !== "object") return;
      if (Array.isArray(o)) { for (const x of o) walk(x); return; }
      const segList = Array.isArray(o.segs) ? o.segs : Array.isArray(o.qseg) ? o.qseg : null;
      if (segList && segList.length > 0) {
        const combined = segList.map(s => (s && typeof s.t === "string") ? s.t : "").join("");
        if (combined.includes(tf.find)) {
          const newCombined = combined.split(tf.find).join(repl);
          const firstSeg = segList[0] || {};
          if (Array.isArray(o.segs)) o.segs = [{ ...firstSeg, t: newCombined }];
          if (Array.isArray(o.qseg)) o.qseg = [{ ...firstSeg, t: newCombined }];
          if (typeof o.plain === "string") o.plain = o.plain.split(tf.find).join(repl);
          if (typeof o.q === "string") o.q = o.q.split(tf.find).join(repl);
          n++;
        }
      }
      for (const k of Object.keys(o)) {
        if (k === "segs" || k === "qseg") continue;
        const v = o[k];
        if (typeof v === "string") { if (v.includes(tf.find)) { o[k] = v.split(tf.find).join(repl); n++; } }
        else walk(v);
      }
    };
    walk(blocks);
    if (!n) console.warn("!  textFix not matched:", tf.find);
  }
  for (const f of ov.fill || []) {
    const i = blocks.findIndex((b) => blockPlain(b).trim().toLowerCase().startsWith(f.after.toLowerCase()));
    if (i < 0) continue;
    let target = -1;
    for (let j = i + 1; j < Math.min(i + 3, blocks.length); j++) {
      if (/[.…]{4,}/.test(blockPlain(blocks[j]))) { target = j; break; }   // the dotted placeholder
    }
    if (target < 0) target = i + 1;
    if (blocks[target]) setBlockText(blocks[target], f.text);
  }
  for (const r of ov.replace || []) {
    const b = flat.find((x) => blockPlain(x).includes(r.find));
    if (b) setBlockText(b, r.with);
  }
  // setCaption: [{ near|file, index, text }] — set the caption of an image. Match by
  // `near` (an existing caption's text, on a lone image or any image in a row) or by
  // `file` (a substring of the image's file path — handy for a swapped-in image that
  // has NO caption, e.g. a figure whose number was baked into the picture and has been
  // cropped out). `index` picks which image in a row (default 0); `text` is written.
  for (const sc of ov.setCaption || []) {
    let b = flat.find((x) => sc.file
      ? ((x.t === "image" && (x.file || "").includes(sc.file)) || (x.t === "imagerow" && (x.images || []).some((im) => (im.file || "").includes(sc.file))))
      : ((x.t === "imagerow" && (x.images || []).some((im) => (im.caption || "").includes(sc.near))) || (typeof x.caption === "string" && x.caption.includes(sc.near))));
    if (!b && sc.near) {
      const idx = flat.findIndex(x => blockPlain(x).includes(sc.near));
      if (idx >= 0) {
        const adjImg = flat.slice(Math.max(0, idx - 2), idx + 3).find(x => x.t === "image" || x.t === "imagerow");
        if (adjImg) {
          b = adjImg;
        }
      }
    }
    if (!b) { console.warn("!  setCaption not matched:", sc.near || sc.file); continue; }
    if (b.t === "imagerow") {
      let idx = sc.index || 0;
      if (sc.file) { const j = b.images.findIndex((im) => (im.file || "").includes(sc.file)); if (j >= 0) idx = j; }
      const im = b.images[idx]; if (im) im.caption = sc.text;
    }
    else b.caption = sc.text;

    // Clear any standalone paragraph block that repeats this caption text
    if (sc.near) {
      for (const p of flat) {
        if (p && p !== b && (p.t === "para" || p.t === "figcaption")) {
          const plain = blockPlain(p).trim();
          if (plain.includes(sc.near) || (sc.text && plain === sc.text)) {
            p.t = "none";
            p.segs = [];
          }
        }
      }
    }
  }
  // dropDupImages: true — within each image row, drop any image whose file already
  // appeared earlier in the SAME row (a manuscript that pasted the identical picture
  // twice, e.g. Grade 2 p107 feelings comic laid out as image31,image32,image31). Keeps
  // the first occurrence; a row left with one image collapses to a lone centred image.
  if (ov.dropDupImages) {
    let n = 0;
    for (const b of flat) {
      if (b.t !== "imagerow" || !Array.isArray(b.images)) continue;
      const seen = new Set();
      const kept = [];
      for (const im of b.images) {
        const k = im.file || JSON.stringify(im);
        if (seen.has(k)) { n++; continue; }
        seen.add(k); kept.push(im);
      }
      if (kept.length === b.images.length) continue;
      if (kept.length === 1) { b.t = "image"; Object.assign(b, kept[0]); delete b.images; }
      else b.images = kept;
    }
    if (!n) console.warn("!  dropDupImages matched nothing");
  }
  // stripCaptionLabels: true — remove a leading "Figure N:" / "Table N:" numbering prefix from
  // every figure/table caption, leaving only the description ("Figure 2: Squares in real objects"
  // -> "Squares in real objects"). For an author who numbered figures/tables in the manuscript but
  // wants the printed book to show descriptions only. Opt-in per book (most books keep their numbers).
  if (ov.stripCaptionLabels) {
    const LBL = /^\s*(figure|fig\.?|table|tbl\.?)\s*\d+\s*[:.\-–]?\s*/i;
    let n = 0;
    const strip = (s) => s.replace(LBL, "").replace(/^\s+/, "");
    for (const b of flat) {
      if (b.t === "figcaption" && typeof b.text === "string" && LBL.test(b.text)) { b.text = strip(b.text); n++; }
      if (b.t === "image" && typeof b.caption === "string" && LBL.test(b.caption)) { b.caption = strip(b.caption); n++; }
      if (b.t === "imagerow" && Array.isArray(b.images)) for (const im of b.images) if (im.caption && LBL.test(im.caption)) { im.caption = strip(im.caption); n++; }
    }
    if (!n) console.warn("!  stripCaptionLabels matched nothing");
  }
  // replaceExact: [{ find, with }] — like replace, but the block's WHOLE trimmed text
  // must equal `find`. Use when the target text is a substring of another block that
  // must NOT change (e.g. a stray duplicate "able 2 below…" whose correct twin reads
  // "Table 2 below…", which contains the typo text and would be matched by `replace`).
  for (const r of ov.replaceExact || []) {
    // `all: true` rewrites EVERY block whose whole trimmed text equals `find` — used to
    // clear a redundant line the manuscript repeated on several pages (e.g. a stray
    // duplicate "READING AND WRITING." under the real lesson heading).
    const matches = flat.filter((x) => blockPlain(x).trim() === r.find);
    if (!matches.length) { console.warn("!  replaceExact not matched:", r.find); continue; }
    for (const b of (r.all ? matches : matches.slice(0, 1))) setBlockText(b, r.with);
  }
  // mdReplaceExact: [{ find, with }] — like replaceExact, but `with` is parsed as
  // lightweight markup (**bold**, *italic*, $math$) so the replacement keeps its
  // formatting. Use for a whole-block rewrite that must retain a bold label (e.g.
  // the author's "put a colon" on a bold weather-type heading -> "**Rain:** Rain
  // is water…"). Plain replaceExact flattens; this one does not.
  for (const r of ov.mdReplaceExact || []) {
    const matches = flat.filter((x) => blockPlain(x).trim() === r.find);
    if (!matches.length) { console.warn("!  mdReplaceExact not matched:", r.find); continue; }
    for (const b of (r.all ? matches : matches.slice(0, 1))) setBlockSegs(b, mkSegs(r.with));
  }
  // replaceBlocks: [{ find, with: [ blockspec, … ] }] — replace the FIRST block (at any
  // depth) whose whole trimmed text === `find` with one or MORE freshly-built blocks.
  // Each blockspec names a block type and its content:
  //   { para: "text" }                   -> paragraph (md-parsed: **bold** *italic* $math$)
  //   { head: "text", col: "8A5A2B" }    -> lesson heading (optional colour)
  //   { listitem: "text", marker: "1." } -> numbered/bulleted item (md-parsed)
  //   { label: "text", col: "…" }        -> coloured label
  // Use when a reviewer wants ONE run-on manuscript block SPLIT into several — e.g.
  // "Solutions: 6 + 4 = ___" separated into a "Solutions:" heading followed by a
  // numbered "6 + 4 = ___" item — or a single block retyped/renumbered (give one
  // blockspec with the new marker). Operates on the block tree so it can splice in place.
  const mkBlock = (spec) => {
    if (!spec || typeof spec !== "object") return null;
    // optional alignment for a rebuilt paragraph — `center: true` (or align: "center"/
    // "right") keeps a fresh imprint/front-matter line centred like its neighbours (the
    // imprint region auto-centres only at import, so post-import blocks need it set).
    const al = spec.center ? "center" : spec.align || null;
    if (spec.para != null) return { t: "para", segs: mkSegs(spec.para), ...(al ? { align: al } : {}) };
    if (spec.head != null) return { t: "head", text: spec.head, ...(spec.col ? { headColor: spec.col } : {}) };
    // { h1: "text" } — a top-level section/unit banner: its own page, styled title, and a
    // table-of-contents entry. Use to graft a whole section (e.g. one borrowed verbatim
    // from a sibling book via a `raw` table/paragraph list) into a book that lacks it.
    if (spec.h1 != null) return { t: "h1", text: spec.h1 };
    if (spec.listitem != null) return { t: "listitem", segs: mkSegs(spec.listitem), marker: spec.marker || "•" };
    if (spec.label != null) return { t: "label", text: spec.label, ...(spec.col ? { labelColor: spec.col } : {}) };
    // { vspace: "6mm" } (or `vspace: true` for the default gap) — a blank vertical gap,
    // for rebuilding an imprint/front-matter run whose airy spacing came from the
    // manuscript's own blank-paragraph rhythm rather than anything replaceBlocks touches.
    if (spec.vspace != null) return { t: "vspace", ...(typeof spec.vspace === "string" ? { h: spec.vspace } : {}) };
    // { raw: {...} } — a fully-formed block object, inserted verbatim (no interpretation).
    // Escape hatch for content no other blockspec covers — e.g. a table extracted from a
    // sibling book's manuscript (a Teacher's Guide borrowing its Learner's Book's "Key
    // Competences" table or Glossary entries) — so it can be pasted in exactly as
    // `importDocx` would have produced it, instead of being retyped as markup and risking
    // a transcription slip.
    if (spec.raw != null && typeof spec.raw === "object") return spec.raw;
    // { numbond: ["15","8","7"] } -> a number-bond diagram (whole 15, parts 8 and 7).
    // Primary-maths books draw these with spaces in Word, which collapse when typeset;
    // this renders a proper centred whole-over-two-parts bond with connecting strokes.
    if (Array.isArray(spec.numbond) && spec.numbond.length >= 3) {
      const [whole, a, b] = spec.numbond;
      return { t: "numbond", whole: String(whole), a: String(a), b: String(b) };
    }
    return null;
  };
  const wsNorm = (s) => s.replace(/\s+/g, " ").trim();
  for (const rb of ov.replaceBlocks || []) {
    const news = (rb.with || []).map(mkBlock).filter(Boolean);
    if (!news.length) { console.warn("!  replaceBlocks empty/unknown spec:", rb.find); continue; }
    const want = wsNorm(rb.find);
    let done = false;
    const walk = (arr) => {
      for (let i = 0; i < arr.length && !done; i++) {
        const b = arr[i];
        if (!b || typeof b !== "object") continue;
        if (wsNorm(blockPlain(b)) === want) { arr.splice(i, 1, ...news); done = true; return; }
        for (const key of Object.keys(b)) if (Array.isArray(b[key]) && !done) walk(b[key]);
      }
    };
    walk(blocks);
    if (!done) console.warn("!  replaceBlocks not matched:", rb.find);
  }
  // deleteRun: [{ from, to }] — delete a CONTIGUOUS run of sibling blocks, from the
  // first block whose trimmed text === `from` through the first block at/after it whose
  // trimmed text === `to` (inclusive). Use to remove a multi-paragraph teaching block a
  // reviewer struck out as one unit (e.g. a whole "STEPS:" method — the label plus its
  // three step paragraphs), where the label text repeats elsewhere so `deleteExact`
  // can't single it out. Whitespace-tolerant; operates on the block tree; first run only.
  for (const dr of ov.deleteRun || []) {
    const from = wsNorm(dr.from), to = wsNorm(dr.to), maxSpan = dr.maxSpan || 12;
    let done = false;
    const walk = (arr) => {
      for (let i = 0; i < arr.length && !done; i++) {
        const b = arr[i];
        if (!b || typeof b !== "object") continue;
        // `from` may repeat (e.g. a "Steps:" label used by several methods); accept a run
        // only when the matching `to` sits within maxSpan blocks — otherwise keep looking.
        if (wsNorm(blockPlain(b)) === from) {
          let j = i;
          while (j < arr.length && j - i <= maxSpan && wsNorm(blockPlain(arr[j])) !== to) j++;
          if (j < arr.length && j - i <= maxSpan) { arr.splice(i, j - i + 1); done = true; return; }
        }
        for (const key of Object.keys(b)) if (Array.isArray(b[key]) && !done) walk(b[key]);
      }
    };
    walk(blocks);
    if (!done) console.warn("!  deleteRun not matched:", dr.from, "..", dr.to);
  }
  // editCell: [{ find, with }] — rewrite TABLE CELLS whose whole trimmed text === find.
  // Table cells live in a block's `rows` (array of rows, each an array of {text,imgs})
  // and are NOT reached by the paragraph/heading overrides (allTextBlocks skips them),
  // so a header typo inside a table — e.g. a stray capital in a fill-in header ("O"->"o",
  // "Oe"->"oe") — needs this. Rewrites every matching cell at any depth. Preserves imgs.
  for (const ec of ov.editCell || []) {
    let n = 0;
    const walkT = (arr) => {
      for (const b of arr) {
        if (!b || typeof b !== "object") continue;
        if (Array.isArray(b.rows) && (b.t === "table" || b.kind === "table")) {
          for (const row of b.rows) if (Array.isArray(row)) for (const cell of row) {
            if (cell && typeof cell.text === "string" && cell.text.trim() === ec.find) { cell.text = ec.with; n++; }
          }
        }
        for (const k of Object.keys(b)) if (Array.isArray(b[k]) && k !== "rows") walkT(b[k]);
      }
    };
    walkT(blocks);
    if (!n) console.warn("!  editCell not matched:", ec.find);
  }
  // deleteExact: ["exact trimmed text", …] — remove EVERY block (at any depth) whose
  // whole trimmed plain text equals the string, splicing it out of the tree entirely
  // (no empty paragraph left behind). Use for a redundant line the manuscript repeated
  // — e.g. a stray duplicate "READING AND WRITING." under the real lesson heading —
  // where blanking it would leave an unwanted vertical gap.
  // Compare with internal whitespace collapsed: the manuscript often aligns a line by
  // hand with runs of spaces/tabs ("4     +   3   =   7"), which `normaliseSpacing`
  // squeezes to single spaces only AFTER overrides run — so a plain-equality delete of
  // "4 + 3 = 7" would miss the still-spaced block. Whole-block equality is preserved.
  const wsEq = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
  for (const del of ov.deleteExact || []) {
    let n = 0;
    const prune = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const b = arr[i];
        if (!b || typeof b !== "object") continue;
        for (const key of Object.keys(b)) if (Array.isArray(b[key])) prune(b[key]);
        if (wsEq(blockPlain(b), del)) { arr.splice(i, 1); n++; }
      }
    };
    prune(blocks);
    if (!n) console.warn("!  deleteExact not matched:", del);
  }
  // setHeading: [{ find, text, as?, mergeNext?, all? }] — repair a mangled unit/topic
  // heading. Find top-level block(s) whose trimmed text === `find`; set the block's
  // text to `text` and (if `as`) its type — "h1" renders a unit/topic banner (e.g. a
  // "CHIBALU N: Title" chapter), "head" a plain lesson heading. With `mergeNext`, also
  // drop the immediately following heading block (a title line the manuscript split off
  // from the number). `all` applies to every match (default: first only). Runs on
  // top-level `blocks` so it can splice out the merged title.
  const HEADISH = (b) => b && (b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t));
  for (const sh of ov.setHeading || []) {
    let n = 0;
    // `near` disambiguates a common short heading (e.g. "Health") that also occurs
    // as ordinary body/list text elsewhere in the book — only match within a small
    // window around the block containing `near` (mirrors renameNear's scoping).
    let lo = 0, hi = blocks.length;
    if (sh.near) {
      const na = blocks.findIndex((b) => blockPlain(b).includes(sh.near));
      if (na < 0) { console.warn("!  setHeading `near` not matched:", sh.near); continue; }
      lo = Math.max(0, na - 15); hi = Math.min(blocks.length, na + 15);
    }
    for (let i = lo; i < hi; i++) {
      if (blockPlain(blocks[i]).trim() !== sh.find) continue;
      if (sh.mergeNext && HEADISH(blocks[i + 1])) blocks.splice(i + 1, 1);
      // mutate in place (keep the object identity) so a later primitive scanning the
      // pre-built `flat` list — e.g. recolorHead — still sees this now-heading block.
      const blk = blocks[i];
      blk.text = sh.text != null ? sh.text : blockPlain(blk).trim();
      blk.t = sh.as || blk.t;
      delete blk.segs; delete blk.marker; delete blk.isList; delete blk.numId; delete blk.lvl;
      n++;
      if (!sh.all) break;
    }
    if (!n) console.warn("!  setHeading not matched:", sh.find);
  }
  // renumberLessons: true — repair scrambled lesson numbering. Grade-2 units repeat the
  // same strand headings ("LISTENING AND SPEAKING: LESSON N", "READING AND WRITING:
  // LESSON N"); some manuscripts mis-number them (a strand restarting at 2, or two
  // "LESSON 1"s in a row). Walk top-level blocks in document order: reset counters at
  // every "UNIT N …" banner, then for each "<strand>: LESSON <n>" heading bump a
  // per-strand counter and rewrite just the number (editBlockText preserves the run's
  // bold/colour and normalises stray double spaces). So each strand numbers 1,2,3,… from
  // the top of its unit. Idempotent — units already sequential are left unchanged.
  if (ov.renumberLessons) {
    const LESSON = /^(.+?):\s*LESSON\s+\d+\s*$/i;
    let counters = {};
    for (const b of blocks) {
      const t = blockPlain(b).trim();
      if (/^UNIT\s+\d+\b/i.test(t)) { counters = {}; continue; }
      const m = t.match(LESSON);
      if (!m) continue;
      // Key the strand on its name with the word "AND" removed, so a manuscript that
      // drops it ("READING WRITING" for "READING AND WRITING") still counts as the same
      // strand and its lessons stay in one sequence rather than restarting at 1. (A later
      // editAll restores the visible "AND"; this only affects the counter key.)
      const key = m[1].replace(/\bAND\b/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
      const n = (counters[key] = (counters[key] || 0) + 1);
      const cur = t.match(/LESSON\s+\d+/i)[0];
      if (cur !== `LESSON ${n}`) editBlockText(b, cur, `LESSON ${n}`);
    }
  }
  // renumberActivities: true — repair scrambled ACTIVITY numbering the same way. Many
  // manuscripts label every activity in a lesson "ACTIVITY 1" (or "Activity 1"). Walk
  // top-level blocks; reset the counter at each "UNIT N …" banner and at every
  // "… LESSON N" heading (each lesson is a fresh 1,2,3,… activity sequence), then for any
  // heading that STARTS with an activity label bump the counter and rewrite just the
  // number — the trailing ": title" (if any) and the run's bold/colour are preserved.
  // Runs before boxifyActivities, so the boxes pick up the corrected numbers. Idempotent.
  if (ov.renumberActivities) {
    // Renumber ACTIVITY headings 1..N per unit+lesson AND normalise their
    // punctuation: the manuscript is inconsistent — "ACTIVITY 1 Tell me a story"
    // (no colon), "Activity1: …" (no space), "ACTIVITY 1: …" (correct). House
    // style is "ACTIVITY N: Title", so whenever a title follows the number we
    // force a single ": " separator (and a single space after the word).
    // Capture and DISCARD an optional lowercase letter suffix on the number
    // ("Activity 1a"): the manuscript occasionally typos a stray letter after the
    // digit. Absorbing it here both prevents the letter being mistaken for the title
    // (which produced the malformed "Activity 1: a: …") and drops it, so the heading
    // renumbers cleanly as a normal sequential activity.
    const ACTNUM = /^(LEARNING\s+ACTIVITY|ACTIVITY|Activity)\s*(\d+)[a-z]?\s*:?\s*(.*)$/;
    // A bare, unnumbered "ACTIVITY" (no digit) — the manuscript occasionally drops
    // the number entirely (e.g. Grade 2 p32). Treat the whole line being just the
    // word (plus an optional colon) as an activity heading and assign it the next n.
    const ACTBARE = /^(LEARNING\s+ACTIVITY|ACTIVITY|Activity)\s*:?\s*$/;
    let n = 0;
    for (const b of blocks) {
      const t = blockPlain(b).trim();
      if (/^UNIT\s+\d+\b/i.test(t)) { n = 0; continue; }
      if (/\bLESSON\s+\d+/i.test(t)) { n = 0; continue; }
      const bare = t.match(ACTBARE);
      if (bare) { n += 1; editBlockText(b, t, `${bare[1]} ${n}`); continue; }
      const m = t.match(ACTNUM);
      if (!m) continue;
      n += 1;
      const title = m[3].trim();
      // everything from the start up to (not including) the title — i.e. the
      // "PREFIX <num>[letter] <sep>" run we will rewrite to the canonical form.
      const cur = title ? t.slice(0, t.length - title.length) : t;
      const next = `${m[1]} ${n}${title ? ": " : ""}`;
      if (cur !== next) editBlockText(b, cur, next);
    }
  }
  // renumberTopics: true — force every "TOPIC N[.M]: Title" heading to a clean
  // sequential "TOPIC <major>.<n>" in document order. Some manuscripts number most
  // topics under a shared strand ("TOPIC 3.4", "TOPIC 3.5", …) but drop the strand
  // number on a few ("TOPIC 8", "TOPIC 15") — inconsistent and confusing in the
  // contents page. `topicPrefix` sets the major number explicitly; otherwise it is
  // taken from the first topic heading that already has a "major.minor" number.
  if (ov.renumberTopics) {
    let major = ov.topicPrefix != null ? String(ov.topicPrefix) : null;
    if (!major) {
      for (const b of blocks) {
        if (b.t !== "h1") continue;
        const m = (b.text || "").trim().match(/^TOPIC\s+(\d+)\.\d+\b/i);
        if (m) { major = m[1]; break; }
      }
      major = major || "1";
    }
    let n = 0;
    for (const b of blocks) {
      if (b.t !== "h1") continue;
      const t = (b.text || "").trim();
      const m = t.match(/^TOPIC\s+([\d.]+)\s*:?\s*(.*)$/i);
      if (!m) continue;
      n += 1;
      const title = m[2].trim();
      const cur = title ? t.slice(0, t.length - title.length) : t;
      const next = `TOPIC ${major}.${n}${title ? ": " : ""}`;
      if (cur !== next) editBlockText(b, cur, next);
    }
  }
  // dedupLessonSubheads: true — Word manuscripts often repeat the strand name as a
  // Title-Case line ("Reading and Writing") directly beneath the all-caps lesson
  // banner ("READING AND WRITING: LESSON 3") — pure duplication. Drop a block whose
  // whole text equals the strand of the IMMEDIATELY-PRECEDING "<STRAND>: LESSON N"
  // banner (blank blocks ignored). The banner guard is essential: the same
  // Title-Case sub-heading ("Reading and Writing" / "Listening and Speaking") is
  // used LEGITIMATELY inside an "End of Unit Assessment" (which is NOT preceded by a
  // LESSON banner), so those survive untouched.
  if (ov.dedupLessonSubheads) {
    const STRANDS = new Set(["reading and writing", "listening and speaking"]);
    let banner = null; // lowercased strand of the last "<STRAND>: LESSON N" seen
    const kept = [];
    for (const b of blocks) {
      const t = blockPlain(b).trim();
      if (!t) { kept.push(b); continue; }              // blank — stay in the window
      const bm = t.match(/^(.+?):\s*LESSON\s+\d+\s*$/i);
      if (bm) { banner = bm[1].replace(/\s+/g, " ").trim().toLowerCase(); kept.push(b); continue; }
      if (banner && STRANDS.has(t.toLowerCase()) && t.toLowerCase() === banner) { banner = null; continue; }
      banner = null;                                    // window closes at any other block
      kept.push(b);
    }
    blocks.length = 0; blocks.push(...kept);
  }
  // recase: [{ startsWith, to }] — for every heading (head/label/h1–h3) whose text
  // starts with `startsWith` (case-insensitive), recase the WHOLE text to Title Case
  // (`to: "title"`, default) or sentence case (`to: "sentence"`). For structural labels
  // the manuscript left inconsistently in ALL-CAPS (e.g. a Lunda "Specific Competences"
  // heading), matched by their fixed opening words so every trailing variant is caught.
  const toTitle = (s) => s.toLowerCase().split(/(\s+)/).map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join("");
  const toSentence = (s) => { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
  for (const rc of ov.recase || []) {
    let n = 0;
    for (const b of flat) {
      if (!(b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t)) || typeof b.text !== "string") continue;
      if (!b.text.trim().toUpperCase().startsWith(rc.startsWith.toUpperCase())) continue;
      b.text = rc.to === "sentence" ? toSentence(b.text.trim()) : toTitle(b.text.trim());
      n++;
    }
    if (!n) console.warn("!  recase not matched:", rc.startsWith);
  }
  // asPara: ["exact trimmed text", …] — demote a head/label block to a plain paragraph,
  // keeping its (already-recased) text. Use for a manuscript line the importer classified
  // as a structural label (ALL-CAPS bold) that is really an instruction sentence — a
  // "label" is force-uppercased by the series theme's lbl(), so recasing it to sentence
  // case is not enough on its own; it must stop being a label. Runs after recase so it
  // carries the corrected casing. Matches on the current (post-recase) trimmed text.
  for (const ap of ov.asPara || []) {
    let n = 0;
    for (const b of flat) {
      if (!(b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t)) || typeof b.text !== "string") continue;
      if (b.text.trim() !== ap) continue;
      const t = b.text.trim();
      b.t = "para"; delete b.text; delete b.marker;
      b.segs = [{ t, b: false, it: false, c: null }];
      n++;
    }
    if (!n) console.warn("!  asPara not matched:", ap);
  }
  // edit: [{ find, with }] — replace/delete a substring INSIDE a block while
  // keeping the formatting of the surrounding runs (e.g. trim one sentence from a
  // paragraph without flattening the bold names elsewhere in it).
  for (const e of ov.edit || []) {
    const b = flat.find((x) => blockPlain(x).includes(e.find));
    if (b) editBlockText(b, e.find, e.with || "");
  }
  // editAll: [{ find, with }] — like edit, but applied to EVERY block that contains the
  // substring (not just the first). For a recurring phrase the same across the whole
  // book, e.g. relabelling every "TIPS FOR THE TEACHER" -> "TIPS TO THE TEACHER".
  for (const e of ov.editAll || []) {
    let n = 0;
    for (const b of flat) if (blockPlain(b).includes(e.find)) { editBlockText(b, e.find, e.with || ""); n++; }
    if (!n) console.warn("!  editAll not matched:", e.find);
  }
  // unbold: ["exact run text", …] — drop bold from any run whose trimmed text equals the
  // entry (mirror of `unitalic`). Used where the author flagged "REMOVE BOLD" on a word/
  // phrase that should read in normal weight.
  for (const u of ov.unbold || []) {
    let n = 0;
    for (const b of flat) for (const s of b.segs || []) {
      if (s.b && (s.t || "").trim() === u) { s.b = false; n++; }
    }
    if (!n) console.warn("!  unbold not matched:", JSON.stringify(u).slice(0, 50));
  }
  // boldToItalic: ["exact run text", …] — drop bold AND set italic on a matching run
  // (the author's "REMOVE BOLD, THEN ITALICISE"). Trimmed-equality match like unbold.
  for (const u of ov.boldToItalic || []) {
    let n = 0;
    for (const b of flat) for (const s of b.segs || []) {
      if ((s.t || "").trim() === u) { s.b = false; s.it = true; n++; }
    }
    if (!n) console.warn("!  boldToItalic not matched:", JSON.stringify(u).slice(0, 50));
  }
  // unitalic: ["exact seg text", …] — drop italics from any run whose trimmed text
  // exactly equals the entry. Used when the author wants a word/phrase set roman
  // (e.g. a defined term the manuscript italicised) without touching its siblings.
  for (const u of ov.unitalic || []) {
    for (const b of flat) for (const s of b.segs || []) {
      if (s.it && (s.t || "").trim() === u) s.it = false;
    }
  }
  // asHead: ["exact heading text", …] — reclassify a coloured section heading (h1/h2)
  // to a plain bold-black `head`. Use when the author wants a specific heading in bold
  // black rather than the theme's accent colour (e.g. "INTRODUCTION" set to match the
  // adjacent "HOW TO USE THIS BOOK" black heading).
  // Also matches a plain PARAGRAPH the author mistyped where a bold sub-heading was
  // meant (a lone "Sounds" / "Conversations" line the manuscript left as body text,
  // inconsistent with its bold siblings elsewhere). Converts EVERY block whose whole
  // trimmed text equals the entry, so a heading that appears once as a real head and
  // once as a stray paragraph both end up as the same bold-black `head`.
  for (const h of ov.asHead || []) {
    let n = 0;
    for (const b of flat) {
      const isHeadType = b.t === "h1" || b.t === "h2" || b.t === "h3" || b.t === "head" || b.t === "label";
      const isTextBlock = b.t === "para" || b.t === "listitem";
      if (!isHeadType && !isTextBlock) continue;
      if (blockPlain(b).trim() !== h) continue;
      // set it to a plain bold-black `head` and flag it so the front-matter builder
      // (which would otherwise re-promote a front-matter section name like INTRODUCTION
      // back to a coloured sectionhead) leaves it alone.
      b.t = "head"; b.text = h; b.noPromote = true; delete b.segs; delete b.marker;
      n++;
    }
    if (!n) console.warn("!  asHead not matched:", h);
  }
  // asSection: ["exact heading text", …] — the inverse of `asHead`: promote a plain
  // inline heading (head/label/h2/h3) to a top-level section heading (h1) so it renders
  // as a styled section head — its own page, accent-coloured title and rule, like the
  // ACRONYMS front-matter sections — and is listed in the table of contents. Use for
  // back-matter sections (GLOSSARY OF TERMS, REFERENCES) the manuscript left as small
  // bold inline headings.
  for (const h of ov.asSection || []) {
    const b = flat.find((x) => (x.t === "head" || x.t === "label" || x.t === "h2" || x.t === "h3") && (x.text || "").trim() === h);
    if (b) b.t = "h1"; else console.warn("!  asSection not matched:", h);
  }
  // styleSection: [{ find, rename? } | "text", …] — give a plain inline heading the styled
  // SECTION-heading look (accent title + rule) WITHOUT a page break and WITHOUT a contents
  // entry, so it can share a page with what precedes it (e.g. an ACRONYMS list sitting
  // directly below the Competences table). `rename` also updates the heading text. Kept a
  // `head` and marked noPromote so applySeriesFront never lifts it to its own page.
  for (const s of ov.styleSection || []) {
    const find = typeof s === "string" ? s : s.find;
    const b = flat.find((x) => (x.t === "head" || x.t === "label" || x.t === "h2" || x.t === "h3") && (x.text || "").includes(find));
    if (!b) { console.warn("!  styleSection not matched:", find); continue; }
    if (s.rename) b.text = s.rename;
    b.t = "head"; b.styleSection = true; b.noPromote = true;
    delete b.segs; delete b.marker;
  }
  // numberedTopics: true — for a manuscript that opens its topics with a BARE number
  // ("2.1. SAFETY") instead of the house form ("TOPIC 2.1: SAFETY"), as the Grade 2 CTS
  // book does while its Grade 3 sibling uses TOPIC. Rewrite those headings into the house
  // form and make them h1. Everything downstream then keys off the normal TOPIC shape:
  // the topic banner, the front-matter/body split (roman → arabic numbering), the table
  // of contents, and the scaffold-strip boundary — with no special-casing anywhere else.
  // Opt-in per book, never automatic: some manuscripts (e.g. the Luvale Form 1 LB) number
  // dozens of ordinary sub-headings this way and must NOT become topics.
  if (ov.numberedTopics) {
    const NUM = /^(\d+\.\d+)\.?\s+(\S.*)$/;
    let n = 0;
    for (const b of flat) {
      const isHeadish = b.t === "head" || b.t === "h1" || b.t === "h2" || b.t === "h3";
      // Accept a bare `para` too: an author who hand-formats topic openers often leaves
      // one un-styled (the Grade 2 CTS "2.5. PATTERNS " is only colour-marked). Guard it
      // hard — short, and the WHOLE line must be the numbered title — so an ordinary
      // sentence that happens to start "2.5. " can never be promoted.
      const isBarePara = b.t === "para" && blockPlain(b).trim().length <= 60;
      if (!isHeadish && !isBarePara) continue;
      const m = (isHeadish ? b.text || "" : blockPlain(b)).trim().match(NUM);
      if (!m) continue;
      b.t = "h1";
      b.text = `TOPIC ${m[1]}: ${m[2].trim()}`;
      delete b.segs; delete b.marker; delete b.isList; delete b.numId; delete b.lvl;
      n++;
    }
    if (!n) console.warn("!  numberedTopics matched nothing");
    // Inside a topic, the opener is "Introduction" + an objective sentence ("You will learn
    // about …"). Some units mis-style the objective, or "Introduction" itself, as a Heading —
    // which then pollutes the units-only contents page. So, ONCE past the first TOPIC banner
    // (leaving the book's own front-matter INTRODUCTION section untouched): demote an objective
    // heading to a plain paragraph, and normalise a topic's "Introduction" heading to a plain
    // sub-head (never a TOC-listed h1/h2).
    const OBJ = /\byou will learn\b/i;
    let pastTopic = false;
    for (const b of flat) {
      const ht = (b.t === "h1" || b.t === "h2" || b.t === "h3" || b.t === "head") ? (b.text || "").trim() : "";
      if (b.t === "h1" && /^TOPIC\s+\d/i.test(ht)) { pastTopic = true; continue; }
      if (!pastTopic) continue;
      // A real Grade-2 sub-heading is short ("MAKING ITEMS", "2.4.1: FIRST AID"); an objective
      // or an instruction sentence mis-styled as a heading is long (or an explicit "You will
      // learn …"). Demote either to body text so it never enters the contents.
      if ((b.t === "head" || b.t === "h2" || b.t === "h3") && typeof b.text === "string" && (OBJ.test(b.text) || b.text.trim().length > 55)) {
        b.segs = [{ t: b.text, b: false, it: false, c: null }]; b.t = "para"; delete b.text; delete b.marker;
      } else if ((b.t === "h1" || b.t === "h2" || b.t === "h3") && /^introduction$/i.test(ht)) {
        b.t = "head"; b.text = "Introduction"; delete b.segs; delete b.marker;
      }
    }
  }
  // topicNumFirst: true — the author writes the lesson-header CODE before the label, either
  // dash-joined ("2.1 - Topic: Conversations", "2.1.1- Sub-Topic: Family") or space-separated
  // in caps ("2.2 TOPIC: Stories", "2.2.1 SUBTOPIC: Simple Stories", "2.2.1.1 SPECIFIC
  // COMPETENCE: Analyse simple stories"), instead of the house form ("Topic 2.1: …"). A
  // number-first line often imports as a bold HEADING, so it also renders oversized (16pt)
  // next to its sibling fields. Reorder each into the intermediate "Label: N value" form as a
  // plain PARAGRAPH; the Teacher's-Guide lesson-meta polish (proofPolish 1c/1d/1e/3) then moves
  // the number inside the label, bolds it, italicises a competence value, and groups it — so it
  // reads exactly like every properly-formatted lesson. Opt-in per book.
  if (ov.topicNumFirst) {
    // Allow a trailing dot after the code ("2.17. TOPIC:") and any of the number-first forms.
    const RE = /^\s*(\d+(?:\.\d+)*)\.?\s*[-–—]?\s*(sub-?topic|topic|specific\s+competences?)\s*:\s*([\s\S]*)$/i;
    let n = 0;
    for (const b of flat) {
      const isHeadish = b.t === "head" || b.t === "h1" || b.t === "h2" || b.t === "h3" || b.t === "label";
      const isPara = b.t === "para" || b.t === "listitem";
      if (!isHeadish && !isPara) continue;
      const src = (isHeadish && b.text != null ? b.text : blockPlain(b)).trim();
      const m = src.match(RE);
      if (!m) continue;
      const raw = m[2].toLowerCase();
      // Trust the CODE DEPTH, not the manuscript's (sometimes wrong) word: a 2-part code
      // (2.17) is a TOPIC, a 3-part code (2.17.5) is a SUB-TOPIC — so a "TOPIC" line whose
      // number is really a sub-topic code, or vice versa, is arranged correctly. Specific
      // competences keep their label (their code is 4-part, e.g. 2.17.5.1).
      const label = /specific/.test(raw)
        ? "Specific competence"
        : (m[1].split(".").length >= 3 ? "Sub-Topic" : "Topic");
      const rest = m[3].trim();
      b.t = "para";
      b.segs = [{ t: `${label}: ${m[1]}${rest ? " " + rest : ""}`, b: false, it: false, c: null }];
      delete b.text; delete b.marker; delete b.isList; delete b.numId; delete b.lvl; delete b.labelColor;
      n++;
    }
    if (!n) console.warn("!  topicNumFirst matched nothing");
  }
  // insertText: [{ after|before, text, as? }] — insert a new block (default a paragraph; `as`
  // may be "head" for a plain bold sub-heading, or "section" for the styled front-matter
  // section look — accent title + rule, no page break, not in the contents — matching
  // styleSection's output) immediately AFTER the first top-level block containing `after`,
  // or BEFORE the first block containing `before`. Used to add author-requested lines (e.g.
  // extra acronym rows, or a heading the manuscript never supplied, like a missing "LIST OF
  // TABLES" separating a Figures list from a headerless run of table captions).
  for (const it of ov.insertText || []) {
    const needle = it.after != null ? it.after : it.before;
    const hay = (b) => `${blockPlain(b)} ${b.heading || ""} ${b.title || ""}`;
    const texts = Array.isArray(it.text) ? it.text : [it.text];
    const mkBlks = () => texts.map((tx, idx) => it.as === "section"
      ? { t: "head", text: tx, styleSection: true, noPromote: true }
      : it.as === "head"
      ? { t: "head", text: tx, black: true, noPromote: true }
      : it.as === "list"
      ? { t: "listitem", isList: true, marker: it.startNum != null ? `${it.startNum + idx}.` : "•", segs: [{ t: tx, b: !!it.bold, it: !!it.italic, c: null }] }
      : { t: "para", segs: [{ t: tx, b: !!it.bold, it: false, c: null }], ...(it.align ? { align: it.align } : {}) });
    if (it.all) {
      let n = 0;
      for (let i = 0; i < blocks.length; i++) {
        if (hay(blocks[i]).includes(needle)) {
          const blks = mkBlks();
          blocks.splice(it.after != null ? i + 1 : i, 0, ...blks);
          i += blks.length; n++;
        }
      }
      if (!n) console.warn("!  insertText not matched:", needle);
    } else {
      // `near`: disambiguate a needle that recurs (e.g. a sentence repeated verbatim
      // earlier in the same lesson as a "jumbled lines" prompt before its own answer
      // key restates it) — locate the UNIQUE `near` text first, then scan backward (up
      // to 10 blocks) for the nearest needle match.
      let at;
      if (it.near) {
        const na = blocks.findIndex((b) => hay(b).includes(it.near));
        at = -1;
        if (na >= 0) for (let k = na; k >= 0 && k >= na - 30; k--) if (hay(blocks[k]).includes(needle)) { at = k; break; }
      } else {
        at = blocks.findIndex((b) => hay(b).includes(needle));
      }
      if (at < 0) { console.warn("!  insertText not matched:", it.near ? `${needle} near ${it.near}` : needle); continue; }
      blocks.splice(it.after != null ? at + 1 : at, 0, ...mkBlks());
    }
  }
  // toTable: [{ find, cols }] — convert a paragraph whose text matches `find` into a 1×N
  // word-bank table (splitting the text on whitespace). Used when the author writes a
  // "choose from these words" list as a plain sentence and wants it shown as a table row.
  for (const tt of ov.toTable || []) {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    let i;
    if (Array.isArray(tt.find)) {
      const needles = tt.find.map(norm);
      i = -1;
      for (let k = 0; k <= blocks.length - needles.length; k++) {
        if (needles.every((n, o) => norm(blockPlain(blocks[k + o])) === n)) { i = k; break; }
      }
    } else {
      i = blocks.findIndex((b) => norm(blockPlain(b)) === norm(tt.find));
    }
    if (i < 0) { console.warn("!  toTable not matched:", tt.find); continue; }
    // `underline: true` gives each cell an underlined segment (a word bank the
    // author wants underlined). Because a cell with segs is never styled as a
    // coloured header, the row renders as plain underlined words rather than an
    // amber header strip — the underline decoration the underline() override
    // cannot reach inside table cells.
    const mkCell = (w) => tt.underline
      ? { text: String(w), imgs: [], segs: [{ t: String(w), b: false, it: false, c: null, u: true }] }
      : { text: String(w), imgs: [] };
    let rows;
    if (tt.rows) {
      rows = tt.rows.map((r) => r.map(mkCell));
    } else {
      const words = tt.find.trim().split(/\s+/);
      const cols = tt.cols || words.length;
      rows = [];
      for (let k = 0; k < words.length; k += cols) {
        rows.push(words.slice(k, k + cols).map(mkCell));
      }
    }
    const consume = tt.count || (Array.isArray(tt.find) ? tt.find.length : 1);
    blocks.splice(i, consume, { t: "table", rows, noHeader: !!tt.noHeader });
  }
  // learnStatement: [{ after, text }] — insert a two-line "What you will learn" block right
  // after a lesson heading (top-level head/hN whose trimmed text === `after`). Primary-LB
  // Specific Competences are stripped; where one was, the author asks for two plain statements:
  // a bold "What you will learn in this lesson:" line and a sentence describing the outcome.
  for (const ls of ov.learnStatement || []) {
    const i = blocks.findIndex((b) => (b.t === "head" || /^h[123]$/.test(b.t)) && (b.text || "").trim() === ls.after);
    if (i < 0) { console.warn("!  learnStatement not matched:", ls.after); continue; }
    blocks.splice(i + 1, 0,
      { t: "head", text: "What you will learn in this lesson:", black: true, noPromote: true },
      { t: "para", segs: [{ t: ls.text, b: false, it: true, c: null }] });
  }
  // recolor: [{ from?, to, text?, bold? }] — recolour text runs. Matches runs by their
  // existing colour (`from`, hex without #) and/or exact trimmed `text`; sets colour to
  // `to` (empty/omitted = default ink/black) and, if `bold` given, that weight. For a
  // manuscript that hard-coded a colour (e.g. bright-blue "00B0F0" topic headings the
  // author now wants in a blend colour, plus one run set back to black).
  for (const rc of ov.recolor || []) {
    for (const b of flat) for (const s of b.segs || []) {
      if (s.m) continue;
      const colOk = !rc.from || (s.c || "").toUpperCase() === rc.from.toUpperCase();
      const txtOk = rc.text == null || (s.t || "").trim() === rc.text.trim();
      if (colOk && txtOk) { s.c = rc.to ? rc.to.toUpperCase() : null; if (rc.bold != null) s.b = rc.bold; }
    }
  }
  // recolorHead: [{ startsWith, to, bold? }] — give a heading (head/h block whose text
  // starts with the prefix) a specific fill colour, so `#head` TOPIC/SUB-TOPIC lines match
  // the recoloured paragraph-rendered ones.
  for (const rh of ov.recolorHead || []) {
    for (const b of flat) if ((b.t === "head" || b.t === "h1" || b.t === "h2" || b.t === "h3") && (b.text || "").trimStart().startsWith(rh.startsWith)) b.headColor = (rh.to || "").toUpperCase();
  }
  // recolorLabel: [{ startsWith, to }] — recolour a `lbl` block (a small caps/coloured label
  // like "Example:", "Solution:") whose text starts with `startsWith`, to hex `to`. The label
  // colour is otherwise the theme accent; some authors want e.g. all Example/Solution labels
  // in a specific colour for consistency.
  for (const rl of ov.recolorLabel || []) {
    let n = 0;
    for (const b of flat) if (b.t === "label" && (b.text || "").trimStart().startsWith(rl.startsWith)) { b.labelColor = (rl.to || "").toUpperCase(); n++; }
    if (!n) console.warn("!  recolorLabel not matched:", rl.startsWith);
  }
  // italiciseFrom: ["prefix", …] — for any paragraph whose text starts with the prefix
  // (e.g. GENERAL/SPECIFIC COMPETENCE, EXPECTED STANDARD), italicise the CONTENT that
  // follows the label but leave the leading label run itself upright (the label word
  // stays roman; only the value after it is italicised).
  for (const pre of ov.italiciseFrom || []) {
    for (const b of flat) {
      if (b.t !== "para" || !b.segs || !b.segs.length) continue;
      if (b.segs.map((s) => s.t).join("").trimStart().startsWith(pre)) {
        for (let k = 1; k < b.segs.length; k++) if (!b.segs[k].m) b.segs[k].it = true;
      }
    }
  }
  // retext: [{ from, to }] — change a run whose trimmed text equals `from` to `to`, in
  // place, PRESERVING its bold/italic/colour (unlike `edit`, which flattens formatting).
  // e.g. de-shout a label from ALL CAPS to Title Case ("GENERAL COMPETENCES:"→"General
  // Competences:") while keeping it bold. Runs after any italiciseFrom pass.
  for (const rt of ov.retext || []) {
    for (const b of flat) for (const s of b.segs || []) {
      if (!s.m && (s.t || "").trim() === rt.from) s.t = s.t.replace(rt.from, rt.to);
    }
  }
  // subtext: [{ from, to }] — replace the substring `from` with `to` inside EVERY run
  // that contains it, PRESERVING that run's bold/italic/colour. Unlike editAll (which
  // flattens the replacement to roman) this keeps formatting, so it is safe on text
  // that may fall inside italic/bold runs — e.g. a manuscript typo like "fourfigure"
  // that must become "four figure" both in body prose and inside an italic activity.
  for (const st of ov.subtext || []) {
    let n = 0;
    for (const b of flat) for (const s of b.segs || []) {
      if (!s.m && s.t && s.t.includes(st.from)) { s.t = s.t.split(st.from).join(st.to); n++; }
    }
    if (!n) console.warn("!  subtext not matched:", st.from);
  }
  // centre: ["exact heading text", …] — centre a heading (a `head`/h1/h2/h3 block whose
  // trimmed text equals the entry). Used for reading-passage / picture / story titles the
  // author wants centred while structural sub-heads stay left. Matches ALL such blocks.
  // An entry may also be an object {find, after} to scope to ONE instance among several
  // identical headings: only the occurrence whose text === find AND is followed (within a
  // few blocks, before the next heading) by a block containing `after` is centred.
  const isHeadC = (b) => b.t === "head" || b.t === "h1" || b.t === "h2" || b.t === "h3";
  for (const entry of ov.centre || []) {
    const cText = typeof entry === "string" ? entry : entry.find;
    const after = typeof entry === "string" ? null : entry.after;
    let n = 0;
    for (let i = 0; i < flat.length; i++) {
      const b = flat[i];
      if (!(isHeadC(b) && (b.text || "").trim() === cText)) continue;
      if (after) {
        let ok = false;
        for (let j = i + 1; j < flat.length && j <= i + 8; j++) {
          const nb = flat[j];
          if (isHeadC(nb) && (nb.text || "").trim() !== cText) break; // next heading ends the window
          if (blockPlain(nb).includes(after)) { ok = true; break; }
        }
        if (!ok) continue;
      }
      b.align = "center";
      n++;
    }
    if (!n) console.warn("!  centre not matched:", cText);
  }
  // centrePara: ["exact paragraph text", …] — centre a PARAGRAPH block (song lyrics, a
  // quoted verse) whose whole trimmed text equals the entry — `centre` only matches
  // heading-like blocks, this is its `para`/`listitem` counterpart. Matches by
  // blockPlain so multi-run (bold/italic) paragraphs still match on their plain text.
  for (const cp of ov.centrePara || []) {
    let n = 0;
    for (const b of flat) {
      if (blockPlain(b).trim() !== cp.trim()) continue;
      // a plain paragraph/list item centres via its own `align` field; an exercise
      // "lead" part (no top-level `t`, lives in a parts array) centres the same way
      // via qaparts' own `align` field — everything else (q/colsum/table/image rows,
      // which already carry their own marker-gutter layout) isn't a meaningful target.
      if (b.t === "para" || b.t === "listitem") { b.align = "center"; n++; }
      else if (b.kind === "lead") { b.align = "center"; n++; }
    }
    if (!n) console.warn("!  centrePara not matched:", cp);
  }
  // monoLines: ["exact line text", …] — render a block/exercise-part whose whole trimmed
  // text equals one of these entries in a monospace font with every space preserved
  // exactly (via Typst's raw()), instead of the body's proportional font. Use for an
  // ASCII-art diagram the manuscript laid out with literal spaces for alignment (a boxed
  // arrow-and-triangle diagram, a hand-drawn table) — a proportional font can't hold the
  // columns the author relied on, however evenly the source spaces are counted.
  for (const ml of ov.monoLines || []) {
    let n = 0;
    for (const b of flat) {
      if (blockPlain(b).trim() !== ml.trim()) continue;
      const k = segKey(b);
      if (!k) continue;
      for (const s of b[k]) s.mono = true;
      n++;
    }
    if (!n) console.warn("!  monoLines not matched:", ml);
  }
  // activityHeadsBlack: true — render every activity/exercise heading in bold BLACK
  // instead of the theme accent colour (a book whose author wants them black). Marks
  // `head`/h blocks whose text starts with Activity/Exercise/Task/Project/Discussion.
  if (ov.activityHeadsBlack) {
    const RE = /^(Activity|Exercise|Task|Project|Discussion)\b/i;
    for (const b of flat) if ((b.t === "head" || b.t === "h1" || b.t === "h2" || b.t === "h3") && RE.test((b.text || "").trim())) b.black = true;
  }
  // insertHead: [{ before, head, as?, near?, editAnchor?, unlist? }] — insert a heading
  // block immediately before the block containing `before`. By default the heading is a
  // bold-black `head`; set `as` to another block type (e.g. "h2") to insert a structural
  // heading — an "h2" renders as a styled sub-topic AND is registered in the outline, so
  // it flows into the table of contents (use the mixed-case text you want shown in the
  // TOC; the body uppercases it). `near` disambiguates a repeated anchor: when `before`
  // occurs many times (e.g. "Specific Competence" under every sub-topic), give a UNIQUE
  // downstream text and the insert lands before the nearest `before` block that precedes
  // it. Optionally edit that anchor block (editAnchor: {find, with}) and/or `unlist` it
  // (drop its list marker so the freed content sits under the new heading).
  for (const ih of ov.insertHead || []) {
    let i;
    if (ih.near) {
      const na = blocks.findIndex((b) => blockPlain(b).includes(ih.near));
      i = -1;
      if (na >= 0) for (let k = na; k >= 0 && k >= na - 10; k--) {
        if (blockPlain(blocks[k]).trim().startsWith(ih.before)) { i = k; break; }
      }
    } else {
      i = blocks.findIndex((b) => blockPlain(b).includes(ih.before));
    }
    if (i < 0) { console.warn("!  insertHead not matched:", ih.near ? `${ih.before} near ${ih.near}` : ih.before); continue; }
    if (ih.editAnchor) editBlockText(blocks[i], ih.editAnchor.find, ih.editAnchor.with || "");
    if (ih.unlist) { blocks[i].t = "para"; delete blocks[i].marker; delete blocks[i].isList; delete blocks[i].numId; delete blocks[i].lvl; }
    blocks.splice(i, 0, ih.as ? { t: ih.as, text: ih.head } : { t: "head", text: ih.head, black: true });
  }
  // renameNear: [{ find, near, to, orEmpty? }] — rename ONE specific occurrence of a
  // heading among several IDENTICAL ones (e.g. a manuscript with a dozen bare
  // "Activity 1:" headings each missing its name) by disambiguating with nearby
  // downstream content, same `near` search as insertHead: find the first block
  // containing `near`, then scan backward (up to 10 blocks) for one whose trimmed
  // text starts with `find` — that occurrence's whole text becomes `to` (empty string
  // removes the heading's text, leaving it blank rather than deleting the block, so
  // reading-passage content that was wrongly given an activity label can be unlabelled
  // without disturbing surrounding blocks).
  for (const rn of ov.renameNear || []) {
    const na = blocks.findIndex((b) => blockPlain(b).includes(rn.near));
    let i = -1;
    if (na >= 0) for (let k = na; k >= 0 && k >= na - 10; k--) {
      if (blockPlain(blocks[k]).trim().startsWith(rn.find)) { i = k; break; }
    }
    if (i < 0) { console.warn("!  renameNear not matched:", `${rn.find} near ${rn.near}`); continue; }
    blocks[i].text = rn.to;
    delete blocks[i].segs;
  }
  // pageBreakBefore: ["text", …] — insert a page break before the first TOP-LEVEL
  // block containing the text, so a section that fell at a page foot starts on a fresh
  // page (e.g. "HOW TO USE THIS BOOK" pushed onto its own page after the figure list).
  // An entry may also be `{find, near}` to disambiguate a heading that repeats book-wide
  // (e.g. "END-OF-TOPIC ASSESSMENT" appears once per topic) — only the occurrence within
  // 15 blocks of the block containing `near` is broken.
  for (const t of ov.pageBreakBefore || []) {
    const find = typeof t === "string" ? t : t.find;
    let i;
    if (typeof t === "object" && t.near) {
      const na = blocks.findIndex((b) => blockPlain(b).includes(t.near));
      i = na < 0 ? -1 : blocks.findIndex((b, idx) => Math.abs(idx - na) <= 15 && blockPlain(b).includes(find));
    } else {
      i = blocks.findIndex((b) => blockPlain(b).includes(find));
    }
    if (i >= 0) blocks.splice(i, 0, { t: "pagebreak" }); else console.warn("!  pageBreakBefore not matched:", find);
  }
  // forceFreshPage: [{find, near}] — force a specific activity/exercise/assessment BOX
  // (one too tall to ever fit one page whole — see `keepwhole force:` in
  // generic-template.typ) to always start on a fresh page, instead of starting
  // wherever there happens to be a little room and leaving just its title + a line or
  // two behind as a widow before the natural break. `find` matches the box's
  // title/heading (substring); `near` disambiguates a title that repeats book-wide
  // (e.g. "END-OF-TOPIC ASSESSMENT", once per topic) by requiring a block within 15
  // indices whose full NESTED text (title/heading + every body/parts descendant, not
  // just the top-level blockPlain) includes it.
  for (const fp of ov.forceFreshPage || []) {
    const deepText = (b) => {
      if (!b || typeof b !== "object") return "";
      let s = blockPlain(b);
      if (typeof b.title === "string") s += " " + b.title;
      if (typeof b.heading === "string") s += " " + b.heading;
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) for (const x of b[k]) s += " " + deepText(x);
      return s;
    };
    const isBox = (b) => b && (b.t === "activity" || b.t === "exercise" || b.t === "assessment");
    const boxTitle = (b) => (b.t === "exercise" ? b.heading : b.title) || "";
    let lo = 0, hi = blocks.length;
    if (fp.near) {
      const na = blocks.findIndex((b) => deepText(b).includes(fp.near));
      if (na < 0) { console.warn("!  forceFreshPage `near` not matched:", fp.near); continue; }
      lo = Math.max(0, na - 15); hi = Math.min(blocks.length, na + 15);
    }
    let done = false;
    for (let i = lo; i < hi; i++) {
      if (isBox(blocks[i]) && boxTitle(blocks[i]).includes(fp.find)) { blocks[i].forceFreshPage = true; done = true; break; }
    }
    if (!done) console.warn("!  forceFreshPage not matched:", fp.find, fp.near ? `near ${fp.near}` : "");
  }
  // dropMath: ["exact math source", …] — delete any MATH segment whose trimmed Typst
  // source exactly equals the entry. For excising a stray equation the manuscript
  // typed by mistake (e.g. a floating "15 x = 8" jammed onto a working) that a plain
  // `remove` can't target because it shares a paragraph with legitimate inline math.
  for (const dm of ov.dropMath || []) {
    for (const b of flat) {
      if (!b.segs) continue;
      b.segs = b.segs.filter((s) => !(s.m && (s.t || "").trim() === dm));
      if (b.plain != null) b.plain = b.segs.map((s) => s.t).join("").replace(/\n/g, " ").trim();
    }
  }
  // setMarker: [{ find, marker }] — force the list marker of the (question/answer)
  // part whose text contains `find`. The engine numbers answer sub-parts a, b, c…
  // from the source, but when a diagram or a merged line throws the sequence off,
  // the author tells us the exact label a specific line should carry.
  // every table block/part, reachable so a marker can be pinned to a comparison
  // table answer (tables carry `rows`, not text, so they're outside `flat`).
  const tableText = (t) => (t.rows || []).map((r) => r.map((c) => c.text || "").join(" ")).join(" ");
  const allTables = [];
  (function tv(arr) { for (const b of arr) { if (!b || typeof b !== "object") continue; if (b.rows && (b.t === "table" || b.kind === "table")) allTables.push(b); for (const k of Object.keys(b)) if (Array.isArray(b[k])) tv(b[k]); } })(blocks);
  for (const sm of ov.setMarker || []) {
    const b = flat.find((x) => blockPlain(x).includes(sm.find)) || allTables.find((t) => tableText(t).includes(sm.find));
    if (!b) { console.warn("!  setMarker not matched:", sm.find); continue; }
    b.marker = sm.marker;
    // Promote an unlabelled lead line to a real answer so the marker renders, and
    // honour an explicit depth (default: a sub-answer, depth 1).
    if (b.kind === "lead") { b.kind = "q"; if (b.a == null) b.a = ""; if (b.aseg == null) b.aseg = []; }
    if (b.kind === "q") b.depth = sm.depth != null ? sm.depth : 1;
  }
  // unlist: ["substring", …] — convert a paragraph the importer wrongly parsed as a
  // list item (its marker mis-extracted — e.g. a competence code "c.1.1.3" mistaken for
  // a "c." letter-list marker) back into a plain paragraph: drop the stray list marker
  // so the line sits flush like its sibling paragraphs. Pair with `subtext` to fold a
  // corrected number into the text run (keeping its italic/bold).
  for (const sub of ov.unlist || []) {
    const b = flat.find((x) => x.t === "listitem" && blockPlain(x).includes(sub));
    if (!b) { console.warn("!  unlist not matched:", sub); continue; }
    b.t = "para"; delete b.marker; delete b.isList; delete b.numId; delete b.lvl;
  }
  // mergePara: [{ find, glue? }] — merge the paragraph that FOLLOWS the one matching
  // `find` into it (the manuscript split one sentence — or even one word — across two
  // paragraphs). With `glue: true` the two run lists are concatenated with NO separator
  // (rejoining a word broken mid-way, "helpin" + "g" -> "helping"); otherwise a single
  // space is inserted between them.
  for (const mp of ov.mergePara || []) {
    const i = blocks.findIndex((b) => (b.t === "para" || b.t === "listitem") && blockPlain(b).includes(mp.find));
    if (i < 0) { console.warn("!  mergePara not matched:", mp.find); continue; }
    // count: how many FOLLOWING paragraphs to fold into this one (default 1). Used to
    // re-flow a story/passage that the manuscript hard-broke into one line per sentence.
    // Trailing whitespace/tabs at each seam are stripped so the join reads as prose.
    const n = mp.count || 1;
    for (let c = 0; c < n; c++) {
      if (i + 1 >= blocks.length) { console.warn("!  mergePara ran past end:", mp.find); break; }
      const next = blocks[i + 1];
      if (!(next.t === "para" || next.t === "listitem")) { console.warn("!  mergePara next not a para:", mp.find); break; }
      const a = (blocks[i].segs || [{ t: blocks[i].text || "", b: false, it: false, c: null }]).slice();
      const b2 = (next.segs || [{ t: next.text || "", b: false, it: false, c: null }]).slice();
      if (a.length && typeof a[a.length - 1].t === "string") a[a.length - 1] = { ...a[a.length - 1], t: a[a.length - 1].t.replace(/\s+$/, "") };
      if (b2.length && typeof b2[0].t === "string") b2[0] = { ...b2[0], t: b2[0].t.replace(/^\s+/, "") };
      blocks[i].segs = mp.glue ? [...a, ...b2] : [...a, { t: " ", b: false, it: false, c: null }, ...b2];
      delete blocks[i].text;
      blocks.splice(i + 1, 1);
    }
  }
  // underline: [{ find, all?, scope? }] — underline an exact substring IN PLACE,
  // splitting the run it sits in so ONLY `find` is underlined. Default first match;
  // `all: true` underlines every occurrence across the book (e.g. the target words in
  // a "underline these words" exercise). Tree-aware (reaches box/activity/exercise
  // bodies). Optional `scope: [txt, …]` restricts matching to paragraphs whose
  // trimmed lowercased plain text equals one of the scope entries — used to
  // underline single letters inside phonics word lists without hitting the whole
  // book (e.g. underline "g" only in the words "go", "good", "girl").
  for (const uf of ov.underline || []) {
    let hits = 0;
    const mk = (t, base) => ({ ...base, t, u: true });
    const scopeSet = uf.scope ? new Set(uf.scope.map((s) => s.toLowerCase().trim())) : null;
    const walk = (arr, inScope) => {
      for (const b of arr) {
        if (!b || typeof b !== "object") continue;
        let localScope = inScope;
        if (scopeSet) {
          for (const key of ["segs", "s", "qseg"]) {
            const segs = b[key];
            if (!Array.isArray(segs)) continue;
            const plain = segs.map((s) => (s && !s.m ? (s.t || "") : "")).join("").trim().toLowerCase();
            if (plain && scopeSet.has(plain)) { localScope = true; break; }
          }
        }
        const eligible = scopeSet ? localScope : true;
        if (eligible && (uf.all || !hits)) for (const key of ["segs", "s", "qseg"]) {
          const segs = b[key]; if (!Array.isArray(segs)) continue;
          for (let k = 0; k < segs.length; k++) {
            if (!uf.all && hits && !scopeSet) break;
            const s = segs[k]; if (s.m || typeof s.t !== "string") continue;
            const idx = s.t.indexOf(uf.find); if (idx < 0) continue;
            const before = s.t.slice(0, idx), after = s.t.slice(idx + uf.find.length);
            const repl = [];
            if (before) repl.push({ ...s, t: before });
            repl.push(mk(uf.find, s));
            if (after) repl.push({ ...s, t: after });
            segs.splice(k, 1, ...repl); k += repl.length - 1; hits++;
            if (process.env.DEBUG_UL) console.error(`   underline HIT: find=${uf.find} in b.t=${b.t} key=${key} segs=${JSON.stringify(segs.map(x=>x.t))}`);
            if (!uf.all) break;
          }
        }
        for (const key of Object.keys(b)) if (Array.isArray(b[key])) walk(b[key], localScope);
      }
    };
    walk(blocks, false);
    if (!hits) console.warn("!  underline not matched:", uf.find, uf.scope ? `(scope ${uf.scope.join("/")})` : "");
  }
  // handwriting: [{ find, all? }] — render an exact substring in the theme
  // handwriting font (T.handFont, defaults to Bradley Hand ITC) IN PLACE, by
  // splitting the run and marking the middle piece with `hw: true`. Used for
  // Grade-2 phonics tracing / handwriting activities where the author wants the
  // sample letters shown in a script face. Same walker as `underline`.
  for (const hf of ov.handwriting || []) {
    let hits = 0;
    const mk = (t, base) => ({ ...base, t, hw: true });
    // Fuzzy whitespace: authors often pad tracing letters with multiple spaces or tabs
    // ("b    d    f    h    k    l    t") so match any run of whitespace as one.
    const pat = new RegExp(hf.find.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
    const walk = (arr) => {
      for (const b of arr) {
        if (!b || typeof b !== "object") continue;
        if ((hf.all || !hits)) for (const key of ["segs", "s", "qseg"]) {
          const segs = b[key]; if (!Array.isArray(segs)) continue;
          for (let k = 0; k < segs.length; k++) {
            if (!hf.all && hits) break;
            const s = segs[k]; if (s.m || typeof s.t !== "string") continue;
            const m = s.t.match(pat); if (!m) continue;
            const idx = m.index, hit = m[0];
            const before = s.t.slice(0, idx), after = s.t.slice(idx + hit.length);
            const repl = [];
            if (before) repl.push({ ...s, t: before });
            repl.push(mk(hit, s));
            if (after) repl.push({ ...s, t: after });
            segs.splice(k, 1, ...repl); k += repl.length - 1; hits++;
            if (!hf.all) break;
          }
        }
        for (const key of Object.keys(b)) if (Array.isArray(b[key])) walk(b[key]);
      }
    };
    walk(blocks);
    if (!hits) console.warn("!  handwriting not matched:", hf.find);
  }
  // dropCap: ["opening phrase", …] — mark the paragraph that STARTS with the
  // phrase to render with a dropped initial capital. Used for the opening of
  // reading passages ("One day, a little boy…") the author asked to decorate.
  // Tree-aware so a passage inside an activity box still gets its drop-cap.
  for (const dc of ov.dropCap || []) {
    let done = false;
    const walk = (arr) => {
      for (const b of arr) {
        if (done) return;
        if (!b || typeof b !== "object") continue;
        if (b.t === "para" && Array.isArray(b.segs)) {
          const plain = b.segs.map((s) => (s.m ? "" : s.t || "")).join("").trimStart();
          if (plain.startsWith(dc)) { b.drop = true; done = true; return; }
        }
        for (const key of Object.keys(b)) if (Array.isArray(b[key])) walk(b[key]);
      }
    };
    walk(blocks);
    if (!done) console.warn("!  dropCap not matched:", dc);
  }
  // boldFind: [{ find, scope? }] — make an exact substring bold IN PLACE, splitting the
  // run it sits in so ONLY `find` gets weight (e.g. bolding a lone set-notation symbol the
  // manuscript left in normal weight). First match only. Optional `scope: [txt, …]`
  // restricts matching to blocks whose trimmed plain text equals one of the scope
  // entries — used to bold a grapheme ("oa") only inside its own phonics line without
  // hitting every "oa" in the book.
  for (const bf of ov.boldFind || []) {
    let done = false;
    const scopeSet = bf.scope ? new Set(bf.scope.map((s) => s.replace(/\s+/g, " ").trim())) : null;
    for (const b of flat) {
      if (done) break;
      const segs = b.segs; if (!segs) continue;
      if (scopeSet && !scopeSet.has(blockPlain(b).replace(/\s+/g, " ").trim())) continue;
      for (let k = 0; k < segs.length && !done; k++) {
        const s = segs[k]; if (s.m || typeof s.t !== "string") continue;
        const idx = s.t.indexOf(bf.find); if (idx < 0) continue;
        const before = s.t.slice(0, idx), after = s.t.slice(idx + bf.find.length);
        const mk = (t, bold) => ({ t, b: bold, it: s.it, c: s.c });
        const repl = [];
        if (before) repl.push(mk(before, s.b));
        repl.push(mk(bf.find, true));
        if (after) repl.push(mk(after, s.b));
        segs.splice(k, 1, ...repl); done = true;
      }
    }
    if (!done) console.warn("!  boldFind not matched:", bf.find);
  }
  // stripUnderline: ["exact block text", …] — remove the underline decoration from every
  // run of any block whose trimmed plain text equals the entry. Tree-aware (reaches box/
  // activity/exercise bodies). Use where the manuscript underlined a line that should not
  // be underlined (e.g. an alphabet row "Yy Zz" the author accidentally underlined).
  for (const su of ov.stripUnderline || []) {
    let hits = 0;
    const target = su.replace(/\s+/g, " ").trim();
    const walk = (arr) => {
      for (const b of arr) {
        if (!b || typeof b !== "object") continue;
        if (Array.isArray(b.segs) && blockPlain(b).replace(/\s+/g, " ").trim() === target) {
          for (const s of b.segs) if (s.u) { s.u = false; hits++; }
        }
        for (const key of Object.keys(b)) if (Array.isArray(b[key])) walk(b[key]);
      }
    };
    walk(blocks);
    if (!hits) console.warn("!  stripUnderline not matched:", su);
  }
  // splitBefore: [{ find }] — split a paragraph into two where a RUN begins with `find`.
  // The manuscript glued a following line onto a bold label ("Expected Responses" +
  // "U = {…}"); this drops that run (and everything after it) into a NEW paragraph so
  // the second part sits on its own line under the first. First match only; tree-aware
  // (works inside activity/exercise bodies), and only splits when the label run stays.
  for (const sp of ov.splitBefore || []) {
    let done = false;
    const walk = (arr) => {
      for (let i = 0; i < arr.length && !done; i++) {
        const b = arr[i];
        if (!b || typeof b !== "object") continue;
        if ((b.t === "para" || b.t === "listitem") && b.segs) {
          const k = b.segs.findIndex((s) => typeof s.t === "string" && s.t.trimStart().startsWith(sp.find));
          // carry the source paragraph's alignment onto the new one, so splitting a
          // centred imprint line ("Cover and Page Design by X") leaves both halves
          // centred instead of flushing the tail left
          if (k > 0) { const tail = b.segs.splice(k); arr.splice(i + 1, 0, { t: "para", segs: tail, ...(b.align ? { align: b.align } : {}) }); done = true; return; }
        }
        for (const key of Object.keys(b)) {
          if (Array.isArray(b[key]) && b[key].some((x) => x && typeof x === "object" && (x.segs || x.body || x.parts))) { walk(b[key]); if (done) return; }
        }
      }
    };
    walk(blocks);
    if (!done) console.warn("!  splitBefore not matched:", sp.find);
  }
  // fixExercise: [{ match, near?, heading?, renumber?, parentBefore? }] — repair a
  // specific exercise box's answer numbering. `match` is its heading text; `near`
  // disambiguates repeated headings by a substring of any answer/part. `heading` renames
  // it (restoring a number the author dropped). `renumber: true` numbers every answer
  // part — QUESTIONS AND IMAGES — 1,2,3… in order (skipping the "Answers" divider),
  // overwriting existing markers and flattening to depth 0, so an image answer that was
  // left out of the count is included. `parentBefore: "a."` inserts an empty depth-0 "1."
  // parent immediately before the part with that marker (a sub-list a,b,c… whose parent
  // "1." was lost). Tree-aware; first matching exercise only.
  for (const fx of ov.fixExercise || []) {
    let target = null;
    const walk = (arr) => {
      for (const b of arr) {
        if (!b || typeof b !== "object") continue;
        if (!target && b.t === "exercise" && (b.heading || "").trim().replace(/\s+/g, " ") === fx.match
            && (!fx.near || JSON.stringify(b.parts || []).includes(fx.near))) { target = b; return; }
        for (const k of Object.keys(b)) if (Array.isArray(b[k])) { walk(b[k]); if (target) return; }
      }
    };
    walk(blocks);
    if (!target) { console.warn("!  fixExercise not matched:", fx.match, fx.near || ""); continue; }
    if (fx.heading) target.heading = fx.heading;
    const parts = target.parts || [];
    if (fx.parentBefore) {
      const idx = parts.findIndex((p) => (p.marker || "") === fx.parentBefore);
      if (idx >= 0) parts.splice(idx, 0, { kind: "q", q: "", qseg: [], a: "", aseg: [], marker: "1.", depth: 0 });
      else console.warn("!  fixExercise parentBefore not found:", fx.parentBefore);
    }
    if (fx.renumber) {
      let n = 0;
      for (const p of parts) {
        if (p.kind === "lead" && p.divider) continue;              // keep the "Answers" divider
        if (p.kind === "image" || p.kind === "q" || p.kind === "lead") {
          n++; p.marker = n + "."; p.depth = 0; if (p.kind === "lead") p.kind = "q";
        }
      }
    }
    // markers: ["1.", "", "2.", …] — set each part's marker EXPLICITLY by position, for a box
    // whose items should not all be numbered. An empty string un-numbers that part (a plain
    // instruction line); a value like "1." numbers it. Used where an author numbers only a
    // sub-list inside the box (e.g. Activity 3's four grouping blanks numbered 1–4, with the
    // surrounding "Imagine…"/"Present…" instructions left as plain sentences).
    if (Array.isArray(fx.markers)) {
      parts.forEach((p, idx) => {
        if (idx >= fx.markers.length) return;
        const mk = fx.markers[idx];
        if (mk === null) return;      // null leaves this part exactly as-is (skip it)
        p.marker = mk; p.depth = 0;
        // a non-empty marker must render as a numbered item: promote a bare "lead" line
        // (e.g. an answer sequence the import left un-numbered) to a proper question part.
        if (mk && p.kind === "lead") { p.kind = "q"; p.a = p.a || ""; p.aseg = p.aseg || []; }
      });
    }
  }
  // remove: ["substring", …] — delete any block whose text contains the substring
  // (e.g. trimming a paragraph so a front-matter section fits on one page).
  for (const sub of ov.remove || []) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blockPlain(blocks[i]).includes(sub)) blocks.splice(i, 1);
    }
  }
  // removeWhereNext: [{ find, next }] — delete the FIRST block containing `find`, but
  // only when the block immediately after it contains `next`. Disambiguates one of
  // several identical lines by its following context (e.g. a redundant "Learners should
  // be able to:" that sits right before a specific answer, leaving the legitimate twins
  // elsewhere untouched). Tree-aware (matches inside activity/exercise bodies).
  for (const rw of ov.removeWhereNext || []) {
    let done = false;
    const walk = (arr) => {
      for (let i = 0; i < arr.length && !done; i++) {
        const b = arr[i]; if (!b || typeof b !== "object") continue;
        if (blockPlain(b).includes(rw.find) && arr[i + 1] && blockPlain(arr[i + 1]).includes(rw.next)) {
          arr.splice(i, 1); done = true; return;
        }
        for (const key of Object.keys(b)) {
          if (Array.isArray(b[key]) && b[key].some((x) => x && typeof x === "object" && (x.segs || x.body || x.parts || typeof x.text === "string"))) { walk(b[key]); if (done) return; }
        }
      }
    };
    walk(blocks);
    if (!done) console.warn("!  removeWhereNext not matched:", rw.find);
  }
  // removeRange: [{ from, to, after? }] — delete a contiguous run of blocks, from the
  // first block containing `from` up to (but NOT including) the next block containing
  // `to`. Use when the two anchors share text a plain `remove` can't tell apart (e.g. a
  // duplicated/mislabelled sub-topic heading that must go while its twin stays).
  // Optional `after`: only start searching for `from` AFTER the block containing this
  // text — needed when `from` itself repeats book-wide (e.g. a duplicated lesson whose
  // heading "LISTENING AND SPEAKING: LESSON 1" is not unique) so the removal targets
  // the intended occurrence rather than the first one in the book.
  for (const rr of ov.removeRange || []) {
    let base = 0;
    if (rr.after) {
      const a = blocks.findIndex((b) => blockPlain(b).includes(rr.after));
      if (a < 0) { console.warn("!  removeRange 'after' not matched:", rr.after); continue; }
      base = a + 1;
    }
    const start = blocks.findIndex((b, i) => i >= base && blockPlain(b).includes(rr.from));
    if (start < 0) { console.warn("!  removeRange start not matched:", rr.from); continue; }
    let end = blocks.findIndex((b, i) => i > start && blockPlain(b).includes(rr.to));
    if (end < 0) { console.warn("!  removeRange end not matched:", rr.to); continue; }
    blocks.splice(start, end - start);
  }
  // moveBefore: [{ find, before }] — lift the block whose text contains `find` and
  // re-insert it immediately before the block whose text contains `before`. Used to
  // reorder items the author wants resequenced (e.g. putting the AUTHORS bios into
  // alphabetical order) without retyping the paragraph and risking a transcription
  // error. `find`/`before` also match an IMAGE block by its filename (e.g. "imp_image4"),
  // so a floating image the importer anchored out of reading order — placed before its
  // activity instead of after it, next to its caption — can be moved back to the
  // manuscript's visual order. Anchors are matched against the CURRENT order, so list
  // moves front-to-back.
  const mbMatch = (b, needle) => blockPlain(b).includes(needle) || (b.t === "image" && (b.file || "").includes(needle));
  for (const mv of ov.moveBefore || []) {
    // `near`: disambiguate a `find` that recurs throughout the book (e.g. a generic
    // "Reading Passage" heading repeated every lesson) — locate the UNIQUE `near` text
    // first, then scan backward from it (up to 10 blocks) for the nearest `find` match.
    let from;
    if (mv.near) {
      const na = blocks.findIndex((b) => mbMatch(b, mv.near));
      from = -1;
      if (na >= 0) for (let k = na; k >= 0 && k >= na - 10; k--) if (mbMatch(blocks[k], mv.find)) { from = k; break; }
    } else {
      from = blocks.findIndex((b) => mbMatch(b, mv.find));
    }
    if (from < 0) { console.warn("!  moveBefore source not matched:", mv.near ? `${mv.find} near ${mv.near}` : mv.find); continue; }
    const [blk] = blocks.splice(from, 1);
    let to = blocks.findIndex((b) => mbMatch(b, mv.before));
    if (to < 0) { console.warn("!  moveBefore target not matched:", mv.before); blocks.splice(from, 0, blk); continue; }
    blocks.splice(to, 0, blk);
  }
  // moveSectionBefore: [{ find, before, until? }] — like moveBefore, but lifts a WHOLE
  // SECTION (the heading whose text contains `find`, plus every block after it up to —
  // but not including — the NEXT heading) and re-inserts the whole span immediately
  // before the block whose text contains `before`. Use to reorder a front/back-matter
  // SECTION (e.g. "LIST OF FIGURES" plus its loentry list) rather than just its heading
  // line. `until` overrides the automatic "next heading" end boundary with an explicit
  // one — needed when the section swallows a SUB-heading (e.g. an insertText-added "LIST
  // OF TABLES" sub-list) that must move together with it rather than ending the span.
  const isHeadingLike = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label";
  // A manuscript sometimes bolds a WHOLE acronym/glossary entry line by mistake ("ABCD:
  // Anthropometric, …"), which imports as its own heading-like block — reformatAcronyms
  // fixes that later, but at THIS point (applyOverrides runs first) it still looks like a
  // heading and would wrongly end the section scan one line early. Recognise the same
  // "SHORT-TOKEN: meaning" shape here so such an entry is treated as section CONTENT.
  const ENTRY_RE = /^[A-Za-z][A-Za-z0-9./]{0,9}:\s*\S/;
  const isBoundary = (b) => isHeadingLike(b) && !ENTRY_RE.test(blockPlain(b).trim());
  for (const mv of ov.moveSectionBefore || []) {
    const start = blocks.findIndex((b) => isHeadingLike(b) && blockPlain(b).includes(mv.find));
    if (start < 0) { console.warn("!  moveSectionBefore source not matched:", mv.find); continue; }
    let end = mv.until
      ? blocks.findIndex((b, i) => i > start && isHeadingLike(b) && blockPlain(b).includes(mv.until))
      : blocks.findIndex((b, i) => i > start && isBoundary(b));
    if (end < 0) end = blocks.length;
    const span = blocks.splice(start, end - start);
    let to = blocks.findIndex((b) => isHeadingLike(b) && blockPlain(b).includes(mv.before));
    if (to < 0) { console.warn("!  moveSectionBefore target not matched:", mv.before); blocks.splice(start, 0, ...span); continue; }
    blocks.splice(to, 0, ...span);
  }
  // tables: [{ match, columns?, rows: [[c, c], …] }] — replace a table the writer
  // built badly (e.g. a matching table with every term lumped in one cell) with a
  // clean grid. Searches top-level blocks AND box/activity bodies and exercise/
  // assessment parts (where reference tables live).
  for (const t of ov.tables || []) {
    const richRows = [];
    if (t.columns) richRows.push(t.columns.map((c) => ({ text: c, imgs: [] })));
    for (const row of t.rows) richRows.push(row.map((c) => ({ text: c, imgs: [] })));
    if (!replaceTableRows(blocks, t.match, richRows)) console.warn("!  table override not matched:", t.match);
  }
  // replaceSection: [{ heading, until?, rename?, items: [...] }] — swap the whole body
  // of a section (from the heading down to, but NOT including, the next section) for
  // author-supplied replacement content. `heading`/`until` match a heading-like block by
  // case-insensitive prefix; omit `until` for the LAST section (runs to end of document).
  // `rename` retitles the heading in place. Each `items` entry is a markup string
  // (**bold**, *italic*, $math$) rendered as a body paragraph, or "## text" for a bold
  // sub-heading. `gap` (a length, e.g. "0.9em") adds vertical space BETWEEN items — for
  // a reference list where each entry should be separated by a blank line. Runs BEFORE
  // reformatAcronyms/formatGlossary, so plain "Term – meaning" lines dropped into an
  // ACRONYMS/GLOSSARY section are auto-formatted to house style; give References their
  // italics explicitly (nothing reformats them).
  const isHeadBlk = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label"
    || (b.t === "h1" && /^(UNIT|TOPIC|CHAPTER|CHIBALU|CIPATI)\b/i.test(b.text || ""));
  for (const rs of ov.replaceSection || []) {
    const pref = (s) => (s || "").trim().toUpperCase();
    const h = blocks.findIndex((b) => isHeadBlk(b) && pref(blockPlain(b)).startsWith(pref(rs.heading)));
    if (h < 0) { console.warn("!  replaceSection heading not matched:", rs.heading); continue; }
    let e;
    if (rs.until) {
      e = blocks.findIndex((b, i) => i > h && pref(blockPlain(b)).startsWith(pref(rs.until)));
      if (e < 0) { console.warn("!  replaceSection 'until' not matched, skipping:", rs.until); continue; }
    } else {
      e = blocks.findIndex((b, i) => i > h && isHeadBlk(b));
      if (e < 0) e = blocks.length;
    }
    if (rs.rename) setBlockText(blocks[h], rs.rename);
    const nb = [];
    (rs.items || []).forEach((it, idx) => {
      if (rs.gap && idx > 0) nb.push({ t: "vspace", h: rs.gap });
      nb.push(typeof it === "string" && it.startsWith("## ")
        ? { t: "head", text: it.slice(3), black: true }
        : { t: "para", segs: mkSegs(String(it)) });
    });
    blocks.splice(h + 1, e - (h + 1), ...nb);
  }
}
// Find a table (top-level, inside a box/activity body, or as an exercise/
// assessment part) whose current content contains `match`, and replace its rows.
function replaceTableRows(blocks, match, rows) {
  const hit = (tb) => tb && JSON.stringify(tb.rows || tb).includes(match);
  for (const b of blocks) {
    if (b.t === "table" && hit(b)) { b.rows = rows; return true; }
    for (const sub of b.body || []) if (sub.t === "table" && hit(sub)) { sub.rows = rows; return true; }
    for (const p of b.parts || []) if (p.kind === "table" && JSON.stringify(p.rows).includes(match)) { p.rows = rows; return true; }
  }
  return false;
}

// In an ACRONYMS section, manuscripts align "ABBR    Full Word" with spaces/tabs.
// Render them as "ABBR: Full Word" (bold abbreviation, colon, then the full form).
function reformatAcronyms(blocks) {
  // The ACRONYMS heading can arrive as any heading-like block (h1/h2/head/label)
  // depending on how the manuscript styled it — and it may only be promoted to
  // h1 later — so toggle on ANY heading whose text is "ACRONYMS" or "LIST OF
  // ACRONYMS", and off at the next (non-entry) heading. (Order-independent: works
  // whenever this runs.)
  const isHeadingBlk = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label";
  const cleanMeaning = (s) => String(s || "").replace(/^[\s:–—-]+/, "").trim();
  // A manuscript sometimes bolds an ENTIRE acronym line by mistake ("ABCD: Anthropometric,
  // Biochemical, Clinical and Dietary Assessment") instead of just the abbreviation — that
  // imports as its own `head`/`label` block (all-bold text reads as a heading), not the
  // `para` every correctly-typed sibling entry becomes. Recognise a heading-like block
  // whose text is "SHORT-TOKEN: meaning" as an acronym ENTRY while inside the list — not a
  // new section — so it still gets split into a bold abbreviation + plain meaning below.
  const ENTRY_RE = /^[A-Za-z][A-Za-z0-9./]{0,9}:\s*\S/;
  let inAcronyms = false;
  for (const b of blocks) {
    const asEntry = inAcronyms && isHeadingBlk(b) && ENTRY_RE.test((b.text || "").trim());
    if (isHeadingBlk(b) && !asEntry) { inAcronyms = /^(LIST OF )?ACRONYMS\b/i.test((b.text || "").trim()); continue; }
    if (asEntry) {
      // fold the whole-bold heading down to a plain paragraph so the split logic below
      // can re-bold just the abbreviation, matching its correctly-typed siblings.
      b.t = "para"; b.segs = [{ t: (b.text || "").trim(), b: false, it: false, c: null }];
      delete b.text; delete b.marker;
    }
    if (!inAcronyms || b.t !== "para" || !(b.segs && b.segs.length)) continue;
    const segs = b.segs;
    // House format "ABBR- Full form" / "ABBR-Full form" (a hyphen between the
    // abbreviation and its meaning) — split on the FIRST hyphen and render
    // "ABBR: Full form". The abbreviation is a short token (letters/dots) with no
    // spaces, e.g. BA, GIS, H.E., PhD, V.I., ZEPH.
    const full = segs.map((s) => s.t).join("").trim();
    const hy = full.match(/^([A-Za-z][A-Za-z.]{0,7})\s*-\s*(\S.*)$/);
    if (hy && !/\s/.test(hy[1])) {
      b.segs = [
        { t: hy[1].replace(/:+$/, ""), b: true, it: false, c: null },
        { t: ": ", b: false, it: false, c: null },
        { t: cleanMeaning(hy[2]), b: false, it: false, c: null },
      ];
      continue;
    }
    // The abbreviation is the leading run; the meaning follows after a whitespace
    // gap (often its own padding runs). Keep the meaning's original runs so the
    // writer's bold capitals (e.g. **A**ntidiuretic **H**ormone) are preserved.
    let abbr = (segs[0].t || "").trim().replace(/:+$/, "");
    if (!abbr) continue;
    let k = 1;
    while (k < segs.length && segs[k].t.trim() === "") k++;   // skip padding spaces
    let rest = segs.slice(k);
    if (rest.length) rest = [{ ...rest[0], t: cleanMeaning(rest[0].t) }, ...rest.slice(1)];
    // Fallback: abbreviation and meaning shared one run ("ABBR  Full Word").
    if (!rest.length || !rest.map((s) => s.t).join("").trim()) {
      const m = segs.map((s) => s.t).join("").match(/^(\S+)\s+(.+)$/);
      if (!m) continue;
      abbr = m[1].replace(/:+$/, "");
      rest = [{ t: m[2].trim(), b: false, it: false, c: null }];
    }
    b.segs = [
      { t: abbr, b: true, it: false, c: null },
      { t: ": ", b: false, it: false, c: null },
      ...rest,
    ];
  }
}

// Within a GLOSSARY section, render each entry as "term" (bold) + ": " +
// meaning (regular) — dropping the manuscript's "Term – meaning" dash and any
// stray bold on the whole line. The separator must be a dash SURROUNDED by
// spaces so hyphenated terms ("Well-being") and definitions ("non-living") stay
// intact.
function formatGlossary(blocks) {
  const isHead = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label";
  const ENTRY = /^(.{1,40}?)(?:\s+[–—-]\s+|:\s+)(.+)$/s;   // "Term – meaning" or "Term: meaning"
  // Render one entry as: term (bold) + ": " + meaning (regular).
  const toEntry = (b, m) => {
    b.t = "para"; delete b.text; delete b.marker;
    b.segs = [
      { t: m[1].trim(), b: true, it: false, c: null },
      { t: ": ", b: false, it: false, c: null },
      { t: m[2].trim().replace(/\s+/g, " "), b: false, it: false, c: null },
    ];
  };
  let inGloss = false;
  for (const b of blocks) {
    const full = (b.segs ? b.segs.map((s) => s.t).join("") : b.text || "").trim();
    if (isHead(b)) {
      // The GLOSSARY section can open as any heading style (h1/h2/head/label),
      // depending on how the manuscript styled it and the import variant.
      if (/^GLOSSARY\b/i.test(full)) { inGloss = true; b.t = "h1"; b.text = "GLOSSARY OF TERMS"; continue; }
      // A single-letter alphabetical divider ("A", "B", "C"…) inside the glossary
      // is just a section marker — keep it, but don't let it end the glossary.
      if (inGloss && /^[A-Z]$/.test(full)) continue;
      // Inside the glossary, a heading-styled line that is really an entry
      // ("Activity – A task…") — the manuscript bolded some terms so the importer
      // read them as heads — is converted to a normal entry and the glossary
      // continues. Any OTHER heading (a genuine new section) ends the glossary.
      if (inGloss && ENTRY.test(full) && full.length <= 200) { toEntry(b, full.match(ENTRY)); continue; }
      inGloss = false;
      continue;
    }
    if (!inGloss) continue;
    const m = full.match(ENTRY);
    if (m) toEntry(b, m);
  }
}

function reorderBackmatter(blocks) {
  const getText = (b) => {
    if (!b) return "";
    if (typeof b === "string") return b;
    if (b.text) return b.text;
    if (b.plain) return b.plain;
    if (Array.isArray(b.segs)) return b.segs.map((s) => s.t || "").join("");
    return "";
  };

  let refHeader = null;
  let refItems = [];

  // Case 1: Standalone References heading block
  let refIdx = blocks.findIndex((b) => b && (b.t === "h1" || b.t === "h2" || b.t === "head" || b.t === "label" || b.t === "para") && /^references\b/i.test(getText(b).trim()));
  if (refIdx >= 0) {
    refHeader = { t: "h1", text: "REFERENCES" };
    let j = refIdx + 1;
    while (j < blocks.length && blocks[j].t !== "h1" && !/^GLOSSARY\b/i.test(getText(blocks[j]).trim())) {
      refItems.push(blocks[j]);
      j++;
    }
    blocks.splice(refIdx, j - refIdx);
  } else {
    // Case 2: Embedded inside exercise block
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b && (b.t === "exercise" || b.kind === "exercise") && Array.isArray(b.parts)) {
        const pIdx = b.parts.findIndex(p => p && (p.q || p.text) && /^references\b/i.test((p.q || p.text).trim()));
        if (pIdx >= 0) {
          const extracted = b.parts.splice(pIdx);
          refHeader = { t: "h1", text: "REFERENCES" };
          for (let k = 1; k < extracted.length; k++) {
            const item = extracted[k];
            const segs = item.qseg || [{ t: item.q || item.text || "", b: false, it: false }];
            refItems.push({
              t: "listitem",
              segs: segs,
              isList: true,
              marker: "•"
            });
          }
          break;
        }
      }
    }
  }

  // Format Glossary Header
  let glossIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const text = getText(b).trim();
    if (b && (b.t === "h2" || b.t === "h1" || b.t === "head" || b.t === "label" || b.t === "para") && /^GLOSSARY\b/i.test(text)) {
      b.t = "h1";
      b.text = "GLOSSARY OF TERMS";
      glossIdx = i;
    }
  }

  // Re-order: Place References AFTER Glossary
  if (refHeader && refItems.length > 0) {
    let insertIdx = blocks.length;
    if (glossIdx >= 0) {
      let j = glossIdx + 1;
      while (j < blocks.length && blocks[j].t !== "h1") j++;
      insertIdx = j;
    }
    blocks.splice(insertIdx, 0, refHeader, ...refItems);
    console.log(`reorderBackmatter: Successfully moved ${refItems.length} reference items to after Glossary at index ${insertIdx}`);
  }
}

// Proofreader house-style polish (primary Teacher's Guides): make the recurring
// structural labels consistent bold black sub-heads, italicise the "General
// Competences" value line and the specific-competence code statements, and bold
// the author's name — normalising the manuscript's inconsistent formatting.
// The "General Competences", "Specific Competences" and "Expected Standards"
// outcome lines are statements, not a checklist — the author asked for the bullets
// removed. Runs for EVERY book (unlike proofPolish, which is gated on boxActivities)
// so Teacher's Guides in the "science" layout are de-bulleted too.
function debulletStandards(blocks) {
  const textOf = (b) => (b.text || (b.segs ? b.segs.map((s) => s.t).join("") : "")).trim();
  const isHead = (b) => b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t);
  const VALSEC = /^(General\s+Competences?|Specific\s+Competences?|Expected\s+Standards?)\b/i;
  for (let i = 0; i < blocks.length; i++) {
    if (!(isHead(blocks[i]) && VALSEC.test(textOf(blocks[i])))) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const y = blocks[j];
      if (isHead(y)) break;
      // Strip only the BULLET marker — keep numbered competence codes ("4.4.1.1").
      if (y.marker === "•") { y.t = "para"; delete y.marker; }
    }
  }
}
// Authors indent lines in Word by typing runs of spaces (or a tab) rather than using
// a paragraph indent. Typeset into a justified column those become ragged, random
// gaps — a passage reads as if every other line is pushed inwards, and mid-sentence
// runs open holes in the text ("them to   celebrate"). Normalise every text run:
// drop whitespace-only runs at the START of a block, trim the leading whitespace off
// its first run, collapse any run of 3+ spaces to one, and trim the trailing edge.
// Deliberately conservative: single and double spaces are untouched (so "a + b = c"
// blend lines and fill-in underscores are unaffected), and structural indentation
// (numbered markers, worked-solution continuation, boxed leads) is layout, not
// spaces, so it is unaffected too. Runs for EVERY book.
// Authors lay out word lists in two or three columns by typing a big run of spaces
// The imprint page credits the typesetter on a "Cover and Book Layout:" line, which
// the manuscripts leave as an empty dot-leader placeholder ("…………"). We do the
// typesetting, so fill that placeholder with our credit on every book. Match the
// label, then set the next dot-leader-only line (within a few blocks) to the name.
const LAYOUT_CREDIT = "Gift Kapula";
function fillLayoutCredit(blocks) {
  const LABEL = /cover\s+and\s+book\s+layout/i;
  const DOTS = /^[.•․…·\s]+$/;   // only dots / ellipses / middots / space
  const walk = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      for (const k of ["body", "parts", "items", "blocks"]) if (Array.isArray(b[k])) walk(b[k]);
      if (!LABEL.test(blockPlain(b))) continue;
      // The credit sits on the next non-empty line. We do the typesetting/layout for every
      // ZEPH book, so set it to our credit whether the manuscript left a dot-leader
      // placeholder ("……") OR filled in someone else's name (some authors self-credit the
      // layout). Only skip if it is ALREADY our credit.
      for (let j = i + 1; j < Math.min(i + 4, arr.length); j++) {
        const txt = blockPlain(arr[j]).trim();
        if (txt === "") continue;
        if (txt !== LAYOUT_CREDIT) setBlockSegs(arr[j], [{ t: LAYOUT_CREDIT, b: false, it: false, c: null }]);
        return;
      }
      return;
    }
  };
  walk(blocks);
}

function unboldLeadProse(blocks) {
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "para" && Array.isArray(b.segs) && b.segs.length > 0) {
        const plain = b.segs.map((s) => s.t || "").join("");
        const m = plain.match(/^([A-Z][A-Za-z\s]{1,35}:)(.*)/);
        if (m) {
          const lead = m[1];
          const rest = m[2];
          const isLeadTopic = /^(Health|Agriculture|Environmental Protection|Food and Nutrition|Land pollution|Water pollution|Air pollution|Human health|Loss of biodiversity|Resource depletion|Decantation|Centrifugation|Filtration|Evaporation|Distillation|Chromatography):/.test(lead);
          if (isLeadTopic && rest.length > 10) {
            b.segs = [
              { t: lead, b: true, it: false },
              { t: rest, b: false, it: false }
            ];
          }
        }
      }
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) walk(b[k]);
      }
    }
  };
  walk(blocks);
}

// A manuscript's table sometimes outgrew one Word page, so the author manually split it
// into two separate tables — a first "LEARNING ACTIVITY N: Title" activity, then a second
// "LEARNING ACTIVITY N: Title (Continuation)" activity whose table repeats the header row
// and continues with the remaining rows. Each import as its OWN boxed activity, so the
// typeset book shows two distinct boxes (the second an orphaned header + tail of rows) where
// the author meant one continuous table. Fold the continuation's table (minus its repeated
// header row) and any trailing body blocks back into the first activity, then drop it.
function mergeContinuationActivities(blocks) {
  const CONT = /\s*\(Continuation\)\s*$/i;
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== "activity" || !CONT.test(b.title || "")) continue;
    const baseTitle = b.title.replace(CONT, "").trim();
    const prev = blocks[i - 1];
    if (!prev || prev.t !== "activity" || (prev.title || "").trim() !== baseTitle) continue;
    const contTableIdx = (b.body || []).findIndex((x) => x.t === "table");
    if (contTableIdx < 0) continue;
    let prevTableIdx = -1;
    for (let j = (prev.body || []).length - 1; j >= 0; j--) if (prev.body[j].t === "table") { prevTableIdx = j; break; }
    if (prevTableIdx < 0) continue;
    const contTable = b.body[contTableIdx];
    prev.body[prevTableIdx].rows.push(...contTable.rows.slice(1));   // drop the repeated header row
    const extras = b.body.filter((x, k) => k !== contTableIdx);
    if (extras.length) prev.body.push(...extras);
    blocks.splice(i, 1);
    i--;
  }
}

function splitActivityTables(blocks) {
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      if (b.t === "table" || b.t === "dtable") {
        if (Array.isArray(b.rows) && b.rows.length >= 2) {
          const actRowIdx = b.rows.findIndex((r, rIdx) => {
            if (rIdx === 0) return false;
            const cellTxt = r.map((c) => (typeof c === "string" ? c : (c.text || c.plain || (c.segs ? c.segs.map((s) => s.t || "").join("") : "")))).join("");
            return /^(LEARNING\s+)?ACTIVIT(?:Y|IES)\s+\d+/i.test(cellTxt.trim());
          });

          if (actRowIdx > 0) {
            const table1Rows = b.rows.slice(0, actRowIdx).filter((r) => {
              const txt = r.map((c) => (typeof c === "string" ? c : (c.text || c.plain || (c.segs ? c.segs.map((s) => s.t || "").join("") : "")))).join("").trim();
              return txt.length > 0;
            });

            const table2Rows = b.rows.slice(actRowIdx).filter((r) => {
              const txt = r.map((c) => (typeof c === "string" ? c : (c.text || c.plain || (c.segs ? c.segs.map((s) => s.t || "").join("") : "")))).join("").trim();
              return txt.length > 0;
            });

            const blk1 = { ...b, rows: table1Rows };
            const blk2 = { ...b, rows: table2Rows };

            arr.splice(i, 1, blk1, blk2);
            console.log(`splitActivityTables: Successfully split table block [${i}] at row ${actRowIdx} into 2 separate blocks`);
            i++;
          }
        }
      }
      if (b.body) walk(b.body);
    }
  };
  walk(blocks);
}

function convertTableActivities(blocks) {
  const getTableText = (tBlock) => {
    if (!tBlock || !Array.isArray(tBlock.rows)) return "";
    let txt = "";
    for (const row of tBlock.rows) {
      if (Array.isArray(row)) {
        for (const cell of row) {
          if (cell) {
            if (typeof cell === "string") txt += cell + " ";
            else if (cell.text) txt += cell.text + " ";
            else if (cell.plain) txt += cell.plain + " ";
            else if (Array.isArray(cell.segs)) txt += cell.segs.map((s) => s.t || "").join("") + " ";
          }
        }
      }
    }
    return txt.trim();
  };

  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      if (b.t === "table" || b.t === "box" || b.t === "dtable") {
        const plain = (b.t === "table" || b.t === "dtable") ? getTableText(b) : blockPlain(b).trim();
        // Accept the plural "LEARNING ACTIVITIES N" (a common author slip) and the stray
        // "LEARNING MODELS N" as activity titles too — all normalised to "LEARNING ACTIVITY N".
        const m = plain.match(/^(LEARNING\s+(ACTIVIT(?:Y|IES)|MODELS?)\s+\d+:?[^\n\r]*|(ACTIVIT(?:Y|IES)|MODELS?)\s+\d+:?[^\n\r]*)/i);
        if (m) {
          let title = m[1].trim().replace(/\bLEARNING\s+(MODELS?|ACTIVITIES)\b/i, "LEARNING ACTIVITY");
          let bodyText = plain.slice(m[0].length).trim();
          if (title.includes("\n")) {
            const parts = title.split("\n");
            title = parts[0].trim().replace(/\bLEARNING\s+(MODELS?|ACTIVITIES)\b/i, "LEARNING ACTIVITY");
            bodyText = parts.slice(1).join("\n").trim() + " " + bodyText;
          }
          arr[i] = {
            t: "activity",
            title: title,
            body: [
              {
                t: "para",
                segs: [
                  { t: bodyText, b: false, it: true }
                ]
              }
            ]
          };
          console.log("Successfully converted 1-cell activity table:", title);
        }
      }
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) walk(b[k]);
      }
    }
  };
  walk(blocks);
}

function ensureOrIndividually(blocks) {
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "activity") {
        const bodyArr = Array.isArray(b.body) ? b.body : [];
        for (const sub of bodyArr) {
          if (sub && Array.isArray(sub.segs)) {
            for (let i = 0; i < sub.segs.length; i++) {
              const s = sub.segs[i];
              if (s && typeof s.t === "string") {
                s.t = s.t.replace(/\b(in\s+(small\s+)?groups|in\s+pairs|working\s+in\s+groups|work\s+in\s+groups|in\s+group)(\s*,?\s*)(?!or\s+individually)/gi, (match, p1) => {
                  return `${p1} or individually `;
                });
                if (s.t.trimEnd().endsWith("individually")) {
                  s.t = s.t.trimEnd() + " ";
                }
              }
            }
          }
        }
      }
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) walk(b[k]);
      }
    }
  };
  walk(blocks);
}
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
function normaliseSpacing(blocks) {
  const fix = (segs) => {
    if (!Array.isArray(segs) || !segs.length) return;
    // drop leading whitespace-only runs
    while (segs.length && typeof segs[0].t === "string" && /^\s+$/.test(segs[0].t) && segs.length > 1) segs.shift();
    for (const s of segs) {
      if (!s || typeof s.t !== "string") continue;
      s.t = s.t.replace(/[ \t]{3,}/g, " ").replace(/\t/g, " ");
    }
    if (typeof segs[0].t === "string") segs[0].t = segs[0].t.replace(/^[ \t]+/, "");
    const last = segs[segs.length - 1];
    if (last && typeof last.t === "string") last.t = last.t.replace(/[ \t]+$/, "");
  };
  const walk = (arr) => {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (Array.isArray(b.segs)) fix(b.segs);
      if (Array.isArray(b.qseg)) fix(b.qseg);
      if (Array.isArray(b.s)) fix(b.s);
      if (typeof b.q === "string") b.q = b.q.replace(/[ \t]{3,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
      if (typeof b.text === "string") b.text = b.text.replace(/[ \t]{3,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
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
        const after = s.t.slice(m.index + m[0].length);
        qSegs = segs.slice(0, i).concat(before.trim() ? [{ ...s, t: before }] : []);
        aSegs = (after.trim() ? [{ ...s, b: false, t: after }] : []).concat(segs.slice(i + 1));
        break;
      }
    }
    if (!aSegs || !aSegs.length) return null;
    if (qSegs.length) qSegs[qSegs.length - 1] = { ...qSegs[qSegs.length - 1], t: qSegs[qSegs.length - 1].t.replace(/\s+$/, "") };
    aSegs[0] = { ...aSegs[0], t: aSegs[0].t.replace(/^\s+/, "") };
    return [qSegs, aSegs];
  };
  // An exercise/assessment question part: move the answer runs to `aseg` (the template
  // then sets them on their own highlighted "Possible answer:" line).
  const splitPart = (p) => {
    if (!Array.isArray(p.qseg) || !p.qseg.length) return;
    if (Array.isArray(p.aseg) && p.aseg.length) return;             // already split
    const c = cut(p.qseg);
    if (!c) return;
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
        for (const p of b.parts) if (p && (p.kind === "q" || p.kind === "lead")) splitPart(p);
      } else if ((b.t === "para" || b.t === "listitem") && Array.isArray(b.segs)) {
        splitPara(b);
      }
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) walk(b[k]);
    }
  };
  walk(blocks);
}
function boldAssessmentSections(blocks) {
  const SEC = /^(listening\s+and\s+speaking|reading\s+and\s+writing|listening\s*&\s*speaking|reading\s*&\s*writing)\s*[:.]?$/i;
  const walk = (arr) => {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "framedsection" && b.kind === "asmt" && Array.isArray(b.body)) {
        for (const it of b.body) {
          if (!it || !Array.isArray(it.segs)) continue;
          const txt = it.segs.map((s) => s.t).join("").trim();
          // These strand sub-headings are made bold here; the manuscript often ALSO
          // underlines them, which is redundant once they are bold — drop the underline.
          if (SEC.test(txt)) for (const s of it.segs) { s.b = true; s.u = false; }
        }
      }
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) walk(b[k]);
    }
  };
  walk(blocks);
}
// Every topic opens with an "Introduction" sub-head. Most manuscripts style it
// bold so it is detected as a label, but occasionally the author leaves it as
// plain body text and it renders un-bolded, inconsistent with its sibling topics.
// Promote a lone "Introduction" paragraph to a bold label so every topic matches.
function labelIntroductions(blocks) {
  for (const b of blocks) {
    if (b.t !== "para" || !b.segs) continue;
    const txt = b.segs.map((s) => s.t).join("").trim();
    if (/^introduction$/i.test(txt)) { b.t = "head"; b.text = txt; delete b.segs; }
  }
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
      b.text = textOf(b); b.t = "head"; delete b.segs; delete b.marker;
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
  // ("General competences:", "Specific competence 2.1.3.1:", "Expected standard:",
  // "Teaching methodology:", "Suggested teaching and learning resources:", "Vocabulary:",
  // "Structure:", "Component:"), whatever the manuscript's (inconsistent) casing. Only the
  // label part up to the colon is recased — the numeric code and the value stay untouched.
  // (Topic / Sub-Topic are proper identifiers kept in Title Case by step 1e, so excluded.)
  const CASEFIELD = /^(general\s+competences?|specific\s+competences?|expected\s+standards?|teaching\s+methodology|suggested\s+teaching\s+and\s+learning\s+(?:resources?|materials?)|teaching\s+and\s+learning\s+(?:resources?|materials?)|vocabulary|structure|component|key\s*words?|learning\s+outcomes?)\b/i;
  const sentenceLabel = (t) => {
    const ci = t.indexOf(":");
    const head = ci >= 0 ? t.slice(0, ci) : t;
    const tail = ci >= 0 ? t.slice(ci) : "";
    return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase() + tail;
  };
  for (const b of blocks) {
    if ((b.t === "head" || b.t === "label") && CASEFIELD.test((b.text || "").trim())) {
      b.text = sentenceLabel(b.text);
    } else if ((b.t === "para" || b.t === "listitem") && b.segs && b.segs.length) {
      const lead = b.segs.find((s) => s.t.trim());
      if (lead && CASEFIELD.test(lead.t.trim())) lead.t = sentenceLabel(lead.t);
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

// Group each lesson's header metadata — the "LESSON N" opener plus its Component /
// Topic / Sub-Topic / competences / Expected Standard / methodology / vocabulary
// fields — into ONE distinct panel block, set larger than body text so the lesson plan
// reads as a self-contained header, visually separate from the lesson prose. The run
// ends at the lesson's "LEARNING ACTIVITIES" heading, its first boxed activity, the next
// lesson, or the next unit — whichever comes first. Runs AFTER boxifyActivities so the
// boxes exist as boundaries.
function groupLessonMeta(blocks) {
  const textOf = (b) => (b.text || (b.segs ? b.segs.map((s) => s.t).join("") : "")).trim();
  const isHeadType = (b) => b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t);
  const isOpener = (b) => {
    const t = textOf(b);
    if (!/\bLESSON\s+\d+\b/i.test(t)) return false;
    if (isHeadType(b)) return true;
    // a bold standalone "LESSON N" / "COMPONENT: LESSON N" paragraph
    return b.t === "para" && t.length <= 60 && !!b.segs && b.segs.every((s) => s.b || !s.t.trim());
  };
  const isUnit = (b) => b.t === "h1" || (isHeadType(b) && /^UNIT\b/i.test(textOf(b)));
  const isActivities = (b) => isHeadType(b) && /^LEARNING\s+ACTIVIT/i.test(textOf(b));
  const isBox = (b) => ["framedsection", "activity", "exercise", "assessment", "box"].includes(b.t);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!isOpener(b)) { out.push(b); continue; }
    const title = textOf(b);
    const body = [];
    let j = i + 1;
    for (; j < blocks.length; j++) {
      const y = blocks[j];
      if (isActivities(y) || isBox(y) || isUnit(y) || isOpener(y)) break;
      body.push(y);
    }
    out.push({ t: "lessonmeta", title, body });
    i = j - 1;
  }
  return out;
}

// Bold the leading name of EACH author bio in the AUTHORS section (many
// manuscripts bold only the first few names). Runs for every book, not just
// CTS. A bio starts with a person's name followed by a verb ("holds a
// Bachelor's…", "is a…", "has taught…"), which anchors the name span.
function boldAuthorNames(blocks) {
  const textOf = (b) => (b.text || (b.segs ? b.segs.map((s) => s.t).join("") : "")).trim();
  const isHead = (b) => b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t);
  const NAME = /^([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,4})\s+(holds?|is\b|has\b|obtained|received|earned|graduated|studied|teaches|taught|possess|acquired|attained|completed|did\b|works?\b|serves?\b)/;
  for (let i = 0; i < blocks.length; i++) {
    if (!(isHead(blocks[i]) && /^(THE\s+)?AUTHORS?$/i.test(textOf(blocks[i])))) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const y = blocks[j];
      if (isHead(y)) break;
      if (y.t !== "para" || !y.segs || !y.segs.length) continue;
      const full = y.segs.map((s) => s.t).join("");
      const m = full.match(NAME);
      if (!m) continue;
      const nameLen = m[1].length;
      // already fully bold at the front? leave it.
      if (y.segs[0].b && full.indexOf(m[1]) === 0) continue;
      y.segs = boldPrefix(y.segs, nameLen);
    }
    break;
  }
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

// Education level (cover eyebrow + running header) inferred from the grade/form in
// the file name, so ONE local-language theme serves a subject across levels: Grade
// 1-7 -> Primary, Form 1-4 -> Ordinary, Form 5-6 -> Advanced. Returns null when the
// name carries no grade/form, leaving the theme's own `level` in force.
// True when the file name marks a Teacher's Guide. Matches "TG" as a standalone token
// — bounded by any non-letter, so "_TG_", " TG ", "(TG)" all count (a plain `\bTG\b`
// misses "_TG" because the underscore is a word char) — or the word "teacher".
function isTeacherBookName(base) { return /(?:^|[^a-z])TG(?:[^a-z]|$)|teacher/i.test(base); }
function eduLevelFor(base) {
  // allow an underscore before the word ("Chitonga_Grade 2") — `_` is a word char,
  // so a plain `\bgrade` would miss it.
  const g = base.match(/(?:^|[^a-z])grade\s*(\d+)/i);
  if (g && +g[1] >= 1 && +g[1] <= 7) return "Primary Education Level";
  const f = base.match(/(?:^|[^a-z])form\s*(\d+)/i);
  if (f) return +f[1] >= 5 ? "Secondary Education Advanced Level" : "Secondary Education Ordinary Level";
  return null;
}

async function typesetOne(docxPath, themeName) {
  const base = path.basename(docxPath).replace(/\.docx$/i, "");
  // Expand a standalone "G 2"/"G2" abbreviation to "Grade 2" for all grade/level/theme
  // detection (kept separate from `base` so the output file keeps its original name).
  const detectName = base.replace(/(^|[^A-Za-z])[Gg]\s*([1-7])(?![0-9])/g, "$1Grade $2");
  // per-book editorial overrides (sidecar JSON next to the .docx). Loaded before theme
  // detection so `ov.theme` can override autoTheme's filename guess — needed when a
  // sibling book's title doesn't match the same pattern (e.g. a Teacher's Guide titled
  // "PE & Sport Teachers Guide" doesn't match the "Physical Education...Sport" regex its
  // Learner's Book title does, and would otherwise fall back to the generic theme).
  let ov = {};
  const ovPath = docxPath.replace(/\.docx$/i, ".overrides.json");
  if (fs.existsSync(ovPath)) {
    try { ov = JSON.parse(fs.readFileSync(ovPath, "utf8")); }
    catch (e) { console.warn("!  overrides skipped:", e.message); }
  }
  const theme = themeName || ov.theme || autoTheme(detectName);
  const variant = (THEMES[theme] || {}).variant;
  const eduLevel = eduLevelFor(detectName);
  // The ZEPH B5 house style is shared by the "series" (flat, English) and
  // "science" (boxed, Physics) layouts.
  const seriesLike = variant === "series" || variant === "science";
  // Resolve image-override paths relative to the .docx so the sidecar can name
  // them simply (e.g. "media/eng-debate.png").
  // An image override is either a bare path ("media/x.png") or an object
  // { src, w } where `w` forces the on-page width in px (so a hero image that
  // replaces a small manuscript picture isn't shrunk to the original's size).
  const imgOverrides = {};
  for (const [k, v] of Object.entries(ov.images || {})) {
    if (typeof v === "string") {
      const resolved = path.isAbsolute(v) ? v : path.resolve(path.dirname(docxPath), v);
      imgOverrides[k] = { src: resolved };
    } else if (v.src) {
      // replace the image AND (optionally) force its on-page width
      const resolved = path.isAbsolute(v.src) ? v.src : path.resolve(path.dirname(docxPath), v.src);
      imgOverrides[k] = { ...v, src: resolved };
    } else {
      // width-only override: keep the author's image but resize it on the page
      // (e.g. shrink one over-tall opener so it fits under its unit banner)
      imgOverrides[k] = { ...v };
    }
  }

  const importOpts = variant === "series" ? { series: true }
    : variant === "science" ? { styled: true, flat: false, textCover: true }
    : {};
  importOpts.imgOverrides = imgOverrides;
  importOpts.removeImages = ov.removeImages || [];
  importOpts.textboxCaptions = ov.textboxCaptions;
  let { blocks, media, tmp } = await importDocx(docxPath, importOpts);
  if (!blocks.length) {
    console.warn("!  No content extracted from", docxPath);
    return;
  }

  // replaceUnitDocx: [{ heading, until?, docx, rename? }] — swap a whole unit/
  // section for author-supplied replacement content shipped as a SEPARATE .docx
  // (a full rewrite too rich — images, tables, activities — to express as
  // replaceSection markup items). The named heading's section (from the heading
  // down to, but NOT including, `until`/the next unit) is removed and the
  // replacement docx's body blocks are spliced in. Runs BEFORE applyOverrides so
  // the new content flows through renumbering, boxing and text fixes exactly like
  // native content. The replacement is imported with the same layout options but
  // with textCover OFF and a per-unit media prefix, so it contributes no cover and
  // its images never collide with the main document's.
  {
    const isHead = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label"
      || (b.t === "h1" && /^(UNIT|TOPIC|CHAPTER|CHIBALU|CIPATI)\b/i.test(b.text || ""));
    const pref = (s) => (s || "").trim().toUpperCase();
    let ru = 0;
    for (const rs of ov.replaceUnitDocx || []) {
      const h = blocks.findIndex((b) => isHead(b) && pref(blockPlain(b)).startsWith(pref(rs.heading)));
      if (h < 0) { console.warn("!  replaceUnitDocx heading not matched:", rs.heading); continue; }
      let e;
      if (rs.until) {
        e = blocks.findIndex((b, i) => i > h && pref(blockPlain(b)).startsWith(pref(rs.until)));
        if (e < 0) { console.warn("!  replaceUnitDocx 'until' not matched, skipping:", rs.until); continue; }
      } else {
        e = blocks.findIndex((b, i) => i > h && isHead(b) && /^(UNIT|TOPIC|CHAPTER|CHIBALU|CIPATI)\b/i.test(blockPlain(b)));
        if (e < 0) e = blocks.length;
      }
      const repPath = path.isAbsolute(rs.docx) ? rs.docx : path.resolve(path.dirname(docxPath), rs.docx);
      if (!fs.existsSync(repPath)) { console.warn("!  replaceUnitDocx docx not found:", rs.docx); continue; }
      const prefix = "ru" + (ru + 1) + "_";
      const repOpts = { ...importOpts, textCover: false, imgPrefix: prefix };
      const rep = await importDocx(repPath, repOpts);
      let nb = rep.blocks.filter((b) => b.t !== "cover" && b.t !== "toc");
      if (rs.rename && nb.length) setBlockText(nb[0], rs.rename);
      for (const m of rep.media) media.push(m);
      blocks.splice(h, e - h, ...nb);
      ru += 1;
      console.log(`   replaceUnitDocx: "${rs.heading}" <- ${path.basename(repPath)} (${nb.length} blocks, ${rep.media.length} images)`);
    }
  }

  // Merge each unit's theme into its banner ("UNIT N: Theme") and demote stray body
  // sub-headings, so units read like the Learner's Book and the contents lists units
  // only. Runs BEFORE applyOverrides so renumberLessons/Activities see settled heads.
  if (ov.mergeUnitThemes) {
    // insertUnitHeads: [{ before, unit }] — the manuscript dropped a "UNIT N" heading, so its
    // content folds into the previous unit. Insert the heading before the anchor block (usually
    // that unit's orphaned "THEME: X" line) BEFORE normalise, so the theme merges into it.
    for (const ins of ov.insertUnitHeads || []) {
      const at = blocks.findIndex((b) => blockPlain(b).trim().startsWith(ins.before));
      if (at >= 0) blocks.splice(at, 0, { t: "h1", text: `UNIT ${ins.unit}` });
      else console.warn("!  insertUnitHeads not matched:", ins.before);
    }
    const missingThemes = normaliseUnitHeads(blocks);
    // unitThemes: { "8": "HIV/AIDS", … } — force banners to match (e.g. sync a TG to its LB).
    if (ov.unitThemes) forceUnitThemes(blocks, ov.unitThemes);
    const stillMissing = missingThemes.filter((n) => !(ov.unitThemes && ov.unitThemes[n]));
    if (stillMissing.length) console.warn("!  unit(s) missing a theme in the manuscript (left bare):", stillMissing.join(", "));
  }

  if (ov.fill || ov.textFix || ov.replace || ov.replaceExact || ov.editCell || ov.remove || ov.removeRange || ov.tables || ov.edit || ov.setMarker || ov.moveBefore || ov.moveSectionBefore || ov.unitalic || ov.dropMath || ov.setCaption || ov.asHead || ov.pageBreakBefore || ov.forceFreshPage || ov.centre || ov.editAll || ov.unbold || ov.boldToItalic || ov.activityHeadsBlack || ov.insertHead || ov.recolor || ov.recolorHead || ov.italiciseFrom || ov.retext || ov.subtext || ov.replaceSection || ov.unlist || ov.asSection || ov.styleSection || ov.setHeading || ov.recase || ov.asPara || ov.mergePara || ov.renumberLessons || ov.renumberActivities || ov.renumberTopics || ov.renameNear || ov.centrePara || ov.boldFind || ov.underline || ov.splitBefore || ov.removeWhereNext || ov.fixExercise || ov.numberedTopics || ov.topicNumFirst || ov.stripCaptionLabels || ov.learnStatement || ov.recolorLabel || ov.insertText || ov.toTable || ov.stripUnderline || ov.replaceBlocks || ov.deleteRun || ov.monoLines) { applyOverrides(blocks, ov); }
  if (fs.existsSync(ovPath)) console.log("   applied overrides:", path.basename(ovPath));
  reformatAcronyms(blocks);
  formatGlossary(blocks);
  displayifyColumnMath(blocks);
  debulletStandards(blocks);
  columnizeLists(blocks);   // BEFORE normaliseSpacing, which would erase the column gaps
  normaliseSpacing(blocks);
  unboldLeadProse(blocks);
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

  ensureOrIndividually(blocks);
  normaliseQuestionMarkBold(blocks);
  fillLayoutCredit(blocks);  // credit the typesetter on the "Cover and Book Layout:" line
  labelIntroductions(blocks);
  boldAuthorNames(blocks);

  // Primary Teacher's Guides: house-style polish + box each Learning Activity /
  // Exercise / Assessment (the manuscript leaves them as plain flowing text). The
  // theme flag turns on both polish + boxing; a per-book `boxActivities` override
  // turns on JUST the boxing (e.g. a local-language TG whose activities the author
  // left as bold headings, to match its Learner's Book).
  mergeContinuationActivities(blocks);
  splitActivityTables(blocks);
  convertTableActivities(blocks);
  normaliseLessonBanners(blocks);
  blocks = dedupeAdjacentHeadings(blocks);
  fixStrayBodyH1s(blocks);
  stripEditorialComments(blocks);
  clearStrayRed(blocks);
  const boxOpts = { looseStarts: !!ov.boxifyLoose, mergeColon: !!ov.mergeActivityColon, boxHeads: ov.boxHeads || [] };
  if ((THEMES[theme] || {}).boxActivities) { proofPolish(blocks); blocks = boxifyActivities(blocks, boxOpts); }
  else if (ov.boxActivities) { if (ov.polish) proofPolish(blocks); blocks = boxifyActivities(blocks, boxOpts); }
  // after boxing, so the assessment bodies exist to scan
  boldAssessmentSections(blocks);
  boldSafetyAndSteps(blocks);
  // Teacher's Guide: peel each inline "Possible Answer:" off its question onto its own line.
  splitAnswerLabels(blocks);
  // Group each lesson's header metadata into one distinct 14pt panel (Teacher's Guide).
  if (ov.polish) blocks = groupLessonMeta(blocks);
  reorderBackmatter(blocks);

  // Primary Learner's Books drop the teacher/curriculum scaffolding (Sub-Topics,
  // Specific Competences, Acronyms, Glossary, List of Figures, References). Gated on the
  // grade-derived level + "not a Teacher's Guide"; a per-book `keepScaffold: true`
  // override opts a specific Learner's Book back out.
  const isPrimaryLB = eduLevel === "Primary Education Level" && !isTeacherBookName(base);
  if (isPrimaryLB && !ov.keepScaffold) blocks = stripPrimaryScaffold(blocks);

  // ZEPH house style: put the ZEPH logo on the front + back covers
  if (seriesLike) {
    const zeph = path.join(ROOT, "zeph-logo", "image.png");
    if (fs.existsSync(zeph)) {
      media.push({ src: zeph, name: "zeph_logo.png" });
      const cov = blocks.find((b) => b.t === "cover");
      if (cov) cov.logo = { file: "zeph_logo.png" };
    }
  }
  // A per-book cover photo, for a book whose manuscript ships no cover image
  // (e.g. Physics). Resolved relative to the .docx; injected as the cover hero.
  if (ov.coverImage) {
    const p = path.isAbsolute(ov.coverImage) ? ov.coverImage : path.resolve(path.dirname(docxPath), ov.coverImage);
    if (fs.existsSync(p)) {
      const nm = "cover_hero" + path.extname(p);
      media.push({ src: p, name: nm });
      const cov = blocks.find((b) => b.t === "cover");
      if (cov) cov.hero = { file: nm, w: 0, tall: false };
    } else console.warn("!  coverImage not found:", p);
  }

  // Cover fallback: some Teacher's Guides have no detectable big-font title on
  // their cover page, leaving the cover (and title page) with no title. Synthesise
  // a clean, consistent cover from the theme's subject + the grade/book-type
  // parsed from the file name — so every book gets a proper cover regardless of
  // how messy the source cover page is.
  {
    const cov = blocks.find((b) => b.t === "cover");
    const linesArr = (cov && cov.lines) || [];
    const t0 = (linesArr[0] || "").trim();
    const isEyebrow = /^secondary education ordinary level/i.test(t0);
    const hasForm = linesArr.some((l) => /\b(form|grade)\s*\d/i.test(l));
    // Good detection = a real subject on line 0 (short, not the eyebrow) OR a
    // "… Form N" subject line somewhere. Otherwise the manuscript cover is junk
    // (eyebrow-only, empty, or a stray sentence) — synthesise a clean cover.
    // The two cover layouts expect different line shapes, so judge "good" per
    // variant: the SCIENCE cover takes the subject from line 0 (good if line 0 is
    // a real short subject, or a "… Form N" line exists); the SERIES cover takes
    // the eyebrow from line 0 (good only if line 0 IS the standard eyebrow AND a
    // subject+form line follows, like English). Otherwise synthesise a clean cover.
    const goodTitle = variant === "science"
      ? ((!isEyebrow && t0.length > 0 && t0.length <= 34) || hasForm)
      : (isEyebrow && hasForm);
    // Local-language covers are extra-inconsistent — always synthesise (keeping any
    // hero photo + real author names).
    const LANG_THEMES = new Set(["nyanja", "tonga", "lunda", "luvale", "bemba", "silozi"]);
    // synthesiseCover: true — force synthesis even when goodTitle passes. A manuscript
    // can pass the (loose) goodTitle heuristic — eyebrow on line 0, SOME line mentioning
    // "Form N" — while still not matching this variant's actual 3-line shape (e.g. the
    // subject and "Form N" split onto two separate lines instead of one combined line,
    // which the "series" cover template doesn't expect), leaving the rendered cover
    // broken (blank subject, a duplicated "Form N"). Opt in per book once spotted.
    if (cov && (!goodTitle || LANG_THEMES.has(theme) || ov.synthesiseCover)) {
      const T = THEMES[theme] || {};
      const subj = (ov.subject || T.subject || (T.hdrleft || base)
        .replace(/^(Secondary Education Ordinary Level|Primary School)\s*/i, "").trim() || base).toUpperCase();
      // the grade/form in the file name wins over the theme's default level
      const eyebrow = eduLevel ? eduLevel.toUpperCase() : (T.eyebrow || "SECONDARY EDUCATION ORDINARY LEVEL");
      const gm = detectName.match(/(form|grade)\s*\d+/i);           // no \b: "_Form 1_" too
      // The manuscript file is occasionally saved without the form/grade digit in its own
      // name ("…Form Learners Book…" — missing the "1"). Fall back to the manuscript's OWN
      // (messy) cover lines for a "Form N"/"Grade N" mention before giving up — otherwise an
      // empty `grade` here starves the series-cover template of ANY form/grade line to find,
      // and it falls back to showing the EYEBROW as the title (see cover() in the template:
      // with no form/grade line, `name` defaults to `subject` = lines[0] = the eyebrow).
      const gm2 = gm || linesArr.map((l) => l.match(/(form|grade)\s*\d+/i)).find(Boolean);
      const grade = gm2 ? titleCase(gm2[0]) : "";
      const booktype = /(^|[\s_])(tg|teacher)/i.test(base) ? "Teacher's Guide" : "Learner's Book";
      // The two cover layouts read `lines` differently: the science cover takes
      // the subject from line 0; the series cover takes the eyebrow from line 0
      // and the subject (+form) from the next line.
      cov.lines = variant === "series"
        ? [eyebrow, (subj + (grade ? " " + grade.toUpperCase() : "")).trim(), booktype]
        : [subj, grade, booktype].filter(Boolean);
      // keep only plausible author names from the (often messy) detected byline,
      // dropping book-type / publisher / title / topic fragments.
      const isAuthor = (t) => {
        const s = (t || "").trim();
        if (s.length < 3 || s.length > 40) return false;
        return !/publish|lusaka|p\.?o\.? box|industrial|\broad\b|mukanda|buku|icitabo|fomu|\bform\b|\bgrade\b|ordinary level|teacher|learner|musambi|walongi|wakadizi/i.test(s);
      };
      cov.byline = (cov.byline || []).filter(isAuthor);
      console.log("   synthesised cover:", cov.lines.join(" / "), "| authors:", cov.byline.length);
    }
    // Explicit author list from overrides wins (restores names the manuscript
    // buried in a long bio line, which the name-filter drops).
    if (cov && Array.isArray(ov.authors) && ov.authors.length) cov.byline = ov.authors.slice();
    // A localised book-type label (e.g. Lunda "MUKANDA WAKADIZI" = Learner's
    // Book) replaces the synthesised English booktype on the cover.
    if (cov && ov.booktype && cov.lines && cov.lines.length) cov.lines[cov.lines.length - 1] = ov.booktype;
  }

  // Restructure the front matter (title page, roman/arabic numbering, etc.).
  // Auto-number the lessons only for "series" (English) — the Physics sub-topics
  // are already numbered ("Sub-Topic 4.1.1: …") in the manuscript.
  // Airy spacing between front-matter paragraphs (clear separation matters more
  // than fitting a section on one page).
  if (seriesLike) blocks = applySeriesFront(blocks, {
    numberLessons: variant === "series",
    // Primary Teacher's Guides have longer front-matter sections; a tighter gap
    // keeps each (e.g. the Acknowledgement + its signatory) on a single page.
    fmSpacing: (THEMES[theme] || {}).boxActivities ? "1.3em" : "1.9em",
  }, detectName);

  // An ISBN supplied in the overrides is shown on the covers (no barcode).
  if (ov.isbn) for (const b of blocks) if (b.t === "cover" || b.t === "backcover") b.isbn = ov.isbn;

  // Workspace for the compiler: a temp dir holding a _media/ subfolder so the
  // imported images resolve. The template is inlined, so no other files needed.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "typeset-"));
  const mediaDir = path.join(ws, "_media");
  fs.mkdirSync(mediaDir, { recursive: true });
  // Copy each imported image into the workspace — first applying the author's Word
  // crop (so a cropped screenshot shows only the kept region, not the whole window),
  // then deepening faint line-art diagrams (photos/crisp diagrams/cut-outs unchanged).
  // Falls back to a plain copy when neither applies or `canvas` isn't available.
  let enhanced = 0, cropped = 0, emfConv = 0;
  for (const m of media) {
    const dest = path.join(mediaDir, m.name);
    try {
      // An EMF that wraps a raster: extract the bitmap to PNG so the picture appears
      // instead of being dropped (Typst can't read EMF). If it's genuine vector art
      // with no embedded bitmap, emfToPng returns null and the image is skipped.
      if (m.emf) {
        const png = emfToPng(fs.readFileSync(m.src));
        if (png) { fs.writeFileSync(dest, png); emfConv++; }
        continue;
      }
      if (m.crop && cropImage(m.src, dest, m.crop, fs)) { cropped++; continue; }
      if (enhanceLineArt(m.src, dest, fs)) enhanced++;
      else fs.copyFileSync(m.src, dest);
    } catch (e) { /* skip missing */ }
  }
  if (emfConv) console.log(`   recovered ${emfConv} EMF image(s) to PNG`);
  if (cropped) console.log(`   applied Word crop to ${cropped} image(s)`);
  if (enhanced) console.log(`   enhanced ${enhanced} faint line-art image(s)`);

  const title = deriveTitle(blocks, base);
  // Running-header pill reflects the actual book (e.g. "Form 4 Teacher's Book"
  // vs "Learner's Book"), derived from the cover lines.
  const themeOverrides = {};
  // A per-book subject name (e.g. the CDC name "English Literacy and Language"
  // rather than the theme's short "English") feeds the cover title, eyebrow,
  // title page and running-header pill alike.
  if (ov.subject) themeOverrides.subject = ov.subject;
  // Align the running-header left text with the grade/form-derived education level
  // (the cover eyebrow already uses it), overriding the theme's fixed default so the
  // same local-language theme reads correctly at primary vs secondary level.
  if (eduLevel) {
    const subj = ov.subject || (THEMES[theme] || {}).subject;
    if (subj) { themeOverrides.hdrleft = eduLevel + " " + subj; themeOverrides.eyebrow = eduLevel.toUpperCase(); }
  }
  // Grade 2 primary books get their OWN cover style, visually distinct from Grade 3 —
  // applied to every Grade 2 primary Learner's/Teacher's book regardless of theme
  // (mathsci/cts share the "grade3" cover; primaryeng/local-language use the default).
  const gnum = (detectName.match(/(?:^|[^a-z])grade\s*(\d+)/i) || [])[1];
  if (gnum === "2" && eduLevel === "Primary Education Level") themeOverrides.coverStyle = "grade2";
  // a book may pin a specific cover style (e.g. to A/B-test a Grade 2 cover variant)
  if (ov.coverStyle) themeOverrides.coverStyle = ov.coverStyle;
  const coverB = blocks.find((b) => b.t === "cover");
  if (coverB && coverB.lines && coverB.lines.length) {
    const gl = coverB.lines.find((l) => /\b(form|grade)\s+\d/i.test(l));
    const grade = gl ? (gl.match(/(?:form|grade)\s+\d+/i) || [""])[0] : "";
    const booktype = coverB.lines[coverB.lines.length - 1] || "";
    if (grade && booktype) themeOverrides.hdrtab = titleCase(`${grade} ${booktype}`);
  }
  // Primary-school (Grade 3) books: the LEARNER'S books are set in Century Gothic —
  // a friendlier, rounded face for young readers — while the TEACHER'S guides keep
  // the house default (Arial body / Times New Roman header / Segoe UI display). The
  // LB and TG of a subject share one theme, so the distinction is made per-book by
  // filename (a TG is named "… TG …" or "… Teacher's …").
  const primaryTheme = theme === "primaryeng" || theme === "cts" || theme === "mathsci";
  const isTeacherBook = isTeacherBookName(base);
  if (primaryTheme && !isTeacherBook) {
    themeOverrides.font = "Century Gothic";
    themeOverrides.bodyFont = "Century Gothic";
    themeOverrides.displayFont = "Century Gothic";
  }
  // CDC 2025 body-text size for LEARNER'S Books — young readers need larger text:
  //   Grade 1 → 18pt, Grade 2-3 → 16pt, Grade 4-6 → 14pt (Avant Garde / Century Gothic).
  // Teacher's Guides and secondary (Form) books keep the 12pt default (Arial/Times New
  // Roman), which is already CDC-compliant. The whole content hierarchy scales with it.
  if (!isTeacherBook && gnum) {
    const g = parseInt(gnum, 10);
    const bodyPt = g === 1 ? 18 : g <= 3 ? 16 : g <= 6 ? 14 : 0;
    if (bodyPt) {
      // Body + a fixed two-step heading hierarchy: sub-headings body+2, main headings
      // body+4 (Grade 2 → 16 / 18 / 20pt). Keeps a clean, evaluable set of sizes.
      themeOverrides.bodySize = `${bodyPt}pt`;
      themeOverrides.hSub = `${bodyPt + 2}pt`;
      themeOverrides.hMain = `${bodyPt + 4}pt`;
      // Tables must read at the same body size as the surrounding prose — otherwise
      // cell text looks shrunken next to 16/18pt body (reviewers flagged tables on
      // pp. xii/17/18 as "smaller than 16pt"). dtable() steps genuinely wide/heavy
      // grids down from this, so we can safely anchor it to the body size.
      if (!themeOverrides.tableSize) themeOverrides.tableSize = `${bodyPt}pt`;
    }
  }
  // A Teacher's Guide reads at the 12pt default, so its tables must too. The learner
  // theme may carry a large tableSize sized for pupils (primaryeng's 16pt) — inherited
  // by the shared TG, it makes TG cell text overshoot the surrounding 12pt prose (a
  // phonics table on the G2 English TG, p41, rendered at 16pt). Anchor TG tables to the
  // TG body size so cells match the prose around them.
  if (isTeacherBook && (THEMES[theme] || {}).tableSize) {
    themeOverrides.tableSize = themeOverrides.bodySize || "12pt";
  }
  // A book may override the theme's `tocUnitsOnly` (whether the contents page lists
  // only units/chapters, or also the front-matter + back-matter sections). Setting it
  // false on a units-only theme (e.g. a local-language book) makes the front matter
  // (Authors/Foreword/…) and back matter (References) appear in the table of contents.
  if (ov.tocUnitsOnly !== undefined) themeOverrides.tocUnitsOnly = ov.tocUnitsOnly;
  // A book may also override the TOC depth directly. Depth 1 keeps top-level
  // sections only (front matter + units/topics) and excludes sub-topics.
  if (ov.tocDepth !== undefined) themeOverrides.tocDepth = ov.tocDepth;
  // blackWhite: true — render the whole book in greyscale (no colour), as CDC requires for
  // Teacher's Guides. Force every themed colour to black/grey and every callout box to a light
  // grey panel with a black title, so headings, banners, rules, bullets, tables and boxes all
  // print in black and white while their structure (bold titles, borders, bands) stays clear.
  // Opt-in per book (the shared Learner's Book keeps its colour for young readers).
  if (ov.blackWhite) {
    const K = "000000", GREY = "595959", RULE = "808080", FILL = "f2f2f2", ZEB = "ededed";
    const monobox = { fill: FILL, border: GREY, title: K };
    const orig = THEMES[theme] || {};
    Object.assign(themeOverrides, {
      mono: true,
      ink: K, primary: K, primary2: GREY, accent: K, cyan: K, signature: K,
      rulec: RULE, zebra: ZEB, yellow: "d9d9d9",
      act: monobox, ex: monobox, kp: monobox, fact: monobox, asmt: monobox,
      // The cover (front + back) stays in FULL COLOUR — only the interior is greyscale — so
      // preserve the original palette for the cover-only colour fields (cover() shadows T
      // with these, so every colour it draws comes from here, not the greyed body colours).
      covPrimary: orig.primary, covPrimary2: orig.primary2, covAccent: orig.accent,
      covSignature: orig.signature || orig.primary, covCyan: orig.cyan || orig.primary2,
      covInk: orig.ink, covRulec: orig.rulec,
    });
  }
  const tmpl = fs.readFileSync(path.join(__dirname, "generic-template.typ"), "utf8");
  // Inject the theme dict ABOVE the template so its functions capture it.
  const doc = `${themeTypst(theme, themeOverrides)}${tmpl}\n#show: doc.with(title: ${S(title)})\n\n${emit(blocks)}\n`;

  // Include OS system fonts so specialty faces like Bradley Hand ITC (used for
  // Grade-2 handwriting exercises) resolve without being bundled in the repo.
  // Silently ignored when a path doesn't exist.
  const sysFontPaths = [
    "C:/Windows/Fonts",
    "/Library/Fonts", "/System/Library/Fonts", "/System/Library/Fonts/Supplemental",
    "/usr/share/fonts", "/usr/local/share/fonts",
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".fonts"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft/Windows/Fonts"),
  ].filter((p) => { try { return p && fs.existsSync(p); } catch (_) { return false; } });
  const compiler = NodeCompiler.create({ workspace: ws, fontArgs: [{ fontPaths: sysFontPaths }] });
  let pdf;
  try { pdf = compiler.pdf({ mainFileContent: doc }); }
  catch (e) {
    // surface the real Typst diagnostics (the raw napi error is opaque)
    try { const r = compiler.compile({ mainFileContent: doc }); const d = compiler.fetchDiagnostics(r.takeDiagnostics()); if (d && d.length) console.error("TYPST:", d.map((x) => x.message).join(" | ")); } catch (_) {}
    throw e;
  }

  // Organise output by grade: output/<Grade>/<book>/…  (e.g. "Form 4", "Grade 6"). The file
  // name usually carries the form/grade, but occasionally omits the digit ("…Form Learners
  // Book…") — fall back to the manuscript's own (already-synthesised) cover lines.
  const gm = detectName.match(/(form|grade)\s*\d+/i)
    || ((blocks.find((b) => b.t === "cover") || {}).lines || []).map((l) => l.match(/(form|grade)\s*\d+/i)).find(Boolean);
  const gradeFolder = gm ? titleCase(gm[0]) : "Other";
  const bookDir = path.join(OUTPUT_DIR, gradeFolder, base);
  fs.mkdirSync(bookDir, { recursive: true });
  const outPath = path.join(bookDir, `${base} - typeset.pdf`);
  fs.writeFileSync(outPath, Buffer.from(pdf));
  // keep the generated .typ alongside the PDF (and by the runner) for inspection
  fs.writeFileSync(path.join(bookDir, "_source.typ"), doc);
  fs.writeFileSync(path.join(__dirname, "_last-docx.typ"), doc);

  const n = blocks.length;
  console.log(`Typeset: ${base}  [theme: ${theme}]  (${n} blocks, ${media.length} images) -> ${outPath} [${fs.statSync(outPath).size} bytes]`);

  // best-effort cleanup of temp extraction dirs
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

async function main() {
  // Parse args: positional .docx paths + an optional `--theme NAME`.
  const argv = process.argv.slice(2);
  let themeName = null;
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--theme") { themeName = argv[++i]; continue; }
    paths.push(argv[i]);
  }
  if (themeName && !THEMES[themeName]) {
    console.error(`Unknown theme "${themeName}". Available: ${Object.keys(THEMES).join(", ")}`);
    process.exit(1);
  }

  let files = [];
  if (paths.length) {
    files = paths.map((p) => path.resolve(p));
  } else {
    for (const dir of INPUT_DIRS) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (/\.docx$/i.test(f) && !f.startsWith("~$")) files.push(path.join(dir, f));
      }
    }
  }
  if (!files.length) {
    console.error(`No .docx files to typeset. Drop one in input/ or books-to-typeset/, or pass a path.`);
    process.exit(1);
  }
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error("Not found:", f); continue; }
    try { await typesetOne(f, themeName); } catch (e) { console.error("Failed on", f, "\n", e.message); }
  }
}

if (require.main === module) main();

module.exports = { emit, importDocx };
