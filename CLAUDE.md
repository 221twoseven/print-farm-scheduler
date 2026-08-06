# Working in this repo

Read this first, then `docs/` as needed. Start with
[docs/architecture.md](docs/architecture.md).

## What this is

A Microsoft Teams tab for a 3D print shop, in production use by ~10–15 people.
One JSX file, transpiled in the browser, hosted on GitHub Pages, storing data in
SharePoint lists via Microsoft Graph. No build step, no server, no tests.

## The shape of a change

Nearly every change is an edit to `print-farm-scheduler.jsx`. Find the section by
its `/* ---- name ---- */` comment rather than by line number — the file is long
and the numbers move.

- **Interface change** → the component sections between `PrintFarmScheduler` and
  `AddTaskForm`.
- **New stored field** → SharePoint column first, then `COLS`, then the list's
  `fromRow`/`toRow` mappers. `checkSchema()` will refuse to load if you miss a
  step. Details in [docs/operations.md](docs/operations.md#changing-the-sharepoint-schema).
- **Storage behaviour** → the persistence section below the `SP` block, and
  `AppShell`.

## Rules that are not style preferences

1. **Mutation handlers must copy only what they change.** The save layer diffs by
   object identity (`diffByIdentity`), so returning a fresh object for an
   untouched row causes a pointless PATCH, and mutating a row in place causes a
   *missed* one. Map over the array; return the same reference for rows you did
   not touch. This is the single most load-bearing invariant in the codebase.
2. **Any structural change to tasks goes through `setTasksOrdered`** (which calls
   `reindex` scoped by `printerId`). Same for groups and printers with their own
   scopes.
3. **Column names in `COLS` are SharePoint *internal* names** and several do not
   match their display names — `status` really is stored in a column called
   `Active`. Never "fix" one to look right. See
   [docs/data-model.md](docs/data-model.md).
4. **Don't add a build step, a server, or a dependency that needs one.** The
   no-build deployment is a decision, not an accident —
   [docs/decisions.md](docs/decisions.md).
5. **Keep `index.html` and `auth.html` in step.** Client and tenant IDs appear in
   both `print-farm-scheduler.jsx` and `auth.html`.
6. **Don't commit blanked `SP` IDs.** Blanking them locally is the supported way
   to run on seed data; committing that silently disconnects production.

## Before pushing

There is no CI gate that will catch a mistake — the Pages build only fails on
infrastructure problems, so a syntax error ships and shows up as a blank board.
At minimum:

- Re-read the diff.
- If the change is non-trivial, serve the repo locally
  (`python3 -m http.server 8080`) and load it; a Babel error appears in the
  console immediately.
- State plainly in the commit what changed and why.

Deploy is: commit to `main` → Pages build → hard-refresh → restart Teams. When a
change appears not to have taken effect, **suspect cache before suspecting the
code** — see [docs/operations.md](docs/operations.md#deploying-a-change).

## Things to check before proposing a change

- Is it already a settled decision? [docs/decisions.md](docs/decisions.md) lists
  the ones argued through, with their accepted costs. Reopen one only with a new
  fact.
- Does it change behaviour described in
  [docs/ui-reference.md](docs/ui-reference.md)? Update that file in the same
  commit.
- Does it write to SharePoint? Then it needs a column, a `COLS` entry, and both
  mappers — a partial change fails at load, not at save.

## House style

The existing code comments explain *why*, not *what*, and several encode hard-won
debugging history (the `Active` column, the noon-UTC dates, the deferred
`setTimeout` in `onDragStart`). Match that: comment the non-obvious reason, leave
the obvious alone, and don't strip an existing comment that records a trap.
