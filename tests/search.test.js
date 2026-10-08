import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fold, words, matcher, rowWords, _memoSize } from '../site/lib/search.js';

const C = (...codes) => String.fromCharCode(...codes);
const hit = (query, row) => matcher(query)(rowWords(row));

test('fold lower-cases, strips marks and collapses punctuation', () => {
  assert.equal(fold('  Atl' + C(0xe9) + 'tico   Madrid '), 'atletico madrid');
  assert.equal(fold('St. Pauli'), 'st pauli');
  assert.equal(fold(''), '');
  assert.equal(fold('---'), '');
});

test('fold maps the non-decomposing letters (built from char codes)', () => {
  assert.equal(fold(C(0xf8)), 'o');
  assert.equal(fold(C(0xe6)), 'ae');
  assert.equal(fold(C(0xdf)), 'ss');
  assert.equal(fold(C(0x142)), 'l');
  assert.equal(fold(C(0x131)), 'i');
  assert.equal(fold(C(0x111)), 'd');
  assert.equal(fold(C(0x153)), 'oe');
  assert.equal(fold(C(0xfe)), 'th');
  assert.equal(fold(C(0xd8) + 'lstykke'), 'olstykke');
  assert.equal(fold(C(0x130) + 'stanbul'), 'istanbul');
});

test('fold strips all three apostrophe forms', () => {
  assert.equal(fold("Newell's"), 'newells');
  assert.equal(fold('Newell' + C(0x2019) + 's'), 'newells');
  assert.equal(fold('Newell' + C(0x2bc) + 's'), 'newells');
});

test('words splits on single spaces with no empties', () => {
  assert.deepEqual(words(' a  b-c '), ['a', 'b', 'c']);
  assert.deepEqual(words(''), []);
});

test('Atletico Madrid found by atl mad, ATL, madrid', () => {
  const row = { home: 'Atl' + C(0xe9) + 'tico Madrid', away: 'Getafe', comp: 'La Liga' };
  assert.ok(hit('atl mad', row));
  assert.ok(hit('ATL', row));
  assert.ok(hit('madrid', row));
  assert.ok(hit('mad atl', row));
});

test('special letters are searchable by plain ASCII', () => {
  assert.ok(hit('ol', { home: C(0xd8) + 'lstykke', away: 'X', comp: 'Y' }));
  assert.ok(hit('gross', { home: 'Gro' + C(0xdf) + 'aspach', away: 'X', comp: 'Y' }));
  assert.ok(hit('lodz', { home: C(0x141) + 'ód' + C(0x017a), away: 'X', comp: 'Y' }));
  assert.ok(hit('ist', { home: C(0x130) + 'stanbul', away: 'X', comp: 'Y' }));
  assert.ok(hit('ist', { home: C(0x131) + 'stanbul', away: 'X', comp: 'Y' }));
});

test('punctuation: St. Pauli found by "st pauli"', () => {
  assert.ok(hit('st pauli', { home: 'St. Pauli', away: 'X', comp: 'Y' }));
});

test('multi-word across fields', () => {
  assert.ok(hit('arsenal premier', { home: 'Arsenal', away: 'Chelsea', comp: 'Premier League' }));
  assert.ok(hit('chel prem', { home: 'Arsenal', away: 'Chelsea', comp: 'Premier League' }));
});

test('non-prefix does not match', () => {
  assert.equal(hit('senal', { home: 'Arsenal', away: 'Chelsea', comp: 'Premier League' }), false);
  assert.equal(hit('arsenal zzz', { home: 'Arsenal', away: 'Chelsea', comp: 'Premier League' }), false);
});

test('empty and blank queries match everything', () => {
  assert.ok(matcher('')([]));
  assert.ok(matcher('   ')(rowWords({ home: 'A', away: 'B', comp: 'C' })));
  assert.ok(matcher('...')([]));
});

test('non-Latin names are preserved', () => {
  const row = { home: 'Ολυμπιακός', away: 'X', comp: 'Y' };
  assert.ok(hit('ολυμ', row));
  assert.ok(hit('ΟΛΥΜ', row));
  assert.notEqual(fold(row.home), '');
});

test('newells finds Newell\'s Old Boys', () => {
  const row = { home: "Newell's Old Boys", away: 'X', comp: 'Y' };
  assert.ok(hit('newells', row));
  assert.ok(hit('newells old', row));
});

test('rowWords tolerates missing fields', () => {
  assert.deepEqual(rowWords({ home: 'A' }), ['a']);
  assert.deepEqual(rowWords({}), []);
});

test('performance: one COLD pass over 1,550 distinct rows (memo cannot help) in < 1000 ms (a sanity bound; B5 times the real browser)', () => {
  const rows = [];
  for (let i = 0; i < 1550; i++) {
    const u = 'u' + i.toString(36) + 'x' + (i * 7919).toString(36);
    rows.push({ home: 'Atl' + C(0xe9) + 'tico ' + u, away: "Newell's " + u + 'b', comp: 'Premier ' + u + 'c' });
  }
  const t0 = performance.now();
  const idx = rows.map(rowWords);
  const n = idx.filter(matcher('atl prem')).length;
  const dt = performance.now() - t0;
  assert.equal(n, 1550);
  assert.ok(dt < 1000, 'took ' + dt + ' ms');
});

test('memo hit equals a cold fold', () => {
  const s = 'Mem' + C(0xf8) + " Test's " + C(0xe9) + 'quipe';
  const cold = fold(s);
  assert.equal(fold(s), cold);
  assert.equal(cold, 'memo tests equipe');
});

test('memo size is bounded at 4,096', () => {
  for (let i = 0; i < 10000; i++) fold('bound-' + i);
  assert.ok(_memoSize() <= 4096, 'size ' + _memoSize());
  assert.ok(_memoSize() > 0);
});

test('precomposed letters fold: o-stroke-acute and ae-acute', () => {
  assert.equal(fold(C(0x1ff) + 'sterbro'), 'osterbro');
  assert.ok(hit('oster', { home: C(0x1ff) + 'sterbro', away: 'X', comp: 'Y' }));
  assert.equal(fold(C(0x1fd)), 'ae');
});

test('apostrophe forms: backtick, acute accent, left single quote', () => {
  for (const ch of ['`', C(0xb4), C(0x2018)]) {
    assert.equal(fold('Newell' + ch + 's'), 'newells');
    assert.ok(hit('newells', { home: 'Newell' + ch + 's Old Boys', away: 'X', comp: 'Y' }));
  }
});

test('rowWords(null) and rowWords(undefined) do not throw', () => {
  assert.deepEqual(rowWords(null), []);
  assert.deepEqual(rowWords(undefined), []);
});

test('isomorphism guard: source has no node:, process, Buffer, require or imports', () => {
  const src = readFileSync(new URL('../site/lib/search.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(code.length > 100, 'source must be present');
  assert.doesNotMatch(code, /node:/);
  assert.doesNotMatch(code, /\bprocess\b/);
  assert.doesNotMatch(code, /\bBuffer\b/);
  assert.doesNotMatch(code, /\brequire\s*\(/);
  assert.doesNotMatch(code, /^\s*import\b/m);
  assert.doesNotMatch(code, /\bimport\s*\(/);
});
