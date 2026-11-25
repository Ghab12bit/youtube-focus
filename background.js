const DEFAULT_SITES = ['x.com', 'twitter.com', 'linkedin.com'];
const SCRIPT_ID = 'ytf-grey-sites';

// Closes the tab when the user picks "Leave" or "Close tab" on an overlay.
// window.close() can't close tabs the user opened, so the content script asks us.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'closeTab' && sender.tab && sender.tab.id != null) {
    chrome.tabs.remove(sender.tab.id);
  }
});

// ---------- Greyscale on other sites ----------
// Registers grey.css/grey.js only for the domains in the list, so nothing
// runs on any other site. Re-registered whenever the list changes.
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
  // Only register for sites the user has actually granted access to.
  const granted = [];
  if (s.enabled && s.greySitesOn) {
    for (const d of s.greySites || []) {
      const m = toMatches([d]);
      if (m.length && await chrome.permissions.contains({ origins: m })) granted.push(...m);
    }
  }
  const matches = granted;
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
    console.warn('YouTube Focus: could not register grey sites', e);
  }
}

chrome.runtime.onInstalled.addListener(syncGreySites);
chrome.permissions.onAdded.addListener(syncGreySites);
chrome.permissions.onRemoved.addListener(syncGreySites);
chrome.runtime.onStartup.addListener(syncGreySites);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && ('enabled' in changes || 'greySitesOn' in changes || 'greySites' in changes)) {
    syncGreySites();
  }
});
