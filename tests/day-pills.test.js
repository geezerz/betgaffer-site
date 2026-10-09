// Day pills (spec §17.1, Plan D Task D3): the strip above the day card is a window anchored on the
// index's today — the listed calendar days D-3, D-2, D-1, then D, then D+1 — the same on / and on
// every /day/<d>/ page, each pill with that day's result from index.days[]. Expectations are derived
// from the fixture data (tests/site-fixtures.js pillArtifact), never from the renderer.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { build, dayPills, pillPct } from '../site/build.mjs';
import { fmtDayLong } from '../site/lib/time.js';
import { parse, find, findAll, textOf, claimViolations } from './html-scan.js';
import { REPO_ROOT, testConfig, workspace, pillArtifact, PILL_DAYS } from './site-fixtures.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');
const D = '2026-10-07';
const WINDOW = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
const quiet = () => {};
const GRADED_TODAY = { won: 6, lost: 1 }; // the fixture day has 7 counted picks

async function built(opts) {
  const ws = await workspace();
  const index = await pillArtifact(ws.root, opts);
  await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: quiet });
  return { ws, index, read: (rel) => readFile(join(ws.out, rel), 'utf8') };
}

const navOf = (html) => find(parse(html), (n) => n.tag === 'nav' && /\bday-pills\b/.test(n.attrs.class ?? ''));
const pillsOf = (html) => {
  const nav = navOf(html);
  return nav ? findAll(nav, (n) => n.tag === 'a') : null;
};
const dayOf = (a) => /^\/day\/(\d{4}-\d{2}-\d{2})\/$/.exec(a.attrs.href)[1];
const part = (a, cls) => find(a, (n) => (n.attrs.class ?? '').split(/\s+/).includes(cls));
const pageRel = (d) => `day/${d}/index.html`;

const LONG_DOW = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
/** 'Tuesday 6 October' from the date (the aria-label's date: weekday and month in full, no year). */
const ariaDate = (d) => {
  const [dow, dd] = fmtDayLong(d).split(' ');
  return `${LONG_DOW[dow]} ${dd} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(d.slice(5, 7)) - 1]}`;
};
/** One decimal from the published two-decimal pct, half up on the published digits. */
const oneDec = (pct) => `${(Math.round(Math.round(pct * 100) / 10) / 10).toFixed(1)}%`;

// ------------------------------------------------------------------ the window

describe('the window is anchored on today', () => {
  let b;
  before(async () => { b = await built({ today: GRADED_TODAY }); });
  after(() => b.ws.cleanup());

  test('premise: the index lists D-5..D+1 and today is D', () => {
    assert.equal(b.index.today, D);
    assert.deepEqual(b.index.days.map((e) => e.day).sort(), ['2026-10-02', '2026-10-03', ...WINDOW]);
  });

  test('/ and every day page show exactly [D-3, D-2, D-1, D, D+1]', async () => {
    for (const rel of ['index.html', ...b.index.days.map((e) => pageRel(e.day))]) {
      const pills = pillsOf(await b.read(rel));
      assert.ok(pills, `${rel}: pills`);
      assert.deepEqual(pills.map(dayOf), WINDOW, rel);
    }
  });

  test('the page\'s own pill is current; an older listed day page has no current pill', async () => {
    const home = pillsOf(await b.read('index.html'));
    assert.deepEqual(home.filter((a) => a.attrs['aria-current'] !== undefined).map((a) => [dayOf(a), a.attrs['aria-current']]), [[D, 'true']]);
    for (const e of b.index.days) {
      const pills = pillsOf(await b.read(pageRel(e.day)));
      const cur = pills.filter((a) => a.attrs['aria-current'] !== undefined);
      if (WINDOW.includes(e.day)) assert.deepEqual(cur.map((a) => [dayOf(a), a.attrs['aria-current']]), [[e.day, 'page']], e.day);
      else assert.deepEqual(cur, [], `${e.day} is outside the window: no current pill`);
    }
  });

  test('only today\'s pill is marked today in the static HTML', async () => {
    for (const rel of ['index.html', pageRel('2026-10-04')]) {
      const pills = pillsOf(await b.read(rel));
      assert.deepEqual(pills.filter((a) => a.attrs['data-when'] !== undefined).map((a) => [dayOf(a), a.attrs['data-when']]), [[D, 'today']], rel);
    }
  });

  test('links use <span>, never <p>, inside the pill', async () => {
    for (const a of pillsOf(await b.read('index.html'))) {
      assert.deepEqual(findAll(a, (n) => n !== a && !['span', 'svg', 'rect', 'line'].includes(n.tag)).map((n) => n.tag), [], dayOf(a));
    }
  });
});

describe('the window follows the listed days', () => {
  const cases = [
    ['D+1 unlisted: four pills', { drop: ['2026-10-08'] }, WINDOW.slice(0, 4)],
    ['a gap day is simply absent', { drop: ['2026-10-05'] }, ['2026-10-04', '2026-10-06', '2026-10-07', '2026-10-08']],
    ['only D and D-1: two pills', { drop: ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-08'] }, ['2026-10-06', D]],
    ['today unlisted: no today pill, tomorrow still shows', { drop: [D] }, ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-08']],
  ];
  for (const [name, opts, want] of cases) {
    test(name, async () => {
      const b = await built(opts);
      try {
        for (const rel of ['index.html', ...b.index.days.map((e) => pageRel(e.day))]) {
          const pills = pillsOf(await b.read(rel));
          assert.deepEqual(pills.map(dayOf), want, rel);
          assert.ok(!pills.some((a) => a.attrs['data-when'] === 'today' && dayOf(a) !== D), rel);
        }
      } finally {
        await b.ws.cleanup();
      }
    });
  }

  test('only D listed: no pills at all', async () => {
    const b = await built({ drop: ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-08'] });
    try {
      for (const rel of ['index.html', pageRel(D)]) assert.equal(navOf(await b.read(rel)), null, rel);
    } finally {
      await b.ws.cleanup();
    }
  });

  test('nothing beyond D+1 and nothing before D-3, even when listed', () => {
    const entry = (day) => ({ day, compacted: true, picks_hash: `sha256:${'a'.repeat(64)}`, fixtures: 9, accuracy: { won: 1, lost: 1, pushes: 0, graded: 2, pct: 50 } });
    const listed = ['2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-03', '2026-10-02'].map(entry);
    const html = `<html><body>${dayPills(listed, D, null, { onDayPage: true })}</body></html>`;
    assert.deepEqual(pillsOf(html).map(dayOf), ['2026-10-07', '2026-10-08']);
  });
});

// ------------------------------------------------------------------ the content

describe('pill content comes from index.days[]', () => {
  let b;
  let pills;
  let entry;
  before(async () => {
    b = await built({ today: GRADED_TODAY });
    pills = new Map(pillsOf(await b.read('index.html')).map((a) => [dayOf(a), a]));
    entry = (d) => b.index.days.find((e) => e.day === d);
  });
  after(() => b.ws.cleanup());

  test('every pill: weekday, day number and month as separate parts, the full date in visually hidden text', () => {
    for (const [d, a] of pills) {
      const [dow, dd, mon] = fmtDayLong(d).split(' ');
      assert.equal(textOf(part(a, 'day-pill__dow')), dow, d);
      assert.equal(textOf(part(a, 'day-pill__dd')), dd, d);
      assert.equal(textOf(part(a, 'day-pill__mon')), mon, d);
      assert.ok(findAll(a, (n) => n.attrs.class === 'vh').some((n) => textOf(n) === fmtDayLong(d)), `${d}: hidden full date`);
      assert.doesNotMatch(a.attrs['aria-label'], /percent/i, `${d}: the % glyph, never the word`);
      // The name starts with the date, or with the pill's own words on a perfect day (WCAG 2.5.3).
      assert.ok(a.attrs['aria-label'].replace(/^All right, /, '').startsWith(`${ariaDate(d)}: `), `${d}: ${a.attrs['aria-label']}`);
    }
  });

  test('a past graded day: its percentage, one decimal, green, with "won of graded"', () => {
    const d = '2026-10-06';
    const { won, graded, pct } = entry(d).accuracy;
    const a = pills.get(d);
    const fig = part(a, 'day-pill__fig');
    assert.equal(textOf(fig), oneDec(pct));
    assert.ok(fig.attrs.class.split(' ').includes('day-pill__fig--won'), 'green');
    assert.match(textOf(part(a, 'day-pill__sub')), new RegExp(`^${won} of ${graded}$`));
    assert.equal(a.attrs['data-figure'], 'record-row');
    assert.equal(a.attrs['data-period'], d);
    assert.equal(a.attrs['aria-label'], `${ariaDate(d)}: ${won} of ${graded} picks right, ${oneDec(pct)}`);
  });

  test('a perfect day reads "All right" with its fraction, and no percentage anywhere', () => {
    const d = '2026-10-04';
    const { won, graded, pct } = PILL_DAYS[d].accuracy;
    assert.equal(pct, 100, 'premise');
    const a = pills.get(d);
    assert.equal(textOf(part(a, 'day-pill__fig')), 'All right');
    assert.equal(textOf(part(a, 'day-pill__sub')), `${won} of ${graded}`);
    assert.doesNotMatch(`${textOf(a)} ${a.attrs['aria-label']}`, /%/);
    assert.equal(a.attrs['aria-label'], `All right, ${ariaDate(d)}: ${won} of ${graded} picks right`, 'the visible words lead the name');
  });

  test('a past day with nothing graded: "—" and "No results yet" (as the ring: grading can lag, pushes are not counted)', () => {
    const d = '2026-10-05';
    assert.equal(PILL_DAYS[d].accuracy.graded, 0, 'premise');
    const a = pills.get(d);
    assert.equal(textOf(part(a, 'day-pill__fig')), '—');
    assert.equal(textOf(part(a, 'day-pill__sub')), 'No results yet');
    assert.equal(a.attrs['data-figure'], undefined);
    assert.equal(a.attrs['aria-label'], `${ariaDate(d)}: no results yet`);
    assert.doesNotMatch(textOf(a), /No results(?! yet)/, 'never a final-sounding "No results"');
  });

  test('today graded: the percentage and fraction, with a hidden "so far" slot for stale.js', () => {
    const a = pills.get(D);
    const { won, graded, pct } = entry(D).accuracy;
    assert.deepEqual([won, graded], [GRADED_TODAY.won, GRADED_TODAY.won + GRADED_TODAY.lost], 'premise');
    assert.equal(textOf(part(a, 'day-pill__fig')), oneDec(pct));
    assert.equal(textOf(part(a, 'day-pill__sub')), `${won} of ${graded}`);
    const sofar = find(a, (n) => n.attrs['data-rel'] === 'sofar');
    assert.ok(sofar && sofar.attrs.hidden !== undefined && textOf(sofar) === '' && sofar.attrs['data-rel-day'] === D);
  });

  test('tomorrow: "N fixtures"', () => {
    const d = '2026-10-08';
    const a = pills.get(d);
    assert.equal(`${textOf(part(a, 'day-pill__fig'))} ${textOf(part(a, 'day-pill__sub'))}`, `${entry(d).fixtures} fixtures`);
    assert.equal(find(a, (n) => n.attrs['data-rel'] === 'sofar'), null);
    assert.equal(a.attrs['aria-label'], `${ariaDate(d)}: ${entry(d).fixtures} fixtures`);
  });

  test('every pill carries a relabel slot (data-rel="pill"), empty and hidden in the static HTML', () => {
    for (const [d, a] of pills) {
      const rel = find(a, (n) => n.attrs['data-rel'] === 'pill');
      assert.ok(rel && rel.attrs['data-rel-day'] === d && rel.attrs.hidden !== undefined && textOf(rel) === '', d);
    }
  });

  test('today ungraded: "No results yet", no "so far" slot', async () => {
    const u = await built({});
    try {
      const a = pillsOf(await u.read('index.html')).find((x) => dayOf(x) === D);
      assert.equal(textOf(part(a, 'day-pill__fig')), '—');
      assert.equal(textOf(part(a, 'day-pill__sub')), 'No results yet');
      assert.equal(find(a, (n) => n.attrs['data-rel'] === 'sofar'), null);
      assert.equal(a.attrs['aria-label'], `${ariaDate(D)}: no results yet`);
    } finally {
      await u.ws.cleanup();
    }
  });

  test('claims scanner: / and every day page are clean', async () => {
    for (const rel of ['index.html', ...b.index.days.map((e) => pageRel(e.day))]) {
      assert.deepEqual(claimViolations(await b.read(rel)), [], rel);
    }
  });
});

// ------------------------------------------------------------------ formatting and the guard

describe('pillPct and the claim guard on a pill', () => {
  const acc = (won, lost, pct) => ({ won, lost, pushes: 0, graded: won + lost, pct });

  test('one decimal, half up on the published two decimals; capped below 100 unless perfect', () => {
    assert.equal(pillPct(acc(120, 20, 85.71)), '85.7%');
    assert.equal(pillPct(acc(1, 1, 87.55)), '87.6%');
    assert.equal(pillPct(acc(9, 1, 90)), '90.0%');
    assert.equal(pillPct(acc(0, 5, 0)), '0.0%');
    assert.equal(pillPct(acc(1999, 1, 99.95)), '99.9%', 'never 100.0% for a day with a wrong pick');
    assert.equal(pillPct(acc(9999, 1, 99.99)), '99.9%');
    assert.equal(pillPct(acc(12, 0, 100)), null, 'a perfect day prints no percentage');
    assert.equal(pillPct(acc(0, 0, null)), null);
  });

  const listed = [
    { day: '2026-10-07', compacted: false, picks_hash: `sha256:${'b'.repeat(64)}`, fixtures: 9, accuracy: acc(120, 20, 85.71) },
    { day: '2026-10-06', compacted: true, picks_hash: `sha256:${'a'.repeat(64)}`, fixtures: 9, accuracy: acc(2, 1, 66.67) },
  ];
  const doc = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

  test('premise: the pills alone are clean', () => {
    assert.deepEqual(claimViolations(doc(dayPills(listed, D, D, { onDayPage: true }))), []);
  });

  test('a pill missing its fraction is reported', () => {
    const html = dayPills(listed, D, D, { onDayPage: true }).replace('day-pill__sub">2 of 3', 'day-pill__sub">2 / 3');
    assert.notEqual(html, dayPills(listed, D, D, { onDayPage: true }), 'premise: the visible fraction was changed');
    assert.ok(claimViolations(doc(html)).some((v) => /66\.7%/.test(v)), 'the percentage loses its licence');
  });

  test('a pill missing its full date is reported', () => {
    const html = dayPills(listed, D, D, { onDayPage: true }).replace(`<span class="vh">${fmtDayLong('2026-10-06')}</span>`, '');
    assert.notEqual(html, dayPills(listed, D, D, { onDayPage: true }), 'premise: the date was removed');
    assert.ok(claimViolations(doc(html)).some((v) => /66\.7%/.test(v)));
  });
});

// ------------------------------------------------------------------ CSS

describe('pill CSS', () => {
  const css = readFileSync(join(REPO_ROOT, 'site/assets/css/fixtures.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  const body = (src, sel) => [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';');
  const narrow = [...css.matchAll(/@media \(max-width:599\.98px\)\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)].map((m) => m[1]).join('\n');

  test('equal columns from the grid, no custom property from markup (CSP)', () => {
    const list = body(top, '.day-pills__list');
    assert.match(list, /display:grid/);
    assert.match(list, /grid-auto-flow:column/);
    assert.match(list, /grid-auto-columns:minmax\(0,1fr\)/);
  });

  test('the current pill is filled, today outlined, the percentage green', () => {
    assert.match(body(top, '.day-pill[aria-current]'), /background:var\(--accent-quiet\)/);
    assert.match(body(top, '.day-pill[aria-current]'), /border-color:var\(--accent\)/);
    assert.match(body(top, '.day-pill[data-when="today"]'), /border-color:var\(--accent\)/);
    assert.doesNotMatch(body(top, '.day-pill[data-when="today"]'), /background/);
    assert.match(body(top, '.day-pill__fig--won'), /color:var\(--won\)/);
  });

  test('phones: the fraction is never hidden; the month is', () => {
    assert.ok(narrow.length > 0, 'premise: a phone block exists');
    assert.doesNotMatch(body(narrow, '.day-pill__sub'), /display:none|visibility:hidden/);
    assert.doesNotMatch(body(top, '.day-pill__sub'), /display:none|visibility:hidden/);
    assert.match(body(narrow, '.day-pill__mon'), /display:none/);
  });

  test('below 1024px only "Today" replaces the weekday; from 1024px every relative word shows', () => {
    const wide = [...css.matchAll(/@media \(min-width:1024px\)\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)].map((m) => m[1]).join('\n');
    assert.match(body(top, '.day-pill__rel'), /display:none/);
    assert.match(body(top, '.day-pill[data-when="today"] .day-pill__rel:not([hidden])'), /display:inline/);
    assert.match(body(wide, '.day-pill__rel:not([hidden])'), /display:inline/);
    assert.match(body(wide, '.day-pill__rel:not([hidden]) + .day-pill__dow'), /display:none/);
  });

  test('"so far" shows at every width; below 1024px it is its own line, reserved while hidden (no shift when stale.js fills it)', () => {
    const wide = [...css.matchAll(/@media \(min-width:1024px\)\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)].map((m) => m[1]).join('\n');
    assert.match(body(top, '.day-pill__sofar'), /display:block/);
    // An empty block is 0px tall: the line is held open by a min-height of one line, not by its text.
    assert.match(body(top, '.day-pill__sofar'), /min-height:1lh/);
    assert.doesNotMatch(body(top, '.day-pill__sofar'), /display:none/);
    const reserved = body(top, '.day-pill .day-pill__sofar[hidden]');
    assert.match(reserved, /display:block/);
    assert.match(reserved, /visibility:hidden/);
    // From 1024px it sits inline on the one-line fraction (nowrap), so showing it changes no height.
    assert.match(body(wide, '.day-pill__sofar'), /display:inline/);
    assert.match(body(wide, '.day-pill .day-pill__sofar[hidden]'), /display:none/);
    assert.match(body(top, '.day-pill__sub'), /white-space:nowrap/);
  });

  test('a [hidden] slot really hides (the pill parts set a display)', () => {
    assert.match(body(top, '.day-pill [hidden]'), /display:none/);
  });

  test('the old strip is gone', () => {
    assert.doesNotMatch(css, /day-strip/);
  });
});

