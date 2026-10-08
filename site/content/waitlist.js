// The founding page /waitlist/ and the sitewide founding card (spec §2, §3 as amended in §14, §16.5; Plan A
// Task 4). BUILD ONLY.
//
// Every number comes from site/lib/founding.js, the benefit cards from its BENEFITS, so the page and
// the programme rules cannot drift. Every percentage printed sits inside data-figure="offer" (the claim
// guard allows the two offer numbers there and nowhere else). The time commitments on this page (B5,
// B6 and step 2's claim window) are approved sentences in site/lib/commitments.js; the commitments
// guard scans the built page.
//
// Interface:
//   META                          route metadata for the build (path, title, description)
//   render(cfg, { waitlistHtml }) the <main> fragment; waitlistHtml is waitlistForm({ places: false })
//                                 (the counter tile above the form is the page's one counter)
//   foundingCard(variantIndex)    the spec §16.5 founding card (one of VARIANTS) that layout.page()
//                                 puts under the header on every page except /waitlist/*

import { escHtml } from '../lib/esc.js';
import {
  BENEFITS, CLAIM_DAYS, DISCOUNT_PCT, GRACE_DAYS, LAUNCH_PLACES, TOTAL_PLACES, VARIANTS, WAITLIST_PLACES,
} from '../lib/founding.js';

/** 1000 -> '1,000' (deterministic: never the host locale). */
const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const META = Object.freeze({
  path: '/waitlist/',
  title: 'Founding members',
  description: `${fmtInt(TOTAL_PLACES)} founding places. ${DISCOUNT_PCT}% off every subscription payment while you `
    + 'subscribe, double Credits, first look at new features and priority support.',
});

const LEDE = `${fmtInt(TOTAL_PLACES)} places. ${DISCOUNT_PCT}% off your plan's price at every payment, for as long as `
  + 'you subscribe — plus double Credits, first look at new features and priority support.';

const FULL_LINE = `All ${fmtInt(WAITLIST_PLACES)} waitlist places are taken. Join anyway and we'll email your invite `
  + `when it's ready — with a head start on one of the ${fmtInt(LAUNCH_PLACES)} launch places.`;

const STEPS = Object.freeze([
  ['Join the waitlist.', `The first ${fmtInt(WAITLIST_PLACES)} people reserve a founding place.`],
  ['Claim it at launch.', `We'll email your invite. Start any paid plan within ${CLAIM_DAYS} days of it and the place `
    + 'is yours. Places not claimed in time go to the earliest-paying subscribers without a place.'],
  ['Keep it while you subscribe.', `If your subscription lapses, you have ${GRACE_DAYS} days to come back and keep `
    + 'everything. After that, the place passes to the next member in line.'],
]);

const QUESTIONS = Object.freeze([
  ['When does Bet Gaffer launch?',
    "Invites go out in batches. Join the waitlist and we'll email you when yours is ready."],
  [`What if I miss the ${CLAIM_DAYS} days?`,
    'Your waitlist place goes to the earliest-paying subscriber without a place. If launch places are still open '
    + "when you subscribe, you'll get one of those."],
  ['Does the free account or a free trial count?',
    'No. Founding status starts with your first paid subscription. A first payment that is refunded or reversed '
    + "doesn't count."],
  ['Can I give my place to someone else?',
    "No. Founding places are personal and can't be transferred or exchanged for anything. Claiming a place needs a "
    + 'verified phone number — one place per number.'],
  [`Does the ${DISCOUNT_PCT}% combine with other discounts?`,
    'No. If another percentage discount applies, you get whichever saves you more.'],
  ['What if I cancel?',
    `You have ${GRACE_DAYS} days after your last paid period ends to subscribe again and keep everything. After that, `
    + 'the place passes to the next member in line.'],
]);

const hasPct = (s) => /%/.test(s);
/** data-figure="offer" on any element whose copy prints a percentage. */
const offerAttr = (...copy) => (copy.some(hasPct) ? ' data-figure="offer"' : '');

function benefitCard(b) {
  return `<li class="bg-fd__benefit" data-benefit="${escHtml(b.id)}"${offerAttr(b.title, b.text)}>
<h3 class="bg-fd__benefit-h">${escHtml(b.title)}</h3>
<p class="bg-fd__benefit-t">${escHtml(b.text)}</p>
</li>`;
}

function step([title, text]) {
  return `<li class="bg-fd__step">
<h3 class="bg-fd__step-h">${escHtml(title)}</h3>
<p class="bg-fd__step-t">${escHtml(text)}</p>
</li>`;
}

function question([q, a]) {
  const summary = hasPct(q) ? `<span data-figure="offer">${escHtml(q)}</span>` : escHtml(q);
  return `<details class="bg-fd__q">
<summary class="bg-fd__q-s">${summary}</summary>
<p class="bg-fd__q-a">${escHtml(a)}</p>
</details>`;
}

/**
 * The /waitlist/ body: the seven sections of spec §3, in order.
 * @param {object} cfg  the site config (unused today; kept for the content-module interface)
 * @param {{ waitlistHtml: string }} o  the waitlist form (trusted HTML from waitlistForm())
 */
export function render(cfg, { waitlistHtml } = {}) {
  if (typeof waitlistHtml !== 'string' || !/<form\b[^>]*\bdata-waitlist[\s>]/.test(waitlistHtml)) {
    throw new TypeError('waitlist: render needs { waitlistHtml } — the waitlist form from waitlistForm()');
  }
  return `<article class="bg-fd">
<header class="bg-fd__hero">
<p class="t-lbl">Founding members</p>
<h1 class="t-d1 bg-fd__title">Become a founding member</h1>
<p class="bg-fd__lede" data-figure="offer">${escHtml(LEDE)}</p>
</header>
<section class="bg-fd__counts" aria-labelledby="fd-counts-h">
<h2 class="vh" id="fd-counts-h">Founding places</h2>
<div class="bg-fd__tile bg-fd__tile--waitlist">
<p class="t-lbl t-lbl--quiet">Waitlist places</p>
<p class="bg-fd__count mono" data-waitlist-places>${escHtml(`${fmtInt(WAITLIST_PLACES)} places`)}</p>
<p class="bg-fd__tile-note">${escHtml(`for the first ${fmtInt(WAITLIST_PLACES)} people to join the waitlist.`)}</p>
</div>
<div class="bg-fd__tile">
<p class="t-lbl t-lbl--quiet">Launch places</p>
<p class="bg-fd__count mono">${escHtml(`${fmtInt(LAUNCH_PLACES)} places`)}</p>
<p class="bg-fd__tile-note">for the first people to subscribe at launch.</p>
</div>
</section>
<section class="bg-fd__join" aria-labelledby="fd-join-h">
<h2 class="vh" id="fd-join-h">Join the founding waitlist</h2>
<p class="bg-fd__full" data-waitlist-full hidden>${escHtml(FULL_LINE)}</p>
${waitlistHtml}
</section>
<section class="bg-fd__sec" aria-labelledby="fd-benefits-h">
<h2 class="t-d2" id="fd-benefits-h">What founding members get</h2>
<ul class="bg-fd__benefits" role="list">
${BENEFITS.map(benefitCard).join('\n')}
</ul>
</section>
<section class="bg-fd__sec" aria-labelledby="fd-how-h">
<h2 class="t-d2" id="fd-how-h">How it works</h2>
<ol class="bg-fd__steps" role="list">
${STEPS.map(step).join('\n')}
</ol>
</section>
<section class="bg-fd__sec" aria-labelledby="fd-faq-h">
<h2 class="t-d2" id="fd-faq-h">Questions</h2>
<div class="bg-fd__faq">
${QUESTIONS.map(question).join('\n')}
</div>
</section>
<p class="bg-fd__rules"><a href="/terms/#founding">Read the full programme rules</a></p>
</article>`;
}

/** One copy segment as HTML: a key word is strong.fd-hl; a segment printing a % sits in an offer figure. */
function segmentHtml({ t, hl, offer }) {
  const fig = offer ? ' data-figure="offer"' : '';
  if (hl) return `<strong class="fd-hl"${fig}>${escHtml(t)}</strong>`;
  return offer ? `<span${fig}>${escHtml(t)}</span>` : escHtml(t);
}

/**
 * The founding card (spec §16.5): one per page, directly under the header, on every page except
 * /waitlist/* (layout.page() places it). `variantIndex` picks the copy from VARIANTS; banner.js swaps
 * in another variant per page view (the same nodes, built with DOM APIs) and shows the close button,
 * which ships hidden: without JS the card shows and cannot be closed. data-banner / data-banner-close
 * are the hooks banner.js and balloon.js find it by. No heading element: on most pages it comes
 * before the page's <h1>.
 */
export function foundingCard(variantIndex) {
  if (!Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= VARIANTS.length) {
    throw new RangeError(`foundingCard: variantIndex must be an integer 0-${VARIANTS.length - 1}, got ${String(variantIndex)}`);
  }
  const v = VARIANTS[variantIndex];
  return `<aside class="bg-wrap bg-fd-slot" aria-label="Founding members" data-banner data-variant="${variantIndex}">
<div class="bg-fd-card">
<div class="bg-fd-card__body">
<p class="bg-fd-card__title" data-fd-heading>${v.heading.map(segmentHtml).join('')}</p>
<p class="bg-fd-card__line" data-fd-line>${v.line.map(segmentHtml).join('')}</p>
</div>
<a class="bg-btn bg-btn--primary bg-fd-card__cta" href="/waitlist/">See the founding benefits</a>
<button type="button" class="bg-fd-card__x" data-banner-close aria-label="Hide the founding card" hidden>×</button>
</div>
</aside>`;
}
