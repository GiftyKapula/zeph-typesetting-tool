// CDC landscape syllabus passes (variant: "syllabus").
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { blockPlain } = require("../blocktext.js");
const fs = require("fs");
const path = require("path");
const { THEMES } = require("../themes.js");

// A CDC syllabus has NO callout boxes — its interior is front-matter prose + the 5-column
// matrix. Flatten any callout the box-detector produced (ASSESSMENT / CBA come through as
// `assessment` boxes) back to a plain h2 heading + its content as ordinary paragraphs.
function flattenSyllabusBoxes(blocks) {
  const para = (text, seg, isList) => ({ t: "para", plain: text,
    segs: (seg && seg.length) ? seg : [{ t: text, b: false, it: false, c: null }], isList: !!isList });
  const out = [];
  const isEnum = (t) => /^\s*(\d+|[a-z])[.)]\s/i.test(t || "");
  const pushTitle = (title) => {
    if (!title) return;
    if (isEnum(title)) out.push(para(title, [{ t: title, b: true, it: false, c: null }]));
    else out.push({ t: "h2", text: title });
  };
  for (const b of blocks) {
    if (b.t === "assessment" || b.t === "exercise") {
      pushTitle((b.title || b.heading || "").trim());
      for (const s of b.intro || []) out.push(para(s));
      for (const p of b.parts || []) {
        // A part that carries a TABLE is re-emitted as a real table block, never
        // flattened to a paragraph. This mattered enormously: when the box detector
        // wraps a stretch of a syllabus (an "ASSESSMENT" heading is enough to start a
        // box, and it then runs to the next heading it recognises), the 5-column
        // matrix — the entire substance of the syllabus — gets absorbed into that box
        // as a table part. Dropping it here silently produced a 10-page syllabus with
        // every topic, competence and expected standard missing, and a clean build log.
        // Keyed on the part's KIND, not merely on it having `rows`: a `colgrid` part
        // also carries `rows`, but shaped { marker, cells[] } rather than an array of
        // cells, and emitting one as a table throws "row is not iterable".
        if (p.kind === "table" && Array.isArray(p.rows)) { out.push({ t: "table", rows: p.rows }); continue; }
        if (p.kind === "colgrid") {
          out.push({ t: "colgrid", rows: p.rows, ncol: p.ncol, hasMarker: p.hasMarker, header: p.header });
          continue;
        }
        if (p.kind === "image" && Array.isArray(p.images)) { for (const im of p.images) out.push({ t: "image", ...im }); continue; }
        const mk = p.marker ? p.marker + " " : "";
        const seg = (p.qseg && p.qseg.length)
          ? [{ t: mk, b: false, it: false, c: null }, ...p.qseg]
          : [{ t: mk + (p.q || ""), b: false, it: false, c: null }];
        out.push(para(mk + (p.q || ""), seg, true));
        if (p.a) out.push(para(p.a, p.aseg));
      }
      for (const s of b.extra || []) out.push(para(s));
    } else if (b.t === "activity" || b.t === "framedsection") {
      pushTitle((b.title || "").trim());
      for (const bb of b.body || []) out.push(bb);
    } else if (b.t === "keypoints" || b.t === "fact") {
      pushTitle((b.title || "").trim());
      for (const pt of b.points || []) out.push(para(pt, null, true));
      for (const bb of b.body || []) out.push(bb);
    } else if (b.t === "box") {
      const body = b.body || [];
      if (body.length && body[0].t === "para") {
        pushTitle((body[0].plain || "").trim());
        for (const bb of body.slice(1)) out.push(bb);
      } else for (const bb of body) out.push(bb);
    } else {
      out.push(b);
    }
  }
  return out;
}

// A syllabus signatory reads: NAME / office / MINISTRY OF EDUCATION. The manuscript styles
// the org line as a heading (left accent bar) and leaves name/office plain. House style: a
// clear space ABOVE, the NAME and ORGANISATION bold, the office line NOT bold, no bar.
function fixSyllabusSignatures(blocks) {
  const txtOf = (b) => (b ? (blockPlain(b) || "").trim() : "");
  const prevNonEmpty = (from) => { let j = from; while (j >= 0 && txtOf(blocks[j]) === "") j--; return j; };
  const bold = (t) => ({ t: "para", plain: t, segs: [{ t, b: true, it: false, c: null }] });
  const plain = (t) => ({ t: "para", plain: t, segs: [{ t, b: false, it: false, c: null }] });
  for (let i = 0; i < blocks.length; i++) {
    if (!/^ministry of education$/i.test(txtOf(blocks[i]))) continue;
    blocks[i] = bold(txtOf(blocks[i]).toUpperCase());
    const ti = prevNonEmpty(i - 1);
    if (ti < 0) continue;
    blocks[ti] = plain(txtOf(blocks[ti]));
    const ni = prevNonEmpty(ti - 1);
    if (ni < 0) continue;
    blocks[ni] = bold(txtOf(blocks[ni]));
    blocks.splice(ni, 0, { t: "sigspace" });
    i++;
  }
  return blocks;
}

// Arrange the syllabus front matter: cover (unnumbered) → title page (B&W echo, unnumbered)
// → [roman i] copyright + imprint → TOC → [roman visible] Vision … front matter → level
// divider page → [arabic 1] Competences & Descriptors → body → back cover. The counter
// resets/visibility ride on the marker blocks (titlestart/showpage/bodystart).
function applySyllabusFront(blocks, { year = "", level = "", isbn = null } = {}) {
  const coverIdx = blocks.findIndex((b) => b.t === "cover");
  const cov = coverIdx >= 0 ? blocks[coverIdx] : null;
  // Where the VISIBLE roman numbering starts: the first prose front-matter section.
  // Travel & Tourism opens that stretch with a VISION h1, but keying on "the first h1"
  // is a trap -- a manuscript whose front-matter headings are all lower-level has its
  // first h1 somewhere near the back (in the Special Education syllabus it was
  // REFERENCES), so numbering switched on two pages before the end and the book printed
  // no folios at all, with a clean build log. Fall back to the first heading of any
  // level after the copyright page.
  const isHead = (b) => /^h[123]$/.test(b.t) || b.t === "head";
  const crIdx = blocks.findIndex((b) => b.t === "para" && /all rights reserved/i.test(blockPlain(b) || ""));
  let visionIdx = blocks.findIndex((b) => b.t === "h1");
  if (visionIdx < 0 || (crIdx >= 0 && visionIdx > crIdx + 40))
    visionIdx = blocks.findIndex((b, i) => i > crIdx && isHead(b));
  // Arabic page 1 starts at the competences section -- the last front-matter heading
  // before the matrix. Matching only "COMPETENCES AND DESCRIPTORS" at h1/h2 was too
  // narrow: the Special Education syllabus calls it "Competencies to be developed" and
  // styles it a lower-level heading, so the body never started, the level divider never
  // appeared, and every page -- REFERENCES included -- numbered as roman front matter.
  const compIdx = blocks.findIndex((b) => (/^h[123]$/.test(b.t) || b.t === "head")
    && /^competen[ct](?:e|ie)s\b.*\b(descriptors|developed)\b/i.test((b.text || "").trim()));
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    if (cov && i === coverIdx + 1) {
      // Roman counting begins (silently) on the TITLE PAGE — the cover spread is page 1
      // of the sheet but is NOT counted, so the title page is roman i, Vision ≈ v.
      out.push({ t: "titlestart" });
      out.push({ t: "titlepage", lines: cov.lines || [], byline: cov.byline || [], hero: cov.heroGrey || cov.hero || null, logo: cov.logoGrey || cov.logo || null });
    }
    if (i === visionIdx && visionIdx >= 0) out.push({ t: "showpage", spacing: "0.95em" });
    // Arabic 1 begins on the LEVEL DIVIDER page (the "Secondary Teacher's Diploma" page).
    if (i === compIdx && compIdx >= 0) { out.push({ t: "bodystart" }); out.push({ t: "divider", text: level }); }
    out.push(blocks[i]);
    if (i === crIdx && crIdx >= 0) out.push({ t: "imprint", year, isbn });
  }
  // No separate back cover — the front + back covers are combined on the cover SPREAD.
  return out;
}

// The whole syllabus post-process run by typesetOne (after the generic passes): matrix
// header/column house style, cover crest + CDC badge, scope-and-sequence year split, the
// standard copyright page, and finally the full syllabus front matter. Mutates `media`
// (pushes the bundled cover assets) and returns the new block list.
function syllabusPostProcess(blocks, { media, theme, ov }) {
  blocks = flattenSyllabusBoxes(blocks);
  // The importer may KEEP the manuscript's list bullets inside matrix cells; the matrix
  // renders its own bullets, so strip the source ones (from cell text + segs) to avoid
  // a doubled "• •" in the activities column and a stray bullet on numbered topics.
  for (const b of blocks) {
    if (!Array.isArray(b.rows)) continue;
    for (const row of b.rows) for (const c of (Array.isArray(row) ? row : [])) {
      if (!c) continue;
      if (typeof c.text === "string") c.text = c.text.replace(/[•▪◦●·‣∙]\s?/g, "");
      if (Array.isArray(c.segs)) for (const s of c.segs) if (typeof s.t === "string") s.t = s.t.replace(/[•▪◦●·‣∙]\s?/g, "");
    }
  }
  // The manuscript's own "TABLE OF CONTENT" heading is left over after its TOC1 lines
  // became the generated outline; relabel it VISION (the section that follows it) so the
  // duplicate banner disappears and the outline shows VISION, not a self-referential TOC.
  for (const b of blocks) {
    if (/^h[12]$/.test(b.t) && /^table of contents?$/i.test((b.text || "").trim())) {
      b.t = "h1"; b.text = "VISION"; break;
    }
  }
  // The manuscript types its own table of contents as ordinary paragraphs -- a row of
  // ellipsis characters and a page number keyed in by hand ("METHODOLOGY......vii").
  // Those numbers are the AUTHOR'S Word pagination, not this typeset book's, so
  // reproducing them prints confident-looking page references that are simply wrong
  // (five entries in a row claimed page vii). Drop the hand-typed block and emit the
  // real outline instead, the way the Travel & Tourism syllabus does.
  const tocHeadAt = blocks.findIndex((b) => (/^h[123]$/.test(b.t) || b.t === "head")
    && /^table of contents?$/i.test((b.text || "").trim()));
  if (tocHeadAt >= 0 && !blocks.some((b) => b.t === "toc")) {
    // A hand-typed entry is a short line carrying a run of dot leaders.
    const isEntry = (b) => b && b.t === "para" && /[.\u2026]{4,}/.test(blockPlain(b) || "")
      && (blockPlain(b) || "").trim().length <= 200;
    let end = tocHeadAt + 1;
    while (end < blocks.length && (isEntry(blocks[end]) || (blockPlain(blocks[end]) || "").trim() === "")) end++;
    // Only swap when a typed-out list was actually found, never on a bare heading.
    if (blocks.slice(tocHeadAt + 1, end).some(isEntry)) blocks.splice(tocHeadAt, end - tocHeadAt, { t: "toc" });
  }
  blocks = fixSyllabusSignatures(blocks);
  // Appendix "YEAR 1" is a heading but "YEAR 2" a plain para — promote bare "YEAR N".
  for (const b of blocks) {
    if (b.t === "para" && /^year\s+\d+$/i.test((blockPlain(b) || "").trim())) {
      b.t = "head"; b.text = (blockPlain(b) || "").trim().toUpperCase(); delete b.segs;
    }
  }
  // COMPETENCES AND DESCRIPTORS table: first column (competence names) in UPPERCASE.
  for (const b of blocks) {
    if (!Array.isArray(b.rows)) continue;
    const hi = b.rows.findIndex((r) => r.length >= 2
      && /^competen/i.test((r[0].text || "").trim()) && /descriptor/i.test((r[1].text || "").trim()));
    if (hi < 0) continue;
    for (let ri = hi + 1; ri < b.rows.length; ri++) {
      const c = b.rows[ri][0];
      if (!c) continue;
      if (c.text) c.text = c.text.toUpperCase();
      if (Array.isArray(c.segs)) for (const s of c.segs) if (s.t) s.t = s.t.toUpperCase();
    }
  }
  // Indent a numbered item's body paragraphs to align under the heading text: a bold
  // "1. Project-Based Learning" heading, then its prose indented to line up with the
  // title. Resets at the next heading. (The numbered heading itself keeps its hanging
  // number, so it is NOT indented.)
  {
    const numbered = (s) => /^\d+(?:\.\d+)*\.?\s/.test((s || "").trim());
    let inNumbered = false;
    for (const b of blocks) {
      const plain = (blockPlain(b) || b.text || "").trim();
      if (/^h[123]$/.test(b.t) || b.t === "head" || b.t === "label") {
        // a NUMBERED heading ("1. Project-Based Learning") opens a numbered item; any
        // other heading closes it.
        inNumbered = numbered(plain); continue;
      }
      if (b.t !== "para") { inNumbered = false; continue; }
      if (!plain) continue;
      if (numbered(plain)) inNumbered = true;      // a numbered item written as a paragraph
      else if (inNumbered) b.sylIndent = true;     // its body — indent to align under the title
    }
  }
  const cov = blocks.find((b) => b.t === "cover");
  if (cov) {
    // Cover images: the Zambia coat of arms at the TOP (bundled asset — the engine may
    // force the ZEPH logo onto a manuscript cover, so don't rely on the manuscript's own
    // logo), and the CDC roundel below the band (the manuscript ships it as unreadable WMF).
    const crest = path.join(__dirname, "..", "assets", "zambia-crest.png");
    if (fs.existsSync(crest)) { media.push({ name: "syl_crest.png", src: crest }); cov.hero = { file: "syl_crest.png" }; }
    else if (cov.logo && cov.logo.file) cov.hero = cov.logo;
    const cdc = path.join(__dirname, "..", "assets", "cdc-badge.png");
    if (fs.existsSync(cdc)) { media.push({ name: "syl_cdc.png", src: cdc }); cov.logo = { file: "syl_cdc.png" }; }
    else cov.logo = null;
    // Greyscale crest + badge for the B&W title page (the cover keeps colour ones).
    const crestG = path.join(__dirname, "..", "assets", "crest-grey.png");
    const cdcG = path.join(__dirname, "..", "assets", "cdc-badge-grey.png");
    if (fs.existsSync(crestG)) { media.push({ name: "syl_crest_grey.png", src: crestG }); cov.heroGrey = { file: "syl_crest_grey.png" }; }
    if (fs.existsSync(cdcG)) { media.push({ name: "syl_cdc_grey.png", src: cdcG }); cov.logoGrey = { file: "syl_cdc_grey.png" }; }
  }
  const Tsyl = THEMES[theme] || {};
  blocks = applySyllabusFront(blocks, { year: Tsyl.year || "", level: Tsyl.eyebrow || "", isbn: ov.isbn || null });
  return blocks;
}

module.exports = { flattenSyllabusBoxes, fixSyllabusSignatures, applySyllabusFront, syllabusPostProcess };
