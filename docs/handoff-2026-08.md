# Print Farm Scheduler — project handoff, August 2026

> Preserved verbatim from `PrintFarmSchedulerHandoffv1Live.pdf`, the document
> that seeded this repo's documentation. Everything in it has been expanded into
> the other files under `docs/`; this copy exists so the original wording stays
> available and no one has to hunt for the PDF. Where this file and the rest of
> the docs disagree, the code is the tiebreaker.

The app is built, connected to SharePoint, published to Teams, and in use. This
document describes the finished system so a new session can pick it up without
re-deriving anything.

## What it is

A Microsoft Teams tab for managing a 3D printing operation: a visual board where
print jobs are queued onto printers, tracked through their lifecycle, and staged
before assignment. Roughly 10–15 designers and operators inside one company.
Internal tool, built to stay usable at several hundred queued jobs.

## Where everything lives

| Piece | Location |
| --- | --- |
| Source | GitHub repo 221twoseven/print-farm-scheduler, public |
| Hosting | GitHub Pages — https://221twoseven.github.io/print-farm-scheduler/ |
| Data | SharePoint lists on https://twosevennet.sharepoint.com/sites/Ticketing/ |
| Identity | Entra ID app registration "Print Farm Scheduler" |
| Access | Teams tab, published org-wide, pinned in the Ticketing channel |

Five files in the repo root:

| File | Role |
| --- | --- |
| print-farm-scheduler.jsx | The entire application — interface and storage layer |
| index.html | Entry point. Loads React, Tailwind, lucide, MSAL, Teams SDK from CDNs and transpiles the JSX in the browser |
| auth.html | Sign-in window Teams opens on its behalf |
| config.html | Configuration page Teams loads when someone adds the tab |
| privacy.html / terms.html | Policy pages the Teams manifest requires |

There is no build step and no server. That is deliberate: the whole thing
deploys by committing files.

## Identity and sign-in

| Setting | Value |
| --- | --- |
| Application (client) ID | 948b6982-588a-4a0f-a109-169675cb4fd9 |
| Directory (tenant) ID | 70aa5330-416f-48cb-a64f-1a89f0196577 |
| Graph permission | Sites.ReadWrite.All (delegated), admin consent granted |
| SPA redirect URIs | …/print-farm-scheduler/ and …/print-farm-scheduler/auth.html |

Both IDs are in the SP block near the top of the persistence section. Neither is
a secret — an MSAL single-page app exposes both by design.

### How sign-in actually works

Three paths, tried in order:

1. **Silent.** On load the app calls `ssoSilent` against the Microsoft session
   the browser or Teams client already has, using the login hint from the Teams
   context. Most people never see a button.
2. **Teams window.** If silent fails inside Teams, Teams opens `auth.html` itself
   and that page runs the MSAL redirect. Teams forbids a popup opened by page
   script, which is why `loginPopup` fails there with `popup_window_error`.
3. **Browser popup.** Outside Teams, ordinary MSAL `loginPopup`.

The token cache is localStorage, not sessionStorage, because `auth.html` and the
tab are different windows and must see the same token. Consequence: on a shared
machine people stay signed in until someone uses Sign out.

Full Teams SSO — `getAuthToken` plus an on-behalf-of exchange — was not used. It
needs a server holding a client secret, and adding one would change the entire
deployment shape. The silent path gets most of the benefit.

## Data model

Four SharePoint lists on the Ticketing site: Groups, Printers, Tasks, Settings.

### Column names are not what they look like

SharePoint fixes a column's internal name at creation and never changes it, so a
renamed or rebuilt column still answers to its original name. Two columns here
are affected, and both cost a debugging cycle to find. The COLS block in the code
is the authority; this table records why two entries look wrong.

| List | App field | Internal name | Note |
| --- | --- | --- | --- |
| Printers | status | Active | Began as the Active Yes/No column, rebuilt as the three-state choice |
| Printers | uuid | PrinterID | Recreated without the space; was "Printer ID", internal Printer_x0020_ID |
| Tasks | uuid | TaskID | Capital D |
| Tasks | printerId | PrinterID | Holds the literal string "staging" when unassigned |

To check any column's internal name: List settings → click the column → read the
`Field=` value in the address bar.

### Dates

EtaDate is a real Date and Time column; EtaTime is plain text. Dates are written
at noon UTC rather than midnight, because midnight UTC displays as the previous
evening anywhere west of Greenwich and the SharePoint list itself would show jobs
due a day early. Noon survives any offset. The site is Eastern, so the round trip
is safe in both directions.

Because EtaTime is text, SharePoint cannot sort or filter by time of day. The app
sorts itself, so this only matters if someone later wants a native SharePoint
view like "due in the next four hours."

### Ordering

Every record carries an integer sortOrder mirroring the SortOrder column. Rows
arrive from Graph in arbitrary order and pass through `hydrate()` before entering
state; after that array position is authoritative and structural changes run
`reindex()`, which renumbers the affected scope and preserves object identity for
untouched rows. Scopes: groups are the board, printers their group, tasks their
printer, staging its own.

### Dropdowns

Seven cosmetic lists — the five printer spec fields plus print quality and
strength — are read from the SharePoint choice columns on sign-in, so the shop
edits them without a code change. DEFAULT_CHOICES stays as the fallback for a
failed read. The behavioral lists — task Status, Priority, SliceStatus, printer
Status — stay in code, because the app branches on every one.

### Settings list

Single-row key/value store: Title is the key, Value a single line of text. Keys:
stagingName, printersPerRow, groupsPerRow. Numbers stored as text and parsed on
read. A missing key falls back to the code default rather than erroring.

## How saving works

No mutation handler was rewritten when persistence landed. After any change, the
save layer compares the new arrays against the last saved snapshot by object
identity: rows that are a different object were edited, rows that appeared are
new, rows that vanished were deleted. This is sound only because `reindex()` and
every handler copy the rows they change and leave the rest alone.

- Writes debounce 700ms, so dragging a card produces one save rather than thirty.
- Before PATCHing, the mapped row is compared against the previous one and
  skipped if no stored column differs — otherwise toggling a group's collapse
  would fire a pointless write.
- One writer at a time. Anything arriving mid-write is coalesced and written on
  the next pass.
- A pill in the bottom-right reads Saving / Saved / Not saved, with the Graph
  error on hover and a retry link.
- `crypto.randomUUID()` for IDs, so two people creating rows simultaneously
  cannot collide.

The seam is the AppShell component plus the `initial` and `onPersist` props on
PrintFarmScheduler. No interface component knows storage exists.

## Settled decisions

These were argued through and should not be relitigated without a new reason.

- One self-contained file, no build step. Keeps deployment to committing files.
- Minimal collapsed cards plus a detail modal, after feedback that earlier cards
  were visually too busy.
- Batched auto-loading over list virtualization. Virtualization complicates
  drag-and-drop and find-in-page.
- Priority sorting beats manual order in staging. sortOrder is the tiebreaker
  within a tier, not an override of it.
- Group color for identity, state color for state. Printer color is not
  individually assignable.
- One three-state printer control, because two booleans produced an impossible
  fourth state.
- Group collapse is per-person and not persisted. The Collapsed column in the
  Groups list is unused on purpose — a shared Yes/No would have folded the group
  for everyone.
- SharePoint via Microsoft Graph and MSAL.js, not the retired Azure ACS /
  Add-ins method.

## Operating it

### Deploying a change

1. Edit `print-farm-scheduler.jsx` in the repo and commit.
2. Wait for the Pages build — check the Actions tab for a green check.
3. Hard-refresh, or use a private window. Babel fetches the JSX separately from
   the page, so it caches on its own.
4. Inside Teams, fully quit the client from the system tray and reopen. Teams
   holds tab content harder than a browser and has no hard refresh.

Two separate caches bit this project twice during deployment. When a change
appears not to have taken effect, suspect cache before suspecting the code.

### The Teams package

Built in the Developer Portal at dev.teams.microsoft.com and published org-wide;
the sysadmin approved it in the Teams admin center. The manifest carries only
URLs, so code changes never require republishing. Republish only when a URL,
icon, description, or scope changes — and bump the version, starting from 1.0.0.

Manifest 1.25+ requires `supportsChannelFeatures` for team scope. The portal
exposes it as Channel support under App content; without it the package fails
validation.

## Open items

Nothing blocking. Known gaps:

- Site regional timezone was never verified — no permissions. Cosmetic only: it
  affects how dates look to someone browsing the lists directly, not the app.
- An expired token inside Teams cannot renew silently, because the hidden-iframe
  renewal MSAL uses is blocked in a nested frame. The code sends the person back
  through the Teams window instead. Worth watching whether anyone notices after
  an hour of use.
- Sample data still ships in the file (seedGroups, seedPrinters, seedTasks). It
  is unreachable while the SP block has IDs in it, and it is what makes the app
  demonstrable if they are ever removed.

The JSX file remains the source of truth. Everything else wraps around it without
changing what it does.
