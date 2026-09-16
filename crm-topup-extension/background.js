// CRM Top-Up Helper — minimal service worker.
// The content script does all the work; this only shows install info.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ installedAt: Date.now() });
});
