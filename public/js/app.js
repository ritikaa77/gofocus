(() => {
  'use strict';

  /* ================= helpers ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const NS = 'http://www.w3.org/2000/svg';

  // Builds DOM with textContent only (never innerHTML) so user text can't inject markup.
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function svg(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const kid of kids) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) showAuth();
      throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
    }
    return data;
  }

  function toast(message, isError = false) {
    const t = h('div', { class: 'toast' + (isError ? ' error' : '') }, message);
    $('#toast-container').append(t);
    setTimeout(() => t.remove(), 3700);
  }

  const fmtMinutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);

  /* ================= state ================= */
  const S = { user: null, config: { durations: [25], maxPicks: 5 }, videos: [], stats: null, affirmations: [], goal: '', playingId: null };

  /* ================= theme ================= */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('#theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem('gf_theme', theme); } catch { /* private mode */ }
  }
  $('#theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  (() => {
    let saved = null;
    try { saved = localStorage.getItem('gf_theme'); } catch { /* ignore */ }
    applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  })();

  /* ================= auth ================= */
  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    $('#tab-login').classList.toggle('active', mode === 'login');
    $('#tab-register').classList.toggle('active', mode === 'register');
    $('#name-field').classList.toggle('hidden', mode === 'login');
    $('#auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create account';
    $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-error').textContent = '';
  }
  $('#tab-login').addEventListener('click', () => setAuthMode('login'));
  $('#tab-register').addEventListener('click', () => setAuthMode('register'));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#auth-error');
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const name = $('#auth-name').value.trim();
    err.textContent = '';
    if (!email || !password) return (err.textContent = 'Enter your email and password');
    if (authMode === 'register' && !name) return (err.textContent = 'Enter your name');
    if (authMode === 'register' && password.length < 8) return (err.textContent = 'Password must be at least 8 characters');

    const btn = $('#auth-submit');
    btn.disabled = true;
    try {
      const { user } = await api('POST', authMode === 'login' ? '/auth/login' : '/auth/register',
        authMode === 'login' ? { email, password } : { name, email, password });
      $('#auth-password').value = '';
      await showApp(user);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    if (T.started) await abandonSession();
    await api('POST', '/auth/logout').catch(() => {});
    showAuth();
  });

  function showAuth() {
    S.user = null;
    $('#app-view').classList.add('hidden');
    $('#auth-view').classList.remove('hidden');
  }

  async function showApp(user) {
    S.user = user;
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    const hour = new Date().getHours();
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    $('#greeting').textContent = `Good ${part}, ${user.name.split(' ')[0]}.`;

    const [config] = await Promise.all([
      api('GET', '/config'), loadVideos(), loadStats(), loadGoal(), loadAffirmations(),
    ]);
    S.config = config;
    renderDurations();
    renderVideos();
    renderStats();
    route();
  }

  /* ================= timer ================= */
  const RING = 741.42; // 2 * PI * r(118)
  const T = { minutes: 25, totalMs: 25 * 60000, remainingMs: 25 * 60000, endAt: 0, running: false, started: false, busy: false, sessionId: null, switches: 0, handle: null };
  const timerCard = $('.timer-card');

  const fmtClock = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function renderTimer() {
    const clock = fmtClock(T.remainingMs);
    $('#time-display').textContent = clock;
    $('#ring-progress').style.strokeDashoffset = String(RING * (1 - T.remainingMs / T.totalMs));
    $('#timer-status').textContent = T.running ? 'Stay with it' : T.started ? 'Paused' : 'Ready when you are';
    $('#start-btn').textContent = T.started && !T.running ? 'Resume' : 'Start';
    $('#start-btn').disabled = T.running;
    $('#pause-btn').disabled = !T.running;
    timerCard.classList.toggle('running', T.running);
    document.title = T.running ? `${clock} · GoFocus` : 'GoFocus';
    document.querySelectorAll('#duration-options .chip-btn').forEach((b) => (b.disabled = T.started));
  }

  function renderSwitches() {
    const el = $('#switch-count');
    el.replaceChildren('Tab switches this session: ', h('strong', {}, T.switches));
    el.classList.toggle('bad', T.switches > 0);
  }

  function renderDurations() {
    const box = $('#duration-options');
    box.replaceChildren();
    if (!S.config.durations.includes(T.minutes)) setMinutes(S.config.durations.includes(25) ? 25 : S.config.durations[0]);
    for (const m of S.config.durations) {
      const label = m < 1 ? 'Demo (6s)' : `${m} min`;
      const btn = h('button', { type: 'button', class: 'chip-btn' + (m === T.minutes ? ' active' : '') }, label);
      btn.addEventListener('click', () => {
        if (T.started) return;
        setMinutes(m);
        box.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
      box.append(btn);
    }
    renderTimer();
  }

  function setMinutes(m) {
    T.minutes = m;
    T.totalMs = T.remainingMs = Math.round(m * 60000);
    renderTimer();
  }

  async function startTimer() {
    if (T.running || T.busy) return;
    if (!T.started) {
      T.busy = true;
      try {
        const { session } = await api('POST', '/sessions/start', { minutes: T.minutes });
        T.sessionId = session.id;
        T.started = true;
        T.switches = 0;
        renderSwitches();
      } catch (ex) {
        toast(ex.message, true);
        return;
      } finally {
        T.busy = false;
      }
    }
    T.running = true;
    T.endAt = Date.now() + T.remainingMs;      // wall-clock based: stays correct even if the tab is throttled
    T.handle = setInterval(tick, 250);
    renderTimer();
  }

  function pauseTimer() {
    if (!T.running) return;
    clearInterval(T.handle);
    T.remainingMs = Math.max(0, T.endAt - Date.now());
    T.running = false;
    renderTimer();
  }

  function tick() {
    T.remainingMs = Math.max(0, T.endAt - Date.now());
    renderTimer();
    if (T.remainingMs <= 0) completeSession();
  }

  function clearTimerState() {
    clearInterval(T.handle);
    T.running = T.started = false;
    T.sessionId = null;
    T.remainingMs = T.totalMs;
    renderTimer();
  }

  async function completeSession() {
    clearInterval(T.handle);
    T.running = false;
    const id = T.sessionId, switches = T.switches;
    try {
      const r = await api('POST', `/sessions/${id}/finish`, { completed: true, tabSwitches: switches });
      if (r.rejected) toast("That session didn't count: the server saw less time than the timer claimed.", true);
      else celebrate(r.session.candies, switches);
    } catch (ex) {
      toast(ex.message, true);
    }
    clearTimerState();
    await loadStats();
    renderStats();
    showQuote();
  }

  async function abandonSession() {
    const id = T.sessionId, switches = T.switches;
    clearInterval(T.handle);
    T.running = false;
    if (id) await api('POST', `/sessions/${id}/finish`, { completed: false, tabSwitches: switches }).catch(() => {});
    clearTimerState();
    await loadStats().catch(() => {});
    renderStats();
  }

  $('#start-btn').addEventListener('click', startTimer);
  $('#pause-btn').addEventListener('click', pauseTimer);
  $('#reset-btn').addEventListener('click', async () => {
    if (T.started) await abandonSession();
    else setMinutes(T.minutes);
    T.switches = 0;
    renderSwitches();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !S.user || e.target.closest('input, textarea, button, a')) return;
    if (!$('#page-focus').classList.contains('active')) return;
    e.preventDefault();
    T.running ? pauseTimer() : startTimer();
  });

  // The whole point of the app: count every time you leave this tab mid-session.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && T.running) {
      T.switches++;
      renderSwitches();
    } else if (!document.hidden && T.running) {
      tick();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (T.running) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => {
    if (T.started && T.sessionId) {
      const blob = new Blob([JSON.stringify({ completed: false, tabSwitches: T.switches })], { type: 'application/json' });
      navigator.sendBeacon(`/api/sessions/${T.sessionId}/finish`, blob);
    }
  });

  /* ================= celebration ================= */
  function celebrate(candies, switches) {
    toast(switches === 0
      ? `Perfect focus! You earned ${candies} candies with zero tab switches.`
      : `Session complete! You earned ${candies} candies (${switches} tab switch${switches > 1 ? 'es' : ''}).`);
    const colors = ['#1B8A5A', '#FF8552', '#E9C46A', '#8B6FD9', '#2FBE7F'];
    const box = $('#confetti');
    for (let i = 0; i < 36; i++) {
      const c = h('i', { class: 'confetto' });
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.5 + 's';
      c.style.animationDuration = 1.8 + Math.random() * 1.2 + 's';
      box.append(c);
      setTimeout(() => c.remove(), 3500);
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.45);
        o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.5);
      });
    } catch { /* audio not available */ }
  }

  /* ================= videos ================= */
  async function loadVideos() { S.videos = (await api('GET', '/videos')).videos; }

  function renderVideos() {
    const max = S.config.maxPicks;
    $('#picks-count').textContent = `${S.videos.length} / ${max}`;
    const list = $('#video-list');
    list.replaceChildren();
    for (const v of S.videos) {
      const thumb = v.kind === 'video'
        ? h('img', { src: `https://i.ytimg.com/vi/${v.ref}/mqdefault.jpg`, alt: '', loading: 'lazy' })
        : h('div', { class: 'thumb-ph' }, '📚');
      const rm = h('button', { type: 'button', 'aria-label': `Remove ${v.title}` }, '×');
      const li = h('li', { class: 'pick' + (S.playingId === v.id ? ' playing' : ''), tabindex: '0', role: 'button' },
        thumb, h('span', { class: 'pick-title' }, v.title), rm);
      li.addEventListener('click', () => playVideo(v));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') playVideo(v); });
      rm.addEventListener('click', (e) => { e.stopPropagation(); removeVideo(v); });
      list.append(li);
    }
    for (let i = S.videos.length; i < max; i++) {
      list.append(h('li', { class: 'pick empty' }, `Pick #${i + 1}`));
    }
  }

  function playVideo(v) {
    S.playingId = v.id;
    const src = v.kind === 'video'
      ? `https://www.youtube-nocookie.com/embed/${v.ref}?rel=0&modestbranding=1`
      : `https://www.youtube-nocookie.com/embed/videoseries?list=${v.ref}&rel=0`;
    $('#video-container').replaceChildren(h('iframe', {
      src, title: v.title, allowfullscreen: true,
      allow: 'accelerometer; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin',
    }));
    renderVideos();
  }

  async function removeVideo(v) {
    try {
      await api('DELETE', `/videos/${v.id}`);
      if (S.playingId === v.id) {
        S.playingId = null;
        $('#video-container').replaceChildren(h('div', { class: 'player-empty' },
          h('div', { class: 'play-icon' }, '▶'), h('p', {}, 'Pick one of your videos below to play it here')));
      }
      await loadVideos();
      renderVideos();
    } catch (ex) { toast(ex.message, true); }
  }

  $('#video-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#video-input');
    const url = input.value.trim();
    if (!url) return;
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      await api('POST', '/videos', { url });
      input.value = '';
      await loadVideos();
      renderVideos();
    } catch (ex) { toast(ex.message, true); }
    finally { if (btn) btn.disabled = false; }
  });

  /* ================= stats ================= */
  async function loadStats() { S.stats = await api('GET', '/stats'); }

  function renderStats() {
    const st = S.stats;
    if (!st) return;
    $('#streak-chip').textContent = `🔥 ${st.streak.current}`;
    $('#streak-chip').title = `Current streak: ${st.streak.current} day${st.streak.current === 1 ? '' : 's'} (best ${st.streak.best})`;

    const tile = (label, value, sub) => h('div', { class: 'card tile' },
      h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'sub' }, sub));
    $('#tiles').replaceChildren(
      tile('Today', fmtMinutes(st.today.minutes), `${st.today.sessions} session${st.today.sessions === 1 ? '' : 's'}`),
      tile('Streak', `${st.streak.current} day${st.streak.current === 1 ? '' : 's'}`, `Best: ${st.streak.best}`),
      tile('Focus score', `${st.totals.focusScore}%`, 'sessions with zero tab switches'),
      tile('Total focus', fmtMinutes(st.totals.focusMinutes), `${st.totals.sessions} completed`),
    );

    renderWeekChart(st.week);
    renderHeatmap(st.heatmap);
    renderJar(st);
    renderBadges(st);
  }

  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  function renderWeekChart(week) {
    const max = Math.max(30, ...week.map((d) => d.minutes));
    const root = svg('svg', { viewBox: '0 0 340 170', role: 'img', 'aria-label': 'Minutes focused in the last 7 days' },
      svg('defs', {}, svg('linearGradient', { id: 'bar-grad', x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: '0%', class: 'stop-a' }), svg('stop', { offset: '100%', class: 'stop-b' }))));
    week.forEach((d, i) => {
      const bh = Math.max(d.minutes ? 4 : 2, (d.minutes / max) * 108);
      const x = 14 + i * 46;
      const bar = svg('rect', { x, y: 138 - bh, width: 32, height: bh, rx: 6, class: 'bar' + (i === week.length - 1 ? ' today' : ''), opacity: d.minutes ? 1 : 0.25 },
        svg('title', {}, `${d.day}: ${d.minutes} min`));
      root.append(bar);
      if (d.minutes) root.append(svg('text', { x: x + 16, y: 130 - bh, 'text-anchor': 'middle' }, d.minutes));
      root.append(svg('text', { x: x + 16, y: 158, 'text-anchor': 'middle' }, parseDay(d.day).toLocaleDateString('en-IN', { weekday: 'short' })));
    });
    $('#week-chart').replaceChildren(root);
  }

  function renderHeatmap(days) {
    const offset = (parseDay(days[0].day).getDay() + 6) % 7; // Monday = 0
    const cols = Math.ceil((offset + days.length) / 7);
    const root = svg('svg', { viewBox: `0 0 ${cols * 20} 140`, role: 'img', 'aria-label': 'Focus minutes per day, last 12 weeks' });
    const level = (m) => (m === 0 ? 0 : m < 25 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4);
    days.forEach((d, i) => {
      const idx = offset + i;
      root.append(svg('rect', { x: Math.floor(idx / 7) * 20, y: (idx % 7) * 20, width: 16, height: 16, class: `cell lv${level(d.minutes)}` },
        svg('title', {}, `${d.day}: ${d.minutes} min`)));
    });
    $('#heatmap').replaceChildren(root);
  }

  function renderJar(st) {
    const { filled, size, level } = st.jar;
    $('#jar-fill').style.transform = `translateY(${(1 - filled / size) * 175}px)`;
    $('#candy-count').textContent = `${st.totals.candies} candies earned`;
    $('#jar-level').textContent = `Jar level ${level} · ${filled}/${size} to the next jar`;
  }

  function renderBadges(st) {
    const { totals, streak } = st;
    const defs = [
      ['🌱', 'First step', 'Complete your first session', totals.sessions >= 1],
      ['🔥', 'On a roll', 'Reach a 3-day streak', streak.best >= 3],
      ['🏆', 'Week warrior', 'Reach a 7-day streak', streak.best >= 7],
      ['🎯', 'Locked in', 'Complete 10 sessions', totals.sessions >= 10],
      ['🧘', 'Zen mode', 'Focus score 80%+ over 5+ sessions', totals.sessions >= 5 && totals.focusScore >= 80],
      ['⏳', 'Ten hour club', 'Focus for 10 hours in total', totals.focusMinutes >= 600],
    ];
    $('#badges').replaceChildren(...defs.map(([ico, title, desc, earned]) =>
      h('li', { class: 'badge' + (earned ? ' earned' : '') },
        h('span', { class: 'ico' }, ico),
        h('div', {}, h('div', { class: 'b-title' }, title), h('div', { class: 'b-desc' }, desc)))));
  }

  /* ================= goals + affirmations ================= */
  async function loadGoal() { S.goal = (await api('GET', '/goal')).goal; renderGoal(); }
  function renderGoal() {
    const el = $('#current-goal');
    el.textContent = S.goal ? `🎯 ${S.goal}` : 'No goal set for today yet.';
    el.classList.toggle('set', !!S.goal);
    el.classList.toggle('muted', !S.goal);
  }
  $('#goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      S.goal = (await api('PUT', '/goal', { text: $('#goal-input').value })).goal;
      $('#goal-input').value = '';
      renderGoal();
      toast('Goal saved for today!');
    } catch (ex) { toast(ex.message, true); }
  });

  async function loadAffirmations() { S.affirmations = (await api('GET', '/affirmations')).affirmations; renderAffirmations(); showQuote(); }
  function renderAffirmations() {
    const list = $('#aff-list');
    if (!S.affirmations.length) return list.replaceChildren(h('li', { class: 'empty-note' }, 'Add a few. One will appear on your timer.'));
    list.replaceChildren(...S.affirmations.map((a) => {
      const rm = h('button', { type: 'button', 'aria-label': 'Delete affirmation' }, '×');
      rm.addEventListener('click', async () => {
        await api('DELETE', `/affirmations/${a.id}`).catch((ex) => toast(ex.message, true));
        await loadAffirmations();
      });
      return h('li', { class: 'aff' }, h('span', {}, a.text), rm);
    }));
  }
  $('#aff-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/affirmations', { text: $('#aff-input').value });
      $('#aff-input').value = '';
      await loadAffirmations();
    } catch (ex) { toast(ex.message, true); }
  });

  // typewriter with a cancel token, so quick successive calls never interleave letters
  let twToken = 0;
  function typewriter(el, text, speed = 32) {
    const mine = ++twToken;
    el.textContent = '';
    let i = 0;
    (function step() {
      if (mine !== twToken || i >= text.length) return;
      el.textContent += text[i++];
      setTimeout(step, speed);
    })();
  }
  function showQuote() {
    const el = $('#quote');
    if (!S.affirmations.length) { twToken++; el.textContent = ''; return; }
    typewriter(el, `"${S.affirmations[Math.floor(Math.random() * S.affirmations.length)].text}"`);
  }

  /* ================= router ================= */
  const PAGES = ['focus', 'progress', 'rewards', 'goals'];
  function route() {
    if (!S.user) return;
    const name = location.hash.replace('#/', '');
    const page = PAGES.includes(name) ? name : 'focus';
    PAGES.forEach((p) => $(`#page-${p}`).classList.toggle('active', p === page));
    document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
    if (page === 'progress' || page === 'rewards') renderStats();
  }
  window.addEventListener('hashchange', route);

  /* ================= boot ================= */
  (async () => {
    renderSwitches();
    try {
      const { user } = await api('GET', '/auth/me');
      await showApp(user);
    } catch {
      showAuth();
    }
  })();
})();
