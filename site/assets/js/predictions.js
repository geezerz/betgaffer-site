// The predictions toolbar (spec §5): search, the Leagues dialog, the result line, the empty state
// and "Jump to now". Browser module, loaded on / and on full day pages; day.js calls init() after
// it renders an archive day.
//
// Progressive enhancement: the static list is complete without JavaScript. Here the empty, hidden
// toolbar slot the renderer emits ([data-day-tools]) is filled and shown. Filtering only toggles
// `hidden` on the rows, through an index built once (one entry per row, from the rendered
// .fx__team / .fx__comp text). The ring, the founding card and the day header are never touched:
// the ring is the whole day's published picks, and a filtered figure would be a different claim.
//
// Elements are built with DOM calls and textContent only. No selector is ever built from a
// competition or team name: rows are matched through the index, never looked up by name.
//
// Imports resolve to /assets/js/lib/ (the build copies the isomorphic modules there).

import { matcher, rowWords, words } from './lib/search.js';
import { lagosToday } from './lib/time.js';

export const STORAGE_KEY = 'bg.leagues';
export const DEBOUNCE_MS = 150;
export const MAX_STORED = 500;
export const MAX_NAME = 120;

export const TEXT = Object.freeze({
  search: 'Search teams or competitions',
  clear: 'Clear search',
  leagues: 'Leagues',
  showAll: 'Show all',
  showAllFixtures: 'Show all fixtures',
  empty: 'No fixtures match your search on this day.',
  jump: 'Jump to now',
  pickSearch: 'Search competitions',
  pickNone: 'No competitions match your search.',
  clearAll: 'Clear all',
  done: 'Done',
});

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // code point: Node and every browser agree
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** window.localStorage, or null where reading the property itself throws (blocked storage). */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const defaultHasDialog = () => typeof HTMLDialogElement !== 'undefined'
  && typeof HTMLDialogElement.prototype.showModal === 'function';

function defaultMedia(q) {
  try {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(q).matches === true;
  } catch {
    return false;
  }
}

/**
 * The stored league names, validated: a JSON array of at most MAX_STORED strings, each at most
 * MAX_NAME characters. Anything else (missing, malformed, blocked storage) is an empty list.
 */
export function readLeagues(storage) {
  let raw;
  try {
    raw = storage ? storage.getItem(STORAGE_KEY) : null;
  } catch {
    return [];
  }
  if (typeof raw !== 'string') return [];
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v) || v.length > MAX_STORED) return [];
  if (!v.every((x) => typeof x === 'string' && x.length <= MAX_NAME)) return [];
  return v;
}

/**
 * The list to store: (stored − this day's competitions) ∪ the selection. The selection is kept
 * whole and the cap trims other days' entries, oldest first, so it never drops a current choice; names too long to store are left out (and so are not
 * remembered), and the result never exceeds MAX_STORED (a longer list would be ignored whole).
 */
export function mergeLeagues(stored, dayComps, selection) {
  const fits = (c) => typeof c === 'string' && c.length <= MAX_NAME;
  const chosen = [...new Set(selection)].filter(fits).sort(cmp).slice(0, MAX_STORED);
  const mine = new Set(chosen);
  const others = [...new Set(stored)].filter((c) => fits(c) && !dayComps.has(c) && !mine.has(c));
  // Over the cap, the oldest other-day entries (the front of the list) give way.
  const room = MAX_STORED - chosen.length;
  return (room > 0 ? others.slice(Math.max(0, others.length - room)) : []).concat(chosen);
}

function writeLeagues(storage, dayComps, selection) {
  if (!storage) return;
  try {
    const merged = mergeLeagues(readLeagues(storage), dayComps, selection);
    if (merged.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Not remembered (blocked or full storage); the filter still applies to this page view.
  }
}

function el(doc, tag, attrs = {}, text = null) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === true) e.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, String(v));
  }
  if (text !== null) e.textContent = text;
  return e;
}

/** Set `hidden` only when it changes (a write on 1,500 rows per keystroke is not free). */
function setHidden(e, hide) {
  if (e.hidden !== hide) e.hidden = hide;
}

function setText(e, text) {
  if (e.textContent !== text) e.textContent = text;
}

/** The index: one entry per row, built once from the rendered text. */
function buildIndex(list) {
  return Array.from(list.querySelectorAll('li[data-fx]'), (li) => {
    const teams = Array.from(li.querySelectorAll('.fx__team'), (t) => t.textContent);
    const compEl = li.querySelector('.fx__comp');
    const comp = compEl ? compEl.textContent : '';
    return {
      el: li,
      comp,
      words: rowWords({ home: teams[0] ?? '', away: teams[1] ?? '', comp }),
      withdrawn: li.getAttribute('data-state') === 'withdrawn',
      ns: li.getAttribute('data-status') === 'NS',
      ko: Date.parse(li.getAttribute('data-ko') ?? ''),
    };
  });
}

/**
 * Fill and reveal the toolbar of the day card inside `root` (a document, or day.js's #day-root).
 * Returns a small controller, or null when there is nothing to do (no toolbar slot or list — a
 * zero-fixture day, another page — or a slot already filled). Every dependency is injectable;
 * in the browser it runs with the defaults.
 */
export function init(root = document, {
  doc = root && root.documentElement ? root : root?.ownerDocument,
  storage = defaultStorage(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
  hasDialog = defaultHasDialog(),
  media = defaultMedia,
  ResizeObserver: RO = globalThis.ResizeObserver,
} = {}) {
  if (!root || !doc) return null;
  const slot = root.querySelector('[data-day-tools]');
  const list = root.querySelector('[data-fx-list]');
  if (!slot || !list || slot.hasAttribute('data-ready')) return null;
  slot.setAttribute('data-ready', '');

  const card = root.querySelector('.day');
  const cardDay = card ? card.getAttribute('data-day') : null;
  const index = buildIndex(list);
  const total = index.filter((r) => !r.withdrawn).length;
  const counts = new Map();
  for (const r of index) counts.set(r.comp, (counts.get(r.comp) ?? 0) + (r.withdrawn ? 0 : 1));
  const comps = [...counts.keys()].sort(cmp);
  const dayComps = new Set(comps);

  const state = {
    query: '',
    match: matcher(''),
    selected: new Set(readLeagues(storage).filter((c) => dayComps.has(c))),
    timer: null,
  };

  // ---- the toolbar
  const main = el(doc, 'div', { class: 'bg-tools__row' });
  const search = el(doc, 'div', { class: 'bg-search' });
  const input = el(doc, 'input', {
    id: 'bg-q', class: 'bg-search__input', type: 'search', placeholder: TEXT.search,
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
  });
  const label = el(doc, 'label', { class: 'vh', for: 'bg-q' }, TEXT.search);
  const glass = el(doc, 'span', { class: 'bg-search__glass', 'aria-hidden': 'true' });
  const clear = el(doc, 'button', { type: 'button', class: 'bg-search__x', 'aria-label': TEXT.clear, 'data-tool': 'clear', hidden: true }, '×');
  search.append(label, glass, input, clear);
  main.append(search);

  let leaguesBtn = null;
  let leaguesCount = null;
  if (hasDialog) {
    leaguesBtn = el(doc, 'button', { type: 'button', class: 'bg-tool bg-tool--leagues', 'aria-haspopup': 'dialog', 'data-tool': 'leagues' });
    leaguesCount = el(doc, 'span', { class: 'bg-tool__count mono', hidden: true });
    leaguesBtn.append(el(doc, 'span', {}, TEXT.leagues), leaguesCount);
    main.append(leaguesBtn);
  }

  const meta = el(doc, 'div', { class: 'bg-tools__row bg-tools__meta' });
  const status = el(doc, 'p', { class: 'bg-result mono', role: 'status' });
  const showAll = el(doc, 'button', { type: 'button', class: 'bg-linkbtn', 'data-tool': 'show-all', hidden: true }, TEXT.showAll);
  const jump = el(doc, 'button', { type: 'button', class: 'bg-tool bg-tool--jump', 'data-tool': 'jump', hidden: true }, TEXT.jump);
  meta.append(status, showAll, jump);

  // ---- the empty state, beside the list (its sentence is announced by the status region)
  const empty = el(doc, 'div', { class: 'bg-filter-empty', 'data-tool': 'empty', hidden: true });
  const emptyBtn = el(doc, 'button', { type: 'button', class: 'bg-btn bg-btn--ghost' }, TEXT.showAllFixtures);
  empty.append(el(doc, 'p', { class: 'bg-filter-empty__t', 'aria-hidden': 'true' }, TEXT.empty), emptyBtn);
  list.before(empty);

  // ---- the Leagues dialog
  const pick = hasDialog ? buildDialog() : null;

  function buildDialog() {
    const d = el(doc, 'dialog', { class: 'bg-pick', 'aria-labelledby': 'bg-pick-t' });
    const inner = el(doc, 'div', { class: 'bg-pick__in' });
    const head = el(doc, 'div', { class: 'bg-pick__head' });
    const title = el(doc, 'h2', { id: 'bg-pick-t', class: 'bg-pick__title', tabindex: '-1' }, TEXT.leagues);
    const sub = el(doc, 'p', { class: 'bg-pick__sub mono' });
    head.append(title, sub);
    const box = el(doc, 'div', { class: 'bg-pick__search' });
    const q = el(doc, 'input', {
      id: 'bg-pick-q', type: 'search', placeholder: TEXT.pickSearch, autocomplete: 'off', spellcheck: 'false', 'data-pick': 'search',
    });
    box.append(el(doc, 'label', { class: 'vh', for: 'bg-pick-q' }, TEXT.pickSearch), q);
    const ul = el(doc, 'ul', { class: 'bg-pick__list', role: 'list' });
    const opts = comps.map((comp) => {
      const li = el(doc, 'li', { class: 'bg-pick__item' });
      const lab = el(doc, 'label', { class: 'bg-pick__opt' });
      const cb = el(doc, 'input', { type: 'checkbox' });
      cb.checked = state.selected.has(comp);
      lab.append(cb, el(doc, 'span', { class: 'bg-pick__name' }, comp), el(doc, 'span', { class: 'bg-pick__n mono' }, String(counts.get(comp))));
      li.append(lab);
      ul.append(li);
      cb.addEventListener('change', () => {
        if (cb.checked) state.selected.add(comp); else state.selected.delete(comp);
        writeLeagues(storage, dayComps, state.selected);
        apply();
      });
      return { li, cb, comp, words: words(comp) };
    });
    const none = el(doc, 'p', { class: 'bg-pick__msg', 'data-pick': 'none', hidden: true }, TEXT.pickNone);
    const foot = el(doc, 'div', { class: 'bg-pick__foot' });
    const clearAll = el(doc, 'button', { type: 'button', class: 'bg-btn bg-btn--ghost', 'data-pick': 'clear' }, TEXT.clearAll);
    const done = el(doc, 'button', { type: 'button', class: 'bg-btn bg-btn--primary', 'data-pick': 'done' }, TEXT.done);
    foot.append(clearAll, done);
    inner.append(head, box, ul, none, foot);
    d.append(inner);

    const filterOpts = () => {
      const m = matcher(q.value);
      let shown = 0;
      for (const o of opts) {
        const ok = m(o.words);
        setHidden(o.li, !ok);
        if (ok) shown++;
      }
      setHidden(none, shown > 0);
    };
    q.addEventListener('input', filterOpts);
    q.addEventListener('keydown', (e) => {
      // Esc order: a filled search box is cleared first; an empty one leaves Esc to the dialog.
      if (e.key === 'Escape' && q.value !== '') {
        e.preventDefault();
        e.stopPropagation();
        q.value = '';
        filterOpts();
      }
    });
    clearAll.addEventListener('click', () => {
      state.selected.clear();
      for (const o of opts) o.cb.checked = false;
      writeLeagues(storage, dayComps, state.selected);
      apply();
    });
    done.addEventListener('click', () => d.close());
    // The panel fills the dialog, so a click whose target is the dialog itself is the backdrop.
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => {
      q.value = '';
      filterOpts();
      if (leaguesBtn) leaguesBtn.focus();
    });
    doc.body.append(d);

    return {
      d,
      sync() {
        for (const o of opts) if (o.cb.checked !== state.selected.has(o.comp)) o.cb.checked = state.selected.has(o.comp);
        const n = state.selected.size;
        setText(sub, `${plural(comps.length, 'competition', 'competitions')} on this card${n > 0 ? ` · ${n} selected` : ''}`);
      },
      open() {
        // No autofocus on a narrow screen: focusing the field would raise the keyboard over the list.
        const narrow = media('(max-width: 639.98px)');
        if (narrow) q.removeAttribute('autofocus'); else q.setAttribute('autofocus', '');
        if (narrow) title.setAttribute('autofocus', ''); else title.removeAttribute('autofocus');
        d.showModal();
        (narrow ? title : q).focus();
      },
    };
  }

  // ---- apply the filters
  const isToday = () => {
    try {
      return cardDay !== null && lagosToday(now()) === cardDay;
    } catch {
      return false;
    }
  };
  // The index is in list order (kickoff order), so the first match is the next to start.
  const nextUp = (t) => index.find((r) => !r.el.hidden && !r.withdrawn && r.ns && Number.isFinite(r.ko) && r.ko > t);

  function apply() {
    const sel = state.selected;
    let shown = 0;
    let counted = 0;
    for (const r of index) {
      const ok = state.match(r.words) && (sel.size === 0 || sel.has(r.comp));
      setHidden(r.el, !ok);
      if (ok) {
        shown++;
        if (!r.withdrawn) counted++;
      }
    }
    const filtered = state.query !== '' || sel.size > 0;
    const none = filtered && shown === 0;
    setText(status, !filtered ? '' : none ? TEXT.empty : `Showing ${counted} of ${plural(total, 'fixture', 'fixtures')}`);
    // The empty state carries the sentence visibly; the status region keeps it for assistive tech.
    status.classList.toggle('vh', none);
    setHidden(empty, !none);
    setHidden(showAll, !filtered || none);
    if (leaguesBtn) {
      // The pill shows the number; the separator is for the accessible name ("Leagues · 3").
      const n = sel.size > 0 ? String(sel.size) : '';
      if (leaguesCount.textContent !== (n === '' ? '' : ` · ${n}`)) {
        if (n === '') leaguesCount.replaceChildren();
        else leaguesCount.replaceChildren(el(doc, 'span', { class: 'vh' }, ' · '), n);
      }
      setHidden(leaguesCount, sel.size === 0);
      if (leaguesBtn.hasAttribute('data-active') !== sel.size > 0) {
        if (sel.size > 0) leaguesBtn.setAttribute('data-active', ''); else leaguesBtn.removeAttribute('data-active');
      }
    }
    if (pick) pick.sync();
    setHidden(jump, !(isToday() && nextUp(now()) !== undefined));
    meta.classList.toggle('is-on', status.textContent !== '' || !showAll.hidden || !jump.hidden);
  }

  function setQuery(v, { immediate = false } = {}) {
    setHidden(clear, v === '');
    if (state.timer !== null) {
      clearTimer(state.timer);
      state.timer = null;
    }
    const run = () => {
      state.timer = null;
      state.query = words(v).join(' ');
      state.match = matcher(v);
      apply();
    };
    // Clearing shows everything at once; typing waits for a pause.
    if (immediate || words(v).length === 0) run();
    else state.timer = setTimer(run, DEBOUNCE_MS);
  }

  function clearSearch() {
    input.value = '';
    setQuery('', { immediate: true });
  }

  function showEverything() {
    input.value = '';
    state.selected.clear();
    writeLeagues(storage, dayComps, state.selected);
    setQuery('', { immediate: true });
    input.focus();
  }

  input.addEventListener('input', () => setQuery(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value !== '') {
      e.preventDefault();
      clearSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setQuery(input.value, { immediate: true });
    }
  });
  clear.addEventListener('click', () => {
    clearSearch();
    input.focus();
  });
  showAll.addEventListener('click', showEverything);
  emptyBtn.addEventListener('click', showEverything);
  if (leaguesBtn && pick) leaguesBtn.addEventListener('click', () => pick.open());

  jump.addEventListener('click', () => {
    // Chosen now, not when the page loaded: the first visible row still to kick off.
    const target = isToday() ? nextUp(now()) : undefined;
    if (!target) {
      setHidden(jump, true);
      meta.classList.toggle('is-on', status.textContent !== '' || !showAll.hidden);
      return;
    }
    const reduce = media('(prefers-reduced-motion: reduce)');
    target.el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    target.el.setAttribute('tabindex', '-1');
    target.el.focus({ preventScroll: true });
  });

  slot.append(main, meta);

  // ---- sticky offsets: the header is sticky (the banner is not); the toolbar sits under it.
  const html = doc.documentElement;
  const topbar = doc.querySelector('.bg-topbar');
  const measure = () => {
    if (topbar && Number.isFinite(topbar.offsetHeight)) html.style.setProperty('--bg-sticky-top', `${topbar.offsetHeight}px`);
    if (Number.isFinite(slot.offsetHeight)) html.style.setProperty('--bg-tools-h', `${slot.offsetHeight}px`);
  };
  html.classList.add('has-day-tools');
  slot.hidden = false;
  apply();
  if (typeof RO === 'function') {
    try {
      const ro = new RO(measure);
      if (topbar) ro.observe(topbar);
      ro.observe(slot);
    } catch {
      // No observer: the CSS fallbacks (per breakpoint) hold the offsets.
    }
  }
  measure();

  return {
    rows: index.length,
    apply,
    get selected() { return [...state.selected]; },
  };
}

if (typeof document !== 'undefined') {
  const start = () => {
    try {
      init(document);
    } catch {
      // The static list stays complete and readable.
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
