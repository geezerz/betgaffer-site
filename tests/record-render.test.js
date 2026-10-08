import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateIndex } from '../site/lib/data.js';
import { renderRecord } from '../site/lib/record.js';
import { fmtDayLong } from '../site/lib/time.js';

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
const stripRows = (html) => allWith(elementWith(html, 'class="rec-strip"').html, 'data-figure="record-row"');
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

test('headline: one block, "Last 30 days", the hero fraction and the exact sentence with 10,268 / 12,154 / 84.48%', () => {
  const html = renderRecord(REC, OPTS);
  assert.equal(count(html, 'data-claim="headline"'), 1, 'exactly one headline block');
  const head = headOf(html);
  const t = text(head);
  assert.match(t, /^Last 30 days /);
  assert.ok(t.includes('10,268 of 12,154'), t);
  assert.ok(t.includes('Our recommended picks were right 10,268 times out of 12,154: 84.48%.'), t);
  // The figures are emphasised as the spec shows them.
  assert.ok(head.includes('<strong>10,268 times out of 12,154</strong>'), head);
  assert.ok(head.includes('<strong>84.48%</strong>'), head);
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

test('headline: a perfect window states its fraction and no percentage at all', () => {
  const r = rec((x) => Object.assign(x.last_30, PERFECT_30));
  const t = text(headOf(renderRecord(r, OPTS)));
  assert.ok(t.includes('12 of 12'), t);
  assert.ok(t.includes('Our recommended picks were right 12 times out of 12.'), t);
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
  assert.ok(text(headOf(html)).includes('right 29,999 times out of 30,000: 99.99%.'));
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
  assert.ok(t.includes('Our recommended picks were right 10,268 times out of 12,154: 84.48%.'));
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

test('strip: six record-rows, each "<full date> <won> of <graded> right <pct>%"', () => {
  const rows = stripRows(renderRecord(REC, OPTS));
  assert.equal(rows.length, 6);
  REC.last_6.forEach((d, i) => {
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
  assert.equal(text(rows[3]), `${fmtDayLong(REC.last_6[3].period)} No picks settled`);
  assert.equal(text(rows[2]), `${fmtDayLong(REC.last_6[2].period)} 5 of 5 right`);
  assert.doesNotMatch(text(rows[2]), /%/);
});

test('strip: links only days the archive lists', () => {
  const strip = elementWith(renderRecord(REC, OPTS), 'class="rec-strip"').html;
  assert.ok(strip.includes('href="/day/2026-10-07/"'));
  for (const d of ['2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03', '2026-10-02']) {
    assert.ok(!strip.includes(`/day/${d}/`), `${d} is not listed, so it must not link`);
  }
  const strip2 = elementWith(renderRecord(REC, { ...OPTS, days: ['2026-10-06'] }), 'class="rec-strip"').html;
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

test('months: a perfect month shows its fraction and no percentage; an empty month reads "No picks settled"', () => {
  const r = rec((x) => {
    Object.assign(x.months[1], { won: 40, lost: 0, pushes: 0, graded: 40, pct: 100, finished_fixtures: 41, coverage: 0.9756 });
    Object.assign(x.months[2], { won: 0, lost: 0, pushes: 0, graded: 0, pct: null, finished_fixtures: 0, coverage: null });
  });
  const rows = monthRows(renderRecord(r, OPTS));
  assert.match(text(rows[1]), /^September 2026 40 of 40 right/);
  assert.doesNotMatch(text(rows[1]), /%/);
  assert.match(text(rows[2]), /^August 2026 No picks settled/);
  assert.doesNotMatch(text(rows[2]), /%|0 of 0/);
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
  s.last_6[1].status = hostile;
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
  const src = readFileSync(join(ROOT, 'site/lib/record.js'), 'utf8');
  assert.match(css, /\.rec-head/);
  assert.match(css, /\.rec-strip/);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/);
  const rules = css.replace(/\/\*[^]*?\*\//g, '');
  assert.doesNotMatch(rules, /rgba?\(|#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(rules, /!important/);
  const classes = new Set([...rules.matchAll(/\.(rec-[a-z0-9_-]+)/g)].map((m) => m[1]));
  assert.ok(classes.size > 5, 'premise: the stylesheet styles rec-* classes');
  for (const c of classes) assert.ok(new RegExp(`\\b${c}\\b`).test(src), `record.css styles .${c}, which record.js never emits`);
  assert.doesNotMatch(rules, /\.rec-foot a\b/);
});
