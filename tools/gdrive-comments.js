#!/usr/bin/env node
// gdrive-comments — reviewer comments on a PDF shared on Google Drive, read from the
// notification e-mails Google sends ("X added a comment…", "New activity in…").
//
//   node tools/gdrive-comments.js <thread.json>… [--pdf typeset.pdf] > comments.json
//   npm run zeph -- return <book> comments.json
//
// Each <thread.json> is a Gmail thread fetched with its HTML bodies (the Gmail
// connector's get_thread, FULL_CONTENT). A comment can arrive several times — alone,
// then again in a digest — so comments are keyed by Drive's discussion id and the
// latest copy wins (it carries every reply so far). The e-mails never say which page
// a comment is on; with --pdf, the passage the reviewer highlighted is searched for in
// the typeset PDF and the page set when it occurs on exactly one page.
//
// Output: [{ disco, date, author, anchor, note, page }] — `note` joins the replies.
const fs = require("node:fs");

const dec = (s) => s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\r/g, "").trim();

function parseMessage(m) {
  const out = [];
  // each discussion opens with an "Open Discussion" ViewAction carrying its disco id
  const parts = (m.htmlBody || "").split(/<div itemprop="action" itemscope itemtype="http:\/\/schema.org\/ViewAction">/).slice(1);
  for (const p of parts) {
    const disco = (p.match(/disco=(doco\.[\w-]+)/) || [])[1];
    if (!disco) continue;
    const snip = p.match(/class="document-content-snippet"[^>]*>([\s\S]*?)<\/div>/);
    const anchor = snip ? dec(snip[1]).replace(/\s*\n\s*/g, " ") : "";
    const posts = [];
    const re = /class="(non-tombstone-post|tombstone-post)"([\s\S]*?)(?=class="(?:non-tombstone-post|tombstone-post|posts-section-end)")/g;
    let mm;
    while ((mm = re.exec(p))) {
      if (mm[1] === "tombstone-post") continue; // a deleted/hidden reply
      const author = dec((mm[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [, ""])[1]);
      const note = [...mm[2].matchAll(/class="notranslate">([\s\S]*?)<\/div>/g)].map((x) => dec(x[1])).join("\n");
      posts.push({ author, note });
    }
    if (posts.length) out.push({ disco, date: m.date, author: posts[0].author, anchor, posts });
  }
  return out;
}

async function locate(list, pdfPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
  const norm = (s) => s.replace(/[‐-―]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, "").toLowerCase();
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(norm(tc.items.map((t) => t.str).join("")));
  }
  for (const c of list) {
    const a = norm(c.anchor.replace(/…$/, "")).slice(0, 150);
    const hits = a.length >= 12 ? pages.flatMap((t, i) => (t.includes(a) ? [i + 1] : [])) : [];
    if (hits.length === 1) c.page = hits[0];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--pdf");
  const pdf = pi >= 0 ? args.splice(pi, 2)[1] : null;
  if (!args.length) { console.error("usage: gdrive-comments <thread.json>… [--pdf typeset.pdf]"); process.exit(1); }
  const byId = new Map();
  let nmsg = 0;
  for (const f of args) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const m of j.messages || [j]) {
      nmsg++;
      for (const c of parseMessage(m)) {
        const prev = byId.get(c.disco);
        if (!prev || c.date >= prev.date) byId.set(c.disco, c);
      }
    }
  }
  const list = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const c of list) {
    c.note = c.posts.map((p, i) => (i && p.author !== c.author ? `[${p.author}] ` : "") + p.note).join("\n— ");
    delete c.posts;
  }
  if (pdf) await locate(list, pdf);
  process.stdout.write(JSON.stringify(list, null, 1) + "\n");
  console.error(`${nmsg} e-mail(s) -> ${list.length} comment(s)${pdf ? `, ${list.filter((c) => c.page).length} placed on a page` : ""}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
