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
//   - a late row never has a pick; a picked row with pre_ko === false is marked and not counted;
//   - an estimated price never appears without its marker (spec test 15);
//   - every state has its own words: the 3px edge colour is never the only channel.
// Every per-pick probability sits in an element with data-figure="pick-prob" (claim scanner).
// The ring is cross-checked against the rows: renderDay recounts won / lost / pushes with the
// accuracy rule (pre_ko, not withdrawn) and throws if day.accuracy (or its pct) disagrees.

import { escHtml, escAttr } from './esc.js';
import { lagosParts, fmtDayLong, fmtStamp, isDate } from './time.js';
import { ring } from './ring.js';

export const EST_TEXT = 'estimated price — no market price was captured';
/** Competition groups rendered open; the rest start closed (works without JS; spec §11). */
export const OPEN_GROUPS = 12;

const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const STATUS_LABELS = Object.freeze({
  FT: 'FT', AET: 'AET', PEN: 'Pens', PST: 'Postponed', CANC: 'Cancelled', ABD: 'Abandoned',
  SUSP: 'Suspended', TBD: 'Time TBC', AWD: 'Awarded', WO: 'Walkover',
});
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
});

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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

// The day file's accuracy rule (spec §4.3): a pick counts when it was published before kickoff
// (pre_ko) and the row is not withdrawn. won/lost make `graded`; push is counted separately.
const inRing = (f) => f.withdrawn !== true && f.pre_ko === true && f.pick !== null && f.pick !== undefined;
const isCounted = (f) => inRing(f) && (f.grade === 'won' || f.grade === 'lost');
const isPct = (p) => Number.isInteger(p) && p >= 0 && p <= 100;

/**
 * Mean stated probability (pick.pct) of the day's settled, counted picks — the forward probability
 * the ring's 100% rule needs. UNROUNDED (the ring rounds, and reads >= 99.5 as ">99"). Null when no
 * pick is counted, or when ANY counted pick lacks a usable pct: a mean over a subset would state a
 * probability the day's picks were never published at.
 */
export function meanStatedPct(fixtures) {
  if (!Array.isArray(fixtures)) return null;
  const counted = fixtures.filter(isCounted);
  if (counted.length === 0 || !counted.every((f) => isPct(f.pick.pct))) return null;
  return counted.reduce((s, f) => s + f.pick.pct, 0) / counted.length;
}

/**
 * Recount won / lost / pushes from the rows and refuse a day whose accuracy disagrees: the ring is
 * a claim about these rows, so it must be derivable from them (and pct from won / graded).
 */
function checkAccuracyAgainstRows(day) {
  const a = day.accuracy;
  if (a === null || typeof a !== 'object') throw new TypeError('renderDay: accuracy is missing');
  let won = 0;
  let lost = 0;
  let pushes = 0;
  for (const f of day.fixtures) {
    if (!inRing(f)) continue;
    if (f.grade === 'won') won++;
    else if (f.grade === 'lost') lost++;
    else if (f.grade === 'push') pushes++;
  }
  const graded = won + lost;
  const pct = graded ? Math.round((10000 * won) / graded) / 100 : null;
  if (a.won !== won || a.lost !== lost || a.pushes !== pushes || a.graded !== graded || a.pct !== pct) {
    throw new Error(`renderDay: ${day.lagos_day} accuracy ${JSON.stringify({ won: a.won, lost: a.lost, pushes: a.pushes, graded: a.graded, pct: a.pct })} `
      + `does not match its rows ${JSON.stringify({ won, lost, pushes, graded, pct })}`);
  }
}

/** The row's state: withdrawn | won | lost | push | void | pending | late | nopick. */
function rowState(f) {
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
  return f.late === true ? 'late' : 'nopick';
}

// ------------------------------------------------------------------ row parts

function timeSlot(f, hm) {
  if (f.withdrawn) return '<span class="fx__time"><em>Withdrawn</em></span>';
  const label = statusLabel(f.status);
  const ko = NO_KICKOFF.has(f.status) ? '' : `<time class="fx__ko" datetime="${escAttr(f.ko)}">${escHtml(hm)}</time>`;
  const em = label === null ? '' : `<em${LIVE.has(f.status) ? ' data-live' : ''}>${escHtml(label)}</em>`;
  return `<span class="fx__time">${ko}${em}</span>`;
}

function teams(f) {
  return '<span class="fx__teams">'
    + `<span class="fx__team">${escHtml(f.home)}</span>`
    + '<span class="vh"> v </span>'
    + `<span class="fx__team">${escHtml(f.away)}</span>`
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

function outcome(f, state) {
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
    + (f.pre_ko === false ? `<p class="fx__note">${escHtml(MSG.moved)}</p>` : '')
    + '</div>';
}

function fixtureRow(f) {
  if (!Number.isInteger(f.fx)) throw new TypeError('renderDay: a fixture has a non-integer fx');
  const hm = lagosParts(f.ko).hm; // validates ko even when the time is not shown
  const state = rowState(f);
  const uncounted = state !== 'withdrawn' && f.pick && f.pre_ko === false ? ' data-uncounted' : '';
  return `<li class="fx" data-fx="${escAttr(f.fx)}" data-state="${state}"${uncounted}>`
    + timeSlot(f, hm) + teams(f) + outcome(f, state)
    + '</li>';
}

// ------------------------------------------------------------------ grouping

function groups(fixtures) {
  const by = new Map();
  for (const f of fixtures) {
    if (typeof f.comp !== 'string') throw new TypeError(`renderDay: fx ${f.fx} comp must be a string`);
    if (!by.has(f.comp)) by.set(f.comp, []);
    by.get(f.comp).push(f);
  }
  const out = [...by.entries()].map(([comp, rows]) => {
    rows.sort((a, b) => cmp(a.ko, b.ko) || a.fx - b.fx);
    return { comp, rows, first: rows[0].ko };
  });
  // ISO-Z strings order chronologically; plain code-unit comparison keeps the build and every
  // browser in the same order (localeCompare would depend on the host locale).
  out.sort((a, b) => cmp(a.first, b.first) || cmp(a.comp, b.comp));
  return out;
}

function groupHtml(g, i) {
  const name = g.comp === '' ? 'Competition not named' : g.comp;
  return `<details class="comp"${i < OPEN_GROUPS ? ' open' : ''}>`
    + `<summary><h2 class="comp__name">${escHtml(name)}</h2>`
    + `<span class="comp__count mono">${escHtml(plural(g.rows.length, 'fixture', 'fixtures'))}</span></summary>`
    + `<ul class="fx-list" role="list">${g.rows.map(fixtureRow).join('')}</ul>`
    + '</details>';
}

// ------------------------------------------------------------------ the card

function howBuilt(day) {
  const ps = day.pick_source;
  if (ps === null || typeof ps !== 'object') throw new TypeError('renderDay: pick_source is missing');
  const markets = count(day.counts?.markets_per_fixture, 'counts.markets_per_fixture');
  const n = count(ps.ledger_match_n, 'pick_source.ledger_match_n');
  const served = count(ps.ledger_match_served_n, 'pick_source.ledger_match_served_n');
  const matched = count(ps.ledger_match_matched, 'pick_source.ledger_match_matched');
  const unserved = count(ps.ledger_match_unserved, 'pick_source.ledger_match_unserved');
  // State counts only, never a cause (the data does not record one), and never the bare rate.
  // The check covers fixtures listed in time for a pick; a late row never has one, but the graded
  // record may still grade that fixture, so a day with late rows says so.
  const checked = n === 0
    ? 'No fixture on this card has been checked against the graded record.'
    : `Of the ${plural(n, 'fixture', 'fixtures')} listed in time for a pick (at least 10 minutes before kickoff) `
      + `that the graded record had a pick for, the card showed a pick for ${served} — `
      + `${matched} of them the same pick the record grades`
      + (unserved > 0 ? ` — and showed no pick for ${unserved}.` : '.');
  const hasLate = day.fixtures.some((f) => f.late === true);
  const check = hasLate
    ? `${checked} Fixtures first listed too late carry no pick here; the graded record may still include them.`
    : checked;
  return '<details class="day-how"><summary>How this card was built</summary><div class="day-how__body">'
    + `<p>At most one recommended pick per fixture, chosen from ${escHtml(plural(markets, 'priced market', 'priced markets'))}.</p>`
    + `<p>${escHtml(check)}</p>`
    + '<p>Each competition lists every fixture we cover that day, with or without a pick. Pushes are not counted; '
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
 * The day card: header + ring + receipt, competition groups, "How this card was built", day links.
 *
 * @param {object} day  a validated FULL day file (a compacted day has no card and throws)
 * @param {object} o
 * Relative words ("Today", "Tomorrow") are never baked in: the build runs hours before some reads,
 * so the card states its date, and the eyebrow (empty, hidden) and ring label carry
 * data-rel-day / data-rel for stale.js to relabel against the VISITOR's Lagos date (review I2).
 * Former isToday / isTomorrow options are ignored.
 * @param {string|null} [o.prevDay] 'YYYY-MM-DD' → link to /day/<d>/
 * @param {string|null} [o.nextDay] 'YYYY-MM-DD' → link to /day/<d>/
 * @param {string} o.repo           'owner/name' of the public receipts repository
 * @returns {string} HTML fragment
 */
export function renderDay(day, { prevDay = null, nextDay = null, repo } = {}) {
  if (day === null || typeof day !== 'object') throw new TypeError('renderDay: day must be an object');
  if (!isDate(day.lagos_day)) throw new TypeError('renderDay: day.lagos_day must be YYYY-MM-DD');
  if (!Array.isArray(day.fixtures)) throw new TypeError(`renderDay: ${day.lagos_day} has no fixtures array (a compacted day has no card)`);
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new TypeError(`renderDay: repo must be "owner/name", got ${JSON.stringify(repo)}`);
  if (typeof day.picks_hash !== 'string' || !HASH_RE.test(day.picks_hash)) throw new TypeError('renderDay: picks_hash must be "sha256:" + 64 hex');
  const prev = optDate(prevDay, 'prevDay');
  const next = optDate(nextDay, 'nextDay');
  day.fixtures.forEach(rowState); // every row renderable (named errors) before the ring is checked
  checkAccuracyAgainstRows(day);

  const d = day.lagos_day;
  const longDate = fmtDayLong(d);
  const frozen = fmtStamp(day.picks_frozen_at);
  const gradedAt = fmtStamp(day.grades_as_of);
  const gs = groups(day.fixtures);
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
  const receiptUrl = `https://github.com/${repo}/commits/main/days/${d}.json`;
  const short = day.picks_hash.slice(0, 'sha256:'.length + 12);

  const head = '<header class="day-head">'
    + '<div class="day-head__title">'
    + `<p class="t-lbl day-head__rel" data-rel-day="${escAttr(d)}" data-rel="eyebrow" hidden></p>`
    + '<h1 class="t-d1">Football predictions</h1>'
    + `<p class="day-head__date">${escHtml(longDate)}</p>`
    + `<p class="day-head__count mono">${escHtml(countLine)}</p>`
    + '</div>'
    + ring(day.accuracy, { dayLabel: ringLabel, date: d, meanStatedPct: meanStatedPct(day.fixtures), relDay: d })
    + '<p class="day-head__note">The ring counts this card’s own published picks. The graded record, every settled pick over time, is on <a href="/our-record/">Our Record</a>.</p>'
    + `<p class="day-receipt mono">Picks frozen ${escHtml(frozen)} · grades as of ${escHtml(gradedAt)} · receipt `
    + `<a class="day-receipt__link" href="${escAttr(receiptUrl)}" rel="noopener">${escHtml(short)}</a></p>`
    + '</header>';

  const body = n === 0
    ? `<div class="bg-empty day-empty"><h2>No fixtures on this card</h2><p>${escHtml(`No fixtures were scheduled in the competitions we cover on ${longDate}.`)}</p></div>`
    : `<div class="day-groups">${gs.map(groupHtml).join('')}</div>`;

  return `<div class="day" data-day="${escAttr(d)}">${head}${body}${howBuilt(day)}${dayNav(prev, next)}</div>`;
}
