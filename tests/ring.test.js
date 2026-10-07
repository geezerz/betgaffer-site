import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ring, fmtPct } from '../site/lib/ring.js';

const SRC_RAW = readFileSync(fileURLToPath(new URL('../site/lib/ring.js', import.meta.url)), 'utf8');
// Code only: a comment that NAMES a banned API must neither pass nor fail the isomorphism check.
const SRC = SRC_RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const acc = (won, lost, pushes, pct) => ({ won, lost, pushes, graded: won + lost, pct });
/** Visible text: tags stripped, entities decoded for the five escapes. */
const text = (html) => html.replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const ariaLabel = (html) => {
  const m = /aria-label="([^"]*)"/.exec(html);
  assert.ok(m, 'the ring carries an aria-label');
  return m[1];
};

// ---------------------------------------------------------------- empty ring (spec test 5)

test('graded === 0: "No results yet", never 0%, --%, 0/0 or 0 of 0, and no arc', () => {
  for (const a of [acc(0, 0, 0, null), acc(0, 0, 2, null)]) {
    const html = ring(a, { dayLabel: "Today's published picks, settled so far", date: '2026-10-08' });
    const t = text(html);
    assert.match(t, /No results yet/);
    assert.ok(!t.includes('0%'), `no 0%: ${t}`);
    assert.ok(!t.includes('--%'), 'no --%');
    assert.ok(!t.includes('0/0'), 'no 0/0');
    assert.ok(!/\b0 of 0\b/.test(t), 'no 0 of 0');
    assert.ok(!t.includes('%'), 'no percentage at all on an empty ring');
    assert.ok(!html.includes('ring__arc'), 'no arc is drawn');
    assert.ok(html.includes('ring__track'), 'the track is still drawn');
    // The empty track is dashed (an "open" dial), never a solid ring that could read as a figure.
    assert.match(html, /<circle class="ring__track ring__track--empty"[^>]*stroke-dasharray="[\d.]+ [\d.]+"/);
    assert.equal((html.match(/stroke-dasharray/g) || []).length, 1, 'the only dash array is the empty track\'s');
    assert.match(ariaLabel(html), /no results yet/i);
    assert.ok(!ariaLabel(html).includes('%'));
  }
});

test('graded === 0 with pushes says the pushes are not counted', () => {
  const t = text(ring(acc(0, 0, 2, null), { dayLabel: 'X' }));
  assert.match(t, /2 pushes not counted/);
  assert.match(text(ring(acc(0, 0, 1, null), { dayLabel: 'X' })), /1 push not counted/);
});

test('empty ring ignores a stray non-null pct (no figure without a denominator)', () => {
  const t = text(ring({ won: 0, lost: 0, pushes: 0, graded: 0, pct: 0 }, { dayLabel: 'X' }));
  assert.match(t, /No results yet/);
  assert.ok(!t.includes('%'));
});

// ---------------------------------------------------------------- graded > 0

test('relDay tags the ring for relabelling (both states); without it no tag; a bad relDay throws', () => {
  for (const a of [acc(6, 1, 0, 85.71), acc(0, 0, 0, null)]) {
    const html = ring(a, { dayLabel: 'Picks published for Wed 7 Oct 2026, settled so far', date: '2026-10-07', relDay: '2026-10-07' });
    assert.match(html, /^<div class="ring" data-figure="ring" data-rel-day="2026-10-07" data-rel="ring" /);
    assert.match(ariaLabel(html), /^Picks published for Wed 7 Oct 2026, settled so far: /, 'aria-label starts with the label it relabels');
    assert.doesNotMatch(ring(a, { dayLabel: 'X' }), /data-rel/);
  }
  assert.throws(() => ring(acc(1, 0, 0, 100), { relDay: '2026-02-30' }), /relDay/);
});

test('graded > 0: fraction is the hero, pct secondary, date, pushes, arc from pct', () => {
  const html = ring(acc(6, 1, 2, 85.71), { dayLabel: 'Picks published for Wed 7 Oct 2026, settled so far', date: '2026-10-07' });
  const t = text(html);
  assert.match(html, /data-figure="ring"/);
  assert.match(t, /6 of 7 landed/);
  assert.match(t, /85\.71%/);
  assert.match(t, /Wed 7 Oct 2026/);
  assert.match(t, /2 pushes not counted/);
  assert.match(html, /<circle[^>]*class="ring__arc"[^>]*stroke-dasharray="85\.71 100"/);
  assert.match(html, /pathLength="100"/);
  // The hero fraction precedes the percentage in reading order.
  assert.ok(t.indexOf('6 of 7') < t.indexOf('85.71%'));
  const label = ariaLabel(html);
  assert.match(label, /6 of 7 landed/);
  assert.match(label, /85\.71%/);
  assert.match(label, /2 pushes not counted/);
});

test('no pushes line when pushes === 0', () => {
  assert.ok(!/push/i.test(text(ring(acc(3, 1, 0, 75), { dayLabel: 'X' }))));
});

test('pct rendered as published, up to 2 decimals', () => {
  assert.equal(fmtPct(85.71), '85.71');
  assert.equal(fmtPct(85.7), '85.7');
  assert.equal(fmtPct(50), '50');
  assert.equal(fmtPct(66.666), '66.67');
  assert.equal(fmtPct(99.996), '100');
});

test('label is always visible, defaults sensibly, and is escaped', () => {
  assert.match(text(ring(acc(1, 1, 0, 50), {})), /Published picks, settled so far/);
  const html = ring(acc(1, 1, 0, 50), { dayLabel: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img'), 'label escaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

// ---------------------------------------------------------------- the 100% rule (charter)

test('100% carries its denominator, "settled so far" and the stated-at probability', () => {
  const html = ring(acc(3, 0, 0, 100), { dayLabel: "Today's published picks, settled so far", meanStatedPct: 87 });
  const t = text(html);
  assert.match(t, /3 of 3 landed/);
  assert.match(t, /100%/);
  assert.match(t, /settled so far/);
  assert.match(t, /these picks were stated at an average 87%/i);
  assert.match(ariaLabel(html), /stated at an average 87%/);
});

test('100% is withheld (fraction only) when the stated-at probability is unknown', () => {
  for (const m of [undefined, null, NaN, -1, 101, '87']) {
    const html = ring(acc(3, 0, 0, 100), { dayLabel: 'X', meanStatedPct: m });
    const t = text(html);
    assert.match(t, /3 of 3 landed/);
    assert.ok(!t.includes('100%'), `never a bare 100% (meanStatedPct=${String(m)})`);
    assert.ok(!t.includes('stated at'));
    assert.ok(!ariaLabel(html).includes('100%'));
    assert.ok(!html.includes('ring__arc'), 'a withheld 100% draws no full arc either');
    assert.ok(!html.includes('ring__track--empty'), 'but it is not the empty state');
  }
});

test('a stated mean that rounds up to 100 reads ">99", never 100', () => {
  for (const m of [99.5, 99.9, 100]) {
    const t = text(ring(acc(3, 0, 0, 100), { dayLabel: 'X', meanStatedPct: m }));
    assert.match(t, /stated at an average >99%/, `m=${m}`);
    assert.ok(!/average 100%/.test(t));
  }
  assert.match(text(ring(acc(3, 0, 0, 100), { dayLabel: 'X', meanStatedPct: 99.49 })), /stated at an average 99%/);
});

test('a pct that ROUNDS to 100 is held to the 100% rule too', () => {
  const bare = text(ring(acc(3, 0, 0, 99.996), { dayLabel: 'X' }));
  assert.ok(!bare.includes('100%'));
  const ok = text(ring(acc(3, 0, 0, 99.996), { dayLabel: 'X', meanStatedPct: 90 }));
  assert.match(ok, /100%/);
  assert.match(ok, /stated at an average 90%/);
  assert.match(ring(acc(3, 0, 0, 99.996), { dayLabel: 'X', meanStatedPct: 90 }), /class="ring__arc"[^>]*stroke-dasharray="100 100"/);
});

test('stated-at is shown only on a 100% ring', () => {
  assert.ok(!text(ring(acc(2, 1, 0, 66.67), { dayLabel: 'X', meanStatedPct: 80 })).includes('stated at'));
});

// ---------------------------------------------------------------- contract hygiene

test('rejects malformed accuracy rather than misrendering it', () => {
  assert.throws(() => ring(null, {}), TypeError);
  assert.throws(() => ring({ won: 1, lost: 1, pushes: 0, graded: 3, pct: 50 }, {}), /graded/);
  assert.throws(() => ring({ won: 1, lost: 0, pushes: 0, graded: 1, pct: null }, {}), /pct/);
  assert.throws(() => ring({ won: '1', lost: 0, pushes: 0, graded: 1, pct: 100 }, {}), TypeError);
  assert.throws(() => ring(acc(1, 0, 0, 100), { date: '2026-02-30' }), TypeError);
});

test('no inline style, no <style>, no script; arc colour lives in CSS classes', () => {
  const html = ring(acc(6, 1, 0, 85.71), { dayLabel: 'X' }) + ring(acc(0, 0, 0, null), { dayLabel: 'X' });
  assert.ok(!/style=/i.test(html));
  assert.ok(!/<style/i.test(html));
  assert.ok(!/<script/i.test(html));
});

test('the ring element holds no nested <div> (claim scanners match it as one element)', () => {
  const html = ring(acc(3, 0, 0, 100), { dayLabel: 'X', meanStatedPct: 87 });
  assert.equal((html.match(/<div/g) || []).length, 1);
  assert.ok(html.trimEnd().endsWith('</div>'));
});

test('isomorphic: imports only ./esc.js and ./time.js, no node: / process / Buffer', () => {
  const specs = [...SRC.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const s of specs) assert.ok(['./esc.js', './time.js'].includes(s), `unexpected import ${s}`);
  assert.ok(!/\bnode:/.test(SRC));
  assert.ok(!/\bprocess\b/.test(SRC));
  assert.ok(!/\bBuffer\b/.test(SRC));
});
