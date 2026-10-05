const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { requireAuth, wrap } = require('../auth');
const { parseYouTube, fetchTitle } = require('../youtube');

const router = express.Router();
const TZ = () => process.env.APP_TZ || 'Asia/Kolkata';
const MAX_PICKS = 5;
const JAR_SIZE = 10;

const durations = () => {
  const list = [5, 15, 25, 45, 60];
  if (process.env.ALLOW_SHORT_SESSIONS === 'true') list.unshift(0.1); // 6s demo session
  return list;
};

router.get('/config', (_req, res) => res.json({ durations: durations(), maxPicks: MAX_PICKS, jarSize: JAR_SIZE }));

router.use(requireAuth);

/* ---------------- Today's video picks ---------------- */
router.get('/videos', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, url, kind, ref, title FROM videos
      WHERE user_id = $1 AND day = (now() AT TIME ZONE $2)::date
      ORDER BY id`,
    [req.userId, TZ()]
  );
  res.json({ videos: rows });
}));

router.post('/videos', wrap(async (req, res) => {
  const { url } = z.object({ url: z.string().trim().url('Paste a full YouTube link').max(300) }).parse(req.body);
  const parsed = parseYouTube(url);
  if (!parsed) return res.status(400).json({ error: "That doesn't look like a YouTube video or playlist link" });

  const title = await fetchTitle(url, parsed.kind === 'playlist' ? 'YouTube playlist' : 'YouTube video');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise concurrent adds for the same user so the "max 5" rule can't be raced past.
    await client.query('SELECT pg_advisory_xact_lock($1)', [req.userId]);
    const { rows: [{ n }] } = await client.query(
      `SELECT count(*)::int AS n FROM videos WHERE user_id = $1 AND day = (now() AT TIME ZONE $2)::date`,
      [req.userId, TZ()]
    );
    if (n >= MAX_PICKS) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `You can only pick ${MAX_PICKS} videos a day. Remove one first.` });
    }
    const { rows } = await client.query(
      `INSERT INTO videos (user_id, day, url, kind, ref, title)
       VALUES ($1, (now() AT TIME ZONE $2)::date, $3, $4, $5, $6)
       ON CONFLICT (user_id, day, ref) DO NOTHING
       RETURNING id, url, kind, ref, title`,
      [req.userId, TZ(), url, parsed.kind, parsed.ref, title]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already added that one today' });
    }
    await client.query('COMMIT');
    res.status(201).json({ video: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

router.delete('/videos/:id', wrap(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  await pool.query('DELETE FROM videos WHERE id = $1 AND user_id = $2', [id, req.userId]);
  res.json({ ok: true });
}));

/* ---------------- Focus sessions ---------------- */
// The server owns the clock: it records when a session started and only awards candies
// if enough real time has passed. The browser can't just POST "completed" to farm rewards.
router.post('/sessions/start', wrap(async (req, res) => {
  const { minutes } = z.object({ minutes: z.number() }).parse(req.body);
  if (!durations().includes(minutes)) return res.status(400).json({ error: 'Unsupported duration' });

  await pool.query(
    `UPDATE sessions
        SET status = 'abandoned', ended_at = now(),
            actual_seconds = LEAST(planned_seconds, EXTRACT(EPOCH FROM now() - started_at)::int)
      WHERE user_id = $1 AND status = 'running'`,
    [req.userId]
  );
  const { rows } = await pool.query(
    'INSERT INTO sessions (user_id, planned_seconds) VALUES ($1, $2) RETURNING id, planned_seconds',
    [req.userId, Math.round(minutes * 60)]
  );
  res.status(201).json({ session: rows[0] });
}));

router.post('/sessions/:id/finish', wrap(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = z.object({
    completed: z.boolean(),
    tabSwitches: z.number().int().min(0).max(999),
  }).parse(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT planned_seconds, EXTRACT(EPOCH FROM now() - started_at)::int AS elapsed
         FROM sessions WHERE id = $1 AND user_id = $2 AND status = 'running' FOR UPDATE`,
      [id, req.userId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No running session found' });
    }
    const { planned_seconds: planned, elapsed } = rows[0];
    // 10% tolerance for network latency, nothing more.
    const genuine = body.completed && elapsed >= planned * 0.9;
    const status = genuine ? 'completed' : 'abandoned';
    const actual = genuine ? planned : Math.min(elapsed, planned);
    const candies = genuine ? 2 + (body.tabSwitches === 0 ? 1 : 0) : 0;

    const { rows: [session] } = await client.query(
      `UPDATE sessions SET status = $1, ended_at = now(), actual_seconds = $2, tab_switches = $3, candies = $4
        WHERE id = $5 RETURNING id, status, actual_seconds, tab_switches, candies`,
      [status, actual, body.tabSwitches, candies, id]
    );
    await client.query('COMMIT');
    res.json({ session, rejected: body.completed && !genuine });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

/* ---------------- Stats ---------------- */
const dayMs = 24 * 60 * 60 * 1000;
const toUTC = (s) => Date.parse(`${s}T00:00:00Z`);

function computeStreaks(completedDays, today) {
  const set = new Set(completedDays);
  // current streak: consecutive days ending today (or yesterday, if today isn't done yet)
  let cursor = set.has(today) ? toUTC(today) : toUTC(today) - dayMs;
  let current = 0;
  while (set.has(new Date(cursor).toISOString().slice(0, 10))) { current++; cursor -= dayMs; }

  const sorted = [...set].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev !== null && toUTC(d) - prev === dayMs ? run + 1 : 1;
    best = Math.max(best, run);
    prev = toUTC(d);
  }
  return { current, best };
}

router.get('/stats', wrap(async (req, res) => {
  const tz = TZ();
  const [daily, days, totals, todayRow] = await Promise.all([
    pool.query(
      `WITH t AS (SELECT (now() AT TIME ZONE $2)::date AS today),
            d AS (SELECT generate_series(t.today - 83, t.today, interval '1 day')::date AS day FROM t)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(s.actual_seconds), 0)::int AS seconds,
              COUNT(s.id) FILTER (WHERE s.status = 'completed')::int AS sessions
         FROM d LEFT JOIN sessions s
           ON s.user_id = $1 AND s.status <> 'running'
          AND (s.started_at AT TIME ZONE $2)::date = d.day
        GROUP BY d.day ORDER BY d.day`,
      [req.userId, tz]
    ),
    pool.query(
      `SELECT DISTINCT to_char((started_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day
         FROM sessions WHERE user_id = $1 AND status = 'completed'`,
      [req.userId, tz]
    ),
    pool.query(
      `SELECT COALESCE(SUM(candies), 0)::int AS candies,
              COALESCE(SUM(actual_seconds), 0)::int AS seconds,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE status = 'completed' AND tab_switches = 0)::int AS perfect
         FROM sessions WHERE user_id = $1 AND status <> 'running'`,
      [req.userId]
    ),
    pool.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today`, [tz]),
  ]);

  const today = todayRow.rows[0].today;
  const t = totals.rows[0];
  const heatmap = daily.rows.map((r) => ({ day: r.day, minutes: Math.ceil(r.seconds / 60), sessions: r.sessions }));
  const week = heatmap.slice(-7);

  res.json({
    today: heatmap[heatmap.length - 1],
    week,
    heatmap,
    streak: computeStreaks(days.rows.map((r) => r.day), today),
    totals: {
      candies: t.candies,
      focusMinutes: Math.round(t.seconds / 60),
      sessions: t.completed,
      focusScore: t.completed ? Math.round((t.perfect / t.completed) * 100) : 0,
    },
    jar: { level: Math.floor(t.candies / JAR_SIZE) + 1, filled: t.candies % JAR_SIZE, size: JAR_SIZE },
  });
}));

/* ---------------- Goal of the day ---------------- */
router.get('/goal', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT text FROM goals WHERE user_id = $1 AND day = (now() AT TIME ZONE $2)::date`,
    [req.userId, TZ()]
  );
  res.json({ goal: rows[0]?.text || '' });
}));

router.put('/goal', wrap(async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(1, 'Write your goal first').max(200) }).parse(req.body);
  await pool.query(
    `INSERT INTO goals (user_id, day, text) VALUES ($1, (now() AT TIME ZONE $2)::date, $3)
     ON CONFLICT (user_id, day) DO UPDATE SET text = EXCLUDED.text`,
    [req.userId, TZ(), text]
  );
  res.json({ goal: text });
}));

/* ---------------- Affirmations ---------------- */
router.get('/affirmations', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, text FROM affirmations WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [req.userId]
  );
  res.json({ affirmations: rows });
}));

router.post('/affirmations', wrap(async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(1, 'Write something first').max(140) }).parse(req.body);
  const { rows } = await pool.query(
    'INSERT INTO affirmations (user_id, text) VALUES ($1, $2) RETURNING id, text', [req.userId, text]
  );
  res.status(201).json({ affirmation: rows[0] });
}));

router.delete('/affirmations/:id', wrap(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  await pool.query('DELETE FROM affirmations WHERE id = $1 AND user_id = $2', [id, req.userId]);
  res.json({ ok: true });
}));

module.exports = router;
