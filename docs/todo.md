# To-do and session state

The single session-facing document: what's left, what shipped, the traps, and
the operational notes. Durable behaviour lives in
[ui-reference.md](ui-reference.md), reasoning in [decisions.md](decisions.md),
schema in [data-model.md](data-model.md) — where this file and the code
disagree, the code wins.

Item numbers are stable identifiers from the original request lists (1–14
original, 15–24 the 2026-08-07 follow-up, 25–30 the 2026-08-12 request, 31–35
the 2026-08-17 request). Full histories of closed items are in git history
(this file before 2026-08-18) and in the merged PRs.

**Risk** is blast radius if the change is wrong, not effort: **Low** = visual,
obvious immediately; **Medium** = stored data or several components,
recoverable; **High** = save layer, auth, or a settled decision — could lose
work or take the board down.

---

## Verified state (2026-08-18, ship-day sprint)

- `main` head `2c6599b` (PR #58); PRs #54–#58 all merged 2026-08-18. Live
  site last *verified* serving BUILD `2026-08-18.3`; builds `.4`–`.9` were
  render-verified locally in a real browser (see the verification ceiling —
  now partially lifted) but not yet eyeballed on the live site or in Teams.
- All SharePoint columns every shipped item needed exist and are confirmed by
  internal name — the full column inventory is in
  [data-model.md](data-model.md). No SharePoint work is pending: item 6's
  wording tidy was done 2026-08-18 (both PrintMaterial columns now read
  `ABS` / `Other`; verified in list settings).
- Nothing is mid-flight beyond this commit's PR.

---

## What's left, sorted by lowest-hanging fruit

### 1. Item 35's UI-copy half — DONE 2026-08-18

The sweep found the 2026-08-17 rework had already converted almost all of
it ("New job", "Add job", noun-aware menus and modal labels). The one
survivor was the printer-card count chip ("N tasks" → "N runs") — changed
and *render-verified* in a browser on seed data. UI copy only; no
SharePoint or `COLS` names touched.

### 2. Item 6's tail — DONE 2026-08-18

The long wording lived on the **Tasks** list, not Printers as this item
originally said (the Printers column already read `ABS` / `Other`). The
Tasks `PrintMaterial` choices were reworded to `ABS` / `Other` in list
settings and verified there; the `DEFAULT_CHOICES` fallback and the
`isOtherMaterial` comment were updated to match. Rows written before the
rewording still store `Other (Discuss with Operator)` — `isOtherMaterial`
matches on the stem, so they behave identically.

### 3. Item 12's remainder — Robert's two enablement steps

**Code shipped 2026-08-18** per the agreed design
([decisions.md](decisions.md#notifications-fire-client-side--no-server-needed)):
first-run assignment pings the job's creator (from the row's SharePoint
author, plumbed through the load path) plus `NotifyPeople`, minus the actor;
a new staging job pings `OPERATOR_NOTIFY_IDS` (code constant, empty until
the shop hires an operator). Sends are best-effort from the acting session
and fail silent until Robert does the two one-time steps in
[operations.md](operations.md#enabling-the-activity-notifications-item-12):
grant `TeamsActivity.Send` admin consent, and declare the `jobStarted` /
`jobQueued` activity types in the Teams manifest + republish.

### 4. Item 11 — live auto-refresh — SHIPPED 2026-08-18, needs the manual pass

Code shipped: a 60-second poll (hidden tabs skip, returning polls at once)
with a per-row merge whose rules are recorded in
[decisions.md](decisions.md#live-refresh-polls-merges-per-row-and-only-writes-what-a-person-did).
Every constraint from the design discussion is honoured: the poll runs only
when the save layer is idle so identity baselines survive; adopted rows
enter state and baseline as the same object (a poll can never cause a
write — `mergeList` has extracted-function tests for this); the open-modal
row and a mid-drag card are never touched, and a remote deletion of them is
undone rather than yanking the row.

**Still worth a two-browser manual pass on test data** (the verification
ceiling applies — transpile + function tests only): edit in tab A, watch tab
B pick it up within a minute with no PATCH storm in the network panel and no
"Saving…" flicker when nothing changed.

### 5. Item 24 — light mode / dark mode — SHELVED

*Shelved 2026-08-18 at Robert's direction (ship-day sprint).* The open
design questions recorded before shelving, for whenever it reopens: which
theme source wins (Teams SDK context theme vs `prefers-color-scheme`, and
whether High contrast is in scope); how the indirection lands without a
build step (CSS custom properties vs a threaded theme object — every colour
today is a hardcoded hex in inline styles); and dark needs its own contrast
pass, not a mechanical inversion.

### 6. Item 28 — Mac Teams blank screen — SHELVED

*Shelved indefinitely 2026-08-17 at Robert's direction; reaffirmed
2026-08-18 (browser access is enough). Reopens only at his say-so, and then
only with console output from an affected Mac in hand*
(right-click the tab → Inspect, captured across the whole load). The three
suspects, in checking order — do not rewrite auth on guesses:

- **`inTeams()` loses its race** — it races `initialize()` against a hard
  2-second timer and caches the answer; a slow Mac client misread as "not in
  Teams" goes down the browser-popup path, which Teams refuses
  (`popup_window_error`). The 2s constant is the most suspicious number in
  the auth code.
- **Storage partitioning between `auth.html` and the tab** — if macOS WebKit
  partitions `localStorage` between the two windows, `getAllAccounts()` is
  empty after a *successful* sign-in, which matches the symptom exactly.
  `teamsSignIn()` throws "Sign-in finished but no account was cached" here —
  check for that string first.
- **ITP breaking `ssoSilent`'s hidden iframe** — more aggressive on WebKit
  than the Windows client's Chromium.

[authentication.md](authentication.md) has the full three-path flow.

---

## Closed items — the ledger

One line each; the standing constraint, if any, in bold. Details are in git
history and [decisions.md](decisions.md).

- **1** Modal close on outside-drag — fixed (#3), both modals.
- **2** Group name chip off printer cards (#5).
- **3** ETA label — **NOT DOING, do not re-propose**: ETA is the shop's own
  word (declined 2026-08-06).
- **4** Jobcode field on tasks (#10); joins staging search.
- **5** Need-by date (#10). **Overdue still keys off ETA only** — a second
  lateness rule was considered and dropped.
- **6** Print material split printer/task (#11). Tail open — see above.
- **7** Printer settings summary "Standard setup" + exceptions (#14).
  **Defaults live in code** (`defaultPrinterFields()`) by decision — if the
  shop edits a choice column so a default value no longer exists, every
  printer silently reads as an exception.
- **8** Busy printer status (#18). **Automation only ever moves a printer
  between Ready and Busy**; Reserved/Maintenance are never touched by it and
  refuse to let queued jobs start.
- **9** Jobcode display filter (#16). **Dimming is purely visual** — dimmed
  printers still accept drops.
- **10** Designer/Operator view (#21). **Not a permission boundary**;
  persisted per browser via `localStorage`.
- **13** Group colour retired (#8). **Colour means state or interaction,
  never identity.** Colours still round-trip through the `Color` column;
  nothing renders them, so reversal needs no schema change.
- **14** Requester + operator notes (#23). **The requester's note freezes on
  assignment**; plain text columns on purpose (rich text returns HTML
  through Graph).
- **15** Jobcode filter's own container (#25).
- **16** Five required fields on new tasks (#25) — all hard-block; existing
  blank rows untouched.
- **17** View toggle survives Teams restart — verified 2026-08-08, no code.
- **18** Operator-view staging cards read-only summary (#25).
- **19** "Edit printers" mode replaces per-group Add printer (#25) — one
  global toggle.
- **20** `CompletedAt` timestamp — stamps on the transition to Complete,
  clears on leaving it; duplicates reset it.
- **21** `CreatedAt` timestamp — `addTask` stamps once; duplicates get fresh
  values.
- **22** Staging sort tiebreakers: need-by then created-at, missing sorts
  last; **manual reordering within a tier is removed**, not inert.
- **23** Completed-jobs table (see 30/31 for where it ended up).
- **25** Staging rename pencil hidden in designer view.
- **26** Spec exceptions read like "Standard setup" — grey italics, one per
  line; per-exception tooltips kept.
- **27** Assigned cards show jobcode/qty/need-by; superseded in part by the
  three-row card (PR #35), finalized by item 32's card design.
- **29** Sign out button and account name removed. **Staying signed in is
  the intended state** — no shared machines; `signOut()` deleted as dead
  code.
- **30** Two-tier history (#33/#34) — partially reversed by 31.
- **31** One job history: per-printer Completed sections gone, global table
  is the only history, Printer filter composes with jobcode filter. **No UI
  purge anywhere** — trimming the record means editing the SharePoint list;
  the path back (operator-only control) is in decisions.md.
- **32** Job/run data model — **one new column (`ParentID`, capital D),
  everything else derived**: staging vs In Progress membership, remaining
  (= total − all runs), two-way job auto-complete. Runs stay put through
  Maintenance; deleting a printer deletes its runs (qty flows back) while
  legacy tasks return to staging. Rows predating the model behave as before.
- **33** Complete & reprint — context menu + modal Status dropdown; one
  PATCH + one POST; **the guard filters already-Complete rows** (keeps the
  2026-08-08 no-op-write bug dead — don't loosen it). Duplicate on a run
  letters instead of "(copy)".
- **34** In Progress panel below staging — staging's sort, designers click
  in, operators drag out. Always visible since PR #48 (hide-when-empty
  caused a false alarm); empty state reads "Nothing in progress".
- **35** Terminology glossary in ui-reference.md (2026-08-17); UI-copy half
  closed 2026-08-18 — one string remained (printer-card count chip).
- **Item 12 groundwork** (PRs #41–#45): `NotifyPeople` column (JSON
  `[{id, name}]`, deliberately not a Person column), `PeoplePicker` off the
  Teams roster (tenant fallback; filters guests and `[ARCHIVE]` names),
  Sent by / Give to single-select with free-text degrade, two new consented
  scopes in both `SCOPES` copies (jsx and `auth.html`).
- **2026-08-18 session** (PRs #48–#50, #52): picker close/scroll fixes;
  In Progress always visible; **Reprint job** from a history row (fresh
  standalone job to staging, editor opens, original never un-completed);
  history table grouped by job with expandable runs; the in-progress
  printers status bar removed as redundant (#52).

---

## Traps — read before touching these areas

- **`ParentID` is capital D.** Don't "fix" it (CLAUDE.md rule 3).
- **Mutation identity discipline** (CLAUDE.md rule 1): the auto-complete
  effects and `evictPrinterTasks` deliberately return the same
  references/arrays when idle — keep that in anything touching them.
- **`PeoplePicker`'s two `preventDefault`s are both load-bearing**: the one
  on each suggestion's `onMouseDown` keeps the pick landing before blur; the
  one on the list container keeps the scrollbar usable. Remove either and a
  2026-08-18 symptom returns.
- **`reprintTask` generates the new id *outside* the state updater** so
  `setExpandedTaskId` can point at it; one appended row, untouched
  references elsewhere. Keep that shape.
- **History grouping nests a run only when its parent's row is in the table**
  (`ids.has(t.parentId)`). Runs of live jobs, orphaned runs, and legacy
  tasks are primary rows on purpose — don't "simplify" the check away.
- **A JSX comment between attributes** in the picker's list container
  (`<div /* … */ onMouseDown={…}>`) is valid and transpiles fine — not an
  accident to clean up.
- **The people-picker directory is cached per session** — after a deploy
  changing its filters or source, hard refresh to see it.
- **Consent is tenant-wide but tokens pick it up lazily** — one "Directory
  unavailable" means retry/refresh before anyone debugs.

## Operational notes

- `gh` CLI is absent. PRs are created with the GitHub REST API using the
  stored git credential (`git credential fill`).
- **Robert merges fast** — check a branch's PR state before pushing more
  work to it (the #43/#44 lesson: commits pushed after merge orphan).
- Judge shipped state only by reading `main` — PR bodies have claimed items
  their diffs didn't ship (#33), and concurrent sessions have shipped to
  `main` mid-session (2026-08-17, twice).
- Transpile check without a browser: install `@babel/core` +
  `@babel/preset-react` and call `transformSync` from a scratch node script
  (`@babel/cli` alone won't resolve the preset).
- Git on this network share may need `safe.directory` per-command from some
  environments; on Robert's Windows machine it works directly. PowerShell
  here-strings with embedded quotes broke a commit once — use
  `git commit -F -` from bash.

## The verification ceiling — partially lifted 2026-08-18

The old ceiling ("transpiles ≠ renders": sandbox egress blocked the CDN
hosts, so nothing since item 23 had run in a browser) was broken on the
ship-day sprint: a Claude session served the repo locally (node static
server — **no python on Robert's machine**, use node) and loaded it in a
real browser. Verified at BUILD `2026-08-18.9`: CDN hosts load, in-browser
Babel transpiles with no errors, the sign-in screen renders with production
config, and the **full board renders on seed data** (SP IDs blanked in a
scratch copy only, per CLAUDE.md rule 6) with zero console errors —
including item 32's runs, the In Progress-era card copy, and item 35's
count chip.

Still never verified live from a session, because they need a signed-in
SharePoint/Teams context Claude cannot enter: the Graph read/write paths,
the people picker against the real roster, notifications, and item 11's
two-browser refresh pass.

**The manual pass worth doing on test data before cutover:** assign a
staging job to a printer → `-A` run appears and In Progress fills →
right-click the run → Complete & reprint → `-B` editor opens → complete it →
the job self-completes into the history table → expand its group → Reprint
job from the row → the recalled copy's editor opens in staging. Then the
picker path: add a job with notify recipients → confirm the JSON round-trips
through `NotifyPeople` and the roster loads inside a real team tab. Check
the header BUILD stamp first — anything older than the change under test is
cache ([operations.md](operations.md#deploying-a-change)).
