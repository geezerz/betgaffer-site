// The accuracy ring (spec §4.3). ISOMORPHIC: imported by the build and served to the browser for
// the archive, so it imports only ./esc.js and ./time.js.
//
// It counts ONE day file's own published picks (`accuracy` = won / lost / pushes / graded / pct
// over the day's pre-kickoff, non-withdrawn, settled picks; graded = won + lost). The record is the
// ledger and is a different figure; the card says so next to the ring.
//
// Claim safety (charter, spec §4.4), enforced here rather than left to callers:
//   - the won-of-graded fraction is the hero; the percentage is secondary and never appears alone;
//   - graded === 0 reads "No results yet": never 0%, never --%, never 0/0, and no arc;
//   - a ring whose percentage DISPLAYS as 100 must carry its fraction, "settled so far" and the
//     forward probability ("these picks were stated at an average m%"). Without a usable m the
//     percentage is withheld and only the fraction is shown — never a bare 100%.
// The wrapper carries data-figure="ring" for the build's claim scanner, and holds no nested <div>
// so a scanner can match it as one element.
//
// CSP: no style attribute. The arc length is the SVG stroke-dasharray ATTRIBUTE over pathLength=100;
// colours come from CSS classes (fixtures.css).

import { escHtml, escAttr } from './esc.js';
import { fmtDayLong, isDate } from './time.js';

const DEFAULT_LABEL = 'Published picks, settled so far';

const isCount = (v) => Number.isInteger(v) && v >= 0;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A published percentage as text, up to 2 decimals ('85.71', '85.7', '50'). */
export function fmtPct(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) throw new TypeError(`fmtPct: not a finite number: ${String(pct)}`);
  return String(Math.round(pct * 100) / 100);
}

function checkAccuracy(a) {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new TypeError('ring: accuracy must be an object');
  for (const k of ['won', 'lost', 'pushes', 'graded']) {
    if (!isCount(a[k])) throw new TypeError(`ring: accuracy.${k} must be a non-negative integer, got ${JSON.stringify(a[k])}`);
  }
  if (a.graded !== a.won + a.lost) {
    throw new Error(`ring: accuracy.graded (${a.graded}) must equal won + lost (${a.won + a.lost})`);
  }
  if (a.graded > 0) {
    if (typeof a.pct !== 'number' || !Number.isFinite(a.pct) || a.pct < 0 || a.pct > 100) {
      throw new Error(`ring: accuracy.pct must be a number in [0, 100] when graded > 0, got ${JSON.stringify(a.pct)}`);
    }
  }
}

/**
 * A usable forward probability for the 100% rule, as display text, or null. A mean that would
 * round to 100 reads '>99': the stated probability was never certainty.
 */
function statedPct(m) {
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0 || m > 100) return null;
  return m >= 99.5 ? '>99' : String(Math.round(m));
}

/**
 * The ring for one day's published picks.
 *
 * @param {{won:number,lost:number,pushes:number,graded:number,pct:number|null}} accuracy
 * @param {object} [o]
 * @param {string} [o.dayLabel]        always-visible label, e.g. "Today's published picks, settled so far"
 * @param {string} [o.date]            'YYYY-MM-DD' — shown as the long date
 * @param {number} [o.meanStatedPct]   unrounded mean pick.pct of the day's settled counted picks (100% rule)
 * @param {string} [o.relDay]          'YYYY-MM-DD': tags the ring (data-rel-day, data-rel="ring") so the
 *   browser (stale.js) can turn the date-form label into "Today's…"/"Tomorrow's…" for the VISITOR's
 *   Lagos date. The aria-label starts with the label, so the relabel can rewrite both.
 * @returns {string} HTML
 */
export function ring(accuracy, { dayLabel, date, meanStatedPct, relDay } = {}) {
  checkAccuracy(accuracy);
  if (date !== undefined && date !== null && !isDate(date)) throw new TypeError(`ring: date must be YYYY-MM-DD, got ${String(date)}`);
  if (relDay !== undefined && relDay !== null && !isDate(relDay)) throw new TypeError(`ring: relDay must be YYYY-MM-DD, got ${String(relDay)}`);
  const rel = relDay ? ` data-rel-day="${escAttr(relDay)}" data-rel="ring"` : '';
  const label = typeof dayLabel === 'string' && dayLabel.trim() !== '' ? dayLabel : DEFAULT_LABEL;
  const { won, graded, pushes } = accuracy;
  const pushesLine = pushes > 0 ? `${plural(pushes, 'push', 'pushes')} not counted` : '';
  const longDate = date ? fmtDayLong(date) : '';
  const meta = [longDate, pushesLine].filter(Boolean);

  const track = '<circle class="ring__track" cx="24" cy="24" r="20" pathLength="100"/>';
  // An empty dial is dashed: open, not a figure. (Attribute, not style: CSP.)
  const emptyTrack = '<circle class="ring__track ring__track--empty" cx="24" cy="24" r="20" pathLength="100" stroke-dasharray="2 3"/>';
  const metaHtml = meta.length ? `<span class="ring__meta mono">${meta.map(escHtml).join(' · ')}</span>` : '';

  if (graded === 0) {
    const aria = `${label}: no results yet.${pushesLine ? ` ${pushesLine}.` : ''}`;
    return `<div class="ring" data-figure="ring"${rel} data-state="empty" role="img" aria-label="${escAttr(aria)}">`
      + '<span class="ring__body">'
      + `<span class="ring__label">${escHtml(label)}</span>`
      + '<span class="ring__hero">No results yet</span>'
      + metaHtml
      + '</span>'
      + `<span class="ring__dial"><svg class="ring__svg" viewBox="0 0 48 48" width="64" height="64" aria-hidden="true" focusable="false">${emptyTrack}</svg></span>`
      + '</div>';
  }

  const pctText = fmtPct(accuracy.pct);
  const isHundred = pctText === '100';
  const m = statedPct(meanStatedPct);
  const showPct = !isHundred || m !== null;
  const fraction = `${won} of ${graded} landed`;

  const statedLine = isHundred && m !== null
    ? `Settled so far. These picks were stated at an average ${m}%.`
    : '';
  const arc = `<circle class="ring__arc" cx="24" cy="24" r="20" pathLength="100" stroke-dasharray="${escAttr(pctText)} 100" transform="rotate(-90 24 24)"/>`;
  // A withheld 100% draws no arc either: a full ring IS the figure.
  const centre = showPct ? `<span class="ring__pct mono">${escHtml(pctText)}%</span>` : '';

  const aria = [
    `${label}: ${fraction}${showPct ? ` (${pctText}%)` : ''}.`,
    statedLine,
    pushesLine ? `${pushesLine}.` : '',
  ].filter(Boolean).join(' ');

  return `<div class="ring" data-figure="ring"${rel} data-state="graded" role="img" aria-label="${escAttr(aria)}">`
    + '<span class="ring__body">'
    + `<span class="ring__label">${escHtml(label)}</span>`
    + `<span class="ring__hero mono"><b>${escHtml(won)}</b> of <b>${escHtml(graded)}</b> <span class="ring__landed">landed</span></span>`
    + (statedLine ? `<span class="ring__stated">${escHtml(statedLine)}</span>` : '')
    + metaHtml
    + '</span>'
    + `<span class="ring__dial"><svg class="ring__svg" viewBox="0 0 48 48" width="64" height="64" aria-hidden="true" focusable="false">${track}${showPct ? arc : ''}</svg>${centre}</span>`
    + '</div>';
}
