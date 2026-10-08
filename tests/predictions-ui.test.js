// The predictions toolbar (Plan B Task B3, spec §5): search, the Leagues dialog, the result line,
// the empty state, "Jump to now", the sticky offset, and the founding card's place under the
// toolbar. The browser modules are imported from a real build (their ./lib/ imports resolve
// there); the DOM is the hand-rolled fake (tests/fake-dom.js) built from rendered HTML.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from '../site/build.mjs';
import { renderDay } from '../site/lib/fixtures.js';
import { foundingCard } from '../site/content/waitlist.js';
import { fakeDocument, fire, FakeResizeObserver } from './fake-dom.js';
import { REPO_ROOT, EDGE_DAY, testConfig, workspace, copyArtifact, addArchive, readJson } from './site-fixtures.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');
const EDGE = JSON.parse(readFileSync(EDGE_DAY, 'utf8'));
const ON_DAY = Date.parse('2026-10-06T13:00:00Z'); // 14:00 WAT on the edge day (2026-10-06)
const NEXT_DAY = Date.parse('2026-10-07T12:00:00Z');
const N_ACTIVE = EDGE.fixtures.filter((f) => f.withdrawn !== true).length; // 23

let ws;
let pred;
let dayjs;
before(async () => {
  ws = await workspace();
  await copyArtifact(ws.root);
  await addArchive(ws.root);
  await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: () => {} });
  pred = await import(pathToFileURL(join(ws.out, 'assets/js/predictions.js')).href);
  dayjs = await import(pathToFileURL(join(ws.out, 'assets/js/day.js')).href);
});
after(() => ws.cleanup());

// ------------------------------------------------------------------ helpers

function dayWith(edit = () => {}) {
  const d = structuredClone(EDGE);
  edit(d);
  return d;
}
const byFx = (d, fx) => d.fixtures.find((f) => f.fx === fx);

function pageOf(day = EDGE) {
  return '<!doctype html><html lang="en-NG"><head><title>t</title></head><body>'
    + '<header class="bg-topbar"><a href="/">Bet Gaffer</a></header>'
    + `<main id="main">${renderDay(day, { beforeList: foundingCard() })}</main></body></html>`;
}

function timers() {
  const t = { pending: new Map(), seq: 0, cleared: 0 };
  t.setTimer = (fn, ms) => { t.seq += 1; t.pending.set(t.seq, { fn, ms }); return t.seq; };
  t.clearTimer = (id) => { if (t.pending.delete(id)) t.cleared += 1; };
  t.run = () => { const all = [...t.pending.values()]; t.pending.clear(); for (const x of all) x.fn(); };
  return t;
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** A page + initialised toolbar. */
function setup({ day = EDGE, storage = memStorage(), now = NEXT_DAY, hasDialog = true, narrow = false, reduced = false, RO } = {}) {
  const doc = fakeDocument(pageOf(day));
  const t = timers();
  const clock = { now };
  const frames = [];
  const ctl = pred.init(doc, {
    raf: (fn) => { frames.push(fn); return frames.length; },
    storage,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
    now: () => clock.now,
    hasDialog,
    media: (q) => (/max-width/.test(q) ? narrow : /reduced-motion/.test(q) ? reduced : false),
    ResizeObserver: RO,
  });
  const tools = doc.querySelector('[data-day-tools]');
  const q = (sel) => doc.querySelector(sel);
  const flush = () => { for (const fn of frames.splice(0)) fn(); };
  return { doc, t, clock, ctl, tools, storage, q, frames, flush };
}

const rows = (doc) => doc.querySelectorAll('li').filter((l) => l.hasAttribute('data-fx'));
const visible = (doc) => rows(doc).filter((l) => !l.hidden).map((l) => Number(l.getAttribute('data-fx')));
const fxOf = (pred2) => EDGE.fixtures.filter(pred2).map((f) => f.fx).sort();
const sorted = (a) => [...a].sort();

function type(s, value) {
  const input = s.tools.querySelector('input[type="search"]');
  input.value = value;
  fire(input, 'input');
  return input;
}
const status = (s) => s.tools.querySelector('[role="status"]');
const tool = (s, name) => s.doc.querySelector(`[data-tool="${name}"]`);
const dialog = (s) => s.doc.querySelector('dialog');
const options = (s) => dialog(s).querySelectorAll('input[type="checkbox"]');
const optName = (cb) => cb.parentNode.querySelector('.bg-pick__name').textContent;
function check(s, name, on = true) {
  const cb = options(s).find((c) => optName(c) === name);
  assert.ok(cb, `option ${name}`);
  cb.checked = on;
  fire(cb, 'change');
}

// ------------------------------------------------------------------ the toolbar

describe('the toolbar', () => {
  test('init fills and reveals the slot: labelled search, Leagues, one always-present status region', () => {
    const s = setup();
    assert.ok(s.ctl, 'init returns a controller');
    assert.equal(s.tools.hidden, false, 'revealed');
    const input = s.tools.querySelector('input[type="search"]');
    assert.ok(input);
    assert.equal(input.getAttribute('placeholder'), 'Search teams or competitions');
    const label = s.tools.querySelector('label');
    assert.equal(label.getAttribute('for'), input.id);
    assert.ok(input.id.length > 0);
    assert.equal(label.textContent, 'Search teams or competitions');
    const leagues = tool(s, 'leagues');
    assert.equal(leagues.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(leagues.textContent, 'Leagues');
    const regions = s.doc.querySelectorAll('[role="status"]').filter((e) => s.tools.contains(e));
    assert.equal(regions.length, 1, 'one live region in the toolbar');
    assert.equal(regions[0].hidden, false, 'never hidden (a hidden region does not announce)');
    assert.equal(regions[0].querySelectorAll('button').length, 0, 'buttons live outside the live region');
    assert.equal(regions[0].textContent, '', 'nothing filtered: no result line');
    assert.equal(tool(s, 'clear').hidden, true, 'clear (×) only when the field has text');
    assert.equal(tool(s, 'clear').getAttribute('aria-label'), 'Clear search');
    assert.ok(s.doc.documentElement.classList.contains('has-day-tools'), 'scroll padding is scoped to pages with the toolbar');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length, 'everything shows');
  });

  test('no toolbar slot or list: init does nothing (a zero-fixture day, a page without a card)', () => {
    const empty = dayWith((d) => { d.fixtures = []; d.accuracy = { won: 0, lost: 0, pushes: 0, graded: 0, pct: null }; });
    const docs = [
      fakeDocument(pageOf(empty)),
      fakeDocument('<!doctype html><html><head></head><body><main id="main"><p>Our Record</p></main></body></html>'),
    ];
    assert.equal(docs[0].querySelector('[data-day-tools]'), null, 'premise: an empty day has no slot');
    for (const doc of docs) {
      const before1 = doc.body.childNodes.length;
      assert.equal(pred.init(doc, { storage: memStorage(), hasDialog: true }), null);
      assert.equal(doc.body.childNodes.length, before1, 'no dialog appended');
      assert.equal(doc.documentElement.classList.contains('has-day-tools'), false);
    }
  });

  test('a second init on the same card is a no-op (one toolbar, one dialog)', () => {
    const s = setup();
    assert.equal(pred.init(s.doc, { storage: memStorage(), hasDialog: true }), null);
    assert.equal(s.doc.querySelectorAll('dialog').length, 1);
    assert.equal(s.doc.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'search' && s.tools.contains(i)).length, 1);
  });
});

// ------------------------------------------------------------------ search

describe('search', () => {
  test('filters ~150 ms after the last keystroke, not before; each keystroke restarts the wait', () => {
    const s = setup();
    type(s, 'al');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length, 'not before the debounce');
    assert.equal(s.t.pending.size, 1);
    assert.equal([...s.t.pending.values()][0].ms, 150);
    type(s, 'alpha');
    assert.equal(s.t.cleared, 1, 'the earlier wait is cancelled');
    assert.equal(s.t.pending.size, 1);
    s.t.run();
    assert.deepEqual(sorted(visible(s.doc)), fxOf((f) => f.comp === 'Alpha League'));
    assert.equal(tool(s, 'clear').hidden, false, '× shows while the field has text');
  });

  test('Esc in the field clears it immediately; clearing by hand shows everything immediately', () => {
    const s = setup();
    const input = type(s, 'zeta');
    s.t.run();
    assert.equal(visible(s.doc).length, 3);
    const ev = fire(input, 'keydown', { key: 'Escape' });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(input.value, '');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length, 'no wait');
    assert.equal(s.t.pending.size, 0);
    assert.equal(tool(s, 'clear').hidden, true);
    // An Esc on an empty field is left alone.
    assert.equal(fire(input, 'keydown', { key: 'Escape' }).defaultPrevented, false);
    type(s, 'zeta');
    s.t.run();
    type(s, '');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length, 'an emptied field shows everything at once');
    assert.equal(s.t.pending.size, 0);
  });

  test('the × button clears and returns focus to the field', () => {
    const s = setup();
    const input = type(s, 'zeta');
    s.t.run();
    fire(tool(s, 'clear'), 'click');
    assert.equal(input.value, '');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length);
    assert.equal(s.doc.activeElement, input);
  });

  test('Enter applies at once', () => {
    const s = setup();
    const input = type(s, 'zeta');
    fire(input, 'keydown', { key: 'Enter' });
    assert.equal(visible(s.doc).length, 3);
    assert.equal(s.t.pending.size, 0);
  });

  test('multi-word, accent and punctuation matches, end to end over the rendered names', () => {
    const day = dayWith((d) => {
      byFx(d, 900010).home = 'Atlético Madrid';
      byFx(d, 900012).away = 'Ølstykke';
      byFx(d, 900013).home = 'St. Pauli';
    });
    const s = setup({ day });
    const run = (v) => { type(s, v); s.t.run(); return sorted(visible(s.doc)); };
    assert.deepEqual(run('atl mad'), [900010]);
    assert.deepEqual(run('ATL'), [900010, 900025], 'Atlético and Atletico (row 900025) alike');
    assert.deepEqual(run('madrid'), [900010]);
    assert.deepEqual(run('ol'), [900012]);
    assert.deepEqual(run('st pauli'), [900013]);
    assert.deepEqual(run('alpha atletico'), [900010], 'across fields: competition + home team');
    assert.deepEqual(run('etico'), [], 'prefix only');
    assert.deepEqual(run('img'), sorted(fxOf((f) => f.comp.includes('<img'))), 'hostile text is matched as text');
  });
});

// ------------------------------------------------------------------ result line, empty state

describe('result line and empty state', () => {
  test('"Showing k of n fixtures" counts non-withdrawn rows; Show all clears every filter', () => {
    const s = setup();
    type(s, 'zeta');
    s.t.run();
    assert.equal(status(s).textContent, `Showing 3 of ${N_ACTIVE} fixtures`);
    const all = tool(s, 'show-all');
    assert.equal(all.hidden, false);
    assert.equal(all.textContent, 'Show all');
    assert.equal(status(s).contains(all), false);
    fire(all, 'click');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length);
    assert.equal(s.tools.querySelector('input[type="search"]').value, '');
    assert.equal(status(s).textContent, '');
    assert.equal(all.hidden, true);
    assert.equal(s.doc.activeElement, s.tools.querySelector('input[type="search"]'), 'focus lands on the field, not <body>');
  });

  test('withdrawn rows follow the filters but are never counted', () => {
    const s = setup();
    type(s, 'withdrawn');
    s.t.run();
    assert.deepEqual(sorted(visible(s.doc)), [900007, 900008]);
    assert.equal(status(s).textContent, `Showing 0 of ${N_ACTIVE} fixtures`);
    assert.equal(tool(s, 'empty').hidden, true, 'rows are visible: not the empty state');
  });

  test('nothing matches: the empty state and Show all fixtures; the sentence is the live region\'s text', () => {
    const s = setup();
    type(s, 'zzzz');
    s.t.run();
    assert.deepEqual(visible(s.doc), []);
    const box = tool(s, 'empty');
    assert.equal(box.hidden, false);
    assert.equal(status(s).textContent, 'No fixtures match your search on this day.');
    // On a phone the box is below the fold: the toolbar's own line says it, visibly, with Show all.
    assert.equal(status(s).classList.contains('vh'), false, 'the status sentence stays visible in the toolbar');
    assert.equal(status(s).hasAttribute('aria-hidden'), false);
    assert.equal(tool(s, 'show-all').hidden, false, 'Show all stays in the sticky toolbar');
    // Screen readers hear the sentence once: the box's copy is aria-hidden.
    const copy = box.querySelectorAll('p').filter((e) => e.textContent === 'No fixtures match your search on this day.');
    assert.equal(copy.length, 1);
    assert.equal(copy[0].getAttribute('aria-hidden'), 'true');
    const btn = box.querySelector('button');
    assert.equal(btn.textContent, 'Show all fixtures');
    const list = s.doc.querySelector('[data-fx-list]');
    assert.equal(box.parentNode, list.parentNode, 'the empty state sits beside the list');
    fire(btn, 'click');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length);
    assert.equal(box.hidden, true);
    assert.equal(status(s).textContent, '');
  });

  test('hidden is written only when it changes', () => {
    const doc = fakeDocument(pageOf());
    let writes = 0;
    for (const li of rows(doc)) {
      Object.defineProperty(li, 'hidden', {
        get() { return this.hasAttribute('hidden'); },
        set(v) { writes += 1; if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); },
      });
    }
    const t = timers();
    pred.init(doc, { storage: memStorage(), setTimer: t.setTimer, clearTimer: t.clearTimer, hasDialog: true, now: () => NEXT_DAY });
    assert.equal(writes, 0, 'init on an unfiltered list writes nothing');
    const input = doc.querySelector('[data-day-tools]').querySelector('input[type="search"]');
    input.value = 'alpha';
    fire(input, 'input');
    t.run();
    const alpha = fxOf((f) => f.comp === 'Alpha League').length;
    assert.equal(writes, EDGE.fixtures.length - alpha, 'only the rows that changed');
    writes = 0;
    fire(input, 'keydown', { key: 'Enter' });
    assert.equal(writes, 0, 'the same filter again writes nothing');
  });

  test('the founding card, the ring and the day header are never filtered', () => {
    const s = setup();
    const keep = () => [s.q('.bg-fd-card'), s.q('[data-figure="ring"]'), s.q('.day-head'), s.q('.day-bar')];
    for (const el of keep()) assert.ok(el, 'premise: present');
    type(s, 'zzzz');
    s.t.run();
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Zeta Division');
    for (const el of keep()) assert.equal(el.hidden, false);
    // Only rows (and the toolbar's own parts) ever carry hidden.
    const hiddenOutside = s.doc.querySelectorAll('[hidden]').filter((e) => !s.tools.contains(e) && !e.hasAttribute('data-fx')
      && e.getAttribute('data-tool') !== 'empty' && !dialog(s).contains(e));
    const baseline = fakeDocument(pageOf()).querySelectorAll('[hidden]').filter((e) => !e.hasAttribute('data-day-tools')).length;
    assert.equal(hiddenOutside.length, baseline, 'nothing else was hidden');
  });

  test('the founding card sits between the toolbar slot and the day bar', () => {
    const s = setup();
    const day = s.q('.day');
    const kids = day.children;
    const at = (pred2) => kids.findIndex(pred2);
    const iTools = at((e) => e.hasAttribute('data-day-tools'));
    const iCard = at((e) => e.getAttribute('class') === 'bg-fd-card');
    const iBar = at((e) => e.getAttribute('class') === 'day-bar');
    assert.ok(iTools >= 0 && iTools < iCard && iCard < iBar, `${iTools} < ${iCard} < ${iBar}`);
  });
});

// ------------------------------------------------------------------ the Leagues dialog

describe('the Leagues dialog', () => {
  test('opens with showModal; competitions A→Z by code point with non-withdrawn counts', () => {
    const s = setup();
    const d = dialog(s);
    assert.ok(d.getAttribute('class').split(' ').includes('bg-pick'));
    assert.equal(d.parentNode, s.doc.body, 'appended to <body>');
    assert.equal(d.open, false);
    fire(tool(s, 'leagues'), 'click');
    assert.equal(d.open, true);
    assert.equal(d.querySelector('h2').textContent, 'Leagues');
    const names = options(s).map(optName);
    const comps = [...new Set(EDGE.fixtures.filter((f) => f.withdrawn !== true).map((f) => f.comp))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(names, comps);
    assert.equal(names.includes('Beta League'), false, 'a competition with only withdrawn rows (0 fixtures) is not offered');
    assert.ok(EDGE.fixtures.some((f) => f.comp === 'Beta League'), 'premise: Beta League has (withdrawn) rows');
    assert.equal(names[0], '"Quotes" & Ampersand Cup', 'code point: " before < before A');
    const counts = Object.fromEntries(options(s).map((c) => [optName(c), c.parentNode.querySelector('.bg-pick__n').textContent]));
    assert.equal(counts['Zeta Division'], '3');
    assert.ok(Object.values(counts).every((n) => Number(n) > 0), 'every listed count is at least 1');
  });

  test('a checkbox applies instantly; leagues and search combine; the button shows the count', () => {
    const s = setup();
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Zeta Division');
    assert.deepEqual(sorted(visible(s.doc)), fxOf((f) => f.comp === 'Zeta Division'));
    assert.equal(tool(s, 'leagues').textContent, 'Leagues · 1');
    const pill = tool(s, 'leagues').querySelector('.bg-tool__count');
    assert.equal(pill.querySelector('.vh').textContent, ' · ', 'the pill shows the number; the separator is screen-reader text');
    assert.equal(pill.hidden, false);
    assert.equal(status(s).textContent, `Showing 3 of ${N_ACTIVE} fixtures`);
    check(s, 'Alpha League');
    assert.equal(tool(s, 'leagues').textContent, 'Leagues · 2');
    type(s, 'estimated');
    s.t.run();
    assert.deepEqual(visible(s.doc), [900006]);
    check(s, 'Zeta Division', false);
    assert.deepEqual(visible(s.doc), [], 'Alpha only + "estimated": nothing');
    assert.equal(tool(s, 'empty').hidden, false);
  });

  test('its own search filters the competition list (folded, prefix); no match says so', () => {
    const s = setup();
    fire(tool(s, 'leagues'), 'click');
    const box = dialog(s).querySelector('input[type="search"]');
    box.value = 'quotes';
    fire(box, 'input');
    const shown = options(s).filter((c) => !c.parentNode.parentNode.hidden).map(optName);
    assert.deepEqual(shown, ['"Quotes" & Ampersand Cup']);
    box.value = 'nothing here';
    fire(box, 'input');
    assert.equal(options(s).filter((c) => !c.parentNode.parentNode.hidden).length, 0);
    assert.equal(dialog(s).querySelector('[data-pick="none"]').hidden, false);
  });

  test('Esc in its search box clears it first; the next Esc is left to the dialog (closes)', () => {
    const s = setup();
    fire(tool(s, 'leagues'), 'click');
    const box = dialog(s).querySelector('input[type="search"]');
    box.value = 'zeta';
    fire(box, 'input');
    const first = fire(box, 'keydown', { key: 'Escape' });
    assert.equal(first.defaultPrevented, true, 'the dialog stays open');
    assert.equal(box.value, '');
    assert.equal(options(s).filter((c) => !c.parentNode.parentNode.hidden).length, options(s).length);
    assert.equal(dialog(s).open, true);
    const second = fire(box, 'keydown', { key: 'Escape' });
    assert.equal(second.defaultPrevented, false, 'the browser closes the dialog');
  });

  test('Done and a backdrop click close it; focus returns to the Leagues button; a click inside does not close', () => {
    const s = setup();
    const btn = tool(s, 'leagues');
    fire(btn, 'click');
    fire(dialog(s), 'click', { target: dialog(s).querySelector('h2') });
    assert.equal(dialog(s).open, true, 'a click inside the panel');
    fire(dialog(s).querySelector('[data-pick="done"]'), 'click');
    assert.equal(dialog(s).open, false);
    assert.equal(s.doc.activeElement, btn);
    fire(btn, 'click');
    s.doc.activeElement = s.doc.body;
    fire(dialog(s), 'click', { target: dialog(s) });
    assert.equal(dialog(s).open, false, 'backdrop');
    assert.equal(s.doc.activeElement, btn);
  });

  test('reopening starts with an empty search box', () => {
    const s = setup();
    fire(tool(s, 'leagues'), 'click');
    const box = dialog(s).querySelector('input[type="search"]');
    box.value = 'zeta';
    fire(box, 'input');
    fire(dialog(s).querySelector('[data-pick="done"]'), 'click');
    fire(tool(s, 'leagues'), 'click');
    assert.equal(box.value, '');
    assert.equal(options(s).filter((c) => !c.parentNode.parentNode.hidden).length, options(s).length);
  });

  test('wide screens focus its search box; narrow screens do not (no keyboard pops up)', () => {
    const wide = setup();
    fire(tool(wide, 'leagues'), 'click');
    assert.equal(wide.doc.activeElement, dialog(wide).querySelector('input[type="search"]'));
    const narrow = setup({ narrow: true });
    fire(tool(narrow, 'leagues'), 'click');
    const box = dialog(narrow).querySelector('input[type="search"]');
    assert.notEqual(narrow.doc.activeElement, box);
    assert.equal(box.hasAttribute('autofocus'), false);
    assert.ok(dialog(narrow).contains(narrow.doc.activeElement), 'focus is still inside the panel');
  });

  test('Clear all unchecks everything and shows every row', () => {
    const s = setup();
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Zeta Division');
    check(s, 'Alpha League');
    fire(dialog(s).querySelector('[data-pick="clear"]'), 'click');
    assert.equal(options(s).filter((c) => c.checked).length, 0);
    assert.equal(visible(s.doc).length, EDGE.fixtures.length);
    assert.equal(tool(s, 'leagues').textContent, 'Leagues');
    assert.equal(s.storage.getItem('bg.leagues'), null);
  });

  test('no showModal: no Leagues button and no dialog; search still works', () => {
    const s = setup({ hasDialog: false });
    assert.equal(tool(s, 'leagues'), null);
    assert.equal(s.doc.querySelector('dialog'), null);
    type(s, 'zeta');
    s.t.run();
    assert.equal(visible(s.doc).length, 3);
  });
});

// ------------------------------------------------------------------ persistence

describe('league persistence (bg.leagues)', () => {
  test('load intersects with this day\'s competitions; a league not playing is dropped silently', () => {
    const storage = memStorage({ 'bg.leagues': JSON.stringify(['Elsewhere Cup', 'Alpha League']) });
    const s = setup({ storage });
    assert.deepEqual(sorted(visible(s.doc)), fxOf((f) => f.comp === 'Alpha League'));
    assert.equal(tool(s, 'leagues').textContent, 'Leagues · 1');
    fire(tool(s, 'leagues'), 'click');
    assert.deepEqual(options(s).filter((c) => c.checked).map(optName), ['Alpha League']);
    assert.equal(options(s).some((c) => optName(c) === 'Elsewhere Cup'), false);
    assert.equal(storage.getItem('bg.leagues'), JSON.stringify(['Elsewhere Cup', 'Alpha League']), 'loading never writes');
  });

  test('a write merges: (stored − this day\'s competitions) ∪ the selection; search is never stored', () => {
    const storage = memStorage({ 'bg.leagues': JSON.stringify(['Elsewhere Cup', 'Alpha League']) });
    const s = setup({ storage });
    type(s, 'zeta');
    s.t.run();
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Alpha League', false);
    check(s, 'Zeta Division');
    assert.deepEqual(JSON.parse(storage.getItem('bg.leagues')), ['Elsewhere Cup', 'Zeta Division']);
    assert.deepEqual([...storage.m.keys()], ['bg.leagues'], 'nothing else is stored');
    assert.equal(storage.getItem('bg.leagues').includes('zeta"'), false);
  });

  test('another day\'s choices written meanwhile are kept (re-read at write time)', () => {
    const storage = memStorage();
    const s = setup({ storage });
    storage.setItem('bg.leagues', JSON.stringify(['Other Tab League']));
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Zeta Division');
    assert.deepEqual(JSON.parse(storage.getItem('bg.leagues')), ['Other Tab League', 'Zeta Division']);
  });

  test('a stored league with only withdrawn rows today is not offered, and survives a write', () => {
    const storage = memStorage({ 'bg.leagues': JSON.stringify(['Beta League']) });
    const s = setup({ storage });
    assert.equal(tool(s, 'leagues').textContent, 'Leagues', 'not selected: it has no fixture on this card');
    assert.equal(visible(s.doc).length, EDGE.fixtures.length);
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Zeta Division');
    assert.deepEqual(JSON.parse(storage.getItem('bg.leagues')), ['Beta League', 'Zeta Division']);
  });

  test('an invalid stored value is ignored', () => {
    const long = 'x'.repeat(121);
    const bad = ['{nope', '"Alpha League"', '{"0":"Alpha League"}', JSON.stringify(['Alpha League', 7]),
      JSON.stringify(['Alpha League', long]), JSON.stringify([...Array.from({ length: 500 }, (_, i) => `L${i}`), 'Alpha League'])];
    for (const v of bad) {
      const s = setup({ storage: memStorage({ 'bg.leagues': v }) });
      assert.equal(visible(s.doc).length, EDGE.fixtures.length, v.slice(0, 40));
      assert.equal(tool(s, 'leagues').textContent, 'Leagues');
    }
    // The edges that ARE valid: 500 entries, 120 characters.
    const ok = JSON.stringify([...Array.from({ length: 499 }, (_, i) => String(i).padStart(120, 'y')), 'Alpha League']);
    const s = setup({ storage: memStorage({ 'bg.leagues': ok }) });
    assert.equal(tool(s, 'leagues').textContent, 'Leagues · 1');
  });

  test('storage that throws never breaks the toolbar', () => {
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
    const s = setup({ storage: boom });
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Zeta Division');
    assert.equal(visible(s.doc).length, 3);
    const n = setup({ storage: null });
    fire(tool(n, 'leagues'), 'click');
    check(n, 'Zeta Division');
    assert.equal(visible(n.doc).length, 3);
  });

  test('the merged list never exceeds 500 entries (else the next read would ignore it all)', () => {
    const many = Array.from({ length: 500 }, (_, i) => `Elsewhere ${i}`);
    const storage = memStorage({ 'bg.leagues': JSON.stringify(many) });
    const s = setup({ storage });
    fire(tool(s, 'leagues'), 'click');
    check(s, 'Zeta Division');
    const stored = JSON.parse(storage.getItem('bg.leagues'));
    assert.equal(stored.length, 500);
    assert.ok(stored.includes('Zeta Division'), 'the current choice is kept first');
  });
});

// ------------------------------------------------------------------ Jump to now

describe('Jump to now', () => {
  test('shown on today\'s card with a not-started row ahead; scrolls to the first one at click time', () => {
    const s = setup({ now: ON_DAY });
    const jump = tool(s, 'jump');
    assert.equal(jump.hidden, false);
    assert.equal(jump.textContent, 'Jump to now');
    assert.equal(s.tools.querySelector('[role="status"]').contains(jump), false);
    fire(jump, 'click');
    const target = s.doc.getElementById('fx-900010'); // the first NS row after 13:00Z (withdrawn rows skipped)
    // Instant, then re-aligned next frame: rows above grow as content-visibility renders them,
    // which made a smooth scroll stop short of its row.
    assert.deepEqual(target.scrolls, [{ block: 'start' }]);
    assert.equal(target.getAttribute('tabindex'), '-1');
    assert.equal(s.doc.activeElement, target);
    assert.equal(s.frames.length, 1, 'a re-alignment is queued');
    s.flush();
    assert.deepEqual(target.scrolls, [{ block: 'start' }, { block: 'start' }]);
  });

  test('the target is chosen at click time, among visible rows only', () => {
    const s = setup({ now: ON_DAY });
    s.clock.now = Date.parse('2026-10-06T17:00:00Z');
    fire(tool(s, 'jump'), 'click');
    assert.equal(s.doc.getElementById('fx-900010').scrolls, undefined);
    assert.equal(s.doc.getElementById('fx-900012').scrolls.length, 1);
    type(s, 'parade');
    s.t.run();
    fire(tool(s, 'jump'), 'click');
    assert.equal(s.doc.getElementById('fx-900025').scrolls.length, 1, 'Alpha hidden: the next visible one');
  });

  test('reduced motion: the same instant scroll and re-alignment, never smooth', () => {
    const s = setup({ now: ON_DAY, reduced: true });
    fire(tool(s, 'jump'), 'click');
    s.flush();
    assert.deepEqual(s.doc.getElementById('fx-900010').scrolls, [{ block: 'start' }, { block: 'start' }]);
  });

  test('not shown on another day, or once nothing is left to start; a stale button hides itself', () => {
    assert.equal(tool(setup({ now: NEXT_DAY }), 'jump').hidden, true, 'not today');
    assert.equal(tool(setup({ now: Date.parse('2026-10-06T20:30:00Z') }), 'jump').hidden, true, 'every NS row has kicked off');
    const s = setup({ now: ON_DAY });
    s.clock.now = Date.parse('2026-10-06T21:00:00Z');
    fire(tool(s, 'jump'), 'click');
    assert.equal(tool(s, 'jump').hidden, true);
    assert.equal(rows(s.doc).some((r) => r.scrolls), false);
  });
});

// ------------------------------------------------------------------ sticky offsets

describe('sticky offsets', () => {
  test('the header height is measured with a ResizeObserver and set on <html> through CSSOM', () => {
    const s = setup({ RO: FakeResizeObserver });
    const ro = FakeResizeObserver.last;
    const topbar = s.q('.bg-topbar');
    assert.ok(ro.targets.includes(topbar));
    assert.ok(ro.targets.includes(s.tools));
    topbar.offsetHeight = 97;
    s.tools.offsetHeight = 112;
    ro.trigger();
    const html = s.doc.documentElement;
    assert.equal(html.style.getPropertyValue('--bg-sticky-top'), '97px');
    assert.equal(html.style.getPropertyValue('--bg-tools-h'), '112px');
    assert.equal(html.getAttribute('style'), null, 'never a style attribute');
  });

  test('without ResizeObserver the toolbar still works (CSS fallbacks)', () => {
    const s = setup({ RO: undefined });
    type(s, 'zeta');
    s.t.run();
    assert.equal(visible(s.doc).length, 3);
  });
});

// ------------------------------------------------------------------ source, CSS, day.js, the build

describe('source and stylesheet', () => {
  const RAW = readFileSync(join(REPO_ROOT, 'site/assets/js/predictions.js'), 'utf8');
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('no innerHTML, style attribute, cssText or fetch; selectors are literals, never built from a name', () => {
    assert.ok(SRC.includes('querySelector'), 'premise: the source was read (comments stripped)');
    for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /setAttribute\(\s*['"]style/, /cssText/, /fetch\(/, /\.style\.[a-z]+\s*=/i]) {
      assert.doesNotMatch(SRC, re, String(re));
    }
    for (const m of SRC.matchAll(/\b(querySelector(?:All)?|closest|matches)\(\s*(.)/g)) {
      assert.match(m[2], /['"]/, `${m[1]}( must take a string literal`);
    }
    // The fake DOM returns arrays; a browser returns a NodeList, which has no array methods.
    assert.doesNotMatch(SRC, /querySelectorAll\([^)]*\)\s*\.\s*(map|filter|find|some|every|reduce|includes|indexOf)\b/,
      'wrap querySelectorAll in Array.from before using array methods');
    assert.match(SRC, /from '\.\/lib\/search\.js'/, 'relative import of the shared search');
    assert.doesNotMatch(SRC, /node:|process\.|Buffer/);
  });

  test('day.js imports predictions.js relatively and calls it after its own try block, guarded', () => {
    const day = readFileSync(join(REPO_ROOT, 'site/assets/js/day.js'), 'utf8');
    assert.match(day, /from '\.\/predictions\.js'/);
    assert.match(day, /typeof HTMLDialogElement !== 'undefined'/);
  });

  test('predictions.css: brand tokens only, [hidden] wins over every display it sets, 44px targets, scoped scroll padding', () => {
    const css = readFileSync(join(REPO_ROOT, 'site/assets/css/predictions.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.deepEqual(css.match(/#[0-9a-f]{3,8}\b/gi) ?? [], [], 'colours come from base.css tokens');
    const hiddenRules = new Set();
    for (const m of css.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)) {
      for (const sel of m[1].split(',')) hiddenRules.add(sel.trim());
    }
    let displays = 0;
    for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      if (!/(^|;)\s*display:\s*(?!none)/.test(m[2])) continue;
      for (const raw of m[1].split(',')) {
        const sel = raw.trim();
        if (sel.includes('[hidden]') || sel.includes(':empty') || sel.startsWith(':root') || sel.startsWith('html')) continue;
        const base = sel.replace(/\[open\]$/, '');
        displays++;
        assert.ok(hiddenRules.has(`${base}[hidden]`), `${sel} sets display: ${base}[hidden]{display:none} must exist`);
      }
    }
    assert.ok(displays >= 6, `premise: the stylesheet sets displays (${displays})`);
    assert.match(css, /var\(--tap\)|44px/);
    assert.match(css, /html\.has-day-tools\s*\{[^}]*scroll-padding-top/);
    assert.doesNotMatch(css.replace(/html\.has-day-tools\s*\{[^}]*\}/g, ''), /scroll-padding/, 'scroll padding only under html.has-day-tools');
    assert.match(css, /var\(--bg-sticky-top/);
    assert.match(css, /@media \(min-width:\s*640px\)/);
    assert.match(css, /safe-area-inset-bottom/);
  });
});

describe('day.js enhances an archive card after rendering it', () => {
  let edge;
  before(async () => { edge = await readJson(join(ws.out, 'days/2026-10-06.json')); });
  const respond = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
  const stubPage = () => readFile(join(ws.out, 'day/2026-10-06/index.html'), 'utf8');

  test('the default enhancement reveals the toolbar on the rendered card', async () => {
    const doc = fakeDocument(await stubPage());
    await dayjs.init({ doc, fetchImpl: respond(edge), nowMs: NOW });
    const tools = doc.getElementById('day-root').querySelector('[data-day-tools]');
    assert.ok(tools);
    assert.equal(tools.hidden, false);
    assert.ok(tools.querySelector('input[type="search"]'));
  });

  test('a throwing enhancement never breaks the verified card; a failed load is not enhanced', async () => {
    const doc = fakeDocument(await stubPage());
    let calls = 0;
    await dayjs.init({ doc, fetchImpl: respond(edge), nowMs: NOW, enhance: () => { calls++; throw new Error('boom'); } });
    const root = doc.getElementById('day-root');
    assert.equal(calls, 1);
    assert.equal(root.querySelector('.day-error'), null);
    assert.equal(rows(doc).length, edge.fixtures.length);
    const bad = fakeDocument(await stubPage());
    let badCalls = 0;
    await dayjs.init({ doc: bad, fetchImpl: respond(null, 404), nowMs: NOW, enhance: () => { badCalls++; } });
    assert.equal(badCalls, 0);
  });
});

describe('built pages', () => {
  const read = (rel) => readFile(join(ws.out, rel), 'utf8');

  test('/ and full day pages load predictions.js; stubs load day.js instead; no other page loads it', async () => {
    const pages = ['index.html', 'day/2026-10-07/index.html', 'day/2026-10-08/index.html', 'day/2026-10-06/index.html',
      'day/2026-10-05/index.html', 'our-record/index.html', 'features/index.html', 'waitlist/index.html'];
    const loads = {};
    for (const rel of pages) loads[rel] = (await read(rel)).includes('<script type="module" src="/assets/js/predictions.js">');
    assert.deepEqual(loads, {
      'index.html': true, 'day/2026-10-07/index.html': true, 'day/2026-10-08/index.html': true,
      'day/2026-10-06/index.html': false, 'day/2026-10-05/index.html': false,
      'our-record/index.html': false, 'features/index.html': false, 'waitlist/index.html': false,
    });
    assert.match(await read('day/2026-10-06/index.html'), /src="\/assets\/js\/day\.js"/);
  });

  test('the built home page: search filters its rows; founding card and ring stay', async () => {
    const doc = fakeDocument(await read('index.html'));
    const t = timers();
    assert.ok(pred.init(doc, { storage: memStorage(), setTimer: t.setTimer, clearTimer: t.clearTimer, hasDialog: true }));
    const all = rows(doc).length;
    assert.ok(all > 10, 'premise: a real card');
    const first = rows(doc)[0];
    const team = first.querySelector('.fx__team').textContent;
    const input = doc.querySelector('[data-day-tools]').querySelector('input[type="search"]');
    input.value = team;
    fire(input, 'input');
    t.run();
    const shown = rows(doc).filter((r) => !r.hidden);
    assert.ok(shown.length >= 1 && shown.length < all, `${shown.length} of ${all}`);
    assert.ok(shown.includes(first));
    assert.equal(doc.querySelector('.bg-fd-card').hidden, false);
    assert.equal(doc.querySelector('[data-figure="ring"]').hidden, false);
  });
});
