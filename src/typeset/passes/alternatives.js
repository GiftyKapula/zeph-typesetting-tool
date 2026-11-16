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

module.exports = { boxAlternatives, liftCrossCutting };
