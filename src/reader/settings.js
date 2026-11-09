// Book settings for supplementary readers: <book>.reader.json next to the manuscript.
// Everything the typesetter needs that is not text: title page facts, family, trim size,
// cover design and colours. Written by `reader:import`, edited by hand when needed.
// Contents titles: the words these books themselves use (the importer keeps the book's
// own word when its contents page has one).
const LANGS = {
  English: { lang: "en", contents: "Contents" },
  Icibemba: { lang: "en", contents: "Ifili mukati" },
  Silozi: { lang: "en", contents: "Linaneho" },
  Cinyanja: { lang: "en", contents: "Zamkatimu" },
  Chitonga: { lang: "en", contents: "Izili moomu" },
  Luvale: { lang: "en", contents: "Vilimo" },
};

// colour sets for the cover designs (primary field, secondary, accent, paper)
const PALETTES = {
  terracotta: ["#8a3a1c", "#d9a441", "#f2d27a", "#f7efdc"],
  indigo: ["#1f3557", "#4f7cac", "#e3a83b", "#f5efe0"],
  forest: ["#24452f", "#6f9a52", "#e0b84c", "#f4f0e2"],
  maroon: ["#5e1f2b", "#b2563f", "#e9c46a", "#f8f0e3"],
  ochre: ["#9a5b12", "#3d2b1f", "#f0c75e", "#fbf3df"],
  teal: ["#0f5257", "#3fa7a0", "#f2b134", "#eef6f2"],
  plum: ["#4b2142", "#a0527d", "#f1b24a", "#f7eef2"],
  charcoal: ["#2b2d33", "#6b7280", "#f2a541", "#f4f1ea"],
  copper: ["#7a3418", "#c56a2c", "#f6d38b", "#fbf1e4"],
  river: ["#123c69", "#2f80b5", "#f4c430", "#eef4fa"],
  savanna: ["#7c5a1e", "#c9a14a", "#f3dd8c", "#fbf6e6"],
  crimson: ["#7d1a1a", "#d1495b", "#edae49", "#fbefe9"],
  olive: ["#4a5226", "#9aa04b", "#e8c55a", "#f5f3e3"],
  dusk: ["#2e2349", "#7d5ba6", "#f3a64a", "#f2eef8"],
};

const ACCENTS = { terracotta: "#9c3d17", indigo: "#2e5a8a", forest: "#2f6b3e", maroon: "#7a2636", ochre: "#9a5b12", teal: "#0f6b70", plum: "#6d2c5f", charcoal: "#7a4a12", copper: "#8a3d1a", river: "#1f5f99", savanna: "#8a6420", crimson: "#9c2323", olive: "#5d6a24", dusk: "#4b3a78" };

function defaults(meta, opts = {}) {
  const language = opts.language || "English";
  const family = opts.family || (meta.verse ? "poetry" : "novel");
  return {
    title: meta.title || "",
    subtitle: meta.subtitle || "",
    author: meta.author || "",
    series: meta.series || [],
    language,
    family,
    trim: meta.trim || [148, 210],
    bodySize: opts.bodySize || (family === "reader" ? 13 : (meta.trim && meta.trim[0] < 140 ? 10 : 10.5)),
    chapterNewPage: meta.chapterNewPage !== false,
    contents: "auto",
    contentsTitle: (LANGS[language] || LANGS.English).contents,
    isbn: meta.isbn || "",
    outName: opts.outName || "",
    outStatus: "Typeset ready for proofreading",
    cover: {
      design: opts.design || "sunrise",
      palette: opts.palette || "terracotta",
      label: opts.label != null ? opts.label : (language === "English" ? "" : language),
      art: opts.art || "",
      front: opts.front || "",
      back: opts.back || "",
      blurb: "",
    },
    source: meta.source || "",
  };
}

module.exports = { LANGS, PALETTES, ACCENTS, defaults };
