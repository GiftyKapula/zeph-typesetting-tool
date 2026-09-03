// Extract reviewer feedback from a returned .docx — both Word comments
// (word/comments.xml) and tracked changes (w:ins / w:del in document.xml).
// Returns [{ page, kind, note, anchor }]. page is null (docx has no fixed
// pagination); anchor is the text the change/comment attaches to.

const fs = require("node:fs");
const JSZip = require("jszip");

const stripTags = (xml) =>
  xml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// pull concatenated <w:t> text out of an xml fragment
const runText = (frag) =>
  (frag.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
    .map((m) => m.replace(/<[^>]*>/g, ""))
    .join("")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function extractDocxComments(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const out = [];

  // --- 1. Word comments -----------------------------------------------------
  const commentsFile = zip.file("word/comments.xml");
  const docFile = zip.file("word/document.xml");
  const docXml = docFile ? await docFile.async("string") : "";

  if (commentsFile) {
    const cx = await commentsFile.async("string");
    const blocks = cx.match(/<w:comment\b[\s\S]*?<\/w:comment>/g) || [];
    for (const b of blocks) {
      const open = b.match(/<w:comment\b[^>]*>/)[0];
      const id = (open.match(/w:id="(\d+)"/) || [])[1];
      const author = (open.match(/w:author="([^"]*)"/) || [])[1] || null;
      const note = runText(b).trim();
      // anchor: text between commentRangeStart/End with the same id
      let anchor = "";
      if (id != null && docXml) {
        const re = new RegExp(
          `<w:commentRangeStart[^>]*w:id="${id}"[^>]*/>([\\s\\S]*?)<w:commentRangeEnd[^>]*w:id="${id}"[^>]*/>`
        );
        const m = docXml.match(re);
        if (m) anchor = runText(m[1]).trim();
      }
      if (!note && !anchor) continue;
      out.push({ page: null, kind: "comment", note, anchor: anchor.slice(0, 300), author });
    }
  }

  // --- 2. Tracked changes ---------------------------------------------------
  if (docXml) {
    for (const [tag, kind] of [["w:ins", "insertion"], ["w:del", "deletion"]]) {
      const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
      let m;
      while ((m = re.exec(docXml))) {
        const author = (m[1].match(/w:author="([^"]*)"/) || [])[1] || null;
        // deletions store text in <w:delText>, insertions in <w:t>
        const frag = m[2];
        const text = kind === "deletion"
          ? (frag.match(/<w:delText[^>]*>([\s\S]*?)<\/w:delText>/g) || [])
              .map((x) => x.replace(/<[^>]*>/g, "")).join("")
          : runText(frag);
        const t = text.trim();
        if (!t) continue;
        out.push({
          page: null, kind,
          note: kind === "deletion" ? `deleted: "${t}"` : `inserted: "${t}"`,
          anchor: t.slice(0, 300), author,
        });
      }
    }
  }

  return out;
}

module.exports = { extractDocxComments };
