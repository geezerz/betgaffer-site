// Banned public-copy phrases (charter v6, plan Task 5) and the scanner every test uses.
// ISOMORPHIC: no node: imports, no process, no Buffer.
//
// One list, one scanner: the content tests (Task 5) and the built-site claim scan (Task 6, test 16)
// both import findBanned, so a phrase banned here is banned everywhere.

// The private platform's name is banned too. It is built from char codes so the literal never
// appears in this public repository's source; the tests build it the same way.
export const INTERNAL_NAME = String.fromCharCode(70, 111, 114, 101, 99, 97, 120, 116);

/**
 * Case-insensitive, word-bounded. A listed phrase also matches its plural and possessive
 * ("tokens", "punters'", "fixed matches") and a hyphenated spelling ("sure-bet"):
 * the copy rule is about the word, not one inflection of it.
 */
export const BANNED = Object.freeze([
  'sure bet', 'sure game', 'banker', 'guaranteed', 'fixed match', 'fixed game', "can't lose", 'cannot lose',
  'jackpot', 'make money', 'double your money', 'free bet', 'bonus code', 'cash out', 'win more', 'win rate',
  'profitable', 'ROI', 'profit', 'yield', 'staking', 'bankroll', 'tipster', 'punter', 'gambler', INTERNAL_NAME,
  'token', 'we win', 'we won', 'odds target', '20 odds', '50 odds',
  // Task 5 review M7. "cash-out" is already caught by "cash out" (hyphens match spaces); "cashout"
  // is one word, so it needs its own entry. No negation ("not a betting site", "not a sportsbook")
  // is allowed: no page uses one, so the negated form is reported too.
  'cashout', "we'll win", 'we will win', 'we have won', 'Green Month Guarantee', 'sportsbook', 'betting site',
]);

/**
 * Exact phrases removed from the text (case-insensitive) BEFORE scanning. Each needs a reason.
 * Nothing else is allowed through.
 */
export const ALLOW = Object.freeze([
  // The free support resource named in the Terms' responsible-play section (plan Task 5). Its name
  // contains "Gamblers", which would otherwise trip "gambler".
  'Gamblers Anonymous',
]);

// "Standard liability wording" (`loss of profits`) is deliberately NOT in ALLOW: the legal pages do
// not use it, and an allow entry nobody needs is a hole in the scan.

// Curly and modifier apostrophes (U+2018, U+2019, U+02BC, U+FF07) built from char codes so no
// editor or tool can silently change them.
const APOS_CHARS = String.fromCharCode(0x2018, 0x2019, 0x02bc, 0xff07);
const APOS = new RegExp(`[${APOS_CHARS}]`, 'g');

// Raw HTML is accepted and reduced to its visible text (review I10). Inline elements do not break a
// word ("jack<span>pot</span>" reads "jackpot"); every other tag does ("sure<br>bet" reads
// "sure bet"). Attribute values are never visible, so they go with their tag.
const INLINE = new Set(['a', 'abbr', 'b', 'em', 'i', 'mark', 'small', 'span', 'strong', 'sub', 'sup', 'time']);
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?\/?>/g;

// Decoded in ONE pass, so "&amp;lt;" becomes the text "&lt;", never "<".
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'" };
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z]+));/g;

function decodeEntity(whole, dec, hex, name) {
  if (name !== undefined) {
    const k = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : whole;
  }
  const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
  return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : whole;
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Left edge: not inside a word, and not the tail of a decimal ("1.20 odds" is a price, not "20 odds").
const LEFT = '(?<![\\p{L}\\p{N}_])(?<!\\p{N}[.,])';
// Right edge: not inside a word; and not a negative contraction ("we won't" is not "we won").
const RIGHT = "(?![\\p{L}\\p{N}_])(?!'t(?![\\p{L}\\p{N}_]))";

function phrasePattern(phrase) {
  return phrase.split(' ').map(reEscape).join('[\\s-]+');
}

const ALLOW_RES = ALLOW.map((p) => new RegExp(`${LEFT}${phrasePattern(p)}${RIGHT}`, 'giu'));
const BANNED_RES = BANNED.map((p) => [p, new RegExp(`${LEFT}${phrasePattern(p)}(?:s|es|'s)?${RIGHT}`, 'iu')]);

/**
 * Text as the scanner sees it: tags removed (inline -> nothing, others -> a space), THEN entities
 * decoded (so escaped markup stays text), apostrophes straightened, whitespace collapsed.
 */
function normalise(text) {
  return text
    .replace(COMMENT, ' ')
    .replace(TAG, (_, name) => (INLINE.has(name.toLowerCase()) ? '' : ' '))
    .replace(ENTITY, decodeEntity)
    .replace(APOS, "'")
    .replace(/\s+/gu, ' ');
}

/**
 * The BANNED entries (canonical spelling, BANNED order, each once) that occur in `text` after the
 * ALLOW phrases are removed. [] when the text is clean.
 */
export function findBanned(text) {
  if (typeof text !== 'string') throw new TypeError(`findBanned: expected a string, got ${text === null ? 'null' : typeof text}`);
  let t = normalise(text);
  for (const re of ALLOW_RES) t = t.replace(re, ' ');
  return BANNED_RES.filter(([, re]) => re.test(t)).map(([p]) => p);
}
