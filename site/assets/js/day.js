// Archive day loader (plan S4, S5, S6). Browser module on the /day/<d>/ stubs of older days.
//
// The stub's static HTML already shows the day's summary (date, count, ring, receipt) and, without
// JavaScript, a note asking for it. With JavaScript this module:
//   1. reads #day-root[data-src][data-day][data-hash][data-prev][data-next];
//   2. fetches the same-site day file;
//   3. checks its shape and recomputes its picks_hash (WebCrypto + the shared hash.js). The file's
//      own hash, the recomputed hash and the index's hash the build verified (data-hash) must all
//      agree — otherwise "This card failed its receipt check" and nothing of it is shown;
//   4. renders it with the SAME renderer the build uses (fixtures.js renderDay, which escapes every
//      value) into #day-root, and relabels its day labels for the visitor's date (stale.js);
//   5. only then hands the verified card to the predictions toolbar (predictions.js: search and
//      the Leagues filter). A toolbar failure never touches the card: it stays fully readable.
// The fetch bypasses the HTTP cache's freshness (cache: 'no-cache' revalidates), so a regraded
// file is never shown stale beside a fresh summary. No WebCrypto (an insecure context, an old
// browser) is a render failure: the receipt was not checked, so it must not be called failed.
// Any failure keeps the summary and adds an error box saying what went wrong (no link). Compacted
// days have no data-src: their summary is all there is, and this module does nothing.
//
// Imports resolve to /assets/js/lib/ (the build copies the isomorphic modules there).

import { picksHash } from './lib/hash.js';
import { renderDay } from './lib/fixtures.js';
import { isDate } from './lib/time.js';
import { relabel } from './stale.js';
import { init as initToolbar } from './predictions.js';

const SRC_RE = /^\/days\/(\d{4}-\d{2}-\d{2})\.json$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

export const MESSAGES = Object.freeze({
  fetch: "We couldn't load this day's card. Please try again later.",
  receipt: 'This card failed its receipt check, so it is not shown.',
  render: "This card couldn't be displayed.",
  loading: 'Loading this day’s fixtures…',
});

/** A load failure; kind is 'fetch' | 'receipt' | 'render' (selects the message). */
export class DayLoadError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'DayLoadError';
    this.kind = kind;
  }
}

/**
 * WebCrypto SHA-256 of a UTF-8 string, lowercase hex: the browser's picksHash digest. `subtle`
 * defaults to globalThis.crypto.subtle; when it is missing (null) or refuses, this throws a 'render'
 * DayLoadError — the receipt could not be checked, which is not the same as failing the check.
 */
export async function webSha256hex(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle || typeof subtle.digest !== 'function') throw new DayLoadError('render', 'WebCrypto is unavailable in this browser');
  let buf;
  try {
    buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  } catch (e) {
    throw new DayLoadError('render', `WebCrypto refused the digest (${e.message})`);
  }
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const optDate = (v) => (v === undefined || v === null || v === '' ? null : v);

/** The stub's data-* attributes, validated. Throws on anything malformed. */
export function readStub(el) {
  const d = el.dataset;
  const m = SRC_RE.exec(d.src ?? '');
  if (!m || m[1] !== d.day || !isDate(d.day)) throw new TypeError('day.js: data-src must be /days/<data-day>.json');
  if (!HASH_RE.test(d.hash ?? '')) throw new TypeError('day.js: data-hash must be sha256:<64 hex>');
  const prev = optDate(d.prev);
  const next = optDate(d.next);
  if ((prev !== null && !isDate(prev)) || (next !== null && !isDate(next))) throw new TypeError('day.js: data-prev/data-next must be dates');
  return { src: d.src, day: d.day, hash: d.hash, prev, next };
}

/** The minimal shape renderDay and the hash need; a wrong-day, compacted or newer file is refused. */
function checkShape(file, day) {
  if (!isObj(file)) throw new Error('not a JSON object');
  if (file.schema !== 1) throw new Error(`unsupported schema ${JSON.stringify(file.schema)}`);
  if (file.compacted === true) throw new Error('a compacted day has no fixtures');
  if (file.lagos_day !== day) throw new Error(`file is for ${JSON.stringify(file.lagos_day)}, not ${day}`);
  if (!Array.isArray(file.fixtures)) throw new Error('fixtures must be an array');
  if (!HASH_RE.test(file.picks_hash ?? '')) throw new Error('picks_hash is malformed');
  for (const k of ['accuracy', 'counts', 'pick_source']) if (!isObj(file[k])) throw new Error(`${k} must be an object`);
}

/**
 * Fetch, verify and render one archived day. Resolves to the card's HTML (escaped by renderDay);
 * rejects with a DayLoadError.
 */
export async function loadDay({ src, day, hash, prev = null, next = null, fetchImpl = globalThis.fetch, sha256hex = webSha256hex }) {
  let file;
  try {
    const res = await fetchImpl(src, { credentials: 'same-origin', cache: 'no-cache', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    file = await res.json();
  } catch (e) {
    throw new DayLoadError('fetch', `could not load ${src}: ${e.message}`);
  }
  try {
    checkShape(file, day);
  } catch (e) {
    throw new DayLoadError('render', `${src}: ${e.message}`);
  }
  let recomputed;
  try {
    recomputed = await picksHash(file.fixtures, sha256hex);
  } catch (e) {
    if (e instanceof DayLoadError) throw e; // no digest available: not a receipt failure
    throw new DayLoadError('receipt', `${src}: cannot recompute picks_hash (${e.message})`);
  }
  if (recomputed !== file.picks_hash || recomputed !== hash) {
    throw new DayLoadError('receipt', `${src}: picks_hash mismatch (recomputed ${recomputed}, file ${file.picks_hash}, index ${hash})`);
  }
  try {
    return renderDay(file, { prevDay: prev, nextDay: next });
  } catch (e) {
    throw new DayLoadError('render', `${src}: ${e.message}`);
  }
}

function errorBox(doc, kind) {
  const box = doc.createElement('div');
  box.className = 'bg-empty day-error';
  box.setAttribute('role', 'alert');
  const p = doc.createElement('p');
  p.textContent = MESSAGES[kind] ?? MESSAGES.render;
  box.append(p);
  return box;
}

/** The default enhancement: the toolbar, with the Leagues dialog only where showModal exists. */
function enhanceDay(root) {
  const hasDialog = typeof HTMLDialogElement !== 'undefined'
    && typeof HTMLDialogElement.prototype.showModal === 'function';
  initToolbar(root, { hasDialog });
}

/** Load the stub's day into #day-root. Dependencies are injectable (tests drive a fake DOM). */
export async function init({
  doc = document, fetchImpl = globalThis.fetch, sha256hex = webSha256hex, nowMs = Date.now(), enhance = enhanceDay,
} = {}) {
  const root = doc.getElementById('day-root');
  if (!root || !root.dataset.src) return; // compacted day: the summary is the page
  let stub;
  try {
    stub = readStub(root);
  } catch {
    return; // a malformed stub keeps its static summary and noscript note
  }
  const status = doc.createElement('p');
  status.className = 'day-load';
  status.setAttribute('role', 'status');
  status.textContent = MESSAGES.loading;
  root.setAttribute('aria-busy', 'true');
  root.append(status);
  let rendered = false;
  try {
    root.innerHTML = await loadDay({ ...stub, fetchImpl, sha256hex }); // renderDay output: every value escaped
    relabel(root, nowMs);
    rendered = true;
  } catch (e) {
    status.remove();
    root.append(errorBox(doc, e instanceof DayLoadError ? e.kind : 'render'));
  } finally {
    root.removeAttribute('aria-busy');
  }
  if (!rendered) return;
  try {
    enhance(root);
  } catch {
    // The verified card is already on the page and complete; it simply has no toolbar.
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
}
