// Back matter + credits: acronyms, glossary, references ordering, layout credit, author names.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { S, arr } = require("../emit.js");
const { segKey, blockPlain, setBlockSegs, editBlockText, allTextBlocks, boldPrefix } = require("../blocktext.js");

// "Phd" for the academic title is a recurring manuscript typo (the author capitalises
// only the first letter, as if it were an ordinary word) seen across unrelated books,
// not a one-off — normalise it everywhere, in every run of every text-bearing block,
// rather than patching it per book via an override. Word-bounded so it can't touch a
// legitimate word that merely contains "phd" as a substring (there isn't one, but the
// boundary costs nothing and documents the intent).
function fixPhdCapitalisation(blocks) {
  for (const b of allTextBlocks(blocks)) {
    const k = segKey(b);
    if (k) { for (const s of b[k]) if (typeof s.t === "string" && /\bPhd\b/.test(s.t)) s.t = s.t.replace(/\bPhd\b/g, "PhD"); }
    else if (typeof b.text === "string" && /\bPhd\b/.test(b.text)) b.text = b.text.replace(/\bPhd\b/g, "PhD");
  }
}

// "Acappella"/"acappella" (run together as one word) is a recurring spelling slip for
// "a cappella" — a genuine two-word term, not book-specific vocabulary — so normalise
// it everywhere the same way as the PhD fix above, rather than as a per-book override.
function fixACappellaSpacing(blocks) {
  const fix = (t) => t.replace(/\bAcappella\b/g, "A cappella").replace(/\bacappella\b/g, "a cappella");
  // A run that IS an MCQ option letter on its own ("A. ", "B) ", …) sitting right
  // before "Acappella" means the word itself is one lettered option in a list
  // whose siblings (Choir, Duet, Trio, …) are each a single word — splitting only
  // this one into two breaks that parallelism and reads as a doubled "A. A
  // cappella". Leave the option text alone in that one case; every other
  // occurrence (prose, glossary) still gets the correct two-word spelling.
  const isOptionMarker = (s) => typeof s === "string" && /^\n?\(?[A-Da-d][.)]\s*$/.test(s);
  for (const b of allTextBlocks(blocks)) {
    const k = segKey(b);
    if (k) {
      b[k].forEach((s, i) => {
        if (typeof s.t !== "string" || !/acappella/i.test(s.t)) return;
        if (isOptionMarker(i > 0 ? b[k][i - 1].t : null)) return;
        s.t = fix(s.t);
      });
    }
    else if (typeof b.text === "string" && /acappella/i.test(b.text)) b.text = fix(b.text);
  }
}

// In an ACRONYMS section, manuscripts align "ABBR    Full Word" with spaces/tabs.
// Render them as "ABBR: Full Word" (bold abbreviation, colon, then the full form).
function reformatAcronyms(blocks) {
  // The ACRONYMS heading can arrive as any heading-like block (h1/h2/head/label)
  // depending on how the manuscript styled it — and it may only be promoted to
  // h1 later — so toggle on ANY heading whose text is "ACRONYMS" or "LIST OF
  // ACRONYMS", and off at the next (non-entry) heading. (Order-independent: works
  // whenever this runs.)
  const isHeadingBlk = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label";
  const cleanMeaning = (s) => String(s || "").replace(/^[\s:–—-]+/, "").trim();
  // A manuscript sometimes bolds an ENTIRE acronym line by mistake ("ABCD: Anthropometric,
  // Biochemical, Clinical and Dietary Assessment") instead of just the abbreviation — that
  // imports as its own `head`/`label` block (all-bold text reads as a heading), not the
  // `para` every correctly-typed sibling entry becomes. Recognise a heading-like block
  // whose text is "SHORT-TOKEN: meaning" as an acronym ENTRY while inside the list — not a
  // new section — so it still gets split into a bold abbreviation + plain meaning below.
  const ENTRY_RE = /^[A-Za-z][A-Za-z0-9./]{0,9}:\s*\S/;
  let inAcronyms = false;
  for (const b of blocks) {
    const asEntry = inAcronyms && isHeadingBlk(b) && ENTRY_RE.test((b.text || "").trim());
    if (isHeadingBlk(b) && !asEntry) { inAcronyms = /^(LIST OF )?ACRONYMS\b/i.test((b.text || "").trim()); continue; }
    if (asEntry) {
      // fold the whole-bold heading down to a plain paragraph so the split logic below
      // can re-bold just the abbreviation, matching its correctly-typed siblings.
      b.t = "para"; b.segs = [{ t: (b.text || "").trim(), b: false, it: false, c: null }];
      delete b.text; delete b.marker;
    }
    if (!inAcronyms || b.t !== "para" || !(b.segs && b.segs.length)) continue;
    const segs = b.segs;
    // House format "ABBR- Full form" / "ABBR-Full form" (a hyphen between the
    // abbreviation and its meaning) — split on the FIRST hyphen and render
    // "ABBR: Full form". The abbreviation is a short token (letters/dots) with no
    // spaces, e.g. BA, GIS, H.E., PhD, V.I., ZEPH.
    const full = segs.map((s) => s.t).join("").trim();
    const hy = full.match(/^([A-Za-z][A-Za-z.]{0,7})\s*-\s*(\S.*)$/);
    if (hy && !/\s/.test(hy[1])) {
      b.segs = [
        { t: hy[1].replace(/:+$/, ""), b: true, it: false, c: null },
        { t: ": ", b: false, it: false, c: null },
        { t: cleanMeaning(hy[2]), b: false, it: false, c: null },
      ];
      continue;
    }
    // The abbreviation is the leading run; the meaning follows after a whitespace
    // gap (often its own padding runs). Keep the meaning's original runs so the
    // writer's bold capitals (e.g. **A**ntidiuretic **H**ormone) are preserved.
    let abbr = (segs[0].t || "").trim().replace(/:+$/, "");
    if (!abbr) continue;
    let k = 1;
    while (k < segs.length && segs[k].t.trim() === "") k++;   // skip padding spaces
    let rest = segs.slice(k);
    if (rest.length) rest = [{ ...rest[0], t: cleanMeaning(rest[0].t) }, ...rest.slice(1)];
    // Fallback: abbreviation and meaning shared one run ("ABBR  Full Word").
    if (!rest.length || !rest.map((s) => s.t).join("").trim()) {
      const m = segs.map((s) => s.t).join("").match(/^(\S+)\s+(.+)$/);
      if (!m) continue;
      abbr = m[1].replace(/:+$/, "");
      rest = [{ t: m[2].trim(), b: false, it: false, c: null }];
    }
    b.segs = [
      { t: abbr, b: true, it: false, c: null },
      { t: ": ", b: false, it: false, c: null },
      ...rest,
    ];
  }
}

// Within a GLOSSARY section, render each entry as "term" (bold) + ": " +
// meaning (regular) — dropping the manuscript's "Term – meaning" dash and any
// stray bold on the whole line. The separator must be a dash SURROUNDED by
// spaces so hyphenated terms ("Well-being") and definitions ("non-living") stay
// intact.
function formatGlossary(blocks) {
  const isHead = (b) => /^h[123]$/.test(b.t) || b.t === "head" || b.t === "label";
  const ENTRY = /^(.{1,40}?)(?:\s+[–—-]\s+|:\s+)(.+)$/s;   // "Term – meaning" or "Term: meaning"
  // Render one entry as: term (bold) + ": " + meaning (regular).
  const toEntry = (b, m) => {
    b.t = "para"; delete b.text; delete b.marker;
    b.segs = [
      { t: m[1].trim(), b: true, it: false, c: null },
      { t: ": ", b: false, it: false, c: null },
      { t: m[2].trim().replace(/\s+/g, " "), b: false, it: false, c: null },
    ];
  };
  let inGloss = false;
  for (const b of blocks) {
    const full = (b.segs ? b.segs.map((s) => s.t).join("") : b.text || "").trim();
    if (isHead(b)) {
      // The GLOSSARY section can open as any heading style (h1/h2/head/label),
      // depending on how the manuscript styled it and the import variant.
      if (/^GLOSSARY\b/i.test(full)) { inGloss = true; b.t = "h1"; b.text = "GLOSSARY OF TERMS"; continue; }
      // A single-letter alphabetical divider ("A", "B", "C"…) inside the glossary
      // is just a section marker — keep it, but don't let it end the glossary.
      if (inGloss && /^[A-Z]$/.test(full)) continue;
      // Inside the glossary, a heading-styled line that is really an entry
      // ("Activity – A task…") — the manuscript bolded some terms so the importer
      // read them as heads — is converted to a normal entry and the glossary
      // continues. Any OTHER heading (a genuine new section) ends the glossary.
      // A misread bolded term lands as h2/head/label (the "small bold line reads as
      // a heading" heuristic), never a real h1 — so exclude h1 from this coincidental-
      // shape fallback: a genuine top-level section (e.g. a back-matter "… – SAMPLE
      // SCHEME OF WORK" appendix) can easily match the "Term – meaning" shape by pure
      // accident of wording and must never be swallowed as a glossary entry.
      if (inGloss && b.t !== "h1" && ENTRY.test(full) && full.length <= 200) { toEntry(b, full.match(ENTRY)); continue; }
      inGloss = false;
      continue;
    }
    if (!inGloss) continue;
    const m = full.match(ENTRY);
    if (m) toEntry(b, m);
  }
}

function reorderBackmatter(blocks) {
  const getText = (b) => {
    if (!b) return "";
    if (typeof b === "string") return b;
    if (b.text) return b.text;
    if (b.plain) return b.plain;
    if (Array.isArray(b.segs)) return b.segs.map((s) => s.t || "").join("");
    return "";
  };

  let refHeader = null;
  let refItems = [];

  // Case 1: Standalone References heading block
  let refIdx = blocks.findIndex((b) => b && (b.t === "h1" || b.t === "h2" || b.t === "head" || b.t === "label" || b.t === "para") && /^references\b/i.test(getText(b).trim()));
  if (refIdx >= 0) {
    refHeader = { t: "h1", text: "REFERENCES" };
    let j = refIdx + 1;
    while (j < blocks.length && blocks[j].t !== "h1" && !/^GLOSSARY\b/i.test(getText(blocks[j]).trim())) {
      refItems.push(blocks[j]);
      j++;
    }
    blocks.splice(refIdx, j - refIdx);
  } else {
    // Case 2: Embedded inside exercise block
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b && (b.t === "exercise" || b.kind === "exercise") && Array.isArray(b.parts)) {
        const pIdx = b.parts.findIndex(p => p && (p.q || p.text) && /^references\b/i.test((p.q || p.text).trim()));
        if (pIdx >= 0) {
          const extracted = b.parts.splice(pIdx);
          refHeader = { t: "h1", text: "REFERENCES" };
          for (let k = 1; k < extracted.length; k++) {
            const item = extracted[k];
            const segs = item.qseg || [{ t: item.q || item.text || "", b: false, it: false }];
            refItems.push({
              t: "listitem",
              segs: segs,
              isList: true,
              marker: "•"
            });
          }
          break;
        }
      }
    }
  }

  // Format Glossary Header
  let glossIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const text = getText(b).trim();
    if (b && (b.t === "h2" || b.t === "h1" || b.t === "head" || b.t === "label" || b.t === "para") && /^GLOSSARY\b/i.test(text)) {
      b.t = "h1";
      b.text = "GLOSSARY OF TERMS";
      glossIdx = i;
    }
  }

  // Re-order: Place References AFTER Glossary
  if (refHeader && refItems.length > 0) {
    let insertIdx = blocks.length;
    if (glossIdx >= 0) {
      let j = glossIdx + 1;
      while (j < blocks.length && blocks[j].t !== "h1") j++;
      insertIdx = j;
    }
    blocks.splice(insertIdx, 0, refHeader, ...refItems);
    console.log(`reorderBackmatter: Successfully moved ${refItems.length} reference items to after Glossary at index ${insertIdx}`);
  }
}

// NOTE: a prior round asked for the bullet dropped from "General Competences" /
// "Specific Competences" / "Expected Standards" outcome lines, and a
// debulletStandards() pass here used to strip it on every book accordingly. A
// later editor pass on Form 4 Geography TG (round 3, Sept 2026) asked for those
// same bullets back — the manuscript's own numPr already marks each outcome line
// as a Word bullet list item (see import-docx.js's numPr handling), so the
// engine now leaves that marker alone and just renders what the manuscript says.
// Authors indent lines in Word by typing runs of spaces (or a tab) rather than using
// a paragraph indent. Typeset into a justified column those become ragged, random
// gaps — a passage reads as if every other line is pushed inwards, and mid-sentence
// runs open holes in the text ("them to   celebrate"). Normalise every text run:
// drop whitespace-only runs at the START of a block, trim the leading whitespace off
// its first run, collapse any run of 3+ spaces to one, and trim the trailing edge.
// Deliberately conservative: single and double spaces are untouched (so "a + b = c"
// blend lines and fill-in underscores are unaffected), and structural indentation
// (numbered markers, worked-solution continuation, boxed leads) is layout, not
// spaces, so it is unaffected too. Runs for EVERY book.
// Authors lay out word lists in two or three columns by typing a big run of spaces
// The imprint page credits the typesetter on a "Cover and Book Layout:" line. We do
// the typesetting, so fill that credit with our name on every book — but manuscripts
// disagree on where the name goes: some leave the label bare with the name (or a
// dot-leader placeholder, or someone's self-credit) on its OWN following line
// ("Cover and Book Layout:" / "Njira Mtonga"); others glue a dot-leader straight onto
// the SAME line as the label ("Cover and Book layout by:................."), leaving
// no separate line for a name at all — the very next paragraph there is unrelated
// real content (e.g. "First Published 2026 by:"), so blindly overwriting "the next
// non-empty block" would destroy that section instead of crediting anyone.
const LAYOUT_CREDIT = "Ng`ambi Teddy (B.Sc)";

function fillLayoutCredit(blocks) {
  // Manuscripts word this credit several ways — "Cover and Book Layout:", "Cover
  // designed by:", "Book layout by:", "Design and layout:" — and matching only the
  // first spelling left the credit unfilled on any book using another. The ICT Form 2
  // Teacher's Guide says "Cover designed by:" and printed a bare row of dots.
  // Capped at a short line so the phrase can't match inside body prose.
  const LABEL = /(cover|book)\s+(and\s+book\s+)?(layout|design)|(layout|design)\s+and\s+(design|layout)/i;
  const LABEL_MAXLEN = 60;
  // Another front-matter label (ends with a colon, or a known "…by:" line) — never a
  // placeholder to overwrite, even when it directly follows ours with no gap.
  const LABELISH = /:\s*$|^(edited|illustrated|printed|published|first published)\b/i;
  const DOTLEADER = /[.•․…·]{3,}\s*$/;   // a run of dot/bullet/ellipsis chars trailing the label
  const isBlankish = (b) => !b || typeof b !== "object" || b.t === "vspace" || b.t === "showpage" || blockPlain(b).trim() === "";
  const walk = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      for (const k of ["body", "parts", "items", "blocks"]) if (Array.isArray(b[k])) walk(b[k]);
      const plain = blockPlain(b);
      if (!LABEL.test(plain) || plain.trim().length > LABEL_MAXLEN) continue;
      // Strip a dot-leader baked onto the label's own line so it never prints raw
      // dots — this also means there is no separate placeholder line to reuse, so
      // the name gets inserted as a brand new line below.
      const dotMatch = plain.match(DOTLEADER);
      if (dotMatch) editBlockText(b, dotMatch[0], "");
      let nameIdx = -1;
      if (!dotMatch) {
        // The name (or a dot-leader placeholder, or someone's self-credit) sits on its
        // own line within the next few blocks — skip past any OTHER label line (e.g.
        // "First Published by:") so it's never mistaken for our placeholder.
        for (let j = i + 1; j < Math.min(i + 4, arr.length); j++) {
          const txt = blockPlain(arr[j]).trim();
          if (txt === "") continue;
          // Hitting another label means OUR label has no placeholder/name line of its
          // own — stop here (nameIdx stays -1) rather than skipping past it, which
          // would land on that OTHER label's own value (e.g. the publisher's name
          // under "First Published 2026 by:") and overwrite it with our credit.
          if (LABELISH.test(txt)) break;
          nameIdx = j;
          break;
        }
      }
      if (nameIdx >= 0) {
        if (blockPlain(arr[nameIdx]).trim() !== LAYOUT_CREDIT) {
          setBlockSegs(arr[nameIdx], [{ t: LAYOUT_CREDIT, b: false, it: false, c: null }]);
        }
        // Space the credit from whatever ZEPH statement (publisher block, "First
        // Published by:", …) follows it, unless a blank line already does the job.
        if (!isBlankish(arr[nameIdx + 1])) arr.splice(nameIdx + 1, 0, { t: "vspace", h: "4mm" });
      } else {
        // No existing line was safe to reuse — insert a fresh one right after the
        // (now dot-free) label, then a gap so the name never runs straight into
        // whatever follows.
        arr.splice(i + 1, 0,
          { t: "para", segs: [{ t: LAYOUT_CREDIT, b: false, it: false, c: null }], align: b.align || "center" },
          { t: "vspace", h: "4mm" });
      }
      return;
    }
  };
  walk(blocks);
}

// Bold the leading name of EACH author bio in the AUTHORS section (many
// manuscripts bold only the first few names). Runs for every book, not just
// CTS. A bio starts with a person's name followed by a verb ("holds a
// Bachelor's…", "is a…", "has taught…"), which anchors the name span.
function boldAuthorNames(blocks) {
  const textOf = (b) => (b.text || (b.segs ? b.segs.map((s) => s.t).join("") : "")).trim();
  const isHead = (b) => b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t);
  const NAME = /^([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,4})\s+(holds?|is\b|has\b|obtained|received|earned|graduated|studied|teaches|taught|possess|acquired|attained|completed|did\b|works?\b|serves?\b)/;
  for (let i = 0; i < blocks.length; i++) {
    if (!(isHead(blocks[i]) && /^(THE\s+)?AUTHORS?$/i.test(textOf(blocks[i])))) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const y = blocks[j];
      if (isHead(y)) break;
      if (y.t !== "para" || !y.segs || !y.segs.length) continue;
      const full = y.segs.map((s) => s.t).join("");
      const m = full.match(NAME);
      if (!m) continue;
      const nameLen = m[1].length;
      // already fully bold at the front? leave it.
      if (y.segs[0].b && full.indexOf(m[1]) === 0) continue;
      y.segs = boldPrefix(y.segs, nameLen);
    }
    break;
  }
}

module.exports = { fixPhdCapitalisation, fixACappellaSpacing, reformatAcronyms, formatGlossary, reorderBackmatter, LAYOUT_CREDIT, fillLayoutCredit, boldAuthorNames };
