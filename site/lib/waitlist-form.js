// Founding-waitlist form and the no-JS result pages (spec §8 S2–S5, §10; plan Task 7).
// ISOMORPHIC-SAFE (no node: imports, no process/Buffer); used by the build only.
//
// The form works with JavaScript disabled: a plain POST to /api/waitlist, which answers a no-JS
// request with a 303 to /waitlist/<kind>/ (rendered by the build from waitlistResultPage). With JS,
// /assets/js/waitlist.js submits it with fetch and fills the places line (on /waitlist/, the counter
// tile above the form instead: that form is rendered without its own line) from GET /api/waitlist.
//
// The places line never shows a date or a countdown — the launch date is never published.
// Every interpolated value goes through escHtml / escAttr; there is no inline style or script.

import { escHtml, escAttr } from './esc.js';
import siteConfig from '../config.js';
import { CLAIM_DAYS, WAITLIST_PLACES } from './founding.js';

/**
 * The waitlist cap: site/config.js waitlist_places = founding.js WAITLIST_PLACES. The Function's own
 * CAP (it cannot import site code) is asserted equal by tests/waitlist.test.js.
 */
export const WAITLIST_CAP = siteConfig.waitlist_places;

/**
 * The consent line shown at the point of collection (NDPA 2023 s.43 informed consent: the
 * purposes — the invite and matching it to the account opened with the address — and the
 * cross-border transfer and its risk are stated beside the field; the privacy policy repeats it).
 */
export const CONSENT_TEXT = "We'll use this address only to send your invite and to match it to the account you open "
  + 'with it. It is stored by Cloudflare in the United States, where data protection law may protect it less '
  + 'than Nigerian law does.';

/**
 * The thanks copy (spec §3): one message for a new and an existing address, so the reply never reveals
 * whether an address is already on the list or where it stands. The Function's MESSAGES.ok and the
 * browser module's FALLBACK.ok carry the same text (they cannot import this; tests assert equality).
 */
export const THANKS_MESSAGE = "You're on the founding waitlist. We'll email your invite when it's ready — if you're "
  + `among the first ${WAITLIST_PLACES}, you'll have ${CLAIM_DAYS} days from that email to claim your place.`;

export const WAITLIST_RESULT_KINDS = Object.freeze(['thanks', 'invalid', 'slow-down', 'unavailable']);

const ID_PREFIX_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The waitlist form.
 * @param {object} [o]
 * @param {string} [o.idPrefix='wl']  prefix for element ids, so two forms on one page stay distinct
 * @param {boolean} [o.places=true]  the form's own places line; false on /waitlist/, where the counter
 *                                   tile above the form is the page's one counter
 * @returns {string} trusted HTML fragment
 */
export function waitlistForm({ idPrefix = 'wl', places = true } = {}) {
  if (typeof idPrefix !== 'string' || !ID_PREFIX_RE.test(idPrefix)) {
    throw new TypeError(`waitlistForm: idPrefix must match ${ID_PREFIX_RE}, got ${JSON.stringify(idPrefix)}`);
  }
  if (typeof places !== 'boolean') throw new TypeError(`waitlistForm: places must be a boolean, got ${JSON.stringify(places)}`);
  const id = (s) => escAttr(`${idPrefix}-${s}`);
  // "long": the script writes "n of 500 waitlist places left" here (this line has no tile label).
  const placesLine = places
    ? `<p class="bg-wl__places mono" data-waitlist-places="long">${escHtml(`${WAITLIST_CAP} waitlist places`)}</p>\n`
    : '';
  return `<form class="bg-wl" method="post" action="/api/waitlist" data-waitlist>
${placesLine}<div class="bg-wl__field">
<label class="bg-wl__label" for="${id('email')}">Email address</label>
<input class="bg-wl__input" id="${id('email')}" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required maxlength="254">
</div>
<div class="bg-wl__check">
<input class="bg-wl__box" id="${id('adult')}" name="adult" type="checkbox" value="yes" required>
<label for="${id('adult')}">I am 18 or over</label>
</div>
<div class="vh" aria-hidden="true">
<label for="${id('ref')}">Leave this empty</label>
<input id="${id('ref')}" name="bg_ref" type="text" tabindex="-1" autocomplete="off">
</div>
<p class="bg-wl__consent">${escHtml(CONSENT_TEXT)} <a href="/privacy/">Privacy policy</a></p>
<div class="bg-wl__actions">
<button type="submit" class="bg-btn bg-btn--primary">Join the founding waitlist</button>
</div>
<p class="bg-wl__status" role="status" aria-live="polite" data-waitlist-status></p>
</form>`;
}

const RESULTS = Object.freeze({
  thanks: Object.freeze({
    title: "You're on the list",
    description: 'You have joined the Bet Gaffer founding waitlist.',
    heading: "You're on the list.",
    lines: Object.freeze([THANKS_MESSAGE]),
    form: false,
  }),
  invalid: Object.freeze({
    title: 'Check your details',
    description: 'The waitlist could not accept that submission.',
    heading: "That didn't go through.",
    lines: Object.freeze([
      'Please enter a valid email address and confirm you are 18 or over, then try again.',
    ]),
    form: true,
  }),
  'slow-down': Object.freeze({
    title: 'Too many attempts',
    description: 'Too many waitlist attempts from this connection.',
    heading: 'Too many attempts.',
    lines: Object.freeze([
      'Too many attempts came from your connection. Please try again in an hour.',
    ]),
    form: false,
  }),
  unavailable: Object.freeze({
    title: 'Waitlist unavailable',
    description: 'The waitlist is temporarily unavailable.',
    heading: 'The waitlist is temporarily unavailable.',
    lines: Object.freeze([
      'Please try again later.',
    ]),
    form: false,
  }),
});

function result(kind) {
  if (typeof kind !== 'string' || !WAITLIST_RESULT_KINDS.includes(kind)) {
    throw new TypeError(`waitlist: unknown result page ${JSON.stringify(kind)}`);
  }
  return RESULTS[kind];
}

/**
 * Page metadata for a no-JS result page: { path, title, description, noindex: true }.
 * @param {'thanks'|'invalid'|'slow-down'|'unavailable'} kind
 */
export function waitlistResultMeta(kind) {
  const r = result(kind);
  return { path: `/waitlist/${kind}/`, title: r.title, description: r.description, noindex: true };
}

/**
 * The <main> body fragment for /waitlist/<kind>/ (Task 6 wraps it with layout.page()).
 * @param {'thanks'|'invalid'|'slow-down'|'unavailable'} kind
 * @returns {string} trusted HTML fragment
 */
export function waitlistResultPage(kind) {
  const r = result(kind);
  const lines = r.lines.map((l) => `<p class="t-b">${escHtml(l)}</p>`).join('\n');
  const form = r.form ? `\n${waitlistForm({ idPrefix: 'wl-retry', places: false })}` : '';
  return `<section class="bg-wl-result" aria-labelledby="wl-result-h">
<p class="t-lbl">Founding waitlist</p>
<h1 class="t-d2" id="wl-result-h">${escHtml(r.heading)}</h1>
${lines}${form}
<p class="bg-wl-result__back"><a href="/">Back to today's predictions</a> · <a href="/features/">About Bet Gaffer</a></p>
</section>`;
}
