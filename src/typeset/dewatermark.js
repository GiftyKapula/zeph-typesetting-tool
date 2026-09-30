// Generator watermark removal for imported manuscript pictures.
//
// Illustrations produced by an image generator often arrive with the generator's
// own badge burnt into a corner of the picture — a small rounded "pill" of flat
// off-white with dark lettering in it, most commonly reading "AI-Generated". It is
// not part of the artwork: it is a label stamped on top of it, and it has no place
// in a printed book. Authors paste these pictures into the manuscript badge and
// all, so the badge travels through the whole pipeline unless something takes it
// off.
//
// This module takes it off WITHOUT cutting the picture down. Cropping the badge
// away would also throw out the artwork underneath it and change the picture's
// aspect ratio; instead the badge is detected, masked, and the pixels it covered
// are rebuilt from the surrounding picture by patch-based inpainting, so the sky
// (or wall, or foliage) it was sitting on simply continues through. Everything
// outside the badge's own footprint is left byte-for-byte alone.
//
// Detection is deliberately narrow, because a false positive would erase real
// artwork. A region is only treated as a badge when it matches the whole stamped
// -label signature at once: a flat, near-neutral light plate; dark near-neutral
// lettering inside it; rounded ends; a plausible label size and aspect; and a
// position tucked into one of the picture's four corners. Manuscript graphics that
// merely contain a pill — a coloured "FAMILY HOPE" lozenge, a numbered step
// header — fail on colour, flatness or position. When the detector cannot see a
// badge that a human can, the book's overrides file can name the box by hand; see
// `watermark` in docs/HOUSE-STYLE.md §5.

let canvasLib = null;
try { canvasLib = require("canvas"); } catch (_) { /* removal disabled */ }

// ---------------------------------------------------------------- detection

// The badge plate: light, and near-neutral — a warm off-white (the common stamp is
// about #FDF3EB). Real artwork pills are coloured, and fail the spread test.
function isPlate(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mn >= 208 && mx >= 238 && mx - mn <= 34;
}
// The lettering inside it: dark, and likewise near-neutral (near-black/brown).
function isInk(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx <= 140 && mx - mn <= 62;
}

// Find every stamped badge in the picture. Returns an array of {x, y, w, h} boxes
// in pixels. Only the four corners are searched — that is where generators stamp,
// and searching the middle of a picture is where false positives live.
function findBadges(data, W, H) {
  const found = [];
  const winW = Math.ceil(W * 0.55), winH = Math.ceil(H * 0.22);
  const plate = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] > 200 && isPlate(data[i], data[i + 1], data[i + 2])) plate[p] = 1;
  }
  const seen = new Uint8Array(W * H);
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];   // [right?, bottom?]
  for (const [cR, cB] of corners) {
    const x0 = cR ? W - winW : 0, x1 = cR ? W : winW;
    const y0 = cB ? H - winH : 0, y1 = cB ? H : winH;
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const s = sy * W + sx;
        if (!plate[s] || seen[s]) continue;
        // Flood the flat plate (4-connected), bounded by the search window. A plate
        // that leaks out of the window is background, not a badge, and is discarded
        // by the size checks below rather than being "fixed".
        let minx = sx, maxx = sx, miny = sy, maxy = sy, area = 0;
        const stack = [s];
        seen[s] = 1;
        while (stack.length) {
          const p = stack.pop();
          const px = p % W, py = (p - px) / W;
          area++;
          if (px < minx) minx = px; if (px > maxx) maxx = px;
          if (py < miny) miny = py; if (py > maxy) maxy = py;
          if (px > x0 && plate[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
          if (px < x1 - 1 && plate[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
          if (py > y0 && plate[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
          if (py < y1 - 1 && plate[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
        }
        const bw = maxx - minx + 1, bh = maxy - miny + 1;
        if (qualifies(data, W, H, minx, miny, bw, bh, area)) found.push({ x: minx, y: miny, w: bw, h: bh });
      }
    }
  }
  return dedupe(found);
}

// Every test a candidate plate has to pass to be called a stamped badge. Any one of
// them failing leaves the picture untouched — the safe direction to err in.
function qualifies(data, W, H, bx, by, bw, bh, area) {
  // Size and shape of a label, not of a background or a full-width banner.
  if (bh < H * 0.026 || bh > H * 0.11) return false;
  if (bw < W * 0.055 || bw > W * 0.42) return false;
  const aspect = bw / bh;
  if (aspect < 1.9 || aspect > 7.5) return false;
  // Tucked into a corner: a small inset from BOTH nearest edges. A badge flush
  // against the edge, or sitting well inside the picture, is not the stamp.
  const gapX = Math.min(bx, W - (bx + bw)), gapY = Math.min(by, H - (by + bh));
  if (gapX > W * 0.07 || gapY > H * 0.09) return false;
  if (gapX < W * 0.0015 && gapY < H * 0.0015) return false;
  // Rounded ends: the plate fills the bbox's edge midpoints but not its corners.
  const px = (x, y) => { const i = ((y * W) + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const inset = Math.max(1, Math.round(bh * 0.09));
  const corner = [[bx + inset, by + inset], [bx + bw - 1 - inset, by + inset],
                  [bx + inset, by + bh - 1 - inset], [bx + bw - 1 - inset, by + bh - 1 - inset]];
  if (corner.some(([x, y]) => isPlate(...px(x, y)))) return false;
  const mid = [[bx + (bw >> 1), by + 1], [bx + (bw >> 1), by + bh - 2],
               [bx + 1, by + (bh >> 1)], [bx + bw - 2, by + (bh >> 1)]];
  if (!mid.every(([x, y]) => isPlate(...px(x, y)))) return false;
  if (area < bw * bh * 0.45) return false;                   // plate must be the bulk of it
  // Interior: nothing but plate and lettering, the lettering covering a share of the
  // label consistent with one short line of text, on a band of rows inside the plate.
  // This is measured on the SOLID CENTRAL BAND rather than on the whole bounding box:
  // a pill's rounded ends leave the picture showing in the box's four corners, and
  // its antialiased rim adds a further in-between fringe all the way round, so on the
  // full box even a perfect stamp scores about a tenth "neither". Cutting the caps and
  // the rim out of the measurement makes the test sharp again.
  const cap = Math.round(bh * 0.55), rim = Math.max(1, Math.round(bh * 0.07));
  const cx0 = bx + cap, cx1 = bx + bw - cap, cy0 = by + rim, cy1 = by + bh - rim;
  if (cx1 - cx0 < bh || cy1 - cy0 < 4) return false;
  // Three classes only: the plate, the lettering, and the antialiased fringe between
  // them (a neutral mid-tone — roughly a twentieth of the band, and unavoidable).
  // Anything else is FOREIGN colour, and a stamped label contains none at all.
  let plateN = 0, inkN = 0, blend = 0, foreign = 0;
  let sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0;
  let inkTop = bh, inkBot = -1;
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const [r, g, b] = px(x, y);
      if (isPlate(r, g, b)) {
        plateN++; sr += r; sg += g; sb += b; sr2 += r * r; sg2 += g * g; sb2 += b * b;
      } else if (isInk(r, g, b)) {
        inkN++;
        const ry = y - by;
        if (ry < inkTop) inkTop = ry; if (ry > inkBot) inkBot = ry;
      } else if (Math.max(r, g, b) - Math.min(r, g, b) <= 62) blend++;
      else foreign++;
    }
  }
  const band = (cx1 - cx0) * (cy1 - cy0);
  if (foreign > band * 0.006) return false;                  // no artwork inside a stamp
  if (blend > band * 0.18) return false;                     // a fringe, not a gradient
  if (plateN < band * 0.6) return false;                     // mostly plate
  if (inkN < band * 0.04 || inkN > band * 0.4) return false; // one short line of lettering
  if (inkBot < 0) return false;
  if (inkBot - inkTop > bh * 0.8) return false;              // lettering sits in a band
  if (inkTop < bh * 0.06) return false;                      // ... clear of the plate's edges
  // Flat fill: a stamped plate is one colour. Some tolerance, because an upscaled
  // picture carries the upscaler's noise into the plate too.
  const n = plateN;
  if (!n) return false;
  const sd = (s, s2) => Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)));
  if (Math.max(sd(sr, sr2), sd(sg, sg2), sd(sb, sb2)) > 9) return false;
  return true;
}

// The flood can enter the same plate from two corners' windows; keep one box each.
function dedupe(boxes) {
  const out = [];
  for (const b of boxes) {
    if (out.some((o) => Math.abs(o.x - b.x) < 4 && Math.abs(o.y - b.y) < 4)) continue;
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------- inpainting

// Rebuild the masked pixels from the picture around them, by multi-scale patch
// matching: at each scale every hole patch is matched to the most similar patch of
// UNMASKED picture nearby, and the hole is re-voted from those matches; the result
// seeds the next finer scale. On smooth ground (sky, a wall) this settles into a
// clean continuation of the gradient; on textured ground it carries the texture
// through instead of smearing it, which a plain blur-fill cannot do.
//
// Source patches are taken only from a window around the hole, so the fill borrows
// from the picture's own neighbourhood rather than from a face on the far side.
const PATCH = 7;                 // odd; 7 holds enough structure without over-smoothing
// A match is scored on how well the patch fits AND on how far it was fetched from.
// Pictures in these books are full of level bands — a wall above a chalkboard rail, a
// horizon, a desk edge, a skyline — and a patch fetched from a different band fills the
// hole with the wrong thing however well its colours happen to agree. Penalising
// vertical travel hard and horizontal travel gently says "continue this row of the
// picture sideways", which is what a band wants; a patch can still come from far along
// the row, so texture stays varied. The two constants are in units of the patch's own
// squared-colour-difference score, so they mean the same thing at every scale.
const PULL_Y = 60;               // cost of a row of vertical travel, squared
const PULL_X = 0.2;              // ... and of a column of horizontal travel

function inpaint(data, W, H, mask) {
  // Working window: the hole's bounds, generously padded for source material.
  let minx = W, miny = H, maxx = -1, maxy = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (maxx < 0) return;
  const pad = Math.max(32, 2 * (maxy - miny + 1), (maxx - minx + 1) >> 1);
  const wx = Math.max(0, minx - pad), wy = Math.max(0, miny - pad);
  const ww = Math.min(W, maxx + 1 + pad) - wx, wh = Math.min(H, maxy + 1 + pad) - wy;

  // Pull the window out as float RGB + hole flags.
  let img = new Float32Array(ww * wh * 3);
  let hole = new Uint8Array(ww * wh);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const s = ((wy + y) * W + (wx + x)) * 4, d = (y * ww + x) * 3;
    img[d] = data[s]; img[d + 1] = data[s + 1]; img[d + 2] = data[s + 2];
    hole[y * ww + x] = mask[(wy + y) * W + (wx + x)] ? 1 : 0;
  }

  // Scale pyramid, coarsest first, down to where the hole is a handful of pixels.
  const holeMin = Math.min(maxx - minx + 1, maxy - miny + 1);
  let levels = 1;
  while (levels < 6 && holeMin / (1 << levels) > 6) levels++;
  const pyr = [{ img, hole, w: ww, h: wh }];
  for (let l = 1; l < levels; l++) pyr.push(downsample(pyr[l - 1]));

  // Coarsest level: seed the hole by pushing known colour inward, then refine.
  let cur = pyr[levels - 1];
  seedFill(cur);
  refine(cur, 10);
  // Finer levels: carry the coarse result up, restore the known pixels, refine again.
  for (let l = levels - 2; l >= 0; l--) {
    const next = pyr[l];
    upsampleInto(cur, next);
    refine(next, l === 0 ? 6 : 6, l === 0);
    cur = next;
  }

  // Write back ONLY the masked pixels; the rest of the picture is untouched.
  const out = cur.img;
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    if (!hole[y * ww + x]) continue;
    const s = (y * ww + x) * 3, d = ((wy + y) * W + (wx + x)) * 4;
    data[d] = clamp8(out[s]); data[d + 1] = clamp8(out[s + 1]); data[d + 2] = clamp8(out[s + 2]);
    data[d + 3] = 255;
  }
}

function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

// Half-size the level. A pixel is "hole" downscale only if every pixel it came from
// was, so known colour is never contaminated by the hole on the way down.
function downsample(L) {
  const w = Math.max(4, L.w >> 1), h = Math.max(4, L.h >> 1);
  const img = new Float32Array(w * h * 3), hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0, holes = 0, tot = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = Math.min(L.w - 1, x * 2 + dx), sy = Math.min(L.h - 1, y * 2 + dy);
      const p = sy * L.w + sx; tot++;
      if (L.hole[p]) { holes++; continue; }
      r += L.img[p * 3]; g += L.img[p * 3 + 1]; b += L.img[p * 3 + 2]; n++;
    }
    const d = (y * w + x) * 3;
    if (n) { img[d] = r / n; img[d + 1] = g / n; img[d + 2] = b / n; }
    hole[y * w + x] = holes === tot ? 1 : 0;
  }
  return { img, hole, w, h };
}

// Lift the coarse fill onto the finer level's hole, keeping the finer level's own
// known pixels exactly as they are.
function upsampleInto(lo, hi) {
  for (let y = 0; y < hi.h; y++) for (let x = 0; x < hi.w; x++) {
    const p = y * hi.w + x;
    if (!hi.hole[p]) continue;
    const sx = Math.min(lo.w - 1, x >> 1), sy = Math.min(lo.h - 1, y >> 1);
    const s = (sy * lo.w + sx) * 3, d = p * 3;
    hi.img[d] = lo.img[s]; hi.img[d + 1] = lo.img[s + 1]; hi.img[d + 2] = lo.img[s + 2];
  }
}

// The first guess the coarsest level starts from, and the one thing that decides
// whether a band survives the repair. Each run of hole pixels is bridged ALONG ITS OWN
// ROW, fading from the known pixel that ends the run on the left to the one that
// begins it again on the right. A wall, a rail and a blackboard therefore each
// continue at their own height straight through the gap, and a band that is slightly
// higher on one side than the other slopes evenly across it. Diffusing inward from the
// whole rim instead — the obvious thing to do — pulls the dark band up into the light
// one and leaves the repair looking dented, which is what this replaces.
//
// Rows with known pixels on one side only are extended from that side. Rows with none
// at all (a hole spanning the full width) fall through to the rim diffusion below.
function seedFill(L) {
  const { img, hole, w, h } = L;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!hole[y * w + x]) { x++; continue; }
      let e = x;
      while (e < w && hole[y * w + e]) e++;
      const lp = x > 0 ? y * w + (x - 1) : -1;
      const rp = e < w ? y * w + e : -1;
      if (lp >= 0 || rp >= 0) {
        const a = lp >= 0 ? lp : rp, b = rp >= 0 ? rp : lp;
        for (let i = x; i < e; i++) {
          const t = (i - x + 1) / (e - x + 1);
          for (let k = 0; k < 3; k++) img[(y * w + i) * 3 + k] = img[a * 3 + k] + (img[b * 3 + k] - img[a * 3 + k]) * t;
        }
        for (let i = x; i < e; i++) hole[y * w + i] |= 2;   // mark as seeded
      }
      x = e;
    }
  }
  const seeded = new Uint8Array(hole.length);
  for (let p = 0; p < hole.length; p++) if (hole[p] & 2) { seeded[p] = 1; hole[p] = 1; }
  rimFill(L, seeded);
}

// The fallback for hole pixels no row could reach: repeatedly average each one from
// its already-known or already-seeded neighbours, working inward from the rim.
function rimFill(L, seeded) {
  const { img, hole, w, h } = L;
  const filled = Uint8Array.from(hole, (v, i) => (v && !seeded[i] ? 0 : 1));
  let remaining = 0;
  for (let i = 0; i < hole.length; i++) if (!filled[i]) remaining++;
  if (!remaining) return;
  let guard = 0;
  while (remaining > 0 && guard++ < 4096) {
    const wave = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (filled[p]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!filled[q]) continue;
        r += img[q * 3]; g += img[q * 3 + 1]; b += img[q * 3 + 2]; n++;
      }
      if (n) wave.push([p, r / n, g / n, b / n]);
    }
    if (!wave.length) break;
    for (const [p, r, g, b] of wave) {
      img[p * 3] = r; img[p * 3 + 1] = g; img[p * 3 + 2] = b;
      filled[p] = 1; remaining--;
    }
  }
}

// EM refinement at one level: match, then vote, `iters` times. With `seam` set (the
// finest level), the last vote is also collected for the KNOWN pixels the matched
// patches reach, and used to blend the fill seamlessly into them — see seamCorrect.
function refine(L, iters, seam) {
  const { w, h } = L;
  const R = PATCH >> 1;
  if (w < PATCH + 2 || h < PATCH + 2) return;
  // Patch centres we must fill: every hole pixel (its patch overlaps the hole).
  const targets = [];
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    if (L.hole[y * w + x]) targets.push(y * w + x);
  }
  if (!targets.length) return;
  // Patch centres we may copy FROM: those whose whole patch is outside the hole.
  const ok = new Uint8Array(w * h);
  const srcList = [];
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    let clean = true;
    for (let dy = -R; dy <= R && clean; dy++) for (let dx = -R; dx <= R; dx++) {
      if (L.hole[(y + dy) * w + (x + dx)]) { clean = false; break; }
    }
    if (clean) { ok[y * w + x] = 1; srcList.push(y * w + x); }
  }
  if (!srcList.length) return;

  // Nearest-neighbour field: target patch centre -> source patch centre.
  const nnf = new Int32Array(w * h).fill(-1);
  const cost = new Float64Array(w * h).fill(Infinity);
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1e6) / 1e6; };
  for (const t of targets) {
    const s = srcList[Math.floor(rnd() * srcList.length) % srcList.length];
    nnf[t] = s; cost[t] = patchDist(L, t, s, R, Infinity);
  }

  const maxR = Math.max(w, h);
  for (let it = 0; it < iters; it++) {
    const fwd = it % 2 === 0;
    for (let k = 0; k < targets.length; k++) {
      const t = targets[fwd ? k : targets.length - 1 - k];
      // Propagate: a good match for my neighbour is probably good for me, shifted.
      for (const d of fwd ? [-1, -w] : [1, w]) {
        const nb = t + d;
        if (nb < 0 || nb >= nnf.length || nnf[nb] < 0) continue;
        const cand = nnf[nb] - d;
        const cx = cand % w, cy = (cand - cx) / w;
        if (cx < R || cy < R || cx >= w - R || cy >= h - R || !ok[cand]) continue;
        const dist = patchDist(L, t, cand, R, cost[t]);
        if (dist < cost[t]) { cost[t] = dist; nnf[t] = cand; }
      }
      // Random search in shrinking rings around the current best.
      let rad = maxR;
      const bx = nnf[t] % w, by = (nnf[t] - (nnf[t] % w)) / w;
      while (rad >= 1) {
        const cx = Math.round(bx + (rnd() * 2 - 1) * rad);
        const cy = Math.round(by + (rnd() * 2 - 1) * rad);
        rad = Math.floor(rad / 2);
        if (cx < R || cy < R || cx >= w - R || cy >= h - R) continue;
        const cand = cy * w + cx;
        if (!ok[cand]) continue;
        const dist = patchDist(L, t, cand, R, cost[t]);
        if (dist < cost[t]) { cost[t] = dist; nnf[t] = cand; }
      }
    }
    // Vote: every hole pixel becomes the average of the matched patches covering it.
    // The votes landing on KNOWN pixels just outside the hole are kept too (they are
    // never written into the picture) — they say what the synthesis "would have"
    // painted where the truth is known, which is what seamCorrect needs.
    const last = it === iters - 1;
    const acc = new Float64Array(w * h * 3), wgt = new Float64Array(w * h);
    for (const t of targets) {
      const s = nnf[t];
      if (s < 0) continue;
      const tx = t % w, ty = (t - tx) / w, sx = s % w, sy = (s - sx) / w;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const tp = (ty + dy) * w + (tx + dx);
        if (!L.hole[tp] && !(seam && last)) continue;
        const sp = ((sy + dy) * w + (sx + dx)) * 3;
        acc[tp * 3] += L.img[sp]; acc[tp * 3 + 1] += L.img[sp + 1]; acc[tp * 3 + 2] += L.img[sp + 2];
        wgt[tp] += 1;
      }
    }
    for (let p = 0; p < wgt.length; p++) {
      if (!wgt[p] || !L.hole[p]) continue;
      L.img[p * 3] = acc[p * 3] / wgt[p];
      L.img[p * 3 + 1] = acc[p * 3 + 1] / wgt[p];
      L.img[p * 3 + 2] = acc[p * 3 + 2] / wgt[p];
    }
    if (seam && last) seamCorrect(L, acc, wgt);
  }
}

// Blend the synthesised fill into the picture around it, so no step in tone shows
// where one meets the other. A patch fill can sit a few levels off its surroundings
// — most visibly along an edge of the picture, where the hole has known material on
// only one side to anchor it — and even a small step reads as a rectangle on a flat
// sky.
//
// The synthesis also painted the ring of KNOWN pixels the matched patches reached,
// and there we can see exactly how far off it is: `res = truth - synthesis`. That
// residual is imposed on the hole's rim and diffused inward (a Laplace/membrane
// solve, i.e. Poisson seamless cloning), then added to the fill. The fill keeps all
// its own detail — only its low-frequency level is pulled into agreement with the
// picture, exactly at the rim and smoothly further in.
function seamCorrect(L, acc, wgt) {
  const { w, h, hole, img } = L;
  const N = w * h;
  const corr = new Float32Array(N * 3);
  const fixed = new Uint8Array(N);
  let any = false;
  for (let p = 0; p < N; p++) {
    if (hole[p] || !wgt[p]) continue;
    // A known pixel the synthesis also painted: how far off was it?
    let touches = false;
    const x = p % w, y = (p - x) / w;
    if (x > 0 && hole[p - 1]) touches = true;
    else if (x < w - 1 && hole[p + 1]) touches = true;
    else if (y > 0 && hole[p - w]) touches = true;
    else if (y < h - 1 && hole[p + w]) touches = true;
    if (!touches) continue;
    fixed[p] = 1; any = true;
    for (let k = 0; k < 3; k++) corr[p * 3 + k] = img[p * 3 + k] - acc[p * 3 + k] / wgt[p];
  }
  if (!any) return;
  // Diffuse the rim residual through the hole. Solved coarse-to-fine: the field is
  // smooth by construction, so a few sweeps per scale settle it far faster than
  // thousands of sweeps at full size would.
  const scales = [];
  for (let s = 8; s >= 1; s >>= 1) scales.push(s);
  let prev = null, prevW = 0, prevH = 0;
  for (const s of scales) {
    const sw = Math.max(2, Math.ceil(w / s)), sh = Math.max(2, Math.ceil(h / s));
    const val = new Float32Array(sw * sh * 3), bnd = new Float32Array(sw * sh * 3);
    const nb = new Int32Array(sw * sh), inH = new Uint8Array(sw * sh);
    for (let p = 0; p < N; p++) {
      const x = p % w, y = (p - x) / w;
      const q = Math.min(sh - 1, (y / s) | 0) * sw + Math.min(sw - 1, (x / s) | 0);
      if (fixed[p]) { for (let k = 0; k < 3; k++) bnd[q * 3 + k] += corr[p * 3 + k]; nb[q]++; }
      else if (hole[p]) inH[q] = 1;
    }
    for (let q = 0; q < sw * sh; q++) if (nb[q]) { for (let k = 0; k < 3; k++) { bnd[q * 3 + k] /= nb[q]; val[q * 3 + k] = bnd[q * 3 + k]; } inH[q] = 0; }
    if (prev) {
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const q = y * sw + x;
        if (!inH[q]) continue;
        const px = Math.min(prevW - 1, x >> 1), py = Math.min(prevH - 1, y >> 1);
        for (let k = 0; k < 3; k++) val[q * 3 + k] = prev[(py * prevW + px) * 3 + k];
      }
    }
    for (let it = 0; it < 220; it++) {
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const q = y * sw + x;
        if (!inH[q]) continue;
        for (let k = 0; k < 3; k++) {
          let sum = 0, n = 0;
          if (x > 0) { sum += val[(q - 1) * 3 + k]; n++; }
          if (x < sw - 1) { sum += val[(q + 1) * 3 + k]; n++; }
          if (y > 0) { sum += val[(q - sw) * 3 + k]; n++; }
          if (y < sh - 1) { sum += val[(q + sw) * 3 + k]; n++; }
          if (n) val[q * 3 + k] = sum / n;
        }
      }
    }
    prev = val; prevW = sw; prevH = sh;
  }
  // Apply it. `prev` is the full-resolution field (the last scale is 1).
  for (let p = 0; p < N; p++) {
    if (!hole[p]) continue;
    const x = p % w, y = (p - x) / w;
    const q = Math.min(prevH - 1, y) * prevW + Math.min(prevW - 1, x);
    for (let k = 0; k < 3; k++) img[p * 3 + k] += prev[q * 3 + k];
  }
}

// How badly the patch at source `s` fits the hole patch at target `t`: the sum of
// squared colour differences, plus the travel penalty described at PULL_Y/PULL_X.
// Exits early once the running score can no longer beat the incumbent.
function patchDist(L, t, s, R, best) {
  const w = L.w, img = L.img;
  const tx = t % w, ty = (t - tx) / w, sx = s % w, sy = (s - sx) / w;
  const ox = sx - tx, oy = sy - ty;
  let sum = PULL_Y * oy * oy + PULL_X * ox * ox;
  if (sum >= best) return sum;
  for (let dy = -R; dy <= R; dy++) {
    let tp = ((ty + dy) * w + (tx - R)) * 3, sp = ((sy + dy) * w + (sx - R)) * 3;
    for (let dx = -R; dx <= R; dx++, tp += 3, sp += 3) {
      const a = img[tp] - img[sp], b = img[tp + 1] - img[sp + 1], c = img[tp + 2] - img[sp + 2];
      sum += a * a + b * b + c * c;
    }
    if (sum >= best) return sum;
  }
  return sum;
}

// ---------------------------------------------------------------- entry point

// Take the generator badge off srcPath and write the result to destPath. `boxes`,
// when given, are hand-specified regions from the book's overrides file, used
// INSTEAD of detection (each {x, y, w, h}, in pixels or as 0..1 fractions of the
// picture). Returns the list of boxes cleaned, or null when there was nothing to do
// (no badge, unreadable picture, or `canvas` unavailable).
function stripWatermark(srcPath, destPath, fs, boxes) {
  if (!canvasLib || !/\.(png|jpe?g)$/i.test(destPath)) return null;
  try {
    const img = new canvasLib.Image();
    img.src = fs.readFileSync(srcPath);
    const W = img.width, H = img.height;
    if (!W || !H) return null;
    const c = canvasLib.createCanvas(W, H);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, W, H);

    let found;
    if (boxes && boxes.length) {
      found = boxes.map((b) => ({
        // A box may be given in pixels or as fractions of the picture, so a sidecar
        // written against one copy of a picture still lands on its upscaled twin.
        x: Math.round(b.x <= 1 ? b.x * W : b.x),
        y: Math.round(b.y <= 1 ? b.y * H : b.y),
        w: Math.round(b.w <= 1 ? b.w * W : b.w),
        h: Math.round(b.h <= 1 ? b.h * H : b.h),
      })).filter((b) => b.w > 0 && b.h > 0);
    } else {
      found = findBadges(id.data, W, H);
    }
    if (!found.length) return null;

    // Mask the badges, grown a little: these stamps carry a soft shadow and
    // antialiased edge that would otherwise survive as a halo.
    const mask = new Uint8Array(W * H);
    for (const b of found) {
      const grow = Math.max(3, Math.round(b.h * 0.14));
      const x0 = Math.max(0, b.x - grow), y0 = Math.max(0, b.y - grow);
      const x1 = Math.min(W, b.x + b.w + grow), y1 = Math.min(H, b.y + b.h + grow);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
    }
    inpaint(id.data, W, H, mask);
    ctx.putImageData(id, 0, 0);
    // Keep the file's format: re-encoding a JPEG as PNG under its own name would
    // make Typst fail to decode it.
    const buf = /\.jpe?g$/i.test(destPath)
      ? c.toBuffer("image/jpeg", { quality: 0.96 })
      : c.toBuffer("image/png");
    fs.writeFileSync(destPath, buf);
    return found;
  } catch (_) { return null; }
}

module.exports = { stripWatermark, findBadges, inpaint };
