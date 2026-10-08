import { test } from 'node:test';
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
