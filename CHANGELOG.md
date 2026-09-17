# Print Farm Scheduler — release notes

The version history of the board, in plain language, newest first. Each entry is
headed by the `BUILD` stamp shown in the board's corner (`## <BUILD> — <date>`;
entries older than the stamp use the date alone), with one `- ` line per change.
Keep lines concrete — say what changed *for the shop*, not how. Developer-only
work (docs, refactors, deploy tooling) doesn't need a line; a build with nothing
shop-facing is folded into the next entry, whose heading then names the newest
stamp of the span. Collect lines for unshipped work under `## Unreleased` and
retitle it when it merges.

CI checks that the current `BUILD` stamp in `print-farm-scheduler.jsx` appears in
a heading here, so a code change cannot ship without its entry.

## 2026-09-14.3 — Sep 14, 2026

- Printer cards no longer lose their coloured top edge after a job is dragged
  across them.
- The completed-jobs table shows each job's printer without expanding the row.

## 2026-09-10.2 — Sep 10, 2026

- Operators can delete in-progress and completed jobs, not just queued ones.

## 2026-08-19.1 — Aug 19, 2026

- Completing a job now posts to the Ticketing activity feed too, alongside the
  start and staging pings (took effect with the 1.0.3 Teams package).

## 2026-08-18.24 — Aug 18, 2026

- Changes made by other people appear on the board automatically — no more
  reloading the tab to see the latest state.
- The Ticketing activity feed gets a ping when a job starts or is staged, sent
  to the people picked on the job — including yourself, so solo use still
  notifies.
- ETA is set with one click — Short / Medium / Long / Weekend presets that fill
  the actual finish time — instead of date and time pickers.
- The history table groups print runs under their parent job; expand a job to
  see its runs. Reprinting from history opens the editor on the new job.
- The board remembers, per person, which groups are collapsed and whether
  history is folded.
- Operators can open a read-only preview of a staging card.
- Consistent job / run vocabulary across the board; the count chip counts runs.
- The in-progress printers status bar is gone.
- The build stamp shows the Teams app version next to the build.
- A round of save-layer and board fixes: a retried save can no longer create
  duplicate rows, retries are bounded, deleting a job no longer strands its
  runs in history, and a job with an unrecognised status no longer blanks the
  board.

## 2026-08-17.9 — Aug 17, 2026

- One job history table with a printer filter, replacing the per-printer
  Completed lists.
- A job can carry several print runs, tracked together, with a persistent
  In Progress block on the board.
- Complete & reprint: finish a run and queue the next one in one step.
- A people picker — sourced from the Teams roster, archived accounts excluded —
  fills Sent by / Give to and picks who a job notifies.

## 2026-08-12.5 — Aug 12, 2026

- Job cards restructured to a three-row layout; assigned cards show their
  fields at a glance.
- Job history splits into two tiers — recent and older.
- The completed-jobs panel sits on the board like any other block instead of
  clinging to the edge of the screen.
- Staging cards get a pencil to edit in place; spec exceptions are styled so
  they stand out; the sign-out button (which nobody needed) is gone.

## Aug 10, 2026

- Jobs are timestamped through their lifecycle, staging keeps a stable sort,
  and finished work lands in a completed-jobs table.
- A build stamp in the corner of the board says exactly which version you are
  looking at (build `2026-08-10.1` — the first stamped build).

## Aug 7, 2026

- Designer view: designers see assigned jobs and printer names read-only, so a
  stray drag can't reshuffle the queue.
- Jobs carry requester notes and operator notes.
- Filter the board by jobcode.
- Printers show a Busy status the app sets by itself while a job runs.
- Printer summaries read "Standard setup", or list only what differs from it.
- Overdue jobs say "overdue" rather than leaving the colour red to carry it.
- The add form insists on its required fields, operators can lock staging, and
  printers are edited through a dedicated Edit printers mode.

## Aug 6, 2026

- Jobs carry a jobcode and a need-by date.
- Print material is two fields: what the machine holds and what the job wants.
- Printer card colour now signals the printer's state or recent activity, not
  its group; the group name chip is gone.
- Releasing a text selection outside a window no longer closes the window.

---

Entries up to Sep 14, 2026 were backfilled on Sep 17, 2026 from the merged
pull-request history (PRs #1–#83); day-level entries, headed by the day's last
`BUILD` stamp where one existed.
