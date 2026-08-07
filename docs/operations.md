# Operating it

## Deploying a change

1. Edit `print-farm-scheduler.jsx` and commit to `main`.
2. Wait for the run in the **Actions** tab to finish, and check that the
   **deploy** job went green — not just the build. See below: they fail
   independently, and a green build is not a deployed site.
3. **Confirm what is actually live** before touching a browser cache. Open
   the raw file and search it for something the change introduced:

   ```
   https://221twoseven.github.io/print-farm-scheduler/print-farm-scheduler.jsx
   ```

   If the new code is not in there, the deploy did not land and no amount of
   refreshing will help.
4. Hard-refresh, or use a private window. **Babel fetches the JSX separately from
   the page, so it caches on its own** — reloading `index.html` is not enough.
5. Inside Teams, fully quit the client from the system tray and reopen. Teams
   holds tab content harder than a browser and has no hard refresh.

Two separate caches — the browser's HTTP cache on `print-farm-scheduler.jsx`, and
the Teams client's own content cache — bit this project twice during deployment.
But a failed deploy looks exactly like a caching problem from inside Teams, and
cache is the more expensive thing to chase. **Confirm the file on the server
first (step 3), then blame cache.**

### When the deploy hangs

"pages build and deployment" is two jobs, **build** then **deploy**, and the
Actions list shows one line for both. The build stage compiles the site; the
deploy stage just polls GitHub's Pages backend until it reports done. They fail
for completely different reasons:

- **Build fails** — something about the files. Read the log; it will name the
  offending file.
- **Deploy fails** — nothing to do with the repo. The log shows
  `Current status: deployment_in_progress` repeating for ten minutes, then
  `Timeout reached, aborting!`. The site keeps serving whatever was last
  deployed successfully.

A healthy deploy on this repo takes **40 seconds to a minute**. Anything around
ten minutes is the timeout, not slowness.

**Check https://www.githubstatus.com first.** Not last — first. On 2026-08-06
this section said to check it "once before assuming a platform fault", and that
ordering cost seven hours and an outage. Actions and Pages were degraded all
afternoon; every symptom below was a consequence, and none of it was fixable
from this side.

Signs the fault is GitHub's and not yours:

- A build job sitting with `runner_id: 0` and an empty runner name — it never
  got a machine, so nothing in the repo can be responsible.
- Runs stuck *Queued* for tens of minutes.
- The Actions API rejecting both cancel
  (`Cannot cancel a workflow re-run that has not yet queued`) and re-run
  (`This workflow is already running`) for the same run.
- Runs completing as **cancelled** rather than failed. A cancelled run that was
  superseded by a newer one is a non-event; only the last run matters.

When that is the picture, the answer is to **wait**. Specifically:

- **Do not re-run.** Every re-run attempted during that incident wedged into a
  state that could be neither cancelled nor retried, and each one added to a
  queue that could not drain. Fresh pushes were scheduled; re-runs were not.
- **Do not unpublish Pages.** This is the one that hurts. Republishing needs a
  successful build, so unpublishing during an Actions outage converts a
  *stale but working* board into a hard 404 with no way back until Actions
  recovers. A stale board is a working board; a 404 is an outage for everyone.
  There is no undo.

Merging back-to-back is fine, by the way. A second push cancels the older
deployment and the newer one carries both commits — correct behaviour, not an
error, and not worth choreographing around.

### If the board is down

The interface is the only thing affected. **The data is untouched and still
reachable**: the SharePoint lists at
https://twosevennet.sharepoint.com/sites/Ticketing/ hold every job with its
printer, status, priority and dates, and the shop can read and edit them
directly in the SharePoint UI meanwhile. The board picks up those edits when it
returns. Worth telling whoever is on shift, so an outage is not mistaken for
lost work.

### Recovering once Actions is healthy

A push to `main` triggers a fresh run; that is the reliable trigger. If Pages
was unpublished, re-select `main` / `(root)` **and** push a commit — the
settings change alone did not start a build. Then verify with the raw file
check above rather than the Actions line.

Other things worth ruling out, though all were clean on 2026-08-06:
**Settings → Environments → `github-pages`** for a required reviewer or wait
timer, which would hold a deployment in exactly this state.

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
| Change didn't take effect | Check the deployed file first (see step 3 above). If the new code is on the server, it's cache twice over: hard-refresh the browser, fully quit and reopen Teams. If it isn't, the deploy failed — the Actions line can read as failed while the *build* was fine |
| "Could not load the board" with a column list | `checkSchema()` — fix `COLS`, not SharePoint |
| Status pill stuck on "Not saved" | Hover it for the Graph error; click Retry. `flush()` keeps the pending snapshot, so nothing is lost until the tab closes |
| Blank board, console shows a Babel error | Syntax error in the JSX — it ships unvalidated |
| Board loads but dropdowns are the built-in defaults | `loadChoices()` failed; check the console warning. Non-fatal by design |
| Site returns a 404 rather than a stale board | Pages has no successful deployment behind it — usually because it was unpublished and never rebuilt. Push a commit to `main`; the settings change alone does not start a build |
| Someone's edits vanished | Two people editing the same row: last writer wins. There is no conflict detection — see [decisions.md](decisions.md#open-items) |
| Sign-in loop or `popup_window_error` | See [authentication.md](authentication.md#failure-modes-worth-recognising) |

## Data recovery

There is no export and no backup beyond SharePoint's own. The lists are ordinary
SharePoint lists: version history and the site recycle bin both apply, and a
deleted row can be restored there. A restored row keeps its `TaskID` / `PrinterID`
UUID, so the app picks it back up on the next load without duplicating anything.
