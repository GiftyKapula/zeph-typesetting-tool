// Reads a Microsoft Word .docx and converts it into the SEMANTIC block format
// the typesetter understands. Crucially, it does not just dump tables as grids:
// it RECOGNISES the book's house-style structures — Learning Activity / Exercise
// / Key Points / Did You Know boxes (stored as single-cell shaded tables), real
// data tables, figures + captions, section headings and labels — so the typeset
// output keeps the book's structure and spacing instead of flattening it.
//
// Extraction uses JSZip (a .docx is a zip), so it runs the same from PowerShell
// or bash with no external tools. The XML is parsed with focused regex.
const fs = require("fs");
const path = require("path");
const os = require("os");
const JSZip = require("jszip");
const { ommlToTypst } = require("./omml.js");

// "SUB-TOPIC N.N.N" (a hand-typed sub-topic heading) written with any separator the
// author might reach for between SUB and TOPIC — hyphen, en dash, em dash, plain space,
// or none — and with the number glued straight on ("Sub-Topic1.1.2") or spaced out. Kept
// as one shared pattern so every recognition site treats the manuscript's inconsistent
// spelling identically instead of drifting out of sync heading-by-heading.
const SUBTOPIC_RE = /^SUB[-\s‐-―]*TOPIC\s*[\d.]+\b/i;
// A numbered SECTION heading of any kind — TOPIC / UNIT / CHAPTER / the hand-typed
// sub-topic (any separator, see SUBTOPIC_RE) — followed by its number, with or without a
// space before the digits (manuscripts sometimes glue them, "Topic1.1.2"). Used wherever
// a following block must be recognised as "the next section starts here".
const SECTION_RE = /^(TOPIC|UNIT|CHAPTER|SUB[-\s‐-―]*TOPIC)\s*[\d.]/i;

const decode = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, "&");

// True pixel dimensions of a PNG/JPEG from its bytes. Word's on-page <wp:extent>
// often doesn't match the real image aspect, so we read the file itself to know
// whether a picture is actually portrait/tall (and must be height-capped).
function imageSize(file) {
  try {
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(26);
    fs.readSync(fd, head, 0, 26, 0);
    if (head[0] === 0x89 && head[1] === 0x50) { // PNG
      fs.closeSync(fd);
      return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
    }
    if (head[0] === 0xFF && head[1] === 0xD8) { // JPEG: scan SOF markers
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, 1 << 20));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xFF) { o++; continue; }
        const m = buf[o + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
        }
        if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7)) { o += 2; continue; }
        o += 2 + buf.readUInt16BE(o + 2);
      }
      return null;
    }
    fs.closeSync(fd);
  } catch (e) { /* unreadable -> fall back to docx extent */ }
  return null;
}

// Recognise a box by the TITLE TEXT in its first cell. This is book-agnostic:
// different books use different fill colours (and sometimes inconsistent ones),
// but the leading label is reliable. Fill colour is only a secondary hint.
// Labels include local-language equivalents (Lunda: Zhakwila atudizi = Learning
// Activity, Mudimu = Exercise) — add a book's labels here as new books arrive.
function boxKindFromTitle(t) {
  const s = t.replace(/^\s+/, "");
  // Labels in English + Zambian local languages (see local-language-glossary).
  // Order matters: multi-word/specific labels before bare ones (e.g. Kaonde
  // "Mwingilo wakuuba" = activity must beat "Mwingilo" = exercise).
  // --- Learning Activity --- ("LEARNING ACTIVITY" tested without a trailing \b so a
  // glued number like "LEARNING ACTIVITY23" (author typo) is still recognised as an
  // activity box rather than falling through to a raw table).
  if (/^LEARNING\s+ACTIVIT/i.test(s)) return "activity";   // ACTIVITY or the plural ACTIVITIES
  if (/^(Ifyakucita|Mwingilo wakuuba|Nchito|Musebezi|Vyakulinga|Zhakwila(\s+atudizi)?|Cakucita)\b/i.test(s)) return "activity";
  // --- End-of-topic / unit Assessment ---
  if (/^(Ukweshiwa|Kupwa kwa mutwe|Mayeso|Tatubo|Mukanga|Esekelo|Kweseka|Musunko)\b/i.test(s)) return "assessment";
  if (/ASSESSMENT/i.test(s)) return "assessment";
  // --- Exercise --- (tolerate the common "EXRCISE"/"EXCERCISE" misspellings so a
  // typo'd title still gets the styled, numbered exercise box instead of a raw table)
  // "EXERCISE 9" (number, possibly glued) OR a bare "EXERCISE" whose number the author
  // dropped — recognised only when followed by a number, colon, line break or end so the
  // glossary definition "Exercise – Moving your body…" is NOT swept up as a box.
  // Plural "EXERCISES 1 - 4" (a range of several numbered questions under one box) is
  // as common as the singular "EXERCISE 9" in some books' house style — accept an
  // optional trailing "S" before the number/colon/newline/end.
  if (/^(EXE?RCISES?|EXCERCISES?)\s*(\d|:|\n|$)/i.test(s) || /^ACTIVITY\s*\d/i.test(s)) return "exercise";
  if (/^(U?Mulimo|Mwingilo|Zocitila|Zoc[hk]?ita|Zakueza|Mudimu)\b/i.test(s)) return "exercise";
  // --- Key points / Did you know ---
  if (/^(KEY POINTS|Key Points to Remember|Mau ofunika kudziwa)/i.test(s)) return "keypoints";
  if (/^DID YOU KNOW/i.test(s)) return "fact";
  return null;
}
// Fallback fill -> kind for books that use the PE house style.
const BOX_FILL = { DEEAF6: "activity", F3F8EE: "exercise", FFF6DA: "keypoints", E4F3F5: "fact" };
const NAVY = "1F3864";

// Some manuscripts place a WHOLE Learning Activity / Exercise / Assessment box inside a
// floating text box (a drawing "canvas" shape, not a picture) instead of the normal
// document flow — a common alternative to the usual single-cell shaded TABLE. The
// ordinary text-box handling strips every text-only box to recover stray on-diagram
// labels, which would otherwise silently DELETE the entire box (title + every question)
// since its host paragraph carries no visible text of its own outside the shape.
//
// Recognise and rescue those boxes here, BEFORE the general stripping runs: swap each
// one's `<w:drawing>` for a plain sentinel run ("@@BOXn@@") so it rides through the
// normal paragraph pipeline exactly like any other text (heading detection, list
// merging, …), and record its parsed title/body/parts in `out` so a later pass
// (resolveTextboxBoxes) can replace the sentinel with the real block once the block
// array exists. Returns { rawDoc } with the swap applied; boxes are pushed onto `out`.
function extractTextboxBoxes(rawDoc, out, numMap) {
  let result = "", last = 0;
  const dre = /<w:drawing\b[\s\S]*?<\/w:drawing>/g;
  let m;
  while ((m = dre.exec(rawDoc))) {
    const d = m[0];
    if (/<a:blip\b/.test(d)) continue;                         // a real picture — leave it alone
    const tbm = d.match(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/);
    if (!tbm) continue;
    // A box's floating shape can carry a NESTED TABLE (a reference table inside a
    // Learning Activity/Exercise/Assessment) — mask it out first (maskTables), like the
    // main body parser does, so the naive <w:p> scan below never grabs a stray cell
    // paragraph as if it were top-level box content, and the table itself survives as
    // its own ordered item instead of being silently dropped.
    const { masked: tbMasked, tables: tbTables } = maskTables(tbm[1]);
    const paras = [...tbMasked.matchAll(/<w:p\b[\s\S]*?<\/w:p>|@@TBL\d+@@/g)]
      .map((p) => p[0].startsWith("@@TBL")
        ? { isTable: true, rows: parseTableRows(tbTables[+p[0].match(/\d+/)[0]]) }
        : { xml: p[0], segs: paraSegs(p[0]) })
      .filter((p) => p.isTable || p.segs.some((s) => (s.t || "").trim()));
    if (!paras.length || paras[0].isTable) continue;   // a title-less box (table first) — leave it
    const title = plainOf(paras[0].segs).trim();
    const kind = boxKindFromTitle(title);
    if (kind !== "activity" && kind !== "exercise" && kind !== "assessment") continue;   // some other shape/graphic — leave it
    // Number the box's own questions/steps from the manuscript's REAL Word-list format
    // (roman / letter / decimal — whatever the author actually chose), not a hard-coded
    // "top=decimal, sub=letter" guess: some exercises number their top level with roman
    // numerals ("i.", "ii.") and only their sub-parts with letters. `counts` is fresh per
    // box (Word's own numbering restarts each list).
    //
    // Depth can't be read from ilvl alone: a manuscript sometimes gives its top list and
    // its sub list SEPARATE numId's that both sit at ilvl 0 (two independent lists, not
    // one nested list) — e.g. "i./ii." as numId 160 ilvl 0, "a)/b)/c)…" as numId 161 ilvl
    // 0. The reliable signal is the list's FORMAT: whichever format the box's FIRST
    // numbered item uses is the top level; a DIFFERENT format appearing after it is a
    // sub-level (letters are sub, and stay sub even if ilvl is otherwise identical).
    const counts = {};
    const ilvlOf = (p) => +((p.xml.match(/<w:ilvl\s+w:val="(\d+)"/) || [])[1] || 0);
    const numIdOf = (p) => (p.xml.match(/<w:numId\s+w:val="(\d+)"/) || [])[1];
    const numbered = (p) => /<w:numPr>/.test(p.xml);
    const fmtOf = (p) => { const numId = numIdOf(p); return numId ? ((levelInfo(numMap, numId, ilvlOf(p)) || {}).fmt || null) : null; };
    const rest = paras.slice(1);
    let topFmt = null;
    let auto = 0;   // fallback sequential counter when the numbering definition can't be found
    const nextMarker = (p) => {
      const numId = numIdOf(p), ilvl = ilvlOf(p), fmt = fmtOf(p);
      if (topFmt == null && fmt != null) topFmt = fmt;
      const depth = fmt != null && topFmt != null && fmt !== topFmt ? 1 : 0;
      const marker = numId ? computeListMarker(numMap, counts, numId, ilvl) : null;
      return { marker: marker || `${(auto += 1)}.`, depth };
    };
    const body = [], parts = [];
    for (const p of rest) {
      if (p.isTable) {
        if (kind === "activity") body.push({ t: "table", rows: p.rows });
        else parts.push({ kind: "table", rows: p.rows });
        continue;
      }
      if (kind === "activity") {
        if (numbered(p)) { const { marker } = nextMarker(p); body.push({ t: "listitem", segs: p.segs, marker }); }
        else body.push({ t: "para", segs: p.segs });
      } else {
        const q = plainOf(p.segs);
        if (numbered(p)) { const { marker, depth } = nextMarker(p); parts.push({ kind: "q", q, qseg: p.segs, a: "", aseg: [], marker, depth }); }
        else parts.push({ kind: "lead", q, qseg: p.segs, indent: false });
      }
    }
    const idx = out.length;
    out.push(kind === "activity" ? { kind, title, body } : { kind, title, parts });
    // Give the sentinel its OWN paragraph — close whatever paragraph is open, emit a
    // minimal <w:p> holding just the sentinel run, then reopen a fresh paragraph for
    // anything that follows. A box's host paragraph often ALSO carries real body text
    // sharing the very same <w:p> as the drawing (e.g. "…</drawing>The food pyramid
    // helps…"); leaving the sentinel run in that same paragraph risks it being merged
    // with the next run's text by paraSegs' run-joining pass. A dedicated paragraph
    // sidesteps that entirely — no run-merge, no dependence on differing styles.
    result += rawDoc.slice(last, m.index) + `</w:p><w:p><w:r><w:t>@@BOX${idx}@@</w:t></w:r></w:p><w:p>`;
    last = m.index + d.length;
  }
  result += rawDoc.slice(last);
  return { rawDoc: result };
}
// Swap each `@@BOXn@@` sentinel (planted by extractTextboxBoxes) for the real
// activity/exercise/assessment block it stands for. Runs once the flat top-level `blocks`
// array exists, so the box lands exactly where its text box was anchored in the manuscript.
// A sentinel can appear two ways: as a WHOLE block's only content (its host paragraph had
// no other text), or as one SEG among others in a paragraph that also carries real body
// text sharing the same host paragraph as the box — split those apart instead of losing
// the surrounding prose.
function resolveTextboxBoxes(blocks, tbBoxes) {
  if (!tbBoxes.length) return blocks;
  const SENT = /^@@BOX(\d+)@@$/;
  const boxBlock = (idx) => {
    const box = tbBoxes[idx];
    return box.kind === "activity" ? { t: "activity", title: box.title, body: box.body }
      : box.kind === "exercise" ? { t: "exercise", heading: box.title, parts: box.parts }
      : { t: "assessment", title: box.title, intro: [], parts: box.parts, extra: [] };
  };
  const out = [];
  for (const b of blocks) {
    // whole-block sentinel: a head/label (or a segs-bearing block) whose ENTIRE text is
    // exactly the sentinel — swap it outright.
    const whole = (b.t === "head" || b.t === "label") ? (b.text || "").trim()
      : Array.isArray(b.segs) ? plainOf(b.segs).trim() : null;
    const wm = whole != null && whole.match(SENT);
    if (wm) { out.push(boxBlock(+wm[1])); continue; }
    // partial: a sentinel seg sharing a paragraph with real text — pull each sentinel seg
    // out (in order), emitting its box, and keep the remaining segs as the same paragraph.
    if (Array.isArray(b.segs) && b.segs.some((s) => !s.m && SENT.test((s.t || "").trim()))) {
      let rest = [];
      for (const s of b.segs) {
        const sm = !s.m && SENT.test((s.t || "").trim());
        if (sm) { if (rest.length) { out.push({ ...b, segs: rest }); rest = []; } out.push(boxBlock(+(s.t.trim().match(SENT)[1]))); }
        else rest.push(s);
      }
      if (rest.length) out.push({ ...b, segs: rest });
      continue;
    }
    out.push(b);
  }
  return out;
}

// Map style ids -> heading level using styles.xml (name "heading N" or outlineLvl).
function headingMap(stylesXml) {
  const map = {};
  if (!stylesXml) return map;
  const re = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
  let m;
  while ((m = re.exec(stylesXml))) {
    const id = m[1], body = m[2];
    const name = (body.match(/<w:name\s+w:val="([^"]+)"/) || [])[1] || "";
    const out = (body.match(/<w:outlineLvl\s+w:val="(\d+)"/) || [])[1];
    let lvl = null;
    const nm = name.toLowerCase();
    if (/^heading\s*\d/.test(nm)) lvl = parseInt(nm.match(/(\d)/)[1], 10);
    else if (/heading\s*\d/.test(id.toLowerCase())) lvl = parseInt(id.match(/(\d)/)[1], 10);
    else if (out != null) lvl = parseInt(out, 10) + 1;
    if (lvl) map[id] = Math.min(lvl, 3);
  }
  return map;
}

// ---- list numbering (preserve the writer's a/b/c, 1/2/3, i/ii markers) -------
// Parse word/numbering.xml into { abstract: {absId: {ilvl:{fmt,lvlText,start}}},
// numToAbs: {numId: absId} } so we can render a list item's real marker instead
// of forcing a bullet.
function parseNumbering(xml) {
  const out = { abstract: {}, numToAbs: {} };
  if (!xml) return out;
  let am;
  const absRe = /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g;
  while ((am = absRe.exec(xml))) {
    const levels = {};
    let lm;
    const lvlRe = /<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
    while ((lm = lvlRe.exec(am[2]))) {
      const lb = lm[2];
      levels[+lm[1]] = {
        fmt: (lb.match(/<w:numFmt\s+w:val="([^"]+)"/) || [])[1] || "decimal",
        lvlText: decode((lb.match(/<w:lvlText\s+w:val="([^"]*)"/) || [])[1] || ("%" + (+lm[1] + 1) + ".")),
        start: parseInt((lb.match(/<w:start\s+w:val="(\d+)"/) || [])[1] || "1", 10),
      };
    }
    out.abstract[am[1]] = levels;
  }
  let nm;
  const numRe = /<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g;
  while ((nm = numRe.exec(xml))) out.numToAbs[nm[1]] = (nm[2].match(/<w:abstractNumId\s+w:val="(\d+)"/) || [])[1];
  return out;
}
const levelInfo = (numMap, numId, ilvl) => ((numMap.abstract[numMap.numToAbs[numId]] || {})[ilvl] || null);
function toLetter(n) { let s = ""; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
function toRoman(n) { const t = [[1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]]; let s = ""; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s; }
function formatNum(n, fmt) {
  if (fmt === "lowerLetter") return toLetter(n);
  if (fmt === "upperLetter") return toLetter(n).toUpperCase();
  if (fmt === "lowerRoman") return toRoman(n);
  if (fmt === "upperRoman") return toRoman(n).toUpperCase();
  return String(n); // decimal / default
}
// Compute a Word-list paragraph's real marker ("a)", "1.", "i.", "•") from the
// manuscript's own numbering definition, given a per-numId `counts` object the caller
// keeps across calls (so a list's counter PERSISTS through interruptions — e.g. items
// 1,2,3 broken by a sub-list a,b,c then resuming at 4 — restarting only when the numId
// itself changes). Returns null when numId has no definition (caller should fall back to
// sequential auto-numbering). Shared by extractTextboxBoxes (fresh counts per text box)
// and the main importer's listMarker closure.
function computeListMarker(numMap, counts, numId, ilvl) {
  const info = numId ? levelInfo(numMap, numId, ilvl) : null;
  if (!info) return null;
  const c = counts[numId] || (counts[numId] = []);
  c[ilvl] = (c[ilvl] == null ? info.start - 1 : c[ilvl]) + 1;
  for (let l = ilvl + 1; l < c.length; l++) c[l] = null;
  if (info.fmt === "bullet") return "•";
  const mk = info.lvlText.replace(/%(\d+)/g, (_, k) => {
    const li = +k - 1, linfo = levelInfo(numMap, numId, li) || info;
    return formatNum(c[li] == null ? linfo.start : c[li], linfo.fmt);
  }).trim();
  return mk || (formatNum(c[ilvl], info.fmt) + ".");
}

// rId -> media filename, from word/_rels/document.xml.rels
function relsMap(relsXml) {
  const map = {};
  if (!relsXml) return map;
  const re = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = re.exec(relsXml))) map[m[1]] = m[2].replace(/^\.\.\//, "").replace(/^\//, "");
  return map;
}

// Mask <w:tbl>…</w:tbl> regions (depth-tracked) so paragraph splitting doesn't
// grab table-internal paragraphs. Returns {masked, tables[]}.
function maskTables(body) {
  const tables = [];
  let out = "", i = 0;
  while (i < body.length) {
    const tbl = body.indexOf("<w:tbl>", i);
    if (tbl < 0) { out += body.slice(i); break; }
    out += body.slice(i, tbl);
    let depth = 0, j = tbl;
    while (j < body.length) {
      if (body.startsWith("<w:tbl>", j)) { depth++; j += 7; }
      else if (body.startsWith("</w:tbl>", j)) { depth--; j += 8; if (depth === 0) break; }
      else j++;
    }
    out += `@@TBL${tables.length}@@`;
    tables.push(body.slice(tbl, j));
    i = j;
  }
  return { masked: out, tables };
}

// Parse a paragraph into runs, preserving bold / italic / colour per run.
// Returns segments [{t, b, it, c}] where c is a 6-hex colour or null.
function paraSegs(pXml) {
  const segs = [];
  // Walk the paragraph's runs AND its Office-Math equations in document order.
  // An <m:oMath> (inline) / <m:oMathPara> (display) becomes a math segment whose
  // text is Typst math source; everything else is a normal <w:r> text run.
  const tokRe = /<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let r;
  while ((r = tokRe.exec(pXml))) {
    const chunk = r[0];
    if (chunk.startsWith("<m:oMath")) {
      const display = chunk.startsWith("<m:oMathPara");
      if (display) {
        // A display paragraph may hold several <m:oMath> lines — the author pressed
        // Shift+Enter inside the equation editor (encoded as <w:br/> between the
        // oMath children). When there are several, they are the steps of one working
        // (e.g. "2x + 30° = 30°", "2x = 0°", "x = 0°"), so render them as ONE aligned
        // block — each line aligned at its first relational sign so the "=" signs sit
        // under each other and the reader can follow the steps (the author's
        // "alignment needed / not arranged" comments). A single line stays centred.
        const lines = [...chunk.matchAll(/<m:oMath\b[\s\S]*?<\/m:oMath>/g)].map((x) => ommlToTypst(x[0])).filter(Boolean);
        const emit = lines.length ? lines : [ommlToTypst(chunk)].filter(Boolean);
        if (emit.length > 1) {
          segs.push({ t: stackAligned(emit), m: true, display: true, b: false, it: false, c: null });
        } else {
          for (const ln of emit) segs.push({ t: ln, m: true, display: true, b: false, it: false, c: null });
        }
        continue;
      }
      const math = ommlToTypst(chunk);
      if (math) {
        // Word tucks the space between an inline equation and the next word INSIDE
        // the equation, where Typst trims it away ("x=9 and" -> "x=9and"). Re-emit
        // a leading/trailing space run so the flow keeps its word spacing.
        const raw = [...chunk.matchAll(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/g)].map((x) => x[1]).join("");
        if (/^\s/.test(raw)) segs.push({ t: " ", b: false, it: false, c: null });
        segs.push({ t: math, m: true, display: false, b: false, it: false, c: null });
        if (/\s$/.test(raw)) segs.push({ t: " ", b: false, it: false, c: null });
      } else if (/<w:br\b/.test(chunk)) {
        // an <m:oMath> that holds ONLY a soft line break (the writer pressed
        // Shift+Enter mid-line inside the equation editor) — keep it as a newline
        // so a glued following line / next question can be split out downstream.
        segs.push({ t: "\n", b: false, it: false, c: null });
      }
      continue;
    }
    const run = chunk;
    // Assemble the run text preserving the ORDER of soft line breaks (<w:br/>)
    // relative to the text. A break can sit BEFORE or between <w:t> nodes, not
    // only after (e.g. a signature run "<w:br/>Board Chairperson"). The old code
    // counted all breaks and appended them to the end, which moved a leading
    // break to the wrong place and glued two lines together.
    let tm = "";
    for (const mm of run.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b(?![^>]*w:type)[^>]*\/?>/g)) {
      tm += mm[1] !== undefined ? mm[1] : "\n";
    }
    const tabs = (run.match(/<w:tab\b/g) || []).length;
    if (!tm && !tabs) continue;
    let t = decode(tm)
      .replace(/[​-‍﻿]/g, "")   // drop zero-width junk (breaks ^label matching)
      .replace(/ *— */g, " - ");     // em dash -> spaced hyphen (house style)
    if (tabs) t = t + " ".repeat(tabs);                // tabs -> spaces (no column artefacts)
    const rpr = (run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || "";
    const b = /<w:b\b(?!Cs)/.test(rpr) && !/<w:b\b[^>]*w:val="(0|false)"/.test(rpr);
    const it = /<w:i\b(?!Cs)/.test(rpr) && !/<w:i\b[^>]*w:val="(0|false)"/.test(rpr);
    // Author underline (<w:u w:val="single"/>, etc.) — preserved on BODY text only:
    // headings/banners/box-titles emit as plain strings (S(b.text)/S(b.title)), so a
    // structural label the author underlined in Word (e.g. "Exercise") never carries
    // the decoration, while an underlined target word/grapheme in a word list does.
    const u = /<w:u\b/.test(rpr) && !/<w:u\b[^>]*w:val="none"/.test(rpr);
    let c = (rpr.match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/) || [])[1] || null;
    if (c) c = c.toUpperCase();
    if (c === "auto" || c === "000000") c = null;
    // Super/subscript runs (<w:vertAlign>). Word sets these for exponents (2n²),
    // chemical formulas (H₂O, CaCO₃) and ionic charges (Ca²⁺). The importer would
    // otherwise flatten them to inline text ("2n2") — wrong in any science book.
    // Emit them as inline math segments (an empty base carrying the script), so the
    // seg renderer typesets a true raised/lowered mark right after the preceding
    // character. The scripted content is upright (quoted) — digits, +/- and letters
    // read as chemistry, not italic algebra.
    const va = (rpr.match(/<w:vertAlign\s+w:val="(superscript|subscript)"/) || [])[1];
    if (va && t.replace(/\s/g, "")) {
      const trail = /\s$/.test(t) ? " " : "";
      const lead = /^\s/.test(t) ? " " : "";
      const inner = t.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      if (lead) segs.push({ t: " ", b: false, it: false, c: null });
      segs.push({ t: (va === "superscript" ? '""^("' : '""_("') + inner + '")', m: true, display: false, b: false, it: false, c: null });
      if (trail) segs.push({ t: " ", b: false, it: false, c: null });
      continue;
    }
    // (soft line breaks are already interleaved into `t` above, in source order)
    if (t) segs.push({ t, b, it, c, ...(u ? { u: true } : {}) });
  }
  // Merge adjacent TEXT runs with identical formatting (Word often splits ONE
  // styled word across runs), then restore hyphens dropped from RUN-TOGETHER
  // compound words. Math segments are never merged or text-normalised.
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && !last.m && !s.m && last.b === s.b && last.it === s.it && last.c === s.c && !!last.u === !!s.u) last.t += s.t;
    else merged.push({ ...s });
  }
  // Drop fake indentation: a paragraph that a writer nudged rightward with a run of
  // literal spaces before its (inline) equation — e.g. a worked step "        x = …".
  // Real indentation lives in paragraph properties, never leading spaces, so a
  // whitespace-only opening run before a math seg is always cosmetic; strip it so the
  // step sits at the left margin and lines up with the steps above and below it.
  while (merged.length >= 2 && !merged[0].m && /^\s*$/.test(merged[0].t) && merged[1].m) merged.shift();
  for (const s of merged) {
    if (s.m) continue;
    s.t = s.t
      .replace(/\bstepbystep\b/gi, "step-by-step")
      .replace(/\blearnercentred\b/gi, "learner-centred")
      .replace(/\bproblemsolving\b/gi, "problem-solving")
      .replace(/\bcompetencybased\b/gi, "Competency-Based")
      .replace(/\bendoftopic\b/gi, "End-of-Topic")
      // House style is British spelling: convert the -ize/-ise verb family to -ise
      // for a curated set of stems (so "size", "maize", "prize", "citizen" are never
      // touched). Only the z is swapped, so the word's own casing is preserved.
      .replace(/\b(summar|special|emphas|organ|recogn|visual|minim|stabil|crystall|synthes|immobil|fertil|general|categor|character|util|standard|maxim|coloni|memor)i(z)(e|es|ed|ing|ation|able|ably)\b/gi,
        (_, stem, z, suf) => stem + "i" + (z === "Z" ? "S" : "s") + suf)
      // British -our for a curated set (colour, behaviour, flavour, odour, vapour,
      // favour…). "labo(u)r" is left out so "laboratory" is never touched.
      .replace(/\b(colo|behavio|flavo|odo|vapo|favo|humo|rigo|vigo)r([a-z]*)\b/gi, "$1ur$2");
  }
  return merged;
}
const plainOf = (segs) => segs.map((s) => s.t).join("").replace(/\n/g, " ");

// Insert a Typst math alignment point ("&") before the FIRST relational operator in
// an equation's Typst source, so a stack of steps lines up under the equals sign.
// Leaves an expression with no relation untouched (it just centres normally).
// A CONTINUATION line that begins with the relation itself ("= frac(144+225…",
// "=0.125") must also get an alignment point right before that leading "=", or it
// falls into column 1 and its "=" won't sit under the "=" of the line above. So we
// handle the leading-relation case explicitly (no space before the operator).
function alignAtRelation(src) {
  const s = src.replace(/^\s+/, "");
  const lead = s.match(/^(<=|>=|!=|=|≈|<|>)/);
  if (lead) return "& " + s;
  const m = s.match(/\s(=|equiv|<=|>=|!=|approx|≈|<|>)\s/);
  if (!m) return s;
  return s.slice(0, m.index) + " &" + s.slice(m.index + 1);
}

// Give a single equation line exactly ONE alignment point, right before its first
// relational operator. It first STRIPS any alignment marks already in the source —
// the OMML sometimes carries its own "&" (from an author tab) and, layered with an
// earlier alignAtRelation pass, a line can end up with "& &" (relation in column 3)
// while its continuation lines have a single "&" (relation in column 2), so the "="
// signs never line up. Normalising every line to one column fixes that.
function relAlign(line) {
  const s = String(line).replace(/&/g, " ").replace(/\s+/g, " ").trim();
  const m = s.match(/(<=|>=|!=|=|≈|<|>|equiv|approx)/);
  if (!m) return s;
  if (m.index === 0) return "& " + s;
  return s.slice(0, m.index).trim() + " & " + s.slice(m.index);
}

// Build ONE aligned display equation from several step lines. Any input line that is
// itself already a multi-line stack (contains " \\ ") is flattened first, so a
// previously-merged block re-aligns cleanly when it is folded together with more
// steps. Each resulting line is normalised to a single alignment column at its first
// relation, then the lines are joined with Typst's math line break.
function stackAligned(lines) {
  const flat = [];
  for (const ln of lines) for (const part of String(ln).split(/\s*\\\\\s*/)) if (part.trim()) flat.push(part);
  if (flat.length <= 1) return flat.length ? flat[0].replace(/&/g, " ").replace(/\s+/g, " ").trim() : "";
  return flat.map(relAlign).join(" \\ ");
}

// ---- depth-aware table helpers (handle tables nested inside cells) --------
// Inner contents of every TOP-LEVEL <w:TAG …>…</w:TAG> in xml (same-tag nesting
// is kept inside, not split), so nested tables don't corrupt row/cell parsing.
function topLevelEls(xml, tag) {
  const startRe = new RegExp(`^<w:${tag}(?:\\s[^>]*)?>`);
  const out = [];
  let i = 0, depth = 0, start = -1, openLen = 0;
  const close = `</w:${tag}>`;
  while (i < xml.length) {
    if (xml[i] === "<") {
      // Match against the whole opening tag (up to its closing ">"), not a fixed
      // window — Word tags can carry many rsid attributes and run well past 80
      // chars, which previously made long <w:tr …>/<w:tc …> tags go undetected
      // and silently dropped the entire table.
      const gt = xml.indexOf(">", i);
      const m = (gt >= 0 ? xml.slice(i, gt + 1) : xml.slice(i, i + 200)).match(startRe);
      if (m && !xml.startsWith(`</w:${tag}`, i)) {
        if (depth === 0) { start = i; openLen = m[0].length; }
        depth++; i += m[0].length; continue;
      }
      if (xml.startsWith(close, i)) {
        depth--; i += close.length;
        if (depth === 0 && start >= 0) out.push(xml.slice(start + openLen, i - close.length));
        continue;
      }
    }
    i++;
  }
  return out;
}

// Rows of cells; each cell = { fill, xml }. Depth-aware.
function cellsOf(tblXml) {
  const rows = [];
  for (const rowInner of topLevelEls(tblXml, "tr")) {
    const cells = topLevelEls(rowInner, "tc").map((xml) => ({
      fill: ((xml.match(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1] || "").toUpperCase(),
      xml,
    }));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// Resolver for images inside a paragraph; set per-import (needs rels/tmp).
let imgResolve = () => [];
// Resolver for a paragraph's list level + real marker; set per-import (needs the
// document's numbering). Returns { numId, lvl, marker } or null for non-list paras.
let listResolve = () => null;

// Ordered content of a cell: paragraphs, images AND nested tables, in order.
// Returns [{t:"para",…} | {t:"img",images} | {t:"table",rows}].
function cellBlocks(tcXml) {
  const { masked, tables } = maskTables(tcXml);
  const out = [];
  const parts = masked.match(/@@TBL\d+@@|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
  for (const part of parts) {
    if (part.startsWith("@@TBL")) {
      const rows = parseTableRows(tables[parseInt(part.match(/\d+/)[0], 10)]);
      if (rows.length) out.push({ t: "table", rows });
      continue;
    }
    const images = imgResolve(part);
    const segs = paraSegs(part);
    const plain = plainOf(segs).trim();
    const li = listResolve(part);
    const paraOf = () => ({ t: "para", segs, plain, isList: !!li || /^[••]/.test(plain),
      numId: li ? li.numId : null, lvl: li ? li.lvl : null, marker: li ? li.marker : null });
    if (images.length) {
      const imgBlk = { t: "img", images, plain };
      // A paragraph may carry an image PLUS real text (e.g. a numbered question
      // "Identify the parts … in the diagram below" that sits with its diagram).
      // Keep both: an inline "Figure N:" caption rides on the image, a lone
      // punctuation/letter anchor is dropped, otherwise the text is emitted as its
      // own block in run order so the question is never lost.
      if (plain && !/^fig(?:ure)?\.?\s*\d+\s*[:.]/i.test(plain)
          && !/^[.·•…\/\\|]{1,3}$/.test(plain) && !/^[A-Za-z]$/.test(plain)) {
        const imgFirst = part.search(/<a:blip\b/) < part.search(/<w:t\b/);
        if (imgFirst) { out.push(imgBlk); out.push(paraOf()); }
        else { out.push(paraOf()); out.push(imgBlk); }
      } else out.push(imgBlk);
    }
    else if (plain) out.push(paraOf());
  }
  return out;
}

// Paragraph-only view of a cell (for boxes that only need text lines).
const cellParas = (tcXml) => cellBlocks(tcXml).filter((b) => b.t === "para");
// Flat text of a cell, including nested-table text (nothing dropped).
const cellFlat = (b) => b.t === "table"
  ? b.rows.map((r) => r.map((c) => c.text).join(" · ")).join("  ") : (b.plain || "");
const cellText = (tcXml) => cellBlocks(tcXml).map(cellFlat).join(" ").trim();

// A rich table cell: its text AND every image it contains (both kept, so a
// "text on top of a picture" cell loses neither).
function cellRich(tcXml) {
  const bl = cellBlocks(tcXml);
  // Join the cell's paragraphs with newlines (not spaces) so a cell that lists
  // several items on separate lines (e.g. a matching activity's term column)
  // stacks them vertically instead of collapsing into one wrapped blob. NESTED
  // tables are pulled out into `subs` (rendered as real sub-tables) rather than
  // flattened into "·"-joined text, so a table-inside-a-table keeps its grid.
  const text = bl.filter((b) => b.t !== "table").map(cellFlat).join("\n").trim();
  const imgs = [];
  const subs = [];
  // rich segments so a cell's bold/italic/coloured runs (e.g. a bold category name
  // beside a plain description in the same table) render correctly — not just the
  // math case this used to be limited to, which silently flattened every other
  // formatted cell to plain text and lost the author's bold/italic emphasis.
  const segs = [];
  bl.forEach((b) => {
    if (b.t === "img") imgs.push(...b.images);
    else if (b.t === "table") subs.push(b.rows);
    else if (b.t === "para" && b.segs) {
      if (segs.length) segs.push({ t: "\n", b: false, it: false, c: null });
      for (const s of b.segs) segs.push(s);
    }
  });
  // Only worth carrying when a run is actually STYLED (bold/italic/coloured/math) —
  // an all-plain cell renders identically via `text`, so skip the richer path there.
  const rich = segs.some((s) => s.m || s.b || s.it || s.c) ? segs : null;
  const out = { text, imgs, segs: rich };
  if (subs.length) out.subs = subs;
  return out;
}

// Depth-aware rows of RICH cells ({text, img}) for a (possibly nested) table.
function parseTableRows(tblXml) {
  const rows = [];
  for (const rowInner of topLevelEls(tblXml, "tr")) {
    const cells = topLevelEls(rowInner, "tc").map(cellRich);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// Pair up "N. question" / "Possible answer: …" paragraphs into {q, a} items.
function pairQA(paras) {
  const items = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const qm = p.plain.match(/^\(?\d+[.)]\s*([\s\S]+)/);
    if (qm) {
      let q = qm[1].trim(), a = "", aseg;
      const qseg = segsFrom(p.segs, p.plain.length - qm[1].length);
      const nxt = paras[i + 1];
      if (nxt && /^possible answer\s*:/i.test(nxt.plain)) {
        a = nxt.plain.replace(/^possible answer\s*:\s*/i, "").trim();
        aseg = segsFrom(nxt.segs, nxt.plain.length - a.length - (nxt.plain.length - nxt.plain.trimEnd().length));
        i++;
      }
      items.push({ q, qseg, a, aseg });
    } else if (p.plain) {
      items.push({ q: p.plain, qseg: p.segs, a: "" });
    }
  }
  return items;
}

// Ordered questions + tables + images, preserving document order so a reference
// table or diagram stays directly under the question that mentions it.
// Returns parts: {kind:"q",q,a,marker,depth} | {kind:"lead",q} |
//                {kind:"table",rows} | {kind:"image",images}.
// Numbering: when the writer used real Word lists, each item keeps its OWN marker
// ("1.", "a)", "i.") and sub-lists are indented — so a question's follow-up parts
// stay under it instead of being renumbered into the main sequence. When there
// are no list markers at all, fall back to plain sequential numbering.
// Re-derive a marker for a local 1-based count `n`, in the FORMAT of the writer's
// template marker ("1." -> decimal+dot, "a)" -> lower-letter+paren, "i." -> roman).
function markerFor(n, template) {
  const suf = (String(template || "").match(/([.)])\s*$/) || [, "."])[1];
  const core = String(template || "").replace(/[.)]\s*$/, "").trim();
  let s;
  if (/^\d+$/.test(core)) s = String(n);
  else if (/^[IVXLCDM]+$/.test(core)) s = toRoman(n).toUpperCase();
  else if (/^[ivxlcdm]{2,}$/.test(core)) s = toRoman(n);
  else if (/^[A-Z]$/.test(core)) s = String.fromCharCode(64 + n);
  else s = toLetter(n);
  return s + suf;
}
// Segments starting at character offset n (a leading marker like "1." / "(a)"
// removed). Math segments are atomic and never split.
function segsFrom(segs, n) {
  if (!segs) return undefined;
  const out = [];
  for (const s of segs) {
    if (n <= 0) { out.push(s); continue; }
    if (s.m) { out.push(s); n = 0; continue; }
    if (s.t.length <= n) { n -= s.t.length; continue; }
    out.push({ ...s, t: s.t.slice(n) }); n = 0;
  }
  return out;
}
// Segments covering [start, end) of the concatenated plain text (plain-text only;
// callers must not pass segments containing math, which is atomic).
function segsSlice(segs, start, end) {
  if (!segs) return undefined;
  const out = [];
  let pos = 0;
  for (const s of segs) {
    const len = s.t.length;
    const a = Math.max(start, pos), b = Math.min(end, pos + len);
    if (a < b) out.push({ ...s, t: s.t.slice(a - pos, b - pos) });
    pos += len;
  }
  return out;
}

// Some manuscripts glue several literal sub-parts into ONE paragraph
// ("(a) Do X.(b) Do Y.(c) Do Z", optionally after a stem "In the model:(a)…").
// Split such a paragraph into one paragraph per part so each sub-question renders
// on its own line with its own marker. Only splits a clean, consecutive a/b/c…
// (or i/ii/iii…) sequence of substantial parts — never stray "(a)"s in prose.
function expandGluedSubparts(blocks) {
  const MARK = /\(([a-z]|[ivx]{2,4})\)/gi;
  const out = [];
  for (const b of blocks) {
    if (b.t !== "para" || !b.segs || b.segs.some((s) => s.m)) { out.push(b); continue; }
    const plain = b.plain != null ? b.plain : b.segs.map((s) => s.t).join("");
    const marks = [...plain.matchAll(MARK)];
    if (marks.length < 2) { out.push(b); continue; }
    // Grow the consecutive sub-sequence starting at the first "(a)"/"(i)".
    const seq = [];
    for (const m of marks) {
      const val = m[1].toLowerCase();
      if (seq.length === 0) { if (val === "a" || val === "i") seq.push({ idx: m.index }); else break; }
      else {
        const expectAlpha = String.fromCharCode(97 + seq.length), expectRoman = toRoman(seq.length + 1);
        if (val === expectAlpha || val === expectRoman) seq.push({ idx: m.index }); else break;
      }
    }
    const first = seq[0];
    const stemText = first ? plain.slice(0, first.idx).trim() : "";
    const okStem = stemText === "" || /[:.]$/.test(stemText);
    // each part must carry real content (guards against "options (a) and (b)")
    const partOk = seq.length >= 2 && seq.every((s, k) => {
      const end = k + 1 < seq.length ? seq[k + 1].idx : plain.length;
      return plain.slice(s.idx, end).replace(MARK, "").trim().length >= 10;
    });
    if (seq.length < 2 || !okStem || !partOk) { out.push(b); continue; }
    const ranges = [];
    if (stemText) ranges.push([0, first.idx]);
    for (let k = 0; k < seq.length; k++) ranges.push([seq[k].idx, k + 1 < seq.length ? seq[k + 1].idx : plain.length]);
    ranges.forEach(([s, e], k) => {
      const txt = plain.slice(s, e).replace(/\s+$/, "").trim();
      const np = { t: "para", segs: segsSlice(b.segs, s, e), plain: txt };
      // Only the first piece inherits the Word-list marker so the top-question /
      // new-question logic still fires; the rest are plain literal-sub paragraphs.
      if (k === 0) { if (b.marker) np.marker = b.marker; if (b.numId != null) np.numId = b.numId; if (b.lvl != null) np.lvl = b.lvl; }
      out.push(np);
    });
  }
  return out;
}

// A writer sometimes ends a question with a SOFT line break (Shift+Enter) and
// types the next numbered question right after it, so both sit in ONE paragraph
// (e.g. "…360°.\n8. Sketch the graph…"). Split such a paragraph at the line break
// that is immediately followed by a decimal top marker, so the second question
// gets its own number. Scoped to Q&A blocks only (called from buildQAParts).
function splitBrokenTops(blocks) {
  const TOP_AFTER_BR = /\n\s*\d{1,2}[.)]\s+[A-Za-z]/;
  const out = [];
  for (const b of blocks) {
    if (b.t !== "para" || !b.segs) { out.push(b); continue; }
    const plain = b.segs.map((s) => s.t).join("");
    const m = plain.match(TOP_AFTER_BR);
    if (!m) { out.push(b); continue; }
    const cut = m.index;                                  // the "\n"
    const secStart = cut + plain.slice(cut).match(/^\n\s*/)[0].length;
    const first = { t: "para", segs: segsSlice(b.segs, 0, cut), plain: plain.slice(0, cut).trim() };
    if (b.marker) first.marker = b.marker;
    if (b.numId != null) first.numId = b.numId;
    if (b.lvl != null) first.lvl = b.lvl;
    out.push(first, { t: "para", segs: segsSlice(b.segs, secStart, plain.length), plain: plain.slice(secStart).trim() });
  }
  return out;
}

// A writer often glues the FIRST multiple-choice option straight onto the question
// stem — "Which is odd?A.  8" — while the remaining options (B, C, D) follow as
// separate list items. Left glued, option A hides inside the stem, so the siblings
// re-letter from A ("B. 12" renders "A. 12") and one option is lost. Split the
// embedded "A. 8" out as its own literal sub-part so the siblings continue B, C, D.
// Gated tightly: this block must be a decimal top question with a trailing "A."/"a."
// option, and the NEXT sibling must be the option that continues at "B"/"b" — the
// unambiguous signature of a glued first option (never fires on stray "A." in prose).
function splitGluedFirstOption(blocks) {
  const EMBEDDED_A = /^(.*?[?:.])[^\S\n]*([Aa][.)][^\S\n]+\S[\s\S]*?)[\s\n]*$/;
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const decimalTop = b.t === "para" && b.marker && /^\(?\d/.test(b.marker);
    const next = blocks[i + 1];
    const nextIsB = next && next.t === "para" && next.marker
      && /^[Bb]\b/.test(next.marker.replace(/^[(]/, ""));
    if (!decimalTop || !nextIsB || !b.segs || b.segs.some((s) => s.m)) { out.push(b); continue; }
    const plain = b.segs.map((s) => s.t).join("");
    const m = plain.match(EMBEDDED_A);
    if (!m || m[1].trim().length < 4) { out.push(b); continue; }
    const cut = plain.indexOf(m[2], m[1].length);         // where option "A." begins
    const first = { t: "para", segs: segsSlice(b.segs, 0, cut), plain: plain.slice(0, cut).trim() };
    if (b.marker) first.marker = b.marker;
    if (b.numId != null) first.numId = b.numId;
    if (b.lvl != null) first.lvl = b.lvl;
    out.push(first, { t: "para", segs: segsSlice(b.segs, cut, plain.length), plain: plain.slice(cut).trim() });
  }
  return out;
}

function buildQAParts(blocks) {
  blocks = expandGluedSubparts(splitBrokenTops(splitGluedFirstOption(blocks)));
  // Manuscripts sometimes indent an ENTIRE question list one or two Word-list
  // levels deep (e.g. every question at ilvl=2 with nothing at ilvl 0/1). Those
  // questions are really the top level, so normalise every marked item's level by
  // the shallowest level present — otherwise they read as sub-items and their
  // numbering restarts (the author's "wrong numbering" on such an exercise).
  const lvls = blocks.filter((b) => b.t === "para" && b.marker && b.lvl != null).map((b) => b.lvl);
  const minLvl = lvls.length ? Math.min(...lvls) : 0;
  const elvl = (b) => Math.max(0, (b.lvl || 0) - minLvl);
  // a top-level item the writer typed literally ("1.", "2)", "(3)"); the text
  // after it may be empty (a bare number that heads a group of sub-answers).
  let LIT_TOP = /^(\(?\d{1,3}[.)])\s*([\s\S]*)$/;
  // a sub-question typed literally ("(a)", "a)", "(i)", "(iv)").
  let LIT_SUB = /^(\(?(?:[a-z]|[ivx]{2,4})[.)])\s+([\s\S]+)/i;
  // A Teacher's Guide answer-key divider ("Possible answers", "Expected Answers",
  // "Marking scheme"…) sitting on its own line between the questions and answers.
  const ANSWERS_DIVIDER = /^(?:(?:possible|expected|suggested|sample|model)\s+)?(?:answers?|responses?|solutions?|marking\s+scheme)\s*:?\s*$/i;
  const anyList = blocks.some((b) => b.t === "para" && b.marker);
  const hasLiteral = blocks.some((b) => b.t === "para" && !b.marker &&
    (LIT_TOP.test(b.plain) || LIT_SUB.test(b.plain)));
  // "structured" = the writer marked items themselves (Word lists OR literal
  // markers); then we PRESERVE their markers and nesting. Otherwise we fall back
  // to plain sequential numbering for a bare list of questions.
  const structured = anyList || hasLiteral;
  // Does this block have DECIMAL top-level markers (Word decimal list OR a literal
  // "7." top)? If so, LETTER/ROMAN markers are sub-parts under them. If NOT (a bare
  // "a) b) c)" list), the letters are themselves the top items. This lets us tell
  // depth from marker FORMAT — reliable even when the writer parks question 1 at a
  // deeper Word ilvl than its own (a)(b) sub-parts (the p107 assessment).
  const hasDecimalTop = blocks.some((b) => {
    if (b.t !== "para") return false;
    if (b.marker && /^\(?\d/.test(b.marker)) return true;
    const pt = b.plain ? b.plain.replace(/^\s+/, "") : "";
    return LIT_TOP.test(pt) && !LIT_SUB.test(pt);
  });
  // A manuscript sometimes numbers its TOP-level items with roman numerals ("i.",
  // "ii.") and its sub-parts with single letters ("a)", "b)") — instead of the usual
  // decimal-top / letter-or-roman-sub scheme this parser otherwise assumes. A lone
  // "i." is ambiguous on its own (roman numeral i, OR the single letter "i"), but
  // "ii."/"iii." can ONLY be roman — so their presence, with NO decimal top anywhere
  // in the block, is the signal to read every roman-looking literal marker here as a
  // TOP item and every single-letter marker as its SUB-part (swapping which regex
  // plays which role, mirroring the existing decimal-top/letter-sub split below).
  const hasRomanTop = !hasDecimalTop && blocks.some((b) => {
    if (b.t !== "para" || b.marker) return false;
    const pt = (b.plain || "").replace(/^\s+/, "");
    return /^\(?[ivx]{2,4}[.)]\s/i.test(pt);        // "ii."/"iii."/… — unambiguously roman
  });
  if (hasRomanTop) {
    LIT_TOP = /^(\(?[ivx]{1,4}[.)])\s*([\s\S]*)$/i;
    LIT_SUB = /^(\(?[a-z][.)])\s+([\s\S]+)/i;        // single letters only — never roman here
  }
  // Numbering is LOCAL to this block (Word's cross-document counters interleave
  // unreliably): top items count 1..N, sub items a..z reset under each parent /
  // lead-in — keeping the writer's marker FORMAT (decimal / letter / roman).
  // topTpl defaults to a genuine 2-char roman template ("ii.") when hasRomanTop, since
  // markerFor only recognises roman formatting from a template of 2+ roman letters — a
  // template captured from a lone "i." would misread as the letter "i" (see markerFor).
  let primaryNum = null, topTpl = hasRomanTop ? "ii." : "1.", subTpl = "a)", topN = 0, subN = 0, auto = 0;
  // The numId of the manuscript's real top-level question list (set once, from the
  // first genuine top-level Word-list item) and the topN count it had reached right
  // before the most recent "Answers:" divider reset it — so a later question
  // continuing that SAME list can pick its count back up instead of restarting
  // (see the divider handler and the decimal-top branch below).
  let questionNumId = null, topNBeforeDivider = 0;
  const stripLit = (s) => s.replace(/^\(/, "");          // "(a)" -> "a)"
  const parts = [];
  // When sub-parts (a, b, c…) appear with NO numbered question above them, the
  // question stem was left unnumbered — an implied Question 1. Promote the
  // preceding lead-in stem to "1." (or, if there is none, emit a bare "1.").
  // If topN is 0 only because an "Answers:" divider just reset it (a real question
  // sits above, or we're mid-answer right after the divider), there's nothing to
  // promote — leave topN untouched so the divider's reset stays intact for the
  // decimal-top branch to either restore it (same numId) or start fresh (different
  // numId); only bump it here when we're truly synthesizing a first top item.
  const ensureTopBeforeSub = () => {
    if (topN > 0) return;
    for (let k = parts.length - 1; k >= 0; k--) {
      if (parts[k].kind === "q") return;                 // a question already sits above
      if (parts[k].kind === "lead" && parts[k].divider) return;  // an answers divider is not a parent question
      if (parts[k].kind === "lead") {
        topN = 1;
        parts[k] = { kind: "q", q: parts[k].q, qseg: parts[k].qseg, a: "", marker: markerFor(1, topTpl), depth: 0 };
        return;
      }
    }
    topN = 1;
    parts.push({ kind: "q", q: "", a: "", marker: markerFor(1, topTpl), depth: 0 });
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "table") { parts.push({ kind: "table", rows: b.rows }); continue; }
    if (b.t === "img") { parts.push({ kind: "image", images: b.images }); continue; }
    if (b.t !== "para") continue;
    const grabAnswer = () => {           // pull a trailing "Possible answer: …"
      const nxt = blocks[i + 1];
      if (nxt && nxt.t === "para" && /^possible answer\s*:/i.test(nxt.plain)) {
        i++;
        const pl = nxt.plain.replace(/^possible answer\s*:\s*/i, "").trim();
        const off = nxt.plain.length - nxt.plain.replace(/^possible answer\s*:\s*/i, "").length;
        return { a: pl, aseg: segsFrom(nxt.segs, off) };
      }
      return { a: "", aseg: undefined };
    };
    // segments for a question with a leading marker of `plainLen - contentLen` chars
    // removed. `b.plain` is trimmed but `b.segs` are NOT, so add back the leading
    // whitespace the trim removed — otherwise the offset lands short and a stripped
    // marker (or leading indent) survives in the rendered segments.
    const leadWs = b.segs ? (b.segs.map((s) => s.t).join("").match(/^\s*/)[0].length) : 0;
    const qsegOf = (content) => segsFrom(b.segs, content == null ? 0 : leadWs + b.plain.length - content.length);
    // A "Possible answers" divider RESETS numbering so the answer key restarts at 1
    // — even when the writer made the divider itself a numbered list item (which
    // would otherwise be counted as a question and drag the answers up to 11, 12…).
    if (ANSWERS_DIVIDER.test(b.plain.trim())) {
      topNBeforeDivider = topN;
      topN = 0; subN = 0; auto = 0; primaryNum = null;
      parts.push({ kind: "lead", q: b.plain, qseg: b.segs, divider: true });
      continue;
    }
    if (!structured) {
      const qm = b.plain.match(/^\(?\d+[.)]\s*([\s\S]+)/);
      auto += 1;
      const an = grabAnswer();
      parts.push({ kind: "q", q: qm ? qm[1].trim() : b.plain, qseg: qsegOf(qm ? qm[1] : b.plain), a: an.a, aseg: an.aseg, marker: auto + ".", depth: 0 });
      continue;
    }
    // A literal marker the writer typed in the TEXT wins over the Word-list
    // marker — manuscripts are inconsistent (e.g. a sub-answer "(a) …" may also
    // be a Word list item; the "(a)" shows the real intent: it's a sub-item).
    // Match a literal marker AFTER any leading whitespace/indentation the writer
    // left in the run — otherwise "   4. …" / "    (a) …" slip past the ^-anchored
    // regexes and the literal marker gets doubled with the auto one ("4. 4.").
    const plainTrim = b.plain.replace(/^\s+/, "");
    const sm = plainTrim.match(LIT_SUB);
    const tm = plainTrim.match(LIT_TOP);
    const tmSub = tm && tm[2].match(LIT_SUB);   // "N. (a) text" = top number + its first sub-part
    // Top-level items are RENUMBERED sequentially (1..N) so a block always starts
    // at 1 even when the writer's literal numbers are erratic (skip a number, or
    // start at 2). Sub-parts count a..z and reset under each new top. The writer's
    // marker FORMAT is kept (decimal / letter), only the count is normalised.
    if (sm) {                            // a literal sub-question "(a) …"
      // A paragraph that is ALSO a top-level Word list item, whose literal sub
      // marker RESTARTS at "(a)"/"(i)" while we are already mid sub-sequence, is a
      // NEW numbered question (its parts merely start at (a)) — not a continuation
      // of the previous question's letters. Emit the new top number, then this
      // "(a)" as its first sub-part. (Without this, "(a) Name…" after a "2. …(a)(b)"
      // group renders as a stray "c)".)
      const subLetter = sm[1].replace(/[()\s.]/g, "").toLowerCase();
      const restarts = subLetter === "a" || subLetter === "i";
      const topListItem = b.marker && elvl(b) === 0
        && (primaryNum == null || b.numId === primaryNum || /^\d/.test(b.marker || ""));
      if (topListItem && restarts) {
        if (primaryNum == null) { primaryNum = b.numId; if (/^\d/.test(b.marker || "")) topTpl = b.marker; }
        topN += 1; subN = 1; subTpl = stripLit(sm[1]);
        parts.push({ kind: "q", q: "", a: "", marker: markerFor(topN, topTpl), depth: 0 });
        const an = grabAnswer();
        parts.push({ kind: "q", q: sm[2].trim(), qseg: qsegOf(sm[2]), a: an.a, aseg: an.aseg, marker: markerFor(subN, subTpl), depth: 1 });
        continue;
      }
      if (subN === 0) { subTpl = stripLit(sm[1]); ensureTopBeforeSub(); }
      subN += 1;
      const an = grabAnswer();
      parts.push({ kind: "q", q: sm[2].trim(), qseg: qsegOf(sm[2]), a: an.a, aseg: an.aseg, marker: markerFor(subN, subTpl), depth: 1 });
    } else if (b.marker) {               // a Word list item (no literal marker in text)
      if (primaryNum == null && elvl(b) === 0) primaryNum = b.numId;
      // Classify by MARKER FORMAT, the reliable signal: a DECIMAL marker heads a
      // top-level question; a LETTER/ROMAN marker is a sub-part — UNLESS the whole
      // block is a bare letter list (no decimal tops), where the letters ARE the
      // tops. Word ilvl is NOT trusted for depth (a manuscript may put question 1
      // at ilvl 1 while its own (a)(b) parts sit at ilvl 0). Tops renumber 1..N in
      // their own format; subs count a..z and reset under each new top.
      const decimal = /^\(?\d/.test(b.marker || "");
      const sub = !decimal && (elvl(b) > 0 || hasDecimalTop);
      let marker;
      if (sub) { if (subN === 0) { subTpl = b.marker; ensureTopBeforeSub(); } subN += 1; marker = markerFor(subN, subTpl); }
      else {
        // A real question continuing the SAME Word list (its numId matches the one
        // that started this block's top-level numbering) picks its count back up
        // across an intervening "Answers:" divider instead of restarting at 1 (see
        // the topN reset below) — while a decimal marker belonging to the answer key
        // itself (a different numId, e.g. "1. Key Factors" under an answer) still
        // starts fresh, since it fails this numId check.
        if (topN === 0 && questionNumId != null && b.numId === questionNumId) topN = topNBeforeDivider;
        topN += 1; subN = 0;
        if (topN === 1) { topTpl = b.marker; questionNumId = b.numId; }
        marker = markerFor(topN, topTpl);
      }
      const an = grabAnswer();
      // The writer sometimes ALSO types the marker into the text of a Word list
      // item ("4. A shape…"); strip that redundant literal so it isn't doubled with
      // the auto marker. (sm already branched above, so only a top literal remains.)
      const content = tm ? tm[2] : b.plain;
      parts.push({ kind: "q", q: content.trim(), qseg: qsegOf(content), a: an.a, aseg: an.aseg, marker, depth: sub ? 1 : 0 });
    } else if (tmSub) {                  // "N. (a) text": emit the top number, then its sub-part
      topN += 1; subN = 1; subTpl = stripLit(tmSub[1]);
      parts.push({ kind: "q", q: "", a: "", marker: markerFor(topN, topTpl), depth: 0 });
      const an = grabAnswer();
      parts.push({ kind: "q", q: tmSub[2].trim(), qseg: qsegOf(tmSub[2]), a: an.a, aseg: an.aseg, marker: markerFor(subN, subTpl), depth: 1 });
    } else if (tm) {                     // a literal top item "1." (text may be empty)
      topN += 1; subN = 0;
      const an = grabAnswer();
      parts.push({ kind: "q", q: tm[2].trim(), qseg: qsegOf(tm[2]), a: an.a, aseg: an.aseg, marker: markerFor(topN, topTpl), depth: 0 });
    } else {                             // a lead-in / heading line ("Expected Answers", "Calculate:")
      subN = 0;
      // A lead that follows a question is a CONTINUATION of it (e.g. "Find the
      // length of side BC." on its own line under question 2, or "Calculate:"
      // before its sub-parts) — indent it to sit under the question text instead
      // of hugging the box's left margin. A lead BEFORE any question (a genuine
      // exercise-wide lead-in) stays flush.
      const indent = parts.some((p) => p.kind === "q");
      parts.push({ kind: "lead", q: b.plain, qseg: b.segs, indent });
    }
  }
  // A bare question number that the writer placed AFTER its figure (e.g. "1."
  // sitting below the diagram that answers it) reads better with the number
  // above the image — move it before the image it immediately follows. Swap only
  // ONE number per image (then skip past the image so the next number stays put).
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].kind === "image" && parts[i + 1].kind === "q"
        && (parts[i + 1].depth || 0) === 0 && !(parts[i + 1].q || "").trim()) {
      [parts[i], parts[i + 1]] = [parts[i + 1], parts[i]];
      i++; // the image now sits at i+1; don't reconsider it
    }
  }
  return parts;
}

// Turn a recognised single-cell box into a semantic block. `blocks` is the
// cell's ordered content (paragraphs, images AND nested tables) — nothing lost.
function makeBox(kind, blocks) {
  // The box title ("EXERCISE 1", "LEARNING ACTIVITY 2"…) is normally the first
  // paragraph, but a disorganised manuscript may glue it onto an image paragraph.
  // Find it across ANY block type; drop it from the body only if it's a title-only
  // paragraph (keep image blocks so their picture still renders).
  const titleIdx = blocks.findIndex((b) => boxKindFromTitle((b.plain || "").trim()));
  const titlePara = blocks.find((b) => b.t === "para");
  let titleText = titleIdx >= 0 ? blocks[titleIdx].plain.trim() : (titlePara ? titlePara.plain : "");
  // insert a missing space where the manuscript glued the box number to its label
  // ("LEARNING ACTIVITY23" -> "LEARNING ACTIVITY 23", "EXERCISE9" -> "EXERCISE 9").
  titleText = titleText.replace(/^(LEARNING ACTIVITY|ACTIVITY|EXE?RCISE|EXCERCISE|TASK|PROJECT|ASSESSMENT)(\d)/i, "$1 $2");
  const bodyFrom = (start) => blocks.filter((b, i) => !(i === start && b.t === "para"));
  // body = everything after a clean title paragraph; or, when the title is glued
  // to an image / not a standalone para, everything except that title-only para.
  const after = titleIdx >= 0
    ? bodyFrom(titleIdx)
    : (titlePara ? blocks.slice(blocks.indexOf(titlePara) + 1) : blocks);
  if (kind === "activity") {
    // A disorganised manuscript sometimes glues the activity's body onto its title
    // paragraph ("LEARNING ACTIVITY 4: Name Divide learners into groups…"). When the
    // title is abnormally long AND runs into an imperative body opener, split the
    // body off so the title stays a short heading and the body flows as normal
    // (italic) activity text rather than being swallowed by the green title.
    const BODY_OPEN = /\s+((?:Divide|Organi[sz]e|Ask|Guide|Instruct|Provide|Facilitate|Work in|Move around|In this activity|Give each|Learners?\b)[\s\S]*)$/;
    const bm = titleText.length > 80 ? titleText.match(BODY_OPEN) : null;
    if (bm) {
      const bodyText = bm[1].trim();
      return { t: "activity", title: titleText.slice(0, bm.index).trim(),
        body: [{ t: "para", segs: [{ t: bodyText, b: false, it: true, c: null }], plain: bodyText }, ...after] };
    }
    return { t: "activity", title: titleText, body: after };
  }
  if (kind === "fact") return { t: "fact", body: after };
  if (kind === "keypoints") {
    const points = after.filter((b) => b.t === "para").map((p) => p.plain.replace(/^[••]\s*/, ""));
    after.filter((b) => b.t === "table").forEach((tb) => tb.rows.forEach((r) => points.push(r.map((c) => c.text).join(" – "))));
    const title = /Mau ofunika|KEY POINTS|Key Points/i.test(titleText) ? titleText : "";
    return { t: "keypoints", title, points };
  }
  if (kind === "exercise") {
    // normalise the common "EXRCISE"/"EXCERCISE" misspelling in the visible heading
    const heading = (titleText || "Exercise").replace(/^\s*EX(?:E?RCISE|CERCISE)\b/i, "EXERCISE");
    return { t: "exercise", heading, parts: buildQAParts(after) };
  }
  return { t: "box", body: blocks }; // generic fallback
}

// Build an assessment block from a TABLE: title + ordered questions/tables from
// the first cell, plus any extra top-level rows.
function makeAssessmentTable(cells) {
  const blocks = cellBlocks(cells[0][0].xml);
  const titlePara = blocks.find((b) => b.t === "para");
  const title = titlePara ? titlePara.plain : "Assessment";
  const after = titlePara ? blocks.slice(blocks.indexOf(titlePara) + 1) : blocks;
  const extra = [];
  for (let r = 1; r < cells.length; r++) for (const c of cells[r]) { const t = cellText(c.xml); if (t) extra.push(t); }
  return { t: "assessment", title, intro: [], parts: buildQAParts(after), extra };
}

// Classify a paragraph that is NOT a Word heading: section heading, label,
// figure caption, assessment title, list item, or body.
//   colorHeads = the doc marks section headings with a colour (PE house style).
//   When it doesn't (e.g. headings are bold black), a short bold line is treated
//   as a heading unless it ends with a colon (then it's a label like
//   "Specific Competence:").
function classifyPara(pXml, segs, hmapLevel, colorHeads, flat) {
  const plain = plainOf(segs).trim();
  // A short box label that wasn't boxed (its content was in a following table or
  // blank) should stay a label, never a heading. The length guard avoids
  // demoting ordinary sentences that merely begin with a label word. In the
  // "flat" (series) layout there are no boxes, so Activity/Exercise lines are
  // headings, not labels — skip this demotion there.
  if (!flat && plain.length <= 40 && boxKindFromTitle(plain)) return { t: "label", text: plain };
  // Series layout: an Activity / Exercise / Task / Assessment line (English or a
  // local language) is always a heading, even if the source didn't bold the whole
  // line — so they style consistently. (Table-wrapped boxes are still kept.)
  if (flat && plain.length <= 80 && (boxKindFromTitle(plain) || /^(activity|exercise|task|project)\b/i.test(plain))) return { t: "head", text: plain };
  // Trust the manuscript's own Word heading style — EXCEPT when the "heading" reads as
  // body prose: a manuscript occasionally applies Heading1 to a whole paragraph by
  // mistake (a Foreword/Preface/bio paragraph, a body sentence under a topic), which
  // would otherwise become a giant, blank-looking front-matter "section" with the real
  // text silently swallowed by the page-break-triggering heading machinery. A genuine
  // heading is always short AND never ends in terminal sentence punctuation.
  const looksLikeProse = plain.length > 140 || (/[.!?]\s*$/.test(plain) && plain.length > 60);
  if (hmapLevel && !looksLikeProse) return { t: "h" + hmapLevel, text: plain };
  // Numbered TOPIC / UNIT / Sub-Topic headings (some manuscripts hand-size these
  // with no Word heading style, e.g. Physics "TOPIC 4.1: …" / "Sub-Topic 4.1.1: …").
  if (plain.length <= 90 && SUBTOPIC_RE.test(plain)) return { t: "h2", text: plain };
  if (plain.length <= 90 && /^(TOPIC|UNIT|CHAPTER)\s+[\d.]+\b/i.test(plain)) return { t: "h1", text: plain };
  // Local-language unit openers, hand-sized (no heading style), e.g. Lunda
  // "CHIBALU 1: …" or Tonga "CIPATI 1: …". Titles can be long, so allow more room.
  if (plain.length <= 120 && /^(CHIBALU|CIPATI)\s+\d+\b/i.test(plain)) return { t: "h1", text: plain };
  // Back-matter section names are section headings even when the manuscript left
  // them un-bold (so they get their own page and end any preceding box).
  if (plain.length <= 40 && /^(GLOSSARY|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX)$/i.test(plain)) return { t: "h1", text: plain };
  const nonblank = segs.filter((s) => s.t.trim());
  const allBold = nonblank.length > 0 && nonblank.every((s) => s.b);
  const colored = nonblank.some((s) => s.c);
  const endsColon = /:\s*$/.test(plain);
  if (/^fig(?:ure)?\.?\s*\d+\s*[:.]/i.test(plain)) return { t: "figcaption", text: plain };
  // A bare figure label ("Figure 11") — just the word and a number, nothing after
  // it — is a caption sitting under its image. Some writers bold it; without this
  // guard the bold-text rule below would turn it into a left-aligned heading. Emit
  // a non-bold, centred paragraph so it matches every other "Figure N" opener.
  if (/^fig(?:ure)?\.?\s*\d+\.?$/i.test(plain)) return { t: "para", segs: segs.map((s) => ({ ...s, b: false })), align: "center" };
  // A line of single letters separated by spaces/commas ("b d f h k l t", or the
  // alphabet "a, b, c, … z") is handwriting/spelling PRACTICE content, not a heading —
  // keep it a paragraph even when the author bolded it, so it stays inside its exercise
  // box (a bold short line would otherwise be promoted to a heading below and end the box).
  const toks = plain.split(/[\s,]+/).filter(Boolean);
  if (toks.length >= 3 && toks.every((w) => w.replace(/[.\/]/g, "").length <= 1)) return { t: "para", segs };
  if (allBold && /assessment/i.test(plain) && plain.length <= 80) return { t: "assessmentTitle", text: plain };
  if (allBold && colored) return { t: "head", text: plain };               // coloured heading (PE)
  if (colorHeads) {
    if (allBold && plain.length <= 60) return { t: "label", text: plain };  // PE: bold-black = label
  } else {
    if (allBold && endsColon && plain.length <= 60) return { t: "label", text: plain };
    if (allBold && !endsColon && plain.length <= 72) return { t: "head", text: plain }; // bold-black heading
    if (allBold && plain.length <= 60) return { t: "label", text: plain };
  }
  if (/<w:numPr>/.test(pXml) || /^[••]/.test(plain)) return { t: "listitem", segs: stripBullet(segs) };
  // In the flowing (series) layout, collapse manual line breaks the author used
  // to hand-wrap a paragraph so the text reflows to the page width (poetry uses
  // the literary variant, which is not flat, so it keeps its breaks).
  return { t: "para", segs: flat ? reflowBreaks(segs) : segs };
}
// Collapse runs of manual line breaks ("\n") inside a flowing paragraph: join
// across the break when it sits mid-word (a letter on each side, e.g. a word
// split as "nta\n\n\nñishi" -> "ntañishi"), otherwise use a single space.
// Operates across segment boundaries so run formatting (bold/italic) is kept.
function reflowBreaks(segs) {
  if (!segs.some((s) => s.t.includes("\n"))) return segs;
  const isWord = (c) => !!c && /[^\s.,;:!?()\[\]"'’“”…—–\-]/.test(c);
  let prevChar = "";
  for (let i = 0; i < segs.length; i++) {
    let nextChar = "";
    for (let j = i + 1; j < segs.length; j++) { if (segs[j].t.length) { nextChar = segs[j].t[0]; break; } }
    segs[i].t = segs[i].t.replace(/\n+/g, (m, off, str) => {
      const before = off > 0 ? str[off - 1] : prevChar;
      const after = off + m.length < str.length ? str[off + m.length] : nextChar;
      return (isWord(before) && isWord(after)) ? "" : " ";
    }).replace(/ {2,}/g, " ");
    if (segs[i].t.length) prevChar = segs[i].t[segs[i].t.length - 1];
  }
  return segs.filter((s) => s.t.length);
}
function stripBullet(segs) {
  const c = segs.map((s) => ({ ...s }));
  if (c[0]) c[0].t = c[0].t.replace(/^[••]\s*/, "");
  return c;
}

// Group an assessmentTitle block + the question/answer lines that follow it
// into one {t:"assessment", title, intro, items} block. Any non-numbered lines
// before the first numbered question (e.g. "Answer all the questions.") become
// the intro; numbered lines + "Possible answer:" lines become the items.
const A_FLOW = new Set(["para", "listitem", "head", "label"]);
function groupAssessments(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "assessmentTitle") {
      const run = [];
      let j = i + 1;
      // Collect the questions that follow the title. Images and tables belonging to
      // a question (a diagram to read, a data table) must NOT end the assessment —
      // include them so the numbering flows across them instead of restarting.
      while (j < blocks.length && (A_FLOW.has(blocks[j].t) || ["image", "imagerow", "table"].includes(blocks[j].t))) {
        const y = blocks[j];
        const plain = y.segs ? plainOf(y.segs).trim() : (y.text || "").trim();
        if (SECTION_RE.test(plain)) break; // a new section ends the assessment
        run.push(y);
        j++;
      }
      // Normalise to the block shapes buildQAParts consumes (para / img / table),
      // then let it number top questions 1..N and sub-parts a..z (across diagrams).
      const qb = run.map((y) =>
        y.t === "image" ? { t: "img", images: [{ file: y.file, w: y.w, tall: y.tall, caption: y.caption, hmm: y.hmm }] }
        : y.t === "imagerow" ? { t: "img", images: y.images }
        : y.t === "table" ? { t: "table", rows: y.rows }
        : { t: "para", segs: y.segs || [], plain: y.segs ? plainOf(y.segs).trim() : (y.text || "").trim(),
            marker: y.marker || null, isList: y.t === "listitem" || !!y.isList, numId: y.numId != null ? y.numId : null, lvl: y.lvl != null ? y.lvl : null });
      const isQ = (p) => p.t === "para" && (p.marker || /^\(?\d+[.)]/.test(p.plain));
      const firstQ = qb.findIndex(isQ);
      const intro = (firstQ < 0 ? [] : qb.slice(0, firstQ)).filter((p) => p.t === "para" && p.plain).map((p) => p.plain);
      const parts = buildQAParts(firstQ < 0 ? qb : qb.slice(firstQ));
      out.push({ t: "assessment", title: b.text, intro, parts, extra: [] });
      i = j - 1;
    } else {
      out.push(b);
    }
  }
  return out;
}

async function importDocx(docxPath, opts = {}) {
  // ZEPH house-style options (decoupled so different layouts can mix them):
  //   styled    – trust Word heading styles (don't infer headings from colour/size)
  //   flat      – no callout boxes; activities/exercises become headings (English)
  //   textCover – build a designed cover even with no hero image
  // `series: true` is shorthand for all three (the English "series" layout).
  const styled = !!(opts.styled || opts.series);
  const flat = opts.flat !== undefined ? !!opts.flat : !!opts.series;
  const textCover = !!(opts.textCover || opts.series);
  const imgOverrides = opts.imgOverrides || {};
  // Media filename prefix. Defaults to "imp_". A secondary import spliced into a
  // primary document (e.g. an author-rewritten unit dropped in via replaceSection
  // `fromDocx`) MUST use a distinct prefix, or its image1.png collides with the
  // main document's image1.png. Both the media entry name and the block's `file`
  // reference use this prefix, so they stay consistent.
  const imgPrefix = opts.imgPrefix || "imp_";
  // filenames (e.g. "image30.jpeg") to DROP entirely — used to collapse a pair of
  // divider images down to one, or remove a watermarked/placeholder stock image.
  const removeImages = new Set(opts.removeImages || []);
  // Some authors put every figure's label in its OWN Word text box styled "Caption"
  // (not the "Figure N:" form). With this opt-in, capture those caption-styled boxes as
  // the picture's caption too, instead of stripping them (see the caption capture below).
  const captionBoxes = !!opts.textboxCaptions;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docx-"));
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  await Promise.all(Object.keys(zip.files).map(async (name) => {
    const entry = zip.files[name];
    const dest = path.join(tmp, name);
    if (entry.dir) { fs.mkdirSync(dest, { recursive: true }); return; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await entry.async("nodebuffer"));
  }));
  const read = (p) => (fs.existsSync(path.join(tmp, p)) ? fs.readFileSync(path.join(tmp, p), "utf8") : "");

  // Strip floating text-box content. Word figures are often a drawing canvas: a
  // picture with separate text boxes positioned as labels (Stem, Root, …). Those
  // label paragraphs live in <w:txbxContent> and otherwise leak into the body as
  // a meaningless vertical list (their on-image positions can't be reproduced).
  // Removing the text-box content drops the stray labels but KEEPS the embedded
  // picture (which lives in <pic:pic>, not in the text box).
  // …but KEEP a text box that wraps a picture (some manuscripts place a unit/
  // topic opener photo inside a text box). Strip only the text-only label boxes.
  // Drop the legacy <mc:Fallback> half of an <mc:AlternateContent> first (we keep
  // the modern <mc:Choice>); otherwise a floating image encoded both ways is
  // imported twice.
  let rawDoc = read("word/document.xml").replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  // Recover a Learning Activity / Exercise / Assessment the author placed ENTIRELY
  // inside a floating text box (a drawing canvas with no picture) rather than the
  // document flow — otherwise the whole box (title + every question) is silently
  // deleted by the ordinary text-box stripping below, since its host paragraph
  // carries no visible text of its own. See extractTextboxBoxes for how the box is
  // swapped for a sentinel that rides through the normal paragraph pipeline, then
  // resolved back into a real block once the block array exists.
  // Parsed early (normally done much later) so extractTextboxBoxes can look up each
  // question's REAL list format (roman/letter/decimal) from the manuscript's own
  // numbering definition, instead of guessing decimal-top/letter-sub from ilvl alone.
  const numMapEarly = parseNumbering(read("word/numbering.xml"));
  const tbBoxes = [];
  ({ rawDoc } = extractTextboxBoxes(rawDoc, tbBoxes, numMapEarly));
  const rels = relsMap(read("word/_rels/document.xml.rels"));
  // The author placed each figure's caption ("Fig N: …") in its OWN text box, next
  // to the picture inside the drawing. Capture those captions BEFORE stripping, so
  // each figure keeps the real number the author assigned (figCaptions is keyed by
  // media file and consumed during image extraction). Then strip ALL text-only
  // boxes (the caption boxes AND the stray on-diagram label boxes) so the caption's
  // nested <w:p> can't corrupt the (non-nesting) paragraph splitter.
  const wtJoin = (s) => (s.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [s])
    .map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(""))
    .join(" ").replace(/\s+/g, " ").trim();
  // Tidy a figure label into "Figure N: Caption" — the author wrote a bare
  // "Figure 1 visual art" (no colon, lower-case), so add the colon and capitalise.
  const normFigCap = (t) => {
    const m = String(t).trim().match(/^(fig(?:ure)?\.?\s*\d+)\s*[:.]?\s*(.*)$/i);
    if (!m) return String(t).trim();
    const label = m[1].replace(/\s+/g, " ");
    let rest = m[2].trim();
    if (rest) rest = rest.charAt(0).toUpperCase() + rest.slice(1);
    return rest ? `${label}: ${rest}` : label;
  };
  const rawFigCaptions = {};   // media base -> caption
  {
    const re = /<a:blip[^>]*r:embed="([^"]+)"|<w:txbxContent>[\s\S]*?<\/w:txbxContent>/gi;
    const pictures = [];
    const captions = [];
    let m;
    while ((m = re.exec(rawDoc))) {
      if (m[1]) { pictures.push({ rel: m[1], pos: m.index }); continue; }
      if (/<a:blip\b/.test(m[0])) continue;                     // a picture-bearing box, not a caption
      const txt = wtJoin(m[0]);
      // A text box that opens with "Figure N" (or "Fig. N") is the author's caption
      // for the adjacent picture — whether or not a colon follows the number
      // ("Figure 1: visual art" AND the bare "Figure 1 visual art" both count). With
      // captionBoxes, also retain a non-empty Caption-styled text box. Other boxes can
      // be orphaned annotations, so they must not be attached to an unrelated picture.
      const isCaption = /^fig(?:ure)?\.?\s*\d+\b/i.test(txt)
        || (captionBoxes && txt.length > 0 && /<w:pStyle\s+w:val="Caption"/i.test(m[0]));
      if (isCaption) captions.push({ text: txt, pos: m.index });
    }
    // Captions are commonly stored immediately after their picture.  In this
    // manuscript, however, Word sometimes writes the caption box immediately
    // BEFORE the following picture.  Pair each box with the closest surrounding
    // picture rather than merely the most recent one.  This preserves both labels
    // when two labelled illustrations occur in succession.
    const claimed = new Set();
    for (const cap of captions) {
      let before = null, after = null;
      for (const pic of pictures) {
        if (pic.pos < cap.pos) before = pic;
        else { after = pic; break; }
      }
      const beforeDist = before ? cap.pos - before.pos : Infinity;
      const afterDist = after ? after.pos - cap.pos : Infinity;
      const candidates = beforeDist <= afterDist ? [before, after] : [after, before];
      const pic = candidates.find((x) => x && rels[x.rel] && !claimed.has(x.rel));
      if (!pic) continue;
      const b = path.basename(rels[pic.rel]);
      if (!rawFigCaptions[b]) {
        rawFigCaptions[b] = normFigCap(cap.text);
        claimed.add(pic.rel);
      }
    }
  }
  const docXml = rawDoc.replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g,
    (m) => (/<a:blip\b/.test(m) ? m : ""));
  const hmap = headingMap(read("word/styles.xml"));
  const numMap = numMapEarly;
  // Compute a list paragraph's real marker ("a)", "1.", "i.", "•") from the
  // numbering definition, keeping per-list counters so the writer's a/b/c and
  // numbered lists are preserved instead of being flattened to bullets. A list
  // continues while its numId is unchanged; a different numId restarts it.
  const listCounters = {};
  const listMarker = (x) => {
    const numId = (x.match(/<w:numId\s+w:val="(\d+)"/) || [])[1];
    const ilvl = parseInt((x.match(/<w:ilvl\s+w:val="(\d+)"/) || [])[1] || "0", 10);
    const info = numId ? levelInfo(numMap, numId, ilvl) : null;
    if (!info) return "•";
    // Per Word semantics, one numId is a single continuous list: its counter must
    // PERSIST across interruptions (e.g. items 1,2,3 broken by a sub-list a,b,c
    // then resuming at 4). A genuinely different numId starts fresh here via lazy
    // init. (The old code wiped the counter whenever the numId changed, so a list
    // resumed after any interruption wrongly restarted at 1.)
    const counts = listCounters[numId] || (listCounters[numId] = []);
    counts[ilvl] = (counts[ilvl] == null ? info.start - 1 : counts[ilvl]) + 1;
    for (let l = ilvl + 1; l < counts.length; l++) counts[l] = null;
    if (info.fmt === "bullet") return "•";
    const m = info.lvlText.replace(/%(\d+)/g, (_, k) => {
      const li = +k - 1, linfo = levelInfo(numMap, numId, li) || info;
      return formatNum(counts[li] == null ? linfo.start : counts[li], linfo.fmt);
    }).trim();
    return m || (formatNum(counts[ilvl], info.fmt) + ".");
  };
  // Expose list level + marker for cell paragraphs (questions/sub-questions in
  // exercise & assessment tables), so their real numbering is preserved.
  listResolve = (x) => {
    if (!/<w:numPr>/.test(x)) return null;
    const numId = (x.match(/<w:numId\s+w:val="(\d+)"/) || [])[1];
    const lvl = parseInt((x.match(/<w:ilvl\s+w:val="(\d+)"/) || [])[1] || "0", 10);
    return { numId, lvl, marker: listMarker(x) };
  };

  const bodyMatch = docXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : docXml;
  // Page text width in px (twips / 15), used to decide whether a floating picture is
  // a narrow "side figure" the author placed beside the text (image on the left/right
  // with the paragraph flowing next to it) rather than a full-width illustration.
  const secPr = (docXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) || []);
  const lastSec = secPr.length ? secPr[secPr.length - 1] : docXml;
  const pgWtw = +((lastSec.match(/<w:pgSz\b[^>]*\bw:w="(\d+)"/) || [])[1]) || 12240;
  const mLtw = +((lastSec.match(/<w:pgMar\b[^>]*\bw:left="(\d+)"/) || [])[1]) || 1440;
  const mRtw = +((lastSec.match(/<w:pgMar\b[^>]*\bw:right="(\d+)"/) || [])[1]) || 1440;
  const textWidthPx = Math.max(200, (pgWtw - mLtw - mRtw) / 15);
  const { masked, tables } = maskTables(body);

  const blocks = [];
  const mediaOut = []; // {src, name}

  // Split into an ordered list of parts (paragraph XML or @@TBLn@@ token).
  // The splitter must be NESTING-AWARE: Word wraps a floating picture in its own
  // <w:p> nested inside the drawing/anchor, so a naive non-greedy `<w:p>…</w:p>`
  // match ends the OUTER paragraph at the first inner </w:p> — orphaning any
  // heading/label that shares the anchor paragraph (its text then falls into the
  // gap between matches and vanishes from the body entirely, e.g. an
  // "ACTIVITY 1: …" line sitting beside its illustration). Track <w:p> depth and
  // only close a top-level paragraph at a depth-0 </w:p>. (Table cell paragraphs
  // are already hidden behind @@TBLn@@ tokens by maskTables, so the only nested
  // <w:p> reaching here live inside drawings.)
  const parts = (() => {
    const out = [];
    const tokRe = /@@TBL\d+@@|<w:p\b[^>]*\/>|<w:p\b[^>]*>|<\/w:p>/g;
    let m, depth = 0, start = -1;
    while ((m = tokRe.exec(masked))) {
      const tok = m[0];
      if (tok.startsWith("@@TBL") || /\/>$/.test(tok)) { if (depth === 0) out.push(tok); continue; }
      if (tok === "</w:p>") {
        if (depth > 0 && --depth === 0) { out.push(masked.slice(start, m.index + tok.length)); start = -1; }
        continue;
      }
      if (depth++ === 0) start = m.index;               // opening <w:p …>
    }
    return out;
  })();
  const isTbl = (x) => x.startsWith("@@TBL");
  const textOf = (x) => (isTbl(x) ? "" : plainOf(paraSegs(x)).trim());
  const styleOf = (x) => (x.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || "";
  const alignOf = (x) => {
    const jc = (x.match(/<w:jc\s+w:val="([^"]+)"/) || [])[1];
    return jc === "center" ? "center" : jc === "right" ? "right" : null;
  };
  // Word sometimes stores vector pictures as EMF/WMF (and a few other formats)
  // that Typst can't read — skip just those rather than fail the whole book.
  // (Don't require a known extension: some docs store images with none, and
  // Typst detects the real format from the bytes.)
  const BAD_IMG = /\.(emf|wmf|tiff?|bmp)$/i;
  // Read a picture's Word crop rectangle (<a:srcRect l t r b/>, values in 1000ths of
  // a percent = how much to trim off each edge). Returns {l,t,r,b} as fractions, or
  // null when there's no crop / it's negligible / it's degenerate. Applied so a
  // cropped screenshot shows only the region the author kept (not the whole window).
  const parseCrop = (d) => {
    const sr = d.match(/<a:srcRect\b([^>]*)\/?>/);
    if (!sr) return null;
    const g = (a) => { const m = sr[1].match(new RegExp(a + '="(-?\\d+)"')); return m ? parseInt(m[1], 10) / 100000 : 0; };
    const l = g("l"), t = g("t"), r = g("r"), b = g("b");
    if (l + t + r + b < 0.01) return null;                 // no meaningful crop
    if (l + r >= 0.98 || t + b >= 0.98) return null;       // degenerate — would erase the image
    return { l, t, r, b };
  };
  // All images in a paragraph, with their on-page size (px), IN DOCUMENT ORDER.
  // Handles BOTH picture encodings Word emits:
  //   • modern DrawingML  — <w:drawing> … <a:blip r:embed> sized by <wp:extent> (EMU/9525=px)
  //   • legacy VML / OLE  — <v:shape style="width:Npt;height:Npt"><v:imagedata r:id>
  //     (a pasted Paint/equation "object"; the picture is the imagedata r:id, while
  //     the sibling <o:OLEObject r:id> is the binary payload — NOT an image, so skip
  //     it). Many manuscripts store most of their figures this way; missing this
  //     branch silently dropped those pictures, leaving only their captions.
  const imagesOf = (x) => {
    const recs = [];
    for (const dm of x.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)) {
      const d = dm[0];
      const rid = (d.match(/<a:blip[^>]*r:embed="([^"]+)"/) || [])[1];
      if (!rid) continue;
      // A grouped figure (one picture among text-box label shapes) carries several
      // extents; use the LARGEST (the picture, not a label box).
      const exts = [...d.matchAll(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/g)].map((e) => ({ w: +e[1] / 9525, h: +e[2] / 9525 }));
      const ext = exts.length ? exts.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)) : { w: 0, h: 0 };
      const verticalOffset = +(d.match(/<wp:positionV\b[^>]*relativeFrom="paragraph"[^>]*>[\s\S]*?<wp:posOffset>(-?\d+)<\/wp:posOffset>/i) || [])[1] || 0;
      // Which side of the column a FLOATING (anchored) picture sits on: the author put
      // small figures on the left/right with the text flowing beside them. Derive it from
      // the horizontal placement — an explicit align keyword, or a posOffset whose picture
      // centre lands in the left/right third of the text column. Only NARROW floats (well
      // under the full text width) are treated as side figures; a wide float is full width.
      let side = null;
      const isAnchor = /<wp:anchor\b/.test(d);
      if (isAnchor && ext.w > 0 && ext.w < textWidthPx * 0.62) {
        const align = (d.match(/<wp:positionH\b[^>]*>[\s\S]*?<wp:align>(left|right|center)<\/wp:align>/i) || [])[1];
        if (align === "left") side = "L";
        else if (align === "right") side = "R";
        else if (align !== "center") {
          const hOff = +(d.match(/<wp:positionH\b[^>]*relativeFrom="(?:column|margin|page|character)"[^>]*>[\s\S]*?<wp:posOffset>(-?\d+)<\/wp:posOffset>/i) || [])[1] || 0;
          const centre = hOff / 9525 + ext.w / 2;
          if (centre < textWidthPx * 0.44) side = "L";
          else if (centre > textWidthPx * 0.56) side = "R";
        }
      }
      // The picture's TRUE vertical offset (px) from its anchor paragraph: a small/negative
      // value sits beside the text ABOVE it, a larger positive value sits lower — beside the
      // following paragraph. Used to order stacked figures and pair each with the right
      // paragraph, so it must keep the real magnitude (never clamped — a large drop is
      // exactly what tells us the picture belongs far below its anchor).
      const voff = Math.round(verticalOffset / 9525);
      recs.push({ pos: dm.index, rid, w: ext.w, h: ext.h, crop: parseCrop(d), floatingBelowText: verticalOffset >= 1000000, side, voff });
    }
    // For the VML scan, drop <mc:Fallback> regions: when a picture is stored as an
    // <mc:AlternateContent> pair, the modern <a:blip> (from <mc:Choice>, already
    // captured above) and the legacy <v:imagedata> fallback are the SAME image —
    // counting the fallback too would duplicate it. Standalone OLE/VML pictures
    // (the common case here) live outside AlternateContent and are unaffected.
    const xv = x.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
    for (const vm of xv.matchAll(/<v:imagedata[^>]*r:id="([^"]+)"[^>]*>/g)) {
      const rid = vm[1];
      // the enclosing <v:shape …> carries the on-page size as CSS points (pt→px @96dpi)
      const before = xv.slice(Math.max(0, vm.index - 600), vm.index);
      const sm = before.match(/style="[^"]*?width:\s*([\d.]+)pt;\s*height:\s*([\d.]+)pt/i);
      recs.push({ pos: vm.index, rid, w: sm ? +sm[1] * 4 / 3 : 0, h: sm ? +sm[2] * 4 / 3 : 0 });
    }
    recs.sort((a, b) => a.pos - b.pos);
    const out = [];
    for (const rec of recs) {
      const rid = rec.rid;
      if (!rels[rid]) continue;
      const base = path.basename(rels[rid]);
      if (removeImages.has(base)) continue;                  // dropped by override
      // A per-book override may replace a specific source image (e.g. swap a
      // stock photo for a contextualised one). The override file stands in for
      // the original everywhere — bytes copied AND aspect/size read from it.
      const ovrEntry = imgOverrides[base];
      const ovr = ovrEntry && ovrEntry.src;
      const useOvr = ovr && fs.existsSync(ovr);
      const src = useOvr ? ovr : path.join(tmp, "word", rels[rid]);
      if (!fs.existsSync(src)) continue;                       // skip missing
      // EMF (and WMF) can't be read by Typst, so they were skipped entirely and their
      // picture went missing. Most are just a raster bitmap wrapped in an EMF, which we
      // can extract to PNG at copy time — so let EMF through, flagged for conversion,
      // rather than dropping it. Other unsupported vector formats are still skipped.
      const isEmf = /\.emf$/i.test(src) && !useOvr;
      if (!isEmf && BAD_IMG.test(src)) continue;               // skip other unsupported formats
      // The output name keeps the override's real extension so Typst decodes it
      // correctly (a .png served under a .jpeg name fails to load).
      // Word keeps the FULL original picture in media/ and stores a crop rectangle
      // (<a:srcRect>) that hides the rest — authors crop a pasted screenshot down to
      // just the diagram, so ignoring it renders the whole Word window/UI. Apply the
      // crop on extraction. A replacement image (override) is already clean, so it is
      // never cropped. A cropped picture is re-encoded to PNG, so force a .png name.
      const crop = useOvr ? null : rec.crop;
      let outBase = useOvr ? path.basename(base, path.extname(base)) + path.extname(ovr) : base;
      if (crop) outBase = outBase.replace(/\.jpe?g$/i, ".png");
      if (isEmf) outBase = outBase.replace(/\.emf$/i, ".png");   // extracted to PNG at copy
      // Word occasionally saves a picture with the WRONG extension (a pasted PNG kept
      // inside media/ as "imageNN.jpg" — the bytes are a real PNG, only the name lies).
      // Typst decodes strictly by extension, so a mismatch fails the whole build with an
      // opaque "Illegal start bytes" error. Sniff the real format from the file's magic
      // bytes and correct the extension before it's baked into the Typst reference — the
      // bytes themselves need no re-encoding, only the name has to tell the truth.
      if (!isEmf && !crop) {
        try {
          const fd = fs.openSync(src, "r");
          const head = Buffer.alloc(8);
          fs.readSync(fd, head, 0, 8, 0);
          fs.closeSync(fd);
          const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
          const isJpg = head[0] === 0xff && head[1] === 0xd8;
          const ext = path.extname(outBase).toLowerCase();
          if (isPng && ext !== ".png") outBase = outBase.slice(0, -ext.length) + ".png";
          else if (isJpg && ext !== ".jpg" && ext !== ".jpeg") outBase = outBase.slice(0, -ext.length) + ".jpg";
        } catch (_) { /* sniff best-effort; fall through with the original name */ }
      }
      const name = imgPrefix + outBase;
      mediaOut.push({ src, name, crop, emf: isEmf });
      let dispW = rec.w || 0, dispH = rec.h || 0;
      if (dispW && dispH && dispW < 16 && dispH < 16) continue;  // tiny spacer/artifact, not content
      // an override may force on-page width — either alongside a replacement image, or
      // width-only (no src) to resize the author's own picture (e.g. shrink an opener
      // that would otherwise strand its unit banner on a near-empty page)
      if (ovrEntry && ovrEntry.w) { dispW = ovrEntry.w; dispH = 0; }
      const real = imageSize(src);                            // true pixels (aspect is reliable)
      // aspect must reflect the CROPPED region (its width/height ratio), not the full file
      const aspect = crop && real && real.w
        ? (real.h * (1 - crop.t - crop.b)) / (real.w * (1 - crop.l - crop.r))
        : (real && real.w ? real.h / real.w : (dispW ? dispH / dispW : 1));
      // hmm: force the on-page display HEIGHT (mm). Needed to enlarge a `tall`
      // picture, which the template otherwise pins to a fixed height regardless of w.
      const forceH = ovrEntry && ovrEntry.hmm ? ovrEntry.hmm : 0;
      out.push({ file: name, w: dispW, h: dispH, tall: aspect > 1.05, caption: rawFigCaptions[base] || "", hmm: forceH, floatingBelowText: !!rec.floatingBelowText, side: rec.side || null, voff: rec.voff || 0 });
    }
    return out;
  };
  imgResolve = imagesOf; // make image extraction available to cell parsing

  // Does this book mark text with a bold + coloured run (PE house style uses
  // navy headings)? If so, a bold-black line is a label; otherwise a short bold
  // line is likely a section heading.
  // The "series" books are reliably styled with Word heading styles, so we map
  // levels from those styles (not from a colour/size heuristic): a bold-black
  // line there is a sub-subheading, not a label.
  const colorHeads = !styled && parts.some((x) =>
    !isTbl(x) && /<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<w:b\b(?!Cs)(?:(?!<\/w:rPr>)[\s\S])*<w:color\s+w:val="(?!auto|000000)[0-9A-Fa-f]{6}"/.test(x));

  // ---- front-matter detection (only when the book clearly has one) ----
  const hasTocStyle = parts.some((x) => /<w:pStyle\s+w:val="TOC\d/.test(x));
  const copyrightIdx = parts.findIndex((x) => !isTbl(x) && /all rights reserved|©|umwini wonse|osalembanso/i.test(textOf(x)));
  const tocPartIdx = parts.findIndex((x) => !isTbl(x) && /^(TABLE OF CONTENTS|NYITAN?CHI YAYIBALU|ZAM.?KATI)$/i.test(textOf(x)));
  // The imprint (copyright/credits) page is centred plain text in the original.
  // It ends at the TOC, the next styled heading, or a safety cap — whichever is
  // first — so a book WITHOUT a TOC doesn't treat its whole body as imprint.
  // Front-matter section names (English + local) — the imprint ends where the
  // first real section begins, even when the manuscript didn't style it as a
  // Word heading (many don't). This stops the imprint's centred styling from
  // bleeding into the Authors/Foreword text.
  const FM_SECTION = /^(THE\s+)?AUTHORS?$|^EDITORS?$|^FOREW(O|A)RD$|^PREFACE$|^ACKNOWLEDG|^INTRODUCTION$|^KEY COMPETEN|^ACRONYMS\b|^LIST OF (TABLES|FIGURES)$|^ANSONEKI$|^MAZU ATACHI$|^KULEMA\b.*\bWUNU$|^KUSAKILILA$|^KULUMBULULA$/i;
  let imprintEnd = tocPartIdx >= 0 ? tocPartIdx : parts.length;
  if (copyrightIdx >= 0) {
    for (let i = copyrightIdx + 1; i < imprintEnd; i++) {
      // stop at the first styled heading OR the first front-matter section name
      if (!isTbl(parts[i]) && (/Heading\d/.test(styleOf(parts[i])) || FM_SECTION.test(textOf(parts[i])))) { imprintEnd = i; break; }
    }
    // Safety cap so a book without a TOC or any detectable section never treats
    // its whole body as imprint.
    if (tocPartIdx < 0) imprintEnd = Math.min(imprintEnd, copyrightIdx + 40);
  }
  const inImprint = (i) => copyrightIdx >= 0 && i >= copyrightIdx && i < imprintEnd;

  // A hand-typed table of contents is a run of >= 3 dot-leader lines (we generate
  // our own TOC, so drop them). Isolated dotted lines (e.g. "ISBN ……") are kept.
  // A genuine TOC entry ends in a PAGE NUMBER ("Foreword …… 3"); require that, so a
  // run of fill-in exercise blanks ("b + e + n + d = ………", "c + a + t = ………") — which
  // end in dots with no page number — is NOT mistaken for a contents list and dropped.
  const tocJunk = new Set();
  {
    let run = [];
    const flush = () => { if (run.length >= 3) run.forEach((k) => tocJunk.add(k)); run = []; };
    for (let i = 0; i < parts.length; i++) {
      if (isTbl(parts[i])) { flush(); continue; }
      const t = textOf(parts[i]);
      if (t === "") continue;                          // blanks don't break the run
      if (/[.…]{4,}\s*\[?\d+\]?\s*$/.test(t)) run.push(i); else flush();
    }
    flush();
  }

  // First run's font size (half-points; 32 = 16pt). Some manuscripts size their
  // headings by hand instead of using Word heading styles — when a book barely
  // uses styled headings, infer heading level from a bold line's font size.
  const sizeOf = (x) => parseInt(((x.match(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/) || [])[1] || "").match(/<w:sz\s+w:val="(\d+)"/)?.[1] || "0", 10);
  const boldFirstRun = (x) => {
    const r = (x.match(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/) || [])[1] || "";
    const rpr = (r.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || "";
    return /<w:b\b(?!Cs)/.test(rpr);
  };
  const startBody = copyrightIdx >= 0 ? copyrightIdx : 0;
  const styledBodyHeads = parts.filter((x, i) => !isTbl(x) && hmap[styleOf(x)] && i > startBody).length;
  // Use size-based heading inference when the book's headings are mostly hand-
  // sized (bold + large, no Word heading style) rather than styled — even if a
  // few stray styled headings exist.
  const unstyledBigHeads = parts.filter((x, i) =>
    !isTbl(x) && i > startBody && boldFirstRun(x) && sizeOf(x) >= 27 && !hmap[styleOf(x)]).length;
  const sizeHeads = !styled && unstyledBigHeads >= 8 && unstyledBigHeads > styledBodyHeads;
  // Some books have an explicit CHAPTER level above topics (Cinyanja: CAPAMUTU).
  // When they do, chapters are the page-breaking top level and the large strand/
  // topic headings below them flow as sections. When they don't (Lunda), the
  // large headings ARE the topics and become the page-breaking top level.
  const CHAP = /^(CAPAMUTU|CHAPUTALA|CHAPTER|UNIT)\b/i;
  const SUBTOPIC = /^MUTU\s+WAUNG.ONO/i;             // Cinyanja explicit sub-topic
  const hasChapters = parts.some((x) => !isTbl(x) && sizeOf(x) >= 31 && CHAP.test(textOf(x)));
  // Books that number their own topics ("TOPIC 3.1:" + "SUB-TOPIC 3.1.1:") — e.g.
  // the primary Teacher's Guides. Here the heading LEVEL must come from the number
  // pattern, not the font size, because other bold sub-labels ("Introduction",
  // "Specific Competence") share the sub-topic's size and would otherwise be
  // mistaken for sub-topics (and pollute the contents page).
  // Tolerate any mix of hyphen/space between "SUB" and "TOPIC" ("SUB-TOPIC",
  // "SUB TOPIC", "SUBTOPIC", and the stray-space typo "SUB- TOPIC") so an
  // inconsistently-typed sub-topic still registers as a level-2 heading (and so
  // reaches the contents) instead of being demoted to a plain body sub-head.
  const NUMTOPIC = /^TOPIC\s+\d/i, NUMSUB = /^SUB[-\s‐-―]*TOPIC\s*\d/i;
  const hasNumberedTopics = !hasChapters
    && parts.some((x) => !isTbl(x) && NUMTOPIC.test(textOf(x)))
    && parts.some((x) => !isTbl(x) && NUMSUB.test(textOf(x)));
  // The first body topic marks the end of the front matter; front-matter section
  // headings are promoted to top level so each starts its own page.
  // Some manuscripts (e.g. the primary Teacher's Guides) apply Word heading styles
  // semantically wrong — content sub-heads and even body prose are tagged
  // Heading2/Heading3. For a flowing book that numbers its own topics, the text
  // pattern ("TOPIC 3.1" / "SUB-TOPIC 3.1.1") is the trustworthy structure, so we
  // ignore the styles and let classifyPara derive levels from the pattern.
  const ignoreStyles = sizeHeads || (hasNumberedTopics && flat);
  let firstTopicIdx = Infinity;
  if (hasNumberedTopics) {
    const k = parts.findIndex((x) => !isTbl(x) && NUMTOPIC.test(textOf(x)));
    if (k >= 0) firstTopicIdx = k;
  } else if (sizeHeads) {
    for (let i = 0; i < parts.length; i++) {
      const x = parts[i]; if (isTbl(x) || !boldFirstRun(x) || sizeOf(x) < 31) continue;
      const t = textOf(x);
      if (hasChapters ? CHAP.test(t) : /^\d/.test(t)) { firstTopicIdx = i; break; }
    }
  }
  // bold + large => heading level (1/2/3) or 0.
  const sizeHeadLevel = (x, i) => {
    if (!sizeHeads || isTbl(x) || !boldFirstRun(x)) return 0;
    const s = sizeOf(x), t = textOf(x), front = i < firstTopicIdx;
    if (boxKindFromTitle(t)) return 0;              // a box label is not a heading
    if (hasNumberedTopics) {
      // level strictly by the number pattern; other bold-large lines fall through
      // to classifyPara (which makes them a "head", not an outlined sub-topic).
      if (NUMTOPIC.test(t)) return 1;
      if (NUMSUB.test(t)) return 2;
      if (front && s >= 27) return 1;               // a front-matter section heading
      return 0;
    }
    if (hasChapters) {
      if (CHAP.test(t) && s >= 27) return 1;        // chapter -> own page
      if (front && s >= 27) return 1;               // front-matter section -> own page
      if (SUBTOPIC.test(t)) return 3;               // sub-topic
      if (s >= 31) return 2;                         // strand / topic heading
      if (s >= 27) return 3;                         // sub-heading
      return 0;
    }
    if (s >= 31) return 1;                           // ~16pt+ -> topic
    if (s >= 27) return front ? 1 : 2;              // ~14pt -> front-matter top level, else section
    return 0;
  };

  let cover = null, coverEnd = -1, gluedCover = false;
  // Some authors glue the entire finished cover artwork INTO the copyright
  // paragraph (so `copyrightIdx === 0` and the "images before the copyright" scan
  // finds nothing). Left as-is, that raster renders as a shrunk thumbnail sitting
  // on top of the imprint text. For a science/series book we instead synthesise a
  // designed cover from the theme and strip the glued artwork out of the imprint.
  if (copyrightIdx === 0 && textCover && imagesOf(parts[0]).some((im) => im.w >= 200)) {
    cover = { hero: null, lines: [], byline: [], logo: null };
    coverEnd = -1;              // consumes no source block; part[0] stays as the imprint
    gluedCover = true;
  }
  if (copyrightIdx > 0) {
    // hero = largest image before the copyright line; everything before the
    // copyright belongs on the cover (title at top, author + logo at the bottom).
    let heroIdx = -1, heroArea = 0;
    for (let i = 0; i < copyrightIdx; i++) {
      if (isTbl(parts[i])) continue;
      for (const im of imagesOf(parts[i])) {
        if (im.w >= 200 && im.w * im.h > heroArea) { heroArea = im.w * im.h; cover = { hero: im }; heroIdx = i; }
      }
    }
    // The series/science layouts always have a designed cover, even with no hero.
    if (!cover && textCover) cover = { hero: null };
    if (cover) {
      // Title lines are the large-font cover text (subject / grade / book type);
      // the byline is the smaller text (authors). A section heading ends the cover.
      const big = parts.slice(0, copyrightIdx).filter((p) => !isTbl(p) && sizeOf(p) >= 36).length >= 2;
      const lines = [], byline = [];
      let logo = null;
      for (let i = 0; i < copyrightIdx; i++) {
        if (isTbl(parts[i])) continue;
        for (const im of imagesOf(parts[i])) if (im.w < 200 && !logo) logo = im; // small publisher logo
        const t = textOf(parts[i]); if (!t) continue;
        const big1 = sizeOf(parts[i]) >= 36;
        if (big ? big1 : i <= heroIdx) lines.push(t);
        else if (boldFirstRun(parts[i]) && sizeOf(parts[i]) >= 27) break;        // heading ends cover
        else byline.push(t);
      }
      // Keep only real author names in the byline: drop an "(NAMES OF) AUTHORS"
      // header, title fragments (e.g. a duplicate "PHYSICS FORM 4" from the
      // image-bearing title paragraph), grade lines, and stray junk like "]".
      cover.lines = lines;
      cover.byline = byline.filter((t) => {
        const s = t.trim();
        if (s.length <= 2) return false;
        if (/^(names of authors|authors)$/i.test(s)) return false;
        if (/\b(form|grade)\s+\d/i.test(s)) return false;
        if (lines.includes(s)) return false;
        return true;
      });
      cover.logo = logo;
      coverEnd = copyrightIdx - 1;
    }
  }

  // ---- paragraph-based boxes ----
  // Some books don't put Learning Activities / Exercises in a table — they just
  // write a bold label line (e.g. "MUDIMU", "ZHAKWILA ATUDIZI 1: …") followed by
  // the content. Detect those: a bold label paragraph starts a box, and the
  // following non-empty lines (up to a blank line, heading, table, or next box)
  // are its body. Maps start-index -> { kind, end, labelSegs, body[] }.
  const paraBox = new Map();
  for (let i = 0; flat ? false : i < parts.length; i++) {  // flat layout: no callout boxes (activities/exercises flow as headings)
    const x = parts[i];
    if (isTbl(x) || inImprint(i)) continue;
    const text = textOf(x);
    const kind = text && boxKindFromTitle(text);
    if (!kind || !boldFirstRun(x)) continue;
    const bodyIdx = [];
    let lastContent = -1;
    for (let j = i + 1; j < parts.length; j++) {
      const y = parts[j];
      const ty = textOf(y);
      if (/Heading\d/.test(styleOf(y)) || sizeHeadLevel(y, j)) break; // a heading ends it
      if (SECTION_RE.test(ty)) break; // a numbered heading (no Word style)
      if (boxKindFromTitle(ty) && boldFirstRun(y)) break;        // the next box label
      // An End-of-Topic assessment runs to the next section: its questions are
      // interleaved with diagrams to read and data tables, and separated by blank
      // gaps — none of which should end it. Other boxes still stop at the first
      // blank line or table (their body is a tight block of lines).
      if (kind === "assessment") {
        bodyIdx.push(j);
        if (isTbl(y) || ty || imagesOf(y).length) lastContent = bodyIdx.length - 1;
        continue;
      }
      if (isTbl(y)) break;
      if (!ty) break;                                            // blank line ends the box
      bodyIdx.push(j);
      lastContent = bodyIdx.length - 1;
    }
    if (lastContent >= 0) bodyIdx.length = lastContent + 1;       // trim trailing blank lines
    if (bodyIdx.length) paraBox.set(i, { kind, end: bodyIdx[bodyIdx.length - 1], labelSegs: paraSegs(x), title: text, body: bodyIdx });
  }

  // ---- walk the parts ----
  for (let i = 0; i < parts.length; i++) {
    if (cover && i === 0) {
      blocks.push({ t: "cover", lines: cover.lines, byline: cover.byline, hero: cover.hero, logo: cover.logo });
      // A glued-in cover artwork lives inside the copyright paragraph: drop the
      // drawing so it doesn't reappear as a thumbnail, then fall through to render
      // part[0] as the (image-free) imprint. Otherwise skip the consumed source.
      if (gluedCover) parts[0] = parts[0].replace(/<w:drawing\b[\s\S]*?<\/w:drawing>/g, "").replace(/<w:pict\b[\s\S]*?<\/w:pict>/g, "");
      else { i = coverEnd; continue; }
    }
    const x = parts[i];

    // an un-boxed Learning Activity / Exercise / Assessment detected above
    if (paraBox.has(i)) {
      const b = paraBox.get(i);
      if (b.kind === "assessment") {
        // Classify each body part as buildQAParts expects (numbered question with
        // its marker/numId, sub-part, diagram or data table) so it numbers the
        // questions 1..N and sub-parts a..z straight across the diagrams.
        const bodyBlocks = b.body.map((k) => {
          const y = parts[k];
          if (isTbl(y)) { const rows = parseTableRows(tables[parseInt(y.match(/\d+/)[0], 10)]); return rows.length ? { t: "table", rows } : null; }
          const imgs = imagesOf(y);
          if (imgs.length) return { t: "img", images: imgs };
          const segs = paraSegs(y);
          const plain = plainOf(segs).trim();
          if (!plain) return null;
          if (/<w:numPr>/.test(y)) { const li = listResolve(y); return { t: "para", segs: stripBullet(segs), plain, marker: li ? li.marker : null, isList: true, numId: li ? li.numId : null, lvl: li ? li.lvl : null }; }
          return { t: "para", segs, plain, isList: false };
        }).filter(Boolean);
        blocks.push({ t: "assessment", title: b.title, intro: [], parts: buildQAParts(bodyBlocks), extra: [] });
        i = b.end;
        continue;
      }
      const body = b.body.map((k) => { const segs = paraSegs(parts[k]); return { t: "para", segs, plain: plainOf(segs).trim(), isList: false }; });
      blocks.push(makeBox(b.kind, [{ t: "para", segs: b.labelSegs, plain: b.title, isList: false }, ...body]));
      i = b.end;
      continue;
    }

    if (isTbl(x)) {
      const cells = cellsOf(tables[parseInt(x.match(/\d+/)[0], 10)]);
      if (!cells.length) continue;
      const firstFill = cells[0][0].fill;
      // The box label ("EXERCISE 1", "LEARNING ACTIVITY 2"…) is usually the first
      // paragraph, but a disorganised manuscript may glue it onto an image
      // paragraph — so look at the first block of ANY type that carries text.
      const firstBlks = cellBlocks(cells[0][0].xml);
      const lead = (firstBlks.find((b) => (b.plain || "").trim()) || {}).plain || "";
      const kind = boxKindFromTitle(lead) || BOX_FILL[firstFill];
      const single = cells.length === 1 && cells[0].length === 1;
      if (kind === "assessment") blocks.push(makeAssessmentTable(cells));
      else if (kind) blocks.push(makeBox(kind, firstBlks));
      else if (single && firstFill && firstFill !== NAVY) blocks.push(makeBox("box", firstBlks));
      else {
        const rows = cells.map((row) => row.map((c) => cellRich(c.xml)));
        // A 1×1 "table" holding only picture(s) — no text — is just an image the
        // author dropped into a table cell; emit it as a real image (not a bordered,
        // empty-looking table) so it isn't lost. (cellRich returns `imgs`, an array —
        // an earlier `c.img` guard here silently discarded such image-only tables.)
        const oneCell = single ? rows[0][0] : null;
        if (oneCell && !oneCell.text && oneCell.imgs && oneCell.imgs.length) {
          blocks.push(oneCell.imgs.length === 1 ? { t: "image", ...oneCell.imgs[0] } : { t: "imagerow", images: oneCell.imgs });
        } else if (rows.some((r) => r.some((c) => c.text || (c.imgs && c.imgs.length)))) {
          blocks.push({ t: "table", rows });
        }
      }
      continue;
    }

    // Table of contents: replace the source's TOC (or a bare TOC heading
    // placeholder, in any supported language) with a freshly generated one, and
    // drop the hand-typed entry lines that follow. Entries may be dot-leadered
    // ("Foreword …… 3") OR bare lines with no leaders (a section name or
    // "CHIBALU N: …" per line). Drop the contiguous run of short, heading-like
    // lines; stop at the first real section header — recognised because the line
    // that follows IT is a substantial body paragraph (the section's prose).
    if (/^(TABLE OF CONTENTS|NYITAN?CHI YAYIBALU|ZAM.?KATI)$/i.test(textOf(x))) {
      blocks.push({ t: "toc" });
      let j = i + 1;
      const bodyLen = (k) => (k < parts.length && !isTbl(parts[k]) ? textOf(parts[k]).length : 0);
      while (j < parts.length && !isTbl(parts[j])) {
        const t = textOf(parts[j]);
        // A genuine "List of Figures" / "List of Tables" section (its heading or a
        // TableofFigures-styled entry) is real front matter, not hand-typed TOC
        // junk — stop dropping so it is kept and rendered. But a bare
        // "LIST OF FIGURES" line sitting INSIDE the contents list (followed by
        // more contents entries, e.g. "HOW TO USE THIS BOOK" then the dotted
        // topic list) is itself a table-of-contents entry: drop it and keep
        // scanning until the REAL section (whose next line is a "Figure N:" /
        // "Table N:" entry or substantial body prose) is reached.
        if (/^tableoffigures$/i.test(styleOf(parts[j]))) break;
        if (/^LIST OF (FIGURES|TABLES)$/i.test(t)) {
          let n = j + 1;
          while (n < parts.length && !isTbl(parts[n]) && textOf(parts[n]) === "") n++;
          const nextT = n < parts.length && !isTbl(parts[n]) ? textOf(parts[n]) : "";
          if (/^(figure|table)\s+\d+\b/i.test(nextT) || nextT.length >= 90) break;  // real section
          j++; continue;                                                            // contents entry — drop
        }
        if (t === "") { j++; continue; }                                   // blank padding
        if (/[.…]{2,}\s*\[?\d+\]?\s*$/.test(t)) { j++; continue; }          // dot-leader entry
        if (/^(CHIBALU|CIPATI)\s*\d+\b/i.test(t)) { j++; continue; }        // a unit entry (may be long)
        // The genuine first section heading ("UNIT 1: …") carries a real heading
        // STYLE (Heading1) or a large font — unlike its same-named contents entry,
        // which is styled TOC1/TOC2 at a smaller size. Stop dropping here so the
        // real heading is kept, even when a short SUBTITLE line ("Children's
        // Rights") sits between it and the body prose (which would otherwise fail
        // the "next line is long body prose" test below and drop the heading).
        if (SECTION_RE.test(t)
            && (/^heading\s*\d/i.test(styleOf(parts[j])) || sizeOf(parts[j]) >= 28)) break;
        // A short heading-like line: a TOC entry to drop UNLESS it's the real
        // first section header (its next non-blank line is long body prose).
        if (t.length < 60) {
          // Peek at the next REAL line, skipping over further TOC entries (blank
          // padding, dot-leadered lines, and numbered TOPIC/UNIT rows). Otherwise a
          // bare section name sitting just above the dotted topic list (e.g. a
          // stray "HOW TO USE THIS BOOK") would be mistaken for a real header.
          const isTocEntry = (s) => s === "" || /[.…]{2,}\s*\[?\d+\]?\s*$/.test(s)
            || SECTION_RE.test(s) || /^(CHIBALU|CIPATI)\s+[\d.]/i.test(s) || /^GLOSSARY\b/i.test(s);
          let n = j + 1;
          while (n < parts.length && !isTbl(parts[n]) && isTocEntry(textOf(parts[n]))) n++;
          if (bodyLen(n) >= 90) break;     // real section header — keep it (stop dropping)
          j++; continue;                   // bare TOC entry — drop
        }
        break;                             // anything else ends the TOC region
      }
      i = j - 1;
      continue;
    }
    // A real "List of Figures" / "List of Tables" section: keep the heading and
    // render its "Figure N: … page" / "Table N: …" entries as proper contents
    // lines (loentry). The entries carry manual dot leaders, so without this they
    // would be swallowed by the dot-leader TOC-junk drop, leaving the heading
    // orphaned. (The TABLE OF CONTENTS drop above already discards any *contents*
    // copy of this heading, so only the genuine section reaches here.)
    if (/^LIST OF (FIGURES|TABLES)$/i.test(plainOf(paraSegs(x)).trim())) {
      const kind = /TABLES/i.test(textOf(x)) ? "Table" : "Figure";
      // The figure/table number can be a bare "1" OR a dotted "topic.figure" code like
      // "1.3" / "5.2" (this manuscript numbers figures by topic) — capture the whole run
      // of digits/dots so the real number is kept together, not split at the first dot.
      const entryRe = new RegExp(`^(${kind}\\s+\\d+(?:\\.\\d+)*)\\s*:?\\s*(.*)$`, "i");
      let j = i + 1, kept = 0;
      const pending = [];
      while (j < parts.length && !isTbl(parts[j])) {
        const raw = textOf(parts[j]).trim();
        if (raw === "") { j++; continue; }                         // blank padding
        // pull the trailing page number (if any), then strip the dot leaders
        const pageM = raw.match(/(\d{1,3})\s*$/);
        const page = pageM ? pageM[1] : "";
        const bodyTxt = (page ? raw.slice(0, raw.length - pageM[0].length) : raw)
          .replace(/[.\s…]+$/, "").trim();
        const em = bodyTxt.match(entryRe);
        if (!em) {
          // A long title the author manually line-wrapped mid-sentence lands as its OWN
          // paragraph with no "Figure N" marker (e.g. "…and Breaking-" / "Through Games").
          // Treat it as a CONTINUATION of the previous entry's title, not the section's
          // end — otherwise every entry after the wrap silently falls out of the list.
          // never absorb a real heading ("LIST OF TABLES", the next section) as if it
          // were a wrapped continuation — an ALL-CAPS line is always a heading, never a
          // caption fragment (those keep normal sentence case).
          const looksLikeHeading = bodyTxt === bodyTxt.toUpperCase() && /[A-Z]/.test(bodyTxt);
          if (kept && pending.length && bodyTxt.length > 0 && bodyTxt.length <= 60 && !looksLikeHeading) {
            pending[pending.length - 1].title = `${pending[pending.length - 1].title} ${bodyTxt}`.trim();
            j++; continue;
          }
          break;                                                    // section ended
        }
        // some sources leave a stray "." after the colon ("Figure 1: . Title") —
        // drop leading stray punctuation so the caption starts at the real title.
        pending.push({ t: "loentry", num: em[1], title: em[2].replace(/^[.\s]+/, "").trim(), page });
        kept++; j++;
      }
      if (kept) {
        blocks.push({ t: "h1", text: `LIST OF ${kind.toUpperCase()}S` });
        blocks.push(...pending);
        i = j - 1;
        continue;
      }
      // no entries followed — fall through (a bare orphan heading is dropped)
      continue;
    }
    if (tocJunk.has(i)) continue;  // a hand-typed TOC entry (we generate our own)
    if (hasTocStyle && /^TOC/i.test(styleOf(x))) continue; // drop source TOC lines + "CONTENTS" heading

    // A paragraph may carry images plus heading or caption text. Don't drop the
    // text: an inline "Figure N:" caption attaches to the images; otherwise the
    // heading/text is emitted in its true position relative to the image (the
    // run order in the paragraph), so e.g. an opener image followed by an
    // "Introduction" heading keeps that order.
    const imgs = imagesOf(x);
    if (imgs.length) {
      const text = textOf(x);
      // Build the emitted block LAZILY — after any caption assignment — because a
      // single-image block spreads `imgs[0]` into a new object, so a caption set on
      // imgs[0] AFTER the spread would be lost (an inline "Figure N:" caption that
      // shares the paragraph with the picture, common for OLE/pasted images).
      const mkImgBlock = () => (imgs.length === 1 ? { t: "image", ...imgs[0] } : { t: "imagerow", images: imgs });
      if (/^fig(?:ure)?\.?\s*\d+\s*[:.]/i.test(text)) {
        const caps = text.split(/(?=Fig(?:ure)?\.?\s*\d+\s*[:.])/i).map((s) => s.trim()).filter(Boolean);
        imgs.forEach((im, k) => { im.caption = caps[k] || im.caption || ""; });
        blocks.push(mkImgBlock());
      } else if (text && !/^[.·•…\/\\|]{1,3}$/.test(text.trim()) && !/^[A-Za-z]$/.test(text.trim())) {
        // (a lone "." or stray single letter that merely anchors the image is
        // dropped — only the image is kept)
        const textBlk = classifyPara(x, paraSegs(x), ignoreStyles ? undefined : hmap[styleOf(x)], colorHeads, flat);
        // A heading always comes BEFORE its illustration (a topic image belongs
        // under the topic title, not above it), regardless of run order;
        // otherwise keep the paragraph's natural image/text order.
        const isHeading = /^h[123]$/.test(textBlk.t) || textBlk.t === "head";
        // A Word floating picture can occur first in the XML but be positioned
        // well below its paragraph's text. In that case, preserve the visual
        // reading order (text, then picture), not the XML run order. A tiny
        // offset is ordinary image-above-text placement, so only treat offsets
        // of about 1.1 inches or more (1,000,000 EMU) as a lower illustration.
        const floatingBelowText = imgs.some((im) => im.floatingBelowText);
        // Where the picture sits relative to the text in run order (a picture may
        // be a modern <a:blip> OR a legacy VML/OLE <v:imagedata>).
        const imgAt = Math.min(...[x.search(/<a:blip\b/), x.search(/<v:imagedata\b/)].filter((n) => n >= 0).concat([Infinity]));
        // A side-figure (a narrow float the author placed beside the text) must sit AFTER
        // its anchor text, so the pairing pass can attach it to the paragraph it flows next
        // to — never image-first, which would strand it above its own introductory line.
        const isSideFig = imgs.some((im) => im.side);
        const imgFirst = !isSideFig && !isHeading && !floatingBelowText && imgAt < x.search(/<w:t\b[^>]*>/);
        if (imgFirst) { blocks.push(mkImgBlock()); blocks.push(textBlk); }
        else { blocks.push(textBlk); blocks.push(mkImgBlock()); }
      } else {
        blocks.push(mkImgBlock());
      }
      continue;
    }

    const segs = paraSegs(x);
    if (!plainOf(segs).trim()) continue;
    // List of Figures / List of Tables entries (Word "TableofFigures" style):
    // render as a proper contents-style line (bold "Figure N"/"Table N" label,
    // the caption, and a right-aligned page number) instead of a centred figure
    // caption. In the source the page number is glued onto the end of the text
    // (e.g. "…Paper Method44"), so split the trailing digits off.
    if (/^tableoffigures$/i.test(styleOf(x))) {
      const plain = plainOf(segs).trim();
      const pm = plain.match(/^(.*?)(\d{1,3})\s*$/);
      const body = (pm ? pm[1] : plain).trim().replace(/\s*:\s*$/, "");
      const page = pm ? pm[2] : "";
      const lm = body.match(/^((?:Figure|Table)\s+\d+)\s*:?\s*(.*)$/i);
      blocks.push({ t: "loentry", num: lm ? lm[1] : "", title: lm ? lm[2].trim() : body, page });
      continue;
    }
    if (/^[.·•…\/\\|]{1,3}$/.test(plainOf(segs).trim())) continue;  // stray punctuation-only line (a lone "." or "/")
    if (/^[A-Za-z]$/.test(plainOf(segs).trim())) continue;  // stray single letter (manuscript artifact, e.g. a lone "s")
    if (/^(Top|Bottom) of Form$/i.test(plainOf(segs).trim())) continue;  // Word form-field artifact (from a protected/form section)
    // imprint page: centred plain text. Long runs of spaces were used as
    // pseudo line-breaks (e.g. the publisher address), so turn them into real
    // line breaks and collapse the rest.
    if (inImprint(i)) {
      const plain = plainOf(segs).trim();
      // Give the imprint room to breathe: a larger gap separating the ISBN/
      // credits from the copyright statement, and a gap before each credit label
      // (Edited by / Illustrated by / Cover and Book Layout / Published / Printed)
      // so each credit reads as its own group rather than a squeezed list.
      if (/^ISBN\b/i.test(plain)) blocks.push({ t: "vspace", h: "8mm" });
      else if (boldFirstRun(x)) blocks.push({ t: "vspace", h: "5mm" });
      const segs2 = segs.map((s) => ({ ...s, t: s.t.replace(/\s{5,}/g, "\n").replace(/ {2,}/g, " ") }));
      blocks.push({ t: "para", segs: segs2, align: "center" });
      continue;
    }
    // size-inferred heading (books that style headings by hand)
    const lvl = sizeHeadLevel(x, i);
    if (lvl) { blocks.push({ t: "h" + lvl, text: plainOf(segs).trim() }); continue; }
    // a Word auto-numbered/bulleted list item: keep the writer's real marker
    // (a, b, c / 1, 2, 3 / i, ii) instead of forcing a bullet.
    if (/<w:numPr>/.test(x) && (ignoreStyles || !hmap[styleOf(x)])) {
      const li = listResolve(x);
      blocks.push({ t: "listitem", segs: stripBullet(segs), marker: (li && li.marker) || listMarker(x),
        numId: li ? li.numId : null, lvl: li ? li.lvl : null });
      continue;
    }
    // Numbered-topic books: a SHORT paragraph the writer styled as a Word heading
    // is a bold sub-head (label / content heading), even if the runs were not
    // bolded — this normalises the manuscript's inconsistent formatting (some
    // topics bold these lines, others only style them). Long "heading"-styled
    // paragraphs are mis-styled prose, and numbered competence codes stay body.
    if (hasNumberedTopics && flat && hmap[styleOf(x)]) {
      const plain = plainOf(segs).trim();
      if (plain && plain.length <= 70
          && !SECTION_RE.test(plain)
          && !/^\d+(\.\d+)+\b/.test(plain)                 // not a competence code
          && !/^\(?[A-Za-z0-9]{1,3}[).]\s/.test(plain)     // not an enumerated item "a) …"
          && !/^[•▪‣·–-]\s/.test(plain)                    // not a bullet line
          && !/^\(/.test(plain)                            // not a parenthetical note "(Any two)"
          && !/[.!?]$/.test(plain)                         // not a full sentence (prose)
          && !/^(in this sub|by the end)/i.test(plain)     // not a lead-in sentence
          && !boxKindFromTitle(plain)) {
        blocks.push({ t: "head", text: plain });
        continue;
      }
    }
    const blk = classifyPara(x, segs, ignoreStyles ? undefined : hmap[styleOf(x)], colorHeads, flat);
    if (blk.t === "para") {
      const a = alignOf(x);
      // Honour the writer's centre/right justification for prose — but NOT for a
      // paragraph that is essentially just an equation (has math, no real prose
      // word). The authors centred some stand-alone equations; house style is to set
      // every equation flush LEFT so a working scans straight down, so we drop the
      // centring there and let it fall to the default left alignment.
      const eqOnly = (segs || []).some((s) => s.m) && !/[A-Za-z]{4,}/.test((segs || []).filter((s) => !s.m).map((s) => s.t).join(""));
      if (a && !eqOnly) blk.align = a;
    }
    blocks.push(blk);
  }

  // Repair a heading that the writer manually broke across two lines: it arrives
  // as two heading blocks, the first ending on a dangling connector word
  // (… IN / OF / AND / THE …) and the second carrying the short tail — e.g.
  // "TOPIC 4.1: CONCEPTS AND METHODS IN" + "BIOLOGY". Glue them into one heading
  // (no real title ends on these words, so this is safe).
  {
    const isHeadBlk = (b) => b && (/^h[123]$/.test(b.t) || b.t === "head");
    const headText = (b) => (b && b.t !== "para" ? (b.text || "") : "");
    for (let i = 0; i < blocks.length - 1; i++) {
      const a = blocks[i], b = blocks[i + 1];
      if (!isHeadBlk(a) || !isHeadBlk(b)) continue;
      const at = headText(a).trim();
      if (!/\b(IN|OF|AND|THE|TO|FOR|ON|OR|AN?|WITH|&)$/i.test(at)) continue;
      const bt = headText(b).trim();
      if (!bt || bt.length > 40) continue;     // the tail should be a short fragment
      a.text = (at + " " + bt).replace(/\s+/g, " ");
      blocks.splice(i + 1, 1);
      i--;
    }
  }

  // Backfill bare local-language unit headings. Some manuscripts put a unit's
  // descriptive title only in the contents list, leaving the unit OPENER as a
  // bare "CHIBALU 4" (or "CHIBALU 6:"). Build a number -> title map from every
  // "CHIBALU N: Title" line in the document (longest title wins) and complete any
  // opener that lacks one, so each unit shows its full title like the others.
  {
    const titleMap = {};
    const RE = /^(CHIBALU|CIPATI)\s*(\d+)\s*[:.]\s*([A-ZÑ][A-ZÑa-zñ’'’ ]{4,})/i;
    for (const x of parts) {
      if (isTbl(x)) continue;
      const m = textOf(x).match(RE);
      if (m) { const k = m[2], t = m[3].trim(); if (!titleMap[k] || t.length > titleMap[k].length) titleMap[k] = t; }
    }
    for (const b of blocks) {
      if (b.t !== "h1") continue;
      const m = (b.text || "").match(/^(CHIBALU|CIPATI)\s*(\d+)\s*:?\s*(.*)$/i);
      if (m && !m[3].trim() && titleMap[m[2]]) b.text = `${m[1].toUpperCase()} ${m[2]}: ${titleMap[m[2]]}`;
    }
  }

  foldInlineCalc(blocks);
  foldDisplayCalc(blocks);
  const withBoxes = resolveTextboxBoxes(blocks, tbBoxes);
  let out = groupAssessments(attachCaptions(mergeImageRows(unwrapLayoutTables(withBoxes))));
  // Pair the author's left/right side-figures with the text that flows beside them
  // (a no-op unless images carry a side, i.e. the manuscript floated them).
  out = groupSideFigures(out, textWidthPx);
  out = autoToc(out);
  return { blocks: out, media: mediaOut, tmp };
}

// Some worked calculations are typed as ONE ordinary paragraph of INLINE math
// (matrices / fractions) plus plain-text variables and operators, hand-laid-out
// with literal space runs and Shift+Enter soft breaks ("\n"). They render
// scattered — the "=" of each step don't line up (e.g. p42 "v + 2u = … = … =").
// Fold such a paragraph (and any immediately-following "="/"+"-continuation) into
// ONE aligned display equation. Guards keep real prose+math sentences untouched:
// the paragraph's PLAIN text must hold an "=", no 3+-letter word, at least one
// inline-math run, and the tell-tale hand-layout (a soft break or a 3+ space run).
function foldInlineCalc(blocks) {
  const textOnly = (b) => (b.segs || []).filter((s) => !s.m).map((s) => s.t).join("");
  const recon = (b) => (b.segs || []).map((s) => (s.m ? " " + s.t + " " : s.t)).join("");
  const isCalc = (b) => {
    if (!b || b.t !== "para" || !b.segs || !b.segs.length) return false;
    const to = textOnly(b);
    if (!/=/.test(to) || /[A-Za-z]{3,}/.test(to)) return false;
    if (!b.segs.some((s) => s.m)) return false;
    return /\n/.test(to) || /\s{3,}/.test(to);
  };
  const isCont = (b) => {
    if (!b || b.t !== "para" || !b.segs || !b.segs.length) return false;
    if (/[A-Za-z]{3,}/.test(textOnly(b))) return false;
    return /^\s*[=+]/.test(recon(b).replace(/^\s+/, ""));
  };
  for (let i = 0; i < blocks.length; i++) {
    if (!isCalc(blocks[i])) continue;
    let full = recon(blocks[i]);
    let end = i;
    while (isCont(blocks[end + 1])) { full += " \n " + recon(blocks[end + 1]); end++; }
    let lines = full.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length);
    // the writer often parks a trailing "=" at the END of a step — move it to the
    // start of the next line so every step begins at its relation and aligns.
    for (let k = 0; k < lines.length - 1; k++) {
      const mm = lines[k].match(/=\s*$/);
      if (mm) { lines[k] = lines[k].slice(0, mm.index).trim(); lines[k + 1] = "= " + lines[k + 1]; }
    }
    if (lines.length < 2) continue;
    const t = stackAligned(lines);
    blocks[i] = { t: "para", segs: [{ t, m: true, display: true }], plain: "" };
    blocks.splice(i + 1, end - i);
  }
}

// Fold a run of adjacent "lone equation" paragraphs into ONE display block whose
// steps are aligned at the relation sign. Writers lay a worked calculation out as
// several one-per-line equations — sometimes each a display equation, sometimes an
// inline equation padded with literal leading spaces to fake-centre it. Rendered
// separately they each centre independently, so the "=" signs drift and never line
// up (e.g. p9 gradient: "m = (2-0)/(0-2)", "m = 2/-2", "m = -1"). This merges a run
// that shares the same left-hand side (or is a bare "= …" continuation) into a
// single stacked, relation-aligned display equation.
function foldDisplayCalc(blocks) {
  const REL = /(<=|>=|!=|=|≈|<|>|equiv|approx)/;
  // the math text of a paragraph that is ONE equation and nothing but whitespace
  // around it (no prose), and that contains a relation — else null.
  const calcLineOf = (b) => {
    if (!b || b.t !== "para" || !b.segs) return null;
    const math = b.segs.filter((s) => s.m);
    const txt = b.segs.filter((s) => !s.m).map((s) => s.t).join("");
    if (math.length !== 1 || /\S/.test(txt)) return null;
    const t = math[0].t.trim();
    return REL.test(t) ? t : null;
  };
  const lhsOf = (t) => {
    const m = String(t).split(/\s*\\\\\s*/)[0].match(/^(.*?)\s*(<=|>=|!=|=|≈|<|>|equiv|approx)/);
    return m ? m[1].replace(/&/g, "").trim() : null;
  };
  for (let i = 0; i < blocks.length; i++) {
    const first = calcLineOf(blocks[i]);
    if (first == null) continue;
    const key = lhsOf(first);
    let end = i;
    while (true) {
      const nxt = calcLineOf(blocks[end + 1]);
      if (nxt == null) break;
      const nl = lhsOf(nxt);
      if (!(nl === key || nl === "")) break; // same LHS, or a bare "= …" continuation
      end++;
    }
    if (end === i) continue;
    const lines = [];
    for (let k = i; k <= end; k++) lines.push(calcLineOf(blocks[k]));
    const t = stackAligned(lines);
    blocks[i] = { t: "para", segs: [{ t, m: true, display: true }], plain: "" };
    blocks.splice(i + 1, end - i);
  }
}

// If a book has headings but no table of contents of its own, insert one just
// before the first topic-level heading (so it sits after the front matter).
function autoToc(blocks) {
  if (blocks.some((b) => b.t === "toc")) return blocks;
  const headings = blocks.filter((b) => b.t === "h1" || b.t === "h2").length;
  if (headings < 3) return blocks;
  let at = blocks.findIndex((b) => b.t === "h1" && /^\d/.test(b.text)); // first numbered topic
  if (at < 0) at = blocks.findIndex((b) => b.t === "h1");
  if (at < 0) return blocks;
  return [...blocks.slice(0, at), { t: "toc" }, ...blocks.slice(at)];
}

// Merge consecutive single images (no text between them) into one side-by-side
// row. Full-width images (>= 450px) are left alone so they don't get squeezed.
// Unwrap a "layout" table — a single-row table whose cell(s) hold a NESTED table
// (authors often wrap a real data table plus its explanation in a 1-row table to
// place them side by side). Rendered as a grid, the inner table forces its column
// wide and squashes the neighbour text to one word per line. Instead, flatten the
// wrapper: emit each cell's content in order (the inner table full-width, then the
// explanation text below it). Only 1-row wrappers are unwrapped — a real
// multi-row data table that happens to contain a sub-table keeps its grid.
function unwrapLayoutTables(blocks) {
  const cellToBlocks = (c) => {
    const r = [];
    for (const sub of c.subs || []) r.push({ t: "table", rows: sub });
    const txt = (c.text || "").trim();
    if (c.segs && c.segs.length) r.push({ t: "para", segs: c.segs, plain: txt });
    else if (txt) r.push({ t: "para", segs: [{ t: c.text, b: false, it: false, c: null }], plain: txt });
    for (const im of c.imgs || []) r.push({ t: "image", ...im });
    return r;
  };
  const visit = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k]) && b[k].some((x) => x && typeof x === "object" && x.t)) visit(b[k]);
      }
      if (b.t === "table" && Array.isArray(b.rows) && b.rows.length === 1
          && b.rows[0].some((c) => c && c.subs && c.subs.length)) {
        const repl = b.rows[0].flatMap(cellToBlocks);
        arr.splice(i, 1, ...repl);
        i += repl.length - 1;
      }
    }
  };
  visit(blocks);
  return blocks;
}

function mergeImageRows(blocks) {
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    const small = (im) => (im.w || 0) > 0 && (im.w || 0) < 450;
    if (b.t === "image" && small(b) && prev) {
      if (prev.t === "image" && small(prev)) { out[out.length - 1] = { t: "imagerow", images: [imgOf(prev), imgOf(b)] }; continue; }
      if (prev.t === "imagerow" && prev.images.length < 4 && small(prev.images[0])) { prev.images.push(imgOf(b)); continue; }
    }
    out.push(b);
  }
  return out;
}
const imgOf = (b) => ({ file: b.file, w: b.w, h: b.h, caption: b.caption, tall: b.tall, hmm: b.hmm, side: b.side || null, voff: b.voff || 0 });

// Attach figure captions to the image(s) they describe. A caption may hold
// several "Figure N: …" labels (side-by-side images share one), and there may
// be several caption paragraphs in a row — gather them all and give each image
// its own label.
function attachCaptions(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    out.push(b);
    if (b.t === "imagerow" || b.t === "image") {
      const caps = [];
      let j = i + 1;
      while (j < blocks.length && blocks[j].t === "figcaption") {
        blocks[j].text.split(/(?=Fig(?:ure)?\.?\s*\d+\s*[:.])/i).forEach((s) => { s = s.trim(); if (s) caps.push(s); });
        j++;
      }
      if (caps.length) {
        if (b.t === "imagerow") b.images.forEach((im, k) => { if (!im.caption) im.caption = caps[k] || ""; });
        else if (!b.caption) b.caption = caps[0];
        i = j - 1; // consume the caption paragraphs
      }
    }
  }
  return out;
}

// Reproduce the manuscript's "figure beside text" layout. The author floated small
// pictures on the left/right of the column with the body text flowing next to them
// (import records this on each image as side: "L"|"R" and voff = its vertical offset from
// the anchor paragraph). Pair each side-figure with the RIGHT paragraph — using voff to
// tell whether it sits beside the text ABOVE it (a small offset) or the text that FOLLOWS
// (a larger drop) — and emit a two-column `sidefig` block: the text in one column, the
// picture(s) in the other, at roughly the picture's manuscript width. Stacked pictures
// keep their true top-to-bottom order (by voff), never swapped. `textWidthPx` sizes the
// image column.
function groupSideFigures(blocks, textWidthPx) {
  const isBodyPara = (b) => b && (b.t === "para" || b.t === "listitem");
  const plainLen = (x) => (x.segs ? x.segs.map((s) => s.t).join("") : (x.text || "")).length;
  // A picture whose top is within ~T px of its anchor sits beside the text ABOVE it;
  // a larger drop means it flows beside the FOLLOWING text.
  const T = 35;
  const sideImagesOf = (b) => {
    if (b.t === "image" && b.side && (b.w || 0) > 0) return [imgOf(b)];
    if (b.t === "imagerow" && Array.isArray(b.images) && b.images.length
        && b.images.every((im) => im.side && (im.w || 0) > 0)) return b.images.map((im) => ({ ...im }));
    return null;
  };
  const fracOf = (imgs) => Math.min(0.5, Math.max(0.28, Math.max(...imgs.map((im) => im.w || 0)) / textWidthPx));
  // rough image-column height (in narrow-column text lines) → character budget for the
  // body text that should flow beside the picture(s).
  const budgetOf = (imgs, frac) => {
    const colWmm = frac * 125;
    let imgHmm = 0;
    for (const im of imgs) { const aspect = (im.h && im.w) ? im.h / im.w : (im.tall ? 1.3 : 0.7); imgHmm += colWmm * aspect + 7; }
    const lines = Math.max(2, Math.round(imgHmm / 5.2));
    // A narrow, justified column fits noticeably fewer characters per line than its width
    // suggests (more inter-word stretch, more hyphenation) — estimate low so the budget
    // doesn't over-pull the NEXT paragraph into the column beside a short picture.
    const cpl = Math.max(20, Math.round((1 - frac) * 58));
    return lines * cpl;
  };
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const simgs = sideImagesOf(b);
    if (!simgs) { out.push(b); continue; }
    simgs.sort((p, q) => (p.voff || 0) - (q.voff || 0));            // top to bottom
    let up = simgs.filter((im) => (im.voff || 0) <= T);            // beside the text above
    let down = simgs.filter((im) => (im.voff || 0) > T);           // beside the following text
    // no paragraph immediately above? the "up" figures fall to the following text instead.
    if (up.length && !isBodyPara(out[out.length - 1])) { down = up.concat(down); up = []; }
    let j = i + 1;
    // Split a flowing run of paragraphs at ~`budget` characters (the picture's height):
    // the part up to the budget sits BESIDE the picture, the remainder (including the
    // crossing paragraph's tail, split on a word boundary) flows FULL WIDTH below — so a
    // paragraph taller than the picture releases to full measure at the picture's bottom
    // instead of running the whole column narrow with blank space beside it.
    const splitFlow = (paras, budget) => {
      const beside = [], overflow = [];
      let acc = 0, done = false;
      for (const p of paras) {
        if (done) { overflow.push(p); continue; }
        const len = plainLen(p);
        if (acc + len <= budget) { beside.push(p); acc += len; continue; }
        const lb = budget - acc;
        if ((p.t === "para" || p.t === "listitem") && Array.isArray(p.segs) && lb > 25 && len - lb > 30) {
          const [f, r] = splitSegsAt(p.segs, lb);
          if (f.length && r.length) { beside.push({ ...p, segs: f }); overflow.push({ ...p, segs: r }); done = true; continue; }
        }
        if (beside.length === 0) { beside.push(p); } else { overflow.push(p); }
        done = true;
      }
      return { beside, overflow };
    };
    // Gather following body paragraphs up to ~`budget` chars (stopping at a non-paragraph
    // or the next figure), so exactly enough text flows beside the picture.
    const gatherFollowing = (budget, seedLen) => {
      const g = []; let acc = seedLen || 0;
      while (acc < budget && j < blocks.length && isBodyPara(blocks[j]) && !sideImagesOf(blocks[j])) {
        g.push(blocks[j]); acc += plainLen(blocks[j]); j++;
      }
      return g;
    };
    const emitted = [];
    // UP figures: the flow begins at the paragraph just ABOVE (popped from `out`), then
    // continues into the following text; split at the picture height.
    if (up.length) {
      const frac = fracOf(up), budget = budgetOf(up, frac);
      const pre = out.pop();
      const flow = [pre].concat(down.length ? [] : gatherFollowing(budget, plainLen(pre)));
      const { beside, overflow } = splitFlow(flow, budget);
      emitted.push({ t: "sidefig", side: up[0].side, frac, images: up, body: beside });
      for (const o of overflow) emitted.push(o);
    }
    // DOWN figures: the flow is the FOLLOWING text; split at the picture height.
    if (down.length) {
      const frac = fracOf(down), budget = budgetOf(down, frac);
      const { beside, overflow } = splitFlow(gatherFollowing(budget), budget);
      if (beside.length) {
        emitted.push({ t: "sidefig", side: down[0].side, frac, images: down, body: beside });
        for (const o of overflow) emitted.push(o);
      } else {
        emitted.push(down.length === 1 ? { t: "image", ...down[0] } : { t: "imagerow", images: down });
      }
    }
    for (const e of emitted) out.push(e);
    i = j - 1;
  }
  return out;
}
// Split a run array at ~`budget` characters, on a word boundary, preserving each run's
// formatting. Returns [beforeSegs, afterSegs] (afterSegs empty if nothing spills over).
function splitSegsAt(segs, budget) {
  let acc = 0, done = false;
  const first = [], rest = [];
  for (const s of segs) {
    const t = s.t || "";
    if (done) { rest.push(s); continue; }
    if (acc + t.length <= budget) { first.push(s); acc += t.length; continue; }
    let cut = budget - acc;
    let sp = t.lastIndexOf(" ", cut);
    if (sp < Math.max(0, cut - 25)) { const nx = t.indexOf(" ", cut); sp = nx >= 0 ? nx : t.length; }
    if (sp <= 0) sp = Math.min(t.length, Math.max(1, cut));
    const a = t.slice(0, sp).replace(/\s+$/, ""), b = t.slice(sp).replace(/^\s+/, "");
    if (a) first.push({ ...s, t: a });
    if (b) rest.push({ ...s, t: b });
    done = true;
  }
  return [first, rest];
}

module.exports = { importDocx };
