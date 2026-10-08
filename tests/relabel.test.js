// Relative day labels follow the VISITOR's Lagos date (Task 6 review I2), and the browser entry
// modules' init() works against real built pages (review M5). The static HTML states every day by
// its date (true whenever it is read, with or without JS); stale.js turns a label into "Today…" /
// "Tomorrow…" on each page view. Built modules are imported from dist; the DOM is a hand-rolled fake
// (tests/fake-dom.js) built from the real built HTML.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from '../site/build.mjs';
import { fmtDayLong } from '../site/lib/time.js';
import { parse, findAll, textOf, visibleText } from './html-scan.js';
import { fakeDocument } from './fake-dom.js';
import { testConfig, workspace, copyArtifact, addArchive, readJson, htmlFiles } from './site-fixtures.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');
const BEFORE_MIDNIGHT = Date.parse('2026-10-07T22:59:59Z'); // 23:59:59 WAT, Wed 7 Oct
const MIDNIGHT = Date.parse('2026-10-07T23:00:00Z'); //        00:00:00 WAT, Thu 8 Oct
const FAR = Date.parse('2030-01-01T12:00:00Z');
const KINDS = ['eyebrow', 'strip', 'ring', 'next', 'record', 'daybar'];
const sync = (fn) => fn();
const noTimer = () => {};

let ws;
let stale;
let dayjs;
before(async () => {
  ws = await workspace();
  await copyArtifact(ws.root);
  await addArchive(ws.root);
  await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: () => {} });
  stale = await import(pathToFileURL(join(ws.out, 'assets/js/stale.js')).href);
  dayjs = await import(pathToFileURL(join(ws.out, 'assets/js/day.js')).href);
});
after(() => ws.cleanup());

const page = (rel) => readFile(join(ws.out, rel), 'utf8');

// ------------------------------------------------------------------ the pure function

describe('relLabel at the Lagos-midnight boundary', () => {
  const W7 = fmtDayLong('2026-10-07');
  const T8 = fmtDayLong('2026-10-08');

  test('23:59:59 WAT on the 7th: the 7th is today, the 8th tomorrow', () => {
    assert.equal(stale.relLabel('2026-10-07', BEFORE_MIDNIGHT, 'ring'), "Today's published picks, settled so far");
    assert.equal(stale.relLabel('2026-10-08', BEFORE_MIDNIGHT, 'ring'), "Tomorrow's published picks, settled so far");
    assert.equal(stale.relLabel('2026-10-07', BEFORE_MIDNIGHT, 'eyebrow'), 'Today');
    assert.equal(stale.relLabel('2026-10-08', BEFORE_MIDNIGHT, 'strip'), 'Tomorrow');
    assert.equal(stale.relLabel('2026-10-08', BEFORE_MIDNIGHT, 'next'), "Tomorrow's card is published:");
    assert.equal(stale.relLabel('2026-10-07', BEFORE_MIDNIGHT, 'record'), 'Today · so far');
    // The record never says "Tomorrow" (nothing is settled ahead of its day).
    assert.equal(stale.relLabel('2026-10-08', BEFORE_MIDNIGHT, 'record'), '');
    // The day bar says "Today" only for today; tomorrow keeps its date form.
    assert.equal(stale.relLabel('2026-10-07', BEFORE_MIDNIGHT, 'daybar'), `Today · ${W7}`);
    assert.equal(stale.relLabel('2026-10-08', BEFORE_MIDNIGHT, 'daybar'), T8);
  });

  test('00:00:00 WAT on the 8th: the 7th is a date, the 8th is today', () => {
    assert.equal(stale.relLabel('2026-10-07', MIDNIGHT, 'ring'), `Picks published for ${W7}, settled so far`);
    assert.equal(stale.relLabel('2026-10-08', MIDNIGHT, 'ring'), "Today's published picks, settled so far");
    assert.equal(stale.relLabel('2026-10-07', MIDNIGHT, 'eyebrow'), '');
    assert.equal(stale.relLabel('2026-10-08', MIDNIGHT, 'eyebrow'), 'Today');
    assert.equal(stale.relLabel('2026-10-08', MIDNIGHT, 'next'), "Today's card is published:");
    // A past day carries no label at all: never "In progress" (Plan A Task 5, review I1).
    assert.equal(stale.relLabel('2026-10-07', MIDNIGHT, 'record'), '');
    assert.equal(stale.relLabel('2026-10-08', MIDNIGHT, 'record'), 'Today · so far');
    assert.equal(stale.relLabel('2026-10-07', MIDNIGHT, 'daybar'), W7);
    assert.equal(stale.relLabel('2026-10-08', MIDNIGHT, 'daybar'), `Today · ${T8}`);
  });

  test('a day two ahead, or in the past, reads as its date', () => {
    assert.equal(stale.relLabel('2026-10-09', BEFORE_MIDNIGHT, 'next'), `The card for ${fmtDayLong('2026-10-09')} is published:`);
    assert.equal(stale.relLabel('2026-10-08', FAR, 'ring'), `Picks published for ${T8}, settled so far`);
    assert.equal(stale.relLabel('2026-10-08', FAR, 'strip'), '');
    assert.equal(stale.relLabel('2026-10-08', FAR, 'record'), '');
    assert.equal(stale.relLabel('2026-10-08', FAR, 'daybar'), T8);
  });

  test('relDay names only today and tomorrow; bad input never throws', () => {
    assert.equal(stale.relDay('2026-10-07', BEFORE_MIDNIGHT), 'today');
    assert.equal(stale.relDay('2026-10-08', BEFORE_MIDNIGHT), 'tomorrow');
    assert.equal(stale.relDay('2026-10-06', BEFORE_MIDNIGHT), null);
    assert.equal(stale.relDay('nope', BEFORE_MIDNIGHT), null);
    assert.throws(() => stale.relLabel('2026-10-07', BEFORE_MIDNIGHT, 'nope'), /kind/);
  });

  test('msUntilLagosMidnight counts to the next 00:00 WAT', () => {
    assert.equal(stale.msUntilLagosMidnight(BEFORE_MIDNIGHT), 1000);
    assert.equal(stale.msUntilLagosMidnight(MIDNIGHT), 86400000);
  });
});

// ------------------------------------------------------------------ the static HTML

describe('static labels are dates, tagged for relabelling', () => {
  test('no home, day or record page states "today" or "tomorrow" in its static text', async () => {
    for (const { rel, html } of await htmlFiles(ws.out)) {
      if (!/^(index\.html|day\/|our-record\/)/.test(rel)) continue;
      assert.doesNotMatch(visibleText(html), /\b(today|tomorrow)('s)?\b/i, rel);
    }
  });

  test('every tagged label\'s static text is relLabel\'s date form for its date and kind', async () => {
    const seen = new Set();
    for (const { rel, html } of await htmlFiles(ws.out)) {
      for (const el of findAll(parse(html), (n) => n.attrs['data-rel-day'] !== undefined)) {
        const kind = el.attrs['data-rel'];
        const date = el.attrs['data-rel-day'];
        assert.ok(KINDS.includes(kind), `${rel}: kind ${kind}`);
        seen.add(kind);
        const shown = kind === 'ring' ? textOf(findAll(el, (n) => n.attrs.class === 'ring__label')[0]) : textOf(el);
        assert.equal(shown, stale.relLabel(date, FAR, kind), `${rel}: ${kind} ${date}`);
        if (kind === 'eyebrow' || kind === 'strip' || kind === 'record') assert.ok(el.attrs.hidden !== undefined, `${rel}: an empty ${kind} is hidden`);
        if (kind === 'ring') assert.ok(el.attrs['aria-label'].startsWith(shown), `${rel}: ring aria-label starts with its label`);
      }
    }
    assert.deepEqual([...seen].sort(), [...KINDS].sort(), 'premise: every kind of label occurs in the build');
  });

  test('every page with a tagged label loads stale.js', async () => {
    for (const { rel, html } of await htmlFiles(ws.out)) {
      const doc = parse(html);
      if (findAll(doc, (n) => n.attrs['data-rel-day'] !== undefined).length === 0) continue;
      assert.ok(findAll(doc, (n) => n.tag === 'script' && n.attrs.src === '/assets/js/stale.js').length === 1, rel);
    }
  });
});

// ------------------------------------------------------------------ stale.js init on real pages

describe('stale.js init on built pages (fake DOM)', () => {
  const ringLabel = (doc) => doc.querySelector('.ring__label').textContent;

  test('home at 23:59:59 WAT: Today / Tomorrow, no banner', async () => {
    const doc = fakeDocument(await page('index.html'));
    stale.init({ doc, nowMs: BEFORE_MIDNIGHT, raf: sync, setTimer: noTimer });
    assert.equal(ringLabel(doc), "Today's published picks, settled so far");
    assert.match(doc.querySelector('[data-figure="ring"]').getAttribute('aria-label'), /^Today's published picks, settled so far: /);
    const eyebrow = doc.querySelector('[data-rel="eyebrow"]');
    assert.equal(eyebrow.textContent, 'Today');
    assert.equal(eyebrow.hidden, false);
    assert.equal(doc.querySelector('[data-rel="next"]').textContent, "Tomorrow's card is published:");
    const tags = doc.querySelectorAll('[data-rel="strip"]').map((t) => [t.getAttribute('data-rel-day'), t.textContent, t.hidden]);
    assert.deepEqual(tags.filter(([d]) => d >= '2026-10-07'), [['2026-10-07', 'Today', false], ['2026-10-08', 'Tomorrow', false]]);
    assert.equal(doc.querySelector('.stale').hidden, true);
    const bar = doc.querySelector('[data-rel="daybar"]');
    assert.equal(bar.textContent, `Today · ${fmtDayLong('2026-10-07')}`);
    assert.equal(bar.hidden, false, 'the day bar label is never hidden');
  });

  test('home at 00:00:00 WAT: the 7th reads as its date, the 8th as today, and the banner links it', async () => {
    const doc = fakeDocument(await page('index.html'));
    stale.init({ doc, nowMs: MIDNIGHT, raf: sync, setTimer: noTimer });
    assert.equal(ringLabel(doc), `Picks published for ${fmtDayLong('2026-10-07')}, settled so far`);
    assert.equal(doc.querySelector('[data-rel="eyebrow"]').hidden, true);
    assert.equal(doc.querySelector('[data-rel="next"]').textContent, "Today's card is published:");
    assert.equal(doc.querySelector('[data-rel="daybar"]').textContent, fmtDayLong('2026-10-07'), 'yesterday reads as its date');
    const region = doc.querySelector('.stale');
    assert.equal(region.hidden, false);
    assert.match(region.textContent, /It's Thu 8 Oct 2026 in Lagos — today's card is here:/);
    assert.equal(region.querySelector('a').getAttribute('href'), '/day/2026-10-08/');
  });

  test('the banner is filled on the frame after it is unhidden', async () => {
    const doc = fakeDocument(await page('index.html'));
    let frame = null;
    stale.init({ doc, nowMs: MIDNIGHT, raf: (fn) => { frame = fn; }, setTimer: noTimer });
    const region = doc.querySelector('.stale');
    assert.equal(region.hidden, false);
    assert.equal(region.textContent, '', 'empty until the next frame');
    frame();
    assert.match(region.textContent, /today's card is here/);
  });

  test('the tomorrow page relabels too: Tomorrow before midnight, Today after', async () => {
    const html = await page('day/2026-10-08/index.html');
    const before1 = fakeDocument(html);
    stale.init({ doc: before1, nowMs: BEFORE_MIDNIGHT, raf: sync, setTimer: noTimer });
    assert.equal(before1.querySelector('[data-rel="eyebrow"]').textContent, 'Tomorrow');
    assert.equal(ringLabel(before1), "Tomorrow's published picks, settled so far");
    const after1 = fakeDocument(html);
    stale.init({ doc: after1, nowMs: MIDNIGHT, raf: sync, setTimer: noTimer });
    assert.equal(after1.querySelector('[data-rel="eyebrow"]').textContent, 'Today');
    assert.equal(ringLabel(after1), "Today's published picks, settled so far");
    assert.equal(after1.querySelector('.stale').hidden, true, 'a day page never says the card is old');
    assert.equal(before1.querySelector('[data-rel="daybar"]').textContent, fmtDayLong('2026-10-08'), 'tomorrow keeps its date');
    assert.equal(after1.querySelector('[data-rel="daybar"]').textContent, `Today · ${fmtDayLong('2026-10-08')}`);
  });

  test('the record page labels its day "Today · so far" only while it is today', async () => {
    const html = await page('our-record/index.html');
    assert.equal(findAll(parse(html), (n) => n.attrs['data-rel'] === 'record').length, 1, 'premise: one tagged day');
    const a = fakeDocument(html);
    stale.init({ doc: a, nowMs: BEFORE_MIDNIGHT, raf: sync, setTimer: noTimer });
    const ta = a.querySelector('[data-rel="record"]');
    assert.equal(ta.textContent, 'Today · so far');
    assert.equal(ta.hidden, false);
    const b = fakeDocument(html);
    stale.init({ doc: b, nowMs: MIDNIGHT, raf: sync, setTimer: noTimer });
    const tb = b.querySelector('[data-rel="record"]');
    assert.equal(tb.textContent, '', 'a past day is never "In progress"');
    assert.equal(tb.hidden, true);
    // Still open at the next midnight: the label goes away.
    const timers = [];
    const c = fakeDocument(html);
    stale.init({ doc: c, nowMs: BEFORE_MIDNIGHT, raf: sync, setTimer: (fn, ms) => timers.push([fn, ms]), now: () => MIDNIGHT });
    assert.equal(c.querySelector('[data-rel="record"]').hidden, false);
    timers[0][0]();
    assert.equal(c.querySelector('[data-rel="record"]').hidden, true);
  });

  test('an open page relabels itself at the next Lagos midnight', async () => {
    const doc = fakeDocument(await page('index.html'));
    const timers = [];
    stale.init({ doc, nowMs: BEFORE_MIDNIGHT, raf: sync, setTimer: (fn, ms) => timers.push([fn, ms]), now: () => MIDNIGHT });
    assert.equal(timers.length, 1);
    assert.ok(timers[0][1] >= 1000 && timers[0][1] < 5000, `scheduled ${timers[0][1]} ms ahead`);
    timers[0][0]();
    assert.equal(doc.querySelector('[data-rel="eyebrow"]').hidden, true);
    assert.equal(doc.querySelector('[data-rel="next"]').textContent, "Today's card is published:");
  });
});

// ------------------------------------------------------------------ day.js init on real stubs

describe('day.js init on built stubs (fake DOM)', () => {
  let edge;
  before(async () => { edge = await readJson(join(ws.out, 'days/2026-10-06.json')); });
  const respond = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });

  test('a good file replaces the summary with the full, relabelled card', async () => {
    const doc = fakeDocument(await page('day/2026-10-06/index.html'));
    const calls = [];
    await dayjs.init({ doc, fetchImpl: async (u, o) => { calls.push(o); return respond(edge)(); }, nowMs: FAR });
    const root = doc.getElementById('day-root');
    assert.equal(calls[0].cache, 'no-cache');
    assert.equal(root.querySelectorAll('li').filter((l) => l.hasAttribute('data-fx')).length, edge.fixtures.length);
    assert.equal(root.querySelector('.day-error'), null);
    assert.equal(root.hasAttribute('aria-busy'), false);
    assert.equal(root.querySelector('.ring__label').textContent, `Picks published for ${fmtDayLong('2026-10-06')}, settled so far`);
  });

  test('the fetched card is relabelled for the visitor\'s date too', async () => {
    const doc = fakeDocument(await page('day/2026-10-06/index.html'));
    await dayjs.init({ doc, fetchImpl: respond(edge), nowMs: Date.parse('2026-10-06T12:00:00Z') });
    assert.equal(doc.querySelector('[data-rel="eyebrow"]').textContent, 'Today');
    assert.equal(doc.querySelector('[data-rel="daybar"]').textContent, `Today · ${fmtDayLong('2026-10-06')}`);
  });

  test('a tampered file keeps the summary and shows the receipt failure, with no link', async () => {
    const doc = fakeDocument(await page('day/2026-10-06/index.html'));
    const bad = structuredClone(edge);
    bad.fixtures.find((f) => f.pick).pick.label = 'edited';
    await dayjs.init({ doc, fetchImpl: respond(bad), nowMs: FAR });
    const root = doc.getElementById('day-root');
    const box = root.querySelector('.day-error');
    assert.ok(box);
    assert.equal(box.getAttribute('role'), 'alert');
    assert.equal(box.textContent, 'This card failed its receipt check, so it is not shown.');
    assert.equal(box.querySelector('a'), null, 'the error box links nowhere');
    assert.ok(root.querySelector('[data-figure="ring"]'), 'the verified summary stays');
    assert.equal(root.querySelectorAll('li').filter((l) => l.hasAttribute('data-fx')).length, 0, 'no unverified row is shown');
    assert.equal(root.querySelector('.day-load'), null, 'the loading line is gone');
  });

  test('a fetch failure shows the load message; no WebCrypto shows the render message', async () => {
    const a = fakeDocument(await page('day/2026-10-06/index.html'));
    await dayjs.init({ doc: a, fetchImpl: respond(null, 404), nowMs: FAR });
    assert.equal(a.querySelector('.day-error').textContent, "We couldn't load this day's card. Please try again later.");
    assert.equal(a.querySelector('.day-error').querySelector('a'), null, 'the load failure links nowhere');
    const b = fakeDocument(await page('day/2026-10-06/index.html'));
    await dayjs.init({ doc: b, fetchImpl: respond(edge), sha256hex: (t) => dayjs.webSha256hex(t, null), nowMs: FAR });
    assert.equal(b.querySelector('.day-error').textContent, "This card couldn't be displayed.");
    assert.equal(b.querySelector('.day-error').querySelector('a'), null, 'the render failure links nowhere');
  });

  test('a compacted day and a page without a stub do nothing', async () => {
    let called = 0;
    const fetchImpl = async () => { called++; return respond(edge)(); };
    const doc = fakeDocument(await page('day/2026-10-05/index.html'));
    const before1 = doc.getElementById('day-root').textContent;
    await dayjs.init({ doc, fetchImpl, nowMs: FAR });
    await dayjs.init({ doc: fakeDocument(await page('index.html')), fetchImpl, nowMs: FAR });
    assert.equal(called, 0);
    assert.equal(doc.getElementById('day-root').textContent, before1);
  });
});
