process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.ALLOW_SHORT_SESSIONS = 'true';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { pool, migrate } = require('../server/db');

let server, base;

// tiny client that remembers the auth cookie, like a browser would
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

before(async () => {
  await migrate();
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

test('auth: register, duplicate, login, wrong password, protected route', async () => {
  const a = client();
  assert.equal((await a('GET', '/api/videos')).status, 401);

  assert.equal((await a('POST', '/api/auth/register', { name: 'A', email: 'a@x.com', password: 'short' })).status, 400);
  const reg = await a('POST', '/api/auth/register', { name: 'Ritika', email: 'A@x.com', password: 'password123' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'a@x.com'); // normalised to lowercase
  assert.equal((await a('GET', '/api/auth/me')).body.user.name, 'Ritika');

  const dup = await client()('POST', '/api/auth/register', { name: 'B', email: 'a@x.com', password: 'password123' });
  assert.equal(dup.status, 409);

  const b = client();
  assert.equal((await b('POST', '/api/auth/login', { email: 'a@x.com', password: 'wrongpass1' })).status, 401);
  assert.equal((await b('POST', '/api/auth/login', { email: 'a@x.com', password: 'password123' })).status, 200);
});

test('videos: validation, duplicates, and the max-5 rule holds under concurrency', async () => {
  const u = client();
  await u('POST', '/api/auth/register', { name: 'V', email: 'v@x.com', password: 'password123' });

  assert.equal((await u('POST', '/api/videos', { url: 'https://example.com/watch?v=dQw4w9WgXcQ' })).status, 400);
  assert.equal((await u('POST', '/api/videos', { url: 'not a link' })).status, 400);

  const ok = await u('POST', '/api/videos', { url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.video.ref, 'dQw4w9WgXcQ');
  assert.equal((await u('POST', '/api/videos', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).status, 409);

  // 9 simultaneous adds with different ids: only 4 more may succeed (1 already exists)
  const ids = 'abcdefghi'.split('').map((c) => `https://youtu.be/${c.repeat(11)}`);
  const results = await Promise.all(ids.map((url) => u('POST', '/api/videos', { url })));
  assert.equal(results.filter((r) => r.status === 201).length, 4);
  assert.equal(results.filter((r) => r.status === 409).length, 5);
  assert.equal((await u('GET', '/api/videos')).body.videos.length, 5);
});

test('users cannot touch each other\'s data', async () => {
  const a = client(), b = client();
  await a('POST', '/api/auth/register', { name: 'A2', email: 'a2@x.com', password: 'password123' });
  await b('POST', '/api/auth/register', { name: 'B2', email: 'b2@x.com', password: 'password123' });

  const { body } = await a('POST', '/api/videos', { url: 'https://youtu.be/zzzzzzzzzzz' });
  await b('DELETE', `/api/videos/${body.video.id}`);
  assert.equal((await a('GET', '/api/videos')).body.videos.length, 1);

  const s = await a('POST', '/api/sessions/start', { minutes: 0.1 });
  const steal = await b('POST', `/api/sessions/${s.body.session.id}/finish`, { completed: true, tabSwitches: 0 });
  assert.equal(steal.status, 404);
});

test('sessions: server rejects instant "completed" claims and rewards real ones', async () => {
  const u = client();
  await u('POST', '/api/auth/register', { name: 'S', email: 's@x.com', password: 'password123' });

  assert.equal((await u('POST', '/api/sessions/start', { minutes: 3 })).status, 400); // not an allowed duration

  // cheat attempt: claim completion immediately
  const cheat = await u('POST', '/api/sessions/start', { minutes: 0.1 });
  const rejected = await u('POST', `/api/sessions/${cheat.body.session.id}/finish`, { completed: true, tabSwitches: 0 });
  assert.equal(rejected.body.rejected, true);
  assert.equal(rejected.body.session.candies, 0);
  assert.equal(rejected.body.session.status, 'abandoned');

  // genuine 6-second session with zero tab switches -> 2 + 1 bonus candies
  const real = await u('POST', '/api/sessions/start', { minutes: 0.1 });
  await new Promise((r) => setTimeout(r, 6200));
  const done = await u('POST', `/api/sessions/${real.body.session.id}/finish`, { completed: true, tabSwitches: 0 });
  assert.equal(done.body.session.status, 'completed');
  assert.equal(done.body.session.candies, 3);

  // can't finish the same session twice
  assert.equal((await u('POST', `/api/sessions/${real.body.session.id}/finish`, { completed: true, tabSwitches: 0 })).status, 404);

  const stats = (await u('GET', '/api/stats')).body;
  assert.equal(stats.totals.candies, 3);
  assert.equal(stats.totals.sessions, 1);
  assert.equal(stats.totals.focusScore, 100);
  assert.equal(stats.streak.current, 1);
  assert.equal(stats.heatmap.length, 84);
  assert.equal(stats.week.length, 7);
  assert.deepEqual(stats.jar, { level: 1, filled: 3, size: 10 });
});

test('goal and affirmations round-trip', async () => {
  const u = client();
  await u('POST', '/api/auth/register', { name: 'G', email: 'g@x.com', password: 'password123' });
  assert.equal((await u('GET', '/api/goal')).body.goal, '');
  await u('PUT', '/api/goal', { text: 'Finish 3 sessions' });
  await u('PUT', '/api/goal', { text: 'Finish 4 sessions' }); // upsert, not duplicate
  assert.equal((await u('GET', '/api/goal')).body.goal, 'Finish 4 sessions');

  const add = await u('POST', '/api/affirmations', { text: '<b>I can do this</b>' });
  assert.equal(add.status, 201);
  assert.equal((await u('GET', '/api/affirmations')).body.affirmations.length, 1);
  await u('DELETE', `/api/affirmations/${add.body.affirmation.id}`);
  assert.equal((await u('GET', '/api/affirmations')).body.affirmations.length, 0);
});
