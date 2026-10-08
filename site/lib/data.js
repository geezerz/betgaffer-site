// Load and validate the publisher's artifact (spec §5). BUILD ONLY (node:fs).
//
// The site renders only what passes here. Every validator returns an ALLOWLISTED copy: a key the
// contract does not name is dropped, so a field the publisher starts emitting tomorrow can never
// reach a page by accident. Any violation throws, which fails the build and leaves the previous
// deploy live (plan S2) — a stale page is better than a misrendered receipt.

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDate, isIsoZ } from './time.js';
import { picksHash } from './hash.js';

export const SCHEMA = 1;
// The day file's accuracy rule (spec §16.6). Absent = 1: a pick counts only when it was published
// before kickoff (pre_ko) and a late row never carries a pick. 2: every non-withdrawn pick counts and
// a late row may carry one. The renderer (fixtures.js) recounts the ring with the same rule.
export const ACCURACY_RULES = new Set([1, 2]);
export const GRADES = new Set(['won', 'lost', 'push', 'void', 'pending', 'withdrawn']);
// The ledger statuses known today. Validation accepts any string (a new status must not fail a
// rebuild); renderers escape it and may style only the ones named here.
export const LEDGER_STATUSES = new Set(['live', 'provisional', 'confirmed', 'republish_pending']);

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})(\.min)?\.json$/;

/** node:crypto SHA-256 of a UTF-8 string, lowercase hex — the build's picksHash digest. */
export function nodeSha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ------------------------------------------------------------------ field checkers

class Ctx {
  constructor(label) { this.label = label; }
  fail(path, msg) { throw new Error(`${this.label}: ${path} ${msg}`); }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function obj(c, v, path) {
  if (!isObj(v)) c.fail(path, 'must be an object');
  return v;
}
function get(c, o, k, path) {
  if (!has(o, k)) c.fail(`${path}${k}`, 'is missing');
  return o[k];
}
function int(c, o, k, path) {
  const v = get(c, o, k, path);
  if (!Number.isInteger(v) || v < 0) c.fail(`${path}${k}`, `must be a non-negative integer, got ${JSON.stringify(v)}`);
  return v;
}
function num(c, o, k, path, { nullable = false } = {}) {
  const v = get(c, o, k, path);
  if (v === null && nullable) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) c.fail(`${path}${k}`, `must be a finite number${nullable ? ' or null' : ''}`);
  return v;
}
function str(c, o, k, path, { nullable = false, nonEmpty = false } = {}) {
  const v = get(c, o, k, path);
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || (nonEmpty && v === '')) {
    c.fail(`${path}${k}`, `must be a ${nonEmpty ? 'non-empty ' : ''}string${nullable ? ' or null' : ''}`);
  }
  return v;
}
function bool(c, o, k, path) {
  const v = get(c, o, k, path);
  if (typeof v !== 'boolean') c.fail(`${path}${k}`, 'must be a boolean');
  return v;
}
function isoZ(c, o, k, path, { nullable = false } = {}) {
  const v = get(c, o, k, path);
  if (v === null && nullable) return null;
  if (!isIsoZ(v)) c.fail(`${path}${k}`, `must be a YYYY-MM-DDTHH:MM:SSZ instant, got ${JSON.stringify(v)}`);
  return v;
}
function date(c, o, k, path) {
  const v = get(c, o, k, path);
  if (!isDate(v)) c.fail(`${path}${k}`, `must be a real YYYY-MM-DD date, got ${JSON.stringify(v)}`);
  return v;
}
function hash(c, o, k, path, { nullable = false } = {}) {
  const v = get(c, o, k, path);
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || !HASH_RE.test(v)) c.fail(`${path}${k}`, 'must be "sha256:" + 64 lowercase hex');
  return v;
}
function oneOf(c, o, k, path, set, { nullable = false } = {}) {
  const v = get(c, o, k, path);
  if (v === null && nullable) return null;
  if (!set.has(v)) c.fail(`${path}${k}`, `must be one of ${[...set].join('|')}${nullable ? ' or null' : ''}, got ${JSON.stringify(v)}`);
  return v;
}
function schema(c, o) {
  const v = get(c, o, 'schema', '');
  if (v !== SCHEMA) c.fail('schema', `is ${JSON.stringify(v)}: unsupported schema (this build reads ${SCHEMA})`);
  return v;
}

/** A percentage that is null exactly when there is no denominator (never 0 for "no data"). */
function pctFor(c, o, k, path, denominator, { max = 100 } = {}) {
  const v = num(c, o, k, path, { nullable: true });
  if (denominator === 0 && v !== null) c.fail(`${path}${k}`, 'must be null when its denominator is 0');
  if (denominator > 0 && v === null) c.fail(`${path}${k}`, 'must be a number when its denominator is > 0');
  if (v !== null && (v < 0 || v > max)) c.fail(`${path}${k}`, `must be within [0, ${max}]`);
  return v;
}

function accuracy(c, v, path) {
  obj(c, v, path);
  const p = `${path}.`;
  const graded = int(c, v, 'graded', p);
  return {
    won: int(c, v, 'won', p),
    lost: int(c, v, 'lost', p),
    pushes: int(c, v, 'pushes', p),
    graded,
    pct: pctFor(c, v, 'pct', p, graded),
  };
}

function counts(c, v, path) {
  obj(c, v, path);
  const p = `${path}.`;
  return {
    fixtures: int(c, v, 'fixtures', p),
    priced: int(c, v, 'priced', p),
    recommended: int(c, v, 'recommended', p),
    markets_per_fixture: int(c, v, 'markets_per_fixture', p),
  };
}

// ------------------------------------------------------------------ index.json

function grain(c, v, path, periodCheck) {
  obj(c, v, path);
  const p = `${path}.`;
  const period = get(c, v, 'period', p);
  if (typeof period !== 'string' || !periodCheck(period)) c.fail(`${p}period`, `is malformed: ${JSON.stringify(period)}`);
  const graded = int(c, v, 'graded', p);
  const ff = int(c, v, 'finished_fixtures', p);
  return {
    period,
    won: int(c, v, 'won', p),
    lost: int(c, v, 'lost', p),
    pushes: int(c, v, 'pushes', p),
    graded,
    finished_fixtures: ff,
    pct: pctFor(c, v, 'pct', p, graded),
    coverage: pctFor(c, v, 'coverage', p, ff, { max: Number.MAX_VALUE }),
  };
}

const isMonth = (s) => {
  const m = MONTH_RE.exec(s);
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
};
const isRange = (s) => {
  const parts = s.split('..');
  return parts.length === 2 && isDate(parts[0]) && isDate(parts[1]) && parts[0] <= parts[1];
};

function statusDays(c, v, path) {
  // The publisher's JSON encoder writes an empty map as [], so an empty array is an empty map.
  if (Array.isArray(v) && v.length === 0) return {};
  obj(c, v, path);
  const out = {};
  for (const [k, n] of Object.entries(v)) {
    if (!Number.isInteger(n) || n < 0) c.fail(`${path}.${k}`, 'must be a non-negative integer');
    out[k] = n;
  }
  return out;
}

function record(c, v) {
  obj(c, v, 'record');
  const sel = obj(c, get(c, v, 'selection', 'record.'), 'record.selection');
  const sp = 'record.selection.';
  const selection = {
    card_min_probability: num(c, sel, 'card_min_probability', sp),
    fallback: str(c, sel, 'fallback', sp),
    fallback_min_probability: num(c, sel, 'fallback_min_probability', sp, { nullable: true }),
    odds_filter: bool(c, sel, 'odds_filter', sp),
    // With the odds filter off the band is not part of the rule, so it may be null.
    min_odds: num(c, sel, 'min_odds', sp, { nullable: sel.odds_filter === false }),
    max_odds: num(c, sel, 'max_odds', sp, { nullable: sel.odds_filter === false }),
    effective_since_date: date(c, sel, 'effective_since_date', sp),
  };

  const l30raw = get(c, v, 'last_30', 'record.');
  const last_30 = grain(c, l30raw, 'record.last_30', isRange);
  last_30.status_days = statusDays(c, get(c, l30raw, 'status_days', 'record.last_30.'), 'record.last_30.status_days');

  const l6 = get(c, v, 'last_6', 'record.');
  if (!Array.isArray(l6) || l6.length !== 6) c.fail('record.last_6', 'must be an array of exactly 6 entries');
  const last_6 = l6.map((e, i) => {
    const g = grain(c, e, `record.last_6[${i}]`, isDate);
    g.status = str(c, e, 'status', `record.last_6[${i}].`, { nullable: true });
    return g;
  });

  const ms = get(c, v, 'months', 'record.');
  if (!Array.isArray(ms)) c.fail('record.months', 'must be an array');
  const months = ms.map((e, i) => {
    const g = grain(c, e, `record.months[${i}]`, isMonth);
    g.status = str(c, e, 'status', `record.months[${i}].`);
    return g;
  });

  return {
    strategy: str(c, v, 'strategy', 'record.', { nonEmpty: true }),
    scope: str(c, v, 'scope', 'record.'),
    selection,
    as_of: isoZ(c, v, 'as_of', 'record.', { nullable: true }),
    last_30,
    last_6,
    months,
  };
}

/** Validate index.json; returns an allowlisted copy. Throws on any contract violation. */
export function validateIndex(o) {
  const c = new Ctx('index.json');
  obj(c, o, '(root)');
  schema(c, o);
  const daysRaw = get(c, o, 'days', '');
  if (!Array.isArray(daysRaw)) c.fail('days', 'must be an array');
  const days = daysRaw.map((e, i) => {
    const p = `days[${i}].`;
    obj(c, e, `days[${i}]`);
    return {
      day: date(c, e, 'day', p),
      compacted: bool(c, e, 'compacted', p),
      picks_hash: hash(c, e, 'picks_hash', p),
      fixtures: int(c, e, 'fixtures', p),
      accuracy: accuracy(c, get(c, e, 'accuracy', p), `days[${i}].accuracy`),
    };
  });
  for (let i = 1; i < days.length; i++) {
    if (days[i].day === days[i - 1].day) c.fail(`days[${i}].day`, `duplicate day ${days[i].day}`);
    if (days[i].day > days[i - 1].day) c.fail(`days[${i}].day`, 'is out of order: days[] must be newest first');
  }
  const newest = date(c, o, 'newest_day', '');
  if (days.length > 0 && newest !== days[0].day) c.fail('newest_day', `(${newest}) must equal days[0].day (${days[0].day})`);
  return {
    schema: SCHEMA,
    generated_at: isoZ(c, o, 'generated_at', ''),
    today: date(c, o, 'today', ''),
    newest_day: newest,
    strategy: str(c, o, 'strategy', '', { nonEmpty: true }),
    days,
    record: record(c, get(c, o, 'record', '')),
  };
}

// ------------------------------------------------------------------ day files

/** The day's accuracy rule: absent -> 1; present -> exactly 1 or 2 (no coercion). */
function accuracyRule(c, o) {
  if (!has(o, 'accuracy_rule')) return 1;
  const v = o.accuracy_rule;
  if (!ACCURACY_RULES.has(v)) c.fail('accuracy_rule', `must be one of ${[...ACCURACY_RULES].join('|')} when present, got ${JSON.stringify(v)}`);
  return v;
}

/**
 * The score (spec §16.2, C1 review): absent (files published before scores) or null -> null;
 * otherwise exactly { home, away, aet_home, aet_away, pen_home, pen_away } (every key present; any
 * other key dropped). home / away: the 90-minute result markets settle on, non-negative integers.
 * aet_*: the result after extra time, pen_*: the shoot-out — each null or a non-negative integer.
 * Outside picks_hash; shown only on finished rows (fixtures.js decides).
 */
function score(c, o, path) {
  if (!has(o, 'score') || o.score === null) return null;
  const v = o.score;
  if (!isObj(v)) c.fail(`${path}score`, `must be an object or null, got ${JSON.stringify(v)}`);
  const p = `${path}score.`;
  const opt = (k) => {
    const x = get(c, v, k, p);
    if (x !== null && (!Number.isInteger(x) || x < 0)) c.fail(`${p}${k}`, `must be a non-negative integer or null, got ${JSON.stringify(x)}`);
    return x;
  };
  return {
    home: int(c, v, 'home', p),
    away: int(c, v, 'away', p),
    aet_home: opt('aet_home'),
    aet_away: opt('aet_away'),
    pen_home: opt('pen_home'),
    pen_away: opt('pen_away'),
  };
}

function pick(c, v, path) {
  if (v === null) return null;
  obj(c, v, path);
  const p = `${path}.`;
  const pct = get(c, v, 'pct', p);
  // The publisher casts pct to an integer; no range is guaranteed upstream, so none is enforced here.
  if (pct !== null && !Number.isInteger(pct)) c.fail(`${p}pct`, 'must be an integer percentage or null');
  const price = num(c, v, 'price', p, { nullable: true });
  return {
    market: str(c, v, 'market', p, { nonEmpty: true }),
    label: str(c, v, 'label', p, { nullable: true }),
    pct,
    price,
    price_est: bool(c, v, 'price_est', p),
    why: str(c, v, 'why', p, { nullable: true }),
  };
}

function fixture(c, v, i, rule) {
  const path = `fixtures[${i}]`;
  obj(c, v, path);
  const p = `${path}.`;
  const rawPick = get(c, v, 'pick', p);
  if (rawPick !== null && !isObj(rawPick)) c.fail(`${p}pick`, 'must be an object or null');
  const f = {
    fx: int(c, v, 'fx', p),
    api_fx: int(c, v, 'api_fx', p),
    ko: isoZ(c, v, 'ko', p),
    comp: str(c, v, 'comp', p),
    home: str(c, v, 'home', p),
    away: str(c, v, 'away', p),
    home_id: int(c, v, 'home_id', p),
    away_id: int(c, v, 'away_id', p),
    status: str(c, v, 'status', p),
    pick: pick(c, rawPick, `${p}pick`),
    frozen_at: isoZ(c, v, 'frozen_at', p, { nullable: true }),
    pre_ko: bool(c, v, 'pre_ko', p),
    late: bool(c, v, 'late', p),
    withdrawn: bool(c, v, 'withdrawn', p),
    grade: oneOf(c, v, 'grade', p, GRADES, { nullable: true }),
    score: score(c, v, p),
  };
  // Every row, withdrawn included: the publisher nulls grade exactly when pick is null
  // (its grading step checks pick before withdrawn).
  if ((f.pick === null) !== (f.grade === null)) {
    c.fail(`${p}grade`, `is ${JSON.stringify(f.grade)} but the row ${f.pick === null ? 'has no pick' : 'has a pick'} (grade is null exactly when there is no pick)`);
  }
  if (!f.withdrawn && f.grade === 'withdrawn') c.fail(`${p}grade`, 'is "withdrawn" on a row whose withdrawn flag is false');
  // Rule 1 only: under rule 2 a late row may take the card's pick (spec §16.6).
  if (rule === 1 && f.late && f.pick !== null) c.fail(`${p}late`, 'is true but the row carries a pick (a late row never has one under accuracy rule 1)');
  if (f.pick !== null && f.frozen_at === null) c.fail(`${p}frozen_at`, 'is null but the row carries a pick');
  return f;
}

function pickSource(c, v) {
  obj(c, v, 'pick_source');
  const p = 'pick_source.';
  return {
    strategy: str(c, v, 'strategy', p, { nonEmpty: true }),
    fallback: str(c, v, 'fallback', p),
    ledger_match_rate: num(c, v, 'ledger_match_rate', p, { nullable: true }),
    ledger_match_n: int(c, v, 'ledger_match_n', p),
    ledger_match_matched: int(c, v, 'ledger_match_matched', p),
    ledger_match_served_n: int(c, v, 'ledger_match_served_n', p),
    ledger_match_unserved: int(c, v, 'ledger_match_unserved', p),
  };
}

/**
 * Validate a day file (full `days/<d>.json` or compacted `days/<d>.min.json`, told apart by
 * `compacted: true`). Returns an allowlisted copy; a compacted copy never carries fixtures.
 */
export function validateDay(o, { expectDate } = {}) {
  const c = new Ctx(`day ${expectDate ?? (isObj(o) ? o.lagos_day : '?')}`);
  obj(c, o, '(root)');
  schema(c, o);
  const lagos_day = date(c, o, 'lagos_day', '');
  if (expectDate !== undefined && lagos_day !== expectDate) c.fail('lagos_day', `is ${lagos_day}, expected ${expectDate}`);
  let compacted = false;
  if (has(o, 'compacted')) compacted = bool(c, o, 'compacted', '');
  const rule = accuracyRule(c, o);

  const out = {
    schema: SCHEMA,
    lagos_day,
    strategy: str(c, o, 'strategy', '', { nonEmpty: true }),
    picks_frozen_at: isoZ(c, o, 'picks_frozen_at', ''),
    grades_as_of: isoZ(c, o, 'grades_as_of', ''),
    prev_hash: hash(c, o, 'prev_hash', '', { nullable: true }),
    picks_hash: hash(c, o, 'picks_hash', ''),
    counts: counts(c, get(c, o, 'counts', ''), 'counts'),
    accuracy: accuracy(c, get(c, o, 'accuracy', ''), 'accuracy'),
    accuracy_rule: rule,
  };
  if (compacted) return { ...out, compacted: true };

  out.pick_source = pickSource(c, get(c, o, 'pick_source', ''));
  const fx = get(c, o, 'fixtures', '');
  if (!Array.isArray(fx)) c.fail('fixtures', 'must be an array');
  const seen = new Set();
  out.fixtures = fx.map((f, i) => {
    const row = fixture(c, f, i, rule);
    if (seen.has(row.fx)) c.fail(`fixtures[${i}].fx`, `duplicate fx ${row.fx}`);
    seen.add(row.fx);
    return row;
  });
  if (out.counts.fixtures !== out.fixtures.length) {
    c.fail('counts.fixtures', `(${out.counts.fixtures}) != fixtures.length (${out.fixtures.length})`);
  }
  return out;
}

// ------------------------------------------------------------------ loading

async function readJson(file, label) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw new Error(`${label}: cannot be read (${e.code ?? e.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${label}: is not valid JSON (${e.message})`);
  }
}

async function listDayFiles(rootDir) {
  try {
    return await readdir(join(rootDir, 'days'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/**
 * Load the artifact under rootDir: `{ index, days: Map<date, day> }`, days newest first.
 * No index.json (before the first publish) -> `{ index: null, days: new Map() }` (plan S7).
 * Any invalid input, a listed day without its file, or a picks_hash that does not recompute
 * (or disagrees with the index) throws. A day file the index does not list is ignored, with a
 * warning.
 */
export async function loadSite(rootDir, { warn = (m) => process.stderr.write(`${m}\n`), sha256hex = nodeSha256 } = {}) {
  const files = await listDayFiles(rootDir);
  const rawIndex = await readJson(join(rootDir, 'index.json'), 'index.json');
  if (rawIndex === undefined) {
    if (files.length > 0) warn(`warning: no index.json, so ${files.length} file(s) under days/ are ignored`);
    return { index: null, days: new Map() };
  }
  const index = validateIndex(rawIndex);

  const expected = new Set();
  const days = new Map();
  for (const entry of index.days) {
    const name = `${entry.day}${entry.compacted ? '.min' : ''}.json`;
    const label = `days/${name}`;
    expected.add(name);
    const raw = await readJson(join(rootDir, 'days', name), label);
    if (raw === undefined) throw new Error(`${label}: is listed in index.json but the file is missing`);
    const day = validateDay(raw, { expectDate: entry.day });
    if ((day.compacted === true) !== entry.compacted) {
      throw new Error(`${label}: compacted is ${day.compacted === true} but index.json lists ${entry.day} as compacted=${entry.compacted}`);
    }
    if (!entry.compacted) {
      // The index's ring figures for a full day are the file's own, field for field.
      const a = day.accuracy;
      const b = entry.accuracy;
      if (['won', 'lost', 'pushes', 'graded', 'pct'].some((k) => a[k] !== b[k])) {
        throw new Error(`accuracy mismatch ${entry.day}: file says ${JSON.stringify(a)}, index says ${JSON.stringify(b)}`);
      }
      const recomputed = await picksHash(raw.fixtures, sha256hex);
      if (recomputed !== day.picks_hash || recomputed !== entry.picks_hash) {
        throw new Error(`picks_hash mismatch ${entry.day}: recomputed ${recomputed}, file says ${day.picks_hash}, index says ${entry.picks_hash}`);
      }
    } else if (day.picks_hash !== entry.picks_hash) {
      throw new Error(`picks_hash mismatch ${entry.day}: compacted file says ${day.picks_hash}, index says ${entry.picks_hash}`);
    }
    days.set(entry.day, day);
  }

  for (const f of [...files].sort()) {
    if (expected.has(f)) continue;
    warn(DAY_FILE_RE.test(f)
      ? `warning: days/${f} is not listed in index.json; ignored`
      : `warning: days/${f} is not a day file; ignored`);
  }
  return { index, days };
}
