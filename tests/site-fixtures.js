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
 * The day-pill window (spec §17.1) over a full week: the fixture artifact plus its archive, with
 * compacted days 2026-10-02..05 (index.today stays 2026-10-07, so the listed days are D-5..D+1):
 *   10-02, 10-03  graded (outside the window: D-5, D-4)
 *   10-04         a perfect day (12 of 12)
 *   10-05         nothing graded (2 pushes)
 *   10-06         the edge day (2 of 3)
 *   10-07         today: ungraded as in the fixture, or with `today` = { won, lost }: its first won + lost
 *                 counted picks graded (grades are outside picks_hash) and the accuracy set to match
 *   10-08         tomorrow (130 fixtures)
 * `drop` removes days from the index (their files stay, unlisted). Returns the written index.
 */
export const PILL_DAYS = Object.freeze({
  '2026-10-02': { fixtures: 70, accuracy: { won: 50, lost: 10, pushes: 0, graded: 60, pct: 83.33 } },
  '2026-10-03': { fixtures: 64, accuracy: { won: 40, lost: 9, pushes: 1, graded: 49, pct: 81.63 } },
  '2026-10-04': { fixtures: 40, accuracy: { won: 12, lost: 0, pushes: 1, graded: 12, pct: 100 } },
  '2026-10-05': { fixtures: 88, accuracy: { won: 0, lost: 0, pushes: 2, graded: 0, pct: null } },
});
export async function pillArtifact(root, { drop = [], today = null } = {}) {
  await copyArtifact(root);
  await addArchive(root);
  const index = await readJson(join(root, 'index.json'));
  for (const [day, { fixtures, accuracy }] of Object.entries(PILL_DAYS)) {
    const hash = `sha256:${day.slice(-1).repeat(64)}`;
    await writeJson(join(root, 'days', `${day}.min.json`), {
      schema: 1, lagos_day: day, compacted: true, strategy: 'edge_reliability',
      picks_frozen_at: '2026-10-01T22:15:00Z', grades_as_of: '2026-10-07T03:00:00Z', prev_hash: null, picks_hash: hash,
      counts: { fixtures, priced: fixtures, recommended: 30, markets_per_fixture: 92 }, accuracy,
    });
    index.days = index.days.filter((e) => e.day !== day);
    index.days.push({ day, compacted: true, picks_hash: hash, fixtures, accuracy });
  }
  if (today) {
    const p = join(root, 'days', '2026-10-07.json');
    const file = await readJson(p);
    const counted = file.fixtures.filter((f) => f.pick && f.pre_ko && !f.withdrawn && Number.isInteger(f.pick.pct));
    if (counted.length < today.won + today.lost) throw new Error('pillArtifact: not enough counted picks to grade');
    counted.slice(0, today.won).forEach((f) => { f.grade = 'won'; });
    counted.slice(today.won, today.won + today.lost).forEach((f) => { f.grade = 'lost'; });
    const graded = today.won + today.lost;
    file.accuracy = { won: today.won, lost: today.lost, pushes: 0, graded, pct: Math.round((10000 * today.won) / graded) / 100 };
    await writeJson(p, file);
    index.days.find((e) => e.day === '2026-10-07').accuracy = file.accuracy;
  }
  index.days = index.days.filter((e) => !drop.includes(e.day)).sort((a, b) => (a.day < b.day ? 1 : -1));
  index.newest_day = index.days[0].day;
  await writeJson(join(root, 'index.json'), index);
  return index;
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

// ------------------------------------------------------------------ large counts (thousands separators)

const letters = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

/**
 * A raw day of `rows` pick-less fixtures in `comps` competitions plus `withdrawn` withdrawn rows:
 * large counts with nothing graded (so the ring needs no recount). Names carry letters only.
 */
export function syntheticDay({ rows, comps = 1, withdrawn = 0, day = '2026-10-06' }) {
  const fixtures = [];
  for (let i = 0; i < rows + withdrawn; i++) {
    fixtures.push({
      fx: 5000000 + i, api_fx: 7000000 + i, ko: `${day}T12:00:00Z`, comp: `League ${letters(i % comps)}`,
      home: `Home ${letters(i)}`, away: `Away ${letters(i)}`, home_id: 100000 + i, away_id: 300000 + i, status: 'NS',
      pick: null, frozen_at: null, pre_ko: true, withdrawn: i >= rows, grade: null,
    });
  }
  return {
    schema: 1, lagos_day: day, strategy: 'edge_reliability', accuracy_rule: 2,
    picks_frozen_at: `${day}T00:00:00Z`, grades_as_of: `${day}T00:00:00Z`, prev_hash: null, picks_hash: `sha256:${'b'.repeat(64)}`,
    counts: { fixtures: fixtures.length, priced: 0, recommended: 0, markets_per_fixture: 92 },
    accuracy: { won: 0, lost: 0, pushes: 0, graded: 0, pct: null },
    pick_source: { strategy: 'edge_reliability', fallback: 'none', ledger_match_rate: null, ledger_match_n: 0, ledger_match_matched: 0, ledger_match_served_n: 0, ledger_match_unserved: 0 },
    fixtures,
  };
}

/** The figures bigArtifact() publishes, for the tests to derive their expectations from. */
export const BIG = Object.freeze({
  times: 24, // the rule-2 fixture day, 24 times over, is the home card
  d5: { day: '2026-10-05', fixtures: 1534, accuracy: { won: 1131, lost: 177, pushes: 50, graded: 1308, pct: 86.47 } },
  d6: { day: '2026-10-06', fixtures: 12345, accuracy: { won: 10081, lost: 2073, pushes: 1234, graded: 12154, pct: 82.94 } },
});

/**
 * An artifact whose every count runs to four or five digits: today (2026-10-08) is the rule-2 fixture
 * day repeated BIG.times over (its picks_hash recomputed), and 2026-10-05 / 2026-10-06 are compacted
 * days with the BIG.d5 / BIG.d6 figures. Returns the home day as written.
 */
export async function bigArtifact(root) {
  await copyArtifact(root);
  const r2 = await readJson(fileURLToPath(new URL('./fixtures/rule2-day.json', import.meta.url)));
  const k = BIG.times;
  const fixtures = [];
  for (let i = 0; i < k; i++) for (const f of r2.fixtures) fixtures.push({ ...structuredClone(f), fx: f.fx + i * 10000000, api_fx: f.api_fx + i * 10000000 });
  const a = r2.accuracy;
  const ps = r2.pick_source;
  const home = {
    ...r2,
    fixtures,
    counts: { ...r2.counts, fixtures: fixtures.length, priced: r2.counts.priced * k, recommended: r2.counts.recommended * k },
    accuracy: { won: a.won * k, lost: a.lost * k, pushes: a.pushes * k, graded: a.graded * k, pct: a.pct },
    pick_source: { ...ps, ledger_match_n: ps.ledger_match_n * k, ledger_match_matched: ps.ledger_match_matched * k, ledger_match_served_n: ps.ledger_match_served_n * k, ledger_match_unserved: ps.ledger_match_unserved * k },
  };
  home.picks_hash = await picksHash(home.fixtures, nodeSha256);
  await writeJson(join(root, 'days/2026-10-08.json'), home);
  const index = await readJson(join(root, 'index.json'));
  index.today = '2026-10-08';
  Object.assign(index.days.find((d) => d.day === '2026-10-08'), { picks_hash: home.picks_hash, fixtures: fixtures.length, accuracy: home.accuracy });
  for (const [n, d] of [['6', BIG.d6], ['5', BIG.d5]]) { // index.days is newest first
    const min = {
      schema: 1, lagos_day: d.day, compacted: true, strategy: 'edge_reliability', accuracy_rule: 2,
      picks_frozen_at: '2026-10-04T22:15:00Z', grades_as_of: '2026-10-07T03:00:00Z', prev_hash: null,
      picks_hash: `sha256:${n.repeat(64)}`,
      counts: { fixtures: d.fixtures, priced: d.fixtures, recommended: d.accuracy.graded + d.accuracy.pushes, markets_per_fixture: 92 },
      accuracy: d.accuracy,
    };
    await writeJson(join(root, 'days', `${d.day}.min.json`), min);
    index.days.push({ day: d.day, compacted: true, picks_hash: min.picks_hash, fixtures: d.fixtures, accuracy: d.accuracy });
  }
  await writeJson(join(root, 'index.json'), index);
  return home;
}
