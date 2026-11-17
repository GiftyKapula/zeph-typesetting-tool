// Passes for a manuscript CONVERTED FROM A PDF (ilovepdf / Word reflow), each opted into
// by a sidecar key: joinBrokenLines (with promoteLostHeadings and boxLooseActivities),
// boxAlternatives, liftCrossCutting. Ported unchanged from main's passes/polish.js and
// passes/alternatives.js (2026-11-16, Computer Science Form 3 LB), so a converted
// portrait book builds here as it does there.

// joinBrokenLines (per-book, a manuscript CONVERTED FROM A PDF): the converter ends a
// paragraph at every printed line, so one sentence arrives as two or three paragraphs
// ("In pairs, observe a model of the human" / "skeleton. Identify the main parts…"), and
// a box title that wrapped loses its last words to the box body ("LEARNING ACTIVITY 2:
// Analysing the skeletal system in man using" / "a model or chart"). Join a plain
// paragraph that does not end a sentence to the next one when that one starts in lower
// case and has the same slant; give a box its title words back when its first body line
// is upright, starts in lower case and the title does not end a sentence. Applies to the
// top-level blocks and to every box body. Returns the number of joins.
function joinBrokenLines(blocks, { flattenExercises = false } = {}) {
  let n = 0;
  // the exercise boxes laid out flat (heading + lines), exactly as structure.js's rebox does
  if (flattenExercises) {
    const flat = blocks.flatMap((b) => {
      if (!b || b.t !== "exercise" || typeof b.heading !== "string") return [b];
      const out = [{ t: "head", text: b.heading }];
      const para = (segs) => ({ t: "para", segs });
      for (const s of b.intro || []) out.push(para([{ t: s, b: false, it: false, c: null }]));
      for (const p of b.parts || []) {
        const segs = p.qseg && p.qseg.length ? p.qseg : [{ t: p.q || "", b: false, it: false, c: null }];
        if (p.kind === "q") out.push({ t: "listitem", segs, marker: p.marker || "•" });
        else if (p.kind === "lead") out.push(para(segs));
        else if (p.kind === "table") out.push({ t: "table", rows: p.rows });
        else if (p.kind === "image") out.push({ t: "imagerow", images: p.images });
      }
      for (const s of b.extra || []) out.push(para([{ t: s, b: false, it: false, c: null }]));
      return out;
    });
    blocks.splice(0, blocks.length, ...flat);
  }
  const plain = (b) => (b.segs || []).map((s) => s.t || "").join("");
  const joinable = (b) => b && b.t === "para" && Array.isArray(b.segs) && b.segs.length && !b.marker && !b.isList
    && b.segs.every((s) => typeof s.t === "string" && !s.m);
  const lastSeg = (b) => [...b.segs].reverse().find((s) => s.t.trim());
  const firstSeg = (b) => b.segs.find((s) => s.t.trim());
  const run = (list) => {
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      if (!joinable(a) || !joinable(b)) continue;
      const at = plain(a).trimEnd(), bt = plain(b).trimStart();
      if (!at || !bt || /[.!?:;)"”’]$/.test(at) || !/^[a-z]/.test(bt)) continue;
      const la = lastSeg(a), fb = firstSeg(b);
      if (!la || !fb || !!la.it !== !!fb.it || (la.b && !fb.b)) continue;
      la.t = la.t.trimEnd() + " ";
      fb.t = fb.t.trimStart();
      a.segs.push(...b.segs);
      list.splice(i + 1, 1); i--; n++;
    }
  };
  // the old book's page number left as a line of its own ("76", "1g3", "Tl2") goes
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    // (it can also land inside an exercise as a list item of its own: "4. 39")
    if (b && (b.t === "para" || b.t === "listitem") && Array.isArray(b.segs) && /^\s*(\d{1,3}|\d[gil]\d|T[l1]\d|\d\/\d)\s*$/.test(b.segs.map((s) => s.t || "").join(""))) { blocks.splice(i, 1); n++; }
  }
  // every box lead-in label ("Possible Answers", "Expected Responses"…) set bold the same
  // way — the conversion kept the bold on some and lost it on others
  const LEAD = /^(Possible Answers?|Expected (Responses?|Findings?|Learner (Findings?|Responses?)|Answers?))\s*[:.]?$/i;
  const boldLeads = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(boldLeads); return; }
    for (const k of ["segs", "s", "qseg"]) if (Array.isArray(o[k]) && o[k].length && LEAD.test(o[k].map((x) => x.t || "").join("").trim()) && o[k].some((x) => !x.b)) { o[k] = o[k].map((x) => ({ ...x, b: true, it: false })); n++; }
    for (const v of Object.values(o)) if (v && typeof v === "object") boldLeads(v);
  };
  boldLeads(blocks);
  // a competence code glued to its words ("5.1.1.1Demonstrate") gets its space back
  const spaceCodes = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(spaceCodes); return; }
    if (typeof o.t === "string" && /\d\.\d+\.\d+[A-Za-z]/.test(o.t)) o.t = o.t.replace(/\b(\d+(?:\.\d+){2,})(?=[A-Za-z])/g, () => { n++; return `${RegExp.lastMatch} `; });
    for (const v of Object.values(o)) if (v && typeof v === "object") spaceCodes(v);
  };
  spaceCodes(blocks);
  const walk = (list) => {
    run(list);
    for (const b of list) {
      if (!b || !Array.isArray(b.body)) continue;
      // the box's first instruction glued onto its title ("…changes in girls In groups,
      // discuss the physical changes… to the class."): the title ends where a lower-case
      // word meets a capitalised one and what follows reads as a sentence (a full stop
      // later on); that sentence goes back to the top of the box body
      // a bare "LEARNING ACTIVITY 4" box title, its words the first (short) body line
      if (b.t === "activity" && typeof b.title === "string" && /^LEARNING\s*ACTIVITY\s*\d+\s*:?\s*$/i.test(b.title.trim()) && joinable(b.body[0])) {
        const ft = plain(b.body[0]).trim();
        if (ft.length < 110 && !/[.!?]$/.test(ft)) { b.title = `${b.title.trim().replace(/:$/, "")}: ${ft}`; b.body.shift(); n++; }
      }
      if (b.t === "activity" && typeof b.title === "string" && !b.titleSegs) {
        const m = b.title.match(/^(.*?:\s*\S.*?[a-z])\s+([A-Z][a-z]+\b[\s\S]*)$/);
        if (m && m[1].length >= 25 && /\.\s|\.$/.test(m[2]) && m[2].split(/\s+/).length >= 5) {
          b.title = m[1];
          b.body.unshift({ t: "para", segs: [{ t: m[2], b: false, it: true, c: null }] });
          n++;
        }
      }
      if (b.t === "activity" && typeof b.title === "string" && !b.titleSegs && joinable(b.body[0])) {
        const ft = plain(b.body[0]).trim();
        if (/^[a-z]/.test(ft) && !/[.!?:]$/.test(b.title.trim()) && b.body[0].segs.every((s) => !s.it || !s.t.trim())) {
          b.title = `${b.title.trim()} ${ft}`; b.body.shift(); n++;
        }
      }
      walk(b.body);
    }
  };
  walk(blocks);
  n += boxLooseActivities(blocks);
  n += promoteLostHeadings(blocks);
  // a numbered item the converter typed as text ("3. Differences in…") right after list item
  // 2 becomes list item 3, hanging under its number like the others
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1], b = blocks[i];
    if (!a || !b || a.t !== "listitem" || b.t !== "para" || !Array.isArray(b.segs) || !b.segs.length) continue;
    const pm = String(a.marker || "").match(/^(\d+)\.$/), m = (b.segs[0].t || "").match(/^\s*(\d+)\.\s+/);
    if (!pm || !m || +m[1] !== +pm[1] + 1) continue;
    b.segs[0] = { ...b.segs[0], t: b.segs[0].t.slice(m[0].length) };
    if (!b.segs[0].t) b.segs.shift();
    Object.assign(b, { t: "listitem", marker: `${m[1]}.`, isList: true });
    n++;
  }
  return n;
}

// (part of joinBrokenLines) A sub-heading whose bold the converter lost ("Physical Changes
// in Girls", "Uses of Various Electric Appliances") came through as an ordinary line, so an
// exercise or activity box above it ran on and swallowed it with the text below. A short
// upright line in Title Case, with no end punctuation, followed by text, is a heading again.
function promoteLostHeadings(blocks) {
  let n = 0;
  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i], b = blocks[i + 1];
    const at = a && (a.text != null ? a.text : (a.segs || []).map((s) => s.t || "").join("")).trim();
    if (a && /^(label|head|assessment)$/.test(a.t) && /^END[\s-]*OF[\s-]*TOPIC\b/i.test(at || a.title || "")
      && b && /^(head|label|h3)$/.test(b.t) && /^Possible Answers?:?$/i.test((b.text || "").trim())) {
      blocks[i + 1] = { t: "para", segs: [{ t: b.text.trim(), b: true, it: false, c: null }] }; n++;
    }
  }
  const SMALL = /^(a|an|the|and|or|of|in|on|at|to|for|with|by|from|as|into|their|its|vs)$/i;
  const plain = (b) => (b.segs || []).map((s) => s.t || "").join("").replace(/\s+/g, " ").trim();
  for (let i = 0; i + 1 < blocks.length; i++) {
    const b = blocks[i], nx = blocks[i + 1];
    if (!b || b.t !== "para" || b.marker || b.isList || !Array.isArray(b.segs) || b.segs.some((s) => s.it || s.m)) continue;
    const t = plain(b), w = t.split(" ");
    // an assessment title left as plain text opens its own box (the box above would swallow
    // it); a "Possible Answers" heading right under it is its lead-in, not a section heading
    if (/^END[\s-]*OF[\s-]*TOPIC\b.*ASSESSMENT\.?$/i.test(t)) {
      blocks[i] = { t: "label", text: t.replace(/\.$/, "") }; n++;
      continue;
    }
    // a sub-topic's own label left as plain text, where its siblings are headings
    if (/^(Expected Standards?|General Competences?|Specific Competences?)\s*:?$/i.test(t)) { blocks[i] = { t: "head", text: t }; n++; continue; }
    // (a heading may end in a stray full stop: "Ways of Preventing the Spread of Parasitic Diseases.")
    if (w.length < 2 || w.length > 12 || t.length > 85 || /[,:;?!)]$/.test(t) || (/\.$/.test(t) && w.length < 4)) continue;
    // (nor a sub-topic's own labels, which the book's later passes style as labels)
    if (/^(Fig(ure)?|Table|LEARNING|EXERCISE|END|Expected|Possible|Note|Answer|Key|SCIENCE|General Competences?|Specific Competences?|Introduction)\b/i.test(t) || /^\d/.test(t)) continue;
    // Title Case: every word capitalised but the small ones — or, for a longer heading, all
    // but its last two ("Comparing and Contrasting the Human Skeletal System and other
    // vertebrates"), with some of it set bold (a converted heading keeps part of its bold)
    const titleCase = (ws) => ws.every((x, k) => /^[A-Z(]/.test(x) || (k > 0 && SMALL.test(x)));
    const someBold = b.segs.some((s) => s.b && (s.t || "").trim());
    if (!titleCase(w) && !(w.length >= 5 && titleCase(w.slice(0, -2)) && someBold)) continue;
    // (a line ending in a full stop right after a list item is a question in a list, not a heading)
    if (/\.$/.test(t) && blocks[i - 1] && blocks[i - 1].t === "listitem") continue;
    if (!nx || !/^(para|listitem|table|image|imagerow|activity)$/.test(nx.t)) continue;
    blocks[i] = { t: "head", text: t };
    n++;
    if (process.env.ZEPH_HEADS) console.log("   heading restored:", t);
  }
  return n;
}

// (part of joinBrokenLines) An activity the converter left as loose paragraphs — its
// "LEARNING ACTIVITY 6: Marketing the birds" title an ordinary paragraph with mixed bold —
// was never boxed. Box it as the reviewed copy shows it: the title (a wrapped second line
// joined back, a glued first instruction split off), then the italic instructions, an
// "Expected Responses/Findings" heading and its italic answers and table. The box ends at the
// first upright paragraph ("Help learners conclude that …"), heading or other box.
function boxLooseActivities(blocks) {
  let n = 0;
  const plain = (b) => (b.segs ? b.segs.map((s) => s.t || "").join("") : (b.text || "")).replace(/\s+/g, " ").trim();
  const TITLE = /^L?EARN?I?NI?NG\s*ACTIVITY\s*\d+\s*:?/i;   // (a converter can drop the L; an author slip "LEARINING", "LEARNINNG")
  // (the converter can drop the capital E, drawn as a picture: "xpected Responses")
  const EXPECT = /^E?xpected\s+(Responses?|Findings?|Learner\s+Findings?|Answers?)\s*:?$/i;
  // what follows "Expected Responses" is the answer, upright or italic, up to the teacher's
  // own closing line ("Help learners conclude that …"), which sits outside the box
  const OUTSIDE = /^(Help\s*(learners|leaners|leraners)|Guide\s+learners\s+to\s+conclude|With\s+your\s+help|Learners\s+should\s+be\s+helped\s+to\s+conclude|Assist\s+learners\s+to\s+conclude)/i;
  const answer = (x) => x && ((x.t === "para" && (italic(x) || !OUTSIDE.test(plain(x)))) || x.t === "table" || x.t === "listitem");
  // italic = most of its letters are italic (a converted line often has an upright word in it)
  const italic = (b) => {
    if (!Array.isArray(b.segs)) return false;
    const all = b.segs.reduce((a, s) => a + (s.t || "").trim().length, 0);
    const it = b.segs.reduce((a, s) => a + (s.it ? (s.t || "").trim().length : 0), 0);
    return all > 0 && it / all >= 0.6;
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // a box already built whose "Expected Responses" and its answers were left outside it
    if (b && b.t === "activity" && Array.isArray(b.body)) {
      let j = i + 1, took = false;
      // (the box ran on over a page in the reviewed copy: its italic instructions continue)
      let k = j;
      // ("Help learners to form groups…" in italics is an instruction, not the closing line)
      while (k < blocks.length && blocks[k].t === "para" && italic(blocks[k])) k++;
      if (k > j && k < blocks.length && /^(para|head|label|h3)$/.test(blocks[k].t) && EXPECT.test(plain(blocks[k]))) {
        while (j < k) b.body.push(blocks[j++]);
        took = true;
      }
      if (j < blocks.length && /^(para|head|label|h3)$/.test(blocks[j].t) && EXPECT.test(plain(blocks[j]))) {
        b.body.push({ t: "para", segs: [{ t: plain(blocks[j]), b: true, it: false, c: null }] }); j++; took = true;
        while (j < blocks.length && answer(blocks[j])) b.body.push(blocks[j++]);
      }
      // a box whose "Expected Responses" is already inside it keeps the italic answer lines
      // and bullets that follow it (the box crossed a page in the reviewed copy)
      if (!took && b.body.some((x) => EXPECT.test(plain(x)))) {
        while (j < blocks.length && /^(para|listitem)$/.test(blocks[j].t) && italic(blocks[j])) { b.body.push(blocks[j++]); took = true; }
      }
      if (took) { blocks.splice(i + 1, j - i - 1); n++; }
      continue;
    }
    if (!b || !/^(para|head|label|h3)$/.test(b.t) || b.marker) continue;
    let title = plain(b);
    // (a title with its whole first instruction glued on can run long; it is split below)
    if (!TITLE.test(title) || title.length > 600) continue;
    let j = i + 1;
    // a wrapped title: its second line is upright and starts in lower case (or is one to
    // three words with no full stop: "Appliances"), and may have come through as a heading
    const wrapLine = (x) => x && /^(para|head|h3)$/.test(x.t) && !italic(x) && !TITLE.test(plain(x)) && !EXPECT.test(plain(x))
      && (/^[a-z]/.test(plain(x)) ? plain(x).length < 80 : /^[A-Z][\w-]*( [\w-]+){0,2}$/.test(plain(x)));
    const body = [];
    // (a picture placed between the title — even between its two lines — and the
    // instructions belongs in the box)
    for (;;) {
      if (j < blocks.length && wrapLine(blocks[j])) { title += " " + plain(blocks[j]); j++; continue; }
      if (j + 1 < blocks.length && /^(image|imagerow)$/.test(blocks[j].t) && (wrapLine(blocks[j + 1]) || (blocks[j + 1].t === "para" && italic(blocks[j + 1])))) { body.push(blocks[j]); j++; continue; }
      break;
    }
    const g = title.match(/^(.*?:\s*\S.*?[a-z])\s+((?:Facilitate|Help|Allow|Assist|Guide|Let|Provide|Aid|In|Form|Organi[sz]e|Divide|Ask|Arrange)\b[\s\S]*)$/);
    if (g && g[1].length >= 25) { title = g[1]; body.push({ t: "para", segs: [{ t: g[2], b: false, it: true, c: null }] }); }
    let seenExpect = false;
    for (; j < blocks.length; j++) {
      const x = blocks[j], t = plain(x);
      if (x.t === "para" && italic(x)) { body.push(x); continue; }
      if (/^(image|imagerow)$/.test(x.t) && blocks[j + 1] && blocks[j + 1].t === "para" && italic(blocks[j + 1])) { body.push(x); continue; }
      if (/^(para|head|label|h3)$/.test(x.t) && EXPECT.test(t)) { body.push({ t: "para", segs: [{ t, b: true, it: false, c: null }] }); seenExpect = true; continue; }
      if (seenExpect && answer(x)) { body.push(x); continue; }
      break;
    }
    if (!body.length) continue;
    blocks.splice(i, j - i, { t: "activity", title: title.replace(/^L?EARN?I?NI?NG\s*ACTIVITY\s*(\d+)\s*:?\s*/i, "LEARNING ACTIVITY $1: "), body });
    n++;
  }
  return n;
}

// boxAlternatives (sidecar `boxAlternatives: true`): every "Alternative Activity" in its
// own box of one style (theme box `alt`), whatever shape the manuscript left it in.
// A book converted from a PDF brings them back three ways: a plain grey box whose first
// line is "Alternative Activity", a loose heading followed by its paragraphs, or run on
// inside the Learning Activity box above it. CDC asked for every one to look the same,
// set apart from the activity it replaces, with "Expected Competences:" in bold.
// (Computer Science Form 3 LB, 2026-11-16.)

const ALT = /^Alternative[’'\s]*(Learning\s+)?Activit(?:y|ies)\b\s*(\d+)?\s*[:.\-–]?\s*(.*)$/i;
const EXPECTED = /^(Expected\s+Competences?\s*:?)/i;
const BOXES = new Set(["activity", "framedsection", "exercise", "assessment", "box", "keypoints", "fact"]);

const plain = (b) => (b && (b.segs ? b.segs.map((s) => s.t || "").join("") : (b.text || "")) || "").replace(/\s+/g, " ").trim();
const titleOf = (t) => {
  const m = t.match(ALT);
  return `Alternative Activity${m[2] ? " " + m[2] : ""}${m[3] ? ": " + m[3].trim() : ""}`;
};
// a short line that only names the alternative activity (not a sentence that mentions one)
const isAltTitle = (b) => b && /^(head|label|h3|para)$/.test(b.t) && ALT.test(plain(b)) && plain(b).length <= 120
  && (b.t !== "para" || (b.segs || []).filter((s) => (s.t || "").trim()).every((s) => s.b));

// "Expected Competences:" bold wherever it opens a paragraph
function boldExpected(blocks) {
  for (const b of blocks || []) {
    if (!b || typeof b !== "object") continue;
    if ((b.t === "para" || b.t === "listitem") && Array.isArray(b.segs) && EXPECTED.test(plain(b))) {
      const first = b.segs.find((s) => (s.t || "").trim());
      const m = first && first.t.replace(/^\s+/, "").match(EXPECTED);
      if (m && !first.b) {
        const lead = first.t.length - first.t.replace(/^\s+/, "").length;
        const idx = b.segs.indexOf(first);
        b.segs.splice(idx, 1, { ...first, t: first.t.slice(0, lead + m[1].length), b: true }, { ...first, t: first.t.slice(lead + m[1].length) });
      }
    }
    if (Array.isArray(b.body)) boldExpected(b.body);
    if (Array.isArray(b.parts)) boldExpected(b.parts);
  }
}

// opts.also: other titles a book uses for the same thing (regex sources, e.g. "^Learner['’]s Activity")
function boxAlternatives(blocks, opts = {}) {
  let n = 0;
  const also = [].concat(opts.also || []).map((r) => new RegExp(r, "i"));
  const isAlso = (t) => also.some((r) => r.test(t));
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // 1. a plain box whose first line names it
    if (b && b.t === "box" && Array.isArray(b.body) && b.body.length && ALT.test(plain(b.body[0])) && plain(b.body[0]).length <= 160) {
      out.push({ t: "framedsection", kind: "alt", title: titleOf(plain(b.body[0])), body: b.body.slice(1) }); n++;
      continue;
    }
    // (or one of the book's own names for it — the box keeps that name as its title)
    if (b && b.t === "box" && Array.isArray(b.body) && b.body.length && isAlso(plain(b.body[0])) && plain(b.body[0]).length <= 160) {
      out.push({ t: "framedsection", kind: "alt", title: plain(b.body[0]), body: b.body.slice(1) }); n++;
      continue;
    }
    // 2. run on inside the box above: split it off into a box of its own after that one
    if (b && (b.t === "activity" || b.t === "framedsection") && Array.isArray(b.body)) {
      const k = b.body.findIndex((x, j) => j > 0 && isAltTitle(x));
      if (k > 0) {
        const rest = b.body.splice(k);
        out.push(b, { t: "framedsection", kind: "alt", title: titleOf(plain(rest[0])), body: rest.slice(1) }); n++;
        continue;
      }
    }
    // 3. a loose heading: take what follows up to and including its "Expected Competences"
    if (isAltTitle(b)) {
      let j = i + 1, end = -1;
      for (; j < blocks.length && j <= i + 20; j++) {
        const x = blocks[j];
        if (!x || BOXES.has(x.t) || x.t === "h1" || x.t === "h2" || isAltTitle(x) || (x.t === "head" && !EXPECTED.test(plain(x)))) break;
        if (EXPECTED.test(plain(x))) {
          end = j;
          // a label alone ("Expected Competences:") takes the line that follows it
          if (plain(x).replace(EXPECTED, "").trim() === "" && blocks[j + 1] && blocks[j + 1].t === "para") end = j + 1;
          break;
        }
      }
      // no "Expected Competences" line: the italic instructions only
      if (end < 0) {
        end = i;
        while (blocks[end + 1] && /^(para|listitem)$/.test(blocks[end + 1].t)
          && (blocks[end + 1].segs || []).some((s) => (s.t || "").trim()) && (blocks[end + 1].segs || []).filter((s) => (s.t || "").trim()).every((s) => s.it)) end++;
      }
      if (end > i) {
        const body = blocks.slice(i + 1, end + 1).map((x) => (x.t === "label" || x.t === "head")
          ? { t: "para", segs: [{ t: plain(x), b: true, it: false, c: null }] } : x);
        out.push({ t: "framedsection", kind: "alt", title: titleOf(plain(b)), body }); n++;
        i = end;
        continue;
      }
    }
    out.push(b);
  }
  // Lines that came through as ONE paragraph (or one table cell) with line breaks inside:
  // one block per line again, a "3. …" line as a numbered item.
  const splitLines = (segs) => {
    const lines = [[]];
    for (const s of segs || []) {
      const parts = String(s.t || "").split("\n");
      parts.forEach((p, k) => { if (k) lines.push([]); if (p) lines[lines.length - 1].push({ ...s, t: p }); });
    }
    const blks = lines.filter((l) => l.some((s) => s.t.trim())).map((l) => {
      const t = l.map((s) => s.t).join("");
      const m = t.match(/^\s*(\d{1,2}[.)])\s+/);
      if (!m) return { t: "para", segs: l };
      // drop the marker from the opening segment(s)
      let cut = m[0].length; const rest = [];
      for (const s of l) { if (cut >= s.t.length) { cut -= s.t.length; continue; } rest.push({ ...s, t: s.t.slice(cut) }); cut = 0; }
      return { t: "listitem", isList: true, marker: m[1], segs: rest };
    });
    // a number left on its own (its heading words deleted) takes the line under it
    for (let k = blks.length - 2; k >= 0; k--) {
      if (blks[k].t === "listitem" && !plain(blks[k]) && blks[k + 1].t === "para") { blks[k].segs = blks[k + 1].segs; blks.splice(k + 1, 1); }
    }
    return blks;
  };
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (!b || b.t !== "activity" || !Array.isArray(b.body)) continue;
    // the rest of the activity, typed into a one-cell table after the box
    const nx = out[i + 1];
    // (one cell with text; any other rows empty)
    const cell = nx && nx.t === "table" && nx.rows && nx.rows[0] && nx.rows[0].length === 1 && nx.rows.slice(1).every((r) => r.every((c) => !(c && c.text || "").trim())) && nx.rows[0][0];
    if (cell && /^\s*\d{1,2}[.)]\s/.test(cell.text || "") && !b.body.some((x) => EXPECTED.test(plain(x)))) {
      b.body.push(...splitLines(cell.segs || [{ t: cell.text, b: false, it: true, c: null }]));
      out.splice(i + 1, 1);
    }
    // "…Communication SkillsAlternative Activity" + its lines, all in the box's last paragraph
    const k = b.body.findIndex((x) => x.t === "para" && /\S\s*Alternative Activit(y|ies)\s*\n/.test((x.segs || []).map((s) => s.t || "").join("")));
    if (k >= 0) {
      const lines = splitLines(b.body[k].segs);
      const a = lines.findIndex((l) => /Alternative Activit(y|ies)\s*$/.test(plain(l)));
      const head = lines.slice(0, a + 1), tail = lines.slice(a + 1);
      const last = head[head.length - 1];
      last.segs = splitLines([{ ...last.segs[0], t: plain(last).replace(/\s*Alternative Activit(y|ies)\s*$/, "") }])[0].segs;
      b.body.splice(k, 1, ...head.filter((l) => plain(l)));
      // the competences before it stay in the box above (CDC); the alternative gets a box of its own
      out.splice(i + 1, 0, { t: "framedsection", kind: "alt", title: "Alternative Activity", body: tail }); n++;
    }
  }
  // The rest of an activity cut off by a page break in the source came back as a plain
  // box of its own, opening mid-sentence ("After finishing" | "your slides, each group…"):
  // it is the same activity — join it on, and the broken sentence with it.
  // Every other plain box right after an activity / alternative box is a page of that box
  // too (the PDF broke a long box at each page): it takes that box's colour. One that opens
  // with a heading of its own ("Game 3: Simple Quiz Game", "Step 3: Create Users", a bold
  // title) stays a box of its own under that title — CDC asked for those to stand apart —
  // and a "Game N:" / "Step N:" line inside one starts the next box.
  const kindOf = (b) => b && (b.t === "activity" ? "act" : b.t === "framedsection" && (b.kind === "alt" || b.kind === "act") ? b.kind : null);
  const PART = /^(Game|Step)\s+\d+\s*:/i;
  const headLike = (x) => {
    if (!x || x.t !== "para" || x.isList) return false;
    const t = plain(x);
    if (!t || t.length > 90 || /[.,;]$/.test(t) || !/^[A-Z0-9]/.test(t) || EXPECTED.test(t)) return false;
    return PART.test(t) || /^\d{1,2}\.\s+[A-Z]/.test(t) || (x.segs || []).filter((s) => (s.t || "").trim()).every((s) => s.b);
  };
  // a plain box that opens with a heading (and is not a page of the box above) is one of the book's activity boxes
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (b && !kindOf(out[i - 1]) && b.t === "box" && Array.isArray(b.body) && b.body.length > 1 && headLike(b.body[0]))
      out[i] = { t: "framedsection", kind: "act", title: plain(b.body[0]), body: b.body.slice(1) };
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const b = out[i], nx = out[i + 1], kind = kindOf(b);
    if (!kind || !Array.isArray(b.body)) continue;
    // a one-column table between the pages is the box's too (kept a table)
    if (nx && nx.t === "table" && Array.isArray(nx.rows) && nx.rows.length && nx.rows.every((r) => r.length === 1)) {
      b.body.push(nx); out.splice(i + 1, 1); i--; continue;
    }
    if (!nx || nx.t !== "box" || !Array.isArray(nx.body) || !nx.body.length) continue;
    // split the plain box at each "Game N:" / "Step N:" line after its first
    const pieces = [[]];
    nx.body.forEach((x, k) => { if (k && x.t === "para" && PART.test(plain(x))) pieces.push([]); pieces[pieces.length - 1].push(x); });
    const boxes = [];
    for (const [k, body] of pieces.entries()) {
      if (headLike(body[0])) { boxes.push({ t: "framedsection", kind, title: plain(body[0]), body: body.slice(1) }); continue; }
      if (k === 0) {   // the rest of the box above: join it on (and a sentence the page break cut, too)
        const last = b.body[b.body.length - 1], first = body[0];
        if (last && last.t === "para" && first.t === "para" && /^[a-z]/.test(plain(first)) && !/[.!?:]$/.test(plain(last))) {
          last.segs.push({ ...first.segs[0], t: " " }, ...first.segs);
          b.body.push(...body.slice(1));
        } else b.body.push(...body);
      } else boxes.push({ t: "framedsection", kind, title: plain(body[0]), body: body.slice(1) });
    }
    out.splice(i + 1, 1, ...boxes);
    i--;   // (the box just built may itself be followed by another page of it)
  }
  // A page break in the source left an activity's last instructions and its "Expected
  // Competences" line outside its box: take them back (italic lines only, up to that line).
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (!b || !(b.t === "activity" || (b.t === "framedsection" && b.kind === "alt")) || !Array.isArray(b.body)) continue;
    if (b.body.some((x) => EXPECTED.test(plain(x)))) continue;
    let j = i + 1;
    const italicLine = (x) => x && /^(para|listitem)$/.test(x.t) && (x.segs || []).some((s) => (s.t || "").trim())
      && (x.segs || []).filter((s) => (s.t || "").trim()).every((s) => s.it);
    while (j < out.length && j <= i + 6 && italicLine(out[j]) && !EXPECTED.test(plain(out[j]))) j++;
    const x = out[j];
    if (!x || !/^(para|label|head)$/.test(x.t) || !EXPECTED.test(plain(x))) continue;
    let end = j;
    if (plain(x).replace(EXPECTED, "").trim() === "" && out[j + 1] && out[j + 1].t === "para") end = j + 1;
    const took = out.splice(i + 1, end - i).map((y) => (y.t === "label" || y.t === "head")
      ? { t: "para", segs: [{ t: plain(y), b: true, it: false, c: null }] } : y);
    b.body.push(...took);
  }
  // a sub-heading the conversion glued onto the list item above it ("CircuitVerse Task")
  // goes back on its own line
  const SUBHEAD = /^(.+?)\s+(Task|Procedure|Presentation|Materials(?: Needed)?|Steps)\s*:?$/;
  for (const b of out) if (b && b.t === "framedsection" && b.kind === "alt" && Array.isArray(b.body)) {
    for (let k = b.body.length - 1; k >= 0; k--) {
      const x = b.body[k], m = (x.t === "listitem" || x.isList) && (x.segs || []).length === 1 && plain(x).match(SUBHEAD);
      if (m) { x.segs = [{ ...x.segs[0], t: m[1] }]; b.body.splice(k + 1, 0, { t: "para", segs: [{ t: m[2], b: true, it: false, c: null }] }); }
    }
  }
  // a one-to-three-word line inside an alternative box ("Task", "Procedure", "Presentation")
  // is its sub-heading: bold, like "Expected Competences:" (CDC)
  for (const b of out) if (b && b.t === "framedsection" && b.kind === "alt") for (const x of b.body || []) {
    const t = plain(x);
    if (x.t === "para" && !x.isList && !x.marker && t && t.split(" ").length <= 3 && !/[.,;]$/.test(t) && /^[A-Z]/.test(t)) for (const sg of x.segs || []) sg.b = true;
  }
  boldExpected(out);
  if (n) console.log(`   boxAlternatives: ${n} Alternative Activit(y/ies) boxed`);
  return out;
}

// liftCrossCutting (sidecar `liftCrossCutting: true`): a topic's CROSS-CUTTING ISSUES
// table is not part of the exercise box above it — a converted book drew both in one Word
// table, so the box swallowed it. Lift each one out to just after its box and give every
// one the same shape: the heading on its own, then the issues two columns wide (issue in
// bold), rows the PDF split in two ("Entrepreneurship | Develops … for" over "Education |
// creating …") joined back. (CDC, Computer Science Form 3 LB p177, 2026-11-16.)
const CCI = /^CROSS\s*[–-]?\s*CUTTING\s+ISSUES$/i;
function liftCrossCutting(blocks) {
  let n = 0;
  const cellText = (c) => String((c && c.text) || "").replace(/\s+/g, " ").trim();
  const isCci = (x) => x && x.t === "table" && Array.isArray(x.rows) && x.rows.some((r) => r.some((c) => CCI.test(cellText(c))));
  const tidy = (tb) => {
    // rows ABOVE the heading row are not the table's: the PDF drew the exercise before it
    // in the same table ("EXERCISE 4" | its question). They go back in front, as that box.
    const h = tb.rows.findIndex((r) => r.some((c) => CCI.test(cellText(c))));
    const pre = [];
    const above = tb.rows.slice(0, Math.max(0, h)).flat().map(cellText).filter(Boolean);
    if (above.length) {
      const ti = above.findIndex((t) => /^EXERCISE\s+\d+\s*:?$/i.test(t));
      const text = above.filter((t, k) => k !== ti).join(" ");
      // "(a) …" parts typed inline go on lines of their own
      const parts = text.split(/\s+(?=\([a-z]\)\s)/);
      const body = parts.map((p) => {
        const m = p.match(/^\(([a-z])\)\s+([\s\S]*)$/);
        return m ? { t: "listitem", isList: true, marker: `(${m[1]})`, segs: [{ t: m[2], b: false, it: true, c: null }] }
          : { t: "para", segs: [{ t: p, b: false, it: true, c: null }] };
      });
      if (ti >= 0) pre.push({ t: "framedsection", kind: "ex", title: above[ti].toUpperCase().replace(/\s*:$/, ""), body });
      else pre.push(...body);
    }
    // drop the heading row(s) and any column that is empty all the way down
    let rows = tb.rows.slice(Math.max(0, h)).filter((r) => !r.some((c) => CCI.test(cellText(c))) && r.some((c) => cellText(c)));
    const w = Math.max(0, ...rows.map((r) => r.length));
    const keep = [...Array(w).keys()].filter((k) => rows.some((r) => cellText(r[k])));
    rows = rows.map((r) => keep.map((k) => cellText(r[k])));
    // a row whose description carries on in lower case is the second half of the one above
    const out = [];
    for (const r of rows) {
      const prev = out[out.length - 1];
      if (prev && r.length > 1 && /^[a-z]/.test(r[1])) { prev[0] = `${prev[0]} ${r[0]}`.trim(); prev[1] = `${prev[1]} ${r[1]}`.trim(); }
      else out.push(r);
    }
    return [...pre, { t: "head", text: "CROSS-CUTTING ISSUES" },
      { t: "table", noHeader: true, rows: out.map((r) => r.map((t, k) => ({ text: t, imgs: [], ...(k === 0 ? { segs: [{ t, b: true, it: false, c: null }] } : {}) }))) }];
  };
  const res = [];
  for (const b of blocks) {
    if (isCci(b)) { res.push(...tidy(b)); n++; continue; }
    const after = [];
    for (const key of ["body", "parts"]) {
      if (!b || !Array.isArray(b[key])) continue;
      b[key] = b[key].filter((x) => {
        const tb = x && (x.t === "table" ? x : x.kind === "table" ? { t: "table", rows: x.rows } : null);
        if (tb && isCci(tb)) { after.push(...tidy(tb)); n++; return false; }
        return true;
      });
    }
    // (an assessment comes AFTER its topic's cross-cutting issues: lift the table out in front)
    if (after.length && /ASSESSMENT/i.test(String(b.title || ""))) res.push(...after, b);
    else res.push(b, ...after);
  }
  if (n) console.log(`   liftCrossCutting: ${n} cross-cutting issues table(s) set apart`);
  return res;
}


module.exports = { joinBrokenLines, boxLooseActivities, boxAlternatives, liftCrossCutting };
