// Site constants and the operator's legal identity (plan S8, S9).
//
// The operator fields are the operator's to supply. Until legal_name, address and contact_email
// are set, requireOperator() throws and the build fails: a legal page with a placeholder in it is
// worse than no legal page.

const config = {
  origin: 'https://betgaffer.com',
  repo: 'geezerz/betgaffer-site',
  brand: 'Bet Gaffer',
  descriptor: 'football match intelligence',
  operator: {
    legal_name: 'BETGAFFER LTD',
    trading_name: 'Bet Gaffer',
    address: '1 Bouar Close, off Bangui Street, Wuse 2, Abuja',
    rc_number: '9885410',
    contact_email: 'contact@betgaffer.com',
    privacy_email: null, // defaults to contact_email
    // Optional: who hosts the operator's mailbox that Cloudflare Email Routing forwards to (e.g.
    // 'Google (Gmail)'). Named in the privacy policy; null reads "an email provider". Not required.
    mailbox_provider: null,
  },
  founding_places: 500,
  pricing: {
    show_prices: true,
    currency: 'NGN',
    // Filled in ({ name, monthly } with monthly in whole naira) when the operator decides to publish
    // prices, in the same commit that sets show_prices: true. requireOperator() refuses
    // show_prices: true while this is empty.
    tiers: [
      { name: 'Free account', monthly: 0 },
      { name: 'Starter', monthly: 1500 },
      { name: 'Pro', monthly: 3000 },
      { name: 'Elite', monthly: 10000 },
    ],
  },
  stale_after_hours: 6,
};

export default config;

const REQUIRED = ['legal_name', 'address', 'contact_email'];
const present = (v) => typeof v === 'string' && v.trim() !== '';

// These values land inside href attributes (mailto:, https://github.com/<repo>, canonical URLs), so
// they are validated by shape, not just escaped: '?bcc=' or a quoted local part in an email, or a
// path or query in an origin, would change what the link does even when correctly escaped.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// owner/name as GitHub allows it: an owner is letters, digits and hyphens; a repository name adds
// "." and "_" but is never "." or "..". The one rule every page that links the repository uses.
export const REPO_RE = /^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
const ORIGIN_RE = /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::\d{1,5})?$/;

/**
 * The effective operator identity (privacy_email defaulted to contact_email). Throws an Error
 * naming EVERY missing required field, so one build run tells the operator everything to fill in;
 * then an Error naming every malformed field (contact_email, privacy_email, repo, origin, and
 * pricing.tiers when pricing.show_prices is true with no tiers).
 */
export function requireOperator(cfg) {
  const op = cfg && typeof cfg.operator === 'object' && cfg.operator !== null ? cfg.operator : {};
  const missing = REQUIRED.filter((k) => !present(op[k]));
  if (missing.length > 0) {
    throw new Error(`site/config.js: operator identity incomplete; set operator.${missing.join(', operator.')} `
      + `(missing: ${missing.join(', ')}). The legal pages cannot be published with placeholders.`);
  }
  const bad = [];
  if (!EMAIL_RE.test(op.contact_email)) bad.push(['operator.contact_email', op.contact_email, 'a plain address like name@example.com']);
  if (present(op.privacy_email) && !EMAIL_RE.test(op.privacy_email)) {
    bad.push(['operator.privacy_email', op.privacy_email, 'a plain address like name@example.com']);
  }
  const repo = cfg.repo;
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    bad.push(['repo', repo, 'owner/name']);
  }
  const pricing = cfg.pricing !== null && typeof cfg.pricing === 'object' ? cfg.pricing : {};
  if (pricing.show_prices === true && (!Array.isArray(pricing.tiers) || pricing.tiers.length === 0)) {
    bad.push(['pricing.tiers', pricing.tiers, 'a non-empty list of { name, monthly } when pricing.show_prices is true']);
  }
  if (typeof cfg.origin !== 'string' || !ORIGIN_RE.test(cfg.origin)) {
    bad.push(['origin', cfg.origin, 'a bare https:// origin with no path, e.g. https://betgaffer.com']);
  }
  if (bad.length > 0) {
    throw new Error(`site/config.js: invalid ${bad.map(([k]) => k).join(', ')}: `
      + bad.map(([k, v, want]) => `${k} must be ${want}, got ${JSON.stringify(v)}`).join('; '));
  }
  return { ...op, privacy_email: present(op.privacy_email) ? op.privacy_email : op.contact_email };
}
