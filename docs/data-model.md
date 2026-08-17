# Data model

Four SharePoint lists on https://twosevennet.sharepoint.com/sites/Ticketing/ :
**Groups**, **Printers**, **Tasks**, **Settings**. Accessed through Microsoft
Graph with a delegated `Sites.ReadWrite.All` token.

The `COLS` block in `print-farm-scheduler.jsx` (just below the `SP` block) is the
authority on column names. This page explains what each column is for and records
why some entries look wrong.

## Column names are not what they look like

SharePoint fixes a column's **internal name** when the column is created and
never changes it. Rename the column and the display name changes; the internal
name — the one Graph uses — keeps its original spelling. A space becomes
`_x0020_`, and a name reused after a delete picks up a trailing digit.

**As of 2026-08-07 every column in `COLS` matches its display name.** That is
worth keeping true — it was not free to get here.

| List | App field | Internal name | Why it is worth knowing |
| --- | --- | --- | --- |
| Printers | `uuid` | `PrinterID` | Recreated without the space. Had it been renamed instead, it would still be `Printer_x0020_ID` |
| Tasks | `printerId` | `PrinterID` | Holds the literal string `staging` when unassigned |

### The one that got fixed

`status` on Printers used to read `Active`: the column began as an Active
Yes/No field, was rebuilt as the three-state choice, and SharePoint fixed the
internal name at creation so the rename never followed. `COLS` said `Active`
while SharePoint showed `Status`.

It cost a debugging cycle to find, then confused every later conversation about
that column — including one where the shop reasonably reported that no `Active`
column existed. A rename could not fix it, so the column was **replaced**: a new
Choice column created with the internal name `Status`, values copied across, and
the old one kept temporarily as `Status (legacy)`.

A transitional fallback read the old column while both existed, so a row missed
during the copy could not silently turn a Maintenance printer into a Ready one.
Both are gone now — the legacy column was deleted and the fallback with it.

The lesson survives the fix: SharePoint fixes an internal name at creation and a
rename never changes it. Always read `Field=` back. What changed is that the
codebase no longer carries an example of the damage.

**To check any column's internal name:** List settings → click the column → read
the `Field=` value at the end of the address bar.

`checkSchema()` runs on every load and compares every name in `COLS` against the
live lists, reporting all mismatches at once instead of failing one save at a
time. If it throws, fix `COLS` — do not rename columns in SharePoint to match.

## Groups

One row per printer group (the shop's physical or logical clusters).

| App field | Column | Type | Notes |
| --- | --- | --- | --- |
| `id` | `GroupID` | Text | Our `crypto.randomUUID()`, not SharePoint's row ID |
| `name` | `Title` | Text | |
| `color` | `Color` | Text | Hex from `GROUP_COLORS`, assigned automatically. **Stored but no longer rendered** — kept so reversing that needs no schema change. See [decisions.md](decisions.md) |
| `sortOrder` | `SortOrder` | Number | Position on the board |
| `collapsed` | `Collapsed` | Yes/No | **Unused on purpose.** Collapse is per-person view state; a shared column would fold the group for everyone |

## Printers

| App field | Column | Type | Notes |
| --- | --- | --- | --- |
| `id` | `PrinterID` | Text | UUID |
| `name` | `Title` | Text | |
| `groupId` | `GroupID` | Text | The group's UUID |
| `status` | `Status` | Choice | `Ready` / `Reserved` / `Maintenance`, plus `Busy`, which the app sets automatically — see below |
| `settings.notes` | `Notes` | Text | Free-form |
| `settings.printMaterialOther` | `PrintMaterialOther` | Text | The actual material, when `PrintMaterial` is an "Other". Written always, read only when it applies |
| `sortOrder` | `SortOrder` | Number | Position within its group |
| `settings.fields.nozzleSize` | `NozzleSize` | Choice | |
| `settings.fields.nozzleType` | `NozzleType` | Choice | |
| `settings.fields.nozzleMaterial` | `NozzleMaterial` | Choice | |
| `settings.fields.bedType` | `BedType` | Choice | |
| `settings.fields.printMaterial` | `PrintMaterial` | Choice | |

The five spec columns are declared once in `PRINTER_FIELDS` — key, label and
column name together — and everything else (form fields, row mapping, choice
loading, schema check) derives from that array. Adding a sixth spec field means
adding a SharePoint choice column, one entry in `PRINTER_FIELDS`, and one entry
in `DEFAULT_CHOICES`.

### Printer status

Three states the operator chooses, plus one the app sets.

| Status | Set by | Accepts new work | Can a job be started | Evicts queued jobs | Card dimmed |
| --- | --- | --- | --- | --- | --- |
| `Ready` | operator | yes | yes | no | no |
| `Busy` | **the app** | yes | yes | no | no |
| `Reserved` | operator | no | **no** | no | no |
| `Maintenance` | operator | no | **no** | yes — queued jobs return to staging | yes |

Defined in `PRINTER_STATUS`. The old `Active` / `Available` pair is entirely
gone now — the semantics went when the three-state control replaced them, and
the column name went when the column was replaced.

### Busy is derived, and automation never overrules a person

One rule covers it: **automation only ever moves a printer between `Ready` and
`Busy`.**

- A printer with a task `In progress` becomes `Busy`; one without goes back to
  `Ready`.
- `Reserved` and `Maintenance` are the operator's word, and automation does not
  touch them — an operator who reserves a machine mid-print still has it
  reserved when the print ends.
- `Busy` is **not offered in the status picker**. Choosing it manually would
  give you a control that snaps back the moment nothing is running.
- `Busy` still accepts new work, unlike `Reserved` and `Maintenance`. A printer
  mid-print is exactly where the next job queues.

`Reserved` and `Maintenance` also refuse to let a queued job be *started* —
"In progress" is disabled, with the reason in its tooltip, in both the context
menu and the detail modal. Previously they only refused new work arriving.

The reconciliation lives in an effect in `PrintFarmScheduler` and returns the
**same array** when nothing moved. That is load-bearing, not tidiness: the save
layer diffs by object identity, so a fresh array each time tasks changed would
PATCH every printer on every keystroke.

## Tasks

| App field | Column | Type | Notes |
| --- | --- | --- | --- |
| `id` | `TaskID` | Text | UUID |
| `printerId` | `PrinterID` | Text | Printer UUID, or the literal `staging` |
| `title` | `Title` | Text | |
| `jobcode` | `Jobcode` | Text | The shop's job reference, typically `XX000`. Not validated — a wrong-shaped code is better than a rejected save |
| `notes` | `Notes` | Multi-line text, **plain** | The requester's note. Editable only while the task is in staging — see below. A different column on a different list from the Printers `Notes` |
| `operatorNotes` | `OperatorNotes` | Multi-line text, **plain** | The operator's working note. Only shown, and only editable, once the task is on a printer |
| `status` | `Status` | Choice | `Not started` / `In progress` / `Complete` |
| `priority` | `Priority` | Choice | `Low` / `Normal` / `High` / `Urgent` |
| `sliceStatus` | `SliceStatus` | Choice | `Sliced` / `Not Sliced` / `Needs Nesting` |
| `quantity` | `Quantity` | Number | Defaults to 1 |
| `etaDate` | `EtaDate` | Date and Time | Written at noon UTC — see below |
| `etaTime` | `EtaTime` | Text | `HH:MM`, plain text on purpose |
| `needByDate` | `NeedByDate` | Date and Time | The deadline, where `EtaDate` is the prediction. Same noon-UTC write |
| `sentBy` | `SentBy` | Text | Requesting designer |
| `giveTo` | `GiveTo` | Text | Who receives the print |
| `notifyPeople` | `NotifyPeople` | Text | JSON `[{id, name}]`, Entra object ids — extra people to ping when the job starts printing. Deliberately not a Person column (site-user lookup ids are painful via Graph). The creator isn't stored here; SharePoint's author field already records them |
| `filepath` | `Filepath` | Text | Where the model lives |
| `printQuality` | `PrintQuality` | Choice | |
| `printStrength` | `PrintStrength` | Choice | |
| `printMaterial` | `PrintMaterial` | Choice | What the **job** asks for. A different column on a different list from the Printers one of the same name |
| `sortOrder` | `SortOrder` | Number | Position within its printer. **Staging does not order by it** — see below; it survives there only as the array position that breaks a total tie |
| `createdAt` | `CreatedAt` | Date and Time | Stamped once, at task creation (`nowIso()`). A real instant, not a user-picked date — see below |
| `completedAt` | `CompletedAt` | Date and Time | Stamped when `status` becomes `Complete`, cleared the instant it doesn't. Same real-instant treatment as `createdAt` |

### The two notes, and why one freezes

`Notes` is the **requester's**: what the designer wants the operator to know.
It is editable while the task sits in staging and **read-only once the task is
on a printer** — for everyone, the operator included. It is then a record of
what was asked for, and a record that can be rewritten afterwards is not one.
The modal renders it as grey text under "Notes — from the requester", and hides
it entirely when an assigned task has none rather than showing a permanent
blank.

`OperatorNotes` is the **operator's**, and is the one that stays live. It does
not appear at all while a task is in staging, because there is no operator on
the job yet.

Both are **plain-text** multi-line columns, not rich text. SharePoint's enhanced
rich text returns HTML through Graph, which would arrive on the board as visible
markup — the "Use enhanced rich text" toggle must stay off.

A task carrying an operator note shows a small note icon on its card, with the
text as the icon's tooltip. That is the only way a designer can read one, since
designer view does not open assigned tasks at all.

### Dates

`EtaDate` and `NeedByDate` are real Date and Time columns; `EtaTime` is plain
text.

The two dates answer different questions and are not interchangeable:
**`NeedByDate` is a commitment** — when the job is wanted — and exists from the
moment the task does. **`EtaDate` is a prediction** — when the print is expected
to finish — and only means anything once the task has a printer, which is why
the interface hides it while a task sits in staging.

Both dates are written at **noon UTC**, not midnight (`dateToIso`). Midnight UTC
displays as the previous evening anywhere west of Greenwich, so the SharePoint
list itself would show jobs due a day early. Noon survives any offset. The site is
Eastern, so the round trip is safe in both directions. Reading back just slices
the first 10 characters (`isoToDate`).

Because `EtaTime` is text, SharePoint cannot sort or filter by time of day. The
app sorts itself, so this only matters if someone later wants a native SharePoint
view like "due in the next four hours."

### `CreatedAt` and `CompletedAt` are not dates, they're instants

Unlike `EtaDate`/`NeedByDate`, these two aren't user-picked calendar dates —
nobody fills in a date-input for them. They're machine-set moments
(`nowIso()`, i.e. `new Date().toISOString()`), so the noon-UTC fudge above
does not apply: the real ISO timestamp round-trips as-is, with the actual time
of day intact. Don't route either through `dateToIso`/`isoToDate` — that
would silently throw away the time and misdate anything written near
midnight UTC.

`createdAt` is written once, in `addTask`, and never touched again;
`copyTask` gives a duplicate its own fresh value rather than inheriting the
original's, since a duplicate is a new job. `completedAt` is written and
cleared by `updateTask` itself whenever a patch includes `status`: stamped
the instant `status` becomes `Complete`, cleared the instant it doesn't — a
`completedAt` value on a task that isn't `Complete` would be a stale fact
nothing in the interface can make sense of.

Staging's display order uses both as tiebreakers within a priority tier —
see [ui-reference.md](ui-reference.md#staging-area) and
[decisions.md](decisions.md#priority-sorting-beats-manual-order-in-staging).

## Settings

A single-row-per-key key/value store.

| Column | Role |
| --- | --- |
| `Title` | the key |
| `Value` | single line of text |

Keys, matching `DEFAULT_APP_SETTINGS`:

| Key | Default | Meaning |
| --- | --- | --- |
| `stagingName` | `Staging area` | Label on the staging panel |
| `printersPerRow` | `2` | Printer cards across inside a group |
| `groupsPerRow` | `3` | Groups across on the board |

Numbers are stored as text and parsed on read. A missing key falls back to the
code default rather than erroring, so deleting a row degrades gracefully. Keys
not in `DEFAULT_APP_SETTINGS` are ignored on read and never written.

## Dropdown options

Seven lists are read from the SharePoint choice columns on sign-in
(`loadChoices()`), so the shop can edit them without a code change: the five
printer spec fields plus `PrintQuality` and `PrintStrength`. `DEFAULT_CHOICES`
stays in code as the fallback for a failed read — a stale dropdown beats an empty
one — and should be kept roughly in step with SharePoint.

`optionsFor()` appends a record's current value to the option list if it is no
longer among the choices, so a row written before a choice was removed does not
silently read as blank.

**Not read from SharePoint on purpose:** task `Status`, `Priority`,
`SliceStatus`, and printer `Status`. The app branches on every one of those, so
they stay in code.

### Two PrintMaterial columns

`PrintMaterial` exists on **both** lists and they mean different things:

- **Printers** — what the machine is currently loaded with. Choices `ABS` /
  `Other`. Picking an "Other" reveals a free-text box stored in
  `PrintMaterialOther`, because "Other" is not an answer on its own.
- **Tasks** — what the job is asking for. Choices `ABS` /
  `Other (Discuss with Operator)`; the longer wording is a message to the
  designer choosing it, not to the operator.

`loadChoices()` keys its results **by list**, not by column name. A flat map
would let whichever list was read last silently overwrite the other — a real
trap now that the two lists are deliberately different. The code that decides
whether to show the free-text box matches on the stem (`isOtherMaterial`), so
either list can be reworded in SharePoint without breaking it.

## What is not stored

- `collapsed` on a group — per-person view state.
- Staging's own collapsed state, search query, priority filter, and how many
  cards have been scrolled into view — all `useState` inside `StagingArea`.
- Which printer's settings panel is open, which task modal is open, drag state.
