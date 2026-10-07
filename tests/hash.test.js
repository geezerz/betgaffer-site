import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalRows, canonicalText, picksHash } from '../site/lib/hash.js';

const SRC = readFileSync(new URL('../site/lib/hash.js', import.meta.url), 'utf8');
const VECTORS = JSON.parse(readFileSync(new URL('./fixtures/hash-vectors.json', import.meta.url), 'utf8'));
const DAY_FILES = ['2026-10-07', '2026-10-08'].map((d) =>
  JSON.parse(readFileSync(new URL(`./fixtures/artifact/days/${d}.json`, import.meta.url), 'utf8')));

// Built from char codes, never typed as escapes (see the plan's tooling hazard).
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const LS_ESC = '\\' + 'u2028';
const PS_ESC = '\\' + 'u2029';

const syncSha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
// The browser path: WebCrypto (globalThis.crypto.subtle exists in Node 22 too).
const webSha = async (s) => {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

test('the char-code constants are what they claim to be', () => {
  assert.equal(LS.length, 1);
  assert.equal(LS.charCodeAt(0), 0x2028);
  assert.equal(PS.charCodeAt(0), 0x2029);
  assert.equal(LS_ESC.length, 6);
  assert.equal(LS_ESC.charCodeAt(0), 0x5c);
  assert.equal(PS_ESC, String.fromCharCode(0x5c) + 'u2029');
});

for (const [name, sha] of [['node:crypto (sync)', syncSha], ['WebCrypto (async)', webSha]]) {
  test(`reproduces both publisher reference vectors via ${name}`, async () => {
    for (const key of ['basic', 'unicode']) {
      assert.equal(await picksHash(VECTORS[key].fixtures, sha), VECTORS[key].picks_hash, key);
    }
  });

  test(`reproduces both fixture artifact files' picks_hash via ${name}`, async () => {
    for (const day of DAY_FILES) {
      assert.equal(await picksHash(day.fixtures, sha), day.picks_hash, day.lagos_day);
    }
  });
}

test('the unicode vector really exercises U+2028/U+2029 and they are escaped in the canonical text', () => {
  const label = VECTORS.unicode.fixtures[0].pick.label;
  assert.ok(label.includes(LS), 'vector label must contain a raw U+2028 after parsing');
  assert.ok(label.includes(PS), 'vector label must contain a raw U+2029 after parsing');
  const text = canonicalText(VECTORS.unicode.fixtures);
  assert.ok(!text.includes(LS) && !text.includes(PS), 'no raw separator may survive');
  assert.ok(text.includes(LS_ESC) && text.includes(PS_ESC), 'the 6-character escapes must be present');
  // Without the escape step the digest differs — the vector would catch a no-op replacement.
  assert.notEqual('sha256:' + syncSha(JSON.stringify(canonicalRows(VECTORS.unicode.fixtures))),
    VECTORS.unicode.picks_hash);
});

test('canonical rows: sorted by fx, fixed element order, price as a 2-dp string', () => {
  const rows = canonicalRows(VECTORS.basic.fixtures);
  assert.deepEqual(rows, [
    [10, 100, 1, 4, ['over_1_5', 'Over 1.5', 88, '1.20', false, 'Form/xG'], '2026-10-07T22:15:00Z', false],
    [20, 200, 2, 3, null, null, false],
  ]);
  assert.equal(canonicalText(VECTORS.basic.fixtures),
    '[[10,100,1,4,["over_1_5","Over 1.5",88,"1.20",false,"Form/xG"],"2026-10-07T22:15:00Z",false],[20,200,2,3,null,null,false]]');
});

test('hash ignores display fields and row order, but not frozen identity', async () => {
  const base = DAY_FILES[1].fixtures;
  const h = await picksHash(base, syncSha);
  const shuffled = [...base].reverse().map((f) => ({ ...f, ko: '2030-01-01T00:00:00Z', status: 'FT', home: 'X', grade: 'won', pre_ko: false }));
  assert.equal(await picksHash(shuffled, syncSha), h);

  const firstPicked = base.findIndex((f) => f.pick);
  const tamper = (fn) => base.map((f, i) => (i === firstPicked ? fn(structuredClone(f)) : f));
  for (const [what, fn] of [
    ['label', (f) => { f.pick.label += ' '; return f; }],
    ['market', (f) => { f.pick.market = 'draw'; return f; }],
    ['price', (f) => { f.pick.price = f.pick.price + 0.01; return f; }],
    ['price_est', (f) => { f.pick.price_est = !f.pick.price_est; return f; }],
    ['withdrawn', (f) => { f.withdrawn = !f.withdrawn; return f; }],
    ['frozen_at', (f) => { f.frozen_at = '2026-10-07T22:16:00Z'; return f; }],
    ['api_fx', (f) => { f.api_fx += 1; return f; }],
  ]) {
    assert.notEqual(await picksHash(tamper(fn), syncSha), h, what);
  }
});

test('throws on a duplicate fx', async () => {
  const f = VECTORS.basic.fixtures;
  assert.throws(() => canonicalRows([...f, { ...f[0] }]), /duplicate fx/);
  await assert.rejects(picksHash([...f, { ...f[0] }], syncSha), /duplicate fx/);
});

test('throws on a non-integer fx', () => {
  for (const fx of [1.5, '10', null, undefined, Number.NaN, Infinity]) {
    assert.throws(() => canonicalRows([{ ...VECTORS.basic.fixtures[0], fx }]), /fx/, String(fx));
  }
});

test("throws on field types the publisher's canonical form cannot be reproduced for", () => {
  const row = VECTORS.basic.fixtures[1];
  assert.throws(() => canonicalRows([{ ...row, api_fx: '100' }]), TypeError);
  assert.throws(() => canonicalRows([{ ...row, withdrawn: 'false' }]), TypeError);
  assert.throws(() => canonicalRows([{ ...row, frozen_at: 5 }]), TypeError);
  assert.throws(() => canonicalRows([{ ...row, pick: { ...row.pick, price: '1.20' } }]), TypeError);
  assert.throws(() => canonicalRows([{ ...row, pick: { ...row.pick, label: 7 } }]), TypeError);
  assert.throws(() => canonicalRows('nope'), TypeError);
});

test('README canonical form: a missing or null withdrawn / price_est counts as false', () => {
  const a = VECTORS.basic.fixtures.find((f) => f.pick !== null);
  const want = canonicalText([a]);
  assert.match(want, /,false\]\]$/, 'premise: the vector row is not withdrawn');
  for (const v of [null, undefined]) {
    const row = { ...a, withdrawn: v, pick: { ...a.pick, price_est: v } };
    if (v === undefined) { delete row.withdrawn; delete row.pick.price_est; }
    assert.equal(canonicalText([row]), want, String(v));
  }
});

test('a pick without a non-empty market hashes as null (as the publisher canonicalises it)', () => {
  const row = { ...VECTORS.basic.fixtures[0], pick: { market: '', label: 'x', pct: 1, price: 1, price_est: false, why: null } };
  assert.equal(canonicalRows([row])[0][4], null);
});

test('rejects a sha256 function that does not return 64 lowercase hex chars', async () => {
  await assert.rejects(picksHash(VECTORS.basic.fixtures, () => 'ABC'), /sha256/);
  await assert.rejects(picksHash(VECTORS.basic.fixtures, async () => new ArrayBuffer(32)), /sha256/);
  await assert.rejects(picksHash(VECTORS.basic.fixtures), /sha256/);
});

test('hash.js is isomorphic (no node: imports, process or Buffer)', () => {
  // Any quoted 'node:' specifier: static `from`, bare `import 'node:x'` and dynamic import().
  assert.doesNotMatch(SRC, /['"]node:/);
  assert.doesNotMatch(SRC, /\bprocess\b/);
  assert.doesNotMatch(SRC, /\bBuffer\b/);
  assert.doesNotMatch(SRC, /\brequire\s*\(/);
  assert.doesNotMatch(SRC, /export\s+(async\s+)?function\s+nodeSha256/);
});
