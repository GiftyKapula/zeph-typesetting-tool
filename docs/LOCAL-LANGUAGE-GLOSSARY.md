# Local-language structural terms

Zambian local-language equivalents of the structural labels the engine must
recognise. These are wired into label recognition in `src/typeset/import-docx.js`
(`boxKindFromTitle` for boxed activities/exercises/assessments, and the flat-mode
heading detection in `classifyPara`). Add a language's terms here and in
`boxKindFromTitle` when a new local-language book arrives.

| Language | Topic | Sub-topic | Learning Activity | Exercise | End-of-topic Assessment | Unit |
|---|---|---|---|---|---|---|
| Bemba (Ichibemba) | Umutwe | Umutwe unoono | Ifyakucita | Umulimo | Ukweshiwa kwa pampela ya isambililo | — |
| Kaonde | Mutwe | Mutwe-kache | Mwingilo wakuuba | Mwingilo | Kupwa kwa mutwe | — |
| Nyanja (Chinyanja) | Mutu | Mutu waung'ono | Nchito | Zocita | Mayeso a kutha kwa mutu | — |
| Silozi | Tuto | Tutonyana | Musebezi | Zakueza | Tatubo ya mafelelezo ya tuto / Mukanga | — |
| Luvale | Chihande | Mutwe wachihande | Vyakulinga | Mulimo | Esekelo yakusoka chihande | — |
| Lunda | Mutu Wansañu | Mutu Wansañu Wantanya | Zhakwila | Mudimu | Kweseka kwahachibalu | — |
| Tonga (Chitonga) | Mutwe | Mutwe Musyoonto | Cakucita | Mulimo | Musunko | Cipati |

**Notes**
- Order matters in `boxKindFromTitle`: match the longer/specific label before the
  bare one (Kaonde "Mwingilo wakuuba" = activity must beat "Mwingilo" = exercise).
- Cross-language collisions exist (Mutwe/Mutu = topic in several; Mulimo/Umulimo/
  Mudimu = exercise), but they're matched at heading position, so risk is low.
- Topics/sub-topics are usually styled with Word heading styles in the manuscript
  (handled automatically); the term list is the fallback when they aren't.
