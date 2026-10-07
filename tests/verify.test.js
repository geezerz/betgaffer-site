// verifyDir is called in-process — never spawn `node site/verify.js` (no-console-window rule).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDir } from '../site/verify.js';
import { picksHash } from '../site/lib/hash.js';
import { nodeSha256 } from '../site/lib/data.js';

const ART = fileURLToPath(new URL('./fixtures/artifact/', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const H07 = readJson(join(ART, 'days/2026-10-07.json')).picks_hash;
const H08 = readJson(join(ART, 'days/2026-10-08.json')).picks_hash;

const tmpRoots = [];
after(() => { for (const d of tmpRoots) rmSync(d, { recursive: true, force: true }); });
function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'bg-verify-'));
  tmpRoots.push(dir);
  cpSync(ART, dir, { recursive: true });
  return dir;
}

test('verifies every full day file of the fixture artifact', async () => {
  const r = await verifyDir(ART);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, [`OK 2026-10-07 ${H07}`, `OK 2026-10-08 ${H08}`]);
});

test('a tampered day file is reported as MISMATCH and fails the run', async () => {
  const dir = copy();
  const p = join(dir, 'days/2026-10-08.json');
  const day = readJson(p);
  day.fixtures.find((f) => f.pick).pick.label = 'Away Win';
  writeFileSync(p, JSON.stringify(day, null, 4) + '\n');
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  // Its own picks_hash no longer recomputes, and neither does the index's.
  assert.deepEqual(r.lines, [`OK 2026-10-07 ${H07}`, 'MISMATCH 2026-10-08', 'MISMATCH 2026-10-08 (index disagrees)']);
});

test('an unreadable day file fails the run with a MISMATCH line', async () => {
  const dir = copy();
  writeFileSync(join(dir, 'days/2026-10-08.json'), '{ not json');
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  assert.match(r.lines[1], /^MISMATCH 2026-10-08 \(/);
});

test('a day file whose lagos_day is not its file name fails', async () => {
  const dir = copy();
  writeFileSync(join(dir, 'days/2026-10-09.json'), readFileSync(join(ART, 'days/2026-10-08.json')));
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  assert.match(r.lines[2], /^MISMATCH 2026-10-09 \(.*lagos_day/);
});

test('compacted .min.json summaries are skipped (no fixtures to hash)', async () => {
  const dir = copy();
  writeFileSync(join(dir, 'days/2026-07-01.min.json'), JSON.stringify({ schema: 1, lagos_day: '2026-07-01', compacted: true }));
  const r = await verifyDir(dir);
  assert.equal(r.ok, true);
  assert.equal(r.lines.length, 2);
});

/** Copy the artifact and add a compacted 2026-10-06 (summary file + index entry). */
function withCompacted({ summaryHash, writeSummary = true } = {}) {
  const dir = copy();
  const src = readJson(join(ART, 'days/2026-10-07.json'));
  const hash = 'sha256:' + 'ab'.repeat(32);
  if (writeSummary) {
    writeFileSync(join(dir, 'days/2026-10-06.min.json'), JSON.stringify({
      schema: 1, lagos_day: '2026-10-06', compacted: true, strategy: src.strategy,
      picks_frozen_at: '2026-10-05T22:15:00Z', grades_as_of: '2026-10-06T22:15:00Z', prev_hash: null,
      picks_hash: summaryHash ?? hash, counts: src.counts, accuracy: src.accuracy,
    }, null, 4) + '\n');
  }
  const idx = readJson(join(dir, 'index.json'));
  idx.days.push({ day: '2026-10-06', compacted: true, picks_hash: hash, fixtures: src.counts.fixtures, accuracy: src.accuracy });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(idx, null, 4) + '\n');
  return { dir, hash };
}

test('a compacted index entry is checked against its .min.json picks_hash', async () => {
  const { dir, hash } = withCompacted();
  const r = await verifyDir(dir);
  assert.equal(r.ok, true);
  assert.equal(r.lines.length, 3);
  assert.equal(r.lines[0], `OK 2026-10-07 ${H07}`);
  assert.equal(r.lines[1], `OK 2026-10-08 ${H08}`);
  assert.match(r.lines[2], new RegExp(`^OK 2026-10-06 ${hash} `));
});

test('a compacted entry whose .min.json disagrees with the index fails', async () => {
  const { dir } = withCompacted({ summaryHash: 'sha256:' + 'cd'.repeat(32) });
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  assert.match(r.lines[2], /^MISMATCH 2026-10-06 \(/);
});

test('a compacted entry with no .min.json fails', async () => {
  const { dir } = withCompacted({ writeSummary: false });
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  assert.match(r.lines[2], /^MISMATCH 2026-10-06 \(.*missing/);
});

test('a full day listed in index.json whose file is missing fails', async () => {
  const dir = copy();
  unlinkSync(join(dir, 'days/2026-10-07.json'));
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, [`OK 2026-10-08 ${H08}`, 'MISMATCH 2026-10-07 (listed but missing)']);
});

test('a re-forged day file (self-consistent hash) that disagrees with index.json fails', async () => {
  const dir = copy();
  const p = join(dir, 'days/2026-10-08.json');
  const day = readJson(p);
  day.fixtures.find((f) => f.pick).pick.pct = 99;
  day.picks_hash = await picksHash(day.fixtures, nodeSha256);
  assert.notEqual(day.picks_hash, H08);
  writeFileSync(p, JSON.stringify(day, null, 4) + '\n');
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, [`OK 2026-10-07 ${H07}`, `OK 2026-10-08 ${day.picks_hash}`,
    'MISMATCH 2026-10-08 (index disagrees)']);
});

test('an index entry whose picks_hash was edited (day file untouched) fails', async () => {
  const dir = copy();
  const idx = readJson(join(dir, 'index.json'));
  idx.days.find((e) => e.day === '2026-10-07').picks_hash = 'sha256:' + '0'.repeat(64);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(idx, null, 4) + '\n');
  const r = await verifyDir(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, [`OK 2026-10-07 ${H07}`, `OK 2026-10-08 ${H08}`, 'MISMATCH 2026-10-07 (index disagrees)']);
});

test('a malformed index.json days entry fails rather than being skipped', async () => {
  for (const bad of [{ day: '../index', compacted: false, picks_hash: H07 }, { day: '2026-10-05', compacted: 'no' }, null]) {
    const dir = copy();
    const idx = readJson(join(dir, 'index.json'));
    idx.days.push(bad);
    writeFileSync(join(dir, 'index.json'), JSON.stringify(idx, null, 4) + '\n');
    const r = await verifyDir(dir);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.lines.at(-1), /^MISMATCH index\.json \(days\[2\] is malformed\)$/, JSON.stringify(bad));
  }
});

test('a directory with no day files verifies nothing and says so via an empty line list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bg-verify-empty-'));
  tmpRoots.push(dir);
  assert.deepEqual(await verifyDir(dir), { ok: true, lines: [] });
  mkdirSync(join(dir, 'days'));
  assert.deepEqual(await verifyDir(dir), { ok: true, lines: [] });
});
