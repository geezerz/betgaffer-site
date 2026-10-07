// The canonical picks_hash (spec §5). ISOMORPHIC: the build injects a node:crypto digest, the
// browser a WebCrypto one, so this module imports nothing.
//
// It must reproduce the publisher's own picks_hash byte for byte:
//   rows sorted by fx ascending; each row [fx, api_fx, home_id, away_id, pick|null, frozen_at|null,
//   withdrawn]; pick [market, label|null, pct|null, price.toFixed(2)|null, price_est, why|null];
//   compact JSON, "/" and non-ASCII unescaped; "sha256:" + lowercase hex SHA-256 of the UTF-8.
// The publisher's JSON encoder escapes U+2028 / U+2029 even with unescaped Unicode;
// JSON.stringify does not, so they are escaped here. The characters and their escapes are built from char codes on purpose.
//
// A field whose type the publisher's cast cannot be reproduced for exactly throws a TypeError:
// refusing to vouch for a receipt beats computing a hash that differs from the publisher's for a reason
// nobody can see.

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const BACKSLASH = String.fromCharCode(0x5c);
const LS_ESC = BACKSLASH + 'u2028';
const PS_ESC = BACKSLASH + 'u2029';

const HEX64 = /^[0-9a-f]{64}$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function intOrZero(v, what, fx) {
  if (v === null || v === undefined) return 0;
  if (Number.isInteger(v)) return v;
  throw new TypeError(`picksHash: fx ${fx} ${what} must be an integer, got ${typeof v}`);
}

function intOrNull(v, what, fx) {
  if (v === null || v === undefined) return null;
  if (Number.isInteger(v)) return v;
  throw new TypeError(`picksHash: fx ${fx} ${what} must be an integer or null, got ${typeof v}`);
}

function strOrNull(v, what, fx) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  throw new TypeError(`picksHash: fx ${fx} ${what} must be a string or null, got ${typeof v}`);
}

function boolOrFalse(v, what, fx) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  throw new TypeError(`picksHash: fx ${fx} ${what} must be a boolean, got ${typeof v}`);
}

function priceOrNull(v, fx) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
  throw new TypeError(`picksHash: fx ${fx} pick.price must be a finite number or null, got ${typeof v}`);
}

/** As the publisher canonicalises it: a pick is only a pick if it names a non-empty string market. */
function canonicalPick(p, fx) {
  if (!isPlainObject(p) || typeof p.market !== 'string' || p.market === '') return null;
  return [
    p.market,
    strOrNull(p.label, 'pick.label', fx),
    intOrNull(p.pct, 'pick.pct', fx),
    priceOrNull(p.price, fx),
    boolOrFalse(p.price_est, 'pick.price_est', fx),
    strOrNull(p.why, 'pick.why', fx),
  ];
}

/** The hashed rows, sorted by fx. Throws on a non-integer or duplicate fx. */
export function canonicalRows(fixtures) {
  if (!Array.isArray(fixtures)) throw new TypeError('picksHash: fixtures must be an array');
  const seen = new Set();
  const rows = fixtures.map((f, i) => {
    if (!isPlainObject(f)) throw new TypeError(`picksHash: fixtures[${i}] is not an object`);
    const fx = f.fx;
    if (!Number.isInteger(fx)) throw new TypeError(`picksHash: fixtures[${i}] has a non-integer fx`);
    if (seen.has(fx)) throw new Error(`picksHash: duplicate fx ${fx} (the hash must not depend on row order)`);
    seen.add(fx);
    return [
      fx,
      intOrZero(f.api_fx, 'api_fx', fx),
      intOrZero(f.home_id, 'home_id', fx),
      intOrZero(f.away_id, 'away_id', fx),
      canonicalPick(f.pick, fx),
      strOrNull(f.frozen_at, 'frozen_at', fx),
      boolOrFalse(f.withdrawn, 'withdrawn', fx),
    ];
  });
  rows.sort((a, b) => a[0] - b[0]);
  return rows;
}

/** The exact text that is hashed (byte-identical to the publisher's JSON encoding). */
export function canonicalText(fixtures) {
  return JSON.stringify(canonicalRows(fixtures)).replaceAll(LS, LS_ESC).replaceAll(PS, PS_ESC);
}

/**
 * "sha256:<hex>" of the canonical text. sha256hex is injected: (utf8String) => hex | Promise<hex>.
 * Always returns a Promise.
 */
export async function picksHash(fixtures, sha256hex) {
  if (typeof sha256hex !== 'function') throw new TypeError('picksHash: a sha256hex function must be injected');
  const text = canonicalText(fixtures);
  const hex = await sha256hex(text);
  if (typeof hex !== 'string' || !HEX64.test(hex)) {
    throw new TypeError('picksHash: the injected sha256hex did not return 64 lowercase hex characters');
  }
  return 'sha256:' + hex;
}
