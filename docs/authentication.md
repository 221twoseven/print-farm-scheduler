# Identity and sign-in

## The app registration

Entra ID app registration **"Print Farm Scheduler"**.

| Setting | Value |
| --- | --- |
| Application (client) ID | `948b6982-588a-4a0f-a109-169675cb4fd9` |
| Directory (tenant) ID | `70aa5330-416f-48cb-a64f-1a89f0196577` |
| Graph permission | `Sites.ReadWrite.All` (delegated), admin consent granted |
| Platform | Single-page application |
| SPA redirect URIs | `https://221twoseven.github.io/print-farm-scheduler/` and `https://221twoseven.github.io/print-farm-scheduler/auth.html` |
| Client secret | none, and there must not be one |

Both IDs appear in the `SP` block in `print-farm-scheduler.jsx` and again as
`CLIENT_ID` / `TENANT_ID` in `auth.html`. **Neither is a secret** — an MSAL
single-page app exposes both by design; security comes from the redirect URI
allowlist and the user's own sign-in. If either ID ever changes, both files need
updating.

The permission is delegated, so every read and write happens as the signed-in
person with their own SharePoint permissions. Someone without access to the
Ticketing site cannot use the board, and nothing runs with elevated rights.

## The three sign-in paths

Tried in order:

### 1. Silent — `silentSignIn()`

On load the app looks for an account already in the MSAL cache and tries
`acquireTokenSilent`. Failing that it calls `ssoSilent` against the Microsoft
session the browser or Teams client already holds, passing the login hint from
the Teams context (`userPrincipalName`) so it never has to show an account
chooser. **Most people never see a button.**

### 2. Teams window — `teamsSignIn()`

If silent fails inside Teams, the app calls
`microsoftTeams.authentication.authenticate({ url: …/auth.html })`. Teams opens
that window itself; `auth.html` runs the ordinary MSAL redirect, catches the
result when it lands back on itself, and calls `notifySuccess`. The tab then
reads the account out of the shared MSAL cache.

This roundabout route exists because **Teams forbids a popup opened by page
script** — `loginPopup` fails there with `popup_window_error`. Teams opening the
window is the only way.

### 3. Browser popup — `signIn()`

Outside Teams, ordinary MSAL `loginPopup` with `prompt: "select_account"`.

`inTeams()` decides which branch applies: it races `microsoftTeams.app.initialize()`
against a 2-second timer, because the SDK's promise only resolves inside Teams
and would otherwise hang a plain browser tab. The answer is cached for the
session.

## Why localStorage

The MSAL cache is `localStorage`, not `sessionStorage`, because `auth.html` and
the tab are **different windows** and must see the same token.

Consequence: on a shared machine, people stay signed in until someone uses the
**Sign out** link in the status pill. That is a real trade-off, accepted
deliberately — without it path 2 cannot work at all.

Sign-out inside Teams clears the MSAL cache rather than calling `logoutPopup`,
which is itself a popup Teams would refuse; then the page reloads.

## Why not full Teams SSO

Full Teams SSO — `getAuthToken` plus an on-behalf-of token exchange — was not
used. The exchange requires a server holding a client secret, and adding one
would change the entire deployment shape from "commit files to a static host" to
"run and maintain a backend."

The silent path gets most of the benefit: nobody signs in twice and most people
never see the button.

## Token renewal, and the one known gap

`token()` calls `acquireTokenSilent` before every Graph request. When that fails:

- **In Teams:** MSAL's hidden-iframe renewal is blocked in a nested frame, so
  silent renewal is impossible. The code sends the person back through the Teams
  window (`teamsSignIn()`) and retries.
- **In a browser:** `acquireTokenPopup`.

The Teams case is the known open item. It is handled, but it means a long-idle
session can surface a sign-in window mid-work. Worth watching whether anyone
notices after an hour of use.

## Failure modes worth recognising

| Symptom | Cause |
| --- | --- |
| `popup_window_error` | `loginPopup` was reached inside Teams; the Teams-window path should have been taken |
| Sign-in window opens and immediately closes with no account | Redirect URI mismatch — the SPA URI list must contain both the app root and `auth.html`, exactly, including the trailing slash |
| "Column names don't line up" | Not auth at all — `checkSchema()` found a `COLS` mismatch. See [data-model.md](data-model.md) |
| `Graph 403` on every call | Admin consent for `Sites.ReadWrite.All` was revoked, or the person lacks access to the Ticketing site |
| Board loads for you, blank for a colleague | Their SharePoint permissions, not the app |

## Running without SharePoint

`configured()` returns false when `SP.clientId` or `SP.tenantId` is empty. In
that state `AppShell` skips auth entirely, passes no `initial` or `onPersist`,
and the board runs on the seed data with no status pill. Blanking the two IDs is
the supported way to get a demoable, offline copy.
