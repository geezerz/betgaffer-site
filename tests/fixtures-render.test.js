import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderDay, meanStatedPct, statusLabel, EST_TEXT } from '../site/lib/fixtures.js';
import { validateDay, nodeSha256 } from '../site/lib/data.js';
import { picksHash } from '../site/lib/hash.js';
import { lagosParts } from '../site/lib/time.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(here(p), 'utf8'));
const EDGE_RAW = readJson('./fixtures/edge-day.json');
const D07_RAW = readJson('./fixtures/artifact/days/2026-10-07.json');
const D08_RAW = readJson('./fixtures/artifact/days/2026-10-08.json');
const EDGE = validateDay(EDGE_RAW, { expectDate: '2026-10-06' });
const D07 = validateDay(D07_RAW, { expectDate: '2026-10-07' });
const D08 = validateDay(D08_RAW, { expectDate: '2026-10-08' });
const SRC_RAW = readFileSync(here('../site/lib/fixtures.js'), 'utf8');
// Code only: a comment that NAMES a banned API must neither pass nor fail the isomorphism check.
const SRC = SRC_RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CSS_PATH = here('../site/assets/css/fixtures.css');

const REPO = 'geezerz/betgaffer-site';
const opts = (o = {}) => ({ isToday: false, isTomorrow: false, prevDay: null, nextDay: null, repo: REPO, ...o });

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** Visible text: tags stripped (vh text kept), entities decoded, whitespace collapsed. */
const text = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The <li> for one fixture (rows never nest an <li>). */
function row(html, fx) {
  const m = new RegExp(`<li class="fx"[^>]*data-fx="${fx}"[^>]*>[\\s\\S]*?</li>`).exec(html);
  assert.ok(m, `row ${fx} rendered`);
  return m[0];
}
const stateOf = (rowHtml) => /data-state="([^"]+)"/.exec(rowHtml)[1];

const EDGE_HTML = renderDay(EDGE, opts({ prevDay: '2026-10-05', nextDay: '2026-10-07' }));

// ---------------------------------------------------------------- the crafted edge day is a real receipt

test('edge-day.json validates through data.js and its picks_hash recomputes', async () => {
  assert.equal(EDGE.fixtures.length, 25);
  assert.equal(await picksHash(EDGE_RAW.fixtures, nodeSha256), EDGE_RAW.picks_hash);
  const grades = new Set(EDGE.fixtures.map((f) => f.grade));
  for (const g of ['won', 'lost', 'push', 'void', 'pending', 'withdrawn', null]) assert.ok(grades.has(g), `edge day covers grade ${g}`);
});

// ---------------------------------------------------------------- every row state

test('won / lost / push / void / pending render their grade chip and state', () => {
  const cases = [[900001, 'won', 'Won'], [900002, 'lost', 'Lost'], [900003, 'push', 'Push'],
    [900004, 'void', 'Void'], [900005, 'pending', 'Pending']];
  for (const [fx, state, chip] of cases) {
    const r = row(EDGE_HTML, fx);
    assert.equal(stateOf(r), state);
    assert.match(r, new RegExp(`<span class="bg-chip[^"]*fx__grade[^"]*">${chip}</span>`), `${fx} chip ${chip}`);
    assert.match(text(r), /★ Recommended pick/);
  }
});

test('a picked row shows selection, price, probability (data-figure) and why', () => {
  const r = row(EDGE_HTML, 900002);
  const t = text(r);
  assert.match(t, /Home or Draw/);
  assert.match(t, /@ 1\.45/);
  assert.match(r, /<p class="fx__prob" data-figure="pick-prob">[\s\S]*?78%[\s\S]*?probability[\s\S]*?<\/p>/);
  assert.match(t, /Form, expected goals and home edge/);
  // price is always two decimals
  assert.match(text(row(EDGE_HTML, 900003)), /@ 1\.90/);
});

test('void (PST) renders Postponed and Void — never Lost', () => {
  const r = row(EDGE_HTML, 900004);
  assert.match(text(r), /Postponed/);
  assert.match(text(r), /Void/);
  assert.ok(!/Lost/.test(text(r)));
});

test('price null: the designed "no price recorded" state, never a dash or "@"', () => {
  const r = row(EDGE_HTML, 900005);
  assert.match(text(r), /no price recorded/);
  assert.ok(!/@/.test(text(r)));
  assert.ok(!/[—–-]\s*<\/b>/.test(r));
});

test('test 15: an estimated price is never shown without its marker', () => {
  const r = row(EDGE_HTML, 900006);
  const sel = /<p class="fx__sel">[\s\S]*?<\/p>/.exec(r)[0];
  assert.match(text(sel), /@ 1\.10/);
  assert.ok(text(sel).includes(EST_TEXT), 'the marker sits in the same element as the price');
  assert.ok(!/title=/.test(sel), 'no title: the meaning is read once, from the hidden text');
  assert.match(sel, /<span class="vh">estimated price — no market price was captured<\/span>/);
  assert.match(sel, /est\./);
  assert.equal(EST_TEXT, 'estimated price — no market price was captured');
  // and an observed price never carries it
  assert.ok(!row(EDGE_HTML, 900002).includes(EST_TEXT));
});

test('test 15 on real data: every price_est pick on 2026-10-08 carries the marker, no other does', () => {
  const html = renderDay(D08, opts({ isTomorrow: true }));
  let est = 0;
  for (const f of D08.fixtures) {
    if (!f.pick) continue;
    const sel = /<p class="fx__sel">[\s\S]*?<\/p>/.exec(row(html, f.fx))[0];
    assert.match(text(sel), new RegExp(`@ ${f.pick.price.toFixed(2).replace('.', '\\.')}`));
    assert.equal(text(sel).includes(EST_TEXT), f.pick.price_est, `fx ${f.fx}`);
    if (f.pick.price_est) est++;
  }
  assert.ok(est > 0);
  assert.equal(html.split(EST_TEXT).length - 1, est, 'the visually-hidden text, once per estimated pick');
});

test('withdrawn with a pick and status NS: Withdrawn, struck pick, note, no kickoff time', () => {
  const r = row(EDGE_HTML, 900007);
  const f = EDGE.fixtures.find((x) => x.fx === 900007);
  assert.equal(f.status, 'NS');
  assert.equal(stateOf(r), 'withdrawn');
  assert.match(text(r), /Withdrawn/);
  assert.match(text(r), /This fixture changed after the pick was published, so the pick is not graded\./);
  assert.match(r, /fx__pick--struck/);
  assert.match(text(r), /Over 1\.5 Goals/);
  assert.ok(!text(r).includes(lagosParts(f.ko).hm), 'no kickoff time on a withdrawn row');
  assert.ok(!/Pending|Recommended pick/.test(text(r)), 'not presented as a live recommendation');
});

test('withdrawn without a pick', () => {
  const r = row(EDGE_HTML, 900008);
  assert.equal(stateOf(r), 'withdrawn');
  assert.match(text(r), /Withdrawn/);
  assert.match(text(r), /This fixture changed after it was published\./);
  assert.ok(!text(r).includes('15:30'));
});

test('late row', () => {
  const r = row(EDGE_HTML, 900009);
  assert.equal(stateOf(r), 'late');
  assert.match(text(r), /No pick — first seen less than 10 minutes before kickoff, or later\./);
  assert.match(text(r), /Live/);
});

test('no-pick row', () => {
  const r = row(EDGE_HTML, 900010);
  assert.equal(stateOf(r), 'nopick');
  assert.match(text(r), /No recommendation\./);
  assert.match(text(r), /17:00/, 'kickoff in Lagos time (16:00Z = 17:00 WAT)');
});

test('pre_ko false on a picked row: marked, not counted', () => {
  const r = row(EDGE_HTML, 900011);
  assert.match(text(r), /Kickoff was moved to a time before this pick was frozen — not counted in the ring\./);
  assert.match(r, /data-uncounted/);
  // and only there
  for (const f of EDGE.fixtures.filter((x) => x.fx !== 900011)) {
    assert.ok(!row(EDGE_HTML, f.fx).includes('Kickoff was moved'), `fx ${f.fx}`);
  }
});

test('team names carry no title attribute (no duplicate announcement)', () => {
  assert.ok(!/class="fx__team"[^>]*title=/.test(EDGE_HTML));
  assert.ok(!/<abbr|title=/.test(EDGE_HTML), 'no title attributes anywhere on the card');
});

test('label null falls back to the market key; pct null and why null degrade cleanly', () => {
  assert.match(text(row(EDGE_HTML, 900012)), /corners_over_8_5/);
  const p = row(EDGE_HTML, 900013);
  assert.match(text(p), /probability not recorded/);
  assert.ok(!/null|undefined|NaN/.test(text(p)));
  const w = row(EDGE_HTML, 900014);
  assert.ok(!/fx__why/.test(w), 'no empty why element');
  assert.ok(!/null|undefined|NaN/.test(text(EDGE_HTML)));
});

test('a 100 per-pick probability never renders as a bare 100%', () => {
  const day = structuredClone(EDGE);
  day.fixtures.find((x) => x.fx === 900005).pick.pct = 100;
  const t = text(row(renderDay(day, opts()), 900005));
  assert.ok(!t.includes('100%'));
  assert.match(t, />99%/);
});

test('status labels: Live, FT, AET, Pens, Postponed, Cancelled, Abandoned, Suspended, Time TBC, Awarded, Walkover, raw', () => {
  const want = { 900015: 'Live', 900016: 'Pens', 900017: 'AET', 900018: 'Abandoned', 900019: 'Cancelled',
    900020: 'Suspended', 900021: 'Time TBC', 900022: 'Awarded', 900023: 'Walkover', 900024: 'X<Y', 900001: 'FT' };
  for (const [fx, label] of Object.entries(want)) {
    const r = row(EDGE_HTML, fx);
    assert.ok(text(/<span class="fx__time"[^>]*>[\s\S]*?<\/span>/.exec(r)[0]).includes(label), `${fx} → ${label}`);
  }
  for (const code of ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']) assert.equal(statusLabel(code), 'Live');
  assert.equal(statusLabel('NS'), null);
  assert.equal(statusLabel('PEN'), 'Pens');
  // Own keys only: an inherited Object.prototype member is a raw code like any other.
  for (const code of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) assert.equal(statusLabel(code), code);
  assert.ok(row(EDGE_HTML, 900024).includes('X&lt;Y'), 'raw code escaped');
  // PST / CANC / TBD show no (stale) kickoff time; TBD shows "Time TBC" instead
  assert.ok(!text(row(EDGE_HTML, 900021)).includes('20:30'));
});

test('kickoff is Lagos HH:MM (23:00Z the evening before = 00:00)', () => {
  assert.match(text(row(EDGE_HTML, 900001)), /\b00:00\b/);
});

test('every row has its state text — colour is never the only channel', () => {
  for (const f of EDGE.fixtures) {
    const t = text(row(EDGE_HTML, f.fx));
    assert.ok(/Won|Lost|Push|Void|Pending|Withdrawn|No pick —|No recommendation\./.test(t), `fx ${f.fx}: ${t}`);
  }
});

// ---------------------------------------------------------------- escaping

test('hostile team, competition, label and why are escaped everywhere', () => {
  assert.ok(!EDGE_HTML.includes('<img'), 'no raw <img');
  assert.ok(!EDGE_HTML.includes('<script'), 'no raw <script');
  assert.ok(!EDGE_HTML.includes('<b>Over</b>'), 'label markup escaped');
  assert.ok(EDGE_HTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(EDGE_HTML.includes('&quot;Quotes&quot; &amp; Ampersand FC'));
  assert.ok(EDGE_HTML.includes('&quot;Quotes&quot; &amp; Ampersand Cup'));
  assert.ok(EDGE_HTML.includes('&lt;b&gt;Over&lt;/b&gt; &quot;1.5&quot; &amp; more'));
  assert.ok(EDGE_HTML.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;why&quot;'));
});

test('no inline style, no <style>, no inline script anywhere', () => {
  for (const html of [EDGE_HTML, renderDay(D07, opts({ isToday: true })), renderDay(D08, opts())]) {
    assert.ok(!/style=/i.test(html));
    assert.ok(!/<style/i.test(html));
    assert.ok(!/<script/i.test(html));
  }
});

// ---------------------------------------------------------------- header, ring, receipt

test('day header: title, long date, fixtures in competitions (never "recommended on X of Y")', () => {
  const t = text(renderDay(D08, opts({ isTomorrow: true })));
  assert.match(t, /Football predictions/);
  assert.match(t, /Thu 8 Oct 2026/);
  assert.match(t, /130 fixtures in 49 competitions/);
  assert.ok(!/\b(today|tomorrow)\b/i.test(t), 'no baked relative word (stale.js relabels in the browser)');
  assert.ok(!/recommended on/i.test(t));
  // Withdrawn rows are not fixtures on the card's count; Beta League holds only withdrawn rows.
  assert.match(text(EDGE_HTML), /23 fixtures in 5 competitions \(2 withdrawn\)/);
  assert.ok(!/\(0 withdrawn\)|withdrawn\)/.test(text(renderDay(D08, opts()))), 'no withdrawn suffix when k = 0');
});

test('count line with every row withdrawn', () => {
  const day = structuredClone(EDGE);
  day.fixtures = day.fixtures.filter((f) => f.withdrawn);
  day.accuracy = { won: 0, lost: 0, pushes: 0, graded: 0, pct: null };
  assert.match(text(renderDay(day, opts())), /0 fixtures \(2 withdrawn\)/);
});

test('receipt line: frozen stamp, grades stamp, 12-hex receipt linking to the file history', () => {
  const html = renderDay(D08, opts());
  assert.match(text(html), /Picks frozen 7 Oct 2026, 23:15 WAT · grades as of 7 Oct 2026, 23:15 WAT · receipt sha256:efd3e3a637cc/);
  assert.match(html, /href="https:\/\/github\.com\/geezerz\/betgaffer-site\/commits\/main\/days\/2026-10-08\.json"/);
  assert.ok(!text(html).includes('efd3e3a637ccf'), 'only the first 12 hex chars');
});

test('relative labels are static dates tagged for the visitor\'s clock (review I2)', () => {
  const html = renderDay(D07, opts({ isToday: true }));
  // The eyebrow is empty and hidden until stale.js knows the visitor's Lagos date.
  assert.match(html, /<p class="t-lbl day-head__rel" data-rel-day="2026-10-07" data-rel="eyebrow" hidden><\/p>/);
  // The ring carries its date; its static label is the date form, true whenever it is read.
  assert.match(html, /<div class="ring" data-figure="ring" data-rel-day="2026-10-07" data-rel="ring" /);
  assert.match(text(html), /Picks published for Wed 7 Oct 2026, settled so far/);
  assert.ok(!/Today|Tomorrow/.test(text(html)), 'isToday no longer bakes a relative word');
  assert.equal(renderDay(D07, opts({ isToday: true })), renderDay(D07, opts()), 'isToday/isTomorrow are ignored');
});

test('ring on the card: date label, and empty on a fresh day', () => {
  const today = renderDay(D07, opts({ isToday: true }));
  assert.match(today, /data-figure="ring"/);
  assert.match(text(today), /Picks published for Wed 7 Oct 2026, settled so far/);
  assert.match(text(today), /No results yet/);
  assert.match(text(EDGE_HTML), /Picks published for Tue 6 Oct 2026, settled so far/);
  assert.match(text(EDGE_HTML), /2 of 3 landed/);
  assert.match(text(EDGE_HTML), /1 push not counted/);
  assert.match(text(today), /graded record/i);
  assert.match(today, /href="\/our-record\/"/);
});

/** A hand-built row; only the fields meanStatedPct and the recount read. */
const r = (grade, pct, o = {}) => ({ fx: Math.random(), withdrawn: false, pre_ko: true, grade,
  pick: { market: 'm', label: null, pct, price: null, price_est: false, why: null }, ...o });

test('meanStatedPct: settled, counted (pre_ko, not withdrawn, won/lost) picks only', () => {
  // Unrounded: the ring rounds, so a 99.67 mean can read ">99" rather than 100.
  assert.equal(meanStatedPct(EDGE.fixtures), (82 + 78 + 84) / 3);
  assert.equal(meanStatedPct(D08.fixtures), null); // nothing settled
  assert.equal(meanStatedPct([]), null);
  // Each excluded row would MOVE the mean if it were counted (80 vs 60 / 70 / 66.7).
  const base = [r('won', 80), r('lost', 80)];
  assert.equal(meanStatedPct(base), 80);
  assert.equal(meanStatedPct([...base, r('won', 40, { pre_ko: false })]), 80, 'moved kickoff excluded');
  assert.equal(meanStatedPct([...base, r('withdrawn', 40, { withdrawn: true })]), 80, 'withdrawn excluded');
  assert.equal(meanStatedPct([...base, r('push', 40)]), 80, 'push excluded');
  assert.equal(meanStatedPct([...base, r('void', 40)]), 80, 'void excluded');
  assert.equal(meanStatedPct([...base, r('pending', 40)]), 80, 'pending excluded');
  assert.equal(meanStatedPct([...base, r('won', 40)]), 200 / 3, 'a counted pick is included');
});

test('meanStatedPct: null when ANY counted pick lacks an integer pct (never a subset mean)', () => {
  assert.equal(meanStatedPct([r('won', 80), r('won', null)]), null);
  assert.equal(meanStatedPct([r('won', 80), r('lost', 80.5)]), null);
  assert.equal(meanStatedPct([r('won', 80), r('lost', 101)]), null);
  // an uncounted row without a pct does not poison the mean
  assert.equal(meanStatedPct([r('won', 80), r('pending', null)]), 80);
});

test('meanStatedPct returns the unrounded-to-100 mean; the ring shows >= 99.5 as ">99"', () => {
  const day = structuredClone(EDGE);
  for (const fx of [900001, 900002, 900014]) {
    const f = day.fixtures.find((x) => x.fx === fx);
    f.grade = 'won';
    f.pick.pct = fx === 900002 ? 99 : 100; // mean 99.67
  }
  day.accuracy = { won: 3, lost: 0, pushes: 1, graded: 3, pct: 100 };
  const t = text(/<div class="ring"[\s\S]*?<\/div>/.exec(renderDay(day, opts()))[0]);
  assert.match(t, /stated at an average >99%/);
  assert.ok(!/average 100%/.test(t));
});

// ---------------------------------------------------------------- the ring is cross-checked against the rows

test('renderDay recounts the ring from the rows and refuses a day whose accuracy disagrees', () => {
  const variants = {
    won: (a) => { a.won += 1; a.graded += 1; a.pct = Math.round(10000 * a.won / a.graded) / 100; },
    lost: (a) => { a.lost += 1; a.graded += 1; a.pct = Math.round(10000 * a.won / a.graded) / 100; },
    pushes: (a) => { a.pushes += 1; },
    pct: (a) => { a.pct = 66.66; },
    pctNullWithGraded: (a) => { a.pct = null; },
  };
  for (const [name, mutate] of Object.entries(variants)) {
    const day = structuredClone(EDGE);
    mutate(day.accuracy);
    assert.throws(() => renderDay(day, opts()), /accuracy/, name);
  }
  // pct present on an empty day
  const empty = structuredClone(D08);
  empty.accuracy.pct = 0;
  assert.throws(() => renderDay(empty, opts()), /accuracy/);
  // a row whose grade changes without the accuracy following it
  const regraded = structuredClone(EDGE);
  regraded.fixtures.find((x) => x.fx === 900002).grade = 'won';
  assert.throws(() => renderDay(regraded, opts()), /accuracy/);
  // uncounted rows do not count: flipping the moved-kickoff row's grade changes nothing
  const moved = structuredClone(EDGE);
  moved.fixtures.find((x) => x.fx === 900011).grade = 'lost';
  assert.doesNotThrow(() => renderDay(moved, opts()));
});

test('a 100% day renders the full charter triple via renderDay', () => {
  const day = structuredClone(EDGE);
  day.fixtures.find((x) => x.fx === 900002).grade = 'won';
  day.accuracy = { won: 3, lost: 0, pushes: 1, graded: 3, pct: 100 };
  const ringHtml = /<div class="ring"[\s\S]*?<\/div>/.exec(renderDay(day, opts()))[0];
  const t = text(ringHtml);
  assert.match(t, /3 of 3 landed/);
  assert.match(t, /100%/);
  assert.match(t, /settled so far/);
  assert.match(t, /stated at an average 81%/);
});

test('every percentage sits inside data-figure="pick-prob" or data-figure="ring"', () => {
  for (const html of [EDGE_HTML, renderDay(D08, opts()), renderDay(D07, opts({ isToday: true }))]) {
    const stripped = html
      .replace(/<p class="fx__prob" data-figure="pick-prob">[\s\S]*?<\/p>/g, '')
      .replace(/<div class="ring"[^>]*data-figure="ring"[\s\S]*?<\/div>/g, '');
    assert.ok(!/\d%/.test(text(stripped)), `stray percentage: ${(/.{0,60}\d%.{0,20}/.exec(text(stripped)) || [''])[0]}`);
  }
});

// ---------------------------------------------------------------- grouping

test('competitions ordered by earliest kickoff, then name; ties broken by name', () => {
  const names = [...EDGE_HTML.matchAll(/<h2 class="comp__name">([^<]*)<\/h2>/g)].map((m) => decode(m[1]));
  assert.deepEqual(names, ['<img src=x onerror=alert(1)> League', '"Quotes" & Ampersand Cup', 'Zeta Division',
    'Alpha League', 'Beta League', 'Status Parade']);
});

test('rows within a competition run by kickoff', () => {
  const zeta = /<details class="comp"[^>]*>(?:(?!<\/details>)[\s\S])*?Zeta Division[\s\S]*?<\/details>/.exec(EDGE_HTML)[0];
  const order = [...zeta.matchAll(/data-fx="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [900011, 900005, 900006]);
});

test('real 2026-10-07: 57 groups, the first 12 open, the rest closed; order matches the rule', () => {
  const html = renderDay(D07, opts({ isToday: true }));
  const groups = [...html.matchAll(/<details class="comp"( open)?>/g)];
  assert.equal(groups.length, 57);
  assert.equal(groups.filter((g) => g[1]).length, 12);
  assert.ok(groups.slice(0, 12).every((g) => g[1]) && groups.slice(12).every((g) => !g[1]));
  const first = new Map();
  for (const f of D07.fixtures) if (!first.has(f.comp) || f.ko < first.get(f.comp)) first.set(f.comp, f.ko);
  const expected = [...first.keys()].sort((a, b) => (first.get(a) < first.get(b) ? -1 : first.get(a) > first.get(b) ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const got = [...html.matchAll(/<h2 class="comp__name">([^<]*)<\/h2>/g)].map((m) => decode(m[1]));
  assert.deepEqual(got, expected);
  // every fixture rendered exactly once
  assert.equal((html.match(/<li class="fx"/g) || []).length, 146);
});

test('group summary carries the fixture count', () => {
  assert.match(EDGE_HTML, /<summary><h2 class="comp__name">Zeta Division<\/h2>\s*<span class="comp__count[^"]*">3 fixtures<\/span><\/summary>/);
  // one heading per group, inside its summary
  assert.equal((EDGE_HTML.match(/<summary><h2 class="comp__name">/g) || []).length, 6);
});

// ---------------------------------------------------------------- footer + nav

test('"How this card was built": both fractions, no rate, no strategy key', () => {
  const html = renderDay(D08, opts());
  const foot = /<details class="day-how">[\s\S]*?<\/details>/.exec(html)[0];
  const t = text(foot);
  assert.match(t, /How this card was built/);
  assert.match(t, /At most one recommended pick per fixture, chosen from 92 priced markets\./);
  assert.match(t, /Of the 129 fixtures listed in time for a pick \(at least 10 minutes before kickoff\) that the graded record had a pick for, the card showed a pick for 120 — 120 of them the same pick the record grades — and showed no pick for 9\./);
  assert.ok(!/first listed too late/.test(t), 'D08 has no late row, so no late sentence');
  assert.match(t, /Pushes are not counted; void picks, withdrawn picks and picks whose kickoff was moved to before they were frozen are shown but not counted in the ring\./);
  assert.match(t, /Prices marked est\. are estimates: no market price was captured for them\./);
  assert.ok(!t.includes('%'));
  assert.ok(!/edge_reliability|probability_range/.test(html), 'internal keys never rendered');
});

test('"How this card was built" with nothing checked yet', () => {
  const day = structuredClone(D08);
  Object.assign(day.pick_source, { ledger_match_n: 0, ledger_match_matched: 0, ledger_match_served_n: 0, ledger_match_unserved: 0, ledger_match_rate: null });
  const t = text(/<details class="day-how">[\s\S]*?<\/details>/.exec(renderDay(day, opts()))[0]);
  assert.ok(!/Of the 0 fixtures/.test(t));
  assert.match(t, /No fixture on this card has been checked against the graded record\./);
  assert.ok(!/\byet\b/.test(t));
});

const howText = (day) => text(/<details class="day-how">[\s\S]*?<\/details>/.exec(renderDay(day, opts()))[0]);
const LATE_NOTE = 'Fixtures first listed too late carry no pick here; the graded record may still include them.';

test('"How this card was built": no "showed no pick" clause when every checked fixture was served', () => {
  const t = howText(D07); // pick_source 7 / 7 / 7, unserved 0
  assert.match(t, /Of the 7 fixtures listed in time for a pick \(at least 10 minutes before kickoff\) that the graded record had a pick for, the card showed a pick for 7 — 7 of them the same pick the record grades\./);
  assert.ok(!/showed no pick/.test(t), t);
  const one = structuredClone(D08);
  Object.assign(one.pick_source, { ledger_match_n: 1, ledger_match_served_n: 1, ledger_match_matched: 1, ledger_match_unserved: 0 });
  assert.match(howText(one), /Of the 1 fixture listed in time for a pick \(at least 10 minutes before kickoff\) that the graded record had a pick for, the card showed a pick for 1 — 1 of them the same pick the record grades\./);
});

test('"How this card was built": a day with late rows says they carry no pick but may still be graded', () => {
  assert.ok(D07.fixtures.some((f) => f.late === true) && EDGE.fixtures.some((f) => f.late === true), 'premise: late rows exist');
  for (const day of [D07, EDGE]) assert.ok(howText(day).includes(LATE_NOTE), day.lagos_day);
  assert.ok(!howText(D08).includes(LATE_NOTE), 'no late row, no note');
  // also when nothing was checked yet
  const none = structuredClone(D07);
  Object.assign(none.pick_source, { ledger_match_n: 0, ledger_match_matched: 0, ledger_match_served_n: 0, ledger_match_unserved: 0, ledger_match_rate: null });
  const t = howText(none);
  assert.match(t, /No fixture on this card has been checked against the graded record\./);
  assert.ok(t.includes(LATE_NOTE));
  // EDGE: 12 checked, 10 served, 9 the same, 2 not served
  assert.match(howText(EDGE), /Of the 12 fixtures listed in time for a pick \(at least 10 minutes before kickoff\) that the graded record had a pick for, the card showed a pick for 10 — 9 of them the same pick the record grades — and showed no pick for 2\./);
});

test('prev / next day links when given, none otherwise', () => {
  assert.match(EDGE_HTML, /<a [^>]*href="\/day\/2026-10-05\/"[^>]*rel="prev"/);
  assert.match(EDGE_HTML, /<a [^>]*href="\/day\/2026-10-07\/"[^>]*rel="next"/);
  assert.match(text(EDGE_HTML), /Mon 5 Oct 2026/);
  const none = renderDay(D08, opts());
  assert.ok(!/rel="prev"|rel="next"/.test(none));
});

// ---------------------------------------------------------------- edge inputs

test('zero fixtures: header, empty ring and an explicit empty state, no groups', () => {
  const day = { ...structuredClone(D08), fixtures: [], counts: { ...D08.counts, fixtures: 0 } };
  const html = renderDay(day, opts({ isToday: true }));
  const t = text(html);
  assert.match(t, /No fixtures were scheduled in the competitions we cover on Thu 8 Oct 2026\./);
  assert.match(t, /0 fixtures/);
  assert.ok(!/<details class="comp"/.test(html));
  assert.match(t, /No results yet/);
});

test('rejects what it cannot render honestly', () => {
  assert.throws(() => renderDay(D08, opts({ repo: undefined })), TypeError);
  assert.throws(() => renderDay(D08, opts({ repo: 'evil"><x' })), TypeError);
  assert.throws(() => renderDay({ ...D08, fixtures: undefined }, opts()), TypeError, 'a compacted day has no card');
  assert.throws(() => renderDay(D08, opts({ prevDay: '2026-13-01' })), TypeError);
  for (const fx of [900001, 900007, 900010]) { // picked, withdrawn, no pick
    const bad = structuredClone(EDGE);
    bad.fixtures.find((x) => x.fx === fx).grade = 'mystery';
    assert.throws(() => renderDay(bad, opts()), /grade/, `fx ${fx}`);
  }
});

// ---------------------------------------------------------------- module + stylesheet contract

test('isomorphic: imports only ./esc.js, ./time.js, ./ring.js; no node: / process / Buffer', () => {
  const specs = [...SRC.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.ok(['./esc.js', './time.js', './ring.js'].includes(s), `unexpected import ${s}`);
  assert.ok(!/\bnode:/.test(SRC));
  assert.ok(!/\bprocess\b/.test(SRC));
  assert.ok(!/\bBuffer\b/.test(SRC));
});

test('fixtures.css exists and styles every class the renderer emits', () => {
  assert.ok(existsSync(CSS_PATH));
  const css = readFileSync(CSS_PATH, 'utf8');
  assert.ok(!/@import/.test(css));
  const classes = new Set();
  for (const m of (EDGE_HTML + renderDay(D07, opts({ isToday: true }))).matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) classes.add(c);
  }
  const base = readFileSync(here('../site/assets/css/base.css'), 'utf8');
  for (const c of classes) {
    const re = new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`);
    assert.ok(re.test(css) || re.test(base), `.${c} has a rule in fixtures.css or base.css`);
  }
  // an uncounted row's grade chip is dashed, not faded (fading would hurt contrast)
  assert.match(css, /\.fx\[data-uncounted\] \.fx__grade\{[^}]*border-style:dashed/);
  assert.ok(!/opacity/.test(css), 'no opacity-based state');
  // the summary heading keeps the summary's look (no default h2 margins/size)
  assert.match(css, /\.comp__name\{[^}]*margin:0[^}]*font-size:13\.5px/);
  // touch targets: summaries and links in the card get the 44px token
  assert.match(css, /\.comp > summary\{[^}]*min-height:var\(--tap\)/);
  // the gold token is for the recommended pick only
  for (const m of css.matchAll(/([^{}]+)\{[^}]*var\(--gold\)/g)) {
    assert.match(m[1], /bg-eyebrow|bg-star/, `--gold used outside the pick eyebrow: ${m[1].trim()}`);
  }
});
