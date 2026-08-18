# Interface reference

What the board actually does, feature by feature. This is the behaviour spec:
when changing the interface, this is the description a change has to stay
consistent with (or deliberately update).

## Terminology

The shop's words, confirmed 2026-08-17 (todo item 35). Docs and UI copy should
use these; the code and SharePoint still say "task" everywhere, and the
internal names stay that way — renaming stored names to look right is
explicitly warned against (CLAUDE.md rule 3, [data-model.md](data-model.md)).

- **Jobcode** — the *project*: `XX000`, where `XX` identifies the client
  (`HE` = Hermes) and `000` is that client's sequential project number
  (`HE270` = Hermes' 270th project). Nothing enforces the format today.
- **Job** — the production of all of one unique part for a project
  (PropPart1, total qty 100), raised by a designer into staging. Under todo
  item 32 its name becomes a persistent ID.
- **Subtask** (a *run* in UI copy) — one print run of part of a Job on one
  printer (PropPart1-A, qty 10), created by the operator at assignment.
  Distinct rows since item 32; rows that predate the model still play both
  roles and behave as they always did.

The board keeps itself current: other people's changes appear within about a
minute (a hidden tab catches up the moment it is brought back). The row you
have open in the detail modal and a card you are dragging are never changed
under you — see
[decisions.md](decisions.md#live-refresh-polls-merges-per-row-and-only-writes-what-a-person-did).

## The board, top to bottom

1. **Header** — purple bar, app name, live count of printers and jobs (rows
   without a parent — runs are part of a job, not counted twice), the
   **build stamp**, the **view toggle**, and a gear opening **Shop layout**
   (operator view only).

   The **build stamp** reads `v<app version> · build <version>` after the
   counts, and repeats on the sign-in screen so a tab that never loads the board
   can still report which code it is running. The app version is the Teams
   manifest version, from the hand-maintained `APP_VERSION` constant (bumped
   only when the package is republished from the Developer Portal); the build
   comes from the `BUILD` constant at the top of `print-farm-scheduler.jsx`,
   which is **bumped by hand in every commit that changes that file**. Compare it against the version that was merged to tell a
   not-yet-deployed change apart from a cached tab — see
   [operations.md](operations.md#deploying-a-change). It is deliberately plain
   text, not a link or a control: it is diagnostic, and nothing acts on it.
2. **Staging area** — jobs not yet assigned anywhere.
3. **In progress jobs** — jobs with at least one run on a printer (item 34).
   Hidden entirely when empty.
4. **Jobcode filter** — dims every printer not working the selected jobcode.
   Hidden entirely when no assigned job carries one.
5. **Groups grid** — `groupsPerRow` groups across, each group holding its printer
   cards `printersPerRow` across.
6. **Completed jobs panel** — the last block on the board, in both views.

## Operator view and Designer view

A toggle in the header. **Operator view** is the board as built. **Designer
view** hides everything that configures the shop or assigns work:

| Hidden in designer view | Still available |
| --- | --- |
| Shop layout gear | Staging area, in full — search, filters, **New job** |
| Printer settings button and right-click menu | The whole board, readable throughout |
| Printer status control — shown as a plain pill, not a menu | Printer status is still *legible*: a machine in maintenance looks it |
| **Add job** on a printer | Jobcode filter |
| Specs summary | Task detail modal **for staging jobs**, fully editable |
| Add / Remove group, Edit printers mode (add/remove printers), group rename, **printer rename** | Context menu on staging jobs — slicing, duplicate, delete (priority and everything else is set in the detail modal, via Edit details) |
| Dragging a task onto a printer, and **Move to** in the context menu | — (dragging *within* staging no longer reorders anything, in either view: staging order is computed) |
| **Assigned jobs entirely**: no detail modal, no context menu, no drag | **Operator notes**, via the note icon on the card — hover reads it. **Completed jobs**, read-only, via the completed-jobs panel at the foot of the board |

**The dividing line is assignment.** A job in staging belongs to the designer
who raised it and stays fully editable. The moment it is on a printer it is the
operator's, and in designer view its card becomes inert — click it and nothing
happens.

**This is not a permission boundary.** The toggle is one click for anybody and
the data is untouched. It removes clutter and prevents accidents; it does not
stop a determined designer from reassigning a print. Real enforcement would need
SharePoint permissions and a server-side check, which this app deliberately does
not have. Do not describe it to anyone as access control.

**One asymmetry runs the other way.** Staging is normally identical in both
views, but in **operator view only**, clicking a staging card opens the detail
modal as a **read-only preview**: every designer-set field is visible, none is
editable, Delete is replaced by a "Preview — assign to a printer to edit"
note, and the right-click menu stays locked — an operator gets to see a job's
full specs before assigning it, but editing an unassigned job is the
designer's. **Designer view keeps staging fully editable**, per the table
above. Dragging a staging card onto a printer still works in both views.

The choice is remembered per browser (`localStorage`) — somebody who works as
a designer should stay one without re-picking every morning. Group collapse
and the completed-jobs fold are remembered the same way. All of it is
per-person and nothing SharePoint knows about: one person folding a panel
never changes anyone else's board.

Three things are hidden that the original request did not list — **Edit
printers mode** (which is where adding and removing printers now lives), the
**printer right-click menu**, and the **status control** — because leaving
them would have made the mode pointless: a designer could still delete a printer
or put one into maintenance.

## Shop layout (gear icon)

Two settings, both stored in the SharePoint Settings list and shared by everyone:

- **Printers per row, within a group** (1–8) — a group of 4 shown 2-wide renders
  as a 2×2 block.
- **Groups per row** (1–6).

Plus **Reset to default** (2 and 3). This is deliberately a set-once, buried
config — it matches the board to the shop's physical arrangement, not to personal
taste.

The staging area's name is edited in place on the staging header, and is the
third setting stored in the same list. Like the other two it is **operator
view only** — the pencil is hidden in designer view, because renaming it
renames it for everybody.

## Jobcode filter

A strip between staging and the groups, offering every jobcode currently on a
printer. Selecting one **dims every printer that is not working that jobcode**,
so a board of twenty machines answers "who has XX000?" at a glance. A count of
matching printers and a **Clear** link sit beside the dropdown.

- **The dropdown only lists live work** — jobs assigned to a printer and not
  yet Complete. A jobcode sitting in staging is not offered, because the filter
  dims printers and an unassigned job says nothing about one.
- **Dimming is purely visual.** A dimmed printer still accepts drops, clicks and
  every menu — a card that looks disabled but silently refuses work reads as a
  bug.
- **The selection clears itself** if its jobcode stops being live, rather than
  leaving the board dimmed against something that no longer exists.
- Per-person and not stored anywhere — it resets on reload, like the staging
  filters.
- The whole strip is hidden when no assigned job has a jobcode.

## Staging area

The holding pen for jobs that have not been assigned to a printer. A task in
staging carries `printerId === "staging"`.

- **Search** — matches title, jobcode, sent by, give to, and filepath.
- **Priority filter** — All / Urgent / High / Normal / Low.
- **Priority ordering** — Urgent first, then High, Normal, Low, with a small
  header the first time each tier appears. **Order within a tier is fully
  computed, not manual**: soonest need-by first, then oldest-created first as
  the final tiebreaker (jobs with neither sort after ones that have them). A
  card dragged above an Urgent job does not become more urgent — that part
  hasn't changed — and dragging *within* a tier no longer reorders it either,
  since there's nothing left for a manual position to override. Dragging a
  card onto a printer, or onto the staging panel to send it back, both still
  work exactly as before.
- **Batched loading** — 60 cards render initially (`STAGING_PAGE`), another 60
  each time the scroll nears the bottom. One flick of the wheel loads one batch,
  not one per scroll event. Chosen over virtualization so drag-and-drop and
  browser find-in-page keep working.
- **Collapse** — a chevron folds the whole panel.
- **Add job** — inline form (the button reads **New job** in staging, **Add
  job** on a printer). Jobcode, job name, sent by, give to and filepath are
  all required; **Add job** stays disabled until every one is filled in.
  **Sent by** and **Give to** are single-select people pickers over the same
  directory as Notify (below) — they still store a plain display name in the
  same text columns, and fall back to free-text inputs if the directory can't
  be read, since a required field must never dead-end. When the directory *is*
  readable but nobody matches what was typed, the list offers one **Add
  "&lt;typed text&gt;"** row (Enter also takes it) — same escape hatch, for
  names outside the roster. Sent by prefills with
  the signed-in user; remove the chip to submit on someone else's behalf.
  **Notify when print starts** is an optional multi-select of people (chips
  plus a type-ahead, fetched once per session). Inside Teams the list is the
  roster of the team the tab is open in — managed by managing team
  membership, not Entra — falling back to the whole tenant elsewhere; guests
  and `[ARCHIVE]`-prefixed (departed) accounts are excluded either way.
  The signed-in creator shows as a pinned "you" chip — they are always
  notified and are not stored in the list; SharePoint already records them as
  the row's author. If the directory can't be read (no consent yet, seed
  mode), the field degrades to "Directory unavailable" and the form still
  works. When the job's **first run** is created (it starts printing), the
  creator and everyone in this list get a Teams activity-feed ping, minus
  whoever did the assigning; the send fires from that person's session, best
  effort, and needs the one-time setup in
  [operations.md](operations.md#enabling-the-activity-notifications-item-12).
- Drop a card anywhere on the panel to send it back to staging.
- Staging cards use the same three-row layout as assigned cards (title + status,
  jobcode, then quantity), minus the ETA — see "Task cards" below.

## In progress jobs (item 32/34, both views)

Jobs mid-production: at least one run on a printer, not yet complete. Sits
directly below staging, same chrome. Always visible: it used to hide when
empty, which read as the feature being missing (it caused a false alarm the
day it shipped); empty it reads "Nothing in progress — assign a staging job
to a printer."

**The model behind it (item 32):** dragging a job out of staging no longer
moves the row — it **creates a run** (a subtask) on the target printer, named
`<job>-A`, `-B`, … (`-Z`, then `-AA`), with quantity defaulting to the job's
remaining and the detail editor opening on the new run, exactly like the old
assign flow. The run copies the job's request fields at creation; **later
edits to the job do not propagate to runs already made**. The job itself
stays put and renders here instead of staging — that "move" is derived from
its runs, not stored.

- **Card face** (approved 2026-08-17): job name + a **"N of M left"** pill /
  jobcode / **need-by**. Need-by is back on this card type deliberately — the
  deadline is what drives assigning the rest. No ETA: a job spanning printers
  has no single one.
- **Runs list** — each card expands to its runs: name, printer, qty, status.
- **Remaining = total − every run so far, finished ones included.** It only
  ever goes down. A fully-assigned job can still take another run (a failed
  print needs a reprint); that run defaults to qty 1.
- **The job completes itself** the moment its total is fully assigned and
  every run is Complete — it leaves this block and joins the history table as
  a summary row (printer "—", qty = total). Reopening a run takes the stamp
  back off and brings it back here. Both directions are automation, like
  Busy/Ready on printers.
- **Interaction mirrors staging's view split**: designers click into the job
  (it is still their job data — total, need-by, priority) and get its context
  menu; operators drag it to a printer to assign another run.
- **A run never returns to staging** — staging holds jobs, not runs. Dropping
  one there is refused; deleting the run (context menu) is the deliberate way
  to un-assign it, and its quantity flows back into the job's remaining.
- Deleting a job with live runs orphans them: they keep printing and complete
  to the table as themselves. Nothing cascades.

## Completed jobs panel (both views)

The permanent, cross-printer record of finished work — one table sorted by
completion, and since item 31 the **only** job history: the per-printer
Completed sections are gone, and a job marked Complete leaves its printer card
immediately and appears here. Shown in **both views**: an operator and a
designer have equal reason to look up what shipped, and the panel carries no
control either shouldn't have (it has no purge button in either view — see
decisions.md).

It is an **ordinary block in the page flow**, the last one on the board, and
carries the same chrome as the staging panel, the jobcode filter and the group
cards: same side margins, rounded corners, white background, one-pixel border,
header row at the top with a chevron. It was originally anchored to the bottom
of the viewport, which made it read as browser furniture rather than as part of
the board. Collapsed by default so it doesn't compete with the groups grid for
space; the header expands it, and the fold is remembered per browser
(`localStorage`) like group collapse — one person expanding it never changes
anyone else's board.

- **Every task with status Complete, across every printer** — not scoped to
  one group or printer.
- **Grouped by job**: the primary rows are finished jobs (plus legacy tasks,
  orphaned runs, and runs whose job is still live — those stay top-level so
  no completed work hides behind a parent that isn't in the table). Clicking
  a job row expands its runs beneath it, chronological by completion,
  indented on a grey ground; collapsed, only the primary rows show. The
  header count is primary rows. Filters match the whole group — a job row
  stays when any of its runs matches (a job carries no printer of its own,
  so the printer filter would otherwise never show finished jobs), and an
  expanded job shows all its runs, not just the matches.
- **Sort: most recently completed first.** A job with no completion stamp (or
  an unparseable one) sorts last regardless — same "missing sorts last"
  principle staging's need-by/created-at tiebreakers use, just applied to a
  newest-first order instead of soonest-first.
- **Columns**: Printer, Jobcode, Job, Qty, Priority, Need by, Completed,
  Notes (an icon, hover reads the operator's note — same convention as the
  card). Blank where a task has no value for that column, not omitted.
- **Jobcode and Printer filters** — dropdowns above the table, same pattern as
  the board's main jobcode filter, and they compose (both set means both must
  match). Built from **the record itself**, not the live board — this is the
  permanent record, so a code whose last job finished long ago must still be
  selectable even though nothing on a printer carries it any more. Each
  dropdown hides when it has nothing to offer. A printer that has been deleted
  drops out of the filter (its completed jobs went back to staging and show
  "—" in the Printer column).
- **Read-only except for one action**: right-click a row → **Reprint job**,
  in both views — it queues a fresh copy of that row in staging (status Not
  started, fresh creation stamp, blank ETA/operator notes/completion), opens
  the detail editor on the copy (the copied quantity is a guess until someone
  confirms it — same reason Complete & reprint opens one), and changes
  nothing in the record. The original is deliberately never
  un-completed: the table is a record, not a queue, and a job whose runs
  still cover its quantity would just auto-complete itself again. A recalled
  **run** comes back as a standalone job (parent link stripped) — staging
  holds jobs, never runs. No click, no drag otherwise; the table exists to
  show history, not to edit it.
- **No purge control anywhere.** Clear history went with the per-printer
  sections (item 31, decided 2026-08-17): completed jobs are never removed
  from the UI. If the record ever genuinely needs trimming, that happens in
  the SharePoint list directly. See decisions.md.
- **Batched loading**, same pattern and page size as staging (`COMPLETED_PAGE`,
  60 rows). Paging is over the filtered rows, and a filter change resets it.

## Printer cards

Each card shows the printer name and a status control. Its top
edge is coloured by **state** — green means "this machine will print". The card
carries no group marker at all: neither the name nor a colour. Which group a
printer belongs to is answered by the group it is sitting in.

- **Status** — Ready / Reserved / Maintenance, from the card control or the
  right-click menu, plus **Busy**, which the app sets and you cannot choose. A
  printer running a job shows Busy and goes back to Ready when nothing is
  running; setting Reserved or Maintenance yourself overrules that for as long
  as you leave it set. Busy still takes new queued work — a printer mid-print is
  where the next job belongs. Moving a printer to **Maintenance** sends its
  queued legacy jobs back to staging and greys out the card (but never the
  control that brings it back). **Runs stay put through maintenance** — a run
  cannot live in staging, and deleting it would eat the operator's notes — so
  it rides out the downtime on the card, ready to be dragged to another
  printer or deleted deliberately.
- **Reserved and Maintenance refuse to start work.** "In progress" is greyed in
  the task context menu and the detail modal, with the reason in its tooltip.
- **Specs summary** — the collapsed line reads **Standard setup** when every
  spec matches the shop default, and otherwise lists **only the fields that
  differ**, each as `Setting: value` on **its own line** — "Nozzle size: 0.2mm",
  "Bed type: Smooth". A printer at defaults except its plate shows one line.
  Exceptions are styled exactly like "Standard setup" — grey italics, no chip
  or background — because both are the same kind of fact about the machine and
  used to look like two different kinds of thing. Where a material was typed in
  by hand, the line shows the typed name rather than "Other", which is the
  reason for asking for it. Each line keeps a hover tooltip, so a value too
  long for the card is still readable.
- **Specs** — expanding the summary shows all five dropdowns (nozzle size,
  nozzle type, nozzle material, bed type, material) plus free-text notes,
  whether or not they are exceptions. Setting material to **Other** reveals a
  box for naming the actual material — "Other" alone does not tell an operator
  what is loaded.
- **Queue** — active (non-complete) jobs. Two slots are visible by default with a
  "+N more" expander; the queue force-opens if the task being edited sits below
  slot 2.
- **Completed** — a job marked Complete leaves the card immediately and
  appears in the completed-jobs table at the foot of the board. Printer cards
  show live work only; there is no per-printer Completed section and no Clear
  history button (both removed by item 31 — the table is the only history,
  and nothing purges it from the UI).
- **Empty state** — reads "No active jobs", "Reserved — no new jobs", "Out for
  maintenance", or "Drop job here" while dragging.
- Deleting a printer sends its legacy tasks to staging; **its runs are
  deleted** (a run cannot live in staging), and their quantity returns to
  their job's remaining. The confirmation dialog states both counts.

## Task cards

Collapsed cards stay close to minimal — three rows, identical in staging and on
a printer except where noted:

- **Row 1** — title on the left, **status pill on the right**. Between them sit
  the note icon and the priority flag when present; they are small at-a-glance
  markers with nowhere else to go, not part of the name/status pairing. There is
  no status dot: the pill already says the same thing in words. The status pill
  shows on **every** card, staging included.
- **Row 2** — **jobcode, indented under the title** so the two read as related:
  the code belongs to the job named above it. Shown only when the task has a
  jobcode (required on new tasks, but older rows may lack one).
- **Row 3** — **ETA on the left, `Qty N` on the right.** ETA is assigned-cards
  only, since a prediction means nothing before a job has a printer; a staging
  card's row 3 is therefore just the quantity. Quantity always reads as `Qty N`,
  the same on every card.

**Need by is not on the card.** It lives in the detail modal. It used to sit on
a shared detail line; the three-row layout the shop asked for does not include
it, so it was dropped from the card face rather than squeezed in.

Everything else lives in the detail modal — earlier cards showed far more and
the feedback was that the board read as visually busy.

- **Click** — open the detail modal.
- **Drag** — move between printers and staging.
- **Right-click** — context menu.
- **Overdue** — an ETA in the past on an unfinished job turns the date red and
  adds a small `OVERDUE` line beneath it. The word is there because red is not
  self-explanatory on this board: it also marks urgent priority and destructive
  actions, so a red date alone does not say *why*. A **Complete** job is never
  overdue however old its ETA, and a passed **need-by** date is not called
  overdue — on this board that word means the ETA has passed.
- A completed card is tinted and stops looking like live work.
- **Note icon** — a small icon appears when the task carries an **operator
  note**; hovering reads it. The icon rather than hover alone, because hover
  cannot tell you *which* cards have a note. It is how a designer reads an
  operator's note without being able to open the job.

#### The two notes

- **Notes** is the requester's. Written in the new-task form or the modal while
  the job is in staging, and **frozen the moment it reaches a printer** — grey,
  read-only, for everyone including the operator. It is a record of what was
  asked for.
- **Operator notes** appears only once a job is assigned, and stays editable. A
  job in staging has no operator yet, so the field is not shown at all.

### Detail modal

Every task field: title, jobcode, quantity (number input), status, priority, print
material, slice status, need-by date, ETA (preset buttons), sent by, give to,
notify when print starts (jobs only, not runs — the same people picker as the
new-task form; a run inherits a snapshot nothing reads, so the field hides),
notes, operator notes, filepath, print quality, print strength. The task's print material is what the
job asks for, and is separate from what a printer is loaded with. Edits commit
on blur and on close; there is no Save button. Delete lives here too.

Closes on the X, on Escape, or on a click on the dimmed backdrop. Selecting text
inside the panel and releasing outside it is a drag, not a click, and leaves the
modal open — the same applies to the shop layout and confirmation dialogs.

Tasks in staging hide the fields that only mean something once assigned. In
**operator view**, the modal on a staging job is a read-only preview — all
fields shown, all disabled, no Delete (see "One asymmetry runs the other
way" above).

ETA has no date or time pickers — entry is four one-click preset buttons,
**Short / Medium / Long / Weekend**, each with its duration (~3 hrs, ~6 hrs,
~24 hrs, 2–3 days) as smaller text below the label. A click fills the stored
date and time with the actual finish instant — now plus the bucket's hours,
to the minute, with no business-hours or weekend rounding, because printers
run unattended. A readout line under the
buttons shows the resulting ETA (or "Not set") with a **clear** link, which is
the only way to unset one. The same control appears in the new-task form on
printer columns, with the buttons stacked two per row because the column is
too narrow for four across.

The assigned-task **Status** dropdown carries one extra entry beyond the three
statuses: **Complete & reprint** — the same action as the context menu's (see
below), included here because the dropdown is where an operator already is
when a run finishes. Pending edits flush into the finishing run first; the
modal then switches to the successor.

A small grey line above the footer reads **Created** with a timestamp, and
**Completed** alongside it once the job has one — read-only facts, not fields
anyone edits. Completed disappears again if the job leaves `Complete`.

### Context menu

**On a task:**

- Set status (Not started / In progress / Complete) — hidden while in staging.
- **Complete & reprint** (item 33) — an action riding under the statuses:
  completes this run and queues its successor on the same printer, next
  suffix letter, same quantity, and **opens the editor on it** so the
  quantity gets corrected before anyone reads it as fact. The successor gets
  its own ETA and operator notes (blank), and counts against the job like
  any run — which also keeps the job from auto-completing. Greyed once the
  task is already Complete (plain Duplicate covers the copy case). On a
  legacy task it duplicates "(copy)"-style instead of lettering.
- Slicing (Sliced / Not Sliced / Needs Nesting).
- Move to — staging, or any **Ready** printer, labelled with its group. Reserved
  and Maintenance printers are not offered; if none are Ready it says so. The
  staging entry is only offered on jobs — a run never sits in staging, so runs
  see printers only.
- Edit details, Duplicate, Delete — both labelled with the row's own word
  (**run** when the row has a parent, **job** otherwise). Duplicating a **run** gives the
  next suffix letter, not "(copy)" — it is a real new run, counted against
  its job, starting fresh (Not started, its own ETA and operator notes).
  Deleting a **job** deletes its runs with it.

**On a printer:** the three statuses with their explanations, and Delete printer
(legacy tasks go to staging; runs are deleted, their quantity returning to
their job).

**On a completed-jobs row:** one item, **Reprint job** — see the completed
jobs panel section. Both views.

## Drag and drop

- Drop a **staging or In Progress job** anywhere on a printer → a **run is
  created** there (item 32) and its editor opens; the job itself stays put.
- Drop an assigned task on a **column's open area** → it moves to that
  printer, at the end of its queue.
- Drop **on a printer card** → the task inserts before or after it, depending on
  which half you release over; an accent-coloured edge shows where it will
  land. **Staging cards don't accept this** — staging's order is computed, not
  manual (see Staging area above), so there's nothing for a drop position to
  do. Dropping anywhere on the staging panel still sends a task there, just not
  onto a specific card within it.
- Only **Ready** printers and staging accept drops. Drops elsewhere are ignored,
  not queued.
- Assigning **opens the new run's detail modal**, because a run being created
  is the moment its quantity, ETA and status need setting.
- Drag state is cleared globally on `dragend`/`drop`, because a dragged card can
  unmount mid-drop and leave the board greyed out otherwise.

## Groups

- Click the header to collapse or expand. **Collapse is per-person** — folding
  a group is one operator's view, not a fact about the shop, so it is never
  written to SharePoint. It is remembered per browser (`localStorage`), so a
  fold survives reload without touching anyone else's board.
- Rename in place via the pencil.
- Groups have no colour in the interface. A colour is still assigned and stored
  against each group, but nothing renders it — see
  [decisions.md](decisions.md). Group headers and their left band are neutral.
- **Add group**; removing a group uses an explicit remove mode and a
  confirmation, since it takes its printers with it.
- **Add or remove a printer**: both live behind an **Edit printers** toggle
  (bottom of the board, beside Remove group), not a standalone Add printer
  button. While it's active, a compact **Add** tile sits at the end of each
  group's grid and a small trash icon replaces the settings gear on every
  printer card — both wired to the printer add/delete that already existed,
  just reached differently. Normal board interaction on printers and their
  tasks (drag, click-to-expand a task, right-click menus) suspends while the
  mode is on, so a card being clicked mid-edit can't be mistaken for an
  accidental drag or open. A printer's own settings-panel delete button still
  works too, outside this mode.

## Confirmations

Destructive actions — deleting a group, deleting a printer — go through
`ConfirmDialog` and name what will happen to the contents.
Deleting a single task does not, because the context menu already requires two
deliberate clicks.

## Saving

A pill in the bottom-right reads **Saving… / Saved / Not saved**. Hover it for
the change count or the Graph error; on error it offers **Retry**. Closing the
tab with a write in flight raises the browser's "leave site?" prompt.

**That is all it carries** — no account name, no **Sign out**. The board only
runs inside a signed-in Teams session and machines aren't shared, so identity
is settled before the tab loads and there was nothing for either to do. See
[authentication.md](authentication.md#there-is-no-sign-out).
