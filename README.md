# Print Farm Scheduler

A Microsoft Teams tab for managing a 3D printing operation: a visual board where
print jobs are queued onto printers, tracked through their lifecycle, and staged
before assignment. Roughly 10–15 designers and operators inside one company.
Internal tool, built to stay usable at several hundred queued jobs.

The app is built, connected to SharePoint, published to Teams, and live in the
Ticketing channel. The shop has not cut over from its previous ticketing system
yet, so the lists currently hold test data.

**That is not licence to treat this as a toy.** It has to be usable the day the
shop switches, which could be any day, and a schema or save-layer mistake
discovered then is far more expensive than one caught now. Work to production
standard: verify the deploy, check the column's internal name, keep the
identity invariant. The instructions in `CLAUDE.md` assume live data on
purpose.

## Where everything lives

| Piece | Location |
| --- | --- |
| Source | GitHub repo `221twoseven/print-farm-scheduler`, public |
| Hosting | GitHub Pages — https://221twoseven.github.io/print-farm-scheduler/ |
| Data | SharePoint lists on https://twosevennet.sharepoint.com/sites/Ticketing/ |
| Identity | Entra ID app registration "Print Farm Scheduler" |
| Access | Teams tab, published org-wide, pinned in the Ticketing channel |

## The files

| File | Role |
| --- | --- |
| `print-farm-scheduler.jsx` | The entire application — interface and storage layer |
| `index.html` | Entry point. Loads React, Tailwind, lucide, MSAL and the Teams SDK from CDNs and transpiles the JSX in the browser |
| `auth.html` | Sign-in window Teams opens on the app's behalf |
| `config.html` | Configuration page Teams loads when someone adds the tab |
| `privacy.html` / `terms.html` | Policy pages the Teams manifest requires |

**There is no build step and no server.** That is deliberate: the whole thing
deploys by committing files. See [docs/decisions.md](docs/decisions.md).

## Running it locally

Any static file server over the repo root works — there is nothing to install
and nothing to compile:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

Sign-in will fail against `localhost` unless that origin is added as an SPA
redirect URI on the app registration. Without SharePoint the board falls back to
sample data (`seedGroups` / `seedPrinters` / `seedTasks`), which is enough to
work on interface changes. See [docs/operations.md](docs/operations.md#working-locally).

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | How the file is laid out, the state model, ordering, and the save layer |
| [docs/data-model.md](docs/data-model.md) | The four SharePoint lists, every column, and the internal-name traps |
| [docs/authentication.md](docs/authentication.md) | Entra registration, the three sign-in paths, token caching, known limits |
| [docs/operations.md](docs/operations.md) | Deploying a change, the two caches, the Teams package, troubleshooting |
| [docs/ui-reference.md](docs/ui-reference.md) | What the board does, feature by feature — the behaviour spec |
| [docs/decisions.md](docs/decisions.md) | Settled decisions that should not be relitigated, plus open items |
| [docs/todo.md](docs/todo.md) | Open bugs and feature requests, ordered simplest first, with the SharePoint work each needs |
| [docs/handoff-2026-08-17-model.md](docs/handoff-2026-08-17-model.md) | Session handoff: the job/subtask model session (items 31–34), the concurrent-session hazard, verification ceiling, traps |
| [docs/handoff-2026-08-17-notify.md](docs/handoff-2026-08-17-notify.md) | Session handoff: the notify-people picker session (item 12 groundwork), and the notification design still to build |

Only the most recent session handoffs are kept; superseded ones (the original
August 2026 seed document, 2026-08-08, 2026-08-12) live in git history.

`CLAUDE.md` at the repo root is the working agreement for Claude Code sessions.

The JSX file remains the source of truth. Everything else wraps around it
without changing what it does.
