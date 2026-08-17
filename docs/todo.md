# To-do

Working list of bugs and feature requests, ordered **simplest first**. Numbers in
parentheses are the item's position in the original request, so the two lists can
be cross-referenced. Items 1–14 trace to the original handoff request; items
15–24 to the 2026-08-07 follow-up; items 25–30 to the 2026-08-12 request;
items 31–35 to the 2026-08-17 request — each uses its own (N) sequence, so
cross-reference against whichever request you're reading.

Each entry records what changes, where, whether SharePoint needs a parallel
change, and what could break. Items are marked DONE as they merge.

Item numbers are stable identifiers, not positions — a later request can land in
an early tier without renumbering everything around it. Read the tier and the
order within it for what to do next; read the number when you need to refer to
an item.

**Tier numbers are the opposite**: they are positions, not identities, and they
renumber as work is re-sorted by effort. The decision-gated group has been Tier
4, then 8, and is Tier 11 today. Refer to items by number and tiers by name.

**Risk** is blast radius if the change is wrong, not effort:

- **Low** — a visual change; worst case it looks wrong and is obvious immediately.
- **Medium** — touches stored data or several components; a mistake could write
  bad rows or break a workflow, but is recoverable.
- **High** — touches the save layer, auth, or a settled decision; a mistake could
  lose work or take the board down for everyone.

Tiers are ordered by effort, low to high, and are where "sort by low-hanging
fruit" lives — read them top to bottom for what to pick up next.

---

## SharePoint work, all in one place

Every column below has to exist **before** the matching code change ships, or
`checkSchema()` refuses to load the board. Batch them in one sitting if you like
— that now includes the two new timestamp columns from the 2026-08-07 request.

| List | Column | Type | Needed by |
| --- | --- | --- | --- |
| ~~Tasks~~ | ~~Jobcode~~ | ~~Single line of text~~ | created — item 4, done |
| ~~Tasks~~ | ~~NeedByDate~~ | ~~Date and Time~~ | created — item 5, done |
| ~~Tasks~~ | ~~PrintMaterial~~ | ~~Choice — `ABS`, `Other (Discuss with Operator)`~~ | created — item 6, done |
| ~~Printers~~ | ~~PrintMaterialOther~~ | ~~Single line of text~~ | created — item 6, done |
| ~~Printers~~ | ~~PrintMaterial *(existing)*~~ | ~~reword choices to `ABS` / `Other`~~ | done |
| ~~Tasks~~ | ~~Notes~~ | ~~Multi-line text, plain~~ | created — requester's note, item 14 |
| ~~Tasks~~ | ~~OperatorNotes~~ | ~~Multi-line text, plain~~ | created — operator's note, item 14 |
| ~~Printers~~ | ~~Active *(existing)*~~ | ~~add `Busy`~~ | superseded — the column was replaced, see below |
| ~~Printers~~ | ~~Status *(new)*~~ | ~~Choice — Ready / Reserved / Maintenance / **Busy**~~ | created — replaces the old `Active`-named column. `Busy` is already a valid value; item 8 is now code-only |
| ~~Printers~~ | ~~Status (legacy)~~ | ~~delete~~ | deleted; the code fallback went with it in #19 |
| ~~Tasks~~ | ~~CompletedAt~~ | ~~Date and Time~~ | created — internal name confirmed as `CompletedAt`, matches display name; needed by item 20 |
| ~~Tasks~~ | ~~CreatedAt~~ | ~~Date and Time~~ | created — internal name confirmed as `CreatedAt`, matches display name; needed by item 21 (also feeds item 22's sort) |
| Tasks | *(parent-job link, per-subtask quantity, derived-ID pieces — names TBD)* | TBD | item 32 — **do not create yet**; the columns come out of the design proposal, which needs sign-off first. Same recipe as ever: column created → internal name confirmed → then code |

**After creating each column, send me its internal name** — List settings → click
the column → the `Field=` value at the end of the address bar. Do not assume it
matches the display name; that assumption has already cost this project two
debugging cycles. See [data-model.md](data-model.md).

Note that `PrintMaterial` on **Tasks** is a new column even though a column of
that name already exists on **Printers** — different lists, no clash.

The Printers status column was **replaced** rather than edited, so its internal
name would finally match its display name — see
[data-model.md](data-model.md#the-one-that-got-fixed). The new one already
carries `Busy`, so item 8 needs nothing further from SharePoint.

**`CompletedAt` and `CreatedAt` are a different kind of date from `EtaDate` /
`NeedByDate`.** Those two are user-picked calendar dates with no meaningful
time-of-day, which is why they're written at noon UTC — a workaround for a
date-only input, documented in [data-model.md](data-model.md#dates). Completion
and creation are machine-set *instants* with a real, meaningful time component
(`new Date().toISOString()`), so the noon-UTC fudge does not apply — write and
read the real timestamp, unmodified.

---

## Tier 1 — no SharePoint, low risk

Three quick wins. These can go out as a single PR.

### 1. Modal closes when a text selection drags outside it (3) — DONE

*Shipped in #3, deployed and confirmed in Teams 2026-08-06.* The confirmation
dialog turned out to have the same bug and was fixed with it.

**Risk: Low.** Confirmed bug, and the cause is exactly what the symptom suggests.

Both modals close on a backdrop `onClick` (`TaskDetailModal`, and the shop layout
modal in `PrintFarmScheduler`). A click "belongs" to the element where the mouse
*released*, so selecting text inside the modal and releasing past its edge closes
it — losing the edit in progress.

Fix: only close when the press *and* the release both land on the backdrop —
record the `mousedown` target and check it on `mouseup`. Apply to both modals.

### 2. Remove the group name from printer cards (9) — DONE

*Shipped in #5.* Note for item 7: the chip's styling is gone from the card but
recorded in that commit's diff if it is wanted back for the exception list.

**Risk: Low.** Deleting the group chip in `PrinterColumn`; the task count beside
it stays.

Group identity is already carried by the card's colour and the group header above
it, so the chip is redundant. Its styling gets reused in item 7 — worth doing
these two in sequence.

### 3. Label the ETA on assigned task cards (4) — NOT DOING

*Declined 2026-08-06. Built as #7, then closed unmerged.* "Est. finish" was
tried and rejected: **ETA is the shop's own word for it** and the board should
speak the shop's language, not a tidier one. Do not re-propose this.

The one thing it was meant to solve — telling the two dates apart once item 5
lands — is handled by "Need by" being unmistakably different from "ETA". What
does still need doing is in item 5: the add-task form's date inputs have no
visible label at all, which is survivable with one date and will not be with
two.

### 13. Retire group colour; colour means state or touch — DONE

*Shipped in #8.* Landed differently from how it was first raised, and the
reasoning is worth keeping.

The original ask was to make the printer card's top edge the **group** colour.
What it became: group colour retired from the interface entirely, and the top
edge **kept** its state colour. The reframing came from the shop — three colour
systems were running at once (group, printer state, task status) and none of
them read as meaning anything; the printer state colour, the one carrying real
information, was not legible as state until it changed in front of you.

Group is the system that went, on a fact that settles it: **a printer cannot
move between groups.** Colour was encoding something that never varies. What
remains follows one rule — colour means an interaction or a state, never an
identity:

- printer card top edge keeps state colour, now uncontested
- task status keeps colour but only with its word attached; the bare dot went
- group headers, in-progress chips, context menu swatches all neutral
- one `ACCENT` for focus, drag targets and active controls
- the only dots left sit inside the status control, beside their own labels

Group colours are still assigned and still round-trip through the `Color`
column; nothing renders them, so reversing this needs no schema change.
[decisions.md](decisions.md) records the superseded decision rather than
quietly dropping it.

**If the board reads flat** after a week of use, that is the signal to revisit —
and the reversal is cheap by design.

---

## Tier 2 — one new stored field each

Both follow the documented recipe: column → `COLS` → both mappers → form → modal.
Mechanical, but a partial change fails at **load**, not at save, so the board goes
down for everyone until the missing piece lands. Ship each with its column
already in place.

### 4. Jobcode field on tasks (6) — DONE

*Shipped in #10.* Internal name came back as `Jobcode`, matching the display
name. Jobcode joins the staging search — it is the most likely thing someone
types into that box. Item 9 is now unblocked.

**Risk: Medium** — new stored field. **Blocks item 9.**

Single line of text, no hint text, on both the new-task form and the detail modal.
Typically 5 characters (`XX000`), but nothing enforces that unless you want it to.

**Decide before starting:** whether jobcode should join the staging search
(currently title / sent by / give to / filepath). It seems obviously useful, and
it is a one-line change while I am already in that function.

### 5. Need-by date on tasks (5) — DONE

*Shipped in #10.* Internal name `NeedByDate`. Shows on staging cards as well as
assigned ones, and only when a date is set.

**The overdue question is now closed.** `isOverdue()` still keys off `etaDate`
only — the rule did not change. What changed in #15 is that the state is now
*named*: a small `OVERDUE` line under the date, because red alone was carrying
too much on a board that also uses it for urgent priority and delete actions.

Deliberately **not** done: making "overdue" mean *ETA later than need-by*. It
was proposed, considered, and dropped — the shop did not ask for a second
lateness rule, and one rule that everyone understands beats two that need
explaining. Reopen only if jobs start silently missing deadlines that the ETA
alone does not catch.

**Risk: Medium** — new stored field, plus a question about existing behaviour.

Same shape as `EtaDate`, including the noon-UTC write — the reason for that is in
[data-model.md](data-model.md#dates) and it is not optional.

**Decide before starting:** what happens to "overdue". `isOverdue()` currently
keys off `etaDate`. If need-by is the real deadline and ETA is the predicted
finish, then overdue should probably mean *ETA is later than need-by*, which is a
more useful signal than either date alone — but it is a behaviour change to
existing cards, so I want it to be your call rather than a side effect.

### 14. Requester notes and operator notes on tasks — DONE

*Shipped in #23.* Two multi-line plain-text columns on Tasks, `Notes` and
`OperatorNotes`, both internal names matching their display names.

The rule that makes them worth having separately: **the requester's note freezes
on assignment.** It is editable while the job sits in staging and read-only
afterwards for everyone, the operator included — a record of what was asked for,
and a record that can be rewritten is not one. The operator's note is the live
one, and does not appear at all until there is an operator on the job.

Designer view cannot open an assigned job, so an operator note would otherwise
be invisible to the person who raised it. A small note icon appears on any card
carrying one, with the text as its tooltip — the icon rather than hover alone,
because hover cannot tell you which cards have a note.

**Plain text, not rich text.** SharePoint's enhanced rich text returns HTML
through Graph, which would land on the board as visible markup.

---

## Tier 3 — moderate

### 6. Split print material between printer and task (8) — DONE

*Shipped in #11.* Internal names confirmed as `PrintMaterial` (Tasks) and
`PrintMaterialOther` (Printers) — both matching their display names. That is
now four columns in a row that matched, which is worth noting but not worth
trusting: the two that did not are still in this repo, and still cost a
debugging cycle each.

One optional SharePoint tidy-up remains: the Printers `PrintMaterial` choices
still read `ABS` / `Other (Discuss with Operator)`. Rewording the printer's to
`ABS` / `Other` matches the intent, but nothing breaks either way —
`isOtherMaterial` matches on the stem.

**Risk: Medium.** Two SharePoint columns, and it touches the printer settings
panel, the new-task form and the detail modal.

- **Printers:** keep the choice, add a free-text box that applies when `Other` is
  selected, so an operator can name the actual material instead of leaving it as
  "Other".
- **Tasks:** gain their own material dropdown (`ABS`, `Other (Discuss with
  Operator)`), which is what a designer requesting the job specifies.

Do this **before** item 7 — a manually entered material counts as an exception in
the summary line, so doing it after means reworking that logic.

### 7. Printer settings summary: "Standard setup" plus exceptions (10) — DONE

*Shipped in #14.* **The defaults stay in code** (`defaultPrinterFields()`), which
was the open question. "Standard setup" is a shop convention, not data — reading
it from the choice columns would make the first value of each list silently
become the standard. The accepted cost is the trap below: it is visible
immediately and fixed by editing one function.

Exceptions render as neutral chips, not group-coloured ones — group colour is
retired, and an exception is information rather than a state.

**The chips are gone as of item 26 (2026-08-12).** Exceptions now read as grey
italics, one per line, matching "Standard setup" — the two states of this line
are the same kind of fact and looked like two different kinds of thing. The
argument that produced chips still holds and is now served by stacking instead:
a wrapped row of values ran together at this card width and hid the one worth
reading. Everything else in this entry — defaults in code, the trap below —
is unchanged.

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

### 8. Busy printer status (1) — DONE

*Shipped in #18.* The shop's four answers reduced to one rule, which is what
made this simple in the end:

> **Automation only ever moves a printer between Ready and Busy.**

- Ready + a job starts → Busy; Busy + nothing running → Ready.
- Reserved and Maintenance are never touched by automation, so an operator who
  reserves a machine mid-print still has it reserved afterwards.
- Busy accepts new queued work — a printer mid-print is where the next job goes.
- Busy is not in the status picker. A manual Busy would snap back the moment
  nothing was running.

Also added, from the answer to "Reserved wins, no jobs can start": Reserved and
Maintenance now refuse to let a **queued** job be started, not just to accept new
ones. "In progress" is disabled with the reason in its tooltip rather than
hidden or silently ignored.

The reconciliation effect returns the same array when nothing moved — the save
layer diffs by identity, so anything else would PATCH every printer whenever a
task changed.

### 9. Display filter by jobcode (11) — DONE

*Shipped in #16.* Dimming is **purely visual** — the decision flagged when this
was written. A dimmed printer still accepts drops and clicks, because a card
that looks disabled and silently refuses work reads as a bug rather than a
filter.

Two details worth knowing: the dropdown offers only jobcodes on a printer and
not yet Complete, and the selection clears itself when its jobcode stops being
live, rather than leaving the board dimmed against nothing.

**Risk: Medium.** Depends on item 4.

A filter block between staging and the printer groups: a dropdown of jobcodes for
tasks currently assigned or in progress; selecting one greys out every printer
*without* a task carrying that jobcode.

**Decide before starting:** whether the grey overlay is purely visual or should
also block interaction. Purely visual is simpler and safer — a dimmed printer that
silently refuses drops is the kind of thing that reads as a bug.

Per-person view state, not stored, same as group collapse.

**Superseded by item 15 below**, which moves this block into its own container —
see that entry.

### 10. Designer view / Operator view (12) — DONE

*Shipped in #21.* Both questions answered in the building: the choice is
remembered per browser via `localStorage`, and the mode is **not** a permission
boundary — that is stated in [ui-reference.md](ui-reference.md) so nobody
describes it as access control.

Three controls are hidden that the request did not list — Add printer, the
printer right-click menu, and the status control. Leaving any of them would have
made the mode pointless: a designer could still delete a printer or send one to
maintenance. The status is still *shown*, as a plain pill, because knowing a
machine is down is not an operator privilege.

**Item 17 below asks for the same persistence this item already built** —
across a full Teams client restart rather than a page reload. Worth verifying
before writing new code.

---

## Tier 4 — no SharePoint, low risk (2026-08-07 request)

Three quick wins, same shape as Tier 1. Can go out together.

### 15. Give the jobcode filter its own container (9) — DONE

*Shipped in [PR #25](https://github.com/221twoseven/print-farm-scheduler/pull/25), merged 2026-08-07.*

**Risk: Low.** Layout only — no state or logic changes.

The jobcode filter strip currently sits directly under the staging area with no
breathing room, which reads as if it belongs to staging rather than being its
own board section (it isn't — it dims printers, and staging jobs aren't part of
what it filters). Give it its own bordered/rounded block, matching the visual
weight of the staging container and the group cards, with margin separating it
from both neighbours.

Purely visual — `liveJobcodes.length > 0` still decides whether it renders at
all, and nothing about `jobcodeFilter` / `jobcodeMatches` changes.

### 16. Require jobcode, task name, sent by, give to, and filepath on new tasks (8) — DONE

*Shipped in [PR #25](https://github.com/221twoseven/print-farm-scheduler/pull/25), merged 2026-08-07. Decided with the user: all five hard-block.*

**Risk: Low.** Client-side form validation in `AddTaskForm`; no schema change,
since all five columns already exist.

Today only the task name blocks submission (`if (!title.trim()) return;`).
Extend that guard to all five fields, and mark them visually as required so the
block isn't a silent dead click.

**Decided:** all five hard-block, rather than leaving `Give to` and `filepath`
merely encouraged. `AddTaskForm`'s Add task button disables until all five are
filled in, each marked with a trailing `*`. This does not touch existing tasks
— a blank field on a row already in SharePoint stays exactly as it is.

### 17. Confirm the view toggle survives a full Teams restart (3) — DONE

*Verified 2026-08-08, manually, in the actual Teams desktop client: closed and
reopened Teams, restarted the app, Designer/Operator view held. No code change
— item 10's `localStorage` persistence (shipped in #21) already covered this.*

**Risk: Low — verification task, not a code change.** Closed as confirmed.

---

## Tier 5 — moderate, no SharePoint (2026-08-07 request)

### 18. Operator-view staging cards: summary info, read-only (1) — DONE

*Shipped in [PR #25](https://github.com/221twoseven/print-farm-scheduler/pull/25), merged 2026-08-07.*

**Risk: Medium.** Changes what staging cards do in one view but not the other —
worth getting the split right.

Two changes, both **operator view only**:

- Show jobcode and quantity on the collapsed staging card in grey, alongside the
  need-by date that's already there. All three already exist on the task; this
  is display only.
- Staging cards stop opening the detail modal (and drop their context menu) in
  operator view — reading the summary is enough, and editing a job before
  assignment is the designer's job, not the operator's. Once a job is placed on
  a printer, the operator's own detail-modal access (already unaffected by
  designer/operator view) takes over.

**Decide before starting:** designer view keeps staging cards fully editable
either way — designers raise and edit jobs, and that's the one thing Designer
view is built to preserve (see [ui-reference.md](ui-reference.md)). Confirm that
reading before starting, since it inverts today's symmetric behaviour (staging
is currently editable in both views) for operator view only.

Follows the same `disabled` pattern already used for assigned-task cards in
designer view (`TaskCard`'s `disabled` prop) — the plumbing exists, this extends
it to a new case rather than inventing a new one.

### 19. Replace "Add printer" with an "Edit printers" mode (2) — DONE

*Shipped in [PR #25](https://github.com/221twoseven/print-farm-scheduler/pull/25), merged 2026-08-07. Decided: one global toggle, not per-group.*

**Risk: Medium.** Interaction change to a control every operator uses
regularly; get the affordance right before shipping.

- Remove the large dashed "+ Add printer" button under each group's printer
  grid.
- Add an "Edit printers" toggle next to the existing "Remove group" button
  (bottom of the board, operator view only) — same pattern as
  `removeGroupMode` today.
- While active: normal board interaction (drag, click-to-expand, context menu)
  suspends, and small add/remove icons appear inline on the printer grid — an
  add icon per group, a remove icon per printer card, both wired to the
  existing `addPrinter` / `askDeletePrinter` handlers.

**Decided:** one global toggle, mirroring `removeGroupMode`, per the default
above — not per-group.

No SharePoint change — `addPrinter` and `deletePrinter` already do the work;
this only changes how they're reached.

---

## Tier 6 — one new stored field each, plus a dependent (2026-08-07 request)

Same recipe as Tier 2. Columns are in the SharePoint table above.

### 20. Job completion timestamp (4) — DONE

*Shipped 2026-08-08.* `CompletedAt` created (internal name confirmed matching);
`updateTask` stamps it the instant a `status` patch sets `Complete`, and clears
it the instant a `status` patch sets anything else — including the ambiguity
this item flagged: a completed job moved back to `Not started` or `In
progress` loses its stamp, re-completing later writes a fresh one. No separate
history is kept. `copyTask` also resets it to blank on a duplicate, for the
same reason `createdAt` gets a fresh value there (see item 21).

**Risk: Medium** — new stored field, plus an automation question, now settled.

Displayed as a small grey line in the detail modal ("Completed Aug 8, 2026,
9:02 AM"), alongside `createdAt` — not asked for explicitly, but a timestamp
nobody can see anywhere felt like half a feature; easy to pull back out if
that's not wanted. Not shown on the collapsed card — keeping that minimal is a
settled decision (see [decisions.md](decisions.md)), and this is exactly the
kind of secondary fact item 23's completed-jobs table exists for.

### 21. Job creation timestamp (5) — DONE

*Shipped 2026-08-08.* `CreatedAt` created (internal name confirmed matching);
`addTask` stamps it once via `nowIso()`, `copyTask` gives a duplicate its own
fresh value rather than inheriting the original's. Displayed alongside
`completedAt` in the modal — see item 20.

**Risk: Medium** — new stored field.

**Fed item 22's sort**, landed in the same pass.

### 22. Staging sort: need-by, then created-at, as tiebreakers (7) — DONE

*Shipped 2026-08-08.* Both open questions resolved with the defaults this
entry proposed, since nobody objected before the SharePoint columns landed:

- Undated/unstamped jobs sort **after** dated/stamped ones in both the
  need-by and created-at passes — a missing value never jumps a real one.
- Manual reordering **within a tier is removed**, not left cosmetically inert.
  Staging `TaskCard`s no longer accept a relative drop at all (`onDropOnTask`
  isn't wired to them anymore); dragging a card onto a printer, or anywhere on
  the staging panel to send it back, is untouched.

Today's staging sort was priority tier (Urgent → High → Normal → Low), then
`sortOrder` — manual drag order — as the tiebreaker within a tier, a decision
recorded in [decisions.md](decisions.md#priority-sorting-beats-manual-order-in-staging).
That tiebreaker is now need-by (soonest first), then created-at (oldest
first). `decisions.md` records the change in place rather than as a fully
superseded entry, since the headline claim — priority beats manual order —
didn't change, only what breaks a tie within a tier did.

**Risk: Medium — changed a settled decision**, now recorded as changed.
Depended on item 21; both landed together.

---

## Tier 7 — larger build, no SharePoint (2026-08-07 request)

### 23. Designer view: scrollable completed-jobs table (6) — DONE

*Shipped 2026-08-10.* `CompletedJobsPanel`, fixed to the bottom of the screen,
designer view only — the one place completed jobs stay visible there, since
designer view otherwise hides assigned jobs (finished or not) entirely.
Read-only: no click, no drag, no context menu, matching every other assigned
job in that view.

Both open questions decided with the user before building: **most recently
completed first**, and **collapsible**, collapsed by default so it doesn't
compete with the groups grid on load. Columns: Printer, Jobcode, Job, Qty,
Priority, Need by, Completed, Notes — blank where a task has no value, not
omitted. Batched loading, same pattern and page size as staging
(`COMPLETED_PAGE`, 60 rows). Missing/unparseable `completedAt` sorts last
regardless of direction, same "missing sorts last" principle as staging's
tiebreakers.

**Risk: Medium.** New component, read-only — doesn't touch the save layer or
any mutation handler.

**Not verified in a browser** — this sandbox's egress still blocks the CDN
hosts the app loads (unpkg, esm.sh, cdn.tailwindcss.com), same limitation
recorded in [handoff-2026-08-08.md](handoff-2026-08-08.md). What *was*
checked: the file transpiles cleanly through Babel with the React preset, the
new sort comparator was extracted and run against table-driven cases
(descending order, missing/unparseable-last, stable ties), and the repo
serves over `python3 -m http.server` with both `index.html` and the JSX
fetching 200. Still needs: serve locally, load the board, watch the console,
then deploy and confirm in Teams.

---

## Tier 8 — trivial, no SharePoint (2026-08-12 request)

Three small ones. None needs a column, and they can go out as a single PR.

### 25. Hide the staging rename pencil in designer view (1) — DONE

*Shipped 2026-08-12.* `StagingArea` already had `operator`; the rename is the
only way into `editingName`, so hiding the pencil closes the path entirely.

**Risk: Low.** One conditional in `StagingArea`.

The pencil beside the staging area's name opens an in-place rename. It is
visible in both views, but the staging name is **shared shop configuration** —
it lives in the SharePoint Settings list under `stagingName`, so a designer
renaming it renames it for everyone. That is exactly the class of control
designer view exists to hide (see item 10 and
[ui-reference.md](ui-reference.md)).

`StagingArea` already receives the `operator` prop, so this is wrapping the
pencil in `operator && …`. Check the rename cannot be reached another way once
the button is gone — the `editingName` state is entered only from that click
today, but confirm rather than assume.

### 29. Remove the Sign out button (5) — DONE

*Shipped 2026-08-12.* The account name went too, not just the link — see the
decision at the end of this entry.

**Risk: Low**, with one consequence worth stating rather than discovering.

Sign-in is Teams' and Microsoft's, not this app's. Somebody signed into Teams
should never be signing out of a tab inside it — the button offers a way to
break your own session with no way back except reloading, and the app's own
sign-in paths exist to avoid ever showing a button in the first place.

Delete the button from `StatusPill`. Then:

- **`signOut()` becomes dead code.** Delete it too rather than leaving an
  unreferenced function — it also carries the only `logoutPopup` call in the
  file, which is a thing Teams refuses anyway.
- **[authentication.md](authentication.md) documented a trade-off that turned
  out not to exist.** It said the localStorage token cache meant "on a shared
  machine people stay signed in until someone uses Sign out."

**Decided — the account name went too, not just the link.** The question was
whether to keep it as the one place the board says *who you are*. The answer
settled it: **there are no shared machines.** Teams logins here are persistent
per machine, one person per machine, and the board cannot run outside a
signed-in Teams session at all. Identity is therefore settled before the tab
loads, and the name told nobody anything they did not already know.

That also corrected the doc rather than just updating it: staying signed in is
the **intended state**, not a risk being tolerated, so the shared-machine
caveat was removed rather than reworded. The pill is save status and nothing
else now.

### 26. Spec exceptions should read like "Standard setup" (2) — DONE

*Shipped 2026-08-12.* **Decided: one exception per line, nothing side by side**,
keeping the per-exception element and its tooltip and dropping only the chip
background and weight. Stacking turned out to be what the chips were really
buying — at this card width a wrapped row ran values together, which was the
original argument for chips in item 7, so the reason survives the restyle.
The summary button moved to `items-start` so the chevron aligns with the first
line rather than centring against a three-line block.

**Risk: Low.** One style block in `PrinterColumn`.

The collapsed specs line reads `Standard setup` in **grey italics** when a
printer is at defaults, but lists exceptions as **chips** — black-ish text
(`#605E5C`) on a grey background (`#F3F2F1`), medium weight. The two states of
the same line look like two different kinds of thing. Match the exception text
to the standard text: grey italic, no chip background.

This **partly reverses item 7**, which chose chips deliberately (they inherited
the group chip's styling from item 2). Record the reversal there rather than
quietly restyling — the reason chips were chosen was that a joined,
truncated five-value string hid the one value worth reading, and that reason
has not gone away.

**Decide before starting:** how multiple exceptions separate now that they have
no chip edges — comma, middot, or one per line. Recommend a middot on one
wrapping line, which keeps the "only what differs" scan while matching the
standard-setup voice. Keep the per-exception `title` tooltips either way; they
are what make a truncated value recoverable.

---

## Tier 9 — moderate, no SharePoint (2026-08-12 request)

### 27. Assigned job cards show jobcode, quantity and need-by (3) — DONE

*Shipped 2026-08-12.* All three open decisions went the way this entry
recommended:

- **`×N` is gone from line 1.** Quantity reads as `Qty N` on the detail line,
  on every card, including quantity 1 — one fact, one shape, always present.
- **Both views, and every card**, not just assigned ones in operator view. The
  line stopped being conditional on `stagingLocked` entirely; a designer who
  cannot open an assigned job now reads its jobcode, quantity and need-by from
  the card face, which was the whole point.
- **Jobcode still renders only when the task has one** — item 16 made it
  required on new tasks, but rows that predate that rule still exist and would
  otherwise leave a gap in the line.

Need-by needed no change: it already rendered on assigned cards whenever a date
was set, and still does not turn red when passed (overdue means the ETA has
passed — unchanged).

The loosening of "minimal collapsed cards" is recorded in
[decisions.md](decisions.md#minimal-collapsed-cards-plus-a-detail-modal) as a
requested change rather than drift, with the note that the next thing wanting a
place on the card has to argue for it.

**Risk: Low–Medium.** Display only, but it touches the card whose minimalism is
a settled decision, and it interacts with the operator/designer split.

An assigned card today shows: title, `×N` (only when quantity > 1), an operator-
note icon, a priority flag, the status pill, need-by when set, and the ETA. The
ask is jobcode, quantity and due date alongside the existing ETA, status and
name.

Most of this already exists and is simply gated off. The jobcode-and-quantity
line was built for item 18 and renders only when `stagingLocked` is true
(operator view, staging only). **Need-by already renders on assigned cards
whenever a date is set** — so of the three asked for, only jobcode and an
always-shown quantity are actually missing.

**Decide before starting:**

- **The `×N` on line 1 duplicates a spelled-out quantity on line 2.** One of
  them should go. Recommend dropping `×N` and keeping `Qty N` on the detail
  line, so quantity always reads the same way and always appears, rather than
  appearing only when it is greater than 1.
- **Both views, or operator only?** Recommend both. Designer view cannot open
  an assigned job at all, so the card face is the only place a designer can
  learn anything about it — the same argument that put the operator-note icon
  there in item 14.
- This pushes against [decisions.md](decisions.md)'s "minimal collapsed cards
  plus a detail modal". It is a deliberate, requested loosening rather than
  drift, so note it there if the card starts feeling busy again.

**Superseded in part by PR #35 (2026-08-12), the three-row card layout:** title
+ status pill / jobcode indented / ETA + `Qty N`. Two calls were made in #35
without an answer, both one line to reverse: **need-by left the card face**
(modal-only — the three-row spec had no slot for it) and **ETA stays
assigned-only** (hidden in staging). Both get resolved for good in item 32/34's
card design rather than relitigated separately. The note icon and priority flag
stayed on row 1 though the spec didn't mention them.

### 30. Two-tier job history (6) — DONE

*Shipped 2026-08-12, PRs #33/#34.* Per-printer Completed sections **plus** the
global completed-jobs panel, now in **both** views (it was designer-only from
item 23), with a jobcode filter built from every jobcode that has ever
completed. Clear history (the purge) became operator-view-only, and a new
decision was recorded: **designer view never gets a permanent-delete control**
(see [decisions.md](decisions.md)).

A caution for whoever reads the PR trail: **PR #33's body claimed this item
while its diff only shipped item 27** — the follow-up commit (`9f1fde8`)
implemented it for real. Judge what shipped by reading `main`, not PR
descriptions or merged-flags; PRs here are merged locally and closed by hand.

**Risk: Medium.** Read paths and one purge control; no schema change.

**Item 31 partially reverses this** — see that entry before extending the
per-printer sections.

---

## Tier 10 — a live bug, effort unknown until diagnosed (2026-08-12 request)

### 28. Mac Teams: sign-in prompt, then a blank screen (4) — SHELVED

*Shelved indefinitely 2026-08-17 at the requester's direction* — Mac
compatibility stays parked; it no longer jumps the queue. If it is ever picked
back up, the entry below still holds: the first move is console output from an
affected Mac captured across the whole load, and the three suspects are
guesses until then — picking one without evidence is how auth gets rewritten
for no reason.

**Risk: High**, and unlike everything else on this list it is **currently
broken for real users** rather than merely absent. Sorted here because its
effort is unknown, not because it is low priority — see the sequencing note.

Opening the tab in the Teams desktop client on macOS prompts for login, the
login appears to succeed, and the board renders blank.

**This cannot be fixed from here.** No Mac, and this sandbox cannot run the app
in Teams at all. The first thing needed is the console from an affected Mac —
right-click the tab → *Inspect*, or the Teams dev tools — captured across the
whole load, not just after the blank appears.

A blank screen is itself informative: `AppShell` renders a `Centered` panel for
every phase it knows about, including `error` ("Could not load the board"). A
truly blank page therefore suggests a failure *before or during* render, not a
handled error path. Suspects, in the order worth checking:

- **`inTeams()` loses its race.** It races `microsoftTeams.app.initialize()`
  against a hard 2-second timer and caches the answer. A slower or
  cold-starting Mac client that resolves late is misread as "not in Teams",
  which sends the app down the browser-popup path — and Teams refuses popups
  opened by page script (`popup_window_error`). The 2s constant is the single
  most suspicious number in the auth code.
- **Storage partitioning between `auth.html` and the tab.** The whole reason
  the MSAL cache is `localStorage` rather than `sessionStorage` is that those
  are two different windows that must see the same token. If the macOS
  WebKit-based client partitions storage between them, `getAllAccounts()`
  returns empty after a *successful* sign-in — which matches the symptom
  exactly ("login yields blank"). Note `teamsSignIn()` throws a specific error
  here ("Sign-in finished but no account was cached"), so check whether that
  string appears anywhere before assuming.
- **ITP / third-party cookie blocking breaking `ssoSilent`'s hidden iframe** —
  more aggressive on WebKit than on the Windows client's Chromium.

Do **not** start rewriting auth on the strength of these guesses. Get the
console output, match it against the three, then fix the one that is real.
[authentication.md](authentication.md) has the full three-path flow and the
existing known gaps.

---

## Tier 11 — needs a decision before any code

All three of these are larger than everything above combined, and each pushes
against the architecture rather than sitting inside it. None should be started
on the same branch as anything else, or alongside each other.

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

### 24. Light mode / dark mode matching system settings (10)

**Risk: High.** Not because any one change is dangerous, but because of how much
of the file it touches.

Every colour in this app is a hardcoded hex value in an inline `style={{...}}`
object — there is no theme layer, no CSS custom properties, and no design-token
indirection anywhere in `print-farm-scheduler.jsx`. Supporting a second palette
means either introducing that indirection everywhere colour is used (hundreds of
call sites across every component) or duplicating every style object, and it
touches nearly the whole file in a way nothing else on this list does — closer
in shape to item 11 than to a normal Tier 3 change.

Open questions before any code:

- **What "system settings" means inside Teams.** The Teams client has its own
  theme setting (Light / Dark / High contrast) exposed through the Teams SDK
  context, which can differ from the OS-level `prefers-color-scheme` a plain
  browser tab would see. Outside Teams there's no Teams context at all, so the
  app would need to fall back to the CSS media query. Worth deciding which
  source wins, and whether High contrast is in scope or explicitly out.
- **How the indirection gets introduced without a build step.** No Tailwind
  build means no `dark:` variants compiled in; the realistic options are CSS
  custom properties set on a root element and referenced from the existing
  inline styles, or a theme object threaded through the component tree. Either
  is a structural change, not a styling pass.
- **Whether this is a full repaint or a palette swap.** The Fluent-ish palette
  in use today (`#5B5FC7` purple header, `#F0F0F2` background, etc.) was chosen
  for light mode specifically; a dark palette needs its own contrast pass
  (status colours, priority colours, the overdue red) rather than a mechanical
  inversion.

Treat this item as "propose an approach and get it signed off", not
"implement" — same posture as item 12.

---

## Tier 12 — docs and labels (2026-08-17 request)

### 35. Terminology pass: jobcode / job / subtask — docs half DONE

*Definitions confirmed 2026-08-17 and recorded in
[ui-reference.md](ui-reference.md#terminology), shipped with this docs
update.* What remains is the UI-copy half, which rides with item 32 — renaming
"task" to "job"/"subtask" in labels before the model distinguishes them would
mislabel today's rows, which play both roles at once.

- **Jobcode** = the *project*: `XX000` — `XX` the client (`HE` = Hermes),
  `000` that client's sequential project number (`HE270` = Hermes' 270th).
- **Job** = producing all of one unique part for a project (PropPart1,
  qty 100), raised by a designer.
- **Subtask** = one print run of part of a Job on one printer (PropPart1-A,
  qty 10), operator-created at assignment.

**Do not rename the SharePoint list, columns, or `COLS` internal names**
(CLAUDE.md rule 3) — UI copy and docs only.

**The format question is answered: no enforcement** (decided 2026-08-17).
Item 16 made jobcode required; item 4 noted the `XX000` shape with nothing
enforcing it; the field stays free text and the glossary documents the
convention. A hard format block on a field the shop free-types is the kind of
thing that surprises someone mid-request, and nothing broke for the lack of
one.

**Risk: Low.** Words.

---

## Tier 13 — moderate, decision-gated (2026-08-17 request)

### 31. One job history: drop the per-printer tier, add a Printer filter (1) — DONE

*Shipped 2026-08-17.* Both decisions were answered before building:

- **No UI purge.** Clear history went with the per-printer sections and got no
  replacement — completed jobs are never removed from the board; trimming the
  record means editing the SharePoint list directly. Recorded in
  [decisions.md](decisions.md#completed-jobs-are-never-purged-from-the-ui),
  including the path back (operator-only control on the table) if the shop
  ever wants purging again. `purgeDone`/`askPurgeDone` deleted as dead code.
- **Straight to the table.** A job marked Complete leaves its printer card
  immediately; printer cards show live work only.

The Printer filter composes with the jobcode filter (both set means both must
match), is built from the record itself like the jobcode list, and drops a
selected printer if it is deleted (its completed jobs go back to staging and
show "—" in the Printer column — pre-existing behaviour, unchanged).

**Risk: Medium — and it partially reverses item 30, shipped five days before
it was requested.** Item 30 built the two-tier history deliberately; this
removed the per-printer Completed sections and made the global completed-jobs
table the only history. Data layer untouched: completed tasks keep their
`printerId`, only display and the purge path changed.

### 33. "Mark Complete and Duplicate" status option (3)

**Risk: Medium. Depends on item 32** — "counts against the Job total" means
nothing until quantities are arithmetic.

A status-dropdown option that completes the current subtask and spawns a new
one with an **editable quantity** counted against the Job's total. (Phrasing
open — "Complete & reprint" may read better on the shop floor; the mechanism
is what matters.)

Build on `copyTask`, which already does the right hygiene (fresh `createdAt`,
cleared `completedAt` — items 20–21). Two standing rules apply directly:

- `updateTask` stamps completion only on a **real** status transition — do not
  reintroduce the no-op-write bug fixed in the 2026-08-08 audit
  ([handoff-2026-08-08.md](handoff-2026-08-08.md)).
- The save layer diffs by identity: the handler must copy only what it
  changes.

---

## Tier 14 — the job/subtask model (2026-08-17 request)

The largest change since item 11 was written. Items 32 and 34 ship together or
not at all; nothing else rides on their branch.

### 32. Job / subtask data model (2)

**Risk: High.** Touches the Tasks schema, the save layer, staging, and every
mutation handler near assignment. **Design proposal and sign-off before any
code; SharePoint columns created and internal names confirmed before any code
ships.**

The model:

- A **Job** is the production of all of one unique part (PropPart1, total
  qty 100), raised by a designer into staging. Its **Name becomes a
  persistent ID**.
- Operator assignment creates a **Subtask** per printer with its own derived
  ID (PropPart1-A) and quantity, counted against the Job's total.
- The parent Job moves from Staging to the new **In Progress** block (item
  34), showing remaining qty = total − (assigned or in-progress), with an
  expandable list of printers and their subtasks.

What the design proposal has to cover:

- SharePoint columns: parent/child link, per-subtask quantity, ID derivation
  — names TBD until sign-off (see the SharePoint table at the top).
- **Migration story for existing rows** — today's rows are job and subtask at
  once, and quantity is display-only; the model makes it arithmetic, so rows
  with no subtasks need a stated fallback.
- **The In Progress job card** — it lands on top of PR #35's three-row layout,
  built around card = one task, and now needs the same info plus an expandable
  subtask list. This is where #35's two open calls (need-by off the card face,
  ETA assigned-only) get settled for good, and it pushes on the already-once-
  loosened "minimal collapsed cards" decision — what earns a place on the card
  has to be argued, not assumed.

### 34. In Progress board block (2) — ships with item 32

**Risk: Medium on its own; High as part of the pair.** The UI half of item 32,
split out so model and board section can be *reviewed* separately — they do
not ship separately.

Below staging, same formatting as the staging block. Staging keeps jobs not
yet assigned anywhere; In Progress holds jobs with at least one live subtask;
completed jobs continue to the history table — since item 31 (shipped first),
the only history: a completed subtask leaves its printer card straight for the
table.

---

## Suggested sequencing

Everything through Tier 9 is closed: items 1, 2, 4–10, 13–23, 25–27, 29 and
30 shipped; item 3 declined; item 35's docs half shipped with this update.
Item 28 is shelved indefinitely. Item 32 will need new SharePoint columns —
names TBD until its design is signed off.

**What is left, sorted by lowest-hanging fruit:**

1. **Item 6's tail** — reword the Printers `PrintMaterial` choices to `ABS` /
   `Other` in SharePoint. Two minutes in list settings, no code, optional;
   nothing breaks either way.
2. **Item 35's UI-copy half** — rides with item 32. Its open question is
   answered: **no `XX000` enforcement** (decided 2026-08-17); the glossary
   documents the convention and the field stays free text.
3. ~~**Item 31**~~ — done, shipped 2026-08-17. No UI purge, complete goes
   straight to the table.
4. **Items 32 + 34** — the job/subtask model and the In Progress block, as one
   designed change on its own branch. Design proposal → sign-off → columns
   created and internal names confirmed → code. Nothing else on that branch.
5. **Item 33** — Mark Complete and Duplicate. After 32; it composes existing
   pieces once quantities are arithmetic.
6. **Tier 11** (12, then 11, then 24) — unchanged posture, with one new fact:
   **item 11's design should now wait for item 32**, since parent/child rows
   change what the identity-diff save layer has to reconcile. 12's research is
   still cheap and still first among the three.
7. **Item 28** — shelved indefinitely; only reopens at the requester's say-so,
   and then only with Mac console output in hand.

**Current state (2026-08-17):** the 2026-08-17 request added items 31–35.
Shipped same day: item 35's docs half (glossary, plus the no-enforcement
answer on `XX000`) and item 31 (one history, no UI purge, Printer filter,
build `2026-08-17.1`). Left: 32/34 — the big one — waiting on a design
proposal and sign-off, then 33 behind it, and the decision-gated Tier 11
three. Standing caveat: items 23, 25–27, 29, 30, the #35 card layout and now
item 31 were verified by transpile and extracted-function tests only, never in
a live browser — one deliberate check in Teams (header should read
`2026-08-17.1` once item 31 deploys) is worth doing before stacking the model
work on top.
