# Operating it

## Deploying a change

1. Edit `print-farm-scheduler.jsx`, **bump `BUILD`** at the top of the file, and
   push to a branch. Open a PR — nothing reaches `main` directly.
2. **Merge the PR.** Until it is merged the change is not on `main`, and Pages
   serves `main` and nothing else. A pushed branch is not a deploy: the site is
   byte-for-byte unchanged, so hard-refreshing, private windows, other browsers,
   and restarting Teams all correctly show you the old build. **If you are
   staring at an unchanged board, check this before anything else** — it is the
   cheapest thing on the list and the easiest to overlook.
3. Wait for the run in the **Actions** tab to finish, and check that the
   **deploy** job went green — not just the build. See below: they fail
   independently, and a green build is not a deployed site. A healthy run is
   about a minute from merge to live.
4. **Read the build stamp in the app.** It is in the header, after the printer
   and task counts, and on the sign-in screen. If it matches the `BUILD` you
   just merged, you are looking at the new code and anything still "wrong" is a
   real bug, not a stale tab. If it shows the old value, continue to the cache
   steps below. This is the whole reason the stamp exists — it turns "is it live
   yet?" from a guess into something you can read off the screen.
5. **Confirm what is actually live** before touching a browser cache. Open
   the raw file and search it for something the change introduced:

   ```
   https://221twoseven.github.io/print-farm-scheduler/print-farm-scheduler.jsx
   ```

   If the new code is not in there, the deploy did not land and no amount of
   refreshing will help.
6. Hard-refresh, or use a private window. **Babel fetches the JSX separately from
   the page, so it caches on its own** — reloading `index.html` is not enough.
7. Inside Teams, fully quit the client from the system tray and reopen. Teams
   holds tab content harder than a browser and has no hard refresh.

Two separate caches — the browser's HTTP cache on `print-farm-scheduler.jsx`, and
the Teams client's own content cache — bit this project twice during deployment.
But an unmerged PR and a failed deploy both look exactly like a caching problem
from inside Teams, and cache is the more expensive thing to chase. **Check the
merge (step 2) and the build stamp (step 4) first, then blame cache.**

On 2026-08-10 this cost a round of hard-refreshing, private windows, two
browsers, and a Teams restart against a change that was still sitting unmerged
on a branch. Nothing client-side can fix a file the server was never given. The
build stamp was added the same day so the question is answerable from the
screen.

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

### Enabling the activity notifications (item 12)

The sends are in the code and fail silently until all three of these are done,
in either order:

1. **Admin consent for `TeamsActivity.Send`** (delegated) on the app
   registration in Entra — same procedure as the two 2026-08-17 scopes.
   Until granted, each person gets one interactive consent prompt at next
   sign-in; the board loads either way.
2. **Declare the activity types in the manifest** and republish (bump the
   version). In the Developer Portal this is **Activity feed notifications**;
   the manifest JSON is:

   ```json
   "activities": {
     "activityTypes": [
       { "type": "jobStarted",
         "description": "A job started printing",
         "templateText": "{jobName} started printing" },
       { "type": "jobQueued",
         "description": "A new job was added to staging",
         "templateText": "New job in staging: {jobName}" }
     ]
   }
   ```

   Graph rejects a send whose `activityType` isn't declared, so notifications
   simply stay off until the republished package rolls out.

3. **Link the Teams app to the Entra app registration** via
   `webApplicationInfo` in the manifest — Graph maps the caller's token to a
   Teams app through it, and without it rejects every
   `sendActivityNotification`, activities declaration or not. In the
   Developer Portal this is **Single sign-on → Application ID URI**; set it to

   ```
   api://221twoseven.github.io/948b6982-588a-4a0f-a109-169675cb4fd9
   ```

   (the GUID is the Entra **client ID** — the portal writes it into
   `webApplicationInfo.id`, which is the part Graph checks; the URI itself is
   only used by Teams SSO, which this app doesn't use, so it never has to
   match an "Expose an API" URI in Entra). Republish after setting it.

Steps 1 and 2 were **done 2026-08-18** (manifest 1.0.1); step 3 was the one
the 2026-08-18 debugging session found missing — the two-step checklist above
was incomplete, and notifications stayed silently off with everything else
correct. Lessons from doing it,
for the next manifest change:

- The app registration was orphaned — visible in no one's Developer Portal.
  Recovery is **Take ownership** on dev.teams.microsoft.com, which wants the
  Teams app's **manifest GUID** (admin center → Manage apps → the app →
  "External app ID"), *not* the Entra client ID — those are two different
  registrations with two different GUIDs, and the wrong one fails silently.
- Admin center's **Upload new app** is create-only here: it rejects a package
  whose app ID already exists. Updates go through the Developer Portal's
  **Submit app update** button on the Publish page (publish-to-org from the
  same page had already failed silently once — the catalog stayed at 1.0.0
  until Submit app update pushed 1.0.1 through).
- Verify by the **version on the app's admin-center detail page**, not the
  approvals queue — an admin's own update can land with nothing pending.

Who gets pinged: on a job's **first run** (it starts printing), the job's
creator — read from the SharePoint row's author, so jobs created before this
feature still resolve; a job created this session has no author yet and falls
back to the acting user — plus everyone in its Notify list. The actor is
**not** excluded: the shop runs effectively solo (2026-08-18), and filtering
out the actor made every one-person action a silent no-op. On a **new staging
job**, the ids in `OPERATOR_NOTIFY_IDS`
(a code constant, empty until the shop hires a dedicated operator). Sends
fire from the acting user's session, best effort: a failure is logged to the
console and never blocks the board.

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
