// emit-ebook.js — export a typeset book into a reflowable eBook bundle (.zephbook)
// for ZEPH Learn: real selectable/highlightable text, images, and PRINT-QUALITY
// math rendered through the SAME Typst engine that builds the PDF (pixel parity).
//
// It reuses importDocx() — the exact semantic model the print typesetter consumes —
// so the eBook stays in sync with the printed book by construction (no re-parse,
// no PDF extraction). This is the "typeset -> eBook" sibling of typeset-docx.js.
//
// Usage:
//   node --experimental-sqlite src/typeset/emit-ebook.js --book <book-id>
//   node src/typeset/emit-ebook.js "path/to/manuscript.docx" \
//        --kind LB --title "..." --grade "Form 1" --subject Chemistry [--price 50]
//
// Output (both, for convenience):
//   dist-ebooks/<book-id>/           browsable bundle  (book.json + media/ + math/)
//   dist-ebooks/<book-id>.zephbook   the single upload file (a zip of the above)
//
// Design contract lives in docs/EBOOK-FORMAT.md (schemaVersion 1).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const { NodeCompiler } = require("@myriaddreamin/typst-ts-node-compiler");
const { importDocx } = require("./import-docx.js");
const { emfToPng, cropImage } = require("./image-enhance.js");
const { THEMES, autoTheme } = require("./themes.js");

const ROOT = path.join(__dirname, "..", "..");
const OUT_ROOT = path.join(ROOT, "dist-ebooks");
const SCHEMA_VERSION = 1;
const WIN_FONTS = process.env.WINDIR
  ? path.join(process.env.WINDIR, "Fonts")
  : "C:/Windows/Fonts";

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      a[k] = v;
    } else a._.push(t);
  }
  return a;
}

// Resolve {docxPath, meta} from either --book <id> (zeph.db) or a direct path.
function resolveTarget(args) {
  if (args.book) {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path.join(ROOT, "zeph.db"));
    const book = db
      .prepare("SELECT id,title,grade,subject,kind,author FROM book WHERE id=?")
      .get(args.book);
    if (!book) throw new Error(`No book with id "${args.book}" in zeph.db`);
    const v = db
      .prepare(
        "SELECT stored_path FROM version WHERE book_id=? AND kind='manuscript' ORDER BY id DESC LIMIT 1",
      )
      .get(args.book);
    if (!v) throw new Error(`No manuscript registered for "${args.book}"`);
    return {
      docxPath: v.stored_path,
      meta: {
        id: book.id,
        title: book.title,
        grade: book.grade,
        subject: book.subject,
        kind: book.kind || "LB",
        author: book.author || "ZEPH",
      },
    };
  }
  const docxPath = args._[0];
  if (!docxPath) throw new Error("Provide --book <id> or a .docx path");
  const base = path.basename(docxPath).replace(/\.docx$/i, "");
  return {
    docxPath,
    meta: {
      id: (args.id || base).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      title: args.title || base,
      grade: args.grade || null,
      subject: args.subject || null,
      kind: args.kind || "LB",
      author: args.author || "ZEPH",
    },
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const slug = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Education-level eyebrow from the grade (mirrors the typeset cover synthesis).
function levelFor(grade) {
  const g = String(grade || "");
  if (/form\s*[56]/i.test(g)) return "Secondary Education Advanced Level";
  if (/form/i.test(g)) return "Secondary Education Ordinary Level";
  if (/grade/i.test(g)) return "Primary Education Level";
  return "Zambia Educational Publishing House";
}

// The book's visual identity (same palette the print PDF uses) so the eBook
// headers / boxes / tables match the typeset book instead of app defaults.
function resolveTheme(meta, override) {
  const key = override || autoTheme(meta.title || "");
  const T = THEMES[key] || THEMES.navy;
  const pick = (b) => ({ fill: b.fill, border: b.border, title: b.title });
  return {
    key,
    primary: T.primary,
    primary2: T.primary2,
    accent: T.accent,
    ink: T.ink,
    rulec: T.rulec,
    zebra: T.zebra,
    signature: T.signature || T.primary,
    motif: T.motif || "atom",
    boxStyle: T.boxStyle || "",
    bodyFont: T.bodyFont || T.font || "Arial",
    displayFont: T.displayFont || T.font || "Arial",
    headerFont: T.font || "Times New Roman",
    act: pick(T.act),
    ex: pick(T.ex),
    kp: pick(T.kp),
    fact: pick(T.fact),
    asmt: pick(T.asmt),
  };
}

// The book's cover photo (from its .overrides.json sidecar, as the print cover
// uses) and the ZEPH logo, so the eBook cover matches the printed cover.
function coverAssets(docxPath) {
  const out = { heroSrc: null, logoSrc: null };
  const logo = path.join(ROOT, "zeph-logo", "image.png");
  if (fs.existsSync(logo)) out.logoSrc = logo;
  const ovPath = docxPath.replace(/\.docx$/i, ".overrides.json");
  if (fs.existsSync(ovPath)) {
    try {
      const ov = JSON.parse(fs.readFileSync(ovPath, "utf8"));
      if (ov.coverImage) {
        const p = path.isAbsolute(ov.coverImage)
          ? ov.coverImage
          : path.resolve(path.dirname(docxPath), ov.coverImage);
        if (fs.existsSync(p)) out.heroSrc = p;
      }
    } catch { /* ignore malformed sidecar */ }
  }
  return out;
}

// Flatten rich segments to plain text (for search / alt text).
function plainOf(segs) {
  return (segs || []).map((s) => (s && !s.m ? s.t : "")).join("");
}

// ---------------------------------------------------------------------------
// math: compile each Typst equation to an SVG once, keyed by source hash.
// Same engine as the PDF -> identical rendering.
// ---------------------------------------------------------------------------
function makeMathRenderer() {
  const compiler = NodeCompiler.create({
    workspace: ROOT,
    fontArgs: [{ fontPaths: [WIN_FONTS] }],
  });
  const cache = new Map(); // srcKey -> { file, w, h }
  const files = new Map(); // file -> svg string

  return {
    files,
    render(src, display) {
      const key = (display ? "D:" : "I:") + src;
      if (cache.has(key)) return cache.get(key);
      // Always render in display style so multi-level glyphs (fractions,
      // isotopes) get their FULL bounds — inline `$x$` clips ascenders in an
      // auto-height page. The stored `display` flag still drives placement
      // (inline vs centred block) in the reader.
      const doc =
        `#set page(width: auto, height: auto, margin: 1pt)\n` +
        `#set text(size: 11pt)\n` +
        `$ ${src} $\n`;
      let entry;
      try {
        const svg = compiler.svg({ mainFileContent: doc });
        // Typst emits dimensionless width/height in pt (e.g. width="20.000").
        const w = parseFloat((svg.match(/\bwidth="([\d.]+)(?:pt)?"/) || [])[1] || "0");
        const h = parseFloat((svg.match(/\bheight="([\d.]+)(?:pt)?"/) || [])[1] || "0");
        const file = "eq_" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 12) + ".svg";
        files.set(file, svg);
        entry = { file, w, h };
      } catch (e) {
        entry = { file: null, w: 0, h: 0, error: e.message };
      }
      cache.set(key, entry);
      return entry;
    },
  };
}

// Map one rich-text segment. Math segments become an SVG reference; the raw
// Typst source is kept as `alt` for search/accessibility.
function mapSeg(s, math) {
  if (!s) return null;
  if (s.m) {
    const r = math.render(s.t, !!s.display);
    return { m: true, svg: r.file, w: r.w, h: r.h, display: !!s.display, alt: s.t };
  }
  const out = { t: s.t };
  if (s.b) out.b = true;
  if (s.it) out.it = true;
  if (s.c) out.c = s.c;
  if (s.u) out.u = true;
  return out;
}
const mapSegs = (segs, math) => (segs || []).map((s) => mapSeg(s, math)).filter(Boolean);

// ---------------------------------------------------------------------------
// block transform: importDocx model -> eBook schema v1
// `isLB` strips answers from questions (Learner's Book shows no answers).
// Front/back matter (cover / backcover) is kept; page-flow blocks are dropped
// because the eBook reflows.
// ---------------------------------------------------------------------------
const DROP = new Set([
  "toc", "pagebreak", "vspace", "titlestart", "showpage", "bodystart",
  "sigspace", "titlepage", "loentry",
]);

function mapCell(c, math) {
  const cell = { text: c.text || "" };
  if (c.segs && c.segs.length) cell.segs = mapSegs(c.segs, math);
  if (c.imgs && c.imgs.length) cell.imgs = c.imgs.map((im) => ({ file: im.file, w: im.w }));
  if (c.subs && c.subs.length) cell.subs = c.subs.map((rows) => rows.map((r) => r.map((cc) => mapCell(cc, math))));
  return cell;
}
const mapRows = (rows, math) => (rows || []).map((r) => r.map((c) => mapCell(c, math)));

// Questions inside exercise / assessment. LB drops answers and answer dividers.
function mapParts(parts, math, isLB) {
  const out = [];
  for (const p of parts || []) {
    if (!p) continue;
    if (p.kind === "lead") {
      if (isLB && p.divider) continue; // the "Answers:" divider — hide in LB
      out.push({ kind: "lead", q: p.q || "", qseg: mapSegs(p.qseg, math), indent: !!p.indent });
    } else if (p.kind === "table") {
      out.push({ kind: "table", rows: mapRows(p.rows, math), marker: p.marker || "" });
    } else if (p.kind === "image") {
      out.push({ kind: "image", images: (p.images || []).map((im) => ({ file: im.file, w: im.w, tall: !!im.tall, caption: im.caption || "" })), marker: p.marker || "" });
    } else if (p.kind === "colsum") {
      out.push({ kind: "colsum", rows: p.rows || [], answer: isLB ? [] : p.answerRows || p.answer || [], marker: p.marker || "" });
    } else if (p.kind === "colgrid") {
      out.push({ kind: "colgrid", rows: p.rows || [], ncol: p.ncol, hasMarker: !!p.hasMarker, header: p.header || null });
    } else {
      // kind "q" (or anything question-like)
      const q = { kind: "q", q: p.q || "", qseg: mapSegs(p.qseg, math), marker: p.marker || "", depth: p.depth || 0 };
      if (!isLB) {
        q.a = p.a || "";
        q.aseg = mapSegs(p.aseg, math);
      }
      out.push(q);
    }
  }
  return out;
}

const mapBody = (body, math, isLB) => (body || []).map((b) => mapBlock(b, math, isLB)).filter(Boolean);

function mapBlock(b, math, isLB) {
  if (!b || typeof b !== "object") return null;
  const t = b.t;
  if (DROP.has(t)) return null;
  switch (t) {
    case "cover": {
      // The print cover is a synthesised graphic (not in the import model); the
      // eBook builds its own themed cover from metadata. Only keep an in-model
      // cover if it actually carries content.
      const has = (b.lines || []).length || (b.byline || []).length || b.hero || b.logo;
      if (!has) return null;
      return { type: "cover", lines: b.lines || [], byline: b.byline || [], hero: b.hero ? { file: b.hero.file } : null, logo: b.logo ? { file: b.logo.file } : null };
    }
    case "backcover":
      return { type: "backcover", lines: b.lines || [], logo: b.logo ? { file: b.logo.file } : null, isbn: b.isbn || null };
    case "signature":
      return { type: "signature", lines: b.lines || [] };
    case "h1":
      return { type: "topic", text: b.text || "" };
    case "h2":
      return { type: "subtopic", text: b.text || "" };
    case "h3":
    case "head":
      return { type: "h3", text: b.text || "" };
    case "label":
      return { type: "label", text: b.text || "", color: b.labelColor || null };
    case "para":
      return { type: "para", segs: mapSegs(b.segs, math), align: b.align || null };
    case "listitem":
      return { type: "listitem", segs: mapSegs(b.segs, math), marker: b.marker || "•" };
    case "figcaption":
      return { type: "caption", text: b.text || "" };
    case "image":
      return { type: "figure", file: b.file, w: b.w, h: b.h, tall: !!b.tall, caption: b.caption || "" };
    case "imagerow":
      return { type: "imagerow", images: (b.images || []).map((im) => ({ file: im.file, w: im.w, tall: !!im.tall, caption: im.caption || "" })) };
    case "activity":
      return { type: "activity", title: b.title || "", body: mapBody(b.body, math, isLB) };
    case "fact":
      return { type: "fact", body: mapBody(b.body, math, isLB) };
    case "keypoints":
      return { type: "keypoints", title: b.title || null, points: b.points || [] };
    case "exercise":
      return { type: "exercise", heading: b.heading || "", items: mapParts(b.parts, math, isLB) };
    case "assessment":
      return { type: "assessment", title: b.title || "", intro: b.intro || [], items: mapParts(b.parts, math, isLB), extra: b.extra || [] };
    case "box":
      return { type: "box", body: mapBody(b.body, math, isLB) };
    case "framedsection":
      return { type: "framedsection", kind: b.kind || "", title: b.title || "", body: mapBody(b.body, math, isLB) };
    case "lessonmeta":
      return { type: "lessonmeta", title: b.title || "", body: mapBody(b.body, math, isLB) };
    case "table":
      return { type: "table", rows: mapRows(b.rows, math), noHeader: !!b.noHeader };
    case "colgrid":
      return { type: "colgrid", rows: b.rows || [], ncol: b.ncol, hasMarker: !!b.hasMarker, header: b.header || null };
    case "colsum":
      return { type: "colsum", rows: b.rows || [], answer: isLB ? [] : b.answerRows || [] };
    case "numbond":
      return { type: "numbond", whole: b.whole, a: b.a, b: b.b };
    default:
      // Unknown but text-bearing -> keep as a paragraph so no content is lost.
      if (b.segs) return { type: "para", segs: mapSegs(b.segs, math), align: b.align || null };
      if (b.text) return { type: "para", segs: [{ t: b.text }] };
      return null; // silently drop pure layout blocks
  }
}

// Split the flat block list into sections at each topic (h1). Anything before
// the first topic (cover, intro) becomes a "front" section. Builds a TOC from
// topics (h1) and their sub-topics (h2).
function sectionize(blocks) {
  const sections = [];
  const toc = [];
  let cur = null;
  let topicN = 0;
  const startSection = (title, kind) => {
    const id = kind === "front" ? "front" : `s${topicN}-${slug(title) || "section"}`;
    cur = { id, title: title || "Front matter", blocks: [] };
    sections.push(cur);
    return cur;
  };
  for (const b of blocks) {
    if (b.type === "topic") {
      topicN += 1;
      startSection(b.text, "topic");
      toc.push({ title: b.text, section: cur.id, children: [] });
    } else if (!cur) {
      startSection(null, "front");
    }
    if (b.type === "subtopic" && toc.length) {
      const anchor = `${cur.id}-sub${cur.blocks.filter((x) => x.type === "subtopic").length}`;
      b.anchor = anchor;
      toc[toc.length - 1].children.push({ title: b.text, section: cur.id, anchor });
    }
    cur.blocks.push(b);
  }
  return { sections, toc };
}

// ---------------------------------------------------------------------------
// media: copy referenced files into the bundle (crop / EMF-decode as needed).
// ---------------------------------------------------------------------------
function stageMedia(media, mediaDir, warn) {
  fs.mkdirSync(mediaDir, { recursive: true });
  let n = 0;
  for (const m of media || []) {
    const dest = path.join(mediaDir, m.name);
    try {
      if (m.emf) {
        const png = emfToPng(fs.readFileSync(m.src));
        if (png) fs.writeFileSync(dest, png);
        else { warn(`EMF decode failed: ${m.name}`); continue; }
      } else if (m.crop) {
        cropImage(m.src, dest, m.crop, fs);
      } else {
        fs.copyFileSync(m.src, dest);
      }
      n++;
    } catch (e) {
      warn(`media copy failed ${m.name}: ${e.message}`);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { docxPath, meta } = resolveTarget(args);
  const isLB = String(meta.kind).toUpperCase() === "LB";
  const warnings = [];
  const warn = (m) => warnings.push(m);

  console.log(`\n[emit-ebook] ${meta.title}  (${meta.kind})`);
  console.log(`  manuscript: ${docxPath}`);
  if (!fs.existsSync(docxPath)) throw new Error("manuscript file not found on disk");

  // Same import options the science books are typeset with.
  const importOpts = { styled: true, flat: false, textCover: true, imgOverrides: {}, removeImages: [] };
  const { blocks: raw, media, tmp } = await importDocx(docxPath, importOpts);
  if (!raw.length) throw new Error("importDocx returned no blocks");
  console.log(`  imported ${raw.length} raw blocks, ${(media || []).length} media`);

  // Transform.
  const math = makeMathRenderer();
  const eblocks = raw.map((b) => mapBlock(b, math, isLB)).filter(Boolean);
  const { sections, toc } = sectionize(eblocks);
  console.log(`  -> ${eblocks.length} eBook blocks, ${sections.length} sections, ${math.files.size} equations, answers ${isLB ? "STRIPPED (LB)" : "kept"}`);

  const theme = resolveTheme(meta, args.theme);
  const assets = coverAssets(docxPath);
  const cover = {
    eyebrow: levelFor(meta.grade),
    title: meta.subject || (THEMES[theme.key] && THEMES[theme.key].subject) || meta.title,
    subtitleTop: meta.grade || "",
    subtitle: meta.kind === "TG" ? "Teacher's Guide" : "Learner's Book",
    author: meta.author,
    publisher: "Zambia Educational Publishing House",
    year: new Date().getFullYear(),
    motif: theme.motif,
    heroFile: null, // set below if a cover photo exists
    logoFile: null,
  };

  // Stage the bundle on disk.
  const bundleDir = path.join(OUT_ROOT, meta.id);
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  const mediaDir = path.join(bundleDir, "media");
  const copied = stageMedia(media, mediaDir, warn);
  // Cover photo + logo (copied from the print pipeline's own assets).
  if (assets.heroSrc) {
    const ext = path.extname(assets.heroSrc) || ".png";
    fs.copyFileSync(assets.heroSrc, path.join(mediaDir, "_cover" + ext));
    cover.heroFile = "_cover" + ext;
  }
  if (assets.logoSrc) {
    fs.copyFileSync(assets.logoSrc, path.join(mediaDir, "_logo.png"));
    cover.logoFile = "_logo.png";
  }
  // math svgs
  const mathDir = path.join(bundleDir, "math");
  if (math.files.size) fs.mkdirSync(mathDir, { recursive: true });
  for (const [file, svg] of math.files) fs.writeFileSync(path.join(mathDir, file), svg);

  const book = {
    schemaVersion: SCHEMA_VERSION,
    id: meta.id,
    title: meta.title,
    subject: meta.subject,
    level: meta.grade,
    bookType: meta.kind,
    author: meta.author,
    theme,
    cover,
    toc,
    sections,
  };
  // Manifest carries exactly what the app's learn_books row needs.
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    id: meta.id,
    title: meta.title,
    subject_name: meta.subject || "",
    form_level: meta.grade || "",
    book_type: meta.kind,
    price_zmw: args.price ? Number(args.price) : 50,
    reader_format: "reflow",
    counts: { blocks: eblocks.length, sections: sections.length, media: copied, equations: math.files.size },
  };
  fs.writeFileSync(path.join(bundleDir, "book.json"), JSON.stringify(book));
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Zip -> <id>.zephbook
  const zip = new JSZip();
  const addDir = (absDir, zipPrefix) => {
    for (const name of fs.readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      if (fs.statSync(abs).isDirectory()) addDir(abs, zipPrefix + name + "/");
      else zip.file(zipPrefix + name, fs.readFileSync(abs));
    }
  };
  addDir(bundleDir, "");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipPath = path.join(OUT_ROOT, meta.id + ".zephbook");
  fs.writeFileSync(zipPath, zipBuf);

  console.log(`\n  bundle : ${bundleDir}`);
  console.log(`  upload : ${zipPath}  (${(zipBuf.length / 1024).toFixed(0)} KB)`);
  if (warnings.length) {
    console.log(`\n  ${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 20)) console.log("   - " + w);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

main().catch((e) => {
  console.error("\n[emit-ebook] FAILED:", e.message);
  console.error(e.stack);
  process.exit(1);
});
