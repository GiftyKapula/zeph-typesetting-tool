# proofread-books/ — annotated returns land here

When a reviewer sends back a marked-up copy (annotated PDF, or a Word file with
comments/tracked changes), drop it in here and register it with:

```bash
npm run zeph -- return <book-id> "proofread-books/My Book - reviewed.pdf"
```

`zeph` extracts every comment straight from the file (highlights + sticky notes
in a PDF, or comments/tracked changes in a `.docx`) into its local database, so
you can work the list with `npm run zeph -- comments <book-id>`.

> Files in this folder are git-ignored — nothing here is committed except this
> README.
