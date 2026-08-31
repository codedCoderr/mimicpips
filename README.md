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

For follower trust/risk visibility, open-trade payloads should also include
the active stop-loss state. The SaaS parser accepts any of these stop price
keys: `stopLossPrice`, `stopLoss`, `atrStopLoss`, or `atrStopLossPrice`.
If the stop is ATR-based, also send `stopLossType: "ATR"` plus
`atrPeriod`/`atrMultiplier` (or the existing SuperTrend aliases
`stPeriod`/`stMult`). Example:

```json
{
  "leaderTradeId": "BTCUSDT-2026-08-31T09:30:00Z",
  "action": "OPEN",
  "symbol": "BTC/USDT:USDT",
  "side": "LONG",
  "leaderNotional": 250,
  "leaderBalance": 5000,
  "entryPrice": 64250.5,
  "stopLossPrice": 62880.2,
  "stopLossType": "ATR",
  "atrPeriod": 7,
  "atrMultiplier": 2
}
```

If an `OPEN` event reaches `/api/saas/copy-trades/execute` without stop
data, the response includes a `warnings` entry and
`stopLossProtection.present: false`; the follower dashboard will show the
trade's stop state as pending until the bot sends it.

The dashboard can also consume the bot event stream itself when running
as a long-lived local process. Set `COPY_TRADE_WORKER_ENABLED=true`; it
will subscribe to `${BOT_SERVER_URL}/api/events`, process
`TRADE_EXECUTED`, `position.opened`, and `position.closed` events, then
fan out execution through `${BOT_SERVER_URL}/api/saas/execute-copy-trade`.

## Marketing Signals

The operator dashboard includes `/dashboard/marketing` for turning trading outcomes and follower-health risk signals into retention messages and public proof points. Email sending uses the SMTP settings in `.env.local`. Telegram sending is optional; set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_PUBLIC_CHANNEL_ID`, then add the bot as an admin/member of the channel before using the send action.

## Testing Follower Health and Marketing Automation

Seed realistic follower scenarios into the SaaS database with:

```bash
npm run seed:marketing
```

The script reads `MONGO_URI` and `SAAS_DB_NAME` from `.env.local`. It is idempotent by follower email and creates these test followers using password `TestPass123!` unless `SEED_USER_PASSWORD` is set:

- `healthy.follower@mimicpips.test` — active, profitable, low-anxiety baseline.
- `anxious.afterloss@mimicpips.test` — recent losses, high dashboard checking, renewal soon.
- `likely.churn@mimicpips.test` — disabled copy trading, support/risk actions, losses, renewal soon.
- `pastdue.invoice@mimicpips.test` — past-due subscription and unsettled performance invoice.
- `not.ready@mimicpips.test` — unverified, no exchange, pending payment.

After seeding, test:

- `/dashboard/followers` to see health score, churn drivers, and recommended actions.
- `/dashboard/marketing` to create saved signals, draft from retention opportunities, send retention emails, and send/copy Telegram messages.
- `/app/login` with a seeded follower email to see the follower-facing Risk Guard confidence panel.

Email sends require `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. Telegram sends require `TELEGRAM_BOT_TOKEN` and `TELEGRAM_PUBLIC_CHANNEL_ID`.


### Retention Email Cron

The daily retention email job can be tested from the operator UI at `/dashboard/marketing` using `Dry-run emails` first, then `Send retention emails`. The job is idempotent by day, reason, and follower, so the same user will not receive duplicate automated retention emails for the same campaign key in one day.

For a real scheduler, set `CRON_SECRET` and call this endpoint once per day:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/cron/retention-emails" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Dry-run without sending:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/cron/retention-emails?dryRun=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

On AWS you can run this with EventBridge Scheduler hitting the deployed URL through an HTTPS target, or with any external cron service that supports custom authorization headers.

### Automated Telegram marketing signals

The signal channel should be the broadcast destination, not the bot chat. Keep `TELEGRAM_BOT_TOKEN` set to the bot token and set `TELEGRAM_PUBLIC_CHANNEL_ID` to the signal channel username or numeric `-100...` channel ID. Add the bot as a channel administrator with posting rights.

Set `AUTO_TELEGRAM_MARKETING=true` only when you want the scheduled scanner to automatically publish qualifying marketing proof points. With the default `false`, the scanner can still create deduped marketing events for operator review. The operator can test the scanner from `/dashboard/marketing` using `Run automation scan`.

For local worker testing, run the web app and worker in separate terminals:

```bash
npm run dev
npm run worker
```

For Amplify production, prefer EventBridge Scheduler calling the cron route instead of relying on a long-running worker:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/cron/marketing-automation" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Use a 30-minute EventBridge schedule for marketing scans. The scanner uses campaign keys, so repeated runs should not duplicate the same condition for the same day.
