// ===== ELEMENT REFERENCES =====
const timeDisplay = document.getElementById('time-display');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');
const videoInput = document.getElementById('video-input');
const addVideoBtn = document.getElementById('add-video-btn');
const videoList = document.getElementById('video-list');
const videoContainer = document.getElementById('video-container');
const jarFill = document.getElementById('jar-fill');
const candyCountDisplay = document.getElementById('candy-count');
const themeToggle = document.getElementById('theme-toggle');
const navLinks = document.querySelectorAll('nav a[data-page]');
const pages = document.querySelectorAll('.page');
const switchCountDisplay = document.getElementById('switch-count-display');

// ===== STATE =====
// ===== STATE =====
let timerInterval = null;
let isRunning = false;
let sessionMinutes = 25;
let totalSeconds = sessionMinutes * 60;
let todaysVideos = [];
let candies = 0;
let tabSwitchCount = 0;
let sessionHistory = [];
let showNewDayMessage = false;

// ===== TIMER =====
function updateDisplay() {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;
  const timeString = `${minutes}:${formattedSeconds}`;
  timeDisplay.textContent = timeString;

  if (isRunning) {
    document.title = `${timeString} — GoFocus`;
  } else {
    document.title = 'GoFocus';
  }
}


function startTimer() {
  if (isRunning) return;
  if (totalSeconds <= 0) {
    showToast("Session already complete — hit Reset to start a new one.");
    return;
  }
  isRunning = true;
  tabSwitchCount = 0;
  updateSwitchDisplay();

  timerInterval = setInterval(() => {
    if (totalSeconds > 0) {
      totalSeconds--;
      updateDisplay();
    } else {
      clearInterval(timerInterval);
      isRunning = false;
      sessionComplete();
    }
  }, 1000);
}

function pauseTimer() {
  clearInterval(timerInterval);
  isRunning = false;
}

function resetTimer() {
  if (isRunning || totalSeconds < sessionMinutes * 60) {
    const minutesDone = Math.round((sessionMinutes * 60 - totalSeconds) / 60);
    if (minutesDone > 0 && totalSeconds > 0) {
      logSession(minutesDone, tabSwitchCount, false); // abandoned session
    }
  }
  clearInterval(timerInterval);
  isRunning = false;
  totalSeconds = Math.round(sessionMinutes * 60);
  updateDisplay();
}

function sessionComplete() {
  candies += 2;
  if (tabSwitchCount === 0) {
    candies += 1; // bonus for zero switches
  }
  logSession(sessionMinutes, tabSwitchCount, true);
  updateJar();
  saveData();

  if (tabSwitchCount === 0) {
    showToast(`Perfect focus! 🎉 You earned 3 candies with zero tab switches.`);
  } else {
    showToast(`Session complete! 🎉 You earned 2 candies (switched tabs ${tabSwitchCount} time${tabSwitchCount > 1 ? 's' : ''}).`);
  }
}

startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
resetBtn.addEventListener('click', resetTimer);

// ===== TAB SWITCH TRACKING =====
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isRunning) {
    tabSwitchCount++;
    updateSwitchDisplay();
  }
});

function updateSwitchDisplay() {
  if (switchCountDisplay) {
    switchCountDisplay.textContent = `Tab switches this session: ${tabSwitchCount}`;
  }
}

// ===== VIDEO STORAGE =====
function addVideo() {
  const link = videoInput.value.trim();
  if (link === '') return;
  todaysVideos.push(link);
  videoInput.value = '';
  renderVideoList();
  saveData();
}

function renderVideoList() {
  videoList.innerHTML = '';

  if (todaysVideos.length === 0) {
    videoList.innerHTML = `<li class="empty-state">No videos added yet. Paste a link above to get started.</li>`;
    return;
  }

todaysVideos.forEach((link, index) => {
  const li = document.createElement('li');

  const linkSpan = document.createElement('span');
  linkSpan.className = 'link-text';
  linkSpan.textContent = link;
  li.appendChild(linkSpan);

  li.style.cursor = 'pointer';
  li.addEventListener('click', () => playLink(link));

  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    removeVideo(index);
  });

  li.appendChild(removeBtn);
  videoList.appendChild(li);
});

function removeVideo(index) {
  todaysVideos.splice(index, 1);
  renderVideoList();
  saveData();
}
}

addVideoBtn.addEventListener('click', addVideo);

// ===== YOUTUBE PARSING + PLAYBACK =====
function parseYouTubeLink(url) {
  const videoMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const playlistMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);

  if (videoMatch) {
    return { type: 'video', id: videoMatch[1] };
  } else if (playlistMatch) {
    return { type: 'playlist', id: playlistMatch[1] };
  } else {
    return null;
  }
}

function playLink(url) {
  const parsed = parseYouTubeLink(url);
  if (!parsed) {
    showToast('That doesn\'t look like a valid YouTube link.');
    return;
  }

  let embedSrc;
  if (parsed.type === 'video') {
    embedSrc = `https://www.youtube-nocookie.com/embed/${parsed.id}?vq=medium`;
  } else {
    embedSrc = `https://www.youtube-nocookie.com/embed/videoseries?list=${parsed.id}`;
  }

  videoContainer.innerHTML = `
    <iframe
      width="100%"
      height="100%"
      src="${embedSrc}"
      frameborder="0"
      allowfullscreen
    ></iframe>
  `;
}

// ===== CANDY JAR =====
const maxCandies = 10;

function updateJar() {
  candyCountDisplay.textContent = `${candies} candies earned`;
  const fillPercent = Math.min(candies / maxCandies, 1);
  const jarHeight = 175;
  const fillHeight = fillPercent * jarHeight;
  jarFill.setAttribute('height', fillHeight);
  jarFill.setAttribute('y', 195 - fillHeight);
}

// ===== SESSION HISTORY (for future ML/achievements) =====
function logSession(durationMinutes, switches, completed) {
  const session = {
    date: getTodayString(),
    timestamp: new Date().toISOString(),
    durationMinutes: durationMinutes,
    tabSwitches: switches,
    completed: completed
  };
  sessionHistory.push(session);
  localStorage.setItem('gofocus_history', JSON.stringify(sessionHistory));
}

// ===== DARK MODE =====
function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  themeToggle.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('gofocus_darkMode', isDark);
}

themeToggle.addEventListener('click', () => {
  const isDark = !document.body.classList.contains('dark-mode');
  applyTheme(isDark);
});

// ===== PAGE NAVIGATION =====
navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(link.getAttribute('data-page'));
  });
});

function showPage(pageId) {
  pages.forEach((page) => page.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  localStorage.setItem('gofocus_currentPage', pageId);

  navLinks.forEach((link) => {
    link.classList.toggle('active-link', link.getAttribute('data-page') === pageId);
  });
}

// ===== SAVE / LOAD (with daily reset) =====
function getTodayString() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

function saveData() {
  localStorage.setItem('gofocus_videos', JSON.stringify(todaysVideos));
  localStorage.setItem('gofocus_candies', candies.toString());
  localStorage.setItem('gofocus_lastActiveDate', getTodayString());
  localStorage.setItem('gofocus_goal', todaysGoal);
  localStorage.setItem('gofocus_affirmations', JSON.stringify(affirmations));
}

function loadData() {
  const savedVideos = localStorage.getItem('gofocus_videos');
  const savedCandies = localStorage.getItem('gofocus_candies');
  const savedHistory = localStorage.getItem('gofocus_history');
  const lastActiveDate = localStorage.getItem('gofocus_lastActiveDate');
  const today = getTodayString();
  const savedGoal = localStorage.getItem('gofocus_goal');
  const savedAffirmations = localStorage.getItem('gofocus_affirmations');

if (lastActiveDate === today) {
  if (savedGoal) todaysGoal = savedGoal;
  if (savedAffirmations) affirmations = JSON.parse(savedAffirmations);
} else {
  todaysGoal = '';
  affirmations = [];
}

  if (savedCandies) {
    candies = parseInt(savedCandies);
  }
  if (savedHistory) {
    sessionHistory = JSON.parse(savedHistory);
  }

  if (lastActiveDate === today && savedVideos) {
    todaysVideos = JSON.parse(savedVideos);
    
  } else {
    todaysVideos = [];
    localStorage.setItem('gofocus_videos', JSON.stringify([]));
    if (lastActiveDate) {
      showNewDayMessage = true;
    }
  }
}



const durationBtns = document.querySelectorAll('.duration-btn');

durationBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isRunning) return; // don't allow changing mid-session
    const minutes = parseFloat(btn.getAttribute('data-minutes'));
    sessionMinutes = minutes;
    totalSeconds = Math.round(minutes * 60);
    updateDisplay();

    durationBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});


function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3000); // matches the 3s animation
}

const goalInput = document.getElementById('goal-input');
const saveGoalBtn = document.getElementById('save-goal-btn');
const currentGoalDisplay = document.getElementById('current-goal');
const affirmationInput = document.getElementById('affirmation-input');
const addAffirmationBtn = document.getElementById('add-affirmation-btn');
const affirmationDisplay = document.getElementById('affirmation-display');

let todaysGoal = '';
let affirmations = [];

function saveGoal() {
  const goal = goalInput.value.trim();
  if (goal === '') return;
  todaysGoal = goal;
  goalInput.value = '';
  renderGoal();
  saveData();
  showToast('Goal saved for today!');
}

function renderGoal() {
  currentGoalDisplay.textContent = todaysGoal
    ? `🎯 ${todaysGoal}`
    : 'No goal set for today yet.';
}

function addAffirmation() {
  const text = affirmationInput.value.trim();
  if (text === '') return;
  affirmations.push(text);
  affirmationInput.value = '';
  renderAffirmations();
  saveData();
  showFeaturedAffirmation()
}

function renderAffirmations() {
  affirmationDisplay.innerHTML = '';
  affirmations.forEach((text) => {
    const item = document.createElement('div');
    item.className = 'affirmation-item';
    item.textContent = text;
    affirmationDisplay.appendChild(item);
  });
}

saveGoalBtn.addEventListener('click', saveGoal);
addAffirmationBtn.addEventListener('click', addAffirmation);


function renderAffirmations() {
  affirmationDisplay.innerHTML = '';
  const accentColors = ['var(--secondary)', 'var(--primary)', '#E9C46A', '#8B6FD9'];
  affirmations.forEach((text, index) => {
    const item = document.createElement('div');
    item.className = 'affirmation-item';
    item.style.borderLeftColor = accentColors[index % accentColors.length];
    item.textContent = text;
    affirmationDisplay.appendChild(item);
  });
}

function showFeaturedAffirmation() {
  const featured = document.getElementById('featured-affirmation');
  if (affirmations.length === 0) {
    featured.textContent = '';
    return;
  }
  const random = affirmations[Math.floor(Math.random() * affirmations.length)];
  typewriterEffect(featured, `"${random}"`);;
}


function typewriterEffect(element, text, speed = 40) {
  element.textContent = '';
  let i = 0;
  function type() {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
      setTimeout(type, speed);
    }
  }
  type();
}


// ===== INITIAL LOAD =====
loadData();
renderVideoList();
updateJar();
updateDisplay();
updateSwitchDisplay();
renderGoal();
renderAffirmations();
showFeaturedAffirmation()

const savedTheme = localStorage.getItem('gofocus_darkMode') === 'true';
applyTheme(savedTheme);

const savedPage = localStorage.getItem('gofocus_currentPage');
showPage(savedPage || 'home-page');

if (showNewDayMessage) {
  setTimeout(() => showToast("New day, fresh start! Add today's 5 videos to begin."), 300);
}
