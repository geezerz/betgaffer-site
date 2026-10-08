// Features page (spec §8, Plan A Task 6; charter v6). BUILD ONLY.
//
// Seventeen features, simplest to most advanced, each stated as the problem it answers and then what
// Bet Gaffer does about it, with a status tag: "At launch" (built on the platform today) or "Coming
// soon". Copy is verbatim from spec §8 as amended. Features left off on purpose: see spec §8.
//
// Interface:
//   render(cfg)  this page carries no form: it links to /waitlist/, where the founding waitlist form is.
//   cfg.breadth = { markets, competitions, fixtures, day } from the home day file, or absent. Only
//     `markets` is printed (feature #5, "up to N per match"); the whole shape is still validated so a
//     malformed day file fails the build instead of printing nonsense. Absent or an empty day: no number.
//   cfg.pricing.show_prices (S9) swaps the "prices later" sentence for the tier table.

import { escHtml } from '../lib/esc.js';
import { isDate } from '../lib/time.js';
import { SUMMARY, TOTAL_PLACES } from '../lib/founding.js';
import { POSITIONING, identityCard, lastUpdated, operatorOf } from './common.js';

export const LAST_UPDATED = '2026-10-08';

export const META = Object.freeze({
  path: '/features/',
  title: 'Features',
  description: 'What Bet Gaffer does, from the simplest tool to the most advanced: every match by kickoff, one '
    + 'recommended pick per fixture, probabilities for every market we price, the Lab and Credits, and how the plans are priced.',
});

export const INTRO = "Bet Gaffer is football match intelligence for sport investors. Here's what it does, from the "
  + 'simplest tool to the most advanced.';

export const PRICING_INTENT = 'Nothing is sold on this site. At launch Bet Gaffer will offer a free account and paid '
  + 'monthly plans priced in naira, VAT-inclusive, billed through Paystack.';
export const PRICES_LATER = 'Prices will be published here before any payment is taken.';

const NAIRA = String.fromCharCode(0x20a6);
const AT_LAUNCH = 'At launch';
const COMING_SOON = 'Coming soon';

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** 1146 -> '1,146' (deterministic; no locale data). */
function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Markets per fixture from cfg.breadth, or null when absent or the day is empty (nothing claimed).
 * Throws on a malformed breadth object.
 */
function marketsOf(breadth) {
  if (breadth === undefined || breadth === null) return null;
  if (typeof breadth !== 'object' || Array.isArray(breadth)) {
    throw new TypeError('features: cfg.breadth must be { markets, competitions, fixtures, day } or absent');
  }
  const { markets, competitions, fixtures, day } = breadth;
  for (const [k, v] of Object.entries({ markets, competitions, fixtures })) {
    if (!isCount(v)) throw new TypeError(`features: cfg.breadth.${k} must be a non-negative integer, got ${JSON.stringify(v)}`);
  }
  if (!isDate(day)) throw new TypeError(`features: cfg.breadth.day must be a real YYYY-MM-DD date, got ${JSON.stringify(day)}`);
  if (fixtures === 0 || competitions === 0 || markets === 0) return null; // an empty day claims no breadth
  return markets;
}

/** Spec §8, in order. `answer` for #5 is filled in from cfg.breadth. */
function featureList(markets) {
  const priced = markets === null
    ? 'Our probability for every market we price.'
    : `Our probability for every market we price — up to ${fmtInt(markets)} per match.`;
  return [
    ['Every match, by kickoff', 'A Saturday can bring more than 1,500 matches spread across apps and sites.',
      'One list of every fixture in the competitions we cover, in Lagos time, with Live, Next 3 hours and Finished views.'],
    ['Search and league filters', 'Scrolling through hundreds of games to find yours wastes time.',
      'Find a team or league in seconds, or show only the leagues you follow.'],
    ['Live scores and match clock', 'Switching apps to check whether a match is still on.',
      'Live scores and the match clock right on the fixture.'],
    ['One recommended pick per fixture', 'There are dozens of markets on every match — too many choices.',
      'We highlight one recommended pick for each fixture, with its probability and price.'],
    ['Probabilities for every market', 'Bookmaker odds tell you the price, not the chance.', priced],
    ['Clearly marked prices', "You can't always tell where a price came from.",
      'When no bookmaker price was captured, ours is clearly marked as an estimate.'],
    ['Match centre', 'Research means opening five tabs.',
      'Head-to-head, standings, stats, lineups and commentary in one place.'],
    ['Early results', 'Waiting for full time to know if a pick landed.',
      "See a pick land the moment it's decided — an over-goals line passed, or a first-half market at half time."],
    ["Today's accuracy ring", 'No quick way to see how today is going.',
      "A ring that shows today's settled picks at a glance."],
    ['Our Record', 'Anyone can claim a big number.',
      'Every recommended pick is graded and kept, misses alongside hits.'],
    ['Power Teams', 'Too much noise when you only follow the big clubs.',
      'One tap narrows the day to the major clubs we track most closely. Elite plan.'],
    ['Ready-made slips', 'No time to build a slip every day.',
      "Ready-made slips every day, for when you'd rather not build your own."],
    ['Same-game slips', 'Combining markets from one match ignores how they affect each other.',
      'Slips that combine several markets from one match, with the link between them taken into account.'],
    ['My Bets', 'Slips scattered across screenshots and notes.',
      'Every slip you build on Bet Gaffer, tracked in one place until it settles.'],
    ['The Lab', 'Building a multi-leg slip by hand is slow and guesswork.',
      'Assemble a multi-leg slip from our priced markets, see which leg is weakest, and change one leg.'],
    ['Credits', 'Paying for a whole plan when you only want one thing.',
      'Pay with Credits only for the actions you use — and get Credits back when a Lab slip you marked as played loses.'],
    ['Ask Gaffer', 'Wanting a second opinion before you place a ticket.',
      'Ask in plain language and get the reasoning behind a pick.', COMING_SOON],
  ].map(([name, problem, answer, tag = AT_LAUNCH]) => ({ name, problem, answer, tag }));
}

function featureCard({ name, problem, answer, tag }, i) {
  const soon = tag !== AT_LAUNCH;
  const id = `ct-f${i + 1}`;
  return `<li class="ct-ladder__step">
<article class="ct-feature${soon ? ' ct-feature--soon' : ''}" aria-labelledby="${id}">
<div class="ct-feature__head">
<p class="ct-feature__n mono" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>
<h3 class="ct-feature__name" id="${id}">${escHtml(name)}</h3>
<p class="ct-feature__tag${soon ? ' ct-feature__tag--soon' : ''}">${escHtml(tag)}</p>
</div>
<p class="ct-feature__problem"><span class="ct-feature__lbl">The problem:</span> ${escHtml(problem)}</p>
<p class="ct-feature__answer"><span class="ct-feature__lbl">What we do:</span> ${escHtml(answer)}</p>
</article>
</li>`;
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
<p class="t-s">Monthly, in naira, VAT-inclusive. Paid plans differ by the competitions and tools they include.</p>`;
}

/**
 * @param {object} cfg  site config (+ optional cfg.breadth); cfg.operator must be complete (S8)
 * @returns {string} body fragment for /features/
 */
export function render(cfg) {
  const op = operatorOf(cfg);
  const pricing = cfg.pricing && typeof cfg.pricing === 'object' ? cfg.pricing : {};
  const ladder = featureList(marketsOf(cfg.breadth)).map(featureCard).join('\n');

  const pricingBody = pricing.show_prices === true
    ? `<p>${escHtml(PRICING_INTENT)}</p>\n${tierTable(pricing.tiers)}`
    : `<p>${escHtml(PRICING_INTENT)} ${escHtml(PRICES_LATER)}</p>`;

  return `<article class="ct-doc ct-features">
<header class="ct-hero">
<p class="t-lbl">Features</p>
<h1 class="t-d1">What Bet Gaffer does</h1>
${lastUpdated(LAST_UPDATED)}
<p class="ct-lead">${escHtml(INTRO)}</p>
<p class="ct-pos">${escHtml(POSITIONING)}</p>
</header>
<section class="ct-fsec" aria-labelledby="ct-feats-h">
<h2 class="vh" id="ct-feats-h">The features, simplest first</h2>
<ol class="ct-ladder" role="list">
${ladder}
</ol>
</section>
<section class="ct-fsec ct-pricing" aria-labelledby="ct-pricing-h">
<h2 class="t-d2" id="ct-pricing-h">Pricing</h2>
${pricingBody}
<p class="t-s">See the <a href="/refunds/">refund and cancellation policy</a> and the <a href="/terms/">terms</a>.</p>
</section>
<section class="ct-fsec ct-founding" aria-labelledby="ct-founding-h">
<h2 class="t-d2" id="ct-founding-h">Be one of ${escHtml(fmtInt(TOTAL_PLACES))} founding members</h2>
<p class="ct-founding__sum" data-figure="offer">${escHtml(SUMMARY)}</p>
<div class="ct-founding__cta"><a class="bg-btn bg-btn--primary" href="/waitlist/">Join the founding waitlist</a></div>
</section>
${identityCard(op)}
</article>`;
}
