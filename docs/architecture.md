# Architecture

Everything is one file: `print-farm-scheduler.jsx`, ~4,500 lines. `index.html`
loads React 18, Tailwind, lucide-react and MSAL from CDNs via an import map, then
hands the JSX to Babel standalone, which transpiles it in the browser. There is
no bundler, no `node_modules`, and no server.

## Layout of the file

The file reads top to bottom as: constants → helpers → interface → persistence →
shell. Approximate line ranges (they drift as the file is edited — the section
comments `/* ---- name ---- */` are the reliable landmarks):

| Section | Lines | Contents |
| --- | --- | --- |
| Imports + persistence-seam note | 1–43 | React, lucide icons, the design note on ordering and the Settings list |
| Constants | 45–289 | `GROUP_COLORS`, `PRINTER_FIELDS`, `DEFAULT_CHOICES`, `TASK_TAGS`, `PRINTER_STATUSES`, `PRINTER_STATUS`, `STATUSES`, `canStartWork()`, `PRIORITIES`, `STAGING`, layout dimensions, `DEFAULT_APP_SETTINGS`, `uid()` |
| Order helpers | 291–307 | `bySortOrder`, `hydrate()`, `reindex()` |
| Seed demo data | 309–455 | `seedGroups`, `seedPrinters`, `buildSeedTasks()`, `seedTasks` — unreachable when SharePoint is configured |
| Helpers | 457–499 | `formatEta()`, `useBackdropClose()`, `isOverdue()` |
| `PrintFarmScheduler` | 501–1524 | The board: all state, every mutation handler, the header, shop settings modal, in-progress bar, group grid |
| `ConfirmDialog` | 1526–1572 | Destructive-action confirmation |
| `ContextMenu` | 1574–1815 | Right-click menu for tasks and printers |
| `StagingArea` | 1817–2124 | Unassigned queue: search, priority filter, tier headers, batched loading |
| `StatusPicker` | 2126–2234 | Task status control |
| `PrinterColumn` | 2236–2681 | One printer card: specs, queue, completed section, drop targets |
| `TaskCard` | 2683–2875 | Collapsed card |
| `TaskDetailModal` | 2877–3281 | Full task editor, plus the shared `Field` wrapper and modal input styles |
| `NumberStepper`, `AddTaskForm` | 3283–3597 | Quantity control and the inline new-task form |
| Persistence | 3599–4229 | `SP`, `COLS`, MSAL, Graph, row mappers, schema check, load, save |
| `AppShell` | 4231–4475 | Auth phases, save orchestration, `StatusPill`, `Centered` |
| Mount | 4477–4483 | `createRoot(...).render(<AppShell />)` if `#root` exists |

To refresh these numbers after the file has drifted, the section banners are
greppable — `grep -n -A1 '^/\* [-=]\{10,\}' print-farm-scheduler.jsx` prints
each landmark with its title, which is enough to rebuild the table without
reading the file. (The character class matters: the persistence seam is ruled
with `=`, the rest with `-`.)

## The seam

`PrintFarmScheduler` is a pure interface component. It takes two props:

```jsx
<PrintFarmScheduler initial={initial} onPersist={onPersist} />
```

- `initial` — `{ groups, printers, tasks, choices, appSettings }` loaded from
  SharePoint, or `null`. When null, the board runs on the seed data exactly as it
  did before persistence landed.
- `onPersist` — called with `{ groups, printers, tasks, appSettings }` after
  every state change, or `null` when SharePoint is not configured.

No interface component below `AppShell` knows storage exists. That is the whole
extension point: a different backend means replacing `AppShell` and the
persistence section, and touching nothing else.

`PrintFarmScheduler` is also the default export, so the file can be imported as a
plain component module; the mount at the bottom only runs when a `#root` element
is present.

## State model

All board state lives in `PrintFarmScheduler` as four `useState` arrays/objects:

| State | Shape |
| --- | --- |
| `groups` | `{ id, name, color, collapsed, sortOrder }[]` |
| `printers` | `{ id, name, groupId, status, sortOrder, settings: { notes, fields } }[]` |
| `tasks` | `{ id, printerId, title, status, priority, sliceStatus, quantity, etaDate, etaTime, sentBy, giveTo, filepath, printQuality, printStrength, sortOrder }[]` |
| `appSettings` | `{ stagingName, printersPerRow, groupsPerRow }` |

Plus `choices` (dropdown options read from SharePoint) and a dozen pieces of
view-only state: `openSettings`, `addingTaskIn`, `expandedTaskId`,
`editingGroupId`, `removeGroupMode`, `showShopSettings`, `contextMenu`,
`draggingTaskId`, `confirm`.

Tasks are flat. A task belongs to a printer by `printerId`; unassigned tasks
carry the literal string `"staging"` (the `STAGING` constant). `tasksByPrinter`
is a single memoised pass over `tasks` rather than a filter per printer card,
which is what keeps several hundred jobs responsive.

The board has no local drafts that survive a render — `TaskDetailModal` keeps a
`draft` object while a field is focused and flushes it on blur/close, but that is
the only deferred write in the interface.

## Ordering

Every record carries an integer `sortOrder` mirroring the `SortOrder` column.

1. Rows arrive from Graph in arbitrary order and go through `hydrate()` — a
   stable sort by `sortOrder` — before entering state.
2. After that, **array position is authoritative**. Any structural change runs
   `reindex()`, which renumbers the affected scope `0,1,2…` and returns the same
   object for rows whose number did not change.

Scopes:

| Records | Scope |
| --- | --- |
| Groups | the board |
| Printers | their group |
| Tasks | their printer (`STAGING` is its own scope) |

`reindex()` preserving object identity is not a nicety — the save layer diffs by
reference, so a reindex that copied every row would PATCH every row.

Staging is the one place `sortOrder` does not decide display order: it sorts by
priority tier first (Urgent → High → Normal → Low), with `sortOrder` as the
stable tiebreaker inside a tier. See [decisions.md](decisions.md).

## How saving works

No mutation handler was rewritten when persistence landed. Instead the save layer
compares the new arrays against the last saved snapshot **by object identity**:

```
created = rows in next whose id is not in prev
deleted = rows in prev whose id is not in next
updated = rows in both where prev.get(id) !== nextRow   // reference inequality
```

That is `diffByIdentity()`. It is sound only because `reindex()` and every
mutation handler copy the rows they change and leave the rest alone — the
codebase's single most load-bearing invariant. **Any new handler must follow it:
map over the array and return the same object for untouched rows.**

Around that diff:

- **Debounce.** `onPersist` sets a 700ms timer (`SAVE_DEBOUNCE_MS`), so dragging
  a card produces one save rather than thirty.
- **No-op suppression.** Before PATCHing, the mapped row is compared field by
  field against the previous mapped row (`sameRow`) and skipped if no stored
  column differs. Toggling a group's collapse changes state but writes nothing.
- **One writer at a time.** `AppShell` holds `writing` / `pending` refs; anything
  arriving mid-write is coalesced into `pending` and written on the next pass of
  the `while` loop in `flush()`.
- **Recovery.** A missing SharePoint item id on an updated row falls through to a
  create rather than throwing.
- **Status.** `StatusPill`, bottom-right, reads Saving / Saved / Not saved, with
  the change count or the Graph error as its tooltip and a Retry link on error.
- **Unload guard.** `beforeunload` warns if a write is pending or in flight.
- **IDs.** `crypto.randomUUID()` via `uid()`, so two people creating rows at the
  same moment cannot collide.

Write order per pass is groups → printers → tasks → settings.

## Load sequence

`AppShell` starts in phase `checking` (or `ready` if `SP` has no IDs):

1. `silentSignIn()` — reuse a cached account, else `ssoSilent` with the Teams
   login hint. Failure moves to phase `signin` and shows the button.
2. `loadEverything()`:
   - `checkSchema()` compares every name in `COLS` against the live lists' column
     names and throws one combined error listing all mismatches. This exists
     because internal names lie (see [data-model.md](data-model.md)) and
     discovering that one failed save at a time was painful.
   - `readList()` for Groups, Printers, Tasks in parallel, paging through
     `@odata.nextLink` at `$top=500`.
   - Each row goes through the per-list `fromRow` mapper; the SharePoint item id
     is recorded in `itemIds` keyed `"kind:uuid"` so later PATCH/DELETE can find
     it.
   - `loadChoices()` and `loadSettings()`.
3. The result becomes both the `initial` prop and the first saved snapshot.

Graph calls go through `graph()`, which retries once on 429 or 5xx after the
`Retry-After` interval and otherwise throws with the status, path and the first
300 characters of the body.

## Rendering and layout

Widths are derived, not fixed. `PRINTER_MIN_W` (230px) plus gaps and padding feed
`groupMinW(printersPerRow)` and `boardMinW(printersPerRow, groupsPerRow)`, so the
board scales up with the window but never squeezes a printer card below the width
that shows every field without clipping. `printersPerRow` and `groupsPerRow` come
from the Settings list, because shop layouts differ.

Colour has two jobs and they are kept apart: **group colour is identity**
(assigned automatically from `GROUP_COLORS`, inherited by printers, never
individually assignable) and **state colour is state** (`PRINTER_STATUS`,
`STATUS_STYLE`, `PRIORITY_STYLE`).
