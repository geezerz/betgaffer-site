import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateIndex } from '../site/lib/data.js';
import { renderRecord } from '../site/lib/record.js';
import { fmtDayLong } from '../site/lib/time.js';
import { claimViolations } from './html-scan.js';
import { toLast7 } from './site-fixtures.js';

// Our Record, stated plainly (Plan A Task 5, spec §7).

// The private platform's name, built from char codes so the literal never appears in this repo.
const INTERNAL = String.fromCharCode(70, 111, 114, 101, 99, 97, 120, 116);
const ART = fileURLToPath(new URL('./fixtures/artifact/', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RAW = JSON.parse(readFileSync(join(ART, 'index.json'), 'utf8'));
const INDEX = validateIndex(RAW);
const REC = INDEX.record;
const DAYS = new Set(INDEX.days.map((d) => d.day)); // 2026-10-07, 2026-10-08
const OPTS = { today: '2026-10-07', days: DAYS };
const clone = (o) => structuredClone(o);

/** The record after a mutation, re-validated so every test input is one the build could pass. */
function rec(mutate) {
  const raw = clone(RAW);
  mutate(raw.record);
  return validateIndex(raw).record;
}
/** The same, with the record carrying last_7 (spec §17.5) instead of the legacy last_6. */
const rec7 = (mutate = () => {}) => rec((x) => { toLast7(x); mutate(x); });
const REC7 = rec7();
/** 12154 -> '12,154', independent of the renderer's own formatter. */
const fmt = (n) => n.toLocaleString('en-US');
/** A published pct as the page prints it. */
const pctText = (v) => `${v.toFixed(2)}%`;
const isPerfectG = (g) => g.graded > 0 && g.won === g.graded;
const isEmptyG = (g) => g.graded === 0 || g.pct === null;

/** Visible text of an HTML fragment (tags dropped, entities for the five escaped chars decoded). */
function text(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:])/g, '$1')
    .trim();
}

/**
 * The outer HTML of the first element carrying `attr` (e.g. 'data-claim="headline"'), found by
 * balancing open/close tags of the same name. Enough for this renderer's well-formed output.
 */
function elementWith(html, attr, from = 0) {
  const at = html.indexOf(attr, from);
  if (at < 0) return null;
  const start = html.lastIndexOf('<', at);
  const name = /^<([a-z0-9]+)/i.exec(html.slice(start))[1];
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { html: html.slice(start, re.lastIndex), end: re.lastIndex };
  }
  throw new Error(`unbalanced <${name}> at ${start}`);
}
function allWith(html, attr) {
  const out = [];
  for (let el, from = 0; (el = elementWith(html, attr, from)); from = el.end) out.push(el.html);
  return out;
}
const count = (hay, needle) => hay.split(needle).length - 1;
const stripOf = (html) => elementWith(html, 'class="rec-strip ').html;
const stripRows = (html) => allWith(stripOf(html), 'data-figure="record-row"');
const monthRows = (html) => allWith(elementWith(html, 'class="bg-table rec-months"').html, 'data-figure="record-row"');
const headOf = (html) => elementWith(html, 'data-claim="headline"').html;
const PERFECT_30 = { won: 12, lost: 0, pushes: 0, graded: 12, pct: 100, finished_fixtures: 14, coverage: 0.8571 };
const STATUS_WORDS = /in progress|provisional|confirmed|being recomputed|republish|\blive\b|not yet reported/i;

// ---------------------------------------------------------------------------------------------
// Intro and headline
// ---------------------------------------------------------------------------------------------

test('intro: the spec §7 sentence, picks "made before kickoff"', () => {
  const t = text(renderRecord(REC, OPTS));
  assert.ok(t.includes("We recommend at most one pick per fixture, made before kickoff and graded after full time. Here's how they've done."), t.slice(0, 300));
  assert.doesNotMatch(t, /published before kickoff/);
});

test('headline (spec §17.5): header row (title + period) -> the percentage hero -> "won of graded picks right" -> one caption without the %', () => {
  const html = renderRecord(REC, OPTS);
  assert.equal(count(html, 'data-claim="headline"'), 1, 'exactly one headline block');
  const head = headOf(html);
  const g = REC.last_30;
  const won = fmt(g.won);
  const graded = fmt(g.graded);
  const pct = pctText(g.pct);
  const period = text(elementWith(head, 'data-claim-part="period"').html);
  // The header row holds the title AND the period, in one element, at the top of the card.
  const top = elementWith(head, 'class="rec-head__top"');
  assert.ok(top, 'a header row');
  assert.ok(top.html.includes('id="rec-head-h"') && top.html.includes('data-claim-part="period"'), top.html);
  assert.equal(text(top.html), `Last 30 days ${period}`);
  // The hero is the percentage, alone, in the green figure class.
  const hero = elementWith(head, 'data-figure="record-pct"');
  assert.ok(hero, 'a hero percentage element');
  assert.equal(text(hero.html), pct);
  assert.match(hero.html, /^<p class="rec-hero rec-won"/);
  // Count line: the won count green, the total not.
  const countLine = elementWith(head, 'class="rec-count"');
  assert.equal(text(countLine.html), `${won} of ${graded} picks right`);
  assert.ok(countLine.html.includes(`<strong class="rec-won">${won}</strong> of ${graded} picks right`), countLine.html);
  // One caption sentence, no percentage.
  const cap = elementWith(head, 'class="rec-hero__cap"');
  assert.equal(text(cap.html), `Our recommended picks were right ${won} times out of ${graded}.`);
  assert.doesNotMatch(text(cap.html), /%/);
  // Order inside the card: header row, hero, count line, caption; nothing after the caption.
  const at = (h) => head.indexOf(h);
  assert.ok(at(top.html) < at(hero.html) && at(hero.html) < at(countLine.html) && at(countLine.html) < at(cap.html), 'order');
  assert.match(head.slice(at(cap.html) + cap.html.length), /^\s*<\/section>$/, 'the period no longer sits at the bottom');
  assert.equal(text(head), `Last 30 days ${period} ${pct} ${won} of ${graded} picks right Our recommended picks were right ${won} times out of ${graded}.`);
});

test('headline: the period line reads "8 Sep – 7 Oct 2026" and is the only claim part', () => {
  const head = headOf(renderRecord(REC, OPTS));
  const parts = [...head.matchAll(/data-claim-part="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(parts, ['period']);
  const period = elementWith(head, 'data-claim-part="period"').html;
  assert.match(period, /datetime="2026-09-08"/);
  assert.match(period, /datetime="2026-10-07"/);
  assert.equal(text(period), '8 Sep – 7 Oct 2026');
});

test('headline: a period across a year end states both years', () => {
  const r = rec((x) => { x.last_30.period = '2026-12-20..2027-01-18'; });
  assert.equal(text(elementWith(headOf(renderRecord(r, OPTS)), 'data-claim-part="period"').html), '20 Dec 2026 – 18 Jan 2027');
});

test('headline: null pct reads "No picks settled in the last 30 days yet." and never 0% / NaN', () => {
  const r = rec((x) => {
    Object.assign(x.last_30, { won: 0, lost: 0, pushes: 0, graded: 0, pct: null, finished_fixtures: 0, coverage: null, status_days: [] });
  });
  const head = headOf(renderRecord(r, OPTS));
  const t = text(head);
  assert.ok(t.includes('No picks settled in the last 30 days yet.'), t);
  assert.doesNotMatch(t, /%|NaN|undefined|null|0 of 0|times out of/);
  assert.ok(head.includes('data-claim-part="period"'), 'the period still shows');
});

test('headline: a perfect window\'s hero reads "Every pick right", the count line stays, no percentage at all', () => {
  const r = rec((x) => Object.assign(x.last_30, PERFECT_30));
  const head = headOf(renderRecord(r, OPTS));
  const t = text(head);
  const n = fmt(PERFECT_30.won);
  const hero = elementWith(head, 'data-figure="record-pct"').html;
  assert.equal(text(hero), 'Every pick right');
  assert.match(hero, /^<p class="rec-hero rec-hero--words rec-won"/);
  assert.equal(text(elementWith(head, 'class="rec-count"').html), `${n} of ${n} picks right`);
  assert.ok(t.includes(`Our recommended picks were right ${n} times out of ${n}.`), t);
  assert.doesNotMatch(t, /%/);
});

test('headline: a non-perfect window that rounds to 100 shows 99.99%, never 100.00%', () => {
  const r = rec((x) => {
    Object.assign(x.last_30, { won: 29999, lost: 1, graded: 30000, pct: 100, finished_fixtures: 30000, coverage: 1 });
    Object.assign(x.last_6[1], { won: 29999, lost: 1, graded: 30000, pct: 100, finished_fixtures: 30000, coverage: 1 });
    Object.assign(x.months[0], { won: 29999, lost: 1, graded: 30000, pct: 100, finished_fixtures: 30000, coverage: 1 });
  });
  const html = renderRecord(r, OPTS);
  assert.doesNotMatch(text(html), /100(\.0+)?%/);
  assert.equal(text(elementWith(headOf(html), 'data-figure="record-pct"').html), '99.99%');
  assert.ok(text(headOf(html)).includes('29,999 of 30,000 picks right Our recommended picks were right 29,999 times out of 30,000.'));
  assert.match(text(stripRows(html)[1]), /29,999 of 30,000 right 99\.99%/);
  assert.match(text(monthRows(html)[0]), /29,999 of 30,000 right 99\.99%/);
});

test('removed: no coverage, confidence, status, selection rule, uncertainty or price band in the visible text', () => {
  // Every ledger status and selection mode the data contract still carries, so nothing is hidden by luck.
  const variants = [
    REC,
    rec((x) => { x.selection.fallback_min_probability = 0.7; x.selection.effective_since_date = '2026-10-01'; }),
    rec((x) => { x.selection.fallback = 'best_allowlist'; x.selection.fallback_min_probability = null; }),
    rec((x) => { x.last_6[1].status = 'confirmed'; x.months[1].status = 'republish_pending'; x.months[2].status = 'confirmed'; }),
    rec((x) => Object.assign(x.last_30, PERFECT_30)),
  ];
  for (const r of variants) {
    const t = text(renderRecord(r, OPTS)).toLowerCase();
    for (const w of ['coverage', 'confidence', 'provisional', 'selection rule', 'probability of at least', 'status',
      'uncertainty', 'price between', 'finished fixtures', 'previous rule', 'stated at', 'landed', 'interval']) {
      assert.ok(!t.includes(w), `"${w}" in the record's visible text`);
    }
  }
});

test('strategy: the page states no selection rule, so any strategy renders', () => {
  const r = rec((x) => { x.strategy = 'probability_range'; });
  const t = text(renderRecord(r, OPTS));
  assert.ok(t.includes(`${pctText(REC.last_30.pct)} ${fmt(REC.last_30.won)} of ${fmt(REC.last_30.graded)} picks right`), t);
  assert.doesNotMatch(t, /probability_range|edge_reliability/);
});

// ---------------------------------------------------------------------------------------------
// Under the card: pushes and voids, once
// ---------------------------------------------------------------------------------------------

test('under the card: one line for pushes and voids; the ledger scope string is not printed', () => {
  const html = renderRecord(REC, OPTS);
  const t = text(html);
  assert.equal(count(t, "Picks that ended level (a push) or void aren't counted."), 1);
  assert.equal(count(t.toLowerCase(), 'level (a push) or void'), 1);
  assert.ok(!t.includes(REC.scope), 'the ledger scope is internal wording');
  assert.doesNotMatch(t, /pushes? in this window|ledger|excluded from the percentage/i);
  // It sits right after the headline card.
  const after = html.slice(elementWith(html, 'data-claim="headline"').end).trimStart();
  assert.match(after, /^<p class="rec-under t-s">Picks that ended level \(a push\) or void aren&#39;t counted\.<\/p>/);
});

// ---------------------------------------------------------------------------------------------
// The last six days
// ---------------------------------------------------------------------------------------------

test('strip (spec §17.5): last_7 -> "The last seven days", seven cards in a 7-column strip; legacy last_6 -> "The last six days", six', () => {
  for (const [r, n, heading, other] of [[REC7, 7, 'The last seven days', 'The last six days'], [REC, 6, 'The last six days', 'The last seven days']]) {
    assert.equal(r.recent.length, n, 'premise: the record carries n days');
    const html = renderRecord(r, OPTS);
    const sec = elementWith(html, 'aria-labelledby="rec-strip-h"').html;
    assert.equal(text(elementWith(sec, 'id="rec-strip-h"').html), heading);
    assert.match(sec, new RegExp(`<ol class="rec-strip rec-strip--${n}" role="list">`));
    const rows = stripRows(html);
    assert.equal(rows.length, n);
    r.recent.forEach((d, i) => assert.ok(rows[i].includes(`data-period="${d.period}"`), `${heading}: row ${i}`));
    assert.ok(!text(html).includes(other), `${heading}: not "${other}"`);
  }
});

test('strip: record-rows, each "<full date> <won> of <graded> right <pct>%"', () => {
  const rows = stripRows(renderRecord(REC7, OPTS));
  assert.equal(rows.length, 7);
  REC7.recent.forEach((d, i) => {
    assert.ok(rows[i].includes(`data-period="${d.period}"`), `row ${i} period attribute`);
    assert.ok(rows[i].includes(`datetime="${d.period}"`), `row ${i} time element`);
    const want = `${fmtDayLong(d.period)} ${d.won.toLocaleString('en-US')} of ${d.graded.toLocaleString('en-US')} right ${d.pct.toFixed(2)}%`;
    assert.equal(text(rows[i]).replace(/ — open this day's card$/, ''), want);
  });
  assert.match(text(rows[0]), /^Wed 7 Oct 2026 8 of 9 right 88\.89%/);
});

test('strip: today is tagged for "Today · so far" (empty and hidden statically); no other day is tagged', () => {
  const rows = stripRows(renderRecord(REC, OPTS));
  assert.match(rows[0], /<p class="rec-day__rel" data-rel-day="2026-10-07" data-rel="record" hidden><\/p>/);
  for (const row of rows.slice(1)) assert.doesNotMatch(row, /data-rel=/);
  // The tag follows opts.today, not the first entry.
  const later = stripRows(renderRecord(REC, { ...OPTS, today: '2026-10-08' }));
  for (const row of later) assert.doesNotMatch(row, /data-rel=/);
});

test('strip: no status word on any day, whatever the ledger says', () => {
  const r = rec((x) => {
    x.last_6[0].status = 'live';
    x.last_6[1].status = 'provisional';
    x.last_6[2].status = 'confirmed';
    x.last_6[3].status = 'republish_pending';
    x.last_6[4].status = 'sealed_v2';
    toLast7(x);
    x.last_7[6].status = 'republish_pending';
  });
  for (const row of stripRows(renderRecord(r, OPTS))) {
    assert.doesNotMatch(text(row), STATUS_WORDS);
    assert.doesNotMatch(text(row), /sealed/);
    assert.doesNotMatch(row, /bg-chip/);
  }
});

test('strip: an empty day reads "No picks settled"; a perfect day "5 of 5 right" with no percentage', () => {
  const r = rec((x) => {
    Object.assign(x.last_6[3], { won: 0, lost: 0, pushes: 0, graded: 0, finished_fixtures: 0, pct: null, coverage: null, status: null });
    Object.assign(x.last_6[2], { won: 5, lost: 0, pushes: 0, graded: 5, finished_fixtures: 6, pct: 100, coverage: 0.8333 });
  });
  const rows = stripRows(renderRecord(r, OPTS));
  assert.equal(text(rows[3]), `${fmtDayLong(REC.recent[3].period)} No picks settled`);
  assert.equal(text(rows[2]), `${fmtDayLong(REC.recent[2].period)} 5 of 5 right`);
  assert.doesNotMatch(text(rows[2]), /%/);
});

test('strip: links only days the archive lists', () => {
  const strip = stripOf(renderRecord(REC7, OPTS));
  assert.ok(strip.includes('href="/day/2026-10-07/"'));
  const unlisted = REC7.recent.map((g) => g.period).filter((d) => !DAYS.has(d));
  assert.equal(unlisted.length, 6, 'premise: six of the seven days are not listed');
  for (const d of unlisted) {
    assert.ok(!strip.includes(`/day/${d}/`), `${d} is not listed, so it must not link`);
  }
  const strip2 = stripOf(renderRecord(REC, { ...OPTS, days: ['2026-10-06'] }));
  assert.ok(strip2.includes('href="/day/2026-10-06/"'));
  assert.ok(!strip2.includes('href="/day/2026-10-07/"'));
});

// ---------------------------------------------------------------------------------------------
// Month by month
// ---------------------------------------------------------------------------------------------

test('months: one record-row per month, newest first, "<Month YYYY> <won> of <graded> right <pct>%"', () => {
  const html = renderRecord(REC, OPTS);
  const rows = monthRows(html);
  assert.deepEqual(rows.map(text), [
    'October 2026 In progress 2,004 of 2,339 right 85.68%',
    'September 2026 10,936 of 13,190 right 82.91%',
    'August 2026 7,837 of 9,764 right 80.26%',
  ]);
  REC.months.forEach((m, i) => assert.ok(rows[i].includes(`data-period="${m.period}"`)));
  // Stacks below 640px: every data cell names its column.
  const table = elementWith(html, 'class="bg-table rec-months"').html;
  assert.equal((table.match(/<td\b/g) || []).length, (table.match(/<td\b[^>]*data-label="/g) || []).length);
});

test('"In progress" appears exactly once, on the current Lagos month, whatever the ledger status', () => {
  const page = (r, today = OPTS.today) => renderRecord(r, { ...OPTS, today });
  // Ledger: Oct live, Sep/Aug provisional.
  const t = text(page(REC));
  assert.equal(count(t, 'In progress'), 1);
  assert.match(text(monthRows(page(REC))[0]), /In progress/);
  // The ledger calls the current month confirmed and the past months live: the month decides.
  const flipped = rec((x) => { x.months[0].status = 'confirmed'; x.months[1].status = 'live'; x.months[2].status = 'republish_pending'; });
  const rows = monthRows(page(flipped));
  assert.match(text(rows[0]), /In progress/);
  for (const row of rows.slice(1)) assert.doesNotMatch(text(row), STATUS_WORDS);
  assert.equal(count(text(page(flipped)), 'In progress'), 1);
  // A month with no row of its own: no month is in progress.
  assert.equal(count(text(page(REC, '2026-11-01')), 'In progress'), 0);
  // The first of a month: that month (already listed) is the current one.
  const sep = text(monthRows(page(REC, '2026-09-30'))[1]);
  assert.match(sep, /^September 2026 In progress/);
  assert.equal(count(text(page(REC, '2026-09-30')), 'In progress'), 1);
});

test('months: a perfect month reads "Every pick right" (no %); an empty month one "No picks settled" cell; never a dash', () => {
  const r = rec((x) => {
    Object.assign(x.months[1], { won: 40, lost: 0, pushes: 0, graded: 40, pct: 100, finished_fixtures: 41, coverage: 0.9756 });
    Object.assign(x.months[2], { won: 0, lost: 0, pushes: 0, graded: 0, pct: null, finished_fixtures: 0, coverage: null });
  });
  const html = renderRecord(r, OPTS);
  const rows = monthRows(html);
  assert.equal(text(rows[1]), 'September 2026 40 of 40 right Every pick right');
  assert.ok(rows[1].includes('<td class="num" data-label="Accuracy"><strong class="rec-won">Every pick right</strong></td>'), rows[1]);
  assert.doesNotMatch(text(rows[1]), /%/);
  assert.equal(text(rows[2]), 'August 2026 No picks settled');
  assert.ok(rows[2].includes('<td class="num" colspan="2" data-label="Right">No picks settled</td>'), rows[2]);
  assert.equal(count(rows[2], '<td'), 1, 'one cell replaces both');
  assert.doesNotMatch(text(rows[2]), /%|0 of 0/);
  const table = elementWith(html, 'class="bg-table rec-months"').html;
  assert.ok(!table.includes('—'), 'no dash in the months table');
});

test('months: none yet renders an explicit empty state, not an empty table', () => {
  const r = rec((x) => { x.months = []; });
  const html = renderRecord(r, OPTS);
  assert.ok(!html.includes('<table'));
  assert.match(text(html), /No month has a settled pick yet/);
});

// ---------------------------------------------------------------------------------------------
// Footer, empty record, copy rules, escaping
// ---------------------------------------------------------------------------------------------

const footOf = (html) => /<ul class="rec-foot[^"]*"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? null;

test('footer: record start, updated stamp, the recent-figures line and the frozen-card commitment', () => {
  const foot = footOf(renderRecord(REC, OPTS));
  assert.deepEqual(allWith(foot, '<li').map(text), [
    'Record starts August 2026.',
    'Updated 7 Oct 2026, 06:05 WAT.',
    'Recent figures can change slightly while late results are checked.',
    "From Wed 7 Oct 2026, each day's card is frozen before its matches kick off.",
  ]);
  // "Record starts" follows the oldest month by value, not by order.
  const r = rec((x) => { x.months.pop(); x.months.reverse(); });
  assert.match(text(renderRecord(r, OPTS)), /Record starts September 2026\./);
  // No months: no start line. No as_of: no stamp. The recent-figures line stays.
  const bare = text(footOf(renderRecord(rec((x) => { x.months = []; x.as_of = null; }), { ...OPTS, days: [] })));
  assert.equal(bare, 'Recent figures can change slightly while late results are checked.');
});

test('footnotes (spec §10): the frozen-card commitment dated from the oldest listed day; no repository, no link', () => {
  const html = renderRecord(REC, OPTS);
  const t = text(html);
  const foot = footOf(html);
  assert.ok(foot.includes("<li>From Wed 7 Oct 2026, each day&#39;s card is frozen before its matches kick off.</li>"), foot);
  assert.doesNotMatch(foot, /<a\b|href=/, 'the footnotes link nowhere');
  assert.doesNotMatch(t, /github|reposit|committed|open source/i);
  assert.ok(!html.includes('geezerz/betgaffer-site'), 'the repo slug never reaches the page');
  assert.doesNotMatch(t, /Every pick is committed|before its day begins/);
  assert.match(text(renderRecord(REC, { ...OPTS, days: ['2026-10-08', '2026-09-30', '2026-10-01'] })), /From Wed 30 Sep 2026, each day's card is frozen before its matches kick off\./);
  const none = text(renderRecord(REC, { ...OPTS, days: [] }));
  assert.doesNotMatch(none, /frozen before its matches kick off/);
  assert.doesNotMatch(none, /From \w{3} \d/);
  assert.match(none, /Updated 7 Oct 2026, 06:05 WAT\./, 'the other footnotes stay');
});

test('I4: opts.days is required (a forgotten archive list must not silently unlink every day)', () => {
  assert.throws(() => renderRecord(REC, { today: '2026-10-07' }), TypeError);
  assert.throws(() => renderRecord(null, { today: '2026-10-07' }), TypeError);
  assert.throws(() => renderRecord(REC, { ...OPTS, today: '2026-13-01' }), TypeError);
});

test('renderRecord(null) renders the no-data state (S7) with no percentage', () => {
  const html = renderRecord(null, OPTS);
  assert.match(text(html), /first card publishes the evening before match day/i);
  assert.doesNotMatch(text(html), /%/);
  assert.ok(!html.includes('data-claim="headline"'));
});

test('copy rules: no banned words, no "win rate", nothing ROI-shaped', () => {
  const t = text(renderRecord(REC, OPTS)).toLowerCase();
  for (const w of ['win rate', 'roi', 'profit', 'yield', 'staking', 'bankroll', 'guaranteed', 'banker',
    'sure bet', 'tipster', 'bookmaker', INTERNAL.toLowerCase(), 'token', 'we win', 'edge_reliability', 'probability_range']) {
    assert.ok(!new RegExp(`\\b${w}\\b`).test(t), `banned or internal term "${w}" in record copy`);
  }
});

test('escaping: a hostile month string never reaches the HTML raw; hostile statuses and scope are not printed', () => {
  const hostile = '<img src=x onerror=alert(1)>"\'&';
  // validateIndex rejects such a period; the renderer must still escape what it is handed.
  const r = clone(REC);
  r.months[1] = { ...r.months[1], period: `2026-09${hostile}` };
  const html = renderRecord(r, OPTS);
  assert.ok(!html.includes('<img'), 'no raw tag');
  assert.doesNotMatch(html, /onerror=alert\(1\)>/);
  assert.ok(html.includes('data-period="2026-09&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;"'), 'the period attribute is escaped');
  assert.ok(text(monthRows(html)[1]).startsWith(`2026-09${hostile} `), 'an unreadable month is shown as given, escaped');
  // Free-text ledger fields are no longer printed at all.
  const s = clone(REC);
  s.scope = hostile;
  s.recent[1].status = hostile;
  s.months[2].status = hostile;
  assert.doesNotMatch(renderRecord(s, OPTS), /onerror/);
  assert.equal(renderRecord(REC, { ...OPTS, repo: 'x"><script>' }), renderRecord(REC, OPTS), 'a repo option is never read');
});

/** Percentages outside the headline block and record-rows, and record-rows lacking a fraction. */
function claimProblems(html) {
  const problems = [];
  let rest = html;
  const head = elementWith(html, 'data-claim="headline"');
  if (head) rest = rest.replace(head.html, '');
  for (const row of allWith(html, 'data-figure="record-row"')) {
    if (!/\d of \d|no picks settled/i.test(text(row))) problems.push(`row without fraction: ${text(row)}`);
    rest = rest.replace(row, '');
  }
  for (const m of text(rest).match(/\d+(\.\d+)?%/g) || []) problems.push(`stray ${m}`);
  return problems;
}

test('claim safety: every percentage sits in the headline block or a record-row', () => {
  const html = renderRecord(REC, OPTS);
  assert.deepEqual(claimProblems(html), []);
  const injected = html.replace('<section class="rec-sec"', '<p class="x">83% of picks</p><section class="rec-sec"');
  assert.notEqual(injected, html);
  assert.deepEqual(claimProblems(injected), ['stray 83%']);
  const noFrac = html.replace(/<p class="rec-day__frac">[^]*?<\/p>/, '');
  assert.notEqual(noFrac, html);
  assert.ok(claimProblems(noFrac).some((p) => p.startsWith('row without fraction')));
});

test('CSP: no inline style, <style> or <script> in the fragment', () => {
  const html = renderRecord(REC, OPTS) + renderRecord(null, OPTS);
  assert.doesNotMatch(html, /\sstyle=|<style|<script/i);
});

test('record.css: only rules, base tokens, and no class the renderer never emits (dead CSS)', () => {
  const css = readFileSync(join(ROOT, 'site/assets/css/record.css'), 'utf8');
  // Class tokens the renderer actually emits, over every state it has (full, empty, perfect, none).
  const outputs = [
    renderRecord(REC, OPTS),
    renderRecord(REC7, OPTS),
    renderRecord(null, OPTS),
    renderRecord(rec((x) => {
      x.months = [];
      Object.assign(x.last_30, { won: 0, lost: 0, pushes: 0, graded: 0, pct: null, finished_fixtures: 0, coverage: null, status_days: [] });
      Object.assign(x.last_6[3], { won: 0, lost: 0, pushes: 0, graded: 0, finished_fixtures: 0, pct: null, coverage: null, status: null });
    }), OPTS),
    renderRecord(rec((x) => {
      Object.assign(x.last_30, PERFECT_30);
      Object.assign(x.months[1], { won: 40, lost: 0, pushes: 0, graded: 40, pct: 100, finished_fixtures: 41, coverage: 0.9756 });
      Object.assign(x.months[2], { won: 0, lost: 0, pushes: 0, graded: 0, pct: null, finished_fixtures: 0, coverage: null });
    }), OPTS),
  ].join('\n');
  const emitted = new Set([...outputs.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  assert.ok(emitted.has('rec-months-card') && emitted.has('rec-empty'), 'premise: every state was rendered');
  assert.match(css, /\.rec-head/);
  assert.match(css, /\.rec-strip/);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/);
  const rules = css.replace(/\/\*[^]*?\*\//g, '');
  assert.doesNotMatch(rules, /rgba?\(|#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(rules, /!important/);
  // Every class selector, whole token (".rec-months" is not satisfied by "rec-months-card").
  const classes = new Set([...rules.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((m) => m[1]));
  assert.ok(classes.has('rec-months') && classes.has('mono') && classes.size > 5, 'premise: the stylesheet\'s class selectors were read');
  for (const c of classes) assert.ok(emitted.has(c), `record.css styles .${c}, which renderRecord never emits as a class`);
  assert.doesNotMatch(rules, /\.rec-foot a\b/);
});

// ---------------------------------------------------------------------------------------------
// Spec §17.5: green figures, the claim scanner over the page, the hero's type and the strip's columns
// ---------------------------------------------------------------------------------------------

/** Visible text of every element whose class list holds `rec-won`, in document order. */
function greens(html) {
  const out = [];
  for (const m of html.matchAll(/<[a-z0-9]+\b[^>]*\bclass="([^"]*)"[^>]*>/gi)) {
    if (!m[1].split(/\s+/).includes('rec-won')) continue;
    out.push(text(elementWith(html, m[0], m.index).html));
  }
  return out;
}
const shown = (g) => (g.won < g.graded && g.pct > 99.99 ? 99.99 : g.pct);
/** What the page must paint green, from the data: every right count and every percentage, no total. */
function expectedGreens(r) {
  const out = [];
  const g = r.last_30;
  if (!isEmptyG(g)) out.push(isPerfectG(g) ? 'Every pick right' : pctText(shown(g)), fmt(g.won));
  for (const d of r.recent) {
    if (isEmptyG(d)) continue;
    out.push(fmt(d.won));
    if (!isPerfectG(d)) out.push(pctText(shown(d)));
  }
  for (const mo of r.months) {
    if (isEmptyG(mo)) continue;
    out.push(fmt(mo.won), isPerfectG(mo) ? 'Every pick right' : pctText(shown(mo)));
  }
  return out;
}
const MIXED = rec7((x) => {
  Object.assign(x.last_7[1], { won: 5, lost: 0, pushes: 0, graded: 5, finished_fixtures: 6, pct: 100, coverage: 0.8333 });
  Object.assign(x.last_7[4], { won: 0, lost: 0, pushes: 0, graded: 0, finished_fixtures: 0, pct: null, coverage: null, status: null });
  Object.assign(x.months[1], { won: 40, lost: 0, pushes: 0, graded: 40, pct: 100, finished_fixtures: 41, coverage: 0.9756 });
  Object.assign(x.months[2], { won: 0, lost: 0, pushes: 0, graded: 0, pct: null, finished_fixtures: 0, coverage: null });
});

test('green figures: every right count and every percentage (hero, count line, day cards, months) and no total', () => {
  for (const [name, r] of [['last_6', REC], ['last_7', REC7], ['mixed', MIXED], ['perfect 30', rec7((x) => Object.assign(x.last_30, PERFECT_30))]]) {
    const html = renderRecord(r, OPTS);
    const want = expectedGreens(r);
    assert.ok(want.length >= 2 + r.recent.length, `${name}: premise: the data has figures to paint`);
    assert.deepEqual(greens(html), want, name);
    // Every percentage in the visible text is one of the green ones (none left neutral).
    const pcts = text(html).match(/\d+(\.\d+)?%/g) || [];
    assert.deepEqual(pcts, want.filter((w) => w.endsWith('%')), `${name}: every percentage is green`);
  }
  // The guard fires: a total painted green, or a count left neutral, breaks the list.
  const html = renderRecord(REC, OPTS);
  const g = REC.last_30;
  const totalGreen = html.replace(` of ${fmt(g.graded)} picks right`, ` of <strong class="rec-won">${fmt(g.graded)}</strong> picks right`);
  assert.notEqual(totalGreen, html);
  assert.notDeepEqual(greens(totalGreen), expectedGreens(REC));
  const neutral = html.replace(`<strong class="rec-won">${fmt(g.won)}</strong>`, fmt(g.won));
  assert.notEqual(neutral, html);
  assert.notDeepEqual(greens(neutral), expectedGreens(REC));
});

test('claims scanner (tests/html-scan.js): the rendered page has no violation, last_7 and legacy last_6 alike', () => {
  const page = (frag) => `<!doctype html><html lang="en"><head><title>Our record</title></head><body><main>${frag}</main></body></html>`;
  for (const r of [REC, REC7, MIXED, rec7((x) => Object.assign(x.last_30, PERFECT_30))]) {
    assert.deepEqual(claimViolations(page(renderRecord(r, OPTS))), []);
  }
  // Premise: the scanner reasons about this markup: the hero needs the headline's period part and its fraction.
  const html = page(renderRecord(REC7, OPTS));
  const hero = pctText(REC7.last_30.pct);
  const noPeriod = html.replace('data-claim-part="period"', 'data-x="gone"');
  assert.notEqual(noPeriod, html);
  assert.ok(claimViolations(noPeriod).some((m) => m.includes(`"${hero}" outside an allowed figure`)), 'no period');
  const noCount = html.replace(/<p class="rec-count">[^]*?<\/p>/, '');
  assert.notEqual(noCount, html);
  assert.ok(claimViolations(noCount).some((m) => m.includes(`"${hero}" outside an allowed figure`)), 'no fraction');
});

/** [min, max] px of a `font-size:` declaration in rule `sel` (a clamp gives both ends, a px value twice). */
function fontSize(css, sel) {
  const rule = new RegExp(`${sel.replace(/[.[\]-]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(rule, `a ${sel} rule`);
  const v = /font-size:\s*([^;]+)/.exec(rule[1]);
  assert.ok(v, `${sel} sets font-size`);
  const px = [...v[1].matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  return [px[0], px[px.length - 1]];
}

test('record.css (spec §17.5): the hero is the largest type on the page, 800, green; the count line ~40% of it', () => {
  const rules = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[^]*?\*\//g, '');
  const css = rules('site/assets/css/record.css');
  const base = rules('site/assets/css/base.css');
  const [heroMin, heroMax] = fontSize(css, '.rec-hero');
  assert.ok(/\.rec-hero\s*\{[^}]*font-weight:\s*800/.test(css), 'hero weight 800');
  assert.ok(/\.rec-won\s*\{[^}]*color:\s*var\(--won\)/.test(css), '.rec-won is var(--won)');
  assert.ok(/\.rec-won\s*\{[^}]*font-weight:\s*(700|800)/.test(css), '.rec-won is bold');
  // Largest at every width: the hero's smallest size (and its perfect-window wording's) beats every
  // other px size the page's CSS sets.
  const [wordsMin] = fontSize(css, '.rec-hero--words');
  const others = [...(css.replace(/\.rec-hero(--words)?\s*\{[^}]*\}/g, '') + base).matchAll(/font-size:\s*([^;}]+)/g)]
    .flatMap((m) => [...m[1].matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1])));
  assert.ok(others.length > 10, 'premise: the other sizes were read');
  for (const [name, min] of [['hero', heroMin], ['perfect-window hero', wordsMin]]) {
    assert.ok(min > Math.max(...others), `${name} ${min}px vs largest other ${Math.max(...others)}px`);
  }
  const [cMin, cMax] = fontSize(css, '.rec-count');
  for (const [c, h] of [[cMin, heroMin], [cMax, heroMax]]) assert.ok(c / h >= 0.35 && c / h <= 0.45, `count ${c}px is ~40% of hero ${h}px`);
});

test('record.css: day-card columns follow the data (7 or 6 from 1024px), 4 from 600px, compact rows below 600px', () => {
  const css = readFileSync(join(ROOT, 'site/assets/css/record.css'), 'utf8').replace(/\/\*[^]*?\*\//g, '');
  /** Every `@media <q>{...}` block's text, joined. */
  const block = (q) => {
    const out = [];
    for (let at = css.indexOf(`@media ${q}{`); at >= 0; at = css.indexOf(`@media ${q}{`, at + 1)) {
      let depth = 0;
      for (let i = css.indexOf('{', at); i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}' && --depth === 0) { out.push(css.slice(at, i + 1)); break; }
      }
    }
    assert.ok(out.length > 0, `a ${q} block`);
    return out.join(' ');
  };
  const wide = block('(min-width:1024px)');
  for (const n of [7, 6]) assert.match(wide, new RegExp(`\\.rec-strip--${n}\\s*\\{[^}]*grid-template-columns:\\s*repeat\\(${n},\\s*minmax\\(0,\\s*1fr\\)\\)`));
  assert.match(block('(min-width:600px)'), /\.rec-strip\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  const phone = block('(max-width:599.98px)');
  assert.match(phone, /\.rec-day__link,\s*\.rec-day__in\s*\{[^}]*display:\s*grid/);
});
