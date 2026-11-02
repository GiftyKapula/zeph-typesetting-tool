import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas } from "../../tools/poster/lib/cover.mjs";
import { buildPoster } from "../../tools/poster/lib/layout.mjs";
import { compilePdf, inspectPdf } from "../../tools/poster/lib/render.mjs";
import { checkPoster } from "../../tools/poster/lib/check.mjs";
import { pickTheme } from "../../tools/poster/lib/colour.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/poster/poster-config.json"), "utf8"));
const LOGO = fs.readFileSync(path.join(ROOT, "zeph-logo/image.png"));
const MM = 72 / 25.4;

// a plain stand-in cover (no real book needed)
function fakeCover(w = 1400, h = 2000, colour = "#1b5773") {
  const c = createCanvas(w, h); const x = c.getContext("2d");
  x.fillStyle = colour; x.fillRect(0, 0, w, h); x.fillStyle = "#ffffff"; x.fillRect(w * 0.1, h * 0.4, w * 0.8, h * 0.3);
  return { png: c.toBuffer("image/png"), width: w, height: h, aspect: h / w };
}
const FIELDS = { subject: "ICIBEMBA", level: "Geledi 4", booktype: "Icitabo Cakwa Kafundisha", authorsLabel: "Bakalemba",
  authors: ["E. Bwalya", "V. N. Mwandama", "S. Mwila", "M. Nambao (Dr.)", "C. Whiscals"] };
const THEME = pickTheme({ mean: [27, 87, 115], dominant: [{ rgb: [27, 87, 115], share: 1 }] }).theme;

async function make(format, fields = FIELDS, cover = fakeCover()) {
  const bleed = format.kind === "pdf" ? (format.bleedMm || 0) * MM : 0;
  const lay = buildPoster({ W: format.w, H: format.h, bleed }, THEME, fields, CFG,
    { file: "cover.png", aspect: cover.aspect, spine: "#1b5773" }, { file: "logo.png", aspect: 596 / 924 });
  const pdf = compilePdf(lay.src, { "cover.png": cover.png, "logo.png": LOGO });
  const inspected = await inspectPdf(pdf);
  return { lay, pdf, inspected, cover };
}

for (const f of CFG.formats) {
  test(`poster ${f.name}: every field present, nothing overflowing or overlapping, readable, cover undistorted`, async () => {
    const { lay, inspected, cover } = await make(f);
    const r = checkPoster({ format: f, inspected, regions: lay.regions, fields: FIELDS, cover, coverMean: [27, 87, 115], theme: THEME });
    assert.deepEqual(r.blockers, []);
    assert.equal(r.qualifies, true);
    if (f.kind === "pdf") assert.equal(+inspected.width.toFixed(1), +(f.w + 2 * f.bleedMm * MM).toFixed(1), "A4 plus bleed");
  });
}

test("poster QA catches a stretched cover", async () => {
  const f = CFG.formats[0];
  const { lay, inspected, cover } = await make(f);
  const r = checkPoster({ format: f, inspected, regions: lay.regions, fields: FIELDS, cover: { ...cover, aspect: cover.aspect * 1.1 }, coverMean: [27, 87, 115], theme: THEME });
  assert.ok(r.blockers.some((b) => /cover distorted/.test(b)), r.blockers.join("; "));
});

test("poster QA catches text over its box, text over text, low contrast and missing fields", () => {
  const format = { name: "t", kind: "png" };
  const regions = [{ id: "a", x: 0, y: 0, w: 100, h: 20, fg: "#777777", bg: "#888888", size: 12 }];
  const inspected = { width: 400, height: 400, images: [],
    texts: [{ str: "far too long a line", x: 10, y: 2, w: 160, h: 12, size: 12, angle: 0 },
            { str: "on top of it", x: 20, y: 4, w: 60, h: 12, size: 12, angle: 0 }] };
  const r = checkPoster({ format, inspected, regions, fields: { subject: "", level: "Grade 4", booktype: "Learner's Book", authors: [] },
    cover: { aspect: 1.4, width: 100 }, coverMean: [0, 0, 0], theme: { bg1: "#ffffff" } });
  const all = r.blockers.join("\n");
  for (const re of [/overflows its box/, /text overlaps/, /contrast too low/, /subject missing/, /cover picture missing/, /logo missing/]) assert.match(all, re);
  assert.ok(r.warnings.some((w) => /no author names/.test(w)));
});

test("print: a cover too small for 300 ppi is a blocker", async () => {
  const f = CFG.formats.find((x) => x.kind === "pdf");
  const small = fakeCover(140, 200);
  const { lay, inspected } = await make(f, FIELDS, small);
  const r = checkPoster({ format: f, inspected, regions: lay.regions, fields: FIELDS, cover: small, coverMean: [27, 87, 115], theme: THEME });
  assert.ok(r.blockers.some((b) => /px per inch/.test(b)));
});

test("3D book: one finished picture, placed at its own proportions, poster passes QA", async () => {
  const { bookMockup } = await import("../../tools/poster/lib/mockup.mjs");
  const flat = fakeCover();
  const m = await bookMockup(flat.png, { spine: "#1b5773" });
  assert.ok(m.aspect > 1 && m.nearShare > 0.8 && m.nearShare < 1);
  const f = CFG.formats[0];
  const shown = { ...flat, aspect: m.aspect, width: m.width, png: m.png };
  const lay = buildPoster({ W: f.w, H: f.h }, THEME, FIELDS, CFG, { file: "cover.png", aspect: m.aspect, spine: "#1b5773", mockup: true }, { file: "logo.png", aspect: 596 / 924 });
  const inspected = await inspectPdf(compilePdf(lay.src, { "cover.png": m.png, "logo.png": LOGO }));
  const r = checkPoster({ format: f, inspected, regions: lay.regions, fields: FIELDS, cover: shown, coverMean: [27, 87, 115], theme: THEME });
  assert.deepEqual(r.blockers, []);
});
