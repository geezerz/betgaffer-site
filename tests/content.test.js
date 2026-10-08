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
  ...(over.breadth !== undefined ? { breadth: over.breadth } : {}),
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
    assert.match(mod.LAST_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(mod.LAST_UPDATED >= '2026-10-07', 'never earlier than the first published version');
    const line = lastUpdated(mod.LAST_UPDATED);
    const html = renderPage(name);
    assert.equal(typeof html, 'string');
    assert.doesNotMatch(html, /<!doctype|<html|<main/i, 'a body fragment, not a document');
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<style/i);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.ok(html.includes(line), `the page prints ${line}`);
    assert.match(visibleText(line), /^Last updated \d{1,2} [A-Z][a-z]+ \d{4}$/, 'premise: the line reads as a date');
    assert.ok(visibleText(html).includes(visibleText(line)), 'its visible text carries the Last updated line');
    const opener = line.slice(0, line.indexOf('<time'));
    assert.match(opener, /Last updated $/, 'premise: the line opens with its label');
    assert.equal(html.split(opener).length, 2, 'exactly one Last updated line');
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1');
  });

  test(`${name}: META describes the route for the build`, () => {
    const { META } = PAGES[name];
    assert.equal(META.path, `/${name}/`);
    assert.ok(typeof META.title === 'string' && META.title.length > 0);
    assert.ok(typeof META.description === 'string' && META.description.length > 20);
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
    assert.match(t, /football data and probability analytics, not betting tips/);
    assert.match(t, /not a bookmaker/i);
    assert.match(t, /Bet Gaffer/);
    assert.match(t, /football match intelligence/);
  });

  test(`${name}: no percentage outside an offer figure, and no banned phrase in visible text`, () => {
    const html = renderPage(name, cfg({ pricing: { show_prices: true },
      breadth: { markets: 92, competitions: 57, fixtures: 146, day: '2026-10-07' } }));
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
      `within ${F.SUPPORT_REPLY_HOURS} hours`, `${F.DISCOUNT_PCT}% off`, `${F.TOPUP_BONUS_PCT}% extra`, 'Double Credits',
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
      'It does not combine with other percentage discounts: if one applies, you get whichever saves you more.',
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
      'Top-ups get their own extra Credits, not double.',
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
    assert.ok(launch.includes('Credits and top-ups are not refundable. Credits returned when a Lab slip you marked as played '
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
import { SUMMARY, TOTAL_PLACES } from '../site/lib/founding.js';

test('shipped config: operator identity and published prices', async () => {
  const { default: shipped } = await import('../site/config.js');
  assert.equal(shipped.operator.legal_name, 'BETGAFFER LTD');
  assert.equal(shipped.operator.rc_number, '9885410');
  assert.equal(shipped.operator.contact_email, 'contact@betgaffer.com');
  assert.equal(shipped.pricing.show_prices, true);
  assert.deepEqual(shipped.pricing.tiers.map((t) => [t.name, t.monthly]),
    [['Free account', 0], ['Starter', 1500], ['Pro', 3000], ['Elite', 5000]]);
});

describe('features (Plan A Task 6, spec §8)', () => {
  const PRICING_INTENT = 'Nothing is sold on this site. At launch Bet Gaffer will offer a free account and paid '
    + 'monthly plans priced in naira, VAT-inclusive, billed through Paystack.';
  const PRICES_LATER = 'Prices will be published here before any payment is taken.';
  const INTRO = "Bet Gaffer is football match intelligence for sport investors. Here's what it does, from the "
    + 'simplest tool to the most advanced.';

  // Spec §8 as amended (Plan A "Task 6 additions": #4's problem carries no number). #5's answer is
  // asserted separately: its tail depends on cfg.breadth.
  const SPEC = [
    ['Every match, by kickoff', 'A Saturday can bring more than 1,500 matches spread across apps and sites.',
      'One list of every fixture in the competitions we cover, in Lagos time, with Live, Next 3 hours and Finished views.'],
    ['Search and league filters', 'Scrolling through hundreds of games to find yours wastes time.',
      'Find a team or league in seconds, or show only the leagues you follow.'],
    ['Live scores and match clock', 'Switching apps to check whether a match is still on.',
      'Live scores and the match clock right on the fixture.'],
    ['One recommended pick per fixture', 'There are dozens of markets on every match — too many choices.',
      'We highlight one recommended pick for each fixture, with its probability and price.'],
    ['Probabilities for every market', 'Bookmaker odds tell you the price, not the chance.', null],
    ['Clearly marked prices', "You can't always tell where a price came from.",
      'When no bookmaker price was captured, ours is clearly marked as an estimate.'],
    ['Match centre', 'Research means opening five tabs.',
      'Head-to-head, standings, stats, lineups and commentary in one place.'],
    ['Early results', 'Waiting for full time to know if a pick landed.',
      "See a pick land the moment it's decided — an over-goals line passed, or a first-half market at half time."],
    ["Today's accuracy ring", 'No quick way to see how today is going.',
      "A ring that shows today's settled picks at a glance."],
    ['Our Record', 'Anyone can claim a big number.',
      'Every recommended pick is graded and kept, misses alongside hits.'],
    ['Power Teams', 'Too much noise when you only follow the big clubs.',
      'One tap narrows the day to the major clubs we track most closely. Elite plan.'],
    ['Ready-made slips', 'No time to build a slip every day.',
      "Ready-made slips every day, for when you'd rather not build your own."],
    ['Same-game slips', 'Combining markets from one match ignores how they affect each other.',
      'Slips that combine several markets from one match, with the link between them taken into account.'],
    ['My Bets', 'Slips scattered across screenshots and notes.',
      'Every slip you build on Bet Gaffer, tracked in one place until it settles.'],
    ['The Lab', 'Building a multi-leg slip by hand is slow and guesswork.',
      'Assemble a multi-leg slip from our priced markets, see which leg is weakest, and change one leg.'],
    ['Credits', 'Paying for a whole plan when you only want one thing.',
      'Pay with Credits only for the actions you use — and get Credits back when a Lab slip you marked as played loses.'],
    ['Ask Gaffer', 'Wanting a second opinion before you place a ticket.',
      'Ask in plain language and get the reasoning behind a pick.'],
  ];
  const SOON = new Set(['Ask Gaffer']);
  const BREADTH = { markets: 92, competitions: 57, fixtures: 1146, day: '2026-10-07' };

  // The rendered page has no <body>, so wrap it for the strict scanner (it also proves the markup
  // nests the way a browser builds it: no block inside a <p>, nothing left open).
  const doc = (html) => parse(`<body>${html}</body>`);
  const cls = (n, c) => (n.attrs.class || '').split(/\s+/).includes(c);
  const articles = (html) => findAll(doc(html), (n) => n.tag === 'article' && cls(n, 'ct-feature'));
  const partOf = (art, c) => find(art, (n) => cls(n, c));
  const render = (c = cfg()) => features.render(c);

  test('LAST_UPDATED is bumped for the rewrite', () => {
    assert.equal(features.LAST_UPDATED, '2026-10-08');
    assert.ok(render().includes(lastUpdated('2026-10-08')));
  });

  test('H1 and the spec §8 intro', () => {
    const d = doc(render());
    const h1 = findAll(d, (n) => n.tag === 'h1');
    assert.equal(h1.length, 1);
    assert.equal(textOf(h1[0]), 'What Bet Gaffer does');
    assert.ok(textOf(d).includes(INTRO), 'intro verbatim');
  });

  test('the 17 features, in the spec order, each a ct-feature article with an h3 name', () => {
    const arts = articles(render());
    assert.equal(arts.length, 17);
    assert.deepEqual(arts.map((a) => textOf(find(a, (n) => n.tag === 'h3'))), SPEC.map(([name]) => name));
    // They sit in one ordered list: the order IS the content (simplest first).
    const ol = find(doc(render()), (n) => n.tag === 'ol' && cls(n, 'ct-ladder'));
    assert.ok(ol, 'an ordered list holds the features');
    assert.equal(findAll(ol, (n) => n.tag === 'article' && cls(n, 'ct-feature')).length, 17);
  });

  // The verbatim check, shared with the premise test below so the premise exercises the real loop.
  const assertVerbatim = (html) => {
    const arts = articles(html);
    assert.equal(arts.length, SPEC.length, 'premise: every spec row is rendered (an empty loop proves nothing)');
    for (const [i, a] of arts.entries()) {
      const [name, problem, answer] = SPEC[i];
      const p = partOf(a, 'ct-feature__problem');
      const w = partOf(a, 'ct-feature__answer');
      assert.ok(p && p.tag === 'p' && w && w.tag === 'p', `${name}: problem and answer paragraphs`);
      assert.equal(textOf(p), `The problem: ${problem}`, name);
      if (answer !== null) assert.equal(textOf(w), `What we do: ${answer}`, name);
      assert.ok(textOf(a).indexOf('The problem:') < textOf(a).indexOf('What we do:'), `${name}: problem before answer`);
    }
  };

  test('every feature states the problem, then what we do — verbatim from spec §8', () => {
    assertVerbatim(render());
  });

  test('16 "At launch" tags and one "Coming soon" (Ask Gaffer)', () => {
    const tags = articles(render()).map((a) => {
      const t = partOf(a, 'ct-feature__tag');
      assert.ok(t, 'each feature carries a tag chip');
      return textOf(t);
    });
    assert.equal(tags.filter((t) => t === 'At launch').length, 16);
    assert.equal(tags.filter((t) => t === 'Coming soon').length, 1);
    assert.deepEqual(SPEC.map(([n], i) => [n, tags[i]]).filter(([, t]) => t === 'Coming soon').map(([n]) => n), [...SOON]);
    const soon = articles(render()).filter((a) => cls(a, 'ct-feature--soon'));
    assert.deepEqual(soon.map((a) => textOf(find(a, (n) => n.tag === 'h3'))), [...SOON], 'the soon modifier marks only Ask Gaffer');
  });

  test('#4 names no market count; #5 reads "up to {markets} per match" from cfg.breadth', () => {
    const answer5 = (c) => textOf(partOf(articles(features.render(c))[4], 'ct-feature__answer'));
    assert.equal(answer5(cfg({ breadth: BREADTH })), 'What we do: Our probability for every market we price — up to 92 per match.');
    assert.equal(answer5(cfg({ breadth: { ...BREADTH, markets: 1 } })), 'What we do: Our probability for every market we price — up to 1 per match.');
    assert.equal(answer5(cfg({ breadth: { ...BREADTH, markets: 1234 } })), 'What we do: Our probability for every market we price — up to 1,234 per match.');
    // Absent, or an empty day: no number at all.
    for (const c of [cfg(), cfg({ breadth: { ...BREADTH, fixtures: 0, competitions: 0 } }), cfg({ breadth: { ...BREADTH, markets: 0 } })]) {
      assert.equal(answer5(c), 'What we do: Our probability for every market we price.');
    }
    const none = visibleText(render());
    assert.doesNotMatch(none, /\b\d{2,}\s+(?:markets|leagues|competitions)\b/, 'no hardcoded breadth figure');
    assert.doesNotMatch(none, /\d+\s+per match|over \d+ markets/i);
    // Malformed breadth is refused rather than printed.
    for (const b of [{ markets: 92 }, { ...BREADTH, markets: '92' }, { ...BREADTH, day: '2026-13-01' },
      { ...BREADTH, markets: -1 }, { ...BREADTH, markets: 1.5 }, 'x', [1]]) {
      assert.throws(() => features.render(cfg({ breadth: b })), TypeError, JSON.stringify(b));
    }
  });

  test('left off on purpose: no unlaunched or banned surface, no form', () => {
    const html = render(cfg({ pricing: { show_prices: true }, breadth: BREADTH }));
    const t = visibleText(html);
    for (const s of ['Daily Slips', 'booking code', 'Exposure', 'Steam', 'Green Month', 'cash out', 'ROI',
      'swap any leg', 'odds you want', 'Life Changer', '50x', 'Guarantee', 'suggested stake']) {
      assert.ok(!t.toLowerCase().includes(s.toLowerCase()), `absent: ${s}`);
    }
    assert.doesNotMatch(html, /<form/i);
    assert.deepEqual(findBanned(t), []);
    assert.doesNotMatch(t, /Token/);
    // Sells time and friction only. "accuracy ring" (the feature's name) is the ONE accuracy phrase allowed.
    const rest = t.replace(/accuracy ring/gi, '');
    assert.ok(t.includes('accuracy ring'), 'premise: the allowed phrase is on the page');
    assert.doesNotMatch(rest, /accura|\bwin\b|\bwinning\b|value bet|\bedge\b|beat the/i);
    // Premise: the narrowed ban still catches any other accuracy wording.
    assert.match(`${t} our accuracy is high`.replace(/accuracy ring/gi, ''), /accura/i);
    assert.match(`${t} Accurate picks`.replace(/accuracy ring/gi, ''), /accura/i);
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
    assert.equal(textOf(offer), SUMMARY);
    assert.ok(textOf(sec).includes(`Be one of ${String(TOTAL_PLACES).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} founding members`));
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

  test('premise: the order and verbatim checks fire on a broken page', () => {
    const html = render();
    // Swap two features: the order check must notice.
    const arts = html.match(/<li class="ct-ladder__step">[\s\S]*?<\/li>/g);
    assert.equal(arts.length, 17, 'premise: one list item per feature');
    const swapped = html.replace(arts[0], '@@SWAP@@').replace(arts[1], arts[0]).replace('@@SWAP@@', arts[1]);
    const names = articles(swapped).map((a) => textOf(find(a, (n) => n.tag === 'h3')));
    assert.notDeepEqual(names, SPEC.map(([n]) => n));
    // The real verbatim loop passes the page as rendered and throws on a reworded problem or answer.
    assertVerbatim(html);
    for (const [from, to] of [['Research means opening five tabs.', 'Research takes ages.'],
      ['Head-to-head, standings, stats, lineups and commentary in one place.', 'Everything in one place.']]) {
      assert.ok(html.includes(from), `premise: the page carries ${from}`);
      assert.throws(() => assertVerbatim(html.replace(from, to)), assert.AssertionError, from);
    }
  });
});
