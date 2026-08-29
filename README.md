# Control Room — Futures Bot Dashboard

Standalone Next.js dashboard for the futures trading bot's dashboard API
(`server.ts` / `killSwitch.ts` / `broker.ts`). Password-protected, talks to
the bot over REST + WebSocket, no shared database.

## Setup

```bash
npm install

# 1. Set the dashboard login password (run once, or again to change it)
node scripts/hash-password.mjs "your-chosen-password"

# 2. Set a session-signing secret
cp .env.example .env.local
# then edit .env.local and set SESSION_SECRET to the output of:
openssl rand -hex 32

npm run dev
```

Open http://localhost:3000 — you'll land on `/login`.

## How auth works

Two separate layers, on purpose:

1. **Dashboard login** (`/login`) — a password you set locally via
   `scripts/hash-password.mjs`. The hash is written to
   `.credentials/password.hash` (gitignored) and checked against a bcrypt
   compare on `POST /api/login`. On success you get a signed, HttpOnly
   session cookie (12h expiry). `proxy.ts` (Next's middleware) blocks
   `/dashboard` and `/setup` until that cookie is valid.

   **Why not an env var for the password hash?** Bcrypt hashes are full of
   `$` characters (`$2b$12$...`), and Next.js's built-in `.env` loader does
   shell-style variable interpolation — it will silently mangle a bcrypt
   hash stored in `.env.local`. Storing it in its own file sidesteps that
   entirely. `SESSION_SECRET` (plain hex, no `$`) is fine in `.env.local`.

2. **Bot connection** (`/setup`) — after logging in, you enter the bot's
   server address and its `DASHBOARD_API_KEY` (set that on the bot's own
   `.env`, generate with `openssl rand -hex 32`). The API key is stored in
   an HttpOnly bot-session cookie and sent to the bot only by server-side
   dashboard proxy routes.

Sign out clears both the session cookie and the stored bot connection.

## What's here

- `/login` — password gate (real auth boundary, enforced server-side)
- `/setup` — bot server address + API key entry
- `/dashboard` — live positions, account summary, equity chart, risk
  panel, and the kill switch / pause-resume controls
- Kill switch requires a ~1.4s press-and-hold to fire (`POST
  /api/emergency/kill-switch`) — no accidental taps
- Pause/resume call `POST /api/trading/pause` and `/api/trading/resume`
- Login attempts are rate-limited (5 per 5 minutes per IP, in-memory —
  resets on server restart; fine for a single-operator deployment)

## Deploying

This app is self-contained — its own `package.json`, no shared deps. Put
it on its own subdomain (e.g. `control.yourdomain.com`) behind HTTPS.
`secure` cookies are enforced automatically once `NODE_ENV=production`.

If you later want this folded into another Next.js app (e.g. a future
admin panel), copy `app/(routes)`, `components/`, `lib/`, and `proxy.ts`
in, and either keep this password gate or swap it for that app's own auth
— just make sure something still protects `/dashboard` before merging.

## Copy-Trading Execution

Follower accounts can opt in only after email verification, exchange-key
verification, active subscription, and no unpaid performance-fee invoice.
When the leader bot executes a trade, call:

```text
POST /api/saas/copy-trades/execute
X-Service-Key: $SAAS_SERVICE_KEY
Content-Type: application/json
```

The body may be either the trade payload directly or a broker envelope
with `payload`/`data`. Required trade fields are `leaderTradeId`,
`action` (`OPEN` or `CLOSE`), `symbol`, `side` (`LONG` or `SHORT`),
`leaderNotional`, and `leaderBalance`.

The dashboard can also consume the bot event stream itself when running
as a long-lived local process. Set `COPY_TRADE_WORKER_ENABLED=true`; it
will subscribe to `${BOT_SERVER_URL}/api/events`, process
`TRADE_EXECUTED`, `position.opened`, and `position.closed` events, then
fan out execution through `${BOT_SERVER_URL}/api/saas/execute-copy-trade`.
