// The day card body (spec §4, §5, §7). ISOMORPHIC: imported by the build for today/tomorrow and
// served to the browser, where the archive stub renders a fetched day file with the same code.
// Imports only ./esc.js, ./time.js and ./ring.js; no Node built-ins, no process, no Buffer.
//
// Input is a day file that passed data.js validateDay (the build) or day.js's shape check (the
// browser). Anything this module cannot render honestly throws rather than guessing: a missing or
// misrendered receipt is worse than a stale page (plan S2).
//
// Row rules (spec §5 "Data facts", §7):
//   - a withdrawn row keeps its published `status` forever, so it is rendered from `withdrawn`;
//   - the day's accuracy rule (ruleOf, spec §16.6) decides what counts and what is said:
//     rule 1 (no accuracy_rule: files published before round 3): a late row never has a pick and
//     says so; a picked row with pre_ko === false is marked (data-uncounted + note) and not counted;
//     rule 2: every non-withdrawn pick counts, a late row may carry a pick and no row carries a
//     late / moved note or marker (late and pre_ko are metadata only);
//   - a finished row (FT / AET / PEN) shows its 90-minute score (what markets settle on), plus the
//     a.e.t. result and the pens when present, if the file carries a well-formed score (checked
//     here too: the archive renders raw fetched files); never on any other status;
//   - an estimated price never appears without its marker (spec test 15);
//   - every state has its own words: the 3px edge colour is never the only channel.
// Every per-pick probability sits in an element with data-figure="pick-prob" (claim scanner).
// The ring is cross-checked against the rows: renderDay recounts won / lost / pushes with the
// day's own rule and throws if day.accuracy (or its pct) disagrees. There is no "accept either":
// a file is checked against exactly one rule, the one it declares.

import { escHtml, escAttr } from './esc.js';
import { lagosParts, fmtDayLong, fmtStamp, isDate } from './time.js';
import { ring } from './ring.js';

export const EST_TEXT = 'estimated price — no market price was captured';
/** The empty toolbar slot predictions.js fills; hidden (and so absent) without JS (spec §5). */
export const DAY_TOOLS = '<div class="day-tools" data-day-tools hidden></div>';

const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const STATUS_LABELS = Object.freeze({
  FT: 'FT', AET: 'AET', PEN: 'Pens', PST: 'Postponed', CANC: 'Cancelled', ABD: 'Abandoned',
  SUSP: 'Suspended', TBD: 'Time TBC', AWD: 'Awarded', WO: 'Walkover',
});
// Finished statuses: the only rows that show a score (an in-play score can be hours old).
const FINISHED = new Set(['FT', 'AET', 'PEN']);
// Statuses whose published kickoff time is not a time anyone should plan around.
const NO_KICKOFF = new Set(['PST', 'CANC', 'TBD']);

const GRADES = Object.freeze({
  won: { chip: 'Won', mod: 'bg-chip--won' },
  lost: { chip: 'Lost', mod: 'bg-chip--lost' },
  push: { chip: 'Push', mod: 'bg-chip--void' },
  void: { chip: 'Void', mod: 'bg-chip--void' },
  pending: { chip: 'Pending', mod: 'bg-chip--open' },
});

const MSG = Object.freeze({
  withdrawnPick: 'This fixture changed after the pick was published, so the pick is not graded.',
  withdrawnBare: 'This fixture changed after it was published.',
  late: 'No pick — first seen less than 10 minutes before kickoff, or later.',
  none: 'No recommendation.',
  moved: 'Kickoff was moved to a time before this pick was frozen — not counted in the ring.',
  // Rule-2 days only (spec §16 amendments): the first line of "How this card was built".
  howRule2: "At most one recommended pick per fixture — the platform's card pick — graded after full time.",
});

const HASH_RE = /^sha256:[0-9a-f]{64}$/;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The receipt code a card prints: the first 12 hex characters after "sha256:" of its picks_hash.
 * Plain text, never a link (spec §10). The build's archive stubs print the same code.
 */
export function receiptCode(picksHash) {
  if (typeof picksHash !== 'string' || !HASH_RE.test(picksHash)) throw new TypeError('receiptCode: picks_hash must be "sha256:" + 64 hex');
  return picksHash.slice('sha256:'.length, 'sha256:'.length + 12);
}

function count(v, what) {
  if (!Number.isInteger(v) || v < 0) throw new TypeError(`renderDay: ${what} must be a non-negative integer, got ${JSON.stringify(v)}`);
  return v;
}
function optDate(v, what) {
  if (v === null || v === undefined) return null;
  if (!isDate(v)) throw new TypeError(`renderDay: ${what} must be YYYY-MM-DD or null, got ${JSON.stringify(v)}`);
  return v;
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The display label for the data provider's status code: null for NS, 'Live' for in-play codes, else mapped or the raw code. */
export function statusLabel(code) {
  if (typeof code !== 'string' || code === '' || code === 'NS') return null;
  if (LIVE.has(code)) return 'Live';
  return Object.hasOwn(STATUS_LABELS, code) ? STATUS_LABELS[code] : code;
}

/**
 * The day file's accuracy rule (spec §16.6): absent -> 1 (files published before round 3);
 * otherwise exactly 1 or 2. Anything else is refused: the ring must be checked against one rule.
 */
export function ruleOf(day) {
  if (day === null || typeof day !== 'object' || !Object.hasOwn(day, 'accuracy_rule')) return 1;
  const v = day.accuracy_rule;
  if (v !== 1 && v !== 2) throw new TypeError(`renderDay: accuracy_rule must be 1 or 2 when present, got ${JSON.stringify(v)}`);
  return v;
}

function checkRule(rule, fn) {
  if (rule !== 1 && rule !== 2) throw new TypeError(`${fn}: rule must be 1 or 2, got ${JSON.stringify(rule)}`);
}

// In the ring: rule 1 (spec §4.3) - published before kickoff (pre_ko) and not withdrawn;
// rule 2 (spec §16.6) - any pick on a non-withdrawn row. won/lost make `graded`; push is counted
// separately.
const inRing = (f, rule) => f.withdrawn !== true && f.pick !== null && f.pick !== undefined
  && (rule === 2 || f.pre_ko === true);

/** A settled pick the day's ring counts (won or lost) under the given rule (1 or 2). */
export function isCounted(f, rule) {
  checkRule(rule, 'isCounted');
  return inRing(f, rule) && (f.grade === 'won' || f.grade === 'lost');
}
const isPct = (p) => Number.isInteger(p) && p >= 0 && p <= 100;

/**
 * Mean stated probability (pick.pct) of the day's settled, counted picks — the forward probability
 * the ring's 100% rule needs. UNROUNDED (the ring rounds, and reads >= 99.5 as ">99"). Null when no
 * pick is counted, or when ANY counted pick lacks a usable pct: a mean over a subset would state a
 * probability the day's picks were never published at. `rule` is the day's ruleOf (1 or 2).
 */
export function meanStatedPct(fixtures, rule) {
  checkRule(rule, 'meanStatedPct');
  if (!Array.isArray(fixtures)) return null;
  const counted = fixtures.filter((f) => isCounted(f, rule));
  if (counted.length === 0 || !counted.every((f) => isPct(f.pick.pct))) return null;
  return counted.reduce((s, f) => s + f.pick.pct, 0) / counted.length;
}

/**
 * Recount won / lost / pushes from the rows and refuse a day whose accuracy disagrees: the ring is
 * a claim about these rows, so it must be derivable from them (and pct from won / graded).
 */
function checkAccuracyAgainstRows(day, rule) {
  checkRule(rule, 'checkAccuracyAgainstRows');
  const a = day.accuracy;
  if (a === null || typeof a !== 'object') throw new TypeError('renderDay: accuracy is missing');
  let won = 0;
  let lost = 0;
  let pushes = 0;
  for (const f of day.fixtures) {
    if (!inRing(f, rule)) continue;
    if (f.grade === 'won') won++;
    else if (f.grade === 'lost') lost++;
    else if (f.grade === 'push') pushes++;
  }
  const graded = won + lost;
  const pct = graded ? Math.round((10000 * won) / graded) / 100 : null;
  if (a.won !== won || a.lost !== lost || a.pushes !== pushes || a.graded !== graded || a.pct !== pct) {
    throw new Error(`renderDay: ${day.lagos_day} accuracy (rule ${rule}) ${JSON.stringify({ won: a.won, lost: a.lost, pushes: a.pushes, graded: a.graded, pct: a.pct })} `
      + `does not match its rows ${JSON.stringify({ won, lost, pushes, graded, pct })}`);
  }
}

/** The row's state: withdrawn | won | lost | push | void | pending | late (rule 1 only) | nopick. */
function rowState(f, rule) {
  if (f.withdrawn === true) {
    if (f.grade !== 'withdrawn' && f.grade !== null) {
      throw new Error(`renderDay: fx ${f.fx} is withdrawn but its grade is ${JSON.stringify(f.grade)}`);
    }
    return 'withdrawn';
  }
  if (f.pick !== null && f.pick !== undefined) {
    if (typeof f.grade !== 'string' || !Object.hasOwn(GRADES, f.grade)) {
      throw new Error(`renderDay: fx ${f.fx} has a pick but grade ${JSON.stringify(f.grade)} is not one this card can render`);
    }
    return f.grade;
  }
  if (f.grade !== null && f.grade !== undefined) {
    throw new Error(`renderDay: fx ${f.fx} has no pick but grade ${JSON.stringify(f.grade)}`);
  }
  return rule === 1 && f.late === true ? 'late' : 'nopick';
}

// ------------------------------------------------------------------ row parts

function timeSlot(f, hm) {
  if (f.withdrawn) return '<span class="fx__time"><em>Withdrawn</em></span>';
  const label = statusLabel(f.status);
  const ko = NO_KICKOFF.has(f.status) ? '' : `<time class="fx__ko" datetime="${escAttr(f.ko)}">${escHtml(hm)}</time>`;
  const em = label === null ? '' : `<em${LIVE.has(f.status) ? ' data-live' : ''}>${escHtml(label)}</em>`;
  return `<span class="fx__time">${ko}${em}</span>`;
}

const isGoals = (v) => Number.isInteger(v) && v >= 0;

/**
 * The score to show, or null: a finished, non-withdrawn row whose score has integer 90-minute home /
 * away goals >= 0. A malformed score (a raw archive file is not validated by data.js) is omitted,
 * never thrown on and never printed. a.e.t. only on AET / PEN and pens only on PEN, each with both
 * values integers >= 0.
 */
function finalScore(f) {
  if (f.withdrawn === true || !FINISHED.has(f.status)) return null;
  const s = f.score;
  if (s === null || typeof s !== 'object' || Array.isArray(s) || !isGoals(s.home) || !isGoals(s.away)) return null;
  const aet = (f.status === 'AET' || f.status === 'PEN') && isGoals(s.aet_home) && isGoals(s.aet_away) ? [s.aet_home, s.aet_away] : null;
  const pens = f.status === 'PEN' && isGoals(s.pen_home) && isGoals(s.pen_away) ? [s.pen_home, s.pen_away] : null;
  return { home: s.home, away: s.away, aet, pens };
}

function teams(f) {
  const sc = finalScore(f);
  if (sc === null) {
    return '<span class="fx__teams">'
      + `<span class="fx__team">${escHtml(f.home)}</span>`
      + '<span class="vh"> v </span>'
      + `<span class="fx__team">${escHtml(f.away)}</span>`
      + '</span>';
  }
  // The 90-minute result (what markets settle on) sits right of each name in a two-column grid.
  // Extra time and the shoot-out are small lines of their own beneath the away score, in the same
  // column, so the two digits stay aligned.
  const line = (label, pair) => (pair === null ? ''
    : `<small class="fx__xtra mono">${label} ${escHtml(pair[0])}–${escHtml(pair[1])}</small>`);
  return '<span class="fx__teams fx__teams--scored">'
    + `<span class="fx__team">${escHtml(f.home)}</span><span class="vh">: </span><span class="fx__score mono">${escHtml(sc.home)}</span>`
    + '<span class="vh"> v </span>'
    + `<span class="fx__team">${escHtml(f.away)}</span><span class="vh">: </span><span class="fx__score mono">${escHtml(sc.away)}</span>`
    + line('a.e.t.', sc.aet) + line('pens', sc.pens)
    + '</span>';
}

function priceHtml(p) {
  if (p.price === null || p.price === undefined) return '<span class="fx__noprice">no price recorded</span>';
  if (typeof p.price !== 'number' || !Number.isFinite(p.price)) throw new TypeError('renderDay: pick.price must be a finite number or null');
  // The marker's meaning is read once, from the hidden text (no title: it would be announced twice).
  // Sighted readers get the same sentence in "How this card was built".
  const est = p.price_est === true
    ? `<span class="bg-chip fx__est"><span aria-hidden="true">est.</span><span class="vh">${escHtml(EST_TEXT)}</span></span>`
    : '';
  return `<b class="bg-odds">@ ${escHtml(p.price.toFixed(2))}</b>${est}`;
}

function probHtml(p, struck) {
  const pct = p.pct;
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    return '<p class="fx__prob fx__prob--none">probability not recorded</p>';
  }
  // A per-pick 100 is a rounded forward probability; it never renders as a bare "100%" (charter).
  const figure = pct === 100 ? '&gt;99%' : `${escHtml(pct)}%`;
  const inner = `<b class="bg-prob">${figure}</b> <span class="fx__cap">probability</span>`;
  return `<p class="fx__prob" data-figure="pick-prob">${struck ? `<s>${inner}</s>` : inner}</p>`;
}

function selHtml(p, struck) {
  const name = `<span class="fx__selname">${escHtml(p.label ?? p.market)}</span>`;
  const inner = `${name} ${priceHtml(p)}`;
  return `<p class="fx__sel">${struck ? `<s>${inner}</s>` : inner}</p>`;
}

function outcome(f, state, rule) {
  const p = f.pick;
  if (state === 'withdrawn') {
    const chip = '<span class="bg-chip bg-chip--void fx__grade">Withdrawn</span>';
    if (p === null || p === undefined) {
      return `<div class="fx__pick fx__pick--none"><p class="fx__pickhead">${chip}</p>`
        + `<p class="fx__msg">${escHtml(MSG.withdrawnBare)}</p></div>`;
    }
    return '<div class="fx__pick fx__pick--struck">'
      + `<p class="fx__pickhead"><span class="fx__offcard">Withdrawn pick</span>${chip}</p>`
      + selHtml(p, true) + probHtml(p, true)
      + `<p class="fx__msg">${escHtml(MSG.withdrawnPick)}</p></div>`;
  }
  if (state === 'late') return `<div class="fx__pick fx__pick--none"><p class="fx__msg">${escHtml(MSG.late)}</p></div>`;
  if (state === 'nopick') return `<div class="fx__pick fx__pick--none"><p class="fx__msg">${escHtml(MSG.none)}</p></div>`;

  const g = GRADES[state];
  return '<div class="fx__pick">'
    + '<p class="fx__pickhead"><span class="bg-eyebrow"><span class="bg-star" aria-hidden="true">★</span>Recommended pick</span>'
    + `<span class="bg-chip ${g.mod} fx__grade">${g.chip}</span></p>`
    + selHtml(p, false)
    + probHtml(p, false)
    + (p.why === null || p.why === undefined || p.why === '' ? '' : `<p class="fx__why">${escHtml(p.why)}</p>`)
    + (rule === 1 && f.pre_ko === false ? `<p class="fx__note">${escHtml(MSG.moved)}</p>` : '')
    + '</div>';
}

function fixtureRow(f, rule) {
  if (!Number.isInteger(f.fx)) throw new TypeError('renderDay: a fixture has a non-integer fx');
  const hm = lagosParts(f.ko).hm; // validates ko even when the time is not shown
  const state = rowState(f, rule);
  const uncounted = rule === 1 && state !== 'withdrawn' && f.pick && f.pre_ko === false ? ' data-uncounted' : '';
  // id: the client's "Jump to now" target; data-ko / data-status: what it needs to pick one
  // (predictions.js, Plan B Task B3). Names are NOT repeated as attributes (page weight): the
  // client indexes the .fx__team / .fx__comp text.
  return `<li class="fx" id="fx-${escAttr(f.fx)}" data-fx="${escAttr(f.fx)}" data-state="${state}"`
    + ` data-ko="${escAttr(f.ko)}" data-status="${escAttr(f.status)}"${uncounted}>`
    + `<p class="fx__comp">${escHtml(f.comp === '' ? 'Competition not named' : f.comp)}</p>`
    + timeSlot(f, hm) + teams(f) + outcome(f, state, rule)
    + '</li>';
}

// ------------------------------------------------------------------ the list

/**
 * The day's rows in list order (spec §5): kickoff, then competition, then home team, then fx.
 * ISO-Z strings order chronologically; names compare by plain code unit (`<`), never
 * localeCompare, so the build and every browser agree whatever their locale. A copy: the
 * day's own array (the receipt's order) is never reordered.
 */
function kickoffOrder(fixtures) {
  for (const f of fixtures) {
    if (typeof f.comp !== 'string') throw new TypeError(`renderDay: fx ${f.fx} comp must be a string`);
    if (typeof f.home !== 'string') throw new TypeError(`renderDay: fx ${f.fx} home must be a string`);
    if (typeof f.ko !== 'string') throw new TypeError(`renderDay: fx ${f.fx} ko must be a string`);
    if (!Number.isInteger(f.fx)) throw new TypeError('renderDay: a fixture has a non-integer fx');
  }
  return [...fixtures].sort((a, b) => cmp(a.ko, b.ko) || cmp(a.comp, b.comp) || cmp(a.home, b.home) || a.fx - b.fx);
}

/** "Thu 8 Oct 2026 · 137 fixtures · by kickoff"; the date is relabelled "Today · …" by stale.js. */
function dayBar(d, activeCount) {
  return '<p class="day-bar">'
    + `<span data-rel-day="${escAttr(d)}" data-rel="daybar">${escHtml(fmtDayLong(d))}</span>`
    + ` · ${escHtml(plural(activeCount, 'fixture', 'fixtures'))} · by kickoff</p>`;
}

// ------------------------------------------------------------------ the card

function howBuilt(day, rule) {
  const ps = day.pick_source;
  if (ps === null || typeof ps !== 'object') throw new TypeError('renderDay: pick_source is missing');
  const markets = count(day.counts?.markets_per_fixture, 'counts.markets_per_fixture');
  const n = count(ps.ledger_match_n, 'pick_source.ledger_match_n');
  const served = count(ps.ledger_match_served_n, 'pick_source.ledger_match_served_n');
  const matched = count(ps.ledger_match_matched, 'pick_source.ledger_match_matched');
  const unserved = count(ps.ledger_match_unserved, 'pick_source.ledger_match_unserved');
  // State counts only, never a cause (the data does not record one), and never the bare rate.
  const none = 'No fixture on this card has been checked against the graded record.';
  const tail = `the card showed a pick for ${served} — ${matched} of them the same pick the record grades`
    + (unserved > 0 ? ` — and showed no pick for ${unserved}.` : '.');
  if (rule === 2) {
    // Rule 2 (spec §16.6): any row may take the card's pick, every non-withdrawn pick counts, and
    // nothing on the card speaks of late or moved kickoffs. The check still covers only the rows
    // the publisher fed it; the sentence states how many, not which.
    const check = n === 0 ? none : `Of the ${plural(n, 'fixture', 'fixtures')} checked against the graded record when first listed, ${tail}`;
    return '<details class="day-how"><summary>How this card was built</summary><div class="day-how__body">'
      + `<p>${escHtml(MSG.howRule2)}</p>`
      + `<p>${escHtml(check)}</p>`
      + '<p>The list shows every fixture we cover that day, with or without a pick. Pushes are not counted; '
      + 'void picks and withdrawn picks are shown but not counted in the ring.</p>'
      + '<p>Prices marked est. are estimates: no market price was captured for them.</p>'
      + '</div></details>';
  }
  // Rule 1: the check covers fixtures listed in time for a pick; a late row never has one, but the
  // graded record may still grade that fixture, so a day with late rows says so.
  const checked = n === 0
    ? none
    : `Of the ${plural(n, 'fixture', 'fixtures')} listed in time for a pick (at least 10 minutes before kickoff) `
      + `that the graded record had a pick for, ${tail}`;
  const hasLate = day.fixtures.some((f) => f.late === true);
  const check = hasLate
    ? `${checked} Fixtures first listed too late carry no pick here; the graded record may still include them.`
    : checked;
  return '<details class="day-how"><summary>How this card was built</summary><div class="day-how__body">'
    + `<p>At most one recommended pick per fixture, chosen from ${escHtml(plural(markets, 'priced market', 'priced markets'))}.</p>`
    + `<p>${escHtml(check)}</p>`
    + '<p>The list shows every fixture we cover that day, with or without a pick. Pushes are not counted; '
    + 'void picks, withdrawn picks and picks whose kickoff was moved to before they were frozen are shown but not counted in the ring.</p>'
    + '<p>Prices marked est. are estimates: no market price was captured for them.</p>'
    + '</div></details>';
}

function dayNav(prevDay, nextDay) {
  if (!prevDay && !nextDay) return '';
  const link = (d, rel, word, arrow) => `<a class="day-nav__link day-nav__link--${rel}" href="/day/${escAttr(d)}/" rel="${rel}">`
    + `<span class="day-nav__dir">${arrow === 'l' ? '<span aria-hidden="true">←</span> ' : ''}${word}${arrow === 'r' ? ' <span aria-hidden="true">→</span>' : ''}</span>`
    + `<span class="day-nav__date">${escHtml(fmtDayLong(d))}</span></a>`;
  return '<nav class="day-nav" aria-label="Other days">'
    + (prevDay ? link(prevDay, 'prev', 'Previous day', 'l') : '')
    + (nextDay ? link(nextDay, 'next', 'Next day', 'r') : '')
    + '</nav>';
}

/**
 * The day card: header + ring + receipt, the toolbar slot, the day bar, ONE list of every row by
 * kickoff, "How this card was built", day links (spec §5). The founding card is not part of it: it
 * sits under the site header on every page (layout.page()).
 *
 * @param {object} day  a validated FULL day file (a compacted day has no card and throws)
 * @param {object} o
 * Relative words ("Today", "Tomorrow") are never baked in: the build runs hours before some reads,
 * so the card states its date, and the eyebrow (empty, hidden) and ring label carry
 * data-rel-day / data-rel for stale.js to relabel against the VISITOR's Lagos date (review I2).
 * Former isToday / isTomorrow options are ignored.
 * @param {string|null} [o.prevDay] 'YYYY-MM-DD' → link to /day/<d>/
 * @param {string|null} [o.nextDay] 'YYYY-MM-DD' → link to /day/<d>/
 * The receipt line is plain text — frozen stamp, grades stamp, 12-hex receipt code — with no link.
 * @returns {string} HTML fragment
 */
export function renderDay(day, { prevDay = null, nextDay = null } = {}) {
  if (day === null || typeof day !== 'object') throw new TypeError('renderDay: day must be an object');
  if (!isDate(day.lagos_day)) throw new TypeError('renderDay: day.lagos_day must be YYYY-MM-DD');
  if (!Array.isArray(day.fixtures)) throw new TypeError(`renderDay: ${day.lagos_day} has no fixtures array (a compacted day has no card)`);
  if (typeof day.picks_hash !== 'string' || !HASH_RE.test(day.picks_hash)) throw new TypeError('renderDay: picks_hash must be "sha256:" + 64 hex');
  const prev = optDate(prevDay, 'prevDay');
  const next = optDate(nextDay, 'nextDay');
  const rule = ruleOf(day);
  day.fixtures.forEach((f) => rowState(f, rule)); // every row renderable (named errors) before the ring is checked
  checkAccuracyAgainstRows(day, rule);

  const d = day.lagos_day;
  const longDate = fmtDayLong(d);
  const frozen = fmtStamp(day.picks_frozen_at);
  const gradedAt = fmtStamp(day.grades_as_of);
  const rows = kickoffOrder(day.fixtures);
  const n = day.fixtures.length;
  // A withdrawn row is not a fixture on today's card; it stays listed (the receipt) and is
  // counted separately so the header never overstates the card.
  const active = day.fixtures.filter((f) => f.withdrawn !== true);
  const k = n - active.length;
  const comps = new Set(active.map((f) => f.comp)).size;
  const countLine = (active.length === 0
    ? '0 fixtures'
    : `${plural(active.length, 'fixture', 'fixtures')} in ${plural(comps, 'competition', 'competitions')}`)
    + (k > 0 ? ` (${k} withdrawn)` : '');
  // = stale.js relLabel(d, <not today or tomorrow>, 'ring'), asserted by tests/relabel.test.js.
  const ringLabel = `Picks published for ${longDate}, settled so far`;
  const code = receiptCode(day.picks_hash);

  const head = '<header class="day-head">'
    + '<div class="day-head__title">'
    + `<p class="t-lbl day-head__rel" data-rel-day="${escAttr(d)}" data-rel="eyebrow" hidden></p>`
    + '<h1 class="t-d1">Football predictions</h1>'
    + `<p class="day-head__date">${escHtml(longDate)}</p>`
    + `<p class="day-head__count mono">${escHtml(countLine)}</p>`
    + '</div>'
    + ring(day.accuracy, { dayLabel: ringLabel, date: d, meanStatedPct: meanStatedPct(day.fixtures, rule), relDay: d })
    + '<p class="day-head__note">The ring counts this card’s own published picks. The graded record, every settled pick over time, is on <a href="/our-record/">Our Record</a>.</p>'
    + `<p class="day-receipt mono">Picks frozen ${escHtml(frozen)} · grades as of ${escHtml(gradedAt)} · receipt `
    + `<span class="mono">${escHtml(code)}</span></p>`
    + '</header>';

  // Nothing to search or count on an empty day: no toolbar slot, day bar or list.
  const body = n === 0
    ? `<div class="bg-empty day-empty"><h2>No fixtures on this card</h2><p>${escHtml(`No fixtures were scheduled in the competitions we cover on ${longDate}.`)}</p></div>`
    : DAY_TOOLS + dayBar(d, active.length)
      + `<ol class="fx-list" role="list" data-fx-list>${rows.map((f) => fixtureRow(f, rule)).join('')}</ol>`;

  return `<div class="day" data-day="${escAttr(d)}">${head}${body}${howBuilt(day, rule)}${dayNav(prev, next)}</div>`;
}
