// The concepts the typesetting engine recognises by their WORDING (a heading, a box
// title, a cover line…). Each language's lexicon maps these ids to the exact words its
// authors use. This list drives the author form (make-forms.js) and, later, the engine.
//
// id      stable key used by the engine — never rename once forms are out
// group   section of the form
// en      the English term the engine already knows
// where   plain explanation for the author of where the word appears

const TERMS = [
  // --- Cover and title page ---
  { id: "level_ece", group: "Cover and title page", en: "Early Childhood Education Level", where: "Top line of the cover of an ECE book" },
  { id: "level_primary", group: "Cover and title page", en: "Primary Education Level", where: "Top line of the cover of a Grade 1–7 book" },
  { id: "level_ordinary", group: "Cover and title page", en: "Secondary Education Ordinary Level", where: "Top line of the cover of a Form 1–4 book" },
  { id: "level_advanced", group: "Cover and title page", en: "Secondary Education Advanced Level", where: "Top line of the cover of a Form 5–6 book" },
  { id: "grade", group: "Cover and title page", en: "Grade", where: "As in “Grade 2” on the cover" },
  { id: "form", group: "Cover and title page", en: "Form", where: "As in “Form 1” on the cover" },
  { id: "learners_book", group: "Cover and title page", en: "Learner's Book", where: "Book type on the cover" },
  { id: "teachers_guide", group: "Cover and title page", en: "Teacher's Guide", where: "Book type on the cover" },
  { id: "authors_label", group: "Cover and title page", en: "Authors / Written by", where: "Label above the author names on the cover" },
  { id: "edited_by", group: "Cover and title page", en: "Edited by", where: "Copyright page credit" },
  { id: "illustrated_by", group: "Cover and title page", en: "Illustrated by", where: "Copyright page credit" },
  { id: "all_rights", group: "Cover and title page", en: "All rights reserved", where: "Copyright page" },

  // --- Front matter (pages before Topic/Unit 1) ---
  { id: "contents", group: "Front matter", en: "Table of Contents", where: "Heading of the contents page" },
  { id: "author_section", group: "Front matter", en: "Author(s) (about the authors)", where: "Heading of the page describing the writers" },
  { id: "editor_section", group: "Front matter", en: "Editor(s)", where: "Heading of the page describing the editor" },
  { id: "foreword", group: "Front matter", en: "Foreword", where: "Heading of the Foreword page" },
  { id: "preface", group: "Front matter", en: "Preface", where: "Heading of the Preface page" },
  { id: "acknowledgement", group: "Front matter", en: "Acknowledgement(s)", where: "Heading of the Acknowledgement page" },
  { id: "introduction", group: "Front matter", en: "Introduction", where: "Heading of the book's Introduction (and of each topic's introduction)" },
  { id: "how_to_use", group: "Front matter", en: "How to use this book / guide", where: "Heading of the page explaining how to use the book" },
  { id: "key_competences", group: "Front matter", en: "Key competences (to be developed)", where: "Heading of the competences page" },
  { id: "list_of_figures", group: "Front matter", en: "List of Figures", where: "Heading of the list of pictures" },
  { id: "list_of_tables", group: "Front matter", en: "List of Tables", where: "Heading of the list of tables" },
  { id: "acronyms", group: "Front matter", en: "Acronyms / Abbreviations", where: "Heading of the list of short forms" },

  // --- Book structure (the big headings) ---
  { id: "unit", group: "Book structure", en: "Unit / Chapter", where: "The biggest part of the book, e.g. “Unit 1: …”" },
  { id: "topic", group: "Book structure", en: "Topic", where: "E.g. “Topic 1.1: …”" },
  { id: "subtopic", group: "Book structure", en: "Sub-topic", where: "E.g. “Sub-topic 1.1.1: …”" },
  { id: "lesson", group: "Book structure", en: "Lesson", where: "E.g. “Lesson 3” (mostly Teacher's Guides)" },
  { id: "theme", group: "Book structure", en: "Theme", where: "If your units have a theme line under the unit title" },

  // --- Language skill strands (language books) ---
  { id: "listening_speaking", group: "Language skills", en: "Listening and Speaking", where: "Skill section heading inside a unit" },
  { id: "reading", group: "Language skills", en: "Reading", where: "Skill section heading" },
  { id: "reading_comprehension", group: "Language skills", en: "Reading comprehension", where: "Skill section heading" },
  { id: "writing", group: "Language skills", en: "Writing", where: "Skill section heading" },
  { id: "language_structure", group: "Language skills", en: "Language structure / Grammar", where: "Skill section heading" },
  { id: "vocabulary", group: "Language skills", en: "Vocabulary / New words", where: "Word list or section heading" },
  { id: "summary_writing", group: "Language skills", en: "Summary", where: "Summary writing section" },
  { id: "composition", group: "Language skills", en: "Composition", where: "Composition / essay section" },
  { id: "literature", group: "Language skills", en: "Literature", where: "Literature section heading" },
  { id: "poem", group: "Language skills", en: "Poem", where: "Title line before a poem" },
  { id: "story", group: "Language skills", en: "Story / Passage", where: "Title line before a reading passage" },

  // --- Competences and lesson details ---
  { id: "general_competences", group: "Competences and lesson details", en: "General competences", where: "Label at the start of a topic or lesson" },
  { id: "specific_competences", group: "Competences and lesson details", en: "Specific competence(s)", where: "Label at the start of a sub-topic" },
  { id: "expected_standards", group: "Competences and lesson details", en: "Expected standard(s)", where: "Label at the start of a sub-topic" },
  { id: "expected_competences", group: "Competences and lesson details", en: "Expected competences", where: "Last line inside a learning activity" },
  { id: "you_will_learn", group: "Competences and lesson details", en: "In this topic you will learn to…", where: "Opening line before the competences" },
  { id: "teaching_materials", group: "Competences and lesson details", en: "Teaching and learning materials / resources", where: "Teacher's Guide lesson label" },
  { id: "lesson_steps", group: "Competences and lesson details", en: "Lesson steps / Procedure", where: "Teacher's Guide lesson label" },
  { id: "teacher_activity", group: "Competences and lesson details", en: "Teacher's activity", where: "Teacher's Guide lesson label" },
  { id: "learner_activity", group: "Competences and lesson details", en: "Learners' activity", where: "Teacher's Guide lesson label" },
  { id: "duration", group: "Competences and lesson details", en: "Time / Duration", where: "Teacher's Guide lesson label" },

  // --- Boxes (the engine draws a box around these) ---
  { id: "activity", group: "Boxes", en: "Learning Activity", where: "Title of an activity box, e.g. “Learning Activity 3: …”" },
  { id: "alt_activity", group: "Boxes", en: "Alternative Activity", where: "Activity for schools without the equipment" },
  { id: "exercise", group: "Boxes", en: "Exercise", where: "Title of an exercise box, e.g. “Exercise 2”" },
  { id: "assessment_topic", group: "Boxes", en: "End of Topic Assessment", where: "Questions at the end of a topic" },
  { id: "assessment_unit", group: "Boxes", en: "End of Unit Assessment", where: "Questions at the end of a unit" },
  { id: "revision", group: "Boxes", en: "Revision exercise", where: "Revision questions" },
  { id: "project", group: "Boxes", en: "Project", where: "A project task" },
  { id: "homework", group: "Boxes", en: "Homework / Activity at home", where: "Work to do at home" },
  { id: "did_you_know", group: "Boxes", en: "Did you know?", where: "Fact box" },
  { id: "key_points", group: "Boxes", en: "Key points / Remember", where: "Summary box of important points" },
  { id: "note_teacher", group: "Boxes", en: "Note to the teacher", where: "Teacher's Guide note box" },
  { id: "example", group: "Boxes", en: "Example", where: "A worked example" },
  { id: "safety", group: "Boxes", en: "Safety first / Caution", where: "Safety warning" },

  // --- Answers (mostly Teacher's Guides) ---
  { id: "possible_answers", group: "Answers", en: "Possible answers", where: "Answer key under an exercise" },
  { id: "expected_responses", group: "Answers", en: "Expected responses", where: "Answer under an activity" },
  { id: "answers", group: "Answers", en: "Answers", where: "Plain answers heading" },
  { id: "marks", group: "Answers", en: "Marks", where: "E.g. “(5 marks)” after a question" },

  // --- Instructions that start questions ---
  { id: "work_groups", group: "Activity instructions", en: "Work in groups", where: "Start of an activity" },
  { id: "work_pairs", group: "Activity instructions", en: "Work in pairs", where: "Start of an activity" },
  { id: "work_individually", group: "Activity instructions", en: "or individually", where: "Added after “in groups / in pairs”" },
  { id: "choose_answer", group: "Activity instructions", en: "Choose the correct answer", where: "Instruction above multiple-choice questions" },
  { id: "fill_blanks", group: "Activity instructions", en: "Fill in the blank spaces", where: "Instruction above fill-in questions" },
  { id: "match", group: "Activity instructions", en: "Match", where: "Instruction above matching questions" },
  { id: "true_false", group: "Activity instructions", en: "True or False", where: "Instruction above true/false questions" },
  { id: "read_passage", group: "Activity instructions", en: "Read the passage / story", where: "Instruction before a passage" },

  // --- Pictures and tables ---
  { id: "figure", group: "Pictures and tables", en: "Figure (Fig.)", where: "Picture caption, e.g. “Figure 2: …”" },
  { id: "table", group: "Pictures and tables", en: "Table", where: "Table caption, e.g. “Table 1: …”" },
  { id: "step", group: "Pictures and tables", en: "Step", where: "E.g. “Step 1: …” in instructions" },

  // --- Back matter ---
  { id: "glossary", group: "Back matter", en: "Glossary", where: "Word list at the end of the book" },
  { id: "references", group: "Back matter", en: "References / Bibliography", where: "Books used, at the end" },
  { id: "index", group: "Back matter", en: "Index", where: "Index at the end" },
  { id: "appendix", group: "Back matter", en: "Appendix", where: "Extra material at the end" },
];

// The seven Zambian regional languages we publish in.
const LANGUAGES = [
  { id: "bemba", name: "Icibemba (Bemba)" },
  { id: "kaonde", name: "Kiikaonde (Kaonde)" },
  { id: "silozi", name: "Silozi (Lozi)" },
  { id: "lunda", name: "Chilunda (Lunda)" },
  { id: "luvale", name: "Luvale" },
  { id: "nyanja", name: "Cinyanja (Nyanja)" },
  { id: "tonga", name: "Chitonga (Tonga)" },
];

// What the engine already uses (from the writers' earlier term lists and past books).
// Shown on the form for the author to confirm or correct. A trailing "(?)" marks a
// term inferred from a manuscript's headings rather than given to us by a writer.
const KNOWN = {
  bemba: { topic: "Umutwe", subtopic: "Umutwe unoono", activity: "Ifyakucita", exercise: "Umulimo", assessment_topic: "Ukweshiwa kwa pampela ya isambililo" },
  kaonde: { topic: "Mutwe", subtopic: "Mutwe-kache", activity: "Mwingilo wakuuba", exercise: "Mwingilo", assessment_topic: "Kupwa kwa mutwe" },
  silozi: { topic: "Tuto", subtopic: "Tutonyana", activity: "Musebezi", exercise: "Zakueza", assessment_topic: "Tatubo ya mafelelezo ya tuto / Mukanga", learners_book: "Buka ya Mwana Sikolo" },
  lunda: { topic: "Mutu Wansañu", subtopic: "Mutu Wansañu Wantanya", activity: "Zhakwila", exercise: "Mudimu", assessment_topic: "Kweseka kwahachibalu", unit: "Chibalu", author_section: "Ansoneki", foreword: "Mazu Atachi", preface: "Kulema kwamukanda wunu", acknowledgement: "Kusakilila", introduction: "Kulumbulula", learners_book: "Mukanda Wakadizi" },
  luvale: { topic: "Chihande", subtopic: "Mutwe wachihande", activity: "Vyakulinga", exercise: "Mulimo", assessment_topic: "Esekelo yakusoka chihande", unit: "Chihanda (?)", foreword: "Mazu Atete (?)", acknowledgement: "Kusakwilila (?)" },
  nyanja: { topic: "Mutu", subtopic: "Mutu waung'ono", activity: "Nchito", exercise: "Zocita", assessment_topic: "Mayeso a kutha kwa mutu", unit: "Capamutu", key_points: "Mau ofunika kudziwa" },
  tonga: { topic: "Mutwe", subtopic: "Mutwe Musyoonto", activity: "Cakucita", exercise: "Mulimo", assessment_topic: "Musunko", unit: "Cipati", author_section: "Balembi (?)" },
};

module.exports = { TERMS, LANGUAGES, KNOWN };
