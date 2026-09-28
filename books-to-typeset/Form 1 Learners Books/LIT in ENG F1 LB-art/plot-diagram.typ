// Freytag plot pyramid for Literature in English Form 1, Unit Three (printed p109).
//
// Replaces a third-party graphic that carried a tiled "ELEMENTS OF FICTION" watermark
// across its header band and seven opaque grey rectangles painted over the definition
// text, so that none of the six stages could actually be read. Upscaling could not help
// it: that bitmap already measured 308 DPI, so it never entered the low-resolution pass,
// and sharpening it would only have sharpened the watermark.
//
// Drawn at the width it is PLACED at in the book (134mm, the B5 text column) so the type
// sizes here are the true printed sizes. A diagram drawn oversized and scaled down lands
// its annotations near 6pt, which is the mistake the first attempt at this made.
// Rendered to PNG at 400 DPI: ~2111px across, well over the 300 DPI floor.
// Re-render from this file rather than editing the bitmap.
#set page(width: 134mm, height: 76mm, margin: 0pt, fill: white)
#set text(font: ("Georgia", "Times New Roman"), fill: rgb("#1a1a1a"))

#let ink = rgb("#1a1a1a")
#let stage(t) = text(size: 11pt, weight: "bold")[#t]
#let defn(w, body) = box(width: w)[#text(size: 8pt, style: "italic", fill: rgb("#4a4a4a"))[#body]]

#block(width: 134mm, height: 76mm)[
  // ---- the pyramid ----
  #place(dx: 11mm, dy: 55mm, line(start: (0mm, 0mm), end: (25mm, 0mm), stroke: 1.6pt + ink))
  #place(dx: 36mm, dy: 55mm, line(start: (0mm, 0mm), end: (37mm, -37mm), stroke: 1.6pt + ink))
  #place(dx: 73mm, dy: 18mm, line(start: (0mm, 0mm), end: (34mm, 37mm), stroke: 1.6pt + ink))
  #place(dx: 107mm, dy: 55mm, line(start: (0mm, 0mm), end: (17mm, 0mm), stroke: 1.6pt + ink))

  // ---- Exposition, below the left flat ----
  #place(dx: 11mm, dy: 56.5mm, stage[Exposition])
  #place(dx: 11mm, dy: 63mm, defn(30mm)[the introduction of the characters and the basic situation])

  // ---- Conflict: kept high and narrow so its five wrapped lines clear both the
  //      Exposition label below it and the arrow drawn to its right.
  #place(dx: 6mm, dy: 25mm, stage[Conflict])
  #place(dx: 6mm, dy: 31.5mm, defn(24mm)[a struggle between opposing forces that drives the action of the story])
  #place(dx: 31mm, dy: 45mm, line(start: (0mm, 0mm), end: (4.5mm, 8mm), stroke: 0.9pt + ink))
  #place(dx: 33.9mm, dy: 51.5mm, rotate(29deg, origin: center, text(size: 8pt, fill: ink)[#sym.triangle.filled.b]))

  // ---- Rising Action: label inside the triangle, definition outside it ----
  #place(dx: 55mm, dy: 42mm, rotate(-45deg, origin: left + horizon, stage[Rising Action]))
  #place(dx: 31mm, dy: 23mm, defn(25mm)[the portion of the story where the conflict increases])

  // ---- Climax: gloss set wide enough to stay on one line and off the label ----
  #place(dx: 66mm, dy: 9.5mm, stage[Climax])
  #place(dx: 56mm, dy: 1.5mm, defn(44mm)[the peak of action and conflict])

  // ---- Falling Action: label right of the line, definition further right ----
  #place(dx: 89mm, dy: 29mm, rotate(47deg, origin: left + horizon, stage[Falling Action]))
  #place(dx: 104mm, dy: 20mm, defn(27mm)[the portion of the story where the conflict decreases])

  // ---- Resolution, below the right flat ----
  #place(dx: 105mm, dy: 56.5mm, stage[Resolution])
  #place(dx: 105mm, dy: 63mm, defn(27mm)[the outcome of the conflict])
]
