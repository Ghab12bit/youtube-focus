// Defaults = the Calm preset: a visible effect on install, nothing that interrupts.
const DEFAULTS = {
  enabled: true, pausedUntil: 0,
  grey: true, blur: false, mute: true,
  pause: false, countdown: 5, timer: true, limit: false, limitMin: 30,
  greySitesOn: true, greySites: ['x.com', 'linkedin.com']
};

const PRESETS = {
  calm:   { enabled: true, grey: true, blur: false, mute: true, pause: false, timer: true, limit: false },
  strict: { enabled: true, grey: true, blur: true,  mute: true, pause: true,  timer: true, limit: true, countdown: 5, limitMin: 30 },
  off:    { enabled: false }
};
const PRESET_HINTS = {
  calm: 'Greys thumbnails and mutes red. No interruptions.',
  strict: 'Everything on: blur, pause screen, 30 min limit.',
  off: 'Normal YouTube. Your settings are kept.',
  custom: 'Custom: your own mix of switches below.'
};
const PAUSE_MS = 15 * 60 * 1000;
const SESSION_GAP_MS = 30 * 60 * 1000;
const REVIEW_AFTER_DAYS = 7;

let settings = { ...DEFAULTS };
const $ = (id) => document.getElementById(id);
const isPaused = () => settings.pausedUntil > Date.now();
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.sync.set(patch);
  render();
}

// ---------- Presets ----------
function currentPreset() {
  if (!settings.enabled) return 'off';
  for (const name of ['calm', 'strict']) {
    const p = PRESETS[name];
    if (Object.keys(p).every((k) => settings[k] === p[k])) return name;
  }
  return 'custom';
}

// ---------- Render everything from settings ----------
function render() {
  const paused = isPaused();
  const preset = currentPreset();

  const status = $('status');
  status.className = 'status';
  if (!settings.enabled) { status.textContent = 'Off'; status.classList.add('off'); }
  else if (paused) { status.textContent = `Paused until ${fmtTime(settings.pausedUntil)}`; status.classList.add('paused'); }
  else status.textContent = `On · ${preset === 'custom' ? 'Custom' : preset[0].toUpperCase() + preset.slice(1)}`;

  $('master').checked = settings.enabled && !paused;
  $('pause15').textContent = paused ? 'Resume' : 'Pause 15m';
  $('pause15').hidden = !settings.enabled;

  const box = $('pausedbox');
  box.hidden = !paused;
  if (paused) {
    box.textContent = '';
    box.append('Everything is off until ');
    const b = document.createElement('b'); b.textContent = fmtTime(settings.pausedUntil);
    box.append(b, '. It turns back on by itself, so you never forget.');
  }
  document.body.classList.toggle('off', !settings.enabled);
  document.body.classList.toggle('paused', paused);

  document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('sel', b.dataset.preset === preset));
  $('seghint').textContent = PRESET_HINTS[preset];

  document.querySelectorAll('input[type=checkbox][data-key]').forEach((cb) => { cb.checked = !!settings[cb.dataset.key]; });
  document.querySelectorAll('.stepper').forEach((st) => {
    st.querySelector('.val').textContent = settings[st.dataset.key] + (st.dataset.unit || '');
  });
  document.querySelectorAll('[data-depends]').forEach((el) => el.classList.toggle('disabled', !settings[el.dataset.depends]));
}

function initControls() {
  $('master').addEventListener('change', (e) => {
    save(e.target.checked ? { enabled: true, pausedUntil: 0 } : { enabled: false });
  });
  $('pause15').addEventListener('click', () => {
    save(isPaused() ? { pausedUntil: 0 } : { pausedUntil: Date.now() + PAUSE_MS });
  });
  document.querySelectorAll('[data-preset]').forEach((b) => {
    b.addEventListener('click', () => save({ ...PRESETS[b.dataset.preset], pausedUntil: 0 }));
  });
  document.querySelectorAll('input[type=checkbox][data-key]').forEach((cb) => {
    cb.addEventListener('change', () => save({ [cb.dataset.key]: cb.checked }));
  });
  document.querySelectorAll('.stepper').forEach((st) => {
    const key = st.dataset.key;
    const min = +st.dataset.min, max = +st.dataset.max, step = +st.dataset.step;
    const bump = (d) => save({ [key]: Math.min(max, Math.max(min, (+settings[key] || 0) + d)) });
    st.querySelector('.minus').addEventListener('click', () => bump(-step));
    st.querySelector('.plus').addEventListener('click', () => bump(step));
  });
}

// ---------- Other sites (access asked one site at a time) ----------
const originsFor = (d) => [`https://${d}/*`, `https://*.${d}/*`];
const hasAccess = (d) => chrome.permissions.contains({ origins: originsFor(d) });
// Must be called directly inside a click/submit handler (user gesture).
const askAccess = (d) => chrome.permissions.request({ origins: originsFor(d) });

function normalizeDomain(raw) {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

async function renderSites() {
  const list = $('site-list');
  list.textContent = '';
  const sites = settings.greySites || [];
  let allowed = 0, pending = 0;
  for (const d of sites) {
    const granted = await hasAccess(d);
    granted ? allowed++ : pending++;
    const chip = document.createElement('span');
    chip.className = 'chip' + (granted ? '' : ' pending');
    const label = document.createElement('span');
    label.textContent = d;
    chip.append(label);
    if (!granted) {
      const allow = document.createElement('button');
      allow.type = 'button'; allow.className = 'allow'; allow.textContent = 'Allow';
      allow.title = `Allow greyscale on ${d}`;
      allow.addEventListener('click', () => { askAccess(d).then(renderSites); });
      chip.append(allow);
    }
    const x = document.createElement('button');
    x.type = 'button'; x.title = `Remove ${d}`; x.textContent = '×';
    x.addEventListener('click', () => {
      save({ greySites: settings.greySites.filter((s) => s !== d) });
      chrome.permissions.remove({ origins: originsFor(d) }).catch(() => {});
      renderSites();
    });
    chip.append(x);
    list.append(chip);
  }
  if (!sites.length) {
    const e = document.createElement('span'); e.className = 'empty'; e.textContent = 'No sites yet';
    list.append(e);
  }
  $('allow-note').hidden = pending === 0;
  $('others-sum').textContent = !settings.greySitesOn ? 'off'
    : pending ? `${allowed} on · ${pending} need Allow` : `${allowed} on`;
  // Open the section by default when something needs the user's click
  if (pending && !sessionStorage.getItem('othersSeen')) { $('others').open = true; sessionStorage.setItem('othersSeen', '1'); }
}

function initSites() {
  const input = $('site-input'), err = $('site-error');
  $('site-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = normalizeDomain(input.value);
    if (!d) { err.textContent = 'Enter a domain like reddit.com'; err.hidden = false; return; }
    if (d === 'youtube.com') { err.textContent = 'YouTube is handled by the settings above'; err.hidden = false; return; }
    err.hidden = true;
    // Save first (the popup can close when Chrome shows the permission prompt),
    // then ask inside the same user gesture.
    if (!settings.greySites.includes(d)) save({ greySites: [...settings.greySites, d] });
    input.value = '';
    askAccess(d).finally(renderSites);
  });
  document.querySelector('[data-key="greySitesOn"]').addEventListener('change', () => setTimeout(renderSites, 0));
}

// ---------- Session, weekly summary, review link ----------
const localDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const weekKey = (d) => {
  const m = new Date(d); m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return localDay(m);
};
const fmtDur = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

async function renderSession() {
  const { session, weeks = {}, days = [], reviewDismissed } =
    await chrome.storage.local.get(['session', 'weeks', 'days', 'reviewDismissed']);
  const fresh = session && Date.now() - session.lastActive <= SESSION_GAP_MS;
  $('intent').textContent = fresh && session.intent ? session.intent : 'Not set';
  $('time').textContent = (fresh ? Math.floor(session.activeMs / 60000) : 0) + ' min';

  const now = Date.now();
  const thisW = weeks[weekKey(now)] || 0;
  const lastW = weeks[weekKey(now - 7 * 864e5)] || 0;
  const week = $('week');
  week.textContent = '';
  week.append('This week ');
  const b = document.createElement('b'); b.textContent = fmtDur(thisW); week.append(b);
  if (lastW) {
    week.append(` · last week ${fmtDur(lastW)} `);
    const pct = Math.round((1 - thisW / lastW) * 100);
    const s = document.createElement('span');
    s.className = pct >= 0 ? 'down' : 'up';
    s.textContent = pct >= 0 ? `↓ ${pct}%` : `↑ ${-pct}%`;
    week.append(s);
  }

  // Review link: only after 7 different days of real use, and only until dismissed
  $('nudge').hidden = reviewDismissed || days.length < REVIEW_AFTER_DAYS;
}

function initNudge() {
  $('review').href = `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;
  $('nudge-x').addEventListener('click', () => { chrome.storage.local.set({ reviewDismissed: true }); $('nudge').hidden = true; });
  $('review').addEventListener('click', () => chrome.storage.local.set({ reviewDismissed: true }));
}

$('end').addEventListener('click', async () => { await chrome.storage.local.remove('session'); renderSession(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const k in changes) settings[k] = changes[k].newValue ?? DEFAULTS[k];
  render();
});

(async () => {
  settings = await chrome.storage.sync.get(DEFAULTS);
  initControls();
  initSites();
  initNudge();
  render();
  renderSites();
  renderSession();
  setInterval(() => { render(); renderSession(); }, 5000);
})();
