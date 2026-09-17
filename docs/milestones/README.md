# Milestone records

One short Markdown file per change worth remembering later: a schema change, an
integration, an audit round, a redesign, anything with a known ceiling or a
lesson in it. Routine fixes and UI tweaks stay in `CHANGELOG.md` only — this
folder is for the *why* and the *what we knowingly punted*, which PR
descriptions and changelog lines don't preserve.

- One file per milestone, named `YYYY-MM-DD-short-slug.md`, flat in this folder.
- Plain language, skimmable — a non-developer should follow it.

Record shape (copy this):

```markdown
# YYYY-MM-DD — Title in plain words

**Date:** … · **Build:** … · **PR:** #…

One or two sentences: what was asked for, or what prompted this.

## What changed

- The change itself, from the shop's point of view.
- Schema or auth changes, if any (list, column, internal name).

Known ceiling: what was deliberately not done, and what would trigger doing it.
```
