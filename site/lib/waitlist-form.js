// Founding-waitlist form and the no-JS result pages (spec §8 S2–S5, §10; plan Task 7).
// ISOMORPHIC-SAFE (no node: imports, no process/Buffer); used by the build only.
//
// The form works with JavaScript disabled: a plain POST to /api/waitlist, which answers a no-JS
// request with a 303 to /waitlist/<kind>/ (rendered by the build from waitlistResultPage). With JS,
// /assets/js/waitlist.js submits it with fetch and fills the places line from GET /api/waitlist.
//
// The places line never shows a date or a countdown — the launch date is never published.
// Every interpolated value goes through escHtml / escAttr; there is no inline style or script.

import { escHtml, escAttr } from './esc.js';
import siteConfig from '../config.js';

/** One source for the cap: site/config.js. The Function's own CAP is asserted equal by the tests. */
export const FOUNDING_CAP = siteConfig.founding_places;

/**
 * The consent line shown at the point of collection (NDPA 2023 s.43 informed consent: the
 * cross-border transfer and its risk are stated beside the field; the privacy policy repeats it).
 */
export const CONSENT_TEXT = "We'll use this address only to tell you when your invite is ready. "
  + 'It is stored by Cloudflare in the United States, where data protection law may protect it less '
  + 'than Nigerian law does.';

export const WAITLIST_RESULT_KINDS = Object.freeze(['thanks', 'invalid', 'slow-down', 'unavailable']);

const ID_PREFIX_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The waitlist form.
 * @param {object} [o]
 * @param {string} [o.idPrefix='wl']  prefix for element ids, so two forms on one page stay distinct
 * @returns {string} trusted HTML fragment
 */
export function waitlistForm({ idPrefix = 'wl' } = {}) {
  if (typeof idPrefix !== 'string' || !ID_PREFIX_RE.test(idPrefix)) {
    throw new TypeError(`waitlistForm: idPrefix must match ${ID_PREFIX_RE}, got ${JSON.stringify(idPrefix)}`);
  }
  const id = (s) => escAttr(`${idPrefix}-${s}`);
  return `<form class="bg-wl" method="post" action="/api/waitlist" data-waitlist>
<p class="bg-wl__places mono" data-waitlist-places>${escHtml(`${FOUNDING_CAP} founding places`)}</p>
<div class="bg-wl__field">
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
<button type="submit" class="bg-btn bg-btn--primary">Join the waitlist</button>
</div>
<p class="bg-wl__status" role="status" aria-live="polite" data-waitlist-status></p>
</form>`;
}

const RESULTS = Object.freeze({
  thanks: Object.freeze({
    title: "You're on the list",
    description: 'You have joined the Bet Gaffer founding waitlist.',
    heading: "You're on the list.",
    lines: Object.freeze([
      "We'll email you when your invite is ready. We'll use your address for nothing else.",
    ]),
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
  const form = r.form ? `\n${waitlistForm({ idPrefix: 'wl-retry' })}` : '';
  return `<section class="bg-wl-result" aria-labelledby="wl-result-h">
<p class="t-lbl">Founding waitlist</p>
<h1 class="t-d2" id="wl-result-h">${escHtml(r.heading)}</h1>
${lines}${form}
<p class="bg-wl-result__back"><a href="/">Back to today's predictions</a> · <a href="/features/">About Bet Gaffer</a></p>
</section>`;
}
