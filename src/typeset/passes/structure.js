// Structure passes: activity boxing, box-label casing, heading clean-up, unit/lesson banners.
// (Split out of typeset-docx.js — see docs/ARCHITECTURE.md.)
const { arr } = require("../emit.js");
const { blockPlain } = require("../blocktext.js");
const { READINSTR } = require("./series-front.js");
const LEXI = require("../lexicon/index.js");

// For the ZEPH "series" layout, restructure the front matter to match the house
// style: a repeated title page after the cover (where silent roman counting
// begins at i), then the Table of Contents, then the prose front matter where
// the roman number becomes visible (so The Authors lands on ~v), then the body
// restarting at arabic page 1 on the first unit. Also leaves room for a hand
// signature above the signatory's name on Foreword/Preface/Acknowledgements.
// Wrap each Learning Activity / Exercise / End-of-Topic Assessment (and its
// following content) in a bordered box. Used for primary Teacher's Guides whose
// writers left these as plain flowing text. A box starts at an activity/exercise/
// assessment heading and runs until the next such heading, the next topic/
// sub-topic, or a fresh content heading — internal labels (Teaching and Learning
// Materials, Teacher Facilitation Procedure, Teacher Notes, …) stay inside it.
// HOUSE STYLE (docs/HOUSE-STYLE.md s.4): a box's top items always renumber 1..N, and
// sub-parts a/b/c reset under each parent. That rule was only ever applied by the
// import-time question builder, which runs for a box the manuscript authored as a
// table or under a recognised heading. A box built HERE — by wrapping blocks that were
// already parsed as ordinary list items — never passed through it, so those boxes kept
// whatever Word counter the author's list happened to be on. The ECE Chitonga Learner's
// Book runs ONE continuous Word list through the whole book, so its boxes opened at
// "3.", "5." and "2." instead of at 1, and the book needed seven hand-written setMarker
// overrides to say what the house style already promised.
//
// Renumber the box's own items: decimal tops count 1..N, letters and roman numerals
// reset under the top they follow. The author's marker FORMAT is kept — "1." stays
// "1.", "1)" stays "1)" — and a bullet is never touched, because a bullet is not a
// numbered item.
function renumberBoxItems(body) {
  const DEC = /^\(?(\d+)([.)])?$/;
  const LET = /^\(?([a-z])([.)])?$/i;
  const ROM = /^\(?([ivx]+)([.)])?$/i;
  const fmt = (m, n, kind) => {
    const open = /^\(/.test(m) ? "(" : "";
    const close = /[.)]$/.test(m) ? m.slice(-1) : "";
    const body2 = kind === "dec" ? String(n)
      : kind === "let" ? String.fromCharCode(96 + ((n - 1) % 26) + 1)
      : ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][n - 1] || String(n);
    const cased = kind === "let" && /^[(]?[A-Z]/.test(m) ? body2.toUpperCase() : body2;
    return open + cased + close;
  };
  let top = 0, sub = 0;
  for (const b of body) {
    if (!b || b.t !== "listitem" || typeof b.marker !== "string") continue;
    const m = b.marker.trim();
    if (!m || m === "\u2022") continue;                 // a bullet is not a numbered item
    const isSub = !!b.nest || !!b._sub;
    if (DEC.test(m) && !isSub) { b.marker = fmt(m, ++top, "dec"); sub = 0; continue; }
    if (LET.test(m) && !ROM.test(m)) { b.marker = fmt(m, ++sub, "let"); continue; }
    if (ROM.test(m)) { b.marker = fmt(m, isSub ? ++sub : ++top, "rom"); continue; }
  }
}

// A box frames the thing it encloses, so a box that encloses nothing but PICTURES is
// not a box — the border frames the pictures, which already have their own edges, and
// says nothing the heading above them does not.
//
// This is the one rule, applied once, after import. A picture label can reach the page
// as a box by several routes — the author put it in a table with its pictures, or drew
// it as a Word shape the box recovery picks up — and the ECE Chitonga Learner's Book
// hit one of them exactly once: it labels every picture "MULIMO n", and fifty-nine of
// those printed as a plain heading while the sixtieth printed inside a titled panel.
// One element, two appearances, decided by nothing the reader can see.
//
// Un-boxed to match: the title becomes the heading it is everywhere else, and the
// pictures follow it. A box with any real content - a question, a list, a table, a
// paragraph of instructions - is left exactly as it was.
function unboxPictureOnly(blocks) {
  const PIC = /^(img|image|imagerow|pendingimg)$/;
  const isPic = (x) => !!x && PIC.test(x.t || x.kind || "");
  const titleOf = (b) => (b.t === "exercise" ? b.heading : b.title) || "";
  const contentOf = (b) => (b.t === "activity" ? (b.body || []) : (b.parts || []));
  const out = [];
  let n = 0, nSplit = 0;
  for (const b of blocks) {
    if (!b || !/^(exercise|activity|assessment)$/.test(b.t)) { out.push(b); continue; }
    const content = contentOf(b);
    if (!content.length || !content.every(isPic)) { out.push(b); continue; }
    const title = String(titleOf(b)).trim();
    if (title) out.push({ t: "head", text: title });
    for (const x of content) {
      const imgs = x.images || (x.file ? [x] : []);
      if (!imgs.length) continue;
      out.push(imgs.length === 1 ? { t: "image", ...imgs[0] } : { t: "imagerow", images: imgs });
    }
    n++;
  }
  if (n) console.log(`   ${n} picture-only box(es) set as a heading and its pictures`);
  // A box that contains ANOTHER box's title is really two things the author typed into
  // one container. The ECE Chitonga Learner's Book drew "MULIMO 2" as a picture label
  // and then, inside the same shape, wrote a whole "Cakucita" activity with its
  // question — so that one picture printed inside a titled panel while the other
  // fifty-nine stood under a plain heading, and the activity was buried in it. Split
  // at the inner title: what comes before it is the picture label, what follows is the
  // activity, and each is then judged on its own by the picture-only rule above.
  const innerTitle = (x) => {
    const t = String((x && (x.q || x.text || x.title)) || "").trim();
    if (!t || t.length > 60) return null;
    return LEXI.boxKind(t);
  };
  const split = [];
  for (const b of out) {
    if (!b || !/^(exercise|activity|assessment)$/.test(b.t)) { split.push(b); continue; }
    const content = contentOf(b);
    const at = content.findIndex((x, i) => i > 0 && innerTitle(x));
    if (at < 0) { split.push(b); continue; }
    const headPart = content.slice(0, at);
    const tailPart = content.slice(at);
    const innerK = innerTitle(tailPart[0]);
    const title = String(titleOf(b)).trim();
    if (title) split.push({ t: "head", text: title });
    for (const x of headPart) {
      const imgs = x.images || (x.file ? [x] : []);
      if (imgs.length) split.push(imgs.length === 1 ? { t: "image", ...imgs[0] } : { t: "imagerow", images: imgs });
      else split.push({ t: "para", segs: x.qseg || x.segs || [{ t: String(x.q || x.text || ""), b: false, it: false, c: null }] });
    }
    const innerName = String((tailPart[0].q || tailPart[0].text || "")).trim();
    const rest = tailPart.slice(1);
    // An activity box carries BODY BLOCKS; an exercise/assessment carries QA PARTS.
    // The content being split out came from the outer box and is already in parts
    // shape, so convert it when the inner title asks for an activity - handing parts
    // to an activity block fails the Typst compile outright.
    const kindT = innerK === "activity" ? "activity" : innerK === "assessment" ? "assessment" : "exercise";
    const asBody = (ps) => ps.map((x) => (x.kind === "image"
      ? { t: "imagerow", images: x.images }
      : x.marker
        ? { t: "listitem", marker: x.marker, segs: x.qseg || [{ t: String(x.q || ""), b: false, it: false, c: null }] }
        : { t: "para", segs: x.qseg || [{ t: String(x.q || ""), b: false, it: false, c: null }] }));
    if (!rest.length) { split.push({ t: "head", text: innerName }); nSplit++; continue; }
    split.push(kindT === "activity" ? { t: "activity", title: innerName, body: asBody(rest) }
      : kindT === "exercise" ? { t: "exercise", heading: innerName, parts: rest }
      : { t: "assessment", title: innerName, intro: [], parts: rest, extra: [] });
    nSplit++;
  }
  if (nSplit) console.log(`   ${nSplit} box(es) split where the author nested another box's title inside`);
  return split;
}

function boxifyActivities(blocks, opts = {}) {
  // `looseStarts` (per-book): also treat a `para`/`listitem`/`h2` block as an
  // activity/exercise/assessment box START (not just a real head/label) and absorb a
  // single content sub-heading the manuscript placed right under the title. For books
  // whose author left activities as plain paragraphs or coloured sub-heads.
  // `mergeColon` (per-book): a bare "ACTIVITY N" title pulls the box's first short
  // instruction line up into the title as "ACTIVITY N: <instruction>".
  // `boxHeads` (per-book): [{find, kind}] — extra heading texts that START a box even
  // though they are not the usual ACTIVITY/EXERCISE/ASSESSMENT words (e.g. a Grade-2
  // "Dictation (Spelling)" strand that should box its following blanks). Default kind
  // is "ex". Matched on exact trimmed plain text.
  const { looseStarts = false, mergeColon = false, boxHeads = [] } = opts;
  const boxHeadMap = new Map(boxHeads.map((h) => [String(h.find).replace(/\s+/g, " ").trim(), h.kind || "ex"]));
  // Real section headings are ALL-CAPS and either numbered ("EXERCISE 1",
  // "LEARNING ACTIVITY 2") or the whole line is the assessment title
  // ("END-OF-TOPIC ASSESSMENT"). This must NOT match glossary entries like
  // "Exercise – Physical activity…" or "Assessment – A method…" (Title-case, a
  // dash, then a definition).
  // English plus local-language "learning activity" labels (Lunda: Zhakwila,
  // Bemba: Ifyakucita, Nyanja: Nchito, Silozi: Musebezi, Luvale: Vyakulinga,
  // Tonga: Cakucita, Kaonde: Mwingilo wakuuba) — a numbered activity heading the
  // manuscript left un-boxed, so it becomes a titled activity box (T.act colour).
  const ACT = /^(LEARNING\s+(ACT(?:IVIT|IVT|VIT)Y?|MODELS?)|LEARNING|ACT(?:IVIT|IVT|VIT)Y?|MODELS?|Zhakwila(\s+atudizi)?|Ifyakucita|Nchito|Musebezi|Vyakulinga|Cakucita|Mwingilo\s+wakuuba)\s+\d/i;
  // "EXERCISE 1" or a bare "Exercise" (many Learner's Books number neither), or a
  // plural range heading ("EXERCISES 1 - 4") some books use instead — the isDefn
  // guard below still excludes a glossary line like "Exercise – Physical…". No \b
  // after "EXERCISE" alone: it would also require a boundary before a literal "S",
  // and "E"/"S" are both word characters, so "EXERCISES" would never match.
  const EX = /^EXERCISES?\b/i;
  // "END-OF-TOPIC ASSESSMENT", "TOPIC ASSESSMENT", "ASSESSMENT [N]" — nothing
  // (except an optional number/colon) may follow, so a "Assessment – …" glossary
  // line is excluded. Also accepts "(END OF) TOPIC EXERCISE" — a whole-topic wrap-up
  // some books title "Exercise" instead of "Assessment"; it must box to the topic end
  // exactly like an assessment (a BARE "EXERCISE" is still a normal lesson exercise,
  // caught earlier by EX, since the TOPIC prefix is required for the exercise variant).
  // Also accepts UNIT as well as TOPIC ("End of Unit Assessment", the wording used
  // in the primary Learner's Books) and a plural "Assessments" — without those the
  // heading was not recognised and the whole end-of-unit section stayed un-boxed.
  // "ASSESS?MENT" (not "ASSESSMENT") because "ASSESMENT" with one S is a very common
  // manuscript typo — spelt that way it was not recognised as a heading at all and the
  // whole end-of-topic answer key stayed un-boxed, flush against the body text. The
  // misspelling is corrected in the PRINTED title by fixBoxTitleSpelling (import-docx.js).
  const ASMT = /^(((END[\s-]*OF[\s-]*)?(TOPIC|UNIT)[\s-]*)?ASSESS?MENTS?|(END[\s-]*OF[\s-]*)?(TOPIC|UNIT)[\s-]*EXERCISE)(\s+\d+)?\s*:?\s*$/i;
  // a glossary definition line ("Term – meaning") is never a box heading
  const isDefn = (t) => /\s[–-]\s/.test(t);
  // A Teacher's Guide answer section ("Exercise – Expected Answers", "Assessment –
  // Expected Responses") reads like a "Term – meaning" glossary line to isDefn, but is
  // really an exercise box that should frame the answers below it. Recognise it FIRST,
  // tolerating the dash type, plural/typo forms ("Exercises", "EXERCSE"), case and a
  // trailing period, so every answer key is boxed like the other exercises.
  const EXPECT = /^(EXERC\w*|ASSESS?MENTS?)\s*[–—-]\s*EXPECTED\s+(ANSWER|RESPONSE)/i;
  // The local language's OWN words for these sections, from its word list, so a book
  // does not depend on its wording having been hard-coded into the regexes above.
  // Those lists require a NUMBER after the word ("Cakucita 1"); a book that numbers
  // none of its activities matched nothing and left every one of them unboxed, against
  // the house style that activities and assessments are boxes.
  //
  // The exercise concept is read too, but a section whose whole body is PICTURES is
  // left as a heading (see below): this book's "MULIMO n" labels a picture rather than
  // a set of questions, and a border drawn round a picture frames nothing.
  const lexKind = (t) => {
    const k = LEXI.boxKind(t);
    return k === "activity" ? "act" : k === "exercise" ? "ex" : k === "assessment" ? "asmt" : null;
  };
  const kindOf = (t) => (EXPECT.test(t) ? "ex" : isDefn(t) ? null : ACT.test(t) ? "act" : EX.test(t) ? "ex" : ASMT.test(t) ? "asmt" : lexKind(t));
  const INTERNAL = /^(teaching and learning materials|teacher.?s?\s*facilitation procedure|facilitation procedure|teacher.?s?\s*notes?|take note of responses|expected responses?|possible answers?|materials?|answers?|procedure)\b/i;
  // The recurring teaching PHASES inside a single activity (the 3Ps / lesson-cycle
  // structure: Introduction, Presentation/Present, Practice, Production/Produce,
  // Conclusion, plus common variants). They are sub-steps of ONE activity, not a new
  // section, so an "act" box must ABSORB them and keep running to the next real
  // activity/topic/lesson — otherwise the box ends at the first phase heading and the
  // rest of the activity spills out unboxed.
  const ACTPHASE = /^(introduction|presentation|present|practi[sc]e|production|produce|conclusion|development|application|reflection|closure|warm[\s-]?up|starter|plenary|main\s+activity|lesson\s+development)\s*:?\s*$/i;
  // An "ALTERNATIVE (LEARNING) ACTIVITY: …" heading (e.g. "…: INDIVIDUAL WORK") is an
  // extension of the SAME activity for learners working alone — it must stay inside the
  // box above it, not end it and float out as a stray heading.
  const ALTACT = /^ALTERNATIVE\s+(LEARNING\s+)?ACTIVIT/i;
  const BACKMATTER = /^(GLOSSARY|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX|ACRONYMS)\b/i;
  const isHead = (b) => b && (b.t === "head" || b.t === "label");
  const ht = (b) => (b.text || "").trim();
  // A pre-built box / already-framed block (from the importer or an earlier pass): its
  // presence always ENDS an open box — the orphan content before it belongs to the box,
  // but the box itself is a sibling, never absorbed.
  const BOXBLOCK = new Set(["exercise", "activity", "assessment", "framedsection", "keypoints", "fact", "box", "termpage"]);
  // The text used to test whether a block STARTS a box. Real heads/labels use their
  // .text; with looseStarts a paragraph/list-item/sub-head uses its plain text so an
  // activity the author typed as body text ("Activity 1: …") or a coloured sub-head
  // ("ACTIVITY", an h2) is still recognised.
  const startText = (b) => {
    if (b.t === "head" || b.t === "label") return (b.text || "").trim();
    if (looseStarts && (b.t === "h2" || b.t === "para" || b.t === "listitem")) return blockPlain(b).trim();
    return null;
  };
  // A bold "header" the manuscript styled INLINE (a bold paragraph, not a real
  // heading) — a local-language topic/sub-topic ("MUTU WANSAÑU: 1.2.4") or a
  // numbered section opener ("1.2 KUTAÑA"). It begins a new section, so it must
  // end an activity box rather than be swallowed as activity content.
  // Match the local-language sub-topic keyword ("MUTU WANSAÑU …") or a numbered
  // section opener whose number is followed by an UPPER-CASE title ("1.2 KUTAÑA") —
  // case-sensitive so an English numbered list item ("2.1 apples") never matches.
  const HEADPARA = /^(MUTU\s+WANSAÑU|MUTU\s+WAUNG['’]ONO|\d+\.\d+\.?\s+[A-ZÑ])/;
  const isHeaderPara = (b) => (b.t === "para" || b.t === "listitem")
    && (b.segs || []).some((s) => s.b) && HEADPARA.test((b.segs || []).map((s) => s.t).join("").trim());
  // A lesson/strand banner ("READING AND WRITING: LESSON 2", "LISTENING AND
  // SPEAKING: LESSON 1") always begins a NEW lesson section, so it must close an
  // open activity/exercise box even when the manuscript styled it as a bold
  // paragraph rather than a real heading. Without this the next lesson's banner
  // is swallowed into the previous exercise's box and reads as "missing".
  const LESSONBANNER = /^.+?:\s*LESSON\s+\d+\s*$/i;
  const isLessonBanner = (b) => LESSONBANNER.test(blockPlain(b).trim());
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // A boxHead (per-book) starts a box regardless of the usual keyword patterns.
    const bhKey = (b.t === "head" || b.t === "label" || b.t === "h2" || b.t === "h3" || b.t === "para")
      ? blockPlain(b).replace(/\s+/g, " ").trim() : null;
    const bhKind = bhKey && boxHeadMap.has(bhKey) ? boxHeadMap.get(bhKey) : null;
    const st = bhKind ? blockPlain(b).trim() : startText(b);
    let k = bhKind || (st ? kindOf(st) : null);
    // The length guard stops a long prose paragraph being mistaken for a bare-word
    // box start ("Exercise …", "Assessment …"). An "ACTIVITY N:" prefix is
    // distinctive enough that a long activity title (a full instruction sentence,
    // e.g. "Activity 1: Stating different religious groups that use …") is still a
    // genuine box start, so the cap is waived for the "act" kind only. A boxHead is
    // an explicit per-book opt-in, so it is never length-capped.
    if (k && !bhKind && k !== "act" && st.length > 90) k = null;
    if (!k) { out.push(b); continue; }
    const body = [];
    let j = i + 1;
    // A "Read the story/passage/poem…" activity is followed by the passage itself —
    // a story TITLE heading plus its paragraphs. Once the box's instruction says to
    // read a passage, a following NON-box content heading (the story title) is part
    // of the passage, not the start of a new section, so the box absorbs it instead
    // of ending. Only for act/ex boxes, and never past a real topic (h1), a lesson
    // banner, a header-para, back matter, or the next box.
    let readmode = false;
    // Set once the "ALTERNATIVE …ACTIVITY" heading has been absorbed and its single
    // instruction line pushed — general reinforcement prose that follows (no heading of
    // its own) is regular body text, not part of the alternative activity, so the box
    // must stop there rather than swallowing it indefinitely.
    let altActDone = false;
    let altActPending = false;
    while (j < blocks.length) {
      const y = blocks[j];
      if (altActDone) break;
      if (BOXBLOCK.has(y.t)) break;                                  // a pre-built box (exercise/activity/…) always ends this one
      if (isLessonBanner(y)) break;                                  // "<STRAND>: LESSON N" always starts a new lesson
      if (isHeaderPara(y)) break;                                    // a bold inline section header
      if (isHead(y) && BACKMATTER.test(ht(y))) break;               // never absorb back matter (GLOSSARY/
      //   REFERENCES/…) into a box — even an "End of Topic Assessment" that otherwise runs to the topic
      //   end. Left inside the box these headings escape the primary-LB scaffold strip (which only scans
      //   TOP-LEVEL blocks); broken out here, they become top-level headings the strip can remove.
      // leadAbsorb: when a loose para/h2 activity/exercise title is immediately
      // followed by ITS content sub-heading ("Read and blend the words",
      // "Recite the poem", …) and the box is still empty, pull that heading in as
      // the box's first line instead of letting it terminate the box before it starts.
      const contentHead = (y.t === "h2" || y.t === "h3" || (isHead(y) && !kindOf(ht(y))));
      const leadAbsorb = body.length === 0 && (k === "act" || k === "ex") && contentHead;
      const passageHead = readmode && (k === "act" || k === "ex")
        && (y.t === "h2" || y.t === "h3" || (isHead(y) && !kindOf(ht(y))));
      // a teaching-phase sub-heading (Introduction / Present / Practice / Produce /
      // Conclusion …) is part of THIS activity — absorb it, don't end the box.
      const phaseHead = k === "act"
        && ACTPHASE.test((y.text || blockPlain(y) || "").trim())
        && (y.t === "h2" || y.t === "h3" || isHead(y)
          || ((y.t === "para" || y.t === "listitem") && (y.segs || []).some((s) => s.b)));
      const altActHead = (k === "act" || k === "ex")
        && ALTACT.test((y.text || blockPlain(y) || "").trim())
        && (y.t === "h2" || y.t === "h3" || isHead(y)
          || ((y.t === "para" || y.t === "listitem") && (y.segs || []).some((s) => s.b)));
      if (altActPending && !isHead(y)) { body.push(y); j++; altActDone = true; break; }
      if (!passageHead && !leadAbsorb && !phaseHead && !altActHead) {
        if (y.t === "h1" || y.t === "h2" || y.t === "h3") break;     // topic / sub-topic / sub-sub-heading
        if (isHead(y)) {
          const yt = ht(y);
          if (kindOf(yt)) break;                                     // the next box starts
          // Activities/exercises end at a fresh content heading. An "End of Topic
          // Assessment" runs to the END of the topic, though — its interior SECTION
          // labels and little matching-table headers ("Organ Work", "Disease Symptom")
          // are part of the assessment, so only a real topic/sub-topic (h1/h2/h3), the
          // next box, or a header-paragraph ends it — never an inner sub-heading.
          if (k !== "asmt" && !INTERNAL.test(yt)) break;
        }
      }
      body.push(y);
      if (altActHead) altActPending = true;
      if (!readmode && (k === "act" || k === "ex") && READINSTR.test(blockPlain(y))) readmode = true;
      j++;
    }
    // mergeColon: fold a bare "ACTIVITY N" title's first short instruction line
    // up into the title as "ACTIVITY N: <instruction>".
    let title = st;
    if (mergeColon && /^(LEARNING\s+ACTIVITY|ACTIVITY|Activity)\s+\d+$/.test(title.trim()) && body.length) {
      // An instruction line the manuscript split off from "Activity 1" folds up: a
      // HEADING-styled sub-head, OR a short paragraph that reads as an imperative
      // instruction ("Read the words", "Blend the sounds…"). A plain paragraph that
      // is NOT an instruction is real content (a chant, an example) and stays in the
      // box body — so p32's "Story time, story time." is never pulled into the title.
      const INSTR = /^(Read|Write|Blend|Make|Recite|Tell|Say|Sort|Interpret|Work out|Match|Fill|Complete|Draw|Colou?r|Circle|Underline|Copy|Look|Listen|Sing|Answer|Choose|Name|Mention|Describe|Discuss|Act|Point|Count|Arrange|Spell|Trace|Join|Identify|Group|Practi[sc]e|Repeat|Study|Use|Find)\b/i;
      const f = body[0];
      const ft = blockPlain(f).trim();
      const headish = f.t === "h2" || f.t === "head" || f.t === "h3";
      const instrPara = (f.t === "para" || f.t === "listitem") && INSTR.test(ft);
      if ((headish || instrPara) && ft && ft.length <= 70 && !/^\d+[.)]/.test(ft)) {
        title = `${title.trim()}: ${ft}`;
        body.shift();
      }
    }
    // A border drawn round a picture frames nothing. When everything the box would
    // hold is images (and their captions), the heading and the pictures are emitted
    // as they stand instead — this book labels every picture "MULIMO n", and boxing
    // those would put a frame round all sixty of them while the sections that really
    // are activities ("Cakucita") and assessments ("MUSUNKO …") carry the lists that
    // a box exists to frame: a list of things to do, a table, a nested box.
    const framable = body.some((x) => x && /^(listitem|table|box|qa|exercise|assessment)$/.test(x.t));
    if (!framable) { out.push(b, ...body); i = j - 1; continue; }
    renumberBoxItems(body);
    out.push({ t: "framedsection", kind: k, title, body });
    i = j - 1;
  }
  return out;
}

// A manuscript sometimes repeats a short bold sub-heading on two consecutive
// paragraphs by mistake (a copy-paste slip, e.g. "First Aid" / "First Aid" back to
// back before the real intro sentence). Drop the immediate duplicate — same
// trimmed text (case-insensitively), both a heading-ish block (head/label/h2/h3) —
// keeping the first (it usually carries the more distinctive styling: colour/size).
function dedupeAdjacentHeadings(blocks) {
  const HEADISH = new Set(["head", "label", "h2", "h3"]);
  // When a manuscript types the same sub-topic name twice back-to-back at two
  // different styles (a plain bold line, then a properly styled Heading2/3), keep
  // the STRUCTURALLY STRONGER one — h2/h3, which get the sub-topic's real styling
  // AND count toward sequential numbering — not just whichever came first. Keeping
  // the weaker `head`/`label` copy left a sub-topic silently unstyled AND (since it
  // no longer counted) skewed every later sub-topic's number by one.
  const RANK = { h2: 2, h3: 2, head: 1, label: 1 };
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (prev && HEADISH.has(prev.t) && HEADISH.has(b.t)) {
      const a = (prev.text || "").trim().toLowerCase();
      const c = (b.text || "").trim().toLowerCase();
      if (a && a === c) {
        if ((RANK[b.t] || 0) > (RANK[prev.t] || 0)) out[out.length - 1] = b;
        continue; // skip the duplicate
      }
    }
    out.push(b);
  }
  return out;
}

// Some manuscripts style a craft/skill GROUP name ("Plaiting", "Weaving",
// "Educational Gymnastics (Tumbling and Stunts)") with Word's Heading1 — the same
// style as the real "TOPIC N: …" opener — even though it is really a sub-topic-level
// label, not a new unit. Left as h1 it wrongly (a) gets its own contents-page entry,
// bloating the TOC with dozens of non-topic names, and (b) forces an unwanted page
// break as if it were a fresh front-matter section. Two authoring patterns show up:
//  - the group h1 is immediately followed by an h2/h3 sub-topic heading with the
//    EXACT same text (the author typed the name twice, once as each level) — the h1
//    is a pure duplicate, so remove it outright.
//  - the group h1's exact text recurs LATER as its own heading again (repeated
//    before each of several sub-topics it covers, e.g. gymnastics before both
//    "Tumbling Activities" and "Simple Stunts Activities") — keep only the first
//    occurrence and remove the repeats.
// Anything else (no exact match either way) is demoted to h2 rather than removed, so
// its text is kept but it stops polluting the TOC / forcing a page break.
function fixStrayBodyH1s(blocks) {
  const UNIT = /^(TOPIC|UNIT|CHAPTER|CHIBALU|CIPATI)\b/i;
  const FRONTBACK = /^((THE\s+)?AUTHORS?|EDITORS?|FOREW(O|A)RD|PREFACE|ACKNOWLEDGEMENTS?|INTRODUCTION|HOW\s+TO\s+USE(\s+THIS\s+(BOOK|GUIDE))?|ABBREVIATIONS?|SUGGES+TED\s+TEACHING\s+METHODOLOGY|(KEY\s+|SUMMARY\s+OF\s+(GENERAL\s+)?)COMPETEN\w*(\s+TO\s+BE\s+DEVELOPED)?|ACRONYMS|LIST\s+OF\s+(TABLES|FIGURES)|GLOSSARY(\s+OF\s+TERMS)?|REFERENCES?|BIBLIOGRAPHY|APPENDI(X|CES)|INDEX|TABLE\s+OF\s+CONTENTS)$/i;
  // FRONTBACK requires an EXACT match end-to-end, which is right for most of its
  // entries (a stray body h1 could otherwise dodge demotion by coincidentally
  // starting with "Introduction" or "Preface"). But ACRONYMS and (KEY/GENERAL)
  // COMPETENCES sections are routinely titled with the manuscript's own trailing
  // words ("ACRONYMS AND ABBREVIATIONS", "GENERAL COMPETENCES TO BE DEVELOPED"
  // — as this Physics book does) rather than the bare "ACRONYMS"/"KEY COMPETENCES"
  // FRONTBACK expects, so the exact-match check demoted a genuine front-matter
  // section to h2 (losing its own page) purely because of the extra words. These
  // two are safe to match leniently by their lead phrase — the same tolerance the
  // FM/FM_SECTION front-matter regexes elsewhere already give ACRONYMS.
  const FRONTBACK_LEAD = /^(LIST OF )?ACRONYMS\b|^(GENERAL|KEY)\s+COMPETEN\w*\b/i;
  // A back-matter "Scheme of Work" appendix (a term/week-by-week teaching-plan table,
  // standard in CDC-aligned Teacher's Guides) is routinely titled with the book's own
  // name prefixed ("FORM 1 FOOD AND NUTRITION – SAMPLE SCHEME OF WORK"), so — like
  // ACRONYMS/COMPETENCES above — match it by its trailing phrase rather than requiring
  // an exact whole-string match.
  const FRONTBACK_TRAIL = /SCHEME\s+OF\s+WORK$/i;
  // (a local-language book's own Unit/Topic and section words count too)
  const isStray = (b) => {
    const t = (b.text || "").trim();
    return b.t === "h1" && !UNIT.test(t) && !FRONTBACK.test(t) && !FRONTBACK_LEAD.test(t) && !FRONTBACK_TRAIL.test(t)
      && !LEXI.isTopSection(t) && !LEXI.isFrontSection(t) && !LEXI.isBackSection(t) && !LEXI.isContents(t);
  };
  const seen = new Set();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!isStray(b)) continue;
    const t = (b.text || "").trim().toLowerCase();
    let nextH = null;
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j].t === "h1" || blocks[j].t === "h2" || blocks[j].t === "h3") { nextH = blocks[j]; break; }
    }
    const dupOfNext = nextH && (nextH.t === "h2" || nextH.t === "h3") && (nextH.text || "").trim().toLowerCase() === t;
    const dupOfEarlier = seen.has(t);
    if (dupOfNext || dupOfEarlier) { blocks.splice(i, 1); i--; continue; }
    seen.add(t);
    b.t = "h2";
  }
}

// A reviewer/editor sometimes leaves an instruction-to-self IN the manuscript instead
// of actually deleting the content ("FROM LEARNING ACTIVITY 1-3 DELETE COMPLETELY",
// "ACTIVITY 3 IS COMPLETELY REMOVED") — always red text, never meant for the printed
// book. Left in, its wording ("ACTIVITY 3…") can even fool the ACT/EX/ASMT box
// detector into treating the note itself as a new activity heading, swallowing real
// content that follows as its "body". Strip these notes out before boxing runs.
function stripEditorialComments(blocks) {
  const COMMENT = /\b(DELETE(D)?\s+COMPLETELY|COMPLETELY\s+(DELETE(D)?|REMOVE(D)?)|REMOVE(D)?\s+COMPLETELY|CHANGED?\s+THIS\s+PICTURE)\b/i;
  const isComment = (b) => {
    const t = (b.text || (b.segs ? b.segs.map((s) => s.t || "").join("") : "") || "").trim();
    return t.length > 0 && t.length < 100 && COMMENT.test(t);
  };
  const filterArr = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      if (!b || typeof b !== "object") continue;
      if (isComment(b)) { arr.splice(i, 1); continue; }
      if (Array.isArray(b.body)) filterArr(b.body);
      if (Array.isArray(b.parts)) filterArr(b.parts);
    }
  };
  filterArr(blocks);
}

// An author occasionally leaves a whole passage in red text — leftover reviewer/draft
// formatting, never an intentional house style (the book has no other use of red for
// student-facing content). Reset it to the normal ink colour everywhere: top-level
// paragraphs/list items, box bodies/parts (exercise & assessment questions use
// qseg/aseg, not segs), and table cells.
function clearStrayRed(blocks) {
  const RED = /^FF0000$/i;
  const fixSegs = (segs) => { if (Array.isArray(segs)) for (const s of segs) if (s && RED.test(s.c || "")) s.c = null; };
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      fixSegs(b.segs);
      fixSegs(b.qseg);
      fixSegs(b.aseg);
      if (Array.isArray(b.rows)) {
        for (const row of b.rows) {
          if (!Array.isArray(row)) continue;
          for (const cell of row) if (cell && Array.isArray(cell.segs)) fixSegs(cell.segs);
        }
      }
      if (Array.isArray(b.body)) walk(b.body);
      if (Array.isArray(b.parts)) walk(b.parts);
    }
  };
  walk(blocks);
}

// blackWhite: true (see the override handling below) greys every colour the THEME
// itself draws — banners, boxes, rules, headings — but has no visibility into colour an
// author set directly on a run in the manuscript (a heading or key term hand-highlighted
// blue, a hyperlink-styled phrase). Left alone those runs print in colour on an otherwise
// black/grey page, defeating the whole point of the override. Same walk as
// clearStrayRed, but unconditional: every explicit run colour is cleared, not just red.
function clearAllInlineColor(blocks) {
  const fixSegs = (segs) => { if (Array.isArray(segs)) for (const s of segs) if (s) s.c = null; };
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      fixSegs(b.segs);
      fixSegs(b.qseg);
      fixSegs(b.aseg);
      if (Array.isArray(b.rows)) {
        for (const row of b.rows) {
          if (!Array.isArray(row)) continue;
          for (const cell of row) if (cell && Array.isArray(cell.segs)) fixSegs(cell.segs);
        }
      }
      if (Array.isArray(b.body)) walk(b.body);
      if (Array.isArray(b.parts)) walk(b.parts);
    }
  };
  walk(blocks);
}

// Inside an activity/exercise box, an author frequently leaves the "SAFETY FIRST"
// notice and each "Step N:" instruction line un-bolded even though they read as
// mini sub-headers within the box — inconsistent with the boxes where the SAME
// phrases WERE bolded. Force them bold everywhere so every box reads consistently,
// scanning top-level blocks and recursing into box bodies/parts.
function boldSafetyAndSteps(blocks) {
  const SAFETY = /^SAFETY\s+FIRST$/i;
  const STEP = /^(Step\s+\d+\s*:)(\s*)/i;
  const ALTACTLINE = /^ALTERNATIVE\s+(LEARNING\s+)?ACTIVIT/i;
  const WHATTODO = /^WHAT\s+TO\s+DO$/i;
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      if ((b.t === "para" || b.t === "listitem") && Array.isArray(b.segs)) {
        const plain = b.segs.map((s) => s.t || "").join("").trim();
        if (SAFETY.test(plain) || ALTACTLINE.test(plain) || WHATTODO.test(plain)) {
          for (const s of b.segs) s.b = true;
        } else if (STEP.test(plain)) {
          // bold only the "Step N:" marker, not the rest of the instruction —
          // split the first segment that carries it.
          const first = b.segs.find((s) => (s.t || "").trim());
          if (first && !first.b) {
            const m = first.t.match(STEP);
            if (m) {
              const idx = b.segs.indexOf(first);
              const markerSeg = { ...first, t: m[1], b: true };
              const restSeg = { ...first, t: first.t.slice(m[1].length) };
              b.segs.splice(idx, 1, markerSeg, restSeg);
            }
          }
        }
      }
      if (Array.isArray(b.body)) walk(b.body);
      if (Array.isArray(b.parts)) walk(b.parts);
    }
  };
  walk(blocks);
}

// Some manuscripts style a lesson banner ("LISTENING AND SPEAKING: LESSON 2") as
// a centred bold PARAGRAPH instead of a heading like its siblings. Left as a para
// it renders centred and — unlike a head — is not sticky, so it orphans at the
// foot of a page while its lesson content flows to the next. Convert any bold
// block whose whole text is a "<STRAND>: LESSON N" banner into a proper head so it
// matches the other lesson headings (left-aligned, sticky, ink-coloured).
function normaliseLessonBanners(blocks) {
  const RE = /^.+?:\s*LESSON\s+\d+\s*$/i;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== "para" && b.t !== "listitem") continue;
    const t = blockPlain(b).trim();
    if (t.length > 60 || !RE.test(t)) continue;
    if (!(b.segs || []).some((s) => s.b)) continue;   // only a bold banner, never plain body text
    blocks[i] = { t: "head", text: t };
  }
}

// Primary Teacher's Guides mark each unit inconsistently: some as a bare "UNIT N"
// banner with the theme split onto the next line ("THEME: Gender") or a following
// paragraph, some already combined ("UNIT 10: SPECIAL AND INCLUSIVE EDUCATION"), one
// as a mis-levelled sub-heading carrying a stray list number ("1. UNIT 11: DRUG…").
// Normalise every unit opener to ONE banner "UNIT N: Theme" — matching the Learner's
// Book — by pulling the theme up from the next block when it was split off and
// dropping the redundant "THEME:" word. Also promotes a mis-levelled unit banner to a
// real unit (h1) and demotes any OTHER stray body sub-heading (h2) to a plain lesson
// head, so the table of contents lists units only (no sub-topics), like the LB.
// Returns the numbers of units whose theme the manuscript never supplied (to flag).
function normaliseUnitHeads(blocks) {
  const UNITRE = /^\s*(?:\d+\.\s*)?UNIT\s+(\d+)\b\s*(.*)$/i;
  const isHeadish = (b) => b && (b.t === "h1" || b.t === "h2" || b.t === "h3" || b.t === "head" || b.t === "label");
  const missing = [];
  let seenUnit = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!isHeadish(b) || typeof b.text !== "string") continue;
    const m = b.text.match(UNITRE);
    if (m) {
      const num = m[1];
      let theme = (m[2] || "").trim().replace(/^[:\-–—]\s*/, "").replace(/^THEME\s*:\s*/i, "").trim();
      if (!theme) {
        // The theme was split onto a following block ("THEME: X" head/para). It is
        // usually the very next block, but some units slot a "WEEK 1" head between the
        // banner and the theme — so scan the next few blocks, skipping such heads, and
        // stop at real body content or the next unit so we never borrow another unit's.
        for (let j = i + 1; j <= i + 4 && j < blocks.length; j++) {
          const nb = blocks[j];
          const plain = blockPlain(nb).trim();
          if (UNITRE.test(plain)) break;                       // reached the next unit
          const tm = plain.match(/^THEME\s*:?\s*(.+)$/i);
          if (tm) { theme = tm[1].trim(); blocks.splice(j, 1); break; }
          if (!/^WEEK\s+\d+\b/i.test(plain)) break;            // real content — stop looking
        }
      }
      b.t = "h1";
      b.text = theme ? `UNIT ${num}: ${theme}` : `UNIT ${num}`;
      delete b.segs; delete b.marker; delete b.isList; delete b.numId; delete b.lvl; delete b.noPromote;
      if (!theme) missing.push(num);
      seenUnit = true;
      continue;
    }
    // any OTHER body sub-heading (h2) → a plain lesson head, so it stays off the
    // units-only contents page and matches the LB lesson styling. Also strip a stray
    // list "N." prefix and repair a colon-less strand banner ("STRAND LESSON 1").
    if (seenUnit && b.t === "h2") {
      let t = (b.text || "").replace(/^\s*\d+\.\s*/, "").trim();
      t = t.replace(/^(.+?)\s+(LESSON\s+\d+)\s*$/i, "$1: $2");
      b.t = "head"; b.text = t; delete b.segs; delete b.marker;
    }
  }
  return missing;
}

// Force each unit banner to a supplied theme (a map { "8": "HIV/AIDS", … }), overriding
// whatever the manuscript did. Used to SYNC a Teacher's Guide's unit themes to its Learner's
// Book when the TG manuscript formats themes inconsistently — a bare heading with no "THEME:"
// prefix, or no theme line at all. Runs AFTER normaliseUnitHeads. Also drops a stray duplicate
// theme heading the manuscript left right under the banner (e.g. a "DRUG AND SUBSTANCE ABUSE"
// Heading2 that had no "THEME:" prefix, so it would otherwise repeat as a body head).
function forceUnitThemes(blocks, map) {
  const UNITRE = /^\s*(?:\d+\.\s*)?UNIT\s+(\d+)\b\s*:?\s*(.*)$/i;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== "h1" || typeof b.text !== "string") continue;
    const m = b.text.match(UNITRE);
    if (!m) continue;
    const theme = map[m[1]];
    if (!theme) continue;
    b.text = `UNIT ${m[1]}: ${theme}`;
    const nb = blocks[i + 1];
    if (nb && (nb.t === "head" || nb.t === "h2") && typeof nb.text === "string"
        && nb.text.trim().toUpperCase() === String(theme).trim().toUpperCase()) {
      blocks.splice(i + 1, 1);
    }
  }
}

// HOUSE STYLE: a book's structural box LABELS -- "LEARNING ACTIVITY 3", "EXERCISE 7",
// "END OF TOPIC ASSESSMENT" -- all read in the same case throughout the book.
// Manuscripts are not consistent about this: the ICT Form 2 Teacher's Guide types
// every activity and exercise in caps but three of its four end-of-topic assessments
// in Title Case, so the same structural divider appeared in two different registers
// depending which topic you were reading.
//
// fixBoxTitleSpelling() in import-docx.js deliberately PRESERVES the manuscript's
// case (it corrects spelling, not style), so this normalisation belongs here instead.
// Only the LABEL is touched: an activity's descriptive tail after the colon
// ("LEARNING ACTIVITY 9: Creating a budget using spreadsheet") is the author's own
// sentence and keeps its case.
//
// The target is whichever case the book itself already uses most across ALL its box
// labels, so a caps-dominant book has its stragglers raised and a Title-Case-dominant
// book has its shouting ones lowered -- neither gets a house case imposed on it from
// outside. An exact tie changes nothing, there being no majority to conform to.
const BOX_LABEL_WORD = /^(END|OF|TOPIC|UNIT|LEARNING|ACTIVITY|ACTIVITIES|EXERCISE|EXERCISES|ASSESSMENT|ASSESSMENTS)$/i;

const BOX_LABEL_SMALL = /^(of|the|and|to|in|for)$/i;

// The label is everything before the first colon. A title with NO colon qualifies only
// when it is nothing but label words and numbers ("End of Topic Assessment"), so a
// colon-less descriptive title is left alone rather than half-recased.
function boxLabelOf(title) {
  const t = (title || "").trim();
  if (!t) return null;
  const ci = t.indexOf(":");
  const label = ci >= 0 ? t.slice(0, ci) : t;
  if (!/[A-Za-z]/.test(label)) return null;
  const toks = label.replace(/[-\u2013\u2014().]/g, " ").split(/\s+/).filter(Boolean);
  if (!toks.length || !toks.every((w) => /^\d+$/.test(w) || BOX_LABEL_WORD.test(w))) return null;
  return label;
}

const isAllCapsLabel = (s) => /[A-Za-z]/.test(s) && s === s.toUpperCase();

const toTitleCaseLabel = (s) => s.replace(/[A-Za-z]+/g, (w, off) =>
  off > 0 && BOX_LABEL_SMALL.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

function uniformBoxLabelCase(blocks) {
  const boxes = [];
  (function walk(arr) {
    for (const b of arr || []) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "activity" || b.t === "assessment") boxes.push({ b, k: "title", s: "titleSegs" });
      else if (b.t === "exercise") boxes.push({ b, k: "heading", s: "headingSegs" });
      if (Array.isArray(b.body)) walk(b.body);
      if (Array.isArray(b.blocks)) walk(b.blocks);
    }
  })(blocks);
  let caps = 0, mixed = 0;
  for (const { b, k } of boxes) {
    const lab = boxLabelOf(b[k]);
    if (lab) (isAllCapsLabel(lab) ? caps++ : mixed++);
  }
  if (caps === mixed) return;
  const recase = caps > mixed ? ((s) => s.toUpperCase()) : toTitleCaseLabel;
  for (const { b, k, s } of boxes) {
    const lab = boxLabelOf(b[k]);
    if (!lab) continue;
    const fixed = recase(lab);
    if (fixed === lab) continue;
    b[k] = fixed + (b[k] || "").trim().slice(lab.length);
    // The rich segments win over the plain string at emit time (see titleContent), so
    // recase them in step. Only letter case changes, so `fixed` is the same length as
    // the label and can be written back across however many runs the manuscript split
    // it into, character for character.
    if (Array.isArray(b[s]) && b[s].length) {
      let pos = 0;
      for (const seg of b[s]) {
        if (pos >= fixed.length) break;
        const txt = seg.t || "";
        const take = Math.min(txt.length, fixed.length - pos);
        seg.t = fixed.slice(pos, pos + take) + txt.slice(take);
        pos += take;
      }
    }
  }
}


// Per-book option `subtopicsOnly` (overrides): for a manuscript whose real sub-topics are all
// numbered ("Sub-Topic 1.1.1: …") but whose author ALSO used Word's Heading 2 — or bold labels
// that later passes promote — for ordinary in-body headings ("Agriculture as a Technology",
// "Fixed-Wing Drones"): the Agriculture Form 1 LB. Left alone, every one takes the sub-topic
// banner and a contents line. Keep only the numbered sub-topics at h2; demote the rest to an
// in-body head, and a long one that is really a sentence ("1. Environmental Factors:
// Environmental factors are natural conditions…") to a paragraph with a bold lead-in.
// Runs AFTER fixStrayBodyH1s, which is what promotes stray headings to h2.
function keepNumberedSubtopicsOnly(blocks) {
  const SUBTOPIC = /^SUB[-\s‐-―]*TOPIC\s*:?\s*[\d.]/i;
  let n = 0;
  for (const b of blocks) {
    if (b.t !== "h2") continue;
    const t = (b.text || blockPlain(b) || "").trim();
    if (SUBTOPIC.test(t)) continue;
    const m = t.length > 70 && t.match(/^([^:]{3,60}:)\s+(\S.*)$/);
    if (m) {
      Object.assign(b, { t: "para", segs: [{ t: m[1] + " ", b: true, it: false, c: null }, { t: m[2], b: false, it: false, c: null }] });
      delete b.text;
    } else { b.t = "head"; b.text = t; }
    n++;
  }
  if (!n) console.warn("!  subtopicsOnly changed nothing");
}




// HOUSE RULE: the same element looks the same on every page. An author retyping a
// recurring heading rarely types it the same way twice — the ECE Chitonga Learner's
// Book writes its end-of-lesson assessment heading nine times and never once
// identically: "MUSUNKO WAKUMAMANINO AACIIYO", "… ACIIYO", "… ACIIIYO", "… ACHIIYO",
// "… AACIYO". A reader meets what looks like five different headings for one thing.
//
// Level only what is demonstrably the SAME WORD spelt two ways. In these languages
// the spelling wobbles in exactly two places: a long vowel (or consonant) written
// once or twice, and the affricate written "c" or "ch". So headings are grouped by a
// skeleton that lowercases, reads "ch" as "c", and counts a run of one repeated
// letter once — and changes NOTHING else.
//
// Everything else is left alone on purpose, because an earlier attempt that ignored
// punctuation, spacing and case did real damage to the Kiikaonde Grade 1 Teacher's
// Guide: it levelled the LENGTH of the dot leaders in a typed contents list, it
// decided a mangled "MUTWE : 1.8  : Bilulumo" was the house form and spread it over
// the correct "MUTWE: 1.8 Bilulumo", and it fought uniformBoxLabelCase for ownership
// of heading case. Hence:
//   - punctuation and spacing are part of the skeleton, so two spellings that differ
//     in a colon, a space or a row of dots are different headings;
//   - a group whose members differ ONLY in case is skipped entirely — case is
//     uniformBoxLabelCase's business, and two passes must not disagree about it.
//
// Within a group the spelling the author used most often wins; on a tie the fullest
// one does, since a dropped letter is the commoner slip. A heading with no variants
// is never touched. Local-language books only: that is where the evidence is.
function levelHeadingVariants(blocks) {
  if (!LEXI.getLang()) return 0;
  const isHead = (b) => b && /^(head|label|h1|h2|h3)$/.test(b.t) && typeof b.text === "string";
  // Collapse a run of one repeated letter to a single letter. A doubled vowel is a
  // genuine typing wobble in these languages and is safe to fold.
  //
  // "c" and "ch" are NOT folded together. Which one is right is a fact about the
  // language, not a typing wobble — Chitonga writes "Cakucita" with c, Cinyanja writes
  // "ch" — so they are a right spelling and a wrong one, not two spellings of equal
  // standing. An earlier version read "ch" as
  // "c" and so was willing to level a correct spelling onto a wrong one, picking the
  // winner by nothing better than which the author typed more often. Where two
  // headings differ by c/ch the word list decides (see lexiconForm below); if the
  // word list is silent, they are left alone for a person to settle.
  const fold = (t) => {
    let out = "";
    for (const ch of t) {
      if (/[A-Za-z\u00C0-\u024F]/.test(ch) && out && out[out.length - 1].toLowerCase() === ch.toLowerCase()) continue;
      out += ch;
    }
    return out;
  };
  // Grouping key: the WORD, ignoring case, punctuation and spacing — so every
  // spelling of one heading lands in one group and the pass cannot pick two
  // different winners for the same word.
  const word = (t) => fold(t.toLowerCase()).replace(/[^a-z\u00C0-\u024F0-9]/g, "");
  // Applying key: the same fold WITH case and punctuation kept. A heading is only
  // rewritten when it already matches the winner in everything but the doubled
  // letters — so this pass changes spelling and nothing else, and never argues with
  // uniformBoxLabelCase about case or adds a colon the author did not type.
  const shape = (t) => fold(t);
  // FIRST, the house spelling. Each concept in the language's word list is written
  // house-spelling-FIRST, with the other wordings authors have used kept after it so
  // the engine still RECOGNISES them. A heading that is one of those other wordings is
  // rewritten to the first one — the house form — whatever the manuscript does most
  // often. The ECE Chitonga Learner's Book writes "Cakucita" ten times and "Chakucita"
  // once; Chitonga writes the sound with plain c, so the word list's "Cakucita" is
  // what prints, and a stray "Cakuchita" is corrected to it (the author's own
  // proofread asked for exactly that). This runs before the levelling below, which only
  // ever decides between spellings the word list has no opinion about.
  const LEX_CONCEPTS = ["activity", "alt_activity", "exercise", "assessment_topic", "assessment_unit",
    "key_points", "note_teacher", "example", "possible_answers", "topic", "subtopic", "lesson", "unit"];
  const houseOf = new Map();
  for (const id of LEX_CONCEPTS) {
    const ws = LEXI.words([id]);
    if (ws.length < 2) continue;                       // no alternative spellings recorded
    for (const w of ws.slice(1)) houseOf.set(w.toLowerCase(), ws[0]);
  }
  let houseN = 0;
  const houseChanged = new Map();
  if (houseOf.size) {
    // Anywhere the term stands ALONE — a heading, a box title, a question line the
    // importer absorbed into a box — carries the house spelling. Matched on the whole
    // trimmed text, never as a substring, so running prose is never touched.
    const setText = (o, h) => {
      if (typeof o.text === "string") o.text = h;
      if (typeof o.q === "string") o.q = h;
      if (typeof o.title === "string") o.title = h;
      if (typeof o.plain === "string") o.plain = h;
      for (const k of ["segs", "qseg", "aseg", "seg"]) {
        if (Array.isArray(o[k]) && o[k].length) o[k] = [{ ...o[k][0], t: h }];
      }
    };
    const textOfNode = (o) => {
      if (typeof o.text === "string" && o.text.trim()) return o.text;
      if (typeof o.q === "string" && o.q.trim()) return o.q;
      if (typeof o.title === "string" && o.title.trim()) return o.title;
      for (const k of ["segs", "qseg", "seg"]) {
        if (Array.isArray(o[k]) && o[k].length) {
          const j = o[k].map((s) => s.t || "").join("");
          if (j.trim()) return j;
        }
      }
      return "";
    };
    (function walk(arr) {
      for (const o of arr) {
        if (!o || typeof o !== "object") continue;
        const t = textOfNode(o).trim();
        const h = t && houseOf.get(t.toLowerCase());
        if (h && h !== t) { setText(o, h); houseChanged.set(t, h); houseN++; }
        if (Array.isArray(o.rows)) for (const r of o.rows) if (Array.isArray(r)) {
          for (const c of r) {
            if (!c || typeof c !== "object") continue;
            const ct = (c.text || "").trim();
            const ch2 = ct && houseOf.get(ct.toLowerCase());
            if (ch2 && ch2 !== ct) { setText(c, ch2); houseChanged.set(ct, ch2); houseN++; }
            if (Array.isArray(c.subs)) for (const sub of c.subs) walk([].concat(...sub));
          }
        }
        for (const k of Object.keys(o)) {
          if (!Array.isArray(o[k])) continue;
          if (["segs", "qseg", "aseg", "seg", "rows", "images"].includes(k)) continue;
          walk(o[k]);
        }
      }
    })(blocks);
  }
  if (houseChanged.size) {
    const says = [...houseChanged].map(([a, b]) => JSON.stringify(a) + " -> " + JSON.stringify(b)).join(", ");
    console.log("   headings set to the house spelling from the " + LEXI.getLang() + " word list: " + says);
  }
  // Which spelling the author really prefers is counted over the WHOLE book, not just
  // over its headings. The Kiikaonde Grade 1 Teacher's Guide writes "Byakuuba bafunda"
  // 62 times in its lesson tables and "Byakuba Bafunda" 17 times as a heading: counting
  // headings alone picked the minority spelling and spread it, making the book less
  // consistent with itself, not more.
  const everyText = [];
  (function walk(arr) {
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      const t = (b.text != null ? b.text : (b.segs || []).map((s) => s.t || "").join("")).trim();
      if (t) everyText.push(t);
      if (Array.isArray(b.rows)) for (const r of b.rows) if (Array.isArray(r)) for (const c of r) {
        if (c && typeof c.text === "string" && c.text.trim()) everyText.push(c.text.trim());
        if (c && Array.isArray(c.subs)) for (const sub of c.subs) walk([].concat(...sub));
      }
      for (const k of Object.keys(b)) if (Array.isArray(b[k]) && k !== "rows" && k !== "segs") walk(b[k]);
    }
  })(blocks);
  const groups = new Map();
  for (const t of everyText) {
    if (t.length < 8 || t.length > 60) continue;
    const k = word(t);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, new Map());
    const g = groups.get(k);
    g.set(t, (g.get(t) || 0) + 1);
  }
  const winner = new Map();
  for (const [k, g] of groups) {
    if (g.size < 2) continue;                                     // no variants to level
    let best = null, bestN = -1;

    for (const [t, n] of g) if (n > bestN || (n === bestN && t.length > best.length)) { best = t; bestN = n; }
    winner.set(k, best);
  }
  if (!winner.size) return houseN;
  let n = 0;
  const changed = new Map();
  for (const b of blocks) {
    if (!isHead(b)) continue;
    const t = b.text.trim();
    const w = winner.get(word(t));
    if (!w || w === t || shape(t) !== shape(w)) continue;
    b.text = w;
    if (b.segs) delete b.segs;
    changed.set(t, w);
    n++;
  }
  if (changed.size) {
    const says = [...changed].map(([a, b]) => JSON.stringify(a) + " -> " + JSON.stringify(b)).join(", ");
    console.log("   headings levelled to the book's own spelling: " + says);
  }
  return n + houseN;
}
module.exports = { unboxPictureOnly, levelHeadingVariants, boxifyActivities, dedupeAdjacentHeadings, fixStrayBodyH1s, stripEditorialComments, clearStrayRed, clearAllInlineColor, boldSafetyAndSteps, normaliseLessonBanners, normaliseUnitHeads, forceUnitThemes, BOX_LABEL_WORD, BOX_LABEL_SMALL, boxLabelOf, isAllCapsLabel, toTitleCaseLabel, uniformBoxLabelCase, keepNumberedSubtopicsOnly };
