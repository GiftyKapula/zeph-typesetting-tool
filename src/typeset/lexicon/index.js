// Local-language word lists ("lexicons") for the engine.
//
// The engine recognises parts of a book by their WORDING (a box title such as
// "LEARNING ACTIVITY 3", a front-matter heading such as "FOREWORD"). For a local-
// language book it also needs the words that language uses. Each <language>.json here
// is built from the authors' returned "Local Language Words" forms by
// tools/lexicon/import-forms.js and maps concept ids (see tools/lexicon/terms.js) to
// every wording the authors gave.
//
// One book is typeset at a time: typeset-docx.js calls setLang() before importing, and
// the passes ask the helpers below. With no language set every helper answers
// "no match", so English books behave exactly as before.

const fs = require("fs");
const path = require("path");

const LEX = {};
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith(".json")) continue;
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
  LEX[j.language] = j;
}

// theme name / override -> language id
const THEME_LANG = { nyanja: "nyanja", cinyanja: "nyanja", tonga: "tonga", lunda: "lunda", luvale: "luvale", bemba: "bemba", silozi: "silozi", kaonde: "kaonde" };
function langFor(theme, ov = {}) {
  if (process.env.ZEPH_NO_LEXICON) return null;   // compare builds with/without the word lists
  const l = String(ov.language || "").toLowerCase();
  return LEX[l] ? l : (THEME_LANG[theme] && LEX[THEME_LANG[theme]] ? THEME_LANG[theme] : null);
}

let current = null;
const setLang = (lang) => { current = lang && LEX[lang] ? lang : null; };
const getLang = () => current;

// all wordings for these concepts in the current language
function words(ids) {
  if (!current) return [];
  const t = LEX[current].terms;
  return [...new Set([].concat(...ids.map((id) => t[id] || [])))];
}

// regex source matching any of the wordings: spaces flexible, any apostrophe style,
// longest first so "Mutu wansañu wanyanya" beats "Mutu wansañu".
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function altSrc(list) {
  if (!list.length) return null;
  return [...list].sort((a, b) => b.length - a.length)
    .map((w) => esc(w.trim()).replace(/\s+/g, "\\s+").replace(/['’`]/g, "['’`]")).join("|");
}
// "not followed by another letter" (\b is ASCII-only and misfires after ñ, ŋ…)
const END = "(?![A-Za-z\\u00C0-\\u024F])";
const cache = new Map();
function re(kind, ids, build) {
  const key = `${current}|${kind}|${ids.join(",")}`;
  if (!cache.has(key)) { const src = altSrc(words(ids)); cache.set(key, src ? new RegExp(build(src), "i") : null); }
  return cache.get(key);
}

// Text that STARTS with one of the concepts' words (a box title, "Mutu 1.1: …").
const startsWith = (ids, text) => { const r = re("start", ids, (s) => `^\\s*(?:${s})${END}`); return !!(r && r.test(text || "")); };
// Text that IS one of the words (a whole heading line; a trailing colon is allowed).
const isExactly = (ids, text) => { const r = re("exact", ids, (s) => `^\\s*(?:${s})\\s*:?\\s*$`); return !!(r && r.test(text || "")); };

// The concept(s) that open a TOP-LEVEL section (a unit banner) in this language: the
// Unit word when the language has one (Chitonga CIPATI holds several MUTWE topics),
// otherwise the Topic word.
const topIds = () => (current && (LEX[current].terms.unit || []).length ? ["unit"] : ["topic"]);
const isTopSection = (text) => startsWith(topIds(), text);

// Box kind from a box title, or null. A wording given for two box kinds (Lunda
// "Mudimu" = Exercise and Alternative Activity) goes to the kind listed first here.
const BOX_ORDER = [
  ["exercise", ["exercise"]],
  ["assessment", ["assessment_topic", "assessment_unit"]],
  ["activity", ["activity", "alt_activity"]],
  ["keypoints", ["key_points"]],
  ["fact", ["did_you_know"]],
];
function boxKind(title) {
  if (!current) return null;
  // try the longest matching wording overall, so "zhakwila hakutaña" (activity) is not
  // read as the shorter exercise word it does not start with, and ties go by BOX_ORDER
  let best = null;
  for (const [kind, ids] of BOX_ORDER) {
    for (const w of words(ids)) {
      const r = new RegExp(`^\\s*(?:${altSrc([w])})${END}`, "i");
      if (r.test(title || "") && (!best || w.length > best.len)) best = { kind, len: w.length };
    }
  }
  return best ? best.kind : null;
}

// Front-matter section heading -> house-order rank (as in passes/series-front.js).
const FRONT_IDS = [
  [["author_section"], 0], [["editor_section"], 1], [["foreword"], 2], [["preface"], 3],
  [["acknowledgement"], 4], [["introduction", "how_to_use"], 5], [["key_competences"], 6],
  [["list_of_figures"], 7], [["list_of_tables"], 8], [["acronyms"], 9],
];
function frontRank(text) {
  for (const [ids, rank] of FRONT_IDS) if (isExactly(ids, text)) return rank;
  return null;
}
const isFrontSection = (text) => frontRank(text) != null;
const isBackSection = (text) => isExactly(["glossary", "references", "index", "appendix"], text);
const isContents = (text) => isExactly(["contents"], text);

// The book's own wording for a printed label (cover line, running header), or null:
// the FIRST wording given, which is the author form's, ahead of words added later.
const label = (id) => words([id])[0] || null;

module.exports = { LEX, langFor, setLang, getLang, words, altSrc, startsWith, isExactly, boxKind, isTopSection, frontRank, isFrontSection, isBackSection, isContents, label };
