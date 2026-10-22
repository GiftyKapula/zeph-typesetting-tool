// ZEPH series front matter (B5 house style) and front-matter ordering.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { arr } = require("../emit.js");
const LEXI = require("../lexicon/index.js");   // the current local language's own wording

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
  const isUnit = (x) => x.t === "h1" && (x.top || /^(UNIT|TOPIC|CHAPTER|CHIBALU|CIPATI)\b/i.test(x.text || "") || LEXI.isTopSection(x.text));
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
  // Accept h2/h3 too: a front-matter section (e.g. FOREWORD) the manuscript styled as
  // a Word Heading 2/3 imports as h2/h3, not head/label — without this it stays a plain
  // sub-heading crammed under the previous section instead of opening its own page.
  // A local-language front-matter word counts only when it appears ONCE: the same
  // heading repeated through the book ("Kalambula bwalo" opening every chapter) is a
  // chapter introduction, not the book's own Introduction page. Count only the front
  // matter when the first unit is known: Chitonga heads its Introduction NTALISYO and
  // also opens chapters with NTALISYO sub-heads, which must not block the front one.
  const lexCount = {};
  for (const x of (firstUnit0 < 0 ? blocks : blocks.slice(0, firstUnit0))) if (/^(label|head|h1|h2|h3)$/.test(x.t)) { const k = fmText(x).toLowerCase(); lexCount[k] = (lexCount[k] || 0) + 1; }
  // (a credit LABEL on the copyright page — "ALEMBI:" = Authors: — is not the section)
  const lexFront = (x) => LEXI.isFrontSection(fmText(x)) && (lexCount[fmText(x).toLowerCase()] || 0) <= 1
    && !(x.t === "label" && /:\s*$/.test(fmText(x)));
  let b = blocks.map((x, i) =>
    (firstUnit0 < 0 || i < firstUnit0) && !x.noPromote &&
    (x.t === "label" || x.t === "head" || x.t === "h2" || x.t === "h3" || x.t === "listitem" || x.t === "para") &&
    (FM.test(fmText(x)) || lexFront(x))
      ? { t: "h1", text: fmText(x) } : x);
  // we place our own table of contents, so drop any auto/imported one
  b = b.filter((x) => x.t !== "toc");

  // leave signature room before the signatory's name on Foreword/Preface/Ack.
  // The name can arrive as a plain paragraph OR (when bold in the source) as a
  // `head` block, so accept both.
  // Section headings that carry a signatory — English plus local-language
  // equivalents (Lunda: MAZU ATACHI=Foreword, KULEMA…WUNU=Preface,
  // KUSAKILILA=Acknowledgement) so every book's signatory groups identically.
  // Plus any front-matter section the current language's word list names, except
  // Authors/Editors (Chitonga MATALIKILO, KULUMBA and BUYALE each carry a signatory).
  const SIGSEC_RE = /FOREW|PREFACE|ACKNOWLEDG|MAZU ATACHI|KULEMA\b.*\bWUNU|KUSAKILILA/i;
  const SIGSEC = { test: (t) => SIGSEC_RE.test(t) || (LEXI.frontRank(t) ?? 0) >= 2 };
  const sigSec = (s) => SIGSEC.test(s);
  // a signatory's name: a trailing honorific "… (Dr)" / "… (Ms.)", OR a leading
  // one "Dr. Name" / "Prof. Name" / "Dr Name" (the period is optional).
  // Trailing parenthetical honorific — allow internal dots/spaces so "(Ph.D.)",
  // "(Ed.D.)", "(M.Ed.)" match as well as "(Dr)" / "(PhD)" — OR a leading title.
  const SIGNAME = /\(\s*(?:dr|ms|mr|mrs|prof|hon|ph\.?\s?d|ed\.?\s?d|m\.?\s?ed|phd)\.?\s*\)\s*$|^(?:dr|prof|mr|mrs|ms|hon)\.?\s+[A-Z]/i;
  // An honorific appearing ANYWHERE (used to catch a run-on signatory that the
  // source glued into one paragraph, e.g. "Noriana Muneku (Ms.)Permanent
  // Secretary…MINISTRY OF EDUCATION").
  const SIGINLINE = /\(\s*(?:dr|ms|mr|mrs|prof|hon|ph\.?\s?d|ed\.?\s?d|m\.?\s?ed|phd)\.?\s*\)/i;
  const plainOfBlk = (x) => (x.t === "head" || x.t === "label" || x.t === "h1" || x.t === "h2" ? (x.text || "") : (x.segs || []).map((s) => s.t).join("")).trim();
  // A manuscript that hand-sizes its signatory lines as large as a heading reaches here with
  // them as h1 ("Agness Mumba Wilkins (PhD)" / "Managing Director / …" / "ZAMBIA EDUCATIONAL
  // PUBLISHING HOUSE"); read those as signature lines, not as new sections. A real section
  // name (INTRODUCTION, PREFACE…) is never one.
  const FRONTNAME = /^((THE\s+)?AUTHORS?|FOREW(O|A)RD|PREFACE|ACKNOWLEDGE?MENTS?|INTRODUCTION|ACRONYMS|KEY COMPETENCES|TABLE OF CONTENTS|GLOSSARY|REFERENCES)\b/i;
  // (h2 too: fixStrayBodyH1s has usually demoted such a stray h1 to h2 before this pass runs.)
  const sigH1 = (x) => x && (x.t === "h1" || x.t === "h2") && (x.text || "").trim().length <= 60 && !FRONTNAME.test((x.text || "").trim());
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
  // A hand-signature line of dots the author typed above the signatory ("……………") —
  // the signature block leaves its own room, so drop it.
  const DOTS = /^[.…‥\s_]{5,}$/;
  const dropDots = (out) => {
    let k = out.length - 1;
    while (k >= 0 && out[k].t === "vspace") k--;
    if (k >= 0 && /^(para|head|label)$/.test(out[k].t) && DOTS.test(plainOfBlk(out[k]))) out.splice(k, 1);
  };
  const isBold = (x) => x.t === "head" || x.t === "label" || (x.segs ? x.segs.some((s) => s.b) : false);
  {
    let section = "", done = false, withSig = [];
    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      const h1Sig = !done && sigSec(section) && sigH1(x) && SIGNAME.test((x.text || "").trim());
      if (x.t === "h1" && !h1Sig) { section = x.text || ""; done = false; withSig.push(x); continue; }
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
      const runonSig = !done && sigSec(section) && x.t === "para" && Array.isArray(x.segs)
        && (SIGINLINE.test(plain) || /^(?:dr|prof|mr|mrs|ms|hon)\.?\s+[A-Z]/i.test(plain))
        && x.segs.filter((s) => s.t.trim()).length >= 2;
      if (runonSig) {
        dropDots(withSig); withSig.push({ t: "sigspace" });
        // a run can hold several lines glued together (a soft break lost, or the role run-on
        // into the ALL-CAPS organisation: "…Chief Executive OfficerZAMBIA EDUCATIONAL…") —
        // split them so only the real organisation line is set bold/uppercase.
        const lines = x.segs.filter((s) => s.t.trim())
          .flatMap((s, k) => s.t.split("\n").flatMap((p) => p.split(/(?<=[a-z])(?=[A-Z]{3,})/)).filter((p) => p.trim()).map((p, m) => [p.trim(), k === 0 && m === 0]))
          .map(([t, isName]) => sigLine(t, isName));
        withSig.push({ t: "signature", lines });
        done = true;
        continue;
      }
      // A signatory NAME line is short ("Agness Mumba Wilkins (PhD)"); a prose sentence that
      // merely starts with an honorific ("Mr. Eustace Panga Museka wrote the book…") is not a
      // signature, so cap the length or it steals the block from the real signatory below it.
      if (!done && sigSec(section) && (isText(x) || h1Sig) && SIGNAME.test(plain) && plain.length <= 60) {
        // Leave room for a hand signature, then render the signatory block (name,
        // title, organisation) as a dedicated block whose lines are EVENLY spaced
        // — consistent across every book (the template controls the gap).
        dropDots(withSig); withSig.push({ t: "sigspace" });
        let j = i;
        const lines = [];
        while (j < b.length && (isText(b[j]) || (h1Sig && sigH1(b[j])))) {
          // The signatory's name (the first line) is always bold; an all-caps
          // organisation line (e.g. "ZAMBIA EDUCATIONAL PUBLISHING HOUSE") is bold
          // too; the title line (e.g. "Board Chairperson") is always regular weight.
          lines.push(sigLine(plainOfBlk(b[j]), j === i));
          j++;
          // the organisation line closes the block (a heading right after it is the next
          // section, not part of the signature)
          if (j - i > 1 && SIGORG.test(plainOfBlk(b[j - 1]))) break;
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
  // A lesson heading (h2) that DIRECTLY follows another heading — a unit banner, a strand
  // heading (Chitonga KUSWIILILA AKWAAMBAULA / KUBALA / KULEMBA), or another h2 — with no
  // text between does not page-break: it flows under that heading. Breaking there left the
  // heading above alone on a near-empty page (or stranded at the foot of the previous
  // one). The headings are sticky, so when little room is left at the foot of a page the
  // whole stack still moves on to the next page together. A strand heading that is a
  // plain head (no page break of its own) takes the lesson's page break instead, so the
  // lesson still opens a fresh page, with its strand heading above it. An h2 directly
  // followed by another h2 is a group heading over the lessons, not a lesson: unnumbered.
  // Only a real heading counts: a bold line that is a sentence ("Expected Answer: (b)
  // Visitors.", CTS Grade 1 TG) is the previous lesson's content and stays with it.
  {
    const isHeading = (x) => x && /^(h1|h2|h3|head|label)$/.test(x.t) && !/[.?!:;)]\s*$/.test((x.text || "").trim());
    const withBreaks = [];
    for (let i = 0; i < b.length; i++) {
      const x = b[i], next = b[i + 1], prev = b[i - 1];
      if (next && next.t === "h2" && /^(h3|head|label)$/.test(x.t) && isHeading(x) && !isHeading(prev)) withBreaks.push({ t: "pagebreak" });
      if (x.t === "h2" && isHeading(prev)) { x.nobreak = true; if (prev.t === "h2") prev.group = true; }
      withBreaks.push(x);
    }
    b = withBreaks;
  }

  if (numberLessons) {
    // A back-matter section (APPENDICES, GLOSSARY, REFERENCES…) after the last unit
    // is not itself a unit and its own h2 sub-headings are not lesson components —
    // stop numbering there, or a heading like "STANDARD PERFORMANCE LEVELS (CBC)"
    // wrongly inherits the LAST unit's running count ("4." tacked onto the first
    // back-matter h2, continuing from that unit's own 1/2/3).
    const BACKMATTER = /^(GLOSSARY|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX|ACRONYMS)\b/i;
    let n = 0, inUnit = false;
    // Auto-numbering is the English house style: only units recognised by the English /
    // long-standing words trigger it. A unit found only through a local-language word
    // list (Cinyanja CAPAMUTU) keeps the author's own section numbers ("CIGAWO 1").
    const isNumberedUnit = (x) => x.t === "h1" && /^(UNIT|TOPIC|CHAPTER|CHIBALU|CIPATI)\b/i.test(x.text || "");
    for (const x of b) {
      if (isUnit(x)) { inUnit = isNumberedUnit(x); n = 0; }
      else if (inUnit && (x.t === "h1" || x.t === "head" || x.t === "label") && (BACKMATTER.test((x.text || "").trim()) || LEXI.isBackSection(x.text))) { inUnit = false; }
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
      } else if (inUnit && x.t === "h2" && !x.group && !/^(SUB[-\s‐-―]*TOPIC|TOPIC)\s*:?\s*[\d.]/i.test(x.text) && !/^\d+(\.\d+)+\b/.test(x.text)) {
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

// autoFrontRefs (opt-in per book): rebuild the List of Figures / List of Tables so
// their page numbers are the REAL typeset pages (not the manuscript's stale Word TOC
// cache), and move those reference lists + the Acronyms table to the END of the front
// matter (just before the body). Two steps:
//   1. drop an invisible page-marker (#lofmark/#lotmark) next to every captioned
//      figure/table in the body — the template's #listof queries these to build the
//      lists with counter(page) read at each marker's own location.
//   2. replace the imported (flattened, mis-merged) List-of-Figures entries with a
//      single #listof("fig"), synthesise a List of Tables, and shift both — plus the
//      Acronyms section — to sit right before `bodystart`.
function applyAutoFrontRefs(list) {
  const FIG = /^\s*(?:figure|fig\.?)\s*(\d+)\s*[:.\-–—]?\s*(.*)$/i;
  const TAB = /^\s*table\s*(\d+)\s*[:.\-–—]?\s*(.*)$/i;
  // 1) inject invisible markers after each captioned figure image / table caption.
  // Captions arrive in three shapes: an image's own caption, a centred/italic caption
  // paragraph, or (inconsistently) a bold heading — accept all three, and dedupe by
  // number so a figure/table never lands in the list twice.
  const seen = new Set();
  const push = (arr, kind, n, title) => {
    const key = kind + ":" + n;
    if (seen.has(key)) return;
    seen.add(key);
    arr.push({ t: "lofmark", kind, num: (kind === "tab" ? "Table " : "Figure ") + n, title: (title || "").trim() });
  };
  const withMarks = [];
  for (const b of list) {
    withMarks.push(b);
    let m;
    if (b.t === "image" && b.caption && (m = String(b.caption).match(FIG))) {
      push(withMarks, "fig", m[1], m[2]);
      continue;
    }
    const isText = b.t === "para" || b.t === "figcaption";
    const isHeadish = b.t === "head" || b.t === "label" || b.t === "h2" || b.t === "h3";
    if (!isText && !isHeadish) continue;
    const txt = (b.t === "figcaption" || isHeadish) ? (b.text || "") : (b.segs || []).map((s) => s.t || "").join("");
    // a caption paragraph must LOOK like a caption (centred or wholly italic) so a body
    // sentence that merely starts "Table 3 shows…" is not mistaken for one; a heading
    // ("Table 3: …") is already a distinct block and is accepted on the text match alone.
    const capish = isHeadish || b.align === "center" || (b.segs && b.segs.length && b.segs.every((s) => s.it));
    if (!capish) continue;
    if ((m = txt.match(TAB))) push(withMarks, "tab", m[1], m[2]);
    else if (isHeadish && (m = txt.match(FIG))) push(withMarks, "fig", m[1], m[2]);
  }
  list = withMarks;
  // 2) locate the List of Figures + Acronyms sections and the body boundary.
  const boundary = (x) => x && ["h1", "bodystart", "toc", "backcover", "cover", "titlestart", "titlepage"].includes(x.t);
  const findH1 = (re) => list.findIndex((x) => x.t === "h1" && re.test((x.text || "").trim()));
  const sectionEnd = (start) => { let e = start + 1; while (e < list.length && !boundary(list[e])) e++; return e; };
  const lofI = findH1(/^LIST OF FIGURES$/i);
  if (lofI < 0) return list;                         // no list to rebuild — leave as-is
  const acrI = findH1(/^ACRONYMS\b/i);
  const lofEnd = sectionEnd(lofI);                    // covers the stale loentry lines
  const lofSection = [list[lofI], { t: "listof", kind: "fig" }];
  const lotSection = [{ t: "h1", text: "LIST OF TABLES" }, { t: "listof", kind: "tab" }];
  let acrSection = null, acrEnd = -1;
  if (acrI >= 0) { acrEnd = sectionEnd(acrI); acrSection = list.slice(acrI, acrEnd); }
  const moved = new Set();
  for (let i = lofI; i < lofEnd; i++) moved.add(i);
  if (acrI >= 0) for (let i = acrI; i < acrEnd; i++) moved.add(i);
  const bundle = [...lofSection, ...lotSection, ...(acrSection || [])];
  const res = [];
  let placed = false;
  for (let i = 0; i < list.length; i++) {
    if (moved.has(i)) continue;
    if (list[i].t === "bodystart" && !placed) { res.push(...bundle); placed = true; }
    res.push(list[i]);
  }
  if (!placed) {                                      // no body boundary — put refs before the back cover
    const bc = res.findIndex((x) => x.t === "backcover");
    if (bc >= 0) res.splice(bc, 0, ...bundle); else res.push(...bundle);
  }
  return res;
}

// orderFrontMatter: put the prose front-matter sections into the house order that
// most ZEPH books (e.g. Form 1 Art and Design) follow:
//   Author(s) > Editor > Foreword > Preface > Acknowledgement > Introduction / How to
//   use this book > Competences > List of Figures > List of Tables > Acronyms
// Manuscripts vary (Acronyms first, Author after the Acknowledgement…). The front
// matter is the run between the "showpage" marker and "bodystart"; a section starts at
// each front-matter h1 (or a styled section head) and runs to the next one. A section
// with an unrecognised title (local-language headings, "Vision"…) travels with the
// section before it, so nothing unknown is reshuffled. Stable: equal ranks keep order.
const FRONT_RANK = [
  [/^(the\s+|about\s+the\s+)?authors?\b/i, 0],
  [/^editors?\b/i, 1],
  [/^foreword\b/i, 2],
  [/^preface\b/i, 3],
  [/^acknowledge?ments?\b/i, 4],
  [/^(introduction|how to use this (book|guide))\b/i, 5],
  [/competenc/i, 6],
  [/^list of figures\b/i, 7],
  [/^list of tables\b/i, 8],
  [/^(list of )?(acronyms|abbreviations)\b/i, 9],
];
function orderFrontMatter(blocks) {
  const s = blocks.findIndex((b) => b.t === "showpage");
  // The front matter ends at the body-start marker, or earlier at the first topic /
  // unit banner or sub-topic, so body content can never be pulled into it.
  const BODY = /^(TOPIC|UNIT|CHAPTER|SUB[-\s]*TOPIC)\b/i;
  const e = blocks.findIndex((b, i) => i > s && (b.t === "bodystart"
    || ((b.t === "h1" || b.t === "h2") && (BODY.test((b.text || "").trim()) || LEXI.startsWith(["unit", "topic", "subtopic"], b.text)))
    || (b.t === "h2" && /^\d+(\.\d+)*[.:]?\s/.test((b.text || "").trim()))));
  if (s < 0 || e < 0) return blocks;
  const isStart = (b) => b.t === "h1" || (b.t === "head" && b.styleSection);
  const rankOf = (b) => { const t = (b.text || "").trim(); const r = FRONT_RANK.find(([re]) => re.test(t)); return r ? r[1] : LEXI.frontRank(t); };
  const region = blocks.slice(s + 1, e);
  const secs = [];
  let lead = [];
  for (const b of region) {
    if (isStart(b)) secs.push({ rank: rankOf(b), blocks: [b] });
    else if (secs.length) secs[secs.length - 1].blocks.push(b);
    else lead.push(b);
  }
  if (secs.filter((x) => x.rank != null).length < 2) return blocks;
  // unknown sections inherit the rank of the section before them (they travel with it);
  // unknown ones at the very start travel with the first recognised section after them.
  let prev = null;
  for (const x of secs) { if (x.rank == null) x.rank = prev; else prev = x.rank; }
  const firstKnown = secs.find((x) => x.rank != null).rank;
  for (const x of secs) { if (x.rank == null) x.rank = firstKnown; else break; }
  const sorted = secs.map((x, i) => ({ ...x, i })).sort((a, b) => a.rank - b.rank || a.i - b.i);
  if (sorted.every((x, k) => x.i === k)) return blocks;
  // A section that now opens the run must start its own page; keep each head's
  // "share the page" flag otherwise (e.g. Acronyms sitting under the Competences table).
  const out = [...lead];
  sorted.forEach((x, k) => {
    if (k === 0 && x.blocks[0].brk === false) delete x.blocks[0].brk;
    out.push(...x.blocks);
  });
  console.log("   front matter reordered:", sorted.map((x) => (x.blocks[0].text || "").trim().slice(0, 20)).join(" > "));
  return [...blocks.slice(0, s + 1), ...out, ...blocks.slice(e)];
}


module.exports = { READINSTR, formatGrade3EngFrontMatter, applySeriesFront, reorderFrontmatter, applyAutoFrontRefs, orderFrontMatter };
