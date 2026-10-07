// The /our-record/ page body (spec §3, §4, D5, D12; charter triple). BUILD ONLY.
//
// Input is the ALLOWLISTED `record` from validateIndex() (site/lib/data.js), so shapes are trusted;
// every string from it is still escaped on the way out. Claim-safety markup (Task 6 scanner):
//   - the 30-day headline is ONE element with data-claim="headline" holding data-claim-part="band",
//     "coverage", "period", "status" and "ci";
//   - every strip day and every month row is an element with data-figure="record-row" (plus
//     data-period) whose visible text carries its "n of m" fraction and its period;
//   - no figure ever prints as a bare 100%: a perfect day/month shows its fraction and "settled so
//     far" with no percentage; a perfect headline adds "so far" and the "stated at" probability
//     floor; a complete coverage reads "every one of"; a near-complete one is capped at 99.9%.
// Copy: "landed"/"accuracy", never "win rate"; the band is a selection RULE, not prices achieved;
// no ROI, profit, yield, staking or bankroll anywhere (spec §4.4).

import { escHtml, escAttr } from './esc.js';
import { isDate, isIsoZ, fmtDayLong, fmtStamp } from './time.js';
import siteConfig from '../config.js';

const Z95 = 1.959964;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Ledger status -> page word and chip modifier. Unknown statuses render escaped, never dropped. */
const STATUS = {
  live: { word: 'In progress', chip: 'bg-chip--open' },
  provisional: { word: 'Provisional', chip: '' },
  confirmed: { word: 'Confirmed', chip: 'rec-chip--confirmed' },
  republish_pending: { word: 'Being recomputed', chip: 'bg-chip--open' },
};
// Headline status order: the least settled first, so "provisional" is never buried.
const STATUS_ORDER = ['provisional', 'republish_pending', 'live', 'confirmed'];

// ------------------------------------------------------------------ numbers

/**
 * Wilson score 95% interval for `won` successes in `graded` trials, as percentages rounded to two
 * decimals: { low, high }. `graded === 0` -> null (no interval without a denominator).
 */
export function wilson(won, graded) {
  if (!Number.isInteger(won) || !Number.isInteger(graded) || won < 0 || graded < 0 || won > graded) {
    throw new RangeError(`wilson: need integers 0 <= won <= graded, got ${String(won)} of ${String(graded)}`);
  }
  if (graded === 0) return null;
  const n = graded;
  const p = won / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const r2 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 10000) / 100;
  return { low: r2(centre - half), high: r2(centre + half) };
}

/** 12154 -> '12,154' (no locale lookup: the build host's ICU must not change the page). */
function int(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
const pct2 = (v) => `${v.toFixed(2)}%`;
/**
 * A grain's published pct for display. Only a perfect grain may reach 100, and it is never printed
 * as a percentage (see isPerfect); a non-perfect one that rounded up is shown as 99.99%.
 */
const shownPct = (g) => (g.won < g.graded && g.pct > 99.99 ? 99.99 : g.pct);
/** A probability (0..1) as a percentage, at most one decimal, trailing zero dropped: 0.8 -> '80%'. */
const probPct = (p) => `${String(Math.round(p * 1000) / 10)}%`;

/** Day-month-year without the weekday: '2026-10-07' -> '7 Oct 2026'. */
function fmtDate(d) {
  return fmtDayLong(d).slice(4);
}
function daysInclusive(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}
function monthName(period) {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** A won/graded grain that settled every graded pick: never printed as a percentage. */
const isPerfect = (g) => g.graded > 0 && g.won === g.graded;

function statusOf(s) {
  if (s !== null && Object.prototype.hasOwnProperty.call(STATUS, s)) return STATUS[s];
  return { word: s, chip: '' };
}
function chip(s) {
  const st = statusOf(s);
  return `<span class="bg-chip rec-chip${st.chip ? ` ${st.chip}` : ''}">${escHtml(st.word)}</span>`;
}

// ------------------------------------------------------------------ headline

/**
 * The selection rule, branched on the fallback mode, so it never states a floor the picks did not
 * have (the card's pick reader's fallback pool; the publisher sets fallback_min_probability for
 * probability_range only):
 *   hide              -> no fallback: the card floor is the whole rule
 *   probability_range -> a fixture with no ELIGIBLE market at the card floor may take one at the
 *                        fallback floor
 *   best_allowlist,
 *   confidence_any    -> such a fixture takes its most likely eligible market, with NO floor
 * "Eligible": the fallback fires when no market passes ALL the primary checks (floor, allowlist,
 * settleability, odds band, disagreement veto), not merely when none reaches the floor.
 * The odds band (when on) applies to every path, primary and fallback: the pick reader's odds check
 * reads the latest captured price, else a price estimated from the model probability (which always
 * exists), so no pick escapes the band for want of a captured price.
 * Returns { rule, perfect } where `perfect` is the "stated at" clause for a window whose every
 * graded pick landed. Unknown mode -> throw.
 */
function selectionRule(sel) {
  const card = probPct(sel.card_min_probability);
  let rule;
  let perfect;
  switch (sel.fallback) {
    case 'hide':
      rule = `Picks need a model probability of at least ${card}.`;
      perfect = `each stated at a model probability of at least ${card}`;
      break;
    case 'probability_range': {
      const fb = sel.fallback_min_probability;
      if (fb === null) throw new TypeError('renderRecord: fallback "probability_range" needs selection.fallback_min_probability');
      if (fb >= sel.card_min_probability) {
        rule = `Picks need a model probability of at least ${card}.`;
        perfect = `each stated at a model probability of at least ${card}`;
      } else {
        const low = probPct(fb);
        rule = `Picks need a model probability of at least ${card}, or at least ${low} for a fixture where no eligible market reaches ${card}.`;
        perfect = `each stated at a model probability of at least ${low}`;
      }
      break;
    }
    case 'best_allowlist':
    case 'confidence_any':
      rule = `Picks need a model probability of at least ${card}; where no eligible market reaches ${card}, the fixture's most likely eligible market is picked.`;
      perfect = `each stated at a model probability of at least ${card}, or as its fixture's most likely eligible market where no eligible market reached ${card}`;
      break;
    default:
      throw new TypeError(`renderRecord: unknown selection.fallback ${JSON.stringify(sel.fallback)}`);
  }
  if (sel.odds_filter && sel.min_odds !== null && sel.max_odds !== null) {
    rule += ` Every pick's price must fall between ${sel.min_odds.toFixed(2)} and ${sel.max_odds.toFixed(2)}: `
      + 'the latest captured market price, or, where none was captured, a price estimated from the model probability.';
  }
  return { rule, perfect };
}

/** Coverage as a percentage, never rounded up to 100.0% (only equal integers say "all"). */
const coveragePct = (g) => Math.min(Math.round(g.coverage * 1000) / 10, 99.9).toFixed(1);

function coverageText(g) {
  if (g.finished_fixtures === 0 || g.coverage === null) return 'No finished fixtures in this period yet.';
  if (g.graded === g.finished_fixtures) {
    return `Every one of the period's ${int(g.finished_fixtures)} finished fixtures carried a graded pick.`;
  }
  if (g.graded > g.finished_fixtures) {
    return `${int(g.graded)} graded picks across the period's ${int(g.finished_fixtures)} finished fixtures.`;
  }
  return `${coveragePct(g)}% of the period's ${int(g.finished_fixtures)} finished fixtures carried a graded pick.`;
}

/** Coverage for a month cell: '90.1% of 2,596 finished' / 'all 11 finished' / both counts. */
function coverageCell(g) {
  if (g.finished_fixtures === 0 || g.coverage === null) return 'no finished fixtures';
  if (g.graded === g.finished_fixtures) return `all ${int(g.finished_fixtures)} finished`;
  if (g.graded > g.finished_fixtures) return `${int(g.graded)} graded, ${int(g.finished_fixtures)} finished`;
  return `${coveragePct(g)}% of ${int(g.finished_fixtures)} finished`;
}

/** '23 of 30 days provisional, 7 of 30 days in progress[, N not yet reported]' over the period's days. */
function statusText(statusDays, periodDays) {
  const entries = Object.entries(statusDays).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total > periodDays) {
    throw new TypeError(`renderRecord: last_30.status_days counts ${total} days but the period has ${periodDays}`);
  }
  const rank = (k) => {
    const i = STATUS_ORDER.indexOf(k);
    return i < 0 ? STATUS_ORDER.length : i;
  };
  entries.sort((a, b) => rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1));
  const parts = entries.map(([k, n]) => `${int(n)} of ${int(periodDays)} days ${statusOf(k).word.toLowerCase()}`);
  const missing = periodDays - total;
  if (missing > 0) parts.push(total === 0 ? `${int(missing)} of ${int(periodDays)} days not yet reported` : `${int(missing)} not yet reported`);
  return parts.join(', ');
}

function periodHtml(period) {
  const [a, b] = period.split('..');
  const n = daysInclusive(a, b);
  return `<time datetime="${escAttr(a)}">${escHtml(fmtDate(a))}</time> – `
    + `<time datetime="${escAttr(b)}">${escHtml(fmtDate(b))}</time> `
    + `<span class="rec-muted">(${int(n)} ${n === 1 ? 'day' : 'days'})</span>`;
}

/**
 * A proportion meter: track = graded, fill = won, a lighter band = the 95% interval. SVG
 * presentation attributes only (the CSP forbids style=). Decorative: the text says it all.
 */
function meter(pct, ci) {
  const x = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const band = ci
    ? `<rect class="rec-meter__ci" x="${x(ci.low)}" y="0" width="${x(Math.max(ci.high - ci.low, 0.4))}" height="6"/>`
    : '';
  return `<svg class="rec-meter" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
    + `<rect class="rec-meter__track" x="0" y="0" width="100" height="6"/>`
    + `<rect class="rec-meter__fill" x="0" y="0" width="${x(pct)}" height="6"/>${band}</svg>`;
}

function headline(rec) {
  const g = rec.last_30;
  const sel = rec.selection;
  const rule = selectionRule(sel);
  const ci = wilson(g.won, g.graded);
  // A non-perfect interval never displays 100.00% (its true upper bound is below 1).
  if (ci && g.won < g.graded && ci.high > 99.99) ci.high = 99.99;
  const perfect = isPerfect(g);
  const [from, to] = g.period.split('..');
  const status = statusText(g.status_days, daysInclusive(from, to));
  const earlierRule = from < sel.effective_since_date
    ? ` The current rule applies from ${fmtDayLong(sel.effective_since_date)}; earlier days in this window were picked under a previous rule.`
    : '';

  let hero;
  if (g.pct === null || g.graded === 0) {
    hero = `<p class="rec-hero rec-hero--empty">No graded picks in this window yet</p>
<p class="rec-hero__cap">Card picks are graded after full time; the first results land here.</p>`;
  } else if (perfect) {
    hero = `<p class="rec-hero"><span class="mono rec-hero__won">${int(g.won)}</span> <span class="rec-hero__of">of</span> <span class="mono">${int(g.graded)}</span></p>
<p class="rec-hero__cap">graded card picks landed — all landed so far, ${escHtml(rule.perfect)}</p>`;
  } else {
    hero = `<p class="rec-hero"><span class="mono rec-hero__won">${int(g.won)}</span> <span class="rec-hero__of">of</span> <span class="mono">${int(g.graded)}</span></p>
<p class="rec-hero__cap">graded card picks landed</p>
<div class="rec-pct"><span class="mono rec-pct__v">${escHtml(pct2(shownPct(g)))}</span>${meter(shownPct(g), ci)}</div>`;
  }

  const ciText = ci
    ? `95% confidence interval <span class="mono">${escHtml(pct2(ci.low))}–${escHtml(pct2(ci.high))}</span>`
    : 'No confidence interval until picks in this window are graded.';

  return `<section class="rec-head" data-claim="headline" aria-labelledby="rec-head-h">
<h2 class="rec-head__h" id="rec-head-h">Last 30 days</h2>
<div class="rec-head__main">
${hero}
</div>
<dl class="rec-facts">
<div class="rec-fact"><dt>Period</dt><dd data-claim-part="period">${periodHtml(g.period)}</dd></div>
<div class="rec-fact"><dt>Selection rule</dt><dd data-claim-part="band">${escHtml(rule.rule + earlierRule)}</dd></div>
<div class="rec-fact"><dt>Coverage</dt><dd data-claim-part="coverage">${escHtml(coverageText(g))}</dd></div>
<div class="rec-fact"><dt>Uncertainty</dt><dd data-claim-part="ci">${ciText}</dd></div>
<div class="rec-fact"><dt>Status</dt><dd data-claim-part="status">${escHtml(`${status}.`)}</dd></div>
</dl>
</section>`;
}

function pushesLine(n) {
  if (n === 0) return 'No pushes in this window.';
  return n === 1 ? '1 push in this window is not counted.' : `${int(n)} pushes in this window are not counted.`;
}

// ------------------------------------------------------------------ strip

function stripFigure(g) {
  if (g.graded === 0 || g.pct === null) {
    return `<p class="rec-day__none">${g.status === null ? 'No graded picks' : 'No graded picks yet'}</p>`;
  }
  const frac = `<p class="rec-day__frac mono">${int(g.won)} <span class="rec-day__of">of</span> ${int(g.graded)}</p>`;
  if (isPerfect(g)) return `${frac}\n<p class="rec-day__pct">all landed so far</p>`;
  return `${frac}\n<p class="rec-day__pct mono">${escHtml(pct2(shownPct(g)))}</p>`;
}

function stripDay(g, { today, listed }) {
  const isToday = g.period === today;
  const state = isToday
    // Static text is true whenever it is read; stale.js says "Today (in progress)" on the visitor's day.
    ? `<span class="bg-chip bg-chip--open rec-chip" data-rel-day="${escAttr(g.period)}" data-rel="record">In progress</span>`
    : g.status === null ? '' : chip(g.status);
  const inner = `<p class="rec-day__date"><time datetime="${escAttr(g.period)}">${escHtml(fmtDayLong(g.period))}</time></p>
${stripFigure(g)}
${state ? `<p class="rec-day__state">${state}</p>` : ''}`;
  const body = listed.has(g.period)
    ? `<a class="rec-day__link" href="/day/${escAttr(g.period)}/">${inner}<span class="vh"> — open this day's card</span></a>`
    : `<div class="rec-day__in">${inner}</div>`;
  return `<li class="rec-day${isToday ? ' rec-day--today' : ''}" data-figure="record-row" data-period="${escAttr(g.period)}">${body}</li>`;
}

function strip(rec, opts) {
  return `<section class="rec-sec" aria-labelledby="rec-strip-h">
<h2 class="t-h" id="rec-strip-h">The last six days</h2>
<p class="t-s rec-sec__lede">Daily volume swings with the fixture calendar, so read each day with its count.</p>
<ol class="rec-strip" role="list">
${rec.last_6.map((g) => stripDay(g, opts)).join('\n')}
</ol>
</section>`;
}

// ------------------------------------------------------------------ months

function monthRow(g, sel) {
  const earlier = `${g.period}-01` < sel.effective_since_date;
  const note = earlier
    ? `<span class="rec-note">Includes days before the current selection rule took effect on ${escHtml(fmtDayLong(sel.effective_since_date))}</span>`
    : '';
  let frac;
  let pct;
  if (g.graded === 0 || g.pct === null) {
    frac = 'no graded picks';
    pct = '<span class="rec-muted">no graded picks</span>';
  } else {
    frac = `${int(g.won)} of ${int(g.graded)}`;
    pct = isPerfect(g) ? 'all landed so far' : escHtml(pct2(shownPct(g)));
  }
  return `<tr data-figure="record-row" data-period="${escAttr(g.period)}">
<th scope="row"><span class="rec-month">${escHtml(monthName(g.period))}</span>${note}</th>
<td class="num" data-label="Landed">${escHtml(frac)}</td>
<td class="num" data-label="Accuracy">${pct}</td>
<td class="num" data-label="Coverage">${escHtml(coverageCell(g))}</td>
<td data-label="Status">${chip(g.status)}</td>
</tr>`;
}

function months(rec) {
  const head = `<h2 class="t-h" id="rec-months-h">Month by month</h2>`;
  if (rec.months.length === 0) {
    return `<section class="rec-sec" aria-labelledby="rec-months-h">
${head}
<div class="bg-empty"><p>No month has a graded pick yet.</p></div>
</section>`;
  }
  return `<section class="rec-sec" aria-labelledby="rec-months-h">
${head}
<div class="bg-card rec-months-card">
<table class="bg-table rec-months">
<thead><tr><th scope="col">Month</th><th scope="col" class="num">Landed</th><th scope="col" class="num">Accuracy</th><th scope="col" class="num">Coverage</th><th scope="col">Status</th></tr></thead>
<tbody>
${rec.months.map((g) => monthRow(g, rec.selection)).join('\n')}
</tbody>
</table>
</div>
</section>`;
}

// ------------------------------------------------------------------ page

function intro() {
  return `<header class="rec-intro">
<h1 class="t-d1">Our record</h1>
<p class="t-b rec-intro__lede">One recommended pick per fixture, made before kickoff and graded after full time. Every figure below carries its count and its period.</p>
</header>`;
}

function footnotes(rec, repo, listed) {
  const url = `https://github.com/${repo}`;
  // months[] is newest first, but take the minimum by value rather than trust the order.
  const oldestMonth = rec.months.reduce((m, g) => (m === null || g.period < m ? g.period : m), null);
  const begins = oldestMonth === null
    ? ''
    : `<li>Record begins ${escHtml(monthName(oldestMonth))} — earlier months were not predicted before kickoff and are not published.</li>\n`;
  const asOf = rec.as_of === null ? '' : `<li>Figures as of ${escHtml(fmtStamp(rec.as_of))}.</li>\n`;
  // The repository holds only the listed days; the ledger figures reach further back.
  const oldestDay = [...listed].sort()[0];
  const commit = oldestDay === undefined
    ? 'Each day\'s card is committed'
    : `From ${fmtDayLong(oldestDay)}, each day's card is committed`;
  return `<ul class="rec-foot t-s" role="list">
${begins}${asOf}<li>${escHtml(commit)} to a public repository before its matches kick off — each row carries its freeze time, and a fixture first seen less than 10 minutes before kickoff carries no pick. The figures above come from the accuracy ledger and include days before the repository began. <a href="${escAttr(url)}">${escHtml(`github.com/${repo}`)}</a></li>
</ul>`;
}

/** opts.days -> Set of listed dates. Required: a forgotten list would silently unlink every day. */
function toSet(days) {
  let set;
  if (days instanceof Map) set = new Set(days.keys());
  else if (days instanceof Set || Array.isArray(days)) set = new Set(days);
  else throw new TypeError('renderRecord: opts.days must be a Set, Map or array of the YYYY-MM-DD dates index.days lists');
  for (const d of set) {
    if (!isDate(d)) throw new TypeError(`renderRecord: opts.days holds a non-date ${JSON.stringify(d)}`);
  }
  return set;
}

/**
 * The /our-record/ body fragment.
 *
 * @param {object|null} record  `validateIndex(...).record`, or null before the first publish (S7)
 * @param {object} opts
 * @param {string} opts.today   the index's Lagos 'YYYY-MM-DD' today (labels the strip's in-progress day)
 * @param {Set<string>|Map|string[]} opts.days  REQUIRED: dates listed in index.days ([] when none) —
 *   strip days link to /day/<d>/ only when listed; the oldest dates the repository footnote
 * @param {string} [opts.repo]  'owner/name' of the public receipts repo (default config.repo)
 */
export function renderRecord(record, { today, days, repo = siteConfig.repo } = {}) {
  if (!isDate(today)) throw new TypeError(`renderRecord: today must be a real YYYY-MM-DD date, got ${String(today)}`);
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new TypeError(`renderRecord: repo must be "owner/name", got ${JSON.stringify(repo)}`);
  }
  const listed = toSet(days);

  if (record === null) {
    return `${intro()}
<div class="bg-empty rec-empty">
<h2>No record yet</h2>
<p>The first card publishes the evening before match day. Its picks are graded after full time, and the record starts here.</p>
<div class="bg-empty__row"><a class="bg-btn bg-btn--ghost" href="/">See the predictions</a></div>
</div>`;
  }
  // The stated rule describes the edge_reliability reader only. Under any other strategy (e.g.
  // probability_range, which ignores the card floor and the fallback mode) every sentence of it
  // would be false, so refuse to render rather than publish it.
  if (record.strategy !== 'edge_reliability') {
    throw new TypeError(`renderRecord: record.strategy ${JSON.stringify(record.strategy)} is not edge_reliability; the selection rule this page states would be false`);
  }
  if (record.as_of !== null && !isIsoZ(record.as_of)) throw new TypeError('renderRecord: record.as_of must be ISO-Z or null');

  return `${intro()}
${headline(record)}
<div class="rec-scope t-s">
<p>${escHtml(record.scope)}</p>
<p>${escHtml(pushesLine(record.last_30.pushes))}</p>
</div>
${strip(record, { today, listed })}
${months(record)}
${footnotes(record, repo, listed)}`;
}
