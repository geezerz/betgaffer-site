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

/** Public benefit cards (spec §3.4), in programme order B1-B6. */
export const BENEFITS = Object.freeze([
  { id: 'B1', title: '30% off, every time', text: `${DISCOUNT_PCT}% off your plan's price at every payment, for as long as you stay subscribed.` },
  { id: 'B2', title: 'Double Credits', text: "Your plan's monthly Credit allowance is doubled, on any paid plan." },
  { id: 'B3', title: 'More from every top-up', text: `Every Credit top-up comes with ${TOPUP_BONUS_PCT}% extra.` },
  { id: 'B4', title: 'A bigger say', text: 'A founding badge, and your vote counts twice when members vote on new features and improvements.' },
  { id: 'B5', title: 'First look at new features', text: `New features reach you at least ${EARLY_ACCESS_HOURS} hours before everyone else, and you help shape them while they're built. (Fixes and security updates go to everyone at once.)` },
  { id: 'B6', title: 'Priority support', text: `A first reply from a person within ${SUPPORT_REPLY_HOURS} hours of your message, every day, on any paid plan — plus a founding-members WhatsApp community with our team.` },
].map(Object.freeze));

/** The short summary line used on the banner, home card and Features (spec §2). */
export const SUMMARY = '30% off every subscription payment · double Credits · first look at new features · priority support';
