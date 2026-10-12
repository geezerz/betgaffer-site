// Thousands separators (BRAND 2026-10-12): every count of four or more digits a visitor reads is
// written with a comma (1,114 · 10,081) by the one formatter, site/lib/num.js. Each surface is
// pinned with a four-digit and a five-digit count, and a guard over whole builds (tests/html-scan.js
// bareCounts) fails on any bare run of four or more digits that is not a year, the operator's
// registration number or a receipt code. data-* attributes stay raw integers (scripts read them).
//
// Expected texts are written out, or grouped by Node's own en-US formatter (an oracle that shares
// no code with num.js).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { build, dayPills } from '../site/build.mjs';
import { renderDay } from '../site/lib/fixtures.js';
import { ring } from '../site/lib/ring.js';
import { ringModel } from '../site/lib/balloon-model.js';
import { parse, find, findAll, textOf, visibleText, bareCounts, bareRuns, claimViolations } from './html-scan.js';
import { testConfig, workspace, copyArtifact, addArchive, bigArtifact, BIG, syntheticDay, htmlFiles } from './site-fixtures.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');
const us = (n) => n.toLocaleString('en-US'); // the oracle
const opts = (o = {}) => ({ isToday: false, isTomorrow: false, prevDay: null, nextDay: null, ...o });
const page = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const acc = (won, lost, pushes, pct) => ({ won, lost, pushes, graded: won + lost, pct });
const A4 = acc(1131, 177, 1050, 86.47); // four digits
const A5 = acc(10081, 2073, 12345, 82.94); // five digits
const ariaOf = (html) => /aria-label="([^"]*)"/.exec(html)[1];

test('premise: the oracle groups digits the way the pages must', () => {
  assert.deepEqual([999, 1114, 10081, 1234567].map(us), ['999', '1,114', '10,081', '1,234,567']);
});

// ------------------------------------------------------------------ the guard itself

describe('bareRuns / bareCounts: what counts as a bare count', () => {
  test('a run of four or more digits is reported; a separated count is not', () => {
    assert.deepEqual(bareRuns('1114 fixtures in 310 competitions').map((r) => r.run), ['1114']);
    assert.deepEqual(bareRuns('1131 of 1308 landed').map((r) => r.run), ['1131', '1308']);
    assert.deepEqual(bareRuns('Of the 12345 fixtures checked, a pick for 10081').map((r) => r.run), ['12345', '10081']);
    for (const ok of ['1,114 fixtures in 310 competitions', '1,131 of 1,308 landed', '10,081 of 12,154', '999 fixtures', '86.47%', '@ 1.62', '23:15 WAT', '1,234,567']) {
      assert.deepEqual(bareRuns(ok), [], ok);
    }
  });

  test('a year is allowed only after a month name, "©" or "Act", in the same text', () => {
    for (const ok of ['Sun 11 Oct 2026', 'From 8 October 2026, each day', 'Updated 7 Oct 2026, 06:05 WAT.', 'May 2026', 'March 1999', '© 2026 Example Media Ltd', 'Consumer Protection Act 2018.']) {
      assert.deepEqual(bareRuns(ok), [], ok);
    }
    for (const bad of ['in 2026 fixtures', '2026 fixtures', 'Oct 12026', 'Oct  2026', 'Oct 2126', 'Oct 1899', 'Maya 2026', 'October: 2026', 'Pact 2018']) {
      assert.equal(bareRuns(bad).length, 1, bad);
    }
  });

  test('the registration number and a 12-hex receipt code are allowed; nothing else is', () => {
    for (const ok of ['RC 1234567', '(RC1234567)', 'receipt d9025801ee16', 'efd3e3a637cc', '537a79be18e8.']) assert.deepEqual(bareRuns(ok), [], ok);
    for (const bad of ['RC: 1234567', 'receipt d9025801ee16f', 'receipt D9025801EE16', 'ref 9025801', 'x9025801ee16a2']) assert.ok(bareRuns(bad).length >= 1, bad);
  });

  test('bareCounts reads text nodes, <title>, readable attributes and text metas — one node at a time', () => {
    const clean = '<!doctype html><html><head><title>Predictions for Thu 8 Oct 2026</title>'
      + '<meta name="description" content="1,114 fixtures on Thu 8 Oct 2026"><meta name="theme-color" content="#0B1017">'
      + '<meta property="og:image:width" content="1200"><meta property="og:url" content="https://x.example/day/2026-10-08/"></head>'
      + '<body><main data-ring-won="1152" data-ring-graded="1320"><p>1,114 fixtures</p>'
      + '<a href="/day/2026-10-08/" aria-label="Thursday 8 October: 1,131 of 1,308 picks right">x</a>'
      + '<time datetime="2026-10-08T12:00:00Z">13:00</time>'
      + '<p class="fx__comp">Liga 1907</p><span class="fx__team">1461 Trabzon FK</span><span class="fx__selname">Over 2500 corners</span><p class="fx__why">1899 was a year</p>'
      + '<p>receipt <span class="mono">efd3e3a637cc</span></p></main></body></html>';
    assert.deepEqual(bareCounts(clean), []);
    const dirty = (frag, head = '') => bareCounts(`<!doctype html><html><head><title>t</title>${head}</head><body>${frag}</body></html>`);
    assert.equal(dirty('<p>1114 fixtures</p>').length, 1);
    assert.equal(dirty('<p><b>1131</b> of <b>1308</b> landed</p>').length, 2, 'a count split over inline tags is still seen');
    assert.equal(dirty('<div role="img" aria-label="1131 of 1308 landed"></div>').length, 2);
    assert.equal(dirty('<img alt="1114 fixtures" src="/x.png">').length, 1);
    assert.equal(dirty('<input placeholder="Search 1114 fixtures">').length, 1);
    assert.equal(dirty('<p title="1114 fixtures">x</p>').length, 1);
    assert.equal(dirty('', '<meta name="description" content="1114 fixtures today">').length, 1);
    assert.equal(dirty('', '<meta property="og:title" content="1114 fixtures">').length, 1);
    assert.equal(bareCounts('<!doctype html><html><head><title>1114 fixtures</title></head><body></body></html>').length, 1);
    // a number never borrows its excuse from a neighbouring element
    assert.equal(dirty('<p><span>Oct</span> <span>2026</span></p>').length, 1);
    assert.equal(dirty('<p><span>RC</span> <span>1234567</span></p>').length, 1);
    // a publisher-supplied name is not scanned, but a count beside it is
    assert.equal(dirty('<li><span class="fx__team">1461 Trabzon FK</span><span class="fx__time">1500</span></li>').length, 1);
    assert.match(dirty('<p class="day-bar">· 1114 fixtures</p>')[0], /text in <p class="day-bar">.*: 1114 in /);
  });
});

// ------------------------------------------------------------------ each surface, four and five digits

describe('the ring (ring.js): fraction, pushes and the aria-label', () => {
  for (const [a, frac, pushes] of [[A4, '1,131 of 1,308', '1,050'], [A5, '10,081 of 12,154', '12,345']]) {
    test(`${frac} landed · ${pushes} pushes not counted`, () => {
      const html = ring(a, { dayLabel: 'Picks published for Sat 10 Oct 2026, settled so far', date: '2026-10-10', relDay: '2026-10-10' });
      const t = visibleText(page(html));
      assert.ok(t.includes(`${frac} landed`), t);
      assert.ok(t.includes(`Sat 10 Oct 2026 · ${pushes} pushes not counted`), t);
      assert.equal(ariaOf(html), `Picks published for Sat 10 Oct 2026, settled so far: ${frac} landed (${a.pct}%). ${pushes} pushes not counted.`);
      assert.deepEqual(bareCounts(page(html)), []);
      assert.deepEqual(claimViolations(page(html)), [], 'the claim scanner still reads the separated fraction');
    });
  }
  test('nothing graded: the pushes line is separated too', () => {
    const html = ring(acc(0, 0, 1234, null), { dayLabel: 'Picks', date: '2026-10-10' });
    assert.equal(ariaOf(html), 'Picks: no results yet. 1,234 pushes not counted.');
    assert.ok(visibleText(page(html)).includes('1,234 pushes not counted'));
    assert.ok(ariaOf(ring(acc(0, 0, 12345, null), { dayLabel: 'Picks' })).includes('12,345 pushes not counted.'));
  });
});

describe('the floating ring captions (balloon-model.js ringModel)', () => {
  const D = '2026-10-07';
  const at = Date.parse('2026-10-07T12:00:00Z');
  test('today and yesterday fractions, in the caption and in the aria-label', () => {
    const m = ringModel(A4, { date: D, yesterday: A5, nowMs: at });
    assert.equal(m.fracText, '1,131 of 1,308');
    assert.equal(m.yday.fracText, '10,081 of 12,154');
    assert.equal(m.aria, "Today's published picks: 1,131 of 1,308 landed (86.47%). Yesterday: 10,081 of 12,154 (82.94%). Opens Our Record.");
    const swap = ringModel(A5, { date: D, yesterday: A4, nowMs: at });
    assert.equal(swap.fracText, '10,081 of 12,154');
    assert.equal(swap.yday.fracText, '1,131 of 1,308');
  });
  test('a perfect day', () => {
    assert.equal(ringModel(acc(1200, 0, 0, 100), { date: D, nowMs: at }).aria, "Today's published picks: 1,200 of 1,200 landed so far. Opens Our Record.");
    assert.equal(ringModel(acc(12000, 0, 0, 100), { date: D, nowMs: at }).fracText, '12,000 of 12,000');
  });
});

describe('the day card (fixtures.js): header count, day bar, "How this card was built"', () => {
  for (const [rows, comps, withdrawn] of [[1114, 1005, 1002], [12345, 10050, 10010]]) {
    test(`${us(rows)} fixtures in ${us(comps)} competitions (${us(withdrawn)} withdrawn)`, () => {
      const html = renderDay(syntheticDay({ rows, comps, withdrawn }), opts());
      const head = /<p class="day-head__count mono">([^<]*)<\/p>/.exec(html)[1];
      assert.equal(head, `${us(rows)} fixtures in ${us(comps)} competitions (${us(withdrawn)} withdrawn)`);
      const bar = textOf(find(parse(page(html)), (n) => n.attrs.class === 'day-bar'));
      assert.equal(bar, `Tue 6 Oct 2026 · ${us(rows)} fixtures · by kickoff`);
      assert.deepEqual(bareCounts(page(html)), []);
      // data-* stay raw: the rows keep their integer ids
      assert.match(html, /data-fx="5000000"/);
    });
  }

  const how = (day) => visibleText(page(/<details class="day-how">[\s\S]*?<\/details>/.exec(renderDay(day, opts()))[0]));
  const withCounts = (n, served, matched, unserved, extra = {}) => {
    const d = syntheticDay({ rows: 3 });
    Object.assign(d.pick_source, { ledger_match_n: n, ledger_match_served_n: served, ledger_match_matched: matched, ledger_match_unserved: unserved });
    Object.assign(d, extra);
    return d;
  };
  test('the checked sentence: every count separated', () => {
    assert.ok(how(withCounts(1099, 1054, 1054, 45)).includes('Of the 1,099 fixtures checked against the graded record, the card showed a pick for 1,054, all of them the same pick the record grades, and no pick for 45.'));
    assert.ok(how(withCounts(12345, 12000, 11999, 345)).includes('Of the 12,345 fixtures checked against the graded record, the card showed a pick for 12,000, 11,999 of them the same pick the record grades, and no pick for 345.'));
    assert.ok(how(withCounts(13000, 11000, 0, 2000)).includes('Of the 13,000 fixtures checked against the graded record, the card showed a pick for 11,000, none of them the same pick the record grades, and no pick for 2,000.'));
    assert.ok(how(withCounts(20000, 0, 0, 20000)).includes('Of the 20,000 fixtures checked against the graded record, the card showed no pick for 20,000.'));
    assert.ok(how(withCounts(1000, 1000, 1000, 0)).includes('Of the 1,000 fixtures checked against the graded record, the card showed a pick for 1,000, all of them the same pick the record grades.'));
  });
  test('rule 1: "chosen from N priced markets"', () => {
    for (const [m, want] of [[1092, '1,092'], [10920, '10,920']]) {
      const d = withCounts(0, 0, 0, 0);
      delete d.accuracy_rule;
      d.counts.markets_per_fixture = m;
      assert.ok(how(d).includes(`At most one recommended pick per fixture, chosen from ${want} priced markets.`), how(d));
    }
  });
});

describe('day pills (build.mjs dayPills): fraction, "N fixtures" and the aria-label', () => {
  const D = '2026-10-07';
  const entry = (day, fixtures, accuracy) => ({ day, compacted: true, picks_hash: `sha256:${'a'.repeat(64)}`, fixtures, accuracy });
  const pills = (tomorrow) => {
    const listed = [
      entry('2026-10-08', tomorrow, acc(0, 0, 0, null)),
      entry(D, 1300, acc(1200, 0, 0, 100)),
      entry('2026-10-06', 1534, acc(1131, 177, 50, 86.47)),
      entry('2026-10-05', 12345, acc(10081, 2073, 1234, 82.94)),
    ];
    const html = page(dayPills(listed, D, D, { onDayPage: true }));
    const as = findAll(parse(html), (n) => n.tag === 'a');
    const part = (a, cls) => textOf(find(a, (n) => (n.attrs.class ?? '').split(/\s+/).includes(cls)));
    return { html, by: Object.fromEntries(as.map((a) => [a.attrs.href.slice(5, 15), { fig: part(a, 'day-pill__fig'), sub: part(a, 'day-pill__sub'), aria: a.attrs['aria-label'] }])) };
  };
  for (const [tomorrow, want] of [[1534, '1,534'], [12345, '12,345']]) {
    test(`tomorrow with ${want} fixtures; graded days with four and five digits`, () => {
      const { html, by } = pills(tomorrow);
      assert.deepEqual(by['2026-10-08'], { fig: want, sub: 'fixtures', aria: `Thursday 8 October: ${want} fixtures` });
      assert.equal(by['2026-10-06'].sub, '1,131 of 1,308');
      assert.equal(by['2026-10-06'].aria, 'Tuesday 6 October: 1,131 of 1,308 picks right, 86.5%');
      assert.equal(by['2026-10-05'].sub, '10,081 of 12,154');
      assert.equal(by['2026-10-05'].aria, 'Monday 5 October: 10,081 of 12,154 picks right, 82.9%');
      assert.equal(by[D].sub, '1,200 of 1,200');
      assert.equal(by[D].aria, 'All right, Wednesday 7 October: 1,200 of 1,200 picks right');
      assert.deepEqual(bareCounts(html), []);
      assert.deepEqual(claimViolations(html), []);
    });
  }
});

// ------------------------------------------------------------------ whole builds

describe('a build whose every count runs to four or five digits', () => {
  let ws;
  let home;
  let files;
  const read = (rel) => readFile(join(ws.out, rel), 'utf8');
  before(async () => {
    ws = await workspace();
    home = await bigArtifact(ws.root);
    await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: () => {} });
    files = await htmlFiles(ws.out);
  });
  after(() => ws.cleanup());

  test('premise: the home card has thousands of fixtures and graded picks', () => {
    assert.ok(home.fixtures.length >= 3000 && home.accuracy.won >= 1000 && home.pick_source.ledger_match_n >= 1000);
    assert.ok(BIG.d6.fixtures >= 10000 && BIG.d6.accuracy.won >= 10000);
  });

  test('home and the day page: header, day bar, ring, "How this card was built"', async () => {
    const active = home.fixtures.filter((f) => f.withdrawn !== true);
    const comps = new Set(active.map((f) => f.comp)).size;
    const gone = home.fixtures.length - active.length;
    assert.ok(active.length >= 1000 && gone > 0, 'premise');
    const a = home.accuracy;
    const ps = home.pick_source;
    assert.equal(ps.ledger_match_matched, ps.ledger_match_served_n, 'premise: every pick matched');
    for (const rel of ['index.html', 'day/2026-10-08/index.html']) {
      const html = await read(rel);
      const t = visibleText(html);
      assert.ok(t.includes(`${us(active.length)} fixtures in ${us(comps)} competitions (${us(gone)} withdrawn)`), `${rel}: header`);
      assert.ok(t.includes(` · ${us(active.length)} fixtures · by kickoff`), `${rel}: day bar`);
      assert.ok(t.includes(`${us(a.won)} of ${us(a.graded)} landed`), `${rel}: ring`);
      const ringEl = find(parse(html), (n) => n.attrs['data-figure'] === 'ring');
      assert.ok(ringEl.attrs['aria-label'].includes(`: ${us(a.won)} of ${us(a.graded)} landed (${a.pct}%).`), ringEl.attrs['aria-label']);
      assert.ok(t.includes(`Of the ${us(ps.ledger_match_n)} fixtures checked against the graded record, the card showed a pick for ${us(ps.ledger_match_served_n)}, all of them the same pick the record grades, and no pick for ${us(ps.ledger_match_unserved)}.`), `${rel}: how built`);
      // data-* attributes stay raw integers: balloon.js reads them
      const main = find(parse(html), (n) => n.tag === 'main');
      assert.equal(main.attrs['data-ring-won'], String(a.won));
      assert.equal(main.attrs['data-ring-graded'], String(a.graded));
      assert.match(main.attrs['data-ring-won'], /^\d{4,}$/);
    }
  });

  test('the day pills: four- and five-digit fractions, in the text and the aria-label', async () => {
    const html = await read('index.html');
    const nav = find(parse(html), (n) => n.tag === 'nav' && /\bday-pills\b/.test(n.attrs.class ?? ''));
    const t = textOf(nav);
    const labels = findAll(nav, (n) => n.tag === 'a').map((x) => x.attrs['aria-label']).join(' | ');
    for (const d of [BIG.d5, BIG.d6, { accuracy: home.accuracy }]) {
      const frac = `${us(d.accuracy.won)} of ${us(d.accuracy.graded)}`;
      assert.ok(t.includes(frac), `${frac} in ${t}`);
      assert.ok(labels.includes(`${frac} picks right`), labels);
    }
  });

  test('archived days: "N fixtures listed", the ring and its pushes', async () => {
    for (const d of [BIG.d5, BIG.d6]) {
      const html = await read(`day/${d.day}/index.html`);
      const t = visibleText(html);
      assert.ok(t.includes(`${us(d.fixtures)} fixtures listed`), `${d.day}: ${t.slice(0, 400)}`);
      assert.ok(t.includes(`${us(d.accuracy.won)} of ${us(d.accuracy.graded)} landed`), d.day);
      assert.ok(t.includes(`${us(d.accuracy.pushes)} pushes not counted`), d.day);
    }
  });

  test('premise: Our Record and the founding copy already print separated counts', async () => {
    assert.match(visibleText(await read('our-record/index.html')), /\d{1,3},\d{3} of \d{1,3},\d{3}/);
    assert.match(visibleText(await read('terms/index.html')), /There are 1,000 founding places in total/);
    assert.match(visibleText(await read('waitlist/index.html')), /1,000 places\./);
  });

  test('guard: no page of the build carries a bare count of four or more digits', () => {
    assert.ok(files.length >= 14, `premise: every page was read (${files.length})`);
    const hits = files.flatMap(({ rel, html }) => bareCounts(html).map((h) => `${rel} — ${h}`));
    assert.deepEqual(hits, []);
  });

  test('the claim scanner accepts every separated fraction', () => {
    for (const { rel, html } of files) assert.deepEqual(claimViolations(html), [], rel);
  });
});

describe('guard: the ordinary builds carry no bare count either', () => {
  let ws;
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    await addArchive(ws.root);
    await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: () => {} });
  });
  after(() => ws.cleanup());

  test('the fixture artifact with its archive', async () => {
    const files = await htmlFiles(ws.out);
    assert.ok(files.length >= 14);
    assert.deepEqual(files.flatMap(({ rel, html }) => bareCounts(html).map((h) => `${rel} — ${h}`)), []);
  });
});
