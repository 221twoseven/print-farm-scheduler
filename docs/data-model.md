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

Two columns here are affected, and both cost a debugging cycle to find:

| List | App field | Internal name | Why |
| --- | --- | --- | --- |
| Printers | `status` | `Active` | Began as the Active Yes/No column, rebuilt as the three-state choice. The rename did not follow. |
| Printers | `uuid` | `PrinterID` | Recreated without the space. Had it been renamed instead, it would still be `Printer_x0020_ID` |
| Tasks | `uuid` | `TaskID` | Capital D |
| Tasks | `printerId` | `PrinterID` | Holds the literal string `staging` when unassigned |

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
| `color` | `Color` | Text | Hex from `GROUP_COLORS`, assigned automatically |
| `sortOrder` | `SortOrder` | Number | Position on the board |
| `collapsed` | `Collapsed` | Yes/No | **Unused on purpose.** Collapse is per-person view state; a shared column would fold the group for everyone |

## Printers

| App field | Column | Type | Notes |
| --- | --- | --- | --- |
| `id` | `PrinterID` | Text | UUID |
| `name` | `Title` | Text | |
| `groupId` | `GroupID` | Text | The group's UUID |
| `status` | `Active` | Choice | `Ready` / `Reserved` / `Maintenance`. Internal name is a leftover — see above |
| `settings.notes` | `Notes` | Text | Free-form |
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

Defined in `PRINTER_STATUS`. The old `Active` and `Available` semantics are gone;
only the column name survives.

## Tasks

| App field | Column | Type | Notes |
| --- | --- | --- | --- |
| `id` | `TaskID` | Text | UUID |
| `printerId` | `PrinterID` | Text | Printer UUID, or the literal `staging` |
| `title` | `Title` | Text | |
| `status` | `Status` | Choice | `Not started` / `In progress` / `Complete` |
| `priority` | `Priority` | Choice | `Low` / `Normal` / `High` / `Urgent` |
| `sliceStatus` | `SliceStatus` | Choice | `Sliced` / `Not Sliced` / `Needs Nesting` |
| `quantity` | `Quantity` | Number | Defaults to 1 |
| `etaDate` | `EtaDate` | Date and Time | Written at noon UTC — see below |
| `etaTime` | `EtaTime` | Text | `HH:MM`, plain text on purpose |
| `sentBy` | `SentBy` | Text | Requesting designer |
| `giveTo` | `GiveTo` | Text | Who receives the print |
| `filepath` | `Filepath` | Text | Where the model lives |
| `printQuality` | `PrintQuality` | Choice | |
| `printStrength` | `PrintStrength` | Choice | |
| `sortOrder` | `SortOrder` | Number | Position within its printer (or within staging) |

### Dates

`EtaDate` is a real Date and Time column; `EtaTime` is plain text.

Dates are written at **noon UTC**, not midnight (`dateToIso`). Midnight UTC
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

## What is not stored

- `collapsed` on a group — per-person view state.
- Staging's own collapsed state, search query, priority filter, and how many
  cards have been scrolled into view — all `useState` inside `StagingArea`.
- Which printer's settings panel is open, which task modal is open, drag state.
