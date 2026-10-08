// The founding banner's close button (spec §2). Browser module, loaded by layout.page() as the FIRST
// module script on every page that carries the banner, so a dismissed banner is removed before any
// other module runs (a brief flash on a slow connection is accepted).
//
// It never fetches anything: the waitlist counter is read on /waitlist/ only (KV list operations are
// rationed). It imports nothing.
//
// The static HTML ships the close button `hidden`: without JS the banner shows and cannot be closed.
// Here the button is shown; a click stores the choice in localStorage (per browser) and removes the
// banner. Storage that is missing, blocked or full never breaks the page: the banner then shows, and
// a click still removes it for this page view.

export const STORAGE_KEY = 'bg.founding.banner';
export const HIDDEN_VALUE = 'hidden';

/** window.localStorage, or null where reading the property itself throws (blocked cookies). */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function dismissed(storage) {
  try {
    return storage !== null && storage.getItem(STORAGE_KEY) === HIDDEN_VALUE;
  } catch {
    return false;
  }
}

/** Every dependency is injectable (tests drive it with a fake DOM); in the browser it runs with the defaults. */
export function init({ doc = document, storage = defaultStorage() } = {}) {
  const banner = doc.querySelector('[data-banner]');
  if (!banner) return;
  if (dismissed(storage)) {
    banner.remove();
    return;
  }
  const close = banner.querySelector('[data-banner-close]');
  if (!close) return;
  close.addEventListener('click', () => {
    try {
      if (storage !== null) storage.setItem(STORAGE_KEY, HIDDEN_VALUE);
    } catch {
      // Not remembered (blocked or full storage); still hidden for this page view.
    }
    // The focused button is about to leave the document: hand focus to the page's main content
    // instead of letting it fall back to <body>.
    const main = doc.getElementById ? doc.getElementById('main') : null;
    banner.remove();
    if (main && typeof main.focus === 'function') main.focus({ preventScroll: true });
  });
  close.hidden = false;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
}
