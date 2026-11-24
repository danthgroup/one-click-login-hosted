# One-click login — hosted engine

Standalone, deployable copy of the one-click login engine.

## The flow (agreed — do not change it)

1. **Opening the link is the request.** There is no "Request login" button
   and no form. A device that opens the link and isn't signed in
   automatically appears as waiting.
2. **The phone that has the login opens the same page**, sees the waiting
   device, and taps **Approve** once.
3. Approving stores a session. **The waiting device signs itself in and
   stays in.** The phone that approved is remembered as the approver, so
   it stops asking for itself.
4. Deny, Cancel, "Ask again", Sign out (revoke) and Clear past requests
   all work.

Deliberately **not** in this build: no mail (no Gmail, no Outlook mail),
no code, no numbers, no time limit / expiry. A request waits until it is
approved, denied, or cancelled.

## Honest limit

This is the user's **own engine**, not Microsoft/Outlook login.
Approving gives access to **this app only**, not to a real Outlook
account, and it does not talk to Microsoft at all. Anyone with the link
can approve a waiting device, so **keep the link private** — share it
only with the phone that should approve.

## Run locally

```bash
node server.js
# open http://localhost:3000
```

No dependencies, no build step, Node 18+. Data is stored in
`./data/store.json` (created on first run). Set `DATA_DIR` to change
where the file lives, `PORT` to change the port.

## Deploy to Railway

> **Not deployed yet.** No Railway login/session could be checked from
> this machine (no Railway CLI installed, no live Railway session
> available here), so the exact account/project was **not** verified.
> Before deploying, confirm in the Railway dashboard that you are signed
> in to the right account and that the project is the one you use for
> RAT — per memory that is **`lovely-nurturing`**
> (`hearty-respect` is the wrong/crashed one). Do not deploy into a
> different project by accident.

### Files needed

Everything in this folder. Nothing else. In particular:

- `server.js` — the whole server (Node stdlib only, zero dependencies)
- `public/index.html` — the page
- `package.json` — `start` is `node server.js`
- `railway.json` — Nixpacks build, `node server.js`, health check `/health`
- `Dockerfile` / `Procfile` — included as a fallback; Railway uses
  `railway.json` (Nixpacks) first

### Steps (one go)

1. Push this folder to a GitHub repo (new repo, e.g.
   `one-click-login-hosted`, or a folder in an existing repo — Railway
   needs a repo it can read).
2. In Railway, open the **`lovely-nurturing`** project (verify the
   project name at the top of the dashboard first).
3. **New Service → GitHub Repo** → pick the repo. Railway detects
   Node, builds with Nixpacks, and starts `node server.js`.
4. Add a **Volume** so sessions survive restarts/redeploys:
   service → **Volumes → New Volume**, mount path **`/data`**.
   The server uses `/data` automatically when it exists (same pattern
   as RAT's `DB_PATH=/data/rat.db`). Without a Volume, redeploys wipe
   the sessions and every device has to be approved again.
5. Generate a public domain: service → **Settings → Networking →
   Generate Domain**. That is the shareable link.
6. Open the link on the computer, then open the **same link** on the
   phone and tap Approve.

No environment variables are required. Optional: `DATA_DIR` (default
is `/data` when that folder exists, else `./data`), `PORT` (Railway
sets this itself).

### What the public URL looks like once deployed

Railway generates a domain like:

```text
https://one-click-login-hosted-production-xxxx.up.railway.app
```

(The exact subdomain is assigned by Railway at deploy time — it
cannot be known in advance, so **no live URL is claimed here**.)
That URL is the link to send to the phone. Opening it is the request;
tapping Approve on the phone gives the computer access.

### Deploy as a separate service, not inside RAT

Do **not** add this to the RAT service. It is its own Railway service
inside the same project (or its own project — either works). It shares
nothing with RAT: no database, no env vars, no bot token.

## API (for reference)

- `GET /api/state` — my device, signed-in state, waiting devices, past
- `POST /api/approve {requestId}` — approve a waiting device
- `POST /api/deny {requestId}` — deny a waiting device
- `POST /api/cancel` — cancel my waiting request
- `POST /api/ask-again` — ask again after deny/cancel
- `POST /api/signout` — revoke my session
- `POST /api/clear-past` — clear past requests
- `GET /health` — `ok` (Railway health check)
