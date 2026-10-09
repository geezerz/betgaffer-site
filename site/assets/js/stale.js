// Staleness banner and relative day labels (spec §6.8, plan S11, Task 6 review I2). Browser module
// on every page that carries a day label (home, day pages, the record).
//
// The build cannot know when a visitor reads the page, so nothing relative is baked into it:
//   - every relative label is rendered in its DATE form (true whenever it is read, with or without
//     JS) and tagged data-rel-day="<date>" data-rel="<kind>"; relabel() turns it into
//     "Today…"/"Tomorrow…" (and, on the day pills only, "Yesterday") for the VISITOR's Lagos
//     date on each page view, and again at the next Lagos midnight while the page stays open;
//   - from <main data-generated-at data-day data-tomorrow data-view data-stale-after-hours>:
//     the published data is older than the window -> "Last updated <stamp>. … this one is late.";
//     on the home page only, the visitor's Lagos date is after the shown day -> either tomorrow's
//     card is already published (the normal 00:00–00:10 window, not a failure) and is linked, or
//     today's card has not been published yet.
// The banner region <div class="stale" role="status" hidden> is in the static HTML. It is unhidden
// first and filled on the next frame (so the live region announces the text); every string is set
// with textContent and links are built with DOM APIs.
//
// Imports resolve to /assets/js/lib/ (the build copies the isomorphic modules there).

import { fmtDayLong, fmtStamp, isDate, isIsoZ, lagosToday } from './lib/time.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LAGOS_OFFSET_MS = HOUR_MS; // UTC+1 all year (lib/time.js)
export const DEFAULT_STALE_HOURS = 6;

function shiftDate(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 'yesterday' | 'today' | 'tomorrow' for the visitor's Lagos date at nowMs, else null (never throws). */
export function relDay(date, nowMs) {
  if (!isDate(date) || typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  const today = lagosToday(nowMs);
  if (date === today) return 'today';
  if (date === shiftDate(today, 1)) return 'tomorrow';
  if (date === shiftDate(today, -1)) return 'yesterday';
  return null;
}

/**
 * The text of a tagged label. kind:
 *   eyebrow         'Today' | 'Tomorrow' | ''  (an empty label is hidden)
 *   pill            'Yesterday' | 'Today' | 'Tomorrow' | ''  (a day pill's relative word, spec §17.1;
 *                   an empty one is hidden and the pill shows its weekday)
 *   sofar           'so far' | ''  (a day pill's note beside today's figure; hidden when empty)
 *   ring            "Today's published picks, settled so far" | "Tomorrow's …" | "Picks published for <date>, settled so far"
 *   next            "Today's card is published:" | "Tomorrow's card is published:" | "The card for <date> is published:"
 *   record          'Today · so far' | ''  (only today's figure is still moving; an empty label is
 *                   hidden, so a past day never reads "In progress" — Plan A Task 5)
 *   daybar          'Today · <date>' | '<date>'  (the list's day bar, spec §5; never empty, never
 *                   "Tomorrow": the bar is a date with an optional "Today" in front)
 * The third form (record, eyebrow, pill, sofar: the empty one) is what the build renders statically
 * (tests assert they agree). Only the pills name yesterday: every other kind keeps its date form.
 */
export function relLabel(date, nowMs, kind = 'ring') {
  const r = relDay(date, nowMs);
  const Word = r === 'today' ? 'Today' : r === 'tomorrow' ? 'Tomorrow' : null;
  switch (kind) {
    case 'eyebrow':
      return Word ?? '';
    case 'pill':
      return r === 'yesterday' ? 'Yesterday' : (Word ?? '');
    case 'sofar':
      return r === 'today' ? 'so far' : '';
    case 'ring':
      return Word ? `${Word}'s published picks, settled so far` : `Picks published for ${fmtDayLong(date)}, settled so far`;
    case 'next':
      return Word ? `${Word}'s card is published:` : `The card for ${fmtDayLong(date)} is published:`;
    case 'record':
      return r === 'today' ? 'Today · so far' : '';
    case 'daybar':
      return r === 'today' ? `Today · ${fmtDayLong(date)}` : fmtDayLong(date);
    default:
      throw new TypeError(`relLabel: unknown kind ${JSON.stringify(kind)}`);
  }
}

/** Milliseconds from nowMs to the next 00:00:00 WAT (a full day when nowMs is exactly midnight). */
export function msUntilLagosMidnight(nowMs) {
  const intoDay = (((nowMs + LAGOS_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - intoDay;
}

const KINDS = new Set(['eyebrow', 'pill', 'sofar', 'ring', 'next', 'record', 'daybar']);
const HIDE_WHEN_EMPTY = new Set(['eyebrow', 'pill', 'sofar', 'record']);
const PILL_PREFIX_RE = /^(?:Yesterday|Today|Tomorrow), /;
const PILL_SOFAR_RE = / so far$/;

/** The .day-pill link holding el (el itself excluded), or null. */
function pillOf(el) {
  for (let n = el.parentNode; n; n = n.parentNode) {
    if (n.classList && n.classList.contains('day-pill')) return n;
  }
  return null;
}

/**
 * A day pill follows its relative word: data-when (the today outline, the phone label) and the
 * accessible name, "<Word>, [All right, ]<date>: <result>[ so far]". The build's name is the date
 * form (a perfect day's starts with its visible "All right"), so the prefix and the note are stripped
 * first: relabelling again never stacks them.
 */
function relabelPill(el, date, nowMs) {
  const pill = pillOf(el);
  if (!pill) return;
  const r = relDay(date, nowMs);
  if (r) pill.setAttribute('data-when', r);
  else pill.removeAttribute('data-when');
  const aria = pill.getAttribute('aria-label');
  if (!aria) return;
  const base = aria.replace(PILL_PREFIX_RE, '').replace(PILL_SOFAR_RE, '');
  const word = relLabel(date, nowMs, 'pill');
  const sofar = pill.querySelector('[data-rel="sofar"]') && r === 'today' ? ' so far' : '';
  pill.setAttribute('aria-label', `${word ? `${word}, ` : ''}${base}${sofar}`);
}

/** Rewrite every [data-rel-day] label under root for the visitor's date at nowMs. */
export function relabel(root, nowMs) {
  for (const el of root.querySelectorAll('[data-rel-day]')) {
    const date = el.getAttribute('data-rel-day');
    const kind = el.getAttribute('data-rel');
    if (!isDate(date) || !KINDS.has(kind)) continue;
    const text = relLabel(date, nowMs, kind);
    if (kind === 'ring') {
      const label = el.querySelector('.ring__label');
      if (!label) continue;
      const old = label.textContent;
      label.textContent = text;
      const aria = el.getAttribute('aria-label');
      if (aria && aria.startsWith(old)) el.setAttribute('aria-label', text + aria.slice(old.length));
      continue;
    }
    el.textContent = text;
    if (HIDE_WHEN_EMPTY.has(kind)) el.hidden = text === '';
    if (kind === 'pill') relabelPill(el, date, nowMs);
  }
}

/**
 * The notices to show, in order (late first): [] when the page is current.
 * Each is { kind: 'late' | 'tomorrow' | 'old', text, href?, linkText? }.
 *
 * @param {object} o
 * @param {number} o.nowMs              visitor's clock, epoch ms
 * @param {string} [o.generatedAt]      index.generated_at (ISO-Z); absent/malformed -> no late check
 * @param {string|null} [o.day]         the shown day; pass it ONLY on the home page
 * @param {string|null} [o.tomorrow]    the published tomorrow date, when listed
 * @param {number} [o.staleAfterHours]  window; not a positive finite number -> 6
 */
export function staleNotice({ nowMs, generatedAt, day, tomorrow, staleAfterHours } = {}) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return [];
  const out = [];
  const hours = typeof staleAfterHours === 'number' && Number.isFinite(staleAfterHours) && staleAfterHours > 0
    ? staleAfterHours : DEFAULT_STALE_HOURS;
  if (isIsoZ(generatedAt) && nowMs - Date.parse(generatedAt) > hours * HOUR_MS) {
    out.push({ kind: 'late', text: `Last updated ${fmtStamp(generatedAt)}. Updates normally run every 2 hours; this one is late.` });
  }
  if (isDate(day)) {
    const visitor = lagosToday(nowMs);
    if (visitor > day) {
      if (isDate(tomorrow) && tomorrow === visitor) {
        out.push({
          kind: 'tomorrow',
          text: `It's ${fmtDayLong(visitor)} in Lagos — today's card is here:`,
          href: `/day/${tomorrow}/`,
          linkText: fmtDayLong(tomorrow),
        });
      } else {
        out.push({ kind: 'old', text: `This is the card for ${fmtDayLong(day)}. Today's card has not been published yet.` });
      }
    }
  }
  return out;
}

function show(doc, region, notices, raf) {
  region.hidden = false;
  raf(() => {
    region.replaceChildren();
    for (const n of notices) {
      const p = doc.createElement('p');
      p.textContent = n.text;
      if (n.href) {
        const a = doc.createElement('a');
        a.href = n.href;
        a.textContent = n.linkText;
        p.append(' ', a);
      }
      region.append(p);
    }
  });
}

const defaultRaf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0));

/**
 * Relabel the page and show any notice. Every dependency is injectable (tests drive it with a fake
 * DOM); in the browser it runs with the defaults.
 */
export function init({
  doc = document, nowMs = Date.now(), raf = defaultRaf, setTimer = (fn, ms) => setTimeout(fn, ms), now = () => Date.now(),
} = {}) {
  relabel(doc, nowMs);
  // Still open at the next Lagos midnight: relabel then (and every midnight after).
  const schedule = (from) => setTimer(() => {
    const t = now();
    relabel(doc, t);
    schedule(t);
  }, msUntilLagosMidnight(from) + 500);
  schedule(nowMs);

  const main = doc.querySelector('main');
  const region = main ? main.querySelector('.stale') : null;
  if (!main || !region) return;
  const d = main.dataset;
  const notices = staleNotice({
    nowMs,
    generatedAt: d.generatedAt,
    day: d.view === 'home' ? d.day : null,
    tomorrow: d.tomorrow,
    staleAfterHours: Number(d.staleAfterHours),
  });
  if (notices.length > 0) show(doc, region, notices, raf);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
}
