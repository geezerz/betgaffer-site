// The floating accuracy ring's model (spec §6, §15). ISOMORPHIC and pure: imported by the tests and
// served to the browser (balloon.js), so it imports only ./ring.js and ./time.js.
//
// One design at every width: from DESKTOP_MIN the large ring (today, then yesterday); below it the
// small ring (today's figure and fraction only). Both drag; each size remembers its own position.
//
// Claim safety mirrors the static ring (ring.js):
//   - nothing graded reads "No results yet": never 0%, never --%, never 0/0, and no arc;
//   - every pick landed reads "n of n" + "landed so far": no percentage (no bare 100%), no arc;
//   - a real 0-of-n day may show 0% WITH its fraction;
//   - a percentage that would DISPLAY as 100 without every pick landing is withheld, arc included;
//   - every percentage, today's or yesterday's, travels with its "won of graded" fraction.
// Day words follow the relabel rules (stale.js relLabel): Today / Tomorrow for the visitor's Lagos
// date, otherwise the date. The line under it is always the shown day minus one.

import { fmtPct } from './ring.js';
import { fmtDayLong, isDate, lagosToday } from './time.js';

export const DESKTOP_MIN = 1024;
/** Each size remembers its own position: a desktop spot would strand the phone ring, and vice versa. */
export const POS_KEYS = Object.freeze({ desktop: 'bg.balloon.pos', compact: 'bg.balloon.pos.sm' });
/** Nominal diameters (px), used when the element cannot be measured (hidden, or not laid out yet). */
export const NOMINAL = Object.freeze({ desktop: 124, compact: 64 });
/** Distance kept from the viewport edges. */
export const PAD = 10;
/** Gap kept below the sticky header + toolbar, and around a toolbar control the default dodges. */
export const GAP = 8;
/**
 * The default anchor's distance from the right and bottom edges, per size (balloon.css says the
 * same, plus the bottom safe area). Bottom-right at both sizes: a top-right ring sat on the day
 * header's own ring.
 */
export const EDGE = Object.freeze({ desktop: Object.freeze({ x: 24, y: 24 }), compact: Object.freeze({ x: 12, y: 16 }) });

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const FIELDS = ['won', 'lost', 'pushes', 'graded', 'pct', 'date'];
const COUNT_RE = /^(?:0|[1-9]\d{0,8})$/;
const PCT_RE = /^\d{1,3}(?:\.\d{1,8})?$/;

const isCount = (v) => Number.isInteger(v) && v >= 0;

/** 'YYYY-MM-DD' + n calendar days (UTC arithmetic on a date). */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Milliseconds from nowMs to the next 00:00 WAT (a full day when nowMs is exactly midnight). */
export function msToLagosMidnight(nowMs) {
  const into = (((nowMs + HOUR_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - into;
}

/** 'desktop' from DESKTOP_MIN px, else 'compact' (an unknown width is the small ring). */
export function sizeClass(vw) {
  return typeof vw === 'number' && Number.isFinite(vw) && vw >= DESKTOP_MIN ? 'desktop' : 'compact';
}

export function storageKey(size) {
  if (!Object.hasOwn(POS_KEYS, size)) throw new TypeError(`storageKey: unknown size ${JSON.stringify(size)}`);
  return POS_KEYS[size];
}

function checkFigures(a, what) {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new TypeError(`${what} must be an object`);
  for (const k of ['won', 'lost', 'pushes', 'graded']) {
    if (!isCount(a[k])) throw new TypeError(`${what}.${k} must be a non-negative integer, got ${JSON.stringify(a[k])}`);
  }
  if (a.graded !== a.won + a.lost) throw new TypeError(`${what}.graded must equal won + lost`);
  if (a.graded === 0) {
    if (a.pct !== null && a.pct !== undefined) throw new TypeError(`${what}.pct must be null when nothing is graded`);
  } else if (typeof a.pct !== 'number' || !Number.isFinite(a.pct) || a.pct < 0 || a.pct > 100) {
    throw new TypeError(`${what}.pct must be a number in [0, 100] when graded > 0, got ${JSON.stringify(a.pct)}`);
  }
}

/**
 * One prefix's figures from string attributes: null when every attribute is absent, false when any
 * is present but invalid (or some are missing), else the parsed figures.
 */
function readOne(get, prefix) {
  const raw = {};
  for (const f of FIELDS) {
    const v = get(`${prefix}-${f}`);
    raw[f] = typeof v === 'string' ? v : null;
  }
  if (FIELDS.every((f) => raw[f] === null)) return null;
  for (const f of ['won', 'lost', 'pushes', 'graded']) if (raw[f] === null || !COUNT_RE.test(raw[f])) return false;
  if (raw.date === null || !isDate(raw.date)) return false;
  if (raw.pct !== null && !PCT_RE.test(raw.pct)) return false;
  const out = {
    won: Number(raw.won), lost: Number(raw.lost), pushes: Number(raw.pushes), graded: Number(raw.graded),
    pct: raw.pct === null ? null : Number(raw.pct), date: raw.date,
  };
  try {
    checkFigures(out, prefix);
  } catch {
    return false;
  }
  return out;
}

/**
 * The ring's figures from the page (`get(name)` returns data-<name>'s value or null): today from
 * data-ring-*, yesterday from data-yday-* (absent -> none). Fails closed: anything present but
 * invalid, or a yesterday that is not the shown day minus one, returns null and nothing is drawn.
 */
export function readFigures(get) {
  if (typeof get !== 'function') return null;
  const today = readOne(get, 'ring');
  if (!today) return null;
  const yesterday = readOne(get, 'yday');
  if (yesterday === false) return null;
  if (yesterday && yesterday.date !== addDays(today.date, -1)) return null;
  return { today, yesterday };
}

const shortDay = (date) => fmtDayLong(date).replace(/ \d{4}$/, ''); // 'Wed 7 Oct'

/**
 * @returns {null | { pctText: string|null, fracText: string, perfect: boolean }}
 *   null when nothing is graded.
 */
function figure(a) {
  if (a.graded === 0) return null;
  const perfect = a.won === a.graded;
  const p = perfect ? null : fmtPct(a.pct);
  return { pctText: p === '100' ? null : p, fracText: `${a.won} of ${a.graded}`, perfect };
}

/**
 * The ring for one shown day.
 *
 * @param {{won,lost,pushes,graded,pct}} today
 * @param {object} o
 * @param {string} o.date                 the shown day, 'YYYY-MM-DD'
 * @param {object|null} [o.yesterday]     the shown day minus one's figures, or null
 * @param {boolean} [o.compact]           the small ring: never a yesterday line
 * @param {number} [o.nowMs]              the visitor's clock; absent -> the date form (as the static page)
 * @returns {{ state: 'none'|'partial'|'perfect', pctText: string|null, fracText: string|null,
 *   label: string|null, dayText: string, arc: number|null,
 *   yday: null | { dayText: string, pctText: string|null, fracText: string }, aria: string }}
 */
export function ringModel(today, { date, yesterday = null, compact = false, nowMs } = {}) {
  checkFigures(today, 'ringModel: today');
  if (!isDate(date)) throw new TypeError(`ringModel: date must be YYYY-MM-DD, got ${String(date)}`);
  if (yesterday !== null) checkFigures(yesterday, 'ringModel: yesterday');

  const visitor = typeof nowMs === 'number' && Number.isFinite(nowMs) ? lagosToday(nowMs) : null;
  const prev = addDays(date, -1);
  let dayText;
  let lead;
  if (visitor !== null && date === visitor) {
    dayText = 'Today';
    lead = "Today's published picks";
  } else if (visitor !== null && date === addDays(visitor, 1)) {
    dayText = 'Tomorrow';
    lead = "Tomorrow's published picks";
  } else {
    dayText = shortDay(date);
    lead = `Picks published for ${fmtDayLong(date)}`;
  }

  const t = figure(today);
  let state;
  let aria;
  let label = null;
  if (t === null) {
    state = 'none';
    label = 'No results yet';
    aria = `${lead}: no results yet.`;
  } else if (t.perfect) {
    state = 'perfect';
    label = 'landed so far';
    aria = `${lead}: ${t.fracText} landed so far.`;
  } else {
    state = 'partial';
    aria = `${lead}: ${t.fracText} landed${t.pctText === null ? '' : ` (${t.pctText}%)`}.`;
  }

  let yday = null;
  const y = !compact && yesterday !== null ? figure(yesterday) : null;
  if (y !== null) {
    let yWord;
    let yLead;
    if (visitor !== null && date === visitor) {
      yWord = 'Yesterday';
      yLead = 'Yesterday';
    } else if (visitor !== null && prev === visitor) {
      yWord = 'Today';
      yLead = 'Today';
    } else {
      yWord = shortDay(prev);
      yLead = fmtDayLong(prev);
    }
    yday = { dayText: yWord, pctText: y.pctText, fracText: y.fracText };
    aria += y.perfect
      ? ` ${yLead}: ${y.fracText} landed so far.`
      : ` ${yLead}: ${y.fracText}${y.pctText === null ? '' : ` (${y.pctText}%)`}.`;
  }
  aria += ' Opens Our Record.';

  return {
    state,
    pctText: t === null ? null : t.pctText,
    fracText: t === null ? null : t.fracText,
    label,
    dayText,
    // The arc is the published percentage, only where that percentage is shown.
    arc: state === 'partial' && t.pctText !== null ? today.pct : null,
    yday,
    aria,
  };
}

const touches = (a, r) => r.width > 0 && r.height > 0
  && a.left < r.left + r.width + GAP && r.left - GAP < a.left + a.w
  && a.top < r.top + r.height + GAP && r.top - GAP < a.top + a.h;

/**
 * Where the ring sits before the visitor drags it: the bottom-right corner (the CSS anchor,
 * kind 'default') unless that would cover a visible toolbar control (within GAP) — as on a phone's
 * first screen, where the toolbar is not stuck yet and its last row can sit at the bottom. Then the
 * bottom-left corner ('left'), else just above the topmost control ('above') when that stays below
 * `floor` (the header's bottom + GAP). With no such room the corner stays: never off-screen.
 * Zero-size rects (controls that are not displayed) never count.
 *
 * @param {{vw:number, vh:number, w:number, h:number, edge:{x:number,y:number}, floor:number}} v
 * @param {{left:number, top:number, width:number, height:number}[]} controls
 * @returns {{left:number, top:number, kind:'default'|'left'|'above'}}
 */
export function defaultSpot({ vw, vh, w, h, edge, floor }, controls) {
  const top = vh - h - edge.y;
  const right = { left: vw - w - edge.x, top, w, h };
  const live = controls.filter((r) => r.width > 0 && r.height > 0);
  const clear = (a) => !live.some((r) => touches(a, r));
  if (clear(right)) return { left: right.left, top, kind: 'default' };
  const left = { left: edge.x, top, w, h };
  if (clear(left)) return { left: left.left, top, kind: 'left' };
  const above = { left: right.left, top: Math.min(...live.map((r) => r.top)) - h - GAP, w, h };
  if (above.top >= floor && clear(above)) return { left: above.left, top: above.top, kind: 'above' };
  return { left: right.left, top, kind: 'default' };
}

/**
 * Keep a ring of w x h inside the viewport, PAD from every edge and never above minTop (the bottom
 * of the sticky header + toolbar). `fits` is false when the viewport has no such room at all — the
 * caller then hides the ring rather than parking it off-screen or over the toolbar.
 */
export function clamp({ left, top }, { vw, vh, w, h, minTop, pad = PAD }) {
  for (const [k, v] of Object.entries({ left, top, vw, vh, w, h, minTop, pad })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`clamp: ${k} must be a finite number, got ${String(v)}`);
  }
  const maxLeft = vw - w - pad;
  const maxTop = vh - h - pad;
  return {
    left: Math.max(pad, Math.min(maxLeft, left)),
    top: Math.max(minTop, Math.min(maxTop, top)),
    fits: maxLeft >= pad && maxTop >= minTop,
  };
}
