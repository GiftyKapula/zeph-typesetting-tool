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
//                          Only the BARE pair is ambiguous, though: the noun has no
//                          "-ing" or "-ed" form, so "practicing" and "practiced" are
//                          always the verb and always "practising"/"practised" in
//                          British English. Those two are in the table below; the bare
//                          pair stays out. The Food and Nutrition Form 2 Learner's Book
//                          printed "Practicing Food Purchasing using Different Models"
//                          as a heading, its figure caption, and an activity title.
//   licence / license    — the same split.
//   meter / metre        — a metre is a length, a meter is an instrument; both occur.
//                          Only the BARE word is ambiguous: an instrument is never a
//                          millimeter or a kilometer, so the SI-prefixed forms are
//                          always the length, and always "-metre" in British English.
//                          Those are in the table below; the bare pair stays out. The
//                          Food and Nutrition Form 2 Learner's Book writes "measurement
//                          units such as millimeters" in its AutoCAD label-design steps.
//   tire / tyre          — "tire" is also the ordinary verb.
//   draft / draught      — different senses, both current.
// Leaving these to a human is the point: this table exists to settle what has one
// right answer, not to make a judgement call invisible inside a build.
const WORDS = {
  color: "colour", colors: "colours", colored: "coloured", coloring: "colouring", colorful: "colourful",
  flavor: "flavour", flavors: "flavours", flavored: "flavoured", flavorful: "flavourful",
  favor: "favour", favors: "favours", favored: "favoured", favorite: "favourite", favorites: "favourites",
  neighbor: "neighbour", neighbors: "neighbours", neighborhood: "neighbourhood",
  labor: "labour", labors: "labours", labored: "laboured",
  behavior: "behaviour", behaviors: "behaviours", behavioral: "behavioural",
  // The pepper: "chilli"/"chillies" in British English, "chili"/"chilies" in American.
  // The Food and Nutrition Form 2 Learner's Book writes it both ways — "chili" ten
  // times, "chilies" once, "chilli" twice — in recipes facing each other.
  chili: "chilli", chilies: "chillies", chilis: "chillies",
  practicing: "practising", practiced: "practised",
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
  millimeter: "millimetre", millimeters: "millimetres",
  centimeter: "centimetre", centimeters: "centimetres",
  kilometer: "kilometre", kilometers: "kilometres",
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

// A DIRECT question — the only shape that can be corrected by rule, because English
// marks it with INVERSION: a wh-word followed by an auxiliary or the copula ("what IS
// a herb", "how DOES the package protect"), or an auxiliary opening the sentence
// outright ("is the food safe"). Everything else that merely begins with a question
// word is something else entirely, and the first version of question-no-mark flagged
// all of it:
//   "When planning a food budget, several factors determine…"  — a subordinate clause
//   "How the package protects the food."                        — an indirect question
//   "Do not overcrowd the refrigerator."                        — an imperative
// Eighteen of the twenty-one hits on the Food and Nutrition Form 2 Learner's Book were
// one of those three, which is the state this file's own header warns against: a report
// whose hits are mostly false is a report nobody reads. Inversion separates them
// cleanly, and `(?!not\b)` keeps the imperatives out of the yes/no arm.
// The auxiliaries deliberately EXCLUDE may/might/must/shall/will/would/should. Those
// invert for a wish or a heading just as readily as for a question, and every hit they
// produced was one of those: "May this book inspire learners to build the essential
// knowledge…" closing the acknowledgement, and the benefit heading "May Encourage Poor
// Eating Habits:". Losing "should learners wash their hands" costs a report; keeping
// the modals cost two sentences a question mark they must never have.
const Q_WH = /^(?:who|what|whom|whose|where|when|why|which|how)\s+(?:is|are|was|were|do|does|did|can|could|has|have|had)\b/i;
// The yes/no arm is split by auxiliary, because the two halves fail differently.
// The COPULA can take a noun subject safely — "Is the food safe", "Are the learners
// ready" — and an imperative never begins with it. The DOING auxiliaries cannot: in
// these books "Do the following:", "Have fun as you learn new skills!" and "Have a
// look at the picture" all open exactly like an inverted question and are imperatives,
// so those require a PRONOUN subject, which an imperative never supplies. This matters
// more than it would for a report, because this pass now writes the question mark into
// the book: on the Grade 1 CTS Learner's Book the unrestricted form turned "Have fun
// learning, making and creating!" into a question.
const Q_AUX = /^(?:(?:is|are|was|were)\s+(?!not\b)[a-z]|(?:do|does|did|can|could|has|have|had)\s+(?!not\b)(?:you|we|they|he|she|it|i)\b)/i;
// A question is often introduced by an adverbial phrase — "Based on this, what is a
// 'herb'" — so the clause AFTER a leading comma counts too. That is how these exercise
// books mostly write them, and testing only the sentence opening missed every one.
//
// That arm is narrower than the sentence-initial one in two ways, both learned from
// what it got wrong. "which" is dropped: after a comma it introduces a RELATIVE clause
// essentially always — "…seasonal foods, which may be more affordable", "…paperboard,
// which is often coated with plastic", "Unlike condiments, which are usually served
// separately" — and never a question. And the bare auxiliary arm is dropped with it,
// because after a comma it lands on list imperatives: "…create a basic business plan,
// do market research, financial projections…".
const Q_WH_TAIL = /^(?:who|what|whom|whose|why|how)\s+(?:is|are|was|were|do|does|did|can|could|has|have|had)\b/i;
// A CLEFT, not a question: "What is important is that your ambition should be
// meaningful to you", "What is important is to save regularly and have a clear
// purpose for the money". The wh-word opens a free relative that is the SUBJECT of a
// second copula, so the line inverts exactly as a question does and reads as one to
// any rule that stops at the opening. Four sentences in the Religious Education Form 2
// Learner's Book are built this way and every one of them was handed a question mark.
// The second copula is the tell, and a real question has nothing after its own:
// "What is a herb", "Why is the soil fertile", "How is bread made". It costs the odd
// genuine report — "What is the food that is served at a banquet" is excluded too —
// which is the right side to err on when the alternative is punctuating a statement
// as a question.
const isCleft = (t) => {
  const m = /^(?:who|what|whose|which)\s+(?:is|are|was|were)\b/i.exec(t);
  return !!m && /\b(?:is|are|was|were)\b/i.test(t.slice(m[0].length));
};
const isDirectQuestion = (s) => {
  const t = String(s || "").trim();
  if (!t || t.includes("?")) return false;
  if (isCleft(t)) return false;
  if (Q_WH.test(t) || Q_AUX.test(t)) return true;
  const after = t.includes(",") ? t.slice(t.indexOf(",") + 1).trim() : "";
  return !!after && !isCleft(after) && Q_WH_TAIL.test(after);
};
// Split a line into sentences for the question test. Only a terminator FOLLOWED BY a
// capital starts a new one, so "No. 3" and "Dr. Chirwa" don't split a sentence in two.
const sentencesOf = (t) => String(t || "").split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);

const CHECKS = [
  // "clean" is deliberately NOT among the verbs that can follow: it is an adjective far
  // more often than a verb in these books — "use clean equipment", "use clean spoons",
  // "use clean and food-grade packaging materials" — and every one of its hits on the
  // Food and Nutrition Form 2 Learner's Book was that adjective, correctly written.
  { id: "missing-to",
    re: /\b(use|uses|used|want|wants|wanted|need|needs|needed|try|tries|tried|like|likes|liked|learn|learns|learnt|decide|decides|hope|hopes)\s+(make|do|go|see|keep|take|get|write|read|draw|play|work|learn|show|tell|find|build|put|give|use|cook|cut|carry|hold|wash)\b/i,
    say: "looks like a missing \"to\"" },
  { id: "doubled-word",
    re: /\b([A-Za-z]{2,})\s+\1\b/i, say: "a word typed twice" },
  // "go" takes a destination through a preposition — "go TO the playground" — so a bare
  // noun phrase after it is a dropped word. The Grade 1 CTS Learner's Book writes "With
  // your teacher go to the playground;" on printed page 7 and "With your teacher go the
  // nearest road;" on page 10: the same instruction, four pages apart, one of them a word
  // short. Only the go-family is tested, because it is the one whose bare-object form is
  // always wrong; "return the tools" and "move our bodies" are ordinary transitive uses,
  // which is why the verbs that have them are not here. The idioms English does allow
  // ("go the distance", "go the extra mile") are excluded outright.
  { id: "missing-preposition", fn: (t) => {
      const m = t.match(/\b(go|goes|going|went)\s+(the|a|an|your|our|my|their|his|her)\s+([a-z]+)/i);
      return !!m && !/^(distance|extra|way|rounds?|length)$/i.test(m[3]);
    }, say: "\"go\" with no preposition — \"go to the …\"" },
  // "there" as a subject needs its verb: "if there ARE no cars coming". A genuine
  // question inverts it ("Is there no other way?"), so an auxiliary before it is spared.
  { id: "there-missing-verb",
    re: /(?<!\b(?:is|are|was|were|be|been)\s)\bthere\s+no\s+[a-z]+/i,
    say: "\"there\" with no verb — \"there are no …\"" },
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
      return sentencesOf(t).some(isDirectQuestion);
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

// ---- the prose slips that ARE fixed ----------------------------------------
// The header above draws the line at judgement: a missing word cannot be restored by
// rule, so missing-to and a/an stay reports. But some of what the checks find has
// exactly ONE right answer, the same standard the spelling table is held to, and
// those are corrected rather than listed. A slip the house rules already settle is
// not a question to put to a human.
//
//   A WORD TYPED TWICE. "…serving bowls that are used used when serving soup…",
//   "…groups of 5 to 8 learners Learners including a learner with a physical
//   disability." Both are paste residue, and collapsing the pair is the only reading.
//   `had` and `that` are held back because English really does double them ("the food
//   that that group prepared", "she had had"); nothing else in these books does.
//
//   A SPACE BEFORE PUNCTUATION. "…conserving trees ." printed exactly that way.
//
// A doubled pair may differ in case ("learners Learners"), in which case the FIRST
// spelling wins — it is the one the sentence was running with.
const DOUBLE_OK = new Set(["had", "that"]);
function fixProse(text) {
  const hits = [];
  let out = String(text ?? "");
  out = out.replace(/\b([A-Za-z]{2,})(\s+)(\1)\b/gi, (m, a, sp, b) => {
    if (a.toLowerCase() !== b.toLowerCase()) return m;
    if (DOUBLE_OK.has(a.toLowerCase())) return m;
    hits.push(`"${a}${sp}${b}" -> "${a}"`);
    return a;
  });
  out = out.replace(/([A-Za-z]) ([.,;:!?])(?= |$)/g, (m, c, p) => {
    hits.push(`"${c} ${p}" -> "${c}${p}"`);
    return c + p;
  });
  return { text: out, hits };
}

// A line whose final sentence is a DIRECT question but carries no question mark: the
// mark is the one thing missing and there is no second reading, so supply it. Returns
// the corrected line, or null when there is nothing to do. Kept separate from
// fixProse() because it needs the whole line — a sentence runs across several Word
// runs, and fixProse works a run at a time.
function fixQuestionMark(line) {
  const t = String(line ?? "");
  if (!t.trim() || t.includes("?")) return null;
  // The same guards the reporting check applies, which this path did not carry. A line
  // already ending in "!" is punctuated — as an exclamation, deliberately — and is never
  // an unmarked question; a line ending in ":" introduces its own list; a line carrying a
  // newline is a stem plus that list, not a sentence; and an ALL-CAPS line is a heading.
  // Without these, "Have fun as you learn new skills!" and the stem "Do the following:"
  // both had a question mark written into them.
  const trimmed = t.trim();
  if (/[!:]$/.test(trimmed) || trimmed.includes("\n")) return null;
  if (trimmed === trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) return null;
  const parts = sentencesOf(t);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  if (!isDirectQuestion(last)) return null;
  // Replace a trailing full stop, or append when the author typed no terminator at all.
  const fixed = /[.!]$/.test(t.trimEnd()) ? t.trimEnd().replace(/[.!]$/, "?") : t.trimEnd() + "?";
  return fixed === t ? null : fixed;
}

module.exports = { toBritish, britishWord, proseIssues, fixProse, fixQuestionMark, isDirectQuestion, WORDS };
