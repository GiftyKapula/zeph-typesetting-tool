#!/usr/bin/env node
// Turn the authors' returned "Local Language Words" forms into the engine's word lists:
// one src/typeset/lexicon/<language>.json per language, holding EVERY wording any
// author gave for each concept (authors of the same language often differ, e.g. Lunda
// Unit = "Chibalu" or "Chikunku"), plus the words the engine already used.
//
//   node tools/lexicon/import-forms.js [formsDir]
//     formsDir defaults to admin/local-language-forms/Received Filled-in Forms
//     (*.docx forms) + tools/lexicon/manual/*.json (hand-typed scanned forms).

const fs = require("fs");
const path = require("path");
const { readForm } = require("./read-form.js");
const { TERMS, KNOWN } = require("./terms.js");

const ROOT = path.join(__dirname, "..", "..");
const formsDir = path.resolve(process.argv[2] || path.join(ROOT, "admin", "local-language-forms", "Received Filled-in Forms"));
const manualDir = path.join(__dirname, "manual");
const outDir = path.join(ROOT, "src", "typeset", "lexicon");

// The form's English row label -> concept id.
const norm = (s) => String(s || "").toLowerCase().replace(/[’'`]/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
const LABEL = new Map(TERMS.map((t) => [norm(t.en), t.id]));
for (const [label, id] of Object.entries({
  "authors": "author_section",
  "author s": "author_section",
  "author one": "author_one",          // a singular the cover uses for one name (Chitonga Mulembi)
  "acronyms": "acronyms",
  "ordinary level secondary": "level_ordinary",
  "advanced secondary education level": "level_advanced",
  "early childhood education level": "level_ece",
  "language structure grammar": "language_structure",
  "comprehension": "reading_comprehension",
  "summary": "summary_writing",
  "end of topic assessment": "assessment_topic",
  "end of unit assessment": "assessment_unit",
  "did you know": "did_you_know",
  "key points": "key_points",
  "note to the teacher": "note_teacher",
  "possible answers": "possible_answers",
  "specific competences": "specific_competences",
  "expected standards": "expected_standards",
  "key competences": "key_competences",
  "table of contents": "contents",
  "acknowledgement": "acknowledgement",
  "references": "references",
  "unit": "unit",
  "lesson": "lesson",
})) LABEL.set(label, id);

// Form "Language" line -> our language id.
function langId(s) {
  const t = String(s || "").toLowerCase();
  if (/bemba/.test(t)) return "bemba";
  if (/tonga/.test(t)) return "tonga";
  if (/nyanja/.test(t)) return "nyanja";
  if (/lunda/.test(t)) return "lunda";
  if (/luvale/.test(t)) return "luvale";
  if (/lozi/.test(t)) return "silozi";
  if (/kaonde/.test(t)) return "kaonde";
  return null;
}

// A cell's wording -> clean variants ("-", blanks and trailing full stops dropped).
const variants = (cell) => String(cell || "").split(/\s*(?:;|\s\/\s)\s*/)
  .map((v) => v.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim())
  .filter((v) => v && !/^[-–—_]+$/.test(v));

async function collect() {
  const forms = [];
  for (const f of fs.existsSync(formsDir) ? fs.readdirSync(formsDir) : []) {
    if (!/\.docx$/i.test(f) || f.startsWith("~$")) continue;
    const r = await readForm(path.join(formsDir, f));
    forms.push({ source: f, ...r });
  }
  for (const f of fs.existsSync(manualDir) ? fs.readdirSync(manualDir) : []) {
    if (!/\.json$/i.test(f)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(manualDir, f), "utf8"));
    forms.push({ source: j.source || f, header: j.header, rows: j.rows });
  }
  return forms;
}

(async () => {
  const forms = await collect();
  const langs = {};
  const unmatched = [];
  for (const form of forms) {
    const lang = langId(form.header.language) || langId(form.source);
    if (!lang) { console.warn("!  language not recognised:", form.source); continue; }
    const L = (langs[lang] ||= { language: lang, sources: [], terms: {}, extras: [] });
    // (phone numbers authors wrote next to their name are dropped: these files are shared)
    const noPhone = (s) => String(s || "").replace(/\(?\+?\d[\d\s/,-]{6,}\d\)?/g, "").replace(/\(\s*\)/g, "").replace(/\s+/g, " ").trim();
    L.sources.push({ file: form.source, author: noPhone(form.header["your name"]), book: noPhone(form.header["book and grade"]) });
    let extrasTable = false;
    for (const row of form.rows) {
      const [en, local] = row;
      if (/^your word$/i.test((en || "").trim())) { extrasTable = true; continue; }
      if (extrasTable) {
        // "Any other headings" table: [their word, English meaning]
        for (const v of variants(en)) L.extras.push({ word: v, meaning: (local || "").replace(/[.\s]+$/, "").trim() });
        continue;
      }
      if (row.length < 2) continue;                       // a group heading row
      const id = LABEL.get(norm(en));
      if (!id) { if (norm(en) && !/^english$/.test(norm(en))) unmatched.push(`${form.source}: "${en}"`); continue; }
      for (const v of variants(local)) {
        const list = (L.terms[id] ||= []);
        if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
      }
    }
  }
  // Words the engine already used (from the writers' earlier term lists) stay in, so
  // nothing that typesets today stops being recognised. Skip guesses marked "(?)".
  for (const [lang, terms] of Object.entries(KNOWN)) {
    const L = (langs[lang] ||= { language: lang, sources: [], terms: {}, extras: [] });
    for (const [id, word] of Object.entries(terms)) {
      for (const v of word.split(/\s*\/\s*/)) {
        if (/\(\?\)/.test(v)) continue;
        const list = (L.terms[id] ||= []);
        if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
      }
    }
  }
  // Reviewed clashes / slips (tools/lexicon/corrections.json) are dropped.
  const corrFile = path.join(__dirname, "corrections.json");
  const drops = fs.existsSync(corrFile) ? JSON.parse(fs.readFileSync(corrFile, "utf8")).drop || [] : [];
  for (const d of drops) {
    const L = langs[d.language];
    const list = L && L.terms[d.id];
    if (!list) continue;
    const i = list.findIndex((w) => w.toLowerCase() === d.word.toLowerCase());
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete L.terms[d.id];
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const L of Object.values(langs)) {
    // the same wording given for two different BOX kinds would make the engine guess;
    // record it so the typesetter can see it (the engine resolves it by priority).
    // (concepts that draw the SAME box, e.g. topic vs unit assessment, don't conflict)
    const BOX_KIND = { activity: "activity", alt_activity: "activity", exercise: "exercise", assessment_topic: "assessment", assessment_unit: "assessment", did_you_know: "fact", key_points: "keypoints" };
    const seen = {};
    L.conflicts = [];
    for (const [id, kind] of Object.entries(BOX_KIND)) for (const w of L.terms[id] || []) {
      const k = w.toLowerCase();
      if (seen[k] && seen[k].kind !== kind) L.conflicts.push({ word: w, concepts: [seen[k].id, id] });
      else if (!seen[k]) seen[k] = { id, kind };
    }
    const file = path.join(outDir, `${L.language}.json`);
    fs.writeFileSync(file, JSON.stringify(L, null, 2) + "\n");
    const n = Object.values(L.terms).reduce((a, v) => a + v.length, 0);
    console.log(`${L.language.padEnd(7)} ${String(L.sources.length).padStart(2)} form(s)  ${String(Object.keys(L.terms).length).padStart(2)} concepts  ${String(n).padStart(3)} words${L.conflicts.length ? `  conflicts: ${L.conflicts.map((c) => `${c.word} (${c.concepts.join(" / ")})`).join(", ")}` : ""}`);
  }
  if (unmatched.length) console.log("unmatched form rows:\n  " + unmatched.join("\n  "));
})();
