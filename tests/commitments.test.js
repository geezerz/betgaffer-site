// Spec §9 guard: the policy and founding pages promise only what the operator will keep. Built over the
// fixture artifact, one sentence at a time:
//   - every time commitment ("within" / "at least" / "no later than" + a number + a unit) must be an
//     approved sentence in site/lib/commitments.js;
//   - no sentence says Credits or top-ups are refundable.
// Each check is premise-tested by planting the banned shape into a built page.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../site/build.mjs';
import { workspace, copyArtifact, testConfig } from './site-fixtures.js';
import {
  APPROVED, APPROVED_SOURCES, commitmentSentences, refundableCredits, commitmentViolations, normalise, sentences,
} from '../site/lib/commitments.js';
import { BENEFITS, CLAIM_DAYS, EARLY_ACCESS_HOURS, SUPPORT_REPLY_HOURS } from '../site/lib/founding.js';

/** Every route the guard covers (spec §9). */
export const GUARDED_ROUTES = Object.freeze(['/privacy/', '/terms/', '/refunds/', '/waitlist/', '/features/']);
/**
 * Routes another Plan A task builds (Task 4: /waitlist/). Until that task is merged the route is not in
 * this tree, and its scan is skipped with that reason; Task 8 empties this set after the merge so a
 * missing route fails instead of skipping.
 */
export const PENDING_ROUTES = new Set(['/waitlist/']);

const fileOf = (out, route) => join(out, ...route.split('/').filter(Boolean), 'index.html');
const exists = (p) => access(p).then(() => true, () => false);

/**
 * The guard over built pages: { route: { built, commitments, unapproved, refundable } } for each route.
 * Reusable by the integration step (Task 8) over any dist directory.
 */
export async function scanRoutes(out, routes = GUARDED_ROUTES) {
  const res = {};
  for (const route of routes) {
    const f = fileOf(out, route);
    if (!(await exists(f))) { res[route] = { built: false }; continue; }
    const html = await readFile(f, 'utf8');
    res[route] = { built: true, html, commitments: commitmentSentences(html), ...commitmentViolations(html) };
  }
  return res;
}

const PLANTS = Object.freeze({
  reply: '<p>We will reply within 2 hours.</p>',
  refunds: '<p>Refunds within five business days.</p>',
  notice: '<p>You get at least 48 hours of notice.</p>',
  noticeWord: '<p>You get at least forty-eight hours of notice.</p>',
  later: '<p>We pay no later than ninety days after you ask.</p>',
  credits: '<p>Unused Credits are refundable.</p>',
});
const plant = (html, frag) => html.replace('</h1>', `</h1>${frag}`);

describe('commitments guard over the built policy pages (spec §9)', () => {
  let ws;
  let scan;
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    await build({ root: ws.root, out: ws.out, config: testConfig(), warn: () => {} });
    scan = await scanRoutes(ws.out);
  });
  after(async () => { await ws?.cleanup(); });

  for (const route of GUARDED_ROUTES) {
    test(`${route}: every time commitment is approved and no sentence makes Credits refundable`, (t) => {
      const r = scan[route];
      if (!r.built) {
        if (PENDING_ROUTES.has(route)) { t.skip(`${route} is built by another Plan A task; Task 8 scans it after the merge`); return; }
        assert.fail(`${route} is not built`);
      }
      assert.deepEqual(r.unapproved, [], `${route}: unapproved time commitments`);
      assert.deepEqual(r.refundable, [], `${route}: sentences making Credits refundable`);
    });
  }

  test('the policy pages are built and actually carry commitments (the scan reaches real copy)', () => {
    for (const route of ['/privacy/', '/terms/', '/refunds/']) {
      assert.ok(scan[route].built, `${route} built`);
      assert.ok(scan[route].commitments.length > 0, `${route} has time commitments to check`);
    }
    // The approved founding promises are on the Terms page, so the scan sees them there.
    for (const s of ['at least 72 hours', 'within 12 hours', 'within 30 days']) {
      assert.ok(scan['/terms/'].commitments.some((c) => c.includes(s)), `terms commitments include "${s}"`);
    }
  });

  test('every approved sentence is still printed on each built route it is approved for (no dead approvals)', () => {
    for (const src of APPROVED_SOURCES) {
      for (const route of src.routes) {
        const r = scan[route];
        if (!r.built && PENDING_ROUTES.has(route)) continue;
        assert.ok(r.built, `${route} built`);
        assert.ok(r.commitments.includes(normalise(src.text)), `${route} prints: ${src.text}`);
      }
    }
  });

  for (const [name, frag] of Object.entries(PLANTS)) {
    test(`premise: a planted ${name} sentence is reported on every built policy page`, () => {
      for (const route of ['/privacy/', '/terms/', '/refunds/', '/features/']) {
        const v = commitmentViolations(plant(scan[route].html, frag));
        const want = normalise(frag.replace(/<[^>]+>/g, ''));
        if (name === 'credits') {
          assert.deepEqual(v.refundable, [want], `${route}: ${name}`);
          assert.deepEqual(v.unapproved, [], `${route}: only the refund check fires`);
        } else {
          assert.deepEqual(v.unapproved, [want], `${route}: ${name}`);
          assert.deepEqual(v.refundable, [], `${route}: only the commitment check fires`);
        }
      }
    });
  }

  test('premise: an approved commitment edited by one word is no longer approved', () => {
    const html = scan['/refunds/'].html;
    assert.ok(html.includes('within 5 business days'), 'premise: the refunds page carries the 5-business-day start');
    const v = commitmentViolations(html.replace('within 5 business days', 'within 3 business days'));
    assert.equal(v.unapproved.length, 1);
    assert.match(v.unapproved[0], /within 3 business days/);
  });
});

describe('commitmentSentences', () => {
  test('matches within / at least / no later than + digits or number words + optional qualifier + unit', () => {
    for (const s of [
      'We reply within 30 days.', 'Within 5 business days.', 'within 3 working days.', 'within 2 calendar weeks.',
      'at least 72 hours.', 'no later than 6 months.', 'within one hour.', 'within twelve hours.', 'within fourteen days.',
      'within twenty-four hours.', 'within thirty days.', 'within forty-eight hours.', 'within ninety days.',
      'within 1,000 days.', 'within a day.', 'within an hour.', 'within a few business days.', 'within 2 years.',
      'WITHIN  7\nDAYS.',
    ]) assert.equal(commitmentSentences(s).length, 1, s);
    for (const s of ['We reply quickly.', 'you have 90 days to come back.', 'within those 90 days.',
      'within the Lagos area.', 'up to an hour.', 'the 7-day cooling-off refund.']) {
      assert.deepEqual(commitmentSentences(s), [], s);
    }
  });

  test('normalises: strips HTML, decodes entities, lowercases, collapses whitespace, straightens apostrophes', () => {
    assert.deepEqual(commitmentSentences('<p>We   <strong>Reply</strong>\n within <span class="x">72</span> hours &amp; we&#39;ll say so’.</p>'),
      ["we reply within 72 hours & we'll say so'."]);
    assert.equal(normalise('  A <b>B</b>\tC  '), 'a b c');
  });

  test('block-level tag boundaries end a sentence even without a full stop', () => {
    const html = '<h2>Support</h2><p>We reply within 2 hours</p><ul><li>Refunds</li><li>within 5 days</li></ul>'
      + '<p>One<br>at least 3 days</p><table><tr><td>a</td><td>no later than 4 weeks</td></tr></table><h3>Then</h3>';
    assert.deepEqual(commitmentSentences(html),
      ['we reply within 2 hours', 'within 5 days', 'at least 3 days', 'no later than 4 weeks']);
  });

  test('splits sentences on . ! ? before a capital, a digit or an opening bracket, never inside "Inc. hosts"', () => {
    assert.deepEqual(sentences('<p>First one. Second within 2 days! (Third.) Cloudflare, Inc. hosts it within 3 days.</p>'),
      ['first one.', 'second within 2 days!', '(third.)', 'cloudflare, inc. hosts it within 3 days.']);
  });

  test('head, script and style contents are not copy', () => {
    assert.deepEqual(commitmentSentences('<head><title>within 2 days</title></head><body><p>x</p></body>'), []);
    assert.deepEqual(commitmentSentences('<script>within 2 days</script><style>/* within 2 days */</style>'), []);
  });

  test('refuses a non-string', () => {
    for (const v of [null, undefined, 3, {}]) {
      assert.throws(() => commitmentSentences(v), TypeError);
      assert.throws(() => refundableCredits(v), TypeError);
    }
  });
});

describe('refundableCredits', () => {
  test('reports a sentence that makes Credits or top-ups refundable', () => {
    for (const s of [
      'Unused Credits are refundable.', 'Top-ups are refundable on request.', 'Topups can be refunded.',
      'Credits bought in the last 7 days are refunded on request.', 'A credit will be refunded if you ask.',
      'We refund unused Credits.', 'Refundable: any Credit top-up.',
      'Credits are not refundable, but top-ups are refundable.',
      'Unused Credits bought in the last 7 days are refundable on request; Credits you have used are not, except where the law requires.',
    ]) assert.equal(refundableCredits(s).length, 1, s);
  });

  test('negations are not reported', () => {
    for (const s of [
      'Credits, including top-ups and any unused balance, are not refundable and have no cash value.',
      'Credits and top-ups are not refundable.', 'Credits are non-refundable.', "Top-ups aren't refundable.",
      "Credits can't be refunded.", 'Credits cannot be refunded.', 'Credits are never refunded.', 'We do not refund Credits.',
      "We don't refund top-ups.", 'Credits returned when a Lab slip you marked as played loses are a Credit return, not a refund.',
      'This covers the subscription payment only, not Credit top-ups.',
      'We will refund the amount charged in error.',
    ]) assert.deepEqual(refundableCredits(s), [], s);
  });
});

describe('APPROVED', () => {
  test('is unique, normalised, and every entry is exactly one commitment sentence', () => {
    assert.ok(Object.isFrozen(APPROVED));
    assert.equal(new Set(APPROVED).size, APPROVED.length, 'no duplicates');
    for (const a of APPROVED) {
      assert.equal(a, normalise(a), `normalised: ${a}`);
      assert.deepEqual(commitmentSentences(a), [a], `one commitment sentence: ${a}`);
    }
    assert.deepEqual([...APPROVED].sort(), [...new Set(APPROVED_SOURCES.map((s) => normalise(s.text)))].sort());
  });

  test('carries the founding promises from site/lib/founding.js and the spec §9 kept sentences', () => {
    const has = (s) => APPROVED.includes(normalise(s));
    // Founding numbers (spec §11): 72 hours, 12 hours, 30 days — straight from the benefit cards.
    const b5 = BENEFITS.find((b) => b.id === 'B5').text;
    const b6 = BENEFITS.find((b) => b.id === 'B6').text;
    assert.ok(has(b5.slice(0, b5.indexOf('built.') + 6)), 'B5');
    assert.ok(has(b6), 'B6');
    assert.ok(APPROVED.some((a) => a.includes(`at least ${EARLY_ACCESS_HOURS} hours`)));
    assert.ok(APPROVED.some((a) => a.includes(`within ${SUPPORT_REPLY_HOURS} hours`)));
    assert.ok(APPROVED.some((a) => a.includes(`within ${CLAIM_DAYS} days`)));
    // Kept (spec §9): 30-day data-request replies, 72-hour breach notice, 5-business-day refund start,
    // the 7-day cooling-off refund.
    for (const s of [
      'We will reply within 30 days, and we may ask you to confirm the request from that address before acting on it.',
      'We reply to every request about your data within 30 days.',
      'If a breach affects personal data we hold, we will notify the Nigeria Data Protection Commission within 72 hours of becoming aware of it, and tell the people affected without undue delay.',
      'We start an agreed refund within 5 business days; how long it then takes to reach you depends on your bank.',
      'If it is your first paid subscription and you have made only limited use of paid features, we will refund that first payment in full if you ask within 7 days of making it.',
    ]) assert.ok(has(s), s);
    // Never approved: the superseded vague refund timing, or any reply-time promise for terms/refunds.
    assert.ok(!APPROVED.some((a) => /a few/.test(a)));
  });
});
