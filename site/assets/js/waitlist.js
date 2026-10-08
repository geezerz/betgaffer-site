// Founding waitlist: progressive enhancement for form[data-waitlist] and the places counter (plan
// Task 7; Plan A Task 4). Browser module, served alone (no imports). Without it the form still posts
// and the Function answers with a 303 to a static result page.
//
// The counter and the "places taken" line are looked up at DOCUMENT level: on /waitlist/ the counter
// tile and the line sit outside the form. GET /api/waitlist is fetched at most once per page view.
//
// Server data is only ever written with textContent — never parsed as HTML.

const ENDPOINT = '/api/waitlist';
const MAX_MESSAGE = 300;

const FALLBACK = Object.freeze({
  // = THANKS_MESSAGE in site/lib/waitlist-form.js and MESSAGES.ok in functions/api/waitlist.js
  // (this module is served alone and cannot import it; tests/waitlist.test.js asserts equality).
  ok: "You're on the founding waitlist. We'll email your invite when it's ready — if you're among the first 500, you'll have 30 days from that email to claim your place.",
  invalid: 'Please check your email address and the 18+ box, then try again.',
  slow: 'Too many attempts — try again in an hour.',
  down: 'The waitlist is temporarily unavailable.',
  offline: "Couldn't reach the waitlist. Check your connection and try again.",
  sending: 'Sending…',
});

/** { left, cap } from a GET /api/waitlist payload, or null when the payload is not sane. */
function sanePlaces(data) {
  if (!data || typeof data !== 'object') return null;
  const { places_left: left, cap } = data;
  if (!Number.isInteger(cap) || cap <= 0 || !Number.isInteger(left) || left < 0 || left > cap) return null;
  return { left, cap };
}

/**
 * The counter text from a GET /api/waitlist payload, or null when the payload is not sane (the
 * static text then stays). The tile on /waitlist/ is labelled "Waitlist places", so it reads
 * "n of 500 left" / "All 500 taken"; `long` is the form's own line, which has no label. Never a
 * date, never a countdown.
 */
export function placesText(data, { long = false } = {}) {
  const p = sanePlaces(data);
  if (!p) return null;
  if (p.left === 0) return long ? `All ${p.cap} waitlist places are taken` : `All ${p.cap} taken`;
  return long ? `${p.left} of ${p.cap} waitlist places left` : `${p.left} of ${p.cap} left`;
}

/**
 * An updater for every [data-waitlist-places] counter and [data-waitlist-full] line in doc. At 0 the
 * lines are shown; once the page has said "taken" it never shows a number again (a stale cached
 * answer from another data centre must not make the count rise in front of the reader).
 */
export function placesUpdater(doc) {
  const counters = [...doc.querySelectorAll('[data-waitlist-places]')];
  const fullLines = [...doc.querySelectorAll('[data-waitlist-full]')];
  let full = false;
  return (data) => {
    if (full) return;
    const p = sanePlaces(data);
    if (!p) return;
    for (const el of counters) el.textContent = placesText(data, { long: el.getAttribute('data-waitlist-places') === 'long' });
    if (p.left === 0) {
      full = true;
      for (const el of fullLines) el.hidden = false;
    }
  };
}

/** The message to show for a POST response: the server's when it is a sane string, else a fallback. */
export function messageFor(status, data) {
  const m = data && typeof data === 'object' ? data.message : undefined;
  if (typeof m === 'string' && m.trim() !== '' && m.length <= MAX_MESSAGE) return m;
  if (status >= 200 && status < 300) return FALLBACK.ok;
  if (status === 429) return FALLBACK.slow;
  if (status >= 400 && status < 500) return FALLBACK.invalid;
  return FALLBACK.down;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

let placesPromise = null;
function loadPlaces() {
  if (!placesPromise) {
    placesPromise = fetch(ENDPOINT, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then((res) => (res.ok ? readJson(res) : null))
      .catch(() => null);
  }
  return placesPromise;
}

function enhance(form) {
  const status = form.querySelector('[data-waitlist-status]');
  const button = form.querySelector('button[type="submit"]');
  let busy = false;

  const say = (text, state) => {
    if (!status) return;
    status.textContent = text;
    if (state) status.setAttribute('data-state', state); else status.removeAttribute('data-state');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // the browser has already enforced required / type=email
    if (busy) return;
    busy = true;
    if (button) button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    say(FALLBACK.sending, null);
    try {
      const res = await fetch(form.action || ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
      });
      const data = await readJson(res);
      const ok = res.ok && data !== null && data.ok === true;
      say(messageFor(res.status, data), ok ? 'ok' : 'error');
      if (ok) form.reset();
    } catch {
      say(FALLBACK.offline, 'error');
    } finally {
      busy = false;
      if (button) button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}

/**
 * Wire every waitlist form on the page and fill the counters. Dependencies are injectable (tests
 * drive it with a fake DOM); in the browser it runs with the defaults. Resolves once the counters
 * have been filled (or left as they are).
 */
export async function init({ doc = document, load = loadPlaces } = {}) {
  for (const form of doc.querySelectorAll('form[data-waitlist]')) enhance(form);
  if (doc.querySelector('[data-waitlist-places]') || doc.querySelector('[data-waitlist-full]')) {
    const update = placesUpdater(doc);
    try {
      update(await load());
    } catch {
      // the counter keeps its static text
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init(); }, { once: true });
  else init();
}
