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
const { THEMES, autoTheme, themeTypst, tgCoverSignature } = require("./themes.js");
const { enhanceLineArt, cropImage, rotateImage, emfToPng } = require("./image-enhance.js");
const { pngDamaged, placeholderPng } = require("./png-check.js");
const LEXI = require("./lexicon/index.js");
const { langFor, setLang, getLang } = LEXI;

const { ROOT, resolveBookPath } = require("./paths.js");
const INPUT_DIRS = [path.join(ROOT, "input"), path.join(ROOT, "books-to-typeset")];
// ZEPH_OUTPUT_DIR lets a test/regression run build somewhere other than the real output/.
const OUTPUT_DIR = process.env.ZEPH_OUTPUT_DIR ? path.resolve(process.env.ZEPH_OUTPUT_DIR) : path.join(ROOT, "output");

// The engine, one concern per module (see docs/ARCHITECTURE.md).
const { S, emit } = require("./emit.js");
const { deriveTitle, titleCase, titleCaseGrade, isTeacherBookName, eduLevelFor } = require("./naming.js");
const { blockPlain, setBlockText } = require("./blocktext.js");
const { applyOverrides } = require("./overrides.js");
const { boxifyActivities, dedupeAdjacentHeadings, fixStrayBodyH1s, stripEditorialComments, clearStrayRed, clearAllInlineColor, boldSafetyAndSteps, normaliseLessonBanners, normaliseUnitHeads, forceUnitThemes, uniformBoxLabelCase, keepNumberedSubtopicsOnly } = require("./passes/structure.js");
const { applySeriesFront, reorderFrontmatter, applyAutoFrontRefs, orderFrontMatter } = require("./passes/series-front.js");
const { fixPhdCapitalisation, fixACappellaSpacing, reformatAcronyms, formatGlossary, reorderBackmatter, fillLayoutCredit, boldAuthorNames } = require("./passes/backmatter.js");
const { unboldLeadProse, mergeContinuationActivities, splitActivityTables, convertTableActivities, ensureOrIndividually, boldAssessmentSections, labelIntroductions, normaliseCompetenceLabels, groupLessonMeta } = require("./passes/activities.js");
const { applyMarkFlushRight } = require("./passes/marks.js");
const { columnizeLists, normaliseSpacing, splitAnswerLabels, displayifyColumnMath, stripPrimaryScaffold, proofPolish, normaliseQuestionMarkBold } = require("./passes/polish.js");
const { syllabusPostProcess } = require("./passes/syllabus.js");

async function typesetOne(docxPath, themeName) {
  const base = path.basename(docxPath).replace(/\.docx$/i, "");
  // Expand a standalone "G 2"/"G2" abbreviation to "Grade 2" for all grade/level/theme
  // detection (kept separate from `base` so the output file keeps its original name).
  // (an underscore counts as a space: "Kikaonde_ Form_1 LB")
  const detectName = base.replace(/_/g, " ").replace(/(^|[^A-Za-z])[Gg]\s*([1-7])(?![0-9])/g, "$1Grade $2");
  // per-book editorial overrides (sidecar JSON next to the .docx). Loaded before theme
  // detection so `ov.theme` can override autoTheme's filename guess — needed when a
  // sibling book's title doesn't match the same pattern (e.g. a Teacher's Guide titled
  // "PE & Sport Teachers Guide" doesn't match the "Physical Education...Sport" regex its
  // Learner's Book title does, and would otherwise fall back to the generic theme).
  let ov = {};
  const ovPath = docxPath.replace(/\.docx$/i, ".overrides.json");
  if (fs.existsSync(ovPath)) {
    // strip a UTF-8 byte-order mark: Windows tools (PowerShell Set-Content, Notepad) add one,
    // and JSON.parse rejects it — which silently skipped the WHOLE overrides file.
    try { ov = JSON.parse(fs.readFileSync(ovPath, "utf8").replace(/^﻿/, "")); }
    catch (e) { console.warn("!  overrides skipped:", e.message); }
  }
  // "preset": "zl-tg" (or a list) — a book family's shared house settings live in
  // src/typeset/presets/<name>.json; the book's own keys win over the preset's.
  for (const name of [].concat(ov.preset || [])) {
    const pp = path.join(__dirname, "presets", `${name}.json`);
    if (!fs.existsSync(pp)) { console.warn("!  preset not found:", name); continue; }
    const pre = JSON.parse(fs.readFileSync(pp, "utf8"));
    delete pre._note;
    ov = { ...pre, ...ov };
    console.log(`   preset: ${name}`);
  }
  const theme = themeName || ov.theme || autoTheme(detectName);
  const variant = (THEMES[theme] || {}).variant;
  // Local-language book? Load its word list (box titles, front-matter headings…) so the
  // passes recognise the author's own wording; English books get no language (no-op).
  setLang(langFor(theme, ov));
  if (getLang()) console.log(`   language: ${getLang()} (local-language word list loaded)`);
  const eduLevel = eduLevelFor(detectName);
  // The ZEPH B5 house style is shared by the "series" (flat, English) and
  // "science" (boxed, Physics) layouts.
  const seriesLike = variant === "series" || variant === "science";
  // Resolve image-override paths relative to the .docx so the sidecar can name
  // them simply (e.g. "media/eng-debate.png"), or from the repo root with "@/"
  // (e.g. "@/images/cov-maths.png") — see paths.js.
  // An image override is either a bare path ("media/x.png") or an object
  // { src, w } where `w` forces the on-page width in px (so a hero image that
  // replaces a small manuscript picture isn't shrunk to the original's size).
  const imgOverrides = {};
  for (const [k, v] of Object.entries(ov.images || {})) {
    if (typeof v === "string") {
      const resolved = resolveBookPath(docxPath, v);
      imgOverrides[k] = { src: resolved };
    } else if (v.src) {
      // replace the image AND (optionally) force its on-page width
      const resolved = resolveBookPath(docxPath, v.src);
      imgOverrides[k] = { ...v, src: resolved };
    } else {
      // width-only override: keep the author's image but resize it on the page
      // (e.g. shrink one over-tall opener so it fits under its unit banner)
      imgOverrides[k] = { ...v };
    }
  }

  const importOpts = variant === "series" ? { series: true }
    : variant === "science" ? { styled: true, flat: false, textCover: true }
    : variant === "syllabus" ? { textCover: true, syllabus: true }
    : {};
  importOpts.imgOverrides = imgOverrides;
  importOpts.removeImages = ov.removeImages || [];
  importOpts.textboxCaptions = ov.textboxCaptions;
  importOpts.noSideFigures = !!ov.noSideFigures;
  importOpts.colonHeadings = !!ov.colonHeadings;   // "TOPIC: 1.5 …" headings (see import-docx.js)
  importOpts.sourceFix = ov.sourceFix || [];          // fix manuscript text before recognition
  importOpts.textboxHeadings = !!ov.textboxHeadings;   // a short title line in a Word text box becomes a heading
  importOpts.flattenBorderless = !!ov.flattenBorderless;   // a table with no lines in Word is set as plain text
  importOpts.tabGap = !!ov.glossaryColumns;           // a single tab still separates two glossary columns
  importOpts.exerciseBullets = !!ov.exerciseBullets; // keep Word bullets inside exercises as bullets
  importOpts.answerListNumbered = ov.answerListNumbered || [];
  let { blocks, media, tmp } = await importDocx(docxPath, importOpts);
  if (!blocks.length) {
    console.warn("!  No content extracted from", docxPath);
    return;
  }
  // untableImages: true — a picture book (ECE) lays its pages out with Word tables used
  // only to place pictures side by side, with at most a short label in a cell. Rendered as
  // a table those pictures shrink to thumbnails; unpack each such table into its short
  // labels (as headings) and its pictures (one full-width row per table row).
  // wordFix: { "Culliculum": "Curriculum", … } — repair whole words everywhere (text runs,
  // table cells, cover lines), keeping each run's formatting. For a manuscript where a
  // find-and-replace damaged one kind of word (a Cinyanja TG whose "r" -> "l" swap also
  // hit the English words and names: "Pelmanent Secletaly", "Beatlice Chilwa").
  if (ov.wordFix && Object.keys(ov.wordFix).length) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keys = Object.keys(ov.wordFix).sort((a, b) => b.length - a.length);
    const re = new RegExp(`(?<![A-Za-z\\u00C0-\\u024F])(${keys.map(esc).join("|")})(?![A-Za-z\\u00C0-\\u024F])`, "g");
    let n = 0;
    const fix = (s) => s.replace(re, (m) => { n++; return ov.wordFix[m]; });
    const walk = (o) => {
      if (o == null || typeof o !== "object") return;
      if (Array.isArray(o)) { for (const x of o) walk(x); return; }
      for (const k of ["t", "text", "plain", "q", "a", "title", "heading"]) if (typeof o[k] === "string") o[k] = fix(o[k]);
      for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
    };
    walk(blocks);
    console.log(`   wordFix: ${n} word(s) repaired`);
  }
  // glossaryColumns: true — a word list (English word, then the local word) the author
  // laid out with tabs in the glossary: every entry becomes a row of one two-column grid,
  // so the local words line up in their own column with clear space after the English.
  // Runs straight after import, while the author's tab gaps are still in the text.
  if (ov.glossaryColumns) {
    const txt = (b) => (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join(""));
    const isGloss = (t) => /^\s*(GLOSSARY|NTUMBA\s+MILANGWE)\s*$/i.test(t) || LEXI.isExactly(["glossary"], t);
    const isRefs = (t) => /^\s*(REFERENCES|BIBLIOGRAPHY)\s*$/i.test(t) || LEXI.isExactly(["references"], t);
    const out = [];
    let inG = false, grid = null, n = 0, header = null;
    for (const b of blocks) {
      const t = txt(b);
      if (isGloss(t)) { inG = true; out.push(b); continue; }
      if (inG && isRefs(t)) inG = false;
      const textual = /^(para|listitem|head|label|h2|h3)$/.test(b.t);
      // the column titles ("ENGLISH   KIKAONDE") head the grid, each over its own column
      // (or any two column names on the line straight after the glossary title: "Silozi  Sikuwa")
      const hm = inG && textual && !grid && !header && n === 0 && (t.match(/^\s*(ENGLISH)\s+(\S+)\s*$/i) || t.match(/^\s*(\p{L}+)\s+(\p{L}+)\s*$/u));
      if (hm) { header = [hm[1], hm[2]]; continue; }
      // an entry: two parts split by the author's tab gap, or a "Word: local word" entry
      // the author set bold ("Learning Activity: Bya Kuuba") — a plain row like the rest
      const m = inG && textual && (t.match(/^\s*(\S.*?\S)\s{2,}(\S.*?)\s*$/) || t.match(/^\s*([A-Z][^:]{1,40}?)\s*:\s+(\S.*?)\s*$/));
      if (m) {
        if (!grid) { grid = { t: "colgrid", rows: [], ncol: 2, hasMarker: false, ragged: true, ruled: !!ov.glossaryRuled }; /* glossaryRuled: a ruled two-column table */ if (header) grid.header = header; header = null; out.push(grid); }
        grid.rows.push({ marker: "", cells: [m[1].replace(/\s+/g, " ").replace(/:$/, ""), m[2].replace(/\s+/g, " ")] });
        n++;
        continue;
      }
      if (t.trim()) grid = null;
      out.push(b);
    }
    blocks = out;
    if (n) console.log(`   glossaryColumns: ${n} glossary entr(ies) in two columns`);
  }
  if (ov.untableImages) {
    const out = [];
    let n = 0;
    for (const b of blocks) {
      // a box with a nested table holds the rest of its lines in that inner table: flatten
      // inner tables' rows into the outer list so nothing inside is lost
      const flatRows = (rs) => [].concat(...rs.map((r) => {
        const inner = r.flatMap((c) => (c && c.subs) || []);
        return [r, ...inner.flatMap((rows) => flatRows(rows || []))];
      }));
      const rows = b.t === "table" && Array.isArray(b.rows) ? flatRows(b.rows) : null;
      const cells = rows ? rows.flat() : [];
      // a picture table, or a table of short labels only (headings the author boxed in
      // a table: "Ntendekelo ya kutanga" / "Mutwe: …" / "TEMU 1")
      // A table that holds a "LABEL:" line ("IFILEKABILWA UKWISHIBA:" = what you should
      // learn) followed by that label's lines is unpacked too: the label in bold, its
      // lines as plain text under it (not headings).
      const lines = (c) => String(c && c.text || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
      const labelled = rows && cells.some((c) => lines(c).some((t) => /:$/.test(t)))
        && cells.every((c) => !c || ((c.text || "").length <= 400 && !(c.imgs && c.imgs.length)));
      const ok = rows && cells.some((c) => c && ((c.imgs && c.imgs.length) || (c.text || "").trim()))
        && (labelled || cells.every((c) => !c || ((c.text || "").trim().length <= 60 && !/\n.*\n.*\n/.test(c.text || ""))));
      if (!ok) { out.push(b); continue; }
      n++;
      // The label and its lines stay together on one page: each is `sticky` to the next,
      // except the group's LAST line (else the whole run of headings and pictures after
      // it is chained on too, and a unit banner is left alone on its page).
      let underLabel = false, lastLine = null;
      const endGroup = () => { if (lastLine) lastLine.sticky = false; lastLine = null; underLabel = false; };
      for (const row of rows) {
        // a cell may stack several short lines (a heading over its topic line): one head each
        // (under a label, a line the author styled as a Word Heading is the next section's
        // title they typed into the same cell: "Amasilabo")
        for (const c of row) for (const raw of String(c && c.text || "").split(/\n/)) {
          const t = raw.trim();
          if (!t) continue;
          if (labelled && /:$/.test(t)) { endGroup(); out.push({ t: "para", sticky: true, outcomes: true, segs: [{ t, b: true, it: false, c: null }] }); underLabel = true; }
          else if (underLabel && (c.heads || []).includes(t)) { endGroup(); out.push({ t: "head", text: t }); }
          else if (underLabel) { lastLine = { t: "para", sticky: true, segs: [{ t, b: false, it: false, c: null }] }; out.push(lastLine); }
          else out.push({ t: "head", text: t });
        }
        const imgs = [].concat(...row.map((c) => (c && c.imgs) || []));
        if (imgs.length === 1) out.push({ t: "image", ...imgs[0] });
        else if (imgs.length) out.push({ t: "imagerow", images: imgs });
      }
      endGroup();
    }
    blocks = out;
    if (n) console.log(`   untableImages: ${n} picture table(s) unpacked`);
  }
  // colourHeads: ["007BB8"] — the author marked headings only by colouring the text
  // ("2. KUTANGA", "NTANGILO YAZHIKA" in blue). A short line whose text is all in one of
  // these colours (a bold number before it is allowed) becomes a plain black heading.
  if (ov.colourHeads) {
    const cols = new Set([].concat(ov.colourHeads).map((c) => String(c).replace(/^#/, "").toUpperCase()));
    let n = 0;
    for (const b of blocks) {
      // (a Word-numbered line too: "1. KUTELEKA NE KWAMBA" keeps its number)
      if (!/^(para|listitem)$/.test(b.t) || !Array.isArray(b.segs)) continue;
      const t = (b.t === "listitem" && b.marker ? b.marker + " " : "") + b.segs.map((s) => s.t).join("").replace(/\s+/g, " ").trim();
      const words = b.segs.filter((s) => /[A-Za-z]/.test(s.t));
      if (!t || t.length > 60 || !words.length) continue;
      if (!words.every((s) => s.c && cols.has(String(s.c).toUpperCase()) || /^\s*\d+[.)]?\s*$/.test(s.t))) continue;
      if (!words.some((s) => s.c)) continue;
      b.t = "head"; b.text = t; b.colourHead = true; delete b.segs; delete b.marker; n++;
    }
    if (n) console.log(`   colourHeads: ${n} coloured line(s) set as headings`);
  }
  // Local-language book: a short heading that starts with the language's own UNIT word
  // ("KISHINA KITANSHI", "CAPAMUTU 2") opens a unit — promote it to a unit banner (h1),
  // as "UNIT 1" / "TOPIC 1.1" are in English books.
  // Only the language's UNIT word counts (never the Topic word), and when the book uses
  // several Unit words (Cinyanja: CAPAMUTU chapters holding CIGAWO sections) only the
  // least frequent one is the top level.
  if (getLang()) {
    // (h1 included: a Unit word whose headings are ALREADY top-level still counts, so a
    // more frequent word below it is not mistaken for the top level)
    // a plain paragraph counts too when it is short and the unit word is followed by a
    // NUMBER ("KISHINA 1: KUTONGAULA MAZHINA"); "KISHINA-KACHE 7" (a sub-unit) does not
    const paraText = (b) => (b.segs || []).map((s) => s.t).join("").trim();
    for (const b of blocks) {
      if (b.t !== "para") continue;
      const t = paraText(b);
      if (t.length <= 60 && LEXI.words(["unit"]).some((w) => new RegExp(`^${LEXI.altSrc([w])}\\s+\\d`, "i").test(t))) { b.t = "head"; b.text = t.replace(/\s+/g, " ").replace(/\s*:\s*/, ": "); delete b.segs; }
    }
    const isCand = (b) => /^(head|label|h1|h2|h3)$/.test(b.t) && (b.text || "").trim().length <= 60;
    const byWord = new Map();
    for (const w of LEXI.words(["unit"])) {
      const re = new RegExp(`^\\s*(?:${LEXI.altSrc([w])})(?![A-Za-z\\u00C0-\\u024F])`, "i");
      const hits = blocks.filter((b) => isCand(b) && re.test(b.text));
      if (hits.length) byWord.set(w, hits);
    }
    if (byWord.size) {
      const [w, hits] = [...byWord.entries()].sort((a, b) => a[1].length - b[1].length)[0];
      const promote = hits.filter((b) => b.t !== "h1");
      for (const b of promote) { b.t = "h1"; b.text = b.text.trim(); }
      if (promote.length) console.log(`   ${promote.length} unit heading(s) recognised from the ${getLang()} word list ("${w}")`);
    }
  }

  // topSections: "regex" — the book's top level is a numbered topic line the word lists
  // don't treat as a unit ("MUTU 1.3: NCHITO ZA LITILICA" in a Literature in Cinyanja book,
  // where Cinyanja's unit word is CIGAWO): a short heading or line matching it opens a new
  // top-level section (h1), like "UNIT 1" in an English book.
  if (ov.topSections) {
    // (`topSectionsMatchCase`: the titles are ALL CAPS and the same words recur in the
    // text in ordinary case — "LITILICHA YAKUHOSHA" vs "Litilicha yakuhosha")
    const re = new RegExp(ov.topSections, ov.topSectionsMatchCase ? "" : "i");
    const plain = (b) => (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join("")).replace(/\s+/g, " ").trim();
    let n = 0;
    for (const b of blocks) {
      // (an h1 too: one the author styled as a Word Heading 1 still needs marking as top-level)
      if (!/^(head|label|para|h1|h2|h3)$/.test(b.t)) continue;
      const t = plain(b);
      if (t.length > 90 || !re.test(t) || /\s\d+\s*$/.test(t)) continue;   // (not a contents entry ending in its page number)
      b.t = "h1"; b.text = t; b.top = true; delete b.segs; n++;
    }
    if (n) console.log(`   topSections: ${n} top-level section heading(s)`);
  }
  // insertPictures: [{ find, file }] — the author left a note ("INSERT A PICTURE SHOWING
  // PEOPLE AT THE MARKET") where a picture belongs: the block holding that note (a line or
  // a one-cell table) is replaced by the picture (path relative to the .docx).
  for (const ip of ov.insertPictures || []) {
    const txt = (b) => b.t === "table" ? JSON.stringify(b.rows || []) : (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join(""));
    // (the note may also sit INSIDE a box — an activity's body, as a line or a one-cell table)
    const txtAny = (b) => b.t === "table" || b.k === "table" ? JSON.stringify(b.rows || b.r || []) : txt(b) || (b.s ? b.s.map((x) => x.t).join("") : "");
    let list = blocks, i = blocks.findIndex((b) => txt(b).includes(ip.find));
    if (i < 0) for (const b of blocks) {
      if (!Array.isArray(b.body)) continue;
      const j = b.body.findIndex((x) => x && txtAny(x).includes(ip.find));
      if (j >= 0) { list = b.body; i = j; break; }
    }
    const src = resolveBookPath(docxPath, ip.file);
    if (i < 0 || !fs.existsSync(src)) { console.warn("!  insertPictures not matched:", i < 0 ? ip.find : src); continue; }
    const name = "ins_" + path.basename(src);
    media.push({ src, name });
    // (`after: true` — keep the matched block and put the picture right below it: a picture
    // the import lost, e.g. the unit opener glued to the typed contents list)
    if (ip.after) list.splice(i + 1, 0, { t: "image", file: name, w: 601, tall: false });
    else if (ip.before) list.splice(i, 0, { t: "image", file: name, w: 601, tall: false });
    else list[i] = { t: "image", file: name, w: 601, tall: false };
  }
  // subSections: "regex" — the level below the units ("Chihande: 1.2.1 Kutanga…" in a
  // Luvale book), however the author styled each one (Heading 1/2/3 or a plain line):
  // every match becomes a sub-topic heading; with `subtopicsOnly` every OTHER line the
  // author styled as a heading drops back to an ordinary heading.
  if (ov.subSections) {
    const re = new RegExp(ov.subSections, ov.subSectionsMatchCase ? "" : "i");
    const plain = (b) => (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join("")).replace(/\s+/g, " ").trim();
    let n = 0;
    for (const b of blocks) {
      if (!/^(head|label|para|h1|h2|h3)$/.test(b.t) || b.top) continue;
      const t = plain(b);
      if (t.length > 90 || !re.test(t)) continue;
      b.t = "h2"; b.text = t; b.sub = true; delete b.segs; n++;
    }
    if (n) console.log(`   subSections: ${n} sub-topic heading(s)`);
  }
  // colonAfterNumber: true — "Mutwe Wachihande: 1.2.1.1 Kutanga" -> "Mutwe Wachihande
  // 1.2.1.1: Kutanga": in a heading that names its number, the colon goes after the number.
  if (ov.colonAfterNumber) {
    const fix = (s) => s.replace(/^(\D*?[A-Za-z’'])\s+\d+\s*:\s*(\d+(?:\.\d+){2,})\s+/, (m, w, num) => `${w} ${num} `)   // "1:1.2.4.1" typo
      .replace(/^(\D*?[A-Za-z’'])\s*:\s*(\d+(?:\s*\.\s*\d+)+)\.?\s*:?\s*(?=\S)/, (m, w, num) => `${w} ${num.replace(/\s+/g, "")}: `)
      .replace(/^(\D*?[A-Za-z’'])\s+(\d+(?:\.\d+)+)\.?\s+(?=[A-Za-z])/, (m, w, num) => `${w} ${num}: `);
    let n = 0;
    // (a unit banner "CHIHANDA 3. KUSEKASANA" takes the same form: "CHIHANDA 3: KUSEKASANA")
    const unitFix = (s) => s.replace(/^([A-Za-z’']+)\s+(\d+)\s*[.:]?\s+(?=[A-Z])/, (m, w, num) => `${w} ${num}: `);
    for (const b of blocks) {
      if (!/^(head|label|h1|h2|h3)$/.test(b.t) || typeof b.text !== "string") continue;
      const t = unitFix(fix(b.text)).replace(/\s{2,}/g, " ");
      if (t !== b.text) { b.text = t; n++; }
    }
    if (n) console.log(`   colonAfterNumber: ${n} heading(s)`);
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
      const repPath = resolveBookPath(docxPath, rs.docx);
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

  // Generic book-agnostic auto-fixes run BEFORE the book's own overrides, not
  // after, so a book's explicit `edit` always has the final word — a reviewer
  // who deliberately asks for "acappella" as one word (or any other spelling a
  // generic fix would otherwise "correct") must not have that override silently
  // clobbered by the very next pipeline step.
  fixPhdCapitalisation(blocks);
  fixACappellaSpacing(blocks);
  if (ov.fill || ov.textFix || ov.replace || ov.replaceExact || ov.editCell || ov.remove || ov.removeRange || ov.tables || ov.edit || ov.editAnswer || ov.setMarker || ov.moveBefore || ov.moveSectionBefore || ov.unitalic || ov.dropMath || ov.setCaption || ov.asHead || ov.pageBreakBefore || ov.forceFreshPage || ov.centre || ov.editAll || ov.unbold || ov.boldToItalic || ov.activityHeadsBlack || ov.insertHead || ov.recolor || ov.recolorHead || ov.italiciseFrom || ov.retext || ov.subtext || ov.replaceSection || ov.unlist || ov.asSection || ov.styleSection || ov.setHeading || ov.recase || ov.asPara || ov.mergePara || ov.renumberLessons || ov.renumberActivities || ov.renumberTopics || ov.renameNear || ov.centrePara || ov.boldFind || ov.underline || ov.splitBefore || ov.removeWhereNext || ov.fixExercise || ov.numberedTopics || ov.topicNumFirst || ov.stripCaptionLabels || ov.learnStatement || ov.recolorLabel || ov.insertText || ov.toTable || ov.stripUnderline || ov.replaceBlocks || ov.deleteRun || ov.monoLines || ov.imageToText || ov.unbox || ov.italicSections || ov.unsideFigure || ov.imageLabelCaptions || ov.recolorCell || ov.replaceRange || ov.insertUnitTopics || ov.renumberExercises || ov.italicPara || ov.boxRange || ov.fontRange) { applyOverrides(blocks, ov); }
  // glossaryColon: true — in the glossary, a term is followed by a colon, not the hyphen
  // the author typed: "Bacikombo- Caamba bamukowa" -> "Bacikombo: Caamba bamukowa".
  if (ov.glossaryColon) {
    const txt = (b) => (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join("")).trim();
    let inG = false, n = 0;
    for (const b of blocks) {
      const t = txt(b);
      if (/^(h1|h2|head|label)$/.test(b.t)) { inG = /^GLOSSARY\b/i.test(t) || LEXI.isExactly(["glossary"], t); continue; }
      if (!inG || !/^(para|listitem)$/.test(b.t) || !Array.isArray(b.segs) || !b.segs.length) continue;
      const s0 = b.segs[0];
      // (only the dash that ENDS the term — followed by a space or the end of the run — so a
      // hyphenated term such as "Caatala-tala" keeps its own hyphen)
      const m = s0.t.match(/^(\s*\S[^:]{0,60}?)\s*[-–](?=\s|$)\s*(\S[\s\S]*)?$/);
      // the dash may instead open the next run ("Mpuwo" + "- Kuzyibwa kapati")
      if (!m && b.segs[1] && /^\s*[-–]/.test(b.segs[1].t) && !/:\s*$/.test(s0.t)) {
        s0.t = s0.t.replace(/\s+$/, "") + ":";
        b.segs[1].t = " " + b.segs[1].t.replace(/^\s*[-–]\s*/, "");
        n++;
        continue;
      }
      if (!m) continue;
      s0.t = m[1] + ":" + (m[2] ? " " + m[2] : "");
      if (!m[2] && b.segs[1] && !/^\s/.test(b.segs[1].t)) b.segs[1].t = " " + b.segs[1].t;
      n++;
    }
    if (n) console.log(`   glossaryColon: ${n} glossary entr(ies)`);
  }
  // unboldRange: [{ after, through }] — the author set a whole run of answers in bold:
  // every block after the one containing `after`, up to and including the one containing
  // `through`, is set in regular weight (a bare bold "1" / "2" heading becomes a plain line).
  const plainOf = (b) => (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join(""));
  for (const ur of ov.unboldRange || []) {
    // `from` (instead of `after`) starts AT the matching block rather than after it
    const hit = blocks.findIndex((b) => plainOf(b).includes(ur.from != null ? ur.from : ur.after));
    const a = ur.from != null && hit >= 0 ? hit - 1 : hit;
    const z = hit < 0 ? -1 : blocks.findIndex((b, i) => i > a && plainOf(b).includes(ur.through));
    if (hit < 0 || z < 0) { console.warn("!  unboldRange not matched:", hit < 0 ? (ur.from || ur.after) : ur.through); continue; }
    for (let i = a + 1; i <= z; i++) {
      const b = blocks[i];
      if (/^(head|label|h3)$/.test(b.t)) { blocks[i] = { t: "para", segs: [{ t: (b.text || "").trim(), b: false, it: false, c: null }] }; continue; }
      for (const s of b.segs || []) s.b = false;
    }
  }
  // liftNestedBoxes: true — an activity box whose body holds a table of further boxes
  // ("Musebezi 2: …", "Musebezi 3: …", one per row: the author drew the boxes inside the
  // first one's table) — each such row becomes its own box, right after the first.
  if (ov.liftNestedBoxes) {
    let n = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!/^(activity|exercise)$/.test(b.t) || !Array.isArray(b.body)) continue;
      const out = [];
      for (let k = b.body.length - 1; k >= 0; k--) {
        const it = b.body[k];
        if (!it || it.t !== "table" || !Array.isArray(it.rows)) continue;
        const cells = it.rows.flat().filter((c) => c && (c.text || "").trim());
        const isBox = (c) => !!LEXI.boxKind(((c.text || "").split("\n")[0] || "").replace(/:.*$/, "").trim()) || /^\s*Musebezi\s*\d/i.test(c.text || "");
        if (!cells.length || !cells.every(isBox)) continue;
        b.body.splice(k, 1);
        for (const c of cells.reverse()) {
          // split the cell's runs into lines (paragraphs) at its "\n" breaks
          const lines = [[]];
          for (const s of (c.segs || [{ t: c.text, b: false, it: false, c: null }])) {
            const parts = String(s.t).split("\n");
            parts.forEach((p, j) => { if (j) lines.push([]); if (p) lines[lines.length - 1].push({ ...s, t: p }); });
          }
          const paras = lines.filter((l) => l.map((s) => s.t).join("").trim());
          const title = paras.shift().map((s) => s.t).join("").trim();
          out.unshift({ t: b.t, title, body: paras.map((segs) => ({ t: "para", segs })) });
          n++;
        }
      }
      if (out.length) { blocks.splice(i + 1, 0, ...out); i += out.length; }
    }
    if (n) console.log(`   liftNestedBoxes: ${n} box(es) lifted out of another box`);
  }
  // capsLinesBold: true — in the body, a short line typed all in capitals ("BUIKONELI
  // KABUTUNGI", "KUBULELA NI KUTEELEZA") is a heading the author forgot to bold: set it as
  // one; a capitals lead-in before a colon ("KAKUTOKWAHALA: Kufitisa …") is set bold.
  if (ov.capsLinesBold) {
    const body0 = blocks.findIndex((b) => b.t === "bodystart");
    let nh = 0, nl = 0;
    for (let i = Math.max(0, body0); i < blocks.length; i++) {
      const b = blocks[i];
      if (b.t !== "para" || !Array.isArray(b.segs) || !b.segs.length || b.segs.some((s) => s.m)) continue;
      const t = b.segs.map((s) => s.t).join("").trim();
      const caps = (s) => /\p{Lu}{2}/u.test(s) && !/\p{Ll}/u.test(s);
      if (caps(t) && t.length <= 70 && !/[.?!]$/.test(t) && !/^\d/.test(t)) { blocks[i] = { t: "head", text: t }; nh++; continue; }
      const m = t.match(/^([\p{Lu}'’ ]{4,40}:)(\s*\S[\s\S]*)$/u);
      if (m && !b.segs[0].b) { b.segs = [{ ...b.segs[0], t: m[1], b: true }, { ...b.segs[0], t: m[2], b: false }]; nl++; }
    }
    console.log(`   capsLinesBold: ${nh} heading(s), ${nl} lead-in(s)`);
  }
  // tableWidths: [{ find, widths: [1.5, 2, 1] }] — fix the column proportions of every
  // table whose text contains `find` (e.g. widen a time column so "13.00 ku 14.00"
  // sits on one line instead of wrapping).
  for (const tw of ov.tableWidths || []) {
    let n = 0;
    const visit = (o) => {
      if (Array.isArray(o)) return o.forEach(visit);
      if (!o || typeof o !== "object") return;
      if (o.t === "table" && Array.isArray(o.rows) && JSON.stringify(o.rows).includes(tw.find)) { o.widths = tw.widths; n++; }
      for (const k of Object.keys(o)) if (k !== "rows" && typeof o[k] === "object") visit(o[k]);
    };
    visit(blocks);
    if (!n) console.warn("!  tableWidths not matched:", tw.find);
  }
  // phraseFix: [["find", "with"], …] and spelling: { rules: { "ch": "c", "r": "l" }, keep: [] }
  // — an author's wording corrections, then a book-wide spelling rule (Zambian Cinyanja
  // writes "c" for "ch" and "l" for "r": cifukwa, maphunzilo). Both work inside every text
  // run (boxes, tables and lists too), so each run keeps its bold/italic. Run after the
  // other overrides, so a phraseFix `find` is the text as the author wrote it, and the
  // spelling rule also covers corrected wording. `keep` lists words the rule must not
  // touch (English terms, names); "ch" right after "n" or "t" is left alone ("nchito").
  if (ov.phraseFix || ov.spelling) {
    const KEYS = ["t", "text", "plain", "q", "a", "title", "heading", "cap", "caption"];
    const walkStrings = (o, fn) => {
      if (o == null || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach((x, i) => { if (typeof x === "string") o[i] = fn(x); else walkStrings(x, fn); }); return; }
      for (const k of Object.keys(o)) {
        const v = o[k];
        // ("t" is a text run's text, but on a BLOCK it is the block's type — "para", "head" —
        // which must never be touched: only treat it as text on a run, which has b/it/m)
        if (typeof v === "string") { if (KEYS.includes(k) && (k !== "t" || "b" in o || "it" in o || "m" in o)) o[k] = fn(v); }
        else if (v && typeof v === "object") walkStrings(v, fn);
      }
    };
    for (const [find, repl] of ov.phraseFix || []) {
      let n = 0;
      walkStrings(blocks, (s) => { if (!s.includes(find)) return s; n++; return s.split(find).join(repl); });
      if (!n) console.warn("!  phraseFix not matched:", find);
    }
    if (ov.spelling) {
      const rules = Object.entries(ov.spelling.rules || {});
      const keep = new Set((ov.spelling.keep || []).map((w) => w.toLowerCase()));
      const caseLike = (src, to) => src === src.toUpperCase() ? to.toUpperCase() : src[0] === src[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
      let n = 0;
      const fixWord = (w) => {
        if (keep.has(w.toLowerCase().replace(/[’']/g, "'"))) return w;
        let out = w;
        for (const [from, to] of rules) {
          const re = from.length > 1 ? new RegExp(`(?<![nNtT])${from}`, "gi") : new RegExp(from, "gi");
          out = out.replace(re, (m) => caseLike(m, to));
        }
        if (out !== w) n++;
        return out;
      };
      walkStrings(blocks, (s) => s.replace(/[A-Za-z’']+/g, fixWord));
      console.log(`   spelling: ${n} word(s) respelt`);
    }
  }
  if (fs.existsSync(ovPath)) console.log("   applied overrides:", path.basename(ovPath));
  reformatAcronyms(blocks);
  formatGlossary(blocks);
  displayifyColumnMath(blocks);
  columnizeLists(blocks);   // BEFORE normaliseSpacing, which would erase the column gaps
  normaliseSpacing(blocks);
  unboldLeadProse(blocks);
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
  if (ov.subtopicsOnly) keepNumberedSubtopicsOnly(blocks);
  stripEditorialComments(blocks);
  clearStrayRed(blocks);
  // Every Teacher's Guide is black-and-white inside by default (see the fuller note
  // by the theme-colour greying below); `blackWhite: false` opts a rare TG back out.
  const wantsBlackWhite = ov.blackWhite === false ? false : (ov.blackWhite === true || isTeacherBookName(base));
  if (wantsBlackWhite) clearAllInlineColor(blocks);
  const boxOpts = { looseStarts: !!ov.boxifyLoose, mergeColon: !!ov.mergeActivityColon, boxHeads: ov.boxHeads || [] };
  // Unlike the rest of proofPolish()'s lesson-field normalisation, "General/Specific
  // Competence(s)" case is a house-style rule for every book, not just the boxActivities
  // ones — see normaliseCompetenceLabels() above.
  normaliseCompetenceLabels(blocks);
  if ((THEMES[theme] || {}).boxActivities) { proofPolish(blocks); blocks = boxifyActivities(blocks, boxOpts); }
  else if (ov.boxActivities) { if (ov.polish) proofPolish(blocks); blocks = boxifyActivities(blocks, boxOpts); }
  // after boxing, so the assessment bodies exist to scan
  boldAssessmentSections(blocks);
  boldSafetyAndSteps(blocks);
  // Teacher's Guide: peel each inline "Possible Answer:" off its question onto its own line.
  splitAnswerLabels(blocks);
  // House style: make every structural box label read in one case across the book.
  uniformBoxLabelCase(blocks);
  // Group each lesson's header metadata into one distinct 14pt panel (Teacher's Guide).
  if (ov.polish) blocks = groupLessonMeta(blocks);
  reorderFrontmatter(blocks);   // house-style front-matter order (see the function)
  reorderBackmatter(blocks);

  // Primary Learner's Books drop the teacher/curriculum scaffolding (Sub-Topics,
  // Specific Competences, Acronyms, Glossary, List of Figures, References). Gated on the
  // grade-derived level + "not a Teacher's Guide"; a per-book `keepScaffold: true`
  // override opts a specific Learner's Book back out.
  const isPrimaryLB = eduLevel === "Primary Education Level" && !isTeacherBookName(base);
  if (isPrimaryLB && !ov.keepScaffold) blocks = stripPrimaryScaffold(blocks);

  // ZEPH house style: put the OFFICIAL ZEPH logo (zeph-logo/image.png — a clean
  // transparent-background mark) on the front + back covers of EVERY book,
  // regardless of theme/variant. This unconditionally overwrites whatever
  // `cov.logo` the cover-detection pass in import-docx.js may have picked up
  // (it grabs any small image sitting on the manuscript's own title page as a
  // "publisher logo" — for classic/modern/literary/panel books that was never
  // replaced, so a manuscript's own flattened, white-background copy of the
  // logo ended up on the cover, showing as a visible white box/container
  // around the mark instead of our clean cut-out). Every book published
  // through this pipeline is a ZEPH book, so the logo should always be ours.
  {
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
    const p = resolveBookPath(docxPath, ov.coverImage);
    if (fs.existsSync(p)) {
      const nm = "cover_hero" + path.extname(p);
      media.push({ src: p, name: nm });
      const cov = blocks.find((b) => b.t === "cover");
      if (cov) cov.hero = { file: nm, w: 0, tall: false };
    } else console.warn("!  coverImage not found:", p);
  }

  // A manuscript can ship its OWN fully-designed cover graphic — title, book
  // type, authors, and publisher/logo already baked into the image, rather
  // than a plain hero photo for the template to frame and caption. Drawing
  // the template's own title/byline/logo on top of one of these duplicates
  // everything the image already carries. This is an explicit opt-in (not
  // auto-detected — a full-bleed image doesn't by itself say whether it's a
  // finished cover or just a big photo) once a book's cover page has been
  // confirmed pre-designed like this; see cover()'s `finished` branch in
  // generic-template.typ, which renders the hero full-bleed and skips every
  // other overlay.
  if (ov.finishedCover) {
    const cov = blocks.find((b) => b.t === "cover");
    if (cov && cov.hero) cov.finished = true;
    else console.warn("!  finishedCover set but no cover hero image was detected on the manuscript's cover page");
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
    const LANG_THEMES = new Set(["nyanja", "tonga", "lunda", "luvale", "bemba", "silozi", "kaonde"]);
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
      // An explicit `grade` override wins (a roman-numeral "form II" filename); ECE books
      // carry "ECE" where other books carry "Form N" / "Grade N".
      const grade = ov.grade ? titleCaseGrade(ov.grade) : (gm2 ? titleCaseGrade(gm2[0]) : eduLevel === "Early Childhood Education Level" ? "ECE" : "");
      const booktype = isTeacherBookName(base) ? "Teacher's Guide" : "Learner's Book";
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
    // Fallback: the manuscript's own cover page sometimes carries no author
    // byline at all (no names before the copyright block for the detection
    // above to find), even though the book has a full "AUTHORS" bio section
    // further into the front matter — each bio paragraph opens with the
    // author's name as its own bold run (e.g. "**Adrian Mudenda** holds a
    // Bachelor's Degree…"), a convention shared across these Teacher's Guides.
    // Pull those names in so the cover isn't left byline-less just because the
    // source cover page itself never had one; an explicit `authors` override
    // (including `[]` to hide the byline) still wins below.
    if (cov && (!cov.byline || !cov.byline.length) && !Array.isArray(ov.authors)) {
      const isHeadType = (b) => b && (b.t === "h1" || b.t === "h2" || b.t === "h3" || b.t === "head");
      const authHeadIdx = blocks.findIndex((b) => isHeadType(b) && /^(THE\s+)?AUTHORS?$/i.test((b.text || "").trim()));
      if (authHeadIdx >= 0) {
        const names = [];
        for (let i = authHeadIdx + 1; i < blocks.length; i++) {
          const b = blocks[i];
          if (isHeadType(b)) break;                                  // next section ends the bios
          const seg0 = Array.isArray(b.segs) && b.segs[0];
          if (!seg0 || !seg0.b) continue;                            // bio opens with a bold name
          const name = (seg0.t || "").trim();
          if (name.length >= 3 && name.length <= 40 && /^[A-Z][A-Za-z'`.\- ]+$/.test(name)) names.push(name);
        }
        if (names.length) {
          cov.byline = names;
          console.log("   authors pulled from manuscript's AUTHORS section:", names.join(", "));
        }
      }
    }
    // Explicit author list from overrides wins (restores names the manuscript
    // buried in a long bio line, which the name-filter drops). An empty array is a
    // deliberate "hide the author byline" — the client didn't want names credited
    // on the cover — as distinct from omitting the key (leave the detected byline
    // alone).
    if (cov && Array.isArray(ov.authors)) cov.byline = ov.authors.slice();
    // A localised book-type label (e.g. Lunda "MUKANDA WAKADIZI" = Learner's
    // Book) replaces the synthesised English booktype on the cover.
    if (cov && ov.booktype && cov.lines && cov.lines.length) cov.lines[cov.lines.length - 1] = ov.booktype;
    // coverWords: { eyebrow, form, booktype, authors, contents, printedBy } — the author's
    // own-language words for the cover / title page ("LUFUNJISHO LWA SEKONDALI",
    // "FOMU 1", "BUUKU WA MUFUNJISHI", "BANEMBI") in place of the English ones.
    const cw = ov.coverWords || {};
    if (cov && cov.lines && cov.lines.length) {
      if (cw.eyebrow && variant === "series") cov.lines[0] = cw.eyebrow;
      if (cw.form) cov.lines = cov.lines.map((l) => l.replace(/\bform(?=\s*\d)/i, cw.form.toUpperCase()));
      // title: the subject + level line in the author's words — an ECE book has no
      // "Form N", so e.g. "CINYANJA ZAKA 3 - 4" gives the cover its age-range pill
      if (cw.title && cov.lines.length > 2) cov.lines[1] = cw.title;
      if (cw.booktype) cov.lines[cov.lines.length - 1] = cw.booktype;
    }
  }

  // ---- CDC SYLLABUS post-processing (landscape matrix book) ----------------------
  if (variant === "syllabus") blocks = syllabusPostProcess(blocks, { media, theme, ov });

  // Keep a Topic banner (h1) and its FIRST Sub-Topic (h2) together when the
  // manuscript gave that Topic no introduction of its own — subhead() otherwise
  // force-page-breaks before every Sub-Topic unconditionally (house style: a
  // Sub-Topic always starts a fresh page), which is fine when the Topic banner's
  // page is already filled by an intro paragraph, but strands the banner alone
  // on a near-empty page when there's nothing between it and the first Sub-Topic
  // (e.g. Form 4 Food and Nutrition TG's "TOPIC 4.2: FOOD SERVICE", which the
  // manuscript runs straight into "Sub-Topic 4.2.1" with no Topic-level intro).
  // Applies to every book variant, not just the syllabus matrix layout.
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].t !== "h2") continue;
    let j = i - 1;
    while (j >= 0 && blocks[j].t === "para" && !(blockPlain(blocks[j]) || "").trim()) j--;
    if (j >= 0 && blocks[j].t === "h1") blocks[i].nobreak = true;
  }

  // Restructure the front matter (title page, roman/arabic numbering, etc.).
  // Auto-number the lessons only for "series" (English) — the Physics sub-topics
  // are already numbered ("Sub-Topic 4.1.1: …") in the manuscript.
  // Airy spacing between front-matter paragraphs (clear separation matters more
  // than fitting a section on one page).
  if (seriesLike) blocks = applySeriesFront(blocks, {
    numberLessons: variant === "series" && !ov.noLessonNumbers,   // (noLessonNumbers: the manuscript leaves its strands un-numbered)
    // Primary Teacher's Guides have longer front-matter sections; a tighter gap
    // keeps each (e.g. the Acknowledgement + its signatory) on a single page.
    fmSpacing: ov.fmSpacing || ((THEMES[theme] || {}).boxActivities ? "1.3em" : "1.9em"),   // (fmSpacing: a book whose front sections spill their signature onto a page of its own)
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
  let enhanced = 0, cropped = 0, rotated = 0, emfConv = 0;
  const damaged = [];
  for (const m of media) {
    const dest = path.join(mediaDir, m.name);
    try {
      // A corrupt PNG would stop Typst compiling the whole book: put a labelled
      // grey placeholder in its place instead, and report it for the author.
      if (/\.png$/i.test(m.name) && !m.emf) {
        const buf = fs.readFileSync(m.src);
        if (pngDamaged(buf)) {
          const ph = placeholderPng(buf, m.name);
          if (ph) fs.writeFileSync(dest, ph);
          damaged.push(m.name);
          continue;
        }
      }
      // An EMF that wraps a raster: extract the bitmap to PNG so the picture appears
      // instead of being dropped (Typst can't read EMF). If it's genuine vector art
      // with no embedded bitmap, emfToPng returns null and the image is skipped.
      if (m.emf) {
        const png = emfToPng(fs.readFileSync(m.src));
        if (png) { fs.writeFileSync(dest, png); emfConv++; }
        continue;
      }
      // A picture the author turned in Word (a sideways phone photo of a poster, say):
      // bake the turn in, since the stored bytes are still in the original orientation.
      // rotateImage does the crop itself, in the right order.
      if (m.rot && rotateImage(m.src, dest, m.rot, m.crop, fs)) { rotated++; continue; }
      if (m.crop && cropImage(m.src, dest, m.crop, fs)) { cropped++; continue; }
      if (enhanceLineArt(m.src, dest, fs)) enhanced++;
      else fs.copyFileSync(m.src, dest);
    } catch (e) { /* skip missing */ }
  }
  if (emfConv) console.log(`   recovered ${emfConv} EMF image(s) to PNG`);
  if (cropped) console.log(`   applied Word crop to ${cropped} image(s)`);
  if (rotated) console.log(`   applied Word rotation to ${rotated} image(s)`);
  if (enhanced) console.log(`   enhanced ${enhanced} faint line-art image(s)`);
  if (damaged.length) console.log(`   DAMAGED picture(s) in manuscript, placeholder used: ${damaged.join(", ")}`);

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
  // keepBoxMm: boxes shorter than this stay whole on one page (default 180 mm); a lower value lets
  // mid-size activity boxes split rather than leave half a page empty before them
  if (ov.keepBoxMm) themeOverrides.keepBoxMm = Number(ov.keepBoxMm);
  if (ov.keepTableMm) themeOverrides.keepTableMm = Number(ov.keepTableMm);   // (likewise for tables; default ~141 mm)
  const coverB = blocks.find((b) => b.t === "cover");
  if (coverB && coverB.lines && coverB.lines.length) {
    // (coverWords only translate the cover and title page: the running-header pill keeps
    // the English "Form 1 Teacher's Guide")
    const cw = ov.coverWords;
    const gl = cw ? (detectName.match(/\b(form|grade)\s*\d+/i) || [""])[0] : coverB.lines.find((l) => /\b(form|grade)\s+\d/i.test(l));
    const grade = gl ? (gl.match(/(?:form|grade)\s*\d+/i) || [""])[0].replace(/(\D)(\d)/, "$1 $2").replace(/\s+/g, " ") : "";
    const booktype = cw ? (isTeacherBookName(base) ? "Teacher's Guide" : "Learner's Book") : (coverB.lines[coverB.lines.length - 1] || "");
    if (grade && booktype) themeOverrides.hdrtab = titleCase(`${grade} ${booktype}`);
    // ECE books have no grade: the pill just names the book type ("Teacher's Guide")
    else if (booktype && eduLevel === "Early Childhood Education Level") themeOverrides.hdrtab = booktype;
  }
  // Local-language books print the cover, title-page and running-header labels in the
  // book's own language when its word list has them (Chitonga "LWIIYO LWA PULAIMALI",
  // "GILEDI 1", "BBUKU LYABAYI", "BALEMBI"). A label the list lacks stays English. The
  // cover lines themselves stay English (the template finds the grade line by the word
  // GRADE/FORM) and are translated where they are printed, via T.labels.
  // Opt-in per book ("localLabels": true) once its words are checked: some word lists
  // give a long phrase for the level (Lunda's carries "Fomu 1 -4", which the cover would
  // then read as the form line), so this is not switched on for every language at once.
  if (getLang() && ov.localLabels) {
    const labels = {};
    for (const [k, id] of [["grade", "grade"], ["form", "form"], ["tg", "teachers_guide"], ["lb", "learners_book"], ["authors", "authors_label"]]) {
      const w = LEXI.label(id);
      if (w) labels[k] = w;
    }
    themeOverrides.labels = labels;
    const tr = (s) => s
      .replace(/\bgrade\b/i, (m) => labels.grade || m)
      .replace(/\bform\b/i, (m) => labels.form || m)
      .replace(/teacher['’]?s\s+guide/i, (m) => labels.tg || m)
      .replace(/learner['’]?s\s+book/i, (m) => labels.lb || m);
    if (themeOverrides.hdrtab) themeOverrides.hdrtab = titleCase(tr(themeOverrides.hdrtab));
    const lvlId = { "Early Childhood Education Level": "level_ece", "Primary Education Level": "level_primary",
      "Secondary Education Ordinary Level": "level_ordinary", "Secondary Education Advanced Level": "level_advanced" }[eduLevel];
    const lvl = lvlId && LEXI.label(lvlId);
    if (lvl) {
      const subj = ov.subject || (THEMES[theme] || {}).subject;
      if (subj) themeOverrides.hdrleft = lvl + " " + subj;
      themeOverrides.eyebrow = lvl.toUpperCase();
      if (coverB && coverB.lines && coverB.lines[0] === eduLevel.toUpperCase()) coverB.lines[0] = lvl.toUpperCase();
    }
  }
  // Primary-school (Grade 3) books: the LEARNER'S books are set in Century Gothic —
  // a friendlier, rounded face for young readers — while the TEACHER'S guides keep
  // the house default (Arial body / Times New Roman header / Segoe UI display). The
  // LB and TG of a subject share one theme, so the distinction is made per-book by
  // filename (a TG is named "… TG …" or "… Teacher's …").
  const primaryTheme = theme === "primaryeng" || theme === "cts" || theme === "mathsci";
  const isTeacherBook = isTeacherBookName(base);
  // ECE learner's books follow the same rule: Avant Garde (Century Gothic) for young readers.
  const ece = eduLevel === "Early Childhood Education Level";
  if ((primaryTheme || ece) && !isTeacherBook) {
    themeOverrides.font = "Century Gothic";
    themeOverrides.bodyFont = "Century Gothic";
    themeOverrides.displayFont = "Century Gothic";
  }
  // CDC 2025 body-text size for LEARNER'S Books — young readers need larger text:
  //   Grade 1 → 18pt, Grade 2-3 → 16pt, Grade 4-6 → 14pt (Avant Garde / Century Gothic).
  // Teacher's Guides and secondary (Form) books keep the 12pt default (Arial/Times New
  // Roman), which is already CDC-compliant. The whole content hierarchy scales with it.
  //   ECE (Early Childhood) → 18pt, the same as Grade 1 (CDC ECE spec: Avant Garde 18pt).
  if (!isTeacherBook && (gnum || ece)) {
    const g = ece ? 1 : parseInt(gnum, 10);
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
  // tocTitle: the contents page's heading in the book's own words (a local-language
  // book's "BIJI MU KACHI" rather than the theme's "Table of Contents").
  if (ov.tocTitle) themeOverrides.toctitle = ov.tocTitle;
  // the author's own-language words for the contents title, the AUTHORS label and the
  // back cover's "Printed by" (see coverWords above)
  if (ov.coverWords) {
    if (ov.coverWords.contents) themeOverrides.toctitle = ov.coverWords.contents;
    if (ov.coverWords.authors) themeOverrides.authorsWord = ov.coverWords.authors;
    if (ov.coverWords.printedBy) themeOverrides.printedBy = ov.coverWords.printedBy;
  }
  if (ov.captionSize) themeOverrides.capSize = ov.captionSize;
  // "boxStripe": false — plain tinted activity/exercise/assessment boxes, no thick left border
  if (ov.boxStripe === false) themeOverrides.boxStripe = false;   // e.g. "12pt" (see capsz in the template)
  // The colours the AUTHOR gave text runs in the manuscript (a blue sub-topic line, a red
  // word) print black in a black-and-white book: nothing in it is coloured. White text is
  // kept (it sits on a dark band or table header).
  const unColour = (o) => {
    if (o == null || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(unColour); return; }
    if (typeof o.c === "string" && !/^f{6}$/i.test(o.c)) o.c = null;
    for (const v of Object.values(o)) if (v && typeof v === "object") unColour(v);
  };
  // Every Teacher's Guide prints black-and-white inside (CDC's requirement) with the
  // cover the one exception that stays full colour — so this is now the DEFAULT for
  // any book whose filename marks it a TG, not something each book's overrides.json
  // has to opt into. `blackWhite: false` in overrides.json is the escape hatch for the
  // rare TG that must stay in colour; `blackWhite: true` still works to force it on a
  // Learner's Book (which otherwise keeps its colour for young readers).
  const useBlackWhite = ov.blackWhite === false ? false : (ov.blackWhite === true || isTeacherBook);
  // inkText: true — the same for a colour book: every coloured heading/line the author
  // typed prints in the book's ink (the engine's own design colours stay).
  if (ov.inkText && !useBlackWhite) unColour(blocks);
  // Force every themed colour to black/grey and every callout box to a light grey panel
  // with a black title, so headings, banners, rules, bullets, tables and boxes all print
  // in black and white while their structure (bold titles, borders, bands) stays clear.
  if (useBlackWhite) {
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
    unColour(blocks);
  }
  // A Teacher's Guide takes a shifted version of its subject's cover colour, so it
  // is distinguishable at a glance from the Learner's Book it shares a theme with
  // (they were identical apart from the "TEACHER'S GUIDE"/"LEARNER'S BOOK" tag).
  // See tgCoverSignature() for how the shift is derived. This runs AFTER the
  // black-and-white block above, which sets covSignature back to the full-colour
  // signature — the cover is the one part of a TG that stays in colour, and this is
  // the colour it should stay in. A book can still pin its own with `coverColor`.
  if (isTeacherBook && !ov.coverColor) {
    themeOverrides.covSignature = tgCoverSignature(theme);
  }
  // Front-matter sections into the house order (Author … Acronyms); opt out per book.
  // Runs last, once the body-start marker and every heading are final.
  if (!ov.keepFrontOrder && variant !== "syllabus") blocks = orderFrontMatter(blocks);
  // termPages: "regex" — a heading/line matching it ("TEMU 1" = Term 1 in a Kiikaonde ECE
  // book) gets a page of its own in large type. One that would land just before the body
  // start is moved after it, so the term page opens the arabic-numbered body.
  if (ov.termPages) {
    const re = new RegExp(ov.termPages, "i");
    let n = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      // (also a term title the author boxed in a one-cell table — "Temu 1")
      const filled = b.t === "table" && Array.isArray(b.rows) ? b.rows.flat().map((c) => ((c && c.text) || "").trim()).filter(Boolean) : [];
      const cell1 = filled.length === 1 && b.rows.flat().every((c) => !c || !(c.imgs || []).length) ? filled[0] : null;
      if (!/^(head|label|para|h1|h2|h3)$/.test(b.t) && cell1 == null) continue;
      const t = (cell1 != null ? cell1 : b.text != null ? b.text : (b.segs || []).map((s) => s.t).join("")).trim();
      if (!re.test(t)) continue;
      // termWord: one spelling for every term page ("Term 2" typed in English -> "TEMU 2")
      const tt = ov.termWord ? t.replace(/^\S+/, ov.termWord).toUpperCase() : t;
      blocks[i] = { t: "termpage", text: tt }; n++;
      const nx = blocks.findIndex((x, k) => k > i && x.t !== "vspace");
      if (nx > 0 && blocks[nx].t === "bodystart") { const [bs] = blocks.splice(nx, 1); blocks.splice(i, 0, bs); i++; }
    }
    if (n) console.log(`   termPages: ${n} term page(s)`);
  }
  // lessonLabels: true — a lesson-plan Teacher's Guide written as "LABEL: text" lines
  // (MUFUNJISHI:, BAFUNDA:, LWESEKO: …). The ALL-CAPS label is set bold; a label line the
  // author put inside a numbered list stops being a list item (so it neither takes a
  // number nor shifts the count); "MUTWE:" / "MUTWE-KACHE:" lines and short ALL-CAPS
  // lines with no colon (strand titles such as "KUTELEKA NE KWAMBA") become headings.
  // Hand-typed page footers that ended up inside table cells are cleared.
  if (ov.lessonLabels) {
    const plain = (b) => (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join("")).replace(/\s+/g, " ").trim();
    const LABEL = /^([A-ZÑŇŊ][A-ZÑŇŊ'’\- ]{1,45}?(?:\s+\d+)?)\s*:\s*(.*)$/;
    const isCaps = (t) => t === t.toUpperCase() && /[A-Z]/.test(t);
    // "MUTWE:", "MUTWE-KACHE:", "MUTWE- KACHE:", "MUTWE –KACHE 0.1.9.2 …" (colon optional
    // when a topic number follows)
    const HEADLINE = /^MUTWE(\s*[-–]?\s*KACHE)?\s*(:|(?=\s*[0-9O]\.\d))/i;
    let n = 0;
    for (const b of blocks) {
      if (b.t === "table" && Array.isArray(b.rows)) {
        for (const r of b.rows) for (const c of r) if (c && /^P\s*a\s*g\s*e\s*\|\s*([ivxlc]+|\d+)$/i.test((c.text || "").trim())) { c.text = ""; c.segs = null; }
        b.rows = b.rows.filter((r) => r.some((c) => c && ((c.text || "").trim() || (c.imgs && c.imgs.length))));
        continue;
      }
      if (!/^(para|listitem|label|head|h3)$/.test(b.t)) continue;
      const t = plain(b);
      if (!t) continue;
      if (HEADLINE.test(t) || (isCaps(t) && !t.includes(":") && t.length <= 40 && b.t !== "head")) {
        b.t = "head"; b.text = t; delete b.segs; delete b.marker; n++; continue;
      }
      const m = t.match(LABEL);
      if (m && isCaps(m[1])) {
        b.t = "para"; delete b.marker; delete b.text;
        b.segs = [{ t: m[1].trim() + ":", b: true, it: false, c: null }];
        if (m[2]) b.segs.push({ t: " " + m[2], b: false, it: false, c: null });
        n++;
      }
    }
    // each run of numbered items under a label restarts at 1; numbered items and bullets
    // nest one level under their label, roman (i., ii.) and letter (a., b.) items one
    // level further, under the numbered step they belong to
    // A number the author TYPED at the start of a plain line ("1.Mwamonapo ka…?") is a
    // sub-question under the step above: it keeps its own number, nests one level in,
    // and does not break the step numbering of the Word list around it.
    for (const b of blocks) {
      if (b.t !== "para" || !Array.isArray(b.segs) || (b.segs[0] && b.segs[0].b)) continue;
      const t = b.segs.map((s) => s.t).join("");
      const m = t.match(/^\s*(\d{1,2})\.\s*(\S[\s\S]*)$/);
      if (!m) continue;
      b.t = "listitem"; b.marker = `${m[1]}.`; b.typed = true;
      b.segs = [{ t: m[2].trim(), b: false, it: false, c: null }];
    }
    let k = 0;
    for (const b of blocks) {
      if (b.t === "listitem" && b.typed) { b.nest = k ? 2 : 1; continue; }
      if (b.t === "listitem") {
        const mk = String(b.marker || "").trim();
        // (`nest`, not `lvl`: imported list items already carry Word's own `lvl`)
        if (/^\d+[.)]$/.test(mk)) { k++; b.marker = `${k}.`; b.nest = 1; }
        else if (/^\(?([ivx]+|[a-z])[.)]$/i.test(mk)) b.nest = k ? 2 : 1;
        else b.nest = k ? 2 : 1;                      // a bullet under a step nests under it
      } else if (b.t !== "vspace") k = 0;
    }
    console.log(`   lessonLabels: ${n} lesson label line(s) set`);
  }
  // A picture book (untableImages) has no boxes: an activity box left with no body (its
  // picture follows it) is just the activity's heading, like every other one.
  if (ov.untableImages) for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].t === "activity" && !(blocks[i].body || []).length) blocks[i] = { t: "head", text: blocks[i].title };
  }
  // strandPages: true — in a picture book each strand ("Ukusambilila Ukutampa
  // Ukubelenga / Umutwe: … / IFILEKABILWA UKWISHIBA: …") opens a fresh page, so its
  // headings and outcomes never sit at the foot of a page with their pictures overleaf.
  // A strand that opens a unit already follows the unit banner and keeps its place.
  if (ov.strandPages) {
    for (let i = 0; i < blocks.length; i++) {
      if (!blocks[i].outcomes) continue;
      let j = i;
      while (j > 0 && /^(head|h3|label)$/.test(blocks[j - 1].t)) j--;
      const prev = blocks.slice(0, j).reverse().find((b) => b.t !== "vspace");
      if (!prev || /^(h1|pagebreak|termpage|bodystart)$/.test(prev.t)) continue;
      blocks.splice(j, 0, { t: "pagebreak" });
      i++;
    }
  }
  // restartNumbering: true — each run of numbered items starts again at 1 after a
  // heading (a Word list the author let run on from the last unit's test: 4., 5.); a
  // number the author typed by hand at the start of a line ("2.    Penta …") joins it.
  if (ov.restartNumbering) {
    let k = 0;
    for (const b of blocks) {
      if (b.t === "para" && Array.isArray(b.segs) && !(b.segs[0] && b.segs[0].b)) {
        const txt = b.segs.map((s) => s.t).join("");
        const m = txt.match(/^\s*(\d{1,2})\.\s+(\S[\s\S]*)$/);
        const ml = txt.match(/^\s*([a-h])\.\s+(\S[\s\S]*)$/);      // a hand-typed "a. foloko" under a question
        if (m && k) { b.t = "listitem"; b.marker = `${m[1]}.`; b.segs = [{ t: m[2].trim(), b: false, it: false, c: null }]; }
        else if (ml && k) { b.t = "listitem"; b.marker = `${ml[1]})`; b.segs = [{ t: ml[2].trim(), b: false, it: false, c: null }]; continue; }
      }
      if (b.t === "listitem" && /^\d+[.)]$/.test(String(b.marker || "").trim())) b.marker = `${++k}.`;
      else if (/^(head|h1|h2|h3|label|termpage)$/.test(b.t)) k = 0;
    }
  }
  // listLabels: ["Mtundu wa otengamo mbali:"] — a line the author numbered as the FIRST item
  // of a list is really the list's label: every such item becomes a plain label line, and
  // the items after it count again from the start (i., ii. … / 1., 2. … / a., b. …).
  for (const lab of ov.listLabels || []) {
    let n = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.t !== "listitem" || (b.segs || []).map((s) => s.t).join("").trim() !== lab) continue;
      const mk = String(b.marker || "").trim();
      b.t = "para"; delete b.marker; delete b.nest; n++;
      const roman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
      let k = 0;
      for (let j = i + 1; j < blocks.length && blocks[j].t === "listitem"; j++, k++) {
        const m = String(blocks[j].marker || "").trim().match(/^\(?([ivx]+|\d+|[a-z])([.)])$/i);
        if (!m) break;
        const kind = /^[ivx]+$/i.test(m[1]) && /^[ivx]+$/i.test(mk.replace(/\W/g, "")) ? "r" : /^\d+$/.test(m[1]) ? "d" : "a";
        blocks[j].marker = (kind === "r" ? roman[k] : kind === "d" ? String(k + 1) : String.fromCharCode(97 + k)) + m[2];
      }
    }
    if (!n) console.warn("!  listLabels not matched:", lab);
  }
  // indentLists: true — every numbered / lettered / roman item in the body sits indented
  // with its text in one column: a line the author TYPED as "1. …", "a. …", "ii) …" (a
  // plain paragraph, so flush at the margin) becomes a real list item; numbered items sit
  // one step in, and letters, romans and bullets under a numbered question one step further.
  if (ov.indentLists) {
    // (a typed decimal number "3.1 Bweende" is its own marker, never "3." + "1 Bweende")
    const MK = /^\s*(\d{1,2}(?:\.\d{1,2})+\.?(?=\s)|\(?(?:\d{1,2}|[a-h]|[ivx]{1,4})[.)](?!\d))\s*(\S[\s\S]*)$/;
    // (inside a box too: "1. Ye kuswani - …" typed in a Musebezi box becomes a real list line)
    for (const bx of blocks) {
      if (!Array.isArray(bx.body)) continue;
      for (const it of bx.body) {
        if (!it || it.t !== "para" || it.isList || !Array.isArray(it.segs) || !it.segs.length) continue;
        const txt = it.segs.map((s) => s.t).join("");
        const m = txt.match(MK);
        if (!m || m[2].length < 2 || /^\d+(\.\d+)+/.test(m[1])) continue;
        let cut = txt.indexOf(m[2]);
        const segs = [];
        for (const s of it.segs) { if (cut >= s.t.length) { cut -= s.t.length; continue; } segs.push({ ...s, t: s.t.slice(cut) }); cut = 0; }
        it.segs = segs; it.marker = m[1].trim(); it.isList = true;
      }
    }
    let body = !!ov.indentListsFront, k = false, n = 0, lastNest = 0;
    // (indentListsFront: the front-matter sections too — "1.Kubala ka kutwisiso" in the Introduction)
    for (const b of blocks) {
      if (b.t === "bodystart") { body = true; continue; }
      if (!body) continue;
      // A numbered/lettered line the author styled as a HEADING is a list item too when it
      // is an answer blank ("a. ……………") or the first question right under a test or
      // exercise heading ("LWESEKO" / "1. Lenga bipelu …"). A strand title such as
      // "1. KUTELEKA NE KWAMBA" stays a heading.
      if (b.t === "head" && !b.colourHead) {
        const ht = String(b.text || "");
        const m = ht.match(MK);
        const prev = blocks.slice(0, blocks.indexOf(b)).reverse().find((x) => x.t !== "vspace");
        const underTest = prev && prev.t === "head" && LEXI.boxKind(prev.text || "") && /^(exercise|assessment)$/.test(LEXI.boxKind(prev.text || ""));
        // (an answer blank may have no full stop after its letter: "a………")
        const blank = ht.match(/^\s*([a-h]|\d{1,2})[.)]?\s*([.…_]{5,}\s*)$/);
        if (blank) { b.t = "para"; b.segs = [{ t: `${blank[1]}. ${blank[2].trim()}`, b: false, it: false, c: null }]; }
        else if (m && (/^[.…_\s]+$/.test(m[2]) || underTest)) { b.t = "para"; b.segs = [{ t: b.text, b: false, it: false, c: null }]; }
      }
      if (b.t === "para" && Array.isArray(b.segs) && b.segs.length) {
        const txt = b.segs.map((s) => s.t).join("");
        const m = txt.match(MK);
        if (m && m[2].length > 1) {
          // drop the marker from the runs (it may be its own bold run: "1." + " Nemba …")
          let cut = txt.indexOf(m[2]);
          const segs = [];
          for (const s of b.segs) {
            if (cut >= s.t.length) { cut -= s.t.length; continue; }
            segs.push({ ...s, t: s.t.slice(cut) }); cut = 0;
          }
          b.t = "listitem"; b.marker = m[1].trim(); b.segs = segs; b.typed = true; n++;
        }
      }
      // (a bullet sits one step further in than the numbered / lettered / roman item it
      // belongs to: "a. Kaheka" then "• Mudimu: …", "• Kulumbulula: …")
      if (b.t === "listitem") {
        const mk = String(b.marker || "").trim();
        const bullet = !/[0-9A-Za-z]/.test(mk);
        if (/^\d+(\.\d+)+\.?$/.test(mk)) { b.nest = k ? 2 : 1; lastNest = b.nest; }   // "3.1" under "3"
        else if (/^\(?\d+[.)]?$/.test(mk)) { k = true; b.nest = 1; lastNest = 1; }
        else if (bullet && lastNest) b.nest = Math.min(lastNest + 1, 3);
        else { b.nest = k ? 2 : 1; if (!bullet) lastNest = b.nest; }
      } else if (/^(head|h1|h2|h3|label|termpage|activity|exercise|assessment)$/.test(b.t)) { k = false; lastNest = 0; }
      else if (b.t === "para" && (b.segs || []).some((s) => (s.t || "").trim())) lastNest = 0;
    }
    if (n) console.log(`   indentLists: ${n} typed item(s) made list items`);
  }
  // keepHeadsWithUnit: true — short headings that sit directly before a unit heading
  // ("Kuteleka ne Kwamba / Mutwe: Mazhina" then "KISHINA 3") open the unit's page with
  // it, above the unit title, instead of being stranded alone on the page before.
  if (ov.keepHeadsWithUnit) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].t !== "h1" || blocks[i].brk === false) continue;
      let j = i;
      while (j > 0 && /^(head|h3|label)$/.test(blocks[j - 1].t)) j--;
      if (j === i) continue;
      blocks[i].brk = false;
      blocks.splice(j, 0, { t: "pagebreak" });
      i++;
    }
  }
  // centreSection: ["NEMBI"] — centre a whole front-matter page (its heading and lines).
  for (const title of ov.centreSection || []) {
    const i = blocks.findIndex((b) => b.t === "h1" && (b.text || "").trim().toUpperCase() === String(title).toUpperCase());
    if (i < 0) { console.warn("!  centreSection not matched:", title); continue; }
    blocks[i].centre = true;
    for (let k = i + 1; k < blocks.length && !/^(h1|bodystart|termpage)$/.test(blocks[k].t); k++) {
      const b = blocks[k];
      if (b.t === "para") b.align = "center";
      else if (/^(head|label|h2|h3)$/.test(b.t)) blocks[k] = { t: "para", align: "center", segs: [{ t: (b.text || "").trim(), b: true, it: false, c: null }] };
    }
  }
  // uniformImages: <mm> — every picture in the book at the same height (picture books).
  if (ov.uniformImages) {
    const h = Number(ov.uniformImages);
    // a picture the author made extra wide (a 2x2 grid of photos in one image) is
    // given the full text width instead of the common height, so its parts stay legible
    // (two pictures back to back belong to one activity: both take the common height, so
    // the pair shares a page instead of the second being pushed over, half a page empty)
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const paired = b.t === "image" && ((blocks[i - 1] || {}).t === "image" || (blocks[i + 1] || {}).t === "image");
      if (b.t === "image") b.hmm = b.w && b.w > 560 && !b.tall && !paired ? 0 : h;
      else if (b.t === "imagerow") for (const im of b.images || []) im.hmm = h;
    }
  }
  // imprint: { copyright, rights, isbn, groups: [{ label, lines }] } — rewrite a messy
  // copyright page in the house layout (as the Art & Design Form 1 LB): the © line in
  // bold, the rights paragraph, the ISBN, then each credit as a bold "… by:" label with
  // its names centred under it.
  if (ov.imprint) {
    const i = blocks.findIndex((b) => b.t === "titlepage");
    const j = blocks.findIndex((b, k) => k > i && b.t === "toc");
    if (i < 0 || j < 0) console.warn("!  imprint: no copyright page found");
    else {
      const im = ov.imprint;
      const p = (t, bold) => ({ t: "para", align: "center", segs: [{ t, b: !!bold, it: false, c: null }] });
      const out = [{ t: "vspace", h: "5mm" }];
      if (im.copyright) out.push(p(im.copyright, true));
      if (im.rights) out.push(p(im.rights));
      if (im.isbn != null) out.push({ t: "vspace", h: "8mm" }, { t: "para", align: "center", segs: [{ t: "ISBN: ", b: false, it: false, c: null }, { t: im.isbn, b: true, it: false, c: null }] });
      for (const g of im.groups || []) {
        out.push({ t: "vspace", h: "5mm" }, p(g.label, true));
        for (const l of g.lines || []) out.push(p(l));
      }
      blocks.splice(i + 1, j - i - 1, ...out);
      // The manuscript's own credits block (ALEMBI: names, ZITHUNZI:, WOKONZA BUKU: …) can
      // survive as a separate front section after the contents page. When every line of a
      // front section is already on the new imprint page, it is that duplicate — drop it.
      const imp = new Set([...(im.groups || []).flatMap((g) => [g.label, ...(g.lines || [])]), im.rights || "", im.copyright || ""]
        .map((s) => s.toLowerCase().replace(/[^\p{L}\d]+/gu, "")));
      const plainB = (b) => (b.text != null ? b.text : (b.segs || []).map((s) => s.t).join(""));
      const key = (s) => s.toLowerCase().replace(/[^\p{L}\d]+/gu, "");
      const body0 = blocks.findIndex((b) => b.t === "bodystart");
      for (let a = 0; a < (body0 < 0 ? blocks.length : body0); a++) {
        if (blocks[a].t !== "h1") continue;
        let z = blocks.findIndex((b, k) => k > a && (b.t === "h1" || b.t === "bodystart"));
        if (z < 0) z = blocks.length;
        const lines = blocks.slice(a + 1, z).flatMap((b) => plainB(b).split("\n")).map(key).filter(Boolean);
        // ("ZITHUNZI:Olemba" — a label and its value glued in one line — counts as two)
        // (an address line "Chishango Road" is part of the imprint's "Chishango Road, P.O. Box 32708")
        const inImp = (l) => imp.has(l) || (l.length >= 6 && [...imp].some((x) => x.includes(l)));
        const known = (l) => inImp(l) || [...imp].some((x) => x && l.startsWith(x) && inImp(l.slice(x.length)));
        if (lines.length >= 2 && lines.every(known)) {
          blocks.splice(a, z - a);
          console.log("   imprint: dropped the manuscript's duplicate credits section");
          break;
        }
      }
    }
  }
  // imprintSpacing: "0.3em" — fit a long copyright/credits page on ONE page (an ECE book's
  // 18pt text makes it spill) by tightening its line gaps and the gaps between its credit
  // groups. The text size never changes.
  if (ov.imprintSpacing) {
    const i = blocks.findIndex((b) => b.t === "titlepage");
    const j = blocks.findIndex((b, k) => k > i && b.t === "toc");
    if (i < 0 || j < 0) console.warn("!  imprintSpacing: no imprint page found");
    else {
      for (let k = i + 1; k < j; k++) if (blocks[k].t === "vspace") blocks[k].h = ov.imprintGap || "2mm";   // (imprintGap: breathing space kept between the credit groups)
      blocks.splice(j, 0, { t: "parspacing", v: "0.86em" });
      blocks.splice(i + 1, 0, { t: "parspacing", v: ov.imprintSpacing });
    }
  }
  // tightSection: [{ title: "PREFACE", spacing: "1em", sig: "6mm" }] — pull a front-matter
  // section onto one page (e.g. a signature spilling onto its own page) by tightening
  // ITS paragraph gaps (and the gap above its signature). The text size never changes.
  for (const ts of ov.tightSection || []) {
    const i = blocks.findIndex((b) => b.t === "h1" && (b.text || "").trim().toUpperCase() === String(ts.title).toUpperCase());
    if (i < 0) { console.warn("!  tightSection not matched:", ts.title); continue; }
    let j = blocks.findIndex((b, k) => k > i && (b.t === "h1" || b.t === "bodystart"));
    if (j < 0) j = blocks.length;
    if (ts.sig) for (let k = i; k < j; k++) if (blocks[k].t === "sigspace") blocks[k].h = ts.sig;
    const front = (blocks.find((b) => b.t === "showpage") || {}).spacing || "1.9em";
    blocks.splice(j, 0, { t: "parspacing", v: front });
    blocks.splice(i + 1, 0, { t: "parspacing", v: ts.spacing || "1em" });
  }
  if (ov.coverColor) themeOverrides.covSignature = String(ov.coverColor).replace(/^#/, "");
  // Last content pass: push every mark allocation flush against the text column's
  // right edge (house style — see splitMarksToFr). Must run after every pass that
  // still expects a plain `.t` string on each segment in a run.
  applyMarkFlushRight(blocks);
  const tmpl = fs.readFileSync(path.join(__dirname, "generic-template.typ"), "utf8");
  // Inject the theme dict ABOVE the template so its functions capture it.
  // labelStyle: "sentence" — the lesson labels ("KWEULULA MULONGESHI:", "SETEKO
  // YAKUNANGAKANA") read as bold sentence-case words at body size with breathing space
  // above, instead of small tracked capitals. Also catches the same labels typed as plain
  // capital-letter lines ("UHASHI WAKUNANGAKANA VYUMA: kushimutwila…" → bold lead-in).
  if (ov.labelStyle === "sentence") {
    const GAP = "1.5em";
    const sc = (s) => s.toLowerCase().replace(/^([^\p{L}]*)(\p{L})/u, (m, a, c) => a + c.toUpperCase())
      .replace(/(:\s*)(\p{L})/u, (m, a, c) => a + c.toUpperCase());
    const caps = (s) => /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s);
    let nl = 0, np = 0, nh = 0;
    // a heading whose words the book uses as a LABEL elsewhere ("Seteko yakunangakana",
    // "Vinoma") is that label too — the author just typed it differently that time
    const lkey = (t) => (t || "").toLowerCase().replace(/[:\s]+$/, "").replace(/\s+/g, " ").trim();
    const labelSet = new Set(blocks.filter((b) => b.t === "label").map((b) => lkey(b.text)));
    // (labelWords: the book names its labels outright, when the manuscript never uses them as labels)
    for (const w of ov.labelWords || []) labelSet.add(lkey(w));
    // only the BODY: the front matter (imprint credits, signatures "Noriana Muneka (Ms.)",
    // "ZAMBIA EDUCATIONAL PUBLISHING HOUSE") keeps the author's own casing and layout
    const body0 = Math.max(0, blocks.findIndex((b) => b.t === "bodystart"));
    for (const b of blocks.slice(body0)) {
      if (/^(head|h3)$/.test(b.t) && b.text && labelSet.has(lkey(b.text))) {
        b.t = "label"; delete b.segs; nh++;
      }
    }
    for (let i = body0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.t === "label") {
        b.text = sc(b.text.trim()); b.keepCase = true; b.plainLabel = true; b.gapAbove = GAP; nl++;
        continue;
      }
      if (b.t !== "para" || !Array.isArray(b.segs) || !b.segs.length || b.segs[0].m) continue;
      const all = b.segs.map((s) => s.t).join("").trim();
      // a whole line of capitals, a few words ("SETEKO YAKUNANGAKANA", "MWAKUNANGWILA")
      if (caps(all) && all.length <= 45 && all.split(/\s+/).length <= 5 && /^\p{Lu}/u.test(all)) {
        blocks[i] = { t: "label", text: sc(all), keepCase: true, plainLabel: true, gapAbove: GAP }; np++;
        continue;
      }
      // a capital-letter lead-in ending in a colon, then the content
      const s0 = b.segs[0];
      const m = s0.t.match(/^(\s*\p{Lu}[\p{Lu}'’ ]{2,40}:)([\s\S]*)$/u);
      if (!m) continue;
      let rest = m[2];
      const restAll = rest + b.segs.slice(1).map((s) => s.t).join("");
      // "CHILONGESELO: KWIVWILILA NAKUHANJIKA" — the value is a capitals title too
      const lead = caps(restAll) ? sc(m[1] + restAll) : sc(m[1]);
      if (caps(restAll)) { b.segs = [{ ...s0, t: lead, b: true }]; }
      else b.segs = [{ ...s0, t: lead, b: true }, { ...s0, t: rest, b: s0.b }, ...b.segs.slice(1)];
      b.gapAbove = GAP; np++;
    }
    // a label with nothing under it (its content was a removed placeholder such as
    // "INSERT ANSWERS") — the next block is already a unit / sub-topic heading
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].t === "label" && blocks[i].plainLabel && (!blocks[i + 1] || /^(h1|h2)$/.test(blocks[i + 1].t))) blocks.splice(i, 1);
    }
    console.log(`   labelStyle: ${nl} label(s) (${nh} from headings), ${np} capital-letter line(s) restyled`);
  }
  // (runs last, so it also reaches headings that later passes create)
  // headingCase: { "head": "sentence", "h2": "upper", … } and caseKeep: ["HIV", "Zambia"]
  // — one casing rule per heading level, whatever the author typed ("VYAKULINGA 2:",
  // "Vyakulinga 2:" and "Mutwe Wachihande … Kutanga Nakwivwishisa" all come out the same).
  // "sentence": first letter, and the first letter after a "Label N:" colon, capitalised;
  // "upper"; "title". Words in caseKeep keep the given spelling.
  if (ov.headingCase) {
    const keep = new Map((ov.caseKeep || []).map((w) => [w.toLowerCase(), w]));
    const fixKeep = (s) => s.replace(/\p{L}+/gu, (w) => keep.get(w.toLowerCase()) || w);
    // (a leading list marker — "(i)", "a)", "2." — is kept as typed; the word after it is capitalised)
    const sentence = (s) => {
      const mk = (s.match(/^\s*(\(?(?:[ivx]{1,4}|[a-z]|\d{1,2})[.)])\s+/i) || [""])[0];
      return mk + fixKeep(s.slice(mk.length).toLowerCase()
        .replace(/^([^\p{L}]*)(\p{L})/u, (m, a, c) => a + c.toUpperCase())
        .replace(/^([^:]{1,40}:)\s*(\p{L})/u, (m, a, c) => a + " " + c.toUpperCase()));
    };
    const title = (s) => fixKeep(s.toLowerCase().replace(/(^|[\s(])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()));
    const fn = { sentence, upper: (s) => fixKeep(s.toUpperCase()), title };
    const n = {};
    // (body only — front-matter section titles and signatures keep their own casing)
    const body0 = Math.max(0, blocks.findIndex((b) => b.t === "bodystart"));
    for (const b of blocks.slice(body0)) {
      const rule = ov.headingCase[b.t];
      if (!rule || !fn[rule]) continue;
      // (a heading never ends in a full stop, colon or semicolon: "MWASO.", "Mulimo:")
      if (b.text != null) b.text = fn[rule](b.text.replace(/\s*[.:;]\s*$/, ""));
      else if (Array.isArray(b.segs) && b.segs.length) {
        const t = fn[rule](b.segs.map((s) => s.t).join(""));
        b.segs = [{ ...b.segs[0], t }];
      } else continue;
      n[b.t] = (n[b.t] || 0) + 1;
    }
    console.log(`   headingCase: ${Object.entries(n).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  }
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
  const gradeFolder = ov.grade ? titleCaseGrade(ov.grade) : (gm ? titleCaseGrade(gm[0]) : eduLevel === "Early Childhood Education Level" ? "ECE" : "Other");
  const bookDir = path.join(OUTPUT_DIR, gradeFolder, base);
  fs.mkdirSync(bookDir, { recursive: true });
  const outPath = path.join(bookDir, `${base} - typeset.pdf`);
  fs.writeFileSync(outPath, Buffer.from(pdf));
  // keep the generated .typ alongside the PDF (and by the runner) for inspection
  fs.writeFileSync(path.join(bookDir, "_source.typ"), doc);
  fs.writeFileSync(path.join(__dirname, "_last-docx.typ"), doc);

  const n = blocks.length;
  console.log(`Typeset: ${base}  [theme: ${theme}]  (${n} blocks, ${media.length} images) -> ${outPath} [${fs.statSync(outPath).size} bytes]`);

  // Publisher rule: a book of more than 112 pages has a SPINE. Build the printer's
  // cover spread — back cover | spine | front cover on one sheet — as a second PDF.
  // Spine width from the page count (`spineMmPerPage`, default 0.055 mm a page for
  // 80 gsm text paper, plus 1 mm for the cover board); the spine carries the book name,
  // the level, the book type when there is room, and the ZEPH logo at the foot.
  if (variant !== "syllabus") {
    const { PDFDocument } = require("pdf-lib");
    const book = await PDFDocument.load(pdf);
    const pages = book.getPageCount();
    const spreadPath = path.join(bookDir, `${base} - cover spread.pdf`);
    // (a book of 112 pages or fewer has NO spine, but with coversInBook it still opens
    // on the back | front cover sheet, the two covers meeting at the fold)
    const hasSpine = pages > 112;
    if (hasSpine || ov.coversInBook) {
      const cov = blocks.find((b) => b.t === "cover") || {};
      const lines = cov.lines || [];
      const LEVEL = /\b(form|fo+mu|grade)\s*\d+|\bECE\b/i;
      const lvLine = [...lines].reverse().find((l) => LEVEL.test(l)) || "";   // (last: a local eyebrow may name a form too)
      const level = (lvLine.match(LEVEL) || [""])[0];
      const T = THEMES[theme] || {};
      const name = (lvLine.replace(LEVEL, "").replace(/\s+/g, " ").trim()
        || ov.subject || T.subject || lines[0] || base).trim();
      const booktype = (ov.coverWords || {}).booktype || ov.booktype || (isTeacherBookName(base) ? "Teacher's Guide" : "Learner's Book");
      const mm = Number(ov.spineMmPerPage) || 0.055;
      const spineMm = Math.round((pages * mm + 1) * 10) / 10;
      const logo = cov.logo && cov.logo.file ? `(file: ${S(cov.logo.file)})` : "none";
      const spineDoc = `${themeTypst(theme, themeOverrides)}${tmpl}\n#spine(${S(name)}, ${S(level)}, ${S(booktype)}, ${logo}, ${spineMm}mm)\n`;
      const spinePdf = hasSpine ? await PDFDocument.load(compiler.pdf({ mainFileContent: spineDoc })) : null;
      // coversInBook: true — the spread becomes the book's FIRST page (as the syllabuses
      // do) in place of the separate front and back cover pages; otherwise it is written
      // as its own "cover spread" PDF.
      const inBook = !!ov.coversInBook;
      const out = inBook ? book : await PDFDocument.create();
      const [front, back] = inBook
        ? [await book.embedPage(book.getPage(0)), await book.embedPage(book.getPage(pages - 1))]
        : await out.embedPdf(book, [0, pages - 1]);
      const [sp] = hasSpine ? await out.embedPdf(spinePdf, [0]) : [null];
      const W = front.width, H = front.height, SW = hasSpine ? sp.width : 0;
      // Trim allowance: the printer trims every cover by 2 mm on each side, so the sheet is
      // 2 mm larger all round (`coverTrimMm`). Each cover is drawn ONCE, scaled up evenly
      // (about 1.6%) from its spine edge so its own artwork fills the extra 2 mm — no strips
      // spliced on, so no joins inside a cover. The spine is stretched to the full height
      // and drawn 1 pt wider underneath both covers, so its two joins show no hairline.
      const B = (ov.coverTrimMm != null ? Number(ov.coverTrimMm) : 2) * 72 / 25.4;
      const size = [W * 2 + SW + 2 * B, H + 2 * B];
      const sheet = inBook ? out.insertPage(0, size) : out.addPage(size);
      const s = (H + 2 * B) / H, Ws = W * s, o = 1;
      if (hasSpine) sheet.drawPage(sp, { x: W + B - o, y: 0, width: SW + 2 * o, height: H + 2 * B });
      sheet.drawPage(back, { x: W + B - Ws, y: 0, width: Ws, height: H + 2 * B });
      sheet.drawPage(front, { x: W + B + SW, y: 0, width: Ws, height: H + 2 * B });
      if (inBook) {
        // drop the separate front (now page 1) and back cover pages
        book.removePage(book.getPageCount() - 1);
        book.removePage(1);
        fs.writeFileSync(outPath, await book.save());
        if (fs.existsSync(spreadPath)) fs.rmSync(spreadPath);
        console.log(hasSpine ? `   covers + ${spineMm} mm spine as the first page of the book (${pages} pages)` : `   covers (no spine: ${pages} pages ≤ 112) as the first page of the book`);
      } else {
        fs.writeFileSync(spreadPath, await out.save());
        console.log(`   cover spread with a ${spineMm} mm spine (${pages} pages) -> ${spreadPath}`);
      }
    } else if (fs.existsSync(spreadPath)) fs.rmSync(spreadPath);
  }

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
  // Track whether every file actually produced a PDF. A failure here (a bad
  // .docx, a Typst compile error, a missing file) was being logged and then
  // silently swallowed — the loop moved on to the next file and `main()`
  // returned normally, so the process exited 0 ("success") even though NO
  // PDF was written. `npm run zeph -- build` just forwards this same exit
  // code, so a build that actually failed still reported as done, with the
  // only sign being an easy-to-miss "Failed on <file>" line in the log. Exit
  // non-zero whenever any file failed, so a failed typeset is never mistaken
  // for a finished one.
  let failed = false;
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error("Not found:", f); failed = true; continue; }
    try { await typesetOne(f, themeName); } catch (e) { console.error("Failed on", f, "\n", e.stack || e.message); failed = true; }
  }
  if (failed) process.exit(1);
}

if (require.main === module) main();

module.exports = { emit, importDocx, typesetOne };
