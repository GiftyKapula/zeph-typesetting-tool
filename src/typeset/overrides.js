// Per-book editorial overrides (the <book>.overrides.json sidecar) applied to the block list.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { S, arr } = require("./emit.js");
const { segKey, blockPlain, setBlockText, setBlockSegs, editBlockText, editBlockAnswerText, allTextBlocks, mkSegs } = require("./blocktext.js");

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
  // A blank Word paragraph imports as a `vspace` block (no text field at all), not an
  // empty paragraph, and the line right after ours can be ANOTHER label — one containing
  // a colon ANYWHERE, not just at the end (some manuscripts glue a dot-leader straight
  // onto the label, e.g. "Cover and Book layout by:................." — the colon sits
  // mid-string, not at the end) — or one ending in a bare "by" with no colon at all
  // ("Illustrated by"). Never a value to fill, so it must not be mistaken for our
  // placeholder just because ours was blank.
  const FILL_LABELISH = /:|\bby\s*$/i;
  for (const f of ov.fill || []) {
    const i = blocks.findIndex((b) => blockPlain(b).trim().toLowerCase().startsWith(f.after.toLowerCase()));
    if (i < 0) continue;
    let target = -1;
    for (let j = i + 1; j < Math.min(i + 3, blocks.length); j++) {
      const b = blocks[j];
      if (b && b.t === "vspace") continue;
      const txt = blockPlain(b).trim();
      if (txt === "") continue;
      if (FILL_LABELISH.test(txt)) break;   // another label — nothing safe to reuse here
      target = j;
      break;
    }
    if (target >= 0) { setBlockText(blocks[target], f.text); continue; }
    // Nothing safe to reuse (only a blank line, or the very next real content is
    // another label) — insert a fresh line for the value right after the label,
    // rather than writing into a non-text `vspace` block (silently renders nothing)
    // or overwriting an unrelated section.
    blocks.splice(i + 1, 0, { t: "para", segs: [{ t: f.text, b: false, it: false, c: null }], align: "center" });
  }
  for (const r of ov.replace || []) {
    const b = flat.find((x) => blockPlain(x).includes(r.find));
    // Warn when nothing matched, the way edit/editAll/setMarker/fixExercise already do.
    // This was silent, so an override whose `find` drifted from the manuscript by one
    // space or a changed word simply did nothing and the book built clean — the edit
    // looked applied until someone read the page. Silence is the wrong default for a
    // primitive whose whole job is to change text that is meant to be there.
    if (!b) { console.warn("!  replace not matched:", r.find); continue; }
    // Honour the same lightweight markup every other author-facing primitive takes
    // (**bold**, *italic*, $math$) instead of flattening to one plain run. Activity
    // bodies are styled "bold label: italic body", so a flattened rewrite of a
    // Procedure or Teacher tips paragraph came out roman and unlabelled next to its
    // untouched siblings. Reviewers write their replacements as "**Procedure:** ..."
    // already, so this renders what they actually asked for. Text with no markers
    // parses to a single plain run, exactly as before.
    setBlockSegs(b, mkSegs(r.with));
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
  // editCell: [{ find, with }] — rewrite TABLE CELLS whose whole trimmed text === find,
  // or (falling back) a substring found inside a cell's text. Table cells live in a
  // block's `rows` (array of rows, each an array of {text,imgs[,segs]}) and are NOT
  // reached by the paragraph/heading overrides (allTextBlocks skips them), so a header
  // typo inside a table — e.g. a stray capital in a fill-in header ("O"->"o", "Oe"->"oe")
  // — needs this. Rewrites every matching cell at any depth. Preserves imgs.
  // A cell with mixed formatting (e.g. a bold title over italic answer lines, all in one
  // cell — some manuscripts wrap a whole callout box in a 1-cell table) carries that
  // styling in `cell.segs`, which rendering prefers over the plain `cell.text`; a `find`
  // that isn't the cell's WHOLE text also gets rewritten there, run-by-run, so the fix
  // actually shows up in the PDF instead of silently no-op'ing on the still-styled cell.
  for (const ec of ov.editCell || []) {
    let n = 0;
    const walkT = (arr) => {
      for (const b of arr) {
        if (!b || typeof b !== "object") continue;
        if (Array.isArray(b.rows) && (b.t === "table" || b.kind === "table")) {
          for (const row of b.rows) if (Array.isArray(row)) for (const cell of row) {
            if (!cell || typeof cell.text !== "string") continue;
            if (cell.text.trim() === ec.find) { cell.text = ec.with; n++; continue; }
            if (cell.text.includes(ec.find)) {
              cell.text = cell.text.split(ec.find).join(ec.with);
              if (Array.isArray(cell.segs)) {
                for (const s of cell.segs) if (typeof s.t === "string" && s.t.includes(ec.find)) s.t = s.t.split(ec.find).join(ec.with);
              }
              n++;
            }
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
        const m = (b.text || "").trim().match(/^TOPIC\s*:?\s*(\d+)\.\d+\b/i);
        if (m) { major = m[1]; break; }
      }
      major = major || "1";
    }
    let n = 0;
    for (const b of blocks) {
      if (b.t !== "h1") continue;
      const t = (b.text || "").trim();
      const m = t.match(/^TOPIC\s*:?\s*([\d.]+)\s*:?\s*(.*)$/i);
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
  const recased = (s, to) => to === "sentence" ? toSentence(s) : to === "upper" ? s.toUpperCase() : toTitle(s);
  // House style capitalises the standing structural labels that open every sub-topic:
  // "General Competences", "Specific Competence", "Key Competences". Manuscripts type
  // them inconsistently ("General competences", "Specific competence") and a reviewer
  // then flags EVERY occurrence by hand — 26 of them in one Form 2 Teacher's Guide, one
  // per sub-topic. They are fixed series-wide labels, not this book's wording, so recase
  // them by default; a book that genuinely wants something else can still override via
  // `recase` below, which runs after this and wins.
  // Capitalise ONLY the word itself, and only on a heading that is not already
  // ALL-CAPS. Title-casing the whole heading was wrong twice over: it rewrote
  // "GENERAL COMPETENCES TO BE DEVELOPED" (a legitimate all-caps house heading, used
  // by the Form 4 Geography TG among others) into title case, which both changed a
  // heading nobody asked to change and broke that book's `pageBreakBefore` anchor,
  // since the override matches the heading text.
  const HOUSE_LABELS = /^(general|specific|key)\s+competences?\b/i;
  const isAllCaps = (s) => s === s.toUpperCase() && /[A-Z]/.test(s);
  for (const b of flat) {
    if (!(b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t)) || typeof b.text !== "string") continue;
    const t = b.text.trim();
    if (!HOUSE_LABELS.test(t) || isAllCaps(t)) continue;
    b.text = t.replace(/\bcompetences?\b/gi, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  for (const rc of ov.recase || []) {
    let n = 0;
    for (const b of flat) {
      if (!(b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t)) || typeof b.text !== "string") continue;
      if (!b.text.trim().toUpperCase().startsWith(rc.startsWith.toUpperCase())) continue;
      b.text = recased(b.text.trim(), rc.to);
      n++;
    }
    // Learning Activity / Exercise / Assessment BOX titles live on `.title`/`.heading`,
    // a field allTextBlocks() never surfaces into `flat` (see its own comment) — a
    // manuscript can leave some boxes ALL-CAPS and others in Title Case in the very
    // same book (e.g. "LEARNING ACTIVITY 1" next to "Learning Activity 2:"), so recase
    // needs to reach these too, not just plain headings.
    for (const b of blocks) {
      const key = b.t === "exercise" ? "heading" : (b.t === "activity" || b.t === "assessment") ? "title" : null;
      if (!key || typeof b[key] !== "string") continue;
      if (!b[key].trim().toUpperCase().startsWith(rc.startsWith.toUpperCase())) continue;
      b[key] = recased(b[key].trim(), rc.to);
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
  // editAnswer: [{ find, with }] — like editAll, but rewrites every qa part's ANSWER
  // text (`.a`/`.aseg`) rather than its question — see editBlockAnswerText().
  for (const e of ov.editAnswer || []) {
    let n = 0;
    for (const b of flat) if (editBlockAnswerText(b, e.find, e.with || "")) n++;
    if (!n) console.warn("!  editAnswer not matched:", e.find);
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
    // list/para runs go through mkSegs so **bold**/*italic*/$math$ markdown works inside
    // an inserted block the same way it already does for replaceBlocks's para/listitem —
    // `it.bold`/`it.italic` (the whole-block flags this took before markdown support was
    // added) still force every seg, so existing plain-string callers render unchanged.
    const segsFor = (tx) => mkSegs(tx).map((s) => ({ ...s, ...(it.bold ? { b: true } : {}), ...(it.italic ? { it: true } : {}) }));
    const mkBlks = () => texts.map((tx, idx) => it.as === "section"
      ? { t: "head", text: tx, styleSection: true, noPromote: true }
      : it.as === "head"
      ? { t: "head", text: tx, black: true, noPromote: true }
      : it.as === "list"
      ? { t: "listitem", isList: true, marker: it.startNum != null ? `${it.startNum + idx}.` : "•", segs: segsFor(tx) }
      : { t: "para", segs: segsFor(tx), ...(it.align ? { align: it.align } : {}) });
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
        // An exercise/assessment QUESTION part (kind "q"/"lead") carries its text in
        // `.qseg`, not `.segs` — the manuscript typed a whole new section divider
        // ("Section B: Application and Analysis") as the tail of the previous item's
        // own paragraph, with no paragraph break, so it imported glued onto that
        // item's question text instead of starting its own line. Split it the same
        // way, inserting the tail as a fresh unnumbered "lead" part right after.
        if ((b.kind === "q" || b.kind === "lead") && Array.isArray(b.qseg)) {
          const k = b.qseg.findIndex((s) => typeof s.t === "string" && s.t.trimStart().startsWith(sp.find));
          if (k > 0) {
            const tail = b.qseg.splice(k);
            b.q = b.qseg.map((s) => s.t || "").join("");
            arr.splice(i + 1, 0, { kind: "lead", q: tail.map((s) => s.t || "").join(""), qseg: tail, indent: false });
            done = true; return;
          }
        }
        for (const key of Object.keys(b)) {
          if (Array.isArray(b[key]) && b[key].some((x) => x && typeof x === "object" && (x.segs || x.body || x.parts || x.qseg))) { walk(b[key]); if (done) return; }
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
    // addParts: [{ text, marker?, depth?, at? }] — insert answer lines the manuscript
    // never carried. A proofreader who finds a question whose answer key is simply
    // missing writes the answer out in their note; until now there was no way to get it
    // into the box, because every other primitive can only rewrite parts that already
    // exist. Appended at the end of the box by default, or spliced in at index `at`.
    // Runs AFTER `markers`, whose indices refer to the original part list. `text` takes
    // the usual **bold**/*italic*/$math$ markup, and a trailing mark ("[2]") is
    // right-aligned by the normal mark handling, so write it with ordinary spaces.
    for (const ap of fx.addParts || []) {
      const part = {
        kind: "q", marker: ap.marker || "", depth: ap.depth != null ? ap.depth : 0,
        q: String(ap.text || ""), qseg: mkSegs(String(ap.text || "")),
        a: "", aseg: [],
      };
      if (ap.at != null && ap.at >= 0 && ap.at <= parts.length) parts.splice(ap.at, 0, part);
      else parts.push(part);
    }
  }
  // imageToText: { "image20.png": "15° × 111 km = 1665 km" } — replace a single
  // embedded picture with plain typeset text, matched by the ORIGINAL media filename
  // (as it was in the .docx, e.g. "image20.png" — not the "imp_"-prefixed name blocks
  // carry internally after import). For manuscripts that pasted a screenshot of an
  // equation editor instead of typing the equation: the screenshot bakes in ClearType
  // subpixel fringing that reads fine on screen but shows a visible red/cyan halo once
  // enlarged for print, and the source pixels are usually far too small (a single
  // text-line's worth) to enlarge without visible blur. Handles both a standalone
  // image block and one image "part" inside an exercise's answer.
  for (const [mediaName, text] of Object.entries(ov.imageToText || {})) {
    const want = "imp_" + mediaName;
    let done = false;
    const walk = (arr) => {
      for (let i = 0; i < arr.length && !done; i++) {
        const b = arr[i];
        if (!b || typeof b !== "object") continue;
        if (b.t === "image" && b.file === want) {
          arr[i] = { t: "para", segs: mkSegs(text) };
          done = true; return;
        }
        if (b.kind === "image" && b.images && b.images[0] && b.images[0].file === want) {
          arr[i] = { kind: "lead", q: text, qseg: mkSegs(text), indent: true };
          done = true; return;
        }
        if (b.t === "img" && b.images && b.images[0] && b.images[0].file === want) {
          arr[i] = { t: "para", segs: mkSegs(text) };
          done = true; return;
        }
        for (const key of Object.keys(b)) if (Array.isArray(b[key]) && !done) walk(b[key]);
      }
    };
    walk(blocks);
    if (!done) console.warn("!  imageToText not matched:", mediaName);
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

module.exports = { applyOverrides, replaceTableRows };
