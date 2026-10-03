#!/usr/bin/env node
// Build the ONE simple Word form we send to every local-language writer: a short
// note, then a two-column table (English word | how you write it in your language).
// Kept deliberately short so it does not feel like work.
//
//   node tools/lexicon/make-word-form.js [outFile]

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  AlignmentType, BorderStyle, ShadingType,
} = require("docx");

const ROOT = path.join(__dirname, "..", "..");
const out = path.resolve(process.argv[2] || path.join(ROOT, "admin", "local-language-forms", "ZEPH Local Language Words Form.docx"));
fs.mkdirSync(path.dirname(out), { recursive: true });

const FONT = "Arial";
const TEAL = "0F6E73";

// Only the words the typesetting really depends on, in everyday language.
const SECTIONS = [
  ["On the cover", [
    "Grade", "Form", "Learner's Book", "Teacher's Guide", "Primary Education Level", "Ordinary Level (Secondary)",
  ]],
  ["Pages at the beginning of the book", [
    "Table of Contents", "Authors", "Foreword", "Preface", "Acknowledgement", "Introduction", "Key Competences", "Acronyms",
  ]],
  ["Headings inside the book", [
    "Unit", "Topic", "Sub-topic", "Lesson", "Specific Competences", "Expected Standards",
    "Listening and Speaking", "Reading", "Writing", "Language Structure (Grammar)", "Comprehension", "Summary",
  ]],
  ["Boxes and questions", [
    "Learning Activity", "Alternative Activity", "Exercise", "End of Topic Assessment", "End of Unit Assessment",
    "Did you know?", "Key Points", "Note to the Teacher", "Example", "Possible Answers",
  ]],
  ["Pages at the end of the book", ["Glossary", "References"]],
];

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: (o.size || 11) * 2, bold: o.bold, italics: o.italic, color: o.color });
const para = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [run(children, o)], spacing: { after: o.after ?? 120 }, alignment: o.align });

const line = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: line, bottom: line, left: line, right: line };
const cell = (children, o = {}) => new TableCell({
  children: [new Paragraph({ children: [run(children, { bold: o.bold, color: o.color })], spacing: { before: 60, after: 60 } })],
  width: { size: o.w, type: WidthType.PERCENTAGE },
  shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
  borders,
});

const rows = [new TableRow({
  tableHeader: true,
  children: [
    cell("English", { bold: true, color: "FFFFFF", fill: TEAL, w: 45 }),
    cell("How you write it in your language", { bold: true, color: "FFFFFF", fill: TEAL, w: 55 }),
  ],
})];
for (const [title, words] of SECTIONS) {
  rows.push(new TableRow({
    children: [new TableCell({
      columnSpan: 2, borders, shading: { type: ShadingType.CLEAR, color: "auto", fill: "E8F3F3" },
      children: [new Paragraph({ children: [run(title, { bold: true, color: TEAL })], spacing: { before: 60, after: 60 } })],
    })],
  }));
  for (const w of words) rows.push(new TableRow({ children: [cell(w, { w: 45 }), cell("", { w: 55 })] }));
}

const blankRows = (n) => Array.from({ length: n }, () => new TableRow({ children: [cell("", { w: 45 }), cell("", { w: 55 })] }));

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
    children: [
      para([run("Zambia Educational Publishing House", { size: 10, color: "666666" })], { after: 60 }),
      para([run("Local Language Words", { size: 18, bold: true, color: TEAL })], { after: 200 }),
      para([run("Dear Author,")]),
      para([run("To lay out your book correctly, we need to know how you write a few common words in your language. Please write each word exactly the way you wrote it in your book (same spelling and the same special letters). It should only take about 10 minutes. Thank you!")], { after: 240 }),
      para([run("Language: ", { bold: true }), run("______________________________")], { after: 80 }),
      para([run("Your name: ", { bold: true }), run("______________________________")], { after: 80 }),
      para([run("Book and grade: ", { bold: true }), run("______________________________")], { after: 240 }),
      new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
      para([run("If your book does not use a word, just leave it blank.", { italic: true, size: 10, color: "666666" })], { after: 300 }),
      para([run("Any other headings or labels you use in your book?", { bold: true })], { after: 120 }),
      new Table({
        rows: [new TableRow({ tableHeader: true, children: [
          cell("Your word", { bold: true, color: "FFFFFF", fill: TEAL, w: 45 }),
          cell("What it means in English", { bold: true, color: "FFFFFF", fill: TEAL, w: 55 }),
        ] }), ...blankRows(4)],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }),
      para("", { after: 240 }),
      para([run("Please send the completed form back to ZEPH. Thank you for your help!", { italic: true })]),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log("wrote", path.relative(ROOT, out), `(${SECTIONS.reduce((n, s) => n + s[1].length, 0)} words)`);
});
