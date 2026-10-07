// Features page (spec §4 /features, §4.2, §4.4; plan S9, S15; charter v6). BUILD ONLY.
//
// Sold on time and friction only: no accuracy, value or outcome claim on any feature. Launch
// features use the charter's approved descriptions (Ask Gaffer explains the reasoning; the Lab
// assembles and stress-tests multi-leg slips, including which legs to drop; Steam Alerts are real
// odds-movement alerts). Booking codes, Exposure, Daily Slips and the Green Month Guarantee are NOT
// described: none is publishable today.
//
// Interface (Task 6 wires it):
//   render(cfg, { waitlistHtml })
//   cfg.breadth = { markets, competitions, fixtures, day } from the home day file, or absent.
//     Breadth figures are never hardcoded; when absent (or the day is empty) nothing is claimed.
//   cfg.pricing.show_prices (S9) swaps the "prices later" sentence for the tier table.
//   waitlistHtml (Task 7's waitlistForm()) is trusted HTML, placed verbatim under "Founding waitlist".

import { REPO_RE } from '../config.js';
import { escAttr, escHtml } from '../lib/esc.js';
import { fmtDayLong, isDate } from '../lib/time.js';
import { POSITIONING, identityCard, lastUpdated, operatorOf } from './common.js';

export const LAST_UPDATED = '2026-10-07';

export const META = Object.freeze({
  path: '/features/',
  title: 'Features',
  description: 'What Bet Gaffer does today: every fixture of the day in the competitions we cover, one pick per '
    + 'fixture with its probability, and a public graded record. What comes at full launch, and how it will be priced.',
});

export const PRICING_INTENT = 'Nothing is sold on this site. At launch Bet Gaffer will offer a free account and paid '
  + 'monthly plans priced in naira, VAT-inclusive, billed through Paystack.';
export const PRICES_LATER = 'Prices will be published here before any payment is taken.';

const NAIRA = String.fromCharCode(0x20a6);

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** 1146 -> '1,146' (deterministic; no locale data). */
function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const plural = (n, one, many) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function breadthBlock(breadth) {
  if (breadth === undefined || breadth === null) return '';
  if (typeof breadth !== 'object' || Array.isArray(breadth)) {
    throw new TypeError('features: cfg.breadth must be { markets, competitions, fixtures, day } or absent');
  }
  const { markets, competitions, fixtures, day } = breadth;
  for (const [k, v] of Object.entries({ markets, competitions, fixtures })) {
    if (!isCount(v)) throw new TypeError(`features: cfg.breadth.${k} must be a non-negative integer, got ${JSON.stringify(v)}`);
  }
  if (!isDate(day)) throw new TypeError(`features: cfg.breadth.day must be a real YYYY-MM-DD date, got ${JSON.stringify(day)}`);
  if (fixtures === 0 || competitions === 0 || markets === 0) return ''; // an empty day claims no breadth
  return `<p class="ct-breadth">On the card for ${escHtml(fmtDayLong(day))}: `
    + `<strong class="mono">${escHtml(plural(fixtures, 'fixture', 'fixtures'))}</strong> in `
    + `<strong class="mono">${escHtml(plural(competitions, 'competition', 'competitions'))}</strong>, with up to `
    + `<strong class="mono">${escHtml(plural(markets, 'market', 'markets'))}</strong> priced per fixture.</p>`;
}

function tierTable(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) throw new TypeError('features: cfg.pricing.tiers must be a non-empty array');
  const rows = tiers.map((t, i) => {
    if (!t || typeof t.name !== 'string' || t.name.trim() === '' || !isCount(t.monthly)) {
      throw new TypeError(`features: cfg.pricing.tiers[${i}] must be { name, monthly (whole naira >= 0) }`);
    }
    return `<tr><th scope="row">${escHtml(t.name)}</th><td class="num" data-label="Monthly">${NAIRA}${escHtml(fmtInt(t.monthly))}</td></tr>`;
  }).join('');
  return `<table class="bg-table ct-tiers">
<caption class="vh">Planned monthly prices, in naira, VAT-inclusive</caption>
<thead><tr><th scope="col">Plan</th><th scope="col" class="num">Monthly</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="t-s">Monthly, in naira, VAT-inclusive. Nothing is charged on this site.</p>`;
}

const card = (n, title, body, extra = '') => `<li class="ct-feat${extra}">
${n ? `<p class="ct-feat__n mono" aria-hidden="true">${n}</p>
` : ''}<h3 class="t-h">${title}</h3>
${body}
</li>`;

/**
 * @param {object} cfg  site config (+ optional cfg.breadth); cfg.operator must be complete (S8)
 * @param {object} [opts]
 * @param {string} [opts.waitlistHtml]  trusted HTML from Task 7; the section is omitted when absent
 * @returns {string} body fragment for /features/
 */
export function render(cfg, { waitlistHtml } = {}) {
  const op = operatorOf(cfg);
  if (waitlistHtml !== undefined && typeof waitlistHtml !== 'string') {
    throw new TypeError('features: opts.waitlistHtml must be an HTML string');
  }
  if (typeof cfg.repo !== 'string' || !REPO_RE.test(cfg.repo)) {
    throw new TypeError(`features: cfg.repo must be "owner/name", got ${JSON.stringify(cfg.repo)}`);
  }
  const pricing = cfg.pricing && typeof cfg.pricing === 'object' ? cfg.pricing : {};
  const repoUrl = `https://github.com/${cfg.repo}`;

  const now = [
    card('01', 'One pick per fixture',
      '<p>At most one pick per fixture, chosen from a priced set of markets, with its probability beside it. One line to read per match instead of a page of markets. A fixture first seen too close to kickoff gets no pick.</p>'),
    card('02', 'The whole day in one place',
      '<p>We list every fixture of the day in the competitions we cover, grouped by competition, with kickoff in Lagos time. No scrolling through channels to find out who plays tonight.</p>'),
    card('03', 'Probabilities, stated as estimates',
      '<p>Every probability is an estimate, and some picks will lose. They stay on the page at the same size as the rest.</p>'),
    card('04', 'A public, graded record',
      '<p>Every pick is graded against the real result once the match is settled. <a href="/our-record/">Our Record</a> shows each figure with its sample size and the period it covers.</p>'),
    card('05', 'Receipts you can check',
      `<p>Every published card is a commit in a <a href="${escAttr(repoUrl)}" rel="noopener">public repository</a>. Each pick carries the time it was frozen, so you can check when it was published against kickoff.</p>`),
  ].join('\n');

  const soon = [
    card(null, 'Ask Gaffer',
      '<p>Gaffer explains the reasoning behind a probability, so you are not left guessing why a number is what it is.</p>', ' ct-feat--soon'),
    card(null, 'The Lab',
      '<p>Bring the slip you are about to send. The Lab lets you assemble and stress-test multi-leg slips, including telling you which legs to drop.</p>', ' ct-feat--soon'),
    card(null, 'Steam Alerts',
      '<p>Steam Alerts are real odds-movement alerts: you hear when a price moves, instead of refreshing all afternoon.</p>', ' ct-feat--soon'),
  ].join('\n');

  const pricingBody = pricing.show_prices === true
    ? `<p>${escHtml(PRICING_INTENT)}</p>\n${tierTable(pricing.tiers)}`
    : `<p>${escHtml(PRICING_INTENT)} ${escHtml(PRICES_LATER)}</p>`;

  const waitlist = waitlistHtml === undefined ? '' : `<section class="ct-fsec ct-waitlist" aria-labelledby="ct-waitlist-h">
<h2 class="t-d2" id="ct-waitlist-h">Founding waitlist</h2>
${waitlistHtml}
</section>`;

  return `<article class="ct-doc ct-features">
<header class="ct-hero">
<p class="t-lbl">Features</p>
<h1 class="t-d1">The day's football on one page, and a record you can check.</h1>
${lastUpdated(LAST_UPDATED)}
<p class="ct-lead">Bet Gaffer saves you the scrolling: the day's fixtures, one pick each with its probability, and every result kept where you can see it.</p>
<p class="ct-pos">${escHtml(POSITIONING)}</p>
${breadthBlock(cfg.breadth)}
</header>
<section class="ct-fsec" aria-labelledby="ct-now-h">
<h2 class="t-d2" id="ct-now-h">On this site today</h2>
<ul class="ct-feats" role="list">
${now}
</ul>
</section>
<section class="ct-fsec" aria-labelledby="ct-soon-h">
<div class="ct-fsec__head"><h2 class="t-d2" id="ct-soon-h">Coming at full launch</h2><span class="bg-chip">Not on this site yet</span></div>
<ul class="ct-feats ct-feats--soon" role="list">
${soon}
</ul>
</section>
<section class="ct-fsec ct-pricing" aria-labelledby="ct-pricing-h">
<h2 class="t-d2" id="ct-pricing-h">Pricing</h2>
${pricingBody}
<p class="t-s">See the <a href="/refunds/">refund and cancellation policy</a> and the <a href="/terms/">terms</a>.</p>
</section>
${waitlist}
${identityCard(op)}
</article>`;
}
