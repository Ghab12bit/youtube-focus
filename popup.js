const DEFAULTS = {
  enabled: true, grey: true, blur: true, mute: true,
  pause: true, countdown: 5, timer: true, limit: true, limitMin: 30,
  greySitesOn: true, greySites: ['x.com', 'twitter.com', 'linkedin.com']
};

// ---------- Other sites ----------
function normalizeDomain(raw) {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

// Site access is optional and asked for one site at a time, only when the
// user adds (or allows) that site. Nothing runs on a site without permission.
const originsFor = (d) => [`https://${d}/*`, `https://*.${d}/*`];
const hasAccess = (d) => chrome.permissions.contains({ origins: originsFor(d) });
// Must be called directly inside a click/submit handler (user gesture).
const askAccess = (d) => chrome.permissions.request({ origins: originsFor(d) });

async function renderSites() {
  const list = document.getElementById('site-list');
  list.textContent = '';
  const sites = settings.greySites || [];
  if (!sites.length) {
    const e = document.createElement('span');
    e.className = 'empty';
    e.textContent = 'No sites yet';
    list.append(e);
    return;
  }
  for (const d of sites) {
    const granted = await hasAccess(d);
    const chip = document.createElement('span');
    chip.className = 'chip' + (granted ? '' : ' pending');
    const label = document.createElement('span');
    label.textContent = d;
    chip.append(label);
    if (!granted) {
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'allow';
      allow.title = `Allow greyscale on ${d}`;
      allow.textContent = 'Allow';
      allow.addEventListener('click', () => {
        askAccess(d).then(() => renderSites());
      });
      chip.append(allow);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.title = `Remove ${d}`;
    x.textContent = '×';
    x.addEventListener('click', () => {
      save('greySites', settings.greySites.filter((s) => s !== d));
      chrome.permissions.remove({ origins: originsFor(d) }).catch(() => {});
      renderSites();
    });
    chip.append(x);
    list.append(chip);
  }
}

function initSites() {
  const form = document.getElementById('site-form');
  const input = document.getElementById('site-input');
  const err = document.getElementById('site-error');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = normalizeDomain(input.value);
    if (!d) { err.textContent = 'Enter a domain like reddit.com'; err.hidden = false; return; }
    if (d === 'youtube.com') { err.textContent = 'YouTube is handled by the settings above'; err.hidden = false; return; }
    err.hidden = true;
    // Save first (the popup can close when Chrome shows the permission
    // prompt), then ask inside the same user gesture. A declined site stays
    // in the list with an "Allow" button.
    if (!settings.greySites.includes(d)) save('greySites', [...settings.greySites, d]);
    input.value = '';
    askAccess(d).finally(() => renderSites());
  });
  renderSites();
}

let settings = { ...DEFAULTS };

function syncState() {
  document.body.classList.toggle('off', !settings.enabled);
  document.getElementById('status').textContent = settings.enabled ? 'Active' : 'Paused';
  document.querySelectorAll('[data-depends]').forEach((el) => {
    el.classList.toggle('disabled', !settings[el.dataset.depends]);
  });
}

function save(key, value) {
  settings[key] = value;
  chrome.storage.sync.set({ [key]: value });
  syncState();
}

function initToggles() {
  document.querySelectorAll('input[type=checkbox][data-key]').forEach((cb) => {
    cb.checked = !!settings[cb.dataset.key];
    cb.addEventListener('change', () => save(cb.dataset.key, cb.checked));
  });
}

function initSteppers() {
  document.querySelectorAll('.stepper').forEach((st) => {
    const key = st.dataset.key;
    const min = +st.dataset.min, max = +st.dataset.max, step = +st.dataset.step;
    const unit = st.dataset.unit || '';
    const val = st.querySelector('.val');
    const render = () => { val.textContent = settings[key] + unit; };
    const bump = (d) => {
      const next = Math.min(max, Math.max(min, (+settings[key] || 0) + d));
      save(key, next);
      render();
    };
    st.querySelector('.minus').addEventListener('click', () => bump(-step));
    st.querySelector('.plus').addEventListener('click', () => bump(step));
    render();
  });
}

async function renderSession() {
  const { session } = await chrome.storage.local.get('session');
  const fresh = session && Date.now() - session.lastActive <= 30 * 60 * 1000;
  document.getElementById('intent').textContent = fresh && session.intent ? session.intent : 'Not set';
  document.getElementById('time').textContent =
    (fresh ? Math.floor(session.activeMs / 60000) : 0) + ' min';
}

document.getElementById('end').addEventListener('click', async () => {
  await chrome.storage.local.remove('session');
  renderSession();
});

(async () => {
  settings = await chrome.storage.sync.get(DEFAULTS);
  initToggles();
  initSteppers();
  initSites();
  syncState();
  renderSession();
  setInterval(renderSession, 5000);
})();
