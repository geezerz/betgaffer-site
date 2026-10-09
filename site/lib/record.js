// The /our-record/ page body, stated plainly (spec §7, Plan A Task 5; charter triple). BUILD ONLY.
//
// Input is the ALLOWLISTED `record` from validateIndex() (site/lib/data.js), so shapes are trusted;
// every value from it is still escaped on the way out. The data contract still carries the selection
// rule, coverage and ledger statuses; this page no longer prints them. Claim-safety markup (the
// tests/html-scan.js scanner):
//   - the 30-day headline is ONE element with data-claim="headline" holding its "X of Y" fraction (the
//     count line) and a data-claim-part="period" line (in its header row);
//   - every strip day and every month row is an element with data-figure="record-row" (plus
//     data-period) whose visible text carries its "n of m" fraction and its period (a strip day by
//     its full date, e.g. "Wed 7 Oct 2026");
//   - no figure ever prints as a bare 100%: a perfect window, day or month shows its fraction and no
//     percentage; a non-perfect one that rounded up is shown as 99.99%.
// Green figures (spec §17.5): every right count and every percentage carries .rec-won (bold, --won);
// a total ("of Y") never does.
// Status: only the current Lagos month says "In progress" (whatever the ledger says); today's strip
// day is tagged for stale.js, which labels it "Today · so far" on the visitor's day only. One footer
// line says recent figures can still move while late results are checked.
// Copy: "right", never "win rate"; no ROI, profit, yield, staking or bankroll anywhere.

import { escHtml, escAttr } from './esc.js';
import { isDate, isIsoZ, fmtDayLong, fmtStamp } from './time.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// ------------------------------------------------------------------ numbers

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

/** A won/graded grain that settled every graded pick: never printed as a percentage. */
const isPerfect = (g) => g.graded > 0 && g.won === g.graded;
/** Nothing settled in the grain. */
const isEmpty = (g) => g.graded === 0 || g.pct === null;

/** '2026-10' -> 'October 2026'; anything else is shown as given (escaped by the caller). */
function monthName(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const i = m ? Number(m[2]) - 1 : -1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : period;
}

/** '2026-09-08..2026-10-07' -> '8 Sep – 7 Oct 2026' (the start's year only when it differs). */
function periodHtml(period) {
  const [a, b] = period.split('..');
  const from = fmtDayLong(a).slice(4); // '8 Sep 2026'
  const to = fmtDayLong(b).slice(4);
  const fromShown = a.slice(0, 4) === b.slice(0, 4) ? from.slice(0, -5) : from;
  return `<time datetime="${escAttr(a)}">${escHtml(fromShown)}</time> – <time datetime="${escAttr(b)}">${escHtml(to)}</time>`;
}

// ------------------------------------------------------------------ headline

function headline(rec) {
  const g = rec.last_30;
  let body;
  if (isEmpty(g)) {
    body = '<p class="rec-hero rec-hero--empty">No picks settled in the last 30 days yet.</p>';
  } else {
    // Spec §17.5, top to bottom: the percentage (the hero), the count it comes from, one caption.
    // A perfect window never prints 100%: its hero says so in words.
    const won = int(g.won);
    const graded = int(g.graded);
    const hero = isPerfect(g)
      ? '<p class="rec-hero rec-hero--words rec-won" data-figure="record-pct">Every pick right</p>'
      : `<p class="rec-hero rec-won" data-figure="record-pct">${escHtml(pct2(shownPct(g)))}</p>`;
    body = `${hero}
<p class="rec-count"><strong class="rec-won">${won}</strong> of ${graded} picks right</p>
<p class="rec-hero__cap">Our recommended picks were right ${won} times out of ${graded}.</p>`;
  }
  return `<section class="rec-head" data-claim="headline" aria-labelledby="rec-head-h">
<div class="rec-head__top">
<h2 class="rec-head__h" id="rec-head-h">Last 30 days</h2>
<p class="rec-head__period" data-claim-part="period">${periodHtml(g.period)}</p>
</div>
${body}
</section>
<p class="rec-under t-s">${escHtml("Picks that ended level (a push) or void aren't counted.")}</p>`;
}

// ------------------------------------------------------------------ strip

function stripFigure(g) {
  if (isEmpty(g)) return '<p class="rec-day__none">No picks settled</p>';
  const frac = `<p class="rec-day__frac"><strong class="rec-won mono">${int(g.won)}</strong> of <span class="mono">${int(g.graded)}</span> right</p>`;
  if (isPerfect(g)) return frac;
  return `${frac}\n<p class="rec-day__pct rec-won mono">${escHtml(pct2(shownPct(g)))}</p>`;
}

function stripDay(g, { today, listed }) {
  // Static text is true whenever it is read: no label. stale.js says "Today · so far" on the
  // visitor's day only, and hides the label again once that day is past.
  const rel = g.period === today
    ? `\n<p class="rec-day__rel" data-rel-day="${escAttr(g.period)}" data-rel="record" hidden></p>`
    : '';
  const inner = `<p class="rec-day__date"><time datetime="${escAttr(g.period)}">${escHtml(fmtDayLong(g.period))}</time></p>
${stripFigure(g)}${rel}`;
  const body = listed.has(g.period)
    ? `<a class="rec-day__link" href="/day/${escAttr(g.period)}/">${inner}<span class="vh"> — open this day's card</span></a>`
    : `<div class="rec-day__in">${inner}</div>`;
  return `<li class="rec-day" data-figure="record-row" data-period="${escAttr(g.period)}">${body}</li>`;
}

// The heading and the column count follow the data: last_7 (spec §17.5) or the legacy last_6.
const STRIP_HEADING = { 7: 'The last seven days', 6: 'The last six days' };

function strip(rec, opts) {
  const n = rec.recent.length;
  const heading = STRIP_HEADING[n];
  if (heading === undefined) throw new TypeError(`renderRecord: record.recent must hold 6 or 7 days, got ${n}`);
  return `<section class="rec-sec" aria-labelledby="rec-strip-h">
<h2 class="t-h" id="rec-strip-h">${heading}</h2>
<p class="t-s rec-sec__lede">Daily volume swings with the fixture calendar, so read each day with its count.</p>
<ol class="rec-strip rec-strip--${n}" role="list">
${rec.recent.map((g) => stripDay(g, opts)).join('\n')}
</ol>
</section>`;
}

// ------------------------------------------------------------------ months

function monthRow(g, currentMonth) {
  // Only the current Lagos month is still moving; the ledger's own status is not printed.
  const chip = g.period === currentMonth ? ' <span class="bg-chip bg-chip--open rec-chip">In progress</span>' : '';
  // Every cell says what happened: an empty month is one "No picks settled" cell across both
  // columns; a perfect month says "Every pick right" instead of a percentage (no bare 100%).
  const cells = isEmpty(g)
    ? '<td class="num" colspan="2" data-label="Right">No picks settled</td>'
    : `<td class="num" data-label="Right"><span><strong class="rec-won">${int(g.won)}</strong> of ${int(g.graded)} right</span></td>
<td class="num" data-label="Accuracy"><strong class="rec-won">${isPerfect(g) ? 'Every pick right' : escHtml(pct2(shownPct(g)))}</strong></td>`;
  return `<tr data-figure="record-row" data-period="${escAttr(g.period)}">
<th scope="row"><span class="rec-month">${escHtml(monthName(g.period))}</span>${chip}</th>
${cells}
</tr>`;
}

function months(rec, today) {
  const head = `<h2 class="t-h" id="rec-months-h">Month by month</h2>`;
  if (rec.months.length === 0) {
    return `<section class="rec-sec" aria-labelledby="rec-months-h">
${head}
<div class="bg-empty"><p>No month has a settled pick yet.</p></div>
</section>`;
  }
  const currentMonth = today.slice(0, 7);
  return `<section class="rec-sec" aria-labelledby="rec-months-h">
${head}
<div class="bg-card rec-months-card">
<table class="bg-table rec-months">
<thead><tr><th scope="col">Month</th><th scope="col" class="num">Right</th><th scope="col" class="num">Accuracy</th></tr></thead>
<tbody>
${rec.months.map((g) => monthRow(g, currentMonth)).join('\n')}
</tbody>
</table>
</div>
</section>`;
}

// ------------------------------------------------------------------ page

function intro() {
  return `<header class="rec-intro">
<h1 class="t-d1">Our record</h1>
<p class="t-b rec-intro__lede">${escHtml("We recommend at most one pick per fixture, made before kickoff and graded after full time. Here's how they've done.")}</p>
</header>`;
}

function footnotes(rec, listed) {
  // months[] is newest first, but take the minimum by value rather than trust the order.
  const oldestMonth = rec.months.reduce((m, g) => (m === null || g.period < m ? g.period : m), null);
  const starts = oldestMonth === null ? '' : `<li>${escHtml(`Record starts ${monthName(oldestMonth)}.`)}</li>\n`;
  const updated = rec.as_of === null ? '' : `<li>${escHtml(`Updated ${fmtStamp(rec.as_of)}.`)}</li>\n`;
  // The ledger can still move recent figures as late results settle (spec §7).
  const recent = '<li>Recent figures can change slightly while late results are checked.</li>\n';
  // The commitment is dated from the oldest listed day (the ledger figures reach further back);
  // with no day listed there is no date to state, so the line is omitted (spec §10).
  const oldestDay = [...listed].sort()[0];
  const frozen = oldestDay === undefined
    ? ''
    : `<li>${escHtml(`From ${fmtDayLong(oldestDay)}, each day's card is frozen before its matches kick off.`)}</li>\n`;
  return `<ul class="rec-foot t-s" role="list">
${starts}${updated}${recent}${frozen}</ul>`;
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
 * @param {string} opts.today   the index's Lagos 'YYYY-MM-DD' today: tags that strip day for the
 *   "Today · so far" relabel, and its month is the one month marked "In progress"
 * @param {Set<string>|Map|string[]} opts.days  REQUIRED: dates listed in index.days ([] when none) —
 *   strip days link to /day/<d>/ only when listed; the oldest dates the frozen-card footnote
 */
export function renderRecord(record, { today, days } = {}) {
  if (!isDate(today)) throw new TypeError(`renderRecord: today must be a real YYYY-MM-DD date, got ${String(today)}`);
  const listed = toSet(days);

  if (record === null) {
    return `${intro()}
<div class="bg-empty rec-empty">
<h2>No record yet</h2>
<p>The first card publishes the evening before match day. Its picks are graded after full time, and the record starts here.</p>
<div class="bg-empty__row"><a class="bg-btn bg-btn--ghost" href="/">See the predictions</a></div>
</div>`;
  }
  if (record.as_of !== null && !isIsoZ(record.as_of)) throw new TypeError('renderRecord: record.as_of must be ISO-Z or null');

  return `${intro()}
${headline(record)}
${strip(record, { today, listed })}
${months(record, today)}
${footnotes(record, listed)}`;
}
