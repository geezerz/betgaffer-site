import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escHtml, escAttr } from '../site/lib/esc.js';

for (const [name, fn] of [['escHtml', escHtml], ['escAttr', escAttr]]) {
  test(`${name} neutralises a script-injection payload`, () => {
    const out = fn('<img src=x onerror=alert(1)>');
    assert.equal(out, '&lt;img src=x onerror=alert(1)&gt;');
    assert.ok(!out.includes('<') && !out.includes('>'));
  });

  test(`${name} escapes quotes and ampersands (ampersand first, no double escaping)`, () => {
    assert.equal(fn(`Tom & "Jerry" 'x'`), 'Tom &amp; &quot;Jerry&quot; &#39;x&#39;');
    assert.equal(fn('&amp;'), '&amp;amp;');
    assert.equal(fn('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
  });

  test(`${name} maps null/undefined to empty and stringifies numbers`, () => {
    assert.equal(fn(null), '');
    assert.equal(fn(undefined), '');
    assert.equal(fn(0), '0');
    assert.equal(fn(84.48), '84.48');
  });

  test(`${name} leaves plain and non-ASCII text alone`, () => {
    assert.equal(fn('São Paulo 😀 1.20'), 'São Paulo 😀 1.20');
    assert.equal(fn(''), '');
  });

  test(`${name} throws TypeError on anything that is not a string, number, null or undefined`, () => {
    for (const bad of [{}, { toString: () => '<b>' }, [], ['<b>'], true, false, 1n, Symbol('s'), () => 'x']) {
      assert.throws(() => fn(bad), TypeError, `expected TypeError for ${typeof bad}`);
    }
  });
}

test('esc.js is isomorphic (no node: imports, process or Buffer)', () => {
  const src = readFileSync(new URL('../site/lib/esc.js', import.meta.url), 'utf8');
  // Any quoted 'node:' specifier: static `from`, bare `import 'node:x'` and dynamic import().
  assert.doesNotMatch(src, /['"]node:/);
  assert.doesNotMatch(src, /\bprocess\b/);
  assert.doesNotMatch(src, /\bBuffer\b/);
  assert.doesNotMatch(src, /\brequire\s*\(/);
});
