// Refund and cancellation policy (T3, spec §9; legal plan §3.6, rebranded). BUILD ONLY.
//
// Accurate TODAY: nothing is sold on this site. The launch column states the intended policy
// (plan Task 5): cancel any time, 7-day cooling-off for first-time subscribers with limited use
// (limits published with the prices), billing errors, refunds via Paystack.

import { legalDoc, operatorOf, mailto } from './common.js';

export const LAST_UPDATED = '2026-10-07';

export const META = Object.freeze({
  path: '/refunds/',
  title: 'Refunds and cancellation',
  description: 'Nothing is sold on the Bet Gaffer site today. This page states the refund and cancellation policy '
    + 'that will apply when paid plans open.',
});

const FCCPA = 'Federal Competition and Consumer Protection Act 2018';

function sections(op) {
  const email = mailto(op.contact_email);
  return [
    {
      id: 'what-is-sold',
      title: 'What is sold',
      now: `<p><strong>Nothing is sold on this site, so there is nothing to refund.</strong> No payment is taken, no card details are collected and no Credits exist.</p>
<p>If anyone asks you to pay for Bet Gaffer today, it is not us. Please tell us at ${email}.</p>`,
      launch: `<p>Bet Gaffer will offer a free account and paid monthly plans, priced in naira, VAT-inclusive and billed through Paystack. Prices will be published before any payment is taken.</p>`,
    },
    {
      id: 'cancelling',
      title: 'Cancelling',
      now: `<p>There is nothing to cancel.</p>`,
      launch: `<p>Cancel any time. Your plan stays active until the end of the period you have paid for, and you will not be charged again.</p>`,
    },
    {
      id: 'cooling-off',
      title: 'The 7-day cooling-off refund',
      now: `<p>Does not apply: nothing is sold.</p>`,
      launch: `<p>A 7-day cooling-off refund for first-time subscribers. If it is your first paid subscription and you have made only limited use of paid features, we will refund that first payment in full if you ask within 7 days of making it. The exact limits on use will be published with the prices.</p>`,
    },
    {
      id: 'billing-errors',
      title: 'Billing errors and your legal rights',
      now: `<p>No payments are taken, so no billing error can arise.</p>`,
      launch: `<p>If we charge you in error (the wrong amount, twice, or after you cancelled), we will refund the amount charged in error. We will also refund wherever the ${FCCPA} or any other law requires it; nothing in this policy limits those rights.</p>`,
    },
    {
      id: 'credits',
      title: 'Credits',
      now: `<p>No Credits exist.</p>`,
      launch: `<p>Unused Credits bought in the last 7 days are refundable on request; Credits you have used are not, except where the law requires.</p>`,
    },
    {
      id: 'how-refunds-are-paid',
      title: 'How refunds are paid',
      now: `<p>Does not apply: nothing is sold.</p>`,
      launch: `<p>Refunds go back to the original payment method through Paystack. We start an agreed refund within 5 business days; how long it then takes to reach you depends on your bank.</p>`,
    },
    {
      id: 'asking-for-a-refund',
      title: 'Asking for a refund',
      now: `<p>Does not apply: nothing is sold.</p>`,
      launch: `<p>Email ${email} from the address on your account, with the Paystack payment reference if you have it, and say what went wrong.</p>`,
    },
    {
      id: 'chargebacks',
      title: 'Chargebacks',
      now: `<p>Does not apply: nothing is sold.</p>`,
      launch: `<p>Please contact us before disputing a charge with your bank: most problems are quicker to fix directly. If you do open a chargeback, we will work with Paystack to resolve it, and we may pause the account involved while the dispute is open.</p>`,
    },
  ];
}

/** Section titles in order (build tests check each appears in the static HTML). */
export const SECTION_TITLES = Object.freeze(sections({ contact_email: 'x@x.x' }).map((s) => s.title));

/**
 * @param {object} cfg  site config; cfg.operator must carry legal_name, address, contact_email (S8)
 * @returns {string} body fragment for /refunds/
 */
export function render(cfg) {
  const op = operatorOf(cfg);
  return legalDoc({
    op,
    title: 'Refunds and cancellation',
    lead: 'Nothing is sold on this site today. This page states the refund and cancellation commitments that will apply when paid plans open, so you can read them before then.',
    updated: LAST_UPDATED,
    email: op.contact_email,
    contactHeading: 'Questions about this policy',
    contactNote: 'We reply to every message about refunds.',
    sections: sections(op),
  });
}
