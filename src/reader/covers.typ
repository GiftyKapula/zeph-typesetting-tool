// Supplementary readers and novels: the cover sheet (back | spine | front), drawn as ONE
// page that becomes page 1 of the book. typeset.js writes `#let C = (...)` above this file.
//
// Front designs (C.design):
//   "heritage"  traditional: earth field, woven triangle bands, cream title cartouche
//   "classic"   traditional novel: cream paper, double rule frame, centred title
//   "modern"    bold colour field, large sun disc, big sans title
//   "art"       a picture from the book fills the top, title band below
//   "sunrise"   rays over layered hills, title in the sky
//   "mosaic"    kitenge-like pattern all over, title panel across the middle
// Back covers stay plain (publisher rule): ISBN and barcode box, ZEPH logo, "Printed by ...".

#let W = C.w
#let H = C.h
#let B = C.bleed
#let S = C.spine
#let FW = W + B         // front panel width (bleed on the outer edge)
#let FH = H + 2 * B
#let k = W / 148mm      // scale for type sizes
// house fonts: Century Gothic, Arial as the fallback ("serif" kept as a name for the titles)
#let serif = ("Century Gothic", "Arial")
#let sans = ("Century Gothic", "Arial")
#let P = C.primary
#let Q = C.secondary
#let A = C.accent
#let paper = C.paper

#set page(width: 2 * W + S + 2 * B, height: FH, margin: 0pt)
#set text(hyphenate: false)

#let tsize(t, big) = {
  let n = t.len()
  (if n <= 10 { big } else if n <= 18 { big * 0.84 } else if n <= 28 { big * 0.7 } else if n <= 40 { big * 0.6 } else { big * 0.5 }) * k
}
#let caps(s, size: 9pt, tracking: 0.2em, fill: white, font: sans) = text(font: font, size: size * k, tracking: tracking, fill: fill, upper(s))
#let diamond(c, s: 2mm) = rotate(45deg, rect(width: s, height: s, fill: c))
#let rule-orn(width, c) = box(width: width, height: 3mm, {
  place(left + horizon, line(length: width / 2 - 3mm, stroke: 0.6pt + c))
  place(right + horizon, line(length: width / 2 - 3mm, stroke: 0.6pt + c))
  place(center + horizon, diamond(c, s: 2mm))
})
#let logo-mark(width: 13mm) = if C.logo != none { image(C.logo, width: width * k) }

// a band of woven triangles (basket / chitenge motif)
#let tri-band(width, height, c1, c2, c3) = box(width: width, height: height, clip: true, {
  let n = calc.ceil(width / (height * 0.9))
  let tw = width / n
  place(top + left, rect(width: width, height: height, fill: c3))
  for i in range(n) {
    let x = tw * i
    place(top + left, polygon(fill: c1, (x, height), (x + tw / 2, height * 0.08), (x + tw, height)))
    place(top + left, polygon(fill: c2, (x + tw * 0.25, height), (x + tw / 2, height * 0.5), (x + tw * 0.75, height)))
    place(top + left, polygon(fill: c3, (x + tw / 2 - tw * 0.06, height * 0.62), (x + tw / 2, height * 0.5), (x + tw / 2 + tw * 0.06, height * 0.62), (x + tw / 2, height * 0.74)))
  }
  place(top + left, rect(width: width, height: height * 0.08, fill: c2))
})

// ---------------- front designs (each draws in a FW x FH box; the outer edge is on the right) -------
#let title-block(fill: white, sub: white, ruled: A, font: serif, align-to: center) = {
  set align(align-to)
  set par(leading: 0.42em, justify: false)
  text(font: font, weight: "bold", size: tsize(C.title, 46pt), fill: fill, C.title)
  if C.subtitle != "" { v(2.5mm * k); text(font: serif, style: "italic", size: 11pt * k, fill: sub, C.subtitle) }
}

#let front-heritage() = {
  place(top + left, rect(width: FW, height: FH, fill: P))
  place(top + left, tri-band(FW, 26mm * k + B, Q, A, P.darken(25%)))
  place(bottom + left, rotate(180deg, tri-band(FW, 22mm * k + B, Q, A, P.darken(25%))))
  // cartouche
  let cw = W * 0.78
  place(top + left, dx: (FW - cw) / 2 + 0mm, dy: B + 44mm * k, block(width: cw, fill: paper, inset: 3.5mm * k, stroke: 1.4pt + A, {
    block(width: 100%, stroke: 0.5pt + A, inset: (x: 5mm * k, y: 9mm * k), {
      set align(center)
      if C.label != "" { caps(C.label, size: 10pt, fill: P, tracking: 0.3em); v(4mm * k) }
      title-block(fill: P.darken(30%), sub: P, font: serif)
      v(5mm * k)
      rule-orn(34mm * k, A)
      v(4mm * k)
      if C.author != "" { caps(C.author, size: 12pt, fill: rgb("#2b2420"), tracking: 0.18em, font: serif) }
    })
  }))
  place(bottom + center, dy: -(22mm * k + B + 6mm * k), box(fill: paper, inset: 1.8mm * k, radius: 50%, logo-mark(width: 10mm)))
}

#let front-classic() = {
  place(top + left, rect(width: FW, height: FH, fill: paper))
  let ins = B + 7mm * k
  place(top + left, dx: 7mm * k, dy: ins, rect(width: FW - 7mm * k - ins, height: FH - 2 * ins, stroke: 2.4pt + P))
  place(top + left, dx: 9.6mm * k, dy: ins + 2.6mm * k, rect(width: FW - 9.6mm * k - ins - 2.6mm * k, height: FH - 2 * ins - 5.2mm * k, stroke: 0.6pt + P))
  // corner diamonds
  for (x, y) in ((7mm * k, ins), (FW - ins, ins), (7mm * k, FH - ins), (FW - ins, FH - ins)) {
    place(top + left, dx: x - 2.2mm, dy: y - 2.2mm, diamond(A, s: 3.1mm))
  }
  place(top + left, dx: 14mm * k, dy: B + 28mm * k, block(width: FW - 14mm * k - B - 14mm * k, {
    set align(center)
    if C.label != "" { caps(C.label, size: 10pt, fill: A.darken(10%), tracking: 0.32em, font: serif); v(14mm * k) } else { v(18mm * k) }
    title-block(fill: P, sub: P.lighten(10%))
    v(7mm * k)
    rule-orn(40mm * k, A)
    v(7mm * k)
    if C.author != "" { caps(C.author, size: 12.5pt, fill: rgb("#2b2420"), tracking: 0.2em, font: serif) }
  }))
  place(bottom + center, dx: 0mm, dy: -(ins + 8mm * k), logo-mark(width: 12mm))
}

#let front-modern() = {
  place(top + left, rect(width: FW, height: FH, fill: P))
  place(top + left, dx: FW * 0.38, dy: -FH * 0.10, circle(radius: FW * 0.42, fill: A))
  place(top + left, dx: FW * 0.52, dy: FH * 0.02, circle(radius: FW * 0.24, fill: A.lighten(28%)))
  place(top + left, polygon(fill: Q, (0mm, FH * 0.58), (FW, FH * 0.44), (FW, FH * 0.54), (0mm, FH * 0.68)))
  place(top + left, dx: 12mm * k, dy: B + 12mm * k, if C.label != "" { caps(C.label, size: 10pt, fill: white, tracking: 0.3em) })
  place(top + left, dx: 12mm * k, dy: FH * 0.70, block(width: FW - 12mm * k - B - 12mm * k, {
    set par(leading: 0.3em, justify: false)
    text(font: sans, weight: "bold", size: tsize(C.title, 50pt), fill: white, upper(C.title))
    if C.subtitle != "" { v(2mm * k); text(font: sans, size: 11pt * k, fill: white, C.subtitle) }
    v(4mm * k)
    box(width: 18mm * k, height: 1.4mm * k, fill: A)
    v(3mm * k)
    if C.author != "" { caps(C.author, size: 12pt, fill: A.lighten(35%), tracking: 0.16em) }
  }))
  place(bottom + right, dx: -(B + 8mm * k), dy: -(B + 8mm * k), box(fill: white, inset: 1.6mm * k, radius: 50%, logo-mark(width: 9mm)))
}

#let front-art() = {
  let ah = FH * 0.6
  place(top + left, rect(width: FW, height: FH, fill: P))
  place(top + left, box(width: FW, height: ah, clip: true, fill: white, image(C.art, width: FW, height: ah, fit: "cover")))
  place(top + left, dy: ah, rect(width: FW, height: 2.2mm * k, fill: A))
  place(top + left, dx: 11mm * k, dy: B + 9mm * k, if C.label != "" { box(fill: P, inset: (x: 3mm * k, y: 1.8mm * k), radius: 1.5mm, caps(C.label, size: 9pt, fill: white, tracking: 0.26em)) })
  place(top + left, dx: 11mm * k, dy: ah + 10mm * k, block(width: FW - 11mm * k - B - 11mm * k, {
    set par(leading: 0.38em, justify: false)
    text(font: serif, weight: "bold", size: tsize(C.title, 42pt), fill: white, C.title)
    if C.subtitle != "" { v(2mm * k); text(font: serif, style: "italic", size: 11pt * k, fill: white, C.subtitle) }
    v(4mm * k)
    if C.author != "" { caps(C.author, size: 11.5pt, fill: A.lighten(30%), tracking: 0.18em) }
  }))
  place(bottom + right, dx: -(B + 8mm * k), dy: -(B + 8mm * k), box(fill: white, inset: 1.6mm * k, radius: 50%, logo-mark(width: 9mm)))
}

#let front-sunrise() = {
  let hz = FH * 0.66
  place(top + left, rect(width: FW, height: FH, fill: gradient.linear(Q, P, angle: 90deg)))
  // rays
  let cx = FW * 0.55
  for i in range(14) {
    let a1 = 180deg + i * 180deg / 14
    let a2 = a1 + 180deg / 28
    let r = FW * 1.6
    place(top + left, polygon(fill: white.transparentize(88%), (cx, hz), (cx + r * calc.cos(a1), hz + r * calc.sin(a1)), (cx + r * calc.cos(a2), hz + r * calc.sin(a2))))
  }
  place(top + left, dx: cx - FW * 0.17, dy: hz - FW * 0.17, circle(radius: FW * 0.17, fill: A))
  // hills
  let hill(y0, amp, c, phase) = {
    let pts = ((0mm, FH),)
    for i in range(0, 41) {
      let x = FW * i / 40
      pts.push((x, y0 - amp * calc.sin((i / 40) * 360deg * 0.9 + phase)))
    }
    pts.push((FW, FH))
    place(top + left, polygon(fill: c, ..pts))
  }
  hill(hz + 4mm * k, 7mm * k, P.darken(35%), 20deg)
  hill(hz + 18mm * k, 9mm * k, P.darken(55%), 140deg)
  place(top + left, dx: 12mm * k, dy: B + 14mm * k, block(width: FW - 12mm * k - B - 12mm * k, {
    set align(center)
    if C.label != "" { caps(C.label, size: 10pt, fill: white, tracking: 0.32em); v(7mm * k) }
    title-block(fill: white, sub: white)
  }))
  place(bottom + left, dx: 12mm * k, dy: -(B + 14mm * k), block(width: FW - 12mm * k - B - 12mm * k, {
    set align(center)
    if C.author != "" { caps(C.author, size: 12pt, fill: white, tracking: 0.22em, font: serif) }
    v(5mm * k)
    box(fill: white, inset: 1.6mm * k, radius: 50%, logo-mark(width: 9mm))
  }))
}

#let front-mosaic() = {
  place(top + left, rect(width: FW, height: FH, fill: P))
  let cell = 15mm * k
  let nx = calc.ceil(FW / cell) + 1
  let ny = calc.ceil(FH / cell) + 1
  for j in range(ny) {
    for i in range(nx) {
      let x = i * cell - (if calc.odd(j) { cell / 2 } else { 0mm })
      let y = j * cell
      place(top + left, dx: x + cell * 0.1, dy: y + cell * 0.1, circle(radius: cell * 0.4, stroke: 1.1pt + Q, fill: none))
      place(top + left, dx: x + cell * 0.5 - 1.6mm * k, dy: y + cell * 0.5 - 1.6mm * k, rotate(45deg, rect(width: 3.2mm * k, height: 3.2mm * k, fill: A.transparentize(20%))))
    }
  }
  let ph = FH * 0.36
  place(top + left, dy: FH * 0.30, rect(width: FW, height: ph, fill: paper))
  place(top + left, dy: FH * 0.30, rect(width: FW, height: 1.6mm * k, fill: A))
  place(top + left, dy: FH * 0.30 + ph - 1.6mm * k, rect(width: FW, height: 1.6mm * k, fill: A))
  place(top + left, dx: 10mm * k, dy: FH * 0.30 + 8mm * k, block(width: FW - 10mm * k - B - 10mm * k, height: ph - 16mm * k, {
    set align(center + horizon)
    if C.label != "" { caps(C.label, size: 9pt, fill: P, tracking: 0.3em); v(3mm * k) }
    title-block(fill: P.darken(25%), sub: P)
    v(3.5mm * k)
    if C.author != "" { caps(C.author, size: 11.5pt, fill: rgb("#2b2420"), tracking: 0.2em, font: serif) }
  }))
  place(bottom + center, dy: -(B + 9mm * k), box(fill: paper, inset: 1.6mm * k, radius: 50%, logo-mark(width: 9mm)))
}

#let draw-front() = {
  let d = C.design
  if d == "heritage" { front-heritage() }
  else if d == "classic" { front-classic() }
  else if d == "modern" { front-modern() }
  else if d == "art" and C.art != none { front-art() }
  else if d == "mosaic" { front-mosaic() }
  else { front-sunrise() }
}

// ---------------- back (plain) and spine ----------------
#let draw-back() = {
  let BW = W + B
  let field = if C.design == "classic" { paper } else { P }
  let txt = if C.design == "classic" { P } else { white }
  place(top + left, rect(width: BW, height: FH, fill: field))
  if C.design == "heritage" {
    place(top + left, tri-band(BW, 14mm * k + B, Q, A, P.darken(25%)))
    place(bottom + left, rotate(180deg, tri-band(BW, 12mm * k + B, Q, A, P.darken(25%))))
  }
  if C.design == "classic" {
    let ins = B + 7mm * k
    place(top + left, dx: ins, dy: ins, rect(width: BW - ins - 7mm * k, height: FH - 2 * ins, stroke: 2.4pt + P))
  }
  if C.blurb != "" {
    place(top + left, dx: B + 14mm * k, dy: B + 30mm * k, block(width: W - 28mm * k, {
      set par(justify: true, leading: 0.6em)
      text(font: serif, size: 10pt * k, fill: txt, C.blurb)
    }))
  }
  // ISBN / barcode box
  place(bottom + left, dx: B + 14mm * k, dy: -(B + 40mm * k), box(width: 44mm * k, height: 26mm * k, fill: white, radius: 1mm, inset: 2.5mm * k, {
    set align(center)
    text(font: sans, size: 7.5pt * k, fill: black, if C.isbn != "" { "ISBN " + C.isbn } else { "ISBN" })
  }))
  place(bottom + center, dy: -(B + 13mm * k), {
    set align(center)
    box(fill: white, inset: 1.4mm * k, radius: 50%, logo-mark(width: 9mm))
    v(1.6mm * k)
    text(font: sans, size: 7pt * k, fill: txt, "Printed by Zambia Educational Publishing House")
  })
}

#let draw-spine() = {
  if S <= 0mm { return }
  let field = if C.design == "classic" { P } else { P.darken(18%) }
  place(top + left, rect(width: S + 0.6mm, height: FH, fill: field))
  let tsz = calc.min(S * 0.42, 11pt)
  place(top + left, dy: B + 14mm, box(width: S, height: FH - 2 * B - 36mm, align(center + horizon, rotate(90deg, reflow: true, {
    text(font: serif, weight: "bold", size: tsz, fill: white, C.title)
    if C.author != "" { h(6mm); text(font: sans, size: tsz * 0.8, fill: white.transparentize(15%), upper(C.author)) }
  }))))
  place(bottom + left, dy: -(B + 7mm), box(width: S, align(center, if C.logo != none { box(fill: white, inset: 0.6mm, radius: 50%, image(C.logo, width: calc.min(S * 0.7, 9mm))) })))
}

#place(top + left, box(width: W + B, height: FH, clip: true, draw-back()))
#place(top + left, dx: W + B, box(width: S + 0.6mm, height: FH, clip: true, draw-spine()))
#place(top + left, dx: W + B + S, box(width: FW, height: FH, clip: true, draw-front()))
