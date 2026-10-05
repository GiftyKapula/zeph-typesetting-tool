// Book naming helpers: title derivation, title-casing, teacher-book and education-level detection.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)

const { term } = require("./lexicon/index.js");


// A clean running-header title. Prefer the cover's subject line(s); otherwise
// clean the file name (drop anything after " - " and trailing codes/dates).
// The two cover layouts put the subject in different places: a "science" cover
// lists [SUBJECT, GRADE, BOOK TYPE], a "series" cover [EDUCATION LEVEL, SUBJECT
// GRADE, BOOK TYPE]. Taking line 0 as the subject therefore titled every series
// book after its EDUCATION LEVEL - the PDF of this Kiikaonde Teacher's Guide
// opened in a reader called "Primary Education Level". Read the subject off the
// GRADE line instead ("KIIKAONDE GILEDI 1" -> "Kiikaonde"), and fall back to line
// 0 only when stripping the grade leaves nothing, which is exactly the science
// case where the grade sits on a line of its own.
// "Grade 4", "Form 2" - and the same thing in the book's own language ("Giledi 1").
// The words come from the book's word list, so this agrees with the cover, the
// title page, the back cover, the spine and the running header.
function gradeTokenRe() {
  const own = ["grade", "form"].map((id) => term(id)).filter(Boolean);
  return new RegExp(`(?:form|grade${own.length ? "|" + own.join("|") : ""})\\s+\\d+`, "i");
}

function deriveTitle(blocks, fallback) {
  const cover = blocks.find((b) => b.t === "cover");
  if (cover && cover.lines && cover.lines.length) {
    const re = gradeTokenRe();
    const gl = cover.lines.find((l) => re.test(l));
    const grade = gl ? gl.match(re)[0] : "";
    const subject = (gl ? gl.replace(re, "").trim() : "") || cover.lines[0];
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

// Early Childhood Education books ("ECE", "Early Childhood", "… ECE LB LEVEL 1-2").
const isECEName = (base) => /(?:^|[^a-z])ECE(?:[^a-z]|$)|early\s*childhood/i.test(base);

function eduLevelFor(base) {
  if (isECEName(base)) return "Early Childhood Education Level";
  // allow an underscore before the word ("Chitonga_Grade 2") — `_` is a word char,
  // so a plain `\bgrade` would miss it.
  const g = base.match(/(?:^|[^a-z])grade\s*(\d+)/i);
  if (g && +g[1] >= 1 && +g[1] <= 7) return "Primary Education Level";
  const f = base.match(/(?:^|[^a-z])form\s*(\d+)/i);
  if (f) return +f[1] >= 5 ? "Secondary Education Advanced Level" : "Secondary Education Ordinary Level";
  return null;
}

module.exports = { deriveTitle, titleCase, titleCaseGrade, isTeacherBookName, eduLevelFor, isECEName };
