// Terms of use (T3, spec §9; legal plan §3.1, rebranded). BUILD ONLY.
//
// Accurate TODAY: the site is free, has no accounts and sells nothing. Booking codes are never
// described as working (4 of 4 booking adapters are stubs). Responsible play is folded in here as a
// short section (spec §9: not a separate document).

import { REPO_RE } from '../config.js';
import { escAttr, escHtml } from '../lib/esc.js';
import { legalDoc, operatorOf, operatorLine, mailto, SAME } from './common.js';

export const LAST_UPDATED = '2026-10-07';

export const META = Object.freeze({
  path: '/terms/',
  title: 'Terms of use',
  description: 'The terms for using Bet Gaffer: football data and probability analytics for adults aged 18 and over. '
    + 'Not betting advice, and not a bookmaker.',
});

const GA = '<a href="https://www.gamblersanonymous.org" rel="noopener">Gamblers Anonymous</a>';
const FCCPA = 'Federal Competition and Consumer Protection Act 2018';
const COPY = String.fromCharCode(0xa9);

function sections(op, repo) {
  const email = mailto(op.contact_email);
  const licence = `https://github.com/${repo}/blob/main/LICENSE-CONTENT.md`;
  return [
    {
      id: 'who-we-are',
      title: 'Who we are',
      now: `<p>Bet Gaffer is run by ${operatorLine(op)} ("we", "us"). Bet Gaffer is football match intelligence: football data and probability analytics, not betting tips.</p>
<p>By using this site you agree to these terms. If you do not agree, please do not use it.</p>`,
      launch: SAME,
    },
    {
      id: 'what-this-site-is',
      title: 'What this site is',
      now: `<p>An informational website. For each day it lists the fixtures in the competitions we cover, at most one pick per fixture with the probability our model gives it, and a graded public record of how earlier picks turned out.</p>
<p>It is free. There are no accounts, and nothing is sold.</p>`,
      launch: `<p>A subscription service with accounts, a free account and paid monthly plans, plus features such as Ask Gaffer and the Lab. Each paid feature, and its price, will be described before any payment is taken.</p>`,
    },
    {
      id: 'not-advice',
      title: 'Probabilities, not promises',
      now: `<p>This site is information, not betting advice. Nothing on it is a recommendation to place a bet. A pick is the market our model selects for a fixture under the rules stated on Our Record; it is information.</p>
<p>Our probabilities are <strong>estimates</strong> produced by statistical models. They <strong>can be wrong</strong>, and some will be; the record shows the ones that were. We give <strong>no guarantee of any outcome</strong>. <strong>Past results do not predict future results.</strong></p>
<p>If you choose to bet, the decision, and its consequences, are yours alone.</p>`,
      launch: `<p>The same applies to every feature, including Gaffer's explanations and the Lab's assessments of a slip: they are information, not betting advice.</p>`,
    },
    {
      id: 'age',
      title: '18+ only',
      now: `<p>This site is for adults aged 18 and over. If you are under 18, do not use it and do not join the waitlist.</p>`,
      launch: `<p>Accounts will be for adults aged 18 and over who can enter a binding agreement. We may ask you to confirm your age, and we will close an account held by anyone under 18.</p>`,
    },
    {
      id: 'not-a-bookmaker',
      title: 'We are not a bookmaker',
      now: `<p>We are not a bookmaker. We take no bets, hold no stakes, offer no odds of our own and pay no winnings. We are not licensed as a gaming operator and do not operate as one.</p>
<p>A price shown with a pick is a bookmaker price we recorded for reference (some are marked as estimates). It is not an offer from us.</p>
<p>We are not paid by any bookmaker for bets placed or clicks made.</p>`,
      launch: SAME,
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable use',
      now: `<p>Please do not:</p>
<ul>
<li>scrape or automate requests to the site in a way that burdens it;</li>
<li>misrepresent the record, for example by quoting a figure without its sample size and period, or by presenting an edited card as ours;</li>
<li>try to break, probe or overload the site or the waitlist;</li>
<li>submit someone else's email address to the waitlist.</li>
</ul>
<p>You may quote the published cards and the record with attribution to Bet Gaffer and a link to this site.</p>`,
      launch: `<p>The same rules, and also: no sharing or reselling access to your account, no more than one account per person, and no attempt to get around a plan's limits.</p>`,
    },
    {
      id: 'intellectual-property',
      title: 'Intellectual property',
      now: `<p>Our probabilities, picks, record and the site's text are ${COPY} ${escHtml(op.legal_name)}. Fixture details, team and competition names, and bookmaker prices belong to their owners.</p>
<p>The terms for the public repository are stated in <a href="${escAttr(licence)}" rel="noopener">LICENSE-CONTENT.md</a>: the site code is open source, and the published cards and copy may be quoted with attribution.</p>`,
      launch: `<p>The same, and content behind a paid plan is licensed to you for your own personal use, not for resale or redistribution.</p>`,
    },
    {
      id: 'liability',
      title: 'Liability',
      now: `<p>The site is free and provided as it is. To the extent the law allows, we are not liable for any loss arising from your use of, or reliance on, the site, including any loss from a bet you choose to place.</p>
<p>Nothing in these terms excludes or limits any right you have under the ${FCCPA}, or any liability that the law does not allow us to exclude, such as liability for fraud or gross negligence.</p>`,
      launch: `<p>The terms for paid plans will set out any limits on our liability. The ${FCCPA} rights and the exceptions above will still apply.</p>`,
    },
    {
      id: 'responsible-play',
      title: 'Responsible play',
      now: `<ul>
<li>Bet Gaffer is for adults aged 18 and over.</li>
<li>If you bet, set a limit on time and money before you start, and keep to it.</li>
<li>Never stake what you cannot afford to lose, and do not chase losses.</li>
<li>Take a break when it stops being fun.</li>
</ul>
<p>If betting is harming you or someone close to you, free and confidential support is available from ${GA} (<span class="mono">www.gamblersanonymous.org</span>).</p>`,
      launch: `<p>The same guidance applies. Any tools we add to help you control your use will be described here.</p>`,
    },
    {
      id: 'accounts',
      title: 'Accounts and eligibility',
      now: `<p>There are no accounts on this site.</p>`,
      launch: `<p>You must be 18 or over and give accurate details. Keep your sign-in secure; you are responsible for what happens on your account. One account per person.</p>`,
    },
    {
      id: 'credits',
      title: 'Credits',
      now: `<p>No Credits exist and nothing is sold on this site.</p>`,
      launch: `<p>Credits will pay for actions that cost us to run, such as Lab generations and Gaffer conversations. Credits have no cash value, cannot be withdrawn or transferred, and are never a stake or a wager. Their prices and terms will be published before any are sold.</p>`,
    },
    {
      id: 'subscriptions',
      title: 'Subscriptions and auto-renewal',
      now: `<p>There are no subscriptions on this site.</p>`,
      launch: `<p>Paid plans will be monthly, priced in naira, VAT-inclusive and billed through Paystack. Auto-renewal will be opt-in, and we will send you a reminder before each renewal. You can cancel at any time; see the <a href="/refunds/">refund and cancellation policy</a>.</p>`,
    },
    {
      id: 'ending',
      title: 'Cancellation, suspension and termination',
      now: `<p>You can stop using the site at any time. To leave the waitlist, email ${email}. We may block traffic that breaks these terms, such as abusive automated requests.</p>`,
      launch: `<p>You can close your account at any time. We may suspend or close an account for a breach of these terms, fraud or abuse, and we will tell you why unless the law prevents us.</p>`,
    },
    {
      id: 'booking-codes',
      title: 'Booking codes',
      now: `<p>This site provides no booking codes.</p>`,
      launch: `<p>If we offer booking codes, a code will only copy a selection onto a bookmaker's slip. Any bet is placed by you, with that bookmaker, under its terms. We are not a party to it, and we are not paid for it.</p>`,
    },
    {
      id: 'law',
      title: 'Governing law',
      now: `<p>These terms are governed by the laws of the Federal Republic of Nigeria, and the courts of Lagos State have jurisdiction. This does not affect any right you have to complain to a regulator or to bring a claim under the ${FCCPA}.</p>`,
      launch: SAME,
    },
    {
      id: 'changes',
      title: 'Changes to these terms',
      now: `<p>We may update these terms. The "Last updated" date shows the current version, and changes apply from when they are published here.</p>`,
      launch: `<p>We will show material changes in the product before they take effect and, where the law requires it, ask you to accept them.</p>`,
    },
  ];
}

/** Section titles in order (build tests check each appears in the static HTML). */
export const SECTION_TITLES = Object.freeze(sections({ contact_email: 'x@x.x', legal_name: 'x', address: 'x' }, 'x/y').map((s) => s.title));

/**
 * @param {object} cfg  site config; cfg.operator must carry legal_name, address, contact_email (S8);
 *                      cfg.repo ('owner/name') locates LICENSE-CONTENT.md
 * @returns {string} body fragment for /terms/
 */
export function render(cfg) {
  const op = operatorOf(cfg);
  if (typeof cfg.repo !== 'string' || !REPO_RE.test(cfg.repo)) {
    throw new TypeError(`terms: cfg.repo must be "owner/name", got ${JSON.stringify(cfg.repo)}`);
  }
  return legalDoc({
    op,
    title: 'Terms of use',
    lead: 'These terms cover your use of Bet Gaffer. The short version: this is an informational site for adults aged 18 and over; nothing here is betting advice; probabilities are estimates and can be wrong.',
    updated: LAST_UPDATED,
    email: op.contact_email,
    contactHeading: 'Questions about these terms',
    contactNote: 'We reply to every message about these terms.',
    sections: sections(op, cfg.repo),
  });
}
