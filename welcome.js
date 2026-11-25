// ---------- Before / after slider ----------
const COLOURS = [
  ['#ff3d3d', '#ffb400'], ['#00c2ff', '#7b2bff'], ['#ff2bbf', '#ff7a00'], ['#20e07b', '#00a3ff'],
  ['#ffe600', '#ff4d6d'], ['#6a5cff', '#00e0c6'], ['#ff7a00', '#ff2bbf'], ['#00b3ff', '#9dff00']
];
document.querySelectorAll('.feed').forEach((feed) => {
  COLOURS.forEach(([a, b]) => {
    const card = document.createElement('div');
    const t = document.createElement('div');
    t.className = 't';
    t.style.background = `linear-gradient(135deg, ${a}, ${b})`;
    const l1 = document.createElement('div'); l1.className = 'l1';
    const l2 = document.createElement('div'); l2.className = 'l2';
    card.append(t, l1, l2);
    feed.append(card);
  });
});

const ba = document.getElementById('ba');
const grey = document.getElementById('grey');
const handle = document.getElementById('handle');
function setSplit(clientX) {
  const r = ba.getBoundingClientRect();
  const pct = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  grey.style.clipPath = `inset(0 0 0 ${pct}%)`;
  handle.style.left = pct + '%';
}
let dragging = false;
ba.addEventListener('pointerdown', (e) => { dragging = true; ba.setPointerCapture(e.pointerId); setSplit(e.clientX); });
ba.addEventListener('pointermove', (e) => { if (dragging) setSplit(e.clientX); });
ba.addEventListener('pointerup', () => { dragging = false; });

// ---------- Presets ----------
const PRESETS = {
  calm:   { enabled: true, pausedUntil: 0, grey: true, blur: false, mute: true, pause: false, timer: true, limit: false },
  strict: { enabled: true, pausedUntil: 0, grey: true, blur: true,  mute: true, pause: true,  timer: true, limit: true, countdown: 5, limitMin: 30 },
  off:    { enabled: false }
};
const cards = document.querySelectorAll('[data-preset]');
function mark(name) { cards.forEach((c) => c.classList.toggle('sel', c.dataset.preset === name)); }
cards.forEach((c) => c.addEventListener('click', () => {
  chrome.storage.sync.set(PRESETS[c.dataset.preset]);
  mark(c.dataset.preset);
}));
chrome.storage.sync.get({ enabled: true, pause: false, limit: false }).then((s) => {
  mark(!s.enabled ? 'off' : (s.pause && s.limit ? 'strict' : 'calm'));
});

// ---------- Pinned? (Chrome 91+) ----------
async function checkPinned() {
  try {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    document.getElementById('pinned').hidden = !isOnToolbar;
  } catch { /* older Chrome: leave the instructions as they are */ }
}
checkPinned();
setInterval(checkPinned, 1500);
