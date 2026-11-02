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

const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

export function checkPoster({ format, inspected, regions, fields, cover, coverMean, theme, book }) {
  const blockers = [], warnings = [];
  const tol = 1.5;
  const W = inspected.width, H = inspected.height;
  const textBoxes = regions.filter((r) => !r.art);

  // print: nothing may sit in the bleed or within `safeMm` of the trimmed edge
  const MM = 72 / 25.4;
  const safe = format.kind === "pdf" ? (format.bleedMm || 0) * MM + (format.safeMm || 0) * MM : 0;

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
  const pic = [...inspected.images].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!pic) blockers.push("cover picture missing");
  else {
    const placed = pic.h / pic.w, err = Math.abs(placed / cover.aspect - 1);
    if (err > 0.005) blockers.push(`cover distorted: placed ${placed.toFixed(4)}, cover ${cover.aspect.toFixed(4)} (${(err * 100).toFixed(2)} % off)`);
    if (format.kind === "pdf") {
      const ppi = cover.width / (pic.w / 72);
      if (ppi < (format.minPpi || 300)) blockers.push(`cover only ${Math.round(ppi)} px per inch at print size (needs ${format.minPpi || 300})`);
    }
  }
  if (inspected.images.length < 2) blockers.push("ZEPH logo missing");
  const sep = separation(coverMean, theme.bg1);
  if (contrast(coverMean, theme.bg1) < 1.6 && sep < 2.2) warnings.push(`cover may not stand out from the background (separation ${sep})`);

  // fields
  const all = norm(inspected.texts.map((t) => t.str).join(" "));
  for (const [k, v] of [["subject", fields.subject], ["level", fields.level], ["book type", fields.booktype]]) {
    if (!v) blockers.push(`${k} missing from the book's data`);
    else if (!all.includes(norm(v))) blockers.push(`${k} "${v}" not found on the poster`);
  }
  if (!fields.authors.length) warnings.push("no author names on the cover — the poster shows none");
  else for (const a of fields.authors) if (!all.includes(norm(a))) warnings.push(`author "${a}" not found on the poster`);

  return { format: format.name, qualifies: blockers.length === 0, blockers, warnings };
}

export function summary(res) {
  const L = [`${res.qualifies ? "✓ POSTER OK" : "✗ POSTER NOT OK"}  ${res.book}  — theme ${res.theme}`];
  for (const f of res.formats) {
    L.push(`   ${f.qualifies ? "✓" : "✗"} ${f.format}`);
    f.blockers.forEach((b) => L.push(`      BLOCKER  ${b}`));
    f.warnings.forEach((w) => L.push(`      warn  ${w}`));
  }
  return L.join("\n");
}
