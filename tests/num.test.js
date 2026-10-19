// The one number formatter (BRAND 2026-10-12): every count a visitor reads goes through
// site/lib/num.js, so a count of four or more digits always carries thousands separators and the
// build and the browser print the same text (no ICU / locale lookup anywhere).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtInt, plural } from '../site/lib/num.js';
import { ISOMORPHIC_LIB } from '../site/build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC = stripComments(readFileSync(join(ROOT, 'site/lib/num.js'), 'utf8'));

test('fmtInt: a comma every three digits from the right; under 1,000 unchanged', () => {
  const cases = [
    [0, '0'], [7, '7'], [45, '45'], [999, '999'], [1000, '1,000'], [1054, '1,054'], [1099, '1,099'], [1114, '1,114'],
    [1308, '1,308'], [9999, '9,999'], [10000, '10,000'], [10081, '10,081'], [12154, '12,154'], [100000, '100,000'],
    [999999, '999,999'], [1000000, '1,000,000'], [1234567, '1,234,567'], [Number.MAX_SAFE_INTEGER, '9,007,199,254,740,991'],
    [-999, '-999'], [-1234, '-1,234'], [-0, '0'],
  ];
  for (const [n, want] of cases) assert.equal(fmtInt(n), want, String(n));
});

test('fmtInt: only whole numbers — anything else throws rather than print a guess', () => {
  for (const bad of ['1114', '1,114', 1.5, NaN, Infinity, -Infinity, null, undefined, true, 1114n, {}, [], [1114], 2 ** 53]) {
    assert.throws(() => fmtInt(bad), TypeError, typeof bad === 'bigint' ? 'bigint' : JSON.stringify(bad) ?? String(bad));
  }
});

test('plural: the formatted count and the right noun', () => {
  assert.equal(plural(0, 'fixture', 'fixtures'), '0 fixtures');
  assert.equal(plural(1, 'fixture', 'fixtures'), '1 fixture');
  assert.equal(plural(2, 'push', 'pushes'), '2 pushes');
  assert.equal(plural(1114, 'fixture', 'fixtures'), '1,114 fixtures');
  assert.equal(plural(12345, 'competition', 'competitions'), '12,345 competitions');
  assert.throws(() => plural('3', 'fixture', 'fixtures'), TypeError);
});

test('isomorphic and locale-free: shipped to the browser, no imports, no Intl / toLocaleString, no node: / process / Buffer', () => {
  assert.ok(ISOMORPHIC_LIB.includes('num.js'), 'the build ships num.js beside the modules that import it');
  assert.doesNotMatch(SRC, /^\s*import\s/m, 'no imports');
  assert.doesNotMatch(SRC, /\bIntl\b|toLocaleString|navigator|\bnode:|\bprocess\b|\bBuffer\b/);
});

// site/assets/js/waitlist.js is the ONE documented exception: tests/waitlist.test.js imports it
// directly from source (unlike predictions.js, whose own tests only import a BUILT copy), so it
// cannot `import` the isomorphic num.js -- that path only exists post-build. Allowed ONLY here,
// and only because the next test proves its copy is byte-for-byte the same formatter.
const ALLOWED_DUPLICATE = 'site/assets/js/waitlist.js';

test('ONE formatter: no other module groups digits, asks the locale, or keeps its own plural()', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.m?js$/.test(e.name)) files.push(rel);
    }
  };
  walk('site');
  walk('functions');
  assert.ok(files.includes('site/lib/fixtures.js') && files.includes('site/assets/js/predictions.js') && files.includes('site/build.mjs'), 'premise: the walk reaches the site');
  const hits = [];
  for (const rel of files) {
    if (rel === 'site/lib/num.js' || rel === ALLOWED_DUPLICATE) continue;
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    // the digit-grouping lookahead (any spelling of "\B(?=(\d{3})+"), a locale call, or a local plural
    for (const [what, re] of [['groups digits itself', /\\d\{3\}\)\+/], ['asks the locale', /toLocaleString|Intl\.NumberFormat/], ['defines its own plural', /(?:const|let|var|function)\s+plural\b/]]) {
      if (re.test(code)) hits.push(`${rel} ${what}`);
    }
  }
  assert.deepEqual(hits, []);
  // premise: the grouping pattern is the one num.js uses, so the scan would see a copy of it
  assert.match(SRC, /\\d\{3\}\)\+/);
});

test('the one allowed duplicate (waitlist.js) groups digits identically to fmtInt, over the same case table', () => {
  const code = stripComments(readFileSync(join(ROOT, ALLOWED_DUPLICATE), 'utf8'));
  const m = code.match(/const fmtInt = \(n\) => (String\(n\)\.replace\([^;]+\));/);
  assert.ok(m, 'waitlist.js must define fmtInt as a single expression this test can extract and run');
  // eslint-disable-next-line no-new-func -- extracting and running the ALLOWED duplicate's own
  // expression is the whole point: a hand-copied assertion could drift from the real source silently.
  const dup = new Function('n', `return ${m[1]};`);
  for (const n of [0, 7, 999, 1000, 1114, 9999, 10000, 1234567]) assert.equal(dup(n), fmtInt(n), String(n));
});

test('every module that prints counts imports the formatter', () => {
  const importsNum = (rel) => /from\s+'(?:\.\/|\.\.\/lib\/|\.\/lib\/)num\.js'/.test(readFileSync(join(ROOT, rel), 'utf8'));
  for (const rel of ['site/lib/fixtures.js', 'site/lib/ring.js', 'site/lib/balloon-model.js', 'site/lib/record.js', 'site/lib/layout.js',
    'site/lib/founding.js', 'site/build.mjs', 'site/assets/js/predictions.js', 'site/content/features.js', 'site/content/waitlist.js', 'site/content/terms.js']) {
    assert.ok(importsNum(rel), rel);
  }
});
