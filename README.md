# GoFocus

GoFocus is a study timer built to help students stay focused while studying with YouTube. Instead of opening YouTube and getting distracted by other videos, you choose up to five videos or playlists for the day and study using the embedded player.

The app tracks your focus sessions, counts how often you switch away from the tab, and rewards you when you complete a session. You can also track your progress, maintain a streak, set daily goals, and save affirmations to keep yourself motivated.

## Features

- **User accounts:** Register and log in using an email and password.
- **Daily video limit:** Add up to five YouTube videos or playlists per day.
- **Focus timer:** Start, pause, and resume study sessions.
- **Tab-switch tracking:** Count when you leave the app tab using the Page Visibility API.
- **Rewards:** Earn 2 candies for a completed session, plus 1 extra candy if you don't switch tabs.
- **Progress tracking:** View your streak, focus score, a 7-day activity chart, and a 12-week heatmap.
- **Daily goals:** Set a study target and track your progress.
- **Saved affirmations:** Keep personal reminders in one place.
- **Light and dark themes:** Switch between themes based on your preference.

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** PostgreSQL
- **Frontend:** HTML, CSS, JavaScript
- **Authentication:** bcrypt, JWT
- **Validation and security:** Zod, Helmet, rate limiting

## Getting Started

You'll need Node.js 20 or later and a PostgreSQL database.

### 1. Clone the repository

```bash
git clone https://github.com/ritikaa77/gofocus.git
cd gofocus
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example environment file:

```bash
cp .env.example .env
```

Add your PostgreSQL connection string and a secure JWT secret to `.env`.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign authentication tokens |
| `APP_TZ` | Timezone used for daily statistics (defaults to `Asia/Kolkata`) |
| `ALLOW_SHORT_SESSIONS` | Set to `true` to enable 6-second sessions for demos |

### 4. Start the app

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The database tables are created automatically when the server starts.

## Running Tests

The tests use a real PostgreSQL database and clear its tables, so **use a separate test database rather than your development database.**

For example:

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gofocus_test npm test
```

## A Few Implementation Details

### Session verification

The server records when a session starts and checks how much time has elapsed before awarding rewards. A session is eligible for completion rewards only after at least 90% of its planned duration has passed.

### Timer accuracy

The timer calculates the remaining time from an end timestamp instead of decreasing a counter every second. This avoids relying on repeated browser updates, which can become unreliable when a tab is in the background.

### Enforcing the daily video limit

When a user adds a video, the server uses a PostgreSQL transaction with `pg_advisory_xact_lock`. This prevents concurrent requests from bypassing the five-video daily limit.

There's also a concurrency test that sends nine requests at the same time and checks that exactly five succeed.

### Progress statistics

The statistics are calculated in SQL. PostgreSQL's `generate_series` is used to include days with no activity in the results, so the charts can show gaps in a user's study history.

### Security

A few measures are in place to protect accounts and user data:

- Passwords are hashed using bcrypt.
- JWTs are stored in an `httpOnly`, `SameSite` cookie.
- Zod validates incoming data.
- Database queries use parameters instead of directly inserting user input into SQL.
- Helmet configures security headers, including a Content Security Policy.
- Rate limiting helps reduce excessive requests.
- Database queries are scoped to the authenticated user.

## API Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Get the current user |
| GET | `/api/config` | Get app configuration |
| GET, POST | `/api/videos` | List or add videos |
| DELETE | `/api/videos/:id` | Remove a video |
| POST | `/api/sessions/start` | Start a focus session |
| POST | `/api/sessions/:id/finish` | Finish a session |
| GET | `/api/stats` | Get study statistics |
| GET, PUT | `/api/goal` | Get or update the daily goal |
| GET, POST | `/api/affirmations` | List or save affirmations |
| DELETE | `/api/affirmations/:id` | Delete an affirmation |

## Database Structure

The app currently uses five tables:

- `users` — account information
- `videos` — videos and playlists added by users
- `sessions` — focus session records
- `goals` — daily study goals
- `affirmations` — saved affirmations

The schema is available in `server/schema.sql`.

## Current Limitations

There are a few things the current implementation doesn't fully handle yet:

- **Pauses aren't verified by the server.** The server checks elapsed time, but it doesn't independently track paused time. This means the duration check alone cannot guarantee that a user studied continuously for the full session.
- **One timezone for everyone.** Daily statistics use a server-wide timezone rather than an individual timezone for each user.
- **In-memory rate limiting.** Rate-limit counters are stored in memory, so they aren't shared across multiple server instances and reset when the server restarts.

These are areas that could be improved in a future version.

---

Built as a project to explore backend development, database design, authentication, and reliable session tracking.
