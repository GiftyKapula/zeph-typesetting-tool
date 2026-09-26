// ZEPH series front matter (B5 house style) and front-matter ordering.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)


// A reading-lesson activity ("Activity 2: Read the story") is followed in the
// manuscript by the passage itself — a story TITLE (a `head`/h2/h3) plus its
// paragraphs. boxifyActivities normally ends an activity box at the next content
// heading, so only the "Read the story" instruction stays in the box while the
// story orphans as top-level text (often onto the next page). When a box's
// instruction matches this, its box is allowed to absorb the following passage
// title + body (see boxifyActivities).
const READINSTR = /\bread\b[^.]*\b(stor(y|ies)|passage|text|poem|paragraph|dialogue|conversation|letter|note|sentences?)\b/i;

function formatGrade3EngFrontMatter(blocks, detectName) {
  if (!/grade\s*3.*eng/i.test(detectName) && !/eng.*grade\s*3/i.test(detectName)) return;

  const covIdx = blocks.findIndex((b) => b && b.t === "cover");
  if (covIdx < 0) return;

  const imprintBlocks = [
    { t: "showpage" },
    { t: "para", segs: [{ t: "© Zambia Educational Publishing House, 2026.", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    {
      t: "para",
      segs: [{
        t: "All rights reserved. No part of this publication may be reproduced, stored in a retrieval system or transmitted in any form or any means, electronic, mechanical, photocopying, recording, or otherwise, without the prior written permission of the copyright owner or publisher.",
        b: false,
        it: false
      }],
      align: "center"
    },
    { t: "vspace", h: "3mm" },
    { t: "para", segs: [{ t: "ISBN ........", b: false, it: false }], align: "center" },
    { t: "vspace", h: "5mm" },
    { t: "para", segs: [{ t: "Edited by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Bridget Moya and Agness Mumba Wilkins", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    { t: "para", segs: [{ t: "Illustrated by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Njekwa Njekwa", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    { t: "para", segs: [{ t: "Cover and book layout by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Gift Kapula", b: false, it: false }], align: "center" },
    { t: "vspace", h: "5mm" },
    { t: "para", segs: [{ t: "First Published 2026 by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Zambia Educational Publishing House\nP. O. Box 32664\nLusaka, Zambia", b: false, it: false }], align: "center" },
    { t: "vspace", h: "4mm" },
    { t: "para", segs: [{ t: "Printed by:", b: true, it: false }], align: "center" },
    { t: "para", segs: [{ t: "Zambia Educational Publishing House\nLusaka, Zambia", b: false, it: false }], align: "center" },
    { t: "showpage" }
  ];

  const authorHeadIdx = blocks.findIndex((b) => b && (b.t === "h1" || b.t === "head") && /THE\s+AUTHOR/i.test(b.text || ""));

  if (authorHeadIdx > covIdx) {
    blocks.splice(covIdx + 1, authorHeadIdx - (covIdx + 1), ...imprintBlocks);
  }

  const newAuthorHeadIdx = blocks.findIndex((b) => b && (b.t === "h1" || b.t === "head") && /THE\s+AUTHOR/i.test(b.text || ""));
  if (newAuthorHeadIdx >= 0 && newAuthorHeadIdx + 1 < blocks.length) {
    const bioBlk = blocks[newAuthorHeadIdx + 1];
    let bioText = "";
    if (typeof bioBlk === "string") bioText = bioBlk;
    else if (bioBlk.text) bioText = bioBlk.text;
    else if (Array.isArray(bioBlk.segs)) bioText = bioBlk.segs.map((s) => s.t || "").join("");

    if (/Njekwa Njekwa/i.test(bioText)) {
      const colIdx = bioText.indexOf(":");
      const prefix = colIdx >= 0 ? bioText.slice(0, colIdx + 1) : "Njekwa Njekwa:";
      const restText = colIdx >= 0 ? bioText.slice(colIdx + 1) : bioText.replace(/Njekwa Njekwa:?/i, "");
      blocks[newAuthorHeadIdx + 1] = {
        t: "para",
        noPromote: true,
        segs: [
          { t: prefix, b: true, it: false, c: null },
          { t: restText, b: false, it: false, c: null }
        ]
      };
    }
  }
}

function applySeriesFront(blocks, { numberLessons = true, fmSpacing = "1.9em" } = {}, detectName = "") {
  formatGrade3EngFrontMatter(blocks, detectName);
  const isUnit = (x) => x.t === "h1" && /^(UNIT|TOPIC|CHAPTER|CHIBALU|CIPATI)\b/i.test(x.text || "");
  // Front-matter section names — English plus local-language equivalents
  // (e.g. Lunda: ANSONEKI=Authors, MAZU ATACHI=Foreword, KULEMA …WUNU=Preface,
  // KUSAKILILA=Acknowledgement, KULUMBULULA=Introduction). "HOW TO USE THIS
  // GUIDE/BOOK", "ABBREVIATIONS" and a "SUGGESTED TEACHING METHODOLOGY" list
  // are common Teacher's-Guide front-matter sections too, often typed with
  // direct bold/size formatting instead of a named Word Heading style (a
  // manuscript that styles most of its front matter properly can still slip
  // into hand-formatting for one or two sections) — without recognising them
  // here they fall through as a plain bold `head` block that looks like a
  // heading but never gets its own page or a Table of Contents entry.
  // "SUGGES+TED" tolerates the manuscript typo "SUGGESSTED" (a doubled S).
  const FM = /^(THE\s+)?AUTHORS?$|^EDITORS?$|^FOREW(O|A)RD$|^PREFACE$|^ACKNOWLEDG|^INTRODUCTION$|^(GENERAL|KEY)\s+COMPETEN\w*|^(LIST OF )?ACRONYMS\b|^HOW\s+TO\s+USE(\s+THIS\s+(BOOK|GUIDE))?$|^ABBREVIATIONS?$|^SUGGES+TED\s+TEACHING\s+METHODOLOGY$|^ANSONEKI$|^MAZU ATACHI$|^KULEMA\b.*\bWUNU$|^KUSAKILILA$|^KULUMBULULA$/i;
  // promote a stray front-matter section name (e.g. an un-styled "INTRODUCTION",
  // or one the source put in a bulleted list) to a real heading so it gets its
  // own page. Accept label/head AND listitem/para blocks, AND h2/h3 — a manuscript
  // sometimes styles a front-matter section as a Word "Heading2" (inconsistent with
  // its own Heading1 use elsewhere for Authors/Foreword/etc.), which the importer
  // takes at face value and emits as an h2/h3 sub-head block. Left unpromoted, that
  // heading renders as a plain in-flow sub-head with no page break before it — so it
  // silently lands wherever the preceding section's text happens to end, stranded at
  // the foot of that page instead of starting its own.
  const fmText = (x) => (x.segs ? x.segs.map((s) => s.t).join("") : (x.text || "")).trim();
  const firstUnit0 = blocks.findIndex(isUnit);
  let b = blocks.map((x, i) =>
    (firstUnit0 < 0 || i < firstUnit0) && !x.noPromote &&
    (x.t === "label" || x.t === "head" || x.t === "listitem" || x.t === "para" || x.t === "h2" || x.t === "h3") &&
    FM.test(fmText(x))
      ? { t: "h1", text: fmText(x) } : x);
  // we place our own table of contents, so drop any auto/imported one
  b = b.filter((x) => x.t !== "toc");

  // leave signature room before the signatory's name on Foreword/Preface/Ack.
  // The name can arrive as a plain paragraph OR (when bold in the source) as a
  // `head` block, so accept both.
  // Section headings that carry a signatory — English plus local-language
  // equivalents (Lunda: MAZU ATACHI=Foreword, KULEMA…WUNU=Preface,
  // KUSAKILILA=Acknowledgement) so every book's signatory groups identically.
  const SIGSEC = /FOREW|PREFACE|ACKNOWLEDG|MAZU ATACHI|KULEMA\b.*\bWUNU|KUSAKILILA/i;
  // a signatory's name: a trailing honorific "… (Dr)" / "… (Ms.)", OR a leading
  // one "Dr. Name" / "Prof. Name" / "Dr Name" (the period is optional).
  // Trailing parenthetical honorific — allow internal dots/spaces so "(Ph.D.)",
  // "(Ed.D.)", "(M.Ed.)" match as well as "(Dr)" / "(PhD)" — OR a leading title.
  const SIGNAME = /\(\s*(?:dr|ms|mr|mrs|prof|hon|ph\.?\s?d|ed\.?\s?d|m\.?\s?ed|phd)\.?\s*\)\s*$|^(?:dr|prof|mr|mrs|ms|hon)\.?\s+[A-Z]/i;
  // An honorific appearing ANYWHERE (used to catch a run-on signatory that the
  // source glued into one paragraph, e.g. "Noriana Muneku (Ms.)Permanent
  // Secretary…MINISTRY OF EDUCATION").
  const SIGINLINE = /\(\s*(?:dr|ms|mr|mrs|prof|hon|ph\.?\s?d|ed\.?\s?d|m\.?\s?ed|phd)\.?\s*\)/i;
  const plainOfBlk = (x) => (x.t === "head" || x.t === "label" ? (x.text || "") : (x.segs || []).map((s) => s.t).join("")).trim();
  // An organisation line in a signatory block (e.g. "Ministry of Education",
  // "Zambia Educational Publishing House") is set BOLD and UPPERCASE — the house
  // style the all-caps orgs already follow. Build one signature line, marking the
  // name (bold), all-caps lines (bold), and organisation lines (bold + uppercased).
  const SIGORG = /\b(ministr(y|ies)|publishing house|educational publishing|examinations? council|curriculum development)\b/i;
  const sigLine = (txt, isName) => {
    const isAllCaps = /[A-Z]/.test(txt) && !/[a-z]/.test(txt);
    const isOrg = SIGORG.test(txt);
    return { text: isOrg ? txt.toUpperCase() : txt, bold: isName || isAllCaps || isOrg };
  };
  const isText = (x) => x && (x.t === "para" || x.t === "head" || x.t === "label");
  const isBold = (x) => x.t === "head" || x.t === "label" || (x.segs ? x.segs.some((s) => s.b) : false);
  {
    let section = "", done = false, withSig = [];
    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      if (x.t === "h1") { section = x.text || ""; done = false; withSig.push(x); continue; }
      const plain = plainOfBlk(x);
      // A run-on signatory: one paragraph that carries the honorific inline and
      // has SEVERAL runs (bold name / plain role / bold organisation) glued with no
      // separating space — the manuscript typed name+title+org as one paragraph
      // whose ONLY formatting break is the run boundary. Multiple non-empty runs is
      // the real signal (a clean single-run name-only line, handled by the next
      // branch below, never has more than one); a trailing "(PhD)" honorific OR a
      // leading "Dr./Prof./…" prefix both count — SIGNAME alone would wrongly
      // exclude the leading-honorific style ("Dr. Beatrice Chirwa…") since it reads
      // as a plausible standalone name line even though it is not one here.
      const runonSig = !done && SIGSEC.test(section) && x.t === "para" && Array.isArray(x.segs)
        && (SIGINLINE.test(plain) || /^(?:dr|prof|mr|mrs|ms|hon)\.?\s+[A-Z]/i.test(plain))
        && x.segs.filter((s) => s.t.trim()).length >= 2;
      if (runonSig) {
        withSig.push({ t: "sigspace" });
        const lines = x.segs.filter((s) => s.t.trim()).map((s, k) => sigLine(s.t.trim(), k === 0));
        withSig.push({ t: "signature", lines });
        done = true;
        continue;
      }
      // A signatory NAME line is short ("Agness Mumba Wilkins (PhD)"); a prose sentence that
      // merely starts with an honorific ("Mr. Eustace Panga Museka wrote the book…") is not a
      // signature, so cap the length or it steals the block from the real signatory below it.
      if (!done && SIGSEC.test(section) && isText(x) && SIGNAME.test(plain) && plain.length <= 60) {
        // Leave room for a hand signature, then render the signatory block (name,
        // title, organisation) as a dedicated block whose lines are EVENLY spaced
        // — consistent across every book (the template controls the gap).
        withSig.push({ t: "sigspace" });
        let j = i;
        const lines = [];
        while (j < b.length && isText(b[j])) {
          // The signatory's name (the first line) is always bold; an all-caps
          // organisation line (e.g. "ZAMBIA EDUCATIONAL PUBLISHING HOUSE") is bold
          // too; the title line (e.g. "Board Chairperson") is always regular weight.
          lines.push(sigLine(plainOfBlk(b[j]), j === i));
          j++;
        }
        withSig.push({ t: "signature", lines });
        done = true;
        i = j - 1;
        continue;
      }
      withSig.push(x);
    }
    b = withSig;
  }

  // number the lessons (h2) within each body unit (1, 2, 3…), restarting per
  // unit, by baking the number into the heading text — so it shows in BOTH the
  // body and the generated table of contents. (Skipped when the manuscript's
  // sub-topics are already numbered, e.g. Physics "Sub-Topic 4.1.1: …".)
  if (numberLessons) {
    // A back-matter section (APPENDICES, GLOSSARY, REFERENCES…) after the last unit
    // is not itself a unit and its own h2 sub-headings are not lesson components —
    // stop numbering there, or a heading like "STANDARD PERFORMANCE LEVELS (CBC)"
    // wrongly inherits the LAST unit's running count ("4." tacked onto the first
    // back-matter h2, continuing from that unit's own 1/2/3).
    const BACKMATTER = /^(GLOSSARY|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX|ACRONYMS)\b/i;
    let n = 0, inUnit = false;
    for (const x of b) {
      if (isUnit(x)) { inUnit = true; n = 0; }
      else if (inUnit && (x.t === "h1" || x.t === "head" || x.t === "label") && BACKMATTER.test((x.text || "").trim())) { inUnit = false; }
      // Skip sub-topics the manuscript already numbers ("SUB-TOPIC 3.1.1: …" or a
      // bare "3.1.1 …") — only auto-number named lessons (the English gospel).
      // No \b after TOPIC here: a manuscript sometimes glues the number straight onto the
      // word ("Sub- Topic1.1.2"), and \b never fires between a letter and a following
      // digit (both are "word" characters, so there is no boundary to match).
      // "Introduction" and "Tumbling Activities" are excluded book-wide: an author
      // round explicitly asked for these two to carry NO number (CTS Grade 3 LB —
      // "remove this number" on both), while every other numbered h2 in this book
      // was left alone/wanted renumbered, not stripped. Excluded from the COUNT too
      // (not just unlabelled), so a later sibling doesn't skip a number.
      else if (inUnit && x.t === "h2" && /^(introduction|tumbling activities)$/i.test((x.text || "").trim())) {
        // no-op: leave unnumbered, don't advance n
      } else if (inUnit && x.t === "h2" && !/^(SUB[-\s‐-―]*TOPIC|TOPIC)\s*:?\s*[\d.]/i.test(x.text) && !/^\d+(\.\d+)+\b/.test(x.text)) {
        n += 1; x.text = `${n}. ${x.text}`;
      }
    }
  }

  const coverIdx = b.findIndex((x) => x.t === "cover");
  const unitIdx = b.findIndex(isUnit);
  // first front-matter heading = first h1 before the body units (else the units)
  const frontI = b.findIndex((x, i) => x.t === "h1" && (unitIdx < 0 || i < unitIdx));
  const out = [];
  for (let i = 0; i < b.length; i++) {
    if (coverIdx >= 0 && i === coverIdx + 1) { out.push({ t: "titlestart" }); out.push({ t: "titlepage", lines: b[coverIdx].lines, byline: b[coverIdx].byline }); }
    if (frontI >= 0 && i === frontI) { out.push({ t: "toc" }); out.push({ t: "showpage", spacing: fmSpacing }); }
    if (unitIdx >= 0 && i === unitIdx) out.push({ t: "bodystart" });
    out.push(b[i]);
  }
  // a back cover as the very last page (echoes the front; barcode/ISBN reserved)
  if (coverIdx >= 0) out.push({ t: "backcover", lines: b[coverIdx].lines, logo: b[coverIdx].logo });
  return out;
}

// HOUSE STYLE (docs/HOUSE-STYLE.md s.3): the front matter runs cover -> title page
// -> imprint -> TOC -> Authors -> Foreword -> Preface -> Acknowledgement ->
// Introduction -> (Key Competences / Acronyms) -> body. Manuscripts routinely file
// the acronyms list early instead, among the Author/Foreword/Preface pages: both ICT
// Form 2 books put it straight after AUTHOR, and both Food & Nutrition Teacher's
// Guides open the front matter with it. That is 4 of the 17 books currently built,
// across three subjects, so it is a recurring manuscript habit rather than one
// book's slip -- engine, not an override.
//
// Deliberately NARROW: it only moves an acronyms section that sits BEFORE the
// Acknowledgement, which is the unambiguous violation. A book that already has it
// after the Acknowledgement is left alone even where the order is not strictly
// house-perfect (the two Geography books run Acknowledgement -> Acronyms ->
// Introduction, with the acronyms one slot early), because those have been through
// review and re-flowing settled books to satisfy a stricter reading buys nothing.
function reorderFrontmatter(blocks) {
  const txt = (b) => {
    if (!b) return "";
    if (b.text) return b.text;
    if (b.plain) return b.plain;
    if (Array.isArray(b.segs)) return b.segs.map((s) => s.t || "").join("");
    return "";
  };
  // A front-matter section heading is `h1` OR `head`: the importer gives the
  // acronyms list a plain `head` in three of the four affected books (it is meant to
  // share a page rather than open its own), and only the Food & Nutrition Form 4
  // Teacher's Guide makes it an `h1`. Matching h1 alone silently missed the other
  // three. The block's own type is preserved -- this pass changes ORDER, not styling.
  const isSec = (b) => b && (b.t === "h1" || b.t === "head");
  const BODY  = /^(TOPIC|UNIT|CHAPTER)\s*:?\s*[\d.]/i;
  const ACRO  = /^(LIST\s+OF\s+)?ACRONYMS?\b/i;
  const ACK   = /^ACKNOWLEDGE?MENTS?\b/i;
  const INTRO = /^INTRODUCTION\b/i;

  // Front matter ends at the first numbered TOPIC/UNIT heading.
  let bodyAt = blocks.findIndex((b) => b && b.t === "h1" && BODY.test(txt(b).trim()));
  if (bodyAt < 0) bodyAt = blocks.length;
  const at = (re) => blocks.findIndex((b, i) => i < bodyAt && isSec(b) && re.test(txt(b).trim()));
  // A section runs from its own heading to the next h1 (or the body).
  const endOf = (i) => { let j = i + 1; while (j < bodyAt && !isSec(blocks[j])) j++; return j; };

  const acroAt = at(ACRO);
  const ackAt  = at(ACK);
  if (acroAt < 0 || ackAt < 0 || acroAt > ackAt) return;   // absent, or already in place

  // Land it after the LAST of Acknowledgement / Introduction, which is where the
  // house order puts it: the final front-matter section before the body.
  const introAt = at(INTRO);
  const anchor = Math.max(ackAt, introAt);
  const acroEnd = endOf(acroAt);
  const anchorEnd = endOf(anchor);
  const cut = blocks.splice(acroAt, acroEnd - acroAt);
  // Everything after the removed slice shifted left by its length.
  blocks.splice(anchorEnd - cut.length, 0, ...cut);
  console.log(`reorderFrontmatter: moved "${txt(cut[0]).trim()}" (${cut.length} blocks) to after ${txt(blocks[anchor - cut.length] || {}).trim() || "the acknowledgement"}`);
}

module.exports = { READINSTR, formatGrade3EngFrontMatter, applySeriesFront, reorderFrontmatter };
