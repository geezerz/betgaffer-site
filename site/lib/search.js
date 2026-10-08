// Accent-insensitive prefix search (spec section 5). Isomorphic: pure functions, no imports.
// Non-ASCII characters are built from char codes so no tool can mangle them.

const c = (n) => String.fromCharCode(n);

// Letters that NFD does not decompose.
const EXTRA = new Map([
  [c(0xf8), 'o'], // o with stroke
  [c(0xe6), 'ae'],
  [c(0xdf), 'ss'],
  [c(0x142), 'l'], // l with stroke
  [c(0x131), 'i'], // dotless i
  [c(0x111), 'd'], // d with stroke
  [c(0x153), 'oe'],
  [c(0xfe), 'th'], // thorn
]);
// One pass (after NFD) for apostrophes (' ` U+00B4 U+2018 U+2019 U+02BC -> removed) and the letters NFD leaves alone.
const PRE_RE = new RegExp("['`" + c(0xb4) + c(0x2018) + c(0x2019) + c(0x2bc) + [...EXTRA.keys()].join('') + ']', 'g');
const pre = (ch) => EXTRA.get(ch) || '';
const MARKS_RE = /\p{M}/gu;
const SPLIT_RE = /[^\p{L}\p{N}]+/gu;

const ASCII_SPLIT_RE = /[^a-z0-9]+/g;
const ASCII_RE = /^[\x00-\x7f]*$/;

// Competition and team names repeat across rows, so memoise (bounded; cleared when full).
const MEMO = new Map();
const MEMO_MAX = 4096;

export function fold(s) {
  const key = String(s == null ? '' : s);
  const hit = MEMO.get(key);
  if (hit !== undefined) return hit;
  const out = foldUncached(key);
  if (MEMO.size >= MEMO_MAX) MEMO.clear();
  MEMO.set(key, out);
  return out;
}

function foldUncached(s) {
  const lower = String(s == null ? '' : s).toLowerCase();
  if (ASCII_RE.test(lower)) {
    // Fast path: nothing to decompose or map.
    return lower.replace(/['`]/g, '').replace(ASCII_SPLIT_RE, ' ').trim();
  }
  // Order matters: NFD first so precomposed letters (o-stroke-acute, ae-acute) expose their base
  // letter, then the special-letter map, then drop the combining marks.
  const base = lower.normalize('NFD').replace(PRE_RE, pre).replace(MARKS_RE, '');
  return (ASCII_RE.test(base) ? base.replace(ASCII_SPLIT_RE, ' ') : base.replace(SPLIT_RE, ' ')).trim();
}

export const _memoSize = () => MEMO.size; // test hook

export function words(s) {
  return fold(s).split(' ').filter(Boolean);
}

export function matcher(query) {
  const q = words(query);
  if (q.length === 0) return () => true;
  return (haystackWords) => q.every((qw) => haystackWords.some((hw) => hw.startsWith(qw)));
}

export function rowWords(r) {
  const { home, away, comp } = r || {};
  return [...words(home), ...words(away), ...words(comp)];
}
