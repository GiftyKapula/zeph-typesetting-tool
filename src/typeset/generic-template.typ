// =====================================================================
//  Generic, structure-aware book design for imported .docx files (Typst).
//  All colours/fonts come from the injected theme dict `T` (see themes.js),
//  and `T.variant` ("classic" or "modern") switches the LAYOUT so different
//  books look genuinely different, not just recoloured.
//  Hidden, outlined headings drive a real table of contents.
// =====================================================================

#let curtopic = state("curtopic", "")
#let modern = T.variant == "modern"
#let literary = T.variant == "literary"
#let panel = T.variant == "panel"
#let series = T.variant == "series"
#let science = T.variant == "science"
// "series" (English, flat) and "science" (Physics, boxed) share the ZEPH B5
// house mechanics: page size/margins, running header, tilde footer, roman/arabic
// numbering, designed cover + title page + back cover.
#let serieslike = series or science
// Opt-in callout look. "labcard" (Chemistry) replaces the shared left-stripe box
// with a rounded tinted CARD: a solid title chip + a hexagon (benzene-ring) motif
// and a full hairline border, no side stripe. Empty = the theme's default box.
#let boxstyle = T.at("boxStyle", default: "")
// A small hexagon (benzene ring) used as the chemistry callout motif.
#let hexmark(c, sz: 5.2mm, w: 0.9pt) = polygon.regular(vertices: 6, size: sz,
  fill: none, stroke: w + c)
// Interior accents: Physics ("science") stays blue inside the book (amber is
// reserved for the cover). `iaccent` is the strong accent (header pill, TOC,
// labels, section heads) = indigo; `iaccent2` is the thin "pop" (sub-head rule,
// topic chip, bullets) = electric cyan. Every other theme uses its amber/gold.
#let iaccent = if T.variant == "science" { T.primary } else { T.accent }
#let iaccent2 = if T.variant == "science" { T.cyan } else { T.accent }
// "series" page numbering is driven by the page's NATIVE numbering pattern (set
// to roman for the front matter, arabic for the body, none on cover/title/
// copyright) so the generated outline formats its page numbers to match. This
// bool just gates whether the (tilde-wrapped) number is drawn in the footer.
#let pgvisible = state("pgvisible", false)
// True once we are past the full-bleed cover (so the running header appears on
// the title page and everything after it, but never on the cover).
#let pastcover = state("pastcover", false)
// "series": lessons under each UNIT are numbered "1. …", "2. …" — the numbers
// are baked into the heading text at build time (so they appear in the body AND
// the generated table of contents), not via a render-time counter here.
// vertical room left above a signatory's name (for a hand signature) on the
// Foreword / Preface / Acknowledgements pages.
#let sigspace() = v(12mm, weak: true)
// A signatory block (name / title / organisation) with EVEN spacing between the
// lines — identical in every book. Kept together so it never splits across a page.
#let signature(lines) = {
  block(breakable: false, width: 100%)[
    #set par(spacing: 0pt)
    #for (i, l) in lines.enumerate() {
      // gap scales with the body size (em) so the lines breathe in a large-type primary
      // book (16pt) as well as a 12pt secondary one — a fixed 7pt looked cramped at 16pt.
      block(above: if i > 0 { 0.75em } else { 0pt }, below: 0pt)[
        #text(weight: if l.bold { "bold" } else { "regular" })[#l.text]]
    }
  ]
}

// Register a heading so the real outline (TOC) can find it, but render nothing
// itself — the visible heading is drawn by the functions below.
#show heading: none
#let mark(lvl, body) = heading(level: lvl, outlined: true, numbering: none)[#body]

// CDC 2025 sets a larger body size for young readers (Grade 1 → 18pt, Grade 2-3 →
// 16pt, Grade 4-6 → 14pt; Teacher's Guides and secondary stay 12pt). `fs()` scales a
// pt value that was tuned around a 12pt body so the whole content hierarchy (headings,
// box titles, captions, worked arithmetic) grows in proportion. It is the IDENTITY
// when the body is 12pt, so every non-primary book is byte-for-byte unchanged.
#let bodySize = T.at("bodySize", default: 12pt)
#let fs(x) = x * (bodySize / 12pt)
// Primary books use a fixed, stepped heading hierarchy set by CDC-driven overrides
// (e.g. Grade 2: body 16pt, sub-headings `hSub` 18pt, main headings `hMain` 20pt).
// When unset (Teacher's Guides, secondary), headings fall back to the proportional
// `fs()` size, so those books are unchanged. `hm()` = main heading, `hs()` = sub.
#let hMainO = T.at("hMain", default: none)
#let hSubO = T.at("hSub", default: none)
#let hm(x) = if hMainO != none { hMainO } else { fs(x) }
#let hs(x) = if hSubO != none { hSubO } else { fs(x) }

#let doc(title: "", body) = {
  set document(title: title)
  set text(font: T.bodyFont, size: bodySize, fill: T.ink, lang: "en", hyphenate: T.at("hyphenate", default: true))
  set par(justify: true, leading: 0.66em, first-line-indent: 0pt, spacing: 0.86em, linebreaks: "optimized")
  // The authors set every stand-alone equation flush to the LEFT text margin (not
  // centred) so a reader can scan a working straight down the page. Typst centres
  // block equations by default, so force them left; dispmath then handles the width.
  show math.equation.where(block: true): set align(left)
  // Fractions must READ at body size. Typst renders an inline fraction in "text"
  // style, shrinking the numerator/denominator to script size (~70%) — so "0.2/12"
  // came out visibly smaller than the 12pt prose around it. Force every fraction
  // into DISPLAY style so its numerator and denominator stay full-size and legible
  // for a young reader, whether the fraction sits inline or in a block equation.
  show math.frac: it => math.display(it)
  // Form 2 / Grade 3 carry a taller running header (a tab/pill + a two-line rule),
  // so they need a little more top margin to keep the same breathing room above
  // the header that the other series books have with their single-line header.
  // Chemistry (labcard) intentionally reuses the Grade 2 book's top/bottom page
  // furniture (pill header + tilde footer + tallhdr margins) rather than a custom
  // style, so it matches the other books.
  let tallhdr = serieslike and (T.at("coverStyle", default: "") == "form2" or T.at("coverStyle", default: "") == "grade3" or T.at("coverStyle", default: "") == "grade2" or boxstyle == "labcard")
  set page(
    paper: T.paper,
    margin: if tallhdr { (top: 24mm, bottom: 16mm, x: 17mm) } else if serieslike { (top: 19mm, bottom: 16mm, x: 17mm) } else { (top: 23mm, bottom: 20mm, x: 21mm) },
    header-ascent: if tallhdr { 8mm } else { 30% },
    footer-descent: 30%,
    header: context {
      let visible = if serieslike { pastcover.get() } else { counter(page).get().first() > 1 }
      if visible {
        if serieslike and (T.at("coverStyle", default: "") == "grade3" or T.at("coverStyle", default: "") == "grade2" or boxstyle == "labcard") {
          // GRADE 2/3 playful header: subject in a rounded pill, book tag on the
          // right, over a two-tone rule (a short thick accent segment then a thin
          // primary line) — unique to this book.
          set text(font: T.font, size: 8pt)
          // Pin the internal spacing so the header→rule gap is identical on every
          // page: without this the header inherits the ambient block spacing, which
          // is airier in the front matter than the body and floats the pill higher
          // on the roman pages than on the arabic ones.
          set block(spacing: 0pt)
          set par(spacing: 0pt)
          grid(columns: (auto, 1fr, auto), align: (left + horizon, center, right + horizon),
            box(fill: T.primary, inset: (x: 8pt, y: 2.5pt), radius: 9pt)[
              #text(fill: white, weight: "bold", size: 7.5pt, tracking: 0.5pt)[#upper(T.subject)]],
            [],
            text(style: "italic", weight: "bold", fill: T.primary, size: 8.5pt)[#T.hdrtab])
          v(5pt)
          grid(columns: (16mm, 1fr), rows: 2pt, align: (left + horizon, left + horizon),
            line(length: 100%, stroke: 2.4pt + T.accent),
            line(length: 100%, stroke: 1pt + T.primary))
        } else if serieslike and T.at("coverStyle", default: "") == "form2" {
          // FORM 2 cartographic header: subject in a solid map-tab on the left,
          // the Form tag on the right, capped by a map-border double rule
          // (a thick green line over a thin ochre line) — unique to this book.
          set text(font: T.font, size: 8pt)
          grid(columns: (auto, 1fr, auto), align: (left + horizon, center, right + horizon),
            box(fill: T.primary, inset: (x: 7pt, y: 2.5pt), radius: 2pt)[
              #text(fill: white, weight: "bold", size: 7.5pt, tracking: 0.5pt)[#upper(T.subject)]],
            [],
            text(style: "italic", weight: "bold", fill: T.primary, size: 8.5pt)[#T.hdrtab])
          v(-1pt); line(length: 100%, stroke: 1.5pt + T.primary)
          v(-3.2pt); line(length: 100%, stroke: 0.7pt + T.accent)
        } else if serieslike {
          // serif italic masthead (subject) + a short teal rule + amber Form pill
          set text(font: T.font, size: 8.5pt)
          grid(columns: (1fr, auto), align: (left + horizon, right + horizon),
            text(style: "italic", weight: "bold", fill: T.primary)[#T.hdrleft],
            box(fill: iaccent, inset: (x: 6pt, y: 2.5pt), radius: 3pt)[
              #text(fill: white, style: "italic", weight: "bold", size: 7.5pt)[#T.hdrtab]])
          v(-1pt); line(length: 100%, stroke: 1.1pt + T.primary)
        } else {
          set text(size: 8.5pt, fill: T.primary)
          grid(columns: (1fr, auto),
            align(left)[#smallcaps[#title]],
            align(right)[#smallcaps[#curtopic.get()]])
          v(-3pt); line(length: 100%, stroke: 0.6pt + if modern { T.accent } else { T.primary })
        }
      }
    },
    footer: context {
      if serieslike {
        if pgvisible.get() {
          // counter(page).display() honours the page's native numbering pattern
          // (roman in front matter, arabic in the body)
          align(center)[#text(font: T.bodyFont, size: 9.5pt, fill: T.ink)[#("~")#h(5pt)#counter(page).display()#h(5pt)#("~")]]
        }
      } else {
        set text(size: 8.5pt, fill: T.primary)
        line(length: 100%, stroke: 0.6pt + T.rulec)
        v(-2pt)
        if modern {
          align(center)[#text(weight: "bold")[#counter(page).display()]]
        } else {
          align(center)[#box(fill: T.primary, inset: (x: 8pt, y: 2.5pt), radius: 7pt)[
            #text(fill: white, weight: "bold")[#counter(page).display()]]]
        }
      }
    },
  )
  body
}

// ---- title page (series): the book name repeated, modern sans, with a small
// geometric accent that echoes the cover ----
#let titlepage(lines, byline) = {
  pagebreak(weak: true)
  set text(font: T.displayFont)
  let grade = lines.find(l => "FORM" in upper(l) or "GRADE" in upper(l))
  let booktype = lines.at(lines.len() - 1, default: "Learner's Book")
  let formtxt = if grade != none { let m = grade.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
  // The subject title: if the grade line is "SUBJECT FORM N" use the stripped
  // subject ("PHYSICS"); if the grade line is just "FORM N", the subject sits on
  // its OWN line ("BIOLOGY") — take the first non-eyebrow, non-grade line.
  let gradeSubj = if grade != none { grade.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { "" }
  let name = if gradeSubj != "" { gradeSubj } else {
    let cand = lines.slice(0, calc.max(1, lines.len() - 1)).filter(l =>
      not ("FORM" in upper(l)) and not ("GRADE" in upper(l)) and upper(l).trim() != "SECONDARY EDUCATION ORDINARY LEVEL")
    cand.at(0, default: lines.at(0, default: ""))
  }
  // the eyebrow is the lead line, unless that line is itself the title (carries
  // FORM/GRADE, or equals the subject) — then fall back to the standard descriptor.
  let rawlead = lines.at(0, default: "")
  let lead = if ("FORM" in upper(rawlead)) or ("GRADE" in upper(rawlead)) or (rawlead == name) { "Secondary Education Ordinary Level" } else { rawlead }
  let deepteal = T.primary.darken(30%)
  // corner accents tying back to the cover. For a LIGHT signature (yellow) the
  // form tag uses the signature fill with deep text; for a DARK signature
  // (indigo) it uses the brand fill with white text.
  let triangle = if science { T.primary } else { T.signature }
  let slice = if science { T.accent } else { T.primary }
  let brightcov = T.at("coverStyle", default: "") == "form2" or T.at("coverStyle", default: "") == "grade3" or T.at("coverStyle", default: "") == "grade2"
  let formfill = if science { T.primary } else if brightcov { T.accent } else { T.signature }
  let formtext = if T.at("mono", default: false) { white } else if science { white } else if brightcov { T.primary.darken(12%) } else { deepteal }
  if T.at("coverStyle", default: "") == "grade2" {
    // echo of the Grade 2 "Hero Wave" cover: a slim colour bar topped by an accent
    // stripe (the wave crest), plus a couple of playful dots. Width 184mm (not 176)
    // so the bar full-bleeds to BOTH page edges: at dx -21mm the series 17mm margin
    // would otherwise leave a ~4mm gap on the right (the bars were sized for the
    // classic 21mm margin).
    place(top + left, dx: -21mm, dy: -23mm, rect(width: 184mm, height: 15mm, fill: T.primary))
    place(top + left, dx: -21mm, dy: -23mm + 15mm, rect(width: 184mm, height: 1.8mm, fill: T.accent))
    place(top + right, dx: 20mm, dy: 28mm, circle(radius: 6mm, fill: T.accent.transparentize(30%)))
    place(top + left, dx: 14mm, dy: 42mm, circle(radius: 4mm, fill: T.primary.transparentize(55%)))
  } else if T.at("coverStyle", default: "") == "grade3" {
    // playful echo of the cover: a slim colour bar with a SCALLOPED bottom edge
    // across the top, plus a couple of accent dots.
    place(top + left, dx: -21mm, dy: -23mm, rect(width: 184mm, height: 16mm, fill: T.primary))
    for i in range(0, 13) {
      place(top + left, dx: -21mm + float(i) * 16mm, dy: -23mm + 12mm, circle(radius: 4mm, fill: white))
    }
    place(top + right, dx: 20mm, dy: 26mm, circle(radius: 6mm, fill: T.accent.transparentize(30%)))
    place(top + left, dx: 14mm, dy: 40mm, circle(radius: 4mm, fill: T.primary.transparentize(55%)))
  } else if T.at("coverStyle", default: "") == "form2" {
    // cartographic echo: a slim angled green bar + ochre seam across the top,
    // and a faint contour ring, matching the Form 2 cover.
    place(top + left, dx: -21mm, dy: -23mm, polygon(fill: T.primary, (0mm, 0mm), (184mm, 0mm), (184mm, 15mm), (0mm, 19mm)))
    place(top + left, dx: -21mm, dy: -23mm, polygon(fill: T.accent, (0mm, 19mm), (184mm, 15mm), (184mm, 17mm), (0mm, 21mm)))
    place(top + right, dx: 26mm, dy: 30mm, circle(radius: 30mm, fill: none, stroke: 1pt + T.accent.transparentize(72%)))
    place(top + right, dx: 26mm, dy: 30mm, circle(radius: 20mm, fill: none, stroke: 1pt + T.primary.transparentize(78%)))
  } else {
    place(top + left, dx: -6mm, dy: 8mm, polygon(fill: triangle, (0mm, 0mm), (34mm, 0mm), (0mm, 22mm)))
    place(top + left, dx: -6mm, dy: 8mm, polygon(fill: slice, (0mm, 22mm), (0mm, 30mm), (12mm, 22mm)))
  }
  v(if name.len() > 22 { 30mm } else { 36mm })
  align(center)[
    #set par(justify: false)
    #text(size: 16pt, weight: "bold", fill: T.primary, tracking: 1pt)[#upper(lead)]
    #v(if name.len() > 22 { 16mm } else { 22mm })
    #text(size: if name.len() > 22 { 30pt } else if name.len() > 13 { 38pt } else { 44pt }, weight: "bold", fill: deepteal, hyphenate: false)[#name]
    #if formtxt != "" [ #v(9mm)
      #box(fill: formfill, inset: (x: 13pt, y: 6pt), radius: 4pt)[
        #text(size: 22pt, weight: "bold", fill: formtext, tracking: 1pt)[#upper(formtxt)]] ]
    #v(7mm)
    #text(size: 20pt, weight: "bold", fill: T.primary)[#upper(booktype)]
  ]
  // The author byline flows a FIXED gap below the booktype line rather than sitting at
  // an absolute page offset — a long subject name (e.g. "Food and Nutrition") wraps the
  // title to two lines, which pushes the in-flow booktype text down; an absolutely
  // positioned byline stayed put at its old fixed offset and collided with it. Flowing
  // it keeps the same visual gap regardless of how many lines the title wrapped to.
  if byline.len() > 0 {
    v(20mm)
    align(center)[
      #for a in byline [ #text(size: 13pt, weight: "medium", fill: T.ink)[#a] #v(3.5mm) ]]
  }
  place(top + center, dy: 199mm, block(width: 100%)[#align(center)[
    #box(fill: T.primary, width: 28mm, height: 2.5pt, radius: 1pt)
    #v(4mm)
    #text(size: 12pt, weight: "bold", fill: T.ink)[Zambia Educational Publishing House]
    #v(1mm)
    #text(size: 11pt, fill: T.ink)[Lusaka]]])
  // Turn the running header on only AFTER the title page, so the title page itself
  // (which already carries the big CHEMISTRY / FORM 1 / LEARNER'S BOOK) shows no
  // redundant masthead. The imprint page onward gets the header.
  pastcover.update(true)
  pagebreak(weak: true)
}

// ---- cover page (a designed, layered cover, drawn in Typst) ---------------
// A small decorative "circuit node": a ring with a filled centre + short wires.
#let cnode(x, y, c, r: 2.4mm) = place(top + left, dx: x, dy: y, {
  circle(radius: r, fill: none, stroke: 0.8pt + c)
  place(center + horizon, circle(radius: r * 0.34, fill: c))
})
#let cdot(x, y, c, r: 1.1mm) = place(top + left, dx: x, dy: y, circle(radius: r, fill: c))

#let cover(lines, byline, hero, logo, isbn) = {
  // The cover keeps its OWN palette even when the interior is printed black-and-white:
  // shadow T with the cover colours so every T.primary/accent/… below draws in colour.
  // (For normal books the cover colours default to the body colours, so this is a no-op.)
  let T = (..T, primary: T.covPrimary, primary2: T.covPrimary2, accent: T.covAccent, signature: T.covSignature, cyan: T.covCyan, ink: T.covInk, rulec: T.covRulec)
  let subject = lines.at(0, default: "")
  let grade = if lines.len() > 1 { lines.slice(1).find(l => "GRADE" in upper(l) or "FORM" in upper(l) or "FOMU" in upper(l)) } else { none }
  let booktype = lines.at(lines.len() - 1, default: "Learner's Book")

  // ---------- SERIES cover: yellow-dominant, diagonal/geometric. Teal title +
  // accents on the yellow field, a tilted photo panel, an AUTHORS tag, and teal
  // corner wedges. One cohesive teal is used for the accents. ----------
  if science {
    // ---------- SCIENCE cover (Physics): deep-indigo signature field with
    // concentric "electron orbit" rings, white title, amber FORM tag ----------
    let gl = if ("FORM" in upper(subject)) or ("GRADE" in upper(subject)) { subject } else { grade }
    let formtxt = if gl != none { let m = gl.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
    // The subject title comes from the subject line with any form/grade token
    // stripped (e.g. "PHYSICS FORM 4" -> "PHYSICS"). When the subject and form
    // sit on SEPARATE lines (e.g. "BIOLOGY" + "FORM 4"), stripping leaves the
    // subject intact; fall back to the raw subject if stripping empties it.
    let nm = subject.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim()
    let name = if nm != "" { nm } else { subject }
    let amber = T.accent
    page(margin: 0pt, header: none, footer: none, fill: T.signature, width: 176mm, height: 250mm)[
      #set text(font: T.displayFont)
      // top-right motif: chemistry (flask) keeps the field clean — a single slim
      // amber accent bar under the masthead is drawn later; physics keeps its
      // concentric electron orbits.
      #if T.motif != "flask" [
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 50mm, fill: none, stroke: 1pt + white.transparentize(72%)))
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 37mm, fill: none, stroke: 1pt + white.transparentize(80%)))
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 24mm, fill: none, stroke: 1.4pt + amber.transparentize(25%)))
        #place(top + right, dx: 28mm, dy: -34mm, circle(radius: 2.6mm, fill: amber))
        #place(bottom + left, dx: -36mm, dy: 40mm, circle(radius: 44mm, fill: none, stroke: 1pt + white.transparentize(82%)))
      ]
      // masthead — CENTRED with the SAME rhythm as the English cover (eyebrow,
      // title, an accent rule, the form tag, then the book type). par spacing is
      // zeroed so the explicit #v values fully control the layout.
      #place(top + center, dy: 22mm, block(width: 158mm)[#set par(spacing: 0pt); #align(center)[
        #text(size: 14pt, weight: "bold", fill: amber, tracking: 3pt)[SECONDARY EDUCATION ORDINARY LEVEL]
        #v(6mm)
        // shrink a long subject so it never hyphenates / overflows
        #text(size: if name.len() > 13 { 40pt } else { 54pt }, weight: "bold", fill: white, hyphenate: false)[#name]
        #v(4mm)
        #box(fill: amber, width: 46mm, height: 3pt, radius: 1.5pt)
        #if formtxt != "" [ #v(7mm)
          #box(fill: amber, inset: (x: 13pt, y: 6pt), radius: 4pt)[
            #text(size: 28pt, weight: "bold", fill: T.primary.darken(8%), tracking: 1pt)[#upper(formtxt)]] ]
        #v(5mm)
        #text(size: 18pt, weight: "bold", fill: white)[#upper(booktype)]
      ]])
      // hero photo (straight, white frame) when present; otherwise a central
      // "atom" motif (nucleus + elliptical orbits + electrons) fills the field
      #if hero != none and T.motif == "flask" [
        // CHEMISTRY hero: a clean 3:2 landscape plate in a simple white frame, with a
        // slim amber accent bar sitting just above it. No motif.
        #place(top + center, dy: 104mm, box(width: 148mm, height: 78mm, clip: true, radius: 3pt, stroke: 4pt + white)[
          #image("_media/" + hero.file, width: 100%, height: 78mm, fit: "cover")])
        #place(top + center, dy: 98mm, box(fill: amber, width: 148mm, height: 3pt, radius: 1.5pt))
      ] else if hero != none [
        #place(top + center, dy: 110mm, box(width: 144mm, height: 78mm, clip: true, radius: 2pt, stroke: 3pt + white)[
          #image("_media/" + hero.file, width: 100%, height: 78mm, fit: "cover")])
      ] else if T.motif == "cell" [
        // biology: a stylised CELL — membrane, nucleus + nucleolus, and a few
        // organelles (mitochondria-like ellipses) and free dots.
        #place(top + center, dy: 104mm, box(width: 96mm, height: 72mm)[
          #place(center + horizon, circle(radius: 33mm, fill: white.transparentize(94%), stroke: 1.4pt + white.transparentize(45%)))
          #place(center + horizon, dx: 5mm, dy: -3mm, circle(radius: 12mm, fill: T.cyan.transparentize(55%), stroke: 1.2pt + T.cyan.transparentize(15%)))
          #place(center + horizon, dx: 8mm, dy: -5mm, circle(radius: 3.2mm, fill: white.transparentize(20%)))
          #place(center + horizon, dx: -16mm, dy: 9mm, rotate(25deg, ellipse(width: 13mm, height: 5mm, fill: none, stroke: 1pt + white.transparentize(50%))))
          #place(center + horizon, dx: -11mm, dy: -14mm, rotate(-30deg, ellipse(width: 10mm, height: 4mm, fill: none, stroke: 1pt + white.transparentize(58%))))
          #place(center + horizon, dx: 17mm, dy: 14mm, circle(radius: 2.2mm, fill: amber))
          #place(center + horizon, dx: 19mm, dy: -13mm, circle(radius: 1.6mm, fill: white.transparentize(40%)))
          #place(center + horizon, dx: -21mm, dy: -4mm, circle(radius: 1.4mm, fill: amber.lighten(15%)))
        ])
      ] else if T.motif == "flask" [
        // chemistry: a conical (Erlenmeyer) flask with a rising bubble stream — a
        // clean laboratory identity distinct from the physics orbits and the biology
        // cell. No benzene-ring hexagon (the locked chemistry design drops hexagons
        // everywhere); the flask is centred on the page on its own.
        #place(top + center, dy: 104mm, box(width: 100mm, height: 74mm)[
          // flask body (triangle) + neck, drawn from white strokes
          #place(center + horizon, dx: -9mm, dy: 8mm, polygon(fill: white.transparentize(88%), stroke: 1.6pt + white,
            (0mm, 0mm), (30mm, 0mm), (19mm, -34mm), (11mm, -34mm)))
          // neck walls
          #place(center + horizon, dx: -9mm, dy: 8mm, line(start: (11mm, -34mm), end: (11mm, -44mm), stroke: 1.6pt + white))
          #place(center + horizon, dx: -9mm, dy: 8mm, line(start: (19mm, -34mm), end: (19mm, -44mm), stroke: 1.6pt + white))
          // mouth lip
          #place(center + horizon, dx: -9mm, dy: 8mm, box(width: 12mm, height: 2.4pt, fill: amber, radius: 1pt))
          // liquid line inside the flask
          #place(center + horizon, dx: -9mm, dy: 8mm, line(start: (4mm, -8mm), end: (26mm, -8mm), stroke: 1pt + amber.transparentize(20%)))
          // bubbles rising from the neck
          #place(center + horizon, dx: 6mm, dy: -34mm, circle(radius: 1.8mm, fill: amber))
          #place(center + horizon, dx: 10mm, dy: -42mm, circle(radius: 1.2mm, fill: white.transparentize(20%)))
          #place(center + horizon, dx: 4mm, dy: -48mm, circle(radius: 1mm, fill: amber.lighten(15%)))
        ])
      ] else [
        #place(top + center, dy: 108mm, box(width: 90mm, height: 64mm)[
          #place(center + horizon, ellipse(width: 86mm, height: 30mm, fill: none, stroke: 1.2pt + white.transparentize(40%)))
          #place(center + horizon, rotate(60deg, ellipse(width: 86mm, height: 30mm, fill: none, stroke: 1.2pt + white.transparentize(40%))))
          #place(center + horizon, rotate(-60deg, ellipse(width: 86mm, height: 30mm, fill: none, stroke: 1.2pt + amber.transparentize(20%))))
          #place(center + horizon, circle(radius: 5mm, fill: amber))
          #place(center + horizon, dx: 43mm, circle(radius: 2mm, fill: white))
          #place(center + horizon, dx: -21mm, dy: -23mm, circle(radius: 2mm, fill: white))
          #place(center + horizon, dx: -22mm, dy: 24mm, circle(radius: 2mm, fill: amber.lighten(15%)))
        ])
      ]
      // authors (small, wraps if long), then publisher + logo
      #if byline.len() > 0 [
        #place(top + center, dy: 196mm, block(width: 152mm)[#align(center)[
          #text(size: 9pt, weight: "bold", fill: amber, tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          #v(2mm)
          #text(size: 10.5pt, weight: "medium", fill: white.transparentize(22%))[#byline.join("    •    ")]]])
      ]
      #place(bottom + center, dy: -12mm, align(center)[
        #if logo != none [ #box(fill: white, inset: 4pt, radius: 4pt)[#image("_media/" + logo.file, height: 11mm)] #v(2mm) ]
        #text(size: 10.5pt, weight: "bold", fill: white)[Zambia Educational Publishing House]
      ])
    ]
  } else if series and T.at("coverStyle", default: "") == "form1" {
    // ---------- FORM 1 cover: a younger, friendlier look that is clearly distinct
    // from the Form 4 series cover (rounded colour header band + a straight,
    // thick-framed hero), but keeps the SAME word order: eyebrow -> subject ->
    // FORM tag -> book type -> photo -> authors -> publisher. ----------
    let gl = grade
    let formtxt = if gl != none { let m = gl.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
    let name = if gl != none { gl.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { subject }
    let deep = T.primary.darken(12%)
    page(margin: 0pt, header: none, footer: none, fill: T.signature, width: 176mm, height: 250mm)[
      #set text(font: T.displayFont)
      // playful accent dots scattered on the signature field
      #place(top + left, dx: 14mm, dy: 150mm, circle(radius: 4mm, fill: T.accent.transparentize(35%)))
      #place(top + right, dx: -12mm, dy: 162mm, circle(radius: 6mm, fill: T.primary.transparentize(55%)))
      #place(top + right, dx: -16mm, dy: 232mm, circle(radius: 3mm, fill: T.accent.transparentize(45%)))
      // rounded colour header band carrying the masthead
      #place(top + center, block(width: 176mm, height: 96mm, fill: T.primary,
        radius: (bottom-left: 30mm, bottom-right: 30mm))[
        #set par(spacing: 0pt, justify: false)
        #place(top + center, dy: 17mm, block(width: 150mm)[#align(center)[
          #text(size: 13pt, weight: "bold", fill: white.transparentize(12%), tracking: 3pt)[#upper(subject)]
          #v(6mm)
          #text(size: if name.len() > 13 { 38pt } else { 50pt }, weight: "bold", fill: white, hyphenate: false)[#name]
          #v(4mm)
          #box(fill: T.accent, width: 42mm, height: 3pt, radius: 1.5pt)
          #if formtxt != "" [ #v(6mm)
            #box(fill: T.accent, inset: (x: 14pt, y: 6pt), radius: 20pt)[
              #text(size: 24pt, weight: "bold", fill: white, tracking: 1pt)[#upper(formtxt)]] ]
          #v(4mm)
          #text(size: 16pt, weight: "bold", fill: white.transparentize(8%))[#upper(booktype)]
        ]])
      ])
      // straight, thick-framed hero (soft drop plate behind for depth)
      #if hero != none [
        #place(top + center, dy: 109mm, box(width: 132mm, height: 78mm, radius: 5mm, fill: deep))
        #place(top + center, dy: 106mm, box(width: 132mm, height: 78mm, radius: 5mm, clip: true, stroke: 5pt + white)[
          #image("_media/" + hero.file, width: 100%, height: 78mm, fit: "cover")])
      ] else [
        #place(top + center, dy: 106mm, box(width: 132mm, height: 78mm, radius: 5mm, fill: T.primary, stroke: 5pt + white)[
          #place(center + horizon, circle(radius: 22mm, fill: white.transparentize(88%)))
          #place(center + horizon, dx: 36mm, dy: -18mm, circle(radius: 9mm, fill: T.accent.transparentize(45%)))])
      ]
      // authors
      #if byline.len() > 0 [
        #place(top + center, dy: 197mm, block(width: 160mm)[#align(center)[
          #text(size: 9pt, weight: "bold", fill: T.primary, tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          #v(2mm)
          #text(size: 9.5pt, weight: "bold", fill: deep)[#byline.join("  •  ")]]])
      ]
      // publisher + logo
      #place(bottom + center, dy: -13mm, align(center)[
        #if logo != none [ #box(fill: white, inset: 4pt, radius: 4pt)[#image("_media/" + logo.file, height: 12mm)] #v(2mm) ]
        #text(size: 10.5pt, weight: "bold", fill: T.primary)[Zambia Educational Publishing House]
      ])
    ]
  } else if series and T.at("coverStyle", default: "") == "form2" {
    // ---------- FORM 2 cover: a cartographic "atlas" look, clearly distinct from
    // both the Form 1 (rounded band) and the default series (corner wedges) covers.
    // Map-paper ground, an ANGLED colour header carrying the masthead, faint
    // topographic contour rings, and a straight, double-framed hero. Keeps the
    // SAME word order: eyebrow -> subject -> FORM tag -> book type -> photo ->
    // authors -> publisher. ----------
    let gl = grade
    let formtxt = if gl != none { let m = gl.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
    let name = if gl != none { gl.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { subject }
    let paper = rgb("#f4f1e6")
    let deep = T.primary.darken(12%)
    page(margin: 0pt, header: none, footer: none, fill: paper, width: 176mm, height: 250mm)[
      #set text(font: T.displayFont)
      // faint topographic contour rings, bottom-right (map-elevation motif)
      #place(bottom + right, dx: 34mm, dy: 30mm, circle(radius: 64mm, fill: none, stroke: 1pt + T.accent.transparentize(74%)))
      #place(bottom + right, dx: 34mm, dy: 30mm, circle(radius: 50mm, fill: none, stroke: 1pt + T.accent.transparentize(78%)))
      #place(bottom + right, dx: 34mm, dy: 30mm, circle(radius: 37mm, fill: none, stroke: 1pt + T.primary.transparentize(80%)))
      #place(bottom + right, dx: 34mm, dy: 30mm, circle(radius: 25mm, fill: none, stroke: 1pt + T.primary.transparentize(84%)))
      // angled colour header (diagonal bottom edge) with a thin ochre seam
      #place(top + left, polygon(fill: T.primary, (0mm, 0mm), (176mm, 0mm), (176mm, 86mm), (0mm, 100mm)))
      #place(top + left, polygon(fill: T.accent, (0mm, 100mm), (176mm, 86mm), (176mm, 90.5mm), (0mm, 104.5mm)))
      // masthead, centred within the header band
      #place(top + center, dy: 15mm, block(width: 152mm)[#set par(spacing: 0pt, justify: false); #align(center)[
        #text(size: 13pt, weight: "bold", fill: T.accent, tracking: 3.5pt)[#upper(subject)]
        #v(6mm)
        #text(size: if name.len() > 13 { 38pt } else { 50pt }, weight: "bold", fill: white, hyphenate: false)[#name]
        #v(4mm)
        #box(fill: T.accent, width: 44mm, height: 3pt, radius: 1.5pt)
        #if formtxt != "" [ #v(6mm)
          #box(fill: T.accent, inset: (x: 14pt, y: 6pt), radius: 4pt)[
            #text(size: 24pt, weight: "bold", fill: deep, tracking: 1pt)[#upper(formtxt)]] ]
        #v(4mm)
        #text(size: 16pt, weight: "bold", fill: white.transparentize(6%))[#upper(booktype)]
      ]])
      // straight, double-framed hero (ochre plate behind + white inner frame)
      #if hero != none [
        #place(top + center, dy: 119mm, box(width: 134mm, height: 80mm, radius: 2mm, fill: T.accent))
        #place(top + center, dy: 116mm, box(width: 134mm, height: 80mm, radius: 2mm, clip: true, stroke: 3.5pt + white)[
          #image("_media/" + hero.file, width: 100%, height: 80mm, fit: "cover")])
      ] else [
        #place(top + center, dy: 116mm, box(width: 134mm, height: 80mm, radius: 2mm, fill: T.primary, stroke: 3.5pt + white)[
          #place(center + horizon, circle(radius: 24mm, fill: white.transparentize(90%)))
          #place(center + horizon, dx: 36mm, dy: -20mm, circle(radius: 9mm, fill: T.accent.transparentize(40%)))])
      ]
      // authors
      #if byline.len() > 0 [
        #place(top + center, dy: 202mm, block(width: 160mm)[#align(center)[
          #text(size: 9pt, weight: "bold", fill: T.accent.darken(8%), tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          #v(2mm)
          #text(size: 9.5pt, weight: "bold", fill: deep)[#byline.join("  •  ")]]])
      ]
      // publisher + logo, on a small green plate for grounding
      #place(bottom + center, dy: -12mm, align(center)[
        #if logo != none [ #box(fill: white, inset: 4pt, radius: 4pt)[#image("_media/" + logo.file, height: 12mm)] #v(2mm) ]
        #text(size: 10.5pt, weight: "bold", fill: T.primary)[Zambia Educational Publishing House]
      ])
    ]
  } else if series and T.at("coverStyle", default: "") == "grade2" {
    // ---------- GRADE 2 cover — "HERO WAVE": photo-FORWARD, a full-bleed hero photo
    // an image BELOW it. A wave sweeps down from the colour title panel into a full-
    // bleed photo band, with authors + publisher on the colour footer. A clear break
    // from Grade 3's title-band + framed-photo-card look (no scallop/zigzag). ---------
    let gl = grade
    let formtxt = if gl != none { let m = gl.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
    let name = if gl != none { gl.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { subject }
    // The cover stays in FULL COLOUR even when the interior is greyscale (blackWhite/mono),
    // so use the cover-only colour fields (they equal the theme colours for normal books).
    let primary = T.at("covPrimary", default: T.primary)
    let accent = T.at("covAccent", default: T.accent)
    let deep = primary.darken(12%)
    let wavey(i, n) = 88mm - 8mm * calc.sin((i / n) * 4 * calc.pi * 1rad)
    page(margin: 0pt, header: none, footer: none, fill: primary, width: 176mm, height: 250mm)[
      #set text(font: T.displayFont)
      // full-bleed photo BAND below the title (soft tinted field when absent)
      #if hero != none [
        #place(top + left, dy: 72mm, box(width: 176mm, height: 132mm, clip: true)[
          #image("_media/" + hero.file, width: 100%, height: 132mm, fit: "cover")])
      ] else [
        #place(top + left, dy: 72mm, rect(width: 176mm, height: 132mm, fill: primary.lighten(14%)))
        #place(top + center, dy: 128mm, circle(radius: 26mm, fill: white.transparentize(86%)))
      ]
      // colour title panel with a WAVE bottom edge, sweeping down over the photo top
      #{
        let n = 60
        let pts = ()
        for i in range(0, n + 1) { pts.push((176mm * (i / n), wavey(i, n))) }
        pts.push((176mm, 0mm)); pts.push((0mm, 0mm))
        place(top + left, polygon(fill: primary, ..pts))
      }
      // a slim accent crest riding the wave (on the photo side)
      #{
        let n = 60
        for i in range(0, n) {
          place(top + left, line(start: (176mm * (i / n), wavey(i, n) + 1.6mm), end: (176mm * ((i + 1) / n), wavey(i + 1, n) + 1.6mm), stroke: 2pt + accent))
        }
      }
      // masthead ABOVE the photo (title size steps down as the subject gets longer)
      #place(top + center, dy: 14mm, block(width: 158mm)[#set par(spacing: 0pt, justify: false); #align(center)[
        #text(size: 12pt, weight: "bold", fill: white.transparentize(14%), tracking: 3pt)[#upper(subject)]
        #v(4mm)
        #text(size: if name.len() > 26 { 24pt } else if name.len() > 15 { 30pt } else { 42pt }, weight: "bold", fill: white, hyphenate: false)[#name]
        #v(3mm)
        #box(fill: accent, width: 44mm, height: 3pt, radius: 1.5pt)
        #if formtxt != "" [ #v(5mm)
          #box(fill: accent, inset: (x: 15pt, y: 6pt), radius: 40pt)[
            #text(size: 21pt, weight: "bold", fill: deep, tracking: 1pt)[#upper(formtxt)]] ]
        #v(4mm)
        #text(size: 14pt, weight: "bold", fill: white.transparentize(8%))[#upper(booktype)]
      ]])
      // authors + publisher are BOTTOM-anchored so they never collide with a tall masthead
      #if byline.len() > 0 [
        #place(bottom + center, dy: -33mm, block(width: 162mm)[#align(center)[
          #text(size: 8.5pt, weight: "bold", fill: white.transparentize(45%), tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          #v(1.5mm)
          #text(size: 10pt, weight: "bold", fill: white.transparentize(24%))[#byline.join("   •   ")]]])
      ]
      #place(bottom + center, dy: -9mm, align(center)[
        #if logo != none [ #box(fill: white, inset: 4pt, radius: 4pt)[#image("_media/" + logo.file, height: 11mm)] #v(1.5mm) ]
        #text(size: 10pt, weight: "bold", fill: white)[Zambia Educational Publishing House]
      ])
    ]
  } else if series and T.at("coverStyle", default: "") == "grade2card" {
    // ---------- GRADE 2 cover — "FRAMED CARD": a solid colour field with a single
    // floating rounded CREAM card holding the photo AND the masthead, like a storybook
    // plate, with confetti on the field. Contained and warm — distinct from both Grade
    // 3 and the Hero Wave. ----------
    let gl = grade
    let formtxt = if gl != none { let m = gl.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
    let name = if gl != none { gl.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { subject }
    let paper = rgb("#fffaf1")
    let deep = T.primary.darken(12%)
    page(margin: 0pt, header: none, footer: none, fill: T.primary, width: 176mm, height: 250mm)[
      #set text(font: T.displayFont)
      // confetti on the colour field
      #place(top + left, dx: 12mm, dy: 15mm, circle(radius: 5mm, fill: T.accent.transparentize(18%)))
      #place(top + right, dx: -14mm, dy: 22mm, circle(radius: 3.5mm, fill: white.transparentize(55%)))
      #place(bottom + left, dx: 13mm, dy: -20mm, circle(radius: 6mm, fill: T.accent.transparentize(30%)))
      #place(bottom + right, dx: -16mm, dy: -26mm, circle(radius: 4mm, fill: white.transparentize(50%)))
      // eyebrow above the card
      #place(top + center, dy: 15mm, text(size: 12pt, weight: "bold", fill: white.transparentize(8%), tracking: 3pt)[#upper(subject)])
      // the floating cream card: photo on top, title below
      #place(top + center, dy: 29mm, box(width: 150mm, height: 178mm, radius: 12mm, fill: paper, clip: true)[
        #box(width: 150mm, height: 106mm, clip: true)[
          #if hero != none { image("_media/" + hero.file, width: 100%, height: 106mm, fit: "cover") } else { rect(width: 100%, height: 106mm, fill: T.primary.lighten(10%)) }]
        #block(width: 150mm, inset: (x: 10mm, top: 8mm))[#set par(spacing: 0pt, justify: false); #align(center)[
          #text(size: if name.len() > 15 { 25pt } else { 35pt }, weight: "bold", fill: T.primary, hyphenate: false)[#name]
          #v(3mm)
          #box(fill: T.accent, width: 40mm, height: 3pt, radius: 1.5pt)
          #if formtxt != "" [ #v(4mm)
            #box(fill: T.accent, inset: (x: 13pt, y: 5pt), radius: 40pt)[
              #text(size: 19pt, weight: "bold", fill: deep, tracking: 1pt)[#upper(formtxt)]] ]
          #v(3mm)
          #text(size: 13pt, weight: "bold", fill: T.primary)[#upper(booktype)]
        ]]
      ])
      #if byline.len() > 0 [
        #place(top + center, dy: 211mm, block(width: 160mm)[#align(center)[
          #text(size: 8pt, weight: "bold", fill: white.transparentize(35%), tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          #v(1mm)
          #text(size: 9.5pt, weight: "bold", fill: white)[#byline.join("   •   ")]]])
      ]
      #place(bottom + center, dy: -8mm, align(center)[
        #if logo != none [ #box(fill: white, inset: 3.5pt, radius: 4pt)[#image("_media/" + logo.file, height: 10mm)] #v(1mm) ]
        #text(size: 9.5pt, weight: "bold", fill: white)[Zambia Educational Publishing House]
      ])
    ]
  } else if series and T.at("coverStyle", default: "") == "grade3" {
    // ---------- GRADE 3 cover: a bright, playful primary-school look, clearly
    // distinct from the Form 1/2 and default covers — a colour header band with a
    // SCALLOPED bottom edge, scattered accent dots, and a chunky rounded photo
    // card. Same word order as every cover: eyebrow -> subject -> GRADE tag ->
    // book type -> photo -> authors -> publisher. ----------
    let gl = grade
    let formtxt = if gl != none { let m = gl.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
    let name = if gl != none { gl.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { subject }
    let paper = rgb("#eafafa")
    let deep = T.primary.darken(10%)
    page(margin: 0pt, header: none, footer: none, fill: paper, width: 176mm, height: 250mm)[
      #set text(font: T.displayFont)
      // scattered playful dots on the lower field
      #place(top + left, dx: 13mm, dy: 118mm, circle(radius: 5mm, fill: T.accent.transparentize(28%)))
      #place(top + right, dx: -11mm, dy: 130mm, circle(radius: 7mm, fill: T.primary.transparentize(58%)))
      #place(top + right, dx: -19mm, dy: 214mm, circle(radius: 4mm, fill: T.accent.transparentize(32%)))
      #place(top + left, dx: 19mm, dy: 206mm, circle(radius: 3.2mm, fill: T.primary.transparentize(52%)))
      // colour header band with a SCALLOPED bottom edge (page-colour half-circles)
      #place(top + left, rect(width: 176mm, height: 92mm, fill: T.primary))
      #for i in range(0, 12) {
        place(top + left, dx: (float(i) * 16mm), dy: 84mm, circle(radius: 8mm, fill: paper))
      }
      // masthead within the band
      #place(top + center, dy: 13mm, block(width: 152mm)[#set par(spacing: 0pt, justify: false); #align(center)[
        #text(size: 12.5pt, weight: "bold", fill: white.transparentize(10%), tracking: 3pt)[#upper(subject)]
        #v(5mm)
        #text(size: if name.len() > 13 { 34pt } else { 46pt }, weight: "bold", fill: white, hyphenate: false)[#name]
        #v(3mm)
        #box(fill: T.accent, width: 40mm, height: 3pt, radius: 1.5pt)
        #if formtxt != "" [ #v(5mm)
          #box(fill: T.accent, inset: (x: 14pt, y: 6pt), radius: 20pt)[
            #text(size: 22pt, weight: "bold", fill: deep, tracking: 1pt)[#upper(formtxt)]] ]
        #v(4mm)
        #text(size: 15pt, weight: "bold", fill: white.transparentize(6%))[#upper(booktype)]
      ]])
      // chunky rounded photo card (accent drop-plate behind, thick white frame)
      #if hero != none [
        #place(top + center, dy: 116mm, box(width: 138mm, height: 82mm, radius: 8mm, fill: T.accent))
        #place(top + center, dy: 112mm, box(width: 138mm, height: 82mm, radius: 8mm, clip: true, stroke: 4pt + white)[
          #image("_media/" + hero.file, width: 100%, height: 82mm, fit: "cover")])
      ] else [
        #place(top + center, dy: 112mm, box(width: 138mm, height: 82mm, radius: 8mm, fill: T.primary, stroke: 4pt + white)[
          #place(center + horizon, circle(radius: 24mm, fill: white.transparentize(88%)))
          #place(center + horizon, dx: 38mm, dy: -20mm, circle(radius: 10mm, fill: T.accent.transparentize(35%)))])
      ]
      // authors ("AUTHOR" when there is only one)
      #if byline.len() > 0 [
        #place(top + center, dy: 203mm, block(width: 160mm)[#align(center)[
          #text(size: 9pt, weight: "bold", fill: T.primary, tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          #v(2mm)
          #text(size: 10pt, weight: "bold", fill: deep)[#byline.join("   •   ")]]])
      ]
      // publisher + logo
      #place(bottom + center, dy: -12mm, align(center)[
        #if logo != none [ #box(fill: white, inset: 4pt, radius: 4pt)[#image("_media/" + logo.file, height: 12mm)] #v(2mm) ]
        #text(size: 10.5pt, weight: "bold", fill: T.primary)[Zambia Educational Publishing House]
      ])
    ]
  } else if series {
    let gl = grade
    let formtxt = if gl != none { let m = gl.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
    let name = if gl != none { gl.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { subject }
    let deepteal = T.primary.darken(30%)
    page(margin: 0pt, header: none, footer: none, fill: T.signature, width: 176mm, height: 250mm)[
      #set text(font: T.displayFont)
      // teal corner wedges (one cohesive teal)
      #place(top + left, polygon(fill: T.primary, (176mm, 250mm), (176mm, 197mm), (117mm, 250mm)))
      #place(top + left, polygon(fill: T.primary, (0mm, 250mm), (0mm, 215mm), (41mm, 250mm)))
      // --- masthead, centred (eyebrow enlarged), with the form tag + book type.
      // par spacing is zeroed so the explicit #v values fully control the layout
      // (otherwise inter-paragraph spacing stacks and pushes the book type down).
      #place(top + center, dy: 19mm, block(width: 158mm)[#set par(spacing: 0pt, justify: false); #align(center)[
        #text(size: 14pt, weight: "bold", fill: deepteal, tracking: 3pt)[#upper(subject)]
        #v(6mm)
        // shrink a long subject so it doesn't spread/hyphenate across the cover
        #text(size: if name.len() > 13 { 40pt } else { 54pt }, weight: "bold", fill: deepteal, hyphenate: false)[#name]
        #v(4mm)
        #box(fill: T.primary, width: 46mm, height: 3pt, radius: 1.5pt)
        #if formtxt != "" [ #v(7mm)
          #box(fill: T.primary, inset: (x: 13pt, y: 6pt), radius: 4pt)[
            #text(size: 28pt, weight: "bold", fill: white, tracking: 1pt)[#upper(formtxt)]] ]
        #v(5mm)
        #text(size: 18pt, weight: "bold", fill: deepteal)[#upper(booktype)]
      ]])
      // --- tilted photo panel (a teal plate behind for depth) ---
      #if hero != none [
        #place(top + center, dy: 113mm, rotate(5deg, reflow: false, box(width: 122mm, height: 78mm, radius: 3pt, fill: T.primary)))
        #place(top + center, dy: 113mm, rotate(-4deg, reflow: false, box(width: 122mm, height: 78mm, clip: true, radius: 3pt, stroke: 5pt + white)[
          #image("_media/" + hero.file, width: 100%, height: 78mm, fit: "cover")]))
      ] else [
        // no cover photo: a tasteful decorative plate (not an empty white box)
        #place(top + center, dy: 113mm, rotate(-4deg, reflow: false, box(width: 122mm, height: 78mm, radius: 4pt, fill: T.primary, stroke: 5pt + white)[
          #place(center + horizon, circle(radius: 24mm, fill: white.transparentize(90%)))
          #place(center + horizon, dx: 34mm, dy: -20mm, circle(radius: 10mm, fill: T.accent.transparentize(45%)))
          #place(center + horizon, dx: -32mm, dy: 22mm, circle(radius: 7mm, fill: white.transparentize(85%)))]))
      ]
      // --- authors: an "AUTHORS" label tab sitting on the names tag (tilted) ---
      #if byline.len() > 0 [
        #place(top + center, dy: 196mm, align(center)[
          #text(size: 9pt, weight: "bold", fill: deepteal, tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]])
        #place(top + center, dy: 201mm, rotate(-2deg, reflow: false, box(fill: T.primary, inset: (x: 15pt, y: 8pt), radius: 4pt)[
          #text(fill: white, weight: "bold", size: 12pt, tracking: 0.3pt)[#byline.join("   •   ")]]))
      ]
      // --- publisher + logo, bottom centre (white badge behind the logo) ---
      #place(bottom + center, dy: -13mm, align(center)[
        #if logo != none [ #box(fill: white, inset: 4pt, radius: 4pt)[#image("_media/" + logo.file, height: 12mm)] #v(2mm) ]
        #text(size: 10.5pt, weight: "bold", fill: deepteal)[Zambia Educational Publishing House]
      ])
    ]
  } else if literary {
    page(margin: 0pt, header: none, footer: none, fill: rgb("#f5efe6"))[
      #set text(font: T.font)
      // burgundy masthead with tagline + title
      #place(top + left, block(width: 100%, height: 58mm, fill: T.primary, inset: (x: 18mm))[
        #align(center + horizon)[
          #if T.tagline != "" [ #text(fill: T.accent, size: 10pt, tracking: 5pt)[#smallcaps[#T.tagline]] #v(3.5mm) ]
          #text(fill: white, size: 27pt, weight: "bold")[#subject]
        ]
      ])
      #place(top + left, dy: 58mm, rect(width: 100%, height: 1.6mm, fill: T.accent))
      // framed hero, capped by HEIGHT so its bottom is deterministic and it can
      // never cover the title or the line below it
      #place(top + center, dy: 70mm, box(stroke: 1.2pt + T.accent, inset: 5pt, fill: white)[
        #image("_media/" + hero.file, height: 98mm)])
      // grade + book type, below where the hero ends
      #place(top + center, dy: 182mm, align(center)[
        #box(stroke: (top: 0.6pt + T.accent, bottom: 0.6pt + T.accent), inset: (x: 10pt, y: 5pt))[
          #text(fill: T.primary, size: 15pt, weight: "bold", tracking: 1pt)[
            #if grade != none [#upper(grade)#h(5pt)·#h(5pt)]#upper(booktype)]]
      ])
      // authors + publisher anchored in a bottom burgundy band
      #place(bottom + left, block(width: 100%, fill: T.primary, inset: (x: 16mm, y: 8mm))[
        #set text(fill: white)
        #align(center)[
          #if byline.len() > 0 [
            #text(fill: T.accent, size: 10pt, tracking: 3pt)[#smallcaps[#byline.at(0)]]
            #if byline.len() > 1 [ \ #v(1pt) #text(size: 12.5pt, weight: "bold")[#byline.slice(1).join(", ")] ]
          ]
          #if logo != none [ #v(4mm) #box(fill: white, inset: 4pt, radius: 4pt)[#image("_media/" + logo.file, height: 11mm)] ]
          #v(3mm)
          #text(size: 9pt, fill: white.transparentize(15%))[Zambia Educational Publishing House]
        ]
      ])
    ]
  } else if panel {
    // ---------- PANEL cover: full-bleed hero across the top, title panel below ----------
    page(margin: 0pt, header: none, footer: none, fill: rgb("#f5f1e8"))[
      #set text(font: T.font)
      #place(top + left, box(width: 100%, height: 148mm, clip: true, fill: T.primary)[
        #image("_media/" + hero.file, width: 100%, height: 148mm, fit: "cover")])
      #place(top + left, dy: 148mm, rect(width: 100%, height: 2.4mm, fill: T.accent))
      #place(top + center, dy: 162mm, block(width: 84%)[
        #align(center)[
          #if T.tagline != "" [ #text(fill: T.accent, size: 10pt, tracking: 4pt)[#smallcaps[#T.tagline]] #v(3mm) ]
          #text(fill: T.primary, size: 30pt, weight: "bold")[#subject]
          #if grade != none [ #v(4mm)
            #box(fill: T.primary, inset: (x: 15pt, y: 6pt), radius: 20pt)[
              #text(fill: white, weight: "bold", size: 13pt, tracking: 1pt)[#upper(grade)#h(5pt)·#h(5pt)#upper(booktype)]] ]
        ]
      ])
      #place(bottom + center, dy: -15mm, align(center)[
        #if byline.len() > 0 [
          #let lbl0 = byline.at(0)
          #if upper(lbl0) == lbl0 and lbl0.len() > 5 and byline.len() > 1 [
            #text(fill: T.accent, size: 10pt, tracking: 3pt)[#smallcaps[#lbl0]] \ #v(1pt)
            #text(fill: T.primary, size: 12.5pt, weight: "bold")[#byline.slice(1).join(", ")]
          ] else [
            #text(fill: T.primary, size: 12.5pt, weight: "bold")[#byline.join(", ")]
          ]
        ]
        #if logo != none [ #v(4mm) #box(fill: white, inset: 4pt, radius: 4pt, stroke: 0.5pt + T.rulec)[#image("_media/" + logo.file, height: 11mm)] ]
        #v(2mm)
        #text(fill: T.primary2, size: 9pt)[Zambia Educational Publishing House]
      ])
    ]
  } else {
  let deep = T.primary.darken(34%)
  let glass = white.transparentize(88%)
  page(margin: 0pt, header: none, footer: none,
    fill: gradient.linear(deep, T.primary, T.primary2, angle: 150deg))[
    #set text(fill: white, font: T.font)

    // ---------- background geometry ----------
    #place(top + left, dx: 0pt, dy: 0pt, polygon(fill: white.transparentize(93%),
      (0pt, 0pt), (210mm, 0pt), (210mm, 70mm), (0pt, 120mm)))
    #place(bottom + right, dx: 40mm, dy: 40mm, circle(radius: 70mm, fill: white.transparentize(95%)))
    #place(bottom + left, dx: -38mm, dy: 30mm, circle(radius: 48mm, fill: T.accent.transparentize(86%)))
    // concentric "orbit" rings, top-right
    #place(top + right, dx: 26mm, dy: -30mm, circle(radius: 50mm, fill: none, stroke: 1pt + white.transparentize(72%)))
    #place(top + right, dx: 26mm, dy: -30mm, circle(radius: 37mm, fill: none, stroke: 1pt + white.transparentize(80%)))
    #place(top + right, dx: 26mm, dy: -30mm, circle(radius: 24mm, fill: none, stroke: 1.4pt + T.accent.transparentize(45%)))
    // circuit nodes + dots scattered along the top
    #cnode(20mm, 18mm, T.accent)
    #cnode(150mm, 60mm, white.transparentize(35%), r: 1.9mm)
    #cdot(40mm, 30mm, white.transparentize(40%))
    #cdot(170mm, 40mm, T.accent.transparentize(20%))
    #cdot(28mm, 52mm, white.transparentize(55%))

    // ---------- title block ----------
    #place(top + left, dx: 18mm, dy: 24mm, block(width: 150mm)[
      #if T.tagline != "" [ #text(size: 11pt, weight: "bold", tracking: 6pt, fill: T.accent)[#T.tagline] #v(5mm) ]
      #text(size: 40pt, weight: "bold")[#upper(subject)]
      #v(3mm)
      #box(fill: T.accent, width: 56mm, height: 3.5pt, radius: 2pt)
    ])

    // ---------- hero image in a framed card ----------
    #place(center + horizon, dy: 6mm, block[
      #box(radius: 12pt, clip: true, stroke: 6pt + white, fill: white)[
        #image("_media/" + hero.file, width: 150mm)]
      // small accent tab on the card (theme-specific subject tag)
      #if T.tab != "" [
        #place(top + left, dx: -5mm, dy: -6mm, box(fill: T.accent, inset: (x: 11pt, y: 5pt), radius: 5pt)[
          #text(size: 10pt, weight: "bold", fill: white)[#T.tab]])
      ]
    ])

    // ---------- grade badge ----------
    #if grade != none [
      #place(center + horizon, dx: 58mm, dy: 52mm, {
        circle(radius: 16mm, fill: T.accent, stroke: 3pt + white)
        place(center + horizon, align(center)[
          #text(size: 9pt, weight: "bold", fill: white, tracking: 2pt)[#upper(grade.split(" ").at(0))]
          #v(-3pt)
          #text(size: 26pt, weight: "bold", fill: white)[#grade.split(" ").at(1, default: "")]
        ])
      })
    ]

    // ---------- footer: book type, author, logo, publisher ----------
    #place(bottom + center, dy: -16mm, align(center)[
      #box(fill: white, inset: (x: 20pt, y: 7pt), radius: 22pt)[
        #text(size: 13pt, weight: "bold", fill: T.primary, tracking: 1pt)[#upper(booktype)]]
      #v(6mm)
      #if byline.len() > 0 [
        #text(size: 10pt, tracking: 4pt, fill: T.accent, weight: "bold")[#upper(byline.at(0))]
        #if byline.len() > 1 [ \ #v(1pt) #text(size: 14pt, weight: "bold")[#byline.slice(1).join(", ")] ]
      ]
      #if logo != none [ #v(4mm) #box(fill: white, inset: 5pt, radius: 6pt)[#image("_media/" + logo.file, height: 12mm)] ]
      #v(3mm)
      #text(size: 9pt, fill: white.transparentize(20%))[Zambia Educational Publishing House]
    ])
  ]
  }
}

// ---- back cover (series): the last page, echoing the front cover's geometry.
// The ISBN/barcode are added by the press later, so we only RESERVE a clean
// box for them and otherwise carry the book identity + publisher branding. ----
#let backcover(lines, logo, isbn) = {
  // keep the cover palette even in a black-and-white interior (see cover()).
  let T = (..T, primary: T.covPrimary, primary2: T.covPrimary2, accent: T.covAccent, signature: T.covSignature, cyan: T.covCyan, ink: T.covInk, rulec: T.covRulec)
  let subject = lines.at(0, default: "")
  let grade = lines.find(l => "FORM" in upper(l) or "GRADE" in upper(l))
  let booktype = lines.at(lines.len() - 1, default: "Learner's Book")
  let formtxt = if grade != none { let m = grade.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
  // Subject title: strip the form/grade token off the grade line ("ENGLISH GRADE 2"
  // -> "ENGLISH"). When the subject and the form sit on SEPARATE lines
  // ("MATHEMATICS" + "Form 1") that leaves nothing, so fall back to the first line
  // that is neither a form/grade nor the standard eyebrow. Without this fallback the
  // name came out blank and the "·" separator was left orphaned. Mirrors `cover`.
  let gradeSubj = if grade != none { grade.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { "" }
  let name = if gradeSubj != "" { gradeSubj } else {
    let cand = lines.slice(0, calc.max(1, lines.len() - 1)).filter(l =>
      not ("FORM" in upper(l)) and not ("GRADE" in upper(l)) and upper(l).trim() != "SECONDARY EDUCATION ORDINARY LEVEL")
    cand.at(0, default: lines.at(0, default: ""))
  }
  // The back cover stays in FULL COLOUR even when the interior is greyscale (mono), so use
  // the cover-only colour fields (they equal the theme colours for normal books).
  let primary = T.at("covPrimary", default: T.primary)
  let accent = T.at("covAccent", default: T.accent)
  let signature = T.at("covSignature", default: T.signature)
  let ink = T.at("covInk", default: T.ink)
  let deepteal = primary.darken(30%)
  // on a LIGHT signature (yellow) text is deep brand colour; on a DARK signature
  // (indigo) it is white, with an accent-coloured rule/wedges.
  let onfield = if science { white } else { deepteal }
  let accentc = if science { accent } else { primary }
  let pubsub = if science { white } else { ink }
  let rawsub = lines.at(0, default: "")
  // When line 0 IS the subject (rather than a standard education-level eyebrow) it
  // would otherwise be printed twice — once small and once as the title. Fall back
  // to the education level in that case, as the front cover does.
  let eyebrow = if ("FORM" in upper(rawsub)) or ("GRADE" in upper(rawsub)) or (rawsub == name) { "Secondary Education Ordinary Level" } else { rawsub }
  // signature-colour dominant, mirroring the front.
  page(margin: 0pt, header: none, footer: none, fill: signature, width: 176mm, height: 250mm)[
    #set text(font: T.displayFont)
    // corner wedges
    #place(top + left, polygon(fill: accentc, (0mm, 250mm), (0mm, 197mm), (59mm, 250mm)))
    #place(top + left, polygon(fill: accentc, (176mm, 250mm), (176mm, 215mm), (137mm, 250mm)))
    // book identity
    #place(top + left, dx: 16mm, dy: 20mm, block(width: 144mm)[
      #text(size: 11pt, weight: "bold", fill: onfield, tracking: 1.5pt)[#upper(eyebrow)]
      #v(3mm)
      // Subject and form on ONE line. `box` keeps them unbreakable so the "·"
      // separator can never be orphaned at the start of a wrapped line; if the
      // pair is wider than the block (e.g. a long subject name) it is scaled down
      // to fit rather than allowed to wrap.
      #layout(sz => {
        let ttl = box(text(size: 26pt, weight: "bold", fill: onfield)[#name#if formtxt != "" [ #h(6pt)#text(fill: accentc)[#sym.dot.c]#h(6pt)#upper(formtxt) ]])
        let m = measure(ttl)
        if m.width > sz.width and m.width > 0pt {
          scale(x: sz.width / m.width * 100%, y: sz.width / m.width * 100%, reflow: true, origin: left + horizon, ttl)
        } else { ttl }
      })
      #v(1mm)
      #text(size: 13pt, weight: "bold", fill: onfield)[#upper(booktype)]
      #v(3mm)
      #box(fill: accentc, width: 34mm, height: 2.5pt, radius: 1.5pt)
    ])
    // publisher branding, centred (white badge behind the logo)
    #place(top + center, dy: 120mm, align(center)[
      #if logo != none [ #box(fill: white, inset: 5pt, radius: 5pt)[#image("_media/" + logo.file, height: 20mm)] #v(4mm) ]
      #text(size: 14pt, weight: "bold", fill: onfield)[Zambia Educational Publishing House]
      #v(1mm)
      #text(size: 11pt, fill: pubsub)[Lusaka, Zambia]
    ])
    // ISBN: if known, print it (no barcode); otherwise reserve a clean box for
    // the press to add the ISBN + barcode at print time.
    #if isbn != none [
      #place(bottom + left, dx: 16mm, dy: -20mm, text(size: 11pt, weight: "bold", fill: onfield)[ISBN #isbn])
    ] else [
      #place(bottom + left, dx: 16mm, dy: -22mm, box(width: 52mm, height: 26mm, fill: white, stroke: 0.7pt + luma(60%), radius: 1pt)[
        #align(center + horizon)[#text(size: 8pt, fill: luma(55%))[ISBN & barcode]]])
    ]
  ]
}

// ---- table of contents (real outline; correct page numbers + leaders) ----
#let tableofcontents() = {
  pagebreak(weak: true)
  block(breakable: false)[
    #text(fill: T.primary, size: 20pt, weight: "bold")[#T.toctitle]
    #v(3pt)
    #box(fill: iaccent, width: 60pt, height: 3pt, radius: 1.5pt)]
  v(8pt)
  set par(leading: 0.9em)
  let tgap = T.at("tocGap", default: 10pt)
  show outline.entry: it => { v(5pt, weak: true); upper(it) }
  let tdepth = T.at("tocDepth", default: 2)
  if serieslike {
    show outline.entry.where(level: 1): it => { v(tgap, weak: true); text(fill: iaccent, weight: "bold")[#upper(it)] }
    outline(title: none, depth: tdepth, indent: 1.2em)
  } else {
    show outline.entry.where(level: 1): it => { v(tgap, weak: true); strong(upper(it)) }
    outline(title: none, depth: tdepth, indent: 1.2em)
  }
}

// ---- inline runs ---------------------------------------------------------
// A LEFT-ALIGNED display equation that SHRINKS to fit the text column when it would
// otherwise run past the page margins (long worked lines, big definite-integral
// expansions). The authors lay every stand-alone equation flush to the left text
// margin (not centred) so a reader can scan the working straight down the page, so
// we align left here too. `layout` gives the available width; if the formula is wider
// we scale it down uniformly (keeping aspect ratio) so nothing bleeds into the
// margin. Formulas that already fit are left at full size. A little left inset keeps
// the equation from jamming against the very edge while still reading as left-aligned.
#let dispmath(t) = layout(size => {
  let body = [$ #eval(t, mode: "math") $]
  let m = measure(body)
  if m.width > size.width and m.width > 0pt {
    let f = size.width / m.width
    align(left)[#scale(x: f * 100%, y: f * 100%, reflow: true, origin: left + horizon)[#body]]
  } else {
    align(left)[#body]
  }
})
// Vertical column arithmetic (H T O headers, the addends, a rule, then the answer),
// laid out RIGHT-ALIGNED at full size with tabular figures so the ones/tens/hundreds
// line up — clear for a young learner (replaces the tiny italic fraction-hack math).
// A multi-column word list (e.g. "bug | 6. hobby") the author laid out with spaces.
// Rendered as an aligned grid so the columns line up, which spaces cannot do (Typst
// collapses them). An optional row marker ("1.", "2."…) is a bold left column.
#let colgrid(rows: (), ncol: 2, hasMarker: false, header: none) = {
  let bodycols = if rows.len() > 0 { rows.at(0).cells.len() } else { ncol }
  let cols = if hasMarker { (auto,) + range(bodycols).map(_ => 1fr) } else { range(bodycols).map(_ => 1fr) }
  // A cell often begins with its own number ("6. hobby"). Colour that leading number
  // the SAME primary/bold as the row marker so every number in the grid matches —
  // the rest of the cell stays in body ink.
  let cell(c) = {
    let m = c.match(regex("^(\\(?\\d+[.)])\\s+(.*)$"))
    if m != none [#text(fill: T.primary, weight: "bold")[#m.captures.at(0)] #m.captures.at(1)] else [#c]
  }
  // An optional header row (e.g. "Hundreds Tens Ones" over a place-value chart): one
  // bold label per body column, sitting over the marker-column with a blank so each
  // label lines up with the answers below it.
  let headRow = if header != none {
    let mk = if hasMarker { ([],) } else { () }
    (mk + header.map(h => text(weight: "bold")[#h])).flatten()
  } else { () }
  block(above: 6pt, below: 6pt, width: 100%)[
    #grid(columns: cols, column-gutter: 10pt, row-gutter: 6pt, align: left + top,
      ..headRow,
      ..rows.map(r => {
        let mk = if hasMarker { (text(fill: T.primary, weight: "bold")[#r.marker],) } else { () }
        mk + r.cells.map(c => cell(c))
      }).flatten())
  ]
}
#let colsum(rows, answer, size: fs(15pt)) = block(above: 10pt, below: 10pt, breakable: false)[
  #set text(font: T.bodyFont, size: size, weight: "medium", features: ("tnum",))
  #box(inset: (left: 4pt))[
    // `answer` may be one line (a plain total) or several (expanded-notation addition
    // stacks the expanded sum over the collapsed total) — render each below the rule.
    #let ans = if type(answer) == array { answer } else { (answer,) }
    #table(columns: 1, align: right, stroke: none, inset: (x: 2pt, y: 2.5pt),
      ..rows.map(r => box[#r]),
      table.hline(stroke: 1pt + T.ink),
      ..ans.map(a => box[#a]))
  ]
]
// numbond: a primary-maths "number bond" — a whole number over two parts, joined by
// two strokes (e.g. 15 over 8 and 7). Authors draw these with spaces in Word, which
// collapse when typeset; this renders a clean centred diagram instead.
#let numbond(whole, a, b, size: fs(16pt)) = block(above: 10pt, below: 10pt, breakable: false)[
  #set text(font: T.bodyFont, size: size, weight: "medium", features: ("tnum",))
  #let node(x) = box(width: 28pt, height: 28pt, radius: 14pt, stroke: 1pt + T.ink,
    inset: 0pt, align(center + horizon)[#x])
  #align(center)[
    #stack(dir: ttb, spacing: 2pt,
      node(whole),
      // both branches as ONE symmetric V (path), so place() centres the apex under
      // the whole instead of offsetting each line's bounding box.
      box(width: 44pt, height: 16pt, path(stroke: 1pt + T.ink,
        (0pt, 16pt), (22pt, 0pt), (44pt, 16pt))),
      grid(columns: (auto, auto), column-gutter: 16pt, align: center, node(a), node(b)))
  ]
]
#let seg(s) = {
  // A math segment carries Typst math source (converted from Word's equations);
  // render it as a real formula. display = a LEFT-aligned block equation, with roomy
  // spacing above/below so consecutive equations have breathing space between them.
  if s.at("m", default: false) {
    if s.at("display", default: false) {
      block(width: 100%, above: 9pt, below: 9pt, breakable: false)[#dispmath(s.t)]
    } else {
      eval(s.t, mode: "math")
    }
  } else {
    let w = if s.b { "bold" } else { "regular" }
    let st = if s.it { "italic" } else { "normal" }
    // A fill-in blank is a long run of underscores the author typed for the learner to
    // write on. Underscores carry no break opportunity, so a long run shoots past the
    // text column and off the page margin (reviewers flagged this on many pages), while a
    // full stop or lone underscore left dangling at the end of the run could also land
    // alone on the next line. Both are fixed on the JS side (see zwspBlanks in
    // typeset-docx.js), which inserts U+200B *between* underscores only — never right
    // before the run's last character — so s.t already carries the right break points.
    let src = s.t
    // honour soft line breaks (encoded as "\n")
    let body = src.split("\n").map(p => [#p]).join(linebreak())
    // a run marked monospace (ASCII-art diagrams the author laid out with literal spaces
    // in Word — a proportional font can't hold the columns the manuscript relied on)
    // renders through raw() so every space keeps its exact fixed-width position.
    if s.at("mono", default: false) {
      return if s.c == none { raw(src) } else { text(fill: rgb("#" + s.c))[#raw(src)] }
    }
    // a run rendered in the theme handwriting font (e.g. tracing exercises)
    let hand = s.at("hw", default: false)
    let styled = if hand {
      let sz = fs(20pt)
      if s.c == none { text(weight: w, style: st, font: T.handFont, size: sz)[#body] }
      else { text(weight: w, style: st, fill: rgb("#" + s.c), font: T.handFont, size: sz)[#body] }
    } else {
      if s.c == none { text(weight: w, style: st)[#body] }
      else { text(weight: w, style: st, fill: rgb("#" + s.c))[#body] }
    }
    // a run the author (or an override) marked to underline — apply LAST so the
    // decoration wraps the styled text (Typst's underline() must sit outside text()
    // or the decoration is dropped)
    // evade:false + a small offset so the line ALWAYS draws below descenders —
    // Typst's default (evade:true) lifts the rule to dodge tails, which erased the
    // underline under a lone "g"/"gg" in the phonics word lists (author flagged this).
    if s.at("u", default: false) { underline(evade: false, offset: 0.12em)[#styled] } else { styled }
  }
}
#let segs(ss) = ss.map(seg).join()
// Render a run of segments where any DISPLAY-math segment becomes its own centred
// block instead of being wrapped in a paragraph — a bare block swallowed inside
// par[...] renders empty, which is why equations sitting on their own line came out
// blank. Contiguous inline segments stay in a paragraph. Shared by every text path
// (body paragraphs, box bodies, exercise/assessment questions).
#let flowsegs(ss) = {
  let isdisp(s) = s.at("m", default: false) and s.at("display", default: false)
  if ss.any(isdisp) {
    let buf = ()
    for s in ss {
      if isdisp(s) {
        if buf.len() > 0 { par[#segs(buf)] }
        buf = ()
        seg(s)
      } else { buf.push(s) }
    }
    if buf.len() > 0 { par[#segs(buf)] }
  } else { par[#segs(ss)] }
}
#let para(ss, align: none, drop: false) = {
  if drop and ss.len() > 0 and ss.at(0).at("m", default: false) == false and ss.at(0).t.len() > 0 {
    // Drop capital: lift the first letter of the first run to ~3-line height in the
    // theme primary colour, then flow the rest of the paragraph. Used for the
    // opening of reading passages ("O nce upon a time…") the author asked us to
    // decorate. Only touches the visual first character — semantics unchanged.
    let head = ss.at(0)
    let ch = head.t.slice(0, 1)
    let rest = head.t.slice(1)
    let tail = if ss.len() > 1 { ss.slice(1) } else { () }
    let restSegs = (((:) + head) + (t: rest),) + tail
    block(width: 100%, above: 6pt, below: 6pt)[
      #box(height: fs(30pt), baseline: fs(18pt))[#text(size: fs(38pt), weight: "bold", fill: T.primary, font: T.displayFont)[#ch]]
      #h(2pt)
      #segs(restSegs)
    ]
  }
  else if align == "center" { block(width: 100%)[#std.align(center, par[#segs(ss)])] }
  else if align == "right" { block(width: 100%)[#std.align(right, par[#segs(ss)])] }
  else { flowsegs(ss) }
}
// A list item rendered with the writer's real marker (a) / 1. / i. / •).
#let listitem(ss, marker) = {
  let isbullet = marker == "•"
  grid(columns: (auto, 1fr), column-gutter: 7pt, align: (left + top, left + top),
    text(fill: if isbullet { iaccent2 } else { T.primary }, weight: if isbullet { "regular" } else { "bold" })[#marker],
    par[#segs(ss)])
}
// A worked-solution CONTINUATION line: a stand-alone equation that carries on the
// numbered step above it (e.g. under "1. 2A = …" the next line "2A + D = …"). The
// emitter pads it under the step's marker gutter so the whole working reads as one
// indented block a learner can scan straight down, instead of every line hugging
// the left margin. The left inset also narrows the width dispmath fits into.
#let contmath(ss) = pad(left: 18pt, flowsegs(ss))

// ---- headings ------------------------------------------------------------
#let topicbanner(no, title, full) = {
  pagebreak(weak: true)
  mark(1, full)
  curtopic.update(title)
  // Black-and-white interior: the banner band is near-black, so its accent/cyan eyebrow
  // and number chip (which turn black in mono) would be invisible on it. Lift accent/cyan
  // to a light grey WITHIN the banner so they read on the dark band (the title is already
  // white). No effect in colour — the banner keeps its full palette.
  let T = if T.at("mono", default: false) { (..T, accent: rgb("#dcdcdc"), cyan: rgb("#dcdcdc")) } else { T }
  if science and T.motif == "cell" {
    // BIOLOGY: an emerald card with a circular amber-ringed number badge, a soft
    // "cell" motif in the corner, and an amber baseline — organic and distinct.
    v(2pt)
    block(width: 100%, breakable: false, radius: 9pt, clip: true, fill: T.primary, inset: 0pt)[
      // translucent cell circles, top-right
      #place(top + right, dx: 12mm, dy: -12mm, circle(radius: 16mm, fill: white.transparentize(92%)))
      #place(top + right, dx: 6mm, dy: -4mm, circle(radius: 7mm, fill: white.transparentize(88%)))
      #block(inset: (x: 14pt, y: 12pt), width: 100%)[
        #set par(justify: false)
        #grid(columns: (auto, 1fr), column-gutter: 14pt, align: (horizon, horizon),
          box(width: 46pt, height: 46pt)[
            #place(center + horizon, circle(radius: 22pt, fill: T.primary2, stroke: 2.2pt + T.accent))
            #place(center + horizon, text(fill: white, size: fs(19pt), weight: "bold")[#no])],
          [#text(fill: T.accent, size: fs(8.5pt), weight: "bold", tracking: 5pt)[TOPIC]
           #v(-2pt)
           #text(fill: white, size: hm(17pt), weight: "bold", hyphenate: false)[#title]])
        #v(9pt)
        #line(length: 100%, stroke: 1.5pt + T.accent)
      ]]
    v(9pt)
  } else if science and T.motif == "flask" {
    // CHEMISTRY: a clean amethyst plate — the topic number in an amber chip on the
    // left, an amber "TOPIC" eyebrow over a large white title. No motif.
    v(2pt)
    block(width: 100%, breakable: false, radius: 6pt, fill: T.primary, inset: (x: 14pt, y: 13pt))[
      #set par(justify: false)
      #grid(columns: (auto, 1fr), column-gutter: 14pt, align: (horizon, horizon),
        box(fill: T.accent, inset: (x: 11pt, y: 7pt), radius: 5pt)[
          #text(fill: T.primary.darken(10%), size: fs(22pt), weight: "bold")[#no]],
        [#text(fill: T.accent, size: fs(8.5pt), weight: "bold", tracking: 5pt)[TOPIC]
         #v(-3pt)
         #text(fill: white, size: hm(17pt), weight: "bold", hyphenate: false)[#title]])]
    v(9pt)
  } else if science {
    // PHYSICS: indigo banner, the topic number in an electric-cyan chip, white title
    v(2pt)
    block(width: 100%, breakable: false, radius: 6pt, fill: T.primary, inset: (x: 14pt, y: 12pt))[
      #grid(columns: (auto, 1fr), column-gutter: 14pt, align: (horizon, horizon),
        box(fill: T.cyan, inset: (x: 11pt, y: 7pt), radius: 5pt)[
          #text(fill: T.primary.darken(10%), size: fs(22pt), weight: "bold")[#no]],
        [#text(fill: T.cyan, size: fs(8pt), weight: "bold", tracking: 5pt)[TOPIC]
         #v(-3pt)
         #text(fill: white, size: hm(16pt), weight: "bold")[#title]])]
    v(9pt)
  } else if modern {
    // full-width banner: outlined number + title, accent base rule
    v(2pt)
    block(width: 100%, breakable: false, radius: 6pt, fill: T.primary, inset: (x: 14pt, y: 11pt))[
      #grid(columns: (auto, 1fr), column-gutter: 14pt, align: (horizon, horizon),
        text(fill: T.accent, size: fs(30pt), weight: "bold")[#no],
        [#text(fill: white.transparentize(20%), size: fs(8pt), weight: "bold", tracking: 5pt)[TOPIC]
         #v(-3pt)
         #text(fill: white, size: hm(16pt), weight: "bold")[#title]])]
    v(9pt)
  } else {
    v(2pt)
    block(width: 100%, breakable: false)[
      #grid(columns: (auto, 1fr), column-gutter: 16pt, align: (horizon, horizon),
        box(fill: T.primary, inset: (x: 15pt, y: 11pt), radius: 5pt)[
          #align(center)[#text(fill: T.accent, size: fs(8pt), weight: "bold", tracking: 4pt)[TOPIC]
            #v(-4pt) #text(fill: white, size: fs(24pt), weight: "bold")[#no]]],
        [#text(fill: T.primary, size: hm(16pt), weight: "bold")[#title]
         #v(5pt) #box(fill: T.accent, width: 60pt, height: 3pt, radius: 1.5pt)])]
    v(8pt)
  }
}
// A topic / chapter / front-matter heading: starts its own page. (Sub-topic
// headings below — subhead — flow with the text so short sections don't leave
// near-empty pages.)
#let tocUnitsOnly = T.at("tocUnitsOnly", default: false)
#let isUnitTitle(t) = {
  let u = upper(t)
  u.starts-with("UNIT") or u.starts-with("TOPIC") or u.starts-with("CHAPTER") or u.starts-with("CHIBALU") or u.starts-with("CIPATI")
}
// `brk` (default true) starts the section on a fresh page. Pass brk: false for a
// section that must SHARE a page with what precedes it (e.g. an ACRONYMS list that
// sits directly under the Competences table), so it gets the styled section heading
// but no page break. `outlined` (default true) lists it in the contents.
#let sectionhead(t, brk: true, outlined: true) = {
  if brk { pagebreak(weak: true) }
  // Outline units always; outline front-matter sections only when the TOC is not
  // restricted to units (some books want a units-only contents page).
  if outlined and (isUnitTitle(t) or not tocUnitsOnly) { mark(1, t) }
  curtopic.update(t)
  if boxstyle == "labcard" {
    let u = upper(t)
    let isunit = isUnitTitle(t)
    if isunit {
      // CHEMISTRY topic banner: a clean amethyst plate — an amber label+number
      // eyebrow over a large white title. No motif. Split on the first colon so
      // "TOPIC 1.4: ATOMIC STRUCTURE" becomes eyebrow + title.
      let ci = u.position(":")
      let eyebrow = if ci != none { u.slice(0, ci).trim() } else { "" }
      let name = if ci != none { u.slice(ci + 1).trim() } else { u }
      v(2pt)
      block(width: 100%, breakable: false, radius: 6pt, fill: T.primary, inset: (x: 15pt, y: 13pt))[
        #if eyebrow != "" [ #text(fill: T.accent, size: hs(10.5pt), weight: "bold", tracking: 1.5pt)[#eyebrow] #v(4pt) ]
        #text(fill: white, size: hm(19pt), weight: "bold")[#name]]
      v(10pt)
    } else {
      // front matter (Authors / Foreword / ...): amethyst heading + thin rule
      v(8pt)
      block(breakable: false, width: 100%)[
        #set par(spacing: 0pt)
        #text(fill: T.primary, size: hm(18pt), weight: "bold")[#upper(t)]
        #v(9pt)
        #line(length: 100%, stroke: 0.7pt + T.rulec)]
      v(12pt)
    }
  } else if serieslike {
    let u = upper(t)
    let isunit = isUnitTitle(t)
    if isunit {
      // body unit: a solid teal banner with white caps
      v(2pt)
      block(width: 100%, breakable: false, radius: 6pt, fill: T.primary, inset: (x: 13pt, y: 11pt))[
        #text(fill: white, size: hm(16pt), weight: "bold")[#upper(t)]]
      v(9pt)
    } else {
      // front matter (Authors / Foreword / ...): accent heading + thin rule
      v(6pt)
      block(breakable: false, width: 100%)[
        // zero the paragraph spacing INSIDE the block so the roomy front-matter par
        // spacing (1.9em) can't leak between the title and its rule — otherwise the
        // line floats far below the heading. The v(3pt) alone sets the gap.
        #set par(spacing: 0pt)
        #text(fill: iaccent, size: hm(18pt), weight: "bold")[#upper(t)]
        #v(8pt)
        #line(length: 100%, stroke: 0.6pt + T.rulec)]
      v(7pt)
    }
  } else if literary {
    // centred chapter title flanked by thin gold rules — a literary look
    v(12pt, weak: true)
    align(center, block(breakable: false, width: 100%)[
      #line(length: 22%, stroke: 0.6pt + T.accent)
      #v(4pt)
      #text(fill: T.primary, size: hm(16pt), weight: "bold", tracking: 0.5pt)[#t]
      #v(4pt)
      #line(length: 22%, stroke: 0.6pt + T.accent)
    ])
    v(8pt)
  } else if panel {
    // editorial banner: thin top rule, title, thick accent rule beneath
    v(10pt, weak: true)
    block(breakable: false, width: 100%)[
      #line(length: 100%, stroke: 0.6pt + T.rulec)
      #v(5pt)
      #text(fill: T.primary, size: hm(16pt), weight: "bold")[#t]
      #v(5pt)
      #box(fill: T.accent, width: 100%, height: 3pt)]
    v(7pt)
  } else {
    v(9pt, weak: true)
    block(breakable: false)[
      #text(fill: T.primary, size: hm(16pt), weight: "bold")[#t]
      #v(3pt)
      #box(fill: T.accent, width: 50pt, height: 2.5pt, radius: 1.5pt)]
    v(6pt)
  }
}
#let subhead(t) = {
  // Sub-topics are omitted from a units-only contents page.
  if not tocUnitsOnly { mark(2, t) }
  v(7pt, weak: true)
  if boxstyle == "labcard" {
    // CHEMISTRY sub-topic: a small amber label+number eyebrow, the name below in
    // amethyst bold, over a single thin rule. Split on the first colon.
    v(20pt, weak: true)
    let ci = t.position(":")
    let eyebrow = if ci != none { upper(t.slice(0, ci).trim()) } else { "" }
    let name = if ci != none { t.slice(ci + 1).trim() } else { t }
    block(width: 100%, breakable: false, sticky: true)[
      #set par(spacing: 0pt)
      #set block(spacing: 0pt)
      #if eyebrow != "" [ #text(fill: T.accent.darken(8%), size: hs(9pt), weight: "bold", tracking: 1.2pt)[#eyebrow] ]
      #if eyebrow != "" { v(8pt) }
      #text(fill: T.primary, size: hs(15pt), weight: "bold")[#name]
      #v(6pt)
      #line(length: 100%, stroke: 0.8pt + T.rulec)]
  } else if serieslike {
    // a lesson heading (already numbered "1. …" at build time) — generous space
    // before it, and `sticky` so a heading never strands at the foot of a page
    v(22pt, weak: true)
    block(width: 100%, breakable: false, sticky: true)[
      #text(fill: T.primary, size: hs(14pt), weight: "bold")[#upper(t)]
      #v(2pt)
      #box(fill: iaccent2, width: 34pt, height: 2.5pt, radius: 1pt)]
  } else if literary {
    // small diamond + italic serif title, with a thin gold rule under it
    block(width: 100%, breakable: false)[
      #grid(columns: (auto, 1fr), column-gutter: 7pt, align: (horizon, horizon),
        rotate(45deg, rect(fill: T.accent, width: 4pt, height: 4pt)),
        text(fill: T.primary, size: hs(14pt), weight: "bold", style: "italic")[#t])
      #v(2pt)
      #line(length: 100%, stroke: 0.5pt + T.accent.lighten(12%))]
  } else if panel {
    // a solid colour "chip", sized to the text
    block(breakable: false)[
      #box(fill: T.primary, inset: (x: 10pt, y: 5pt), radius: 4pt)[
        #text(fill: white, size: hs(14pt), weight: "bold")[#t]]]
  } else if modern {
    block(width: 100%, breakable: false, radius: 4pt, fill: T.act.fill, stroke: (left: 5pt + T.accent), inset: (x: 11pt, y: 8pt))[
      #text(fill: T.primary, size: hs(14pt), weight: "bold")[#t]]
  } else {
    block(width: 100%, breakable: false, clip: true, radius: 3pt, stroke: (left: 5pt + T.accent), fill: T.primary, inset: (x: 11pt, y: 8pt))[
      #text(fill: white, size: hs(14pt), weight: "bold")[#t]]
  }
  v(5pt)
}
#let head(t, al: none, black: false, col: none) = {
  if serieslike { v(13pt, weak: true) } else { v(5pt) }
  let body = if serieslike {
    // activities/exercises in teal, other bold sub-subheads in ink (like the ref);
    // sticky so the heading stays with the content that follows it. `black` forces the
    // accent-coloured activity/exercise heads to ink; `col` overrides the fill outright
    // (used to give TOPIC/SUB-TOPIC heads a specific blend colour per book).
    let u = upper(t)
    let isact = (u.starts-with("ACTIVITY") or u.starts-with("EXERCISE") or u.starts-with("TASK") or u.starts-with("PROJECT") or u.starts-with("DISCUSSION")) and not black
    block(breakable: false, sticky: true)[#text(fill: if col != none { rgb("#" + col) } else if isact { T.primary } else { T.ink }, size: hs(14pt), weight: "bold")[#t]]
  } else if literary {
    block(breakable: false)[#text(fill: T.primary, size: hs(13pt), weight: "bold", style: "italic")[#t]]
  } else if panel {
    block(breakable: false)[
      #grid(columns: (7pt, auto), column-gutter: 7pt, align: (horizon, horizon),
        rect(fill: T.accent, width: 7pt, height: 7pt, radius: 1pt),
        text(fill: T.primary, size: hs(13pt), weight: "bold")[#t])]
  } else if modern {
    block(breakable: false)[
      #text(fill: T.primary, size: hs(13pt), weight: "bold")[#t]
      #v(1pt)
      #line(length: 38pt, stroke: 2pt + T.accent)]
  } else {
    block(breakable: false)[
      #grid(columns: (4pt, auto), column-gutter: 7pt,
        rect(fill: T.primary2, width: 4pt, height: 14pt, radius: 1pt),
        text(fill: T.primary, size: hs(13pt), weight: "bold")[#t])]
  }
  // a heading the author asked to centre (e.g. a reading passage / picture title)
  if al == "center" { std.align(center)[#body] } else { body }
  v(2pt)
}
#let lbl(t, col: none) = { v(2pt); let c = if col != none { rgb("#" + col) } else { none }; if serieslike { text(weight: "bold", size: fs(10pt), fill: if c != none { c } else { iaccent }, tracking: 0.5pt)[#upper(t)] } else { text(weight: "bold", size: fs(12pt), fill: if c != none { c } else { T.primary2 })[#t] }; v(1pt) }

// ---- boxes ---------------------------------------------------------------
// modern:   light fill + thick accent LEFT stripe.
// classic:  full thin border, title inline.
// literary: a coloured HEADER BAR with the title, body on a light tint.
// Callout boxes are BREAKABLE by default: a long box (a Learning Activity, an
// end-of-topic assessment, an exercise…) flows across a page boundary instead of
// overflowing the bottom margin (which clips/jumbles the text). Pass
// `breakable: false` only for a short box that must stay whole.
#let titledbox(title, kind, content, breakable: true) = {
  if boxstyle == "labcard" {
    // Chemistry callout: a clean rounded card. A solid full-width title band in the
    // kind colour caps the card (white title); the body sits on a light tint below.
    // No side stripe, no motif — quiet and professional.
    block(width: 100%, breakable: breakable, radius: 6pt, clip: true,
          stroke: 0.8pt + kind.border.transparentize(35%))[
      #block(width: 100%, sticky: true, fill: kind.border, inset: (x: 14pt, y: 8pt), below: 0pt)[
        #text(fill: white, weight: "bold", size: hs(12.5pt), tracking: 0.3pt)[#title]]
      #block(width: 100%, breakable: breakable, fill: kind.fill, inset: (x: 14pt, y: 12pt))[#content]]
  } else if serieslike {
    // a light tinted panel with a coloured left stripe (used for any residual
    // boxed content / key points / reference tables in the flowing series layout)
    block(width: 100%, breakable: breakable, radius: 4pt, fill: kind.fill, stroke: (left: 4pt + kind.border), inset: (x: 11pt, y: 9pt))[
      #block(sticky: true, below: 7pt)[#text(fill: kind.title, weight: "bold", size: hs(14pt))[#title]]
      #content]
  } else if panel {
    // filled panel (no border) with a thick accent rule under the title
    block(width: 100%, breakable: breakable, radius: 4pt, fill: kind.fill, inset: (x: 11pt, y: 9pt))[
      #text(fill: kind.title, weight: "bold", size: hs(13pt))[#title]
      #v(4pt)
      #line(length: 100%, stroke: 2pt + kind.border)
      #v(5pt)
      #content]
  } else if literary {
    block(width: 100%, breakable: breakable, radius: 2pt, clip: true, stroke: 0.7pt + kind.border)[
      #block(width: 100%, fill: kind.border, inset: (x: 11pt, y: 5pt))[
        #text(fill: white, weight: "bold", size: hs(13pt))[#title]]
      #block(width: 100%, breakable: breakable, fill: kind.fill, inset: (x: 11pt, y: 9pt))[#content]]
  } else if modern {
    block(width: 100%, breakable: breakable, radius: 4pt, fill: kind.fill, stroke: (left: 4pt + kind.border), inset: (x: 11pt, y: 9pt))[
      #text(fill: kind.title, weight: "bold", size: hs(13pt))[#title]
      #v(3pt)
      #content]
  } else {
    block(width: 100%, breakable: breakable, radius: 3pt, stroke: 0.9pt + kind.border, fill: kind.fill, inset: (x: 10pt, y: 8pt))[
      #text(fill: kind.title, weight: "bold", size: hs(13pt))[#title]
      #v(3pt)
      #content]
  }
  v(4pt)
}
// ---- figures (defined early; the boxes reuse them) -----------------------
// Single image. Landscape: width scaled from natural px (small stay small).
// Tall/portrait (detected from the real image aspect): capped by HEIGHT so one
// picture can't fill the whole page.
#let figimg(pathstr, wpx, tall, cap, sticky: false, hmm: 0) = {
  v(2pt)
  let img = if hmm > 0 {
    // author asked to enlarge/fit: force an explicit on-page height (mm)
    image(pathstr, height: hmm * 1mm)
  } else if tall {
    image(pathstr, height: 95mm)
  } else {
    // Keep illustrations large enough to read (accessibility): a generous floor
    // so small source diagrams aren't shrunk, and reach full width sooner.
    let f = if wpx <= 0 { 0.85 } else { calc.max(0.55, calc.min(1.0, wpx / 480)) }
    image(pathstr, width: f * 100%)
  }
  // `sticky` keeps the picture on the same page as the heading/title that follows it.
  align(center)[#block(breakable: false, sticky: sticky)[
    #img
    #if cap != none [ #v(2pt) #text(size: fs(8.5pt), style: "italic", fill: rgb("#444"))[#cap] ]
  ]]
  v(3pt)
}
// Side-by-side images, aspect preserved (no stretching), one caption each.
// 2-3 images: a UNIFORM height so they line up and their labels align.
// More than that (a gallery): proportional widths that always fit the page.
#let imagerow(imgs) = {
  v(3pt)
  if imgs.len() <= 3 {
    // an author "enlarge to fit" request sets hmm on the row's images; the largest
    // wins as the uniform row height so the pictures still line up.
    let hmax = imgs.fold(0, (a, im) => calc.max(a, im.at("hmm", default: 0)))
    let h = if hmax > 0 { hmax * 1mm } else if imgs.len() == 2 { 41mm } else if imgs.len() == 3 { 32mm } else { 44mm }
    let row = block(breakable: false)[
      #grid(columns: imgs.map(_ => auto), column-gutter: 10pt, align: top + center,
        ..imgs.map(im => block(width: auto)[
          #image(im.at("file"), height: h)
          #if im.at("cap") != none [ #v(2pt) #text(size: fs(8pt), style: "italic", fill: rgb("#444"))[#im.at("cap")] ]
        ]))]
    // At a uniform height, two landscape images (e.g. side-by-side formula
    // images) can be wider than the text block and bleed off the margins. If the
    // natural row is too wide, scale it down uniformly so it always fits.
    layout(size => {
      let m = measure(row)
      if m.width > size.width and m.width > 0pt {
        let f = size.width / m.width
        align(center)[#scale(x: f * 100%, y: f * 100%, reflow: true, origin: top + center)[#row]]
      } else {
        align(center)[#row]
      }
    })
  } else {
    let total = imgs.fold(0.0, (a, im) => a + im.at("w")); if total <= 0 { total = imgs.len() }
    block(width: 100%, breakable: false)[
      #grid(columns: imgs.map(im => (im.at("w") / total) * 1fr), column-gutter: 6pt, align: top + center,
        ..imgs.map(im => [
          #image(im.at("file"), width: 100%)
          #if im.at("cap") != none [ #v(2pt) #text(size: fs(7.5pt), style: "italic", fill: rgb("#444"))[#im.at("cap")] ]
        ]))]
  }
  v(5pt)
}
#let figcaption(t) = { align(center)[#text(size: fs(8.5pt), style: "italic", fill: rgb("#444"))[#t]]; v(5pt) }

// ---- a List of Figures / List of Tables entry: a bold "Figure N"/"Table N"
// label + caption on the left, a dotted leader, and a right-aligned page number
// — styled like the table of contents, not like a centred caption. ----
#let loentry(num, title, page) = block(above: 0.86em, below: 0pt, width: 100%)[
  // match the book's body: 12pt text, the same leading and inter-paragraph gap
  #set text(size: fs(12pt))
  #set par(leading: 0.66em)
  #grid(columns: (1fr, auto), gutter: 6pt, align: (left + top, right + top),
    [#if num != "" [#text(weight: "bold", fill: T.primary)[#num]#if title != "" [: ]]#title],
    [#page])
]

// ---- data table (rich cells: each cell is (text, img)) -------------------
#let dtable(rows, noHeader: false) = if rows.len() > 0 and rows.at(0).len() > 0 {
  v(2pt)
  // table text matches the body size (12pt) for readability; very wide tables
  // (5+ columns) step down so they still fit the page width. A theme may set a larger
  // `tableSize` (e.g. big, easy-to-read tables in a lower-primary book).
  // A theme-set `tableSize` (lower-primary books read at 16pt, per CDC) applies to
  // every table, stepping down a little on wide grids so the columns stay usable.
  // Without one, keep the historical default so other books are unchanged.
  set text(size: {
    let ncol = rows.at(0).len()
    let ts = T.at("tableSize", default: none)
    if ts != none {
      // Step down only when the CONTENT is actually wide. Column count alone is a
      // poor signal in a lower-primary book: letter strips ("s | ss | se | c | ce")
      // and word-search grids have many columns but one or two characters per cell,
      // and shrinking those made them smaller than the body text around them. Use
      // the widest cell instead, so only genuinely text-heavy grids step down.
      let widest = 0
      for r in rows { for c in r { let l = c.text.len(); if l > widest { widest = l } } }
      if ncol >= 6 and widest >= 6 { ts * 0.66 }
      else if widest >= 24 and ncol >= 5 { ts * 0.78 }
      else if widest >= 12 and ncol >= 5 { ts * 0.85 }
      else { ts }
    } else if ncol >= 6 { 9.5pt } else if ncol >= 5 { 10pt } else { 12pt }
  })
  // Is a cell completely empty? Such cells appear in "Complete the table" / "Fill
  // in the table" grids the learner writes into. When many body cells are empty
  // the table is a FILL-IN table — give every empty cell a minimum writing height
  // so it isn't a thin collapsed line dwarfed by the text-filled tables.
  let isempty(c) = c.imgs.len() == 0 and c.at("seg", default: ()).len() == 0 and c.text == ""
  let bodycells = rows.slice(calc.min(1, rows.len())).map(r => r).flatten()
  let emptyn = bodycells.filter(isempty).len()
  let fillin = emptyn >= 2 and emptyn * 2 >= bodycells.len()
  // A cell may hold text AND image(s) — render both (text first, then images),
  // so nothing is dropped.
  let cell(c) = {
    let cs = c.at("colsum", default: none)
    let sg = c.at("seg", default: ())
    let subs = c.at("subs", default: ())
    if cs != none {
      // column arithmetic stacked inside this cell (e.g. a regrouping worksheet)
      colsum(cs.rows, cs.answer, size: fs(13pt))
    } else if sg.len() > 0 {
      // rich cell (holds an equation): render the segments (with real math)
      segs(sg)
    } else if c.text != "" {
      // honour line breaks: a cell may list several items on separate lines
      for (i, ln) in c.text.split("\n").enumerate() { if i > 0 { linebreak() }; ln }
    } else if fillin and subs.len() == 0 {
      // reserve room for the learner to write into an empty fill-in cell
      box(width: 100%, height: 12pt)[]
    }
    for (i, im) in c.imgs.enumerate() {
      if c.text != "" or i > 0 { v(2pt) }
      align(center)[#image(im.file, width: 100%, height: 22mm, fit: "contain")]
    }
    // a nested table (table-inside-a-table): render it as a real sub-table grid
    // rather than flattening it to text
    for (i, sub) in subs.enumerate() {
      if c.text != "" or c.imgs.len() > 0 or i > 0 { v(3pt) }
      dtable(sub)
    }
  }
  let iy = if fillin { 8pt } else { 4pt }
  let ix = if rows.at(0).len() >= 6 { 3.5pt } else { 6pt }
  // A first row is only treated as a coloured HEADER when it looks like one:
  // every cell is short, single-line, imageless label text. A table whose first
  // row already carries data (long descriptors, line breaks, images) has NO
  // header and is rendered entirely as body rows (no purple banner).
  let hdr = (not noHeader) and rows.at(0).all(c =>
    c.imgs.len() == 0 and c.at("seg", default: ()).len() == 0
    and not c.text.contains("\n") and c.text.len() <= 40 and c.text != "")
  let hasimg = rows.any(r => r.any(c => c.imgs.len() > 0))
  // Content-proportional column widths (all `fr`, so a table that breaks across pages
  // keeps consistent columns). Each column's weight is its fullest cell's length,
  // capped at 45 (so an ordinary all-text table stays ~equal), but floored so the
  // column is always wide enough for the LONGEST WORD in its header — otherwise a short
  // single-word header ("Stage") can't wrap and overflows into the next column, while a
  // paragraph column still gets the room it needs. Fill-in write-in grids keep their
  // empty columns roomy.
  let ncols = rows.at(0).len()
  let colsumlen(c) = { let cs = c.at("colsum", default: none); if cs == none { 0 } else { let m = 0; for r in cs.rows { if r.len() > m { m = r.len() } }; for a in cs.answer { if a.len() > m { m = a.len() } }; m * 3 + 12 } }
  let celllen(c) = c.text.len() + c.at("seg", default: ()).len() * 6 + c.imgs.len() * 30 + colsumlen(c)
  let bigcontent = rows.any(r => r.any(c => celllen(c) >= 100))
  let collen(ci) = { let m = 0; for r in rows { let l = celllen(r.at(ci)); if l > m { m = l } }; m }
  // The longest UNBREAKABLE word anywhere in a column (header OR body). A column
  // must be at least wide enough for this word or it overflows into its neighbour
  // (e.g. a short "Class" header whose body holds "Amphibians"/"Mammals"). Relative
  // `fr` weight alone can't guarantee that, so we raise the column's floor to it.
  let longword(s) = s.split(regex("\s+")).fold(0, (a, w) => calc.max(a, w.len()))
  let colword(ci) = { let m = 0; for r in rows { let l = longword(r.at(ci).text); if l > m { m = l } }; m }
  let colweight(ci) = {
    let floor = calc.max(6, colword(ci) * 2)   // fit the column's longest (unbreakable) word
    if fillin and not bigcontent {
      let bodyEmpty = rows.slice(calc.min(1, rows.len())).all(r => celllen(r.at(ci)) == 0)
      if bodyEmpty { calc.max(20, floor) } else { calc.max(floor, calc.min(collen(ci), 45)) }
    } else { calc.max(floor, calc.min(collen(ci), 45)) }
  }
  // A genuine numbering/serial column ("S/N", "No.", "#") has a short header AND
  // trivially short body cells (a digit or two). Given proportional `fr` weight it
  // gets starved next to a content-heavy column and its header wraps ("S/" over "N").
  // Size such a column to its content with `auto` instead — it stays narrow and
  // consistent across page breaks (unlike content columns, where auto misbehaves).
  // Requires real BODY rows: a serial column only exists in a data table. Without
  // this guard a single-row label strip ("Tree | lady | coin | meat | monkey | boy")
  // had every short cell sized `auto`, leaving the one longer cell as the only `1fr`
  // column — so it soaked up all the remaining width and the strip looked lopsided.
  // A serial column's body is genuinely NUMERIC (1, 2, 3 …). Requiring numeric body
  // stops this from misfiring on a peer word-list column that merely happens to hold
  // short words (e.g. the "ay | a-e" columns of a phonics "ai | a | ay | a-e" grid,
  // whose 4-letter words are one letter shorter than the neighbouring columns' — that
  // is not a serial column and must not collapse to `auto`).
  let isnum(s) = { let t = s.trim(); t != "" and t.matches(regex("^[0-9]+$")).len() > 0 }
  let narrowNum(ci) = rows.len() >= 2 and not fillin and rows.at(0).at(ci).text.len() <= 5 and collen(ci) <= 4 and rows.slice(1).all(r => { let t = r.at(ci).text.trim(); t == "" or isnum(t) }) and rows.slice(1).any(r => isnum(r.at(ci).text))
  // A "word grid" — every cell a single short token (phonics spelling-choice tables
  // like "ai | a | ay | a-e" with one word per cell) — reads as lopsided under content-
  // proportional widths when one column's longest word is a letter longer than another's.
  // The author wants these uniform ("make them even/uniform"), so give every column
  // equal width. Excludes fill-in grids (empty cells), image tables, and any multi-word
  // cell (a real data table keeps its proportional widths).
  let uniformgrid = not fillin and not hasimg and ncols >= 2 and rows.all(r => r.all(c =>
    c.text != "" and not c.text.contains(" ") and c.text.len() <= 10
    and c.at("seg", default: ()).len() == 0 and c.imgs.len() == 0))
  let cols = if uniformgrid { range(ncols).map(_ => 1fr) } else { range(ncols).map(ci => if narrowNum(ci) { auto } else { colweight(ci) * 1fr }) }
  let tbl = if hdr {
    table(columns: cols, stroke: 0.5pt + T.rulec,
      fill: (col, row) => if row == 0 { T.primary } else if calc.odd(row) { T.zebra } else { white },
      inset: (x: ix, y: iy),
      table.header(..rows.at(0).map(c => text(fill: white, weight: "bold")[#c.text])),
      ..rows.slice(1).map(r => r.map(cell)).flatten())
  } else {
    table(columns: cols, stroke: 0.5pt + T.rulec,
      fill: (col, row) => if calc.even(row) { T.zebra } else { white },
      inset: (x: ix, y: iy),
      ..rows.map(r => r.map(cell)).flatten())
  }
  // Keep a table whole on one page so its coloured header never orphans at the
  // foot of a page (author's "table must be on one page") — but ONLY when it
  // actually fits: measure the table at the real column width and keep it
  // unbreakable only if it's short enough to sit on a page. A tall table (e.g. the
  // Key Competences grid) stays breakable so it flows instead of being pushed to
  // the next page whole and leaving a near-empty page behind it.
  layout(size => {
    let h = measure(box(width: size.width)[#tbl]).height
    if not hasimg and h < 400pt { block(breakable: false, width: 100%)[#tbl] } else { tbl }
  })
  v(4pt)
}

// Mixed box body: paragraphs, sub-headings, list items, images and nested
// tables, in order.
#let renderbody(body, hsize: none) = {
  for it in body {
    if it.k == "table" { dtable(it.r, noHeader: it.at("nohdr", default: false)) }
    else if it.k == "img" {
      if it.images.len() == 1 { figimg(it.images.at(0).file, it.images.at(0).w, it.images.at(0).tall, it.images.at(0).cap, hmm: it.images.at(0).at("hmm", default: 0)) }
      else { imagerow(it.images) }
    }
    else if it.k == "head" {
      v(3pt)
      let hd = text(weight: "bold", fill: T.primary, size: if hsize != none { hsize } else { hs(12pt) })[#it.t]
      block(breakable: false, width: 100%)[#if it.at("center", default: false) { align(center)[#hd] } else { hd }]
      v(2pt)
    }
    else if it.k == "list" {
      // A sub-list (one that restarts its numbering under a numbered parent) is
      // indented so it reads as belonging to that question rather than as a sibling.
      let pad = it.at("indent", default: 0) * 18pt
      grid(columns: (pad, auto, 1fr), column-gutter: (0pt, 7pt), align: (left + top, left + top, left + top),
        [],
        text(fill: if it.marker == "•" { T.primary2 } else { T.primary }, weight: if it.marker == "•" { "regular" } else { "bold" })[#it.marker],
        par[#segs(it.s)])
      v(1.5pt)
    }
    else if it.k == "colgrid" { colgrid(rows: it.rows, ncol: it.ncol, hasMarker: it.hasMarker) }
    else if it.k == "colsum" { colsum(it.rows, it.answer) }
    else { flowsegs(it.s); v(2pt) }
  }
}
// A framed Learning Activity / Exercise / Assessment (primary Teacher's Guide):
// a titled, coloured box whose colour follows the section kind (act/ex/asmt).
// A box that carries a picture (e.g. "Activity 1: What can you see in the picture?"
// — a heading over one illustration) is kept UNBREAKABLE so its title and image can
// never split across a page break (which orphaned the heading at the foot of one page
// and pushed the picture to the next). Text-only boxes stay breakable so a long list
// can still flow across pages.
// A box holding a picture is kept whole so its title and image never split across a
// page — but only when it can actually FIT on one. A tall picture box forced whole
// jumps to the next page and strands the unit banner on a near-empty page, so measure
// it first and let an over-tall box break normally.
// A figure placed BESIDE the text, as in the manuscript: the picture(s) in a narrow
// column on the given side (L/R) at `frac` of the text width, the body text flowing in
// the wider column next to them. `images` are the imagerow dict form (file/w/cap/…),
// stacked vertically with their captions; `body` is the renderbody block list. Defined
// after renderbody because it renders the paired text with it.
#let sidefig(side, frac, images, body) = {
  let f = calc.max(0.24, calc.min(0.52, frac))
  let imgcol = block(breakable: false, width: 100%)[
    #for (i, im) in images.enumerate() {
      if i > 0 { v(6pt) }
      image(im.at("file"), width: 100%)
      if im.at("cap", default: none) != none [
        #v(2pt)
        #align(center)[#text(size: fs(8pt), style: "italic", fill: rgb("#444"))[#im.at("cap")]]
      ]
    }
  ]
  let txt = { set par(justify: true); renderbody(body) }
  v(3pt)
  block(width: 100%, breakable: false)[
    #if side == "L" {
      grid(columns: (f * 100%, 1fr), column-gutter: 13pt, align: (top, top), imgcol, txt)
    } else {
      grid(columns: (1fr, f * 100%), column-gutter: 13pt, align: (top, top), txt, imgcol)
    }
  ]
  v(4pt)
}
#let framedsection(kind, title, body) = layout(sz => {
  let content = renderbody(body)
  // Keep a box WHOLE (unbreakable) whenever it is short enough to sit on a page by
  // itself: measure the rendered height and, if it fits comfortably (< 180mm, leaving
  // room for the title + insets on a B5 page), don't let it break. This stops a short
  // Exercise/Activity from splitting so that a stray last item or two orphans onto an
  // otherwise-empty page — it moves wholesale to the next page instead. Genuinely tall
  // boxes stay breakable so they never overflow the page.
  let fits = measure(box(width: sz.width, content)).height < 180mm
  titledbox(text(size: hs(14pt))[#title], T.at(kind), content, breakable: not fits)
})
// The lesson-header metadata (LESSON N + Component / Topic / Sub-Topic / competences /
// Expected Standard / methodology / vocabulary) grouped and STYLED — NOT boxed. The
// author asked for the header set larger (14pt vs the 12pt body) and visually distinct,
// but flowing, not enclosed in a panel/table. So: a larger coloured "LESSON N" title
// over a thin heading rule, then the fields at 14pt — set apart by type, not a frame.
#let lessonmeta(title, body) = {
  v(6pt)
  block(sticky: true, below: 4pt)[#text(fill: T.primary, weight: "bold", size: 16pt)[#title]]
  line(length: 100%, stroke: 0.6pt + T.primary.lighten(45%))
  v(7pt)
  text(size: 14pt)[#renderbody(body, hsize: 14pt)]
  v(6pt)
}
// Activity/Exercise/Assessment boxes: keep WHOLE (unbreakable) whenever short enough
// to sit on a page by itself (< 180mm — mirrors framedsection's rule), so a box that
// doesn't fit the remainder of the current page moves wholesale to the next page
// instead of splitting and leaving just its title + a line or two behind as a widow.
// Genuinely tall boxes (>= 180mm) stay breakable so they never overflow a page.
// A `force` flag (per-box, set from a `pageBreakBefore`-style override — see
// typeset-docx.js) unconditionally starts this box on a fresh page even when it is
// too tall to ever fit one page whole: without it, an oversized box left to start
// wherever there happens to be room can begin two lines from the page foot and leave
// almost nothing before the break (a widowed title). `weak: true` is a no-op when
// already at the top of a page. NOT applied to every oversized box by default — that
// wastes a lot of trailing whitespace on the page before each one book-wide; only used
// where an author flagged a specific widow. `pagebreak()` can't be called from inside
// `layout()` (a measurement container), so the forced case is split into three steps:
// measure into a scratch state, read it back at the TOP LEVEL to emit the weak
// pagebreak, then render.
#let boxfits = state("boxfits", true)
#let keepwhole(kind, title, content, force: false) = {
  if force {
    layout(sz => boxfits.update(measure(box(width: sz.width, content)).height < 180mm))
    context (if not boxfits.get() { pagebreak(weak: true) })
    context titledbox(title, T.at(kind), content, breakable: not boxfits.get())
  } else {
    layout(sz => {
      let fits = measure(box(width: sz.width, content)).height < 180mm
      titledbox(title, T.at(kind), content, breakable: not fits)
    })
  }
}
#let activity(title, body, force: false) = keepwhole("act", title, renderbody(body), force: force)
#let fact(body) = titledbox("Did You Know?", T.fact, renderbody(body))
#let keypoints(title, items) = titledbox(if title == none { "Key Points to Remember" } else { title }, T.kp,
  { for it in items [#grid(columns: (10pt, 1fr), text(fill: T.kp.border)[•], par[#it]); #v(1.5pt)] })
#let genericbox(body) = { block(width: 100%, breakable: true, radius: 3pt,
  stroke: 0.9pt + T.rulec, fill: rgb("#f7f9fc"), inset: (x: 10pt, y: 8pt))[#renderbody(body)]; v(3pt) }

// ---- exercises & assessment (ordered q/table parts, manual numbering) -----
#let show-answers = state("show-answers", true)
// render the rich (segments, incl. math) version if present, else the plain text
#let rich(seg, plain) = if seg != none and seg.len() > 0 { segs(seg) } else { [#plain] }
// Like `rich`, but emits each DISPLAY-math segment as its own centred block rather
// than inside a paragraph — a bare block swallowed by par[...] renders empty, which
// is why equations that sit on their own line inside an exercise/assessment (the
// author's "math boxes") came out blank. Inline runs stay in a paragraph. Mirrors
// `para`. (Parameter is `ss`, not `seg`, so it doesn't shadow the seg() function.)
#let richflow(ss, plain) = if ss == none or ss.len() == 0 { par[#plain] } else { flowsegs(ss) }
#let answer(aseg, a) = context if show-answers.get() and (a != "" or aseg.len() > 0) {
  if T.at("mono", default: false) {
    [#text(style: "italic", fill: T.ex.title)[#text(weight: "bold")[Possible answer: ]#rich(aseg, a)]]
  } else {
    [#highlight(fill: T.yellow, extent: 1pt)[#text(style: "italic", fill: T.ex.title)[#text(weight: "bold")[Possible answer: ]#rich(aseg, a)]]]
  }
}
#let qaparts(parts) = {
  // exercise/assessment text is left-aligned (not justified): fill-in-the-blank lines
  // ("Natural Resources = ____") end in a long unbreakable underscore run that wraps to
  // the next line, and justification would stretch the orphaned label across the column.
  set par(justify: false)
  for it in parts {
    if it.kind == "colsum" {
      // a vertical column sum/subtraction answer (converted from an unaligned fraction),
      // optionally numbered by the part's marker.
      let cm = it.at("marker", default: "")
      if cm != "" { grid(columns: (22pt, 1fr), column-gutter: 6pt, align: (right + top, left + top), text(fill: T.primary, weight: "bold")[#cm], colsum(it.rows, it.answer, size: fs(12pt))) }
      else { colsum(it.rows, it.answer, size: fs(12pt)) }
    }
    else if it.kind == "table" {
      // an answer that is a comparison table may carry a part marker (e.g. "c)")
      let tm = it.at("marker", default: "")
      if tm != "" { grid(columns: (22pt, 1fr), column-gutter: 6pt, align: (right + top, left + top), text(fill: T.primary, weight: "bold")[#tm], dtable(it.r)) }
      else { dtable(it.r) }
    }
    else if it.kind == "image" {
      let mk = it.at("marker", default: "")
      let body = if it.images.len() == 1 { figimg(it.images.at(0).file, it.images.at(0).w, it.images.at(0).tall, it.images.at(0).cap, hmm: it.images.at(0).at("hmm", default: 0)) } else { imagerow(it.images) }
      // an image that is itself a numbered answer (e.g. a tally chart) carries a marker
      if mk != "" { grid(columns: (22pt, 1fr), column-gutter: 6pt, align: (right + top, left + top), text(fill: T.primary, weight: "bold")[#mk], body) }
      else { body }
    }
    else if it.kind == "colgrid" {
      // a place-value chart or word grid the author laid out with space columns
      // inside an exercise; render the aligned columns.
      colgrid(rows: it.rows, ncol: it.ncol, hasMarker: it.at("hasMarker", default: false), header: it.at("header", default: none))
      v(2pt)
    }
    else if it.kind == "lead" {
      // an unnumbered lead-in line (e.g. "Calculate:") or a standalone equation the
      // author dropped between questions (their "math boxes") — render display math
      // as its own centred block so it doesn't vanish inside a paragraph. A lead that
      // CONTINUES a question (flagged `indent`) is padded to align under the question
      // text (the 22pt marker gutter) instead of hugging the box's left edge.
      let leadbody = richflow(it.at("qseg", default: ()), it.q)
      let al = it.at("align", default: none)
      if it.at("indent", default: false) {
        grid(columns: (22pt, 1fr), column-gutter: 6pt, align: (left + top, left + top),
          [], if al == "center" { std.align(center)[#leadbody] } else { leadbody })
      } else { if al == "center" { std.align(center)[#leadbody] } else { leadbody } }
      v(2pt)
    }
    else {
      // a question / sub-question rendered with the WRITER'S OWN marker, indented
      // by depth so follow-up parts (a, b, c…) sit under their parent question.
      let pad = it.depth * 16pt
      let aseg = it.at("aseg", default: ())
      grid(columns: (pad, 22pt, 1fr), column-gutter: (0pt, 6pt), align: (left + top, right + top, left + top),
        [], [#it.marker], [#richflow(it.at("qseg", default: ()), it.q) #context if show-answers.get() and (it.a != "" or aseg.len() > 0) [ \ #answer(aseg, it.a) ]])
      v(T.at("qgap", default: 3pt))
    }
  }
}
#let exercise(title, parts, force: false) = keepwhole("ex", text(size: hs(14pt))[#title], qaparts(parts), force: force)
#let assessment(title, intro, parts, extra, force: false) = keepwhole("asmt", text(size: hs(14pt))[#title], {
  for line in intro [#par[#text(style: "italic")[#line]]; #v(2pt)]
  qaparts(parts)
  if extra.len() > 0 { v(2pt); for e in extra [#grid(columns: (10pt, 1fr), text(fill: T.asmt.border)[•], par[#e]); #v(1pt)] }
}, force: force)
