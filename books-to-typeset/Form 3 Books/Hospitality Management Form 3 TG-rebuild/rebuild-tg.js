// Rebuild the Hospitality Management Form 3 Teacher's Guide manuscript.
//
// The editor (Madam Phyllis Simasiku) returned the TG as the EARLIER TYPESET PDF
// CONVERTED TO WORD, with her corrections made in the text: additions highlighted
// yellow (keep), deletions in red (remove). That file cannot be typeset directly — its
// topic banners, running heads and contents title are invisible text boxes, the
// activity/exercise boxes are grey tables cut at the old page breaks, and paragraphs are
// split where old pages ended. This turns it into a linear manuscript, keeping every
// word she kept. Rerun it whenever she sends a new copy, then re-typeset.
//
//   node "Hospitality Management Form 3 TG-rebuild/rebuild-tg.js" [in.docx] [out.docx]
//
// (run from books-to-typeset/Form 3 Books; the defaults are the names below)
const JSZip = require("jszip"), fs = require("fs");
const [IN = "HOSPITALITY MANAGEMENT FORM 3 TG post cdc edit word.docx",
  OUT = "Hospitality Management Form 3 TG.docx"] = process.argv.slice(2);
const log = (...a) => console.log(...a);

// depth-aware: find each outermost <tag ...>...</tag> span in s
function spans(s, tag, from = 0, to = s.length) {
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "g"), out = [];
  const close = `</${tag}>`;
  let i = from;
  while (i < to) {
    open.lastIndex = i; const m = open.exec(s); if (!m || m.index >= to) break;
    // self-closing?
    const gt = s.indexOf(">", m.index);
    if (s[gt - 1] === "/") { out.push([m.index, gt + 1]); i = gt + 1; continue; }
    let depth = 1, j = gt + 1;
    while (depth > 0) {
      open.lastIndex = j; const o = open.exec(s); const c = s.indexOf(close, j);
      if (o && o.index < c) { const g = s.indexOf(">", o.index); if (s[g - 1] !== "/") depth++; j = g + 1; }
      else { depth--; j = c + close.length; }
    }
    out.push([m.index, j]); i = j;
  }
  return out;
}
function cut(s, list) { let r = "", p = 0; for (const [a, b] of list) { r += s.slice(p, a); p = b; } return r + s.slice(p); }
const T = (x) => (x.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) || []).map((t) => t.startsWith("<w:tab") ? "\t" : t.replace(/<[^>]+>/g, "")).join("")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

JSZip.loadAsync(fs.readFileSync(IN)).then(async (z) => {
  let d = await z.file("word/document.xml").async("string");
  const b0 = d.indexOf("<w:body>") + 8, b1 = d.lastIndexOf("<w:sectPr");
  let head = d.slice(0, b0), body = d.slice(b0, b1), tail = d.slice(b1);

  // 1. text boxes: all running-head / banner / TOC-title debris from the old PDF
  let ac = spans(body, "mc:AlternateContent").filter(([a, b]) => body.slice(a, b).includes("txbxContent"));
  body = cut(body, ac);
  let pic = spans(body, "w:pict").filter(([a, b]) => body.slice(a, b).includes("txbxContent"));
  body = cut(body, pic);
  let dr = spans(body, "w:drawing").filter(([a, b]) => body.slice(a, b).includes("txbxContent"));
  body = cut(body, dr);
  log("text boxes removed:", ac.length, pic.length, dr.length, "left:", (body.match(/txbxContent/g) || []).length);
  // the remaining drawings are the old layout's rules and frames, plus the old cover
  // picture (image1.png, the only picture in the file); the cover is built fresh
  const rest = [...spans(body, "mc:AlternateContent"), ...spans(body, "w:pict")];
  body = cut(body, rest.sort((a, b) => a[0] - b[0]));
  const dr2 = spans(body, "w:drawing"); body = cut(body, dr2);
  log("other drawings removed:", rest.length + dr2.length, "left:", (body.match(/<w:drawing|<w:pict|<a:blip/g) || []).length);

  // 2. runs: red EE0000 = the reviewer's "delete"; white FFFEFD = invisible header residue
  const red = [];
  body = body.replace(/<w:r(?=[\s>])(?:(?!<w:r[\s>])[\s\S])*?<\/w:r>/g, (r) => {
    const c = (r.match(/<w:color w:val="(\w+)"/) || [])[1];
    if (c === "EE0000") { red.push(T(r)); return ""; }
    if (c === "FFFEFD") return "";
    return r;
  });
  log("red runs deleted:", red.length, JSON.stringify(red.join("|")).slice(0, 2000));
  // 3. highlights: yellow = the reviewer's accepted corrections (keep text), cyan the same
  body = body.replace(/<w:highlight w:val="\w+"\/>/g, "");

  // top-level elements
  const els = [];
  { let i = 0; const re = /<w:(p|tbl)(?=[\s>])/g;
    while (true) { re.lastIndex = i; const m = re.exec(body); if (!m) break;
      if (m.index > i && body.slice(i, m.index).trim()) els.push({ k: "x", x: body.slice(i, m.index) });
      const [a, b] = spans(body, "w:" + m[1], m.index)[0]; els.push({ k: m[1], x: body.slice(a, b) }); i = b; }
    if (body.slice(i).trim()) els.push({ k: "x", x: body.slice(i) }); }
  const txt = (e) => T(e.x).trim();
  const sty = (e) => (e.x.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || "";
  const hasMedia = (e) => /<w:drawing|<w:pict|<w:object/.test(e.x);
  const isEmpty = (e) => e.k === "p" && !txt(e) && !hasMedia(e);

  // 4. drop the typed table of contents (the engine builds its own)
  let s = els.findIndex((e) => e.k === "p" && /^TABLE OF CONTENTS? \.{3}/.test(txt(e)));
  let s0 = s; while (s0 > 0 && (isEmpty(els[s0 - 1]) || /^TABLE OF CONTENTS?$/.test(txt(els[s0 - 1])))) s0--;
  const eA = els.findIndex((e, i) => i > s && e.k === "p" && /^ACRONYMS$/.test(txt(e)));
  log("typed TOC removed:", eA - s0, "elements");
  els.splice(s0, eA - s0);

  // 5. topic headings (the banners did not survive the conversion)
  const TOPICS = ["HEALTH AND SAFETY", "FOOD SAFETY", "CUSTOMER CARE", "COSMETOLOGY", "PROFESSIONAL CONDUCT",
    "COMMUNICATION", "SECURITY IN HOSPITALITY", "ENTREPRENEURSHIP"];
  const kc = els.findIndex((e) => /^KEY COMPETENCES TO BE DEVELOPED/.test(txt(e)));
  const intros = []; els.forEach((e, i) => { if (i > kc && e.k === "p" && /^introduction$/i.test(txt(e))) intros.push(i); });
  log("topic introductions found:", intros.length);
  if (intros.length !== 8) throw new Error("expected 8 topic introductions");
  for (let n = 7; n >= 0; n--) {
    const h = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">TOPIC 3.${n + 1}: ${TOPICS[n]}</w:t></w:r></w:p>`;
    els.splice(intros[n], 0, { k: "p", x: h });
  }

  // 6. "General Competence(s): …" lines styled as headings -> plain paragraphs
  let gc = 0;
  for (const e of els) if (e.k === "p" && /^General Competences?\s*:/i.test(txt(e)) && /Heading/.test(sty(e))) {
    e.x = e.x.replace(/<w:pStyle w:val="Heading\d"\/>/, ""); gc++; }
  log("General Competence lines unstyled:", gc);

  // 7. grey boxes: one box per table, cut at the old page breaks or holding two boxes
  const TITLE = /^(LEARNING ACTIVITY|EXERCISE|END OF TOPIC)/i;
  const rowParas = (tr) => {
    const cells = spans(tr, "w:tc").map(([a, b]) => tr.slice(a, b));
    if (cells.length === 1) return spans(cells[0], "w:p").map(([a, b]) => cells[0].slice(a, b));
    // "•" | text rows: the bullet was typed in a cell of its own
    const first = T(cells[0]).trim();
    const rest = cells.slice(1).flatMap((c) => spans(c, "w:p").map(([a, b]) => c.slice(a, b)));
    if (/^[•●▪]$/.test(first) && rest.length) {
      rest[0] = rest[0].replace(/(<w:r[\s>])/, `<w:r><w:t xml:space="preserve">• </w:t></w:r>$1`); return rest; }
    return cells.flatMap((c) => spans(c, "w:p").map(([a, b]) => c.slice(a, b)));
  };
  const out = []; let boxes = 0, contd = 0;
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (e.k !== "tbl" || !/w:fill="E9E8E7"/.test(e.x)) { out.push(e); continue; }
    const tblPr = (e.x.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/) || [""])[0];
    const rows = spans(e.x, "w:tr").map(([a, b]) => e.x.slice(a, b));
    const tcPr = (rows[0].match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [""])[0].replace(/<w:gridSpan[^>]*\/>/, "").replace(/<w:tcW [^>]*\/>/, "");
    let groups = [];
    for (const r of rows) {
      const ps = rowParas(r); const t = T(r).trim(); if (!t) continue;
      if (!groups.length || TITLE.test(t)) groups.push({ ps: [...ps], tblPr, tcPr }); else groups[groups.length - 1].ps.push(...ps);
    }
    // a table that opens without a title continues the box before it, unless text came between
    let j = out.length - 1; while (j >= 0 && (isEmpty(out[j]) || out[j].k === "x")) j--;
    if (groups.length && !TITLE.test(T(groups[0].ps.join("")).trim()) && j >= 0 && out[j].box) {
      out[j].g.ps.push(...groups.shift().ps); out[j].x = mk(out[j].g); contd++;
      out.splice(j + 1, out.length - j - 1, ...out.slice(j + 1).filter((x) => !isEmpty(x)));
    }
    // …or the LOOSE activity before it: Sub-topic 3.2.2's Learning Activity 4 has its title
    // and steps as plain paragraphs and only its "Expected Responses" in a grey box, which
    // printed as a second, title-less box under it. Its paragraphs go into that box.
    else if (groups.length && !TITLE.test(T(groups[0].ps.join("")).trim())) {
      let s = out.length - 1;
      while (s >= 0 && s >= out.length - 25 && out[s].k === "p" && !/<w:pStyle w:val="Heading/.test(out[s].x) && !/^LEARNING ACTIVITY\s*\d/i.test(txt(out[s]))) s--;
      if (s >= 0 && out[s].k === "p" && /^LEARNING ACTIVITY\s*\d/i.test(txt(out[s]))) {
        const g = groups.shift();
        g.ps = [...out.slice(s).filter((x) => !isEmpty(x)).map((x) => x.x), ...g.ps];
        out.splice(s); out.push({ k: "tbl", box: true, g, x: mk(g) }); boxes++; contd++;
        log("   loose activity boxed with its responses:", txt(out[out.length - 1]).slice(0, 50));
      }
    }
    for (const g of groups) { out.push({ k: "tbl", box: true, g, x: mk(g) }); boxes++; }
  }
  function mk(g) {
    return `<w:tbl>${g.tblPr}<w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc>${g.tcPr}${g.ps.join("")}</w:tc></w:tr></w:tbl>`;
  }
  log("boxes:", boxes, "continuations joined:", contd);

  // 7b. exercises the reviewer re-typed as plain text lost their grey box: box them
  //     like every other exercise, up to the next heading, box or activity
  const proto = out.find((e) => e.box).g;
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    if (e.k !== "p" || !/^(EXERCISE\s+\d+|LEARNING ACTIVITY\s+\d+)/i.test(txt(e))) continue;
    const isLA = /^LEARNING/i.test(txt(e));
    let j = i + 1;
    const label = (x) => /^(Suggested|Possible|Expected) (Answers?|Responses?)/i.test(txt(x));
    const stop = (x) => (x.k === "tbl" && !(x.box && !TITLE.test(T(x.g.ps.join("")).trim())))
      || (x.k === "p" && ((new RegExp(`<w:pStyle w:val="Heading[123]"`).test(x.x) && !label(x))
      || /^(LEARNING ACTIVITY|END OF TOPIC|EXERCISE\s+\d|Sub[- ]Topic)/i.test(txt(x))));
    while (j < out.length && !stop(out[j])) j++;
    while (j > i + 1 && isEmpty(out[j - 1])) j--;
    if (isLA) {
      // a loose activity title: box it on its own; 7c below gives it its body
      out.splice(i, 1, { k: "tbl", box: true, g: { ps: [e.x], tblPr: proto.tblPr, tcPr: proto.tcPr }, x: "" });
      continue;
    }
    // an untitled box inside the run is this box carried over a page: take its paragraphs
    const ps = out.slice(i, j).flatMap((x) => x.k === "p" ? [x.x] : x.box ? x.g.ps : [])
      .map((x) => x.replace(/<w:pStyle w:val="Heading\d"\/>/, ""));
    const g = { ps, tblPr: proto.tblPr, tcPr: proto.tcPr };
    log("   boxed loose", txt(e).slice(0, 30), "+", ps.length - 1, "paragraphs; next:", out[j] ? (out[j].k + " " + T(out[j].x).trim().slice(0, 50)) : "-");
    out.splice(i, j - i, { k: "tbl", box: true, g, x: mk(g) });
  }

  // 7c. a box's own text is set in ITALIC in this book (instructions, expected responses,
  //     tips), the teacher's running text outside the boxes in roman. Where the old page
  //     ended, the conversion closed the box and left the rest of it as loose italic
  //     paragraphs (with their bold labels: "Expected Responses", "Key Teaching Points",
  //     "TIPS"). Each box takes those back, up to the next roman paragraph or heading.
  const BOXLABEL = /^(key\s+)?teaching\s+(points?|notes?)|^tips?$|^expected\s+(learner\s+)?responses?|^possible\s+(learner\s+)?(responses?|answers?|ideas?|choices|suggestions?|actions?|demonstration)|^suggested\s+(responses?|answers?)|^scenarios?\b|^reinforce\b|^note$|^guidance\b|^reflection$|^highlight\b|^follow.up activity$/i;
  const italicShare = (x) => {
    let it = 0, all = 0;
    for (const r of x.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g) || []) {
      const n = T(r).replace(/[^A-Za-z]/g, "").length; all += n; if (/<w:i\/>|<w:i w:val="(1|true)"\/>/.test(r)) it += n;
    }
    return all ? it / all : 0;
  };
  const isItalicP = (x) => x.k === "p" && /[A-Za-z]/.test(txt(x)) && italicShare(x.x) >= 0.2 && !TITLE.test(txt(x))
    && !/<w:pStyle w:val="Heading[123]"/.test(x.x);
  const allBold = (x) => (x.x.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g) || []).every((r) => !/[A-Za-z]/.test(T(r)) || /<w:b\/>/.test(r));
  const isLabelP = (x) => x.k === "p" && !TITLE.test(txt(x)) && txt(x).split(/\s+/).length <= 8
    && (BOXLABEL.test(txt(x).replace(/[:.]\s*$/, "")) || /:$/.test(txt(x)) || allBold(x)) && !/<w:pStyle w:val="Heading[12]"/.test(x.x);
  const untitledBox = (x) => x.box && !TITLE.test(T(x.g.ps.join("")).trim());
  let absorbed = 0;
  for (let i = 0; i < out.length; i++) {
    if (!out[i].box) continue;
    const g = out[i].g; let j = i + 1, take = [];
    while (j < out.length) {
      const x = out[j];
      // empty, or a lone "•" / tab the conversion left behind: no content, step over it
      if (isEmpty(x) || (x.k === "p" && !/[A-Za-z0-9]/.test(txt(x)) && !hasMedia(x))) { j++; continue; }
      if (untitledBox(x)) { take.push(...x.g.ps); j++; continue; }
      // the second line of a title that wrapped ("…a mock customer care plan for" /
      // "a hospitality business"): it carries on the line above, so it starts in lower case
      const prev = T((take.length ? take : g.ps)[(take.length ? take : g.ps).length - 1] || "").trim();
      if (x.k === "p" && /^[a-z]/.test(txt(x)) && /[A-Za-z,]$/.test(prev) && !/<w:pStyle w:val="Heading/.test(x.x)) { take.push(x.x); j++; continue; }
      // answers typed in roman among the box's italic ones: still the box's, when more of
      // its italic text or labels follow before the next heading, title or box
      if (x.k === "p" && !/<w:pStyle w:val="Heading/.test(x.x) && !TITLE.test(txt(x)) && !/^Sub[- ]Topic/i.test(txt(x))) {
        let k = j + 1, found = false;
        while (k < out.length && k < j + 15) {
          const y = out[k];
          if (y.k !== "p" || /<w:pStyle w:val="Heading/.test(y.x) || TITLE.test(txt(y))) break;
          if (isItalicP(y) || (isLabelP(y) && BOXLABEL.test(txt(y).replace(/[:.]\s*$/, "")))) { found = true; break; }
          k++;
        }
        if (found) { take.push(x.x); j++; continue; }
      }
      if (isItalicP(x)) { take.push(x.x); j++; continue; }
      if (isLabelP(x)) {
        let k = j + 1; while (k < out.length && isEmpty(out[k])) k++;
        if (k < out.length && (isItalicP(out[k]) || untitledBox(out[k]))) {
          // a heading-styled label goes into the box as a bold line, not a heading
          take.push(/<w:pStyle w:val="Heading\d"\/>/.test(x.x)
            ? x.x.replace(/<w:pStyle w:val="Heading\d"\/>/, "").replace(/<w:rPr>/g, "<w:rPr><w:b/>").replace(/<w:r>(?!<w:rPr>)/g, "<w:r><w:rPr><w:b/></w:rPr>")
            : x.x);
          j++; continue;
        }
      }
      break;
    }
    if (take.length) { absorbed += take.length; g.ps.push(...take); }
    out.splice(i + 1, j - i - 1, ...out.slice(i + 1, j).filter((x) => false));
    out[i].x = mk(g);
  }
  log("box text taken back from the page breaks:", absorbed, "paragraphs");

  // 8. paragraphs cut at the old page breaks: "…use the school" / "environment for…"
  let merges = [];
  function mergeSeq(ps) {
    // ps: array of paragraph xml strings; returns new array
    const res = [];
    for (const p of ps) {
      let k = res.length - 1; while (k >= 0 && !T(res[k]).trim() && !/<w:drawing|<w:pict/.test(res[k]) && T(p).trim()) k--;
      const A = k >= 0 ? res[k] : null, ta = A ? T(A).replace(/\s+$/, "") : "", tb = T(p).replace(/^\s+/, "");
      const okA = A && !/<w:pStyle w:val="Heading/.test(A) && /[A-Za-z,]$/.test(ta) && ta.length > 25 && !/\t/.test(ta);
      const okB = tb && /^[a-z]/.test(tb) && !/^(?:[a-z]|[ivx]+)[).]/.test(tb) && !/<w:numPr>/.test(p) && !/<w:pStyle w:val="Heading/.test(p);
      if (okA && okB) {
        const runs = (p.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>|<w:hyperlink[\s\S]*?<\/w:hyperlink>/g) || []).join("");
        res[k] = A.replace(/<\/w:p>$/, `<w:r><w:t xml:space="preserve"> </w:t></w:r>${runs}</w:p>`);
        res.splice(k + 1); merges.push(ta.slice(-30) + " ⏎ " + tb.slice(0, 30));
      } else res.push(p);
    }
    return res;
  }
  // body level
  const fin = []; let buf = [];
  const flush = () => { for (const p of mergeSeq(buf)) fin.push({ k: "p", x: p }); buf = []; };
  for (const e of out) { if (e.k === "p") buf.push(e.x); else { flush(); if (e.box) { e.g.ps = mergeSeq(e.g.ps); e.x = mk(e.g); } fin.push(e); } }
  flush();
  log("paragraph joins:", merges.length); merges.forEach((m) => log("   ", m));

  body = fin.map((e) => e.x).join("");

  // 9. the old layout's pointer icon before "Refer to Learner's Book …" is a Wingdings
  //    private-use character (U+F076); no book font has it, so it printed as a box
  let icons = 0;
  body = body.replace(/<w:r(?=[\s>])(?:(?!<w:r[\s>])[\s\S])*?<\/w:r>/g, (r) => {
    if (!/w:ascii="Wingdings"/.test(r)) return r;
    const t = T(r);
    if (/^[-\s]*$/.test(t)) { icons++; return ""; }
    return r;
  });
  log("Wingdings icons removed:", icons);

  // 10. lines of the old layout the conversion ran together: a bold label glued onto the
  //     end of a paragraph ("…learners can recognise. Teaching Points learners should
  //     understand:"), and a lettered/roman part glued onto the line before ("…the
  //     learners must: a) Identify the rule involved")
  const LABEL = /^(key\s+)?teaching\s+(points?|notes?)|^tips?$|^expected\s+(learner\s+)?responses?|^possible\s+(learner\s+)?(responses?|answers?|ideas?|choices|suggestions?|actions?|demonstration)|^suggested\s+(responses?|answers?)|^scenarios?(\/|$)|^reinforce\b|^note$|^guidance\b|^reflection$|^highlight\b|^customer responses$/i;
  const CUT_AT = [
    "Accept any correct hazard-control", "Physical contamination e.g.", "Before the visit:", "Examples may include:",
    "Responses may include:", "guide learners to see the consequences", "Consumer responsibility: Understand",
    "Learners may mention that:", "Any two:", "lifted effect. |Nose", "reduce booking errors |Online reservation",
    "(paragraph idea). |Risks are potential", "teamwork. |Encourage learners to give", "prevent the hazard |Learners may state:",
    "Risk |Theft.", "Learners may include:",
  ];
  const LABEL_PHRASE = /(^|[.?!:]\s+)(Key Teaching Points|Teaching Points|Expected Responses from Learners During Review|Expected Responses from Learners|Expected Learner Responses|Possible Demonstration Behaviours|Possible Learner Responses|Possible Learner Choices|Possible Responses|Suggested Responses|TIPS)(?=\s|:|$)/g;
  const cutHits = new Set();
  const splits = [];
  body = body.replace(/<w:p(?=[\s>])[^>]*>[\s\S]*?<\/w:p>/g, (p) => {
    const open = p.match(/^<w:p(?=[\s>])[^>]*>/)[0];
    const pPr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
    const inner = p.slice(open.length, -6).replace(pPr, "");
    const items = inner.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>|<[^>]+\/>|<w:hyperlink[\s\S]*?<\/w:hyperlink>|<[^>]+>[\s\S]*?<\/[^>]+>/g) || [];
    const runs = items.map((x) => ({ x, t: /^<w:r[\s>]/.test(x) ? T(x) : "", b: /<w:b\/>|<w:b w:val="(1|true)"\/>/.test(x) }));
    let pos = 0; for (const r of runs) { r.at = pos; pos += r.t.length; }
    const full = runs.map((r) => r.t).join("");
    const cuts = new Set();
    // (a) bold labels
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]; if (!r.b || !r.t.trim()) continue;
      const before = full.slice(0, r.at); if (!/[A-Za-z]/.test(before)) continue;
      let k = i - 1; while (k >= 0 && !runs[k].t.trim()) k--; if (k < 0 || runs[k].b) continue;
      let j = i, lab = ""; while (j < runs.length && (runs[j].b || !runs[j].t.trim())) { lab += runs[j].t; j++; }
      const l = lab.trim(), core = l.replace(/[:.]\s*$/, "");
      if (!/[A-Za-z]{2}/.test(core) || core.split(/\s+/).length > 8 ||!(LABEL.test(core) || /:$/.test(l))) continue;
      if (/:$/.test(l) && !LABEL.test(core) && !/[.?!:;]\s*$/.test(before) && core.split(/\s+/).length > 5) continue;
      cuts.add(r.at + (r.t.length - r.t.trimStart().length));
      const end = runs[j - 1].at + runs[j - 1].t.length;
      if (!/:$/.test(l) && LABEL.test(core) && /^\s*[A-Za-z]/.test(full.slice(end))) cuts.add(end + (full.slice(end).length - full.slice(end).trimStart().length));
    }
    // (a2) the same labels by their wording, bold or not: at the start of a line with the
    //      next line run on after them ("Key Teaching Points Learners should:"), or after
    //      a full stop ("…in the correct category. Expected Responses from Learners")
    for (const m of full.matchAll(LABEL_PHRASE)) {
      const at = m.index + m[1].length, end = at + m[2].length;
      if (at > 0) cuts.add(at);
      if (/^\s+[A-Z(]/.test(full.slice(end)) && full.slice(end).trim().length > 3) cuts.add(end + (full.slice(end).length - full.slice(end).trimStart().length));
    }
    // (b) a) / b) / ii. after a full stop, colon, question mark or bracket — or straight
    //     after a full stop with no space at all ("…causing delays.a) Professional issue")
    for (const m of full.matchAll(/[.:?)]\s+(?=(?:[a-h]|i{1,3}|iv|vi{0,3})[.)]\s+[A-Z])|[a-z]\.(?=[a-h]\)\s+[A-Z])/g)) cuts.add(m.index + m[0].length);
    //     a roman sub-question marker glued onto the end of the answer before it
    //     ("…expected standards ii. State three steps", "…professional image ii.")
    for (const m of full.matchAll(/[a-z)]\s+(?=(?:ii|iii|iv)\.(?:\s+[A-Z]|\s*$))/g)) cuts.add(m.index + m[0].length);
    // (d) a bullet typed mid-paragraph ("…polite communication. •⇥Following service standards.")
    for (const m of full.matchAll(/[A-Za-z.;,)]\s*(?=•)/g)) cuts.add(m.index + m[0].length);
    // (c) lines of this book glued without a bold label to show it (found on proof)
    // ("A|B" cuts between A and B; a bare anchor cuts before itself)
    for (const a of CUT_AT) {
      const [pre, post] = a.includes("|") ? a.split("|") : ["", a];
      const k = full.indexOf(pre + post);
      if (k >= 0 && k + pre.length > 0) { cuts.add(k + pre.length); cutHits.add(a); }
    }
    if (!cuts.size) return p;
    // cut the runs at those offsets (inside a run only when it holds one plain text node)
    const pieces = [[]]; const sorted = [...cuts].sort((a, b) => a - b);
    for (const r of runs) {
      const inside = sorted.filter((c) => c > r.at && c < r.at + r.t.length);
      if (sorted.includes(r.at) && r.at > 0 && r.t) pieces.push([]);
      if (!inside.length) { pieces[pieces.length - 1].push(r.x); continue; }
      const one = (r.x.match(/<w:t(?:\s[^>]*)?>/g) || []).length === 1 && !/<w:tab\/>|<w:br\/>/.test(r.x);
      if (!one) { pieces[pieces.length - 1].push(r.x); continue; }
      let last = 0;
      for (const c of [...inside, r.at + r.t.length]) {
        const seg = r.t.slice(last, c - r.at);
        pieces[pieces.length - 1].push(r.x.replace(/(<w:t)(?:\s[^>]*)?>[^<]*<\/w:t>/, `$1 xml:space="preserve">${esc(seg)}</w:t>`));
        if (c < r.at + r.t.length) pieces.push([]);
        last = c - r.at;
      }
    }
    const nonEmpty = pieces.filter((pc) => T(pc.join("")).trim());
    if (nonEmpty.length < 2) return p;
    splits.push(nonEmpty.map((pc) => T(pc.join("")).trim().slice(0, 28)).join(" ‖ "));
    const pPr2 = pPr.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "");
    return nonEmpty.map((pc, n) => `${open}${n ? pPr2 : pPr}${pc.join("")}</w:p>`).join("");
  });
  log("paragraph splits:", splits.length); splits.forEach((s) => log("   ", s));
  for (const a of CUT_AT) if (!cutHits.has(a)) log("   ! cut point not found:", a);

  // 11. odds and ends
  //  - a lone capital left over from a glued line ("L" of "LKey Teaching Points")
  //  - the competence name repeated on its own line under "General Competences: …" —
  //    the editor struck this same stray line in red under every other sub-topic; the
  //    one under 3.1.1 escaped her pen
  //  - the "General Competence(s):" label in bold everywhere (plain in half the sub-topics)
  let odd = 0;
  body = body.replace(/<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g, (p) => (/^[A-Z]$/.test(T(p).trim()) ? (odd++, "") : p));
  let prevGC = false;
  body = body.replace(/<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g, (p) => {
    const t = T(p).trim();
    if (prevGC && /^(Environmental Sustainability|Critical Thinking|Communication|Collaboration)$/.test(t)) { prevGC = false; odd++; return ""; }
    prevGC = /^General Competences?\s*:/.test(t);
    if (!prevGC) return p;
    // bold every run up to and including the one that holds the colon
    const runs = p.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g) || [];
    let seen = "", out = p, changed = false;
    for (const r of runs) {
      const rt = T(r); if (!rt) continue;
      const k = rt.indexOf(":");
      const bold = (x) => /<w:b\/>/.test(x) ? x : (/<w:rPr>/.test(x) ? x.replace("<w:rPr>", "<w:rPr><w:b/>") : x.replace(/^(<w:r(?=[\s>])[^>]*>)/, "$1<w:rPr><w:b/></w:rPr>"));
      const withText = (x, s) => x.replace(/(<w:t)(?:\s[^>]*)?>[^<]*<\/w:t>/, `$1 xml:space="preserve">${esc(s)}</w:t>`);
      if (k < 0) { if (!/<w:b\/>/.test(r)) { out = out.replace(r, bold(r)); changed = true; } seen += rt; continue; }
      if (!/<w:b\/>/.test(r)) {
        const head = withText(bold(r), rt.slice(0, k + 1)), tail = rt.slice(k + 1) ? withText(r, rt.slice(k + 1)) : "";
        out = out.replace(r, head + tail); changed = true;
      }
      break;
    }
    if (changed) odd++;
    return out;
  });
  // a paragraph repeated word for word straight after itself (Sub-topic 3.5.1, Learning
  // Activity 1: scenarios n) and o) are the same waiter scenario)
  let lastT = "";
  const PARA = /<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g;
  // an answer-key item typed as a Word heading ("4. Strategic partnerships" among plain
  // "3." and "6." in Topic 3.8's assessment; item 1 in Topic 3.3's): a plain line like
  // its siblings
  body = body.replace(PARA, (p) => (/^\d+\.\s/.test(T(p).trim()) && /<w:pStyle w:val="Heading\d"\/>/.test(p)
    ? (odd++, p.replace(/<w:pStyle w:val="Heading\d"\/>/, "")) : p));
  // Sub-topic 3.7.1 Exercise 1 types "1a. Security risk" but then "b. Action"; read as a
  // lettered list, "b." restarted the key's numbering. Typed as its sibling is.
  body = body.replace(PARA, (p) => (T(p).trim() === "b. Action"
    ? (odd++, p.replace(/(<w:t(?:\s[^>]*)?>)b\. Action/, "$11b. Action")) : p));
  // Sub-topic 3.1.2 Exercise 2: the first sub-question's marker came through as a bare
  // "1" under "Possible Answers"; its siblings are "ii." and "iii."
  body = body.replace(/(Possible Answers(?:(?!<\/w:p>)[\s\S])*<\/w:p>)(<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:t(?:\s[^>]*)?>)1(<\/w:t>(?:(?!<\/w:p>)[\s\S])*<\/w:p>)/,
    (m, a, b, c) => (T(b + "1" + c).trim() === "1" ? (odd++, a + b + "i." + c) : m));
  // an item number standing alone, its "a)" part on the next line ("6." / "a) Two risks…"),
  // which a page break can strand at the foot of a page: one line, as "2. a) …" already is
  body = body.replace(/(<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*<\/w:p>)(<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*<\/w:p>)/g, (m, a, b) => {
    if (!/^\d+\.$/.test(T(a).trim()) || !/^a\)\s/.test(T(b).trim()) || /<w:numPr>/.test(a)) return m;
    const runs = (b.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g) || []).join("");
    odd++; return a.replace(/<\/w:p>$/, `<w:r><w:t xml:space="preserve"> </w:t></w:r>${runs}</w:p>`);
  });
  // a full stop typed twice across two runs ("2." + "." Emergency help…)
  body = body.replace(PARA, (p) => {
    const runs = p.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g) || [];
    for (let i = 1; i < runs.length; i++) {
      if (T(runs[i]) === "." && /\.$/.test(T(runs[i - 1]))) { odd++; return p.replace(runs[i], ""); }
    }
    return p;
  });
  body = body.replace(PARA, (p) => {
    const t = T(p).trim(); if (t.length > 40 && t === lastT) { odd++; return ""; } if (t) lastT = t; return p; });
  // a Learning Activity title ends without a full stop, as most of them already do
  body = body.replace(PARA, (p) => {
    if (!/^LEARNING ACTIVITY \d+\s*:/.test(T(p).trim()) || !/\.\s*$/.test(T(p))) return p;
    const runs = p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || [];
    const last = [...runs].reverse().find((r) => /\S/.test(r.replace(/<[^>]+>/g, "")));
    odd++; return p.replace(last, last.replace(/\.(\s*)<\/w:t>$/, "$1</w:t>"));
  });
  // A bullet glued inside its neighbour ("Using polite communication. • Following service
  // standards.", Sub-topic 3.3.1 Exercise 2): the cut above splits it off, but as a plain
  // line still carrying a typed "•". It is the next item of the same list.
  const pPrOf = (p) => (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
  const stripLead = (p, re) => { let done = false; return p.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (m, a, t, c) => {
    if (done) return m; if (!t.trim()) return a + c; done = true; return a + t.replace(re, "") + c; }); };
  const withPPr = (p, pp) => (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(p) ? p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, pp) : p.replace(/^(<w:p(?=[\s>])[^>]*>)/, `$1${pp}`));
  let prevP = "";
  body = body.replace(PARA, (p) => {
    let out = p;
    if (/^•\s*\S/.test(T(p).trim()) && /<w:numPr>/.test(prevP) && !/<w:numPr>/.test(p)) { out = withPPr(stripLead(p, /^\s*•\s*/), pPrOf(prevP)); odd++; }
    prevP = out; return out;
  });
  // "a) Wakumelo uses a lipstick…" (Sub-topic 3.4.1 Learning Activity 1) is the first of
  // four scenarios; she typed its letter, and the other three are Word's own a) b) c), so
  // the list printed a) a) b) c). The typed letter goes and the line joins their list.
  // Four more lists open the same way (3.1.2 LA2, 3.3.1 LA1, 3.3.4 LA3, 3.4.2 LA3), where
  // the typed "a)" sat flush left of its siblings' hanging letters.
  // The PDF-to-Word conversion gave four of those lists a start of "b" to follow the typed
  // letter, so once that line joins them they must count from "a" again (patched in
  // numbering.xml below, for these lists only).
  // (each paragraph is checked against the one after it, so the pair is never missed by
  // falling across two matches)
  const joinedLists = new Set();
  body = body.replace(/<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*<\/w:p>(?=(<w:p(?=[\s>])[^>]*>(?:(?!<\/w:p>)[\s\S])*<\/w:p>)?)/g, (a, b = "") => {
    // (a lead-in ending in a colon — "a) Effects on the guest may include:" — heads the
    // bulleted list after it, and stays as typed)
    if (!/^a\)\s+\S/.test(T(a).trim()) || /:\s*$/.test(T(a)) || /<w:numPr>/.test(a) || !/<w:numPr>/.test(b) || /^a\)/.test(T(b).trim())) return a;
    odd++; log("   a) joined to its list:", T(a).trim().slice(0, 50), "| next:", T(b).trim().slice(0, 40));
    const nid = (b.match(/<w:numId w:val="(\d+)"/) || [])[1]; if (nid) joinedLists.add(nid);
    return withPPr(stripLead(a, /^\s*a\)\s*/), pPrOf(b));
  });
  // a paragraph holding nothing but a full stop (end of Sub-topic 3.3.6 Exercise 10)
  body = body.replace(PARA, (p) => (T(p).trim() === "." ? (odd++, "") : p));
  // Topic 3.1 heads its opening "INTRODUCTION" in capitals; Topics 3.2-3.8 all write
  // "Introduction". The front-matter INTRODUCTION is a different (Heading 2) section.
  body = body.replace(PARA, (p) => (T(p).trim() === "INTRODUCTION" && !/<w:pStyle w:val="Heading[12]"\/>/.test(p)
    ? (odd++, p.replace(/(<w:t(?:\s[^>]*)?>)INTRODUCTION/, "$1Introduction")) : p));
  // the box label "Tips" is bold and upright in every box but one (Sub-topic 3.8.1
  // Learning Activity 1, italic and not bold)
  body = body.replace(PARA, (p) => {
    if (T(p).trim() !== "Tips" || /<w:b\/>/.test(p)) return p;
    odd++; return p.replace(/<w:i\/>|<w:iCs\/>/g, "").replace(/<w:rPr>/g, "<w:rPr><w:b/>");
  });
  // Sub-topic 3.1.1 writes "Expected Standard:" with a colon (a field label, set in
  // small capitals); the other twenty sub-topics write the sub-head without one
  body = body.replace(PARA, (p) => (T(p).trim() === "Expected Standard:"
    ? (odd++, p.replace(/(Standard)\s*:(\s*<\/w:t>)/, "$1$2").replace(/<w:t(?:\s[^>]*)?>\s*:\s*<\/w:t>/, "<w:t></w:t>")) : p));
  log("odds and ends:", odd);

  if (joinedLists.size) {
    let nx = await z.file("word/numbering.xml").async("string"), restarted = 0;
    for (const id of joinedLists) {
      const abs = (nx.match(new RegExp(`<w:num w:numId="${id}"[^>]*>\\s*<w:abstractNumId w:val="(\\d+)"`)) || [])[1];
      if (!abs) continue;
      nx = nx.replace(new RegExp(`(<w:abstractNum [^>]*w:abstractNumId="${abs}"[^>]*>(?:(?!</w:abstractNum>)[\\s\\S])*?<w:lvl w:ilvl="0"[^>]*>\\s*<w:start w:val=")2(")`), (m, a, c) => (restarted++, `${a}1${c}`));
    }
    z.file("word/numbering.xml", nx);
    log("   lists restarted at a):", restarted);
  }
  z.file("word/document.xml", head + body + tail);
  fs.writeFileSync(OUT, await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  log("written", OUT);
});
