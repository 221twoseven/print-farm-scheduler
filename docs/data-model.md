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

`LEGACY_STATUS_COL` in the code reads the old column when the new one is empty,
so a row missed during the copy cannot silently turn a Maintenance printer into
a Ready one. **Delete that constant and its use when the legacy column goes.**

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
| `status` | `Status` | Choice | `Ready` / `Reserved` / `Maintenance`, plus `Busy` in the column but not yet used by the app — see [todo.md](todo.md) item 8 |
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

One control, three states. It replaced an on/off toggle plus an availability pill
which between them produced four states when only three mean anything.

| Status | Accepts new work | Evicts queued jobs | Card dimmed |
| --- | --- | --- | --- |
| `Ready` | yes | no | no |
| `Reserved` | no | no | no |
| `Maintenance` | no | **yes — queued jobs return to staging** | yes |

Defined in `PRINTER_STATUS`. The old `Active` / `Available` pair is entirely
gone now — the semantics went when the three-state control replaced them, and
the column name went when the column was replaced.

The SharePoint column also offers **`Busy`**, which nothing writes yet. Until
item 8 lands, setting a printer to Busy directly in SharePoint will read back as
Ready on the board, because `PRINTER_STATUS` has no entry for it.

## Tasks

| App field | Column | Type | Notes |
| --- | --- | --- | --- |
| `id` | `TaskID` | Text | UUID |
| `printerId` | `PrinterID` | Text | Printer UUID, or the literal `staging` |
| `title` | `Title` | Text | |
| `jobcode` | `Jobcode` | Text | The shop's job reference, typically `XX000`. Not validated — a wrong-shaped code is better than a rejected save |
| `status` | `Status` | Choice | `Not started` / `In progress` / `Complete` |
| `priority` | `Priority` | Choice | `Low` / `Normal` / `High` / `Urgent` |
| `sliceStatus` | `SliceStatus` | Choice | `Sliced` / `Not Sliced` / `Needs Nesting` |
| `quantity` | `Quantity` | Number | Defaults to 1 |
| `etaDate` | `EtaDate` | Date and Time | Written at noon UTC — see below |
| `etaTime` | `EtaTime` | Text | `HH:MM`, plain text on purpose |
| `needByDate` | `NeedByDate` | Date and Time | The deadline, where `EtaDate` is the prediction. Same noon-UTC write |
| `sentBy` | `SentBy` | Text | Requesting designer |
| `giveTo` | `GiveTo` | Text | Who receives the print |
| `filepath` | `Filepath` | Text | Where the model lives |
| `printQuality` | `PrintQuality` | Choice | |
| `printStrength` | `PrintStrength` | Choice | |
| `printMaterial` | `PrintMaterial` | Choice | What the **job** asks for. A different column on a different list from the Printers one of the same name |
| `sortOrder` | `SortOrder` | Number | Position within its printer (or within staging) |

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
