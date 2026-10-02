"use strict";
/*
 * british-english.js — spelling converted, prose flagged.
 *
 * These books are written in British English, and nothing in the pipeline enforced
 * it: a manuscript that spells "colour" on one page and "color" on the next printed
 * both, which is the same disagreement-with-itself the uniform-colour and
 * uniform-marker passes exist to remove, only in words.
 *
 * The module does TWO different jobs, and the difference between them matters:
 *
 *   SPELLING IS FIXED. An American spelling has exactly one British counterpart, and
 *   choosing it needs no judgement about meaning, so the engine simply makes the
 *   change on every book and names what it changed in the build log.
 *
 *   GRAMMAR IS ONLY FLAGGED. "Hand tools are simple tools we use make different
 *   things" is missing a word, and no rule written here can know whether the author
 *   meant "use to make", "use make" as a typo for "make", or something else. A
 *   regex that guessed would silently rewrite an author's sentence — far worse than
 *   printing it as typed. So the prose checks REPORT, with the line quoted, and a
 *   human decides and corrects through `subtext`. The checks are chosen to be the
 *   ones with a high hit rate and an obvious reading, not to be exhaustive.
 *
 * Both run for every book. `"britishEnglish": false` switches the spelling pass off;
 * `"proseCheck": false` silences the report.
 */

// ---- the spelling table ----------------------------------------------------
// Only one-way, unambiguous mappings. The genuinely ambiguous pairs are deliberately
// ABSENT, because "correcting" them would introduce errors a reader would blame on
// the typesetter:
//   program / programme  — a computer program keeps the short form in British English
//                          too, and these books are full of them (Topic 10 is Computer
//                          Software).
//   practice / practise  — noun vs verb; the American spelling is the British NOUN.
//   licence / license    — the same split.
//   meter / metre        — a metre is a length, a meter is an instrument; both occur.
//   tire / tyre          — "tire" is also the ordinary verb.
//   draft / draught      — different senses, both current.
// Leaving these to a human is the point: this table exists to settle what has one
// right answer, not to make a judgement call invisible inside a build.
const WORDS = {
  color: "colour", colors: "colours", colored: "coloured", coloring: "colouring", colorful: "colourful",
  flavor: "flavour", flavors: "flavours", flavored: "flavoured",
  favor: "favour", favors: "favours", favored: "favoured", favorite: "favourite", favorites: "favourites",
  neighbor: "neighbour", neighbors: "neighbours", neighborhood: "neighbourhood",
  labor: "labour", labors: "labours", labored: "laboured",
  behavior: "behaviour", behaviors: "behaviours",
  honor: "honour", honors: "honours", honored: "honoured",
  humor: "humour", humored: "humoured",
  harbor: "harbour", harbors: "harbours",
  odor: "odour", odors: "odours",
  vapor: "vapour", vapors: "vapours",
  rumor: "rumour", rumors: "rumours",
  savior: "saviour", saviors: "saviours",
  center: "centre", centers: "centres", centered: "centred",
  fiber: "fibre", fibers: "fibres",
  liter: "litre", liters: "litres",
  theater: "theatre", theaters: "theatres",
  defense: "defence", defenses: "defences",
  offense: "offence", offenses: "offences",
  pretense: "pretence",
  traveled: "travelled", traveling: "travelling", traveler: "traveller", travelers: "travellers",
  canceled: "cancelled", canceling: "cancelling",
  modeled: "modelled", modeling: "modelling",
  labeled: "labelled", labeling: "labelling",
  signaled: "signalled", signaling: "signalling",
  marvelous: "marvellous",
  jewelry: "jewellery",
  gray: "grey", grays: "greys", grayish: "greyish",
  plow: "plough", plows: "ploughs", plowed: "ploughed",
  mold: "mould", molds: "moulds", molded: "moulded", molding: "moulding",
  smolder: "smoulder",
  aluminum: "aluminium",
  airplane: "aeroplane", airplanes: "aeroplanes",
  math: "maths",
  skillful: "skilful", skillfully: "skilfully",
  fulfill: "fulfil", fulfills: "fulfils",
  enrollment: "enrolment",
  installment: "instalment", installments: "instalments",
  catalog: "catalogue", catalogs: "catalogues",
  dialog: "dialogue", dialogs: "dialogues",
  pajamas: "pyjamas",
  tidbit: "titbit",
};

// -ize / -ization are regular enough to take as a rule rather than a list, which is
// what keeps a word nobody thought to enumerate ("itemize", "pulverize") from slipping
// through. The stoplist holds the words that merely END that way without being the
// suffix at all — "size" is not "si" + "ize".
const IZE_STOP = new Set([
  "size", "sizes", "sized", "sizing", "prize", "prizes", "prized", "prizing",
  "capsize", "capsizes", "capsized", "capsizing", "maize", "seize", "seizes", "seized",
  "baize", "assize", "resize", "resized", "resizes", "downsize", "downsized", "upsize",
]);

// Preserve the shape of the word as the author typed it (ALL CAPS in a heading,
// Capitalised at the start of a sentence), so a correction never changes the case
// of the line it lands in.
function matchShape(src, repl) {
  if (src === src.toUpperCase() && src !== src.toLowerCase()) return repl.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

// The British spelling of one word, or null when it is already right.
function britishWord(w) {
  const lower = w.toLowerCase();
  if (WORDS[lower]) return matchShape(w, WORDS[lower]);
  if (IZE_STOP.has(lower)) return null;
  // -ize -> -ise, -ized -> -ised, -izes, -izing, -ization -> -isation, -izer -> -iser
  const m = lower.match(/^(.{3,})iz(e|es|ed|ing|er|ers|ation|ations)$/);
  if (m) return matchShape(w, m[1] + "is" + m[2]);
  return null;
}

// Convert every word in a string. Returns { text, hits } — hits naming each change so
// the build log can show what moved, the same way the watermark and JPEG passes do.
function toBritish(text) {
  const hits = [];
  const out = text.replace(/[A-Za-z]+/g, (w) => {
    const b = britishWord(w);
    if (!b || b === w) return w;
    hits.push(`${w} -> ${b}`);
    return b;
  });
  return { text: out, hits };
}

// ---- the prose checks ------------------------------------------------------
// Each is a pattern whose hits are nearly always a real slip AND whose correction is
// obvious to a human reading the line. Anything needing a judgement about meaning is
// reported, never changed.
//
// MISSING_TO is the one worth explaining. English lets a bare infinitive follow a few
// verbs ("help make", "let go"), but not the ones listed here, so "we use make
// different things" and "this helps us keep" sit on opposite sides of a line that can
// actually be drawn. `help` is therefore NOT in the trigger list.
// Words that follow "a"/"an" so often, and so harmlessly, that testing them produces
// only noise — "Picture A and B" is not a broken article.
const FUNCTION_AFTER = new Set(["and", "or", "as", "at", "in", "on", "of", "it", "is", "am",
  "are", "was", "to", "the", "an", "a", "if", "but", "so", "for", "up", "out", "off", "all"]);
// The spelling-versus-sound exceptions that make the a/an rule look wrong when it is
// right: a vowel LETTER opening with a consonant sound, and the reverse.
const SOUNDS_CONSONANT = /^(?:uni|use|user|usu|eu|ewe|one|once)/i;        // a university, a one-way
const SOUNDS_VOWEL = /^(?:hour|honest|honour|honor|heir)/i;              // an hour, an honest

const CHECKS = [
  { id: "missing-to",
    re: /\b(use|uses|used|want|wants|wanted|need|needs|needed|try|tries|tried|like|likes|liked|learn|learns|learnt|decide|decides|hope|hopes)\s+(make|do|go|see|keep|take|get|write|read|draw|play|work|learn|show|tell|find|build|put|give|use|cook|clean|cut|carry|hold|wash)\b/i,
    say: "looks like a missing \"to\"" },
  { id: "doubled-word",
    re: /\b([A-Za-z]{2,})\s+\1\b/i, say: "a word typed twice" },
  // The mirror of missing-to: "make/let someone DO" takes a bare infinitive, so the
  // "to" in "makes them to feel welcome" is one word too many. `help` is absent for
  // the same reason it is absent from missing-to — "helps them to find" is correct.
  { id: "extra-to",
    re: /\b(make|makes|made|let|lets)\s+(him|her|them|us|me|it|you|the\s+\w+|a\s+\w+)\s+to\s+[a-z]+/i,
    say: "an extra \"to\" — \"make someone do\", not \"make someone to do\"" },
  // A space before a full stop DOES survive to the page — "one way of conserving trees ."
  // printed exactly that way — unlike a doubled space, which normaliseSpacing collapses
  // long before the page and which was therefore dropped from these checks as pure noise.
  { id: "space-before-stop",
    re: /[A-Za-z] [.,;:!?](?: |$)/, say: "a space before punctuation" },
  { id: "is-are",
    re: /\b(is|was)\s+(are|were)\b|\b(are|were)\s+(is|was)\b/i, say: "two verbs disagreeing" },
  { id: "a-before-vowel", fn: (t) => {
      const m = t.match(/\ba ([aeio][a-z]{2,})/);          // lower-case "a" only — "A" is a label
      return m && !FUNCTION_AFTER.has(m[1].toLowerCase()) && !SOUNDS_CONSONANT.test(m[1]);
    }, say: "\"a\" before a vowel — check it should not be \"an\"" },
  { id: "an-before-consonant", fn: (t) => {
      const m = t.match(/\ban ([bcdfgjklmnpqrstvwxyz][a-z]{2,})/i);
      return m && !SOUNDS_VOWEL.test(m[1]);
    }, say: "\"an\" before a consonant — check it should not be \"a\"" },
  // A heading is not a question however it opens ("HOW TO USE THIS BOOK"), and neither
  // is an instruction that runs on into its own list ("Do the following:"). Both were
  // flagged by the first version of this check, which is how they come to be excluded
  // here: a report whose hits are mostly false is a report nobody reads.
  { id: "question-no-mark", fn: (t) => {
      if (t.endsWith(":") || t.includes("\n")) return false;
      if (t === t.toUpperCase()) return false;             // a heading, not a sentence
      if (t.includes("?")) return false;
      return /^(?:who|what|where|when|why|which|how|do|does|did|is|are|can|should|would)\b/i.test(t);
    }, say: "reads as a question but does not end in \"?\"", min: 12 },
];

// Run the checks over one line. Returns an array of {id, say}.
//
// Runs of spaces are collapsed first, so the checks see the line as it will actually
// PRINT rather than as the manuscript happens to store it — normaliseSpacing squeezes
// those out downstream, and reporting them produced four false hits out of five on the
// first book this ran against.
function proseIssues(line) {
  const t = (line || "").replace(/[ \t]+/g, " ").trim();
  if (!t || t.length < 8) return [];
  const out = [];
  for (const c of CHECKS) {
    if (c.min && t.length < c.min) continue;
    if (c.fn ? c.fn(t) : c.re.test(t)) out.push({ id: c.id, say: c.say });
  }
  return out;
}

module.exports = { toBritish, britishWord, proseIssues, WORDS };
