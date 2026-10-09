// Shared helpers for the build tests (tests/build.test.js, tests/claims.test.js): a filled test
// operator config, temp copies of the fixture artifact with mutations, and a dist snapshot.
// Nothing here spawns a process: the tests import build() and call it.

import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { picksHash } from '../site/lib/hash.js';
import { nodeSha256 } from '../site/lib/data.js';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ARTIFACT = fileURLToPath(new URL('./fixtures/artifact/', import.meta.url));
export const EDGE_DAY = fileURLToPath(new URL('./fixtures/edge-day.json', import.meta.url));

/** A complete operator config (the real site/config.js has the operator fields null until launch). */
export function testConfig(over = {}) {
  return {
    origin: 'https://betgaffer.com',
    repo: 'geezerz/betgaffer-site',
    brand: 'Bet Gaffer',
    descriptor: 'football match intelligence',
    operator: {
      legal_name: 'Example Media Ltd',
      trading_name: 'Bet Gaffer',
      address: '1 Example Road, Ikeja, Lagos',
      rc_number: 'RC1234567',
      contact_email: 'hello@example.com',
      privacy_email: 'privacy@example.com',
      mailbox_provider: null,
    },
    waitlist_places: 500,
    pricing: { show_prices: false, currency: 'NGN', tiers: [] },
    stale_after_hours: 6,
    ...over,
  };
}

/**
 * A fresh temp workspace: { dir, root, out, cleanup }. `dir` gets a {"type":"module"} package.json
 * so a test can import the built browser modules from `out` as ES modules.
 */
export async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'bg-build-'));
  await writeFile(join(dir, 'package.json'), '{"type":"module"}\n');
  const root = join(dir, 'root');
  await mkdir(root);
  return { dir, root, out: join(dir, 'dist'), cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 5 }) };
}

export const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
export const writeJson = (p, v) => writeFile(p, `${JSON.stringify(v, null, 2)}\n`);

/** Copy the fixture artifact (index.json + days/) into root. */
export async function copyArtifact(root) {
  await cp(ARTIFACT, root, { recursive: true });
}

/** Recompute the day file's picks_hash and set it on the file and its index entry. */
export async function rehash(root, date) {
  const file = join(root, 'days', `${date}.json`);
  const day = await readJson(file);
  day.picks_hash = await picksHash(day.fixtures, nodeSha256);
  await writeJson(file, day);
  const index = await readJson(join(root, 'index.json'));
  const e = index.days.find((d) => d.day === date);
  if (e) e.picks_hash = day.picks_hash;
  await writeJson(join(root, 'index.json'), index);
  return day.picks_hash;
}

/**
 * Add an archive: the edge-case day as a full 2026-10-06 (every row state, a graded ring) and a
 * compacted 2026-10-05. index.today stays 2026-10-07, so both render as archive stubs.
 */
export async function addArchive(root) {
  const edge = await readJson(EDGE_DAY);
  await writeJson(join(root, 'days', '2026-10-06.json'), edge);
  const min = {
    schema: 1,
    lagos_day: '2026-10-05',
    compacted: true,
    strategy: 'edge_reliability',
    picks_frozen_at: '2026-10-04T22:15:00Z',
    grades_as_of: '2026-10-06T03:00:00Z',
    prev_hash: null,
    picks_hash: `sha256:${'a'.repeat(64)}`,
    counts: { fixtures: 88, priced: 88, recommended: 40, markets_per_fixture: 92 },
    accuracy: { won: 30, lost: 6, pushes: 2, graded: 36, pct: 83.33 },
  };
  await writeJson(join(root, 'days', '2026-10-05.min.json'), min);
  const index = await readJson(join(root, 'index.json'));
  index.days.push(
    { day: '2026-10-06', compacted: false, picks_hash: edge.picks_hash, fixtures: edge.fixtures.length, accuracy: edge.accuracy },
    { day: '2026-10-05', compacted: true, picks_hash: min.picks_hash, fixtures: 88, accuracy: min.accuracy },
  );
  await writeJson(join(root, 'index.json'), index);
}

/**
 * Spec §17.5: the raw index `record` with `last_7` (seven days, newest first) in place of the legacy
 * `last_6`: the six fixture days plus the day before the oldest. Mutates and returns `record`.
 */
export function toLast7(record) {
  const six = record.last_6;
  const oldest = six[six.length - 1].period;
  const before = new Date(Date.parse(`${oldest}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const won = 75;
  const graded = 90;
  const ff = 101;
  record.last_7 = [...six, {
    period: before, won, lost: graded - won, pushes: 3, graded, finished_fixtures: ff,
    pct: Math.round((won / graded) * 10000) / 100, coverage: Math.round((graded / ff) * 10000) / 10000, status: 'live',
  }];
  delete record.last_6;
  return record;
}

/** Every file under dir -> sha256 of its bytes, keyed by forward-slash relative path. */
export async function snapshot(dir) {
  const out = {};
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out[relative(dir, p).split('\\').join('/')] = createHash('sha256').update(await readFile(p)).digest('hex');
    }
  };
  await walk(dir);
  return out;
}

/** Every built HTML file: [{ rel, html }]. */
export async function htmlFiles(out) {
  const snap = await snapshot(out);
  const rels = Object.keys(snap).filter((r) => r.endsWith('.html')).sort();
  return Promise.all(rels.map(async (rel) => ({ rel, html: await readFile(join(out, rel), 'utf8') })));
}
