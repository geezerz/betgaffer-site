// Privacy policy (T3, spec §9, §8 S4-S6; NDPA 2023). BUILD ONLY.
//
// Accurate TODAY. Every promise here names a mechanism that exists: the waitlist stores {email, ts}
// only (Task 7); the rate-limit key is an HMAC of the IP held in the Cache API for at most one hour;
// analytics are Cloudflare Web Analytics (cookieless) and Bot Fight Mode is off (docs/DEPLOY.md), so
// the site sets no cookies; data-subject requests are handled by hand by the operator (DEPLOY.md
// runbook). No DPO, no SCCs, no self-service tool is claimed, because none exists.
// Teaser v2 (spec §9, §13): the waitlist purpose is the founding invite, its claim window and matching
// the address to the account opened with it (the waitlist consent line says the same); at launch a phone
// number is collected only for phone verification or the founding-members WhatsApp community.

import { escHtml } from '../lib/esc.js';
import { WAITLIST_PLACES, CLAIM_DAYS } from '../lib/founding.js';
import { legalDoc, operatorOf, operatorLine, mailto, SAME } from './common.js';

export const LAST_UPDATED = '2026-10-08';

export const META = Object.freeze({
  path: '/privacy/',
  title: 'Privacy policy',
  description: 'What Bet Gaffer collects, why, where it is stored, how long we keep it and your rights under the '
    + 'Nigeria Data Protection Act 2023.',
});

const NDPC = '<a href="https://ndpc.gov.ng" rel="noopener">Nigeria Data Protection Commission</a>';

function sections(op) {
  const email = mailto(op.privacy_email);
  const mailbox = typeof op.mailbox_provider === 'string' && op.mailbox_provider.trim() !== ''
    ? escHtml(op.mailbox_provider.trim()) : 'an email provider';
  const forwarded = `Emails you send us are forwarded by Cloudflare to the operator's mailbox, hosted by ${mailbox}, which may store them outside Nigeria.`;
  return [
    {
      id: 'who-we-are',
      title: 'Who we are',
      now: `<p>${operatorLine(op)} runs Bet Gaffer and is the data controller for personal data collected on this site.</p>
<p>For anything in this policy, email ${email}.</p>`,
      launch: `<p>The same controller will run the full Bet Gaffer service. If we appoint a data protection officer, we will name them here.</p>`,
    },
    {
      id: 'what-we-collect',
      title: 'What we collect',
      now: `<p>If you join the waitlist, we keep <strong>your email address and the time you submitted it</strong>. Nothing else: no name, no phone number, no account, no payment data.</p>
<p>The form asks you to confirm you are 18 or over. We do not store that answer; an address without it is not accepted.</p>
<p>If you only read the site, we collect no personal data ourselves. Cloudflare, which hosts the site, processes technical data such as your IP address in order to deliver pages and protect the site from abuse.</p>
<p>If you email us, we have your message and your email address.</p>`,
      launch: `<p>When accounts open we will also collect:</p>
<ul>
<li><strong>Account details</strong>: your email address and a display name.</li>
<li><strong>Google sign-in</strong>, if you choose it: your name, email address and profile picture. We get no access to any other Google data: not your email, files or contacts. We use it only to create your account and sign you in. We do not share it, and we delete it when you close your account.</li>
<li><strong>A phone number</strong>, if you verify your account by phone or join the founding-members WhatsApp community.</li>
<li><strong>Payment data</strong>, processed by Paystack. Your card details never reach us; we receive a payment reference and whether the payment succeeded.</li>
<li><strong>Your Credits balance and history</strong>, and the plan you are on.</li>
<li><strong>Your notification preferences.</strong></li>
<li><strong>Support correspondence</strong>: the messages between you and our support.</li>
<li><strong>Usage data</strong>: which pages and features you use, so we can run and improve the service.</li>
</ul>`,
    },
    {
      id: 'cookies-and-analytics',
      title: 'Cookies and analytics',
      now: `<p><strong>This site sets no cookies.</strong> If Cloudflare's security check challenges your connection, Cloudflare may set one strictly necessary cookie (cf_clearance) to remember that you passed.</p>
<p>We use Cloudflare Web Analytics, which is cookieless: it counts page views in aggregate without identifying individual visitors and without following you across other sites.</p>`,
      launch: `<p>Signing in needs cookies that keep you signed in and protect your account. These are strictly necessary for a service you have asked for.</p>
<p>We will not set analytics or marketing cookies that are not strictly necessary without asking you first, and we will describe any we use here before they are set.</p>`,
    },
    {
      id: 'why-and-lawful-basis',
      title: 'Why we use it, and our lawful basis',
      now: `<ul>
<li><strong>Your waitlist address</strong> is used only to send your invite and to match it to the account you open with it. If you are among the first ${WAITLIST_PLACES} people to join, your invite offers you a founding place, which you claim by starting a paid subscription in the ${CLAIM_DAYS} days after the invite. At launch we use your address only to send your invite and to match it to the account you open with the same address. Lawful basis: your <strong>consent</strong>, given when you submit the form. You can withdraw it at any time.</li>
<li><strong>Security and abuse prevention.</strong> To stop automated abuse of the waitlist, the form counts sign-up attempts from each IP address (for IPv6, each /56 network) using a keyed one-way hash of that address, held only in Cloudflare's short-term cache for up to an hour, never stored with your email address. Lawful basis: our <strong>legitimate interest</strong> in keeping the site and the waitlist working.</li>
<li><strong>Emails you send us</strong> are used to answer you. Lawful basis: legitimate interest.</li>
</ul>
<p>We do not sell personal data, and we do not use it for advertising.</p>
<p>Our probabilities are statistical estimates about football matches, not decisions about you. We make no automated decisions about you.</p>`,
      launch: `<ul>
<li><strong>Contract</strong>: to provide your account, your plan and the features you use.</li>
<li><strong>Legal obligation</strong>: to keep the payment and tax records the law requires.</li>
<li><strong>Legitimate interest</strong>: security, fraud prevention and improving the service.</li>
<li><strong>Consent</strong>: marketing messages and optional notifications, which you can switch off at any time.</li>
</ul>
<p>We will still not sell personal data.</p>`,
    },
    {
      id: 'who-we-share-it-with',
      title: 'Who we share it with',
      now: `<p><strong>Cloudflare, Inc.</strong> hosts this site, protects it from abuse, provides the analytics, stores waitlist addresses and forwards emails sent to us. It acts as our processor.</p>
<p>${forwarded}</p>
<p>When we send invites we will use an email delivery provider. We will name it here before the first invite is sent.</p>
<p>We disclose personal data to authorities only where the law requires it.</p>`,
      launch: `<p>Processors, by role, each bound by contractual data-processing terms:</p>
<ul>
<li><strong>Hosting, security and storage</strong>: Cloudflare.</li>
<li><strong>Payments</strong>: Paystack.</li>
<li><strong>Sign-in</strong>: Google, if you choose Google sign-in.</li>
<li><strong>Email delivery</strong>: named here before launch.</li>
<li><strong>Founding-members community</strong>: WhatsApp, only if you choose to join it.</li>
</ul>`,
    },
    {
      id: 'transfers-outside-nigeria',
      title: 'Transfers outside Nigeria',
      now: `<p>Waitlist addresses are stored by <strong>Cloudflare, Inc.</strong>, a company in the <strong>United States</strong>, on its global network. Your address therefore leaves Nigeria.</p>
<p>The waitlist form tells you this at the point you submit your address. The transfer relies on your consent, given there, and on Cloudflare's contractual data-processing terms, which require it to protect the data and process it only to provide its service to us.</p>
<p>Data protection law in the United States may protect your address less than Nigerian law does.</p>
<p>${forwarded} We use your message only to answer it.</p>`,
      launch: `<p>Some processors, including Cloudflare and Google, are outside Nigeria. Before launch we will list each transfer here, with its destination and the safeguard it relies on under the Nigeria Data Protection Act 2023.</p>`,
    },
    {
      id: 'how-long-we-keep-it',
      title: 'How long we keep it',
      now: `<ul>
<li><strong>Waitlist addresses</strong>: until 12 months after full launch, and never more than 24 months after you joined, unless you withdraw your consent sooner.</li>
<li><strong>Rate-limit hashes</strong>: up to an hour, in Cloudflare's short-term cache.</li>
<li><strong>Emails you send us</strong>: as long as we need them to deal with your message.</li>
</ul>`,
      launch: `<ul>
<li><strong>Account data</strong>: until you close your account, plus any period the law requires us to keep records (for example, payment and tax records).</li>
<li><strong>Usage data</strong>: 2 years after your last activity.</li>
<li><strong>Marketing consent</strong>: until you withdraw it.</li>
</ul>`,
    },
    {
      id: 'your-rights',
      title: 'Your rights',
      now: `<p>Under the Nigeria Data Protection Act 2023 you have the right to:</p>
<ul>
<li>be told how your data is used (this page);</li>
<li>access the data we hold about you;</li>
<li>rectification of data that is wrong;</li>
<li>erasure of your data;</li>
<li>restrict how we use it;</li>
<li>withdraw your consent at any time (this does not affect what we did before you withdrew it);</li>
<li>object to our use of it;</li>
<li>data portability: receive your data in a common electronic format;</li>
<li>complain to the ${NDPC}.</li>
</ul>
<p><strong>How to use them:</strong> email ${email} from the address concerned and say what you want. The operator handles every request by hand. We will reply within 30 days, and we may ask you to confirm the request from that address before acting on it. Removing your waitlist address is a one-line email.</p>`,
      launch: `<p>You will have the same rights. We will publish how to exercise each one from your account before accounts open; email will always work, and we will reply within 30 days.</p>`,
    },
    {
      id: 'children',
      title: 'Children',
      now: `<p>This site is for adults aged 18 and over and is not directed at anyone under 18. The waitlist requires you to confirm you are 18 or over. If we learn that we hold a waitlist address belonging to someone under 18, we delete it.</p>`,
      launch: `<p>Accounts will be for adults aged 18 and over only. If we learn that an account belongs to someone under 18, we will close it and delete its data, except records the law requires us to keep.</p>`,
    },
    {
      id: 'security',
      title: 'Security',
      now: `<p>The site is served over HTTPS only. Waitlist addresses are held in Cloudflare's storage. Access to them is limited to the operator, through the operator's Cloudflare account and the site code the operator deploys. We collect as little as we can, so there is little to lose: an email address and a time.</p>
<p>If a breach affects personal data we hold, we will notify the Nigeria Data Protection Commission within 72 hours of becoming aware of it, and tell the people affected without undue delay.</p>`,
      launch: `<p>The same commitments apply. Card details are handled by Paystack and never reach our systems.</p>`,
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      now: `<p>When this policy changes, we update this page and its "Last updated" date. If we ever want to use waitlist addresses for anything other than sending your invite and matching it to your account, we will ask for your consent first.</p>`,
      launch: SAME,
    },
  ];
}

/** Section titles in order (build tests check each appears in the static HTML). */
export const SECTION_TITLES = Object.freeze(sections({ privacy_email: 'x@x.x', legal_name: 'x', address: 'x' }).map((s) => s.title));

/**
 * @param {object} cfg  site config; cfg.operator must carry legal_name, address, contact_email (S8)
 * @returns {string} body fragment for /privacy/
 */
export function render(cfg) {
  const op = operatorOf(cfg);
  return legalDoc({
    op,
    title: 'Privacy policy',
    lead: `This policy explains what personal data Bet Gaffer collects, why, where it is stored, how long we keep it and your rights under the <strong>Nigeria Data Protection Act 2023</strong>. Today the answer is short: if you join the waitlist, an email address and the time you gave it to us.`,
    updated: LAST_UPDATED,
    email: op.privacy_email,
    emailLabel: 'Privacy contact',
    contactHeading: 'Questions about this policy',
    contactNote: `We reply to every request about your data within 30 days. You can also complain to the ${NDPC}.`,
    sections: sections(op),
  });
}
