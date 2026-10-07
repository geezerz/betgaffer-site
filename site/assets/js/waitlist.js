// Founding waitlist: progressive enhancement for form[data-waitlist] (plan Task 7).
// Browser module, served alone (no imports). Without it the form still posts and the Function
// answers with a 303 to a static result page.
//
// Server data is only ever written with textContent — never parsed as HTML.

const ENDPOINT = '/api/waitlist';
const MAX_MESSAGE = 300;

const FALLBACK = Object.freeze({
  ok: "You're on the list. We'll email you when your invite is ready.",
  invalid: 'Please check your email address and the 18+ box, then try again.',
  slow: 'Too many attempts — try again in an hour.',
  down: 'The waitlist is temporarily unavailable.',
  offline: "Couldn't reach the waitlist. Check your connection and try again.",
  sending: 'Sending…',
});

/**
 * The places line from a GET /api/waitlist payload, or null when the payload is not sane (the
 * static "500 founding places" then stays). Never a date, never a countdown.
 */
export function placesText(data) {
  if (!data || typeof data !== 'object') return null;
  const { places_left: left, cap } = data;
  if (!Number.isInteger(cap) || cap <= 0 || !Number.isInteger(left) || left < 0 || left > cap) return null;
  if (left === 0) return `The ${cap} founding places are taken — you can still join the waitlist.`;
  return `${left} of ${cap} founding places left`;
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
  const places = form.querySelector('[data-waitlist-places]');
  const button = form.querySelector('button[type="submit"]');
  let busy = false;

  if (places) {
    loadPlaces().then((data) => {
      const text = placesText(data);
      if (text) places.textContent = text;
    });
  }

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

function init() {
  for (const form of document.querySelectorAll('form[data-waitlist]')) enhance(form);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
