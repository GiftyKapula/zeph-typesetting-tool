// Colour/typography/layout themes for the typesetter. Each book can use a
// different theme while sharing one engine. A theme becomes a Typst `#let T =
// (…)` dict that generic-template.typ reads for every colour, the font, and the
// `variant` (which switches the LAYOUT — classic vs modern — so books look
// genuinely different, not just recoloured).
//
// Add a new theme by copying one of these and changing the values — or, for a
// ZEPH house-style book (the English/Physics/Biology family), use zeph() below.

// Lighten a 6-hex colour toward white by `amt` (0..1) — used to derive soft box
// fills from a theme's palette so each book's boxes match its identity.
function tint(hex, amt) {
  const n = parseInt(hex, 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (v) => Math.round(v + (255 - v) * amt).toString(16).padStart(2, "0");
  return m(r) + m(g) + m(b);
}
// Factory for a ZEPH house-style theme (B5, serif header + sans body, graphic
// centred cover, roman→arabic front matter). `variant`: "series" = flat (English
// gospel — activities become headings, but table-wrapped boxes are kept);
// "science" = boxed. Box colours are derived from the palette so they're cohesive.
// EDUCATION-LEVEL RULE — the eyebrow at the top of every cover (and title page,
// and the secondary running header) is the school level, chosen by the book's
// grade/form. Always use exactly one of:
//   • "Secondary Education Advanced Level"  — Form 5-6
//   • "Secondary Education Ordinary Level"  — Form 1-4   (the default below)
//   • "Primary Education Level"             — Grade 1-6
// When adding a theme, pass the matching `level` (primary/A-level books must set it).
function zeph({ subject, variant = "series", motif = "atom",
               signature, primary, primary2, accent, cyan,
               level = "Secondary Education Ordinary Level",
               toctitle = "Table of Contents", tocUnitsOnly = false, coverStyle = "" }) {
  cyan = cyan || primary2;
  return {
    font: "Times New Roman", displayFont: "Segoe UI", bodyFont: "Arial",
    variant, paper: "iso-b5", ink: "1a1a1a", motif,
    tagline: "", tab: "Learner's Book", toctitle,
    tocUnitsOnly, coverStyle,
    // `subject` + `eyebrow` are read by the cover-synthesis step (not emitted to
    // Typst), so the eyebrow follows the education level (primary vs secondary).
    subject, eyebrow: level.toUpperCase(),
    hdrleft: level + " " + subject,
    hdrtab: "Learner's Book",
    signature, primary, primary2, accent, cyan,
    rulec: tint(primary, 0.78), zebra: tint(primary, 0.93), yellow: "fff39a",
    act:  { fill: tint(primary, 0.9),  border: primary2, title: primary },
    ex:   { fill: tint(cyan, 0.9),     border: cyan,      title: primary },
    kp:   { fill: "fff3d9",            border: "d99a2e",  title: "8a5a12" },
    fact: { fill: "ece9f5",            border: "7a5fb0",  title: "493585" },
    asmt: { fill: "f6ece2",            border: "b6743c",  title: "7d4a1c" },
  };
}

const THEMES = {
  // Navy + gold, serif, classic layout — the Form 5 Physical Education look.
  navy: {
    font: "Times New Roman", variant: "classic", ink: "1a1a1a",
    tagline: "MOVEMENT · HEALTH · PERFORMANCE", tab: "", toctitle: "Table of Contents",
    primary: "1f3864", primary2: "2e5496", accent: "c79a3b",
    rulec: "c9d3e4", zebra: "eef3fa", yellow: "fff39a",
    act:  { fill: "e7effb", border: "2e5496", title: "1f3864" },
    ex:   { fill: "f1f8ea", border: "548235", title: "375623" },
    kp:   { fill: "fff6da", border: "bf8f00", title: "7f6000" },
    fact: { fill: "e4f3f5", border: "2e8b9a", title: "1f6b77" },
    asmt: { fill: "fbeae3", border: "c0703f", title: "8a3d18" },
  },
  // Blue + orange, Century Gothic, modern layout — friendly but professional;
  // for the Grade 4 Technology Studies learner's book.
  tech: {
    font: "Century Gothic", variant: "modern", ink: "232a30",
    tagline: "TECHNOLOGY · INNOVATION · DESIGN", tab: "ICT · D&T", toctitle: "Table of Contents",
    primary: "13579f", primary2: "2f7ac9", accent: "f29230",
    rulec: "cdd9e8", zebra: "eaf1fa", yellow: "fff39a",
    act:  { fill: "eaf1fb", border: "2f7ac9", title: "13497f" },  // Learning Activity (blue)
    ex:   { fill: "e7f3ee", border: "3f9d77", title: "246149" },  // Exercise (green)
    kp:   { fill: "fff3d9", border: "e0982e", title: "8a5a12" },  // Key Points (amber)
    fact: { fill: "f0e9f7", border: "8a6fb0", title: "5d4385" },  // Did You Know (violet)
    asmt: { fill: "fde9de", border: "e3743a", title: "b04c1c" },  // Assessment (orange)
  },
  // Burgundy + warm gold, Times New Roman, classic layout — an elegant literary
  // look for Literature / language books (e.g. Literature in Lunda).
  lit: {
    font: "Times New Roman", variant: "literary", ink: "211a1c",
    tagline: "LITERATURE · LANGUAGE · CULTURE", tab: "", toctitle: "Nyitanchi Yayibalu",
    primary: "6b2737", primary2: "8e3b4f", accent: "b68a3e",
    rulec: "e0cdd2", zebra: "f6eef0", yellow: "fff39a",
    act:  { fill: "f3e9ec", border: "8e3b4f", title: "6b2737" },  // Learning Activity (rose)
    ex:   { fill: "f1ecdf", border: "9a7d34", title: "6d5316" },  // Exercise (gold)
    kp:   { fill: "eef0e8", border: "6f7e4e", title: "47532c" },  // Key Points (olive)
    fact: { fill: "ece9f0", border: "6f5a93", title: "473767" },  // Did You Know (plum)
    asmt: { fill: "f6e7e3", border: "b25a3f", title: "7d3320" },  // Assessment (terracotta)
  },
  // Teal + amber + cyan, serif display over a sans body, "series" layout —
  // the Zambia Educational Publishing House secondary-school house style
  // (e.g. English Language Form 4). Printed at B5 (176x250mm), with a graphic
  // cover, a repeated title page, roman front matter and arabic body. Content
  // flows (activities/exercises become teal headings, not coloured boxes).
  english: {
    font: "Times New Roman",      // running header (refined serif italic)
    displayFont: "Segoe UI",      // cover + title page (modern sans)
    bodyFont: "Arial",            // body text + interior headings (sans)
    variant: "series", paper: "iso-b5", ink: "1a1a1a",
    tagline: "", tab: "Form 4 Learner's Book", toctitle: "Table of Contents",
    hdrleft: "Secondary Education Ordinary Level English Language",
    hdrtab: "Form 4 Learner's Book",
    // English's signature cover colour is YELLOW (used for the cover bands/shapes,
    // with teal as the readable text/structure colour).
    signature: "f6c324",
    primary: "2f9e8c", primary2: "1f8472", accent: "e0922f", cyan: "00a0e0",
    rulec: "bfe3da", zebra: "e9f7f3", yellow: "fff39a",
    act:  { fill: "e6f5f1", border: "2f9e8c", title: "1f6b5f" },  // teal
    ex:   { fill: "fcefdc", border: "d98b2b", title: "8a5413" },  // amber
    kp:   { fill: "eef0e3", border: "7d8a3e", title: "4d551f" },  // olive
    fact: { fill: "e6f1f6", border: "3f8fb8", title: "1f5d77" },  // cyan
    asmt: { fill: "f7e8e2", border: "b65a3c", title: "7d331c" },  // clay
  },
  // Deep indigo + energetic amber, "science" layout — a precise, technical feel
  // for the Physics Form 4 book. Shares the ZEPH B5 house mechanics (front matter,
  // numbering, covers) with `series`, but KEEPS the callout boxes (it's a hands-on
  // lab book: Learning Activities + Exercises are boxed) and adds a physics
  // identity (indigo cover with orbit motifs, numbered TOPIC banners).
  physics: {
    font: "Times New Roman",      // running header
    displayFont: "Segoe UI",      // cover + title page (clean technical sans)
    bodyFont: "Arial",            // body + interior headings (sans)
    variant: "science", paper: "iso-b5", ink: "1a1a1a", motif: "atom",
    tagline: "", tab: "Form 4 Learner's Book", toctitle: "Table of Contents",
    hdrleft: "Secondary Education Ordinary Level Physics",
    hdrtab: "Form 4 Learner's Book",
    signature: "26346b",          // deep indigo (cover signature)
    primary: "26346b", primary2: "3a4a8c", accent: "f0a32e", cyan: "1fb6d6",
    rulec: "cfd6ea", zebra: "eef1f8", yellow: "fff39a",
    act:  { fill: "e9edf8", border: "3a4a8c", title: "26346b" },  // Learning Activity (indigo)
    ex:   { fill: "e2f2f5", border: "1f8fa6", title: "176070" },  // Exercise (teal/cyan)
    kp:   { fill: "eaedf7", border: "5566a8", title: "30407e" },  // Key Points (blue)
    fact: { fill: "efeaf7", border: "7a5fb0", title: "493585" },  // Did You Know (violet)
    asmt: { fill: "e6ecf6", border: "2a3a6b", title: "1c2750" },  // Assessment (deep indigo)
  },
  // Deep emerald + warm amber + teal, "science" layout — a living, organic feel
  // for the Biology Form 4 book. Shares the ZEPH B5 science mechanics with the
  // Physics theme (boxed Learning Activities + Exercises, numbered TOPIC banners,
  // graphic cover) but in a green life-sciences palette, and swaps the cover's
  // physics atom for a biological CELL motif (membrane, nucleus, organelles).
  biology: {
    font: "Times New Roman",      // running header
    displayFont: "Segoe UI",      // cover + title page
    bodyFont: "Arial",            // body + interior headings (sans)
    variant: "science", paper: "iso-b5", ink: "1a1a1a", motif: "cell",
    tagline: "", tab: "Form 4 Learner's Book", toctitle: "Table of Contents",
    hdrleft: "Secondary Education Ordinary Level Biology",
    hdrtab: "Form 4 Learner's Book",
    signature: "17633a",          // deep emerald (cover signature)
    primary: "17633a", primary2: "2f8f5b", accent: "e8a020", cyan: "16a085",
    rulec: "cfe3d6", zebra: "edf6f0", yellow: "fff39a",
    act:  { fill: "e7f3ec", border: "2f8f5b", title: "17633a" },  // Learning Activity (emerald)
    ex:   { fill: "e2f3f0", border: "1aa088", title: "176b5e" },  // Exercise (teal)
    kp:   { fill: "fff3d9", border: "d99a2e", title: "8a5a12" },  // Key Points (amber)
    fact: { fill: "e8f0f6", border: "4a86b0", title: "245d77" },  // Did You Know (water blue)
    asmt: { fill: "f6ece2", border: "b6743c", title: "7d4a1c" },  // Assessment (earth clay)
  },
  // Amethyst purple + teal + amber, "science" layout — a fresh, distinct identity
  // for the Chemistry Form 1 book. Shares the ZEPH B5 science mechanics with the
  // Physics/Biology themes (numbered TOPIC banners, graphic cover, boxed Learning
  // Activities + Exercises) but deliberately breaks from them in two ways the other
  // science books share: (1) a NEW callout look — `boxStyle: "labcard"` — a tinted
  // rounded CARD with a solid title chip and a hexagon (benzene-ring) motif, NOT
  // the thick left-stripe every other book uses; (2) a chemistry cover motif
  // (`flask`) — a conical flask + hexagon instead of the physics electron orbits.
  // Purple reads as chemistry (litmus / permanganate / iodine) and is clearly
  // apart from physics indigo, biology emerald and maths plum.
  chemistry: {
    font: "Times New Roman",      // running header
    displayFont: "Segoe UI",      // cover + title page
    bodyFont: "Arial",            // body + interior headings (sans)
    variant: "science", paper: "iso-b5", ink: "1a1a1a", motif: "flask",
    subject: "Chemistry",         // read by cover synthesis + running-header pill
    boxStyle: "labcard",          // unique chemistry callout (no left stripe)
    tocDepth: 1,                  // contents lists TOPICS only (no sub-topics)
    tagline: "", tab: "Form 1 Learner's Book", toctitle: "Table of Contents",
    hdrleft: "Secondary Education Ordinary Level Chemistry",
    hdrtab: "Form 1 Learner's Book",
    signature: "6a2c8f",          // amethyst purple (cover signature)
    primary: "6a2c8f", primary2: "8a4aad", accent: "e79a2b", cyan: "17a2b8",
    rulec: "e0d3ec", zebra: "f4eef9", yellow: "fff39a",
    act:  { fill: "f1e9f7", border: "6a2c8f", title: "4a1d66" },  // Learning Activity (amethyst)
    ex:   { fill: "e2f3f6", border: "17a2b8", title: "0d6575" },  // Exercise (teal)
    kp:   { fill: "fbeed6", border: "d98b2b", title: "8a5413" },  // Key Points (amber)
    fact: { fill: "f7e8f1", border: "a83b7a", title: "6e214e" },  // Did You Know (magenta)
    asmt: { fill: "ece7f3", border: "5a2680", title: "3c1a56" },  // Assessment (deep purple)
  },
  // Forest green + warm amber, Times New Roman, "panel" layout — an earthy,
  // distinct look for the Cinyanja Form 1 language book.
  cinyanja: {
    font: "Times New Roman", variant: "panel", ink: "1f241f",
    tagline: "CINENERO · CIKHALIDWE · MAPHUNZIRO", tab: "", toctitle: "Zam'kati",
    primary: "1f5c45", primary2: "2f7d5e", accent: "d98b2b",
    rulec: "cfe0d6", zebra: "ecf4ee", yellow: "fff39a",
    act:  { fill: "e9f3ec", border: "2f7d5e", title: "1c5640" },  // Nchito = Learning Activity (green)
    ex:   { fill: "fbeedd", border: "cf8327", title: "8a5413" },  // Zocita = Exercise (amber)
    kp:   { fill: "eef0e3", border: "7d8a3e", title: "4d551f" },  // Mau ofunika kudziwa (olive)
    fact: { fill: "e7f1f2", border: "3f8f93", title: "1f5d61" },  // Did You Know (teal)
    asmt: { fill: "f7e8e2", border: "b65a3c", title: "7d331c" },  // Mayeso = Assessment (clay)
  },

  // ---- ZEPH house-style family (English is the reference standard). Each book
  // its own colour; same layout per grade. Local languages use "series" (flat,
  // but table-wrapped boxes are kept); activity-heavy subjects use "science". ----
  // Local languages — BRIGHT, cheerful cover (signature = vivid fill) with a
  // complementary medium colour for the title/accents (the English yellow+teal
  // recipe), each distinct. Translations of English, but with their own identity.
  nyanja:  zeph({ subject: "Chinyanja",  signature: "7ac74f", primary: "1f7a44", primary2: "2f9e5e", accent: "ef8b2c", cyan: "1aa6a0" }),  // leaf green
  tonga:   zeph({ subject: "Chitonga",   signature: "f5a04e", primary: "1f6b6b", primary2: "2f9090", accent: "c4452d", cyan: "2f9e8c" }),  // warm amber
  lunda:   zeph({ subject: "Lunda",      signature: "ef96ae", primary: "6a2342", primary2: "9e3a5e", accent: "c79a3b", cyan: "4a86b0", toctitle: "NYITACHI YAYIBALU", tocUnitsOnly: true, coverStyle: "form1" }),  // rose; Form 1 cover, units-only contents
  luvale:  zeph({ subject: "Luvale",     signature: "9d8be0", primary: "3a2a73", primary2: "6a5bb0", accent: "ef7a59", cyan: "2f9e8c" }),  // lavender
  bemba:   zeph({ subject: "Ichibemba",  signature: "62bfe8", primary: "1b5773", primary2: "2f7fa0", accent: "edab3a", cyan: "2f9e8c" }),  // sky blue
  silozi:  zeph({ subject: "Silozi",     signature: "bfe3c8", primary: "2e7d46", primary2: "45a066", accent: "e0a52e", cyan: "2f9e8c" }),  // forest green
  // Subject books (Form 4 / Grade 6): activity-heavy -> "science" (boxed)
  compsci: zeph({ subject: "Computer Science", variant: "science", signature: "1f3a5f", primary: "1f3a5f", primary2: "2f6aa0", accent: "f0a32e", cyan: "1fb6d6" }),
  maths:   zeph({ subject: "Mathematics",      variant: "science", signature: "5e2b5e", primary: "5e2b5e", primary2: "8a4a8a", accent: "e0a32e", cyan: "3f9e8c" }),
  grade6sci: zeph({ subject: "Science",        variant: "science", signature: "1f6b4a", primary: "1f6b4a", primary2: "2f8f5b", accent: "e8a020", cyan: "1fa0b6", motif: "cell" }),
  // Prose-heavy subjects -> "series" (flat; boxes kept where the source boxes them)
  travel:    zeph({ subject: "Travel and Tourism", signature: "147a78", primary: "147a78", primary2: "2f9e8c", accent: "e0922f", cyan: "1fb6d6" }),
  // Art and Design (Form 1) — a warm, creative "artist's palette": terracotta/burnt-
  // orange primary with a teal accent, distinct from the purple/red family (maths plum,
  // lit rose, chemistry amethyst). Prose- and image-heavy, so the flat "series" layout.
  art:       zeph({ subject: "Art and Design",     signature: "e08a2f", primary: "b5451f", primary2: "d97b3f", accent: "2f9e8c", cyan: "2f9e8c", tocUnitsOnly: true }),
  // Geography — an "atlas" palette: deep map-green land, ochre contour-line
  // accent, and map-water blue. Form 2 gets its own cartographic cover + header.
  geography: zeph({ subject: "Geography",          signature: "18704a", primary: "18704a", primary2: "2a9668", accent: "d98a2b", cyan: "2b7fb8", coverStyle: "form2" }),
  // Food and Nutrition (Form 1) — a warm "spice and herb" palette: toasted-cinnamon
  // brown primary with a fresh basil-green accent, distinct from art's orange-terracotta
  // and biology's emerald. Boxed activities/exercises (author uses real Learning
  // Activity / Exercise boxes), so the flat "series" layout keeps them as-is.
  // tocDepth 1 keeps the contents to front/back matter + topics, dropping sub-topics —
  // tocUnitsOnly would ALSO drop the front/back matter sections, which this book keeps.
  foodnutrition: { ...zeph({ subject: "Food and Nutrition", signature: "c68a52", primary: "8a4a2e", primary2: "b06b45", accent: "4a8f5b", cyan: "2f8f8a" }), tocDepth: 1 },
  // Physical Education and Sport (Form 1) — its OWN athletic identity, distinct from the
  // Form 5 PE book's navy+gold "navy" theme: a vivid cobalt/royal blue primary with a
  // whistle-orange accent (a track-and-field palette), teal for exercises.
  pesport: { ...zeph({ subject: "Physical Education and Sport", signature: "3f7fc4", primary: "1a4d8f", primary2: "2f6bb0", accent: "e8622e", cyan: "1fa39e" }), tocDepth: 1 },
  // Primary school (Grade 1-6) — same ZEPH house style, but a cheerful palette and
  // a "Primary Education Level" eyebrow/header (see the education-level rule on `level`).
  // sunny yellow-gold + teal; big lower-primary tables. Hyphenation OFF (as on the
  // other primary themes): an early reader cannot decode a word split across lines
  // ("ba-nanas", "ground-nuts"), and it is worst in the English book itself.
  primaryeng: { ...zeph({ subject: "English", level: "Primary Education Level", signature: "ffd23d", primary: "cf8d00", primary2: "eab029", accent: "17867a", cyan: "2a9e8f" }), tableSize: "16pt", hyphenate: false },
  // Grade 3 Creative and Technology Studies — a cheerful primary-school ZEPH
  // theme in a bright turquoise with a sunny tangerine accent, and its own
  // playful "grade3" cover + header layout (distinct from every other book).
  cts: { ...zeph({ subject: "Creative and Technology Studies", level: "Primary Education Level", signature: "d3f0f0", primary: "0f9ea3", primary2: "23bfc4", accent: "ff9e2c", cyan: "23bfc4", coverStyle: "grade3" }), boxActivities: true, hyphenate: false, qgap: "1.5pt", tocDepth: 1, tocGap: "6pt" },
  // Grade 3 Mathematics and Science — a cheerful primary-school ZEPH theme in a
  // bright, friendly BLUE with a sunny amber accent (distinct from English's orange
  // and CTS's turquoise), sharing the playful "grade3" cover + header layout.
  mathsci: { ...zeph({ subject: "Mathematics and Science", level: "Primary Education Level", signature: "d5e8f7", primary: "1f6fb5", primary2: "3f92d0", accent: "ff9e2c", cyan: "2bb3c0", coverStyle: "grade3" }), boxActivities: true, hyphenate: false, qgap: "1.5pt" },
};

// Pick a sensible theme from the file name when none is given.
function autoTheme(name) {
  // order matters: more specific names first (e.g. "Computer Science" before
  // a bare "Science"; subjects before the generic "literature/language").
  if (/computer\s*science|computing|\bict\b/i.test(name)) return "compsci";
  // CTS = Creative and Technology Studies (primary school). Match before the
  // generic "technolog" route so it gets the cheerful primary-school theme.
  if (/\bCTS\b|creative and technolog/i.test(name)) return "cts";
  // Primary-school combined Mathematics & Science (Grade 1-7) — match before the
  // secondary physics/biology/maths subject routes grab it on the bare "maths".
  if (/grade\s*[1-7](?![0-9])/i.test(name) && /math/i.test(name) && /science/i.test(name)) return "mathsci";
  if (/technolog|design studies|spreadsheet/i.test(name)) return "tech";
  if (/chemistr/i.test(name)) return "chemistry";
  if (/physics|physical science/i.test(name)) return "physics";
  if (/biology|life science/i.test(name)) return "biology";
  if (/grade\s*6.*science|primary science/i.test(name)) return "grade6sci";
  // `maths?(?=\b|_)` so "Maths_ Form 1" matches too — an underscore is a word char, so
  // a plain `\bmaths?\b` misses "Maths_..." (no boundary between the "s" and the "_").
  if (/mathematic|\bmaths?(?=\b|_)/i.test(name)) return "maths";
  if (/travel|tourism/i.test(name)) return "travel";
  if (/art\s*(and|&|,)?\s*(design|crafts?)|art\s+and\s+design/i.test(name)) return "art";
  if (/geograph/i.test(name)) return "geography";
  if (/food\s*(and|&)?\s*nutrition|nutrition/i.test(name)) return "foodnutrition";
  // Physical Education and Sport at Ordinary Level (Form 1-4) gets its OWN "pesport"
  // theme; the existing Form 5/6 (Advanced Level) PE book keeps its established "navy"
  // look — matched by grade so the two books, which share almost the same title, don't
  // collide.
  if (/physical\s*education.*sport|\bPES\b/i.test(name) && /form\s*[1-4]\b/i.test(name)) return "pesport";
  // Primary-school English (Grade 1-7) — "Eng"/"English" + a primary grade.
  if (/grade\s*[1-7]\b/i.test(name) && /\beng(lish)?\b/i.test(name)) return "primaryeng";
  if (/english/i.test(name)) return "english";
  if (/chinyanja|cinyanja|nyanja/i.test(name)) return "nyanja";
  if (/chitonga|tonga/i.test(name)) return "tonga";
  if (/ichibemba|bemba/i.test(name)) return "bemba";
  if (/luvale/i.test(name)) return "luvale";
  if (/lunda/i.test(name)) return "lunda";
  if (/silozi|\blozi\b/i.test(name)) return "silozi";
  if (/literature|language/i.test(name)) return "lit";
  return "navy";
}

// Emit the Typst `#let T = (…)` block for a theme.
function themeTypst(theme, overrides = {}) {
  const t = { ...(THEMES[theme] || THEMES.navy), ...overrides };
  const c = (h) => `rgb("#${h}")`;
  const box = (b) => `(fill: ${c(b.fill)}, border: ${c(b.border)}, title: ${c(b.title)})`;
  const q = (s) => '"' + String(s || "").replace(/"/g, '\\"') + '"';
  return `#let T = (
  font: "${t.font}", bodyFont: "${t.bodyFont || t.font}", displayFont: "${t.displayFont || t.font}", handFont: "${t.handFont || "Bradley Hand ITC"}", variant: "${t.variant}",
  paper: "${t.paper || "a4"}", bodySize: ${t.bodySize || "12pt"}, hMain: ${t.hMain || "none"}, hSub: ${t.hSub || "none"}, ink: ${c(t.ink)}, motif: ${q(t.motif || "atom")},
  subject: ${q(t.subject)}, tagline: ${q(t.tagline)}, tab: ${q(t.tab)}, toctitle: ${q(t.toctitle || "Table of Contents")}, hyphenate: ${t.hyphenate === false ? "false" : "true"},
  hdrleft: ${q(t.hdrleft)}, hdrtab: ${q(t.hdrtab || t.tab)},
  primary: ${c(t.primary)}, primary2: ${c(t.primary2)}, accent: ${c(t.accent)}, cyan: ${c(t.cyan || t.primary2)}, signature: ${c(t.signature || t.primary)},
  covPrimary: ${c(t.covPrimary || t.primary)}, covPrimary2: ${c(t.covPrimary2 || t.primary2)}, covAccent: ${c(t.covAccent || t.accent)}, covSignature: ${c(t.covSignature || t.signature || t.primary)}, covCyan: ${c(t.covCyan || t.cyan || t.primary2)}, covInk: ${c(t.covInk || t.ink)}, covRulec: ${c(t.covRulec || t.rulec)},
  rulec: ${c(t.rulec)}, zebra: ${c(t.zebra)}, yellow: ${c(t.yellow)},
  tocUnitsOnly: ${t.tocUnitsOnly ? "true" : "false"}, coverStyle: ${q(t.coverStyle || "")}, boxStyle: ${q(t.boxStyle || "")}, tocDepth: ${t.tocDepth || 2}, mono: ${t.mono ? "true" : "false"},
  ${t.tableSize ? `tableSize: ${t.tableSize},\n  ` : ""}
  ${t.qgap ? `qgap: ${t.qgap},\n  ` : ""}${t.tocGap ? `tocGap: ${t.tocGap},\n  ` : ""}act: ${box(t.act)}, ex: ${box(t.ex)}, kp: ${box(t.kp)}, fact: ${box(t.fact)}, asmt: ${box(t.asmt)},
)\n`;
}

module.exports = { THEMES, autoTheme, themeTypst };
