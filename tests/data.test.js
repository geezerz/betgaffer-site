import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, rmSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSite, validateIndex, validateDay, nodeSha256 } from '../site/lib/data.js';

const ART = fileURLToPath(new URL('./fixtures/artifact/', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const INDEX = readJson(join(ART, 'index.json'));
const DAY07 = readJson(join(ART, 'days/2026-10-07.json'));
const DAY08 = readJson(join(ART, 'days/2026-10-08.json'));
const clone = (o) => structuredClone(o);

const tmpRoots = [];
after(() => { for (const d of tmpRoots) rmSync(d, { recursive: true, force: true }); });

/** A writable copy of the fixture artifact in a fresh temp dir. */
function artifactCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'bg-data-'));
  tmpRoots.push(dir);
  cpSync(ART, dir, { recursive: true });
  return dir;
}
function emptyDir() {
  const dir = mkdtempSync(join(tmpdir(), 'bg-empty-'));
  tmpRoots.push(dir);
  return dir;
}
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 4) + '\n');
const quiet = { warn: () => {} };

// ---------------------------------------------------------------- loadSite: happy paths

test('loads the fixture artifact: index + both full days, newest first, no warnings', async () => {
  const warnings = [];
  const site = await loadSite(ART, { warn: (m) => warnings.push(m) });
  assert.equal(site.index.today, '2026-10-07');
  assert.equal(site.index.newest_day, '2026-10-08');
  assert.deepEqual([...site.days.keys()], ['2026-10-08', '2026-10-07']);
  assert.equal(site.days.get('2026-10-08').fixtures.length, 130);
  assert.equal(site.days.get('2026-10-07').fixtures.length, 146);
  assert.equal(site.days.get('2026-10-08').picks_hash, DAY08.picks_hash);
  assert.equal(site.index.record.last_6.length, 6);
  assert.deepEqual(warnings, []);
});

test('no index.json (before the first publish) is not an error: index null, no days', async () => {
  const site = await loadSite(emptyDir(), quiet);
  assert.equal(site.index, null);
  assert.ok(site.days instanceof Map);
  assert.equal(site.days.size, 0);
});

test('an unparsable index.json throws', async () => {
  const dir = artifactCopy();
  writeFileSync(join(dir, 'index.json'), '{"schema": 1,');
  await assert.rejects(loadSite(dir, quiet), /index\.json/);
});

test('an index.json of a newer schema throws "unsupported schema"', async () => {
  const dir = artifactCopy();
  writeJson(join(dir, 'index.json'), { ...clone(INDEX), schema: 2 });
  await assert.rejects(loadSite(dir, quiet), /unsupported schema/);
});

// ---------------------------------------------------------------- loadSite: files vs index

test('a listed day with no file throws', async () => {
  const dir = artifactCopy();
  unlinkSync(join(dir, 'days/2026-10-07.json'));
  await assert.rejects(loadSite(dir, quiet), /2026-10-07/);
});

test('a day file present but not listed is ignored with a warning', async () => {
  const dir = artifactCopy();
  writeJson(join(dir, 'days/2026-10-01.json'), { ...clone(DAY07), lagos_day: '2026-10-01' });
  const warnings = [];
  const site = await loadSite(dir, { warn: (m) => warnings.push(m) });
  assert.equal(site.days.has('2026-10-01'), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2026-10-01/);
});

test('a tampered day file (pick changed) fails with picks_hash mismatch', async () => {
  const dir = artifactCopy();
  const day = clone(DAY08);
  day.fixtures.find((f) => f.pick).pick.market = 'draw';
  writeJson(join(dir, 'days/2026-10-08.json'), day);
  await assert.rejects(loadSite(dir, quiet), /picks_hash mismatch 2026-10-08/);
});

test('a day whose stored picks_hash was re-forged to match its edit still fails against the index', async () => {
  const dir = artifactCopy();
  const day = clone(DAY08);
  const f = day.fixtures.find((x) => x.pick);
  f.pick.pct = 99;
  const { picksHash } = await import('../site/lib/hash.js');
  day.picks_hash = await picksHash(day.fixtures, nodeSha256);
  writeJson(join(dir, 'days/2026-10-08.json'), day);
  await assert.rejects(loadSite(dir, quiet), /picks_hash mismatch 2026-10-08/);
});

test('an index entry whose picks_hash disagrees with its day file fails', async () => {
  const dir = artifactCopy();
  const idx = clone(INDEX);
  idx.days[1].picks_hash = 'sha256:' + '0'.repeat(64);
  writeJson(join(dir, 'index.json'), idx);
  await assert.rejects(loadSite(dir, quiet), /picks_hash mismatch 2026-10-07/);
});

test('a day file whose lagos_day differs from its file name fails', async () => {
  const dir = artifactCopy();
  writeJson(join(dir, 'days/2026-10-07.json'), { ...clone(DAY07), lagos_day: '2026-10-06' });
  await assert.rejects(loadSite(dir, quiet), /lagos_day/);
});

test('a compacted day loads from days/<d>.min.json', async () => {
  const dir = artifactCopy();
  const { fixtures, pick_source, ...rest } = clone(DAY07);
  void fixtures; void pick_source;
  writeJson(join(dir, 'days/2026-10-07.min.json'), { schema: 1, lagos_day: rest.lagos_day, compacted: true,
    strategy: rest.strategy, picks_frozen_at: rest.picks_frozen_at, grades_as_of: rest.grades_as_of,
    prev_hash: rest.prev_hash, picks_hash: rest.picks_hash, counts: rest.counts, accuracy: rest.accuracy });
  unlinkSync(join(dir, 'days/2026-10-07.json'));
  const idx = clone(INDEX);
  idx.days[1].compacted = true;
  writeJson(join(dir, 'index.json'), idx);
  const site = await loadSite(dir, quiet);
  const d = site.days.get('2026-10-07');
  assert.equal(d.compacted, true);
  assert.equal(d.fixtures, undefined);
  assert.equal(d.picks_hash, DAY07.picks_hash);
});

test('a compacted day whose .min.json picks_hash disagrees with its index entry fails', async () => {
  const dir = artifactCopy();
  const { fixtures, pick_source, ...rest } = clone(DAY07);
  void fixtures; void pick_source;
  const forged = 'sha256:' + 'cd'.repeat(32);
  assert.notEqual(forged, INDEX.days[1].picks_hash);
  writeJson(join(dir, 'days/2026-10-07.min.json'), { schema: 1, lagos_day: rest.lagos_day, compacted: true,
    strategy: rest.strategy, picks_frozen_at: rest.picks_frozen_at, grades_as_of: rest.grades_as_of,
    prev_hash: rest.prev_hash, picks_hash: forged, counts: rest.counts, accuracy: rest.accuracy });
  unlinkSync(join(dir, 'days/2026-10-07.json'));
  const idx = clone(INDEX);
  idx.days[1].compacted = true;
  writeJson(join(dir, 'index.json'), idx);
  await assert.rejects(loadSite(dir, quiet), /picks_hash mismatch 2026-10-07/);
});

test('a compacted entry whose only file is the full one fails (wrong file for the entry)', async () => {
  const dir = artifactCopy();
  const idx = clone(INDEX);
  idx.days[1].compacted = true;
  writeJson(join(dir, 'index.json'), idx);
  await assert.rejects(loadSite(dir, quiet), /2026-10-07\.min\.json/);
});

test('a full entry pointing at a compacted file fails', async () => {
  const dir = artifactCopy();
  renameSync(join(dir, 'days/2026-10-07.json'), join(dir, 'days/2026-10-07.tmp'));
  writeJson(join(dir, 'days/2026-10-07.json'), { schema: 1, lagos_day: '2026-10-07', compacted: true,
    strategy: DAY07.strategy, picks_frozen_at: DAY07.picks_frozen_at, grades_as_of: DAY07.grades_as_of,
    prev_hash: DAY07.prev_hash, picks_hash: DAY07.picks_hash, counts: DAY07.counts, accuracy: DAY07.accuracy });
  await assert.rejects(loadSite(dir, quiet), /compacted/);
});

// ---------------------------------------------------------------- validateIndex

const badIndex = (mut) => { const o = clone(INDEX); mut(o); return o; };

test('validateIndex accepts the artifact index and drops unknown keys', () => {
  const o = clone(INDEX);
  o.surprise = '<script>';
  o.record.selection.extra = 1;
  o.days[0].secret = 'x';
  const v = validateIndex(o);
  assert.equal(v.surprise, undefined);
  assert.equal(v.record.selection.extra, undefined);
  assert.equal(v.days[0].secret, undefined);
  assert.equal(v.record.last_30.pct, 84.48);
  assert.deepEqual(v.record.last_30.status_days, { live: 7, provisional: 23 });
});

test('validateIndex accepts the legitimate nulls the publisher emits', () => {
  const o = clone(INDEX);
  o.record.as_of = null;
  o.record.selection.fallback_min_probability = null;
  o.record.last_6[5] = { period: '2026-10-02', won: 0, lost: 0, pushes: 0, graded: 0, finished_fixtures: 0,
    pct: null, coverage: null, status: null };
  o.record.last_30.status_days = []; // the publisher's JSON encoder writes an empty map as []
  o.record.selection.odds_filter = false;
  o.record.selection.min_odds = null;
  o.record.selection.max_odds = null;
  o.record.months[0].status = 'sealed_v2'; // a status this build does not know yet
  o.record.last_6[0].status = 'audit_hold';
  const v = validateIndex(o);
  assert.equal(v.record.last_6[5].status, null);
  assert.deepEqual(v.record.last_30.status_days, {});
  assert.equal(v.record.selection.min_odds, null);
  assert.equal(v.record.months[0].status, 'sealed_v2');
  const o2 = clone(INDEX);
  o2.record.last_30.status_days = { live: 3, future_status: 2 };
  assert.deepEqual(validateIndex(o2).record.last_30.status_days, { live: 3, future_status: 2 });
});

test('validateIndex rejects contract violations', () => {
  const cases = [
    ['schema 2', (o) => { o.schema = 2; }, /unsupported schema/],
    ['generated_at not ISO-Z', (o) => { o.generated_at = '2026-10-07 22:15:00'; }, /generated_at/],
    ['today not a real date', (o) => { o.today = '2026-02-30'; }, /today/],
    ['duplicate day', (o) => { o.days[1].day = o.days[0].day; }, /duplicate|newest first/],
    ['days not newest first', (o) => { o.days.reverse(); o.newest_day = o.days[0].day; }, /newest first/],
    ['newest_day disagrees with days[0]', (o) => { o.newest_day = '2026-10-07'; }, /newest_day/],
    ['compacted not bool', (o) => { o.days[0].compacted = 0; }, /compacted/],
    ['bad picks_hash', (o) => { o.days[0].picks_hash = 'md5:abc'; }, /picks_hash/],
    ['fixtures not integer', (o) => { o.days[0].fixtures = 1.5; }, /fixtures/],
    ['last_6 has 5 entries', (o) => { o.record.last_6.pop(); }, /last_6/],
    ['last_6 has 7 entries', (o) => { o.record.last_6.push(clone(o.record.last_6[0])); }, /last_6/],
    ['pct 0 without a denominator', (o) => { Object.assign(o.record.last_6[0], { won: 0, lost: 0, graded: 0, pct: 0 }); }, /pct/],
    ['pct null with a denominator', (o) => { o.record.months[0].pct = null; }, /pct/],
    ['coverage 0 without a denominator', (o) => { Object.assign(o.record.last_6[0], { finished_fixtures: 0, coverage: 0 }); }, /coverage/],
    ['pct as a string', (o) => { o.record.last_30.pct = '84.48'; }, /pct/],
    ['ledger status not a string', (o) => { o.record.months[0].status = 1; }, /status/],
    ['odds band null while the odds filter is on', (o) => { o.record.selection.min_odds = null; }, /min_odds/],
    ['month status null', (o) => { o.record.months[0].status = null; }, /status/],
    ['month period not a month', (o) => { o.record.months[0].period = '2026-13'; }, /period/],
    ['last_30 period malformed', (o) => { o.record.last_30.period = '2026-09-08'; }, /period/],
    ['status_days count not an integer', (o) => { o.record.last_30.status_days.live = '7'; }, /status_days/],
    ['status_days a non-empty list', (o) => { o.record.last_30.status_days = [7]; }, /status_days/],
    ['selection.odds_filter not bool', (o) => { o.record.selection.odds_filter = 1; }, /odds_filter/],
    ['effective_since_date invalid', (o) => { o.record.selection.effective_since_date = '2026-09-31'; }, /effective_since_date/],
    ['record missing', (o) => { delete o.record; }, /record/],
    ['days not an array', (o) => { o.days = {}; }, /days/],
    ['root not an object', () => {}, /object/],
  ];
  for (const [name, mut, re] of cases) {
    const o = name === 'root not an object' ? [] : badIndex(mut);
    assert.throws(() => validateIndex(o), re, name);
  }
});

// ---------------------------------------------------------------- validateDay

const picked = (day) => day.fixtures.findIndex((f) => f.pick !== null);
const unpicked = (day) => day.fixtures.findIndex((f) => f.pick === null);

test('validateDay accepts both artifact days and drops unknown keys', () => {
  const d = clone(DAY08);
  d.leak = 'x';
  d.fixtures[0].internal_note = 'x';
  d.fixtures[picked(d)].pick.model_score = 0.9;
  d.pick_source.debug = true;
  const v = validateDay(d, { expectDate: '2026-10-08' });
  assert.equal(v.leak, undefined);
  assert.equal(v.fixtures[0].internal_note, undefined);
  assert.equal(v.fixtures[picked(d)].pick.model_score, undefined);
  assert.equal(v.pick_source.debug, undefined);
  assert.equal(v.fixtures.length, 130);
  validateDay(clone(DAY07), { expectDate: '2026-10-07' });
});

test('validateDay accepts withdrawn rows, a null price/pct/why and a null prev_hash', () => {
  const d = clone(DAY07);
  const i = picked(d);
  Object.assign(d.fixtures[i], { withdrawn: true, grade: 'withdrawn' });
  Object.assign(d.fixtures[i].pick, { price: null, pct: null, why: null });
  const j = unpicked(d);
  Object.assign(d.fixtures[j], { withdrawn: true, grade: null });
  d.prev_hash = null;
  d.pick_source.ledger_match_rate = null;
  const v = validateDay(d, { expectDate: '2026-10-07' });
  assert.equal(v.fixtures[i].withdrawn, true);
  assert.equal(v.fixtures[i].pick.price, null);
});

test('validateDay rejects contract violations', () => {
  const cases = [
    ['schema 2', (d) => { d.schema = 2; }, /unsupported schema/],
    ['lagos_day not a real date', (d) => { d.lagos_day = '2026-02-30'; }, /lagos_day/],
    ['picks_frozen_at not ISO-Z', (d) => { d.picks_frozen_at = '2026-10-07T22:15:00.000Z'; }, /picks_frozen_at/],
    ['prev_hash malformed', (d) => { d.prev_hash = 'sha256:XYZ'; }, /prev_hash/],
    ['counts.fixtures disagrees', (d) => { d.counts.fixtures += 1; }, /counts\.fixtures/],
    ['accuracy pct 0 with graded 0', (d) => { d.accuracy.pct = 0; }, /pct/],
    ['pick_source.ledger_match_n not int', (d) => { d.pick_source.ledger_match_n = '129'; }, /ledger_match_n/],
    ['fixtures missing', (d) => { delete d.fixtures; }, /fixtures/],
    ['duplicate fx', (d) => { d.fixtures[1].fx = d.fixtures[0].fx; }, /duplicate fx/],
    ['non-integer fx', (d) => { d.fixtures[0].fx = 1.5; }, /fx/],
    ['ko not ISO-Z', (d) => { d.fixtures[0].ko = '2026-10-07T23:00:00+01:00'; }, /ko/],
    ['home not a string', (d) => { d.fixtures[0].home = null; }, /home/],
    ['status not a string', (d) => { d.fixtures[0].status = 1; }, /status/],
    ['grade outside its set', (d) => { d.fixtures[picked(d)].grade = 'maybe'; }, /grade/],
    ['no pick but graded', (d) => { d.fixtures[unpicked(d)].grade = 'pending'; }, /grade/],
    ['pick but grade null', (d) => { d.fixtures[picked(d)].grade = null; }, /grade/],
    ['grade withdrawn on a live row', (d) => { d.fixtures[picked(d)].grade = 'withdrawn'; }, /withdrawn/],
    // The publisher nulls grade exactly when pick is null on EVERY row (its grading step).
    ['withdrawn row with a pick but grade null', (d) => { Object.assign(d.fixtures[picked(d)], { withdrawn: true, grade: null }); }, /grade/],
    ['withdrawn row with no pick but a grade', (d) => { Object.assign(d.fixtures[unpicked(d)], { withdrawn: true, grade: 'withdrawn' }); }, /grade/],
    ['late row with a pick', (d) => { d.fixtures[picked(d)].late = true; }, /late/],
    ['pick without frozen_at', (d) => { d.fixtures[picked(d)].frozen_at = null; }, /frozen_at/],
    ['pre_ko not bool', (d) => { d.fixtures[0].pre_ko = 'true'; }, /pre_ko/],
    ['pick.market empty', (d) => { d.fixtures[picked(d)].pick.market = ''; }, /market/],
    ['pick.pct not integer', (d) => { d.fixtures[picked(d)].pick.pct = 88.5; }, /pct/],
    ['pick.price a string', (d) => { d.fixtures[picked(d)].pick.price = '1.20'; }, /price/],
    ['pick.price_est missing', (d) => { delete d.fixtures[picked(d)].pick.price_est; }, /price_est/],
    ['pick an array', (d) => { d.fixtures[picked(d)].pick = []; }, /pick/],
  ];
  for (const [name, mut, re] of cases) {
    const d = clone(DAY08);
    mut(d);
    assert.throws(() => validateDay(d, { expectDate: '2026-10-08' }), re, name);
  }
});

test('validateDay accepts a day with zero fixtures', () => {
  const d = clone(DAY08);
  d.fixtures = [];
  Object.assign(d.counts, { fixtures: 0, priced: 0, recommended: 0 });
  assert.deepEqual(validateDay(d, { expectDate: '2026-10-08' }).fixtures, []);
});

test('validateDay accepts an out-of-range pct and a zero price (types are right; renderers escape)', () => {
  const d = clone(DAY08);
  Object.assign(d.fixtures[picked(d)].pick, { pct: 101, price: 0, label: null });
  const v = validateDay(d, { expectDate: '2026-10-08' });
  assert.equal(v.fixtures[picked(d)].pick.pct, 101);
  assert.equal(v.fixtures[picked(d)].pick.label, null);
});

test('validateDay enforces expectDate', () => {
  assert.throws(() => validateDay(clone(DAY08), { expectDate: '2026-10-07' }), /lagos_day/);
});

test('validateDay accepts a compacted summary and never returns fixtures for it', () => {
  const { fixtures, pick_source, ...rest } = clone(DAY07);
  void pick_source;
  const v = validateDay({ ...rest, compacted: true, fixtures }, { expectDate: '2026-10-07' });
  assert.equal(v.compacted, true);
  assert.equal(v.fixtures, undefined);
  assert.equal(v.pick_source, undefined);
});

test('nodeSha256 is lowercase hex SHA-256 of the UTF-8 bytes', async () => {
  assert.equal(nodeSha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  // Non-ASCII: cross-check against WebCrypto over explicit UTF-8 bytes.
  const s = 'São Paulo 😀';
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  assert.equal(nodeSha256(s), [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''));
});

// ---------------------------------------------------------------- spec §16: scores, accuracy rule 2

// The publisher's real 2026-10-08 file with accuracy_rule 2, scores on finished rows, a late row
// that carries a pick (558451) and a picked row with pre_ko false (558454). Only fields outside
// picks_hash differ from the published file, so the receipt still recomputes.
const RULE2 = readJson(fileURLToPath(new URL('./fixtures/rule2-day.json', import.meta.url)));
const at = (d, fx) => d.fixtures.find((f) => f.fx === fx);

test('rule-2 fixture premise: hash recomputes, a late row with a pick, scores on finished rows', async () => {
  const { picksHash } = await import('../site/lib/hash.js');
  assert.equal(await picksHash(RULE2.fixtures, nodeSha256), RULE2.picks_hash);
  assert.equal(RULE2.accuracy_rule, 2);
  assert.ok(at(RULE2, 558451).late && at(RULE2, 558451).pick !== null);
  assert.equal(at(RULE2, 558454).pre_ko, false);
  assert.ok(RULE2.fixtures.some((f) => f.score !== null && f.status === 'PEN'));
});

test('validateDay: old files carry no score / accuracy_rule -> rule 1, score null', () => {
  for (const [raw, d] of [[DAY07, '2026-10-07'], [DAY08, '2026-10-08']]) {
    assert.ok(!('accuracy_rule' in raw) && !raw.fixtures.some((f) => 'score' in f), 'premise: an old file');
    const v = validateDay(clone(raw), { expectDate: d });
    assert.equal(v.accuracy_rule, 1);
    assert.ok(v.fixtures.every((f) => f.score === null));
  }
});

test('validateDay: a rule-2 file keeps its rule, its scores (allowlisted) and its late picked row', () => {
  const raw = clone(RULE2);
  const pen = raw.fixtures.find((f) => f.status === 'PEN');
  pen.score.extra = 'x';
  const v = validateDay(raw, { expectDate: '2026-10-08' });
  assert.equal(v.accuracy_rule, 2);
  const vp = v.fixtures.find((f) => f.fx === pen.fx);
  assert.deepEqual(vp.score, { home: pen.score.home, away: pen.score.away, pen_home: 4, pen_away: 3 });
  const ft = v.fixtures.find((f) => f.status === 'FT' && f.score !== null);
  assert.equal(ft.score.pen_home, null);
  assert.equal(at(v, 558451).late, true);
  assert.notEqual(at(v, 558451).pick, null);
  assert.equal(v.fixtures.filter((f) => f.score !== null).length, RULE2.fixtures.filter((f) => f.score !== null).length);
});

test('validateDay: a malformed score throws', () => {
  const fx = RULE2.fixtures.find((f) => f.score !== null).fx;
  const cases = [
    ['string home', (s) => { s.home = '1'; }],
    ['negative away', (s) => { s.away = -1; }],
    ['float home', (s) => { s.home = 1.5; }],
    ['null home', (s) => { s.home = null; }],
    ['missing away', (s) => { delete s.away; }],
    ['missing pen_home', (s) => { delete s.pen_home; }],
    ['pen string', (s) => { s.pen_home = '4'; }],
    ['pen negative', (s) => { s.pen_away = -3; }],
    ['pen float', (s) => { s.pen_home = 4.5; }],
    ['pen boolean', (s) => { s.pen_home = true; }],
  ];
  for (const [name, mut] of cases) {
    const d = clone(RULE2);
    mut(at(d, fx).score);
    assert.throws(() => validateDay(d, { expectDate: '2026-10-08' }), /score/, name);
  }
  for (const bad of [0, 'FT 2-1', [], [2, 1], true]) {
    const d = clone(RULE2);
    at(d, fx).score = bad;
    assert.throws(() => validateDay(d, { expectDate: '2026-10-08' }), /score/, JSON.stringify(bad));
  }
  // and the legitimate shapes pass
  const ok = clone(RULE2);
  at(ok, fx).score = { home: 0, away: 0, pen_home: 0, pen_away: null };
  assert.deepEqual(at(validateDay(ok, { expectDate: '2026-10-08' }), fx).score, { home: 0, away: 0, pen_home: 0, pen_away: null });
});

test('validateDay: accuracy_rule is absent, 1 or 2 — anything else throws', () => {
  for (const rule of [1, 2]) {
    const d = clone(DAY08);
    d.accuracy_rule = rule;
    assert.equal(validateDay(d, { expectDate: '2026-10-08' }).accuracy_rule, rule);
  }
  for (const bad of [0, 3, '2', null, 1.5, true, []]) {
    const d = clone(RULE2);
    d.accuracy_rule = bad;
    assert.throws(() => validateDay(d, { expectDate: '2026-10-08' }), /accuracy_rule/, JSON.stringify(bad));
  }
});

test('validateDay: a late row with a pick is allowed under rule 2 only', () => {
  assert.doesNotThrow(() => validateDay(clone(RULE2), { expectDate: '2026-10-08' }));
  const r1 = clone(RULE2);
  delete r1.accuracy_rule;
  assert.throws(() => validateDay(r1, { expectDate: '2026-10-08' }), /late/);
  const explicit1 = clone(RULE2);
  explicit1.accuracy_rule = 1;
  assert.throws(() => validateDay(explicit1, { expectDate: '2026-10-08' }), /late/);
});

test('validateDay: a compacted summary carries its accuracy_rule (absent -> 1; bad -> throws)', () => {
  const { fixtures, pick_source, ...rest } = clone(RULE2);
  void fixtures; void pick_source;
  assert.equal(validateDay({ ...rest, compacted: true }, { expectDate: '2026-10-08' }).accuracy_rule, 2);
  const { accuracy_rule, ...old } = rest;
  void accuracy_rule;
  assert.equal(validateDay({ ...old, compacted: true }, { expectDate: '2026-10-08' }).accuracy_rule, 1);
  assert.throws(() => validateDay({ ...rest, accuracy_rule: 7, compacted: true }, { expectDate: '2026-10-08' }), /accuracy_rule/);
});

test('loadSite: a full day whose index accuracy differs from its file throws (strict, every field)', async () => {
  const fields = {
    won: (a) => { a.won += 1; },
    lost: (a) => { a.lost += 1; },
    pushes: (a) => { a.pushes += 1; },
    graded: (a) => { a.graded += 1; },
    pct: (a) => { a.pct = 50; },
  };
  for (const [name, mut] of Object.entries(fields)) {
    const dir = artifactCopy();
    const idx = clone(INDEX);
    const e = idx.days.find((x) => x.day === '2026-10-08');
    // a self-consistent index entry (so validateIndex passes) that disagrees with the day file
    Object.assign(e.accuracy, { won: 3, lost: 1, pushes: 0, graded: 4, pct: 75 });
    mut(e.accuracy);
    writeJson(join(dir, 'index.json'), idx);
    await assert.rejects(loadSite(dir, quiet), /accuracy mismatch 2026-10-08/, name);
  }
  // equal accuracy loads (premise: the check does not reject the artifact itself)
  await assert.doesNotReject(loadSite(artifactCopy(), quiet));
});

test('loadSite: a rule-2 day loads and its index entry must match its accuracy', async () => {
  const dir = artifactCopy();
  writeJson(join(dir, 'days/2026-10-08.json'), RULE2);
  const idx = clone(INDEX);
  const e = idx.days.find((x) => x.day === '2026-10-08');
  Object.assign(e, { picks_hash: RULE2.picks_hash, fixtures: RULE2.fixtures.length, accuracy: clone(RULE2.accuracy) });
  writeJson(join(dir, 'index.json'), idx);
  const site = await loadSite(dir, quiet);
  assert.equal(site.days.get('2026-10-08').accuracy_rule, 2);
  e.accuracy.won -= 1;
  e.accuracy.graded -= 1;
  e.accuracy.pct = Math.round((10000 * e.accuracy.won) / e.accuracy.graded) / 100;
  writeJson(join(dir, 'index.json'), idx);
  await assert.rejects(loadSite(dir, quiet), /accuracy mismatch 2026-10-08/);
});
