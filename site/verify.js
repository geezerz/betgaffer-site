// Public verifier: recompute every published picks_hash, no publisher code needed (plan S6).
//
//   node site/verify.js [dir]      (dir defaults to the repository root)
//
// Checks every full day file `days/<d>.json`: its fixtures must hash to its own picks_hash and its
// lagos_day must match its file name. When index.json is present, every full (compacted:false)
// entry's day file must exist and recompute to the index's picks_hash. Compacted
// `days/<d>.min.json` summaries carry no fixtures, so they cannot be recomputed here; each
// compacted entry's picks_hash must equal the one in its .min.json (the full file stays in git
// history, where `git show <commit>:days/<d>.json` recovers it for a full check). A malformed
// days entry fails the run rather than being skipped.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { picksHash } from './lib/hash.js';
import { nodeSha256 } from './lib/data.js';

const FULL_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readJsonOrNull(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  return JSON.parse(raw);
}

/** Returns { line, hash } — hash is the recomputed picks_hash, or null when it could not be computed. */
async function checkFull(dir, name, date) {
  try {
    const day = JSON.parse(await readFile(join(dir, 'days', name), 'utf8'));
    if (day === null || typeof day !== 'object') return { line: `MISMATCH ${date} (not a JSON object)`, hash: null };
    if (day.lagos_day !== date) return { line: `MISMATCH ${date} (lagos_day is ${JSON.stringify(day.lagos_day)})`, hash: null };
    const h = await picksHash(day.fixtures, nodeSha256);
    return { line: h === day.picks_hash ? `OK ${date} ${h}` : `MISMATCH ${date}`, hash: h };
  } catch (e) {
    return { line: `MISMATCH ${date} (${e.message})`, hash: null };
  }
}

/**
 * A full (compacted:false) index entry: its days/<d>.json must exist and recompute to the index's
 * picks_hash. A file that exists but could not be hashed is already reported by checkFull.
 */
function checkFullEntry(entry, names, recomputed) {
  const date = entry.day;
  if (!names.has(`${date}.json`)) return `MISMATCH ${date} (listed but missing)`;
  const h = recomputed.get(date);
  if (h === undefined || h === null) return null;
  return h === entry.picks_hash ? null : `MISMATCH ${date} (index disagrees)`;
}

const isEntry = (e) => e !== null && typeof e === 'object' && typeof e.day === 'string'
  && DATE_RE.test(e.day) && typeof e.compacted === 'boolean';

async function checkCompacted(dir, entry) {
  const date = entry.day;
  try {
    const min = await readJsonOrNull(join(dir, 'days', `${date}.min.json`));
    if (min === null) return `MISMATCH ${date} (compacted in index.json but days/${date}.min.json is missing)`;
    if (min.picks_hash !== entry.picks_hash) return `MISMATCH ${date} (index.json and days/${date}.min.json disagree)`;
    return `OK ${date} ${entry.picks_hash} (compacted; index agrees with summary)`;
  } catch (e) {
    return `MISMATCH ${date} (${e.message})`;
  }
}

/** Verify a directory laid out like the repo root. Returns { ok, lines[] }. */
export async function verifyDir(dir) {
  let names = [];
  try {
    names = await readdir(join(dir, 'days'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const lines = [];
  const recomputed = new Map();
  for (const name of names.sort()) {
    const m = FULL_RE.exec(name);
    if (!m) continue;
    const { line, hash } = await checkFull(dir, name, m[1]);
    lines.push(line);
    recomputed.set(m[1], hash);
  }
  const present = new Set(names);

  let index = null;
  try {
    index = await readJsonOrNull(join(dir, 'index.json'));
  } catch (e) {
    lines.push(`MISMATCH index.json (${e.message})`);
  }
  if (index !== null) {
    const days = index && Array.isArray(index.days) ? index.days : null;
    if (days === null) {
      lines.push('MISMATCH index.json (no days list)');
    } else {
      const entries = [];
      days.forEach((e, i) => {
        if (isEntry(e)) entries.push(e);
        else lines.push(`MISMATCH index.json (days[${i}] is malformed)`);
      });
      for (const entry of entries.sort((a, b) => (a.day < b.day ? -1 : 1))) {
        if (entry.compacted) {
          lines.push(await checkCompacted(dir, entry));
        } else {
          const line = checkFullEntry(entry, present, recomputed);
          if (line !== null) lines.push(line);
        }
      }
    }
  }
  return { ok: lines.every((l) => l.startsWith('OK ')), lines };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const { ok, lines } = await verifyDir(dir);
  for (const l of lines) console.log(l);
  if (lines.length === 0) console.log(`no day files found under ${join(dir, 'days')}`);
  if (!ok) process.exitCode = 1;
}
