// Book naming helpers: title derivation, title-casing, teacher-book and education-level detection.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)


// A clean running-header title. Prefer the cover's subject line(s); otherwise
// clean the file name (drop anything after " - " and trailing codes/dates).
function deriveTitle(blocks, fallback) {
  const cover = blocks.find((b) => b.t === "cover");
  if (cover && cover.lines && cover.lines.length) {
    // e.g. ["TECHNOLOGY STUDIES", "GRADE 4", "LEARNER'S BOOK"] -> "Grade 4 Technology Studies"
    const subject = cover.lines[0];
    const grade = cover.lines.find((l) => /\bgrade\s+\d/i.test(l));
    const t = grade ? `${grade} ${subject}` : subject;
    return titleCase(t);
  }
  return titleCase(fallback.split(/\s+-\s+/)[0].replace(/[_\d]+\s*(LB|TB)?\s*$/i, "").trim());
}

function titleCase(s) {
  const small = new Set(["and", "of", "the", "in", "to", "for", "a"]);
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Title-case a "form|grade \d+"-shaped match, but first make sure the word and
// the digit are actually separated. The matching regexes deliberately tolerate
// a missing space (`\s*`, not `\s+`) so a filename like "PHYSICS.FORM2.ZEPH…"
// still gets recognised as Form 2 — but titleCase() alone doesn't insert one,
// so the un-spaced match rode straight through to the synthesised cover ("Form2")
// and the output folder name ("output/Form2/…"). Worse, downstream code that
// reads the grade back OFF the cover (the running-header "Form N …" pill) matches
// with `\s+` and requires the space, so a spaceless "Form2" failed that match
// silently and fell back to the theme's hardcoded "Form 4" placeholder — wrong for
// every Form 1-3 book sharing that theme. Normalising the space in HERE, once, at
// the source keeps every reader of the grade string correct.
function titleCaseGrade(s) {
  return titleCase(s.replace(/^(form|grade)(\d)/i, "$1 $2"));
}

// Education level (cover eyebrow + running header) inferred from the grade/form in
// the file name, so ONE local-language theme serves a subject across levels: Grade
// 1-7 -> Primary, Form 1-4 -> Ordinary, Form 5-6 -> Advanced. Returns null when the
// name carries no grade/form, leaving the theme's own `level` in force.
// True when the file name marks a Teacher's Guide. Matches "TG" as a standalone token
// — bounded by any non-letter, so "_TG_", " TG ", "(TG)" all count (a plain `\bTG\b`
// misses "_TG" because the underscore is a word char) — or the word "teacher".
function isTeacherBookName(base) { return /(?:^|[^a-z])TG(?:[^a-z]|$)|teacher/i.test(base); }

function eduLevelFor(base) {
  // allow an underscore before the word ("Chitonga_Grade 2") — `_` is a word char,
  // so a plain `\bgrade` would miss it.
  const g = base.match(/(?:^|[^a-z])grade\s*(\d+)/i);
  if (g && +g[1] >= 1 && +g[1] <= 7) return "Primary Education Level";
  const f = base.match(/(?:^|[^a-z])form\s*(\d+)/i);
  if (f) return +f[1] >= 5 ? "Secondary Education Advanced Level" : "Secondary Education Ordinary Level";
  return null;
}

module.exports = { deriveTitle, titleCase, titleCaseGrade, isTeacherBookName, eduLevelFor };
