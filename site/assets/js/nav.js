// The small-screen menu (spec §16.3). Browser module, loaded by layout.page() on EVERY page, right
// after banner.js (or first where there is no banner). It imports nothing and fetches nothing.
//
// The layout is CSS, not this script: below 600 px base.css already shows the wordmark and the ☰
// button and keeps the panel (#bg-nav-panel: the four nav links and the legal links) closed; from
// 600 px the button is not displayed and the nav sits inline. Without JS, nojs.css (linked inside
// <noscript>) restores the tab row. Here the button only opens and closes the panel:
//   - open: [data-open] on the panel, aria-expanded="true", focus moves to the first link;
//   - close: the button again, Esc, a tap outside, a link in the panel, focus leaving the panel for
//     the page, or a resize to 600 px and wider;
//   - closing hands focus back to the button when it was inside the panel (never stealing it from a
//     control the visitor moved to). So a tap outside leaves focus where the visitor tapped, and Esc
//     or a link inside the panel returns it to the button.
// The panel is position:fixed below the bar, so opening it never changes the bar's height (the
// sticky toolbar and the floating ring measure it). Attributes only: no markup, no style writes.

/** At this width and wider the inline nav takes over (base.css's 600 px breakpoint). */
export const WIDE_QUERY = '(min-width: 600px)';

function defaultMedia(q) {
  try {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(q).matches === true;
  } catch {
    return false;
  }
}

const wired = new WeakSet();

/**
 * Wire the ☰ button to its panel. Every dependency is injectable (tests drive it with a fake DOM);
 * in the browser it runs with the defaults. Returns a small controller, or null when the page has no
 * menu or it is already wired.
 */
export function init({ doc = globalThis.document, win = globalThis.window, media = defaultMedia } = {}) {
  if (!doc || !win) return null;
  const button = doc.querySelector('.bg-burger');
  const panel = doc.querySelector('#bg-nav-panel');
  if (!button || !panel || wired.has(button)) return null;
  wired.add(button);

  const wide = () => media(WIDE_QUERY);
  const isOpen = () => panel.hasAttribute('data-open');

  function open() {
    panel.setAttribute('data-open', '');
    button.setAttribute('aria-expanded', 'true');
    const first = panel.querySelector('a');
    if (first) first.focus();
  }

  /** Close; `refocus` returns focus to the button only if it was inside the closing panel. */
  function close({ refocus = true } = {}) {
    if (!isOpen()) return false;
    const inside = panel.contains(doc.activeElement);
    panel.removeAttribute('data-open');
    button.setAttribute('aria-expanded', 'false');
    if (refocus && inside) button.focus();
    return true;
  }

  button.addEventListener('click', () => {
    if (isOpen()) close();
    else if (!wide()) open(); // the button is not displayed from 600 px; never open a panel there
  });

  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    close();
    button.focus(); // Esc always lands on the button, wherever focus was
  });

  // pointerdown, not click: iOS fires no click on a tap over non-interactive content.
  doc.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (!isOpen() || !t || panel.contains(t) || button.contains(t)) return;
    close();
  });

  // Tab past the last link (or Shift+Tab out to the page): the panel closes behind the visitor.
  panel.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (!to || panel.contains(to) || button.contains(to)) return;
    close({ refocus: false });
  });

  for (const a of Array.from(panel.querySelectorAll('a'))) a.addEventListener('click', () => close());

  if (typeof win.addEventListener === 'function') {
    win.addEventListener('resize', () => {
      if (wide()) close({ refocus: false }); // the same link is now in the inline nav
    }, { passive: true });
  }

  return {
    open: () => { if (!isOpen() && !wide()) open(); },
    close: () => close(),
    get isOpen() { return isOpen(); },
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const start = () => {
    try {
      init();
    } catch {
      // The links stay in the page: the footer carries the legal ones, the wordmark goes home.
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
