// Box reshaping AFTER the automatic boxing passes (boxifyActivities, boxAlternatives,
// liftCrossCutting): the override keys that run in applyOverrides() see the blocks before
// any box exists, so they cannot say "this run of paragraphs is its own Learning Activity"
// or "this text is not part of the exercise box it landed in". A book converted from a PDF
// leaves both shapes behind — an exercise bar stranded over the next section with the
// questions it belongs to just above it, an activity's later parts run on as plain text.
// (Computer Science Form 3 LB, proofreading round 1, 2026-11-19.)
//
//   boxRange:   [{ from, to?, count?, near?, kind: "act" | "alt" | "ex", title, rest? }]
//               the blocks from the one containing `from` through the one containing `to`
//               (or `count` blocks; default just the one) become a box of their own. They
//               may start or end inside an existing box: that box is split around them,
//               what comes before stays in it, and what comes after goes back into the flow
//               as plain blocks (`rest: "box"` keeps it in a box of the same kind and title).
//               A box wholly inside the range is opened up: its title becomes a bold line.
//   unboxRange: [{ from, to?, count?, near? } | { title, near? }]
//               the blocks from `from` to `to` (inside a box) go back into the flow as plain
//               blocks; without `to`, to the end of that box. `{ title }` opens up the whole
//               box whose title contains it.
// `near` picks the first match AFTER the block containing it, for an anchor that repeats.

const BOXES = new Set(["activity", "framedsection", "box", "exercise", "assessment"]);
const isBox = (b) => b && BOXES.has(b.t) && Array.isArray(b.body);
const plain = (b) => (b && (b.segs ? b.segs.map((s) => s.t || "").join("") : (b.text || (b.rows ? b.rows.flat().map((c) => (c && c.text) || "").join(" ") : ""))) || "").replace(/\s+/g, " ").trim();
const titleOf = (b) => String(b.title || b.heading || "").replace(/\s+/g, " ").trim();
const kindOf = (b) => b.t === "activity" ? "act" : b.t === "framedsection" ? b.kind : b.t === "exercise" ? "ex" : null;

// every position in reading order: [top, -1] for a top-level block, [top, j] inside a box
function positions(blocks) {
  const out = [];
  blocks.forEach((b, i) => {
    if (isBox(b)) { out.push([i, -1, b, true]); b.body.forEach((x, j) => out.push([i, j, x, false])); }
    else out.push([i, -1, b, false]);
  });
  return out;
}
const textAt = (p) => p[3] ? titleOf(p[2]) : plain(p[2]);

function locate(blocks, find, near, startAt = 0) {
  const ps = positions(blocks);
  let k = 0;
  if (near) { k = ps.findIndex((p) => textAt(p).includes(near)); if (k < 0) return null; }
  k = Math.max(k, startAt);
  for (; k < ps.length; k++) if (!ps[k][3] && textAt(ps[k]).includes(find)) return { k, ps };
  return null;
}

// a box's title as a bold line, for a box opened up inside a new box or back into the flow
const titleLine = (b) => titleOf(b) ? [{ t: "para", segs: [{ t: titleOf(b), b: true, it: false, c: null }] }] : [];
const rebuild = (b, body) => ({ ...b, body });

// cut the flow at positions k1..k2 (inclusive, both inner or top-level), return
// { before: blocks up to the cut, items: the cut-out blocks (flat), after: the rest },
// splitting the boxes the cut starts and ends in
function cut(blocks, ps, k1, k2, keepRestBoxed) {
  const [i1, j1] = ps[k1], [i2, j2] = ps[k2];
  const before = blocks.slice(0, i1), after = blocks.slice(i2 + 1), items = [];
  for (let i = i1; i <= i2; i++) {
    const b = blocks[i];
    if (!isBox(b)) { items.push(b); continue; }
    const lo = i === i1 && j1 >= 0 ? j1 : 0, hi = i === i2 && j2 >= 0 ? j2 : b.body.length - 1;
    if (i === i1 && lo > 0) before.push(rebuild(b, b.body.slice(0, lo)));
    else if (lo === 0 && !(i === i1 && j1 >= 0)) items.push(...titleLine(b));
    items.push(...b.body.slice(lo, hi + 1));
    if (i === i2 && hi < b.body.length - 1) {
      const rest = b.body.slice(hi + 1);
      after.unshift(...(keepRestBoxed ? [rebuild(b, rest)] : rest));
    }
  }
  return { before, items, after };
}

// a one-cell table's lines as paragraphs again ("3. …" / "• …" lines as list items)
function cellLines(cell) {
  const segs = (cell.segs && cell.segs.length) ? cell.segs : [{ t: cell.text || "", b: false, it: false, c: null }];
  const lines = [[]];
  for (const s of segs) String(s.t || "").split("\n").forEach((p, k) => { if (k) lines.push([]); if (p) lines[lines.length - 1].push({ ...s, t: p }); });
  // the cell keeps the old PDF's line ends: a line runs on from the one before unless that
  // one ended a sentence or a label, or either is a bold-only title, a list item or a label
  const txt = (l) => l.map((s) => s.t).join("").trim();
  // (a plain "2." before a bold title still makes a title line)
  const boldOnly = (l) => l.filter((s) => s.t.trim() && !/^\s*\d{1,2}[.)]\s*$/.test(s.t)).every((s) => s.b);
  const starts = /^\s*(\d{1,2}[.)]\s|[•●▪]|\([a-z]\)\s|Expected\s+Competences?|What\s+You|Materials\s+Needed|Steps?\b)/i;
  const joined = [];
  for (const l of lines.filter((x) => x.some((s) => s.t.trim()))) {
    const prev = joined[joined.length - 1];
    const codeLine = (t) => /[{};<>#]|\s=\s|\w\(|^\.\.\.|^>>>/.test(t);
    if (prev && !/[.:!?]$/.test(txt(prev)) && !starts.test(txt(l)) && !boldOnly(l) && !boldOnly(prev) && !codeLine(txt(prev)) && !codeLine(txt(l))) {
      const glue = /-$/.test(txt(prev));
      prev.push({ ...l[0], t: (glue ? "" : " ") + l[0].t.replace(/^\s+/, "") }, ...l.slice(1));
    } else joined.push(l.slice());
  }
  return joined.map((l) => {
    const t = l.map((s) => s.t).join("");
    const m = t.match(/^\s*(\d{1,2}[.)]|[•●▪]|\([a-z]\))\s*/);
    if (!m) return { t: "para", segs: l };
    let cut = m[0].length; const rest = [];
    for (const s of l) { if (cut >= s.t.length) { cut -= s.t.length; continue; } rest.push({ ...s, t: s.t.slice(cut) }); cut = 0; }
    return { t: "listitem", isList: true, marker: m[1], segs: rest };
  }).filter((x) => plain(x));   // (a number left alone on a line is a stray from the old page)
}
const tableText = (b) => b && b.t === "table" && Array.isArray(b.rows) ? b.rows.flat().map((c) => (c && c.text) || "").join(" ").replace(/\s+/g, " ") : "";

// A converted book carries the part of an activity box that ran onto the next page of the
// old PDF as a one-column table inside the box (a white panel within the coloured box).
// Its lines go back into the box as ordinary paragraphs. A table with two or more columns
// is real data and stays. (CDC proofreader, Computer Science Form 3 LB: "remove white
// background", "maintain the same green background".)
function unwrapBoxTables(blocks) {
  let n = 0;
  for (const b of blocks) {
    if (!isBox(b) || !["act", "alt"].includes(kindOf(b))) continue;
    for (let j = 0; j < b.body.length; j++) {
      const x = b.body[j];
      if (!x || x.t !== "table" || !Array.isArray(x.rows) || !x.rows.length) continue;
      if (!x.rows.every((r) => r.filter((c) => c && (c.text || "").trim()).length <= 1)) continue;
      const lines = x.rows.flat().filter((c) => c && (c.text || "").trim()).flatMap(cellLines);
      b.body.splice(j, 1, ...lines);
      j += lines.length - 1; n++;
    }
  }
  return n;
}

function reshapeBoxes(blocks, ov) {
  let out = blocks;
  //   splitTable: ["text"] — a table (top level or in a box) whose text contains it, every
  //               non-empty cell's lines back as paragraphs in its place
  //   dropTable: ["text"] — delete the table whose text contains it (its content rebuilt elsewhere)
  for (const dt of ov.dropTable || []) {
    const i = out.findIndex((b) => tableText(b).includes(dt));
    if (i < 0) { console.warn("!  dropTable not matched:", dt); continue; }
    out.splice(i, 1);
  }
  for (const st of ov.splitTable || []) {
    let done = false;
    const visit = (arr) => {
      for (let i = 0; i < arr.length && !done; i++) {
        const b = arr[i];
        if (b && b.t === "table" && tableText(b).includes(st)) {
          arr.splice(i, 1, ...b.rows.flat().filter((c) => c && (c.text || "").trim()).flatMap(cellLines));
          done = true;
        } else if (isBox(b)) visit(b.body);
      }
    };
    visit(out);
    if (!done) console.warn("!  splitTable not matched:", st);
  }
  // (a line a table's next cell carried on — "…Digital Literacy and" | "Technical Skills…" —
  // joined before any box is cut around it)
  if (ov.joinBrokenLines) joinCompetenceTails(out);
  for (const br of ov.boxRange || []) {
    const a = locate(out, br.from, br.near);
    if (!a) { console.warn("!  boxRange not matched:", br.from); continue; }
    let k2 = a.k;
    if (br.to) {
      // (toNear: look for `to` only from the block containing this text on)
      const from2 = br.toNear ? (locate(out, br.toNear, null, a.k) || { k: a.k }).k : a.k;
      const z = locate(out, br.to, null, from2);
      if (!z) { console.warn("!  boxRange `to` not matched:", br.to); continue; }
      k2 = z.k;
    } else if (br.count > 1) {
      for (let c = 1; c < br.count && k2 + 1 < a.ps.length; c++) { k2++; if (a.ps[k2][3]) k2++; }
    }
    const { before, items, after } = cut(out, a.ps, a.k, k2, br.rest === "box");
    // (titleFromFirst: the first block is the box's title line)
    const first = br.titleFromFirst ? items.shift() : null;
    const title = first ? (first.marker && /^\d/.test(first.marker) ? first.marker + " " : "") + plain(first) : (br.title || "");
    // (into: "prev" — the rest of the box just before: appended to it instead)
    const prevBox = before[before.length - 1];
    if (br.into === "prev" && isBox(prevBox)) { prevBox.body.push(...items); out = [...before, ...after]; continue; }
    const box = { t: "framedsection", kind: br.kind || "act", title, body: items };
    out = [...before, box, ...after];
  }
  //   boxHead: [{ find, near? }] — a line inside a box shown at the box-title size and colour,
  //            for a part of an activity that the reviewer wants titled like its sibling box
  //            ("Part A" inside the activity, "Part B" a box of its own) without a box of its
  //            own and the gap that comes with it (CS Form 3 LB round 2)
  for (const bh of ov.boxHead || []) {
    const a = locate(out, bh.find, bh.near);
    if (!a || a.ps[a.k][1] < 0 || a.ps[a.k][3]) { console.warn("!  boxHead not matched inside a box:", bh.find); continue; }
    const x = a.ps[a.k][2];
    const t = plain(x);
    for (const k of Object.keys(x)) delete x[k];
    Object.assign(x, { t: "head", text: t, boxTitle: true });
  }
  //   keepNext: [{ find, near? }] — a line inside a box kept on the same page as the line after
  //             it (a 2-line "Expected Competences:" left alone over the page; CS F3 LB round 2)
  for (const kn of ov.keepNext || []) {
    const a = locate(out, kn.find, kn.near);
    if (!a || a.ps[a.k][1] < 0 || a.ps[a.k][3]) { console.warn("!  keepNext not matched inside a box:", kn.find); continue; }
    a.ps[a.k][2].keepNext = true;
  }
  //   keepWhole: [{ find, near? }] — the box whose title (or text) contains `find` is not
  //              split across a page: it moves to the next page whole when it does not fit
  //   newPage:   [{ find, near? }] — a page break before the block containing `find` (the
  //              box it opens, if it is a box's first line or its title)
  for (const kw of ov.keepWhole || []) {
    const ps = positions(out);
    const k0 = kw.near ? Math.max(0, ps.findIndex((p) => textAt(p).includes(kw.near))) : 0;
    const hit = ps.slice(k0).find((p) => p[3] ? titleOf(p[2]).includes(kw.find) : textAt(p).includes(kw.find));
    if (!hit || !isBox(out[hit[0]])) { console.warn("!  keepWhole: no box matched:", kw.find); continue; }
    out[hit[0]].forceFreshPage = true;
  }
  //   runOn: ["Sub-Topic 3.11.1"] — that sub-topic heading runs on after the text above it
  //          instead of opening a fresh page (the page before it was left nearly empty)
  for (const ro of ov.runOn || []) {
    const h = out.find((b) => b && b.t === "h2" && String(b.text || "").includes(ro));
    if (h) h.nobreak = true; else console.warn("!  runOn not matched:", ro);
  }
  for (const np of ov.newPage || []) {
    const ps = positions(out);
    const k0 = np.near ? Math.max(0, ps.findIndex((p) => textAt(p).includes(np.near))) : 0;
    const hit = ps.slice(k0).find((p) => textAt(p).includes(np.find));
    if (!hit || hit[1] > 0) { console.warn("!  newPage not matched at a block or box start:", np.find); continue; }
    out.splice(hit[0], 0, { t: "pagebreak" });
  }
  //   edit entries with `late: true` — text that only exists once the boxes do (a line a box's
  //   one-column table gave back): `find` → `with` in the first block after `after` holding it
  for (const ed of (ov.edit || []).filter((x) => x && x.late)) {
    const ps = positions(out);
    const k0 = ed.after ? Math.max(0, ps.findIndex((p) => textAt(p).includes(ed.after))) : 0;
    const hit = ps.slice(k0).find((p) => !p[3] && Array.isArray(p[2].segs) && p[2].segs.some((s) => typeof s.t === "string" && s.t.includes(ed.find)));
    if (!hit) { console.warn("!  edit (late) not matched in one run:", ed.find); continue; }
    const s = hit[2].segs.find((x) => typeof x.t === "string" && x.t.includes(ed.find));
    s.t = s.t.replace(ed.find, ed.with || "");
  }
  //   splitBefore entries with `late: true` — a line break before `find` in a paragraph that
  //   only exists once the boxes do (after `near`)
  for (const sb of (ov.splitBefore || []).filter((x) => x && x.late)) {
    const ps = positions(out);
    const k0 = sb.near ? Math.max(0, ps.findIndex((p) => textAt(p).includes(sb.near))) : 0;
    const hit = ps.slice(k0).find((p) => !p[3] && Array.isArray(p[2].segs) && plain(p[2]).indexOf(sb.find) > 0);
    if (!hit) { console.warn("!  splitBefore (late) not matched:", sb.find); continue; }
    const b = hit[2], arr = hit[1] < 0 ? out : out[hit[0]].body, at = hit[1] < 0 ? hit[0] : hit[1];
    const k = b.segs.findIndex((s) => typeof s.t === "string" && s.t.includes(sb.find));
    if (k < 0) { console.warn("!  splitBefore (late): text spans runs:", sb.find); continue; }
    const s = b.segs[k], cutAt = s.t.indexOf(sb.find);
    const head = [...b.segs.slice(0, k), ...(cutAt > 0 ? [{ ...s, t: s.t.slice(0, cutAt).replace(/\s+$/, "") }] : [])];
    const tail = [{ ...s, t: s.t.slice(cutAt) }, ...b.segs.slice(k + 1)];
    b.segs = head;
    arr.splice(at + 1, 0, { t: "para", segs: tail });
  }
  //   codeBlocks entries with `late: true` — code that only exists once the boxes do (lines
  //   a splitTable gave back): marked here, after the reshaping, instead of in applyOverrides
  for (const cb of (ov.codeBlocks || []).filter((x) => x && x.late)) {
    const a = locate(out, cb.from, cb.near);
    if (!a) { console.warn("!  codeBlocks (late) not matched:", cb.from); continue; }
    let z = cb.to ? locate(out, cb.to, null, a.k) : a;
    // (until: the line containing it ends the code, not included)
    if (!cb.to && cb.until) { const u = locate(out, cb.until, null, a.k + 1); z = u && { ...u, k: u.k - 1 }; }
    if (!z) { console.warn("!  codeBlocks (late) `to` not matched:", cb.to); continue; }
    // (with: ["line", …] — the lines from..to replaced by these, one code line each; from/to
    //  both in one box, or both loose on the page)
    if (Array.isArray(cb.with)) {
      const [i1, j1] = a.ps[a.k], [i2, j2] = z.ps[z.k];
      if ((j1 < 0) !== (j2 < 0) || (j1 >= 0 && i1 !== i2)) { console.warn("!  codeBlocks (late) with: from/to not in one place:", cb.from); continue; }
      const lines = cb.with.map((t) => ({ t: "para", segs: [{ t: String(t).replace(/^ +/, (m) => "\u00a0".repeat(m.length)) || "\u00a0", b: false, it: false, c: null, code: true }] }));
      if (j1 < 0) out.splice(i1, i2 - i1 + 1, ...lines); else out[i1].body.splice(j1, j2 - j1 + 1, ...lines);
      continue;
    }
    for (let k = a.k; k <= z.k; k++) {
      const x = a.ps[k][2];
      if (a.ps[k][3] || !Array.isArray(x.segs)) continue;
      // (a line a table indented with spaces keeps them)
      x.segs = x.segs.map((s, q) => s.m ? s : { ...s, code: true, it: false, t: q === 0 ? String(s.t).replace(/^ +/, (m) => "\u00a0".repeat(m.length)) : s.t });
    }
  }
  //   codeConsole: true — every Python console session (">>> …" / "... …" lines, with the
  //   output lines between them and the output after a closing "..." line) in the coding font
  if (ov.codeConsole) {
    const CON = /^(>>>|\.\.\.)/;
    const isLine = (x) => x && x.t === "para" && !x.isList && Array.isArray(x.segs);
    const mark = (x) => { x.segs = x.segs.map((s) => s.m ? s : { ...s, code: true, it: false, b: false }); };
    const visit = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        if (isBox(arr[i])) { visit(arr[i].body); continue; }
        if (!isLine(arr[i]) || !CON.test(plain(arr[i]))) continue;
        let end = i;
        for (let j = i + 1; j < arr.length && j <= end + 7; j++) {
          if (!isLine(arr[j])) break;
          const t = plain(arr[j]);
          if (CON.test(t)) { end = j; continue; }
          if (t.length > 120 || /^Expected\s+Competences?/i.test(t)) break;
        }
        // the output after a session that ends on a "..." line (the program's result)
        let tail = end;
        if (/^\.\.\./.test(plain(arr[end]))) {
          while (tail + 1 < arr.length && tail < end + 2 && isLine(arr[tail + 1]) && plain(arr[tail + 1]).length <= 200
            && !/^Expected\s+Competences?/i.test(plain(arr[tail + 1])) && !/:$/.test(plain(arr[tail + 1]))) tail++;
        }
        for (let k = i; k <= tail; k++) mark(arr[k]);
        i = tail;
      }
    };
    visit(out);
  }
  //   codeSql: true — every line that is an SQL statement (or the rest of one) in the coding font
  if (ov.codeSql) {
    const SQL = /^(CREATE|INSERT|SELECT|GRANT|REVOKE|FLUSH|USE|VALUES|UPDATE|DELETE|ALTER|DROP|FROM|WHERE|ORDER BY|SET)\b(?![a-z])/;
    const REST = /^(\(\d+, '.*\)[,;]?|\);?|'[a-z]+'@'localhost';?|[a-z_]+ [A-Z]+(\(\d+\))?,?)$/;
    const visit = (arr) => {
      for (const x of arr) {
        if (isBox(x)) { visit(x.body); continue; }
        if (!x || x.t !== "para" || x.isList || !Array.isArray(x.segs)) continue;
        const t = plain(x);
        if (SQL.test(t) || REST.test(t)) x.segs = x.segs.map((s) => s.m ? s : { ...s, code: true, it: false });
      }
    };
    visit(out);
  }
  //   boldLead: ["What You Should Learn:" | { lead, near }] — that label in bold wherever it
  //             opens a paragraph (any case), the way "Expected Competences:" is; with `near`,
  //             only the first such paragraph after the block containing `near`
  if (ov.boldLead) {
    const items = [].concat(ov.boldLead).map((l) => typeof l === "string" ? { lead: l.toLowerCase() } : { ...l, lead: l.lead.toLowerCase() });
    const labels = items.filter((l) => !l.near).map((l) => l.lead);
    const opens = (b, lab) => (b.t === "para" || b.t === "listitem") && Array.isArray(b.segs) && b.segs.length
      && b.segs.map((s) => s.t || "").join("").replace(/^\s+/, "").toLowerCase().startsWith(lab);
    const one = new Map();   // block -> label, for the `near` entries
    for (const l of items.filter((x) => x.near)) {
      const ps = positions(out);
      const k0 = ps.findIndex((p) => textAt(p).includes(l.near));
      const hit = k0 < 0 ? null : ps.slice(k0).find((p) => !p[3] && opens(p[2], l.lead));
      if (hit) one.set(hit[2], l.lead); else console.warn("!  boldLead not matched:", l.lead, "near", l.near);
    }
    const visit = (arr) => {
      for (const b of arr) {
        if (!b) continue;
        if (isBox(b)) visit(b.body);
        if (!(b.t === "para" || b.t === "listitem") || !Array.isArray(b.segs) || !b.segs.length) continue;
        const lab = one.get(b) || labels.find((l) => opens(b, l));
        if (!lab) continue;
        // re-cut the opening segments: the label bold, the rest as it was
        let need = lab.length, lead = true; const segs = [];
        for (const s of b.segs) {
          let t = s.t || "";
          if (lead) { t = t.replace(/^\s+/, ""); if (!t) continue; lead = false; }
          if (need > 0) {
            const head = t.slice(0, need), rest = t.slice(need);
            segs.push({ ...s, t: head, b: true });
            need -= head.length;
            if (rest) segs.push({ ...s, t: rest });
          } else segs.push(s);
        }
        b.segs = segs;
      }
    };
    visit(out);
  }
  for (const ub of ov.unboxRange || []) {
    if (ub.title) {
      const ps = positions(out);
      let k = 0;
      if (ub.near) { k = ps.findIndex((p) => textAt(p).includes(ub.near)); if (k < 0) k = 0; }
      const hit = ps.slice(k).find((p) => p[3] && titleOf(p[2]).includes(ub.title));
      if (!hit) { console.warn("!  unboxRange title not matched:", ub.title); continue; }
      const b = hit[2];
      out.splice(hit[0], 1, ...(ub.keepTitle ? titleLine(b) : []), ...b.body);
      continue;
    }
    const a = locate(out, ub.from, ub.near);
    if (!a || a.ps[a.k][1] < 0) { console.warn("!  unboxRange not matched inside a box:", ub.from); continue; }
    let k2 = a.k;
    if (ub.to) {
      const z = locate(out, ub.to, null, a.k);
      if (!z || z.ps[z.k][0] !== a.ps[a.k][0]) { console.warn("!  unboxRange `to` not in the same box:", ub.to); continue; }
      k2 = z.k;
    } else {
      // count blocks, or to the end of the box
      const n = ub.count || Infinity;
      while (k2 + 1 < a.ps.length && a.ps[k2 + 1][0] === a.ps[a.k][0] && k2 - a.k + 1 < n) k2++;
    }
    const { before, items, after } = cut(out, a.ps, a.k, k2, true);
    out = [...before, ...items, ...after];
  }
  //   mergeTables: [{ first, second }] — the rows of the table containing `second` added to
  //   the (top-level) table containing `first`; a heading just before `second` goes before
  //   `first` (one CROSS-CUTTING ISSUES table the PDF's page break cut in two)
  for (const mt of ov.mergeTables || []) {
    const i = out.findIndex((b) => tableText(b).includes(mt.first));
    const j = out.findIndex((b) => tableText(b).includes(mt.second));
    if (i < 0 || j < 0 || j <= i) { console.warn("!  mergeTables not matched:", mt.first, "/", mt.second); continue; }
    out[i].rows.push(...out[j].rows);
    const head = out[j - 1] && /^(head|h3|label)$/.test(out[j - 1].t) && j - 1 > i ? out[j - 1] : null;
    out.splice(j, 1);
    if (head) { out.splice(j - 1, 1); out.splice(i, 0, head); }
  }
  return out;
}

// ZEPH_TREE=<file>: the blocks after every boxing pass, one line each (box bodies indented),
// for writing boxRange / unboxRange anchors against a converted manuscript
function dumpTree(blocks) {
  const lines = [];
  blocks.forEach((b, i) => {
    if (isBox(b)) {
      lines.push(`${i}\t[${b.t}${kindOf(b) ? ":" + kindOf(b) : ""}] ${titleOf(b)}`);
      b.body.forEach((x, j) => lines.push(`${i}.${j}\t  ${x.t}${x.marker ? " " + x.marker : ""}\t${plain(x).slice(0, x.t === "table" ? 4000 : 150)}`));
    } else lines.push(`${i}\t${b.t}${b.marker ? " " + b.marker : ""}\t${plain(b).slice(0, b.t === "table" ? 4000 : 150)}`);
  });
  return lines.join("\n");
}

// A converted book (joinBrokenLines) breaks an activity's "Expected Competences:" line at
// the old PDF's line end: the rest ("Skills, Collaboration and Communication Skills.")
// comes back as a paragraph of its own under it, and a full stop the PDF wrapped arrives
// alone on a line. Join both back to the line they belong to, inside boxes too.
// (CDC proofreader, Computer Science Form 3 LB round 1: "move the highlighted text so
// that it starts immediately after the word 'and'", seven times.)
const COMPETENCES = /^Expected\s+Competences?\s*:/i;
function joinCompetenceTails(arr) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (b && Array.isArray(b.body)) n += joinCompetenceTails(b.body);
    if (!b || (b.t !== "para" && b.t !== "listitem") || !Array.isArray(b.segs)) continue;
    const p = plain(b), nx = arr[i + 1];
    // a lone full stop / comma: onto the paragraph before
    if (nx && nx.t === "para" && !nx.isList && Array.isArray(nx.segs) && /^[).,;]{1,2}$/.test(plain(nx))) {
      b.segs = [...b.segs, { ...nx.segs[0], t: plain(nx) }];
      arr.splice(i + 1, 1); n++; i--; continue;
    }
    // a sentence the PDF's line end cut in two: "…Give one" | "other example of where…"
    // (never program code, where a lower-case line is a statement of its own)
    // (a line explaining a symbol, "# → Used for comments", is prose; a line already set as code is not)
    const code = (t, x) => (x && (x.segs || []).some((s) => s.code)) || (!/→/.test(t) && /[{};<>#]|\s=\s|\w\(|^\.\.\.|^>>>/.test(t));
    // (nor a line that opens with a bold label of its own — a glossary or abbreviation entry, "pH: …")
    const labelled = (x) => { const f = (x.segs || []).find((s) => (s.t || "").trim()); return !!(f && f.b && /:\s*$/.test(f.t)); };
    // (nor across a change from bold to plain: a bold question and the answer under it)
    const edge = (x, last) => { const ss = (x.segs || []).filter((s) => (s.t || "").trim()); const s = last ? ss[ss.length - 1] : ss[0]; return !!(s && s.b); };
    if (nx && nx.t === "para" && !nx.isList && Array.isArray(nx.segs) && /^[a-z]/.test(plain(nx)) && p && !/[.?!:;)]$/.test(p) && !labelled(nx) && edge(b, true) === edge(nx, false)
        && !code(p, b) && !code(plain(nx), nx) && !COMPETENCES.test(p) && plain(nx).length < 400) {
      if (process.env.ZEPH_JOINS) console.log("   joined:", p.slice(-40), "|", plain(nx).slice(0, 40));
      b.segs = [...b.segs.map((s, k) => k === b.segs.length - 1 ? { ...s, t: s.t.replace(/\s+$/, "") } : s), { ...nx.segs[0], t: " " + nx.segs[0].t.replace(/^\s+/, "") }, ...nx.segs.slice(1)];
      arr.splice(i + 1, 1); n++; i--; continue;
    }
    if (!COMPETENCES.test(p) || /[.]$/.test(p)) continue;
    if (!nx || nx.t !== "para" || nx.isList || !Array.isArray(nx.segs)) continue;
    const q = plain(nx);
    if (!q || q.length > 120 || /\.\s/.test(q) || /^\d/.test(q) || /^Alternative/i.test(q)) continue;
    const tail = /(\band|,|-|:)$/.test(p) || /^(Skills\b|[a-z])/.test(q) || (/Skills\.?$/.test(q) && /,|\band\b/.test(q));
    if (!tail) continue;
    const glue = /-$/.test(p);
    const first = { ...nx.segs[0], t: (glue ? "" : " ") + nx.segs[0].t.replace(/^\s+/, "") };
    b.segs = [...b.segs.map((s, k) => k === b.segs.length - 1 ? { ...s, t: s.t.replace(/\s+$/, "") } : s), first, ...nx.segs.slice(1)];
    arr.splice(i + 1, 1); n++; i--;
  }
  return n;
}

// A converted book can strand an EXERCISE bar one section late: the scenario and its
// lettered questions come through as plain text, and the bar opens the box that follows,
// over the next section's heading and prose. When an exercise box opens with a heading
// and the blocks just before it are a scenario plus two or more lettered questions, the
// bar goes back over those questions and the section after it is plain text again.
// (Computer Science Form 3 LB round 1: the same correction on eight pages.)
const LETTERED = /^\(?[a-z][.)]$/;
const letteredBlock = (b) => b && ((b.t === "listitem" || (b.t === "para" && b.isList)) && LETTERED.test(String(b.marker || "").trim())
  || (b.t === "para" && /^\([a-z]\)\s/.test(plain(b))));
function exerciseBarBack(blocks) {
  let n = 0;
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (!(b && b.t === "framedsection" && b.kind === "ex" && Array.isArray(b.body) && b.body.length > 1)) continue;
    if (!/^(h3|head)$/.test(b.body[0].t)) continue;
    let j = i - 1, letters = 0;
    while (j > 0) {
      if (letteredBlock(blocks[j])) { letters++; j--; continue; }
      // (a plain line between two lettered ones is part of a question)
      if (blocks[j].t === "para" && letteredBlock(blocks[j - 1]) && letters) { j--; continue; }
      break;
    }
    const lead = blocks[j];
    if (letters < 2 || !lead || lead.t !== "para" || lead.isList || plain(lead).length < 40) continue;
    const box = { t: "framedsection", kind: "ex", title: b.title, body: blocks.slice(j, i) };
    blocks.splice(j, i - j + 1, box, ...b.body);
    i = j;
    n++;
  }
  return n;
}

module.exports = { reshapeBoxes, dumpTree, joinCompetenceTails, exerciseBarBack, unwrapBoxTables };
