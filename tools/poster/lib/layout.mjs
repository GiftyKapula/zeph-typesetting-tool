// Writes one poster page (Typst source) and the list of its text boxes for the poster QA.
// The structure follows the approved sample advert top to bottom:
//   megaphone + GREAT NEWS tag + audience banner | the book (with its cover words below)
//   CBC Aligned seal | Approved-for-use badge
//   light strip: calendar "Available soon …" | tree "Give your child the gift …" gift
//   contact band: WhatsApp pre-order line + numbers | globe + website
//   footer: ZEPH logo | "Zambia's Leading National Publisher …", yellow rule
// All sizes scale with the page width (u = width / 1080); a taller page gives the book and
// the badges more room, never a different arrangement.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rgbOf, hex } from "./colour.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HELPERS = fs.readFileSync(path.join(HERE, "..", "poster.typ"), "utf8");

const S = (s) => JSON.stringify(String(s));              // a Typst string literal
const C = (h) => `rgb(${S(h)})`;
const pt = (n) => `${(+n).toFixed(2)}pt`;
const mix = (a, b, t) => hex(rgbOf(a).map((v, i) => v + (rgbOf(b)[i] - v) * t));

// `bleed` (print): the page is that much larger all round; backgrounds and bands run into
// it, everything else is laid out on the trimmed page inside it.
export function buildPoster({ W, H, bleed = 0 }, theme, fields, cfg, cover, logo) {
  const u = W / 1080, bl = bleed;
  // a page taller than 4:5 (A4) gives the lower bands, the badges and the book more room
  const tall = Math.max(0, Math.min(1, (H / W - 1.25) / 0.165)), ub = u * (1 + 0.15 * tall);
  const font = `(${cfg.fonts.map(S).join(", ")})`;
  const bg = [];     // full-bleed pieces, in page coordinates
  const out = [];    // everything else, on the trimmed page
  const regions = [];
  const bgAt = (y) => mix(theme.bg1, theme.bg2, Math.max(0, Math.min(1, y / H)));
  // one text box: Typst content placed at (x, y), recorded for the QA
  const box = (id, x, y, w, h, body, { fg, bg, align = "left + horizon", rotate = 0, size, text: txt, large = false } = {}) => {
    const inner = `box(width: ${pt(w)}, height: ${pt(h)}, align(${align}, ${body}))`;
    out.push(`#place(dx: ${pt(x)}, dy: ${pt(y)}, ${rotate ? `rotate(${rotate}deg, ${inner})` : inner})`);
    regions.push({ id, x, y, w, h, fg, bg, rotate, size, text: txt, large });
  };
  const fitT = (w, size, fill, txt, weight = "regular") =>
    `fit(${pt(w)}, ${pt(size)}, font: ${font}, weight: ${S(weight)}, fill: ${C(fill)}, ${S(txt)})`;

  const footerH = 120 * ub, bandH = 116 * ub, stripH = 132 * ub;
  const bandY = H - footerH - bandH, bandPad = (bandH - 116 * u) / 2;   // (band content keeps its 4:5 size, centred)
  const stripY = bandY - stripH - 22 * u, stripX = 46 * u, stripW = W - 92 * u;
  const topBottom = stripY - 14 * u;
  const extra = Math.max(0, topBottom - 700 * u);           // room a taller page adds

  // ---- page + background ----------------------------------------------------------------
  bg.push(`#set page(width: ${pt(W + 2 * bl)}, height: ${pt(H + 2 * bl)}, margin: 0pt, fill: gradient.linear(${C(theme.bg1)}, ${C(theme.bg2)}, angle: 90deg))`);
  // line boxes from ascender to descender, so stacked lines never touch
  out.push(`#set text(font: ${font}, top-edge: "ascender", bottom-edge: "descender")`);

  // ---- the book (right column) -----------------------------------------------------------
  // As big as the page allows, so the words printed on the cover (the authors too) can be
  // read: the book takes 56 % of the width and the left column's call-out scales to fit.
  // No caption under it — the cover itself carries the title, level and authors (as in the
  // approved sample).
  const colX = (0.44 - 0.02 * tall) * W, colW = W - colX - 22 * u;
  const top = 26 * u + extra * 0.05;
  const avail = topBottom - top - 8 * u;
  // (a 3D book — lib/mockup.mjs — is one finished picture with its own shadow and edges)
  const frame = cover.mockup ? 1 : 1.06, frameH = cover.mockup ? 1 : 1.03;
  const bw = Math.min(colW / frame, avail / frameH / cover.aspect);
  const bh = bw * cover.aspect;
  const bookX = colX + (colW - bw * frame) / 2 + (cover.mockup ? 0 : 0.02 * bw), bookY = top + (avail - bh * frameH) / 2;
  const cx = bookX + bw / 2, cy = bookY + bh / 2;
  // soft glow behind the book: halo colour fading into the background at that height
  out.push(`#place(dx: ${pt(cx - bw * 0.95)}, dy: ${pt(cy - bh * 0.66)}, ellipse(width: ${pt(bw * 1.9)}, height: ${pt(bh * 1.32)}, fill: gradient.radial((${C(theme.halo)}, 0%), (${C(mix(theme.halo, bgAt(cy), 0.55))}, 45%), (${C(bgAt(cy))}, 100%))))`);
  if (cover.mockup) out.push(`#place(dx: ${pt(bookX)}, dy: ${pt(bookY)}, image(${S(cover.file)}, width: ${pt(bw)}, height: ${pt(bh)}, fit: "stretch"))`);
  else out.push(`#place(dx: ${pt(bookX)}, dy: ${pt(bookY)}, book(${S(cover.file)}, ${pt(bw)}, ${pt(bh)}, ${C(theme.band)}, ${C(cover.spine || theme.band)}))`);

  // ---- call-out (left column, top), scaled to the column -----------------------------------
  const x0 = 30 * u, y0 = 50 * u + extra * 0.12;
  const k = Math.min(1, (colX - 16 * u - x0) / (575 * u)), uc = u * k;
  out.push(`#place(dx: ${pt(x0)}, dy: ${pt(y0 + 20 * uc)}, megaphone(${pt(190 * uc)}, ${C(theme.tag)}, ${C(mix(theme.tag, "#000000", 0.35))}, ${C(theme.accent)}))`);
  box("headline", x0 + 205 * uc, y0 + 40 * uc, 340 * uc, 86 * uc,
    `box(width: 100%, height: 100%, fill: ${C(theme.tag)}, radius: ${pt(10 * uc)}, inset: (x: ${pt(18 * uc)}), align(center + horizon, ${fitT(304 * uc, 60 * uc, "#ffffff", cfg.headline, "black")}))`,
    { fg: "#ffffff", bg: theme.tag, rotate: -5, size: 60 * uc, text: cfg.headline, large: true });
  box("audience", x0 + 120 * uc, y0 + 138 * uc, 440 * uc, 118 * uc,
    `box(width: 100%, height: 100%, fill: ${C(theme.accent)}, radius: ${pt(10 * uc)}, inset: (x: ${pt(16 * uc)}), align(center + horizon, stack(spacing: ${pt(6 * uc)}, ${cfg.audience.map((l) => fitT(408 * uc, 40 * uc, theme.bannerInk, l, "black")).join(", ")})))`,
    { fg: theme.bannerInk, bg: theme.accent, rotate: -5, size: 40 * uc, text: cfg.audience.join(" "), large: true });

  // ---- badges (left column, lower) -------------------------------------------------------
  const leftW = colX - x0 - 14 * u;
  const bs = 150 * u * (1 + 0.06 * tall), by = y0 + 300 * uc + 40 * u + extra * 0.42;
  const b1 = x0 + leftW * 0.25 - bs / 2, b2 = x0 + leftW * 0.75 - bs / 2;
  out.push(`#place(dx: ${pt(b1)}, dy: ${pt(by)}, cbcSeal(${pt(bs)}, ${C(theme.badge)}, white, ${font}))`);
  out.push(`#place(dx: ${pt(b2)}, dy: ${pt(by)}, tickBadge(${pt(bs)}, ${C(theme.badge)}))`);
  out.push(`#place(dx: ${pt(x0 + leftW * 0.5)}, dy: ${pt(by + 10 * u)}, line(length: ${pt(bs + 70 * u)}, angle: 90deg, stroke: ${pt(2 * u)} + ${C(theme.ink)}.transparentize(55%)))`);
  const ly = by + bs + 12 * u, lw = leftW * 0.43;
  box("badge-cbc", x0 + leftW * 0.25 - lw / 2, ly, lw, 40 * u, fitT(lw, 34 * u, theme.ink, cfg.badgeCbc, "bold"),
    { fg: theme.ink, bg: bgAt(ly), align: "center + horizon", size: 34 * u, text: cfg.badgeCbc, large: true });
  box("badge-approved", x0 + leftW * 0.75 - lw / 2, ly, lw, 80 * u,
    `stack(spacing: ${pt(4 * u)}, ${cfg.badgeApproved.map((l) => fitT(lw, 33 * u, theme.ink, l, "semibold")).join(", ")})`,
    { fg: theme.ink, bg: bgAt(ly), align: "center + horizon", size: 33 * u, text: cfg.badgeApproved.join(" "), large: true });

  // ---- strip: available soon | Christmas gift -------------------------------------------
  for (let i = 0; i < 4; i++) out.push(`#place(dx: ${pt(stripX + i * 2 * ub)}, dy: ${pt(stripY + (i + 1) * 3 * ub)}, rect(width: ${pt(stripW)}, height: ${pt(stripH)}, radius: ${pt(22 * ub)}, fill: black.transparentize(93%)))`);
  out.push(`#place(dx: ${pt(stripX)}, dy: ${pt(stripY)}, rect(width: ${pt(stripW)}, height: ${pt(stripH)}, radius: ${pt(22 * ub)}, fill: ${C(theme.strip)}))`);
  const ic = 104 * ub, mid = stripY + stripH / 2;
  out.push(`#place(dx: ${pt(stripX + 22 * ub)}, dy: ${pt(mid - ic / 2)}, calendarIcon(${pt(ic)}, ${C(mix(theme.accent, "#ffffff", 0.75))}, ${C(theme.tag)}))`);
  const ax = stripX + 140 * ub, aw = stripW * 0.47 - 150 * ub;
  box("availability", ax, stripY + 12 * ub, aw, stripH - 24 * ub,
    `stack(spacing: ${pt(6 * ub)}, ${fitT(aw, 34 * ub, theme.stripInk, cfg.availability[0])}, ${fitT(aw, 38 * ub, theme.stripInk, cfg.availability[1], "bold")})`,
    { fg: theme.stripInk, bg: theme.strip, size: 34 * ub, text: cfg.availability.join(" "), large: true });
  const dx1 = stripX + stripW * 0.47;
  out.push(`#place(dx: ${pt(dx1)}, dy: ${pt(stripY + 22 * ub)}, line(length: ${pt(stripH - 44 * ub)}, angle: 90deg, stroke: ${pt(2 * ub)} + ${C(theme.stripInk)}.transparentize(60%)))`);
  out.push(`#place(dx: ${pt(dx1 + 16 * ub)}, dy: ${pt(mid - 56 * ub)}, treeIcon(${pt(112 * ub)}))`);
  const gx = dx1 + 110 * ub, gw = stripX + stripW - 130 * ub - gx;
  box("gift", gx, stripY + 10 * ub, gw, stripH - 20 * ub,
    `stack(spacing: ${pt(4 * ub)}, ${cfg.gift.map((l) => fitT(gw, 27 * ub, theme.stripInk, l, "bold")).join(", ")})`,
    { fg: theme.stripInk, bg: theme.strip, size: 27 * ub, text: cfg.gift.join(" "), large: true });
  out.push(`#place(dx: ${pt(stripX + stripW - 116 * ub)}, dy: ${pt(mid - 50 * ub)}, giftIcon(${pt(96 * ub)}, ${C(theme.tag)}, ${C(theme.accent)}))`);

  // ---- contact band ----------------------------------------------------------------------
  bg.push(`#place(dx: 0pt, dy: ${pt(bandY + bl)}, rect(width: ${pt(W + 2 * bl)}, height: ${pt(bandH)}, fill: ${C(theme.band)}))`);
  bg.push(`#place(dx: 0pt, dy: ${pt(bandY - 26 * u + bl)}, polygon(fill: ${C(theme.accent)}, (0pt, 0pt), (${pt(90 * u + bl)}, ${pt(26 * u)}), (0pt, ${pt(34 * u)})))`);
  bg.push(`#place(dx: ${pt(W + bl - 90 * u)}, dy: ${pt(bandY - 26 * u + bl)}, polygon(fill: ${C(theme.accent)}, (${pt(90 * u + bl)}, 0pt), (${pt(90 * u + bl)}, ${pt(34 * u)}), (0pt, ${pt(26 * u)})))`);
  const wi = 78 * u;
  out.push(`#place(dx: ${pt(30 * u)}, dy: ${pt(bandY + (bandH - wi) / 2)}, whatsappIcon(${pt(wi)}))`);
  const px = 124 * u, pw = W * 0.66 - px - 14 * u;
  box("preorder", px, bandY + bandPad + 14 * u, pw, 36 * u, fitT(pw, 25 * u, theme.bandInk, cfg.preorder),
    { fg: theme.bandInk, bg: theme.band, size: 25 * u, text: cfg.preorder });
  const nums = cfg.whatsappNumbers.join("  |  ");
  box("whatsapp", px, bandY + bandPad + 54 * u, pw, 48 * u,
    `fit(${pt(pw)}, ${pt(34 * u)}, font: ${font}, weight: "bold", fill: ${C(theme.bandInk)}, [#text(size: 0.8em, ${S(cfg.whatsappLabel + " ")})#text(fill: ${C(theme.accent)}, ${S(nums)})])`,
    { fg: theme.accent, bg: theme.band, size: 34 * u, text: `${cfg.whatsappLabel} ${nums}`, large: true });
  out.push(`#place(dx: ${pt(W * 0.66)}, dy: ${pt(bandY + 22 * u)}, line(length: ${pt(bandH - 44 * u)}, angle: 90deg, stroke: ${pt(2 * u)} + ${C(theme.bandInk)}.transparentize(55%)))`);
  const gi = 68 * u, gwx = W * 0.66 + 22 * u;
  out.push(`#place(dx: ${pt(gwx)}, dy: ${pt(bandY + (bandH - gi) / 2)}, globeIcon(${pt(gi)}, ${C(theme.badge)}))`);
  const wx = gwx + gi + 16 * u, ww = W - wx - 26 * u;
  box("website", wx, bandY + 30 * u, ww, bandH - 60 * u, fitT(ww, 38 * u, theme.bandInk, cfg.website, "bold"),
    { fg: theme.bandInk, bg: theme.band, size: 38 * u, text: cfg.website, large: true });

  // ---- footer ----------------------------------------------------------------------------
  const fy = H - footerH;
  bg.push(`#place(dx: 0pt, dy: ${pt(fy + bl)}, rect(width: ${pt(W + 2 * bl)}, height: ${pt(footerH + bl)}, fill: white))`);
  bg.push(`#place(dx: 0pt, dy: ${pt(H + bl - 12 * ub)}, rect(width: ${pt(W + 2 * bl)}, height: ${pt(12 * ub + bl)}, fill: ${C(theme.accent)}))`);
  const lh = 88 * ub, lwid = lh / logo.aspect;
  out.push(`#place(dx: ${pt(300 * ub - lwid)}, dy: ${pt(fy + (footerH - 12 * ub - lh) / 2)}, image(${S(logo.file)}, width: ${pt(lwid)}, height: ${pt(lh)}, fit: "stretch"))`);
  out.push(`#place(dx: ${pt(326 * ub)}, dy: ${pt(fy + 18 * ub)}, line(length: ${pt(footerH - 48 * ub)}, angle: 90deg, stroke: ${pt(3 * ub)} + ${C(theme.stripInk)}))`);
  const tx = 350 * ub, tw = W - tx - 40 * ub;
  box("tagline", tx, fy + 10 * ub, tw, footerH - 30 * ub,
    `stack(spacing: ${pt(6 * ub)}, ${fitT(tw, 41 * ub, theme.stripInk, cfg.tagline[0], "black")}, ${fitT(tw, 31 * ub, theme.stripInk, cfg.tagline[1])})`,
    { fg: theme.stripInk, bg: "#ffffff", size: 31 * ub, text: cfg.tagline.join(" "), large: true });

  const src = `${HELPERS}\n${bg.join("\n")}\n#place(dx: ${pt(bl)}, dy: ${pt(bl)}, block(width: ${pt(W)}, height: ${pt(H)})[\n${out.join("\n")}\n])\n`;
  for (const r of regions) { r.x += bl; r.y += bl; }     // QA works in page coordinates
  return { src, regions, trim: { x: bl, y: bl, w: W, h: H }, book: { x: bookX + bl, y: bookY + bl, w: bw, h: bh }, logo: { w: lwid, h: lh } };
}
