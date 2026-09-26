# Contributing — how to work without breaking anyone else's books

`main` is the only long-lived branch. It must always build every book. Nobody
commits to it directly: every change arrives through a **pull request (PR)** that
someone else looks at first.

## The everyday loop

```bash
# 1. start from the latest main
git switch main
git pull

# 2. one branch per book or per engine fix
git switch -c fix/physics-form2-captions

# 3. work, typeset, LOOK at the PDF, commit small steps
git add "books-to-typeset/Physics/Form 2/2026-09-10/My Book.overrides.json"
git commit -m "Physics F2 LB: fix figure 3.2 caption"

# 4. publish the branch and open a PR on GitHub
git push -u origin fix/physics-form2-captions
#    GitHub prints a link — open it, describe what changed + which books you checked
```

When the PR is merged, delete the branch (GitHub offers a button), then
`git switch main && git pull` before starting the next thing.

## Rules

- **Never** `git push --force`, never commit to `main`, never create long-running
  "integration" / "all-fixes" branches. Small branches, merged often.
- Keep each PR to one book or one engine change. A PR that touches 12 books and the
  engine can't be reviewed.
- Engine change (`src/typeset/`)? Run the regression check before and after and
  paste the result into the PR:
  ```bash
  npm run regress -- snapshot before.json     # on main, before your change
  npm run regress -- snapshot after.json      # on your branch
  npm run regress -- compare before.json after.json
  ```
  Only the books you meant to change may appear.
- Never commit manuscripts (`.docx`), PDFs or `data/zeph.db` — `.gitignore` already
  blocks them. Do commit `.overrides.json`, helper images, and `data/books.json`
  (after `npm run zeph -- export`).

## Your local work is safe

- `git pull` never touches your manuscripts, your `output/` or your database —
  they're git-ignored, so git doesn't know they exist.
- Uncommitted edits to tracked files? `git pull` refuses rather than overwrite them.
  Commit them on a branch first (`git switch -c wip/my-work && git commit -am wip`),
  or `git stash`, pull, then `git stash pop`.
- The zeph database moved from `zeph.db` to `data/zeph.db`. You don't need to do
  anything: the first time you run `npm run zeph`, it moves your existing file there.

## If you were on an old branch (`portrait-books`, `integration/all-fixes`, `fix/…`)

All of those were merged into `main` and removed from GitHub on 2026-09-26 —
nothing was lost. Switch over once:

```bash
git fetch --prune
git status                      # anything uncommitted? commit or stash it first
git switch main
git pull
git branch -D portrait-books    # (and any other old local branches you had)
```

If you had commits on your old branch that you never pushed, keep them instead:
`git switch <old-branch> && git rebase main`, then push it under a new name and open a PR.
