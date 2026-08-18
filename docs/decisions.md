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

**Loosened 2026-08-12**, at the shop's request, then given an explicit layout
the same day. The card is now three rows: title + status pill (row 1), jobcode
indented under the title (row 2), and ETA + `Qty N` (row 3). The principle holds
— the modal is still where a job is read in full — but designer view cannot open
an assigned job at all, so for a designer the card face is the only surface
jobcode and quantity can reach.

Two things went the other way in the same change, both by the shop's layout:
**need-by came off the card** (it was on the first-pass detail line; the
three-row spec has no slot for it, and it stays in the modal), and **the status
pill now shows in staging too**, where it had been assigned-only. Quantity reads
as `Qty N` on every card — it was line 1's `×N`, shown only when greater than
one, so one fact had two shapes.

Watch for the board reading busy again; the next thing that wants a place on the
card should have to argue for it — and note that need-by just lost its place, so
"put it back" is not free either.

### Designer view never gets a permanent-delete control

Any control that permanently deletes board state is operator view only, full
stop. Designer view may *read* everything — assigned cards, the global history
table — but it configures nothing and destroys nothing. This is the same rule
that keeps the shop-layout gear, the printer settings button and the printer
status control out of designer view (item 10); any future permanent-delete
control inherits it without needing to argue the point again. (The per-printer
**Clear history** button was this rule's first application; item 31 later
removed that button in both views — see the next entry — which satisfies the
rule vacuously rather than retiring it.)

*Why this is a rule and not a per-button choice:* Clear history shipped with no
gate at all — it rendered, enabled, in designer view, and its confirmation
opened — because "hide the destructive thing in designer view" was applied
control by control rather than as a principle. Stating it once here is cheaper
than rediscovering it the next time someone adds a delete button.

*Cost:* a genuinely read-only-plus-tidy action (say, a designer archiving their
own completed view) would also be blocked and would have to argue for an
exception. Accepted: the failure mode of a too-permissive delete is worse than
the friction of a too-strict one.

### Completed jobs are never purged from the UI

Decided 2026-08-17 with item 31, which removed the per-printer Completed
sections and made the completed-jobs table the only history. Clear history —
the only purge path — went with them, and deliberately got no replacement: the
board has **no control that deletes a completed job**, in either view. A job
marked Complete leaves its printer card immediately and lives in the table
from then on.

*Why:* the table is meant to be the permanent record, and a record with a
delete button is one accident away from not being one. Nothing on the board
needs the rows gone — filters keep the table usable as it grows, and the
batched loading already assumes an unbounded list.

*Cost:* the record grows forever, and genuinely trimming it means editing the
SharePoint Tasks list directly (filter to status Complete, delete rows) —
deliberate friction, in the one place that already requires care. If the shop
ever asks for purging back, it returns as an operator-view-only control on the
table, per the rule above.

### Jobs and runs: one list, one column, everything else derived

Decided 2026-08-17 with items 32/34. Jobs and subtasks ("runs" in UI copy)
became distinct things with **one new SharePoint column** — `ParentID` on
Tasks (note the capital D; confirmed at creation, and not the "ParentId" the
design proposed) — rather than a second list, a type column, or stored state
for the staging/In Progress split:

- A row with `ParentID` empty in staging is a **Job**; set, it is a **run** on
  a printer. Rows with it empty *on* a printer predate the model and behave
  exactly as before — **the migration story is that there is no migration**.
- Whether a job renders in Staging or In Progress is **derived from whether
  it has runs**. The parent is never PATCHed by assignment; the save layer's
  identity diff sees only the one new run row.
- Run names (`-A`, `-B`, … `-AA`) are parsed back out of titles to find the
  next letter. Accepted ceilings, marked in the code: deleting the *latest*
  run frees its letter for reuse, and renaming a parent after runs exist
  restarts lettering (duplicate titles are legal everywhere in this app).
  A counter column fixes both if they ever bite.
- Runs **snapshot** the job's request fields at creation; later edits to the
  job do not propagate. The frozen-notes rule (item 14) is preserved by the
  snapshot, which is why the job's own notes stay editable in its modal.
- The job **auto-completes** (and un-completes) from its runs — two-way
  automation with the same identity discipline as Busy/Ready.

*Why one column:* every alternative stored a fact that could be derived, and
every stored fact is a write the identity-diff save layer has to get right.
The one-column model adds exactly one write per assignment (the new row).

*Cost:* remaining quantity, block membership, and completion are recomputed
every render from the full task list — O(n) scans that are trivial at this
shop's scale (tens of rows) and would need memo restructuring at thousands.

### Batched auto-loading over list virtualization

Staging renders 60 cards and adds 60 more as you scroll. Virtualization would
scale further but complicates drag-and-drop and breaks browser find-in-page,
which operators use.

### Priority sorting beats manual order in staging

Within staging, tier order (Urgent → High → Normal → Low) always wins.
Dragging a card to the top of staging does not promote it — change its
priority instead. That part hasn't moved.

**What the tiebreaker *inside* a tier is has moved, 2026-08.** It was
`sortOrder` — manual drag order — until the shop asked for something more
predictable: need-by (soonest first), then created-at (oldest first,
undated/unstamped last in both passes). Order within a tier is now fully
computed rather than partly manual, so dragging a card within staging no
longer repositions it — see [ui-reference.md](ui-reference.md#staging-area).
`sortOrder` still exists on staging tasks and is still reindexed on
structural change, for the save layer's sake, but nothing reads it for
display order there anymore.

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

### Notifications fire client-side — no server needed

*(2026-08-17, item 12.)* Push notifications looked blocked by the no-server
decision: Teams activity feed notifications were assumed to need app-only
credentials, meaning a secret, meaning a server. They don't, because of a fact
about this app: **both notification triggers are user actions inside the app**
— a job starting to print (an operator drag) and a job being added to staging
(a designer submit). Whoever triggers the moment has an open, signed-in
session, so Graph `sendActivityNotification` can fire from there with the
delegated `TeamsActivity.Send` scope. No background layer, no secret, no
server; the settled no-server decision holds unchanged.

Accepted costs: no notification fires if the acting user's send fails or they
close the tab mid-action (best-effort, not queued), and the scope needs
another admin consent plus activity types in the Teams app manifest and a
republished package. Recipients: the job's creator comes from the row's
SharePoint author (deliberately not stored in any app column), extras from
`NotifyPeople` (plain text, not a Person column — see
[data-model.md](data-model.md)); the actor is skipped. The groundwork shipped
2026-08-17 (PRs #41–#45); the sends shipped 2026-08-18. They stay silent
until the `TeamsActivity.Send` consent is granted and the manifest declares
the activity types — the one-time steps are in
[operations.md](operations.md#enabling-the-activity-notifications-item-12).

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
