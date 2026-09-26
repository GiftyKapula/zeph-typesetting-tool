// Activity/assessment passes: continuation merging, table activities, competence labels.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { S, arr, bodyArr } = require("../emit.js");
const { blockPlain } = require("../blocktext.js");

function unboldLeadProse(blocks) {
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "para" && Array.isArray(b.segs) && b.segs.length > 0) {
        const plain = b.segs.map((s) => s.t || "").join("");
        const m = plain.match(/^([A-Z][A-Za-z\s]{1,35}:)(.*)/);
        if (m) {
          const lead = m[1];
          const rest = m[2];
          const isLeadTopic = /^(Health|Agriculture|Environmental Protection|Food and Nutrition|Land pollution|Water pollution|Air pollution|Human health|Loss of biodiversity|Resource depletion|Decantation|Centrifugation|Filtration|Evaporation|Distillation|Chromatography):/.test(lead);
          if (isLeadTopic && rest.length > 10) {
            b.segs = [
              { t: lead, b: true, it: false },
              { t: rest, b: false, it: false }
            ];
          }
        }
      }
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) walk(b[k]);
      }
    }
  };
  walk(blocks);
}

// A manuscript's table sometimes outgrew one Word page, so the author manually split it
// into two separate tables — a first "LEARNING ACTIVITY N: Title" activity, then a second
// "LEARNING ACTIVITY N: Title (Continuation)" activity whose table repeats the header row
// and continues with the remaining rows. Each import as its OWN boxed activity, so the
// typeset book shows two distinct boxes (the second an orphaned header + tail of rows) where
// the author meant one continuous table. Fold the continuation's table (minus its repeated
// header row) and any trailing body blocks back into the first activity, then drop it.
function mergeContinuationActivities(blocks) {
  const CONT = /\s*\(Continuation\)\s*$/i;
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== "activity" || !CONT.test(b.title || "")) continue;
    const baseTitle = b.title.replace(CONT, "").trim();
    const prev = blocks[i - 1];
    if (!prev || prev.t !== "activity" || (prev.title || "").trim() !== baseTitle) continue;
    const contTableIdx = (b.body || []).findIndex((x) => x.t === "table");
    if (contTableIdx < 0) continue;
    let prevTableIdx = -1;
    for (let j = (prev.body || []).length - 1; j >= 0; j--) if (prev.body[j].t === "table") { prevTableIdx = j; break; }
    if (prevTableIdx < 0) continue;
    const contTable = b.body[contTableIdx];
    prev.body[prevTableIdx].rows.push(...contTable.rows.slice(1));   // drop the repeated header row
    const extras = b.body.filter((x, k) => k !== contTableIdx);
    if (extras.length) prev.body.push(...extras);
    blocks.splice(i, 1);
    i--;
  }
}

function splitActivityTables(blocks) {
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      if (b.t === "table" || b.t === "dtable") {
        if (Array.isArray(b.rows) && b.rows.length >= 2) {
          const actRowIdx = b.rows.findIndex((r, rIdx) => {
            if (rIdx === 0) return false;
            const cellTxt = r.map((c) => (typeof c === "string" ? c : (c.text || c.plain || (c.segs ? c.segs.map((s) => s.t || "").join("") : "")))).join("");
            return /^(LEARNING\s+)?ACTIVIT(?:Y|IES)\s+\d+/i.test(cellTxt.trim());
          });

          if (actRowIdx > 0) {
            const table1Rows = b.rows.slice(0, actRowIdx).filter((r) => {
              const txt = r.map((c) => (typeof c === "string" ? c : (c.text || c.plain || (c.segs ? c.segs.map((s) => s.t || "").join("") : "")))).join("").trim();
              return txt.length > 0;
            });

            const table2Rows = b.rows.slice(actRowIdx).filter((r) => {
              const txt = r.map((c) => (typeof c === "string" ? c : (c.text || c.plain || (c.segs ? c.segs.map((s) => s.t || "").join("") : "")))).join("").trim();
              return txt.length > 0;
            });

            const blk1 = { ...b, rows: table1Rows };
            const blk2 = { ...b, rows: table2Rows };

            arr.splice(i, 1, blk1, blk2);
            console.log(`splitActivityTables: Successfully split table block [${i}] at row ${actRowIdx} into 2 separate blocks`);
            i++;
          }
        }
      }
      if (b.body) walk(b.body);
    }
  };
  walk(blocks);
}

function convertTableActivities(blocks) {
  const getTableText = (tBlock) => {
    if (!tBlock || !Array.isArray(tBlock.rows)) return "";
    let txt = "";
    for (const row of tBlock.rows) {
      if (Array.isArray(row)) {
        for (const cell of row) {
          if (cell) {
            if (typeof cell === "string") txt += cell + " ";
            else if (cell.text) txt += cell.text + " ";
            else if (cell.plain) txt += cell.plain + " ";
            else if (Array.isArray(cell.segs)) txt += cell.segs.map((s) => s.t || "").join("") + " ";
          }
        }
      }
    }
    return txt.trim();
  };

  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      if (b.t === "table" || b.t === "box" || b.t === "dtable") {
        const plain = (b.t === "table" || b.t === "dtable") ? getTableText(b) : blockPlain(b).trim();
        // Accept the plural "LEARNING ACTIVITIES N" (a common author slip) and the stray
        // "LEARNING MODELS N" as activity titles too — all normalised to "LEARNING ACTIVITY N".
        const m = plain.match(/^(LEARNING\s+(ACTIVIT(?:Y|IES)|MODELS?)\s+\d+:?[^\n\r]*|(ACTIVIT(?:Y|IES)|MODELS?)\s+\d+:?[^\n\r]*)/i);
        if (m) {
          let title = m[1].trim().replace(/\bLEARNING\s+(MODELS?|ACTIVITIES)\b/i, "LEARNING ACTIVITY");
          let bodyText = plain.slice(m[0].length).trim();
          if (title.includes("\n")) {
            const parts = title.split("\n");
            title = parts[0].trim().replace(/\bLEARNING\s+(MODELS?|ACTIVITIES)\b/i, "LEARNING ACTIVITY");
            bodyText = parts.slice(1).join("\n").trim() + " " + bodyText;
          }
          arr[i] = {
            t: "activity",
            title: title,
            body: [
              {
                t: "para",
                segs: [
                  { t: bodyText, b: false, it: true }
                ]
              }
            ]
          };
          console.log("Successfully converted 1-cell activity table:", title);
        }
      }
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) walk(b[k]);
      }
    }
  };
  walk(blocks);
}

function ensureOrIndividually(blocks) {
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "activity") {
        const bodyArr = Array.isArray(b.body) ? b.body : [];
        for (const sub of bodyArr) {
          if (sub && Array.isArray(sub.segs)) {
            for (let i = 0; i < sub.segs.length; i++) {
              const s = sub.segs[i];
              if (s && typeof s.t === "string") {
                // The guard used to be `(\s*,?\s*)(?!or\s+individually)`: a GREEDY
                // whitespace group sitting right before the negative lookahead. On
                // text that already said "...groups or individually", the regex
                // engine would first try consuming that whitespace, see the lookahead
                // fail, then BACKTRACK the greedy group down to zero characters —
                // at which point the lookahead is checked one position too early
                // (right after "groups", before the space), where the literal "or
                // individually" doesn't immediately follow, so the guard passed
                // anyway and "or individually" got appended a second time. Moving
                // the lookahead onto the phrase itself (nothing left to backtrack)
                // and letting it tolerate the optional whitespace/comma fixes that;
                // it also stops eating a comma the author had after "groups".
                //
                // That per-phrase lookahead still isn't enough when a sentence already
                // lists all three modes together up front, e.g. "Work individually, in
                // pairs or in groups using a toy car…" — "individually" there sits
                // nowhere near "in pairs" or "in groups", so each of those two triggers
                // independently passed the lookahead and both got "or individually"
                // appended, producing "in pairs or individually or in groups or
                // individually…". House style only needs ONE "individually" per
                // sentence/segment, so skip the whole segment once it already contains
                // the word anywhere, rather than checking only right after each trigger.
                if (!/\bindividually\b/i.test(s.t)) {
                  s.t = s.t.replace(/\b(in\s+(?:small\s+)?groups|in\s+pairs|working\s+in\s+groups|work\s+in\s+groups|in\s+group)\b(?!\s*,?\s*or\s+individually)/gi, "$1 or individually");
                }
                if (s.t.trimEnd().endsWith("individually")) {
                  s.t = s.t.trimEnd() + " ";
                }
              }
            }
          }
        }
      }
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k])) walk(b[k]);
      }
    }
  };
  walk(blocks);
}

function boldAssessmentSections(blocks) {
  const SEC = /^(listening\s+and\s+speaking|reading\s+and\s+writing|listening\s*&\s*speaking|reading\s*&\s*writing)\s*[:.]?$/i;
  const walk = (arr) => {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "framedsection" && b.kind === "asmt" && Array.isArray(b.body)) {
        for (const it of b.body) {
          if (!it || !Array.isArray(it.segs)) continue;
          const txt = it.segs.map((s) => s.t).join("").trim();
          // These strand sub-headings are made bold here; the manuscript often ALSO
          // underlines them, which is redundant once they are bold — drop the underline.
          if (SEC.test(txt)) for (const s of it.segs) { s.b = true; s.u = false; }
        }
      }
      for (const k of Object.keys(b)) if (Array.isArray(b[k])) walk(b[k]);
    }
  };
  walk(blocks);
}

// Every topic opens with an "Introduction" sub-head. Most manuscripts style it
// bold so it is detected as a label, but occasionally the author leaves it as
// plain body text and it renders un-bolded, inconsistent with its sibling topics.
// Promote a lone "Introduction" paragraph to a bold label so every topic matches.
function labelIntroductions(blocks) {
  for (const b of blocks) {
    if (b.t !== "para" || !b.segs) continue;
    const txt = b.segs.map((s) => s.t).join("").trim();
    if (/^introduction$/i.test(txt)) { b.t = "head"; b.text = txt; delete b.segs; }
  }
}

// "General/Specific Competence(s)" is a fixed structural label, not manuscript prose, so
// its display case is a house-style rule ("General Competences", "Specific Competence")
// regardless of how a given author typed it — see fixCompetenceCase in proofPolish() above
// for the original version of this fix. That version only fires inside proofPolish(), which
// itself only runs for the handful of themes/books opted into `boxActivities`; every other
// book's manuscript case leaks straight through. Worse, a manuscript that bolds these lines
// (most do) imports them as `label` blocks up front, which render through `lbl()` — and
// `lbl()` force-uppercases its text for every "series"/"science" themed book (i.e. nearly
// every subject), so even fixing the block's stored case would have no visible effect: the
// block must be promoted to a `head` block instead, since `head()` always honours the case
// it's given. Runs unconditionally, for every book, independent of `boxActivities`.
function normaliseCompetenceLabels(blocks) {
  const fixCase = (t) => t.replace(/^(General|Specific)\s+(Competences?)\b/i,
    (_, w1, w2) => `${w1.charAt(0).toUpperCase()}${w1.slice(1).toLowerCase()} ${w2.charAt(0).toUpperCase()}${w2.slice(1).toLowerCase()}`);
  const STANDALONE = /^(General|Specific)\s+Competences?\s*:?\s*$/i;   // "General Competences" / "…:" alone, value on the next block(s)
  const INLINE = /^(General|Specific)\s+Competences?\s*:\s*\S/i;       // "General Competences: Analytical Thinking…" on one line
  for (const b of blocks) {
    const t = (b.text || (b.segs ? b.segs.map((s) => s.t).join("") : "") || "").trim();
    if (!t) continue;
    if ((b.t === "label" || b.t === "head") && STANDALONE.test(t)) {
      b.t = "head"; b.text = fixCase(t); delete b.segs; delete b.marker; delete b.labelColor;
    } else if ((b.t === "label" || b.t === "head") && INLINE.test(t)) {
      const ci = t.indexOf(":");
      b.t = "para";
      b.segs = [{ t: `${fixCase(t.slice(0, ci))}:`, b: true, it: false, c: null }, { t: ` ${t.slice(ci + 1).trim()}`, b: false, it: false, c: null }];
      delete b.text; delete b.labelColor;
    } else if ((b.t === "para" || b.t === "listitem") && b.segs && b.segs.length) {
      const full = b.segs.map((s) => s.t).join("");
      const fixed = fixCase(full);
      if (fixed !== full) {
        let pos = 0;
        b.segs = b.segs.map((s) => { const nt = fixed.slice(pos, pos + s.t.length); pos += s.t.length; return { ...s, t: nt }; });
      }
    }
  }
}

// Group each lesson's header metadata — the "LESSON N" opener plus its Component /
// Topic / Sub-Topic / competences / Expected Standard / methodology / vocabulary
// fields — into ONE distinct panel block, set larger than body text so the lesson plan
// reads as a self-contained header, visually separate from the lesson prose. The run
// ends at the lesson's "LEARNING ACTIVITIES" heading, its first boxed activity, the next
// lesson, or the next unit — whichever comes first. Runs AFTER boxifyActivities so the
// boxes exist as boundaries.
function groupLessonMeta(blocks) {
  const textOf = (b) => (b.text || (b.segs ? b.segs.map((s) => s.t).join("") : "")).trim();
  const isHeadType = (b) => b.t === "head" || b.t === "label" || /^h[123]$/.test(b.t);
  const isOpener = (b) => {
    const t = textOf(b);
    if (!/\bLESSON\s+\d+\b/i.test(t)) return false;
    if (isHeadType(b)) return true;
    // a bold standalone "LESSON N" / "COMPONENT: LESSON N" paragraph
    return b.t === "para" && t.length <= 60 && !!b.segs && b.segs.every((s) => s.b || !s.t.trim());
  };
  const isUnit = (b) => b.t === "h1" || (isHeadType(b) && /^UNIT\b/i.test(textOf(b)));
  const isActivities = (b) => isHeadType(b) && /^LEARNING\s+ACTIVIT/i.test(textOf(b));
  const isBox = (b) => ["framedsection", "activity", "exercise", "assessment", "box"].includes(b.t);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!isOpener(b)) { out.push(b); continue; }
    const title = textOf(b);
    const body = [];
    let j = i + 1;
    for (; j < blocks.length; j++) {
      const y = blocks[j];
      if (isActivities(y) || isBox(y) || isUnit(y) || isOpener(y)) break;
      body.push(y);
    }
    out.push({ t: "lessonmeta", title, body });
    i = j - 1;
  }
  return out;
}

module.exports = { unboldLeadProse, mergeContinuationActivities, splitActivityTables, convertTableActivities, ensureOrIndividually, boldAssessmentSections, labelIntroductions, normaliseCompetenceLabels, groupLessonMeta };
