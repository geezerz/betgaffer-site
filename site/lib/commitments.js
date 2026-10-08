// Spec §9: the public pages promise only what the operator will keep. This module holds the approved
// time commitments and the sentence-level checks the commitments guard (tests/commitments.test.js) runs
// over /privacy/, /terms/, /refunds/, /waitlist/ and /features/.
//
// Pure functions, no node: imports. A sentence is approved only by adding its exact text to
// APPROVED_SOURCES below, with the spec section or founding constant it comes from. Never add a sentence
// just to make the guard pass: change the page instead, or get the promise approved first.

import { BENEFITS, CLAIM_DAYS } from './founding.js';

const APOS = new RegExp(`[${String.fromCharCode(0x2018, 0x2019, 0x02bc)}]`, 'g');
const DQUOTE = new RegExp(`[${String.fromCharCode(0x201c, 0x201d)}]`, 'g');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: '—', ndash: '–', hellip: '...' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Sentence end marker for block-level boundaries (a control character never found in page copy).
const END = String.fromCharCode(1);
const BLOCK_END = /<\/(?:p|li|h[1-6]|td|th|dt|dd|div|section|article|header|footer|aside|nav|blockquote|figcaption|caption|summary|label|button|ul|ol|dl|table|tr|main|form)\s*>|<(?:br|hr)\b[^>]*>|<(?:p|li|h[1-6]|td|th|dt|dd|div|section|article|header|footer|aside|nav|blockquote|ul|ol|dl|table|tr|main|form)\b[^>]*>/gi;
const INLINE_TAG = /<\/?(?:a|strong|em|b|i|u|span|time|abbr|code|small|mark|sup|sub|q|cite|data|bdi|bdo|wbr|s)\b[^>]*>/gi;

function requireString(fn, v) {
  if (typeof v !== 'string') throw new TypeError(`${fn}: expected a string, got ${v === null ? 'null' : typeof v}`);
}

/** Lowercase, collapse whitespace, straighten quotes, trim. Strips any HTML left in the text. */
export function normalise(s) {
  requireString('normalise', s);
  return decode(s.replace(INLINE_TAG, '').replace(/<[^>]*>/g, ' '))
    .replace(APOS, "'").replace(DQUOTE, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The visible copy of an HTML document or fragment (or plain text) as normalised sentences. A sentence
 * ends at ".", "!" or "?" (with any closing bracket or quote) before a capital, a digit or an opening
 * bracket/quote, and at every block-level tag boundary (</p>, </li>, </h2>, </td>, <br> …), so a list
 * item or heading without a full stop never runs into the next one. <head>, <script>, <style>,
 * <template> and comments are not copy; <noscript> is (readers without JS see it).
 */
export function sentences(html) {
  requireString('sentences', html);
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(BLOCK_END, ` ${END} `)
    .replace(INLINE_TAG, '')
    .replace(/<[^>]*>/g, ' ');
  const out = [];
  for (const block of decode(text).replace(APOS, "'").replace(DQUOTE, '"').split(END)) {
    const flat = block.replace(/\s+/g, ' ').trim();
    if (flat === '') continue;
    for (const s of flat.split(/(?<=[.!?][)\]"']*)\s+(?=[A-Z0-9("'[])/)) {
      const n = s.trim().toLowerCase();
      if (n !== '') out.push(n);
    }
  }
  return out;
}

const UNITS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
// Digits (with thousands commas and decimals: "1,000", "1.5"), number words ("twenty-four" or
// "twenty four"), "a hundred", "a"/"an", "a few"/"few"/"several".
const NUMBER = `\\d[\\d,]*(?:\\.\\d+)?|(?:${TENS})(?:(?:-|\\s+)(?:one|two|three|four|five|six|seven|eight|nine))?|${UNITS}|a\\s+hundred|one\\s+hundred|a\\s+few|few|several|a|an`;
const UNIT = 'minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?';
/**
 * A time commitment: within / at least / no later than + a number (digits, words, "a"/"an" or "a few")
 * + an optional business/working/calendar qualifier + a unit (minutes to years, "mins"/"hrs" included).
 */
export const COMMITMENT_RE = new RegExp(
  `\\b(?:within|at\\s+least|no\\s+later\\s+than)\\s+(?:${NUMBER})\\s+(?:(?:business|working|calendar)\\s+)?(?:${UNIT})\\b`, 'i');

/** Normalised sentences of html that make a time commitment. */
export function commitmentSentences(html) {
  requireString('commitmentSentences', html);
  return sentences(html).filter((s) => COMMITMENT_RE.test(s));
}

const CREDIT_RE = /\b(?:credits?|top-?ups?)\b/i;
// Negated refund wording, removed before the positive test so "not refundable, but … refundable" still fires.
const NEGATED_RE = /\b(?:not|never|cannot|can't|won't|aren't|isn't|don't|doesn't)\s+(?:be\s+)?refund(?:able|ed|s)?\b|\bnon-?refundable\b/gi;
const REFUNDABLE_RE = /\brefundable\b|\b(?:can|will|may|shall|could|would)\s+be\s+refunded\b|\b(?:are|is|get|gets|be)\s+refunded\b|\brefund(?:s|ed)?\s+(?:(?:your|any|the|all|unused|their)\s+)*(?:credits?|top-?ups?)\b/i;

/** Normalised sentences of html that say Credits or top-ups are refundable. */
export function refundableCredits(html) {
  requireString('refundableCredits', html);
  return sentences(html).filter((s) => CREDIT_RE.test(s) && REFUNDABLE_RE.test(s.replace(NEGATED_RE, ' ')));
}

/**
 * Every approved time commitment, with where it is printed. Founding promises are built from the
 * strings and numbers in site/lib/founding.js; the rest are the spec §9 "Kept" commitments.
 * @type {readonly {text: string, routes: readonly string[], source: string}[]}
 */
export const APPROVED_SOURCES = Object.freeze([
  // Founding benefit cards B5 and B6 (founding.js), printed on /waitlist/ and in the Terms.
  ...BENEFITS.flatMap((b) => commitmentSentences(b.text).map((s) => ({ text: s, routes: ['/terms/', '/waitlist/'], source: `founding.js ${b.id}` }))),
  // Spec §3.5 step 2 (final copy, /waitlist/) and programme §1 in the Terms: the 30-day claim window.
  { text: `Start any paid plan within ${CLAIM_DAYS} days of it and the place is yours.`, routes: ['/waitlist/'], source: 'spec §3.5 step 2' },
  { text: `A paid subscription started within ${CLAIM_DAYS} days of the invite claims the place; subscribing before the invite arrives also claims it.`, routes: ['/terms/'], source: 'programme §1' },
  // Spec §9 "Kept": 30-day data-request replies, 72-hour breach notice.
  { text: 'We will reply within 30 days, and we may ask you to confirm the request from that address before acting on it.', routes: ['/privacy/'], source: 'spec §9 kept: data requests' },
  { text: 'We will publish how to exercise each one from your account before accounts open; email will always work, and we will reply within 30 days.', routes: ['/privacy/'], source: 'spec §9 kept: data requests' },
  { text: 'We reply to every request about your data within 30 days.', routes: ['/privacy/'], source: 'spec §9 kept: data requests' },
  { text: 'If a breach affects personal data we hold, we will notify the Nigeria Data Protection Commission within 72 hours of becoming aware of it, and tell the people affected without undue delay.', routes: ['/privacy/'], source: 'spec §9 kept: breach notice' },
  // Spec §9 "Kept": 5-business-day refund start, the 7-day first-subscription cooling-off refund.
  { text: 'We start an agreed refund within 5 business days; how long it then takes to reach you depends on your bank.', routes: ['/refunds/'], source: 'spec §9 kept: refund start' },
  { text: 'If it is your first paid subscription and you have made only limited use of paid features, we will refund that first payment in full if you ask within 7 days of making it.', routes: ['/refunds/'], source: 'spec §9 kept / F11: cooling-off' },
].map((s) => Object.freeze({ ...s, routes: Object.freeze([...s.routes]) })));

/** The exact normalised text of every approved time-commitment sentence. */
export const APPROVED = Object.freeze([...new Set(APPROVED_SOURCES.map((s) => normalise(s.text)))]);
const APPROVED_SET = new Set(APPROVED);

/** The guard over one page: { unapproved, refundable } — both [] when the page is clean. */
export function commitmentViolations(html) {
  return {
    unapproved: commitmentSentences(html).filter((s) => !APPROVED_SET.has(s)),
    refundable: refundableCredits(html),
  };
}
