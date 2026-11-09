#!/usr/bin/env node
// reader:typeset — typeset a supplementary reader or novel from its book folder
// (made by reader:import): the Word manuscript + <name>.reader.json -> one PDF whose
// page 1 is the cover sheet (back | spine | front; a spine only above 112 pages).
//
// Usage:
//   npm run reader:typeset -- "<book folder>"            (or the .docx / .reader.json inside it)
//   options: --design <name> --palette <name>   try another cover without editing the settings
//            --out <folder>                      where the PDF goes (default: output/Supplementary Readers/<Language>/<name>/)
//            --covers                            also write the cover sheet on its own
const fs = require("fs");
const path = require("path");
const { NodeCompiler } = require("@myriaddreamin/typst-ts-node-compiler");
const { PDFDocument } = require("pdf-lib");
const { readDocx } = require("./read-docx.js");
const { PALETTES, ACCENTS, LANGS } = require("./settings.js");

const ROOT = path.join(__dirname, "..", "..");
const S = (s) => '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ") + '"';
const arr = (a) => "(" + a.map(S).join(", ") + (a.length === 1 ? ",)" : ")");

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; o[k] = v; }
    else o._.push(a);
  }
  return o;
}

function findBook(p) {
  const st = fs.statSync(p);
  const dir = st.isDirectory() ? p : path.dirname(p);
  const files = fs.readdirSync(dir);
  const json = files.find((f) => f.endsWith(".reader.json"));
  if (!json) throw new Error(`no .reader.json settings file in ${dir} (run reader:import first)`);
  const base = json.replace(/\.reader\.json$/, "");
  const docx = files.find((f) => f === base + ".docx") || files.find((f) => f.endsWith(".docx") && !f.startsWith("~$"));
  if (!docx) throw new Error(`no Word manuscript in ${dir}`);
  return { dir, settingsFile: path.join(dir, json), docx: path.join(dir, docx) };
}

// inline runs -> Typst markup made only of string literals (nothing in the text can be read as code)
function runsT(runs) {
  return runs.filter((r) => r.t).map((r) => {
    const s = S(r.t.replace(/\u0001/g, ""));
    if (r.b && r.i) return `#strong(emph(${s}))`;
    if (r.b) return `#strong(${s})`;
    if (r.i) return `#emph(${s})`;
    return `#${s}`;
  }).join("");
}

// first paragraph after a chapter heading: split off the first letter (with any opening
// quote) and the rest of the first word, for the raised initial
function openingT(runs) {
  const first = runs[0]; if (!first || first.b || first.i) return null;
  const m = first.t.match(/^(["'“‘(]*\p{L})(\p{L}*)([\s\S]*)$/u);
  if (!m) return null;
  const rest = [{ ...first, t: m[3] }, ...runs.slice(1)];
  return `#opening(${S(m[1])}, ${S(m[2])}, [${runsT(rest)}])`;
}

function linesT(lines) { return "(" + lines.map((l) => `[${runsT(l.runs)}]`).join(", ") + (lines.length === 1 ? ",)" : ")"); }

function emitBlocks(blocks, ctx) {
  let out = "";
  let afterChapter = false;
  for (const b of blocks) {
    switch (b.t) {
      case "h1": out += `\n#chapter(${S(b.label || "")}, ${S(b.title || "")})\n`; afterChapter = true; continue;
      case "h2": out += `\n#sect(${S(b.text)})\n`; afterChapter = false; continue;
      case "p": {
        const op = afterChapter && ctx.family !== "poetry" ? openingT(b.runs) : null;
        if (b.quote) out += `\n#quoteblock[${runsT(b.runs)}]\n`;
        else out += `\n${op || runsT(b.runs)}\n`;
        afterChapter = false; continue;
      }
      case "verse": out += `\n#verse(${linesT(b.lines)})\n`; break;
      case "center": out += `\n#centred(${linesT(b.lines)})\n`; break;
      case "right": out += `\n#rightlines(${linesT(b.lines)})\n`; break;
      case "break": out += `\n#scenebreak()\n`; break;
      case "fig": {
        const file = ctx.media(b.file);
        if (!file) { out += `\n#centred(([#"[picture missing: ${b.file}]"],))\n`; break; }
        const pct = Math.max(25, Math.min(100, Math.round((b.wpt || 300) / ctx.docTextPt * 100)));
        out += `\n#pic(${S(file)}, ${pct}%, ${S(b.caption || "")})\n`;
        break;
      }
      default: break;
    }
    if (b.t !== "fig") afterChapter = false;
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a._[0]) { console.log('usage: npm run reader:typeset -- "<book folder>" [--design X] [--palette Y] [--out DIR]'); process.exit(1); }
  const { dir, settingsFile, docx } = findBook(a._[0]);
  const st = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const build = path.join(dir, "_build");
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(path.join(build, "media"), { recursive: true });
  const model = await readDocx(docx, { mediaDir: path.join(build, "media") });
  const meta = model.meta;
  const title = st.title || meta.title || path.basename(docx, ".docx");
  const author = st.author != null && st.author !== "" ? st.author : meta.author || "";
  const family = st.family || "novel";
  const [tw, th] = st.trim || [148, 210];
  const pal = PALETTES[a.palette || st.cover.palette] || PALETTES.terracotta;
  const accent = ACCENTS[a.palette || st.cover.palette] || pal[0];
  const lang = (LANGS[st.language] || LANGS.English).lang;
  // logo + cover pictures into the build folder (Typst reads only inside it)
  const logoSrc = path.join(ROOT, "zeph-logo", "image.png");
  const hasLogo = fs.existsSync(logoSrc);
  if (hasLogo) fs.copyFileSync(logoSrc, path.join(build, "zeph-logo.png"));
  const copyIn = (rel) => {
    if (!rel) return null;
    const src = path.isAbsolute(rel) ? rel : path.join(dir, rel);
    if (!fs.existsSync(src)) { console.log(`  ! cover picture not found: ${rel}`); return null; }
    const name = "cv-" + path.basename(src).replace(/[^\w.-]+/g, "_");
    fs.copyFileSync(src, path.join(build, name));
    return name;
  };
  const media = (rel) => {
    const name = rel.replace(/^media\//, "");
    if (fs.existsSync(path.join(build, "media", name))) return "media/" + name;
    const alt = path.join(dir, rel);
    if (fs.existsSync(alt)) { fs.copyFileSync(alt, path.join(build, "media", path.basename(alt))); return "media/" + path.basename(alt); }
    return null;
  };
  // Word page text width: trim minus the 0.625 inch margins to-docx.js sets
  const docTextPt = tw / 25.4 * 72 - 90;
  const chapters = model.body.filter((b) => b.t === "h1");
  const titled = chapters.filter((b) => b.title || b.label).length;
  const wantContents = st.contents === true || (st.contents === "auto" && titled >= 3 && chapters.some((b) => b.title));
  const numW = chapters.some((b) => b.label && b.title) ? Math.min(30, 3 + Math.max(...chapters.filter((b) => b.label && b.title).map((b) => b.label.length)) * 2.1) : 0;

  const R = `#let R = (
  w: ${tw}mm, h: ${th}mm, family: ${S(family)}, lang: ${S(lang)}, body-size: ${st.bodySize || 10.5}pt,
  accent: rgb(${S(accent)}), title: ${S(title)}, subtitle: ${S(st.subtitle || meta.subtitle || "")}, author: ${S(author)},
  series: ${arr(st.series || meta.series || [])}, running-title: ${S(st.runningTitle || title)},
  contents-title: ${S(st.contentsTitle || "Contents")}, contents-num-width: ${numW}mm,
  chapter-newpage: ${st.chapterNewPage === false ? "false" : "true"}, logo: ${hasLogo ? S("zeph-logo.png") : "none"},
)\n`;
  let body = "";
  body += "#halftitle()\n#titlepage()\n";
  const imprint = model.front.filter((f) => f.type === "imprint").flatMap((f) => f.lines);
  if (imprint.length) body += `#imprint(${arr(imprint)})\n`;
  for (const f of model.front.filter((f) => f.type === "section")) {
    const blocks = f.blocks || [];
    const head = blocks[0] && blocks[0].t === "h1" ? [blocks[0].label, blocks[0].title].filter(Boolean).join(" ") : "";
    const rest = head ? blocks.slice(1) : blocks;
    body += `#frontsec(${S(head)}, [${emitBlocks(rest, { family, media, docTextPt })}])\n`;
  }
  if (wantContents) body += "#contents()\n";
  body += "#mainstart()\n";
  body += emitBlocks(model.body, { family, media, docTextPt });

  const tmpl = fs.readFileSync(path.join(__dirname, "reader-template.typ"), "utf8");
  const doc = R + tmpl + "\n" + body;
  fs.writeFileSync(path.join(build, "book.typ"), doc);
  const fontPaths = ["C:/Windows/Fonts", path.join(process.env.LOCALAPPDATA || "", "Microsoft/Windows/Fonts"), "/Library/Fonts", "/System/Library/Fonts", "/usr/share/fonts"].filter((p) => { try { return p && fs.existsSync(p); } catch (_) { return false; } });
  const compiler = NodeCompiler.create({ workspace: build, fontArgs: [{ fontPaths }] });
  const compile = (src, what) => {
    try { return compiler.pdf({ mainFileContent: src }); }
    catch (e) {
      try { const r = compiler.compile({ mainFileContent: src }); const d = compiler.fetchDiagnostics(r.takeDiagnostics()); console.error(`TYPST (${what}):`, (d || []).map((x) => x.message + (x.range ? ` @${x.range}` : "")).join(" | ")); } catch (_) {}
      throw new Error(`Typst could not build the ${what}; see ${path.join(build, what === "book" ? "book.typ" : "cover.typ")}`);
    }
  };
  const inner = compile(doc, "book");
  const book = await PDFDocument.load(inner);
  const pages = book.getPageCount();
  // cover sheet
  const spineMm = pages > 112 ? Math.round((pages * 0.055 + 1) * 10) / 10 : 0;
  const design = a.design || st.cover.design || "sunrise";
  const C = `#let C = (
  w: ${tw}mm, h: ${th}mm, bleed: 2mm, spine: ${spineMm}mm, design: ${S(design)},
  primary: rgb(${S(pal[0])}), secondary: rgb(${S(pal[1])}), accent: rgb(${S(pal[2])}), paper: rgb(${S(pal[3])}),
  spine-colour: rgb(${S(st.cover.spineColour || pal[0])}),
  title: ${S(st.cover.title || title)}, subtitle: ${S(st.cover.subtitle != null ? st.cover.subtitle : (st.subtitle || ""))}, author: ${S(author)},
  label: ${S(st.cover.label || "")}, isbn: ${S(st.isbn || "")}, blurb: ${S(st.cover.blurb || "")},
  logo: ${hasLogo ? S("zeph-logo.png") : "none"},
  art: ${(() => { const n = copyIn(st.cover.art); return n ? S(n) : "none"; })()},
  front-image: ${(() => { const n = copyIn(st.cover.front); return n ? S(n) : "none"; })()},
  back-image: ${(() => { const n = copyIn(st.cover.back); return n ? S(n) : "none"; })()},
)\n`;
  const ctmpl = fs.readFileSync(path.join(__dirname, "covers.typ"), "utf8");
  fs.writeFileSync(path.join(build, "cover.typ"), C + ctmpl);
  const coverPdf = await PDFDocument.load(compile(C + ctmpl, "cover"));
  const [sheet] = await book.copyPages(coverPdf, [0]);
  book.insertPage(0, sheet);
  book.setTitle(title); if (author) book.setAuthor(author); book.setProducer("ZEPH reader typesetter");
  // output
  const name = st.outName || path.basename(dir);
  const outDir = a.out ? path.resolve(a.out) : path.join(ROOT, "output", "Supplementary Readers", st.language || "English", name);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${name} - ${st.outStatus || "Typeset ready for proofreading"}.pdf`);
  fs.writeFileSync(outFile, await book.save());
  if (a.covers) {
    const solo = await PDFDocument.create(); const [p] = await solo.copyPages(coverPdf, [0]); solo.addPage(p);
    fs.writeFileSync(path.join(outDir, `${name} - cover sheet.pdf`), await solo.save());
  }
  console.log(`${name}: ${pages} pages + cover sheet${spineMm ? ` (spine ${spineMm} mm)` : " (no spine, 112 pages or fewer)"}, cover design "${design}"`);
  console.log(`  -> ${outFile}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
