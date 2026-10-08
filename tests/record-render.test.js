import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateIndex } from '../site/lib/data.js';
import { renderRecord, wilson } from '../site/lib/record.js';

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

/** Visible text of an HTML fragment (tags dropped, entities for the five escaped chars decoded). */
function text(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
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

// ---------------------------------------------------------------------------------------------
// Wilson score interval
// ---------------------------------------------------------------------------------------------

test('wilson() matches an independently written closed form on the real 30-day record', () => {
  const z = 1.959964;
  const n = 12154;
  const x = 10268;
  // The other textbook form: (2x + z^2 -/+ z*sqrt(z^2 + 4x(n-x)/n)) / (2(n + z^2)).
  const root = z * Math.sqrt(z * z + (4 * x * (n - x)) / n);
  const lo = (2 * x + z * z - root) / (2 * (n + z * z));
  const hi = (2 * x + z * z + root) / (2 * (n + z * z));
  const w = wilson(x, n);
  assert.equal(w.low, Math.round(lo * 10000) / 100);
  assert.equal(w.high, Math.round(hi * 10000) / 100);
  assert.deepEqual(w, { low: 83.83, high: 85.12 }); // the plan's stated value
});

test('wilson() known edge values: 0 of 10 and 10 of 10', () => {
  // x = 0: low is 0 and high is z^2 / (n + z^2) = 27.75% (the textbook zero-success bound).
  assert.deepEqual(wilson(0, 10), { low: 0, high: 27.75 });
  assert.deepEqual(wilson(10, 10), { low: 72.25, high: 100 });
});

test('wilson() returns null without a denominator and rejects impossible input', () => {
  assert.equal(wilson(0, 0), null);
  assert.throws(() => wilson(5, 4), RangeError);
  assert.throws(() => wilson(-1, 4), RangeError);
  assert.throws(() => wilson(1.5, 4), RangeError);
  assert.throws(() => wilson('3', 4), RangeError);
});

// ---------------------------------------------------------------------------------------------
// Headline triple
// ---------------------------------------------------------------------------------------------

test('headline: one data-claim="headline" block carries fraction, pct, band, coverage, period, status, CI', () => {
  const html = renderRecord(REC, OPTS);
  assert.equal(html.split('data-claim="headline"').length - 1, 1, 'exactly one headline block');
  const head = elementWith(html, 'data-claim="headline"').html;
  const t = text(head);

  assert.match(t, /10,268 of 12,154/);
  assert.match(t, /graded card picks landed/);
  assert.match(t, /84\.48%/);

  for (const part of ['band', 'coverage', 'period', 'ci', 'status']) {
    assert.ok(head.includes(`data-claim-part="${part}"`), `headline lacks data-claim-part="${part}"`);
  }
  const band = text(elementWith(head, 'data-claim-part="band"').html);
  // probability_range with an equal fallback floor: the floor is stated once.
  assert.match(band, /model probability of at least 80%/);
  assert.equal(band.split('80%').length - 1, 1, `floor stated once: ${band}`);
  // The pick reader's odds check uses the latest captured price, or an
  // estimate from the model probability when none was captured -- so every pick is checked.
  assert.match(band, /Every pick's price must fall between 1\.10 and 1\.80: the latest captured market price, or, where none was captured, a price estimated from the model probability\./);
  assert.doesNotMatch(band, /when one was captured/);
  // I1: the window starts 2026-09-08, before the rule's effective date 2026-09-30.
  assert.match(band, /The current rule applies from Wed 30 Sep 2026; earlier days in this window were picked under a previous rule\./);

  const cov = text(elementWith(head, 'data-claim-part="coverage"').html);
  assert.match(cov, /90\.7% of the period's 13,401 finished fixtures carried a graded pick/);

  const period = elementWith(head, 'data-claim-part="period"').html;
  assert.match(period, /datetime="2026-09-08"/);
  assert.match(period, /datetime="2026-10-07"/);
  assert.match(text(period), /8 Sep 2026/);
  assert.match(text(period), /7 Oct 2026/);
  assert.match(text(period), /30 days/);

  const status = text(elementWith(head, 'data-claim-part="status"').html);
  assert.match(status, /23 of 30 days provisional/);
  assert.match(status, /7 of 30 days in progress/);

  const ci = text(elementWith(head, 'data-claim-part="ci"').html);
  assert.match(ci, /95% confidence interval 83\.83%–85\.12%/);
});

test('headline: the band is the probability floor alone when the odds filter is off', () => {
  const r = rec((x) => { x.selection.odds_filter = false; x.selection.min_odds = null; x.selection.max_odds = null; });
  const band = text(elementWith(renderRecord(r, OPTS), 'data-claim-part="band"').html);
  assert.match(band, /model probability of at least 80%/);
  assert.doesNotMatch(band, /price/);
  assert.doesNotMatch(band, /1\.10|1\.80/);
});

const bandOf = (r) => text(elementWith(renderRecord(r, OPTS), 'data-claim-part="band"').html);

test('band I1: no previous-rule sentence when the whole window is under the current rule', () => {
  const r = rec((x) => { x.selection.effective_since_date = '2026-09-08'; });
  assert.doesNotMatch(bandOf(r), /previous rule/);
});

test('band C1: probability_range with a lower fallback floor states both floors', () => {
  const r = rec((x) => { x.selection.fallback_min_probability = 0.7; });
  // The fallback fires when no market passes ALL primary checks, not only the floor.
  assert.match(bandOf(r), /at least 80%, or at least 70% for a fixture where no eligible market reaches 80%/);
  assert.doesNotMatch(bandOf(r), /where no market reaches/);
});

test('band C1: hide states the card floor alone', () => {
  const r = rec((x) => { x.selection.fallback = 'hide'; x.selection.fallback_min_probability = null; });
  const band = bandOf(r);
  assert.match(band, /Picks need a model probability of at least 80%\./);
  assert.doesNotMatch(band, /where no market|most likely/);
});

for (const mode of ['best_allowlist', 'confidence_any']) {
  test(`band C1: ${mode} claims no floor for the fallback picks`, () => {
    const r = rec((x) => { x.selection.fallback = mode; x.selection.fallback_min_probability = null; });
    const band = bandOf(r);
    assert.match(band, /at least 80%; where no eligible market reaches 80%, the fixture's most likely eligible market is picked\./);
    assert.doesNotMatch(band, /where no market reaches/);
    // Never the bare all-picks claim "at least 80%." / "at least 80% and".
    assert.doesNotMatch(band, /at least 80%(\.| and)/);
    // The perfect-window caption obeys the same rule.
    const p = rec((x) => {
      x.selection.fallback = mode; x.selection.fallback_min_probability = null;
      Object.assign(x.last_30, { won: 12, lost: 0, pushes: 0, graded: 12, pct: 100, finished_fixtures: 14, coverage: 0.8571 });
    });
    const main = text(elementWith(renderRecord(p, OPTS), 'class="rec-head__main"').html);
    assert.match(main, /stated at/);
    assert.match(main, /most likely eligible market where no eligible market reached 80%/);
    assert.doesNotMatch(main, /at least 80%(\.|$)/);
  });
}

test('strategy: any strategy other than edge_reliability throws (the stated rule would be false)', () => {
  // Under strategy probability_range the reader ignores the card floor and the fallback mode.
  assert.throws(() => renderRecord(rec((x) => { x.strategy = 'probability_range'; }), OPTS), /edge_reliability/);
  assert.throws(() => renderRecord(rec((x) => { x.strategy = 'something_new'; }), OPTS), TypeError);
  assert.doesNotThrow(() => renderRecord(REC, OPTS));
  assert.doesNotThrow(() => renderRecord(null, OPTS));
});

test('band C1: an unknown fallback mode, or probability_range without its floor, throws', () => {
  assert.throws(() => renderRecord(rec((x) => { x.selection.fallback = 'mystery'; }), OPTS), TypeError);
  assert.throws(() => renderRecord(rec((x) => { x.selection.fallback_min_probability = null; }), OPTS), TypeError);
});

test('perfect caption under probability_range with a lower floor states the lower floor', () => {
  const r = rec((x) => {
    x.selection.fallback_min_probability = 0.7;
    Object.assign(x.last_30, { won: 12, lost: 0, pushes: 0, graded: 12, pct: 100, finished_fixtures: 14, coverage: 0.8571 });
  });
  const main = text(elementWith(renderRecord(r, OPTS), 'class="rec-head__main"').html);
  assert.match(main, /all landed so far/);
  assert.match(main, /stated at a model probability of at least 70%/);
});

test('headline: null pct reads "No graded picks in this window yet" and never 0% / NaN', () => {
  const r = rec((x) => {
    Object.assign(x.last_30, { won: 0, lost: 0, pushes: 0, graded: 0, pct: null, finished_fixtures: 0, coverage: null, status_days: [] });
  });
  const html = renderRecord(r, OPTS);
  const head = elementWith(html, 'data-claim="headline"').html;
  const t = text(head);
  assert.match(t, /No graded picks in this window yet/);
  assert.doesNotMatch(t, /\b0(\.0+)?%/);
  assert.doesNotMatch(t, /NaN|undefined|null|0 of 0/);
  for (const part of ['band', 'coverage', 'period', 'ci']) {
    assert.ok(head.includes(`data-claim-part="${part}"`), `null path lacks ${part}`);
  }
  assert.doesNotMatch(text(elementWith(head, 'data-claim-part="ci"').html), /%–/);
});

test('headline: a perfect window never renders a bare 100% (fraction + "so far" + "stated at")', () => {
  const r = rec((x) => Object.assign(x.last_30, { won: 12, lost: 0, pushes: 0, graded: 12, pct: 100, finished_fixtures: 14, coverage: 0.8571 }));
  const head = elementWith(renderRecord(r, OPTS), 'data-claim="headline"').html;
  const t = text(head);
  assert.match(t, /12 of 12/);
  assert.match(t, /so far/);
  assert.match(t, /stated at/);
  // The interval's upper bound is 100.00% here; it sits in a block that carries the fraction,
  // "so far" and "stated at" (the charter's 100% rule). Nothing ELSE may print 100%.
  const ci = elementWith(head, 'data-claim-part="ci"').html;
  assert.match(text(ci), /100\.00%/);
  assert.doesNotMatch(text(head.replace(ci, '')), /(^|[^\d.])100(\.0+)?%/, 'the headline pct is not printed as 100%');
});

const covOf = (r) => text(elementWith(renderRecord(r, OPTS), 'data-claim-part="coverage"').html);

test('coverage I2: "every one" only when graded equals finished fixtures', () => {
  const r = rec((x) => Object.assign(x.last_30, { finished_fixtures: 12154, coverage: 1 }));
  const cov = covOf(r);
  assert.match(cov, /every one of the period's 12,154 finished fixtures/i);
  assert.doesNotMatch(cov, /100(\.0+)?%/);
  // A coverage field of 1 that the integers do not back is NOT "every one".
  const lying = rec((x) => Object.assign(x.last_30, { finished_fixtures: 12160, coverage: 1 }));
  assert.doesNotMatch(covOf(lying), /every/i);
  assert.match(covOf(lying), /99\.9%/);
});

test('coverage I2: 24,999 of 25,000 is capped at 99.9%, never 100.0%', () => {
  const r = rec((x) => Object.assign(x.last_30, { won: 21000, lost: 3999, graded: 24999, pct: 84.0, finished_fixtures: 25000, coverage: 0.99996 }));
  const cov = covOf(r);
  assert.match(cov, /99\.9% of the period's 25,000 finished fixtures/);
  assert.doesNotMatch(cov, /100(\.0+)?%|every/i);
});

test('coverage I2: more graded picks than finished fixtures prints both counts, no "every", no %', () => {
  const r = rec((x) => Object.assign(x.last_30, { finished_fixtures: 12000, coverage: 1.0128 }));
  const cov = covOf(r);
  assert.match(cov, /12,154 graded picks/);
  assert.match(cov, /12,000 finished fixtures/);
  assert.doesNotMatch(cov, /every|%/i);
  const m = rec((x) => Object.assign(x.months[0], { finished_fixtures: 2000, coverage: 1.1695 }));
  const row = allWith(elementWith(renderRecord(m, OPTS), 'class="bg-table rec-months"').html, 'data-figure="record-row"')[0];
  assert.match(text(row), /2,339 graded, 2,000 finished/);
  assert.doesNotMatch(text(row), /all|11\d\.\d%/);
});

test('minor 1: a non-perfect figure never displays 100.00%', () => {
  const r = rec((x) => {
    Object.assign(x.last_30, { won: 29999, lost: 1, graded: 30000, pct: 100, finished_fixtures: 30000, coverage: 1 });
    Object.assign(x.last_6[1], { won: 29999, lost: 1, graded: 30000, pct: 100, finished_fixtures: 30000, coverage: 1 });
    Object.assign(x.months[0], { won: 29999, lost: 1, graded: 30000, pct: 100, finished_fixtures: 30000, coverage: 1 });
  });
  const html = renderRecord(r, OPTS);
  assert.doesNotMatch(text(html), /100\.00%/);
  assert.match(text(elementWith(html, 'class="rec-head__main"').html), /99\.99%/);
  assert.match(text(elementWith(html, 'data-claim-part="ci"').html), /–99\.99%/);
  const strip = allWith(elementWith(html, 'class="rec-strip"').html, 'data-figure="record-row"');
  assert.match(text(strip[1]), /29,999 of 30,000 99\.99%/);
  const month = allWith(elementWith(html, 'class="bg-table rec-months"').html, 'data-figure="record-row"')[0];
  assert.match(text(month), /99\.99%/);
});

test('minor 3: status denominator is the days in the period; missing days read "not yet reported"', () => {
  const r = rec((x) => { x.last_30.status_days = { provisional: 20, live: 6 }; });
  const s = text(elementWith(renderRecord(r, OPTS), 'data-claim-part="status"').html);
  assert.match(s, /20 of 30 days provisional/);
  assert.match(s, /6 of 30 days in progress/);
  assert.match(s, /4 not yet reported/);
  const empty = rec((x) => { x.last_30.status_days = {}; });
  assert.match(text(elementWith(renderRecord(empty, OPTS), 'data-claim-part="status"').html), /30 of 30 days not yet reported/);
  assert.throws(() => renderRecord(rec((x) => { x.last_30.status_days = { provisional: 31 }; }), OPTS), TypeError);
});

// ---------------------------------------------------------------------------------------------
// Scope, pushes
// ---------------------------------------------------------------------------------------------

test('scope is rendered verbatim (escaped); the push count is stated separately (minor 6)', () => {
  const html = renderRecord(REC, OPTS);
  const scope = text(elementWith(html, 'class="rec-scope').html);
  assert.ok(scope.includes(REC.scope));
  assert.match(scope, /506 pushes in this window are not counted\./);
  assert.doesNotMatch(scope, /both sides/);
  const one = rec((x) => { x.last_30.pushes = 1; });
  assert.match(text(renderRecord(one, OPTS)), /1 push in this window is not counted\./);
  const none = rec((x) => { x.last_30.pushes = 0; });
  assert.match(text(renderRecord(none, OPTS)), /No pushes in this window\./);
});

// ---------------------------------------------------------------------------------------------
// 6-day strip
// ---------------------------------------------------------------------------------------------

test('strip: six record-rows, today first and labelled, each with its fraction and period', () => {
  const html = renderRecord(REC, OPTS);
  const strip = elementWith(html, 'class="rec-strip"').html;
  const rows = allWith(strip, 'data-figure="record-row"');
  assert.equal(rows.length, 6);
  REC.last_6.forEach((d, i) => {
    const t = text(rows[i]);
    assert.ok(rows[i].includes(`data-period="${d.period}"`), `row ${i} period attribute`);
    assert.ok(rows[i].includes(`datetime="${d.period}"`), `row ${i} time element`);
    const [y, m, dd] = d.period.split('-').map(Number);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
    assert.ok(t.includes(`${dd} ${mon} ${y}`), `row ${i} visible date: ${t}`);
    assert.ok(t.includes(`${d.won.toLocaleString('en-US')} of ${d.graded.toLocaleString('en-US')}`), `row ${i} fraction: ${t}`);
    assert.ok(t.includes(`${d.pct.toFixed(2)}%`), `row ${i} pct: ${t}`);
  });
  // Static text is true whenever it is read; stale.js says "Today (in progress)" on the visitor's day.
  assert.match(rows[0], /<span class="bg-chip bg-chip--open rec-chip" data-rel-day="2026-10-07" data-rel="record">In progress<\/span>/);
  assert.doesNotMatch(text(rows[0]), /today/i);
  assert.doesNotMatch(rows[1], /data-rel="record"/);
});

test('strip: links only days the archive lists', () => {
  const strip = elementWith(renderRecord(REC, OPTS), 'class="rec-strip"').html;
  assert.ok(strip.includes('href="/day/2026-10-07/"'));
  for (const d of ['2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03', '2026-10-02']) {
    assert.ok(!strip.includes(`/day/${d}/`), `${d} is not listed, so it must not link`);
  }
  // An array of listed dates works the same as a Set.
  const strip2 = elementWith(renderRecord(REC, { ...OPTS, days: ['2026-10-06'] }), 'class="rec-strip"').html;
  assert.ok(strip2.includes('href="/day/2026-10-06/"'));
  assert.ok(!strip2.includes('href="/day/2026-10-07/"'));
});

test('strip: a null-status day reads "no graded picks"; a 100% day never shows a bare 100%', () => {
  const r = rec((x) => {
    Object.assign(x.last_6[3], { won: 0, lost: 0, pushes: 0, graded: 0, finished_fixtures: 0, pct: null, coverage: null, status: null });
    Object.assign(x.last_6[2], { won: 5, lost: 0, pushes: 0, graded: 5, finished_fixtures: 6, pct: 100, coverage: 0.8333 });
  });
  const rows = allWith(elementWith(renderRecord(r, OPTS), 'class="rec-strip"').html, 'data-figure="record-row"');
  const empty = text(rows[3]);
  assert.match(empty, /no graded picks/i);
  assert.doesNotMatch(empty, /%|0 of 0|NaN|null/);
  const perfect = text(rows[2]);
  assert.match(perfect, /5 of 5/);
  assert.match(perfect, /all landed so far/);
  assert.doesNotMatch(perfect, /100(\.0+)?%/);
});

// ---------------------------------------------------------------------------------------------
// Month by month
// ---------------------------------------------------------------------------------------------

test('months: one record-row per month, newest first, with fraction, pct, coverage, status word', () => {
  const html = renderRecord(REC, OPTS);
  const table = elementWith(html, 'class="bg-table rec-months"').html;
  const rows = allWith(table, 'data-figure="record-row"');
  assert.equal(rows.length, 3);
  const want = [
    ['2026-10', /October 2026/, /2,004 of 2,339/, /85\.68%/, /90\.1%/, /In progress/],
    ['2026-09', /September 2026/, /10,936 of 13,190/, /82\.91%/, /90\.1%/, /Provisional/],
    ['2026-08', /August 2026/, /7,837 of 9,764/, /80\.26%/, /71\.2%/, /Provisional/],
  ];
  rows.forEach((row, i) => {
    assert.ok(row.includes(`data-period="${want[i][0]}"`));
    const t = text(row);
    for (const re of want[i].slice(1)) assert.match(t, re, `month ${want[i][0]}: ${t}`);
  });
  // Stacks below 640px: every data cell names its column.
  assert.equal((table.match(/<td\b/g) || []).length, (table.match(/<td\b[^>]*data-label="/g) || []).length);
});

test('months: effective-since footnote fires for 2026-09 (and 2026-08), not 2026-10 (minor 4)', () => {
  const rows = allWith(elementWith(renderRecord(REC, OPTS), 'class="bg-table rec-months"').html, 'data-figure="record-row"');
  const note = /Includes days before the current selection rule took effect on Wed 30 Sep 2026/;
  assert.doesNotMatch(text(rows[0]), /current selection rule/);
  assert.match(text(rows[1]), note);
  assert.match(text(rows[2]), note);
  // A month starting ON the effective date is under the current rule.
  const r = rec((x) => { x.selection.effective_since_date = '2026-09-01'; });
  const rows2 = allWith(elementWith(renderRecord(r, OPTS), 'class="bg-table rec-months"').html, 'data-figure="record-row"');
  assert.doesNotMatch(text(rows2[1]), /current selection rule/);
  assert.match(text(rows2[2]), /current selection rule/);
});

test('status words: every ledger status maps; an unknown status is shown escaped, never dropped', () => {
  const r = rec((x) => {
    x.months[0].status = 'live';
    x.months[1].status = 'confirmed';
    x.months[2].status = 'republish_pending';
    x.months.push({ ...x.months[2], period: '2026-07', status: '<b>weird</b>' });
  });
  const rows = allWith(elementWith(renderRecord(r, OPTS), 'class="bg-table rec-months"').html, 'data-figure="record-row"');
  assert.match(text(rows[0]), /In progress/);
  assert.match(text(rows[1]), /Confirmed/);
  assert.match(text(rows[2]), /Being recomputed/);
  assert.ok(rows[3].includes('&lt;b&gt;weird&lt;/b&gt;'));
  assert.ok(!rows[3].includes('<b>weird'));
  for (const raw of ['republish_pending', '>live<', '>provisional<', '>confirmed<']) {
    assert.ok(!rows.slice(0, 3).join('').includes(raw), `raw key ${raw} leaked`);
  }
});

test('months: none yet renders an explicit empty state, not an empty table', () => {
  const r = rec((x) => { x.months = []; });
  const html = renderRecord(r, OPTS);
  assert.ok(!html.includes('<table'));
  assert.match(text(html), /No month has a graded pick yet/);
});

// ---------------------------------------------------------------------------------------------
// Footnotes, empty record, copy rules, escaping
// ---------------------------------------------------------------------------------------------

test('footnotes (spec §10): the frozen-card commitment dated from the oldest listed day; no repository, no link', () => {
  const html = renderRecord(REC, OPTS);
  const t = text(html);
  assert.match(t, /Figures as of 7 Oct 2026, 06:05 WAT\./);
  const foot = /<ul class="rec-foot[^"]*"[^>]*>[\s\S]*?<\/ul>/.exec(html)[0];
  assert.ok(foot.includes("<li>From Wed 7 Oct 2026, each day&#39;s card is frozen before its matches kick off.</li>"), foot);
  assert.doesNotMatch(foot, /<a\b|href=/, 'the footnotes link nowhere');
  assert.doesNotMatch(t, /github|reposit|committed|open source/i);
  assert.ok(!html.includes('geezerz/betgaffer-site'), 'the repo slug never reaches the page');
  // The old sentence claimed every pick in the record was committed: false for pre-repository days.
  assert.doesNotMatch(t, /Every pick is committed|before its day begins/);
  // The oldest day comes from opts.days by value, not by its order.
  assert.match(text(renderRecord(REC, { ...OPTS, days: ['2026-10-08', '2026-09-30', '2026-10-01'] })), /From Wed 30 Sep 2026, each day's card is frozen before its matches kick off\./);
  // With no day listed there is no date to state: the commitment line is omitted, not left dateless.
  const none = text(renderRecord(REC, { ...OPTS, days: [] }));
  assert.doesNotMatch(none, /frozen before its matches kick off/);
  assert.doesNotMatch(none, /From \w{3} \d/);
  assert.match(none, /Figures as of 7 Oct 2026, 06:05 WAT\./, 'the other footnotes stay');
});

test('footnotes: no item at all renders no empty list', () => {
  const r = rec((x) => { x.months = []; x.as_of = null; });
  assert.ok(!/<ul class="rec-foot/.test(renderRecord(r, { ...OPTS, days: [] })));
  assert.match(renderRecord(r, OPTS), /<ul class="rec-foot[^"]*"[^>]*>\n<li>From Wed 7 Oct 2026/);
});

test('intro I3: picks are "made before kickoff", not "published before kickoff"', () => {
  const t = text(renderRecord(REC, OPTS));
  assert.match(t, /made before kickoff/);
  assert.doesNotMatch(t, /published before kickoff/);
});

test('minor 5: "Record begins" is derived from the oldest month', () => {
  assert.match(text(renderRecord(REC, OPTS)), /Record begins August 2026 — earlier months were not predicted before kickoff and are not published\./);
  const r = rec((x) => { x.months.pop(); });
  assert.match(text(renderRecord(r, OPTS)), /Record begins September 2026/);
  assert.doesNotMatch(text(renderRecord(rec((x) => { x.months = []; }), OPTS)), /Record begins/);
});

test('I4: opts.days is required (a forgotten archive list must not silently unlink every day)', () => {
  assert.throws(() => renderRecord(REC, { today: '2026-10-07' }), TypeError);
  assert.throws(() => renderRecord(null, { today: '2026-10-07' }), TypeError);
});

test('footnotes: as-of line omitted when as_of is null', () => {
  const r = rec((x) => { x.as_of = null; });
  assert.doesNotMatch(text(renderRecord(r, OPTS)), /Figures as of/);
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

test('escaping: hostile scope and status values never reach the HTML raw; a repo option is never read', () => {
  const hostile = '<img src=x onerror=alert(1)>"\'&';
  const r = rec((x) => { x.scope = hostile; x.last_6[1].status = hostile; });
  const html = renderRecord(r, OPTS);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
  assert.equal(renderRecord(REC, { ...OPTS, repo: 'x"><script>' }), renderRecord(REC, OPTS));
  assert.throws(() => renderRecord(REC, { ...OPTS, today: '2026-13-01' }), TypeError);
});

/** Percentages outside the headline block and record-rows, and record-rows lacking a fraction. */
function claimProblems(html) {
  const problems = [];
  let rest = html;
  const head = elementWith(html, 'data-claim="headline"');
  if (head) rest = rest.replace(head.html, '');
  for (const row of allWith(html, 'data-figure="record-row"')) {
    if (!/\d of \d|no graded picks/i.test(text(row))) problems.push(`row without fraction: ${text(row)}`);
    rest = rest.replace(row, '');
  }
  for (const m of text(rest).match(/\d+(\.\d+)?%/g) || []) problems.push(`stray ${m}`);
  return problems;
}

test('claim safety: every percentage sits in the headline block or a record-row (Task 6 rule)', () => {
  const html = renderRecord(REC, OPTS);
  assert.deepEqual(claimProblems(html), []);
  // Premise: a stray % injected INTO the rendered page (between sections) is reported...
  const injected = html.replace('<section class="rec-sec"', '<p class="x">83% of picks</p><section class="rec-sec"');
  assert.notEqual(injected, html);
  assert.deepEqual(claimProblems(injected), ['stray 83%']);
  // ...and so is a record-row whose fraction is missing.
  const noFrac = html.replace(/<p class="rec-day__frac mono">[^]*?<\/p>/, '');
  assert.notEqual(noFrac, html);
  assert.ok(claimProblems(noFrac).some((p) => p.startsWith('row without fraction')));
});

test('CSP: no inline style, <style> or <script> in the fragment', () => {
  const html = renderRecord(REC, OPTS) + renderRecord(null, OPTS);
  assert.doesNotMatch(html, /\sstyle=|<style|<script/i);
});

test('record.css exists and is only rules (no @import)', () => {
  const css = readFileSync(join(ROOT, 'site/assets/css/record.css'), 'utf8');
  assert.match(css, /\.rec-head/);
  assert.match(css, /\.rec-strip/);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/);
  // Minor 7: colours come from base.css tokens; no specificity hammer.
  assert.doesNotMatch(css.replace(/\/\*[^]*?\*\//g, ''), /rgba?\(|#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /!important/);
});
