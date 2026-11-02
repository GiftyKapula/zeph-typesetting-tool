// Colour helpers for the marketing posters: WCAG contrast, the cover's dominant colours
// (k-means on a down-sampled copy), and the poster colour themes built from them.
//
// The background is chosen to make the COVER stand out: it is pulled away from the cover's
// own hue (towards the complementary side of the wheel) and away from its lightness, so a
// dark blue cover sits on a warm cream and a pale cover sits on a deep shade.

export const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
export const rgbOf = (h) => { const s = h.replace(/^#/, ""); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };

// WCAG 2.x relative luminance and contrast ratio (1 … 21)
export function luminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) {
  const [x, y] = [luminance(typeof a === "string" ? rgbOf(a) : a), luminance(typeof b === "string" ? rgbOf(b) : b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const t = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return [t(h + 1 / 3) * 255, t(h) * 255, t(h - 1 / 3) * 255];
}
const hsl = (h, s, l) => hex(hslToRgb([h, s, l]));
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// Dominant colours of an RGBA pixel buffer: k-means (k clusters, deterministic seeding),
// returned largest cluster first as { rgb, share } (share = fraction of pixels).
export function dominantColours(data, k = 5, iterations = 12) {
  const px = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]]);
  if (!px.length) return [];
  // seed: k pixels spread through the luminance-sorted list (deterministic, no RNG)
  const sorted = [...px].sort((a, b) => luminance(a) - luminance(b));
  let cent = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / k)].slice());
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    for (let p = 0; p < px.length; p++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++) {
        const d = (px[p][0] - cent[c][0]) ** 2 + (px[p][1] - cent[c][1]) ** 2 + (px[p][2] - cent[c][2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      assign[p] = best;
    }
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let p = 0; p < px.length; p++) { const s = sum[assign[p]]; s[0] += px[p][0]; s[1] += px[p][1]; s[2] += px[p][2]; s[3]++; }
    cent = cent.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  const n = cent.map(() => 0);
  for (const a of assign) n[a]++;
  return cent.map((rgb, i) => ({ rgb: rgb.map(Math.round), share: n[i] / px.length }))
    .filter((c) => c.share > 0).sort((a, b) => b.share - a.share);
}

// Average colour of the cover (what the eye reads as "the cover's colour" against a background).
export function meanColour(data) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { if (data[i + 3] <= 128) continue; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  return n ? [r / n, g / n, b / n].map(Math.round) : [128, 128, 128];
}

// How well a background lets the cover stand out: lightness contrast between the cover's
// mean colour and the background, plus a bonus for being far round the colour wheel.
export function separation(coverMean, bg) {
  const c = contrast(coverMean, bg);
  const [h1, s1] = rgbToHsl(coverMean), [h2, s2] = rgbToHsl(rgbOf(bg));
  const hue = (s1 > 0.12 && s2 > 0.08) ? hueDist(h1, h2) / 180 : 0.5;   // greys: neutral bonus
  return +(c + hue * 1.5).toFixed(3);
}

// The poster themes. Each one keeps the sample's layout and wording; only colours change.
//   bg1/bg2  background gradient (top → bottom)   halo  soft glow behind the book
//   ink      headings/labels on the background     band  the contact band   bandInk its text
//   accent   the yellow banner + numbers           tag   the red "GREAT NEWS" tag
//   badge    the blue tick badge / globe           strip the light "Available soon" strip
export function themesFor(cover) {
  const { mean, dominant } = cover;
  const [h, s] = rgbToHsl(mean);
  const main = dominant.find((d) => rgbToHsl(d.rgb)[1] > 0.2) || dominant[0] || { rgb: mean };
  const [mh] = rgbToHsl(main.rgb);
  const comp = (mh + 180) % 360;
  const deepNavy = "#0f2a4f";
  const base = { tag: "#d7262b", accent: "#f6c21a", badge: "#1f6fe0", strip: "#ffffff", stripInk: "#0f2a4f", bannerInk: "#0f2a4f" };
  const T = {
    // the sample's look: warm cream behind the book, navy band
    cream: { ...base, name: "cream", bg1: "#fbf3e8", bg2: "#f1dfc8", halo: "#ffffff", ink: "#0f2a4f", band: deepNavy, bandInk: "#ffffff" },
    // a light tint of the cover's complementary hue
    complement: { ...base, name: "complement", bg1: hsl(comp, 0.55, 0.95), bg2: hsl(comp, 0.45, 0.86), halo: "#ffffff", ink: hsl(mh, 0.6, 0.18), band: hsl(mh, 0.65, 0.17), bandInk: "#ffffff" },
    // a deep shade of the complementary hue: for pale or very light covers
    deep: { ...base, name: "deep", bg1: hsl(comp, 0.45, 0.24), bg2: hsl(comp, 0.5, 0.13), halo: hsl(comp, 0.35, 0.42), ink: "#ffffff", band: hsl(comp, 0.55, 0.08), bandInk: "#ffffff", badge: "#3d8bff" },
    // cool silver-grey: a quiet background for a busy, colourful cover
    silver: { ...base, name: "silver", bg1: "#f4f6f8", bg2: "#dfe4ea", halo: "#ffffff", ink: "#1b2a3a", band: "#1b2a3a", bandInk: "#ffffff" },
  };
  for (const t of Object.values(T)) t.score = separation(mean, t.bg1);
  return { themes: T, coverHue: h, coverSat: s };
}

// The theme to use: an override ("posterTheme": "deep", or an object of colours laid over
// the best theme), otherwise the one that separates best from the cover.
export function pickTheme(cover, override) {
  const { themes } = themesFor(cover);
  const ranked = Object.values(themes).sort((a, b) => b.score - a.score);
  if (typeof override === "string") {
    if (!themes[override]) throw new Error(`unknown posterTheme "${override}" (choose ${Object.keys(themes).join(", ")})`);
    return { theme: themes[override], ranked, forced: true };
  }
  if (override && typeof override === "object") return { theme: { ...ranked[0], ...override, name: "custom" }, ranked, forced: true };
  return { theme: ranked[0], ranked, forced: false };
}
