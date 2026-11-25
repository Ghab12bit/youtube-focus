// Lets already-open tabs react instantly when greyscale is switched off or
// a site is removed, without needing a reload.
(() => {
  const DEFAULTS = { enabled: true, greySitesOn: true, greySites: ['x.com', 'twitter.com', 'linkedin.com'] };
  const root = document.documentElement;
  const host = location.hostname.replace(/^www\./, '');

  const matches = (sites) => sites.some((d) => host === d || host.endsWith('.' + d));

  function apply(s) {
    const on = s.enabled && s.greySitesOn && matches(s.greySites || []);
    if (on) root.removeAttribute('data-ytf-site-off');
    else root.setAttribute('data-ytf-site-off', '');
  }

  chrome.storage.sync.get(DEFAULTS).then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!('enabled' in changes || 'greySitesOn' in changes || 'greySites' in changes)) return;
    chrome.storage.sync.get(DEFAULTS).then(apply);
  });
})();
