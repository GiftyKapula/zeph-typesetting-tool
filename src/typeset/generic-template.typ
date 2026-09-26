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
// "syllabus" = the CDC landscape curriculum-syllabus family (A4 landscape, a grey-
// header 5-column matrix interior, a spread cover). Its own page furniture below.
#let syllabus = T.variant == "syllabus"
// "series" (English, flat) and "science" (Physics, boxed) share the ZEPH B5
// house mechanics: page size/margins, running header, tilde footer, roman/arabic
// numbering, designed cover + title page + back cover.
#let serieslike = series or science
// Opt-in callout look. "labcard" (Chemistry) replaces the shared left-stripe box
// with a rounded tinted CARD: a solid title chip + a hexagon (benzene-ring) motif
// and a full hairline border, no side stripe. Empty = the theme's default box.
#let boxstyle = T.at("boxStyle", default: "")
// The x-inset a BOX's content sits at. titledbox picks this per theme (see its
// branches); genericbox mirrors it here rather than hard-coding its own, so an
// untitled box's text and list markers line up down the page with the titled
// boxes around it. They differed by 1pt before — invisible on its own, but it put
// two list families in one book at two different left edges, which is exactly the
// unevenness the numbering rules elsewhere work to avoid.
#let boxinx = if boxstyle == "labcard" { 14pt } else if serieslike or panel or literary or modern { 11pt } else { 10pt }
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
// Register a heading so the real outline (TOC) finds it at THIS page, but render nothing
// on the page — used to list the matrix TOPICS (which live inside table cells) in the
// contents with their true page numbers, nested under the YEAR heading.
#let tocentry(lvl, body) = place(hide(heading(level: lvl, outlined: true, numbering: none, bookmarked: false)[#body]))

// Does this cover line name a form/grade? FORM, GRADE and FOMU must match as WORDS,
// never as substrings. "INFORMATION" contains "FORM": a plain `"FORM" in upper(line)`
// took the subject line of "Information and Communication Technology" for the form
// line, found no "FORM <digit>" in it, and silently dropped the FORM 2 tag from that
// book's cover. The same trap is waiting in PERFORMING ARTS, TRANSFORMATION, REFORM.
#let hasGradeWord(s) = upper(s).match(regex("\\b(FORM|GRADE|FOMU)\\b")) != none

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
  // HYPHENATION. `costs.hyphenation` raises the price the line-breaker pays for a
  // hyphen, so it still breaks a word where the alternative is an overfull line —
  // a ~26mm rubric column cannot hold "demonstrated" whole — but stops breaking
  // words merely to tidy a body line that would have set perfectly well.
  //
  // 300% was picked by measuring, not taste. Across the 284-page ICT Form 2
  // Teacher's Guide: 1237 hyphenated line-breaks at the default 100%, 981 at 200%,
  // 807 at 300%, 738 at 500% — and the runs of consecutive hyphenated lines that
  // Hart's Rules calls a "ladder" fell 118 -> 47 between 100% and 300%, then barely
  // moved. Past 300% the gain is marginal and the justification pays for it.
  //
  // `region: "gb"` is language TAGGING, for a Zambian book following British
  // spelling and for the PDF's own language metadata. It does NOT change the
  // breaks: this Typst builds identical hyphenation with and without it (measured
  // — all four counts unchanged), because it ships one English pattern set rather
  // than separate en-GB/en-US ones.
  //
  // What this cannot do is enforce the 3-letters-before / 3-after minimum the print
  // standards ask for; Typst exposes no such control. ~70 breaks still fall short
  // of it, nearly all inside the narrow rubric columns where the measure leaves no
  // other option. Body prose is where the win landed.
  set text(font: T.bodyFont, size: bodySize, fill: T.ink, costs: (hyphenation: 300%), lang: "en", region: "gb", hyphenate: T.at("hyphenate", default: true))
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
    flipped: T.at("landscape", default: false),
    margin: if syllabus { (top: 20mm, bottom: 20mm, x: 20mm) } else if tallhdr { (top: 24mm, bottom: 16mm, x: 17mm) } else if serieslike { (top: 19mm, bottom: 16mm, x: 17mm) } else { (top: 23mm, bottom: 20mm, x: 21mm) },
    header-ascent: if tallhdr { 8mm } else { 30% },
    footer-descent: if syllabus { 40% } else { 30% },
    header: context {
      let visible = if serieslike { pastcover.get() } else { counter(page).get().first() > 1 }
      if syllabus {
        // No running header on the matrix pages (the wide matrix uses the full width).
      } else if visible {
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
          // Pin the internal spacing so the header→rule gap is identical on every
          // page: without this the header inherits the ambient block spacing, which
          // is airier in the front matter than the body and floats the map-tab
          // higher (widening the gap between the two rules) on the roman pages
          // than on the arabic ones. (Same fix as the GRADE 2/3 header above.)
          set block(spacing: 0pt)
          set par(spacing: 0pt)
          grid(columns: (auto, 1fr, auto), align: (left + horizon, center, right + horizon),
            box(fill: T.primary, inset: (x: 7pt, y: 2.5pt), radius: 2pt)[
              #text(fill: white, weight: "bold", size: 7.5pt, tracking: 0.5pt)[#upper(T.subject)]],
            [],
            text(style: "italic", weight: "bold", fill: T.primary, size: 8.5pt)[#T.hdrtab])
          v(4pt)
          // A single grid with fixed row heights (like the GRADE 2/3 rule above),
          // not two v()-trimmed line() blocks: a trim only works by shaving down an
          // ambient block-spacing gap, which no longer exists now that it's pinned
          // to 0 above — trimming a zero gap goes negative and inverts the rules.
          grid(columns: (100%,), rows: (3.2pt, 3.2pt), align: left + horizon,
            line(length: 100%, stroke: 1.5pt + T.primary),
            line(length: 100%, stroke: 0.7pt + T.accent))
        } else if serieslike {
          // serif italic masthead (subject) + a short teal rule + amber Form pill
          set text(font: T.font, size: 8.5pt)
          // Pin the internal spacing so the header→rule gap is identical on every
          // page: without this the header inherits the ambient block spacing,
          // which is airier in the front matter than the body and floats the
          // masthead higher on the roman pages than on the arabic ones (the
          // same fix already applied to the GRADE 2/3 and FORM 2 map headers
          // above — this is the one remaining "serieslike" header shape that
          // hadn't gotten it, used by every subject without its own coverStyle).
          set block(spacing: 0pt)
          set par(spacing: 0pt)
          grid(columns: (1fr, auto), align: (left + horizon, right + horizon),
            text(style: "italic", weight: "bold", fill: T.primary)[#T.hdrleft],
            box(fill: iaccent, inset: (x: 6pt, y: 2.5pt), radius: 3pt)[
              #text(fill: white, style: "italic", weight: "bold", size: 7.5pt)[#T.hdrtab]])
          v(3pt); line(length: 100%, stroke: 1.1pt + T.primary)
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
      if syllabus {
        // CDC syllabus footer: a double black rule + the italic "‹Subject› Syllabus
        // ‹year›" masthead on the left, from the copyright page onward (pastcover). The
        // page number sits in a black chip centred on the rule, but only once numbering
        // is VISIBLE (pgvisible) — i.e. from the Vision page (roman) through the body.
        if pastcover.get() {
          set text(font: T.bodyFont, size: 9pt, fill: T.ink)
          place(top, line(length: 100%, stroke: 1.6pt + T.ink))
          place(top, dy: 3pt, line(length: 100%, stroke: 0.6pt + T.ink))
          v(5pt)
          grid(columns: (1fr, auto, 1fr), align: (left + horizon, center + horizon, right),
            text(style: "italic", weight: "bold")[#T.hdrleft],
            if pgvisible.get() {
              box(fill: T.ink, inset: (x: 8pt, y: 2.5pt))[
                #text(fill: white, weight: "bold")[#counter(page).display()]]
            } else { [] },
            [])
        }
      } else if serieslike {
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
#let titlepage(lines, byline, hero: none, logo: none) = {
  // SYLLABUS title page: a black-and-white echo of the cover — crest + ministry, the
  // title between two grey rules, the level line, the CDC badge and the developed-by
  // block. Unnumbered (its own footer:none page). Mirrors the reference second page.
  if syllabus {
    let subject = lines.at(0, default: "")
    let name = if subject != "" and not ("SYLLABUS" in upper(subject)) { subject } else { T.subject }
    let year = T.at("year", default: "")
    let grey = rgb("#c8c8c8")
    return {
      pagebreak(weak: true)
      page(paper: "a4", flipped: true, margin: (x: 26mm, y: 16mm), header: none, footer: none)[
        #set align(center)
        #if hero != none and hero.file != "" { image("_media/" + hero.file, height: 40mm); v(3mm) }
        #text(font: T.bodyFont, size: 15pt, weight: "bold", fill: T.ink)[Republic of Zambia] #linebreak()
        #text(font: T.bodyFont, size: 18pt, weight: "bold", fill: T.ink)[MINISTRY OF EDUCATION]
        #v(9mm)
        #line(length: 100%, stroke: 3pt + grey)
        #v(7mm)
        #text(font: T.displayFont, size: 33pt, weight: "black", fill: T.ink, tracking: 0.5pt)[#upper(name) SYLLABUS] #linebreak()
        #v(4mm)
        #text(font: T.bodyFont, size: 19pt, weight: "bold", fill: T.ink)[#upper(T.eyebrow)]
        #v(7mm)
        #line(length: 100%, stroke: 3pt + grey)
        #v(11mm)
        #if logo != none and logo.file != "" { image("_media/" + logo.file, height: 26mm); v(4mm) }
        #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: T.ink)[Developed by the Curriculum Development Centre] #linebreak()
        #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: T.ink)[#year]
      ]
      pastcover.update(true)
      pagebreak(weak: true)
    }
  }
  pagebreak(weak: true)
  set text(font: T.displayFont)
  let grade = lines.find(l => hasGradeWord(l))
  let booktype = lines.at(lines.len() - 1, default: "Learner's Book")
  let formtxt = if grade != none { let m = grade.match(regex("(?i)(form|grade)\\s+\\d+")); if m != none { m.text } else { "" } } else { "" }
  // The subject title: if the grade line is "SUBJECT FORM N" use the stripped
  // subject ("PHYSICS"); if the grade line is just "FORM N", the subject sits on
  // its OWN line ("BIOLOGY") — take the first non-eyebrow, non-grade line.
  let gradeSubj = if grade != none { grade.replace(regex("(?i)\\s*(form|grade)\\s+\\d+"), "").trim() } else { "" }
  let name = if gradeSubj != "" { gradeSubj } else {
    let cand = lines.slice(0, calc.max(1, lines.len() - 1)).filter(l =>
      not hasGradeWord(l) and upper(l).trim() != "SECONDARY EDUCATION ORDINARY LEVEL")
    cand.at(0, default: lines.at(0, default: ""))
  }
  // the eyebrow is the lead line, unless that line is itself the title (carries
  // FORM/GRADE, or equals the subject) — then fall back to the standard descriptor.
  let rawlead = lines.at(0, default: "")
  let lead = if hasGradeWord(rawlead) or (rawlead == name) { T.eyebrow } else { rawlead }
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
  // One line per author reads best for the usual 1-2 author byline, but a book
  // credited to several authors (e.g. a Teacher's Guide with a whole writing
  // panel) stacks past the publisher block below, which sits at a FIXED offset
  // and doesn't know how far the in-flow byline pushed things down — the two
  // silently overlapped. Past 2 names, wrap them into one centred paragraph
  // instead (matching how the cover's own byline already handles a long list).
  if byline.len() > 0 {
    v(20mm)
    align(center)[
      #text(size: 9pt, weight: "bold", fill: T.primary, tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
      #v(3mm)
      #if byline.len() > 2 {
        text(size: 13pt, weight: "medium", fill: T.ink)[#byline.join("   •   ")]
      } else {
        for a in byline [ #text(size: 13pt, weight: "medium", fill: T.ink)[#a] #v(3.5mm) ]
      }
    ]
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
// A small flat "berry cluster" food accent for the series cover's
// `T.motif == "food"` themes: three overlapping circles in warm harvest
// colours, built from the same circle primitive as cnode/cdot above (no
// rotated-ellipse "leaf" shapes — those read as illegible slivers at this
// size), gated to those themes so no other "series" cover picks it up.
#let berrycluster(x, y, c1, c2, c3, r: 3.2mm) = place(top + left, dx: x, dy: y, {
  circle(radius: r, fill: c1)
  place(dx: r * 1.5, dy: r * 0.3, circle(radius: r * 0.8, fill: c2))
  place(dx: r * 0.5, dy: r * 1.7, circle(radius: r * 0.65, fill: c3))
})

#let cover(lines, byline, hero, logo, isbn, finished: false) = {
  // The cover keeps its OWN palette even when the interior is printed black-and-white:
  // shadow T with the cover colours so every T.primary/accent/… below draws in colour.
  // (For normal books the cover colours default to the body colours, so this is a no-op.)
  let T = (..T, primary: T.covPrimary, primary2: T.covPrimary2, accent: T.covAccent, signature: T.covSignature, cyan: T.covCyan, ink: T.covInk, rulec: T.covRulec)
  let subject = lines.at(0, default: "")
  let grade = if lines.len() > 1 { lines.slice(1).find(l => hasGradeWord(l)) } else { none }
  let booktype = lines.at(lines.len() - 1, default: "Learner's Book")

  // ---------- FINISHED cover: the manuscript ships a complete, already-designed
  // cover graphic (title, book type, authors, publisher/logo all baked into the
  // image itself) rather than a plain hero photo for the template to dress up.
  // Render it full-bleed and skip every template overlay (title text, byline,
  // logo, motif) — drawing any of that on top would duplicate what the image
  // already carries. Opt in per book via the `finishedCover` override once a
  // manuscript's cover page is confirmed to be pre-designed like this. ----------
  if syllabus {
    // ---------- SYLLABUS cover SPREAD (CDC camera-ready): ONE double-wide sheet — the
    // BACK cover on the left panel, the FRONT cover on the right panel, on a solid subject
    // field with a full-width title band. Then the interior continues as normal A4 pages. --
    let field = T.covSignature
    let band = T.at("covBand", default: white)
    let ftext = T.at("covText", default: white)
    let title = T.at("covTitle", default: T.ink)
    let name = if subject != "" and not ("SYLLABUS" in upper(subject)) { subject } else { T.subject }
    let year = T.at("year", default: "")
    let fdx = 297mm   // left edge of the FRONT (right) panel
    page(width: 594mm, height: 210mm, flipped: false, margin: 0pt, header: none, footer: none, fill: field)[
      // full-width title band across the whole spread
      #place(top + left, dy: 82mm, rect(width: 100%, height: 40mm, fill: band, stroke: none))
      // ---- FRONT cover (right panel) ----
      #place(top + left, dx: fdx, dy: 9mm, box(width: 297mm)[
        #set align(center)
        #if hero != none and hero.file != "" { image("_media/" + hero.file, height: 40mm); v(2.5mm) }
        #text(font: T.bodyFont, size: 19pt, weight: "bold", fill: ftext)[Republic of Zambia] #linebreak()
        #text(font: T.bodyFont, size: 27pt, weight: "bold", fill: ftext)[Ministry of Education]
      ])
      #place(top + left, dx: fdx, dy: 82mm, box(width: 297mm, height: 40mm)[
        #set align(center + horizon)
        #stack(spacing: 4mm,
          text(font: T.displayFont, size: 31pt, weight: "black", fill: title, tracking: 0.5pt)[#upper(name) SYLLABUS],
          text(font: T.bodyFont, size: 18pt, weight: "bold", fill: title)[#upper(T.eyebrow)])
      ])
      #place(top + left, dx: fdx, dy: 128mm, box(width: 297mm)[
        #set align(center)
        #if logo != none and logo.file != "" { image("_media/" + logo.file, height: 30mm) }
      ])
      #place(top + left, dx: fdx, dy: 176mm, box(width: 297mm)[
        #set align(center)
        #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: ftext)[DEVELOPED BY THE CURRICULUM DEVELOPMENT CENTRE] #linebreak()
        #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: ftext)[LUSAKA] #linebreak()
        #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: ftext)[#year]
      ])
      // ---- BACK cover (left panel): ISBN/barcode reserve + printer imprint ----
      #place(top + left, dx: 0mm, dy: 58mm, box(width: 297mm)[
        #set align(center)
        #box(width: 120mm, height: 34mm, fill: white, stroke: 0.75pt + rgb("#cccccc"))[
          #set align(center + horizon)
          #{
            if isbn != none { text(font: T.bodyFont, size: 13pt, fill: black)[ISBN #isbn] }
            else { text(font: T.bodyFont, size: 10pt, fill: rgb("#999999"))[ISBN / barcode] }
          }
        ]
      ])
      #place(top + left, dx: 0mm, dy: 150mm, box(width: 297mm)[
        #set align(center)
        #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: ftext)[Printed by] #linebreak()
        #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: ftext)[Zambia Educational Publishing House]
      ])
    ]
    pastcover.update(true)
    pagebreak(weak: true)
  } else if finished and hero != none {
    page(margin: 0pt, header: none, footer: none, width: 176mm, height: 250mm)[
      #image("_media/" + hero.file, width: 100%, height: 100%, fit: "cover")
    ]
  } else if science {
    // ---------- SCIENCE cover (Physics): deep-indigo signature field with
    // concentric "electron orbit" rings, white title, amber FORM tag ----------
    let gl = if hasGradeWord(subject) { subject } else { grade }
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
      // amber accent bar under the masthead is drawn later; Grade 6 Science
      // (earth) gets its own pebble/sunburst design below; physics (and every
      // other science theme) keeps the concentric electron orbits.
      #if T.motif != "flask" and T.motif != "earth" and T.motif != "circuit" [
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 50mm, fill: none, stroke: 1pt + white.transparentize(72%)))
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 37mm, fill: none, stroke: 1pt + white.transparentize(80%)))
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 24mm, fill: none, stroke: 1.4pt + amber.transparentize(25%)))
        #place(top + right, dx: 28mm, dy: -34mm, circle(radius: 2.6mm, fill: amber))
        #place(bottom + left, dx: -36mm, dy: 40mm, circle(radius: 44mm, fill: none, stroke: 1pt + white.transparentize(82%)))
      ]
      // GRADE 6 SCIENCE (earth): a warm, hands-on identity distinct from every
      // other science book's orbits/flask/cell — the same proven ring anchor
      // point as the electron-orbit design above (so the rings still peek out
      // from behind the masthead the same way). The field itself is earth-
      // green (T.signature falls back to T.primary — see themes.js); ocean-
      // blue on that green field read poorly (too low-contrast/muddy), so
      // both rings stay in the white/orange family instead — the second ring
      // is tinted energetic-orange (T.accent), echoing the GRADE 6 badge.
      // Plus a small energetic-orange sunburst (light/energy — this book's
      // own Materials and Energy topic) sitting just inside the rings where
      // it's actually on-page (the orbit dot's own dx/dy, reused as-is,
      // places a small shape almost entirely off the top edge).
      #if T.motif == "earth" [
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 50mm, fill: none, stroke: 1pt + white.transparentize(72%)))
        #place(top + right, dx: 32mm, dy: -30mm, circle(radius: 37mm, fill: none, stroke: 1pt + T.accent.transparentize(35%)))
        #place(top + right, dx: 6mm, dy: 10mm, circle(radius: 2.8mm, fill: amber))
        #place(top + right, dx: 6mm, dy: 10mm, line(start: (0mm, 0mm), end: (-7mm, -3mm), stroke: 1.4pt + amber.transparentize(15%)))
        #place(top + right, dx: 6mm, dy: 10mm, line(start: (0mm, 0mm), end: (-8mm, 3mm), stroke: 1.4pt + amber.transparentize(15%)))
        #place(top + right, dx: 6mm, dy: 10mm, line(start: (0mm, 0mm), end: (-2mm, 9mm), stroke: 1.4pt + amber.transparentize(15%)))
        #place(bottom + left, dx: -36mm, dy: 40mm, circle(radius: 44mm, fill: none, stroke: 1pt + white.transparentize(82%)))
      ]
      // COMPUTING / IT books (circuit): faint gadget outlines and connection
      // traces instead of the concentric orbit rings above. The rings read as
      // planets — fine for physics, wrong for a computing book — so an ICT or
      // Computer Science cover gets a chip package with pin ticks, a few via
      // pads, and trace lines running off toward the page edges and down the
      // side margin. Everything stays in the same faint white/accent family and
      // the same corners the rings occupied (top-right, bottom-left), so the
      // masthead and hero card sit on top of it exactly as before.
      //
      // `v` varies the art a little from book to book, so ICT, Computer Science
      // and any future computing title are recognisably the same family without
      // being the same picture. It is derived from the subject name rather than
      // randomised, so a given book's cover is stable across rebuilds and a
      // Learner's Book matches its own Teacher's Guide (both carry the same
      // subject; only `booktype` differs).
      #if T.motif == "circuit" [
        #let v = calc.rem(subject.len(), 3)
        #let trace = stroke(paint: white.transparentize(72%), thickness: 1pt, cap: "round", join: "round")
        #let faint = stroke(paint: white.transparentize(84%), thickness: 0.8pt, cap: "round", join: "round")
        #let trail = stroke(paint: white.transparentize(80%), thickness: 1pt, cap: "round", dash: "dotted")
        // pads are placed by their CENTRE, unlike Typst's top-left default for
        // `place` + `circle`, so the geometry below reads as coordinates on the
        // trace rather than as corner offsets.
        #let pad(x, y, r, c) = place(top + left, dx: x - r, dy: y - r, circle(radius: r, fill: c))
        #let ring(x, y, r, c) = place(top + left, dx: x - r, dy: y - r, circle(radius: r, fill: none, stroke: 1.1pt + c))
        #let seg(x1, y1, x2, y2, s) = place(top + left, line(start: (x1, y1), end: (x2, y2), stroke: s))

        // ---- top-right: the chip package ----
        // Sized/nudged per book; the pin ticks always run down its left edge and
        // along its bottom, which is what makes it read as a chip rather than a
        // plain rectangle.
        #let cx = if v == 1 { 128mm } else { 133mm }
        #let cy = if v == 2 { 16mm } else { 11mm }
        #let cw2 = if v == 1 { 32mm } else { 27mm }
        #let chh = if v == 2 { 16mm } else { 21mm }
        #place(top + left, dx: cx, dy: cy, rect(width: cw2, height: chh, radius: 1.5mm, fill: none, stroke: trace))
        #for i in range(0, 4) {
          seg(cx - 5mm, cy + 4mm + i * 4.5mm, cx, cy + 4mm + i * 4.5mm, faint)
        }
        #for i in range(0, 3) {
          seg(cx + 6mm + i * 7mm, cy + chh, cx + 6mm + i * 7mm, cy + chh + 4mm, faint)
        }
        // traces off the chip to the page edges
        #seg(cx + cw2, cy + 7mm, 176mm, cy + 7mm, trace)
        #seg(cx + 9mm, cy, cx + 9mm, 0mm, faint)
        // The elbow leaves the chip on its RIGHT side and drops down the right
        // MARGIN, not back across the page. Routed inward (an earlier version ran
        // it down x = cx - 18mm) it crossed the centred masthead, and the dotted
        // trail read as a line ruled through "COMMUNICATION" / "TECHNOLOGY". The
        // masthead block is 158mm wide on a 176mm page, so only the outer ~9mm is
        // reliably clear of title glyphs -- hence x: 171mm, and a stop well above
        // the hero card.
        #let ey = cy + chh - 4mm
        #seg(cx + cw2, ey, 171mm, ey, trace)
        #pad(171mm, ey, 1.5mm, T.accent.transparentize(35%))
        #seg(171mm, ey, 171mm, if v == 0 { 96mm } else { 84mm }, trail)
        #ring(cx + cw2 - 4mm, cy + 4mm, 1.6mm, amber.transparentize(30%))

        // ---- bottom-left: a smaller gadget (a screen/tablet outline) ----
        // Mirrors the corner the old lower ring sat in, so the cover keeps its
        // diagonal balance. v picks whether it reads as a tablet or a small
        // hand-held, which is the most visible of the per-book differences.
        #let gx = 12mm
        // v2 sits its gadget LANDSCAPE, so it needs a little more headroom than the
        // portrait variants to clear the hero card, whose bottom edge is ~196mm.
        #let gy = if v == 2 { 201mm } else { 202mm }
        #let gw = if v == 2 { 30mm } else { 22mm }
        #let gh = if v == 2 { 20mm } else { 30mm }
        #place(top + left, dx: gx, dy: gy, rect(width: gw, height: gh, radius: 2mm, fill: none, stroke: trace))
        #place(top + left, dx: gx + 2.5mm, dy: gy + 3mm, rect(width: gw - 5mm, height: gh - 8mm, radius: 0.8mm, fill: white.transparentize(93%), stroke: faint))
        #pad(gx + gw / 2, gy + gh - 2.5mm, 1.1mm, white.transparentize(55%))
        // traces leaving the gadget toward the page edges
        #seg(gx, gy + 8mm, 0mm, gy + 8mm, faint)
        #seg(gx + gw, gy + gh - 6mm, gx + gw + 12mm, gy + gh - 6mm, trace)
        #pad(gx + gw + 12mm, gy + gh - 6mm, 1.5mm, T.accent.transparentize(45%))
        #seg(gx + gw + 12mm, gy + gh - 6mm, gx + gw + 12mm, 250mm, trail)
        // a couple of loose vias in the open field, so the two corners read as
        // parts of one board rather than two isolated drawings
        #pad(26mm, gy - 14mm, 1.3mm, white.transparentize(62%))
        #pad(if v == 1 { 40mm } else { 34mm }, gy - 26mm, 1mm, white.transparentize(70%))
      ]
      // MUSICAL ARTS (notes): a scatter of small colourful eighth/beamed notes in the
      // open blue field around the masthead and hero photo — echoes the manuscript's
      // own note-and-staff illustration without drawing on top of the photo itself.
      #if T.motif == "notes" [
        #place(top + left, dx: 14mm, dy: 14mm, rotate(-12deg, text(size: 26pt, fill: white.transparentize(25%))[♪]))
        #place(top + right, dx: -14mm, dy: 46mm, rotate(10deg, text(size: 22pt, fill: amber.transparentize(10%))[♬]))
        #place(bottom + left, dx: 12mm, dy: -96mm, rotate(8deg, text(size: 24pt, fill: T.cyan.transparentize(10%))[♫]))
        #place(bottom + right, dx: -16mm, dy: -30mm, rotate(-8deg, text(size: 22pt, fill: white.transparentize(30%))[♪]))
      ]
      // masthead — CENTRED with the SAME rhythm as the English cover (eyebrow,
      // title, an accent rule, the form tag, then the book type). par spacing is
      // zeroed so the explicit #v values fully control the layout.
      // justify: false — a cover title that wraps must stay ragged-centred. Justified,
      // a two-word first line is stretched to the full 158mm ("INFORMATION      AND"),
      // which reads as broken. Only bites once a subject is long enough to wrap, so it
      // went unnoticed until a book with a long name ("Information and Communication
      // Technology") came through.
      #let mastheadBlock = block(width: 158mm)[#set par(spacing: 0pt, justify: false); #align(center)[
        #text(size: 14pt, weight: "bold", fill: amber, tracking: 3pt)[#upper(T.eyebrow)]
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
      ]]
      #place(top + center, dy: 22mm, mastheadBlock)
      // hero photo (straight, white frame) when present; otherwise a central
      // "atom" motif (nucleus + elliptical orbits + electrons) fills the field.
      // The hero photo and the masthead above used to sit at INDEPENDENT fixed
      // offsets, which worked as long as the title was a short single word
      // (Physics, Chemistry) — but an Advanced Level cover's big title is the
      // long generic "Advanced Secondary Education Level" phrase (verbatim
      // from the manuscript's own title page, not the subject name), which
      // wraps to 3 lines and pushed past the fixed hero offset, so the photo
      // landed on top of the "Teacher's Guide" line below it. Measuring the
      // masthead's actual rendered height and only pushing the hero (and the
      // byline below it) down when it would otherwise collide keeps every
      // existing short-title cover pixel-identical while fixing the
      // long-title case.
      #let heroBaseDy = if T.motif == "flask" { 104mm } else { 110mm }
      #let earthCard = T.motif == "earth" and byline.len() > 0
      #context {
        let mastheadH = measure(mastheadBlock).height
        let heroDy = calc.max(heroBaseDy, 22mm + mastheadH + 8mm)
        if hero != none and T.motif == "flask" {
          // CHEMISTRY hero: a clean 3:2 landscape plate in a simple white frame, with a
          // slim amber accent bar sitting just above it. No motif.
          place(top + center, dy: heroDy, box(width: 148mm, height: 78mm, clip: true, radius: 3pt, stroke: 4pt + white)[
            #image("_media/" + hero.file, width: 100%, height: 78mm, fit: "cover")])
          place(top + center, dy: heroDy - 6mm, box(fill: amber, width: 148mm, height: 3pt, radius: 1.5pt))
        } else if hero != none {
          place(top + center, dy: heroDy, box(width: 144mm, height: 78mm, clip: true, radius: 2pt, stroke: 3pt + white)[
            #image("_media/" + hero.file, width: 100%, height: 78mm, fit: "cover")])
        } else if T.motif == "cell" {
          // biology: a stylised CELL — membrane, nucleus + nucleolus, and a few
          // organelles (mitochondria-like ellipses) and free dots.
          place(top + center, dy: 104mm, box(width: 96mm, height: 72mm)[
            #place(center + horizon, circle(radius: 33mm, fill: white.transparentize(94%), stroke: 1.4pt + white.transparentize(45%)))
            #place(center + horizon, dx: 5mm, dy: -3mm, circle(radius: 12mm, fill: T.cyan.transparentize(55%), stroke: 1.2pt + T.cyan.transparentize(15%)))
            #place(center + horizon, dx: 8mm, dy: -5mm, circle(radius: 3.2mm, fill: white.transparentize(20%)))
            #place(center + horizon, dx: -16mm, dy: 9mm, rotate(25deg, ellipse(width: 13mm, height: 5mm, fill: none, stroke: 1pt + white.transparentize(50%))))
            #place(center + horizon, dx: -11mm, dy: -14mm, rotate(-30deg, ellipse(width: 10mm, height: 4mm, fill: none, stroke: 1pt + white.transparentize(58%))))
            #place(center + horizon, dx: 17mm, dy: 14mm, circle(radius: 2.2mm, fill: amber))
            #place(center + horizon, dx: 19mm, dy: -13mm, circle(radius: 1.6mm, fill: white.transparentize(40%)))
            #place(center + horizon, dx: -21mm, dy: -4mm, circle(radius: 1.4mm, fill: amber.lighten(15%)))
          ])
        } else if T.motif == "flask" {
          // chemistry: a conical (Erlenmeyer) flask with a rising bubble stream — a
          // clean laboratory identity distinct from the physics orbits and the biology
          // cell. No benzene-ring hexagon (the locked chemistry design drops hexagons
          // everywhere); the flask is centred on the page on its own.
          place(top + center, dy: 104mm, box(width: 100mm, height: 74mm)[
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
        } else {
          place(top + center, dy: 108mm, box(width: 90mm, height: 64mm)[
            #place(center + horizon, ellipse(width: 86mm, height: 30mm, fill: none, stroke: 1.2pt + white.transparentize(40%)))
            #place(center + horizon, rotate(60deg, ellipse(width: 86mm, height: 30mm, fill: none, stroke: 1.2pt + white.transparentize(40%))))
            #place(center + horizon, rotate(-60deg, ellipse(width: 86mm, height: 30mm, fill: none, stroke: 1.2pt + amber.transparentize(20%))))
            #place(center + horizon, circle(radius: 5mm, fill: amber))
            #place(center + horizon, dx: 43mm, circle(radius: 2mm, fill: white))
            #place(center + horizon, dx: -21mm, dy: -23mm, circle(radius: 2mm, fill: white))
            #place(center + horizon, dx: -22mm, dy: 24mm, circle(radius: 2mm, fill: amber.lighten(15%)))
          ])
        }
        // authors (small, wraps if long), then publisher + logo. Full-opacity,
        // semibold text — a lightly transparentized white read fine on the
        // original deep indigo/purple/navy science covers but washes out to a
        // pale, hard-to-read grey-green on a lighter/more saturated field like
        // Grade 6 Science's green, so this is no longer transparentized at all.
        let bylineBlock = block(width: 152mm)[#align(center)[
          #text(size: 9pt, weight: "bold", fill: amber, tracking: 3pt)[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          #v(2mm)
          #text(size: 10.5pt, weight: "semibold", fill: white)[#byline.join("    •    ")]]]
        if earthCard {
          // GRADE 6 SCIENCE (earth): a soft, rounded, barely-there card behind the
          // author credit — the cover otherwise being one flat colour field reads
          // a bit plain/severe for a primary-school audience, and this lifts the
          // (often long) author list off the green rather than leaving it to
          // float directly on the field. The card used to sit at a fixed dy
          // flush against the photo's bottom edge (no gap) with a fixed 42mm
          // height that a long author list (this format regularly lists a dozen
          // contributors) overflowed — spilling text past the card into the
          // logo/publisher line below it. Both are now measured/derived: a real
          // gap under the photo, and a height that actually fits the byline, with
          // the logo+publisher line placed below the card's own bottom edge
          // instead of pinned to the page bottom, so it never overlaps.
          // The cover page is only 250mm tall (not A4) and this sits below a
          // 78mm-tall photo already 110mm+ down the page, so every gap here is
          // kept deliberately tight — a generous padding budget (that reads fine
          // on a full A4 page) pushed the logo/publisher line off the bottom
          // edge of this shorter page entirely.
          let bylineH = measure(bylineBlock).height
          let cardTop = heroDy + 78mm + 5mm
          let cardH = bylineH + 8mm
          place(top + center, dy: cardTop, box(width: 164mm, height: cardH, radius: 6mm, fill: white.transparentize(88%), stroke: 1pt + white.transparentize(75%)))
          place(top + center, dy: cardTop + 4mm, bylineBlock)
          place(top + center, dy: cardTop + cardH + 5mm, align(center)[
            #if logo != none [ #image("_media/" + logo.file, height: 11mm) #v(2mm) ]
            #text(size: 10.5pt, weight: "bold", fill: white)[Zambia Educational Publishing House]
          ])
        } else if byline.len() > 0 {
          let bylineDy = if hero != none { calc.max(196mm, heroDy + 78mm + 10mm) } else { 196mm }
          place(top + center, dy: bylineDy, bylineBlock)
        }
      }
      #if not earthCard [
        #place(bottom + center, dy: -12mm, align(center)[
          #if logo != none [ #image("_media/" + logo.file, height: 11mm) #v(2mm) ]
          #text(size: 10.5pt, weight: "bold", fill: white)[Zambia Educational Publishing House]
        ])
      ]
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
        #if logo != none [ #image("_media/" + logo.file, height: 12mm) #v(2mm) ]
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
      // publisher + logo
      #place(bottom + center, dy: -12mm, align(center)[
        #if logo != none [ #image("_media/" + logo.file, height: 12mm) #v(2mm) ]
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
        #if logo != none [ #image("_media/" + logo.file, height: 11mm) #v(1.5mm) ]
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
        #if logo != none [ #image("_media/" + logo.file, height: 10mm) #v(1mm) ]
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
        #if logo != none [ #image("_media/" + logo.file, height: 12mm) #v(2mm) ]
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
        #if T.motif == "food" [
          #berrycluster(18mm, 96mm, T.accent, T.primary2, T.cyan)
          #berrycluster(148mm, 96mm, T.primary2, T.accent, T.cyan)
        ]
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
      // --- publisher + logo, bottom centre ---
      #place(bottom + center, dy: -13mm, align(center)[
        #if logo != none [ #image("_media/" + logo.file, height: 12mm) #v(2mm) ]
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
            #text(fill: T.accent, size: 10pt, tracking: 3pt)[#smallcaps[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]]
            \ #v(1pt) #text(size: 12.5pt, weight: "bold")[#byline.join(", ")]
          ]
          #if logo != none [ #v(4mm) #image("_media/" + logo.file, height: 11mm) ]
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
          #block(width: 170mm)[#align(center)[
            #text(fill: T.accent, size: 10pt, tracking: 3pt)[#smallcaps[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]] \ #v(1pt)
            #text(fill: T.primary, size: 12.5pt, weight: "bold")[#byline.join(", ")]]]
        ]
        #if logo != none [ #v(4mm) #image("_media/" + logo.file, height: 11mm) ]
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

    #if T.motif == "circuit" [
      // TECHNOLOGY STUDIES ONLY: a faint perfboard-style dot grid across the
      // WHOLE cover, drawn FIRST — before the wash/circles/corner traces/
      // title — so every later element simply layers on top of it and needs
      // no manual avoidance. Without this, the wide plain-colour field
      // between the title and the photo card (the same empty band noted in
      // pcbcorner's comment below) read as generic "light blue" rather than
      // anything tech-specific. A subtle dot grid is the standard shorthand
      // for a circuit board / graph-paper look without going dark or busy —
      // this is a Grade 6 cover, so it stays barely-there (93% transparent).
      #let dotgrid(step, r, op) = {
        for gx in range(0, 16) {
          for gy in range(0, 22) {
            place(top + left, dx: gx * step, dy: gy * step, circle(radius: r, fill: white.transparentize(op)))
          }
        }
      }
      #dotgrid(14mm, 0.4mm, 93%)
    ]

    // ---------- background geometry ----------
    // A symmetric chevron wash (peaks at centre) echoes the centred title below it,
    // instead of the old one-sided ramp that was shaped for a left-aligned title.
    #place(top + left, dx: 0pt, dy: 0pt, polygon(fill: white.transparentize(93%),
      (0mm, 0mm), (210mm, 0mm), (210mm, 90mm), (105mm, 112mm), (0mm, 90mm)))
    #place(bottom + right, dx: 40mm, dy: 40mm, circle(radius: 70mm, fill: white.transparentize(95%)))
    #place(bottom + left, dx: -38mm, dy: 30mm, circle(radius: 48mm, fill: T.accent.transparentize(86%)))
    #if T.motif != "circuit" [
      // concentric "orbit" rings, mirrored on both top corners so they bracket the
      // centred tagline/title symmetrically instead of sitting only on one side.
      #place(top + right, dx: 26mm, dy: -30mm, circle(radius: 50mm, fill: none, stroke: 1pt + white.transparentize(72%)))
      #place(top + right, dx: 26mm, dy: -30mm, circle(radius: 37mm, fill: none, stroke: 1pt + white.transparentize(80%)))
      #place(top + right, dx: 26mm, dy: -30mm, circle(radius: 24mm, fill: none, stroke: 1.4pt + T.accent.transparentize(45%)))
      #place(top + left, dx: -26mm, dy: -30mm, circle(radius: 50mm, fill: none, stroke: 1pt + white.transparentize(72%)))
      #place(top + left, dx: -26mm, dy: -30mm, circle(radius: 37mm, fill: none, stroke: 1pt + white.transparentize(80%)))
      #place(top + left, dx: -26mm, dy: -30mm, circle(radius: 24mm, fill: none, stroke: 1.4pt + T.accent.transparentize(45%)))
    ] else [
      // TECHNOLOGY STUDIES ONLY: right-angle PCB-trace lines with via pads, in
      // all FOUR corners, in place of the generic "orbit" rings above (which
      // read as planets/astronomy, not computing — the whole point of this
      // theme's corner decoration). Every other theme keeps the plain rings.
      //
      // This branch's page has NO explicit width/height (unlike most of the
      // other cover branches, which pin 176mm×250mm) — it inherits T.paper,
      // which for `tech` defaults to plain A4 (210mm×297mm; confirmed via
      // `pdfinfo` on an actual typeset PDF), not the 176×250 assumed by an
      // earlier version of this code, which made the "mirrored" corners
      // literally asymmetric and put the bottom pair on top of the footer
      // text. `pcbcorner` mirrors ONE base shape (defined in insets from the
      // top-left) across the true page box. The corner elbow itself stays
      // within 12mm of its corner (clear of the tagline, which starts
      // y: 24mm); a second, dotted trace then runs on down the SIDE margin
      // (x: 13mm / 197mm) to flank the hero photo card, which this cover
      // centres at roughly x: 30mm–180mm, y: 111mm–196mm — the trace stops
      // ~15mm short of the card on every side, so it reads as "leading
      // toward" the photo without ever touching it or the footer block
      // (bottom edge y: 297mm − 16mm = 281mm).
      //
      // Rounded caps/joins + a dotted (not solid) run + higher transparency
      // throughout is deliberate: solid sharp-cornered traces read as an
      // adult PCB schematic, and this cover is for a Grade 6 kids' book —
      // softened into a faint, friendly "dot-trail" instead.
      #let cw = 210mm
      #let ch = 297mm
      #let softline = stroke(paint: white.transparentize(72%), thickness: 1pt, cap: "round", join: "round")
      #let dotline = stroke(paint: white.transparentize(78%), thickness: 1.1pt, cap: "round", dash: "dotted")
      #let pcbcorner(flipx, flipy) = {
        let mx(v) = if flipx { cw - v } else { v }
        let my(v) = if flipy { ch - v } else { v }
        let pt(x, y) = (mx(x), my(y))
        place(top + left, line(start: pt(24mm, 3mm), end: pt(24mm, 9mm), stroke: softline))
        place(top + left, line(start: pt(24mm, 9mm), end: pt(13mm, 9mm), stroke: softline))
        place(top + left, line(start: pt(13mm, 9mm), end: pt(13mm, 12mm), stroke: softline))
        // extension toward the hero photo's side, drawn as a soft dotted trail
        place(top + left, line(start: pt(13mm, 12mm), end: pt(13mm, 95mm), stroke: dotline))
        place(top + left, dx: mx(24mm), dy: my(3mm), circle(radius: 1.4mm, fill: none, stroke: 1pt + T.accent.transparentize(45%)))
        place(top + left, dx: mx(24mm), dy: my(9mm), circle(radius: 1.3mm, fill: white.transparentize(55%)))
        place(top + left, dx: mx(13mm), dy: my(9mm), circle(radius: 1.3mm, fill: white.transparentize(55%)))
        place(top + left, dx: mx(13mm), dy: my(12mm), circle(radius: 1.4mm, fill: T.accent.transparentize(40%)))
        place(top + left, dx: mx(13mm), dy: my(95mm), circle(radius: 1.8mm, fill: T.accent.transparentize(55%)))
        place(top + left, line(start: pt(5mm, 6mm), end: pt(16mm, 6mm), stroke: (paint: white.transparentize(80%), thickness: 0.8pt, cap: "round")))
        place(top + left, dx: mx(5mm), dy: my(6mm), circle(radius: 0.9mm, fill: white.transparentize(60%)))
      }
      #pcbcorner(false, false)
      #pcbcorner(true, false)
      #pcbcorner(false, true)
      #pcbcorner(true, true)
    ]
    // circuit nodes + dots, mirrored left/right so they balance around the centreline
    #cnode(20mm, 18mm, T.accent)
    #cnode(190mm, 18mm, T.accent)
    #cnode(60mm, 60mm, white.transparentize(35%), r: 1.9mm)
    #cnode(150mm, 60mm, white.transparentize(35%), r: 1.9mm)
    #cdot(40mm, 30mm, white.transparentize(40%))
    #cdot(170mm, 30mm, white.transparentize(40%))
    #cdot(28mm, 52mm, white.transparentize(55%))
    #cdot(182mm, 52mm, white.transparentize(55%))
    #if T.motif == "circuit" [
      // TECHNOLOGY STUDIES ONLY: connect the nodes/dots above into an actual
      // wandering circuit path (they otherwise float unconnected) and carry
      // it on down into the open band toward the photo card, mirroring the
      // side trails pcbcorner already runs from the corners — together they
      // fill what used to be a plain empty stretch of blue with a proper
      // "this is a circuit board" read, at the same faint opacity as the rest
      // of the motif so it stays in the background, not competing with text.
      #let ctrace = stroke(paint: white.transparentize(82%), thickness: 0.8pt, cap: "round", join: "round")
      #place(top + left, line(start: (20mm, 18mm), end: (40mm, 30mm), stroke: ctrace))
      #place(top + left, line(start: (40mm, 30mm), end: (28mm, 52mm), stroke: ctrace))
      #place(top + left, line(start: (28mm, 52mm), end: (60mm, 60mm), stroke: ctrace))
      #place(top + left, line(start: (60mm, 60mm), end: (60mm, 98mm), stroke: ctrace))
      #place(top + left, dx: 60mm, dy: 98mm, circle(radius: 1.4mm, fill: T.accent.transparentize(60%)))
      #place(top + left, line(start: (190mm, 18mm), end: (170mm, 30mm), stroke: ctrace))
      #place(top + left, line(start: (170mm, 30mm), end: (182mm, 52mm), stroke: ctrace))
      #place(top + left, line(start: (182mm, 52mm), end: (150mm, 60mm), stroke: ctrace))
      #place(top + left, line(start: (150mm, 60mm), end: (150mm, 98mm), stroke: ctrace))
      #place(top + left, dx: 150mm, dy: 98mm, circle(radius: 1.4mm, fill: T.accent.transparentize(60%)))
    ]

    // ---------- title block (centred, matching the rest of the cover) ----------
    #place(top + center, dy: 24mm, block(width: 160mm)[#align(center)[
      #if T.tagline != "" [ #text(size: 11pt, weight: "bold", tracking: 6pt, fill: T.accent)[#T.tagline] #v(5mm) ]
      #text(size: 40pt, weight: "bold")[#upper(subject)]
      #v(3mm)
      #box(fill: T.accent, width: 56mm, height: 3.5pt, radius: 2pt)
    ]])

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
        #block(width: 170mm)[#align(center)[
          #text(size: 10pt, tracking: 4pt, fill: T.accent, weight: "bold")[#if byline.len() == 1 { "AUTHOR" } else { "AUTHORS" }]
          \ #v(1pt) #text(size: 14pt, weight: "bold")[#byline.join(", ")]]]
      ]
      #if logo != none [ #v(4mm) #image("_media/" + logo.file, height: 12mm) ]
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
  // ---------- SYLLABUS back cover: solid subject field + a RESERVED white ISBN/barcode
  // box + the "Printed by / Zambia Educational Publishing House" imprint. A4 landscape. --
  if syllabus {
    let field = T.covSignature
    let ftext = T.at("covText", default: white)
    return {
      page(paper: "a4", flipped: true, margin: 0pt, header: none, footer: none, fill: field)[
        #place(top + center, dy: 40mm, box(width: 120mm, height: 34mm, fill: white, stroke: 0.75pt + rgb("#cccccc"))[
          #set align(center + horizon)
          #{
            if isbn != none { text(font: T.bodyFont, size: 13pt, fill: black)[ISBN #isbn] }
            else { text(font: T.bodyFont, size: 10pt, fill: rgb("#999999"))[ISBN / barcode] }
          }
        ])
        #place(bottom + center, dy: -30mm, box(width: 160mm)[
          #set align(center)
          #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: ftext)[Printed by] #linebreak()
          #text(font: T.bodyFont, size: 13pt, weight: "bold", fill: ftext)[Zambia Educational Publishing House]
        ])
      ]
    }
  }
  let subject = lines.at(0, default: "")
  let grade = lines.find(l => hasGradeWord(l))
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
      not hasGradeWord(l) and upper(l).trim() != "SECONDARY EDUCATION ORDINARY LEVEL")
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
  let eyebrow = if hasGradeWord(rawsub) or (rawsub == name) { T.eyebrow } else { rawsub }
  // signature-colour dominant, mirroring the front.
  page(margin: 0pt, header: none, footer: none, fill: signature, width: 176mm, height: 250mm)[
    #set text(font: T.displayFont)
    // corner wedges
    #place(top + left, polygon(fill: accentc, (0mm, 250mm), (0mm, 197mm), (59mm, 250mm)))
    #place(top + left, polygon(fill: accentc, (176mm, 250mm), (176mm, 215mm), (137mm, 250mm)))
    // MUSICAL ARTS (notes): the same scattered colourful note glyphs as the front
    // cover, echoed here in the open field so front and back read as one set.
    #if T.motif == "notes" [
      #place(top + left, dx: 20mm, dy: 60mm, rotate(-10deg, text(size: 22pt, fill: onfield.transparentize(20%))[♪]))
      #place(top + right, dx: -22mm, dy: 62mm, rotate(10deg, text(size: 20pt, fill: accentc.transparentize(10%))[♬]))
      #place(bottom + left, dx: 24mm, dy: -70mm, rotate(8deg, text(size: 20pt, fill: onfield.transparentize(25%))[♫]))
      #place(bottom + right, dx: -26mm, dy: -70mm, rotate(-8deg, text(size: 22pt, fill: accentc.transparentize(10%))[♪]))
    ]
    // book identity — CENTRED (every element on the back cover reads centred,
    // matching the publisher branding block below it).
    #place(top + center, dy: 20mm, block(width: 144mm)[#align(center)[
      #text(size: 11pt, weight: "bold", fill: onfield, tracking: 1.5pt)[#upper(eyebrow)]
      #v(3mm)
      // Subject on its own line — scaled down to fit if a long subject name
      // would otherwise overflow the block.
      #layout(sz => {
        let ttl = box(text(size: 26pt, weight: "bold", fill: onfield)[#name])
        let m = measure(ttl)
        if m.width > sz.width and m.width > 0pt {
          scale(x: sz.width / m.width * 100%, y: sz.width / m.width * 100%, reflow: true, origin: left + horizon, ttl)
        } else { ttl }
      })
      // Form/grade on its OWN line, between the subject and the book type.
      #if formtxt != "" [
        #v(2mm)
        #text(size: 16pt, weight: "bold", fill: accentc)[#upper(formtxt)]
      ]
      #v(1mm)
      #text(size: 13pt, weight: "bold", fill: onfield)[#upper(booktype)]
      #v(3mm)
      #box(fill: accentc, width: 34mm, height: 2.5pt, radius: 1.5pt)
    ]])
    // publisher branding, centred
    #place(top + center, dy: 120mm, align(center)[
      #if logo != none [ #image("_media/" + logo.file, height: 20mm) #v(4mm) ]
      #text(size: 14pt, weight: "bold", fill: onfield)[Zambia Educational Publishing House]
      #v(1mm)
      #text(size: 11pt, fill: pubsub)[Lusaka, Zambia]
    ])
    // ISBN: if known, print it (no barcode); otherwise reserve a clean box for
    // the press to add the ISBN + barcode at print time. CENTRED, like every
    // other element on the back cover — sitting on the page's centre line also
    // keeps it well clear of both bottom corner wedges (see "corner wedges"
    // above: triangles from (0,197mm)-(0,250mm)-(59,250mm) and the mirrored one
    // on the right), which only reach in from the left/right edges.
    #if isbn != none [
      #place(bottom + center, dy: -43mm, text(size: 11pt, weight: "bold", fill: onfield)[ISBN #isbn])
    ] else [
      #place(bottom + center, dy: -45mm, box(width: 52mm, height: 26mm, fill: white, stroke: 0.7pt + luma(60%), radius: 1pt)[
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
// A word carrying an INTERNAL capital is a product or brand name — WinRAR, PowerISO,
// PeaZip, JavaScript, iPhone — and print convention does not break those: "Win-RAR"
// and "Pow-erISO" read as two words or a typo, not as the product. (Both appeared in
// the ICT Form 2 Learner's Book's narrow "Tool" column.) Turn hyphenation off for just
// those words, so the whole name moves to the next line instead.
//
// `text(hyphenate: false)` rather than `box()`: it still allows a normal break at the
// spaces either side, so such a name can only overflow where the measure is narrower
// than the name itself. Body text is never that narrow; a table column can be, so
// cells use nohyphcell() below instead of this.
//
// Ordinary words are untouched (they carry no internal capital) and the split only
// runs on a string that actually contains one, so the common path is unchanged. An
// acronym ("ICT", "ZIP") has no lower-to-upper step and never matches.
#let camelRe = regex("[a-z][A-Z]")
#let nohyph(p) = if p.find(camelRe) == none { [#p] } else {
  p.split(" ").map(t => if t.find(camelRe) == none { [#t] } else {
    text(hyphenate: false)[#t]
  }).join(" ")
}

// The TABLE-CELL flavour. A table column is a far narrower measure than the body
// text, and simply refusing to hyphenate can leave a name wider than its column, so
// it overruns the neighbouring cell ("WinRARCompress and extract...") — which is
// worse than the hyphen it replaced. So in a cell the name also gets a zero-width
// space at each internal capital: a real break opportunity that prints NOTHING.
// dtable's camel floor below is what normally keeps such a name whole; this is the
// fallback for when even that is not enough, and it degrades to "Power" / "ISO"
// rather than to "Pow-" / "erISO" or to an overflow across the cell border.
#let camelBreak(t) = t.replace(regex("([a-z])([A-Z])"), m => m.captures.at(0) + "\u{200B}" + m.captures.at(1))
#let nohyphcell(p) = if p.find(camelRe) == none { [#p] } else {
  p.split(" ").map(t => if t.find(camelRe) == none { [#t] } else {
    text(hyphenate: false)[#camelBreak(t)]
  }).join(" ")
}
#let seg(s) = {
  // A zero-content "fill to the edge" marker (see splitMarksToFr in typeset-docx.js):
  // inserted right before every mark-allocation bracket ("[1]", "[2 marks]") so the
  // bracket sits flush against the right edge of the text column instead of glued
  // right after the sentence — the fractional space consumes whatever room is left
  // on the current line, pushing the bracket to the end of it and wrapping whatever
  // comes after onto a fresh line, exam-paper style.
  if s.at("fr", default: false) { return h(1fr) }
  // Forces the text after a MID-sentence mark bracket onto a fresh line (see
  // splitMarksToFr) — a plain fr-space alone only visibly pushes to the edge when
  // it's already the last thing on the line; with more real text still to come on
  // the SAME line, Typst just collapses it to near-zero instead of breaking.
  if s.at("brk", default: false) { return linebreak() }
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
    let body = src.split("\n").map(p => nohyph(p)).join(linebreak())
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
// A dedicated "\n"-only seg (no other content) marks a fold-in line break between
// two originally-separate paragraphs (e.g. each step of a worked answer joined into
// one highlighted "Possible answer:" run). A bare linebreak() there uses the
// document's fixed par leading (0.66em, tuned for plain text) with no allowance for
// a TALL inline formula — a stacked fraction ("Ek = 1/2 × 4 × 12²") on either side of
// the break then collides with the adjacent line's glyphs instead of sitting cleanly
// below/above it (seen on the Physics Form 2 TG's Exercise 2, item 2(b): the fraction
// bar of one line overlapped the numerator "1" of the next). Widen just that one
// break with a little extra vertical space whenever either neighbouring seg carries
// inline (non-display) math, since a plain-text-only run already fits the fixed
// leading and doesn't need it.
#let segs(ss) = {
  let inlineMath(s) = s != none and s.at("m", default: false) and not s.at("display", default: false)
  ss.enumerate().map(((i, s)) => {
    if s.at("t", default: none) == "\n" and not s.at("m", default: false) {
      let prev = if i > 0 { ss.at(i - 1) } else { none }
      let next = if i + 1 < ss.len() { ss.at(i + 1) } else { none }
      if inlineMath(prev) or inlineMath(next) { v(4pt, weak: true); linebreak() } else { seg(s) }
    } else { seg(s) }
  }).join()
}
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
// hyphenate: false skips Typst's hyphenation dictionary for this paragraph. Used for
// the imprint/credits page, where a short centred line of proper names ("Precious
// Sapanoi") has no justification to gain from hyphenating and a dictionary match on
// an ordinary-word name (Precious -> "Pre-cious") reads as a typo, not a line break.
#let para(ss, align: none, drop: false, hyphenate: true) = {
  set text(hyphenate: hyphenate)
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
  // A numbered/lettered marker used to be bold unconditionally — right for the
  // common case (a bold numbered step), but it left the marker visibly bolder
  // than its OWN item text wherever the manuscript's list content is plain/italic
  // (e.g. an activity's instruction steps), a mismatch a reviewer flagged as
  // stray bold to remove. Match the marker's weight to the item's own first run
  // instead of forcing bold, so it always agrees with its text.
  let firstseg = ss.find(s => s.t.trim() != "")
  let contentBold = firstseg != none and firstseg.at("b", default: false)
  grid(columns: (auto, 1fr), column-gutter: 7pt, align: (left + top, left + top),
    text(fill: if isbullet { iaccent2 } else { T.primary }, weight: if isbullet { "regular" } else if contentBold { "bold" } else { "regular" })[#marker],
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
  } else if science and T.motif == "earth" {
    // GRADE 6 SCIENCE: earth-green banner — the topic number in an energetic-
    // orange chip, an orange "TOPIC" eyebrow, white title. The generic
    // fallback below (physics' look) uses T.cyan for the chip/eyebrow, which
    // reads as a dull blue-on-green here rather than the crisp cyan-on-indigo
    // it was designed for — orange (already this theme's accent) instead.
    v(2pt)
    block(width: 100%, breakable: false, radius: 6pt, fill: T.primary, inset: (x: 14pt, y: 12pt))[
      #grid(columns: (auto, 1fr), column-gutter: 14pt, align: (horizon, horizon),
        box(fill: T.accent, inset: (x: 11pt, y: 7pt), radius: 5pt)[
          #text(fill: T.primary.darken(10%), size: fs(22pt), weight: "bold")[#no]],
        [#text(fill: T.accent, size: fs(8pt), weight: "bold", tracking: 5pt)[TOPIC]
         #v(-3pt)
         #text(fill: white, size: hm(16pt), weight: "bold")[#title]])]
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
// SYLLABUS imprint block — the ISBN + publisher/address + printer, centred, under the
// copyright paragraph on the copyright page (mirrors the reference imprint page).
#let imprint(year, isbn) = {
  let isbnText = if isbn != none { isbn } else { "...................." }
  v(40pt)
  align(center, {
    set text(font: T.bodyFont, size: 12pt, fill: T.ink)
    [*ISBN:* #isbnText]
    v(20pt)
    [First Published #year by \
     Zambia Educational Publishing House \
     Light Industrial Area \
     Chishango Road \
     P.O. BOX 32708 \
     Lusaka Zambia]
    v(20pt)
    [Printed by: \
     *Zambia Educational Publishing House (ZEPH)*]
  })
}

// SYLLABUS section divider — a page carrying only the education level, where the arabic
// body numbering BEGINS (so it prints "1"). Styled as a centred band framed by a double
// rule top AND bottom (echoing the footer's double-rule motif) — a distinct treatment.
// It keeps the document footer (so the page number shows), only dropping the header.
#let divider(txt) = {
  page(paper: "a4", flipped: true, header: none)[
    #place(center + horizon, block(width: 205mm)[
      #set align(center)
      #line(length: 100%, stroke: 2.4pt + T.ink)
      #v(2.5pt)
      #line(length: 100%, stroke: 0.8pt + T.ink)
      #v(13mm)
      #text(font: T.displayFont, size: 30pt, weight: "bold", fill: T.ink, tracking: 2.5pt)[#upper(txt)]
      #v(13mm)
      #line(length: 100%, stroke: 0.8pt + T.ink)
      #v(2.5pt)
      #line(length: 100%, stroke: 2.4pt + T.ink)
    ])
  ]
}

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
#let subhead(t, nobrk: false) = {
  // Every Sub-Topic starts its own fresh page, same house-style rule as Topics
  // (topicbanner above) — a Sub-Topic heading must never land as a widow at the
  // foot of the page its parent Topic's overview text happened to fill. In a
  // SYLLABUS, though, only the YEAR banners get that treatment; the front-matter
  // sub-sections (Methodologies, Assessment, CBA, Time Allocation…) FLOW as normal
  // headings under their parent section (Introduction), so they don't page-break.
  let isyear = syllabus and t.trim().match(regex("(?i)^year\\s+\\d+$")) != none
  if not nobrk and (isyear or not syllabus) { pagebreak(weak: true) }
  // Sub-topics are omitted from a units-only contents page. In a syllabus the YEAR
  // banners are TOP-LEVEL contents entries (level 1), with the topics nested under them.
  if not tocUnitsOnly {
    if isyear { mark(1, t) } else { mark(2, t) }
  }
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
  } else if syllabus {
    // clean solid banner — no left accent stripe
    block(width: 100%, breakable: false, radius: 3pt, fill: T.primary, inset: (x: 12pt, y: 8pt))[
      #text(fill: white, size: hs(14pt), weight: "bold")[#t]]
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
  } else if syllabus {
    // plain bold heading — NO vertical accent bar (the reference has none)
    block(breakable: false)[#text(fill: T.ink, size: hs(13pt), weight: "bold")[#t]]
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
  // Headings/box titles are conventionally never hyphenated in print — a long
  // word wrapping mid-title (e.g. "ACAP-PELLA") reads as broken even though the
  // break itself is a valid hyphenation point, since a reader expects a title's
  // words to stay whole. Disable it here once rather than per style branch below.
  // Titles are also never JUSTIFIED: the document body defaults to justify:true,
  // but a short, wrapped, all-caps title (e.g. "LEARNING ACTIVITY 1: WRITING
  // MUSIC.  REFER TO FORM 4 LEARNER'S BOOK PAGE 70.") has so few spaces per line
  // that justification stretches them into visibly uneven gaps — worst on the
  // line with the fewest words. Headings are conventionally left-ragged in print.
  let title = { set par(justify: false); text(hyphenate: false)[#title] }
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
      #block(width: 100%, sticky: true, below: 7pt)[#text(fill: kind.title, weight: "bold", size: hs(14pt))[#title]]
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
  // Table cells are NEVER justified — they are set ragged-right at every width, so
  // there is no column-count threshold here any more. A table column is a narrow
  // measure: roughly 47mm split three ways, 35mm four ways, 26mm six ways, and even a
  // 2-column grid can hand a column ~55mm, because dtable sizes columns to their
  // CONTENT rather than splitting the measure evenly. Justifying a column that narrow
  // forces a hyphen into almost every line just to reach the measure — "Transac-tion
  // steps", "Recipi-ent", "demon-strated" down a whole assessment rubric;
  // "Traditional out-door cooking" across a comparison grid; "cont-/amination" in a
  // two-column one — and stretches whatever word gaps survive. That is what made the
  // ICT Form 2 rubrics and the Food & Nutrition tables read as a wall of broken
  // words. Ragged-right keeps whole words on most lines at every one of those
  // widths, which is why the rule is unconditional: the syllabus matrix (ragged from
  // the start) and every other book now follow the same one.
  //
  // A cell whose text never wraps is unaffected either way — justification only ever
  // stretches a line that is not the last of its paragraph — so short data grids
  // ("Chanda | 101 | 14 | 977000001") render identically.
  //
  // Hyphenation STAYS ON: turning it off overflowed the cells outright — "Not
  // demonstrated 0" clipped to "Not demo" and the last column's text ran over its
  // neighbour's, because a ~22mm column cannot hold "demonstrated" or
  // "understanding" whole. Dropping the justification is what actually helps.
  set par(justify: false)
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
      // A plain cell never goes through seg(), so the brand-name rule is applied here
      // too — the narrow "Tool" column of a compression-tools table is exactly where a
      // name like PowerISO would otherwise be hyphenated.
      for (i, ln) in c.text.split("\n").enumerate() { if i > 0 { linebreak() }; nohyphcell(ln) }
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
  // A cell that carries a `seg` is normally excluded (its formatting would be
  // lost if flattened to the plain `c.text` the header band renders with) —
  // but almost every header cell in a real manuscript is simply BOLD, and the
  // importer now attaches a `seg` to any styled cell (not just genuinely rich
  // ones like equations), so this used to reject nearly every bold header row
  // outright. A cell whose `seg` is a single non-math run carries no styling
  // beyond what the forced-bold header band already applies, so it's still a
  // plain label for this purpose.
  let plainHeaderCell(c) = {
    let sg = c.at("seg", default: ())
    sg.len() == 0 or (sg.len() == 1 and not sg.at(0).at("m", default: false))
  }
  let hdr = (not noHeader) and rows.at(0).all(c =>
    c.imgs.len() == 0 and plainHeaderCell(c)
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
  // Only MATH segments get an extra width bonus: their Typst source length is a
  // poor proxy for rendered width, unlike plain bold/italic text where c.text's
  // own length already tracks the rendered width closely enough. Counting every
  // seg (the old behaviour) inflated any merely-bold cell — including a short
  // "Week"/"Topic" header label — enough to defeat narrowNum's auto-width test
  // below, squeezing a numbering column so far that its header word overflowed
  // into its neighbour.
  let celllen(c) = c.text.len() + c.at("seg", default: ()).filter(s => s.at("m", default: false)).len() * 6 + c.imgs.len() * 30 + colsumlen(c)
  let bigcontent = rows.any(r => r.any(c => celllen(c) >= 100))
  let collen(ci) = { let m = 0; for r in rows { let l = celllen(r.at(ci)); if l > m { m = l } }; m }
  // The longest UNBREAKABLE word anywhere in a column (header OR body). A column
  // must be at least wide enough for this word or it overflows into its neighbour
  // (e.g. a short "Class" header whose body holds "Amphibians"/"Mammals"). Relative
  // `fr` weight alone can't guarantee that, so we raise the column's floor to it.
  let longword(s) = s.split(regex("\s+")).fold(0, (a, w) => calc.max(a, w.len()))
  let colword(ci) = { let m = 0; for r in rows { let l = longword(r.at(ci).text); if l > m { m = l } }; m }
  // The longest word in a column that nohyphcell() renders UNHYPHENATABLE (a brand
  // name like PowerISO). For every other word the floor above is only a preference —
  // hyphenation can always rescue a column that ends up a little too narrow — but
  // one of these has to fit whole or it breaks at its capital (or, before the
  // zero-width space, spilled into the next cell). The `* 2` proxy is calibrated for
  // a word that may hyphenate and is about a third short of the real rendered width,
  // so these get a bigger multiplier, capped so one long name cannot starve the rest
  // of the table. Columns with no such word are untouched, which keeps every table
  // in every other book laid out exactly as before.
  let camelword(ci) = { let m = 0; for r in rows { for w in r.at(ci).text.split(regex("\s+")) { if w.find(camelRe) != none and w.len() > m { m = w.len() } } }; m }
  let colweight(ci) = {
    let floor = calc.max(6, colword(ci) * 2)   // fit the column's longest (unbreakable) word
    let cwl = camelword(ci)
    let floor = if cwl > 0 { calc.max(floor, calc.min(30, cwl * 3.2)) } else { floor }
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
  // ---- CDC SYLLABUS matrix look: a GREY header row that REPEATS on every page, a black
  // inner grid + thicker outer frame, no zebra, the TOPIC column bold, the activities
  // column bulleted, and the TOPIC/SUB-TOPIC row-span merge (empty left cells continue the
  // one above, so no line between them). Each non-empty topic also drops a hidden TOC entry.
  let syl = T.variant == "syllabus"
  let plainlabel(c) = {
    let t = c.at("text", default: "")
    if t == none { t = "" }
    if t != "" { t } else {
      let j = c.at("seg", default: ()).map(s => { let x = s.at("t", default: ""); if x == none { "" } else { x } }).join()
      if j == none { "" } else { j }
    }
  }
  // Strip a leading bullet/marker — the importer may KEEP the manuscript's list bullet in
  // a cell, and the matrix adds its own, so drop the source one to avoid a double bullet.
  let stripLead(s) = if s == none { "" } else { s.replace(regex("^\\s*[•▪◦●·‣∙\\-]+\\s*"), "") }
  let sylhdr = syl and (not noHeader) and rows.at(0).all(c =>
    c.imgs.len() == 0 and not plainlabel(c).contains("\n")
    and plainlabel(c).len() <= 44 and plainlabel(c).trim() != "")
  // The SUGGESTED/LEARNING ACTIVITIES column (ACT…VIT — tolerates the "ACTVITIES" typo).
  let actCol = if sylhdr { rows.at(0).position(c => upper(plainlabel(c)).contains(regex("ACT.?VIT"))) } else { none }
  let sylbullets(c) = {
    let sg = c.at("seg", default: ())
    let lines = ()
    if sg.len() > 0 {
      let cur = ()
      for s in sg {
        let parts = s.t.split("\n")
        for (i, p) in parts.enumerate() {
          if i > 0 { lines.push(cur); cur = () }
          if p != "" { cur.push((..s, t: p)) }
        }
      }
      lines.push(cur)
      lines = lines.filter(l => l.len() > 0)
    } else {
      lines = c.text.split("\n").filter(t => t.trim() != "")
    }
    let clean(l) = if type(l) == array { let m = l; if m.len() > 0 { m.at(0) = (..m.at(0), t: stripLead(m.at(0).t)) }; m } else { stripLead(l) }
    if lines.len() == 0 { cell(c) } else {
      grid(columns: (8pt, 1fr), column-gutter: 2pt, row-gutter: 4pt, align: (left + top, left + top),
        ..lines.map(l => { let cl = clean(l); (text[•], if type(cl) == array { segs(cl) } else { cl }) }).flatten())
    }
  }
  let isEmptyCell(x, y) = {
    if y < 1 or y >= rows.len() or x >= rows.at(y).len() { false }
    else {
      let c = rows.at(y).at(x)
      c.text.trim() == "" and c.at("seg", default: ()).len() == 0 and c.imgs.len() == 0
    }
  }
  let mergeTop(x, y) = x <= 1 and y >= 1 and isEmptyCell(x, y)
  let sylStroke = (x, y) => {
    let lastr = rows.len() - 1
    let lastc = rows.at(0).len() - 1
    (
      left: (if x == 0 { 1.3pt } else { 0.5pt }) + T.ink,
      right: (if x == lastc { 1.3pt } else { 0.5pt }) + T.ink,
      top: if y == 0 { 1.3pt + T.ink } else if mergeTop(x, y) { none } else { 0.5pt + T.ink },
      bottom: if y == lastr { 1.3pt + T.ink } else if mergeTop(x, y + 1) { none } else { 0.5pt + T.ink },
    )
  }
  let topicNum(row) = {
    let st = if row.len() > 1 { let x = row.at(1).at("text", default: ""); if x == none { "" } else { x } } else { "" }
    let m = st.match(regex("^\\s*(\\d+)\\.(\\d+)"))
    if m != none { m.captures.at(0) + "." + m.captures.at(1) } else { "" }
  }
  // Render a cell that STARTS with a number ("1.1.4.1 …", "1. …") as a HANGING item: the
  // number in its own column, the wrapped text ALIGNED under itself (not under the number),
  // with a clear gap after the number. Preserves the cell's rich formatting (segs).
  let numcell(c) = {
    let ct = plainlabel(c)
    let m = ct.match(regex("^(\\d+(?:\\.\\d+)*\\.?)\\s+"))
    if m == none { cell(c) } else {
      let num = m.captures.at(0)
      let cut = m.text.len()
      let sg = c.at("seg", default: ())
      let firstBold = sg.len() > 0 and sg.at(0).at("b", default: false)
      let restContent = if sg.len() > 0 {
        let removed = 0
        let out = ()
        for s in sg {
          let t = s.at("t", default: "")
          if t == none { t = "" }
          if removed >= cut { out.push(s) }
          else if removed + t.len() <= cut { removed += t.len() }
          else { out.push((..s, t: t.slice(cut - removed))); removed = cut }
        }
        segs(out)
      } else { c.text.slice(cut) }
      grid(columns: (auto, 1fr), column-gutter: 6pt, align: (left + top, left + top),
        if firstBold { text(weight: "bold")[#num] } else { num }, restContent)
    }
  }
  let sylbody(ci, c, row) = if actCol != none and ci == actCol {
    sylbullets(c)
  } else if ci == 0 {
    let tt = stripLead(plainlabel(c)).trim()
    let body = text(weight: "bold")[#tt]
    if tt != "" and sylhdr and actCol != none {
      let num = topicNum(row)
      let label = if num == "" or tt.match(regex("^\\d+\\.\\d")) != none { tt } else { num + "  " + tt }
      [#tocentry(2, label)#body]
    } else { body }
  } else { numcell(c) }
  // A table row that SPLITS across a page break strands a fragment of one cell under
  // the repeated header on the next page (a two-word tail sitting alone above a blank
  // page). Keep each row whole so it moves to the next page intact instead. Applied
  // only to rows short enough that they cannot plausibly be taller than a page — a very
  // tall row (a nested sub-table, a stack of images) must stay breakable or it could
  // not be placed at all. The syllabus matrix keeps its own behaviour: its rows are
  // long by design and routinely exceed a page.
  let rowlen(r) = r.fold(0, (a, c) => a + celllen(c))
  let rowcell(r, c) = if rowlen(r) <= 600 { table.cell(breakable: false)[#cell(c)] } else { cell(c) }
  let tbl = if syl and sylhdr {
    table(columns: cols, stroke: sylStroke, inset: (x: ix + 2pt, y: iy + 1.5pt),
      fill: (col, row) => if row == 0 { T.at("matHeader", default: rgb("#d9d9d9")) } else { white },
      table.header(..rows.at(0).map(c => align(center)[#text(fill: T.ink, weight: "bold")[#plainlabel(c)]])),
      ..rows.slice(1).map(r => r.enumerate().map(((ci, c)) => sylbody(ci, c, r))).flatten())
  } else if syl {
    table(columns: cols, stroke: sylStroke, inset: (x: ix + 2pt, y: iy + 1.5pt), fill: white,
      ..rows.map(r => r.enumerate().map(((ci, c)) => sylbody(ci, c, r))).flatten())
  } else if hdr {
    table(columns: cols, stroke: 0.5pt + T.rulec,
      fill: (col, row) => if row == 0 { T.primary } else if calc.odd(row) { T.zebra } else { white },
      inset: (x: ix, y: iy),
      table.header(..rows.at(0).map(c => text(fill: white, weight: "bold")[#c.text])),
      ..rows.slice(1).map(r => r.map(c => rowcell(r, c))).flatten())
  } else {
    table(columns: cols, stroke: 0.5pt + T.rulec,
      fill: (col, row) => if calc.even(row) { T.zebra } else { white },
      inset: (x: ix, y: iy),
      ..rows.map(r => r.map(c => rowcell(r, c))).flatten())
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
      // Match the marker's weight to the item's own first run rather than forcing
      // bold — a numbered step whose manuscript text is plain/italic (not bold)
      // otherwise ends up with a visibly bolder marker than its own text (see the
      // matching fix on `listitem`, used outside a box, just above).
      let firstseg = it.s.find(s => s.t.trim() != "")
      let contentBold = firstseg != none and firstseg.at("b", default: false)
      grid(columns: (pad, auto, 1fr), column-gutter: (0pt, 7pt), align: (left + top, left + top, left + top),
        [],
        text(fill: if it.marker == "•" { T.primary2 } else { T.primary }, weight: if it.marker == "•" { "regular" } else if contentBold { "bold" } else { "regular" })[#it.marker],
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
#let framedsection(kind, title, body) = {
  let content = renderbody(body)
  // Always breakable (mirrors titledbox's own default). A prior version kept any box
  // under 180mm tall fully atomic so it could never split and orphan a stray last item
  // — but Typst then moves the WHOLE box to the next page whenever it doesn't fit
  // what's left of the current one, regardless of how much of the current page that
  // wastes (observed leaving up to ~85% of a page blank, flagged by a reviewer across
  // several books). The title stays `sticky` inside titledbox either way, so it still
  // can't be stranded alone at the foot of a page; letting the body break normally
  // trades a rare small widow for guaranteed no more multi-page blank gaps.
  titledbox(text(size: hs(14pt))[#title], T.at(kind), content, breakable: true)
}
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
    // Always breakable — see framedsection for why the old "atomic if short" rule was
    // dropped from the default (non-`force`) path: it could strand the whole box on a
    // fresh page while leaving most of the current one blank. `force` (from a book's
    // `forceFreshPage` override, opted into per-widow) keeps its own measured behaviour
    // unchanged, since that's an author-curated exception, not the common case.
    titledbox(title, T.at(kind), content, breakable: true)
  }
}
#let activity(title, body, force: false) = keepwhole("act", title, renderbody(body), force: force)
#let fact(body) = titledbox("Did You Know?", T.fact, renderbody(body))
#let keypoints(title, items) = titledbox(if title == none { "Key Points to Remember" } else { title }, T.kp,
  { for it in items [#grid(columns: (10pt, 1fr), text(fill: T.kp.border)[•], par[#it]); #v(1.5pt)] })
#let genericbox(body) = { block(width: 100%, breakable: true, radius: 3pt,
  stroke: 0.9pt + T.rulec, fill: rgb("#f7f9fc"), inset: (x: boxinx, y: 8pt))[#renderbody(body)]; v(3pt) }

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
// No highlighted background — the "Possible answer" callout used to sit inside a
// yellow/amber highlight() band, which a manuscript's own literal-space padding could
// stretch into a bare colour bar bleeding past the box (see the space-collapsing fix
// in normaliseSpacing). Dropped for every book: plain italic accent-coloured text reads
// as a distinct answer key without depending on a background fill at all.
// No label either. The box's own heading ("Expected Responses", printed directly under
// the EXERCISE/ASSESSMENT title of every Teacher's Guide answer key) already says these
// are the answers, so a second "Possible answer:" tag on each one is pure repetition —
// the same reasoning import-docx.js already applies to the label it used to synthesise
// for unlabelled lettered answers, now extended to the label a manuscript typed itself.
// A reviewer struck out all seventeen of them in one Form 2 Teacher's Guide, every
// occurrence in the book. The answer stays visually distinct without it: italic, in the
// box's accent colour, against the roman body of the question above it.
#let answer(aseg, a) = context if show-answers.get() and (a != "" or aseg.len() > 0) {
  [#text(style: "italic", fill: T.ex.title)[#rich(aseg, a)]]
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
      let qseg = it.at("qseg", default: ())
      // A top-level marker with NO question text of its own — the manuscript wrote
      // "1. (a) <answer text>" with nothing between the number and its first
      // sub-part, so the fold in import-docx.js hangs the whole lettered answer
      // off the empty top as its `a`/`aseg` — must not force a blank first line
      // before the answer: the old unconditional leading `\` left "1." stranded
      // alone with an empty gap above "Possible answer:" on the next line.
      let hasQ = it.q != "" or qseg.len() > 0
      let body = if hasQ {
        [#richflow(qseg, it.q) #context if show-answers.get() and (it.a != "" or aseg.len() > 0) [ \ #answer(aseg, it.a) ]]
      } else {
        [#context if show-answers.get() and (it.a != "" or aseg.len() > 0) [#answer(aseg, it.a)]]
      }
      // A combined top+sub marker ("1. a)", the manuscript's own "1. (a) …" glued
      // onto one line — see the tmSub case in import-docx.js) is too wide for the
      // fixed 22pt gutter every plain "a)"/"1." marker fits in — a bare `text(...)`
      // that doesn't fit its grid cell WRAPS inside that narrow cell instead of
      // overflowing, so "1." and "a)" landed on two separate lines with nothing in
      // the body column beside the second one. Widen the gutter for just this row
      // when the marker is longer than a plain single marker ever is.
      let mkw = if it.marker.len() > 3 { 36pt } else { 22pt }
      grid(columns: (pad, mkw, 1fr), column-gutter: (0pt, 6pt), align: (left + top, right + top, left + top),
        [], [#it.marker], body)
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
