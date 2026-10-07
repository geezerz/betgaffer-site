// The public repository carries no internal names: not the private platform's name, its classes,
// its tables or its data provider. Every name below is assembled from pieces so this file passes
// its own scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const j = (...parts) => parts.join('');

const INTERNAL = [
  j('Fore', 'caxt'), j('api', 'sports'), j('Prediction', 'Pick'), j('Teaser', 'Settings'), j('Prediction', 'Odds'),
  j('Artifact', 'Codec'), j('Freeze', 'Merge'), j('Day', 'Reader'), j('Record', 'Reader'), j('card_pick', '_accuracy'),
  j('app', '_settings'), j('pred', '_pick_'), j('fallback', 'Pool'), j('passes', 'OddsGate'),
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Names and the server language in any case; a static-method reference (a capitalised name, two
// colons, a method name) is case-sensitive, so CSS pseudo-elements and IPv6 addresses do not match.
const NAMES = new RegExp(`${INTERNAL.map(esc).join('|')}|\\bphp\\b`, 'i');
const STATIC = /\b[A-Z][A-Za-z0-9]*::[A-Za-z_]/;
const SCAN = { exec: (s) => NAMES.exec(s) ?? STATIC.exec(s), test: (s) => NAMES.test(s) || STATIC.test(s) };

const SKIP_DIRS = new Set(['.git', 'node_modules', 'days']);
const BINARY = new Set(['.woff2', '.woff', '.png', '.ico', '.jpg', '.jpeg', '.webp', '.gif']);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || /^dist(\.|$)/.test(e.name)) continue;
      yield* walk(join(dir, e.name));
    } else if (e.isFile() && !BINARY.has(extname(e.name).toLowerCase())) {
      const rel = relative(ROOT, join(dir, e.name)).replaceAll('\\', '/');
      if (rel === 'index.json' || /^dist\.lock$/.test(rel)) continue; // publisher / build owned
      yield rel;
    }
  }
}

test('premise: the scan fires on every internal name and on a static-method reference', () => {
  for (const n of INTERNAL) {
    assert.ok(SCAN.test(`see ${n} here`), n);
    assert.ok(SCAN.test(`see ${n.toLowerCase()} here`), `${n} lower-cased`);
  }
  assert.ok(SCAN.test(`the ${j('P', 'HP')} publisher`));
  assert.ok(SCAN.test(`${j('Some', 'Class')}::method()`));
  for (const fine of ['*::before{}', 'summary::after', '2001:db8::1', "s.split('::')", 'picksHash(rows)']) {
    assert.ok(!SCAN.test(fine), fine);
  }
});

test('no tracked text file names an internal class, table, product or provider', () => {
  const files = [...walk(ROOT)];
  assert.ok(files.includes('README.md') && files.includes('site/lib/hash.js'), 'the walk reaches the repo');
  const hits = [];
  for (const rel of files) {
    readFileSync(join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      const m = SCAN.exec(line);
      if (m) hits.push(`${rel}:${i + 1}: ${m[0]}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the code licence is a LICENSE file with the same MIT text and holder LICENSE-CONTENT.md names', () => {
  const lic = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(lic, /^MIT License\n\nCopyright \(c\) 2026 the operator of betgaffer\.com\n/);
  const content = readFileSync(join(ROOT, 'LICENSE-CONTENT.md'), 'utf8');
  const block = /```\n(MIT License[\s\S]*?)```/.exec(content);
  if (block) assert.equal(lic.trim(), block[1].trim(), 'the two copies of the MIT text agree');
  assert.match(content, /\[`LICENSE`\]\(LICENSE\)/, 'LICENSE-CONTENT.md points to LICENSE');
});

test('.gitignore keeps every build working path out of git', () => {
  const lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
  for (const p of ['dist/', 'dist.tmp/', 'dist.old/', 'dist.lock']) assert.ok(lines.includes(p), p);
  assert.ok(existsSync(join(ROOT, '.gitignore')));
});
