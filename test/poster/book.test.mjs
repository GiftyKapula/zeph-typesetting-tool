import test from "node:test";
import assert from "node:assert/strict";
import { typstArgs, coverFromSource, fieldsFromCover } from "../../tools/poster/lib/book.mjs";
import { frontPanel } from "../../tools/poster/lib/cover.mjs";

const TYP = [
  '#let T = (',
  '  labels: (grade: "Geledi", form: "Fomu", tg: "Icitabo Cakwa Kafundisha", lb: "Icitabo ca Musambi", authors: "Bakalemba"),',
  ')',
  '#cover(("AMASAMBILILO YA KUBALILAPO", "ICIBEMBA GRADE 4", "Icitabo Cakwa Kafundisha",), ("E. Bwalya", "M. Nambao (Dr.)", "C. Whiscals",), (file: "cover_hero.png", w: 0, h: 0), none, none)',
  '#para("interior text the poster must never use")',
].join("\n");

test("Typst call arguments: brackets inside strings don't end an argument", () => {
  const a = typstArgs('#cover(("A", "B (x)",), ("M. Nambao (Dr.)", "C. W",), none)', 2);
  assert.deepEqual(a, ['"A", "B (x)",', '"M. Nambao (Dr.)", "C. W",']);
});

test("the cover's words, byline and own-language labels come out of _source.typ", () => {
  const c = coverFromSource(TYP);
  assert.deepEqual(c.lines, ["AMASAMBILILO YA KUBALILAPO", "ICIBEMBA GRADE 4", "Icitabo Cakwa Kafundisha"]);
  assert.deepEqual(c.byline, ["E. Bwalya", "M. Nambao (Dr.)", "C. Whiscals"]);
  assert.equal(c.labels.grade, "Geledi");
});

test("a Zambian-language book's poster fields use the book's own words", () => {
  const f = fieldsFromCover(coverFromSource(TYP));
  assert.equal(f.subject, "ICIBEMBA");
  assert.equal(f.level, "Geledi 4");
  assert.equal(f.booktype, "Icitabo Cakwa Kafundisha");
  assert.equal(f.authorsLabel, "Bakalemba");
  assert.equal(f.authors.length, 3);
});

test("an English book falls back to English labels", () => {
  const f = fieldsFromCover({ lines: ["PHYSICS", "FORM 2", "Learner's Book"], byline: ["A. Banda"], labels: {} });
  assert.equal(f.subject, "PHYSICS");
  assert.equal(f.level, "Form 2");
  assert.equal(f.booktype, "Learner's Book");
  assert.equal(f.authorsLabel, "Author", "one author: singular");
});

test("no build yet: fields come from the overrides and file name", () => {
  const f = fieldsFromCover({ lines: [], byline: [], labels: {} }, { subject: "Geography", level: "Grade 5", booktype: "Teacher's Guide", authors: [] });
  assert.equal(f.title, "Geography Grade 5 Teacher's Guide");
  assert.deepEqual(f.authors, []);
});

test("front cover on page 1: the whole page, or the right-hand panel of a cover sheet", () => {
  assert.deepEqual(frontPanel([499, 709], [499, 709]), { x: 0, y: 0, w: 499, h: 709, spread: false });
  // B5 book, 12 mm spine, 2 mm trim allowance: sheet = 2W + spine + 2B wide, H + 2B high
  const B = 2 * 72 / 25.4, W = 499, H = 709, SW = 12 * 72 / 25.4;
  const p = frontPanel([2 * W + SW + 2 * B, H + 2 * B], [W, H]);
  assert.equal(p.spread, true);
  assert.ok(Math.abs(p.x - (W + B + SW)) < 0.01 && Math.abs(p.y - B) < 0.01 && p.w === W && p.h === H);
});
