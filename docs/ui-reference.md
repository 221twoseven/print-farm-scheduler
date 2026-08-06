# Interface reference

What the board actually does, feature by feature. This is the behaviour spec:
when changing the interface, this is the description a change has to stay
consistent with (or deliberately update).

## The board, top to bottom

1. **Header** — purple bar, app name, live count of printers and tasks, and a
   gear opening **Shop layout**.
2. **In-progress bar** — a chip per printer that has at least one `In progress`
   task, in the printer's group colour, with a count. Reads "No printers have
   tasks in progress" when empty.
3. **Staging area** — the unassigned queue.
4. **Groups grid** — `groupsPerRow` groups across, each group holding its printer
   cards `printersPerRow` across.

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

## Staging area

The holding pen for jobs that have not been assigned to a printer. A task in
staging carries `printerId === "staging"`.

- **Search** — matches title, sent by, give to, and filepath.
- **Priority filter** — All / Urgent / High / Normal / Low.
- **Priority ordering** — Urgent first, then High, Normal, Low, with a small
  header the first time each tier appears. Manual `sortOrder` is the tiebreaker
  *within* a tier, never an override of it: a card dragged above an Urgent job
  does not become more urgent.
- **Batched loading** — 60 cards render initially (`STAGING_PAGE`), another 60
  each time the scroll nears the bottom. One flick of the wheel loads one batch,
  not one per scroll event. Chosen over virtualization so drag-and-drop and
  browser find-in-page keep working.
- **Collapse** — a chevron folds the whole panel.
- **Add task** — inline form.
- Drop a card anywhere on the panel to send it back to staging.

## Printer cards

Each card shows the printer name, its group chip in the group colour, and a
status control. Its top edge is coloured by **state**, not group — green means
"this machine will print".

- **Status** — Ready / Reserved / Maintenance, from the card control or the
  right-click menu. Moving a printer to **Maintenance** sends its queued jobs
  back to staging and greys out the card (but never the control that brings it
  back).
- **Specs** — an expandable panel with the five dropdowns (nozzle size, nozzle
  type, nozzle material, bed type, print material) plus free-text notes.
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

Collapsed cards are deliberately minimal: status dot, title, quantity, priority
flag, status pill, and ETA. Everything else lives in the detail modal — earlier
cards showed more and the feedback was that the board read as visually busy.

- **Click** — open the detail modal.
- **Drag** — move between printers and staging.
- **Right-click** — context menu.
- Overdue ETAs are called out on the card.
- A completed card is tinted and stops looking like live work.

### Detail modal

Every task field: title, quantity (stepper), status, priority, slice status, ETA
date and time, sent by, give to, filepath, print quality, print strength. Edits
commit on blur and on close; there is no Save button. Delete lives here too.

Tasks in staging hide the fields that only mean something once assigned.

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
- Drop **on a card** → the task inserts before or after it, depending on which
  half you release over; a coloured edge shows where it will land.
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
- Colour is assigned automatically from a fixed palette and is not individually
  assignable: group colour is identity, state colour is state.
- **Add group** / **Add printer**; removing a group uses an explicit remove mode
  and a confirmation, since it takes its printers with it.

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
