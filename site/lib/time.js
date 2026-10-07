// Lagos time formatting. ISOMORPHIC: runs in the build and in the browser.
//
// Africa/Lagos is UTC+1 all year (no DST), so Lagos wall-clock = UTC + 1 h, computed with the
// UTC accessors only. The host timezone (build machine or visitor) is never consulted: the local
// accessors and locale formatters are banned in this file (tests/time.test.js greps for them).

const OFFSET_MS = 60 * 60 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO_Z_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n) => String(n).padStart(2, '0');
const pad4 = (n) => String(n).padStart(4, '0');

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based: day 0 of the next month
}

function realDate(y, m, d) {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Strict 'YYYY-MM-DDTHH:MM:SSZ' that names a real instant. */
export function isIsoZ(s) {
  if (typeof s !== 'string') return false;
  const m = ISO_Z_RE.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  return realDate(y, mo, d) && h <= 23 && mi <= 59 && se <= 59;
}

/** Strict 'YYYY-MM-DD' that names a real calendar date. */
export function isDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  return realDate(y, mo, d);
}

function partsOfMs(ms) {
  const t = new Date(ms + OFFSET_MS);
  const year = t.getUTCFullYear();
  const month = t.getUTCMonth() + 1;
  const day = t.getUTCDate();
  return {
    date: `${pad4(year)}-${pad2(month)}-${pad2(day)}`,
    hm: `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`,
    dow: DOW[t.getUTCDay()],
    day,
    mon: MON[month - 1],
    year,
  };
}

/** Lagos wall-clock parts of a UTC instant: {date, hm, dow, day, mon, year}. */
export function lagosParts(isoZ) {
  if (!isIsoZ(isoZ)) throw new TypeError(`lagosParts: not a strict ISO-Z instant: ${String(isoZ)}`);
  return partsOfMs(Date.parse(isoZ));
}

/** 'YYYY-MM-DD' (a calendar date, no instant) -> 'Thu 8 Oct 2026'. */
export function fmtDayLong(date) {
  if (!isDate(date)) throw new TypeError(`fmtDayLong: not a real YYYY-MM-DD date: ${String(date)}`);
  const [y, m, d] = date.split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${d} ${MON[m - 1]} ${y}`;
}

/** UTC instant -> '8 Oct 2026, 23:15 WAT' (Lagos time). */
export function fmtStamp(isoZ) {
  if (!isIsoZ(isoZ)) throw new TypeError(`fmtStamp: not a strict ISO-Z instant: ${String(isoZ)}`);
  const p = partsOfMs(Date.parse(isoZ));
  return `${p.day} ${p.mon} ${p.year}, ${p.hm} WAT`;
}

/** The Lagos calendar date ('YYYY-MM-DD') at epoch milliseconds nowMs (default: now). */
export function lagosToday(nowMs = Date.now()) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError(`lagosToday: nowMs must be finite epoch milliseconds, got ${String(nowMs)}`);
  }
  return partsOfMs(nowMs).date;
}
