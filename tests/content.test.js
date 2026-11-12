// Task 5: features page, legal documents (privacy, terms, refunds) and the banned-phrase module.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import siteConfig from '../site/config.js';
import { BANNED, ALLOW, findBanned } from '../site/lib/claims.js';
import * as features from '../site/content/features.js';
import * as privacy from '../site/content/privacy.js';
import * as terms from '../site/content/terms.js';
import * as refunds from '../site/content/refunds.js';
import { lastUpdated } from '../site/content/common.js';
import { percentagesOutsideOffers } from './html-scan.js';
import * as F from '../site/lib/founding.js';

// A filled test operator. Every value carries HTML metacharacters so escaping is proven, and the
// privacy address differs from the contact address so the right one is proven on each page.
const OP = {
  legal_name: 'Example & Co <Media> Ltd',
  trading_name: 'Bet Gaffer',
  address: '1 "Example" Road, Ikeja, Lagos',
  rc_number: 'RC1234567',
  contact_email: 'hello@example.com',
  privacy_email: 'privacy@example.com',
};
// Made-up tiers: the shipped config carries none (prices are the operator's to publish), so the
// show_prices tests bring their own.
const TEST_TIERS = Object.freeze([{ name: 'Free', monthly: 0 }, { name: 'Plus', monthly: 1250 }, { name: 'Max', monthly: 20000 }]);
const cfg = (over = {}) => ({
  ...siteConfig,
  operator: { ...siteConfig.operator, ...OP, ...(over.operator || {}) },
  pricing: { ...siteConfig.pricing, tiers: TEST_TIERS, ...(over.pricing || {}) },
});

// The private platform's name, built from char codes so the literal never appears in this repo.
const INTERNAL = String.fromCharCode(70, 111, 114, 101, 99, 97, 120, 116);

const PAGES = { features, privacy, terms, refunds };
const LEGAL = { privacy, terms, refunds };
// Every content page renders from the config alone (the waitlist form lives on /waitlist/, Plan A Task 4).
const renderPage = (name, c = cfg()) => PAGES[name].render(c);

// Visible text of an HTML fragment: tags removed, the escapes esc.js emits decoded, whitespace collapsed.
function visibleText(html) {
  return html
    .replace(/<\/?(?:a|strong|em|b|i|span|time|abbr|code)\b[^>]*>/gi, '') // inline: no word break
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================================
// claims.js
// =============================================================================================

const PLAN_BANNED = ['sure bet', 'sure game', 'banker', 'guaranteed', 'fixed match', 'fixed game', "can't lose",
  'cannot lose', 'jackpot', 'make money', 'double your money', 'free bet', 'bonus code', 'cash out', 'win more',
  'win rate', 'profitable', 'ROI', 'profit', 'yield', 'staking', 'bankroll', 'tipster', 'punter', 'gambler',
  INTERNAL, 'token', 'we win', 'we won', 'odds target', '20 odds', '50 odds',
  // Task 5 review M7
  'cashout', "we'll win", 'we will win', 'we have won', 'Green Month Guarantee', 'sportsbook', 'betting site'];

test('claims: BANNED is exactly the plan list (+ review M7) and ALLOW is exactly Gamblers Anonymous', () => {
  assert.deepEqual([...BANNED].sort(), [...PLAN_BANNED].sort());
  assert.deepEqual([...ALLOW], ['Gamblers Anonymous']);
  assert.ok(Object.isFrozen(BANNED) && Object.isFrozen(ALLOW), 'the lists cannot be mutated by a caller');
});

test('claims: every banned phrase is found when injected, in any case', () => {
  for (const p of BANNED) {
    assert.deepEqual(findBanned(`Read this: ${p} is here.`), [p], `lower/as-listed: ${p}`);
    assert.deepEqual(findBanned(`READ THIS: ${p.toUpperCase()}!`), [p], `upper: ${p}`);
    assert.deepEqual(findBanned(p), [p], `whole text: ${p}`);
  }
});

test('claims: plurals, possessives, hyphens, curly apostrophes, entities and line breaks still match', () => {
  assert.deepEqual(findBanned('Tokens can be bought'), ['token']);
  assert.deepEqual(findBanned('for punters and tipsters'), ['tipster', 'punter']);
  assert.deepEqual(findBanned('no fixed matches'), ['fixed match']);
  assert.deepEqual(findBanned(`${INTERNAL}'s engine`), [INTERNAL]);
  assert.deepEqual(findBanned(`the ${INTERNAL.toUpperCase()} engine`), [INTERNAL]);
  assert.deepEqual(findBanned('a sure-bet for you'), ['sure bet']);
  assert.deepEqual(findBanned('you can’t lose'), ["can't lose"]);
  assert.deepEqual(findBanned('you can&#39;t lose'), ["can't lose"]);
  assert.deepEqual(findBanned('make\n  money'), ['make money']);
  assert.deepEqual(findBanned('sure&nbsp;bet'), ['sure bet']);
  assert.deepEqual(findBanned('loss of profits'), ['profit'], 'loss of profits is NOT allowed through: it is unused');
});

test('claims: review M7 additions — variants caught, and no page needs a negation allowance', () => {
  assert.deepEqual(findBanned('cash-out now'), ['cash out'], 'cash-out is covered by "cash out"');
  assert.deepEqual(findBanned('instant CASHOUT'), ['cashout']);
  assert.deepEqual(findBanned('we’ll win this'), ["we'll win"]);
  assert.deepEqual(findBanned('We will win.'), ['we will win']);
  assert.deepEqual(findBanned('we have won 9 in a row'), ['we have won']);
  assert.deepEqual(findBanned('the Green Month Guarantee'), ['Green Month Guarantee']);
  assert.deepEqual(findBanned('a sportsbook'), ['sportsbook']);
  assert.deepEqual(findBanned('betting sites'), ['betting site']);
  // No page uses "not a betting site" / "not a sportsbook", so ALLOW carries no negation: the
  // negated form is still reported. If a page ever needs it, add the EXACT phrase to ALLOW.
  assert.deepEqual(findBanned('We are not a betting site.'), ['betting site']);
  assert.deepEqual(findBanned('not a sportsbook'), ['sportsbook']);
  // Near misses for the new entries.
  for (const t of ['we will not win you over', 'a betting slip', 'site', 'Green Month', 'cash', 'we have']) {
    assert.deepEqual(findBanned(t), [], t);
  }
});

test('claims: raw HTML is scanned as visible text (review I10)', () => {
  assert.deepEqual(findBanned('<strong>sure</strong> bet'), ['sure bet']);
  assert.deepEqual(findBanned('sure<br>bet'), ['sure bet']);
  assert.deepEqual(findBanned('fixed</a> match'), ['fixed match']);
  assert.deepEqual(findBanned('can&#8217;t lose'), ["can't lose"]);
  assert.deepEqual(findBanned('can&#x2019;t lose'), ["can't lose"]);
  assert.deepEqual(findBanned('can&rsquo;t lose'), ["can't lose"]);
  assert.deepEqual(findBanned('&#82;OI'), ['ROI'], 'numeric entities decoded generically');
  assert.deepEqual(findBanned('&#x52;&#x4F;&#x49;'), ['ROI']);
  assert.deepEqual(findBanned('profit &amp; loss'), ['profit']);
  assert.deepEqual(findBanned('<p class="x">jack</p><p>pot</p>'), [], 'block tags separate words');
  assert.deepEqual(findBanned('jack<span>pot</span>'), ['jackpot'], 'inline tags join words');
  assert.deepEqual(findBanned('<a href="/bonus-code">link</a>'), [], 'attribute values are not visible text');
  assert.deepEqual(findBanned('&lt;b&gt;sure&lt;/b&gt; bet'), [], 'escaped markup is visible text, not tags (renders as "<b>sure</b> bet")');
  assert.deepEqual(findBanned('a < b and c > d'), [], 'a bare < is text');
});

test('claims: ALLOW phrases are removed before scanning, and only those', () => {
  assert.deepEqual(findBanned('Gamblers Anonymous offers free support.'), []);
  assert.deepEqual(findBanned('gamblers anonymous'), []);
  assert.deepEqual(findBanned('gamblers'), ['gambler']);
  assert.deepEqual(findBanned('Gamblers Anonymous helps gamblers'), ['gambler']);
  assert.deepEqual(findBanned('Gamblers'), ['gambler'], 'half of an ALLOW phrase is not allowed');
});

test('claims: near-misses are not banned', () => {
  for (const t of [
    'fixture', 'fixtures', 'Fixtures of the day', 'kickoff was fixed at 15:00', 'no guarantee of any outcome',
    'guarantee', 'a guarantee', 'bank', 'your bank', 'Android', 'royal', 'we will not', "we won't publish it",
    'we won’t', 'stake', 'never stake what you cannot afford to lose', 'priced 1.20 odds', '120 odds',
    'sure', 'bet', 'win', 'more', 'profiles', 'tokenism-free',
  ]) {
    assert.deepEqual(findBanned(t), [], `should be clean: ${JSON.stringify(t)}`);
  }
});

test('claims: the near-miss boundaries hold in both directions', () => {
  assert.deepEqual(findBanned('guaranteed'), ['guaranteed']);
  assert.deepEqual(findBanned('we won'), ['we won']);
  assert.deepEqual(findBanned('we won.'), ['we won']);
  assert.deepEqual(findBanned('20 odds'), ['20 odds']);
  assert.deepEqual(findBanned('(50 odds)'), ['50 odds']);
});

test('claims: results are canonical, de-duplicated and in BANNED order', () => {
  assert.deepEqual(findBanned('profit, PROFIT, profits and a jackpot'), ['jackpot', 'profit']);
});

test('claims: findBanned refuses a non-string', () => {
  for (const v of [null, undefined, 3, {}, ['x']]) assert.throws(() => findBanned(v), TypeError);
});

// =============================================================================================
// All four pages
// =============================================================================================

for (const name of Object.keys(PAGES)) {
  // Per page (Plan A Task 1b): each page prints its own LAST_UPDATED, so a task can bump one page's date.
  test(`${name}: renders a CSP-clean fragment with its own Last updated line`, () => {
    const mod = PAGES[name];
    const [date, label] = name === 'features' ? [mod.CHECKED, 'Checked'] : [mod.LAST_UPDATED, 'Last updated'];
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(date >= '2026-10-07', 'never earlier than the first published version');
    const line = lastUpdated(date, label);
    const html = renderPage(name);
    assert.equal(typeof html, 'string');
    assert.doesNotMatch(html, /<!doctype|<html|<main/i, 'a body fragment, not a document');
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<style/i);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.ok(html.includes(line), `the page prints ${line}`);
    assert.match(visibleText(line), new RegExp(`^${label} \\d{1,2} [A-Z][a-z]+ \\d{4}$`), 'premise: the line reads as a date');
    assert.ok(visibleText(html).includes(visibleText(line)), 'its visible text carries the date line');
    const opener = line.slice(0, line.indexOf('<time'));
    assert.match(opener, new RegExp(`${label} $`), 'premise: the line opens with its label');
    assert.equal(html.split(opener).length, 2, 'exactly one date line');
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1');
  });

  test(`${name}: META describes the route for the build`, () => {
    const { META } = PAGES[name];
    assert.equal(META.path, `/${name}/`);
    assert.ok(typeof META.title === 'string' && META.title.length > 0);
    assert.ok(typeof META.description === 'string' && META.description.length > 20);
    // SEO 2026-10-19: an upper bound too -- nothing previously stopped a description running well
    // past what a search result actually shows (features.js's own description ran to 216 chars
    // before this existed). ~155-160 is the common truncation point; 170 leaves a little room
    // without being so loose the rule catches nothing.
    assert.ok(META.description.length <= 170, `${name}: description is ${META.description.length} chars, past the ~155-160 a search result shows`);
    assert.deepEqual(findBanned(`${META.title} ${META.description}`), []);
    // These four pages carry no percentage in their meta tags at all. /waitlist/'s description states
    // the offer ("30% off") and is checked in tests/waitlist-page.test.js: offer percentages only.
    assert.doesNotMatch(META.description, /%/);
  });

  test(`${name}: operator identity is shown and escaped`, () => {
    const html = renderPage(name);
    assert.ok(html.includes('Example &amp; Co &lt;Media&gt; Ltd'), 'legal name escaped');
    assert.ok(!html.includes('<Media>'), 'raw legal name never appears');
    assert.ok(html.includes('1 &quot;Example&quot; Road, Ikeja, Lagos'), 'address escaped');
    const email = name === 'privacy' ? OP.privacy_email : OP.contact_email;
    assert.ok(html.includes(`href="mailto:${email}"`), `mailto ${email}`);
  });

  test(`${name}: RC number is printed once as "RC <number>" whatever prefix the config carries (review M6)`, () => {
    for (const rc of ['RC1234567', 'RC 1234567', 'rc  1234567', '1234567']) {
      const t = visibleText(renderPage(name, cfg({ operator: { rc_number: rc } })));
      assert.ok(t.includes('RC 1234567'), `${rc}: shown as RC 1234567`);
      assert.doesNotMatch(t, /RC\s*RC|RC\s*rc|RC1234567/i, `${rc}: no doubled or unspaced prefix`);
    }
  });

  test(`${name}: RC number is omitted when unset and the page still renders`, () => {
    const html = renderPage(name, cfg({ operator: { rc_number: null } }));
    assert.ok(!/\bRC\b/.test(visibleText(html)), 'no dangling RC label');
  });

  test(`${name}: positioning — football data and probability analytics, not a bookmaker`, () => {
    const t = visibleText(renderPage(name));
    assert.doesNotMatch(t, /football match intelligence|probability analytics/);
    if (name === 'features') return; // the spec's intro carries the same sentence on this page
    assert.ok(t.includes("BetGaffer is a sports prediction platform. We're not a bookmaker: we take no bets, hold no stakes and pay no winnings."), 'R-182 line verbatim');
  });

  test(`${name}: no percentage outside an offer figure, and no banned phrase in visible text`, () => {
    const html = renderPage(name, cfg({ pricing: { show_prices: true } }));
    const t = visibleText(html);
    assert.deepEqual(percentagesOutsideOffers(html), [], 'content pages carry percentages only inside an offer figure');
    // Premise: the same check fires on this page for a bare percentage or a wrong offer value, and
    // passes a real offer figure.
    const plant = (frag) => `${html}\n${frag}`;
    assert.ok(percentagesOutsideOffers(plant('<p>30% off</p>')).some((m) => /"30%"/.test(m)), 'bare 30% reported');
    assert.ok(percentagesOutsideOffers(plant('<p><span data-figure="offer">25% off</span></p>')).some((m) => /"25%"/.test(m)), '25% offer reported');
    assert.deepEqual(percentagesOutsideOffers(plant('<p><span data-figure="offer">30% off</span></p>')), [], '30% offer allowed');
    assert.deepEqual(findBanned(t), []);
    assert.doesNotMatch(t, /600\+/);
  });

  test(`${name}: premise — a banned phrase injected into the page is reported`, () => {
    const html = renderPage(name).replace('</h1>', ' sure bet</h1>');
    assert.deepEqual(findBanned(visibleText(html)), ['sure bet']);
    const viaOperator = renderPage(name, cfg({ operator: { legal_name: `${INTERNAL} Ltd` } }));
    assert.deepEqual(findBanned(visibleText(viaOperator)), [INTERNAL]);
  });

  test(`${name}: refuses to render without an operator identity (S8)`, () => {
    const blanked = { ...siteConfig, operator: { ...siteConfig.operator, legal_name: null, address: null, contact_email: null } };
    assert.throws(() => renderPage(name, blanked), /legal_name/);
  });
}

// =============================================================================================
// Legal documents: two columns throughout
// =============================================================================================

for (const name of Object.keys(LEGAL)) {
  test(`${name}: every section carries both columns with the label repeated`, () => {
    const html = renderPage(name);
    const sections = html.split('<section class="ct-sec"').slice(1);
    assert.ok(sections.length >= 4, `${name} has sections (got ${sections.length})`);
    for (const s of sections) {
      const body = s.slice(0, s.indexOf('</section>'));
      assert.match(body, /<h2[^>]*>/, 'section heading');
      assert.equal((body.match(/class="ct-col ct-col--now"/g) || []).length, 1, 'one Now column');
      assert.equal((body.match(/class="ct-col ct-col--launch"/g) || []).length, 1, 'one launch column');
      assert.match(body, /<p class="ct-col__lbl">Now \(this site\)<\/p>/);
      assert.match(body, /<p class="ct-col__lbl">At full launch<\/p>/);
    }
    // The desktop column header is decorative; the per-section labels carry the meaning.
    assert.match(html, /<div class="ct-colhead" aria-hidden="true">/);
    assert.equal(LEGAL[name].SECTION_TITLES.length, sections.length, 'SECTION_TITLES lists every section');
    for (const title of LEGAL[name].SECTION_TITLES) assert.ok(visibleText(html).includes(title), title);
  });

  test(`${name}: contents list links every section anchor`, () => {
    const html = renderPage(name);
    const ids = [...html.matchAll(/<section class="ct-sec" id="([a-z0-9-]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, 'unique ids');
    for (const id of ids) assert.ok(html.includes(`href="#${id}"`), `toc links #${id}`);
  });

  test(`${name}: ends with a "Questions about …" contact block (heading per document, review M6)`, () => {
    const t = visibleText(renderPage(name));
    const heading = name === 'terms' ? 'Questions about these terms' : 'Questions about this policy';
    const other = name === 'terms' ? 'Questions about this policy' : 'Questions about these terms';
    assert.ok(t.includes(heading), heading);
    assert.ok(!t.includes(other), `not: ${other}`);
    const email = name === 'privacy' ? OP.privacy_email : OP.contact_email;
    const at = t.lastIndexOf(heading);
    assert.ok(t.indexOf(email, at) > at, 'the contact block names the address');
    // Spec §9: Terms and Refunds invite a message without promising a reply; Privacy keeps its 30 days.
    const reply = { privacy: 'We reply to every request about your data within 30 days.',
      terms: 'Write to us about these terms.',
      refunds: 'Write to us about refunds.' }[name];
    assert.ok(t.indexOf(reply, at) > at, `contact block says: ${reply}`);
    assert.doesNotMatch(t, /We reply to every message/, 'spec §9: no blanket reply promise');
    assert.doesNotMatch(t, /reads and answers every message|We read every message|answers every message/, 'review M5');
  });
}

// =============================================================================================
// Privacy
// =============================================================================================

test('privacy: NDPA 2023 content, the Cloudflare transfer, retention, rights, breach and children', () => {
  const t = visibleText(renderPage('privacy'));
  for (const s of [
    'Nigeria Data Protection Act 2023',
    'Nigeria Data Protection Commission',
    'your email address and the time you submitted it',
    'This site sets no cookies',
    'Cloudflare Web Analytics',
    'cookieless',
    'Cloudflare, Inc.',
    'United States',
    'at the point you submit',
    'consent',
    'legitimate interest',
    'up to an hour',
    'until 12 months after full launch, and never more than 24 months after you joined, unless you withdraw your consent sooner',
    'within 30 days',
    'within 72 hours',
    'without undue delay',
    'under 18',
    'Paystack',
    'card details never reach us',
    'Google sign-in',
    'no access to any other Google data',
    'by hand',
    '2 years after your last activity',
    'notification preferences',
    'support',
    'access', 'rectification', 'erasure', 'object', 'portability', 'withdraw',
  ]) assert.ok(t.includes(s), `privacy says: ${s}`);
  assert.match(renderPage('privacy'), /href="https:\/\/ndpc\.gov\.ng\/?"/);
});

test('privacy: never claims a mechanism that does not exist', () => {
  const t = visibleText(renderPage('privacy'));
  assert.doesNotMatch(t, /Standard Contractual Clauses|SCCs?\b/);
  assert.doesNotMatch(t, /DPO:|our DPO|Data Protection Officer is/i);
  assert.doesNotMatch(t, /\/account\/delete|self-service tool (?:lets|allows)|delete it yourself/i);
  assert.doesNotMatch(t, /we sell your/i);
});

test('privacy: review I1-I4, I6-I8 wording is exact', () => {
  const t = visibleText(renderPage('privacy'));
  for (const s of [
    // I1
    "Access to them is limited to the operator, through the operator's Cloudflare account and the site code the operator deploys.",
    // I2
    'Data protection law in the United States may protect your address less than Nigerian law does.',
    // I4
    'counts sign-up attempts from each IP address (for IPv6, each /56 network) using a keyed one-way hash of that address, held only in Cloudflare\'s short-term cache for up to an hour, never stored with your email address.',
    // I6
    'This site sets no cookies.',
    "If Cloudflare's security check challenges your connection, Cloudflare may set one strictly necessary cookie (cf_clearance) to remember that you passed.",
    // I7
    'until 12 months after full launch, and never more than 24 months after you joined, unless you withdraw your consent sooner.',
    // I8
    'We use it only to create your account and sign you in. We do not share it, and we delete it when you close your account.',
  ]) assert.ok(t.includes(s), `privacy says: ${s}`);
  // I3: no statement about a DPO in the Now column; the contact sentence stays.
  assert.doesNotMatch(t, /We have not appointed a data protection officer/);
  assert.ok(t.includes('For anything in this policy, email privacy@example.com'));
  // Superseded wording is gone.
  assert.doesNotMatch(t, /can be reached only through|at most one hour|counts attempts per visitor|whichever is sooner/);
});

test('privacy: the operator mailbox is disclosed in sharing and transfers (review I5)', () => {
  assert.equal(siteConfig.operator.mailbox_provider, null, 'config default is null');
  assert.doesNotThrow(() => renderPage('privacy', cfg({ operator: { mailbox_provider: null } })), 'not required');
  const sentence = (p) => `Emails you send us are forwarded by Cloudflare to the operator's mailbox, hosted by ${p}, which may store them outside Nigeria.`;
  const dflt = visibleText(renderPage('privacy', cfg({ operator: { mailbox_provider: null } })));
  assert.ok(dflt.includes(sentence('an email provider')), 'default provider wording');
  const html = renderPage('privacy', cfg({ operator: { mailbox_provider: 'Mail <Co> & Sons' } }));
  assert.ok(html.includes('Mail &lt;Co&gt; &amp; Sons') && !html.includes('<Co>'), 'escaped');
  assert.ok(visibleText(html).includes(sentence('Mail <Co> & Sons')), 'named provider');
  // Covered in the transfers section too.
  const transfers = html.slice(html.indexOf('id="transfers-outside-nigeria"'));
  const tx = visibleText(transfers.slice(0, transfers.indexOf('</section>')));
  assert.match(tx, /Emails you send us/);
  assert.match(tx, /Mail <Co> & Sons/);
  assert.match(tx, /outside Nigeria/);
});

test('privacy: privacy_email defaults to contact_email when unset', () => {
  const html = renderPage('privacy', cfg({ operator: { privacy_email: null } }));
  assert.ok(html.includes('href="mailto:hello@example.com"'));
  assert.ok(!html.includes('privacy@example.com'));
});

// =============================================================================================
// Terms
// =============================================================================================

test('terms: not advice, no guarantee, estimates, 18+, not a bookmaker, FCCPA, Lagos, responsible play', () => {
  const html = renderPage('terms');
  const t = visibleText(html);
  for (const s of [
    'not betting advice',
    'no guarantee of any outcome',
    'estimates',
    'can be wrong',
    'Past results do not predict future results',
    'aged 18 and over',
    'We are not a bookmaker',
    'We take no bets',
    'Federal Competition and Consumer Protection Act 2018',
    'Federal Republic of Nigeria',
    'courts of the Federal Capital Territory, Abuja',
    'Responsible play',
    'Never stake what you cannot afford to lose',
    'Take a break when it stops being fun',
    'Gamblers Anonymous',
    'Credits',
    'auto-renewal',
    'reminder',
    'suspend',
    'This site provides no booking codes',
    'You may quote our published cards and record if you name Bet Gaffer and link to betgaffer.com.',
  ]) assert.ok(t.includes(s), `terms says: ${s}`);
  assert.match(html, /<a href="https:\/\/www\.gamblersanonymous\.org"[^>]*>/);
  // Spec §10: no licence link, no repository, no open-source sentence (the repository's own LICENSE
  // still governs the code); the quoting permission names betgaffer.com, not "this site".
  for (const gone of ['LICENSE-CONTENT', 'public repository', 'open source', 'with attribution', 'a link to this site']) {
    assert.ok(!t.includes(gone), `terms no longer says: ${gone}`);
  }
  assert.doesNotMatch(html, /github|LICENSE-CONTENT/i);
  // Every link left on the page is a mailto, a same-site path or Gamblers Anonymous.
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
    assert.match(href, /^(?:mailto:|\/(?!\/)|#|https:\/\/www\.gamblersanonymous\.org$)/, href);
  }
});

test('terms: ownership and liability wording (review I9, M4)', () => {
  const html = renderPage('terms');
  const t = visibleText(html);
  assert.ok(t.includes("Our probabilities, picks, record and the site's text are © Example & Co <Media> Ltd. "
    + 'Fixture details, team and competition names, and bookmaker prices belong to their owners.'), 'I9');
  assert.ok(html.includes('© Example &amp; Co &lt;Media&gt; Ltd') || html.includes('&copy; Example &amp; Co &lt;Media&gt; Ltd'), 'I9 escaped');
  assert.doesNotMatch(t, /published data are ©/, 'I9 old claim gone');
  assert.ok(t.includes('The terms for paid plans will set out any limits on our liability.'), 'M4');
  assert.doesNotMatch(t, /linked to what you have paid us/, 'M4 old wording gone');
});

test('terms: booking codes are never described as working today', () => {
  const t = visibleText(renderPage('terms'));
  assert.doesNotMatch(t, /booking codes? (?:are|is) available/i);
  assert.doesNotMatch(t, /(?:copy|use|get) (?:a|your|our) booking code/i);
});

// =============================================================================================
// Refunds
// =============================================================================================

test('refunds: nothing sold now; cancel, 7-day cooling-off, billing errors, Paystack timing, chargebacks', () => {
  const t = visibleText(renderPage('refunds'));
  for (const s of [
    'Nothing is sold on this site, so there is nothing to refund',
    'Cancel any time',
    'end of the period you have paid for',
    '7-day cooling-off',
    'first-time subscribers',
    'limited use',
    'published with the prices',
    'billing error',
    'Federal Competition and Consumer Protection Act 2018',
    'through Paystack',
    'We start an agreed refund within 5 business days; how long it then takes to reach you depends on your bank.',
    'chargeback',
    // M3
    'we will refund that first payment in full if you ask within 7 days of making it',
  ]) assert.ok(t.includes(s), `refunds says: ${s}`);
  assert.doesNotMatch(t, /within a few business days/, 'M2 old wording gone');
});

test('refunds: a Credits section in both columns (review M1)', () => {
  const html = renderPage('refunds');
  assert.ok(refunds.SECTION_TITLES.includes('Credits'));
  const at = html.indexOf('<section class="ct-sec" id="credits"');
  assert.ok(at > -1, 'credits section');
  const sec = html.slice(at, html.indexOf('</section>', at));
  const now = visibleText(sec.slice(sec.indexOf('ct-col--now'), sec.indexOf('ct-col--launch')));
  const launch = visibleText(sec.slice(sec.indexOf('ct-col--launch')));
  assert.ok(now.includes('No Credits exist.'), now);
  // Spec §9 (F11): Credits and top-ups are never refundable.
  assert.ok(launch.includes('Credits, including top-ups and any unused balance, are not refundable and have no cash value. '
    + 'The only exceptions are a charge we made in error, or where the law requires a refund.'), launch);
  assert.doesNotMatch(visibleText(html), /are refundable on request|bought in the last 7 days/, 'the old refundable-Credits sentence is gone');
});

// =============================================================================================
// Policy pages, Plan A Task 7 (spec §4, §9): founding programme terms, Credits never refundable,
// honest contact lines, privacy updates. Task 6 owns the features cases below.
// =============================================================================================

describe('policy pages (Plan A Task 7, spec §4 and §9)', () => {
  const section = (html, id) => {
    const at = html.indexOf(`<section class="ct-sec" id="${id}"`);
    assert.ok(at > -1, `section #${id}`);
    const end = html.indexOf('</section>', at);
    assert.ok(end > at, `section #${id} is closed`);
    return html.slice(at, end + '</section>'.length);
  };
  // The two columns' visible text, sliced at tag boundaries so no attribute text leaks in.
  const cols = (sec) => {
    const nowAt = sec.indexOf('>', sec.indexOf('class="ct-col ct-col--now"')) + 1;
    const launchTag = sec.lastIndexOf('<div', sec.indexOf('class="ct-col ct-col--launch"'));
    const launchAt = sec.indexOf('>', launchTag) + 1;
    assert.ok(nowAt > 0 && launchTag > nowAt, 'premise: both columns found');
    return { now: visibleText(sec.slice(nowAt, launchTag)), launch: visibleText(sec.slice(launchAt)) };
  };
  const n = (v) => v.toLocaleString('en-US');

  test('the three policy pages are dated 8 October 2026', () => {
    for (const mod of [terms, refunds, privacy]) assert.equal(mod.LAST_UPDATED, '2026-10-08');
  });

  test('terms: a "Founding Member Programme" section, id="founding", right after subscriptions, in the contents', () => {
    const html = renderPage('terms');
    const ids = [...html.matchAll(/<section class="ct-sec" id="([a-z0-9-]+)"/g)].map((m) => m[1]);
    assert.equal(ids[ids.indexOf('subscriptions') + 1], 'founding', `order: ${ids.join(', ')}`);
    assert.ok(terms.SECTION_TITLES.includes('Founding Member Programme'));
    assert.match(section(html, 'founding'), /<h2 class="ct-sec__h" id="founding-h">.*Founding Member Programme<\/h2>/);
    assert.ok(html.includes('href="#founding"'), 'contents link');
  });

  test('terms #founding: the Now column is the spec §4 text', () => {
    const { now } = cols(section(renderPage('terms'), 'founding'));
    assert.equal(now, `Now (this site) Joining the founding waitlist reserves one of ${F.WAITLIST_PLACES} waitlist places for the first `
      + `${F.WAITLIST_PLACES} people to join. It costs nothing and creates no account. Founding status itself starts only when you `
      + 'start a paid subscription after launch.');
  });

  test('terms #founding: every programme number, read from site/lib/founding.js', () => {
    const sec = section(renderPage('terms'), 'founding');
    const { launch } = cols(sec);
    for (const s of [
      `${n(F.TOTAL_PLACES)} founding places`, `${n(F.WAITLIST_PLACES)} waitlist places`, `${n(F.LAUNCH_PLACES)} launch places`,
      `within ${F.CLAIM_DAYS} days of the invite`, `${F.GRACE_DAYS} days' grace`, `at least ${F.EARLY_ACCESS_HOURS} hours`,
      `within ${F.SUPPORT_REPLY_HOURS} hours`, `${F.DISCOUNT_PCT}% off`, `${F.TOPUP_BONUS_PCT}% extra`, 'Double plan Credits',
      'double the plan', 'counts twice',
    ]) assert.ok(launch.includes(s), `founding launch column says: ${s}`);
    assert.equal(F.TOTAL_PLACES, F.WAITLIST_PLACES + F.LAUNCH_PLACES, 'premise: 500 + 500 = 1,000');
    // Every percentage is an offer figure, and only the two offer numbers appear.
    assert.deepEqual(percentagesOutsideOffers(sec), []);
    const pcts = [...visibleText(sec).matchAll(/\d+%/g)].map((m) => m[0]);
    assert.ok(pcts.length >= 2, 'premise: the section prints its percentages');
    assert.deepEqual([...new Set(pcts)].sort(), [`${F.TOPUP_BONUS_PCT}%`, `${F.DISCOUNT_PCT}%`].sort());
    assert.ok((sec.match(/<span data-figure="offer">/g) || []).length >= 2);
  });

  test('terms #founding: the programme rules (§1-§3) in plain sentences', () => {
    const { launch } = cols(section(renderPage('terms'), 'founding'));
    for (const s of [
      `The total is always ${n(F.TOTAL_PLACES)}.`,
      'first come, first served by the date of their first paid subscription',
      'subscribing before the invite arrives also claims it',
      `People who join after the first ${n(F.WAITLIST_PLACES)} stay on the waitlist and are invited too, with a head start on one of the launch places.`,
      'Free trials and the free account never count.',
      'refunded (including the 7-day cooling-off refund) or charged back does not count, and any place it earned is released',
      'matched to the account opened with the same address (letter case is ignored)',
      'aliases such as +tags or Gmail dots, hold one place',
      'not transferable',
      'no cash value',
      "It doesn't combine with other percentage discounts, such as a challenge reward: the bigger one applies to that payment.",
      'We will not reduce your founding benefits while you hold the status.',
      'founding members get an equal or better replacement, with 30 days\' notice',
      'It also ends if you close your account, or if we close it for a breach of these terms or fraud',
      `you have ${F.GRACE_DAYS} days' grace from the end of that period`,
      'Turning off auto-renewal is not a lapse while your paid period runs.',
      'ranked highest by how early they first paid, how consistently they have subscribed and how much they have spent',
      'Fixes, security updates and changes the law requires go to everyone at once.',
    ]) assert.ok(launch.includes(s), `founding launch column says: ${s}`);
  });

  test('terms #founding: one release rule, the claiming payment, notice from founding.js, verified phone (Task 7 review)', () => {
    const { launch } = cols(section(renderPage('terms'), 'founding'));
    for (const s of [
      // I1: unclaimed waitlist places and later releases follow two separate, non-contradicting rules.
      'Waitlist places not claimed in time go to the earliest-paying subscriber without a place: first come, first served by the date of their first paid subscription.',
      'A place released later passes as set out under "When it ends".',
      // 5
      'Founding status starts with the first paid subscription that claims a place: a successful payment for a paid plan.',
      // 6
      `founding members get an equal or better replacement, with ${F.NOTICE_DAYS} days' notice.`,
      // 8 (operator decision): claiming a founding place requires a verified phone number.
      'claiming a place requires a verified phone number',
      // 9
      `Double plan Credits means double the plan's monthly Credit allowance, every month, and the limit on how many plan Credits you can hold is doubled too. As for every member, new plan Credits aren't added while you're at that limit. Top-ups get ${F.TOPUP_BONUS_PCT}% extra Credits instead, not double.`,
    ]) assert.ok(launch.includes(s), `founding launch column says: ${s}`);
    for (const gone of ['and any place released later, go to', 'a verified phone number is checked', 'never double',
      'Founding status starts with your first paid subscription']) {
      assert.ok(!launch.includes(gone), `no longer says: ${gone}`);
    }
    // The release sentence points at a section part that exists.
    assert.ok(launch.includes('When it ends.'), 'the "When it ends" part exists');
  });

  test('terms: no "100%" anywhere, double Credits worded "double", programme §5 omitted', () => {
    const t = visibleText(renderPage('terms'));
    assert.doesNotMatch(t, /100\s*%|100 per ?cent/i);
    assert.doesNotMatch(t, /countdown|launch date/i);
    assert.deepEqual(findBanned(t), []);
  });

  test('terms: Credits are not refundable; a Lab Credit return is not a refund', () => {
    const { launch } = cols(section(renderPage('terms'), 'credits'));
    assert.ok(launch.includes('Credits and top-ups are not refundable, except a charge we made in error or where the law requires a refund (see the refund policy). Credits returned when a Lab slip you marked as played '
      + 'loses are a Credit return, not a refund.'), launch);
  });

  test('refunds: the cooling-off refund covers the subscription payment only', () => {
    const { launch } = cols(section(renderPage('refunds'), 'cooling-off'));
    assert.ok(launch.includes('we will refund that first payment in full if you ask within 7 days of making it.'), 'kept');
    assert.ok(launch.includes('This covers the subscription payment only, not Credit top-ups.'), launch);
  });

  test('privacy: the waitlist address is used only for the invite, its 30-day claim and matching the account', () => {
    const { now } = cols(section(renderPage('privacy'), 'why-and-lawful-basis'));
    for (const s of [
      'Your waitlist address is used only to send your invite and to match it to the account you open with it.',
      `If you are among the first ${F.WAITLIST_PLACES} people to join, your invite offers you a founding place, which you claim by starting a paid subscription in the ${F.CLAIM_DAYS} days after the invite.`,
    ]) assert.ok(now.includes(s), `privacy says: ${s}`);
    const t = visibleText(renderPage('privacy'));
    assert.doesNotMatch(t, /used only to tell you when your invite is ready/, 'old purpose gone');
    // Review minor 7: the purpose is stated once, not restated.
    assert.doesNotMatch(t, /At launch we use your address only/, 'no restatement of the purpose');
  });

  test('privacy: the launch column adds the phone number verified to claim a founding place (operator decision)', () => {
    const { now, launch } = cols(section(renderPage('privacy'), 'what-we-collect'));
    assert.ok(launch.includes("A phone number, which you'll verify to claim a founding place and which we'll use if you join the founding-members WhatsApp community."), launch);
    assert.ok(now.includes('no phone number'), 'today: still no phone number');
  });

  test('privacy: WhatsApp is not listed as our processor; its own handling of your number is disclosed (Task 7 review I2)', () => {
    const html = renderPage('privacy');
    const sec = section(html, 'who-we-share-it-with');
    const { launch } = cols(sec);
    const processors = sec.slice(sec.indexOf('<ul>'), sec.indexOf('</ul>'));
    assert.ok(processors.includes('Paystack'), 'premise: this is the processors list');
    assert.doesNotMatch(processors, /WhatsApp/, 'WhatsApp is not a processor');
    assert.ok(sec.indexOf('WhatsApp') > sec.indexOf('</ul>'), 'the WhatsApp line follows the list');
    assert.ok(launch.includes('If you choose to join the founding-members WhatsApp community, WhatsApp (Meta) handles your phone number '
      + 'under its own terms and privacy policy, and other members of the community may see it.'), launch);
    const basis = cols(section(html, 'why-and-lawful-basis')).launch;
    assert.ok(basis.includes('Consent: marketing messages, optional notifications and joining the founding-members WhatsApp community'), basis);
  });

  test('privacy: consent is asked before any other use of waitlist addresses', () => {
    const t = visibleText(renderPage('privacy'));
    assert.ok(t.includes('If we ever want to use waitlist addresses for anything other than sending your invite and matching it to your account, we will ask for your consent first.'));
  });
});

// =============================================================================================
// Features (Plan A Task 6, spec §8) — simplest to most advanced, problem then answer.
// Kept in one describe block so Task 7's policy blocks merge mechanically. Import declarations are
// hoisted, so the ones this block alone needs sit here rather than in the shared header.
// =============================================================================================

import { parse, findAll, find, textOf } from './html-scan.js';
import { TOTAL_PLACES } from '../site/lib/founding.js';

test('shipped config: operator identity and published prices', async () => {
  const { default: shipped } = await import('../site/config.js');
  assert.equal(shipped.operator.legal_name, 'BETGAFFER LTD');
  assert.equal(shipped.operator.rc_number, '9885410');
  assert.equal(shipped.operator.contact_email, 'support@betgaffer.com');
  assert.equal(shipped.pricing.show_prices, true);
  assert.deepEqual(shipped.pricing.tiers.map((t) => [t.name, t.monthly]),
    [['Free account', 0], ['Starter', 1500], ['Pro', 3000], ['Elite', 5000]]);
});

describe('features (teaser copy spec 2026-11-12, section A)', () => {
  const PRICING_INTENT = 'Nothing is sold on this site. At launch Bet Gaffer will offer a free account and paid '
    + 'monthly and yearly plans priced in naira, VAT-inclusive, billed through Paystack.';
  const PRICES_LATER = 'Prices will be published on BetGaffer before any payment is taken.';
  const INTRO = [
    'BetGaffer is a sports prediction platform. We cover football today, and other sports will follow.',
    "We're not a bookmaker: we take no bets and never hold your stake.",
    "BetGaffer opens at launch. Here's what it will do.",
  ];

  // Spec rows 1-9 and 11-13 (10, Results by day, is omitted until Legal's condition is met).
  // [name, problem, what we do, label]
  const SPEC = [
    ['Predictions', "Bookmaker odds show a price, with the bookmaker's margin built in.",
      "The day's fixtures, with our probabilities for the markets your plan covers.", 'At launch'],
    ['One recommended pick', "Every match has dozens of markets, and that's too many choices.",
      "On a match where we recommend a pick, it's one pick for that match: the outcome our model rates best.", 'At launch'],
    ['Match pages', 'Checking one match means jumping between apps.',
      'One page per match, with all the markets your plan covers for it.', 'At launch'],
    ['League, team and country pages', 'Finding out how a team has really been playing takes digging.',
      "Country: every competition we cover there, plus its national side and today's fixtures. League: the table, trends in context, "
      + "today's fixtures and the cups those clubs play. Team: form and tendencies first, then fixtures. Guests see fixtures, results "
      + 'and form tiles only; our statistics, charts and rating are for members whose plan covers that league.', 'At launch'],
    ['National team pages', 'National sides play rarely, so their form is hard to follow.',
      "A page for each national side we cover: men's, women's and youth.", 'At launch'],
    ['Coverage', "It isn't always clear which leagues a service covers.",
      'Which leagues each plan covers, grouped by country.', 'At launch'],
    ['Daily Slips', 'Building a slip from scratch takes time.',
      "Ready-made slips, from lower to higher odds, built from our model's picks.", 'At launch'],
    ['Ask Gaffer', 'A slip can look strong and still hide a weak leg.',
      'Gaffer is our AI football assistant. Bring your slip, and Gaffer finds the weak legs. Gaffer comes with some plans.', 'At launch'],
    ['Our Record', 'Anyone can claim a big number.',
      'Every recommended pick is graded in public after full time, misses included, month by month.', 'At launch'],
    ['Credits', "Some features you'll only want now and then.",
      'Monthly Credits on plans that include them, and top-ups on any plan.', 'At launch'],
    ['Breaks and limits', 'Betting should stay fun, and sometimes that means a break.',
      'Profile, billing, notifications, limits on buying Credits, and Breaks & limits: email us to take a break (self-exclusion) '
      + 'and we set it up. When it ends, you ask for your access back, and it returns 24 hours later.', 'At launch'],
    ['Blog and Learn', 'Words like 1UP or GG on a slip can be confusing.',
      'Plain guides to how bets work and settle.', 'Live now'],
  ];
  const COMING = [
    ['The Lab', 'Building a ticket to a target takes ages.',
      "Coming at launch: the Lab, where you'll be able to set your stake and target odds and get a ticket built from our model's rated picks, to your rules."],
    ['Power Picks', null,
      'Coming soon: Power Picks, our recommended picks on the matches we single out, on the plans that include them.'],
    ['Booking codes', 'Typing a ticket in leg by leg is slow.',
      "Coming at launch: turn a ticket into a SportyBet booking code, where SportyBet offers its markets."],
  ];

  // The rendered page has no <body>, so wrap it for the strict scanner (it also proves the markup
  // nests the way a browser builds it: no block inside a <p>, nothing left open).
  const doc = (html) => parse(`<body>${html}</body>`);
  const cls = (n, c) => (n.attrs.class || '').split(/\s+/).includes(c);
  const articles = (html) => findAll(doc(html), (n) => n.tag === 'article' && cls(n, 'ct-feature'));
  const partOf = (art, c) => find(art, (n) => cls(n, c));
  const render = (c = cfg()) => features.render({ ...c, blog: true });
  const rowsOf = (html) => articles(html).slice(0, SPEC.length);
  const h3Of = (a) => textOf(find(a, (n) => n.tag === 'h3'));

  test('CHECKED is 12 November 2026 and the byline reads "Checked", not "Last updated"', () => {
    assert.equal(features.CHECKED, '2026-11-12');
    const html = render();
    assert.ok(html.includes(lastUpdated('2026-11-12', 'Checked')));
    assert.ok(visibleText(html).includes('Checked 12 November 2026'));
    assert.ok(!visibleText(html).includes('Last updated'));
  });

  test('H1 is "What BetGaffer will do" and matches the meta; intro lines verbatim', () => {
    const d = doc(render());
    const h1 = findAll(d, (n) => n.tag === 'h1');
    assert.equal(h1.length, 1);
    assert.equal(textOf(h1[0]), 'What BetGaffer will do');
    assert.ok(features.META.description.startsWith('What BetGaffer will do at launch: '));
    assert.equal(features.META.fullTitle, 'Features | BetGaffer');
    assert.deepEqual(findAll(d, (n) => n.tag === 'p' && cls(n, 'ct-lead')).map(textOf), INTRO);
  });

  test('12 rows in spec order: name, problem, answer verbatim; "Results by day" absent', () => {
    const arts = rowsOf(render());
    assert.equal(arts.length, 12);
    assert.deepEqual(arts.map(h3Of), SPEC.map(([n]) => n));
    for (const [i, a] of arts.entries()) {
      const [name, problem, answer] = SPEC[i];
      assert.equal(textOf(partOf(a, 'ct-feature__problem')), `The problem: ${problem}`, name);
      assert.equal(textOf(partOf(a, 'ct-feature__answer')), `What we do: ${answer}`, name);
    }
    assert.ok(!visibleText(render()).includes('Results by day'));
  });

  test('the label sits on every row itself: "At launch" on rows 1-11, "Live now" on the blog row', () => {
    assert.equal(SPEC.filter(([, , , l]) => l === 'At launch').length, 11, 'premise: eleven At launch rows');
    for (const [i, a] of rowsOf(render()).entries()) {
      const tag = partOf(a, 'ct-feature__tag');
      assert.ok(tag, `${SPEC[i][0]}: a label inside the row`);
      assert.equal(textOf(tag), SPEC[i][3], SPEC[i][0]);
    }
  });

  test('only the blog row links, and it goes to /blog/', () => {
    const hrefs = rowsOf(render()).map((a) => findAll(a, (n) => n.tag === 'a').map((n) => n.attrs.href));
    assert.deepEqual(hrefs.slice(0, 11), Array(11).fill([]));
    assert.deepEqual(hrefs[11], ['/blog/']);
  });

  test("What's coming: H2 and the Lab, Power Picks, Booking codes lines verbatim (no problem line on Power Picks)", () => {
    const html = render();
    assert.ok(findAll(doc(html), (n) => n.tag === 'h2').map(textOf).includes("What's coming"));
    const arts = articles(html).slice(SPEC.length);
    assert.equal(arts.length, 3);
    for (const [i, a] of arts.entries()) {
      const [name, problem, answer] = COMING[i];
      assert.equal(h3Of(a), name);
      const p = partOf(a, 'ct-feature__problem');
      if (problem === null) assert.ok(!p, `${name}: no problem line`);
      else assert.equal(textOf(p), `The problem: ${problem}`, name);
      assert.equal(textOf(partOf(a, 'ct-feature__answer')), `What we do: ${answer}`, name);
    }
  });

  // Large-screen bento (R-214(2)): span 4 = hero, 2 = normal; an unfinished row widens evenly.
  test('bentoSpans: rows always sum to 6, order kept, heroes pair with one normal tile', () => {
    const N = false;
    const H = true;
    for (const [name, heroes, want] of [
      ['all normal, full rows', [N, N, N, N, N, N], [2, 2, 2, 2, 2, 2]],
      ['hero then normal', [H, N], [4, 2]],
      ['normal then hero', [N, H], [2, 4]],
      ['unfinished last row: two tiles', [N, N, N, N, N], [2, 2, 2, 3, 3]],
      ['unfinished last row: one tile', [N, N, N, N], [2, 2, 2, 6]],
      ['a lone tile', [N], [6]],
      ['a lone hero', [H], [6]],
      ['hero closes a short row: two normals widen', [N, N, H, N], [3, 3, 4, 2]],
      ['hero followed by hero: the first widens', [H, H, N], [6, 4, 2]],
      ['empty', [], []],
      ['the shipped 12 (Predictions, Ask Gaffer, Our Record)', [H, N, N, N, N, N, N, H, H, N, N, N], [4, 2, 2, 2, 2, 3, 3, 6, 4, 2, 3, 3]],
    ]) {
      const got = features.bentoSpans(heroes);
      assert.deepEqual(got, want, name);
      let acc = 0;
      for (const s of got) { acc += s; assert.ok(acc <= 6, `${name}: a row overflows`); if (acc === 6) acc = 0; }
      assert.equal(acc, 0, `${name}: no row ends in a hole`);
    }
  });

  test('every ladder step carries data-span (heroes 4, the rest 2 or widened), in both lists', () => {
    const html = render();
    const spans = (id) => findAll(find(doc(html), (n) => n.attrs['aria-labelledby'] === id), (n) => n.tag === 'li' && cls(n, 'ct-ladder__step')).map((n) => Number(n.attrs['data-span']));
    const feats = spans('ct-feats-h');
    assert.deepEqual(feats, features.bentoSpans(features.ROWS.map((r) => r.hero === true)));
    assert.equal(feats.length, 12);
    assert.deepEqual(spans('ct-coming-h'), [2, 2, 2]);
    assert.deepEqual(features.ROWS.filter((r) => r.hero).map((r) => r.name), ['Predictions', 'Ask Gaffer']);
    // Two heroes pack the 12 rows with one widened pair and no lone full-width tile (the 3-hero set left Ask Gaffer alone).
    assert.deepEqual(feats, [4, 2, 2, 2, 2, 3, 3, 4, 2, 2, 2, 2]);
    assert.doesNotMatch(html, /\sstyle=/);
  });

  test('removed phrases and unverified features are absent', () => {
    const t = visibleText(render(cfg({ pricing: { show_prices: true } }))).toLowerCase();
    for (const s of ['Power Teams', 'landed', 'sport investors', 'match intelligence', 'Credits back', 'match clock',
      'accuracy ring', 'Same-game', 'Live scores', 'Early results', 'Results by day']) {
      assert.ok(!t.includes(s.toLowerCase()), `absent: ${s}`);
    }
    assert.doesNotMatch(t, /up to [\d,]+ per match/, 'no breadth number');
  });

  test('with the blog off there is no blog row and no /blog/ link', () => {
    const html = features.render(cfg());
    assert.equal(articles(html).length, 14);
    assert.doesNotMatch(html, /\/blog\/|Blog and Learn/);
  });

  test('left off on purpose: no unlaunched or banned surface, no form', () => {
    const html = render(cfg({ pricing: { show_prices: true } }));
    const t = visibleText(html);
    for (const s of ['Exposure', 'Steam', 'Green Month', 'cash out', 'ROI',
      'swap any leg', 'odds you want', 'Life Changer', '50x', 'Guarantee', 'suggested stake']) {
      assert.ok(!t.toLowerCase().includes(s.toLowerCase()), `absent: ${s}`);
    }
    assert.doesNotMatch(html, /<form/i);
    assert.deepEqual(findBanned(t), []);
    assert.doesNotMatch(t, /Token/);
    assert.doesNotMatch(t, /accura|\bwin\b|\bwinning\b|value bet|\bedge\b|beat the/i);
  });

  test('pricing: intent kept, tier table from config, Elite at ₦5,000 in the shipped config', () => {
    const shipped = features.render(siteConfig);
    assert.match(shipped, /<table class="bg-table ct-tiers">/);
    assert.match(shipped, /<th scope="row">Elite<\/th><td class="num" data-label="Monthly">₦5,000<\/td>/);
    assert.ok(visibleText(shipped).includes(PRICING_INTENT));
    const st = visibleText(shipped);
    assert.ok(st.includes('Monthly, in naira, VAT-inclusive. Paid plans differ by the competitions and tools they include.'), st);
    assert.ok(!st.includes('Nothing is charged on this site.'), 'PRICING_INTENT already says nothing is sold; no repeat');
    assert.equal(st.split('Nothing is sold on this site.').length, 2, 'the "nothing is sold" sentence appears exactly once');
  });

  test('pricing: no figures when show_prices is off (S9)', () => {
    const html = render(cfg({ pricing: { show_prices: false } }));
    const t = visibleText(html);
    assert.ok(t.includes(PRICING_INTENT) && t.includes(PRICES_LATER));
    assert.doesNotMatch(t, /₦/);
    assert.doesNotMatch(html, /ct-tiers/);
  });

  test('pricing: show_prices renders the tier table instead of the last sentence', () => {
    const html = render(cfg({ pricing: { show_prices: true } }));
    const t = visibleText(html);
    assert.ok(t.includes(PRICING_INTENT) && !t.includes(PRICES_LATER));
    for (const [n, p] of [['Free', '₦0'], ['Plus', '₦1,250'], ['Max', '₦20,000']]) {
      assert.match(html, new RegExp(`<th scope="row">${n}</th><td class="num" data-label="Monthly">${p}</td>`), n);
    }
  });

  test('pricing: tiers are escaped and validated; no tiers refuses to render', () => {
    const html = render(cfg({ pricing: { show_prices: true, tiers: [{ name: 'A<b>', monthly: 1234567 }] } }));
    assert.ok(html.includes('A&lt;b&gt;') && html.includes('₦1,234,567'));
    for (const tiers of [[{ name: '', monthly: 1 }], [{ name: 'X', monthly: -1 }], [{ name: 'X', monthly: 1.5 }]]) {
      assert.throws(() => render(cfg({ pricing: { show_prices: true, tiers } })), TypeError, JSON.stringify(tiers));
    }
    for (const tiers of [[], null]) {
      assert.throws(() => render(cfg({ pricing: { show_prices: true, tiers } })), /pricing\.tiers/, JSON.stringify(tiers));
    }
  });

  test('founding summary inside an offer figure, and the primary button to /waitlist/', () => {
    const html = render();
    const d = doc(html);
    const sec = find(d, (n) => n.tag === 'section' && cls(n, 'ct-founding'));
    assert.ok(sec, 'a founding section');
    const offer = find(sec, (n) => n.attrs['data-figure'] === 'offer');
    assert.ok(offer, 'the summary is an offer figure');
    assert.equal(textOf(offer), 'Founding members get 30% off subscription payments while they stay subscribed · double plan Credits · 20% extra on top-ups · early access to new features · priority support');
    assert.equal(TOTAL_PLACES, 1000, 'premise: the heading prints 1,000');
    assert.equal(textOf(find(sec, (n) => n.tag === 'h2')), 'Be one of our 1,000 founding members.');
    const terms = findAll(sec, (n) => n.tag === 'a' && n.attrs.href === '/terms/#founding');
    assert.equal(terms.length, 1);
    assert.equal(textOf(terms[0]), 'When each benefit starts: Subscription Terms');
    const btn = findAll(sec, (n) => n.tag === 'a' && cls(n, 'bg-btn--primary'));
    assert.equal(btn.length, 1);
    assert.equal(btn[0].attrs.href, '/waitlist/');
    assert.equal(textOf(btn[0]), 'Join the founding waitlist');
    assert.deepEqual(percentagesOutsideOffers(html), []);
    // Order: the features, then pricing, then the founding summary.
    const at = (c) => html.indexOf(`class="ct-fsec ${c}`);
    assert.ok(html.indexOf('ct-ladder') > -1 && html.indexOf('ct-ladder') < at('ct-pricing') && at('ct-pricing') < at('ct-founding'));
  });

  test('the embedded waitlist form is gone (the form lives on /waitlist/)', () => {
    const plain = features.render(cfg());
    assert.doesNotMatch(plain, /<form\b|data-waitlist|action="\/api\/waitlist"/);
    assert.ok(!/Founding waitlist<\/h2>/.test(plain));
    assert.equal(features.render.length, 1, 'render(cfg): no options argument left over from the embedded form');
  });

  test('no repository card, no GitHub link or mention (spec §10)', () => {
    const html = render();
    assert.doesNotMatch(visibleText(html), /Receipts you can check|reposit|commit\b/i);
    assert.doesNotMatch(html, /github/i);
    assert.ok(!html.includes('geezerz/betgaffer-site'), 'the repo slug never reaches the page');
    for (const name of ['features', 'terms']) {
      const other = { ...cfg(), repo: 'some-org/other.site' };
      assert.notEqual(other.repo, cfg().repo);
      assert.equal(renderPage(name, other), renderPage(name), name);
    }
  });

  test('premise: the row checks fire on a broken page', () => {
    const html = render();
    const items = html.match(/<li class="ct-ladder__step"[^>]*>[\s\S]*?<\/li>/g);
    const swapped = html.replace(items[0], '@@SWAP@@').replace(items[1], items[0]).replace('@@SWAP@@', items[1]);
    assert.notDeepEqual(articles(swapped).map(h3Of).slice(0, 12), SPEC.map(([n]) => n));
    const noLabel = html.replace('<p class="ct-feature__tag">At launch</p>', '');
    assert.equal(rowsOf(noLabel).filter((a) => partOf(a, 'ct-feature__tag')).length, 11);
  });
});

test('Terms: priority support is stated as Legal cleared it (Addendum 3, c976fd471)', () => {
  const html = terms.render(cfg());
  assert.ok(html.includes("<p>Priority support means a first reply from a person within 24 hours of a message to support@betgaffer.com or in-app support, every day, while you're a founding member on a paid plan. A first reply isn't always a full answer.</p>"));
  assert.doesNotMatch(html, /Priority support covers messages/);
});

test('Terms: the discount line is Legal addendum 6 (4df74b3fc), the source rule', () => {
  const html = terms.render(cfg());
  assert.ok(html.includes('<p>The discount is <span data-figure="offer">30% off</span> the plan\'s price at every subscription payment made after your place is given to you, while you keep it and for as long as BetGaffer offers subscriptions. It doesn\'t combine with other percentage discounts, such as a challenge reward: the bigger one applies to that payment.</p>'));
  assert.doesNotMatch(html, /The discount applies at every subscription payment/);
});

test("Terms: the founding-members community as Legal cleared it (882ef16fc, operator R-214 community = yes)", () => {
  const html = terms.render(cfg());
  assert.ok(html.includes("<p>You can choose to join a founding-members WhatsApp community with our team. Joining is optional. Other members of the community can see your WhatsApp name and phone number, and WhatsApp's own terms apply there. We remove you if you lose your founding place, close your account or self-exclude. The community is for feedback and news about BetGaffer; we don't sell picks or take bets there.</p>"));
});

test('Privacy: the founding-members community section as Legal cleared it, with no way to join before launch', () => {
  const html = privacy.render(cfg());
  assert.ok(privacy.SECTION_TITLES.includes('Founding-members community'));
  assert.ok(html.includes("If you choose to join our founding-members WhatsApp community, other members and our team can see your WhatsApp name and phone number, and WhatsApp (Meta) handles the messages under its own privacy policy. We use your number there only to add you, to remove you when you leave the founding programme, close your account or self-exclude, and to read what you post. Joining is optional."));
  assert.doesNotMatch(html, /chat\.whatsapp\.com|wa\.me\/|whatsapp\.com\/channel|qr/i, 'Legal: no join link or QR code before launch');
});
