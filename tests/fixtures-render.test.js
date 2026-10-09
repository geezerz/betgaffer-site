import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderDay, receiptCode, meanStatedPct, statusLabel, EST_TEXT, ruleOf, isCounted } from '../site/lib/fixtures.js';
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

const opts = (o = {}) => ({ isToday: false, isTomorrow: false, prevDay: null, nextDay: null, ...o });

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
/** The row's data-phase, or null when it carries none (spec §17.2). Reads the <li> tag only. */
const phaseAttr = (rowHtml) => /data-phase="([^"]*)"/.exec(/^<li[^>]*>/.exec(rowHtml)[0])?.[1] ?? null;

// Spec §17.2: every provider status belongs to exactly one phase. `pre` is "everything else": NS,
// TBD, an unknown code, and inherited Object.prototype names (a lookup must use own members only).
const PHASES = Object.freeze({
  live: ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'],
  done: ['FT', 'AET', 'PEN', 'AWD', 'WO'],
  off: ['PST', 'CANC', 'ABD', 'SUSP'],
  pre: ['NS', 'TBD', 'X<Y', 'ZZZ', 'toString', '__proto__'],
});
const expectedPhase = (status) => Object.keys(PHASES).find((p) => p !== 'pre' && PHASES[p].includes(status)) ?? 'pre';

/** A copy of a day with some rows' status replaced: Map fx → status, or one status for every row. */
function withStatus(day, statuses) {
  const copy = structuredClone(day);
  for (const f of copy.fixtures) {
    if (typeof statuses === 'string') f.status = statuses;
    else if (statuses.has(f.fx)) f.status = statuses.get(f.fx);
  }
  return copy;
}

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
  // 900005 is NS + pending: before kickoff it shows no chip (spec §17.2, tested below), so the
  // Pending chip is checked on the same row once its match is in play (2H).
  const inPlay = renderDay(withStatus(EDGE, new Map([[900005, '2H']])), opts());
  const cases = [[EDGE_HTML, 900001, 'won', 'Won'], [EDGE_HTML, 900002, 'lost', 'Lost'], [EDGE_HTML, 900003, 'push', 'Push'],
    [EDGE_HTML, 900004, 'void', 'Void'], [inPlay, 900005, 'pending', 'Pending']];
  for (const [html, fx, state, chip] of cases) {
    const r = row(html, fx);
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
  // A pending pick whose match has not started (pre) or will not be played as listed (off) has no
  // chip and no edge colour (spec §17.2): its words are "Recommended pick" and nothing claims a grade.
  let quiet = 0;
  for (const f of EDGE.fixtures) {
    const r = row(EDGE_HTML, f.fx);
    const t = text(r);
    if (stateOf(r) === 'pending' && ['pre', 'off'].includes(phaseAttr(r))) {
      quiet++;
      assert.match(t, /★ Recommended pick/, `fx ${f.fx}: ${t}`);
      assert.ok(!/Won|Lost|Push|Void|Pending/.test(t), `fx ${f.fx}: no grade word before kickoff: ${t}`);
      continue;
    }
    assert.ok(/Won|Lost|Push|Void|Pending|Withdrawn|No pick —|No recommendation\./.test(t), `fx ${f.fx}: ${t}`);
  }
  assert.ok(quiet > 0, 'premise: the edge day has pending picks before kickoff');
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

test('receipt line: frozen stamp, grades stamp, 12-hex receipt code as plain text (spec §10)', () => {
  const html = renderDay(D08, opts());
  const line = /<p class="day-receipt mono">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(line, 'the receipt line is rendered');
  assert.equal(line[1], 'Picks frozen 7 Oct 2026, 23:15 WAT · grades as of 7 Oct 2026, 23:15 WAT · receipt <span class="mono">efd3e3a637cc</span>');
  assert.doesNotMatch(line[1], /<a\b|href=/, 'the receipt links nowhere');
  assert.ok(!text(html).includes('sha256:'), 'the code is printed without its algorithm prefix');
  assert.ok(!text(html).includes('efd3e3a637ccf'), 'only the first 12 hex chars');
  assert.doesNotMatch(html, /github|commits\/main/i);
});

test('receiptCode: the 12 hex after "sha256:", and nothing it cannot vouch for', () => {
  assert.equal(receiptCode(D08.picks_hash), 'efd3e3a637cc');
  for (const bad of [undefined, null, 'efd3e3a637cc', `sha256:${'A'.repeat(64)}`, `sha256:${'a'.repeat(63)}`, `sha1:${'a'.repeat(64)}`]) {
    assert.throws(() => receiptCode(bad), TypeError, String(bad));
  }
});

test('a leftover repo option is ignored: the card is the same with or without it', () => {
  assert.equal(renderDay(D08, { ...opts(), repo: 'geezerz/betgaffer-site' }), renderDay(D08, opts()));
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
  assert.equal(meanStatedPct(EDGE.fixtures, 1), (82 + 78 + 84) / 3);
  assert.equal(meanStatedPct(D08.fixtures, 1), null); // nothing settled
  assert.equal(meanStatedPct([], 1), null);
  // Each excluded row would MOVE the mean if it were counted (80 vs 60 / 70 / 66.7).
  const base = [r('won', 80), r('lost', 80)];
  assert.equal(meanStatedPct(base, 1), 80);
  assert.equal(meanStatedPct([...base, r('won', 40, { pre_ko: false })], 1), 80, 'moved kickoff excluded');
  assert.equal(meanStatedPct([...base, r('withdrawn', 40, { withdrawn: true })], 1), 80, 'withdrawn excluded');
  assert.equal(meanStatedPct([...base, r('push', 40)], 1), 80, 'push excluded');
  assert.equal(meanStatedPct([...base, r('void', 40)], 1), 80, 'void excluded');
  assert.equal(meanStatedPct([...base, r('pending', 40)], 1), 80, 'pending excluded');
  assert.equal(meanStatedPct([...base, r('won', 40)], 1), 200 / 3, 'a counted pick is included');
});

test('meanStatedPct: null when ANY counted pick lacks an integer pct (never a subset mean)', () => {
  assert.equal(meanStatedPct([r('won', 80), r('won', null)], 1), null);
  assert.equal(meanStatedPct([r('won', 80), r('lost', 80.5)], 1), null);
  assert.equal(meanStatedPct([r('won', 80), r('lost', 101)], 1), null);
  // an uncounted row without a pct does not poison the mean
  assert.equal(meanStatedPct([r('won', 80), r('pending', null)], 1), 80);
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

// ---------------------------------------------------------------- one flat list by kickoff (spec §5)

/** Row fx ids in document order. */
const fxOrder = (html) => [...html.matchAll(/<li class="fx"[^>]*\sdata-fx="(\d+)"/g)].map((m) => Number(m[1]));
const cp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const TOOLS = '<div class="day-tools" data-day-tools hidden></div>';

test('one flat list: no competition groups, one <ol data-fx-list> holding every row', () => {
  for (const [day, n] of [[EDGE, 25], [D07, 146], [D08, 130]]) {
    const html = renderDay(day, opts());
    assert.ok(!/<details class="comp"/.test(html), `${day.lagos_day}: no competition group`);
    assert.ok(!/comp__|day-groups|<h2/.test(html), `${day.lagos_day}: no group heading or wrapper`);
    const lists = [...html.matchAll(/<ol class="fx-list" role="list" data-fx-list>([\s\S]*?)<\/ol>/g)];
    assert.equal(lists.length, 1, `${day.lagos_day}: exactly one list`);
    assert.ok(!/<ul\b|<ol\b/.test(html.replace(lists[0][0], '')), `${day.lagos_day}: no other list`);
    assert.equal((lists[0][1].match(/<li class="fx"/g) || []).length, n, `${day.lagos_day}: every row once, inside it`);
    assert.equal(new Set(fxOrder(html)).size, n);
  }
});

test('order: kickoff, then competition, then home team, then fx (edge day, hand-checked)', () => {
  assert.deepEqual(fxOrder(EDGE_HTML), [
    900001, //                 05T23:00
    900004, 900003, //         10:00 same comp: "Postponed Home" < "Push Home"
    900014, 900002, 900011, 900005, 900006,
    900009, 900007, //         14:00 "Alpha League" < "Beta League" (the withdrawn row sorts like any other)
    900008, 900010,
    900012, 900013, //         18:00 same comp: "Label…" < "Pct…"
    900017, 900015, 900016, // 19:00 Extra < Halftime < Penalties
    900018, 900019, 900020,
    900022, 900021, 900023, // 19:30 Awarded < Unscheduled < Walkover
    900025, 900024, //         20:00 "Club…" < "Raw…"
  ]);
});

test('order ties: same kickoff -> competition by code point (not localeCompare) -> home -> fx; input order is irrelevant', () => {
  assert.ok('Ägypten Cup'.localeCompare('Zambia Cup', 'en') < 0, 'premise: a locale sort puts Ägypten first');
  const day = structuredClone(EDGE);
  const at = (fx) => day.fixtures.find((f) => f.fx === fx);
  const KO = '2026-10-06T21:00:00Z';
  // Home beats fx: 900010 has the lowest fx but the later home name.
  Object.assign(at(900010), { ko: KO, comp: 'Zambia Cup', home: 'B' });
  Object.assign(at(900012), { ko: KO, comp: 'Ägypten Cup', home: 'A' });
  Object.assign(at(900013), { ko: KO, comp: 'Zambia Cup', home: 'A' });
  Object.assign(at(900025), { ko: KO, comp: 'Zambia Cup', home: 'A' });
  // Kickoff beats competition: the last name by code point kicks off first.
  Object.assign(at(900024), { ko: '2026-10-06T20:59:00Z', comp: 'Zzz Last By Name', home: 'Zzz' });
  // 900025 before 900013 in the input: the fx tie-break, not the input order, decides.
  const i13 = day.fixtures.indexOf(at(900013));
  const i25 = day.fixtures.indexOf(at(900025));
  [day.fixtures[i13], day.fixtures[i25]] = [day.fixtures[i25], day.fixtures[i13]];
  assert.ok(day.fixtures.indexOf(at(900025)) < day.fixtures.indexOf(at(900013)), 'premise: input order reversed');
  const order = fxOrder(renderDay(day, opts()));
  assert.deepEqual(order.slice(-5), [900024, 900013, 900025, 900010, 900012]);
  assert.deepEqual(EDGE.fixtures.map((f) => f.fx), EDGE_RAW.fixtures.map((f) => f.fx), 'renderDay does not reorder its input');
});

test('real 2026-10-07: the list follows the rule, including kickoff ties', () => {
  const html = renderDay(D07, opts());
  const want = [...D07.fixtures]
    .sort((a, b) => cp(a.ko, b.ko) || cp(a.comp, b.comp) || cp(a.home, b.home) || a.fx - b.fx)
    .map((f) => f.fx);
  assert.ok(new Set(D07.fixtures.map((f) => f.ko)).size < D07.fixtures.length, 'premise: kickoff ties exist');
  assert.deepEqual(fxOrder(html), want);
});

test('rows: id="fx-{fx}", data-ko, data-status (escaped); no data-home/away/comp; the competition is the first line', () => {
  for (const f of EDGE.fixtures) {
    const r = row(EDGE_HTML, f.fx);
    const open = /^<li [^>]*>/.exec(r)[0];
    assert.ok(open.startsWith('<li class="fx" '), `fx ${f.fx}: class first`);
    assert.ok(open.includes(` id="fx-${f.fx}"`), `fx ${f.fx}: id`);
    assert.ok(open.includes(` data-ko="${f.ko}"`), `fx ${f.fx}: data-ko`);
    const st = f.status.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(open.includes(` data-status="${st}"`), `fx ${f.fx}: data-status ${st}`);
    assert.ok(!/data-(home|away|comp)=/.test(open), `fx ${f.fx}: no per-row name attributes`);
    const comp = /^<li [^>]*><p class="fx__comp">([^<]*)<\/p>/.exec(r);
    assert.ok(comp, `fx ${f.fx}: .fx__comp is the row's first child`);
    assert.equal(decode(comp[1]), f.comp);
  }
  assert.ok(row(EDGE_HTML, 900024).includes('data-status="X&lt;Y"'), 'premise: a hostile status is escaped');
  assert.ok(row(EDGE_HTML, 900001).includes('<p class="fx__comp">&lt;img src=x onerror=alert(1)&gt; League</p>'));
  assert.ok(row(EDGE_HTML, 900003).includes('<p class="fx__comp">&quot;Quotes&quot; &amp; Ampersand Cup</p>'));
  assert.equal((EDGE_HTML.match(/ id="fx-/g) || []).length, 25, 'one id per row');
});

test('an empty competition reads "Competition not named"', () => {
  const day = structuredClone(EDGE);
  day.fixtures.find((f) => f.fx === 900010).comp = '';
  assert.match(row(renderDay(day, opts()), 900010), /<p class="fx__comp">Competition not named<\/p>/);
});

test('a non-string competition or home team is refused (the sort compares them)', () => {
  for (const [k, v] of [['comp', 7], ['comp', null], ['home', 7], ['home', undefined]]) {
    const day = structuredClone(EDGE);
    day.fixtures.find((f) => f.fx === 900010)[k] = v;
    assert.throws(() => renderDay(day, opts()), TypeError, `${k} = ${v}`);
  }
});

test('no "Jump to now" link and no build-clock state in the static card', () => {
  for (const html of [EDGE_HTML, renderDay(D07, opts()), renderDay(D08, opts())]) {
    assert.ok(!/data-jump-now|Jump to now/i.test(html));
  }
});

test('toolbar slot: empty, hidden, after the header and before the day bar and list', () => {
  const html = EDGE_HTML;
  assert.equal(html.split(TOOLS).length - 1, 1, 'exactly one slot, exactly this markup');
  const slot = html.indexOf(TOOLS);
  assert.ok(html.indexOf('</header>') < slot, 'after the day header');
  assert.ok(slot < html.indexOf('<p class="day-bar">'), 'before the day bar');
  assert.ok(html.indexOf('<p class="day-bar">') < html.indexOf('<ol class="fx-list"'), 'day bar before the list');
});

test('the day card has no beforeList slot: the founding card lives under the header (layout.page()), so the option is gone', () => {
  const MARK = '<section class="probe">before the list</section>';
  assert.equal(renderDay(EDGE, opts({ beforeList: MARK, prevDay: '2026-10-05', nextDay: '2026-10-07' })), EDGE_HTML, 'an old caller\'s beforeList is ignored, never rendered');
  assert.doesNotMatch(readFileSync(new URL('../site/lib/fixtures.js', import.meta.url), 'utf8'), /beforeList/);
});
test('day bar: date tagged for relabelling, non-withdrawn count, "by kickoff"', () => {
  assert.ok(EDGE_HTML.includes('<p class="day-bar"><span data-rel-day="2026-10-06" data-rel="daybar">Tue 6 Oct 2026</span> · 23 fixtures · by kickoff</p>'));
  const one = structuredClone(EDGE);
  one.fixtures = one.fixtures.filter((f) => f.fx === 900010 || f.withdrawn);
  one.accuracy = { won: 0, lost: 0, pushes: 0, graded: 0, pct: null };
  assert.ok(renderDay(one, opts()).includes('</span> · 1 fixture · by kickoff</p>'), 'singular; withdrawn rows not counted');
  const d08 = renderDay(D08, opts());
  assert.ok(d08.includes('<span data-rel-day="2026-10-08" data-rel="daybar">Thu 8 Oct 2026</span> · 130 fixtures · by kickoff'));
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
  assert.match(t, /The list shows every fixture we cover that day, with or without a pick\. Pushes are not counted; void picks, withdrawn picks and picks whose kickoff was moved to before they were frozen are shown but not counted in the ring\./);
  assert.ok(!/Each competition/.test(t), 'no grouping left in the copy');
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
  // Nothing to search or count: no toolbar slot, day bar or list.
  assert.ok(!/data-day-tools|day-bar|data-rel="daybar"|<ol\b|<ul\b/.test(html));
  // The empty state follows the header directly.
  assert.ok(html.indexOf('</header><div class="bg-empty day-empty">') > 0, 'header, then the empty state');
});

test('rejects what it cannot render honestly', () => {
  assert.throws(() => renderDay({ ...D08, picks_hash: 'sha256:short' }, opts()), TypeError, 'no receipt code it cannot vouch for');
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
  // the competition groups are gone, and so are their rules
  assert.ok(!/\.comp(?![\w-])|\.comp__|\.day-groups/.test(css), 'no dead .comp* / .day-groups rules');
  // the gold token is for the recommended pick only
  for (const m of css.matchAll(/([^{}]+)\{[^}]*var\(--gold\)/g)) {
    assert.match(m[1], /bg-eyebrow|bg-star/, `--gold used outside the pick eyebrow: ${m[1].trim()}`);
  }
});

/** Top-level rules of a stylesheet (at-rule blocks removed) as [selectors[], body]. */
function topRules(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[\w-]+[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1].split(',').map((s) => s.trim()), m[2]]);
}
const bodyOf = (rules, sel) => rules.filter(([s]) => s.includes(sel)).map(([, b]) => b).join(';');

test('fixtures.css: hiding really hides, rows are virtualised, the competition line is first', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const top = topRules(css);
  // .fx is display:grid, which beats the UA [hidden] rule: the explicit rule must exist.
  assert.match(bodyOf(top, '.fx'), /display:grid/, 'premise: rows set a display');
  assert.match(bodyOf(top, '.fx[hidden]'), /display:none/);
  assert.match(bodyOf(top, '[data-day-tools][hidden]'), /display:none/);
  // content-visibility with an intrinsic size per container width (narrow card / wide rail).
  const fx = bodyOf(top, '.fx');
  assert.match(fx, /content-visibility:auto/);
  const narrow = /contain-intrinsic-size:auto (\d+)px/.exec(fx);
  assert.ok(narrow, 'narrow intrinsic size');
  const wide = /@container \(min-width:720px\)\{([\s\S]*?)\n\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.ok(wide, 'the wide-row container rule exists');
  const wideFx = /(?:^|\s)\.fx\{([^}]*)\}/.exec(wide[1]);
  const wideSize = /contain-intrinsic-size:auto (\d+)px/.exec(wideFx ? wideFx[1] : '');
  assert.ok(wideSize, 'wide intrinsic size');
  assert.notEqual(wideSize[1], narrow[1], 'one value per layout');
  // content-box hints: with ~24-26px padding/border they approximate measured medians (197 narrow, 113 wide)
  assert.equal(narrow[1], '172');
  assert.equal(wideSize[1], '88');
  // the competition line takes row 1; time and teams move down; the wide rail spans both rows
  const comp = bodyOf(top, '.fx__comp');
  for (const d of [/grid-row:1/, /white-space:nowrap/, /overflow:hidden/, /text-overflow:ellipsis/, /min-width:0/]) assert.match(comp, d);
  for (const sel of ['.fx__time', '.fx__teams']) {
    assert.match(bodyOf(top, sel), /grid-row:2/, sel);
    assert.doesNotMatch(bodyOf(top, sel), /grid-row:1(?!\d)/, sel);
  }
  assert.match(bodyOf(top, '.fx__pick'), /grid-row:3/);
  assert.match(wide[1], /\.fx__pick\{[^}]*grid-row:1 \/ span 2/);
  assert.match(css, /\.day-bar\{/);
});

// ---------------------------------------------------------------- spec §16: accuracy rule 2, scores

// The publisher's real 2026-10-08 file as a rule-2 day: scores on finished rows (one AET, one PEN),
// 558451 late WITH a pick, 558454 picked with pre_ko false, 147972 late without a pick.
const R2_RAW = readJson('./fixtures/rule2-day.json');
const R2 = validateDay(R2_RAW, { expectDate: '2026-10-08' });
const R2_HTML = renderDay(R2, opts());
const FINISHED = new Set(['FT', 'AET', 'PEN']);
const scoreSpans = (html) => [...html.matchAll(/<span class="fx__score mono">([\s\S]*?)<\/span>/g)].map((m) => m[1]);

test('ruleOf: absent -> 1, else exactly 1 or 2; anything else throws', () => {
  assert.equal(ruleOf({}), 1);
  assert.equal(ruleOf(EDGE_RAW), 1);
  assert.equal(ruleOf({ accuracy_rule: 1 }), 1);
  assert.equal(ruleOf({ accuracy_rule: 2 }), 2);
  assert.equal(ruleOf(R2_RAW), 2);
  for (const bad of [0, 3, '2', null, 1.5, true, [], {}]) assert.throws(() => ruleOf({ accuracy_rule: bad }), TypeError, JSON.stringify(bad));
  const day = structuredClone(EDGE_RAW);
  day.accuracy_rule = '2';
  assert.throws(() => renderDay(day, opts()), /accuracy_rule/, 'a raw archive file with a bad rule is refused');
});

test('isCounted: rule 1 needs pre_ko; rule 2 counts every non-withdrawn won/lost pick', () => {
  const moved = r('won', 80, { pre_ko: false });
  assert.equal(isCounted(moved, 1), false);
  assert.equal(isCounted(moved, 2), true);
  assert.equal(isCounted(r('lost', 80, { pre_ko: false, late: true }), 2), true);
  for (const rule of [1, 2]) {
    assert.equal(isCounted(r('won', 80), rule), true);
    assert.equal(isCounted(r('withdrawn', 80, { withdrawn: true }), rule), false);
    assert.equal(isCounted(r('won', 80, { withdrawn: true }), rule), false);
    for (const g of ['push', 'void', 'pending']) assert.equal(isCounted(r(g, 80), rule), false, `${g} rule ${rule}`);
    assert.equal(isCounted({ fx: 1, withdrawn: false, pre_ko: true, grade: null, pick: null }, rule), false);
  }
  for (const bad of [undefined, 0, 3, '1']) assert.throws(() => isCounted(r('won', 80), bad), TypeError);
});

test('meanStatedPct takes the rule: a moved-kickoff pick counts under rule 2 only', () => {
  const base = [r('won', 80), r('lost', 80)];
  assert.equal(meanStatedPct([...base, r('won', 40, { pre_ko: false })], 1), 80);
  assert.equal(meanStatedPct([...base, r('won', 40, { pre_ko: false })], 2), 200 / 3);
  assert.equal(meanStatedPct([...base, r('won', 40, { withdrawn: true })], 2), 80, 'withdrawn never counts');
  const counted = R2.fixtures.filter((f) => !f.withdrawn && f.pick && (f.grade === 'won' || f.grade === 'lost'));
  assert.ok(counted.some((f) => f.fx === 558451) && counted.some((f) => f.fx === 558454), 'premise');
  assert.equal(meanStatedPct(R2.fixtures, 2), counted.reduce((s, f) => s + f.pick.pct, 0) / counted.length);
  assert.notEqual(meanStatedPct(R2.fixtures, 1), meanStatedPct(R2.fixtures, 2));
  for (const bad of [undefined, 0, 3, '2']) assert.throws(() => meanStatedPct(base, bad), TypeError, String(bad));
});

test('rule 2: the ring counts every non-withdrawn pick, and there is no "accept either" loophole', () => {
  assert.match(text(R2_HTML), /48 of 55 landed/);
  // The same rows read under rule 1 drop the two moved-kickoff wins: refused.
  const asRule1 = structuredClone(R2_RAW);
  delete asRule1.accuracy_rule;
  assert.throws(() => renderDay(asRule1, opts()), /accuracy/);
  // A rule-1 file relabelled rule 2 counts its moved-kickoff row (900011): refused.
  const edge2 = structuredClone(EDGE_RAW);
  edge2.accuracy_rule = 2;
  assert.throws(() => renderDay(edge2, opts()), /accuracy/);
  // ... and with the rule-2 recount it renders.
  edge2.accuracy = { won: 3, lost: 1, pushes: 1, graded: 4, pct: 75 };
  assert.match(text(renderDay(edge2, opts())), /3 of 4 landed/);
});

test('rule 2: a 100% day states the mean of every counted pick, moved kickoff included', () => {
  const day = structuredClone(EDGE_RAW);
  day.accuracy_rule = 2;
  day.fixtures.find((x) => x.fx === 900002).grade = 'won';
  day.accuracy = { won: 4, lost: 0, pushes: 1, graded: 4, pct: 100 };
  const counted = day.fixtures.filter((f) => !f.withdrawn && f.pick && f.grade === 'won');
  assert.equal(counted.length, 4);
  assert.ok(counted.some((f) => f.fx === 900011), 'premise: the moved-kickoff pick is one of them');
  const mean = Math.round(counted.reduce((s, f) => s + f.pick.pct, 0) / 4);
  assert.match(text(/<div class="ring"[\s\S]*?<\/div>/.exec(renderDay(day, opts()))[0]), new RegExp(`stated at an average ${mean}%`));
});

test('rule 2: no late / moved notes, no uncounted marker; a late row with a pick renders like any pick', () => {
  const t = text(R2_HTML);
  assert.ok(!t.includes('No pick — first seen'), 'no late note');
  assert.ok(!t.includes('Kickoff was moved'), 'no moved note');
  assert.ok(!/data-uncounted|fx__note/.test(R2_HTML));
  assert.ok(!/data-state="late"/.test(R2_HTML));
  for (const fx of [558451, 558454]) {
    const rw = row(R2_HTML, fx);
    assert.equal(stateOf(rw), 'won', `fx ${fx}`);
    assert.match(text(rw), /★ Recommended pick/);
    assert.match(rw, /data-figure="pick-prob"/);
  }
  const bare = row(R2_HTML, 147972);
  assert.equal(stateOf(bare), 'nopick');
  assert.match(text(bare), /^Serie A \(Brazil\) .* No recommendation\.$/);
  // EDGE as rule 2 (recounted): its late row and moved row lose their notes too.
  const edge2 = structuredClone(EDGE);
  edge2.accuracy_rule = 2;
  edge2.accuracy = { won: 3, lost: 1, pushes: 1, graded: 4, pct: 75 };
  const h = renderDay(edge2, opts());
  assert.equal(stateOf(row(h, 900009)), 'nopick');
  assert.match(text(row(h, 900009)), /No recommendation\./);
  assert.ok(!/data-uncounted|fx__note|Kickoff was moved|first seen/.test(h));
  // while rule 1 (EDGE as published) keeps them
  assert.match(EDGE_HTML, /data-uncounted/);
  assert.match(text(EDGE_HTML), /Kickoff was moved/);
  assert.match(text(EDGE_HTML), /No pick — first seen/);
});

test('rule 2: "How this card was built" names the card pick and drops every late / moved / 10-minute sentence', () => {
  const t = howText(R2);
  assert.match(t, /^How this card was built At most one recommended pick per fixture — the platform's card pick — graded after full time\. /);
  assert.match(t, /Of the 111 fixtures checked against the graded record when first listed, the card showed a pick for 107 — 107 of them the same pick the record grades — and showed no pick for 4\./);
  assert.match(t, /The list shows every fixture we cover that day, with or without a pick\. Pushes are not counted; void picks and withdrawn picks are shown but not counted in the ring\./);
  assert.match(t, /Prices marked est\. are estimates: no market price was captured for them\./);
  assert.ok(!/10 minutes|\blate\b|too late|moved|in time|priced markets/i.test(t), t);
  assert.ok(!t.includes('%'));
  // nothing checked yet
  const none = structuredClone(R2);
  Object.assign(none.pick_source, { ledger_match_n: 0, ledger_match_matched: 0, ledger_match_served_n: 0, ledger_match_unserved: 0, ledger_match_rate: null });
  assert.match(howText(none), /No fixture on this card has been checked against the graded record\./);
  // rule 1 keeps the old copy
  assert.match(howText(EDGE), /At most one recommended pick per fixture, chosen from 92 priced markets\./);
  assert.ok(howText(EDGE).includes(LATE_NOTE));
});

test('the archive renders the raw file: raw and validated rule-2 / rule-1 days give the same card', () => {
  assert.equal(renderDay(R2_RAW, opts()), R2_HTML);
  assert.equal(renderDay(D07_RAW, opts()), renderDay(D07, opts()));
  assert.equal(renderDay(EDGE_RAW, opts()), renderDay(EDGE, opts()));
});

const xtras = (html) => [...html.matchAll(/<small class="fx__xtra mono">([\s\S]*?)<\/small>/g)].map((m) => m[1]);
const S = (home, away, o = {}) => ({ home, away, aet_home: null, aet_away: null, pen_home: null, pen_away: null, ...o });

test('scores: the 90-minute result beside each team on finished rows only (FT / AET / PEN)', () => {
  const scored = R2.fixtures.filter((f) => !f.withdrawn && FINISHED.has(f.status) && f.score !== null);
  assert.ok(scored.length > 50 && scored.some((f) => f.status === 'AET') && scored.some((f) => f.status === 'PEN'), 'premise');
  assert.equal(scoreSpans(R2_HTML).length, 2 * scored.length, 'two scores per finished row, none elsewhere');
  for (const f of scored) {
    const rw = row(R2_HTML, f.fx);
    const home = f.home.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    assert.ok(rw.includes(`<span class="fx__teams fx__teams--scored"><span class="fx__team">${home}</span><span class="vh">: </span><span class="fx__score mono">${f.score.home}</span>`), `fx ${f.fx} home`);
    // a screen reader hears "Team: 2 v Other: 3", never a name ending in a digit run into its score
    const away = f.away.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    assert.ok(rw.includes(`<span class="fx__team">${away}</span><span class="vh">: </span><span class="fx__score mono">${f.score.away}</span>`), `fx ${f.fx} away`);
    // the two digits are the score and nothing else (the extra lines are their own elements)
    assert.deepEqual(scoreSpans(rw), [String(f.score.home), String(f.score.away)], `fx ${f.fx}`);
    const want = f.status === 'PEN' ? [`a.e.t. ${f.score.aet_home}–${f.score.aet_away}`, 'pens 4–3']
      : f.status === 'AET' ? [`a.e.t. ${f.score.aet_home}–${f.score.aet_away}`] : [];
    assert.deepEqual(xtras(rw), want, `fx ${f.fx} ${f.status}`);
  }
  // the AET premise: 90 minutes 1–1, after extra time 2–1, and the card says both
  const aet = R2.fixtures.find((f) => f.status === 'AET');
  assert.notEqual(aet.score.home, aet.score.aet_home, 'premise: extra time changed the score');
  assert.match(text(row(R2_HTML, aet.fx)), new RegExp(`${aet.score.home} .* ${aet.score.away} a\\.e\\.t\\. ${aet.score.aet_home}–${aet.score.aet_away}`));
  // the extra lines follow the away score, inside the teams block
  const pen = row(R2_HTML, R2.fixtures.find((f) => f.status === 'PEN').fx);
  assert.match(pen, /<span class="fx__score mono">\d+<\/span><small class="fx__xtra mono">a\.e\.t\. \d+–\d+<\/small><small class="fx__xtra mono">pens 4–3<\/small><\/span>/);
  // old files carry no score: no score markup, the teams block unchanged
  for (const html of [EDGE_HTML, renderDay(D07, opts())]) assert.ok(!/fx__score|fx__teams--scored|fx__xtra/.test(html));
});

test('scores: never for in-play, not-started, postponed, awarded or walkover rows; never on a withdrawn row', () => {
  const base = R2_RAW.fixtures.find((f) => f.status === 'FT' && f.score !== null && !f.withdrawn);
  for (const st of ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'NS', 'PST', 'CANC', 'ABD', 'SUSP', 'TBD', 'AWD', 'WO']) {
    const day = structuredClone(R2_RAW);
    const f = day.fixtures.find((x) => x.fx === base.fx);
    f.status = st;
    f.score = S(2, 1, { aet_home: 3, aet_away: 1, pen_home: 4, pen_away: 3 });
    const rw = row(renderDay(day, opts()), f.fx);
    assert.equal(scoreSpans(rw).length, 0, st);
    assert.equal(xtras(rw).length, 0, st);
  }
  for (const st of ['FT', 'AET', 'PEN']) {
    const day = structuredClone(R2_RAW);
    const f = day.fixtures.find((x) => x.fx === base.fx);
    f.status = st;
    assert.equal(scoreSpans(row(renderDay(day, opts()), f.fx)).length, 2, st);
  }
  // a withdrawn row keeps its published status; a score there would describe a different fixture
  const w = structuredClone(R2_RAW);
  const wf = w.fixtures.find((x) => x.withdrawn);
  Object.assign(wf, { status: 'FT', score: S(1, 0) });
  assert.equal(scoreSpans(row(renderDay(w, opts()), wf.fx)).length, 0);
});

test('scores: "a.e.t." only on AET / PEN with both integers; "pens" only on PEN with both integers', () => {
  const aetFx = R2_RAW.fixtures.find((f) => f.status === 'AET').fx;
  const penFx = R2_RAW.fixtures.find((f) => f.status === 'PEN').fx;
  const cases = [
    // [fx, status, score, expected extra lines]
    [penFx, 'PEN', S(1, 1, { aet_home: 2, aet_away: 2, pen_home: 5, pen_away: 4 }), ['a.e.t. 2–2', 'pens 5–4']],
    [penFx, 'PEN', S(0, 0, { aet_home: 0, aet_away: 0, pen_home: 0, pen_away: 0 }), ['a.e.t. 0–0', 'pens 0–0']],
    [penFx, 'PEN', S(1, 1, { pen_home: 5, pen_away: 4 }), ['pens 5–4']],
    [penFx, 'PEN', S(1, 1, { aet_home: 2, aet_away: 2 }), ['a.e.t. 2–2']],
    [penFx, 'PEN', S(1, 1, { aet_home: 2, aet_away: null, pen_home: 5, pen_away: null }), []],
    [penFx, 'PEN', S(1, 1, { aet_home: '2', aet_away: 2, pen_home: '5', pen_away: 4 }), []],
    [penFx, 'PEN', S(1, 1, { aet_home: 2.5, aet_away: 2, pen_home: 5.5, pen_away: 4 }), []],
    [penFx, 'PEN', S(1, 1, { aet_home: -1, aet_away: 2, pen_home: -1, pen_away: 4 }), []],
    [penFx, 'PEN', S(1, 1, { aet_home: '<b>', aet_away: 2, pen_home: '<i>', pen_away: 4 }), []],
    [aetFx, 'AET', S(1, 1, { aet_home: 3, aet_away: 1 }), ['a.e.t. 3–1']],
    [aetFx, 'AET', S(1, 1, { aet_home: 3, aet_away: 1, pen_home: 4, pen_away: 3 }), ['a.e.t. 3–1']], // no shoot-out text on AET
    [aetFx, 'AET', S(1, 1), []],
    [aetFx, 'FT', S(1, 1, { aet_home: 3, aet_away: 1, pen_home: 4, pen_away: 3 }), []], // 90 minutes only
  ];
  for (const [fx, status, score, want] of cases) {
    const day = structuredClone(R2_RAW);
    Object.assign(day.fixtures.find((x) => x.fx === fx), { status, score });
    const rw = row(renderDay(day, opts()), fx);
    assert.deepEqual(scoreSpans(rw), [String(score.home), String(score.away)], JSON.stringify(score));
    assert.deepEqual(xtras(rw), want, `${status} ${JSON.stringify(score)}`);
    assert.ok(!/<b>|<i>/.test(rw));
  }
});

test('scores: a raw archive file with a malformed score omits it and never throws', () => {
  const ft = R2_RAW.fixtures.find((f) => f.status === 'FT' && f.score !== null && !f.withdrawn);
  const bad = ['2-1', 7, [], [2, 1], true, {}, { home: 1 }, { away: 1 }, { home: '1', away: 0 }, { home: -1, away: 0 },
    { home: 1.5, away: 0 }, { home: 1, away: null }, { home: '<img src=x onerror=alert(1)>', away: 1 }, { home: NaN, away: 1 }];
  for (const s of bad) {
    for (const status of ['FT', 'PEN']) {
      const day = structuredClone(R2_RAW);
      Object.assign(day.fixtures.find((x) => x.fx === ft.fx), { status, score: s });
      let html;
      assert.doesNotThrow(() => { html = renderDay(day, opts()); }, JSON.stringify(s));
      const rw = row(html, ft.fx);
      assert.equal(scoreSpans(rw).length, 0, JSON.stringify(s));
      assert.ok(!/fx__teams--scored|fx__xtra|<img/.test(rw), JSON.stringify(s));
    }
  }
  // a broken 90-minute score hides the extra lines too (never "a.e.t." without the result)
  const day = structuredClone(R2_RAW);
  const pen = day.fixtures.find((x) => x.status === 'PEN');
  pen.score = { ...pen.score, home: null };
  assert.equal(xtras(row(renderDay(day, opts()), pen.fx)).length, 0);
  // score absent or null: same as an old file
  for (const s of [undefined, null]) {
    const d = structuredClone(R2_RAW);
    const f = d.fixtures.find((x) => x.fx === ft.fx);
    if (s === undefined) delete f.score; else f.score = s;
    assert.equal(scoreSpans(row(renderDay(d, opts()), ft.fx)).length, 0);
  }
});

test('rule 2 + scores: no inline style / script, every percentage inside its figure', () => {
  assert.ok(!/style=|<style|<script/i.test(R2_HTML));
  const stripped = R2_HTML
    .replace(/<p class="fx__prob" data-figure="pick-prob">[\s\S]*?<\/p>/g, '')
    .replace(/<div class="ring"[^>]*data-figure="ring"[\s\S]*?<\/div>/g, '');
  assert.ok(!/\d%/.test(text(stripped)));
  assert.doesNotMatch(R2_HTML, /github/i);
});

test('fixtures.css: scores sit right of each team name, digits aligned, extra lines beneath; rule-1 marker kept', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const top = topRules(css);
  const classes = new Set();
  for (const m of R2_HTML.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) classes.add(c);
  const base = readFileSync(here('../site/assets/css/base.css'), 'utf8');
  for (const c of classes) {
    const re = new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`);
    assert.ok(re.test(css) || re.test(base), `.${c} has a rule in fixtures.css or base.css`);
  }
  for (const c of ['fx__score', 'fx__xtra', 'fx__teams--scored']) assert.ok(classes.has(c), `premise: ${c} rendered`);
  assert.ok(!/\.fx__pens/.test(css), 'no dead pens rule');
  const scoredTeams = bodyOf(top, '.fx__teams--scored');
  assert.match(scoredTeams, /display:grid/);
  assert.match(scoredTeams, /grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(bodyOf(top, '.fx__teams--scored .fx__team'), /grid-column:1/);
  const sc = bodyOf(top, '.fx__score');
  for (const d of [/grid-column:2/, /justify-self:end/, /text-align:right/, /tabular-nums/, /white-space:nowrap/]) assert.match(sc, d);
  // the extra lines are their own grid items in the score column, right-aligned under the digits
  const xt = bodyOf(top, '.fx__xtra');
  for (const d of [/grid-column:2/, /justify-self:end/, /white-space:nowrap/, /font-size:/]) assert.match(xt, d);
  assert.match(css, /\.fx\[data-uncounted\] \.fx__grade\{[^}]*border-style:dashed/, 'rule-1 files still mark uncounted rows');
  assert.match(bodyOf(top, '.fx__note'), /border-left/, 'rule-1 files still show the moved note');
});

// ---------------------------------------------------------------- spec §17.2: the edge only once a match has started

const GRADE_WORDS = Object.freeze({ won: 'Won', lost: 'Lost', push: 'Push', void: 'Void', pending: 'Pending' });
const chipOf = (rowHtml) => /<span class="bg-chip[^"]*fx__grade[^"]*">([^<]*)<\/span>/.exec(rowHtml)?.[1] ?? null;
const ALL_STATUSES = Object.values(PHASES).flat();

test('the phase sets are the renderer\'s own: live codes are the ones labelled Live, and the sets are disjoint', () => {
  for (const code of PHASES.live) assert.equal(statusLabel(code), 'Live', code);
  for (const p of ['done', 'off', 'pre']) for (const code of PHASES[p]) assert.notEqual(statusLabel(code), 'Live', code);
  assert.equal(new Set(ALL_STATUSES).size, ALL_STATUSES.length, 'no status in two phases');
});

test('every non-withdrawn row carries data-phase from its status; a withdrawn row carries none', () => {
  for (const [phase, codes] of Object.entries(PHASES)) {
    for (const code of codes) {
      const day = withStatus(EDGE, code);
      const html = renderDay(day, opts());
      let rows = 0;
      for (const f of day.fixtures) {
        const r = row(html, f.fx);
        if (f.withdrawn === true) {
          assert.ok(!/data-phase/.test(/^<li[^>]*>/.exec(r)[0]), `withdrawn fx ${f.fx} (${code}): no data-phase attribute`);
        } else {
          assert.equal(phaseAttr(r), phase, `fx ${f.fx} status ${code}`);
          rows++;
        }
      }
      assert.ok(rows > 0 && rows < day.fixtures.length, `premise (${code}): both kinds of row present`);
    }
  }
});

test('real days: each row\'s data-phase follows its own status (unknown codes are pre)', () => {
  const seen = new Set();
  for (const [day, html] of [[EDGE, EDGE_HTML], [D07, renderDay(D07, opts())], [D08, renderDay(D08, opts())], [R2, R2_HTML]]) {
    for (const f of day.fixtures) {
      const got = phaseAttr(row(html, f.fx));
      if (f.withdrawn === true) { assert.equal(got, null, `fx ${f.fx}`); continue; }
      assert.equal(got, expectedPhase(f.status), `fx ${f.fx} status ${f.status}`);
      seen.add(got);
    }
  }
  for (const p of Object.keys(PHASES)) assert.ok(seen.has(p), `premise: the real and edge days include a ${p} row`);
});

test('the grade chip: hidden only for a pending pick before kickoff (pre) or off; a settled grade always shows', () => {
  const picked = EDGE.fixtures.filter((f) => f.withdrawn !== true && f.pick);
  const grades = new Set(picked.map((f) => f.grade));
  for (const g of Object.keys(GRADE_WORDS)) assert.ok(grades.has(g), `premise: the edge day has a ${g} pick`);
  let hiddenSeen = 0;
  for (const code of ALL_STATUSES) {
    const phase = expectedPhase(code);
    const html = renderDay(withStatus(EDGE, code), opts());
    for (const f of picked) {
      const r = row(html, f.fx);
      const t = text(r);
      const hidden = f.grade === 'pending' && (phase === 'pre' || phase === 'off');
      assert.equal(chipOf(r), hidden ? null : GRADE_WORDS[f.grade], `fx ${f.fx} ${f.grade} ${code}`);
      if (hidden) {
        hiddenSeen++;
        assert.ok(!t.includes('Pending'), `fx ${f.fx} ${code}: no "Pending" text before kickoff`);
      }
      // The pick itself is never hidden: eyebrow, selection, price (or its designed absence), probability.
      assert.match(t, /★ Recommended pick/, `fx ${f.fx} ${code}`);
      assert.ok(t.includes(f.pick.label ?? f.pick.market), `fx ${f.fx} ${code}: selection`);
      assert.ok(f.pick.price === null ? t.includes('no price recorded') : t.includes(`@ ${f.pick.price.toFixed(2)}`), `fx ${f.fx} ${code}: price`);
      assert.match(r, /<p class="fx__prob[^"]*"/, `fx ${f.fx} ${code}: probability`);
      if (Number.isInteger(f.pick.pct)) assert.match(r, /data-figure="pick-prob"/, `fx ${f.fx} ${code}: probability figure`);
    }
  }
  assert.ok(hiddenSeen > 0, 'premise: some pending pick was rendered before kickoff');
});

test('an off row keeps its status label and, graded void, its Void chip (EDGE 900004: PST + void)', () => {
  const r = row(EDGE_HTML, 900004);
  assert.equal(phaseAttr(r), 'off');
  assert.equal(chipOf(r), 'Void');
  assert.match(text(r), /Postponed/);
  for (const code of PHASES.off) {
    const rr = row(renderDay(withStatus(EDGE, new Map([[900004, code]])), opts()), 900004);
    assert.equal(chipOf(rr), 'Void', code);
    assert.ok(text(rr).includes(statusLabel(code)), `${code} label kept`);
  }
});

test('the ring and its counts do not depend on the phase (accuracy maths untouched)', () => {
  const headOf = (html) => /<header class="day-head">[\s\S]*?<\/header>/.exec(html)[0];
  for (const code of ALL_STATUSES) {
    assert.equal(headOf(renderDay(withStatus(EDGE, code), opts())), headOf(EDGE_HTML), code);
  }
});

// -- CSS: parse every rule (at-rule bodies too) and check which rows an edge colour can reach.

/** Split a selector list on top-level commas only (a comma inside :not(...) is not a separator). */
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Every innermost rule of a stylesheet, one entry per selector, in source order. */
function allRules(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of splitSelectors(m[1])) out.push({ sel, body: m[2] });
  }
  return out;
}
/** The subject (last) compound of a selector. */
const subjectOf = (sel) => sel.split(/\s*[\s>+~]\s*/).pop();
/** The colour a rule gives the LEFT edge, or null: border-left-color, or the colour in a border-left / border shorthand. */
function leftEdgeColour(body) {
  let colour = null;
  for (const decl of body.split(';')) {
    const m = /^\s*(border-left-color|border-left|border-inline-start-color|border-inline-start|border-color|border)\s*:(.*)$/.exec(decl);
    if (m) {
      const v = /var\((--[\w-]+)\)/.exec(m[2]);
      colour = v ? v[1] : m[2].trim();
    }
  }
  return colour;
}
/** A `.fx` subject compound as its attribute tests, or null when it is not a plain `.fx[...]` compound. */
function fxAttrs(compound) {
  const m = /^\.fx((?:\[[\w-]+(?:="[^"]*")?\])*)$/.exec(compound);
  if (!m) return null;
  return [...m[1].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((a) => [a[1], a[2] ?? null]);
}
const CSS_DIR = here('../site/assets/css/');
const ALL_CSS = readdirSync(CSS_DIR).filter((n) => n.endsWith('.css')).map((n) => [n, readFileSync(CSS_DIR + n, 'utf8')]);

test('fixtures CSS: every edge colour keyed on data-state is scoped to a live or done phase (withdrawn excepted)', () => {
  let scoped = 0;
  for (const [name, css] of ALL_CSS) {
    for (const { sel, body } of allRules(css)) {
      const subj = subjectOf(sel);
      if (!/^\.fx(?![\w-])/.test(subj) || leftEdgeColour(body) === null) continue;
      // Nothing keyed on the quiet phases colours the edge.
      assert.ok(!/\[data-phase="(pre|off)"\]/.test(subj), `${name}: ${sel} colours a pre/off row`);
      if (!/\[data-state=/.test(subj)) continue;
      if (/\[data-state="withdrawn"\]/.test(subj)) {
        // Withdrawn rows carry no phase: a phase condition would make the rule dead.
        assert.ok(!/\[data-phase/.test(subj), `${name}: ${sel} — withdrawn keeps its edge with no phase condition`);
        continue;
      }
      assert.match(subj, /\[data-phase="(live|done)"\]/, `${name}: ${sel} colours the edge with no live/done phase`);
      scoped++;
    }
  }
  assert.ok(scoped > 0, 'premise: phase-scoped edge rules exist');
});

test('fixtures CSS: the edge each row gets — neutral before kickoff and when off, coloured once live or done', () => {
  const rules = [];
  for (const [, css] of ALL_CSS) {
    for (const { sel, body } of allRules(css)) {
      const attrs = fxAttrs(sel);
      const colour = leftEdgeColour(body);
      if (attrs !== null && colour !== null) rules.push({ attrs, colour });
    }
  }
  /** The winning rule for a row: most attribute tests (specificity), then the later rule. */
  const edgeOf = (rowAttrs) => {
    let best = null;
    for (const r of rules) {
      if (!r.attrs.every(([k, v]) => Object.hasOwn(rowAttrs, k) && (v === null || rowAttrs[k] === v))) continue;
      if (best === null || r.attrs.length >= best.attrs.length) best = r;
    }
    return best?.colour ?? null;
  };
  assert.equal(edgeOf({}), '--line', 'premise: the base row edge is the neutral --line');
  const states = ['won', 'lost', 'push', 'void', 'pending', 'late', 'nopick'];
  const DONE = { won: '--won', lost: '--lost', push: '--void', void: '--void', pending: '--hold', late: '--line', nopick: '--line' };
  for (const state of states) {
    for (const phase of ['pre', 'off']) assert.equal(edgeOf({ 'data-state': state, 'data-phase': phase }), '--line', `${phase} ${state}`);
    assert.equal(edgeOf({ 'data-state': state, 'data-phase': 'done' }), DONE[state], `done ${state}`);
    // In play: a settled grade colours the edge as it does when finished; pending is hold; a row
    // with no pick stays quiet. (Operator decision 2026-10-09: live + won is --won, not --hold.)
    assert.equal(edgeOf({ 'data-state': state, 'data-phase': 'live' }), DONE[state], `live ${state}`);
  }
  assert.equal(edgeOf({ 'data-state': 'withdrawn' }), '--void', 'withdrawn keeps its own edge');
  // Every state the renderer emits is covered above (derived from the edge day's rows).
  for (const s of new Set([...EDGE_HTML.matchAll(/<li class="fx"[^>]*data-state="([^"]+)"/g)].map((m) => m[1]))) {
    assert.ok(states.includes(s) || s === 'withdrawn', `state ${s} checked`);
  }
});

