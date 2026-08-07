# Settled decisions and open items

## Settled decisions

These were argued through during the build and should not be relitigated without
a new reason. Each one has a cost that was accepted knowingly; if you are about
to undo one, the bar is a *new* fact, not a fresh preference.

### One self-contained file, no build step

The whole app is `print-farm-scheduler.jsx`, transpiled in the browser by Babel
standalone. Deployment is committing files. No bundler, no `node_modules`, no
pipeline to break, and anyone with repo access can ship a fix.

*Costs:* a syntax error ships unvalidated; there is no test or lint gate; Babel
transpiles on every load; the file is long enough that navigating it means using
the section comments.

### SharePoint via Microsoft Graph and MSAL.js

Not the retired Azure ACS / SharePoint Add-ins method, which is on its way out
and would have needed app-only credentials.

### No server, therefore no full Teams SSO

`getAuthToken` plus an on-behalf-of exchange needs a server holding a client
secret. Adding one changes the deployment shape entirely. The `ssoSilent` path
gets most of the benefit — see [authentication.md](authentication.md).

### Minimal collapsed cards plus a detail modal

Earlier cards carried far more on their face and read as visually busy. The
collapsed card now shows only name, status and ETA; everything else is one click
away.

### Batched auto-loading over list virtualization

Staging renders 60 cards and adds 60 more as you scroll. Virtualization would
scale further but complicates drag-and-drop and breaks browser find-in-page,
which operators use.

### Priority sorting beats manual order in staging

Within staging, tier order (Urgent → High → Normal → Low) always wins;
`sortOrder` is the tiebreaker *inside* a tier. Dragging a card to the top of
staging does not promote it — change its priority instead.

### ~~Group colour for identity, state colour for state~~ — superseded 2026-08

The original decision: group colours assigned automatically from a fixed palette
and inherited by printers, so colour never means two things at once.

It did not survive contact with a full board. Three colour systems ran at the
same time — group identity, printer state, task status — and the intent that
each would stay in its own lane did not hold visually: with colour everywhere,
none of it read as meaning anything in particular. The printer state colour
suffered worst. It was the one carrying real information, and operators
reported it was not legible as *state* until they watched it change.

**What replaced it: colour means an interaction or a state, never an identity.**

- **Group colour is retired from the interface.** A printer cannot be moved
  between groups — the assignment is static — so colour was encoding something
  that never varies, which is where a colour code earns least. The grouping is
  already unmistakable from the layout and the group's name.
- **State keeps its colour**, and now has it to itself: the printer card's top
  edge stays green / orange / grey, so "which machines will print" is still
  answerable by scanning rather than by reading each card.
- **Status keeps its colour, but only with its word attached.** The task status
  chip stays; the bare status dot beside it went, because it repeated the chip
  without the label that made it readable.
- **A single accent** (`ACCENT`) covers focus, drag targets and active controls
  — "what am I touching", never "what is this".

Group colours are still assigned and still round-trip through the `Color`
column. Nothing renders them. They cost nothing to keep, and leaving them means
reversing this needs no schema change and no data migration — which is the
cheapest possible insurance against the board reading flat once the shop lives
with it.

### One three-state printer control

`Ready` / `Reserved` / `Maintenance`, replacing an on/off toggle plus a separate
availability pill — two booleans that between them produced four states when only
three mean anything. The SharePoint column carried the internal name `Active`
from that era until 2026-08-07, when it was replaced by one actually named
`Status` — see [data-model.md](data-model.md#the-one-that-got-fixed).

### Group collapse is per-person and not persisted

The `Collapsed` column in the Groups list is left unused **on purpose**. A shared
Yes/No would have folded the group for everyone who opened the board.

### Dates written at noon UTC

Midnight UTC displays as the previous evening west of Greenwich, which made the
SharePoint list itself show jobs due a day early. Noon survives any offset.

### Behavioural dropdowns stay in code

The seven cosmetic dropdowns are read from SharePoint choice columns so the shop
can edit them freely. Task `Status`, `Priority`, `SliceStatus` and printer
`Status` stay in code, because the app branches on every value.

## Open items

Nothing blocking.

- **Site regional timezone was never verified** — no permissions to check.
  Cosmetic only: it affects how dates look to someone browsing the lists
  directly, not the app.
- **Expired token inside Teams cannot renew silently.** MSAL's hidden-iframe
  renewal is blocked in a nested frame. The code sends the person back through
  the Teams window instead. Worth watching whether anyone notices after an hour
  of use.
- **Sample data still ships in the file** (`seedGroups`, `seedPrinters`,
  `seedTasks`). Unreachable while the `SP` block has IDs in it, and it is what
  makes the app demonstrable if they are ever removed.
- **No conflict detection.** Two people editing the same row is last-writer-wins,
  and the board does not poll for other people's changes — you see them on
  reload. Acceptable at 10–15 users with distinct printers; it would not be at
  ten times that.
- **No native SharePoint view by time of day**, because `EtaTime` is a text
  column. Only matters if someone wants a list view like "due in the next four
  hours."
