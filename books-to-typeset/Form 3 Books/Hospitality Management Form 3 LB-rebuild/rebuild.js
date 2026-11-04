// Rebuild the Hospitality Management F3 LB (a typeset PDF converted back to Word)
// into a plain, linear manuscript the engine reads: drawn boxes -> one-cell tables,
// banners -> headings, page furniture dropped, page-split paragraphs rejoined.
//
// Book-specific, not engine: the editor returned the corrected Learner's Book as the
// earlier typeset PDF converted to Word (131 sections, every box a floating drawing
// group, running heads and page numbers as text boxes). Every word, correction and
// picture is kept; what this script changes beyond structure is logged and listed in
// the book's overrides.json "//source" note.
//
// usage (from the repo root):
//   node "books-to-typeset/Form 3 Books/Hospitality Management Form 3 LB-rebuild/rebuild.js" \
//     "books-to-typeset/Form 3 Books/HOSPITALITY MANAGEMENT FORM 3 LB TYPESET EDITED COPYl.docx" \
//     "books-to-typeset/Form 3 Books/Hospitality Management Form 3 LB.docx" <dump-dir>
const JSZip = require(require.resolve('jszip', { paths: [process.cwd()] })), fs = require('fs');
const [inp, outp, dumpdir] = process.argv.slice(2);

const LABEL = /^(LEARNING\s*ACTIVITY\s*\d+\s*:?|EXERCISE\s*\d+\s*:?|END OF TOPIC ASSESSMENT)$/i;
const FURNITURE = /^(Hospitality Management - Form \d - Learner’s Book|Topic \d+[.:] .{3,40})$/;
const FRONT = { 'TABLE OF CONTENTS': 1, 'ACRONYMS': 1, 'AUTHOR’S BIOGRAPHY': 1, 'FOREWORD': 1, 'PREFACE': 1, 'ACKNOWLEDGEMENT': 1, 'INTRODUCTION': 1, 'GLOSSARY': 1, 'REFERENCES': 1, 'REFERENCE': 1 };

const noFallback = (s) => s.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
const textOf = (s) => noFallback(s).replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const paraText = (p) => textOf(p.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, '').replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, ''));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// split a run of XML into top-level elements of the given tags
function splitTop(xml, tags) {
  const out = []; const re = new RegExp('<(' + tags.join('|') + ')[ >]', 'g'); let i = 0;
  while (true) {
    re.lastIndex = i; const m = re.exec(xml); if (!m) break;
    const tag = m[1]; const ro = new RegExp('<' + tag + '[ >/]|</' + tag + '>', 'g'); ro.lastIndex = m.index; let d = 0, j = -1, mm;
    while ((mm = ro.exec(xml))) { if (mm[0][1] === '/') d--; else d++; if (d === 0) { j = ro.lastIndex; break; } }
    out.push({ tag, xml: xml.slice(m.index, j) }); i = j;
  }
  return out;
}

// clean a paragraph: no section breaks, highlights, drawings, frames, page breaks
function cleanP(p) {
  if (/<wp:docPr id="5\d{3}" name="Picture /.test(p)) return p; // a picture paragraph this script built
  return p.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '')
    .replace(/<w:highlight [^>]*\/>/g, '')
    .replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>[\s\S]*?<\/w:r>/g, '')
    .replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:r>/g, '')
    .replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:pict>[\s\S]*?<\/w:pict>[\s\S]*?<\/w:r>/g, '')
    .replace(/<w:framePr[^>]*\/>/g, '').replace(/<w:lastRenderedPageBreak\/>/g, '').replace(/<w:br w:type="page"\/>/g, '');
}
const mkP = (text, style, bold) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
function imgP(pic) {
  const ext = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  const id = 5000 + (imgP.n = (imgP.n || 0) + 1);
  const picx = pic.includes('xmlns:pic') ? pic : pic.replace('<pic:pic', '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"');
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${ext[1]}" cy="${ext[2]}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">${picx}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// what a drawing holds: text boxes (with y) and pictures, in reading order
function drawingParts(d) {
  const parts = [];
  for (const w of splitTop(d, ['wps:wsp', 'pic:pic'])) {
    const y = +((w.xml.match(/<a:off x="-?\d+" y="(-?\d+)"/) || [])[1] || 0);
    if (w.tag === 'pic:pic') { parts.push({ k: 'pic', y, xml: w.xml }); continue; }
    const tb = w.xml.match(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/);
    if (!tb) continue;
    const paras = splitTop(tb[1], ['w:p', 'w:tbl']).map((e) => e.xml);
    const text = textOf(tb[1]);
    if (text) parts.push({ k: 'tb', y, paras, text });
  }
  parts.sort((a, b) => a.y - b.y);
  return parts;
}

(async () => {
  const z = await JSZip.loadAsync(fs.readFileSync(inp));
  const doc = await z.file('word/document.xml').async('string');
  const bStart = doc.indexOf('<w:body>') + 8, bEnd = doc.lastIndexOf('<w:sectPr');
  const lastSect = doc.slice(bEnd, doc.lastIndexOf('</w:body>'));
  const els = splitTop(doc.slice(bStart, bEnd), ['w:p', 'w:tbl']);

  const out = []; // {k:'p'|'tbl'|'box'|'h1'|'h2'|'img', ...}
  const log = [];
  let pendingTopic = null, inFront = true;
  const lastReal = () => out[out.length - 1];

  // Face Mapping (Sub-Topic 3.4.2): four paragraphs typeset beside their pictures; the
  // conversion cut each sentence around its picture and glued the caption into the text.
  // Rebuilt as text -> picture -> caption, the words as given (plus missing full stops).
  const lead = (l, rest) => `<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(l)}</w:t></w:r><w:r><w:t xml:space="preserve">${esc(rest)}</w:t></w:r></w:p>`;
  const picOf = (k) => { const m = noFallback(els[k].xml).match(/<pic:pic[\s\S]*?<\/pic:pic>/); return m ? imgP(m[0]) : ''; };
  const faceAt = els.findIndex((e) => /Eyes: Use eyeshadow/.test(textOf(e.xml)));
  const FACE = faceAt < 0 ? null : {
    from: faceAt, to: faceAt + 9,
    blocks: [
      { k: 'p', xml: lead('Eyes: ', 'Use eyeshadow to add depth and dimension: apply lighter shades on the lid, darker shades in the crease. Line eyes with eyeliner to define shape and create illusion of bigger eyes. Mascara lengthens and volumises lashes, making eyes look bigger and more prominent. Use highlighter on the brow bone to make eyes appear more lifted.'), text: 'Eyes:', style: 'BodyText' },
      { k: 'img', xml: picOf(faceAt) },
      { k: 'p', xml: mkP('Figure 6: Illustration of enhanced eyes', 'BodyText'), text: 'Figure 6: Illustration of enhanced eyes.', style: 'BodyText' },
      { k: 'p', xml: lead('Nose: ', 'Contouring with bronzer or contour powder can slim or straighten the nose. Highlighting the bridge of the nose can make it appear more defined and straighter.'), text: 'Nose:', style: 'BodyText' },
      { k: 'img', xml: picOf(faceAt + 2) },
      { k: 'p', xml: mkP('Figure 7. Illustration of enhanced nose', 'BodyText'), text: 'Figure 7.', style: 'BodyText' },
      { k: 'p', xml: lead('Cheekbones: ', 'Apply blush to the apples of the cheeks to add colour and create a healthy glow. Contouring with bronzer or contour powder can define cheekbones and create a slimmer face shape. Highlighting the tops of cheekbones can make them appear more prominent.'), text: 'Cheekbones:', style: 'BodyText' },
      { k: 'img', xml: picOf(faceAt + 6) },
      { k: 'p', xml: mkP('Figure 8. Illustration of enhanced cheekbones', 'BodyText'), text: 'Figure 8.', style: 'BodyText' },
      { k: 'p', xml: lead('Lips: ', 'Line lips with lip liner to define shape and prevent feathering. Use lipstick or gloss to add colour and moisture. Highlight the cupid’s bow (centre of the top lip) to make lips appear fuller.'), text: 'Lips:', style: 'BodyText' },
      { k: 'img', xml: picOf(faceAt + 8) },
      { k: 'p', xml: mkP('Figure 9. Illustration of enhanced lips. (Picture courtesy of Annie Chikonde)', 'BodyText'), text: 'Figure 9.', style: 'BodyText' },
    ],
  };
  if (FACE && !/Illustartion of enhanced lips/.test(textOf(els[faceAt + 9].xml))) throw new Error('face-mapping block moved: check FACE indices');

  for (let ei = 0; ei < els.length; ei++) {
    if (FACE && ei === FACE.from) { out.push(...FACE.blocks); ei = FACE.to; log.push('face-mapping block rebuilt'); continue; }
    const e = els[ei];
    if (e.tag === 'w:tbl') { out.push({ k: 'tbl', xml: e.xml.replace(/<w:highlight [^>]*\/>/g, '') }); continue; }
    const p = noFallback(e.xml);
    const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    const drawings = p.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) || [];
    const own = paraText(p);
    // ---- drawings first, in their true top-to-bottom order on the old page
    const parts = [];
    for (const [di, d] of drawings.entries()) {
      const anchored = /<wp:anchor/.test(d);
      const base = anchored ? +((d.match(/<wp:positionV[^>]*>\s*<wp:posOffset>(-?\d+)/) || [])[1] || 0) : -1e8;
      for (const q of drawingParts(d)) parts.push({ ...q, di, ay: base + q.y });
    }
    parts.sort((a, b) => a.ay - b.ay);
    let cur = null;
    for (const t of parts) {
      if (t.k === 'pic') {
        if (cur && cur.di === t.di) cur.paras.push(imgP(t.xml));
        else out.push({ k: 'img', xml: imgP(t.xml) });
        continue;
      }
      const tt = t.text.replace(/\s+/g, ' ').trim();
      if (FURNITURE.test(tt) || /^\d+$/.test(tt)) continue;
      if (FRONT[tt.toUpperCase()] !== undefined) { if (tt === tt.toUpperCase()) out.push({ k: 'h1', text: tt === 'REFERENCE' ? 'REFERENCES' : tt }); cur = null; continue; }
      if (/^TOPIC \d+:?$/.test(tt)) { pendingTopic = tt.replace(/:?$/, ':'); cur = null; continue; }
      if (/^Sub[- ]Topic\b/i.test(tt)) { out.push({ k: 'h2', text: tt }); cur = null; continue; }
      if (/^LEARNER’S BOOK$/.test(tt)) continue;
      if (/^© Zambia Educational Publishing House/.test(tt)) { out.push({ k: 'p', xml: mkP(tt, 'BodyText'), text: tt, style: 'BodyText' }); continue; }
      if (LABEL.test(tt)) { cur = { k: 'box', label: tt, paras: [], src: ei, di: t.di }; out.push(cur); continue; }
      if (cur) { cur.paras.push(...t.paras); continue; }
      // the box ran on below its own picture: the picture goes inside the box
      if (out.length > 1 && lastReal().k === 'img' && out[out.length - 2].k === 'box') { const im = out.pop(); lastReal().paras.push(im.xml); log.push(`[${ei}] picture moved into box "${lastReal().label}"`); }
      const prev = lastReal();
      if (prev && prev.k === 'box') { prev.paras.push(...t.paras); cur = prev; cur.di = t.di; log.push(`[${ei}] continuation appended to box "${prev.label}": ${tt.slice(0, 70)}`); }
      else { cur = { k: 'box', label: '', paras: [...t.paras], src: ei, di: t.di }; out.push(cur); log.push(`[${ei}] UNLABELLED box: ${tt.slice(0, 90)}`); }
    }
    // a label with no body of its own (END OF TOPIC ASSESSMENT) is a heading line
    for (let k = out.length - 1; k >= 0 && out[k].src === ei; k--) if (out[k].k === 'box' && !out[k].paras.length && /^END OF TOPIC/i.test(out[k].label)) out[k] = { k: 'p', xml: mkP('END OF TOPIC ASSESSMENT', '', true), text: 'END OF TOPIC ASSESSMENT', style: '' };
    // ---- the paragraph's own text
    if (!own) continue;
    if (FURNITURE.test(own)) continue;
    if (style === 'Heading1') {
      if (pendingTopic) { out.push({ k: 'h1', text: `${pendingTopic} ${own}` }); pendingTopic = null; inFront = false; }
      else out.push({ k: 'h1', text: own });
      continue;
    }
    // a box's border carried over to the next page as a bare shape: the list lines under
    // it are the rest of that box
    if (drawings.length && !parts.length && style === 'ListParagraph' && lastReal() && lastReal().k === 'box') {
      const box = lastReal(); let j = ei; let n = 0;
      for (; j < els.length; j++) {
        const q = noFallback(els[j].xml); const st = (q.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
        const qt = paraText(q);
        if (els[j].tag === 'w:tbl' || st === 'BodyText' && qt || /Heading/.test(st)) break;
        if (!qt) continue;
        const prevT = box.paras.length ? textOf(box.paras[box.paras.length - 1]) : '';
        if (qt === prevT) { log.push(`[${j}] duplicate line dropped: ${qt.slice(0, 70)}`); continue; }
        box.paras.push(cleanP(els[j].xml)); n++;
      }
      log.push(`[${ei}] ${n} lines under a carried-over border added to box "${box.label}"`);
      ei = j - 1; continue;
    }
    if (style === 'Heading2' && /^LEARNING ACTIVITY/i.test(own)) {
      // a box typed as loose paragraphs: take the following unstyled/list lines
      const box = { k: 'box', label: own, paras: [], src: ei, loose: true };
      let j = ei + 1;
      for (; j < els.length; j++) {
        const q = noFallback(els[j].xml); const st = (q.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
        const qt = paraText(q);
        if (els[j].tag === 'w:tbl') { box.paras.push(els[j].xml.replace(/<w:highlight [^>]*\/>/g, '')); continue; }
        if (!qt) { if ((q.match(/<w:drawing>/g) || []).length) { const tb = []; for (const d of q.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g)) tb.push(...drawingParts(d)); if (tb.some((t) => t.k === 'tb' && !FURNITURE.test(t.text))) break; } continue; }
        if (FURNITURE.test(qt)) continue;
        if (st === 'BodyText' || st === 'Heading1' || st === 'Heading2') break;
        box.paras.push(cleanP(els[j].xml));
      }
      log.push(`[${ei}] loose activity "${own}" took ${box.paras.length} paragraphs, stopped at [${j}] "${paraText(noFallback(els[j] ? els[j].xml : '')).slice(0, 60)}"`);
      out.push(box); ei = j - 1; continue;
    }
    out.push({ k: 'p', xml: cleanP(e.xml), text: own, style });
  }

  // ---- rejoin paragraphs a line or page break of the old layout split in two
  const styleOfX = (x) => (x.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
  const canJoin = (px, ptext, nx, ntext) => /^[a-z]/.test(ntext) && !/^[a-z][).]/.test(ntext) && !/[.:?!;)]$/.test(ptext) && !/^Fig(ure)?\.?\s*\d/i.test(ptext)
    && !/Heading/.test(styleOfX(px)) && !/Heading/.test(styleOfX(nx)) && !/<w:numPr>/.test(nx)
    && !/<w:drawing>/.test(px) && !/<w:drawing>/.test(nx) && !/^<w:tbl/.test(px) && !/^<w:tbl/.test(nx);
  const glue = (px, nx) => {
    const runs = nx.replace(/^[\s\S]*?(?:<\/w:pPr>|<w:p\b[^>]*>)/, '').replace(/<\/w:p>$/, '');
    return px.replace(/<\/w:p>$/, (/-$/.test(textOf(px)) ? '' : '<w:r><w:t xml:space="preserve"> </w:t></w:r>') + runs + '</w:p>');
  };
  const res = [];
  for (const b of out) {
    const prev = res[res.length - 1];
    if (b.k === 'p' && prev && prev.k === 'p' && canJoin(prev.xml, prev.text, b.xml, b.text)) {
      log.push(`joined: "…${prev.text.slice(-40)}" + "${b.text.slice(0, 40)}…"`);
      prev.xml = glue(prev.xml, b.xml); prev.text += ' ' + b.text; continue;
    }
    res.push(b);
  }
  for (const b of res) if (b.k === 'box') {
    const ps = [];
    for (const x of b.paras.map(cleanP)) {
      const prev = ps[ps.length - 1];
      if (prev && !(ps.length === 1 && /^LEARNING/i.test(b.label)) && canJoin(prev, textOf(prev), x, textOf(x))) { log.push(`box-joined: "…${textOf(prev).slice(-40)}" + "${textOf(x).slice(0, 40)}…"`); ps[ps.length - 1] = glue(prev, x); }
      else ps.push(x);
    }
    b.paras = ps;
  }
  // ---- spots where the old layout's floating shapes put things out of reading order
  const find = (re) => res.findIndex((b) => b.k === 'p' && re.test(b.text || ''));
  const moveAfter = (what, after) => {
    const i = find(what); if (i < 0) { log.push(`PATCH MISSED: ${what}`); return; }
    const [b] = res.splice(i, 1); const j = find(after); if (j < 0) { res.splice(i, 0, b); log.push(`PATCH MISSED: ${after}`); return; }
    res.splice(j + 1, 0, b); log.push(`moved "${b.text.slice(0, 50)}" after "${res[j].text.slice(0, 50)}"`);
  };
  moveAfter(/^Organisational Barriers:/, /^Psychological Barriers:/);
  const isCap = (b) => b && b.k === 'p' && /^Fig(ure)?\.?\s*\d/i.test(b.text || '');
  for (let i = 0; i < res.length; i++) {
    // a caption split over two lines: "(Picture" / "curtsy of …)"
    if (isCap(res[i]) && res[i + 1] && res[i + 1].k === 'p' && /\([^)]*$/.test(res[i].text) && /^[a-z]/.test(res[i + 1].text)) {
      res[i].xml = glue(res[i].xml, res[i + 1].xml); res[i].text += ' ' + res[i + 1].text; res.splice(i + 1, 1); log.push(`caption rejoined: ${res[i].text}`);
    }
  }
  for (let i = 2; i < res.length; i++) {
    // picture, [caption], then the rest of the sentence the picture interrupted
    const b = res[i]; if (b.k !== 'p' || !/^[a-z]/.test(b.text)) continue;
    let k = i - 1; if (isCap(res[k])) k--; if (!res[k] || res[k].k !== 'img') continue;
    const p = res[k - 1]; if (!p || p.k !== 'p' || /[.:?!;)]$/.test(p.text) || isCap(p)) continue;
    p.xml = glue(p.xml, b.xml); log.push(`rejoined across picture: "…${p.text.slice(-30)}" + "${b.text.slice(0, 30)}…"`); p.text += ' ' + b.text; res.splice(i, 1); i--;
  }
  for (let i = 2; i < res.length; i++) {
    // a caption that drifted one paragraph below its picture
    if (isCap(res[i]) && res[i - 1].k === 'p' && !isCap(res[i - 1]) && res[i - 2].k === 'img') { const [c] = res.splice(i, 1); res.splice(i - 1, 0, c); log.push(`caption moved up to its picture: ${c.text.slice(0, 40)}`); }
  }
  // the sentence that introduces the competences table goes with the table's heading
  {
    const s = find(/^To help you clearly understand the knowledge, skills and values/);
    const h = find(/^KEY COMPETENCES TO BE DEVELOPED$/i);
    if (s >= 0 && h === s + 1) { const [hb] = res.splice(h, 1); res.splice(s, 0, hb); log.push('competences heading put above its lead-in sentence'); }
  }
  // the food safety plan template is the "guide below" of its activity
  {
    const bx = res.findIndex((b) => b.k === 'box' && b.paras.length && /Implementing a food safety plan/.test(textOf(b.paras[0])));
    const tb = res.findIndex((b, i) => i > bx && i < bx + 4 && b.k === 'tbl' && /^Food safety area/.test(textOf(b.xml)));
    if (bx >= 0 && tb >= 0) { const [t] = res.splice(tb, 1); res[bx].paras.push(t.xml); log.push('food safety plan template moved into its activity box'); }
    else log.push('PATCH MISSED: food safety plan table');
  }
  // table captions: "Table 2" ran on at the end of the sentence before its table, and
  // Table 3's caption sat below its table — both set as captions ABOVE, like Table 1
  {
    const a = find(/consumer protection bodies in Zambia\. Table 2 Consumer protection bodies$/);
    if (a >= 0) {
      res.splice(a, 1, { k: 'p', xml: mkP('The following table outlines the consumer protection bodies in Zambia.', 'BodyText'), text: 'The following table outlines the consumer protection bodies in Zambia.', style: 'BodyText' },
        { k: 'p', xml: mkP('Table 2: Consumer protection bodies', ''), text: 'Table 2: Consumer protection bodies', style: '' });
      log.push('Table 2 caption set apart from its lead-in sentence');
    } else log.push('PATCH MISSED: Table 2 caption');
    const c = find(/^Table 3 Business Pan template$/);
    if (c >= 0 && res[c - 1].k === 'tbl') {
      res.splice(c, 1); res.splice(c - 1, 0, { k: 'p', xml: mkP('Table 3: Business Plan template', ''), text: 'Table 3: Business Plan template', style: '' });
      log.push('Table 3 caption moved above its table, "Pan" -> "Plan"');
    } else log.push('PATCH MISSED: Table 3 caption');
  }
  // Topic 6 numbers its exercises 1, 2, 2: the last (Sub-Topic 3.6.3) is Exercise 3
  {
    const h = res.findIndex((b) => b.k === 'h2' && /3\.6\.3/.test(b.text));
    const e = res.findIndex((b, i) => i > h && b.k === 'box' && /^EXERCISE 2$/.test(b.label));
    const nextH1 = res.findIndex((b, i) => i > h && b.k === 'h1');
    if (h >= 0 && e >= 0 && e < nextH1) { res[e].label = 'EXERCISE 3'; log.push('Topic 6, Sub-Topic 3.6.3: second "EXERCISE 2" renumbered 3'); }
    else log.push('PATCH MISSED: Topic 6 exercise number');
  }
  // "Business Adventure" for "Business Venture" (Sub-Topic 3.8.1 heading, printed page
  // 133): the heading's words sit in separate runs, so it is set whole here (user, 19 Oct 2026)
  {
    const v = find(/^How to Nurture a Business Adventure$/);
    if (v >= 0) { res[v].xml = mkP('How to Nurture a Business Venture', res[v].style); res[v].text = 'How to Nurture a Business Venture'; log.push('heading fixed: Business Adventure -> Business Venture'); }
    else log.push('PATCH MISSED: Business Adventure heading');
  }
  // the Customer Profile Template's form line: tab gaps that printed as a stray "_";
  // writing lines instead, as a form to fill in
  for (const b of res) if (b.k === 'box') for (let i = 0; i < b.paras.length; i++) {
    if (/^Hospitality Facility:\s*Date:\s*$/.test(textOf(b.paras[i]))) {
      b.paras[i] = mkP('Hospitality Facility: ________________________   Date: ______________', '');
      log.push('profile template form line given writing lines');
    }
  }
  // "Offer Solutions" (steps in handling complaints): its text carries stray italic and
  // bold-italic punctuation runs; set like its four siblings (bold term, plain text)
  {
    const i = res.findIndex((b) => b.k === 'p' && /^Offer Solutions\s*:/.test(b.text || ''));
    if (i >= 0) {
      const rest = res[i].text.replace(/^Offer Solutions\s*:\s*/, '');
      res[i] = { k: 'p', xml: lead('Offer Solutions:', ' ' + rest), text: 'Offer Solutions: ' + rest, style: res[i].style };
      log.push('"Offer Solutions" set like its siblings');
    } else log.push('PATCH MISSED: Offer Solutions');
  }
  // "Social Media Platforms": Facebook and TikTok were italic, Twitter and Instagram not;
  // brand names in roman, all four alike
  {
    const i = res.findIndex((b) => b.k === 'p' && /^Social Media Platforms/.test(b.text || ''));
    if (i >= 0) { res[i].xml = res[i].xml.replace(/<w:i\/>|<w:iCs\/>/g, ''); log.push('platform names set in roman'); }
    else log.push('PATCH MISSED: Social Media Platforms');
  }
  // two acronyms typed on one line
  {
    const a = find(/^USP – Unique Selling Proposition VIP – Very Important Person$/);
    if (a >= 0) { res.splice(a, 1, { k: 'p', xml: lead('USP', ' – Unique Selling Proposition'), text: 'USP', style: 'BodyText' }, { k: 'p', xml: lead('VIP', ' – Very Important Person'), text: 'VIP', style: 'BodyText' }); log.push('USP / VIP split onto two lines'); }
    else log.push('PATCH MISSED: USP/VIP');
  }
  for (const b of res) if (b.k === 'p' && /^END OF TOPIC ASSESSEMENT$/.test(b.text)) {
    b.xml = b.xml.replace(/ASSESSEMENT/g, 'ASSESSMENT'); log.push('heading fixed: END OF TOPIC ASSESSEMENT -> ASSESSMENT');
    if (!/ASSESSMENT/.test(textOf(b.xml))) { b.xml = mkP('END OF TOPIC ASSESSMENT', b.style); }
    b.text = 'END OF TOPIC ASSESSMENT';
  }
  for (const b of res) if (b.k === 'h2') {
    const t0 = b.text;
    b.text = b.text.replace(/Heath Hazards/, 'Health Hazards').replace(/Conflicts Resolution/, 'Conflict Resolution');
    if (b.text !== t0) log.push(`heading fixed: ${t0} -> ${b.text}`);
  }
  // Figure 15's caption and the next paragraph were typed as ONE paragraph in the edited
  // copy ("…support business growth.Operational Excellence: Operational efficiency…"),
  // so the body text printed inside the caption. Split at the join.
  {
    const f = res.findIndex((b) => b.k === 'p' && /^Figure 15:.*growth\.Operational Excellence:/.test(b.text || ''));
    if (f >= 0) {
      const t = res[f].text, at = t.indexOf('Operational Excellence:');
      const cap = t.slice(0, at).trim(), body = t.slice(at + 'Operational Excellence:'.length).trim();
      res.splice(f, 1, { k: 'p', xml: mkP(cap, 'BodyText'), text: cap, style: 'BodyText' },
        { k: 'p', xml: lead('Operational Excellence:', ' ' + body), text: 'Operational Excellence: ' + body, style: 'BodyText' });
      log.push('Figure 15 caption split from the "Operational Excellence" paragraph');
    } else log.push('PATCH MISSED: Figure 15 caption split');
  }
  // End of Topic 3 Assessment, question 8: the editor typed its three parts in ONE
  // paragraph ("i. Explain … ii. Explain … iii. The hotel …"); one item per part, with
  // her own roman markers (the book's `romanSubParts` keeps them roman).
  {
    const q = res.findIndex((b) => b.k === 'p' && /^i\. Explain how you would personalise the service/.test(b.text || ''));
    if (q >= 0) {
      const parts = res[q].text.split(/\s+(?=(?:ii|iii)\.\s)/);
      res.splice(q, 1, ...parts.map((t) => ({ k: 'p', xml: mkP(t.trim(), 'ListParagraph'), text: t.trim(), style: 'ListParagraph' })));
      log.push(`Topic 3 assessment Q8 split into ${parts.length} parts`);
    } else log.push('PATCH MISSED: Topic 3 assessment Q8 parts');
  }
  // Topic 1 assessment, question 6: "a) Identify two risks … food.b) Recommend …" typed
  // as one line; one item per part.
  {
    const q = res.findIndex((b) => b.k === 'p' && /^a\) Identify two risks associated with allowing the co-worker/.test(b.text || ''));
    if (q >= 0) {
      const parts = res[q].text.split(/(?<=\.)\s*(?=b\)\s)/);
      res.splice(q, 1, ...parts.map((t) => ({ k: 'p', xml: mkP(t.trim(), 'ListParagraph'), text: t.trim(), style: 'ListParagraph' })));
      log.push(`Topic 1 assessment Q6 split into ${parts.length} parts`);
    } else log.push('PATCH MISSED: Topic 1 assessment Q6 parts');
  }
  // ---- headings: one form for one heading, book-wide (consistency pass, 19 Oct 2026) ----
  // Topics 1-2 head their opening section "INTRODUCTION", Topics 3-8 "Introduction"; the
  // majority Title Case wins, as for every other sub-heading. Likewise "Specific
  // competence" (once) beside "Specific Competence", and the stray capital in
  // "Highlights For a Face".
  for (const b of res) if (b.k === 'p' && /Heading/.test(b.style || '')) {
    const t0 = b.text;
    let t = t0.replace(/^INTRODUCTION$/, 'Introduction').replace(/^Specific competence$/, 'Specific Competence').replace(/^Highlights For a Face$/, 'Highlights for a Face');
    if (t !== t0) { b.xml = mkP(t, b.style); b.text = t; log.push(`heading: "${t0}" -> "${t}"`); }
  }
  // a sentence that introduces a table was styled as a heading; set it as body text,
  // like the book's other table lead-ins ("The following table outlines …")
  {
    const i = res.findIndex((b) => b.k === 'p' && /^The table below shows communication strategies in conflict situation$/.test(b.text || ''));
    if (i >= 0) { const t = res[i].text + '.'; res[i] = { k: 'p', xml: mkP(t, 'BodyText'), text: t, style: 'BodyText' }; log.push('table lead-in set as body text'); }
    else log.push('PATCH MISSED: table lead-in heading');
  }
  // Learning Activity titles: 55 end without a full stop and 20 with one; none, like the
  // majority (a title, not a sentence)
  for (const b of res) if (b.k === 'box') b.titleNoStop = true;
  // spelling slips in the captions (the words are otherwise as typed)
  const CAPFIX = [[/Illustartion/g, 'Illustration'], [/\bcurtsy\b|\bcurtesy\b/g, 'courtesy'], [/^(Figure \d+),/, '$1.'], [/^(Figure \d+) (?=[A-Z])/, '$1. '], [/\( picture/g, '(Picture'], [/extension\(/g, 'extension (']];
  for (const b of res) if (isCap(b)) for (const [re, to] of CAPFIX) if (b.text.search(re) >= 0) {
    b.text = b.text.replace(re, to); b.xml = mkP(b.text, 'BodyText'); log.push(`caption fixed: ${b.text}`);
  }
  for (const b of res) if (b.k === 'p' && b.style === 'Heading3' && b.text.length > 120) {
    b.xml = b.xml.replace(/<w:pStyle w:val="Heading3"\/>/, '<w:pStyle w:val="BodyText"/>'); b.style = 'BodyText'; log.push(`restyled long Heading3 as body: ${b.text.slice(0, 60)}`);
  }
  // ---- the hand-typed contents list goes (the engine builds its own)
  const ti = res.findIndex((b) => b.k === 'h1' && b.text === 'TABLE OF CONTENTS');
  if (ti >= 0) { let j = ti + 1; while (j < res.length && res[j].k === 'p') j++; log.push(`contents: dropped ${j - ti - 1} hand-typed lines`); res.splice(ti + 1, j - ti - 1); }
  // the author's biography opens the front matter, ahead of the Foreword (house order)
  const bi = res.findIndex((b) => b.k === 'h1' && /BIOGRAPHY/.test(b.text));
  if (bi >= 0) {
    let j = bi + 1; while (j < res.length && res[j].k !== 'h1') j++;
    const blk = res.splice(bi, j - bi);
    const fi = res.findIndex((b) => b.k === 'h1' && b.text === 'FOREWORD');
    res.splice(fi, 0, ...blk); log.push(`author's biography (${blk.length} blocks) moved before FOREWORD`);
  }
  for (const b of res) {
    if (b.k === 'p' && /^KEY COMPETENCES TO BE DEVELOPED$/i.test(b.text)) { b.xml = mkP('Key Competences to be Developed', 'Heading3'); b.style = 'Heading3'; }
    if (b.k === 'h2') b.text = b.text.replace(/^Sub[- ]Topic\s*(\d)\.\s*(\d)\.\s*(\d)\s*[.:]?\s*/i, 'Sub-Topic $1.$2.$3: ');
  }

  // ---- write
  const xmlOf = (b) => {
    if (b.k === 'p' || b.k === 'tbl' || b.k === 'img') return b.xml;
    if (b.k === 'h1') return mkP(b.text, 'Heading1');
    if (b.k === 'h2') return mkP(b.text, 'Heading2');
    if (b.k === 'box') {
      // an empty numbered line prints as a lone "5." at the foot of a box; a line holding
      // only "." or the stray keystrokes "tt" (both un-highlighted leftovers in the
      // edited copy: Exercise 4 of 3.3.2, Exercise 3 of 3.5.2, LA 3 of 3.4.1) likewise
      let paras = b.paras.map(cleanP).filter((x) => {
        if (/<w:drawing>/.test(x)) return true;
        const t = textOf(x).trim();
        if (/<w:numPr>/.test(x) && !t) return false;
        if (t === '.' || t === 'tt') { log.push(`stray line dropped from box "${b.label}": "${t}"`); return false; }
        return true;
      });
      let label = b.label.replace(/\s+/g, ' ').trim();
      if (/^LEARNING/i.test(label) && paras.length && !b.loose) {
        const title = textOf(paras[0]);
        if (title && title.length < 160) { label = `${label.replace(/:?$/, ':')} ${title}`; paras = paras.slice(1); }
        else if (title) {
          // title and instruction typed as ONE paragraph: the title is its leading bold
          // run(s); the plain text after them stays as the first body line
          const runs = splitTop(paras[0], ['w:r']);
          let k = 0, bt = '';
          while (k < runs.length && (/<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(runs[k].xml) || !textOf(runs[k].xml).trim())) { bt += textOf(runs[k].xml) ? (bt ? ' ' : '') + textOf(runs[k].xml) : ''; k++; }
          bt = bt.replace(/\s+/g, ' ').trim();
          if (bt && bt.length < 160 && k < runs.length) {
            label = `${label.replace(/:?$/, ':')} ${bt}`;
            const pPr = (paras[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
            paras[0] = `<w:p>${pPr}${runs.slice(k).map((r) => r.xml).join('')}</w:p>`;
            log.push(`activity title split from its instruction: ${bt}`);
          }
        }
      }
      if (b.loose) {
        const first = paras.length ? textOf(paras[0]) : '';
        if (first && first.length < 160) { label = `${label.replace(/:?$/, ':')} ${first}`; paras = paras.slice(1); }
      }
      if (b.titleNoStop && /^LEARNING/i.test(label) && /[^.]\.$/.test(label)) { log.push(`activity title full stop dropped: ${label.slice(0, 60)}`); label = label.slice(0, -1); }
      // the instruction under an activity title opens with a capital
      if (/^LEARNING/i.test(label) && paras.length && /^[a-z]/.test(textOf(paras[0])))
        paras[0] = paras[0].replace(/(<w:t(?: [^>]*)?>)(\s*)([a-z])/, (m, a, sp, c) => a + sp + c.toUpperCase());
      const cell = (label ? mkP(label, '', true) : '') + paras.join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="pct"/><w:shd w:val="clear" w:color="auto" w:fill="FCEAE0"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl><w:p/>`;
    }
  };
  // A hyphen the old layout put at a line end came through as "hospi- tality". A word
  // broken mid-syllable is closed up; a real compound ("problem- solving") keeps its
  // hyphen and loses only the space. Done across runs: the two halves often sit in
  // separate <w:t> nodes.
  const SPLIT = new Set(['Responsi-bilities', 'Account-ability', 'Identifica-tion', 'Man-agement', 'hospi-tality', 'mem-ber', 'se-curity']);
  // ---- bold lead-in terms ("Term: explanation"), consistency pass 19 Oct 2026 ----
  // 225 of 251 carry their colon inside the bold and 240 are in Title Case; the rest
  // are brought into line: the colon joins the bold term, and seven terms take Title Case.
  const LEAD_CASE = ['Flexible Scheduling', 'Poor Listening Skills', 'Lack of Empathy', 'Documentation and Follow-up',
    'Right to Correct Information', 'Reflection and Evaluation', 'Positive Body Language'];
  const isBoldRun = (r) => /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(r);
  const leadFix = (px) => {
    const runs = [...px.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map((m) => ({ xml: m[0], at: m.index }));
    const txt = (r) => (r.xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((s) => s.replace(/<[^>]+>/g, '')).join('');
    let k = 0, lead = '';
    while (k < runs.length && (isBoldRun(runs[k].xml) || !txt(runs[k]).trim()) && (lead || txt(runs[k]).trim() || k === 0)) {
      if (!isBoldRun(runs[k].xml) && txt(runs[k]).trim()) break;
      lead += txt(runs[k]); k++;
    }
    if (!lead.trim() || lead.length > 60 || k >= runs.length) return px;
    let out = px;
    // the colon typed just after the bold term: move it into the term's last bold run
    if (!/:\s*$/.test(lead) && /^\s*:/.test(txt(runs[k]))) {
      let lb = k - 1; while (lb >= 0 && !isBoldRun(runs[lb].xml)) lb--;
      if (lb >= 0) {
        const newBold = runs[lb].xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)(?![\s\S]*<w:t)/, (m, a, t, b) => `${a.replace(/<w:t(?! xml:space)/, '<w:t xml:space="preserve"')}${t.replace(/\s+$/, '')}:${b}`);
        const newNext = runs[k].xml.replace(/(<w:t[^>]*>)\s*:/, (m, a) => a.replace(/<w:t(?! xml:space)/, '<w:t xml:space="preserve"'));
        out = out.slice(0, runs[lb].at) + newBold + out.slice(runs[lb].at + runs[lb].xml.length, runs[k].at) + newNext + out.slice(runs[k].at + runs[k].xml.length);
        log.push(`lead-in colon moved into bold: ${lead.trim()}`);
      }
    }
    // the term's casing
    const term = lead.replace(/:\s*$/, '').replace(/\s+/g, ' ').trim();
    const want = LEAD_CASE.find((w) => w.toLowerCase() === term.toLowerCase() && w !== term);
    if (want) {
      // the term usually spans several runs (one word per run), so change the letters in
      // place across the runs' text nodes: same length, case only
      let all = '';
      const nodes = [...out.matchAll(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g)];
      nodes.forEach((n) => { all += n[2]; });
      const s0 = all.search(/\S/);
      const flat = all.slice(s0, s0 + term.length * 2).replace(/\s+/g, ' ');
      if (flat.startsWith(term)) {
        const fixed = all.split(''); let ti = 0;
        for (let c = s0; c < all.length && ti < want.length; c++) {
          if (/\s/.test(all[c]) && want[ti] !== ' ') continue;
          if (/\s/.test(all[c])) { ti++; while (c + 1 < all.length && /\s/.test(all[c + 1])) c++; continue; }
          fixed[c] = want[ti]; ti++;
        }
        let pos = 0, k2 = 0;
        out = out.replace(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, (m, a, t, b) => { const r = a + fixed.slice(pos, pos + t.length).join('') + b; pos += t.length; k2++; return r; });
        log.push(`lead-in term cased: ${term} -> ${want}`);
      }
    }
    return out;
  };
  // A word split across a bold/plain boundary ("**Sincere Apolo**gy:", "Thi**s**") prints
  // half bold. The smaller fragment takes the format of the larger: it is moved, as
  // text, into the neighbouring run.
  const wordSplitFix = (px) => {
    const re = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    let runs = [...px.matchAll(re)].map((m) => ({ xml: m[0], at: m.index }));
    const tOf = (x) => (x.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/) || [, null])[1];
    const setT = (x, t) => x.replace(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${t}</w:t>`);
    let changed = false;
    for (let i = 0; i < runs.length - 1; i++) {
      const a = runs[i], b = runs[i + 1];
      const ta = tOf(a.xml), tb = tOf(b.xml);
      if (ta == null || tb == null || isBoldRun(a.xml) === isBoldRun(b.xml)) continue;
      const tail = (ta.match(/[A-Za-z’']+$/) || [''])[0], head = (tb.match(/^[a-z’']+/) || [''])[0];
      if (!tail || !head) continue;
      if (tail.length >= head.length) { a.xml = setT(a.xml, ta + head); b.xml = setT(b.xml, tb.slice(head.length)); }
      else { a.xml = setT(a.xml, ta.slice(0, -tail.length)); b.xml = setT(b.xml, tail + tb); }
      log.push(`split word rejoined: "${ta.slice(-12)}|${tb.slice(0, 12)}"`); changed = true;
    }
    if (!changed) return px;
    let out = '', pos = 0;
    for (const r of [...px.matchAll(re)].map((m, k) => ({ m, k }))) { out += px.slice(pos, r.m.index) + runs[r.k].xml; pos = r.m.index + r.m[0].length; }
    return out + px.slice(pos);
  };
  const fixHyphens = (px0) => {
    // a TAB the PDF conversion left between two words ("Explain⇥how⇥make⇥up") is a word
    // space; one at the start or end of a line is nothing. Tabs are carried as text here
    // so the word passes below see them, then any left (a form line's gaps) go back.
    const px = px0.replace(/<w:tab\/>/g, '<w:t xml:space="preserve">\t</w:t>');
    const nodes = [...px.matchAll(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g)];
    if (!nodes.length) return px;
    let all = ''; const owner = [];
    nodes.forEach((n, k) => { for (let c = 0; c < n[2].length; c++) owner.push(k); all += n[2]; });
    const drop = new Set();
    const tabSwap = new Map();
    for (let c = 0; c < all.length; c++) if (all[c] === '\t') {
      const before = all.slice(0, c), after = all.slice(c + 1);
      if (!before.trim() || !after.trim()) drop.add(c);                       // leading / trailing
      else if (/[A-Za-z,.?]$/.test(before) && /^[A-Za-z]/.test(after)) tabSwap.set(c, ' ');   // between words
    }
    if (drop.size || tabSwap.size) log.push(`tabs: ${tabSwap.size} word gaps, ${drop.size} stray in "${all.replace(/\t/g, '⇥').slice(0, 50)}"`);
    for (const m of all.matchAll(/([A-Za-z]+)- ([a-z]+)/g)) {
      const at = m.index + m[1].length; // index of "-"
      const joined = `${m[1]}-${m[2]}`;
      drop.add(at + 1); if (SPLIT.has(joined)) drop.add(at);
      log.push(`hyphen: "${m[0]}" -> "${SPLIT.has(joined) ? m[1] + m[2] : joined}"`);
    }
    // a lowercase "l" standing for the pronoun "I" (same length, so swapped in place)
    const swap = new Map();
    for (const m of all.matchAll(/\bwhere l could\b/g)) { swap.set(m.index + 6, 'I'); log.push('text fixed: "where l could" -> "where I could"'); }
    // a list letter typed hard against its item: "b)How" -> "b) How"
    const ins = new Set(), ins2 = new Map();
    for (const m of all.matchAll(/(?:^|\s)[a-h]\)(?=[A-Z])/g)) { ins.add(m.index + m[0].length); log.push(`text fixed: "${m[0].trim()}" given a space`); }
    // ...and a full stop typed hard against the next sentence: "properly.These"
    for (const m of all.matchAll(/\b[a-z]{2,}\.(?=[A-Z][a-z]{2,})/g)) { ins.add(m.index + m[0].length); log.push(`text fixed: space after "${m[0]}" (${all.slice(m.index + m[0].length, m.index + m[0].length + 12)}…)`); }
    // ---- one spelling for one word, book-wide (consistency pass, 19 Oct 2026) ----
    // The edited copy spells the same word several ways. The majority form wins:
    // "makeup" (86) over "make-up" (35) and "make up" (3); "workplace" (39) over "work
    // place" (4); "teamwork" (12) over "team-work" (1). All are deletions, so they are
    // made character-by-character across Word's runs.
    for (const m of all.matchAll(/\b([Mm]ake|MAKE)(-\s?|\s)([Uu]p|UP)\b(?!\s+(?:for|of|the|a|their|your|his|her)\b)/g)) {
      for (let c = m.index + m[1].length; c < m.index + m[1].length + m[2].length; c++) drop.add(c);
      if (m[3] === 'Up') swap.set(m.index + m[1].length + m[2].length, 'u');   // "Make Up" -> "Makeup"
      log.push(`spelling: "${m[0]}" -> makeup`);
    }
    for (const m of all.matchAll(/\b([Ww]ork|WORK) (place|PLACE)\b/g)) { drop.add(m.index + m[1].length); log.push(`spelling: "${m[0]}" -> workplace`); }
    for (const m of all.matchAll(/\b([Tt]eam)-(work)\b/g)) { drop.add(m.index + m[1].length); log.push(`spelling: "${m[0]}" -> teamwork`); }
    // "practice" is the noun and "practise" the verb in British English, which the book
    // already follows in five places; the verb uses spelt "practice" take the -se form
    for (const m of all.matchAll(/(?:\b(?:to|will|and|then|can|should|must|you|learners)\s+|^\s*|[.:]\s+)([Pp]ractice)(?=\s+(?:how|combining|interper|mediating|good|responding|security|the|using|with|written|it|your|proper)\b)/g)) {
      swap.set(m.index + m[0].length - 2, 's'); log.push(`spelling: verb "${m[0].trim()}" -> practise`);
    }
    // "Discus two ways…" (twice, Exercises 1 and 2 of 3.3.1/3.3.2) is the verb "discuss"
    for (const m of all.matchAll(/\bDiscus(?=\s)/g)) { ins2.set(m.index + 6, 's'); log.push('spelling: "Discus" -> "Discuss"'); }
    // the follow-up label: "Follow up activity" / "Follow up activity:" -> "Follow-up activity:"
    for (const m of all.matchAll(/\bFollow up activity(:?)/g)) {
      swap.set(m.index + 6, '-'); if (!m[1]) ins2.set(m.index + m[0].length, ':');
      log.push(`label: "${m[0]}" -> "Follow-up activity:"`);
    }
    if (!drop.size && !swap.size && !ins.size && !ins2.size && !tabSwap.size) return px0;
    const texts = nodes.map(() => '');
    for (let c = 0; c < all.length; c++) {
      if (ins.has(c)) texts[owner[c - 1]] += ' ';
      if (ins2.has(c)) texts[owner[c - 1]] += ins2.get(c);
      if (!drop.has(c)) texts[owner[c]] += swap.get(c) || tabSwap.get(c) || all[c];
    }
    if (ins2.has(all.length)) texts[owner[all.length - 1]] += ins2.get(all.length);
    let k = 0;
    return px.replace(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, (m, a, t, b) => `<w:t xml:space="preserve">${texts[k++]}${b}`)
      .replace(/<w:t xml:space="preserve">\t<\/w:t>/g, '<w:tab/>');   // a tab still standing is a real one
  };
  // stray letters left by the conversion (checked against the edited copy's own text)
  const TEXTFIX = [[/(LEARNING ACTIVITY 2: )L (Performing guest privacy drills)/g, '$1$2'], [/(<w:t(?: [^>]*)?>)([a-h]\))(?=[A-Z])/g, '$1$2 '], [/ENTERPRENEURSHIP/g, 'ENTREPRENEURSHIP'], [/Enterpreneurship/g, 'Entrepreneurship'],
    // "Business Adventure" for "Business Venture" (Sub-Topic 3.8.1, printed page 133) and
    // "your adventure" in the sentence under it — corrected on the user's instruction, 19 Oct 2026
    [/Business Adventure/g, 'Business Venture'], [/your adventure and drive growth/g, 'your venture and drive growth'],
    // Sub-Topic 3.3.2 heading "Benefits Of Good" and "Present your chat" (Contouring LA3, p.69) - the user's instruction, 19 Oct 2026
    [/Benefits Of Good Customer Care/g, 'Benefits of Good Customer Care'], [/(<w:t>)chat(<\/w:t>)/g, '$1chart$2']];   // "chat" sits in a run of its own
  const fixText = (x) => { for (const [re, to] of TEXTFIX) if (x.search(re) >= 0) { log.push(`text fixed: ${re}`); x = x.replace(re, to); } return x; };
  const body = res.map(xmlOf).map((x) => fixText(x.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (p) => leadFix(wordSplitFix(fixHyphens(p)))))).join('');
  const newDoc = doc.slice(0, bStart) + body + lastSect + doc.slice(doc.lastIndexOf('</w:body>'));
  z.file('word/document.xml', newDoc);
  fs.writeFileSync(outp, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  // review dump
  const dump = res.map((b, i) => {
    if (b.k === 'box') return `${i} BOX [${b.label}] ${b.paras.map((p) => textOf(p) || (p.includes('<w:drawing>') ? '<IMG>' : '')).filter(Boolean).join(' / ').slice(0, 300)}`;
    if (b.k === 'img') return `${i} IMG`;
    if (b.k === 'tbl') return `${i} TABLE ${textOf(b.xml).slice(0, 100)}`;
    return `${i} ${b.k.toUpperCase()} ${b.style || ''} ${(b.text || '').slice(0, 200)}`;
  });
  fs.writeFileSync(dumpdir + '/rebuild-dump.txt', dump.join('\n'));
  fs.writeFileSync(dumpdir + '/rebuild-log.txt', log.join('\n'));
  console.log('blocks', res.length, 'log lines', log.length);
})();
