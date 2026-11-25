const DEFAULT_SITES = ['x.com', 'linkedin.com'];
const SCRIPT_ID = 'ytf-grey-sites';
const YT_MATCHES = ['https://www.youtube.com/*', 'https://youtube.com/*'];

// ---------- Messages from the content script ----------
// Closes the tab when the user picks "Leave" or "Close tab" on an overlay.
// window.close() can't close tabs the user opened, so the content script asks us.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'closeTab' && sender.tab && sender.tab.id != null) {
    chrome.tabs.remove(sender.tab.id);
  }
});

// ---------- Install / update ----------
// Chrome does not run a new extension in tabs that were already open, so a
// user who installs and looks at their open YouTube tab would see no change
// and think it is broken. Inject into those tabs straight away.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: YT_MATCHES });
  for (const t of tabs) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
    } catch (e) { /* tab may be discarded or not ready: it will load normally later */ }
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  syncGreySites();
  updateBadge();
  if (reason === 'install' || reason === 'update') injectIntoOpenTabs();
  if (reason === 'install') {
    chrome.storage.local.set({ installedAt: Date.now() });
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});
chrome.runtime.onStartup.addListener(() => { syncGreySites(); updateBadge(); });

// ---------- Toolbar shortcut: turn everything on or off ----------
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-unpull') return;
  const { enabled = true, pausedUntil = 0 } = await chrome.storage.sync.get(['enabled', 'pausedUntil']);
  const on = enabled && !(pausedUntil > Date.now());
  chrome.storage.sync.set(on ? { enabled: false } : { enabled: true, pausedUntil: 0 });
});

// ---------- Toolbar badge: shows clearly when it is OFF or paused ----------
async function updateBadge() {
  const { enabled = true, pausedUntil = 0 } = await chrome.storage.sync.get(['enabled', 'pausedUntil']);
  const paused = pausedUntil > Date.now();
  if (!enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#5C5C5C' });
  } else if (paused) {
    chrome.action.setBadgeText({ text: 'II' });
    chrome.action.setBadgeBackgroundColor({ color: '#C9A86A' });
    chrome.alarms.create('resume', { when: pausedUntil + 500 });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'resume') {
    chrome.storage.sync.set({ pausedUntil: 0 }); // triggers updateBadge via onChanged
  }
});

// ---------- Greyscale on other sites ----------
// Registers grey.css/grey.js only for sites the user has granted access to,
// so nothing runs on any other site. Re-registered whenever the list changes.
function toMatches(domains) {
  return domains
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))
    .flatMap((d) => [`https://${d}/*`, `https://*.${d}/*`]);
}

async function syncGreySites() {
  const s = await chrome.storage.sync.get({
    enabled: true, greySitesOn: true, greySites: DEFAULT_SITES
  });
  try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch {}
  const matches = [];
  if (s.enabled && s.greySitesOn) {
    for (const d of s.greySites || []) {
      const m = toMatches([d]);
      if (m.length && await chrome.permissions.contains({ origins: m })) matches.push(...m);
    }
  }
  if (!matches.length) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches,
      css: ['grey.css'],
      js: ['grey.js'],
      runAt: 'document_start',
      persistAcrossSessions: true
    }]);
  } catch (e) {
    console.warn('Unpull: could not register grey sites', e);
  }
}

chrome.permissions.onAdded.addListener(syncGreySites);
chrome.permissions.onRemoved.addListener(syncGreySites);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if ('enabled' in changes || 'greySitesOn' in changes || 'greySites' in changes) syncGreySites();
  if ('enabled' in changes || 'pausedUntil' in changes) updateBadge();
});
