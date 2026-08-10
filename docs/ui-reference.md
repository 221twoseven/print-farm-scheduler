# Interface reference

What the board actually does, feature by feature. This is the behaviour spec:
when changing the interface, this is the description a change has to stay
consistent with (or deliberately update).

## The board, top to bottom

1. **Header** — purple bar, app name, live count of printers and tasks, the
   **build stamp**, the **view toggle**, and a gear opening **Shop layout**
   (operator view only).

   The **build stamp** reads `build <version>` after the counts, and repeats on
   the sign-in screen so a tab that never loads the board can still report which
   code it is running. It comes from the `BUILD` constant at the top of
   `print-farm-scheduler.jsx`, which is **bumped by hand in every commit that
   changes that file**. Compare it against the version that was merged to tell a
   not-yet-deployed change apart from a cached tab — see
   [operations.md](operations.md#deploying-a-change). It is deliberately plain
   text, not a link or a control: it is diagnostic, and nothing acts on it.
2. **In-progress bar** — a chip per printer that has at least one `In progress`
   task, with a count, in the `In progress` status blue. Reads "No printers have
   tasks in progress" when empty.
3. **Staging area** — the unassigned queue.
4. **Jobcode filter** — dims every printer not working the selected jobcode.
   Hidden entirely when no assigned job carries one.
5. **Groups grid** — `groupsPerRow` groups across, each group holding its printer
   cards `printersPerRow` across.
6. **Completed jobs panel** — designer view only, fixed to the bottom of the
   screen.

## Operator view and Designer view

A toggle in the header. **Operator view** is the board as built. **Designer
view** hides everything that configures the shop or assigns work:

| Hidden in designer view | Still available |
| --- | --- |
| Shop layout gear | Staging area, in full — search, filters, **New task** |
| Printer settings button and right-click menu | The whole board, readable throughout |
| Printer status control — shown as a plain pill, not a menu | Printer status is still *legible*: a machine in maintenance looks it |
| **Add task** on a printer | Jobcode filter |
| Specs summary | Task detail modal **for staging jobs**, fully editable |
| Add / Remove group, Edit printers mode (add/remove printers), group rename, **printer rename** | Context menu on staging jobs — slicing, duplicate, delete (priority and everything else is set in the detail modal, via Edit details) |
| Dragging a task onto a printer, and **Move to** in the context menu | — (dragging *within* staging no longer reorders anything, in either view: staging order is computed) |
| **Assigned jobs entirely**: no detail modal, no context menu, no drag | **Operator notes**, via the note icon on the card — hover reads it. **Completed jobs**, read-only, via the bottom completed-jobs panel |

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
views, but in **operator view only**, staging cards stop opening the detail
modal and drop their right-click menu — reading the summary is enough, and
editing an unassigned job is the designer's. **Designer view keeps staging
fully editable**, per the table above. Dragging a staging card onto a printer
still works in both views; only the click-to-open and the context menu lock.

The choice is remembered per browser (`localStorage`), unlike group collapse
which resets each load — somebody who works as a designer should stay one
without re-picking every morning. It is still per-person and still nothing
SharePoint knows about.

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
third setting stored in the same list.

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
- Per-person and not stored, like group collapse and the staging filters.
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
- **Add task** — inline form. Jobcode, task name, sent by, give to and filepath
  are all required; **Add task** stays disabled until every one is filled in.
- Drop a card anywhere on the panel to send it back to staging.
- **Operator view only**: the collapsed card also shows jobcode and quantity,
  grey, on the same line as need-by (see "One asymmetry runs the other way"
  above).

## Completed jobs panel (designer view)

Designer view hides every assigned job's card entirely, including finished
ones — this panel is the one place that history stays visible there. Fixed to
the bottom of the screen, but stops short of the bottom-right corner so it
never sits under the save-status pill (with the **Retry** link) that floats
there in every view. Collapsed by default so it doesn't compete with the
groups grid for space; a chevron on its bar expands it.

- **Every task with status Complete, across every printer** — not scoped to
  one group or printer.
- **Sort: most recently completed first.** A job with no completion stamp (or
  an unparseable one) sorts last regardless — same "missing sorts last"
  principle staging's need-by/created-at tiebreakers use, just applied to a
  newest-first order instead of soonest-first.
- **Columns**: Printer, Jobcode, Job, Qty, Priority, Need by, Completed,
  Notes (an icon, hover reads the operator's note — same convention as the
  card). Blank where a task has no value for that column, not omitted.
- **Read-only, like every assigned job in designer view** — no click, no
  drag, no context menu; the table exists to show history, not to edit it.
- **Batched loading**, same pattern and page size as staging (`COMPLETED_PAGE`,
  60 rows).
- Not shown in operator view — the printer's own Completed section (below)
  already covers this for that view.

## Printer cards

Each card shows the printer name, a task count, and a status control. Its top
edge is coloured by **state** — green means "this machine will print". The card
carries no group marker at all: neither the name nor a colour. Which group a
printer belongs to is answered by the group it is sitting in.

- **Status** — Ready / Reserved / Maintenance, from the card control or the
  right-click menu, plus **Busy**, which the app sets and you cannot choose. A
  printer running a job shows Busy and goes back to Ready when nothing is
  running; setting Reserved or Maintenance yourself overrules that for as long
  as you leave it set. Busy still takes new queued work — a printer mid-print is
  where the next job belongs. Moving a printer to **Maintenance** sends its
  queued jobs back to staging and greys out the card (but never the control that
  brings it back).
- **Reserved and Maintenance refuse to start work.** "In progress" is greyed in
  the task context menu and the detail modal, with the reason in its tooltip.
- **Specs summary** — the collapsed line reads **Standard setup** when every
  spec matches the shop default, and otherwise lists **only the fields that
  differ**, each as `Setting: value` — "Nozzle size: 0.2mm", "Bed type: Smooth".
  A printer at defaults except its plate shows one chip. Where a material was
  typed in by hand, the chip shows the typed name rather than "Other", which is
  the reason for asking for it.
- **Specs** — expanding the summary shows all five dropdowns (nozzle size,
  nozzle type, nozzle material, bed type, material) plus free-text notes,
  whether or not they are exceptions. Setting material to **Other** reveals a
  box for naming the actual material — "Other" alone does not tell an operator
  what is loaded.
- **Queue** — active (non-complete) jobs. Two slots are visible by default with a
  "+N more" expander; the queue force-opens if the task being edited sits below
  slot 2.
- **Completed** — finished jobs collapse into a separate section at the bottom
  and stop consuming an active slot. **Clear completed** purges them (with a
  confirmation).
- **Empty state** — reads "No active jobs", "Reserved — no new jobs", "Out for
  maintenance", or "Drop task here" while dragging.
- Deleting a printer sends its tasks to staging rather than deleting them.

## Task cards

Collapsed cards are deliberately minimal: title, quantity, priority flag,
status pill, the need-by date when one is set, and the ETA. Everything else
lives in the detail modal — earlier cards showed more and the feedback was that
the board read as visually busy. There is no status dot: the pill beside it
already says the same thing in words.

- **Click** — open the detail modal.
- **Drag** — move between printers and staging.
- **Right-click** — context menu.
- **Overdue** — an ETA in the past on an unfinished job turns the date red and
  adds a small `OVERDUE` line beneath it. The word is there because red is not
  self-explanatory on this board: it also marks urgent priority and destructive
  actions, so a red date alone does not say *why*. A **Complete** job is never
  overdue however old its ETA, and a passed **need-by** date is not called
  overdue — on this board that word means the ETA has passed.
- **Need by** shows on staging cards too, unlike the ETA: a deadline exists from
  the moment the job does, while an ETA only means something once the job has a
  printer. It renders only when a date is set, so cards without one look exactly
  as they did.
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

Every task field: title, jobcode, quantity (stepper), status, priority, print
material, slice status, need-by date, ETA date and time, sent by, give to,
notes, operator notes, filepath, print quality, print strength. The task's print material is what the
job asks for, and is separate from what a printer is loaded with. Edits commit
on blur and on close; there is no Save button. Delete lives here too.

Closes on the X, on Escape, or on a click on the dimmed backdrop. Selecting text
inside the panel and releasing outside it is a drag, not a click, and leaves the
modal open — the same applies to the shop layout and confirmation dialogs.

Tasks in staging hide the fields that only mean something once assigned.

A small grey line above the footer reads **Created** with a timestamp, and
**Completed** alongside it once the job has one — read-only facts, not fields
anyone edits. Completed disappears again if the job leaves `Complete`.

### Context menu

**On a task:**

- Set status (Not started / In progress / Complete) — hidden while in staging.
- Slicing (Sliced / Not Sliced / Needs Nesting).
- Move to — staging, or any **Ready** printer, labelled with its group. Reserved
  and Maintenance printers are not offered; if none are Ready it says so.
- Edit details, Duplicate task, Delete task.

**On a printer:** the three statuses with their explanations, and Delete printer
(tasks go to staging).

## Drag and drop

- Drop on a **column's open area** → the task moves to that printer, at the end
  of its queue.
- Drop **on a printer card** → the task inserts before or after it, depending on
  which half you release over; an accent-coloured edge shows where it will
  land. **Staging cards don't accept this** — staging's order is computed, not
  manual (see Staging area above), so there's nothing for a drop position to
  do. Dropping anywhere on the staging panel still sends a task there, just not
  onto a specific card within it.
- Only **Ready** printers and staging accept drops. Drops elsewhere are ignored,
  not queued.
- Moving a task **out of staging onto a printer opens its detail modal**, because
  a job being assigned is the moment its ETA and status need setting.
- Drag state is cleared globally on `dragend`/`drop`, because a dragged card can
  unmount mid-drop and leave the board greyed out otherwise.

## Groups

- Click the header to collapse or expand. **Collapse is per-person and is not
  saved** — folding a group is one operator's view, not a fact about the shop.
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

Destructive actions — deleting a group, deleting a printer, clearing completed
jobs — go through `ConfirmDialog` and name what will happen to the contents.
Deleting a single task does not, because the context menu already requires two
deliberate clicks.

## Saving

A pill in the bottom-right reads **Saving… / Saved / Not saved**. Hover it for
the change count or the Graph error; on error it offers **Retry**. The signed-in
account and a **Sign out** link live in the same pill. Closing the tab with a
write in flight raises the browser's "leave site?" prompt.
