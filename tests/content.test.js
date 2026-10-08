// Task 5: features page, legal documents (privacy, terms, refunds) and the banned-phrase module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import siteConfig from '../site/config.js';
import { BANNED, ALLOW, findBanned } from '../site/lib/claims.js';
import * as features from '../site/content/features.js';
import * as privacy from '../site/content/privacy.js';
import * as terms from '../site/content/terms.js';
import * as refunds from '../site/content/refunds.js';
import { lastUpdated } from '../site/content/common.js';
import { percentagesOutsideOffers } from './html-scan.js';

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
const WAITLIST = '<form method="post" action="/api/waitlist" class="wl-probe"><button>Join the waitlist</button></form>';
const renderPage = (name, c = cfg(), opts = {}) => PAGES[name].render(c, name === 'features' ? { waitlistHtml: WAITLIST, ...opts } : opts);

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
    const reply = { privacy: 'We reply to every request about your data within 30 days.',
      terms: 'We reply to every message about these terms.',
      refunds: 'We reply to every message about refunds.' }[name];
    assert.ok(t.indexOf(reply, at) > at, `contact block says: ${reply}`);
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
  assert.ok(launch.includes('Unused Credits bought in the last 7 days are refundable on request; Credits you have used are not, except where the law requires.'), launch);
});

// =============================================================================================
// Features
// =============================================================================================

const PRICING_INTENT = 'Nothing is sold on this site. At launch Bet Gaffer will offer a free account and paid '
  + 'monthly plans priced in naira, VAT-inclusive, billed through Paystack.';
const PRICES_LATER = 'Prices will be published here before any payment is taken.';

test('features: pricing intent without figures when show_prices is off (S9)', () => {
  const html = renderPage('features', cfg({ pricing: { show_prices: false } }));
  const t = visibleText(html);
  assert.ok(t.includes(PRICING_INTENT), 'pricing intent');
  assert.ok(t.includes(PRICES_LATER), 'prices later');
  assert.doesNotMatch(t, /₦/);
  assert.doesNotMatch(html, /ct-tiers/);
});

test('features: show_prices renders the tier table instead of the last sentence', () => {
  const html = renderPage('features', cfg({ pricing: { show_prices: true } }));
  const t = visibleText(html);
  assert.ok(t.includes(PRICING_INTENT), 'intent stays');
  assert.ok(!t.includes(PRICES_LATER), 'the prices-later sentence is replaced');
  assert.match(html, /<table class="bg-table ct-tiers">/);
  for (const [n, p] of [['Free', '₦0'], ['Plus', '₦1,250'], ['Max', '₦20,000']]) {
    assert.match(html, new RegExp(`<th scope="row">${n}</th><td class="num" data-label="Monthly">${p}</td>`), n);
  }
  assert.match(t, /VAT-inclusive/);
});

test('features: the tier table says what separates the plans', () => {
  const html = renderPage('features', cfg({ pricing: { show_prices: true } }));
  assert.match(html, /Paid plans differ by the competitions they cover\./);
});

test('shipped config: operator identity and published prices', async () => {
  const { default: shipped } = await import('../site/config.js');
  assert.equal(shipped.operator.legal_name, 'BETGAFFER LTD');
  assert.equal(shipped.operator.rc_number, '9885410');
  assert.equal(shipped.operator.contact_email, 'contact@betgaffer.com');
  assert.equal(shipped.pricing.show_prices, true);
  assert.deepEqual(shipped.pricing.tiers.map((t) => [t.name, t.monthly]),
    [['Free account', 0], ['Starter', 1500], ['Pro', 3000], ['Elite', 5000]]);
});

test('features: tiers come from config and are validated', () => {
  const html = renderPage('features', cfg({ pricing: { show_prices: true, tiers: [{ name: 'A<b>', monthly: 1234567 }] } }));
  assert.ok(html.includes('A&lt;b&gt;') && html.includes('₦1,234,567'));
  for (const tiers of [[{ name: '', monthly: 1 }], [{ name: 'X', monthly: -1 }], [{ name: 'X', monthly: 1.5 }]]) {
    assert.throws(() => renderPage('features', cfg({ pricing: { show_prices: true, tiers } })), TypeError, JSON.stringify(tiers));
  }
  // No tiers at all is refused before any page renders (requireOperator names pricing.tiers).
  for (const tiers of [[], null]) {
    assert.throws(() => renderPage('features', cfg({ pricing: { show_prices: true, tiers } })), /pricing\.tiers/, JSON.stringify(tiers));
  }
});

test('features: show_prices with no tiers refuses to render; the shipped config renders its tier table', () => {
  assert.match(renderPage('features', siteConfig), /<table class="bg-table ct-tiers">[\s\S]*Elite/);
  assert.throws(() => renderPage('features', { ...siteConfig, pricing: { ...siteConfig.pricing, show_prices: true, tiers: [] } }), /pricing\.tiers/);
  assert.doesNotMatch(renderPage('features', { ...siteConfig, pricing: { ...siteConfig.pricing, show_prices: false } }), /₦|ct-tiers/);
});

test('features: the waitlist HTML is placed verbatim under a "Founding waitlist" heading', () => {
  const html = renderPage('features');
  const h = html.search(/<h2[^>]*>Founding waitlist<\/h2>/);
  assert.ok(h > -1, 'heading present');
  const at = html.indexOf(WAITLIST);
  assert.ok(at > h, 'form follows the heading, verbatim');
  assert.doesNotMatch(renderPage('features', cfg(), { waitlistHtml: undefined }), /Founding waitlist/,
    'no heading without a form');
  assert.throws(() => renderPage('features', cfg(), { waitlistHtml: 42 }), TypeError);
});

test('features: breadth is rendered from cfg.breadth and never hardcoded', () => {
  const none = visibleText(renderPage('features'));
  assert.doesNotMatch(none, /competitions,|markets priced per fixture/);
  assert.doesNotMatch(none, /\b\d{2,}\s+(?:markets|leagues|competitions)\b/, 'no hardcoded breadth figure');

  const html = renderPage('features', cfg({ breadth: { markets: 92, competitions: 57, fixtures: 1146, day: '2026-10-07' } }));
  const t = visibleText(html);
  assert.ok(t.includes('On the card for Wed 7 Oct 2026: 1,146 fixtures in 57 competitions, with up to 92 markets priced per fixture.'), t);

  const one = visibleText(renderPage('features', cfg({ breadth: { markets: 1, competitions: 1, fixtures: 1, day: '2026-10-07' } })));
  assert.ok(one.includes('1 fixture in 1 competition, with up to 1 market priced per fixture.'), 'singulars');

  const zero = visibleText(renderPage('features', cfg({ breadth: { markets: 92, competitions: 0, fixtures: 0, day: '2026-10-07' } })));
  assert.doesNotMatch(zero, /On the card for/, 'an empty day claims no breadth');

  for (const b of [{ markets: 92 }, { markets: '92', competitions: 1, fixtures: 1, day: '2026-10-07' },
    { markets: 92, competitions: 1, fixtures: 1, day: '2026-13-01' }, { markets: -1, competitions: 1, fixtures: 1, day: '2026-10-07' }, 'x']) {
    assert.throws(() => renderPage('features', cfg({ breadth: b })), TypeError, JSON.stringify(b));
  }
});

test('features: what it does now and the three launch features in charter wording', () => {
  const t = visibleText(renderPage('features'));
  for (const s of [
    'One pick per fixture',
    'every fixture of the day in the competitions we cover',
    'estimates',
    'graded',
    'Ask Gaffer', 'explains the reasoning',
    'Lab', 'assemble and stress-test multi-leg slips', 'which legs to drop',
    'Steam Alerts', 'real odds-movement alerts',
    'Not on this site yet',
  ]) assert.ok(t.includes(s), `features says: ${s}`);
});

test('features (spec §10): no repository card, no GitHub link or mention', () => {
  const html = renderPage('features');
  const t = visibleText(html);
  assert.doesNotMatch(t, /Receipts you can check|reposit|commit\b/i);
  assert.doesNotMatch(html, /github/i);
  assert.ok(!html.includes('geezerz/betgaffer-site'), 'the repo slug never reaches the page');
  // The page no longer reads cfg.repo: another valid repo renders the identical page (features and terms).
  for (const name of ['features', 'terms']) {
    const other = { ...cfg(), repo: 'some-org/other.site' };
    assert.notEqual(other.repo, cfg().repo);
    assert.equal(renderPage(name, other), renderPage(name), name);
  }
});

test('features: sells time and friction only — no accuracy/outcome claim, no unlaunched surfaces', () => {
  const t = visibleText(renderPage('features', cfg({ pricing: { show_prices: true } })));
  assert.doesNotMatch(t, /accura|\bwin\b|\bwinning\b|value bet|\bedge\b|beat the/i);
  assert.doesNotMatch(t, /booking code|Exposure|Daily Slips|Green Month|Guarantee/i);
  assert.doesNotMatch(t, /Token/);
});
