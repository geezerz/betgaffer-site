// The Founding Member Programme in numbers and words — the ONE source every page and test reads.
// Authority: the operator-approved founding programme rules (2026-10-08). Change a number here only
// together with those rules.
export const TOTAL_PLACES = 1000;
export const WAITLIST_PLACES = 500;
export const LAUNCH_PLACES = 500;
export const CLAIM_DAYS = 30;
export const GRACE_DAYS = 90;
export const DISCOUNT_PCT = 30;
export const TOPUP_BONUS_PCT = 20;
export const VOTE_WEIGHT = 2;
export const EARLY_ACCESS_HOURS = 72;
export const SUPPORT_REPLY_HOURS = 12;
/** Notice before an equal-or-better replacement of a founding benefit (programme §2, "No downgrades"). */
export const NOTICE_DAYS = 30;

/** Public benefit cards (spec §3.4), in programme order B1-B6. */
export const BENEFITS = Object.freeze([
  { id: 'B1', title: `${DISCOUNT_PCT}% off, every time`, text: `${DISCOUNT_PCT}% off your plan's price at every payment, for as long as you stay subscribed.` },
  { id: 'B2', title: 'Double Credits', text: "Your plan's monthly Credit allowance is doubled, on any paid plan." },
  { id: 'B3', title: 'More from every top-up', text: `Every Credit top-up comes with ${TOPUP_BONUS_PCT}% extra.` },
  { id: 'B4', title: 'A bigger say', text: 'A founding badge, and your vote counts twice when members vote on new features and improvements.' },
  { id: 'B5', title: 'First look at new features', text: `New features reach you at least ${EARLY_ACCESS_HOURS} hours before everyone else, and you help shape them while they're built. (Fixes and security updates go to everyone at once.)` },
  { id: 'B6', title: 'Priority support', text: `A first reply from a person within ${SUPPORT_REPLY_HOURS} hours of your message, every day, on any paid plan — plus a founding-members WhatsApp community with our team.` },
].map(Object.freeze));

/** The short summary line used on Features (spec §2). */
export const SUMMARY = `${DISCOUNT_PCT}% off every subscription payment · double Credits · first look at new features · priority support`;

/** 1000 -> '1,000' (deterministic: never the host locale). */
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * One run of card copy. `hl`: a key word (bold, accent colour). `offer` is derived, never typed: every
 * segment that prints a percentage sits in data-figure="offer" (the claim guard allows it nowhere else).
 */
function seg(t, hl = false) {
  return Object.freeze({ t, ...(hl ? { hl: true } : {}), ...(t.includes('%') ? { offer: true } : {}) });
}
const P = (t) => seg(t);
const H = (t) => seg(t, true);
const variant = (heading, line) => Object.freeze({ heading: Object.freeze(heading), line: Object.freeze(line) });

const OFF = `${DISCOUNT_PCT}% off`;
const ALL = thousands(TOTAL_PLACES);

/**
 * The founding card's ten copy variants (spec §16.5; variants 4 and 9 as corrected there). The build
 * renders one per page (variantFor), banner.js swaps in another per page view. No time commitments,
 * nothing beyond the programme rules.
 * @type {readonly {heading: readonly {t: string, hl?: true, offer?: true}[], line: readonly {t: string, hl?: true, offer?: true}[]}[]}
 */
export const VARIANTS = Object.freeze([
  variant([P('Be one of '), H(`${ALL} founding members`)],
    [H(OFF), P(' every subscription payment · '), H('double Credits'), P(' · '), H('first look'), P(' at new features · '), H('priority support')]),
  variant([H(OFF), P(' for as long as you subscribe')],
    [P('Founding members save '), H(`${DISCOUNT_PCT}%`), P(' on every payment. There are only '), H(`${ALL} founding places`), P('.')]),
  variant([P('Reserve your '), H('founding place')],
    [P("It's "), H('free'), P(' to join the waitlist. The first '), H(thousands(WAITLIST_PLACES)), P(' reserve a founding place with '), H(OFF), P(' every payment.')]),
  variant([P("Your plan's Credits, "), H('doubled')],
    [P('Founding members get '), H('double Credits'), P(' every month on any paid plan, and '), H(`${TOPUP_BONUS_PCT}% extra`), P(' on every top-up.')]),
  variant([P('See new features '), H('before everyone else')],
    [P('Founding members get '), H('early access'), P(' to new features and help '), H('shape them'), P(" while they're built.")]),
  variant([P('A '), H('bigger say'), P(' in what we build')],
    [P('As a founding member, your vote counts '), H('twice'), P(' when members vote on new features and improvements.')]),
  variant([P('Help when you need it, '), H('first')],
    [H('Priority support'), P(' on any paid plan, plus a founding-members '), H('WhatsApp community'), P(' with our team.')]),
  variant([P('Only '), H(`${ALL} founding places`)],
    [H(thousands(WAITLIST_PLACES)), P(' for the waitlist and '), H(thousands(LAUNCH_PLACES)), P(' for the first subscribers at launch.')]),
  variant([P('Founding benefits that '), H('stay with you')],
    [P('Stay subscribed and keep your '), H(OFF), P(', '), H('double Credits'), P(' and '), H('priority support'), P('.')]),
  variant([P('Get the '), H('founding member'), P(' badge')],
    [P('A '), H('founding badge'), P(', '), H(OFF), P(' every payment and '), H('double Credits'), P(' — for the first '), H(ALL), P('.')]),
]);

/** FNV-1a, 32-bit, over UTF-16 code units: the same number in the build and in any browser. */
export function pathHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The static variant of every fixed page with the card, each a different one (a reader moving between
 * them without JS sees different copy). The home page leads with variant 1, "Be one of 1,000 founding
 * members" (operator, 2026-10-08). tests/build.test.js fails when a fixed page is added or removed
 * without updating this map. Dated pages (/day/YYYY-MM-DD/) are not listed: they use the path hash.
 */
export const PAGE_VARIANTS = Object.freeze({
  '/': 0, // Be one of 1,000 founding members
  '/our-record/': 1, // 30% off for as long as you subscribe
  '/features/': 4, // See new features before everyone else
  '/privacy/': 2, // Reserve your founding place
  '/terms/': 8, // Founding benefits that stay with you
  '/refunds/': 6, // Help when you need it, first
  '/404.html': 7, // Only 1,000 founding places
});

/** The variant a page's static HTML carries: its PAGE_VARIANTS entry, else a stable hash of its site path. */
export function variantFor(path) {
  if (typeof path !== 'string') throw new TypeError(`variantFor: path must be a string, got ${typeof path}`);
  if (Object.hasOwn(PAGE_VARIANTS, path)) return PAGE_VARIANTS[path];
  return pathHash(path) % VARIANTS.length;
}
