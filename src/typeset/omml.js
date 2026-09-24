// Convert Office Math Markup Language (OMML, the <m:…> elements Word stores
// equations in) into Typst math source. The result is fed to Typst's
// eval(str, mode: "math") so every fraction, power, root, subscript, etc. is
// rendered as a real formula instead of flattened text.

// Split an XML fragment into its ordered top-level elements, honouring same-tag
// nesting (so a fraction inside a fraction is kept whole).
function parseEls(xml) {
  const els = [];
  const open = /<(m:[A-Za-z]+|w:[A-Za-z]+)\b([^>]*?)(\/?)>/g;
  let i = 0;
  while (i < xml.length) {
    open.lastIndex = i;
    const m = open.exec(xml);
    if (!m) break;
    const tag = m[1];
    if (m[3] === "/") { els.push({ tag, attrs: m[2], inner: "" }); i = open.lastIndex; continue; }
    const scan = new RegExp(`<${tag}\\b[^>]*?(\\/?)>|</${tag}>`, "g");
    scan.lastIndex = open.lastIndex;
    let depth = 1, mm, closeStart = -1, closeEnd = -1;
    while ((mm = scan.exec(xml))) {
      if (mm[0][1] === "/") { depth--; if (depth === 0) { closeStart = mm.index; closeEnd = scan.lastIndex; break; } }
      else if (mm[1] !== "/") depth++;
    }
    if (closeEnd < 0) break;
    els.push({ tag, attrs: m[2], inner: xml.slice(open.lastIndex, closeStart) });
    i = closeEnd;
  }
  return els;
}

const decode = (s) => (s || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

const attrVal = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}\\b[^>]*m:val="([^"]*)"`)); return m ? m[1] : null; };
const innerOf = (xml, tag) => { const e = parseEls(xml).find((x) => x.tag === tag); return e ? e.inner : ""; };
const hasTag = (xml, tag) => new RegExp(`<${tag}\\b`).test(xml);

// A math accent character -> Typst accent function.
function accentOf(chr) {
  if (!chr) return "hat";
  const c = chr.codePointAt(0);
  if (c === 0x0305 || c === 0x00af || chr === "‾") return "overline"; // bar / macron
  if (c === 0x20d7 || chr === "→" || chr === "⃗") return "arrow";     // vector
  if (c === 0x0307 || chr === "̇") return "dot";
  if (c === 0x0308) return "dot.double";
  if (c === 0x0303 || chr === "~") return "tilde";
  return "hat";
}
function naryOp(chr) {
  if (chr === "∑" || chr == null) return "sum";
  if (chr === "∏") return "product";
  if (chr === "∫") return "integral";
  if (chr === "∬") return "integral.double";
  if (chr === "∮") return "integral.cont";
  if (chr === "⋃") return "union.big";
  if (chr === "⋂") return "sect.big";
  return "sum";
}
const DELIM = { "(": "(", ")": ")", "[": "[", "]": "]", "{": "brace.l", "}": "brace.r", "|": "|", "‖": "bar.v.double", "⟨": "angle.l", "⟩": "angle.r", "": "", "〈": "angle.l", "〉": "angle.r" };
function delim(ch, opening) {
  if (ch == null) return opening ? "(" : ")";
  if (ch === "") return "";
  return DELIM[ch] != null ? DELIM[ch] : ch;
}

// Bracket for a matrix that carries its OWN delimiter (from a wrapping <m:d>).
// `mat`'s default is "(" so a paren needs no override; square/curly brackets do.
// Returns a `delim: …, ` prefix (or "" for the default paren).
function matDelim(beg) {
  if (beg === "[" || beg === "bracket.l") return `delim: "[", `;
  if (beg === "{" || beg === "brace.l") return `delim: "{", `;
  if (beg === "|") return `delim: "|", `;
  return "";
}

// single unicode/ASCII character -> Typst math token
const SYM = {
  "×": " times ", "÷": " div ", "⋅": " dot.op ", "∙": " dot.op ", "·": " dot.op ",
  "−": "-", "–": "-", "≤": " <= ", "≥": " >= ", "≠": " != ", "≈": " approx ", "≅": " tilde.eq ", "≡": " equiv ",
  "±": " plus.minus ", "∓": " minus.plus ", "°": " degree ", "∞": " infinity ", "√": " sqrt ", "∈": " in ", "∉": " in.not ",
  "⊆": " subset.eq ", "⊂": " subset ", "⊇": " supset.eq ", "⊃": " supset ", "∪": " union ", "∩": " sect ", "∅": " nothing ",
  "∀": " forall ", "∃": " exists ", "→": " arrow.r ", "←": " arrow.l ", "↔": " arrow.l.r ", "⇒": " arrow.r.double ", "⇔": " arrow.l.r.double ",
  "∝": " prop ", "∴": " therefore ", "∵": " because ", "…": " dots.h ", "⋯": " dots.h ", "∠": " angle ", "∟": " angle.r ",
  "Δ": " Delta ", "∆": " Delta ", "π": " pi ", "θ": " theta ", "α": " alpha ", "β": " beta ", "γ": " gamma ", "δ": " delta ",
  "μ": " mu ", "λ": " lambda ", "Σ": " sum ", "Ω": " Omega ", "φ": " phi.alt ", "ϕ": " phi ", "ρ": " rho ", "σ": " sigma ",
  "τ": " tau ", "ω": " omega ", "ε": " epsilon ", "∥": " parallel ", "⊥": " perp ", "′": "'", "″": "''", "%": " percent ",
  "#": "\\#", "$": "\\$", "&": "\\&", "_": "\\_", "^": "\\^", "\\": "\\\\", "{": "{", "}": "}",
  // Quote/apostrophe chars that appear literally in an equation's text (e.g. a
  // stray inch mark, or feet/inches) must be emitted as Typst math STRING literals,
  // never a bare `"` — a bare double-quote opens a string in `eval(…, mode:"math")`
  // that never closes ("unclosed string"). Smart quotes map to their glyph string.
  '"': ' "\\"" ', "“": ' "“" ', "”": ' "”" ', "‘": ' "‘" ', "’": ' "’" ',
  // Parentheses/brackets that appear in the TEXT of an equation (coordinates,
  // and sometimes stray/unbalanced ones in sloppily-authored formulas) must be
  // literal symbols so they can never corrupt Typst's structural bracket
  // counting (the STRUCTURAL parentheses come from the converter, not the text).
  "(": " paren.l ", ")": " paren.r ", "[": " bracket.l ", "]": " bracket.r ",
  // invisible math operators (function application / invisible times / separator)
  "⁡": " ", "⁢": " ", "⁣": ", ", "⁤": " ", " ": " ",
};
// multi-letter runs that Typst math already knows (functions / operators) and
// must NOT be split into single letters.
const FUNC = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh",
  "arcsin", "arccos", "arctan", "log", "ln", "exp", "lim", "max", "min", "gcd", "lcm", "det", "mod", "dim", "sup", "inf"]);

// Map the literal text of an <m:t> run to Typst math tokens. A run of 2+ letters
// would be read by Typst as ONE (undefined) identifier — e.g. "mx", "AB", "K500"
// -> "unknown variable" — so split letter runs into single-letter variables
// (keeping known function names whole).
//
// That per-letter split is right for genuinely concatenated symbols ("mgh" = m
// times g times h), which a Word author always types with no space between them
// — but some authors instead type a whole descriptive WORD or PHRASE straight
// into the equation editor as a fraction's label ("Useful Output Energy" over
// "energy input", "distance travelled" over "time taken"). A real multi-word
// phrase is the one case where a SPACE shows up inside a single <m:t> run (an
// author never spaces out multiplied variables within one run), so it's a safe
// tell. Splitting it letter-by-letter anyway doesn't just look ugly — the fix
// destroys the very thing it's meant to preserve: Typst's math-mode spacing
// between adjacent single-letter atoms is the same tight gap the source had one
// space or many, so "Useful Output Energy" came out as the glued, run-together
// "UsefulOutputEnergy". Render a detected phrase as one Typst STRING instead:
// math mode displays a string as plain upright text with its real word-spacing
// intact, and — like any string — it can never be misread as an identifier.
const PHRASE = /^[A-Za-z]+(?:[ \t]+[A-Za-z]+)+/;
function convText(s) {
  s = decode(s);
  if (!s) return "";
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/[A-Za-z]/.test(ch)) {
      const phrase = PHRASE.exec(s.slice(i));
      if (phrase) {
        const words = phrase[0].split(/\s+/);
        if (words.some((w) => w.length >= 2) && !words.some((w) => FUNC.has(w.toLowerCase()))) {
          out += ` "${phrase[0].replace(/\s+/g, " ").trim().replace(/"/g, '\\"')}" `;
          i += phrase[0].length; continue;
        }
      }
      let j = i; while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      const word = s.slice(i, j);
      if (FUNC.has(word.toLowerCase())) out += " " + word.toLowerCase() + " ";
      else out += " " + word.split("").join(" ") + " ";   // "mx" -> "m x"
      i = j; continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i; while (j < s.length && (/[0-9]/.test(s[j]) || (s[j] === "." && /[0-9]/.test(s[j + 1])))) j++;
      out += s.slice(i, j); i = j; continue;
    }
    out += SYM[ch] != null ? SYM[ch] : ch;
    i++;
  }
  return out;
}

// Word does not keep a typed phrase in ONE <m:r>. Whenever the author's formatting
// changes mid-phrase — and it always does, because Word emits each inter-word space
// as its own upright <m:sty m:val="p"> run between italic word runs — "Useful Output
// Energy" arrives as five sibling runs: "Useful", " ", "Output", " ", "Energy". No
// single <m:t> then contains a space, so convText's phrase detection never fires, each
// word is split into single-letter italic identifiers, and the lone space runs vanish
// (Typst math ignores literal whitespace between atoms). The result is the glued
// "UsefulOutputEnergy" / "energyinput" reviewers keep flagging on efficiency, density
// and speed formulae. Join adjacent run siblings back into one before converting, so
// the phrase is seen whole and rendered as an upright string with real word spacing.
function mergeRuns(els) {
  const out = [];
  for (const el of els) {
    if (el.tag === "m:r") {
      const mt = el.inner.match(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/);
      const txt = mt ? mt[1] : "";
      const prev = out[out.length - 1];
      if (prev && prev.tag === "m:rtext") { prev.text += txt; continue; }
      out.push({ tag: "m:rtext", text: txt });
      continue;
    }
    out.push(el);
  }
  return out;
}
function conv(xml) {
  return mergeRuns(parseEls(xml)).map(convEl).filter(Boolean).join(" ");
}
// converted inner of a child tag, trimmed and never empty (Typst calls like
// frac()/^()/root() error on a blank argument, so fall back to empty text "").
const C = (xml, tag) => conv(innerOf(xml, tag)).trim() || '""';

// The base of a subscript/superscript used to be UNCONDITIONALLY wrapped in
// "(...)" before the "_(...)"/"^(...)". That's only correct grouping syntax
// immediately AFTER the "_"/"^" (Typst's special invisible argument-grouping
// parens); parens placed BEFORE it, around the base itself, are just an
// ordinary parenthesized math atom, and Typst renders those literally — so
// "V" (a single already-unambiguous token) turned into a visibly parenthesised
// "(V)" with the subscript sitting outside it, e.g. Charles'/Gay-Lussac's law
// rendering as "(V)₁" instead of "V₁". A single token never needs grouping at
// all; only wrap when the base is itself a multi-token expression (e.g. an
// "a+b" that must stay together under the sub/superscript) — and there the
// visible parens are exactly what standard notation shows anyway.
function wrapBase(expr) {
  const e = (expr || "").trim();
  return e && !/\s/.test(e) ? e : `(${e})`;
}

function convEl(el) {
  const t = el.tag;
  switch (t) {
    case "m:oMathPara": case "m:oMath": case "m:e": case "m:num": case "m:den":
    case "m:sup": case "m:sub": case "m:deg": case "m:lim": case "m:box": case "m:limLow": case "m:limUpp":
      return conv(el.inner);
    case "m:rtext": return convText(el.text);   // one or more adjacent <m:r> joined by mergeRuns
    case "m:r": {
      const mt = el.inner.match(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/);
      return mt ? convText(mt[1]) : "";
    }
    case "m:f": {
      const num = C(el.inner, "m:num"), den = C(el.inner, "m:den");
      const ty = attrVal(el.inner, "m:type");
      // "noBar" is Word's column vector / stacked pair (no fraction bar); the
      // enclosing delimiter supplies the parentheses.
      if (ty === "noBar") return `mat(delim: #none, ${num}; ${den})`;
      if (ty === "lin") return `(${num}) \\/ (${den})`;
      return `frac(${num}, ${den})`;
    }
    case "m:sSup": return `${wrapBase(C(el.inner, "m:e"))}^(${C(el.inner, "m:sup")})`;
    case "m:sSub": return `${wrapBase(C(el.inner, "m:e"))}_(${C(el.inner, "m:sub")})`;
    case "m:sSubSup": return `${wrapBase(C(el.inner, "m:e"))}_(${C(el.inner, "m:sub")})^(${C(el.inner, "m:sup")})`;
    case "m:sPre": return `""_(${C(el.inner, "m:sub")})^(${C(el.inner, "m:sup")}) ${wrapBase(C(el.inner, "m:e"))}`;
    case "m:rad": {
      const e = C(el.inner, "m:e");
      const degXml = innerOf(el.inner, "m:deg");
      const hide = attrVal(el.inner, "m:degHide") === "1" || !conv(degXml).trim();
      return hide ? `sqrt(${e})` : `root(${C(el.inner, "m:deg")}, ${e})`;
    }
    case "m:d": {
      const beg = delim(attrVal(el.inner, "m:begChr"), true);
      const end = delim(attrVal(el.inner, "m:endChr"), false);
      const eEls = parseEls(el.inner).filter((x) => x.tag === "m:e");
      // A delimiter wrapping a SINGLE matrix: the delimiter's brackets ARE the
      // matrix brackets. `mat(…)` already draws its own delimiters (default "("),
      // so wrapping it in `lr( ( … ) )` would double them up — e.g. `((1,2;3,4))`.
      // Render the matrix with the delimiter's bracket instead of nesting.
      if (eEls.length === 1) {
        const kids = parseEls(eEls[0].inner).filter((x) => x.tag.startsWith("m:") && !/Pr$/.test(x.tag));
        if (kids.length === 1 && kids[0].tag === "m:m") {
          const rows = parseEls(kids[0].inner).filter((r) => r.tag === "m:mr")
            .map((r) => parseEls(r.inner).filter((c) => c.tag === "m:e").map((c) => conv(c.inner).trim() || '""').join(", "));
          return `mat(${matDelim(beg)}${rows.join("; ")})`;
        }
      }
      const body = eEls.map((x) => conv(x.inner)).join(", ");
      if ((beg === "|" || beg === "||") && end === beg) return `${beg === "||" ? "norm" : "abs"}(${body})`;
      return `lr(${beg || "("} ${body} ${end || ")"})`;
    }
    case "m:func": {
      const fn = conv(innerOf(el.inner, "m:fName")).trim();
      return `${fn} (${C(el.inner, "m:e")})`;
    }
    case "m:nary": {
      const chr = attrVal(el.inner, "m:chr");
      const op = naryOp(chr);
      const sub = conv(innerOf(el.inner, "m:sub")).trim(), sup = conv(innerOf(el.inner, "m:sup")).trim(), e = conv(innerOf(el.inner, "m:e")).trim();
      let s = op;
      if (sub) s += `_(${sub})`;
      if (sup) s += `^(${sup})`;
      return `${s} ${e}`;
    }
    case "m:acc": {
      const fn = accentOf(attrVal(el.inner, "m:chr"));
      return `${fn}(${C(el.inner, "m:e")})`;
    }
    case "m:bar": return `overline(${C(el.inner, "m:e")})`;
    case "m:groupChr": return conv(innerOf(el.inner, "m:e"));
    case "m:eqArr": {
      // a stack of rows: a column vector (when wrapped in a delimiter) or a
      // multi-line/aligned equation. A bare-delimiter matrix stacks them cleanly.
      const rows = parseEls(el.inner).filter((x) => x.tag === "m:e").map((x) => conv(x.inner).trim() || '""');
      return `mat(delim: #none, ${rows.join("; ")})`;
    }
    case "m:m": {
      const rows = parseEls(el.inner).filter((x) => x.tag === "m:mr")
        .map((r) => parseEls(r.inner).filter((c) => c.tag === "m:e").map((c) => conv(c.inner).trim() || '""').join(", "));
      return `mat(${rows.join("; ")})`;
    }
    default:
      return t.startsWith("m:") && !/Pr$/.test(t) ? conv(el.inner) : "";
  }
}

// The manuscripts write an angle's degree symbol as a superscript "0" (zero) or
// a small circle "∘", usually wrapping the number in brackets: (90)^(0), (30)^(∘).
// Typeset verbatim that reads as "900" / "(90)∘". The author asked for a proper
// degree sign with the brackets dropped, so normalise a parenthesised number
// raised to 0 / ∘ into "<n>°". Only bare numbers qualify — real exponents such as
// (x)^(2) or inverse marks like (sin)^(-1) are left untouched.
function normalizeDegrees(t) {
  return t.replace(/\(\s*(\d+(?:\.\d+)?)\s*\)\s*\^\(\s*(?:∘|0)\s*\)/g, "$1 degree");
}

// Public: convert one <m:oMath>/<m:oMathPara> fragment to a Typst math string.
function ommlToTypst(xml) {
  return normalizeDegrees(conv(xml).replace(/\s+/g, " ").trim());
}

module.exports = { ommlToTypst, convText };
