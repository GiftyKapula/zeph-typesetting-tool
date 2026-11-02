// The poster code may use ONLY the front cover and the book's metadata: never admin/
// (authors' forms with phone numbers), never the network, never an interior page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "poster");
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|js|typ|json)$/.test(e.name)) files.push(p); } };
walk(DIR);
const code = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(\/\/|"_note)/.test(l)).join("\n");

test("no poster file reads admin/ or local-language-forms", () => {
  for (const f of files) assert.doesNotMatch(code(f), /admin[\\/]|local-language-forms/, path.basename(f));
});

test("no poster file can reach the network", () => {
  for (const f of files) assert.doesNotMatch(code(f), /\bfetch\(|require\(["'](https?|net|dgram)["']\)|from ["']node:(https?|net)["']|from ["'](https?|net)["']|XMLHttpRequest|WebSocket/, path.basename(f));
});

test("only page 1 of a book is ever rendered (page 2 is read for its size alone)", () => {
  const cover = code(path.join(DIR, "lib", "cover.mjs"));
  const calls = [...cover.matchAll(/getPage\((\d+)\)/g)].map((m) => +m[1]);
  assert.deepEqual([...new Set(calls)].sort(), [1, 2]);
  assert.match(cover, /getPage\(2\)\)\.getViewport\(\{ scale: 1 \}\);\s*\/\/ size only/);
  assert.equal((cover.match(/\.render\(/g) || []).length, 1, "one render call: page 1");
});
