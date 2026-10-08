// The floating accuracy ring (Plan B Task B4, spec §6 and §15): one design at every width — the
// large ring with yesterday from 1024 px, a ~64 px ring with today's figure only below — both
// draggable, each remembering its own position. The pure model (site/lib/balloon-model.js) is
// tested directly; the browser module is imported from a real build (its ./lib/ imports resolve
// there) and driven through the hand-rolled fake DOM (tests/fake-dom.js).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from '../site/build.mjs';
import {
  DESKTOP_MIN, GAP, NOMINAL, PAD, POS_KEYS, clamp, defaultTop, floorTop, msToLagosMidnight, readFigures, ringModel, sizeClass, storageKey,
} from '../site/lib/balloon-model.js';
import { fakeDocument, fire, serialize, FakeResizeObserver } from './fake-dom.js';
import { claimViolations } from './html-scan.js';
import { REPO_ROOT, testConfig, workspace, copyArtifact } from './site-fixtures.js';

const TODAY = '2026-10-07';
const NOW = Date.parse('2026-10-07T12:00:00Z'); // 13:00 WAT on TODAY
const acc = (won, lost, pct = null, pushes = 0) => ({ won, lost, pushes, graded: won + lost, pct });
const A24 = acc(24, 5, 82.76);
const Y18 = acc(18, 4, 81.82);

let ws;
let balloon;
before(async () => {
  ws = await workspace();
  await copyArtifact(ws.root);
  await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: () => {} });
  balloon = await import(pathToFileURL(join(ws.out, 'assets/js/balloon.js')).href);
});
after(() => ws.cleanup());

/** Every text a model can put on screen or in the accessible name. */
const textsOf = (m) => [m.pctText, m.fracText, m.label, m.dayText, m.aria, m.yday?.pctText, m.yday?.fracText, m.yday?.dayText]
  .filter((t) => typeof t === 'string');

// ------------------------------------------------------------------ the model

describe('ringModel', () => {
  test('partial: the published percentage with its fraction, the arc at that percentage', () => {
    const m = ringModel(A24, { date: TODAY, yesterday: Y18, nowMs: NOW });
    assert.equal(m.state, 'partial');
    assert.equal(m.pctText, '82.76');
    assert.equal(m.fracText, '24 of 29');
    assert.equal(m.dayText, 'Today');
    assert.equal(m.arc, 82.76);
    assert.deepEqual(m.yday, { dayText: 'Yesterday', pctText: '81.82', fracText: '18 of 22' });
    assert.equal(m.aria, "Today's published picks: 24 of 29 landed (82.76%). Yesterday: 18 of 22 (81.82%). Opens Our Record.");
  });

  test('none: "No results yet", no percentage, no fraction, no arc', () => {
    const m = ringModel(acc(0, 0), { date: TODAY, yesterday: Y18, nowMs: NOW });
    assert.equal(m.state, 'none');
    assert.equal(m.pctText, null);
    assert.equal(m.fracText, null);
    assert.equal(m.label, 'No results yet');
    assert.equal(m.arc, null);
    assert.equal(m.aria, "Today's published picks: no results yet. Yesterday: 18 of 22 (81.82%). Opens Our Record.");
  });

  test('perfect: n of n "landed so far", no percentage and no arc (never a bare 100%)', () => {
    const m = ringModel(acc(5, 0, 100), { date: TODAY, nowMs: NOW });
    assert.equal(m.state, 'perfect');
    assert.equal(m.pctText, null);
    assert.equal(m.fracText, '5 of 5');
    assert.equal(m.label, 'landed so far');
    assert.equal(m.arc, null);
    assert.equal(m.yday, null);
    assert.equal(m.aria, "Today's published picks: 5 of 5 landed so far. Opens Our Record.");
  });

  test('a real 0-of-n day shows 0% WITH its fraction', () => {
    const m = ringModel(acc(0, 4, 0), { date: TODAY, nowMs: NOW });
    assert.equal(m.state, 'partial');
    assert.equal(m.pctText, '0');
    assert.equal(m.fracText, '0 of 4');
    assert.equal(m.arc, 0);
    assert.match(m.aria, /0 of 4 landed \(0%\)/);
  });

  test('a percentage that would display as 100 without every pick landing is withheld (and draws no arc)', () => {
    const m = ringModel(acc(19999, 1, 99.995), { date: TODAY, nowMs: NOW });
    assert.equal(m.state, 'partial');
    assert.equal(m.pctText, null);
    assert.equal(m.fracText, '19999 of 20000');
    assert.equal(m.arc, null);
    assert.doesNotMatch(m.aria, /%/);
  });

  test('yesterday: missing, nothing graded, perfect, 0 of n', () => {
    assert.equal(ringModel(A24, { date: TODAY, nowMs: NOW }).yday, null, 'missing');
    assert.equal(ringModel(A24, { date: TODAY, yesterday: acc(0, 0), nowMs: NOW }).yday, null, 'nothing graded');
    const p = ringModel(A24, { date: TODAY, yesterday: acc(6, 0, 100), nowMs: NOW });
    assert.deepEqual(p.yday, { dayText: 'Yesterday', pctText: null, fracText: '6 of 6' });
    assert.match(p.aria, /Yesterday: 6 of 6 landed so far\./);
    assert.deepEqual(ringModel(A24, { date: TODAY, yesterday: acc(0, 3, 0), nowMs: NOW }).yday,
      { dayText: 'Yesterday', pctText: '0', fracText: '0 of 3' });
  });

  test('compact (the phone ring) never carries yesterday', () => {
    const m = ringModel(A24, { date: TODAY, yesterday: Y18, compact: true, nowMs: NOW });
    assert.equal(m.yday, null);
    assert.equal(m.aria, "Today's published picks: 24 of 29 landed (82.76%). Opens Our Record.");
    assert.equal(m.pctText, '82.76');
    assert.equal(m.fracText, '24 of 29');
  });

  test('day wording follows the relabel rules: Today / Tomorrow / the date; yesterday is the day before the shown one', () => {
    const past = ringModel(acc(2, 1, 66.67), { date: '2026-10-05', yesterday: acc(30, 6, 83.33), nowMs: NOW });
    assert.equal(past.dayText, 'Mon 5 Oct');
    assert.equal(past.yday.dayText, 'Sun 4 Oct');
    assert.equal(past.aria, 'Picks published for Mon 5 Oct 2026: 2 of 3 landed (66.67%). Sun 4 Oct 2026: 30 of 36 (83.33%). Opens Our Record.');
    const tomorrow = ringModel(acc(0, 0), { date: '2026-10-08', yesterday: A24, nowMs: NOW });
    assert.equal(tomorrow.dayText, 'Tomorrow');
    assert.equal(tomorrow.yday.dayText, 'Today');
    assert.equal(tomorrow.aria, "Tomorrow's published picks: no results yet. Today: 24 of 29 (82.76%). Opens Our Record.");
    // Yesterday's page, read today: its own label is its date, and the line under it is the day before.
    const yday = ringModel(A24, { date: '2026-10-06', yesterday: Y18, nowMs: NOW });
    assert.equal(yday.dayText, 'Tue 6 Oct');
    assert.equal(yday.yday.dayText, 'Mon 5 Oct');
    // Without a clock (no visitor date) it is the date form, like the static page.
    assert.equal(ringModel(A24, { date: TODAY }).dayText, 'Wed 7 Oct');
  });

  test('never "--%", "0/0", a bare 100% or a percentage without its fraction, over every small case', () => {
    let cases = 0;
    for (let won = 0; won <= 6; won++) {
      for (let lost = 0; lost <= 6; lost++) {
        const g = won + lost;
        const pct = g === 0 ? null : Math.round((won / g) * 10000) / 100;
        for (const y of [null, acc(0, 0), acc(3, 0, 100), acc(0, 2, 0), acc(7, 2, 77.78)]) {
          for (const compact of [false, true]) {
            const m = ringModel(acc(won, lost, pct), { date: TODAY, yesterday: y, compact, nowMs: NOW });
            for (const t of textsOf(m)) {
              assert.doesNotMatch(t, /--%|0\/0|\bNaN\b|undefined|null/, t);
              assert.doesNotMatch(t, /(^|[^\d.])100(\.0+)?%/, `bare 100%: ${t}`);
            }
            if (m.pctText !== null) assert.notEqual(m.fracText, null, 'a percentage always has its fraction');
            if (m.yday && m.yday.pctText !== null) assert.notEqual(m.yday.fracText, null);
            for (const part of m.aria.split('. ')) if (/%/.test(part)) assert.match(part, /\d+ of \d+/, part);
            if (won === 0 && lost === 0) assert.equal(m.pctText, null, '0 graded is never 0%');
            cases++;
          }
        }
      }
    }
    assert.equal(cases, 490);
  });

  test('invalid figures throw (the browser module validates first and renders nothing)', () => {
    assert.throws(() => ringModel({ won: 1, lost: 1, pushes: 0, graded: 3, pct: 50 }, { date: TODAY }), TypeError);
    assert.throws(() => ringModel(acc(1, 1, null), { date: TODAY }), TypeError);
    assert.throws(() => ringModel(acc(0, 0, 0), { date: TODAY }), TypeError);
    assert.throws(() => ringModel(acc(1, 1, 101), { date: TODAY }), TypeError);
    assert.throws(() => ringModel(acc(-1, 1, 0), { date: TODAY }), TypeError);
    assert.throws(() => ringModel(A24, { date: '2026-02-30' }), TypeError);
    assert.throws(() => ringModel(A24, { date: TODAY, yesterday: { won: 1 } }), TypeError);
  });
});

describe('readFigures (fail closed on the <main> data)', () => {
  const attrs = (o) => (name) => (Object.hasOwn(o, name) ? o[name] : null);
  const RING = { 'ring-won': '24', 'ring-lost': '5', 'ring-pushes': '1', 'ring-graded': '29', 'ring-pct': '82.76', 'ring-date': TODAY };
  const YDAY = { 'yday-won': '18', 'yday-lost': '4', 'yday-pushes': '0', 'yday-graded': '22', 'yday-pct': '81.82', 'yday-date': '2026-10-06' };

  test('valid today and yesterday', () => {
    assert.deepEqual(readFigures(attrs({ ...RING, ...YDAY })), {
      today: { won: 24, lost: 5, pushes: 1, graded: 29, pct: 82.76, date: TODAY },
      yesterday: { won: 18, lost: 4, pushes: 0, graded: 22, pct: 81.82, date: '2026-10-06' },
    });
  });

  test('an unrounded published pct (any finite number in [0, 100]) is accepted; the ring rounds it', () => {
    const f = readFigures(attrs({ ...RING, 'ring-pct': '83.33333333333333' }));
    assert.equal(f.today.pct, 83.33333333333333);
    assert.equal(ringModel(f.today, { date: TODAY }).pctText, '83.33');
    for (const ok of ['0', '100', '100.0', '0.5', '99.99999999999999']) assert.notEqual(readFigures(attrs({ ...RING, 'ring-pct': ok })), null, ok);
    for (const bad of ['1e2', '8.3e1', 'Infinity', '100.01', '.5', '5.', '+5', '0x10', '1_0']) assert.equal(readFigures(attrs({ ...RING, 'ring-pct': bad })), null, bad);
  });

  test('no yesterday attributes -> no yesterday; nothing graded today -> pct absent', () => {
    assert.equal(readFigures(attrs(RING)).yesterday, null);
    const none = { ...RING, 'ring-won': '0', 'ring-lost': '0', 'ring-graded': '0' };
    delete none['ring-pct'];
    assert.equal(readFigures(attrs(none)).today.pct, null);
  });

  test('anything invalid -> null (no balloon at all)', () => {
    const bad = [
      {},
      { ...RING, 'ring-graded': '30' }, // graded !== won + lost
      { ...RING, 'ring-won': '-1' },
      { ...RING, 'ring-won': '2.5' },
      { ...RING, 'ring-won': ' 24' },
      { ...RING, 'ring-won': '' },
      { ...RING, 'ring-pct': '101' },
      { ...RING, 'ring-pct': '-1' },
      { ...RING, 'ring-pct': 'NaN' },
      { ...RING, 'ring-pct': '1e2' },
      { ...RING, 'ring-date': '2026-13-01' },
      { ...RING, 'ring-pushes': null },
      (() => { const o = { ...RING }; delete o['ring-pct']; return o; })(), // graded > 0 without pct
      { ...RING, 'ring-won': '0', 'ring-lost': '0', 'ring-graded': '0' }, // pct with nothing graded
      { ...RING, ...YDAY, 'yday-date': '2026-10-05' }, // not the shown day minus one
      { ...RING, ...YDAY, 'yday-graded': '21' },
      (() => { const o = { ...RING, ...YDAY }; delete o['yday-won']; return o; })(), // half a yesterday
    ];
    for (const [i, o] of bad.entries()) assert.equal(readFigures(attrs(o)), null, `case ${i}`);
  });
});

describe('clamp, size class and storage keys', () => {
  const box = { vw: 1280, vh: 800, w: 124, h: 124, minTop: 140 };

  test('inside the box: unchanged', () => {
    assert.deepEqual(clamp({ left: 600, top: 300 }, box), { left: 600, top: 300, fits: true });
  });

  test('left, right, top and bottom edges', () => {
    assert.equal(clamp({ left: -50, top: 300 }, box).left, PAD);
    assert.equal(clamp({ left: 5000, top: 300 }, box).left, 1280 - 124 - PAD);
    assert.equal(clamp({ left: 600, top: 0 }, box).top, 140, 'never above the sticky header + toolbar');
    assert.equal(clamp({ left: 600, top: 5000 }, box).top, 800 - 124 - PAD);
  });

  test('a viewport with no room below the sticky stack does not fit', () => {
    const c = clamp({ left: 10, top: 10 }, { vw: 300, vh: 200, w: 64, h: 64, minTop: 180 });
    assert.equal(c.fits, false);
    assert.equal(clamp({ left: 10, top: 10 }, { vw: 50, vh: 900, w: 64, h: 64, minTop: 0 }).fits, false, 'too narrow');
  });

  test('non-finite input throws', () => {
    assert.throws(() => clamp({ left: Number.NaN, top: 0 }, box), TypeError);
    assert.throws(() => clamp({ left: 0, top: 0 }, { ...box, vh: Infinity }), TypeError);
  });

  test('size class at the 1024 px line; separate keys per size', () => {
    assert.equal(DESKTOP_MIN, 1024);
    assert.equal(sizeClass(1024), 'desktop');
    assert.equal(sizeClass(1023), 'compact');
    assert.equal(sizeClass(Number.NaN), 'compact');
    assert.equal(storageKey('desktop'), 'bg.balloon.pos');
    assert.equal(storageKey('compact'), 'bg.balloon.pos.sm');
    assert.notEqual(POS_KEYS.desktop, POS_KEYS.compact);
    assert.throws(() => storageKey('tablet'), TypeError);
    assert.deepEqual(NOMINAL, { desktop: 124, compact: 64 });
  });

  test('floorTop: GAP under the topbar, or under the toolbar while it is stuck there', () => {
    assert.equal(GAP, 8);
    assert.equal(floorTop(64, null), 72);
    assert.equal(floorTop(64, { top: 300, bottom: 360 }), 72, 'in the flow: not stuck');
    assert.equal(floorTop(64, { top: 64, bottom: 176 }), 184, 'stuck');
    assert.equal(floorTop(64, { top: -50, bottom: 20 }), 72, 'toolbar pushed up behind the header: the floor never rises above the header');
    assert.equal(floorTop(64.4, { top: 65, bottom: 120 }), 128, 'stuck within a pixel of rounding');
    assert.equal(floorTop(64, { top: 0, bottom: 0 }), 72, 'a zero box (not displayed) is not stuck');
    assert.equal(floorTop(Number.NaN, null), 8);
  });

  test('defaultTop: below the topbar, below the banner while it is on screen, never above the floor', () => {
    assert.equal(defaultTop({ barBottom: 64, bannerBottom: null, floor: 72 }), 72);
    assert.equal(defaultTop({ barBottom: 64, bannerBottom: 150, floor: 72 }), 158);
    assert.equal(defaultTop({ barBottom: 64, bannerBottom: 30, floor: 72 }), 72, 'a banner scrolled under the topbar');
    assert.equal(defaultTop({ barBottom: 64, bannerBottom: 150, floor: 184 }), 184, 'the stuck toolbar wins');
  });

  test('msToLagosMidnight', () => {
    assert.equal(msToLagosMidnight(Date.parse('2026-10-07T22:59:00Z')), 60000);
    assert.equal(msToLagosMidnight(Date.parse('2026-10-07T23:00:00Z')), 86400000);
  });
});

// ------------------------------------------------------------------ the browser module

const RING_ATTRS = (a, date) => [
  ['ring-won', a.won], ['ring-lost', a.lost], ['ring-pushes', a.pushes], ['ring-graded', a.graded], ['ring-pct', a.pct], ['ring-date', date],
];
const YDAY_ATTRS = (a, date) => [
  ['yday-won', a.won], ['yday-lost', a.lost], ['yday-pushes', a.pushes], ['yday-graded', a.graded], ['yday-pct', a.pct], ['yday-date', date],
];

function pageOf({ today = A24, yesterday = Y18, date = TODAY, ydate = '2026-10-06', extra = [], banner = false } = {}) {
  const pairs = [...(today ? RING_ATTRS(today, date) : []), ...(yesterday ? YDAY_ATTRS(yesterday, ydate) : []), ...extra];
  const data = pairs.filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => ` data-${k}="${v}"`).join('');
  return '<!doctype html><html lang="en-NG"><head><title>t</title></head><body>'
    + '<header class="bg-topbar"><a href="/">Bet Gaffer</a></header>'
    + (banner ? '<aside class="bg-banner" data-banner><p>Founding</p><button type="button" data-banner-close>x</button></aside>' : '')
    + `<main id="main"${data}><div class="day"><div class="day-tools" data-day-tools></div><p>card</p></div></main></body></html>`;
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    writes: [],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { this.writes.push(k); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    map: m,
  };
}

function setup({
  width = 1280, height = 800, html = pageOf(), store = {}, storage, clock = NOW, RO = FakeResizeObserver,
  tools: toolsRect = { top: 300, bottom: 360 }, banner: bannerRect = null,
} = {}) {
  const doc = fakeDocument(html);
  doc.querySelector('.bg-topbar')._rect = { top: 0, bottom: 64 };
  const tools = doc.querySelector('[data-day-tools]');
  if (tools) { tools.offsetHeight = 60; tools._rect = toolsRect; }
  const bannerEl = doc.querySelector('[data-banner]');
  if (bannerEl && bannerRect) bannerEl._rect = bannerRect;
  const win = {
    innerWidth: width, innerHeight: height, listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
  };
  const frames = [];
  const timers = [];
  const s = {
    doc, win, frames, timers, clock: { now: clock },
    storage: storage ?? memStorage(store),
  };
  s.api = balloon.init({
    doc, win, storage: s.storage,
    raf: (fn) => { frames.push(fn); return frames.length; },
    cancelRaf: (id) => { frames[id - 1] = null; },
    now: () => s.clock.now,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    ResizeObserver: RO,
  });
  s.el = doc.querySelector('.bg-balloon');
  s.flush = () => { const all = frames.splice(0); for (const f of all) if (f) f(); };
  s.resize = (w, h = height) => { win.innerWidth = w; win.innerHeight = h; for (const f of win.listeners.resize ?? []) f({ type: 'resize' }); s.flush(); };
  s.scroll = () => { for (const f of win.listeners.scroll ?? []) f({ type: 'scroll' }); s.flush(); };
  s.has = () => doc.documentElement.classList.contains('has-balloon');
  s.style = (k) => s.el.style.getPropertyValue(k);
  return s;
}

describe('balloon.js: rendering', () => {
  test('desktop: a link to Our Record, not draggable natively, today + yesterday, accessible name', () => {
    const s = setup();
    const a = s.el;
    assert.ok(a, 'rendered');
    assert.equal(a.localName, 'a');
    assert.equal(a.getAttribute('href'), '/our-record/');
    assert.equal(a.getAttribute('draggable'), 'false');
    assert.equal(a.getAttribute('data-figure'), 'ring');
    assert.equal(a.getAttribute('data-size'), 'desktop');
    assert.equal(a.getAttribute('data-state'), 'partial');
    assert.equal(a.hidden, false);
    assert.ok(s.has(), 'html.has-balloon');
    assert.equal(a.getAttribute('aria-label'), "Today's published picks: 24 of 29 landed (82.76%). Yesterday: 18 of 22 (81.82%). Opens Our Record.");
    const text = a.textContent;
    for (const t of ['82.76%', 'Today', '24 of 29', 'Yesterday', '81.82%', '18 of 22']) assert.ok(text.includes(t), t);
    assert.equal(s.doc.querySelectorAll('.bg-balloon').length, 1);
  });

  test('--pct is set through CSSOM style.setProperty, never a style attribute', () => {
    const s = setup();
    assert.equal(s.style('--pct'), '82.76');
    assert.ok(s.el.hasAttribute('data-arc'));
    assert.equal(s.el.getAttribute('style'), null);
    for (const n of s.el.querySelectorAll('span')) assert.equal(n.getAttribute('style'), null);
  });

  test('perfect and none draw no arc; none says "No results yet" on desktop', () => {
    const p = setup({ html: pageOf({ today: acc(5, 0, 100), yesterday: null }) });
    assert.equal(p.el.getAttribute('data-state'), 'perfect');
    assert.equal(p.style('--pct'), '');
    assert.equal(p.el.hasAttribute('data-arc'), false);
    assert.match(p.el.textContent, /5 of 5/);
    assert.match(p.el.textContent, /landed so far/);
    assert.doesNotMatch(p.el.textContent, /%/);
    const n = setup({ html: pageOf({ today: acc(0, 0), yesterday: null }) });
    assert.equal(n.el.getAttribute('data-state'), 'none');
    assert.equal(n.el.hidden, false);
    assert.match(n.el.textContent, /No results yet/);
    assert.equal(n.style('--pct'), '');
  });

  test('the rendered balloon passes the claim scanner (as a data-figure="ring")', () => {
    for (const o of [{}, { today: acc(0, 4, 0) }, { today: acc(5, 0, 100), yesterday: acc(4, 0, 100) }, { today: acc(0, 0) }]) {
      for (const width of [1280, 390]) {
        const s = setup({ width, html: pageOf(o) });
        if (!s.el || s.el.hidden) continue;
        const html = `<!doctype html><html><head><title>t</title></head><body>${serialize(s.el)}</body></html>`;
        assert.match(html, /data-figure="ring"/);
        assert.deepEqual(claimViolations(html), [], html);
      }
    }
    // Premise: the scanner does fire on a percentage outside the ring.
    assert.notDeepEqual(claimViolations('<!doctype html><html><head><title>t</title></head><body><p>82.76%</p></body></html>'), []);
  });

  test('phone (< 1024): the small ring, today only, no yesterday', () => {
    const s = setup({ width: 390 });
    assert.equal(s.el.getAttribute('data-size'), 'compact');
    assert.equal(s.el.hidden, false);
    const text = s.el.textContent;
    assert.ok(text.includes('82.76%') && text.includes('24 of 29'));
    assert.doesNotMatch(text, /Yesterday|81\.82|18 of 22/);
    assert.doesNotMatch(s.el.getAttribute('aria-label'), /Yesterday/);
  });

  test('phone: not rendered when nothing is graded (and appears at desktop width)', () => {
    const s = setup({ width: 390, html: pageOf({ today: acc(0, 0) }) });
    assert.ok(!s.el || s.el.hidden, 'no small ring');
    assert.equal(s.has(), false, 'no bottom padding');
    s.resize(1280);
    assert.equal(s.el.hidden, false);
    assert.match(s.el.textContent, /No results yet/);
    assert.ok(s.has());
    s.resize(390);
    assert.equal(s.el.hidden, true);
    assert.equal(s.has(), false);
  });

  test('crossing 1024 re-renders: yesterday appears and disappears', () => {
    const s = setup({ width: 1280 });
    assert.match(s.el.textContent, /Yesterday/);
    s.resize(800);
    assert.equal(s.el.getAttribute('data-size'), 'compact');
    assert.doesNotMatch(s.el.textContent, /Yesterday/);
    s.resize(1100);
    assert.match(s.el.textContent, /Yesterday/);
  });

  test('fail closed: invalid data renders nothing', () => {
    const cases = [
      pageOf({ today: { ...A24, graded: 30 } }),
      pageOf({ today: { ...A24, pct: 140 } }),
      pageOf({ today: { ...A24, pct: null } }),
      pageOf({ ydate: '2026-10-01' }),
      pageOf({ date: 'yesterday' }),
      pageOf({ today: null, yesterday: null }),
    ];
    for (const html of cases) {
      const s = setup({ html });
      assert.equal(s.el, null, html);
      assert.equal(s.api, null);
      assert.equal(s.has(), false);
    }
  });

  test('re-labels at the next Lagos midnight while the page stays open', () => {
    const s = setup({ clock: Date.parse('2026-10-07T22:30:00Z') }); // 23:30 WAT
    assert.match(s.el.getAttribute('aria-label'), /^Today's published picks/);
    const t = s.timers.at(-1);
    assert.equal(t.ms, 30 * 60000 + 500);
    s.clock.now = Date.parse('2026-10-07T23:00:01Z');
    t.fn();
    assert.match(s.el.getAttribute('aria-label'), /^Picks published for Wed 7 Oct 2026: /);
    assert.match(s.el.getAttribute('aria-label'), /Tue 6 Oct 2026: 18 of 22/);
    assert.ok(s.el.textContent.includes('Wed 7 Oct'));
  });

  test('midnight during a drag: nothing is rebuilt under the pointer; it retries a second later', () => {
    const s = setup({ clock: Date.parse('2026-10-07T22:30:00Z') });
    s.el._rect = { left: 1100, top: 150, width: 124, height: 124 };
    const kids = s.el.childNodes[0];
    fire(s.el, 'pointerdown', { button: 0, pointerId: 1, clientX: 1150, clientY: 200 });
    s.clock.now = Date.parse('2026-10-07T23:00:01Z');
    s.timers.at(-1).fn();
    assert.equal(s.el.childNodes[0], kids, 'not re-rendered mid-drag');
    assert.match(s.el.getAttribute('aria-label'), /^Today's/);
    assert.equal(s.timers.at(-1).ms, 1000, 're-armed shortly');
    fire(s.el, 'pointerup', { pointerId: 1, clientX: 1150, clientY: 200 });
    s.timers.at(-1).fn();
    assert.match(s.el.getAttribute('aria-label'), /^Picks published for Wed 7 Oct 2026: /);
  });
});

describe('balloon.js: position', () => {
  test('no stored position: top right, just below the topbar (top set through CSSOM; right from the CSS)', () => {
    for (const width of [1280, 390]) {
      const s = setup({ width });
      assert.equal(s.style('top'), `${64 + GAP}px`, `${width}: topbar bottom + 8`);
      for (const k of ['left', 'right', 'bottom']) assert.equal(s.style(k), '', `${width} ${k}`);
      assert.equal(s.el.getAttribute('style'), null);
      assert.equal(s.api.custom, false);
    }
  });

  test('the floor: the topbar, or the sticky toolbar while it is stuck under it (re-checked on scroll)', () => {
    const s = setup({ tools: { top: 64, bottom: 176 } });
    assert.equal(s.style('top'), `${176 + GAP}px`, 'stuck: below the toolbar');
    s.doc.querySelector('[data-day-tools]')._rect = { top: 420, bottom: 532 };
    s.scroll();
    assert.equal(s.style('top'), `${64 + GAP}px`, 'scrolled back up: the toolbar is in the flow again');
  });

  test('a parked ring never covers the stuck toolbar: on scroll it is pushed below the floor, for display only', () => {
    const stored = JSON.stringify({ left: 100, top: 80 });
    const s = setup({ store: { 'bg.balloon.pos': stored } });
    assert.equal(s.style('top'), '80px');
    s.doc.querySelector('[data-day-tools]')._rect = { top: 64, bottom: 176 }; // scrolled: the toolbar sticks
    for (const f of s.win.listeners.scroll ?? []) f({ type: 'scroll' });
    for (const f of s.win.listeners.scroll ?? []) f({ type: 'scroll' });
    assert.equal(s.frames.length, 1, 'one frame per burst (rAF-throttled)');
    s.flush();
    assert.equal(s.style('top'), `${176 + GAP}px`, 'below the stuck toolbar');
    assert.equal(s.style('left'), '100px');
    assert.deepEqual(s.storage.writes, [], 'storage is never rewritten');
    assert.equal(s.storage.getItem('bg.balloon.pos'), stored);
    s.doc.querySelector('[data-day-tools]')._rect = { top: 420, bottom: 532 }; // back up: in the flow again
    s.scroll();
    assert.equal(s.style('top'), '80px', 'returns to where the visitor put it');
  });

  test('a parked ring below the floor is not touched on scroll (no style write)', () => {
    const s = setup({ store: { 'bg.balloon.pos': JSON.stringify({ left: 100, top: 400 }) } });
    const before = new Map(s.el.style.props);
    let writes = 0;
    const set = s.el.style.setProperty;
    s.el.style.setProperty = (k, v) => { writes++; set(k, v); };
    s.doc.querySelector('[data-day-tools]')._rect = { top: 64, bottom: 176 };
    s.scroll();
    assert.equal(writes, 0, 'unchanged position: nothing written');
    assert.deepEqual(new Map(s.el.style.props), before);
  });

  test('a stored desktop position is restored, re-clamped to the viewport and below the floor', () => {
    const s = setup({ tools: { top: 64, bottom: 124 }, store: { 'bg.balloon.pos': JSON.stringify({ left: 5000, top: 10 }) } });
    assert.equal(s.style('left'), `${1280 - NOMINAL.desktop - PAD}px`);
    assert.equal(s.style('top'), `${124 + GAP}px`);
    assert.equal(s.style('right'), 'auto');
    assert.equal(s.style('bottom'), 'auto');
    assert.equal(s.api.custom, true);
    assert.deepEqual(s.storage.writes, [], 'restoring never writes');
  });

  test('a hidden toolbar does not count; without one the floor is the header', () => {
    const html = pageOf().replace('<div class="day-tools" data-day-tools></div>', '<div class="day-tools" data-day-tools hidden></div>');
    const s = setup({ html, tools: { top: 64, bottom: 124 }, store: { 'bg.balloon.pos': JSON.stringify({ left: 100, top: 0 }) } });
    assert.equal(s.style('top'), `${64 + GAP}px`);
  });

  test('the founding banner on screen: the default sits just below it (its close button stays tappable); dismissed: below the topbar', () => {
    const s = setup({ width: 360, height: 700, html: pageOf({ banner: true }), banner: { top: 64, bottom: 150 } });
    assert.equal(s.style('top'), `${150 + GAP}px`);
    const close = s.doc.querySelector('[data-banner-close]');
    fire(close, 'click');
    s.doc.querySelector('[data-banner]').remove(); // banner.js removes it on the same click
    s.flush();
    assert.equal(s.style('top'), `${64 + GAP}px`);
    // Scrolled under the header: the banner's bottom above the topbar's no longer counts.
    const t = setup({ width: 360, height: 700, html: pageOf({ banner: true }), banner: { top: -100, bottom: -14 } });
    assert.equal(t.style('top'), `${64 + GAP}px`);
    // A stored position is the visitor's: the banner does not move it.
    const u = setup({ width: 360, height: 700, html: pageOf({ banner: true }), banner: { top: 64, bottom: 150 }, store: { 'bg.balloon.pos.sm': JSON.stringify({ left: 20, top: 90 }) } });
    assert.equal(u.style('top'), '90px');
  });

  test('stored garbage is ignored: strings, non-finite, wrong shape, bad JSON, throwing storage', () => {
    for (const raw of ['{"left":"100","top":50}', '{"left":1e400,"top":50}', '[100,50]', 'null', '{bad', '{"left":100}']) {
      const s = setup({ store: { 'bg.balloon.pos': raw } });
      assert.equal(s.style('left'), '', raw);
      assert.equal(s.api.custom, false, raw);
    }
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const s = setup({ storage: throwing });
    assert.equal(s.el.hidden, false, 'still shows');
  });

  test('the phone ring ignores the desktop key and reads its own', () => {
    const desk = JSON.stringify({ left: 30, top: 300 });
    const a = setup({ width: 390, height: 700, store: { 'bg.balloon.pos': desk } });
    assert.equal(a.style('left'), '', 'desktop position not applied on a phone');
    const b = setup({ width: 390, height: 700, store: { 'bg.balloon.pos.sm': JSON.stringify({ left: 30, top: 300 }) } });
    assert.equal(b.style('left'), '30px');
    assert.equal(b.style('top'), '300px');
  });

  test('re-clamped on resize (a shrink pulls it in; widening again restores where it was put)', () => {
    const s = setup({ store: { 'bg.balloon.pos': JSON.stringify({ left: 1100, top: 600 }) } });
    assert.equal(s.style('left'), '1100px');
    s.resize(1100, 600);
    assert.equal(s.style('left'), `${1100 - 124 - PAD}px`);
    assert.equal(s.style('top'), `${600 - 124 - PAD}px`);
    s.resize(1280, 800);
    assert.equal(s.style('left'), '1100px');
    assert.equal(s.style('top'), '600px');
    assert.deepEqual(s.storage.writes, []);
  });

  test('re-clamped when the sticky header, the banner or the card resizes (ResizeObserver)', () => {
    const s = setup({ html: pageOf({ banner: true }), banner: { top: 64, bottom: 120 }, store: { 'bg.balloon.pos': JSON.stringify({ left: 100, top: 80 }) } });
    const ro = FakeResizeObserver.last;
    for (const sel of ['.bg-topbar', 'main', '[data-banner]']) assert.ok(ro.targets.includes(s.doc.querySelector(sel)), sel);
    assert.equal(s.style('top'), '80px');
    s.doc.querySelector('.bg-topbar')._rect = { top: 0, bottom: 97 };
    ro.trigger();
    s.flush();
    assert.equal(s.style('top'), `${97 + GAP}px`);
  });

  test('no room below the topbar (tiny landscape phone): the ring is not shown', () => {
    const s = setup({ width: 600, height: 140 });
    assert.equal(s.el.hidden, true);
    assert.equal(s.has(), false);
    s.resize(600, 700);
    assert.equal(s.el.hidden, false);
  });
});

// Spec §16.7: CSS hides the day header's static ring from the first paint whenever scripting is on;
// balloon.js puts html.ring-static on in every path where the floating ring is NOT shown.
describe('balloon.js: html.ring-static (no flash of the old ring)', () => {
  const RS = 'ring-static';
  const hasRS = (doc) => doc.documentElement.classList.contains(RS);

  test('the floating ring shows: no ring-static (the static ring stays hidden)', () => {
    for (const width of [1280, 390]) {
      const s = setup({ width });
      assert.equal(s.el.hidden, false, `premise: shown at ${width}`);
      assert.equal(hasRS(s.doc), false, `${width}`);
      assert.equal(s.has(), true);
    }
  });

  test('phone with nothing graded: ring-static on; desktop width shows the floating ring and drops it; back again', () => {
    const s = setup({ width: 390, html: pageOf({ today: acc(0, 0) }) });
    assert.equal(hasRS(s.doc), true, 'the static "No results yet" ring shows');
    s.resize(1280);
    assert.equal(s.el.hidden, false);
    assert.equal(hasRS(s.doc), false, 'removed when the floating ring shows');
    s.resize(390);
    assert.equal(hasRS(s.doc), true);
  });

  test('invalid data: ring-static on (and nothing else rendered)', () => {
    for (const html of [pageOf({ today: { ...A24, graded: 30 } }), pageOf({ date: 'yesterday' }), pageOf({ today: null, yesterday: null })]) {
      const s = setup({ html });
      assert.equal(s.api, null, 'premise: fail closed');
      assert.equal(hasRS(s.doc), true, html);
      assert.equal(s.has(), false);
    }
  });

  test('no room below the bar: ring-static on; room again: off', () => {
    const s = setup({ width: 600, height: 140 });
    assert.equal(s.el.hidden, true, 'premise: no room');
    assert.equal(hasRS(s.doc), true);
    s.resize(600, 700);
    assert.equal(hasRS(s.doc), false);
  });

  test('an unmeasurable viewport (place() throws): ring-static on', () => {
    const doc = fakeDocument(pageOf());
    doc.querySelector('.bg-topbar').getBoundingClientRect = () => { throw new Error('detached'); };
    const win = { innerWidth: 1280, innerHeight: 800, addEventListener() {} };
    const api = balloon.init({ doc, win, storage: memStorage(), raf: () => 1, cancelRaf: () => {}, now: () => NOW, setTimer: () => 1, ResizeObserver: undefined });
    assert.ok(api, 'premise: the ring was built');
    assert.equal(api.el.hidden, true);
    assert.equal(hasRS(doc), true);
  });

  test('init failure: boot() puts ring-static on; a successful init leaves it to init', () => {
    const doc = fakeDocument(pageOf());
    let calls = 0;
    balloon.boot({ doc, initFn: () => { calls++; throw new Error('boom'); } });
    assert.equal(calls, 1);
    assert.equal(hasRS(doc), true, 'a throwing init shows the static ring');
    const ok = fakeDocument(pageOf());
    balloon.boot({ doc: ok, initFn: () => ({}) });
    assert.equal(hasRS(ok), false, 'boot adds nothing on success');
  });

  test('a second init on a page that already has the ring changes nothing', () => {
    const s = setup();
    assert.equal(hasRS(s.doc), false, 'premise');
    assert.equal(balloon.init({ doc: s.doc, win: s.win, storage: memStorage(), setTimer: () => 1, raf: () => 1 }), null);
    assert.equal(hasRS(s.doc), false, 'the shown ring keeps the static one hidden');
  });
});

describe('balloon.js: drag', () => {
  function dragSetup(o = {}) {
    const s = setup(o);
    s.el._rect = o.rect ?? { left: 1100, top: 150, width: 124, height: 124 };
    return s;
  }

  test('a real drag moves by transform, commits left/top on release, saves once, and the click after it does not navigate', () => {
    const s = dragSetup();
    fire(s.el, 'pointerdown', { button: 0, pointerId: 7, isPrimary: true, clientX: 1150, clientY: 200 });
    assert.equal(s.el.captured, 7, 'setPointerCapture');
    assert.ok(s.el.classList.contains('is-dragging'));
    fire(s.el, 'pointermove', { pointerId: 7, clientX: 1000, clientY: 350 });
    fire(s.el, 'pointermove', { pointerId: 7, clientX: 900, clientY: 450 });
    assert.equal(s.style('transform'), '', 'nothing written until the frame');
    s.flush();
    assert.equal(s.style('transform'), 'translate3d(-250px,250px,0)', 'latest event only, transform-only');
    assert.equal(s.style('left'), '', 'no layout write during the drag');
    assert.deepEqual(s.storage.writes, [], 'nothing saved during the drag');
    fire(s.el, 'pointerup', { pointerId: 7, clientX: 900, clientY: 450 });
    assert.equal(s.style('transform'), '');
    assert.equal(s.style('left'), '850px');
    assert.equal(s.style('top'), '400px');
    assert.equal(s.style('right'), 'auto');
    assert.equal(s.style('bottom'), 'auto');
    assert.ok(!s.el.classList.contains('is-dragging'));
    assert.deepEqual(s.storage.writes, ['bg.balloon.pos']);
    assert.deepEqual(JSON.parse(s.storage.getItem('bg.balloon.pos')), { left: 850, top: 400 });
    const click = fire(s.el, 'click', { detail: 1 });
    assert.equal(click.defaultPrevented, true, 'the click that ends a drag does not open Our Record');
    assert.equal(fire(s.el, 'click', { detail: 1 }).defaultPrevented, false, 'the next click does');
    fire(s.el, 'lostpointercapture', { pointerId: 7 });
    assert.deepEqual(s.storage.writes, ['bg.balloon.pos'], 'a late lostpointercapture does not save again');
  });

  test('a release before the frame still counts the movement (no click-through after a fast flick)', () => {
    const s = dragSetup();
    fire(s.el, 'pointerdown', { button: 0, pointerId: 1, clientX: 1150, clientY: 200 });
    fire(s.el, 'pointermove', { pointerId: 1, clientX: 1100, clientY: 260 });
    fire(s.el, 'pointerup', { pointerId: 1, clientX: 1100, clientY: 260 });
    assert.equal(s.style('left'), '1050px');
    assert.equal(fire(s.el, 'click', { detail: 1 }).defaultPrevented, true);
  });

  test('a click (movement within 4 px) opens Our Record and saves nothing; the default anchor stays', () => {
    const s = dragSetup();
    fire(s.el, 'pointerdown', { button: 0, pointerId: 2, clientX: 1150, clientY: 200 });
    fire(s.el, 'pointermove', { pointerId: 2, clientX: 1153, clientY: 202 });
    s.flush();
    fire(s.el, 'pointerup', { pointerId: 2, clientX: 1153, clientY: 202 });
    assert.equal(fire(s.el, 'click', { detail: 1 }).defaultPrevented, false);
    assert.deepEqual(s.storage.writes, []);
    assert.equal(s.style('left'), '', 'a click never converts the default anchor to coordinates');
    assert.equal(s.style('transform'), '');
    assert.equal(s.api.custom, false);
  });

  test('a keyboard activation is never swallowed', () => {
    const s = dragSetup();
    fire(s.el, 'pointerdown', { button: 0, pointerId: 3, clientX: 1150, clientY: 200 });
    fire(s.el, 'pointerup', { pointerId: 3, clientX: 1050, clientY: 300 });
    assert.equal(fire(s.el, 'click', { detail: 0 }).defaultPrevented, false);
  });

  test('only the primary button starts a drag', () => {
    const s = dragSetup();
    fire(s.el, 'pointerdown', { button: 2, pointerId: 4, clientX: 1150, clientY: 200 });
    fire(s.el, 'pointermove', { pointerId: 4, clientX: 900, clientY: 450 });
    s.flush();
    fire(s.el, 'pointerup', { pointerId: 4, clientX: 900, clientY: 450 });
    assert.equal(s.el.captured, undefined);
    assert.equal(s.style('transform'), '');
    assert.deepEqual(s.storage.writes, []);
  });

  test('the drag is clamped: never above the stuck toolbar, never off-screen', () => {
    const s = dragSetup({ tools: { top: 64, bottom: 124 } });
    fire(s.el, 'pointerdown', { button: 0, pointerId: 5, clientX: 1150, clientY: 200 });
    fire(s.el, 'pointermove', { pointerId: 5, clientX: 3000, clientY: -500 });
    s.flush();
    fire(s.el, 'pointerup', { pointerId: 5, clientX: 3000, clientY: -500 });
    assert.equal(s.style('left'), `${1280 - 124 - PAD}px`);
    assert.equal(s.style('top'), `${64 + 60 + 8}px`);
  });

  test('a resize during the drag is caught up on release (the end of a drag re-runs the layout)', () => {
    const s = dragSetup();
    fire(s.el, 'pointerdown', { button: 0, pointerId: 10, clientX: 1150, clientY: 200 });
    fire(s.el, 'pointermove', { pointerId: 10, clientX: 1150, clientY: 700 });
    s.resize(1280, 500); // skipped: dragging
    fire(s.el, 'pointerup', { pointerId: 10, clientX: 1150, clientY: 700 });
    assert.equal(s.style('top'), '650px', 'committed against the box measured at pointerdown');
    s.flush();
    assert.equal(s.style('top'), `${500 - 124 - PAD}px`, 're-clamped to the smaller viewport');
  });

  test('pointercancel mid-drag commits where the ring was drawn', () => {
    const s = dragSetup();
    fire(s.el, 'pointerdown', { button: 0, pointerId: 6, clientX: 1150, clientY: 200 });
    fire(s.el, 'pointermove', { pointerId: 6, clientX: 1050, clientY: 300 });
    s.flush();
    fire(s.el, 'pointercancel', { pointerId: 6 });
    assert.equal(s.style('left'), '1000px');
    assert.equal(s.style('top'), '250px');
    assert.deepEqual(s.storage.writes, ['bg.balloon.pos']);
  });

  test('the small ring drags too, and persists only after a real drag, under its own key', () => {
    const s = dragSetup({ width: 390, height: 700, rect: { left: 314, top: 610, width: 64, height: 64 } });
    assert.equal(s.el.getAttribute('data-size'), 'compact');
    fire(s.el, 'pointerdown', { button: 0, pointerId: 8, clientX: 340, clientY: 640 });
    fire(s.el, 'pointerup', { pointerId: 8, clientX: 341, clientY: 641 });
    assert.deepEqual(s.storage.writes, [], 'a tap saves nothing');
    assert.equal(fire(s.el, 'click', { detail: 1 }).defaultPrevented, false, 'a tap opens Our Record');
    fire(s.el, 'pointerdown', { button: 0, pointerId: 9, clientX: 340, clientY: 640 });
    fire(s.el, 'pointermove', { pointerId: 9, clientX: 100, clientY: 400 });
    s.flush();
    fire(s.el, 'pointerup', { pointerId: 9, clientX: 100, clientY: 400 });
    assert.deepEqual(s.storage.writes, ['bg.balloon.pos.sm']);
    assert.deepEqual(JSON.parse(s.storage.getItem('bg.balloon.pos.sm')), { left: 74, top: 370 });
    assert.equal(s.storage.getItem('bg.balloon.pos'), null, 'the desktop position is untouched');
  });

  test('crossing 1024 switches to the other size\'s own remembered position', () => {
    const s = setup({
      width: 1280,
      store: { 'bg.balloon.pos': JSON.stringify({ left: 500, top: 300 }), 'bg.balloon.pos.sm': JSON.stringify({ left: 20, top: 400 }) },
    });
    assert.equal(s.style('left'), '500px');
    s.resize(390, 700);
    assert.equal(s.style('left'), '20px');
    assert.equal(s.style('top'), '400px');
    s.resize(1280, 800);
    assert.equal(s.style('left'), '500px');
    assert.deepEqual(s.storage.writes, []);
  });
});

describe('balloon.js and balloon-model.js: source', () => {
  const strip = (raw) => raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const JS = readFileSync(join(REPO_ROOT, 'site/assets/js/balloon.js'), 'utf8');
  const MODEL = readFileSync(join(REPO_ROOT, 'site/lib/balloon-model.js'), 'utf8');

  test('no shipped stylesheet or script talks about the internal "UI tab" (public files)', () => {
    let files = 0;
    for (const dir of ['site/assets/css', 'site/assets/js', 'site/lib']) {
      for (const f of readdirSync(join(REPO_ROOT, dir))) {
        if (!/\.(css|js)$/.test(f)) continue;
        files++;
        assert.doesNotMatch(readFileSync(join(REPO_ROOT, dir, f), 'utf8'), /\bUI tab\b/i, `${dir}/${f}`);
      }
    }
    assert.ok(files > 15, `premise: files scanned (${files})`);
  });

  test('no innerHTML, fetch, style attribute, cssText or direct style property writes', () => {
    for (const [name, raw] of [['balloon.js', JS], ['balloon-model.js', MODEL]]) {
      const src = strip(raw);
      assert.ok(src.length > 500, `premise: ${name} read`);
      for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /fetch\(/, /setAttribute\(\s*['"]style/, /cssText/, /\.style\.[a-z]+\s*=/i, /node:|process\.|Buffer/]) {
        assert.doesNotMatch(src, re, `${name}: ${re}`);
      }
    }
    assert.match(strip(JS), /style\.setProperty\(\s*'--pct'/, '--pct through CSSOM');
    assert.match(strip(JS), /setPointerCapture/);
    assert.match(strip(JS), /from '\.\/lib\/balloon-model\.js'/);
    assert.match(strip(MODEL), /import \{ fmtPct \} from '\.\/ring\.js'/, 'reuses the ring\'s percentage format');
    assert.doesNotMatch(strip(JS), /data-auth/, 'no auth gating');
  });

  const CSS = readFileSync(join(REPO_ROOT, 'site/assets/css/balloon.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (sel) => {
    const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(CSS);
    return m ? m[1] : null;
  };

  test('balloon.css: brand tokens, user-drag off, touch-action none, [hidden] wins, reduced motion', () => {
    assert.deepEqual(CSS.match(/#[0-9a-f]{3,8}\b/gi) ?? [], [], 'colours come from base.css tokens');
    assert.match(CSS, /\.bg-balloon\[hidden\]\s*\{\s*display:\s*none/);
    assert.match(CSS, /-webkit-user-drag:\s*none/);
    assert.match(CSS, /touch-action:\s*none/);
    assert.match(CSS, /conic-gradient\([^;{}]*var\(--pct/);
    assert.match(CSS, /prefers-reduced-motion/);
    assert.match(CSS, /64px/);
    assert.doesNotMatch(CSS, /data-auth/);
  });

  test('balloon.css: top-right at every width (12px / 24px in, plus the right safe area), no bottom anchor', () => {
    const base = block('.bg-balloon');
    const desk = block('.bg-balloon[data-size="desktop"]');
    assert.ok(base !== null && desk !== null, 'premise: both rules found');
    assert.match(base, /right:\s*calc\(12px \+ env\(safe-area-inset-right/);
    assert.match(base, /(^|[;\s])top:\s*calc\(var\(--bar-h\) \+ 8px\)/);
    assert.match(base, /bottom:\s*auto/);
    assert.match(desk, /right:\s*calc\(24px \+ env\(safe-area-inset-right/);
    assert.match(desk, /(^|[;\s])top:\s*calc\(var\(--bar-h-lg\) \+ 8px\)/);
    assert.doesNotMatch(CSS, /bottom:\s*calc/, 'no bottom anchor anywhere');
    assert.doesNotMatch(CSS, /\.bg-page/, 'no <main> padding: nothing sits at the bottom any more');
  });

  test('balloon.css: with scripting on, the static ring is hidden from the first paint; html.ring-static shows it again (spec §16.7)', () => {
    assert.match(CSS, /@media\s*\(scripting:\s*enabled\)\s*\{\s*\.day-head\s+\.ring\s*\{\s*display:\s*none;?\s*\}\s*\}/);
    // ring-static gives the ring back its own display (fixtures.css .ring), at a higher specificity.
    const fx = readFileSync(join(REPO_ROOT, 'site/assets/css/fixtures.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const ringDisplay = /(?:^|\})\s*\.ring\s*\{[^}]*?display:\s*([a-z-]+)/.exec(fx)?.[1];
    assert.ok(ringDisplay && ringDisplay !== 'none', `premise: .ring's display (${ringDisplay})`);
    const shows = /(?:^|\})\s*html\.ring-static\s+\.day-head\s+\.ring\s*\{\s*display:\s*([a-z-]+);?\s*\}/.exec(CSS);
    assert.ok(shows, 'html.ring-static .day-head .ring rule, at the top level (not inside any @media)');
    assert.equal(shows[1], ringDisplay);
    // Only two rules hide .ring: the scripting one (no-JS readers keep the static ring) and, for a
    // browser without the scripting media feature, the old has-balloon swap (spec: "keep the current
    // behaviour"). Neither ever applies without JS.
    const hides = [...CSS.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)].map((m) => m[1].trim()).filter((sel) => /\.ring\b/.test(sel));
    assert.deepEqual(hides, ['.day-head .ring', 'html.has-balloon .day-head .ring']);
    assert.match(CSS, /\}\s*html\.has-balloon\s+\.day-head\s+\.ring\s*\{\s*display:\s*none;?\s*\}/, 'has-balloon hide at the top level');
  });

  test('balloon.js: has-balloon and ring-static are never on together (equal specificity: order must not matter)', () => {
    const cases = [
      { width: 1280 }, { width: 390 }, { width: 390, html: pageOf({ today: acc(0, 0) }) }, { width: 600, height: 140 },
      { html: pageOf({ today: null, yesterday: null }) },
    ];
    for (const o of cases) {
      const s = setup(o);
      const cls = s.doc.documentElement.classList;
      for (const w of [o.width ?? 1280, 390, 1280]) {
        s.resize(w, o.height);
        assert.ok(cls.contains('has-balloon') !== cls.contains('ring-static'), `${JSON.stringify(o)} at ${w}: exactly one`);
      }
    }
  });

  test('balloon.js: ring-static is set in every no-ring path (show(false), the early fail-closed returns, boot\'s catch)', () => {
    const src = strip(JS);
    assert.match(src, /classList\.toggle\(\s*'ring-static',\s*!on\s*\)/, 'show(on) mirrors it');
    assert.match(src, /export function boot\(/);
    assert.match(src, /boot\(\s*\)/, 'the module start goes through boot()');
  });
});
