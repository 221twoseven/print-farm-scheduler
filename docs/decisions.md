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

### Group colour for identity, state colour for state

Group colours are assigned automatically from a fixed palette and inherited by
printers. Printer colour is not individually assignable, so colour never means
two things at once.

### One three-state printer control

`Ready` / `Reserved` / `Maintenance`, replacing an on/off toggle plus a separate
availability pill — two booleans that between them produced four states when only
three mean anything. The SharePoint column is still internally named `Active`
from that era.

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
