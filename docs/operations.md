# Operating it

## Deploying a change

1. Edit `print-farm-scheduler.jsx` and commit to `main`.
2. Wait for the GitHub Pages build — check the **Actions** tab for a green check.
3. Hard-refresh, or use a private window. **Babel fetches the JSX separately from
   the page, so it caches on its own** — reloading `index.html` is not enough.
4. Inside Teams, fully quit the client from the system tray and reopen. Teams
   holds tab content harder than a browser and has no hard refresh.

Two separate caches — the browser's HTTP cache on `print-farm-scheduler.jsx`, and
the Teams client's own content cache — bit this project twice during deployment.
**When a change appears not to have taken effect, suspect cache before suspecting
the code.**

There is no build step, no test suite and no linter in CI. The only gate between
a commit and production is the Pages build, which only fails on infrastructure
problems, not on broken JSX. A syntax error ships and shows up as a blank board
with a Babel error in the console. Read the diff before pushing.

## Working locally

Any static server over the repo root:

```bash
python3 -m http.server 8080
# http://localhost:8080/
```

Two ways to work:

- **Against real data.** Add `http://localhost:8080/` and
  `http://localhost:8080/auth.html` as SPA redirect URIs on the app registration.
  Writes go to the live SharePoint lists — there is no staging site, so treat
  every drag as production.
- **Offline on seed data.** Blank `SP.clientId` and `SP.tenantId` locally.
  `configured()` goes false, auth is skipped, and the board runs on
  `seedGroups` / `seedPrinters` / `seedTasks`. **Never commit the blanked
  values.**

## The Teams package

Built in the Developer Portal at https://dev.teams.microsoft.com and published
org-wide; the sysadmin approved it in the Teams admin center.

**The manifest carries only URLs, so code changes never require republishing.**
Republish only when a URL, icon, description or scope changes — and bump the
version when you do, starting from 1.0.0.

Manifest 1.25+ requires `supportsChannelFeatures` for team scope. The portal
exposes it as **Channel support** under **App content**; without it the package
fails validation.

The tab's content URL is set by `config.html` when someone adds the tab —
`entityId: "printFarmScheduler"`, suggested name "Print Farm". There is nothing to
configure, so Save is enabled immediately.

## Changing the SharePoint schema

Adding a column the app should store means, in order:

1. Create the column in SharePoint.
2. Read back its **internal** name: List settings → click the column → the
   `Field=` value in the address bar. Do not assume it matches the display name.
3. Add it to `COLS` (and to `PRINTER_FIELDS` if it is a printer spec dropdown,
   and `DEFAULT_CHOICES` if it is a choice column).
4. Add it to the `fromRow` and `toRow` mappers for that list.

`checkSchema()` will refuse to load and list every mismatch if step 2 or 3 goes
wrong, which is the intended safety net — read its message, it names the columns
the list actually has.

Renaming an existing column in SharePoint does **not** change its internal name,
so it does not require a code change. Deleting and recreating one does.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Change didn't take effect | Cache, twice over: hard-refresh the browser, fully quit and reopen Teams |
| "Could not load the board" with a column list | `checkSchema()` — fix `COLS`, not SharePoint |
| Status pill stuck on "Not saved" | Hover it for the Graph error; click Retry. `flush()` keeps the pending snapshot, so nothing is lost until the tab closes |
| Blank board, console shows a Babel error | Syntax error in the JSX — it ships unvalidated |
| Board loads but dropdowns are the built-in defaults | `loadChoices()` failed; check the console warning. Non-fatal by design |
| Someone's edits vanished | Two people editing the same row: last writer wins. There is no conflict detection — see [decisions.md](decisions.md#open-items) |
| Sign-in loop or `popup_window_error` | See [authentication.md](authentication.md#failure-modes-worth-recognising) |

## Data recovery

There is no export and no backup beyond SharePoint's own. The lists are ordinary
SharePoint lists: version history and the site recycle bin both apply, and a
deleted row can be restored there. A restored row keeps its `TaskID` / `PrinterID`
UUID, so the app picks it back up on the next load without duplicating anything.
