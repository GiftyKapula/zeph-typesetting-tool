# Supplementary readers and novels

This part of the engine typesets supplementary books: novels, primary readers and poetry
books, in English and the Zambian languages. It is separate from the textbook engine and
lives in `src/reader/`.

## How it works

1. **Import** turns the old book (a PDF with text, or a Word file) into a book folder:

   ```
   <Title>/<Title>.docx          the manuscript in reader styles (you edit this in Word)
   <Title>/<Title>.reader.json   title, author, language, cover design, colours
   <Title>/images/               pictures cut from the PDF at 300 dpi
   <Title>/cover/                the book's own cover, when it has one
   <Title>/import-report.txt     what was found, and what to check by eye
   ```

2. **You check and correct the Word file** against the source PDF.

3. **Typeset** builds the finished PDF from the Word file and the settings file. The cover
   sheet (back, spine, front) is page 1 of the PDF.

## Commands

Run these from the repository folder.

Import a book:

```
npm run reader:import -- "Pano Calo novel.pdf" --out "Books" --language Icibemba --family novel --design heritage --palette terracotta
```

With its own cover scan (page 1 is the front, page 2 the back):

```
npm run reader:import -- "Coup.pdf" --out "Books" --language English --cover "Coup - covers.pdf"
```

Typeset a book folder:

```
npm run reader:typeset -- "Books/Pano Calo"
```

The PDF goes to `output/Supplementary Readers/<Language>/<Title>/<Title> - Typeset ready for proofreading.pdf`.
Add `--out <folder>` to put it somewhere else.

To try another cover without editing the settings file:

```
npm run reader:typeset -- "Books/Pano Calo" --design mosaic --palette indigo
```

**Never import a book again after you have started correcting its Word file.** Import writes
a new Word file and your corrections would be lost. The settings file is kept unless you add `--force`.

## The Word styles

Open the Styles pane in Word (Ctrl+Alt+Shift+S). The typesetter reads these styles:

| Style | Use it for |
|---|---|
| Book Title, Book Author, Book Series | the title page |
| Imprint | each line of the copyright page |
| Front Heading | the heading of a preface, foreword or dedication |
| Chapter Number | the chapter label above a title: `1`, `KAPETULU 1`, `CHAPTER ONE` |
| Heading 1 | the chapter title (starts a new chapter) |
| Heading 2 | a section heading inside a chapter |
| Normal | body paragraphs |
| Verse | a stanza of a poem (lines split with Shift+Enter) |
| Centred | a song or lines that are centred in the source |
| Right | a signature or a line set to the right |
| Quote | an indented block such as a letter |
| Scene Break | the `* * *` between scenes |
| Picture, Caption | a picture and the line under it |

To move a picture, cut its paragraph and paste it where it belongs. To delete a picture,
delete its paragraph.

## The settings file (`<Title>.reader.json`)

Open it with Notepad. The fields you will change:

| Field | Meaning |
|---|---|
| `title`, `subtitle`, `author` | as they should print on the cover and title page |
| `language` | English, Icibemba, Silozi, Cinyanja, Chitonga, Luvale... |
| `family` | `novel` (justified, indented), `reader` (primary readers: bigger, spaced), `poetry` |
| `isbn` | printed in the box on the back cover |
| `contentsTitle` | the heading of the contents page, in the book's language |
| `cover.design` | see below |
| `cover.palette` | see below |
| `cover.label` | the small line at the top of the front cover |
| `cover.art` | for the `art` design: the picture to use, for example `images/fig-012.png` |
| `cover.blurb` | optional text for the back cover |

## Cover designs

| Design | Look | Good for |
|---|---|---|
| `original` | the book's own scanned cover | books that came with a cover |
| `heritage` | woven triangle bands and a cream title panel | traditional stories, Zambian languages |
| `classic` | cream paper, double frame, corner diamonds | serious novels |
| `mosaic` | circle and diamond pattern with a title panel | traditional and folk tales |
| `modern` | sun discs, a diagonal band, big title | modern novels |
| `sunrise` | sun rays over hills | stories of village and land |
| `art` | a picture from the book on the top part | primary readers with pictures |

Palettes: terracotta, indigo, forest, maroon, ochre, teal, plum, charcoal, copper, river,
savanna, crimson, olive, dusk.

Every book already has its design and palette chosen. Change it only if you are asked to.

## House rules (the engine does these for you)

* The cover sheet is page 1: back cover, spine, front cover.
* A spine is added only when the book is longer than 112 pages.
* The back cover is plain: ISBN box, ZEPH logo and "Printed by Zambia Educational Publishing House".
* No word breaking (hyphenation) at line ends.

## Checklist before you hand a book in

1. Read `import-report.txt`.
2. Compare every chapter opening with the source PDF: number, title, first words.
3. Check that no paragraph is split in two or joined to the next one.
4. Check every picture: right place, right caption.
5. Fill in the ISBN if the source has one.
6. Look at every page of the finished PDF, the cover sheet first.
