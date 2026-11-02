// Topic 8 opener: the sign reads "RESTURANT"; repaint that word as "RESTAURANT"
const { loadImage, createCanvas, GlobalFonts } = require('C:/Users/hp/Documents/zeph-typesetting-tool/node_modules/@napi-rs/canvas');
const fs = require('fs');
const [src, out, preview] = process.argv.slice(2);
GlobalFonts.registerFromPath('C:/Windows/Fonts/GOTHICB.TTF', 'GothicB');
(async () => {
  const img = await loadImage(src);
  const W = img.width, H = img.height;
  const c = createCanvas(W, H), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const X0 = 264, X1 = 598, Y0 = 132, Y1 = 185;          // the word, with a small margin
  const d = x.getImageData(0, 0, W, H);
  const px = (X, Y) => { const k = (Y * W + X) * 4; return [d.data[k], d.data[k + 1], d.data[k + 2]]; };
  // fill each column by blending the sign's own pixels just above and below the word
  for (let X = X0; X <= X1; X++) {
    const a = px(X, Y0 - 2), b = px(X, Y1 + 1);
    for (let Y = Y0; Y <= Y1; Y++) {
      const t = (Y - Y0) / (Y1 - Y0), k = (Y * W + X) * 4;
      for (let ch = 0; ch < 3; ch++) d.data[k + ch] = Math.round(a[ch] * (1 - t) + b[ch] * t);
    }
  }
  x.putImageData(d, 0, 0);
  // the new word, on its own layer, scaled to the old word's box (269..593 x 135..181)
  const L = createCanvas(W, H), lx = L.getContext('2d');
  const size = 62;
  lx.font = `${size}px GothicB`;
  const m = lx.measureText('RESTAURANT');
  const capH = m.actualBoundingBoxAscent;
  const sy = 46 / capH, sx = (593 - 269) / m.width;
  lx.save();
  lx.translate(269, 181);
  lx.scale(sx, sy);
  lx.fillStyle = 'rgb(218,215,208)';
  lx.fillText('RESTAURANT', 0, 0);
  lx.restore();
  // soften to the picture's own (upscaled) edge
  x.filter = 'blur(0.7px)';
  x.drawImage(L, 0, 0);
  x.filter = 'none';
  fs.writeFileSync(out, c.toBuffer('image/png'));
  if (preview) { const p = createCanvas(620, 230), pc = p.getContext('2d'); pc.drawImage(c, 0, 20, 620, 230, 0, 0, 620, 230); fs.writeFileSync(preview, p.toBuffer('image/png')); }
  console.log('scale', sx.toFixed(2), sy.toFixed(2));
})();
