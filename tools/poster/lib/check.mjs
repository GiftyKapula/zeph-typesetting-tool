// Poster QA — the same shape as the book gate (tools/qa/qa.mjs): BLOCKERS fail the poster,
// WARNINGS are listed for a person. Checked on the RENDERED poster PDF, not on intentions:
//
//   overflow     every piece of text sits inside the box it was set in, and inside the page
//   shrunk       text the fitting had to shrink below 60 % of its design size (warning)
//   contrast     WCAG ratio of every text box against its background: 4.5 (3 for large text)
//   distortion   the cover is placed at its own proportions (within 0.5 %)
//   resolution   the cover has at least 200 px per inch at its printed size (warning)
//   standout     the cover separates from the background behind it (warning)
//   fields       subject, level, book type, the cover and the logo are all on the poster;
//                author names are expected but may be absent from a cover (warning)

import { contrast, separation, rgbOf } from "./colour.mjs";



export function checkPoster({ format, inspected, regions, fields, cover, coverMean, theme, book }) {
  const blockers = [], warnings = [];
  const tol = 1.5;
  const W = inspected.width, H = inspected.height;
  const textBoxes = regions.filter((r) => !r.art);

  // print: nothing may sit in the bleed or within `safeMm` of the trimmed edge
  const MM = 72 / 25.4;
  const safe = format.kind === "pdf" ? (format.bleedMm || 0) * MM + (format.safeMm || 0) * MM : 0;

  // the cover's own words (a vector cover brings its text along) are the book's, not the
  // poster's: they are checked for size below, not for boxes and overlaps
  // (a vector cover is page 1 clipped to its front panel: the hidden back cover's words are
  // in the file too, so the poster's text is told apart by its known wording, not position)
  const n = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/s+/g, " ").trim();
  const known = n(regions.map((r) => r.text || "").join(" ") + " CBC COMPETENCE BASED CURRICULUM");
  const onCover = (t) => book && t.x + t.w / 2 >= book.x && t.x + t.w / 2 <= book.x + book.w && t.y + t.h / 2 >= book.y && t.y + t.h / 2 <= book.y + book.h;
  const isPoster = (t) => !onCover(t) && known.includes(n(t.str));
  const coverTexts = inspected.texts.filter(onCover);
  inspected = { ...inspected, texts: inspected.texts.filter(isPoster),
    images: inspected.images.filter((i) => i.x >= -1 && i.y >= -1 && i.x + i.w <= W + 1 && i.y + i.h <= H + 1) };

  // overflow + shrinking
  for (const t of inspected.texts) {
    if (t.x < -tol || t.y < -tol || t.x + t.w > W + tol || t.y + t.h > H + tol) { blockers.push(`text off the page: "${t.str.slice(0, 40)}"`); continue; }
    if (safe && (t.x < safe - tol || t.y < safe - tol || t.x + t.w > W - safe + tol || t.y + t.h > H - safe + tol)) blockers.push(`text inside the ${format.safeMm} mm print margin: "${t.str.slice(0, 40)}"`);
    const home = textBoxes.find((r) => {
      const slack = r.rotate ? Math.abs(Math.sin(r.rotate * Math.PI / 180)) * r.w + tol : tol;
      return t.x + t.w / 2 >= r.x - slack && t.x + t.w / 2 <= r.x + r.w + slack && t.y + t.h / 2 >= r.y - slack && t.y + t.h / 2 <= r.y + r.h + slack;
    });
    if (!home) continue;   // the seal's lettering and other drawn art carry their own text
    const slack = home.rotate ? Math.abs(Math.sin(home.rotate * Math.PI / 180)) * home.w + tol : tol;
    if (t.x < home.x - slack || t.x + t.w > home.x + home.w + slack) blockers.push(`text overflows its box (${home.id}): "${t.str.slice(0, 40)}"`);
    if (home.size && t.size < home.size * 0.6 - 0.01) warnings.push(`${home.id}: text shrunk to ${Math.round(100 * t.size / home.size)} % to fit ("${t.str.slice(0, 30)}…")`);
  }

  // lines that run into each other (upright text only; the seal's lettering is drawn art)
  const flat = inspected.texts.filter((t) => Math.abs(t.angle) < 1);
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
    const a = flat[i], b = flat[j];
    const hx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const vy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (hx > 2 && vy > 0.3 * Math.min(a.h, b.h)) blockers.push(`text overlaps: "${a.str.slice(0, 25)}" / "${b.str.slice(0, 25)}"`);
  }

  // contrast of every text box
  for (const r of textBoxes) {
    const c = contrast(r.fg, r.bg), need = r.large ? 3 : 4.5;
    if (c < need) blockers.push(`contrast too low in ${r.id}: ${c.toFixed(2)} (needs ${need})`);
  }

  // the cover: proportions, resolution, separation from the background
  // the cover: of the large pictures (over 5 % of the page), the one closest to its proportions
  const big = inspected.images.filter((i) => i.w * i.h > 0.05 * W * H);
  const pic = [...big].sort((a, b) => Math.abs(a.h / a.w / cover.aspect - 1) - Math.abs(b.h / b.w / cover.aspect - 1))[0];
  if (!pic) blockers.push("cover picture missing");
  else {
    const placed = pic.h / pic.w, err = Math.abs(placed / cover.aspect - 1);
    if (err > 0.005) blockers.push(`cover distorted: placed ${placed.toFixed(4)}, cover ${cover.aspect.toFixed(4)} (${(err * 100).toFixed(2)} % off)`);
    if (format.kind === "pdf" && !pic.form) {   // (a vector cover has no pixels to count)
      const ppi = cover.width / (pic.w / 72);
      if (ppi < (format.minPpi || 300)) blockers.push(`cover only ${Math.round(ppi)} px per inch at print size (needs ${format.minPpi || 300})`);
    }
  }
  if (inspected.images.length < 2) blockers.push("ZEPH logo missing");
  const sep = separation(coverMean, theme.bg1);
  if (contrast(coverMean, theme.bg1) < 1.6 && sep < 2.2) warnings.push(`cover may not stand out from the background (separation ${sep})`);

  // fields: they reach the poster ON THE COVER (the words are read from the cover itself),
  // so each must be there in the cover's words and the cover must be placed
  for (const [k, v] of [["subject", fields.subject], ["level", fields.level], ["book type", fields.booktype]]) {
    if (!v) blockers.push(`${k} missing from the cover's words`);
  }
  if (!fields.authors.length) warnings.push("no author names on the cover — the poster shows none");

  // how big the cover's own author names come out on the poster
  let authorText = null;
  // measured on the poster itself when the cover is vector (its words are real text there),
  // otherwise from the cover's own proportions
  const names = fields.authors.map((n) => n.toLowerCase().replace(/s+/g, " ").trim());
  const nameSizes = coverTexts.filter((t) => { const s = t.str.toLowerCase().replace(/s+/g, " ").trim(); return s.length > 1 && names.some((n) => n.includes(s) || s.includes(n)); }).map((t) => t.size);
  if (pic && (nameSizes.length || cover.authorShare)) {
    const h = nameSizes.length ? Math.min(...nameSizes) : cover.authorShare * pic.h;   // points on the poster page
    authorText = format.kind === "pdf" ? { pt: +h.toFixed(1), mm: +(h / MM).toFixed(2) } : { px: +h.toFixed(1), pxHD: +(h * (format.hd || 1)).toFixed(1) };
    if (format.kind === "pdf" && h < 6) warnings.push(`author names on the printed cover are only ${h.toFixed(1)} pt`);
    if (format.kind === "png" && h < 12) warnings.push(`author names on the cover are only ${h.toFixed(1)} px tall (${(h * (format.hd || 1)).toFixed(0)} px in HD) — readable when zoomed`);
  }

  return { format: format.name, qualifies: blockers.length === 0, blockers, warnings, authorText };
}

export function summary(res) {
  const L = [`${res.qualifies ? "✓ POSTER OK" : "✗ POSTER NOT OK"}  ${res.book}${res.set ? `  — poster ${res.set} (${res.bookStyle === "3d" ? "3D book" : "flat book"})` : ""}  — theme ${res.theme}`];
  for (const f of res.formats) {
    L.push(`   ${f.qualifies ? "✓" : "✗"} ${f.format}`);
    f.blockers.forEach((b) => L.push(`      BLOCKER  ${b}`));
    f.warnings.forEach((w) => L.push(`      warn  ${w}`));
  }
  return L.join("\n");
}
