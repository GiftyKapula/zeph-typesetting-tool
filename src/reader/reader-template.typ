// Supplementary readers and novels: the inside of the book.
// The typesetter (typeset.js) writes `#let R = (...)` (the book's settings) above this file
// and the book's content below it, using only the functions defined here.
//
// Families: "novel" (secondary and adult fiction, serif, indented paragraphs, chapter
// openers with a raised initial), "reader" (primary readers: large sans type, spaced
// paragraphs, big pictures), "poetry" (verse kept line by line).

#let fam = R.family
#let serif = ("Palatino Linotype", "Book Antiqua", "Georgia", "Libertinus Serif")
#let sans = ("Century Gothic", "Segoe UI", "Arial", "Libertinus Serif")
#let bodyfont = if fam == "reader" { sans } else { serif }
#let display = if fam == "reader" { sans } else { serif }
#let accent = R.accent
#let ink = rgb("#1d1a17")
#let soft = rgb("#6b625a")

#let caps(s, size: 0.82em, tracking: 0.12em) = text(size: size, tracking: tracking, upper(s))
// a small diamond-and-rule ornament, built simply so it never breaks
#let orn(width: 30mm, colour: accent) = align(center, box(width: width, height: 2.4mm, {
  place(left + horizon, line(length: width / 2 - 2.4mm, stroke: 0.5pt + colour))
  place(right + horizon, line(length: width / 2 - 2.4mm, stroke: 0.5pt + colour))
  place(center + horizon, rotate(45deg, rect(width: 1.7mm, height: 1.7mm, fill: colour)))
}))

#let in-main = state("in-main", false)
#let chap-title = state("chap-title", "")

// ---------------- page set-up ----------------
#let margins = if R.w < 140mm {
  (inside: 15mm, outside: 12mm, top: 15mm, bottom: 16mm)
} else { (inside: 17mm, outside: 14mm, top: 17mm, bottom: 18mm) }

#set page(
  width: R.w, height: R.h, margin: margins,
  header: context {
    if not in-main.get() { return }
    let pg = here().page()
    let opens = query(<chapmeta>).filter(m => m.location().page() == pg)
    if opens.len() > 0 { return }
    set text(size: 7.6pt, fill: soft, font: bodyfont)
    let even = calc.even(counter(page).get().first())
    // left pages: the author (or the title); right pages: the chapter title (or the book title)
    let t = if even { if R.author != "" { R.author } else { R.running-title } } else { let c = chap-title.get(); if c == "" { R.running-title } else { c } }
    align(center, caps(t, size: 1em, tracking: 0.14em))
  },
  footer: context {
    if not in-main.get() { return }
    set text(size: 8.5pt, fill: soft, font: bodyfont)
    align(center, counter(page).display("1"))
  },
)
#set text(font: bodyfont, size: R.body-size, fill: ink, lang: R.lang, hyphenate: false)
#set par(
  justify: fam != "reader",
  leading: if fam == "reader" { 0.85em } else { 0.62em },
  spacing: if fam == "reader" { 1.05em } else { 0.62em },
  first-line-indent: if fam == "reader" { 0em } else { (amount: 1.3em, all: false) },
)
#show strong: set text(weight: "bold")

// ---------------- front matter ----------------
#let halftitle() = {
  set page(header: none, footer: none)
  v(30%)
  align(center, text(font: display, size: 1.5em, weight: "bold", fill: ink, R.title))
  pagebreak()
  // reverse of the half title stays blank
  pagebreak()
}

#let titlepage() = {
  set page(header: none, footer: none)
  set align(center)
  if R.series.len() > 0 {
    for s in R.series { text(size: 0.85em, style: "italic", fill: soft, s); linebreak() }
  }
  v(1fr)
  text(font: display, size: if fam == "reader" { 2.3em } else { 2.1em }, weight: "bold", fill: ink, R.title)
  if R.subtitle != "" { v(0.5em); text(size: 1.05em, style: "italic", fill: soft, R.subtitle) }
  v(1.2em)
  orn(width: 36mm)
  v(1.2em)
  if R.author != "" { caps(R.author, size: 1.0em, tracking: 0.16em) }
  v(1.4fr)
  if R.logo != none { image(R.logo, width: 15mm) ; v(2mm) }
  text(size: 0.85em, "Zambia Educational Publishing House")
  linebreak()
  text(size: 0.85em, "Lusaka")
  pagebreak()
}

#let imprint(lines) = {
  set page(header: none, footer: none)
  set align(center)
  v(1fr)
  set text(size: 8pt, fill: ink)
  set par(justify: false, leading: 0.5em, spacing: 0.5em, first-line-indent: 0em)
  for l in lines { if l == "" { v(0.6em) } else { l; linebreak() } }
  pagebreak()
}

#let frontsec(title, body) = {
  set page(header: none, footer: none)
  pagebreak(weak: true)
  v(14%)
  if title != "" {
    align(center, text(font: display, size: 1.3em, weight: "bold", fill: ink, title))
    v(0.4em)
    orn(width: 26mm)
    v(1.6em)
  } else { v(18%) }
  body
  pagebreak(weak: true)
}

#let contents() = {
  set page(header: none, footer: none)
  pagebreak(weak: true)
  v(10%)
  align(center, text(font: display, size: 1.3em, weight: "bold", fill: ink, R.contents-title))
  v(0.4em)
  orn(width: 26mm)
  v(1.8em)
  context {
    let ms = query(<chapmeta>)
    set par(justify: false, first-line-indent: 0em, spacing: 0.75em, leading: 0.5em)
    for m in ms {
      let v = m.value
      if v.lbl == "" and v.ttl == "" { continue }
      let pg = counter(page).at(m.location()).first()
      let num = if v.lbl != "" and v.ttl != "" { v.lbl } else { "" }
      let name = if v.ttl != "" { v.ttl } else { v.lbl }
      grid(columns: (if R.contents-num-width > 0mm { R.contents-num-width } else { 0mm }, 1fr, auto), column-gutter: 2mm,
        text(fill: accent, num),
        box(width: 100%, [#name #box(width: 1fr, repeat(text(fill: soft, size: 0.8em, "  .  ")))]),
        text(fill: ink, str(pg)))
    }
  }
  pagebreak(weak: true)
}

#let mainstart() = {
  pagebreak(weak: true)
  in-main.update(true)
  counter(page).update(1)
}

// ---------------- the text ----------------
#let chapter(lbl, ttl) = {
  if R.chapter-newpage { pagebreak(weak: true) } else { v(2.4em, weak: true) }
  chap-title.update(ttl)
  [#metadata((lbl: lbl, ttl: ttl)) <chapmeta>]
  let numeric = lbl.match(regex("^[0-9]{1,3}$|^[IVXLC]{1,6}$")) != none
  if fam == "reader" {
    if R.chapter-newpage { v(4mm) }
    block(width: 100%, below: 1.4em, {
      if lbl != "" { box(fill: accent, radius: 2.5mm, inset: (x: 3mm, y: 1.6mm), text(fill: white, weight: "bold", size: 0.8em, upper(lbl))); v(0.4em) }
      if ttl != "" { text(font: display, weight: "bold", size: 1.55em, fill: ink, ttl) }
    })
  } else {
    if R.chapter-newpage { v(R.h * 0.13) }
    block(width: 100%, below: 2.2em, breakable: false, align(center, {
      if lbl == "" and ttl == "" { orn(width: 40mm) }
      else if numeric and ttl == "" {
        text(font: display, size: 2.9em, fill: accent, lbl)
        v(0.2em); orn(width: 26mm)
      } else {
        if lbl != "" {
          if numeric { text(font: display, size: 2.1em, fill: accent, lbl) } else { caps(lbl, size: 0.85em, tracking: 0.28em) + h(0pt) }
          v(0.5em)
        }
        orn(width: 26mm)
        if ttl != "" { v(0.7em); text(font: display, size: if ttl.len() > 40 { 1.25em } else { 1.5em }, weight: "bold", fill: ink, ttl) }
      }
    }))
  }
}

#let sect(t) = block(width: 100%, above: 1.6em, below: 0.9em, breakable: false,
  if fam == "reader" { text(font: display, weight: "bold", size: 1.12em, fill: accent, t) }
  else { align(center, text(weight: "bold", size: 1.0em, fill: ink, t)) })

// first paragraph of a chapter: a raised initial and the first words in capitals
#let opening(first, word, rest) = {
  if fam == "reader" { par(first-line-indent: 0em, [#first#word#rest]) }
  else {
    par(first-line-indent: 0em, [#text(font: display, size: 2.15em, fill: accent, baseline: 0pt, first)#caps(word, size: 0.86em, tracking: 0.05em)#rest])
  }
}

#let scenebreak() = block(above: 1.1em, below: 1.1em, align(center, text(fill: accent, size: 0.9em, tracking: 0.6em, "* * *")))

#let verse(lines) = block(width: 100%, above: 0.9em, below: 0.9em, breakable: true, {
  set par(justify: false, first-line-indent: 0em, leading: 0.55em, spacing: 0.55em)
  pad(left: if fam == "poetry" { 6mm } else { 10mm }, lines.join(linebreak()))
})

#let centred(lines) = block(width: 100%, above: 0.8em, below: 0.8em, {
  set par(justify: false, first-line-indent: 0em)
  align(center, lines.join(linebreak()))
})

#let rightlines(lines) = block(width: 100%, above: 0.5em, below: 0.8em, {
  set par(justify: false, first-line-indent: 0em)
  align(right, lines.join(linebreak()))
})

#let quoteblock(body) = block(width: 100%, above: 0.8em, below: 0.8em, pad(x: 8mm, {
  set par(first-line-indent: 0em)
  body
}))

#let pic(file, pct, cap) = block(width: 100%, above: 1em, below: 1em, breakable: false, align(center, {
  box(width: pct, image(file, width: 100%))
  if cap != "" { v(0.35em); text(size: 0.86em, style: "italic", fill: soft, cap) }
}))
