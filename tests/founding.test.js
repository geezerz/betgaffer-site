import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../site/lib/founding.js';
import config from '../site/config.js';

test('founding numbers match the programme rules (founding-member-programme.md §1-§3)', () => {
  assert.equal(F.TOTAL_PLACES, 1000);
  assert.equal(F.WAITLIST_PLACES, 500);
  assert.equal(F.LAUNCH_PLACES, 500);
  assert.equal(F.TOTAL_PLACES, F.WAITLIST_PLACES + F.LAUNCH_PLACES);
  assert.equal(F.CLAIM_DAYS, 30);
  assert.equal(F.GRACE_DAYS, 90);
  assert.equal(F.DISCOUNT_PCT, 30);
  assert.equal(F.TOPUP_BONUS_PCT, 20);
  assert.equal(F.VOTE_WEIGHT, 2);
  assert.equal(F.EARLY_ACCESS_HOURS, 72);
  assert.equal(F.SUPPORT_REPLY_HOURS, 12);
  // Programme §2 "No downgrades": an equal or better replacement, with 30 days' notice.
  assert.equal(F.NOTICE_DAYS, 30);
});

test('every printed offer percentage is derived from DISCOUNT_PCT / TOPUP_BONUS_PCT, never typed', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../site/lib/founding.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // No literal "<digits>%" in the module's code: B1's title, SUMMARY and the sentences use the constants.
  assert.deepEqual(code.match(/\d+%/g) ?? [], []);
  assert.ok(F.BENEFITS[0].title.startsWith(`${F.DISCOUNT_PCT}% off`));
  assert.ok(F.SUMMARY.startsWith(`${F.DISCOUNT_PCT}% off`));
});

test('the waitlist cap in config is the founding waitlist cap', () => {
  assert.equal(config.waitlist_places, F.WAITLIST_PLACES);
});

test('benefits: six, in programme order, each with a title and one sentence', () => {
  assert.deepEqual(F.BENEFITS.map((b) => b.id), ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
  for (const b of F.BENEFITS) {
    assert.ok(b.title.length > 0 && b.text.length > 0, b.id);
    assert.doesNotMatch(b.text, /100%/, 'no bare 100% (charter)');
  }
  assert.match(F.BENEFITS[0].text, /30% off your plan's price at every payment/);
  assert.match(F.BENEFITS[5].text, /within 12 hours/);
  assert.match(F.BENEFITS[4].text, /at least 72 hours/);
});

test('plans are the operator-decided prices (2026-10-08)', () => {
  assert.equal(config.pricing.show_prices, true);
  assert.deepEqual(config.pricing.tiers.map((t) => [t.name, t.monthly]),
    [['Free account', 0], ['Starter', 1500], ['Pro', 3000], ['Elite', 5000]]);
});

// ── The founding card's ten copy variants (spec §16.5, variants 4 and 9 as corrected in the spec) ──
// Typed out from the spec table on purpose (never derived from founding.js): **bold** marks the words
// the card highlights (bold, in the accent colour).
const SPEC_VARIANTS = Object.freeze([
  ['Be one of **1,000 founding members**', '**30% off** every subscription payment · **double Credits** · **first look** at new features · **priority support**'],
  ['**30% off** for as long as you subscribe', 'Founding members save **30%** on every payment. There are only **1,000 founding places**.'],
  ['Reserve your **founding place**', "It's **free** to join the waitlist. The first **500** reserve a founding place with **30% off** every payment."],
  ["Your plan's Credits, **doubled**", 'Founding members get **double Credits** every month on any paid plan, and **20% extra** on every top-up.'],
  ['See new features **before everyone else**', "Founding members get **early access** to new features and help **shape them** while they're built."],
  ['A **bigger say** in what we build', 'As a founding member, your vote counts **twice** when members vote on new features and improvements.'],
  ['Help when you need it, **first**', '**Priority support** on any paid plan, plus a founding-members **WhatsApp community** with our team.'],
  ['Only **1,000 founding places**', '**500** for the waitlist and **500** for the first subscribers at launch.'],
  ['Founding benefits that **stay with you**', 'Stay subscribed and keep your **30% off**, **double Credits** and **priority support**.'],
  ['Get the **founding member** badge', 'A **founding badge**, **30% off** every payment and **double Credits** — for the first **1,000**.'],
]);
/** Segments -> the spec's **markdown** form. */
const md = (segs) => segs.map((s) => (s.hl ? `**${s.t}**` : s.t)).join('');

describe('VARIANTS: the founding card copy (spec §16.5)', () => {
  test('ten variants, each the spec heading and line, with the spec highlights', () => {
    assert.equal(F.VARIANTS.length, 10);
    F.VARIANTS.forEach((v, i) => {
      assert.deepEqual(Object.keys(v).sort(), ['heading', 'line'], `variant ${i + 1}`);
      assert.equal(md(v.heading), SPEC_VARIANTS[i][0], `variant ${i + 1} heading`);
      assert.equal(md(v.line), SPEC_VARIANTS[i][1], `variant ${i + 1} line`);
    });
  });

  test('variants 4 and 9 carry the corrected spec copy (plan C amendments)', () => {
    assert.equal(md(F.VARIANTS[3].line), 'Founding members get **double Credits** every month on any paid plan, and **20% extra** on every top-up.');
    assert.equal(md(F.VARIANTS[8].line), 'Stay subscribed and keep your **30% off**, **double Credits** and **priority support**.');
  });

  test('segments: a non-empty string t, hl only as true, offer exactly when the segment prints a %', () => {
    let offers = 0;
    for (const [i, v] of F.VARIANTS.entries()) {
      for (const s of [...v.heading, ...v.line]) {
        assert.ok(typeof s.t === 'string' && s.t.length > 0, `variant ${i + 1}: ${JSON.stringify(s)}`);
        for (const k of Object.keys(s)) assert.ok(['t', 'hl', 'offer'].includes(k), `variant ${i + 1}: key ${k}`);
        if ('hl' in s) assert.equal(s.hl, true);
        assert.equal(s.offer === true, s.t.includes('%'), `variant ${i + 1}: ${JSON.stringify(s)}`);
        if ('offer' in s) { assert.equal(s.offer, true); offers++; }
      }
      // No two plain segments in a row (they would be one segment).
      for (const segs of [v.heading, v.line]) {
        segs.forEach((s, j) => { if (j > 0) assert.ok(s.hl || segs[j - 1].hl || s.offer || segs[j - 1].offer, `variant ${i + 1} seg ${j}`); });
      }
    }
    assert.equal(offers, 7, 'premise: the seven % segments of the table (v1, v2 ×2, v3, v4, v9, v10)');
  });

  test('every percentage is one of the two offer numbers, built from the constants', () => {
    const pcts = F.VARIANTS.flatMap((v) => [...v.heading, ...v.line]).flatMap((s) => s.t.match(/\d+%/g) ?? []);
    assert.deepEqual([...new Set(pcts)].sort(), [`${F.TOPUP_BONUS_PCT}%`, `${F.DISCOUNT_PCT}%`].sort());
  });

  test('the place counts track the constants (1,000 with a thousands separator)', () => {
    const text = (v) => [...v.heading, ...v.line].map((s) => s.t).join('');
    assert.match(text(F.VARIANTS[0]), /1,000 founding members/);
    assert.match(text(F.VARIANTS[7]), /^Only 1,000 founding places500 for the waitlist and 500 for the first/);
    assert.ok(F.VARIANTS.every((v) => !/\b1000\b/.test(text(v))), 'never "1000"');
  });

  test('frozen: a page cannot rewrite the copy', () => {
    assert.ok(Object.isFrozen(F.VARIANTS));
    for (const v of F.VARIANTS) {
      assert.ok(Object.isFrozen(v) && Object.isFrozen(v.heading) && Object.isFrozen(v.line));
      for (const s of [...v.heading, ...v.line]) assert.ok(Object.isFrozen(s));
    }
  });

  test('the copy passes the banned-phrase scan and makes no time commitment', async () => {
    const { findBanned } = await import('../site/lib/claims.js');
    const { commitmentSentences } = await import('../site/lib/commitments.js');
    for (const [i, v] of F.VARIANTS.entries()) {
      const t = `<p>${md(v.heading)}</p><p>${md(v.line)}</p>`.replace(/\*\*/g, '');
      assert.deepEqual(findBanned(t), [], `variant ${i + 1}`);
      assert.deepEqual(commitmentSentences(t), [], `variant ${i + 1}`);
    }
    // Premise: both scans fire on this kind of copy.
    assert.deepEqual(findBanned('<p>A sure bet for founding members.</p>'), ['sure bet']);
    assert.equal(commitmentSentences('<p>Priority support within 12 hours.</p>').length, 1);
  });
});

describe('variantFor(path): the static variant of a page', () => {
  test('pathHash is FNV-1a 32-bit (stable across builds and runtimes)', () => {
    assert.equal(F.pathHash(''), 0x811c9dc5);
    assert.equal(F.pathHash('a'), 0xe40c292c);
    assert.equal(F.pathHash('foobar'), 0xbf9cf968);
  });

  test('a dated page (day / archive): an index into VARIANTS from its path hash, deterministic', () => {
    for (const p of ['/day/2026-10-07/', '/day/2026-10-08/', '/day/2025-01-01/']) {
      const i = F.variantFor(p);
      assert.ok(Number.isInteger(i) && i >= 0 && i < F.VARIANTS.length, `${p}: ${i}`);
      assert.equal(F.variantFor(p), i);
      assert.equal(i, F.pathHash(p) % F.VARIANTS.length);
    }
    assert.throws(() => F.variantFor(7), TypeError);
  });

  test('the fixed pages have an explicit variant each, all different; the home page shows variant 1', () => {
    const map = F.PAGE_VARIANTS;
    assert.ok(Object.isFrozen(map));
    assert.equal(map['/'], 0, "operator's pick (2026-10-08): the home page leads with variant 1");
    assert.equal(F.VARIANTS[F.variantFor('/')].heading.map((x) => x.t).join(''), 'Be one of 1,000 founding members');
    const values = Object.values(map);
    assert.ok(values.every((i) => Number.isInteger(i) && i >= 0 && i < F.VARIANTS.length), String(values));
    assert.equal(new Set(values).size, values.length, `distinct: ${JSON.stringify(map)}`);
    for (const [p, i] of Object.entries(map)) assert.equal(F.variantFor(p), i, `${p} uses its mapped variant, not its hash`);
    assert.ok(Object.keys(map).some((p) => F.pathHash(p) % F.VARIANTS.length !== map[p]), 'premise: the map overrides the hash somewhere');
    assert.equal(Object.hasOwn(map, 'toString'), false);
    assert.equal(F.variantFor('toString'), F.pathHash('toString') % F.VARIANTS.length, 'only own keys of the map count');
  });

  test('different pages carry different copy: at least 5 distinct variants over the site\'s paths', () => {
    const paths = ['/', '/404.html', '/day/2026-10-07/', '/day/2026-10-08/', '/features/', '/our-record/', '/privacy/', '/refunds/', '/terms/'];
    const seen = new Set(paths.map(F.variantFor));
    assert.ok(seen.size >= 5, `${seen.size} distinct`);
  });
});
