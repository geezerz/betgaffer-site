// Features page (teaser copy spec 2026-11-12, section A, Legal-cleared). BUILD ONLY.
//
// Twelve rows, each stated as the problem it answers and then what BetGaffer does, with a label on
// the row: "At launch" (nothing on the platform is public yet) or "Live now" (the blog). Then
// "What's coming". Row "Results by day" is left out until its fix merges (Legal's condition).
//
// Interface:
//   render(cfg)  this page carries no form: it links to /waitlist/, where the founding waitlist form is.
//   cfg.blog (bool)  the blog row and its /blog/ link appear only while the blog is published (it gates itself).
//   cfg.pricing.show_prices (S9) swaps the "prices later" sentence for the tier table.

import { escHtml, escAttr } from '../lib/esc.js';
import { fmtInt } from '../lib/num.js';
import { SUMMARY, TOTAL_PLACES } from '../lib/founding.js';
import { identityCard, lastUpdated, operatorOf } from './common.js';

// The date the copy was last checked against the platform; the byline prints it.
export const CHECKED = '2026-11-12';

export const META = Object.freeze({
  path: '/features/',
  title: 'Features',
  fullTitle: 'Features | BetGaffer',
  description: 'What BetGaffer will do at launch: our probabilities for the markets your plan covers, a recommended '
    + 'pick where we have one, graded in public, misses included.',
});

export const H1 = 'What BetGaffer will do';
export const INTRO = [
  'BetGaffer is a sports prediction platform. We cover football today, and other sports will follow.',
  "We're not a bookmaker: we take no bets and never hold your stake.",
  "BetGaffer opens at launch. Here's what it will do.",
];

export const PRICING_INTENT = 'Nothing is sold on this site. At launch Bet Gaffer will offer a free account and paid '
  + 'monthly plans priced in naira, VAT-inclusive, billed through Paystack.';
export const PRICES_LATER = 'Prices will be published here before any payment is taken.';

const NAIRA = String.fromCharCode(0x20a6);
const AT_LAUNCH = 'At launch';
const LIVE_NOW = 'Live now';

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

// [name, problem, what we do, label, href]. Only the blog row links: the app pages are not on the teaser.
export const ROWS = [
  ['Predictions', "Bookmaker odds show a price, with the bookmaker's margin built in.",
    "The day's fixtures, with our probabilities for the markets your plan covers."],
  ['One recommended pick', "Every match has dozens of markets, and that's too many choices.",
    "On a match where we recommend a pick, it's one pick for that match: the outcome our model rates best."],
  ['Match pages', 'Checking one match means jumping between apps.',
    'One page per match, with all the markets your plan covers for it.'],
  ['League, team and country pages', 'Finding out how a team has really been playing takes digging.',
    "Country: every competition we cover there, plus its national side and today's fixtures. League: the table, "
    + "trends in context, today's fixtures and the cups those clubs play. Team: form and tendencies first, then "
    + 'fixtures. Guests see fixtures, results and form tiles only; our statistics, charts and rating are for '
    + 'members whose plan covers that league.'],
  ['National team pages', 'National sides play rarely, so their form is hard to follow.',
    "A page for each national side we cover: men's, women's and youth."],
  ['Coverage', "It isn't always clear which leagues a service covers.",
    'Which leagues each plan covers, grouped by country.'],
  ['Daily Slips', 'Building a slip from scratch takes time.',
    "Ready-made slips, from lower to higher odds, built from our model's picks."],
  ['Ask Gaffer', 'A slip can look strong and still hide a weak leg.',
    'Gaffer is our AI football assistant. Bring your slip, and Gaffer finds the weak legs. Gaffer comes with some plans.'],
  ['Our Record', 'Anyone can claim a big number.',
    'Every recommended pick is graded in public after full time, misses included, month by month.'],
  ['Credits', "Some features you'll only want now and then.",
    'Monthly Credits on plans that include them, and top-ups on any plan.'],
  ['Breaks and limits', 'Betting should stay fun, and sometimes that means a break.',
    'Profile, billing, notifications, limits on buying Credits, and Breaks & limits: email us to take a break '
    + '(self-exclusion) and we set it up. When it ends, you ask for your access back, and it returns 24 hours later.'],
  ['Blog and Learn', 'Words like 1UP or GG on a slip can be confusing.',
    'Plain guides to how bets work and settle.', LIVE_NOW, '/blog/'],
].map(([name, problem, answer, tag = AT_LAUNCH, href]) => ({ name, problem, answer, tag, href }));

export const COMING_H2 = "What's coming";
export const COMING = [
  ['The Lab', 'Building a ticket to a target takes ages.',
    "Coming at launch: the Lab, where you'll be able to set your stake and Gaffer will build a ticket from our "
    + "model's rated picks, to your rules."],
  ['Power Picks', null,
    'Coming soon: Power Picks, our recommended picks on the matches we single out, on the plans that include them.'],
  ['Booking codes', 'Typing a ticket in leg by leg is slow.',
    "We're working to let you turn a ticket into a SportyBet booking code, where SportyBet offers its markets."],
].map(([name, problem, answer]) => ({ name, problem, answer }));

const problemP = (t) => (t === null ? ''
  : `\n<p class="ct-feature__problem"><span class="ct-feature__lbl">The problem:</span> ${escHtml(t)}</p>`);
const answerP = (t) => `\n<p class="ct-feature__answer"><span class="ct-feature__lbl">What we do:</span> ${escHtml(t)}</p>`;

function featureCard({ name, problem, answer, tag, href }, i) {
  const id = `ct-f${i + 1}`;
  const title = href ? `<a href="${escAttr(href)}">${escHtml(name)}</a>` : escHtml(name);
  return `<li class="ct-ladder__step">
<article class="ct-feature" aria-labelledby="${id}">
<div class="ct-feature__head">
<p class="ct-feature__n mono" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>
<h3 class="ct-feature__name" id="${id}">${title}</h3>
<p class="ct-feature__tag">${escHtml(tag)}</p>
</div>${problemP(problem)}${answerP(answer)}
</article>
</li>`;
}

function comingCard({ name, problem, answer }, i) {
  const id = `ct-c${i + 1}`;
  return `<li class="ct-ladder__step">
<article class="ct-feature ct-feature--soon" aria-labelledby="${id}">
<div class="ct-feature__head">
<h3 class="ct-feature__name" id="${id}">${escHtml(name)}</h3>
</div>${problemP(problem)}${answerP(answer)}
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
 * @param {object} cfg  site config; cfg.operator must be complete (S8)
 * @returns {string} body fragment for /features/
 */
export function render(cfg) {
  const op = operatorOf(cfg);
  const pricing = cfg.pricing && typeof cfg.pricing === 'object' ? cfg.pricing : {};
  const ladder = ROWS.filter((r) => !r.href || cfg.blog === true).map(featureCard).join('\n');
  const coming = COMING.map(comingCard).join('\n');

  const pricingBody = pricing.show_prices === true
    ? `<p>${escHtml(PRICING_INTENT)}</p>\n${tierTable(pricing.tiers)}`
    : `<p>${escHtml(PRICING_INTENT)} ${escHtml(PRICES_LATER)}</p>`;

  return `<article class="ct-doc ct-features">
<header class="ct-hero">
<p class="t-lbl">Features</p>
<h1 class="t-d1">${escHtml(H1)}</h1>
${lastUpdated(CHECKED, 'Checked')}
${INTRO.map((t) => `<p class="ct-lead">${escHtml(t)}</p>`).join('\n')}
</header>
<section class="ct-fsec" aria-labelledby="ct-feats-h">
<h2 class="vh" id="ct-feats-h">The features</h2>
<ol class="ct-ladder" role="list">
${ladder}
</ol>
</section>
<section class="ct-fsec" aria-labelledby="ct-coming-h">
<h2 class="t-d2" id="ct-coming-h">${escHtml(COMING_H2)}</h2>
<ol class="ct-ladder" role="list">
${coming}
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
