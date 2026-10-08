// Spec test 16 — claim safety over every built page (plan Task 6). The scanner is tests/html-scan.js
// claimViolations(): banned phrases (site/lib/claims.js), percentages only inside an allowed figure,
// and the charter's 100% rule. The premise tests inject each kind of violation into real built
// pages and assert the scanner reports it: a scanner that cannot fail proves nothing.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { build } from '../site/build.mjs';
import { claimViolations, percentagesOutsideOffers, visibleText, HEADLINE_PARTS } from './html-scan.js';
import { DISCOUNT_PCT, TOPUP_BONUS_PCT } from '../site/lib/founding.js';
import {
  testConfig, workspace, copyArtifact, addArchive, readJson, writeJson, htmlFiles, EDGE_DAY,
} from './site-fixtures.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');
const quiet = () => {};

async function built(mutate, { artifact = true } = {}) {
  const ws = await workspace();
  if (artifact) await copyArtifact(ws.root);
  if (mutate) await mutate(ws.root);
  await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: quiet });
  return ws;
}

/** Grade the first `won + lost` counted picks of 2026-10-07 (grades are outside picks_hash). */
function grade(won, lost) {
  return async (root) => {
    const p = join(root, 'days/2026-10-07.json');
    const d = await readJson(p);
    const counted = d.fixtures.filter((f) => f.pick && f.pre_ko && !f.withdrawn && Number.isInteger(f.pick.pct));
    assert.ok(counted.length >= won + lost, 'premise: enough picks to grade');
    counted.slice(0, won).forEach((f) => { f.grade = 'won'; });
    counted.slice(won, won + lost).forEach((f) => { f.grade = 'lost'; });
    const graded = won + lost;
    d.accuracy = { won, lost, pushes: 0, graded, pct: Math.round((10000 * won) / graded) / 100 };
    await writeJson(p, d);
    const i = await readJson(join(root, 'index.json'));
    i.days.find((x) => x.day === '2026-10-07').accuracy = d.accuracy;
    await writeJson(join(root, 'index.json'), i);
  };
}

/** The edge-case day (every row state, hostile strings, a 2-of-3 ring) as the only, home day. */
async function edgeHome(root) {
  const edge = await readJson(EDGE_DAY);
  await writeJson(join(root, 'days/2026-10-06.json'), edge);
  const i = await readJson(join(root, 'index.json'));
  i.today = '2026-10-06';
  i.newest_day = '2026-10-06';
  i.days = [{ day: '2026-10-06', compacted: false, picks_hash: edge.picks_hash, fixtures: edge.fixtures.length, accuracy: edge.accuracy }];
  await writeJson(join(root, 'index.json'), i);
}

/** index.today moves past the newest card: home falls back to it, with a notice. */
async function missedToday(root) {
  const i = await readJson(join(root, 'index.json'));
  i.today = '2026-10-09';
  await writeJson(join(root, 'index.json'), i);
}

/** Only tomorrow's card is listed: home shows the no-card state and links it. */
async function onlyTomorrow(root) {
  await rm(join(root, 'days/2026-10-07.json'));
  const i = await readJson(join(root, 'index.json'));
  i.days = i.days.filter((d) => d.day === '2026-10-08');
  await writeJson(join(root, 'index.json'), i);
}

const inject = (html, fragment) => {
  assert.ok(html.includes('</main>'), 'premise: page has a <main>');
  return html.replace('</main>', `${fragment}\n</main>`);
};

describe('every built page passes the claim scan', () => {
  const builds = {};
  before(async () => {
    builds.plain = await built();
    builds.archive = await built(addArchive);
    builds.perfect = await built(grade(3, 0));
    builds.mixed = await built(grade(2, 1));
    builds.edge = await built(edgeHome);
    builds.noData = await built(null, { artifact: false });
    builds.missedToday = await built(missedToday);
    builds.onlyTomorrow = await built(onlyTomorrow);
  });
  after(() => Promise.all(Object.values(builds).map((w) => w.cleanup())));

  for (const name of ['plain', 'archive', 'perfect', 'mixed', 'edge', 'noData', 'missedToday', 'onlyTomorrow']) {
    test(`${name}: no banned phrase, no stray percentage, no bare 100%`, async () => {
      const files = await htmlFiles(builds[name].out);
      assert.ok(files.length >= 11, 'premise: the whole site was built (11 pages with no data)');
      for (const { rel, html } of files) assert.deepEqual(claimViolations(html), [], `${name}: ${rel}`);
    });
  }

  test('premise: the scanned pages really carry each kind of figure', async () => {
    const rec = await readFile(join(builds.plain.out, 'our-record/index.html'), 'utf8');
    assert.match(rec, /data-claim="headline"/);
    assert.match(rec, /data-figure="record-row"/);
    assert.match(visibleText(rec), /84\.48%/);
    const home = await readFile(join(builds.plain.out, 'index.html'), 'utf8');
    assert.match(home, /data-figure="pick-prob"/);
    assert.match(visibleText(home), /\d+%/);
    const stub = await readFile(join(builds.archive.out, 'day/2026-10-05/index.html'), 'utf8');
    assert.match(visibleText(stub), /30 of 36 landed/);
    assert.match(visibleText(stub), /83\.33%/);
    const edge = visibleText(await readFile(join(builds.edge.out, 'index.html'), 'utf8'));
    assert.match(edge, /2 of 3 landed/);
    assert.match(edge, /66\.67%/);
    const mixed = visibleText(await readFile(join(builds.mixed.out, 'index.html'), 'utf8'));
    assert.match(mixed, /2 of 3 landed/);
  });

  test('the 100% rule: a perfect day shows 100% only beside its fraction, "so far" and "stated at"', async () => {
    const text = visibleText(await readFile(join(builds.perfect.out, 'index.html'), 'utf8'));
    assert.match(text, /3 of 3 landed/);
    assert.match(text, /100%/, 'premise: the ring states 100%');
    assert.match(text, /Settled so far\. These picks were stated at an average \d+%\./);
    // The perfect day's own page and its strip entry pass too (scanned above); a bare 100% nowhere.
  });
});

describe('premise: the scanner reports each injected violation', () => {
  let ws;
  let pages;
  before(async () => {
    ws = await built();
    pages = Object.fromEntries((await htmlFiles(ws.out)).map(({ rel, html }) => [rel, html]));
  });
  after(() => ws.cleanup());

  const SAMPLE = ['index.html', 'our-record/index.html', 'features/index.html', 'privacy/index.html', 'terms/index.html',
    'refunds/index.html', 'waitlist/index.html', 'waitlist/thanks/index.html', '404.html', 'day/2026-10-08/index.html'];

  test('a bare <p>83%</p> on any page is reported', () => {
    for (const rel of SAMPLE) {
      const v = claimViolations(inject(pages[rel], '<p>83%</p>'));
      assert.ok(v.some((m) => /percentage "83%" outside an allowed figure/.test(m)), `${rel}: ${v}`);
    }
  });

  test('a percentage split over inline tags is still one percentage', () => {
    const v = claimViolations(inject(pages['index.html'], '<p>8<b>3</b>%</p>'));
    assert.ok(v.some((m) => /"83%"/.test(m)), String(v));
  });

  test('a 100% in a ring-like element without "stated at" is reported; with it, it passes', () => {
    const bad = '<div data-figure="ring"><span>3 of 3 landed</span> <span>100%</span> <span>settled so far</span></div>';
    const v = claimViolations(inject(pages['index.html'], bad));
    assert.ok(v.some((m) => /"100%" without its fraction, "so far" and "stated at"/.test(m)), String(v));
    assert.ok(!v.some((m) => /outside an allowed figure/.test(m)), 'the ring itself is an allowed figure');
    const good = '<div data-figure="ring"><span>3 of 3 landed</span> <span>100%</span> <span>Settled so far. These picks were stated at an average 84%.</span></div>';
    assert.deepEqual(claimViolations(inject(pages['index.html'], good)), []);
  });

  test('a 100% without its fraction is reported even with "stated at"', () => {
    const v = claimViolations(inject(pages['index.html'], '<div data-figure="pick-prob"><b>100%</b> settled so far, stated at 100%</div>'));
    assert.ok(v.some((m) => /"100%" without/.test(m)), String(v));
  });

  test('a ring percentage without its fraction is reported', () => {
    const v = claimViolations(inject(pages['index.html'], '<div data-figure="ring"><span>85.71%</span></div>'));
    assert.ok(v.some((m) => /"85.71%" outside an allowed figure/.test(m)), String(v));
  });

  test('ROI (and every banned phrase) is reported, in the body or in the title', () => {
    for (const rel of SAMPLE) {
      const v = claimViolations(inject(pages[rel], '<p>Our ROI speaks for itself.</p>'));
      assert.ok(v.includes('banned phrase "ROI"'), `${rel}: ${v}`);
    }
    const t = pages['index.html'].replace(/<title>[^<]*<\/title>/, '<title>Sure bet of the day — Bet Gaffer</title>');
    assert.ok(claimViolations(t).includes('banned phrase "sure bet"'));
    const d = pages['index.html'].replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Make money with football">');
    assert.ok(claimViolations(d).includes('banned phrase "make money"'));
  });

  test('aria-label, title and alt are scanned too: banned phrases and stray percentages', () => {
    const home = pages['index.html'];
    for (const [frag, want] of [
      ['<span aria-label="Our ROI">x</span>', 'banned phrase "ROI"'],
      ['<span title="A sure bet">x</span>', 'banned phrase "sure bet"'],
      ['<img src="/assets/img/mark.svg" alt="jackpot">', 'banned phrase "jackpot"'],
    ]) assert.ok(claimViolations(inject(home, frag)).includes(want), `${frag}: ${claimViolations(inject(home, frag))}`);
    for (const frag of ['<span aria-label="83% of picks">x</span>', '<abbr title="landed 83%">x</abbr>', '<img src="/x.png" alt="83%">']) {
      const v = claimViolations(inject(home, frag));
      assert.ok(v.some((m) => /"83%" outside an allowed figure/.test(m)), `${frag}: ${v}`);
    }
    const bare100 = claimViolations(inject(home, '<div data-figure="ring" aria-label="3 of 3 landed (100%)"><span>3 of 3 landed</span></div>'));
    assert.ok(bare100.some((m) => /"100%" without/.test(m)), String(bare100));
  });

  test('premise: the real ring\'s aria-label percentage is scanned and allowed', async () => {
    const w = await built(grade(2, 1));
    try {
      const html = await readFile(join(w.out, 'index.html'), 'utf8');
      assert.match(html, /aria-label="[^"]*\(66\.67%\)/);
      assert.deepEqual(claimViolations(html), []);
    } finally {
      await w.cleanup();
    }
  });

  test('the ALLOW phrase passes; the word it contains does not', () => {
    assert.deepEqual(claimViolations(inject(pages['index.html'], '<p>Gamblers Anonymous</p>')), []);
    assert.ok(claimViolations(inject(pages['index.html'], '<p>for every gambler</p>')).includes('banned phrase "gambler"'));
  });

  test('the headline needs its period (the one part it carries, Plan A Task 5) and its fraction', () => {
    assert.deepEqual([...HEADLINE_PARTS], ['period']);
    const rec = pages['our-record/index.html'];
    assert.deepEqual(claimViolations(rec), [], 'premise: the real record page is clean');
    for (const part of HEADLINE_PARTS) {
      const html = rec.replace(`data-claim-part="${part}"`, 'data-x="removed"');
      assert.notEqual(html, rec, `premise: ${part} present`);
      const v = claimViolations(html);
      assert.ok(v.some((m) => /84\.48%" outside an allowed figure/.test(m)), `${part}: ${v}`);
    }
    // A period part with no text licenses nothing either.
    const blank = rec.replace(/(<p [^>]*data-claim-part="period"[^>]*>)[^]*?(<\/p>)/, '$1$2');
    assert.notEqual(blank, rec);
    assert.ok(claimViolations(blank).some((m) => /84\.48%" outside an allowed figure/.test(m)), 'blank period');
    // A headline whose text lost every "X of Y" fraction no longer licenses its percentage.
    const noFrac = rec.replace(/<p class="rec-hero">[^]*?<\/p>/, '');
    assert.notEqual(noFrac, rec);
    assert.ok(claimViolations(noFrac).some((m) => /84\.48%" outside an allowed figure/.test(m)), 'no fraction');
  });

  test('a record row whose text lacks its period, or its fraction, is reported', () => {
    const rec = pages['our-record/index.html'];
    const moved = rec.replace(/data-figure="record-row" data-period="(\d{4}-\d{2})"/, 'data-figure="record-row" data-period="1999-01"');
    assert.notEqual(moved, rec);
    assert.ok(claimViolations(moved).some((m) => /outside an allowed figure/.test(m)));
    const row = '<div data-figure="record-row" data-period="2026-10"><p>October 2026</p><p>84.10%</p></div>';
    assert.ok(claimViolations(inject(rec, row)).some((m) => /"84.10%" outside/.test(m)));
  });

  // Offer figures (Plan A Task 1b): the founding offer's two percentages are allowed, and only inside
  // an element marked data-figure="offer". Same code path as the real page scan (claimViolations).
  test(`an offer figure licenses exactly ${DISCOUNT_PCT}% and ${TOPUP_BONUS_PCT}%, and nothing else`, () => {
    assert.deepEqual([DISCOUNT_PCT, TOPUP_BONUS_PCT], [30, 20], 'premise: the fixtures below use the programme numbers');
    for (const rel of SAMPLE) {
      assert.deepEqual(claimViolations(inject(pages[rel], '<p><span data-figure="offer">30% off</span></p>')), [], `${rel}: 30% off`);
      assert.deepEqual(claimViolations(inject(pages[rel], '<p><span data-figure="offer">20% extra</span></p>')), [], `${rel}: 20% extra`);
      const wrong = claimViolations(inject(pages[rel], '<p><span data-figure="offer">25% off</span></p>'));
      assert.ok(wrong.some((m) => /percentage "25%" outside an allowed figure/.test(m)), `${rel}: 25% in an offer: ${wrong}`);
      const bare = claimViolations(inject(pages[rel], '<p>30% off</p>'));
      assert.ok(bare.some((m) => /percentage "30%" outside an allowed figure/.test(m)), `${rel}: bare 30%: ${bare}`);
    }
  });

  test('an offer figure holding one wrong percentage licenses none of them', () => {
    const v = claimViolations(inject(pages['index.html'], '<p><span data-figure="offer">30% off, then 83% more</span></p>'));
    assert.ok(v.some((m) => /"83%" outside an allowed figure/.test(m)), String(v));
    assert.ok(v.some((m) => /"30%" outside an allowed figure/.test(m)), String(v));
  });

  test('an offer figure split over inline tags, or nested deeper, is still judged by its whole text', () => {
    assert.deepEqual(claimViolations(inject(pages['index.html'], '<p data-figure="offer"><b>3</b>0% off <em>every</em> payment</p>')), []);
    const v = claimViolations(inject(pages['index.html'], '<div data-figure="offer"><p>30% off</p><p>2<b>5</b>% extra</p></div>'));
    assert.ok(v.some((m) => /"25%" outside an allowed figure/.test(m)), String(v));
  });

  test('an offer figure\'s aria-label, title and alt are held to the same two values', () => {
    const home = pages['index.html'];
    assert.deepEqual(claimViolations(inject(home, '<span data-figure="offer" aria-label="30% off">30% off</span>')), []);
    for (const frag of ['<span data-figure="offer" aria-label="25% off">30% off</span>',
      '<span data-figure="offer" title="25% off">30% off</span>',
      '<span data-figure="offer"><img src="/x.png" alt="25% off"> 30% off</span>']) {
      const v = claimViolations(inject(home, frag));
      assert.ok(v.some((m) => /"25%" outside an allowed figure/.test(m)), `${frag}: ${v}`);
    }
  });

  test('an offer figure licenses the two numbers as written, not a longer number ending in them', () => {
    for (const fig of ['1,030% off', '130% off', '030% off', '1.30% off', '30.0% off', '5,20% extra']) {
      const html = inject(pages['index.html'], `<p><span data-figure="offer">${fig}</span></p>`);
      assert.ok(claimViolations(html).some((m) => /outside an allowed figure/.test(m)), `${fig}: ${claimViolations(html)}`);
      const attr = inject(pages['index.html'], `<span data-figure="offer" aria-label="${fig}">30% off</span>`);
      assert.ok(claimViolations(attr).some((m) => /outside an allowed figure, in aria-label/.test(m)), `aria ${fig}: ${claimViolations(attr)}`);
    }
  });

  test('a data-figure value that only looks like "offer" licenses nothing', () => {
    for (const fig of ['Offer', 'offers', ' offer', 'offer x']) {
      const v = claimViolations(inject(pages['index.html'], `<p><span data-figure="${fig}">30% off</span></p>`));
      assert.ok(v.some((m) => /"30%" outside an allowed figure/.test(m)), `${fig}: ${v}`);
    }
  });

  test('a content page carries no percentage outside an offer figure', () => {
    for (const rel of ['features/index.html', 'privacy/index.html', 'terms/index.html', 'refunds/index.html']) {
      assert.deepEqual(percentagesOutsideOffers(pages[rel]), [], rel);
      // Premise: the same check fires on a bare percentage and on a non-offer figure on that page.
      assert.ok(percentagesOutsideOffers(inject(pages[rel], '<p>30% off</p>')).some((m) => /"30%"/.test(m)), `${rel}: bare`);
      assert.ok(percentagesOutsideOffers(inject(pages[rel], '<p><span data-figure="pick-prob">83%</span></p>')).some((m) => /"83%"/.test(m)), `${rel}: pick-prob`);
      assert.deepEqual(percentagesOutsideOffers(inject(pages[rel], '<p><span data-figure="offer">30% off</span></p>')), [], `${rel}: offer`);
    }
  });

  test('the scanner refuses malformed markup instead of guessing its structure', () => {
    assert.throws(() => claimViolations(inject(pages['index.html'], '<p><div>83%</div></p>')), /inside an open <p>/);
    assert.throws(() => claimViolations(inject(pages['index.html'], '<span>unclosed')), /closes|never closed/);
    assert.throws(() => claimViolations(inject(pages['index.html'], '<p>a < b</p>')), /bare "<"/);
  });
});
