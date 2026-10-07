// Shared pieces of the static content pages (features, privacy, terms, refunds). BUILD ONLY.
//
// Every operator value goes through escHtml / escAttr here. Section bodies passed to legalDoc() are
// authored HTML from the content modules, which escape their own interpolations.

import { escHtml, escAttr } from '../lib/esc.js';
import { isDate } from '../lib/time.js';
import { requireOperator } from '../config.js';

/** Positioning, stated on every content page (spec §9, charter "IS / IS NOT"). */
export const POSITIONING = 'Bet Gaffer is football match intelligence: football data and probability analytics, '
  + 'not betting tips. We are not a bookmaker. We take no bets, hold no stakes and pay no winnings.';

export const COL_NOW = 'Now (this site)';
export const COL_LAUNCH = 'At full launch';

/** Marker for a launch column whose content is identical to the Now column. */
export const SAME = Symbol('same-at-launch');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

/** 'YYYY-MM-DD' -> '7 October 2026'. */
export function fmtDateLong(date) {
  if (!isDate(date)) throw new TypeError(`fmtDateLong: not a real YYYY-MM-DD date: ${String(date)}`);
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The "Last updated" line. */
export function lastUpdated(date) {
  return `<p class="ct-meta mono">Last updated <time datetime="${escAttr(date)}">${escHtml(fmtDateLong(date))}</time></p>`;
}

/** Effective operator identity (throws naming every missing field, plan S8). */
export function operatorOf(cfg) {
  return requireOperator(cfg);
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * The RC number without any 'RC' prefix the config may carry ('RC1234567', 'rc 1234567' and
 * '1234567' all give '1234567'), so it is printed exactly once as 'RC 1234567'. '' when unset.
 */
export function rcNumber(op) {
  return nonEmpty(op.rc_number) ? op.rc_number.trim().replace(/^RC\s*/i, '').trim() : '';
}

/** "Example Ltd (RC 123), 1 Road, Lagos" — escaped. */
export function operatorLine(op) {
  const rc = rcNumber(op) ? ` (RC ${escHtml(rcNumber(op))})` : '';
  return `${escHtml(op.legal_name)}${rc}, ${escHtml(op.address)}`;
}

/** A mailto link — escaped. */
export function mailto(email) {
  return `<a href="mailto:${escAttr(email)}">${escHtml(email)}</a>`;
}

/** Who runs the site: the operator identity card on every content page. */
export function identityCard(op, { email, label = 'Contact' } = {}) {
  const rows = [
    ['Operator', `${escHtml(op.legal_name)}${nonEmpty(op.trading_name) ? `, trading as ${escHtml(op.trading_name)}` : ''}`],
    rcNumber(op) ? ['Company registration', `<span class="mono">RC ${escHtml(rcNumber(op))}</span>`] : null,
    ['Address', escHtml(op.address)],
    [label, mailto(email || op.contact_email)],
  ].filter(Boolean);
  const dl = rows.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${v}</dd></div>`).join('');
  return `<aside class="ct-ident" aria-label="Who runs this site"><dl>${dl}</dl></aside>`;
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const two = (n) => String(n).padStart(2, '0');

/**
 * A legal document body: hero, identity, how-to-read note, contents, column header, two-column
 * sections, contact block.
 *
 * @param {object} o
 * @param {object} o.op              effective operator (operatorOf(cfg))
 * @param {string} o.title           h1
 * @param {string} o.lead            authored HTML paragraph content
 * @param {string} o.updated         'YYYY-MM-DD'
 * @param {string} o.email           the address for this document's contact block
 * @param {string} [o.emailLabel]
 * @param {string} [o.contactHeading]  'Questions about this policy' | 'Questions about these terms'
 * @param {string} o.contactNote     authored HTML (escaped by the caller) after the address
 * @param {{id:string,title:string,now:string,launch:string|symbol}[]} o.sections
 */
export function legalDoc({ op, title, lead, updated, email, emailLabel = 'Contact', contactHeading = 'Questions about this policy', contactNote = '', sections }) {
  if (!Array.isArray(sections) || sections.length === 0) throw new TypeError('legalDoc: sections required');
  const ids = new Set();
  for (const s of sections) {
    if (!ID_RE.test(s.id) || ids.has(s.id)) throw new TypeError(`legalDoc: bad or duplicate section id ${JSON.stringify(s.id)}`);
    ids.add(s.id);
    if (!nonEmpty(s.title) || typeof s.now !== 'string' || (s.launch !== SAME && typeof s.launch !== 'string')) {
      throw new TypeError(`legalDoc: section ${s.id} needs a title, a now column and a launch column`);
    }
  }

  const toc = sections.map((s, i) => `<li><a href="#${escAttr(s.id)}"><span class="mono">${two(i + 1)}</span>${escHtml(s.title)}</a></li>`).join('');

  const body = sections.map((s, i) => {
    const launch = s.launch === SAME ? '<p class="ct-same">The same applies at full launch.</p>' : s.launch;
    return `<section class="ct-sec" id="${escAttr(s.id)}" aria-labelledby="${escAttr(s.id)}-h">
<h2 class="ct-sec__h" id="${escAttr(s.id)}-h"><span class="ct-sec__n mono">${two(i + 1)}</span> ${escHtml(s.title)}</h2>
<div class="ct-cols">
<div class="ct-col ct-col--now"><p class="ct-col__lbl">${escHtml(COL_NOW)}</p>${s.now}</div>
<div class="ct-col ct-col--launch"><p class="ct-col__lbl">${escHtml(COL_LAUNCH)}</p>${launch}</div>
</div>
</section>`;
  }).join('\n');

  return `<article class="ct-doc ct-legal">
<header class="ct-hero">
<p class="t-lbl">Legal</p>
<h1 class="t-d1">${escHtml(title)}</h1>
${lastUpdated(updated)}
<p class="ct-lead">${lead}</p>
<p class="ct-pos">${escHtml(POSITIONING)}</p>
</header>
${identityCard(op, { email, label: emailLabel })}
<div class="ct-howto">
<p><strong>How to read this page.</strong> Every section has two columns. <strong>${escHtml(COL_NOW)}</strong> is what applies today, on this site. <strong>${escHtml(COL_LAUNCH)}</strong> is what we intend once accounts and paid plans open; it does not apply yet, and we will publish an updated version of this page before it does.</p>
</div>
<nav class="ct-toc" aria-label="Contents">
<h2 class="t-lbl t-lbl--quiet">Contents</h2>
<ol role="list">${toc}</ol>
</nav>
<div class="ct-colhead" aria-hidden="true"><span class="ct-colhead__now">${escHtml(COL_NOW)}</span><span class="ct-colhead__launch">${escHtml(COL_LAUNCH)}</span></div>
${body}
<section class="ct-contact" aria-labelledby="ct-contact-h">
<h2 class="t-h" id="ct-contact-h">${escHtml(contactHeading)}</h2>
<p>Email ${mailto(email)}. ${contactNote}</p>
<p class="ct-contact__addr">${operatorLine(op)}</p>
</section>
</article>`;
}
