// The small-screen menu (spec §16.3, plan C amendment "Hamburger"): site/assets/js/nav.js driven
// through the hand-rolled fake DOM over a REAL page from layout.page(). Below 600 px the CSS
// already shows the ☰ and hides the panel; the script only opens and closes it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { page } from '../site/lib/layout.js';
import { init, WIDE_QUERY } from '../site/assets/js/nav.js';
import { fakeDocument, fire, serialize } from './fake-dom.js';
import { REPO_ROOT, testConfig } from './site-fixtures.js';

const html = (path = '/our-record/') => page({
  path, title: 'Our Record', description: 'd', body: '<p id="probe"><a href="#x">in the page</a></p>', config: testConfig(), year: 2026,
});

/** A fake document whose document-level listeners work, a fake window and a settable width. */
function setup({ wide = false, path } = {}) {
  const doc = fakeDocument(html(path));
  const docListeners = {};
  doc.addEventListener = (t, fn) => { (docListeners[t] ??= []).push(fn); };
  doc.fire = (type, init2 = {}) => {
    const ev = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init2 };
    for (const fn of docListeners[type] ?? []) fn(ev);
    return ev;
  };
  const win = { listeners: {}, addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); } };
  const state = { wide };
  const queries = [];
  const media = (q) => { queries.push(q); return state.wide; };
  const ctl = init({ doc, win, media });
  const btn = doc.querySelector('.bg-burger');
  const panel = doc.querySelector('#bg-nav-panel');
  const links = panel.querySelectorAll('a');
  const resize = (w) => { state.wide = w; for (const fn of win.listeners.resize ?? []) fn({ type: 'resize' }); };
  return { doc, win, ctl, btn, panel, links, resize, state, queries, docListeners };
}
const isOpen = (s) => s.panel.hasAttribute('data-open');

describe('nav.js: the ☰ menu below 600 px', () => {
  test('premise: the page carries the button and the panel; init wires them and changes nothing yet', () => {
    const before = serialize(fakeDocument(html()).root);
    const s = setup();
    assert.ok(s.ctl, 'a controller');
    assert.ok(s.btn && s.panel);
    assert.equal(serialize(s.doc.root), before, 'no DOM change on load: the CSS default is already the ☰ layout');
    assert.ok(s.links.length >= 7, 'four nav links + three legal links');
  });

  test('the button opens the panel: data-open + aria-expanded="true", focus moves to the first link', () => {
    const s = setup();
    fire(s.btn, 'click');
    assert.equal(isOpen(s), true);
    assert.equal(s.btn.getAttribute('aria-expanded'), 'true');
    assert.equal(s.doc.activeElement, s.links[0], 'focus moves into the panel');
    assert.equal(s.links[0].getAttribute('href'), '/');
  });

  test('the button again closes it; focus stays on the button', () => {
    const s = setup();
    fire(s.btn, 'click');
    s.btn.focus();
    fire(s.btn, 'click');
    assert.equal(isOpen(s), false);
    assert.equal(s.btn.getAttribute('aria-expanded'), 'false');
    assert.equal(s.doc.activeElement, s.btn);
  });

  test('Esc closes it and returns focus to the button; Esc while closed is left alone', () => {
    const s = setup();
    fire(s.btn, 'click');
    assert.equal(s.doc.activeElement, s.links[0], 'premise: focus inside');
    const ev = s.doc.fire('keydown', { key: 'Escape' });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(isOpen(s), false);
    assert.equal(s.btn.getAttribute('aria-expanded'), 'false');
    assert.equal(s.doc.activeElement, s.btn, 'focus returns to the button');
    assert.equal(s.doc.fire('keydown', { key: 'Escape' }).defaultPrevented, false, 'closed: Esc belongs to the page');
    const other = s.doc.fire('keydown', { key: 'Enter' });
    assert.equal(other.defaultPrevented, false);
  });

  test('a tap outside closes it; a tap inside the panel or on the button does not', () => {
    const s = setup();
    fire(s.btn, 'click');
    s.doc.fire('pointerdown', { target: s.links[2] });
    assert.equal(isOpen(s), true, 'inside the panel');
    s.doc.fire('pointerdown', { target: s.btn });
    assert.equal(isOpen(s), true, 'the button handles its own click');
    const outside = s.doc.querySelector('#probe');
    s.doc.fire('pointerdown', { target: outside });
    assert.equal(isOpen(s), false, 'outside');
    assert.equal(s.btn.getAttribute('aria-expanded'), 'false');
    assert.equal(s.doc.activeElement, s.btn, 'focus was inside the closing panel: back to the button');
  });

  test('a tap outside onto another control leaves that control focused', () => {
    const s = setup();
    fire(s.btn, 'click');
    const target = s.doc.querySelector('#probe').querySelector('a');
    target.focus(); // the browser moves focus on pointerdown before the document listener runs
    s.doc.fire('pointerdown', { target });
    assert.equal(isOpen(s), false);
    assert.equal(s.doc.activeElement, target, 'never steals focus back');
  });

  test('a link in the panel (nav or legal) closes it', () => {
    for (const i of [1, 3, 5]) {
      const s = setup();
      fire(s.btn, 'click');
      fire(s.links[i], 'click');
      assert.equal(isOpen(s), false, `link ${i}`);
      assert.equal(s.btn.getAttribute('aria-expanded'), 'false');
    }
  });

  test('focus leaving the panel for the page (Tab past the last link) closes it without moving focus', () => {
    const s = setup();
    fire(s.btn, 'click');
    const out = s.doc.querySelector('#probe').querySelector('a');
    fire(s.panel, 'focusout', { relatedTarget: s.links[1] });
    assert.equal(isOpen(s), true, 'within the panel');
    fire(s.panel, 'focusout', { relatedTarget: s.btn });
    assert.equal(isOpen(s), true, 'back to the button (Shift+Tab)');
    fire(s.panel, 'focusout', { relatedTarget: null });
    assert.equal(isOpen(s), true, 'focus to nothing: the pointer handler decides');
    out.focus();
    fire(s.panel, 'focusout', { relatedTarget: out });
    assert.equal(isOpen(s), false);
    assert.equal(s.doc.activeElement, out);
  });

  test('a resize to 600 px or wider closes it (the inline nav takes over); narrower resizes do not', () => {
    const s = setup();
    fire(s.btn, 'click');
    s.resize(false);
    assert.equal(isOpen(s), true, 'still narrow');
    s.resize(true);
    assert.equal(isOpen(s), false);
    assert.equal(s.btn.getAttribute('aria-expanded'), 'false');
    assert.ok(s.queries.every((q) => q === WIDE_QUERY), 'one breakpoint');
    assert.equal(WIDE_QUERY, '(min-width: 600px)');
  });

  test('at 600 px and wider nothing changes: a click on the (CSS-hidden) button does not open a panel', () => {
    const s = setup({ wide: true });
    const before = serialize(s.doc.root);
    fire(s.btn, 'click');
    s.doc.fire('keydown', { key: 'Escape' });
    s.doc.fire('pointerdown', { target: s.doc.querySelector('#probe') });
    fire(s.links[1], 'click');
    s.resize(true);
    assert.equal(serialize(s.doc.root), before, 'the inline nav and the button untouched');
  });

  test('a second init is a no-op; a page without the button or panel is left alone', () => {
    const s = setup();
    assert.equal(init({ doc: s.doc, win: s.win, media: () => false }), null);
    fire(s.btn, 'click');
    assert.equal(isOpen(s), true, 'one listener: a double toggle would leave it closed');
    const bare = fakeDocument('<!doctype html><html><head><title>t</title></head><body><main id="main"></main></body></html>');
    bare.addEventListener = () => assert.fail('no listeners on a page without the menu');
    assert.equal(init({ doc: bare, win: { addEventListener: () => assert.fail('no window listeners') }, media: () => false }), null);
  });

  test('every page variant renders the menu: home, a waitlist page, the 404', () => {
    for (const path of ['/', '/waitlist/', '/waitlist/thanks/', '/404.html']) {
      const s = setup({ path });
      fire(s.btn, 'click');
      assert.equal(isOpen(s), true, path);
    }
  });
});

describe('nav.js: source', () => {
  const RAW = readFileSync(join(REPO_ROOT, 'site/assets/js/nav.js'), 'utf8');
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('no imports, no fetch, no innerHTML, no style writes of any kind, literal selectors', () => {
    assert.ok(SRC.includes('aria-expanded'), 'premise: the source was read (comments stripped)');
    for (const re of [/^\s*import\b/m, /import\(/, /fetch\(/, /XMLHttpRequest/, /innerHTML/, /outerHTML/, /insertAdjacentHTML/,
      /\.style\b/, /setAttribute\(\s*['"]style/, /cssText/, /node:|process\.|Buffer/, /localStorage/]) {
      assert.doesNotMatch(SRC, re, String(re));
    }
    for (const m of SRC.matchAll(/\b(querySelector(?:All)?|closest|matches|getElementById)\(\s*(.)/g)) {
      assert.match(m[2], /['"]/, `${m[1]}( must take a string literal`);
    }
    assert.doesNotMatch(SRC, /querySelectorAll\([^)]*\)\s*\.\s*(map|filter|find|some|every|reduce|includes|indexOf)\b/,
      'wrap querySelectorAll in Array.from before using array methods (a NodeList has none)');
  });
});
