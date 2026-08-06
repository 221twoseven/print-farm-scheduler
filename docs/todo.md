# To-do

Working list of bugs and feature requests, ordered **simplest first**. Numbers in
parentheses are the item's position in the original request, so the two lists can
be cross-referenced.

Each entry records what changes, where, whether SharePoint needs a parallel
change, and what could break. Tick items off as they merge.

**Risk** is blast radius if the change is wrong, not effort:

- **Low** — a visual change; worst case it looks wrong and is obvious immediately.
- **Medium** — touches stored data or several components; a mistake could write
  bad rows or break a workflow, but is recoverable.
- **High** — touches the save layer, auth, or a settled decision; a mistake could
  lose work or take the board down for everyone.

---

## SharePoint work, all in one place

Every column below has to exist **before** the matching code change ships, or
`checkSchema()` refuses to load the board. Batch them in one sitting if you like.

| List | Column | Type | Needed by |
| --- | --- | --- | --- |
| Tasks | Jobcode | Single line of text | [4](#4-jobcode-field-on-tasks-6) |
| Tasks | NeedByDate | Date and Time | [5](#5-need-by-date-on-tasks-5) |
| Tasks | PrintMaterial | Choice — `ABS`, `Other (Discuss with Operator)` | [6](#6-split-print-material-between-printer-and-task-8) |
| Printers | PrintMaterialOther | Single line of text | [6](#6-split-print-material-between-printer-and-task-8) |
| Printers | Active *(existing)* | add `Busy` to the choice values | [8](#8-busy-printer-status-1) |

**After creating each column, send me its internal name** — List settings → click
the column → the `Field=` value at the end of the address bar. Do not assume it
matches the display name; that assumption has already cost this project two
debugging cycles. See [data-model.md](data-model.md).

Note that `PrintMaterial` on **Tasks** is a new column even though a column of
that name already exists on **Printers** — different lists, no clash.

The `Active` change is different from the rest: it is an edit to an existing
choice column, and until `Busy` is one of its values SharePoint will reject any
row trying to store it.

---

## Tier 1 — no SharePoint, low risk

Three quick wins. These can go out as a single PR.

### 1. Modal closes when a text selection drags outside it (3)

**Risk: Low.** Confirmed bug, and the cause is exactly what the symptom suggests.

Both modals close on a backdrop `onClick` (`TaskDetailModal`, and the shop layout
modal in `PrintFarmScheduler`). A click "belongs" to the element where the mouse
*released*, so selecting text inside the modal and releasing past its edge closes
it — losing the edit in progress.

Fix: only close when the press *and* the release both land on the backdrop —
record the `mousedown` target and check it on `mouseup`. Apply to both modals.

### 2. Remove the group name from printer cards (9)

**Risk: Low.** Deleting the group chip in `PrinterColumn`; the task count beside
it stays.

Group identity is already carried by the card's colour and the group header above
it, so the chip is redundant. Its styling gets reused in item 7 — worth doing
these two in sequence.

### 3. Label the ETA on assigned task cards (4)

**Risk: Low.** The card renders `formatEta(...)` bare, so a reader cannot tell
whether the time is when the print starts or when it finishes.

**Decide before starting:** what the label should say. "ETA", "Est. finish" and
"Due" all read differently on a card, and this becomes more pointed once item 5
adds a second date — so pick the wording for both at the same time.

---

## Tier 2 — one new stored field each

Both follow the documented recipe: column → `COLS` → both mappers → form → modal.
Mechanical, but a partial change fails at **load**, not at save, so the board goes
down for everyone until the missing piece lands. Ship each with its column
already in place.

### 4. Jobcode field on tasks (6)

**Risk: Medium** — new stored field. **Blocks item 9.**

Single line of text, no hint text, on both the new-task form and the detail modal.
Typically 5 characters (`XX000`), but nothing enforces that unless you want it to.

**Decide before starting:** whether jobcode should join the staging search
(currently title / sent by / give to / filepath). It seems obviously useful, and
it is a one-line change while I am already in that function.

### 5. Need-by date on tasks (5)

**Risk: Medium** — new stored field, plus a question about existing behaviour.

Same shape as `EtaDate`, including the noon-UTC write — the reason for that is in
[data-model.md](data-model.md#dates) and it is not optional.

**Decide before starting:** what happens to "overdue". `isOverdue()` currently
keys off `etaDate`. If need-by is the real deadline and ETA is the predicted
finish, then overdue should probably mean *ETA is later than need-by*, which is a
more useful signal than either date alone — but it is a behaviour change to
existing cards, so I want it to be your call rather than a side effect.

---

## Tier 3 — moderate

### 6. Split print material between printer and task (8)

**Risk: Medium.** Two SharePoint columns, and it touches the printer settings
panel, the new-task form and the detail modal.

- **Printers:** keep the choice, add a free-text box that applies when `Other` is
  selected, so an operator can name the actual material instead of leaving it as
  "Other".
- **Tasks:** gain their own material dropdown (`ABS`, `Other (Discuss with
  Operator)`), which is what a designer requesting the job specifies.

Do this **before** item 7 — a manually entered material counts as an exception in
the summary line, so doing it after means reworking that logic.

### 7. Printer settings summary: "Standard setup" plus exceptions (10)

**Risk: Medium.** Display-only, but the logic has a trap in it.

Today the summary joins all five fields and truncates with "…" on narrow cards.
Instead: if every field matches its default, read `Standard setup` in grey
italics; otherwise list only the fields that deviate, styled like the group chip
being removed in item 2.

The defaults already exist in code as `defaultPrinterFields()` — 0.4mm, Standard,
Standard, Textured, ABS.

**The trap:** "default" is currently a code constant, while the dropdown options
come from SharePoint. If the shop edits a choice column so that a default value
no longer exists, every printer silently reads as an exception. Worth deciding
whether the defaults should also come from SharePoint, or whether the code
constant is the intended source of truth. I lean toward leaving it in code and
documenting it, since "standard setup" is a shop convention rather than data.

### 8. Busy printer status (1)

**Risk: Medium-High.** This one needs decisions before any code.

Adding a fourth value to `PRINTER_STATUSES` / `PRINTER_STATUS` is easy. The hard
part is that Busy is the first status the *app* sets on its own, and it collides
with the operator's manual control:

- **Does Busy accept new queued jobs?** A printer that is mid-print is exactly
  where you want the next job queued, so "accepts" is probably still true — but
  then Busy behaves unlike Reserved and Maintenance, which both refuse work.
- **What if the operator set Reserved and a job then starts?** Auto-switching to
  Busy silently discards a deliberate choice.
- **Revert to Ready when — any task completes, or all of them?** With two jobs
  queued and one finished, reverting is wrong.
- **What if the operator manually changes status while Busy?** Manual should
  presumably win until the print ends.

My recommendation: Busy accepts work, is set only when a task moves to *In
progress*, reverts to Ready only when no task on that printer is *In progress*
any more, and never overrides Maintenance. But this is a workflow question about
your shop, not a code question, so tell me how it should behave.

This also touches [decisions.md](decisions.md) — the three-state control was a
deliberate simplification of an earlier four-state mess. Adding a fourth state
that the app manages is defensible, but it is reopening that decision knowingly,
and the doc should record why.

### 9. Display filter by jobcode (11)

**Risk: Medium.** Depends on item 4.

A filter block between staging and the printer groups: a dropdown of jobcodes for
tasks currently assigned or in progress; selecting one greys out every printer
*without* a task carrying that jobcode.

**Decide before starting:** whether the grey overlay is purely visual or should
also block interaction. Purely visual is simpler and safer — a dimmed printer that
silently refuses drops is the kind of thing that reads as a bug.

Per-person view state, not stored, same as group collapse.

### 10. Designer view / Operator view (12)

**Risk: Medium-High.** Not conceptually hard, but it reaches into nearly every
component, which makes it easy to miss a control.

Designer view hides: printer settings button, Add Task on printers, Add/Remove
Group, group rename, the shop layout gear, the settings summary — and disables
click/drag task assignment. Toggle sits in the top bar next to the gear.

**Two things to be clear about up front:**

1. **This is not a permission boundary.** Anyone can flip the toggle, and the
   underlying data is unchanged. It reduces clutter and prevents accidents; it
   does not stop a determined designer from reassigning a print. Real enforcement
   would need SharePoint permissions and a server-side check, which this app
   deliberately does not have. Worth stating plainly so nobody assumes otherwise.
2. **Should the choice persist per person?** Group collapse set the precedent —
   per-person and not stored at all, so it resets each load. A view mode probably
   wants to be stickier than that; `localStorage` keeps it per-person without a
   SharePoint column. Your call.

Best done **last** of the interface items — every earlier item adds or removes
controls that this one has to know how to hide.

---

## Tier 4 — needs a decision before any code

Both of these are larger than everything above combined, and both push against
the architecture rather than sitting inside it. Neither should be started on the
same branch as anything else.

### 11. Live auto-refresh across users (2)

**Risk: High.** The single biggest change on this list.

The board loads once at sign-in and never looks again, which is why your native
board app updates live and this one does not. Today, two people editing the same
row is last-writer-wins and neither sees the other's change until reload —
recorded as a known gap in [decisions.md](decisions.md#open-items).

Polling Graph on a timer is the easy half. The hard half is what happens to
someone mid-edit when new data arrives:

- The save layer diffs against `saved.current` **by object identity**. Replacing
  state wholesale from a poll resets that baseline and can either resurrect
  deleted rows or fire a storm of pointless PATCHes.
- Someone with a detail modal open, or a card half-dragged, cannot have the row
  yanked out from under them.
- Merging has to be per-row: take remote changes for rows this person has not
  touched, keep local for rows they have.

Genuinely doable, and worth doing — but it needs a design discussion first, and
it should land on its own with nothing else in the branch. Graph throttling
(HTTP 429) also becomes a live concern with 10–15 clients polling; the retry
logic already handles it, but the interval needs choosing with that in mind.

### 12. Teams user assignment and push notifications (7)

**Risk: High — likely blocked by the no-server decision.**

Two halves, and they are not equally feasible:

- **Assigning to a Teams user** is plausible. It needs an extra Graph permission
  to list people (`User.Read.All`, delegated, admin consent) and a new column to
  store the assignee. That is a bigger ask of your sysadmin than the current
  `Sites.ReadWrite.All`, but it fits the existing shape.
- **Push notifications for job created / started / finished** almost certainly do
  not fit. Teams activity feed notifications need application-level credentials —
  a bot registration or an app-only token — which means a server holding a
  secret. That is the one thing this app has never had, and adding it changes the
  deployment model from "commit files to a static host" to "run and maintain a
  backend", along with everything that implies for whoever inherits it.

**Before I build anything here, I need to research current Graph and Teams
capabilities and come back with concrete options and costs** — including whether
something lighter (an adaptive card posted to the channel, say) gets you most of
the value without a server. Treat this item as "investigate and report", not
"implement".

---

## Suggested sequencing

1. **PR 1** — items 1–3. No SharePoint, immediate wins.
2. **Create the Tasks columns** (Jobcode, NeedByDate), send me the internal names.
3. **PR 2** — items 4–5.
4. **Create the material columns**, send internal names.
5. **PR 3** — item 6, then **PR 4** — item 7.
6. **Decide the Busy behaviour**, add the choice value, then **PR 5** — item 8.
7. **PR 6** — item 9.
8. **PR 7** — item 10, once the interface has stopped moving.
9. **Then** tackle 11 on its own, and treat 12 as research.

Items 1–3 need nothing from you but the ETA wording, so that PR can go out as
soon as you pick it.
