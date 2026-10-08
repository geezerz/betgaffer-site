// The founding card's script (spec §2, §16.5): its close button and its copy rotation. Browser module,
// loaded by layout.page() as the FIRST module script on every page that carries the card, so a
// dismissed card is removed before any other module runs (a brief flash on a slow connection is
// accepted).
//
// It never fetches anything: the waitlist counter is read on /waitlist/ only (KV list operations are
// rationed). Its one import is the copy itself, ./lib/founding.js (isomorphic, shipped by the build).
//
// Rotation: the static HTML carries the variant chosen by the page's path (no-JS readers see different
// copy on different pages). Here a variant is picked at random for this page view, never the one the
// previous page view showed (remembered in localStorage), and the heading and line are rebuilt from
// its segments with DOM APIs only (createElement / textContent; key words as strong.fd-hl, every
// percentage inside data-figure="offer") — the same nodes the build writes. The card reserves the
// height of its longest variant (founding.css), so the swap moves nothing below it.
//
// Dismissal: the static HTML ships the close button `hidden` (without JS the card cannot be closed).
// Here the button is shown; a click stores the choice in localStorage (per browser) and removes the
// card. Storage that is missing, blocked or full never breaks the page: the card then shows, rotates
// without memory, and a click still removes it for this page view.

import { VARIANTS } from './lib/founding.js';

export const STORAGE_KEY = 'bg.founding.banner';
export const HIDDEN_VALUE = 'hidden';
/** The variant the last page view showed: its index as a decimal string. */
export const VARIANT_KEY = 'bg.founding.v';

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

/** The previous page view's variant, or null (nothing stored, unreadable, or not a variant index). */
function lastShown(storage) {
  let v = null;
  try {
    v = storage === null ? null : storage.getItem(VARIANT_KEY);
  } catch {
    return null;
  }
  if (typeof v !== 'string' || !/^(?:0|[1-9][0-9]?)$/.test(v)) return null;
  const i = Number(v);
  return i < VARIANTS.length ? i : null;
}

/**
 * A random variant index in [0, n), never `last` (when n > 1). random() outside [0, 1) (or not a
 * number) counts as 0, so a broken generator still yields a valid, non-repeating index.
 */
export function pickVariant(last, n, random) {
  const r = Number(random());
  const u = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0;
  if (last === null || n < 2) return Math.min(n - 1, Math.floor(u * n));
  const k = Math.min(n - 2, Math.floor(u * (n - 1))); // one of the n - 1 others
  return k >= last ? k + 1 : k;
}

/** One copy segment as a DOM node: text, or strong.fd-hl / span carrying data-figure="offer". */
function segmentNode(doc, { t, hl, offer }) {
  if (!hl && !offer) return t;
  const el = doc.createElement(hl ? 'strong' : 'span');
  if (hl) el.className = 'fd-hl';
  if (offer) el.setAttribute('data-figure', 'offer');
  el.textContent = t;
  return el;
}

/** Puts variant i's copy into the card; false (nothing changed) when the card lacks its copy slots. */
function show(doc, card, i) {
  const heading = card.querySelector('[data-fd-heading]');
  const line = card.querySelector('[data-fd-line]');
  if (!heading || !line || typeof heading.replaceChildren !== 'function' || typeof line.replaceChildren !== 'function') return false;
  const v = VARIANTS[i];
  heading.replaceChildren(...v.heading.map((s) => segmentNode(doc, s)));
  line.replaceChildren(...v.line.map((s) => segmentNode(doc, s)));
  card.setAttribute('data-variant', String(i));
  return true;
}

function rotate(doc, card, storage, random) {
  const i = pickVariant(lastShown(storage), VARIANTS.length, random);
  if (!show(doc, card, i)) return;
  try {
    if (storage !== null) storage.setItem(VARIANT_KEY, String(i));
  } catch {
    // Not remembered (blocked or full storage): the next view may repeat this one.
  }
}

/** Every dependency is injectable (tests drive it with a fake DOM); in the browser it runs with the defaults. */
export function init({ doc = document, storage = defaultStorage(), random = Math.random } = {}) {
  const card = doc.querySelector('[data-banner]');
  if (!card) return;
  if (dismissed(storage)) {
    card.remove();
    return;
  }
  try {
    rotate(doc, card, storage, random);
  } catch {
    // The static variant stays; the close button below must still work.
  }
  const close = card.querySelector('[data-banner-close]');
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
    card.remove();
    if (main && typeof main.focus === 'function') main.focus({ preventScroll: true });
  });
  close.hidden = false;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
}
