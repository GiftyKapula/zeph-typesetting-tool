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

const { ROOT, resolveBookPath } = require("./paths.js");
const INPUT_DIRS = [path.join(ROOT, "input"), path.join(ROOT, "books-to-typeset")];
// ZEPH_OUTPUT_DIR lets a test/regression run build somewhere other than the real output/.
const OUTPUT_DIR = process.env.ZEPH_OUTPUT_DIR ? path.resolve(process.env.ZEPH_OUTPUT_DIR) : path.join(ROOT, "output");

// The engine, one concern per module (see docs/ARCHITECTURE.md).
const { S, emit } = require("./emit.js");
const { deriveTitle, titleCase, titleCaseGrade, isTeacherBookName, eduLevelFor } = require("./naming.js");
const { blockPlain, setBlockText } = require("./blocktext.js");
const { applyOverrides } = require("./overrides.js");
const { boxifyActivities, dedupeAdjacentHeadings, fixStrayBodyH1s, stripEditorialComments, clearStrayRed, clearAllInlineColor, boldSafetyAndSteps, normaliseLessonBanners, normaliseUnitHeads, forceUnitThemes, uniformBoxLabelCase } = require("./passes/structure.js");
const { applySeriesFront, reorderFrontmatter } = require("./passes/series-front.js");
const { fixPhdCapitalisation, fixACappellaSpacing, reformatAcronyms, formatGlossary, reorderBackmatter, fillLayoutCredit, boldAuthorNames } = require("./passes/backmatter.js");
const { unboldLeadProse, mergeContinuationActivities, splitActivityTables, convertTableActivities, ensureOrIndividually, boldAssessmentSections, labelIntroductions, normaliseCompetenceLabels, groupLessonMeta } = require("./passes/activities.js");
const { applyMarkFlushRight } = require("./passes/marks.js");
const { columnizeLists, normaliseSpacing, splitAnswerLabels, displayifyColumnMath, stripPrimaryScaffold, proofPolish, normaliseQuestionMarkBold } = require("./passes/polish.js");
const { syllabusPostProcess } = require("./passes/syllabus.js");

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
  if (ov.fill || ov.textFix || ov.replace || ov.replaceExact || ov.editCell || ov.remove || ov.removeRange || ov.tables || ov.edit || ov.editAnswer || ov.setMarker || ov.moveBefore || ov.moveSectionBefore || ov.unitalic || ov.dropMath || ov.setCaption || ov.asHead || ov.pageBreakBefore || ov.forceFreshPage || ov.centre || ov.editAll || ov.unbold || ov.boldToItalic || ov.activityHeadsBlack || ov.insertHead || ov.recolor || ov.recolorHead || ov.italiciseFrom || ov.retext || ov.subtext || ov.replaceSection || ov.unlist || ov.asSection || ov.styleSection || ov.setHeading || ov.recase || ov.asPara || ov.mergePara || ov.renumberLessons || ov.renumberActivities || ov.renumberTopics || ov.renameNear || ov.centrePara || ov.boldFind || ov.underline || ov.splitBefore || ov.removeWhereNext || ov.fixExercise || ov.numberedTopics || ov.topicNumFirst || ov.stripCaptionLabels || ov.learnStatement || ov.recolorLabel || ov.insertText || ov.toTable || ov.stripUnderline || ov.replaceBlocks || ov.deleteRun || ov.monoLines || ov.imageToText) { applyOverrides(blocks, ov); }
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
      const grade = gm2 ? titleCaseGrade(gm2[0]) : "";
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
  let enhanced = 0, cropped = 0, rotated = 0, emfConv = 0;
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
  // Every Teacher's Guide prints black-and-white inside (CDC's requirement) with the
  // cover the one exception that stays full colour — so this is now the DEFAULT for
  // any book whose filename marks it a TG, not something each book's overrides.json
  // has to opt into. `blackWhite: false` in overrides.json is the escape hatch for the
  // rare TG that must stay in colour; `blackWhite: true` still works to force it on a
  // Learner's Book (which otherwise keeps its colour for young readers).
  const useBlackWhite = ov.blackWhite === false ? false : (ov.blackWhite === true || isTeacherBook);
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
  if (ov.coverColor) themeOverrides.covSignature = String(ov.coverColor).replace(/^#/, "");
  // Last content pass: push every mark allocation flush against the text column's
  // right edge (house style — see splitMarksToFr). Must run after every pass that
  // still expects a plain `.t` string on each segment in a run.
  applyMarkFlushRight(blocks);
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
  const gradeFolder = gm ? titleCaseGrade(gm[0]) : "Other";
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

module.exports = { emit, importDocx };
