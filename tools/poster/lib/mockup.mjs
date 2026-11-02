// A 3D book for the poster (`"posterBook": "3d"`): the front cover turned slightly towards
// the viewer, as in the approved sample — the near (right) edge taller than the far (left)
// one, the spine on the left, the page block on the right and a soft shadow under it.
// Drawn here with canvas (column by column for the perspective), not in Typst, so the poster
// places it as one finished picture at its own proportions.

import { createCanvas, loadImage } from "./cover.mjs";

const darken = (hex, f) => {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
  return `rgb(${c.join(",")})`;
};

// png: the flat front cover; returns { png, aspect, coverBox } where coverBox is where the
// cover's near edge sits in the picture (share of the picture's height), for the QA.
export async function bookMockup(png, { spine = "#1b5773", turn = 0.10, depth = 0.05 } = {}) {
  const img = await loadImage(png);
  const cw = img.width, ch = img.height;
  const fw = Math.round(cw * (1 - turn * 0.6));            // front face, foreshortened
  const farH = ch * (1 - turn), nearH = ch;                 // far (left) and near (right) edge heights
  const sw = Math.round(cw * 0.035), pw = Math.round(cw * depth);
  const pad = Math.round(cw * 0.06);
  const W = sw + fw + pw + pad * 2, H = Math.round(ch * 1.06 + pad * 2);
  const c = createCanvas(W, H);
  const x = c.getContext("2d");
  const x0 = pad + sw, y0 = pad + ch * 0.02;
  const topAt = (t) => y0 + (nearH - (farH + (nearH - farH) * t)) / 2 * 1.25;   // a little more rise at the top
  const hAt = (t) => farH + (nearH - farH) * t;
  const xr = x0 + fw;

  // shadow under the whole book
  x.save();
  x.shadowColor = "rgba(0,0,0,0.42)"; x.shadowBlur = cw * 0.045; x.shadowOffsetX = cw * 0.035; x.shadowOffsetY = cw * 0.04;
  x.fillStyle = "rgba(0,0,0,1)";
  x.beginPath();
  x.moveTo(x0 - sw, topAt(0) + sw * 0.6); x.lineTo(xr + pw, topAt(1) + pw * 0.35); x.lineTo(xr + pw, topAt(1) + nearH - pw * 0.1); x.lineTo(x0 - sw, topAt(0) + farH - sw * 0.2); x.closePath(); x.fill();
  x.restore();
  x.globalCompositeOperation = "source-over";

  // page block on the near side
  const pg = x.createLinearGradient(xr, 0, xr + pw, 0);
  pg.addColorStop(0, "#fbf9f3"); pg.addColorStop(1, "#d8d2c4");
  x.fillStyle = pg;
  x.beginPath();
  x.moveTo(xr, topAt(1) + 2); x.lineTo(xr + pw, topAt(1) + pw * 0.35); x.lineTo(xr + pw, topAt(1) + nearH - pw * 0.12); x.lineTo(xr, topAt(1) + nearH - 2); x.closePath(); x.fill();
  x.strokeStyle = "rgba(150,140,120,0.35)"; x.lineWidth = Math.max(1, cw / 900);
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    x.beginPath(); x.moveTo(xr + pw * t, topAt(1) + pw * 0.35 * t + 2); x.lineTo(xr + pw * t, topAt(1) + nearH - pw * 0.12 * t - 2); x.stroke();
  }

  // spine on the far side
  const sg = x.createLinearGradient(x0 - sw, 0, x0, 0);
  sg.addColorStop(0, darken(spine, 0.55)); sg.addColorStop(1, darken(spine, 0.2));
  x.fillStyle = sg;
  x.beginPath();
  x.moveTo(x0 - sw, topAt(0) + sw * 0.6); x.lineTo(x0, topAt(0)); x.lineTo(x0, topAt(0) + farH); x.lineTo(x0 - sw, topAt(0) + farH - sw * 0.2); x.closePath(); x.fill();

  // the cover, one column at a time
  for (let i = 0; i < fw; i++) {
    const t = i / (fw - 1);
    const sx = Math.min(cw - 1, Math.floor(t * cw));
    x.drawImage(img, sx, 0, 1, ch, x0 + i, topAt(t), 1.6, hAt(t));
  }
  // light: a soft sheen from the far edge, and the hinge crease near the spine
  const sheen = x.createLinearGradient(x0, 0, xr, 0);
  sheen.addColorStop(0, "rgba(0,0,0,0.22)"); sheen.addColorStop(0.06, "rgba(0,0,0,0.0)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0.0)"); sheen.addColorStop(0.85, "rgba(255,255,255,0.07)"); sheen.addColorStop(1, "rgba(255,255,255,0.0)");
  x.fillStyle = sheen;
  x.beginPath(); x.moveTo(x0, topAt(0)); x.lineTo(xr, topAt(1)); x.lineTo(xr, topAt(1) + nearH); x.lineTo(x0, topAt(0) + farH); x.closePath(); x.fill();

  return { png: c.toBuffer("image/png"), width: W, height: H, aspect: H / W, nearShare: nearH / H };
}
