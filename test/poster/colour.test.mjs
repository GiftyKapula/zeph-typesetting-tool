import test from "node:test";
import assert from "node:assert/strict";
import { contrast, luminance, dominantColours, meanColour, themesFor, pickTheme, separation, hslToRgb } from "../../tools/poster/lib/colour.mjs";

const px = (list) => { const a = new Uint8ClampedArray(list.length * 4); list.forEach((c, i) => a.set([...c, 255], i * 4)); return a; };
const fill = (c, n) => Array.from({ length: n }, () => c);

test("WCAG contrast: black on white is 21, a colour on itself is 1", () => {
  assert.equal(+contrast("#000000", "#ffffff").toFixed(2), 21);
  assert.equal(+contrast("#336699", "#336699").toFixed(2), 1);
  assert.ok(luminance([255, 255, 255]) > luminance([10, 10, 10]));
});

test("dominant colours: largest cluster first, with its share", () => {
  const blue = [27, 87, 115], yellow = [237, 171, 58];
  const d = dominantColours(px([...fill(blue, 70), ...fill(yellow, 30)]), 3);
  assert.deepEqual(d[0].rgb, blue);
  assert.equal(+d[0].share.toFixed(2), 0.7);
  assert.deepEqual(meanColour(px(fill(blue, 5))), blue);
});

test("a dark blue cover is set on a light background that stands out", () => {
  const cover = { mean: [27, 87, 115], dominant: [{ rgb: [27, 87, 115], share: 0.8 }] };
  const { theme } = pickTheme(cover);
  assert.ok(luminance([0, 0, 0]) <= luminance([...hexRgb(theme.bg1)]));
  assert.ok(contrast(cover.mean, theme.bg1) >= 4, `cover vs background contrast ${contrast(cover.mean, theme.bg1)}`);
});

test("a very pale cover is set on the deep background", () => {
  const cover = { mean: [246, 244, 238], dominant: [{ rgb: [246, 244, 238], share: 0.9 }] };
  assert.equal(pickTheme(cover).theme.name, "deep");
});

test("posterTheme override: a name, an object of colours, an unknown name", () => {
  const cover = { mean: [27, 87, 115], dominant: [{ rgb: [27, 87, 115], share: 1 }] };
  assert.equal(pickTheme(cover, "silver").theme.name, "silver");
  const custom = pickTheme(cover, { bg1: "#ffffff" });
  assert.equal(custom.theme.bg1, "#ffffff");
  assert.equal(custom.theme.name, "custom");
  assert.throws(() => pickTheme(cover, "purple"), /unknown posterTheme/);
});

test("every theme keeps every text readable, whatever the cover colour", () => {
  for (let h = 0; h < 360; h += 30) for (const l of [0.2, 0.5, 0.85]) {
    const rgb = hslToRgb([h, 0.6, l]).map(Math.round);
    const { themes } = themesFor({ mean: rgb, dominant: [{ rgb, share: 1 }] });
    for (const t of Object.values(themes)) {
      assert.ok(contrast(t.ink, t.bg1) >= 4.5 && contrast(t.ink, t.bg2) >= 4.5, `${t.name} ink h${h} l${l}`);
      assert.ok(contrast(t.bandInk, t.band) >= 4.5, `${t.name} band h${h} l${l}`);
      assert.ok(contrast(t.stripInk, t.strip) >= 4.5 && contrast(t.bannerInk, t.accent) >= 4.5, `${t.name} strip/banner`);
      assert.ok(contrast("#ffffff", t.tag) >= 3, `${t.name} tag`);
    }
  }
});

test("separation rewards lightness contrast and distance round the colour wheel", () => {
  const blue = [27, 87, 115];
  assert.ok(separation(blue, "#fbf3e8") > separation(blue, "#1b5773"));
});

function hexRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
