# GoFocus

A distraction-free study timer. You pick up to **5 YouTube videos or playlists** for the day, then study from only those, with a focus timer that counts every time you leave the tab. Finishing sessions fills a candy jar, builds a streak and unlocks badges, all stored in your account.

**Live demo:** _add your link here_ · **Stack:** Node.js, Express, PostgreSQL, vanilla JS (no framework, no build step)

## Features

- Email + password accounts (bcrypt, JWT in an httpOnly cookie)
- Daily picks: paste a YouTube video or playlist link, max 5 per day, played in a privacy-friendly embed
- Focus timer with a progress ring, pause/resume, keyboard shortcut (`Space`), and tab-switch tracking via the Page Visibility API
- Server-verified rewards: 2 candies per completed session, +1 for zero tab switches
- Progress page: today, streak, focus score, 7-day bar chart, 12-week consistency heatmap (all drawn as SVG, no chart library)
- Rewards page: candy jar levels and badges
- Daily goal and saved affirmations, light/dark theme, responsive layout

## Run it locally

```bash
git clone <your-repo-url> && cd gofocus
npm install
cp .env.example .env        # then fill in DATABASE_URL and JWT_SECRET
npm start                   # tables are created automatically on startup
```

Open http://localhost:3000. Set `ALLOW_SHORT_SESSIONS=true` in `.env` to get a 6-second demo session.

Tests (they need a throwaway Postgres database):

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gofocus_test npm test
```

## Design decisions

**The server owns the clock.** `POST /api/sessions/start` records `started_at` in Postgres. On finish, the server checks that real elapsed time is at least 90% of the planned length before it awards any candies. A client that just sends "completed: true" immediately gets nothing (there is a test for exactly this). Pausing is safe because the server clock only keeps running.

**The timer uses timestamps, not a counter.** The old `setInterval(() => seconds--)` approach slows down in background tabs, which is a real problem for an app about leaving tabs. The timer stores an end time and recomputes the remaining time from `Date.now()` on every tick.

**The "max 5 picks" rule can't be raced past.** The add-video route runs in a transaction that takes `pg_advisory_xact_lock(user_id)` before counting, so concurrent requests are serialised per user. The test fires 9 simultaneous adds and asserts exactly 5 total succeed.

**Stats are computed in SQL.** The heatmap uses `generate_series` joined to sessions so days with no activity still appear as zeros. Streaks are computed from the distinct set of days with a completed session.

**Security basics:** passwords hashed with bcrypt; JWT in an `httpOnly`, `SameSite=Lax` cookie (not readable by JS, not sent on cross-site POSTs); input validated with zod; every query is parameterised; every row is scoped by `user_id` (tests check users can't touch each other's data); Helmet with a strict Content-Security-Policy (no inline scripts, only YouTube embeds allowed as frames); rate limiting on `/api` and `/api/auth`; the UI builds DOM with `textContent`, never `innerHTML`, so user text can't inject markup.

## Schema

`users` · `videos` (unique per user/day/video) · `sessions` (status: running / completed / abandoned) · `goals` (one per user per day) · `affirmations`. See `server/schema.sql`.

## API

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | accounts |
| GET | `/api/auth/me`, `/api/config` | current user, allowed durations |
| GET / POST / DELETE | `/api/videos`, `/api/videos/:id` | today's picks |
| POST | `/api/sessions/start`, `/api/sessions/:id/finish` | focus sessions |
| GET | `/api/stats` | totals, streak, 7-day and 84-day series, jar |
| GET / PUT | `/api/goal` | goal of the day |
| GET / POST / DELETE | `/api/affirmations`, `/api/affirmations/:id` | affirmations |

## Deploy (free tier)

1. Create a Postgres database on [Neon](https://neon.tech) and copy the connection string.
2. Push this repo to GitHub, then create a **Web Service** on [Render](https://render.com): build command `npm install`, start command `npm start`.
3. Set environment variables: `DATABASE_URL`, `JWT_SECRET`, `APP_TZ`, `NODE_ENV=production`.
4. Put the Render URL at the top of this README.

## Known limitations

- Day boundaries use one server-wide timezone (`APP_TZ`), not a per-user one.
- Rate-limit counters live in memory, so they reset on restart and don't share across multiple instances (Redis would fix this).
- An unfinished session is marked abandoned when the tab closes (via `sendBeacon`) or when you start a new one; a crash mid-session is cleaned up on the next start.

## Ideas for next steps

Google OAuth login, per-user timezones, a study-subject tag on each session with a per-subject chart, a Redis-backed rate limiter, and a Dockerfile.
