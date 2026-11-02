// Drawing helpers for the ZEPH marketing poster (tools/poster/layout.mjs writes the page).
// Everything is vector: the only pictures on a poster are the book's front cover and the
// ZEPH logo. Sizes are given in absolute lengths by the caller.

// Text that shrinks (never grows) until it fits a width.
#let fit(w, size, min: 6pt, ..args, body) = context {
  let s = size
  while s > min and measure(text(size: s, ..args, body)).width > w { s = s - 0.25pt }
  text(size: s, ..args, body)
}

// Letters set round a circle (the CBC seal), each turned to the curve.
#let arctext(txt, r, a0, a1, size, fill, font, up: true) = {
  let cs = txt.clusters()
  let n = cs.len()
  for (i, c) in cs.enumerate() {
    let a = a0 + (a1 - a0) * (i + 0.5) / n
    place(center + horizon, dx: r * calc.cos(a), dy: r * calc.sin(a),
      rotate(if up { a + 90deg } else { a - 90deg }, text(font: font, size: size, weight: "bold", fill: fill, c)))
  }
}

#let megaphone(s, red, dark, yel) = box(width: s, height: s, {
  for (a, l, y) in ((-38deg, 0.20, 0.30), (-12deg, 0.24, 0.40), (14deg, 0.20, 0.50)) {
    place(dx: s * 0.80, dy: s * y, rotate(a, origin: left + horizon,
      line(length: s * l, stroke: (paint: yel, thickness: s * 0.05, cap: "round"))))
  }
  place(dx: s * 0.26, dy: s * 0.60, rotate(22deg, rect(width: s * 0.11, height: s * 0.30, radius: s * 0.03, fill: dark)))
  place(polygon(fill: red, (s * 0.12, s * 0.38), (s * 0.66, s * 0.10), (s * 0.72, s * 0.80), (s * 0.12, s * 0.60)))
  place(polygon(fill: white.transparentize(70%), (s * 0.14, s * 0.40), (s * 0.62, s * 0.15), (s * 0.63, s * 0.24), (s * 0.14, s * 0.46)))
  place(dx: s * 0.02, dy: s * 0.36, rect(width: s * 0.13, height: s * 0.26, radius: s * 0.05, fill: dark))
  place(dx: s * 0.60, dy: s * 0.06, rotate(-8deg, ellipse(width: s * 0.20, height: s * 0.78, fill: dark, stroke: s * 0.025 + red)))
})

#let cbcSeal(s, blue, paper, font) = box(width: s, height: s, {
  place(circle(radius: s / 2, fill: paper, stroke: s * 0.035 + blue))
  place(dx: s * 0.06, dy: s * 0.06, circle(radius: s * 0.44, stroke: s * 0.012 + blue))
  place(dx: s * 0.21, dy: s * 0.21, circle(radius: s * 0.29, fill: paper, stroke: s * 0.022 + blue))
  arctext("COMPETENCE BASED", s * 0.37, 198deg, 342deg, s * 0.078, blue, font)
  arctext("CURRICULUM", s * 0.37, 146deg, 34deg, s * 0.078, blue, font, up: false)
  for sx in (-1, 1) {
    let star = range(10).map(i => {
      let a = i * 36deg - 90deg
      let r = if calc.rem(i, 2) == 0 { s * 0.032 } else { s * 0.013 }
      (s / 2 + sx * s * 0.405 + r * calc.cos(a), s / 2 + r * calc.sin(a))
    })
    place(polygon(fill: blue, ..star))
  }
  // open book
  place(center + horizon, dy: -s * 0.08, box(width: s * 0.34, height: s * 0.16, {
    place(polygon(fill: blue, (0pt, s * 0.02), (s * 0.16, s * 0.04), (s * 0.17, s * 0.16), (0pt, s * 0.14)))
    place(polygon(fill: blue, (s * 0.34, s * 0.02), (s * 0.18, s * 0.04), (s * 0.17, s * 0.16), (s * 0.34, s * 0.14)))
    for i in range(3) {
      place(dx: s * 0.03, dy: s * (0.05 + i * 0.03), line(length: s * 0.11, stroke: s * 0.008 + paper))
      place(dx: s * 0.20, dy: s * (0.05 + i * 0.03), line(length: s * 0.11, stroke: s * 0.008 + paper))
    }
  }))
  place(center + horizon, dy: s * 0.11, text(font: font, size: s * 0.15, weight: "black", fill: blue, "CBC"))
})

#let tickBadge(s, blue) = box(width: s, height: s, {
  place(circle(radius: s / 2, fill: blue))
  let oct = range(8).map(i => {
    let a = i * 45deg + 22.5deg
    (s / 2 + s * 0.30 * calc.cos(a), s / 2 + s * 0.30 * calc.sin(a))
  })
  place(polygon(fill: white, ..oct))
  place(dx: s * 0.06, dy: s * 0.06, circle(radius: s * 0.44, stroke: s * 0.01 + white.transparentize(50%)))
  let st = (paint: blue, thickness: s * 0.075, cap: "round")
  place(line(start: (s * 0.36, s * 0.51), end: (s * 0.46, s * 0.61), stroke: st))
  place(line(start: (s * 0.46, s * 0.61), end: (s * 0.65, s * 0.40), stroke: st))
})

#let calendarIcon(s, ring, red) = box(width: s, height: s, {
  place(circle(radius: s / 2, fill: ring))
  place(dx: s * 0.25, dy: s * 0.24, rect(width: s * 0.50, height: s * 0.52, radius: s * 0.06, fill: red))
  place(dx: s * 0.29, dy: s * 0.36, rect(width: s * 0.42, height: s * 0.36, radius: s * 0.03, fill: white))
  for r in range(3) { for c in range(4) {
    place(dx: s * (0.315 + c * 0.095), dy: s * (0.39 + r * 0.105), rect(width: s * 0.07, height: s * 0.07, fill: red))
  } }
  place(dx: s * 0.33, dy: s * 0.18, rect(width: s * 0.05, height: s * 0.12, radius: s * 0.02, fill: red.darken(30%)))
  place(dx: s * 0.62, dy: s * 0.18, rect(width: s * 0.05, height: s * 0.12, radius: s * 0.02, fill: red.darken(30%)))
})

#let treeIcon(s) = box(width: s * 0.75, height: s, {
  let g = rgb("#2e8b3a")
  place(dx: s * 0.33, dy: s * 0.84, rect(width: s * 0.09, height: s * 0.14, fill: rgb("#7a4a21")))
  place(polygon(fill: g.darken(15%), (s * 0.375, s * 0.38), (s * 0.70, s * 0.86), (s * 0.05, s * 0.86)))
  place(polygon(fill: g, (s * 0.375, s * 0.22), (s * 0.62, s * 0.62), (s * 0.13, s * 0.62)))
  place(polygon(fill: g.lighten(10%), (s * 0.375, s * 0.08), (s * 0.54, s * 0.40), (s * 0.21, s * 0.40)))
  let star = range(10).map(i => {
    let a = i * 36deg - 90deg
    let r = if calc.rem(i, 2) == 0 { s * 0.09 } else { s * 0.04 }
    (s * 0.375 + r * calc.cos(a), s * 0.08 + r * calc.sin(a))
  })
  place(polygon(fill: rgb("#f6c21a"), ..star))
  for (x, y, c) in ((0.28, 0.52, "#d7262b"), (0.47, 0.70, "#f6c21a"), (0.22, 0.76, "#1f6fe0"), (0.45, 0.33, "#d7262b")) {
    place(dx: s * x, dy: s * y, circle(radius: s * 0.025, fill: rgb(c)))
  }
})

#let giftIcon(s, red, ribbon) = box(width: s, height: s, {
  place(dx: s * 0.12, dy: s * 0.42, rect(width: s * 0.76, height: s * 0.52, fill: red))
  place(dx: s * 0.06, dy: s * 0.30, rect(width: s * 0.88, height: s * 0.16, fill: red.darken(12%)))
  place(dx: s * 0.45, dy: s * 0.30, rect(width: s * 0.10, height: s * 0.64, fill: ribbon))
  place(dx: s * 0.06, dy: s * 0.35, rect(width: s * 0.88, height: s * 0.06, fill: ribbon))
  place(dx: s * 0.22, dy: s * 0.06, rotate(-25deg, ellipse(width: s * 0.30, height: s * 0.20, stroke: s * 0.06 + ribbon)))
  place(dx: s * 0.48, dy: s * 0.06, rotate(25deg, ellipse(width: s * 0.30, height: s * 0.20, stroke: s * 0.06 + ribbon)))
})

#let whatsappIcon(s) = box(width: s, height: s, {
  let g = rgb("#25d366")
  place(polygon(fill: white, (s * 0.10, s * 0.97), (s * 0.18, s * 0.70), (s * 0.36, s * 0.86)))
  place(circle(radius: s / 2, fill: white))
  place(dx: s * 0.07, dy: s * 0.07, circle(radius: s * 0.43, fill: g))
  place(polygon(fill: g, (s * 0.16, s * 0.88), (s * 0.22, s * 0.68), (s * 0.34, s * 0.80)))
  // handset: a curved grip (a quarter-ring round the top-right) with ear and mouth pads
  let (hx, hy, ro, ri) = (s * 0.64, s * 0.36, s * 0.27, s * 0.17)
  let outer = range(13).map(i => { let a = 90deg + i * 7.5deg; (hx + ro * calc.cos(a), hy + ro * calc.sin(a)) })
  let inner = range(13).rev().map(i => { let a = 90deg + i * 7.5deg; (hx + ri * calc.cos(a), hy + ri * calc.sin(a)) })
  place(polygon(fill: white, ..outer, ..inner))
  place(dx: hx - s * 0.03, dy: hy + ri - s * 0.005, rotate(-12deg, rect(width: s * 0.15, height: s * 0.115, radius: s * 0.035, fill: white)))
  place(dx: hx - ro - s * 0.005, dy: hy - s * 0.12, rotate(12deg, rect(width: s * 0.115, height: s * 0.15, radius: s * 0.035, fill: white)))
})

#let globeIcon(s, blue) = box(width: s, height: s, {
  place(circle(radius: s / 2, fill: blue))
  let w = (paint: white, thickness: s * 0.04)
  place(dx: s * 0.2, dy: s * 0.2, circle(radius: s * 0.3, stroke: w))
  place(dx: s * 0.38, dy: s * 0.2, ellipse(width: s * 0.24, height: s * 0.6, stroke: w))
  place(dx: s * 0.2, dy: s * 0.5, line(length: s * 0.6, stroke: w))
  place(dx: s * 0.25, dy: s * 0.36, line(length: s * 0.5, stroke: w))
  place(dx: s * 0.25, dy: s * 0.64, line(length: s * 0.5, stroke: w))
})

// The book as a standing hard-back: soft shadow, page edges on the right, a darker spine
// edge on the left (OUTSIDE the cover). The cover picture is placed at exactly its own
// proportions and nothing is drawn over it. (Only opaque gradients: the PNG rasteriser
// draws see-through gradients as solid.)
#let book(file, w, h, shadow, spine) = box(width: w * 1.06, height: h * 1.03, {
  for i in range(6) {
    let o = (i + 1) * w * 0.012
    place(dx: o, dy: o * 1.1, rect(width: w, height: h, radius: w * 0.02, fill: shadow.transparentize(88%)))
  }
  place(dx: -w * 0.03, dy: h * 0.004, rect(width: w * 0.035, height: h * 0.992, radius: (left: w * 0.012),
    fill: gradient.linear(spine.darken(45%), spine.darken(10%))))
  place(dx: w * 0.035, dy: h * 0.012, rect(width: w * 0.99, height: h * 0.985, radius: (right: w * 0.015),
    fill: gradient.linear(rgb("#f4f1ea"), rgb("#d9d4c8"), angle: 90deg), stroke: 0.4pt + rgb("#bdb6a6")))
  for i in range(5) {
    place(dx: w * (1.0 + i * 0.006), dy: h * 0.02, line(start: (0pt, 0pt), end: (0pt, h * 0.965), stroke: 0.3pt + rgb("#c9c2b2")))
  }
  place(image(file, width: w, height: h, fit: "stretch"))
  place(rect(width: w, height: h, stroke: 0.5pt + shadow.transparentize(40%)))
})
