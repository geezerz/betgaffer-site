import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { page, NAV, OG_FOUNDING, navCurrent } from '../site/lib/layout.js';
import { lagosToday } from '../site/lib/time.js';
import { TOTAL_PLACES, WAITLIST_PLACES, LAUNCH_PLACES, DISCOUNT_PCT } from '../site/lib/founding.js';
import { parse, find, findAll, textOf, claimViolations } from './html-scan.js';
import { fakeDocument } from './fake-dom.js';
import { init as bannerInit, STORAGE_KEY as BANNER_KEY } from '../site/assets/js/banner.js';

// The private platform's name, built from char codes so the literal never appears in this repo.
const INTERNAL = String.fromCharCode(70, 111, 114, 101, 99, 97, 120, 116);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'site', 'assets');

// A self-contained test config: these tests never read site/config.js, so whether the operator has
// filled it in yet cannot change their outcome.
const cfg = Object.freeze({
  origin: 'https://betgaffer.com',
  repo: 'geezerz/betgaffer-site',
  brand: 'Bet Gaffer',
  operator: Object.freeze({
    legal_name: 'Example Media Ltd',
    trading_name: 'Bet Gaffer',
    address: '1 Example Road, Lagos',
    rc_number: null,
    contact_email: 'hello@example.com',
    privacy_email: null,
  }),
});

const NOT_A_BOOKMAKER = 'Bet Gaffer is football match intelligence. We are not a bookmaker: '
  + 'we take no bets, hold no stakes and pay no winnings.';

const base = (o = {}) => page({
  path: '/our-record/',
  title: 'Our Record',
  description: 'The graded record of every published pick.',
  body: '<section class="probe">BODY-PROBE</section>',
  config: cfg,
  year: 2026,
  ...o,
});

// ---------------------------------------------------------------------------------------------
// Document head
// ---------------------------------------------------------------------------------------------

test('page() returns a complete HTML document with the required head', () => {
  const html = base();
  assert.ok(html.startsWith('<!doctype html>'), 'starts with the doctype');
  assert.match(html, /<html lang="en-NG">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<title>Our Record — Bet Gaffer<\/title>/);
  assert.match(html, /<meta name="description" content="The graded record of every published pick.">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/betgaffer.com\/our-record\/">/);
  assert.match(html, /<meta name="theme-color" content="#0B1017">/);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<link rel="icon" href="\/assets\/img\/favicon.svg" type="image\/svg\+xml">/);
  assert.match(html, /<meta property="og:title" content="Our Record — Bet Gaffer">/);
  assert.match(html, /<meta property="og:description" content="The graded record of every published pick.">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/betgaffer.com\/our-record\/">/);
  const sheets = html.match(/<link rel="stylesheet"[^>]*>/g) || [];
  assert.deepEqual(sheets, ['<link rel="stylesheet" href="/assets/css/site.css">'], 'exactly one stylesheet');
  assert.match(html, /<\/html>\s*$/);
});

test('the canonical URL follows config.origin and the page path', () => {
  const html = base({ path: '/', config: { ...cfg, origin: 'https://staging.example' } });
  assert.match(html, /<link rel="canonical" href="https:\/\/staging.example\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/staging.example\/">/);
});

test('robots noindex is emitted only when asked for', () => {
  assert.doesNotMatch(base(), /name="robots"/);
  assert.match(base({ noindex: true }), /<meta name="robots" content="noindex">/);
});

test('canonicalPath points canonical and og:url at another page (the day page of the home card -> /)', () => {
  const html = base({ path: '/day/2026-10-07/', canonicalPath: '/' });
  assert.match(html, /<link rel="canonical" href="https:\/\/betgaffer.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/betgaffer.com\/">/);
  assert.match(base({ path: '/day/2026-10-08/' }), /<link rel="canonical" href="https:\/\/betgaffer.com\/day\/2026-10-08\/">/);
  for (const bad of ['//evil.example/', 'https://evil.example/', '/a/../b/', 'x']) {
    assert.throws(() => base({ canonicalPath: bad }), /canonicalPath/, bad);
  }
});

test('a noindex page drops canonical and og:url (it must not name itself the canonical URL)', () => {
  const indexed = base({ path: '/waitlist/thanks/' });
  assert.match(indexed, /<link rel="canonical"/, 'premise: an indexed page carries canonical');
  assert.match(indexed, /property="og:url"/, 'premise: an indexed page carries og:url');
  const html = base({ path: '/waitlist/thanks/', noindex: true });
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /og:url/);
  assert.match(html, /<meta property="og:title" content="Our Record — Bet Gaffer">/, 'the rest of the head stays');
});

test('page() requires an explicit config object (no silent fallback to site/config.js)', () => {
  const args = { path: '/', title: 'Predictions', description: 'd', body: '', year: 2026 };
  for (const config of [undefined, null, 'https://betgaffer.com', 7, true]) {
    assert.throws(() => page({ ...args, config }), (e) => {
      assert.ok(e instanceof TypeError, `TypeError for ${String(config)}`);
      assert.match(e.message, /page: config is required/);
      return true;
    });
  }
  assert.throws(() => page(), /path|config/);
});

test('title and description are escaped', () => {
  const html = base({ title: '<img src=x onerror=alert(1)> & "q"', description: '"><script>alert(1)</script>' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<title>&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;q&quot; — Bet Gaffer<\/title>/);
  assert.match(html, /content="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
});

test('invalid arguments throw instead of rendering a broken page', () => {
  assert.throws(() => base({ path: 'our-record/' }), /path/);
  assert.throws(() => base({ path: '//evil.example/' }), /path/);
  assert.throws(() => base({ path: '/x"y/' }), /path/);
  for (const p of ['/./', '/../', '/..', '/.', '/day/../privacy/', '/day/./x/', '/a/..', '/../etc/passwd']) {
    assert.throws(() => base({ path: p }), /path/, `should reject dot segment in ${p}`);
  }
  for (const p of ['/', '/404.html', '/day/2026-10-08/', '/.well-known/x', '/a..b/', '/...']) {
    assert.doesNotThrow(() => base({ path: p }), `should accept ${p}`);
  }
  assert.throws(() => base({ title: '' }), /title/);
  assert.throws(() => base({ description: null }), /description/);
  assert.throws(() => base({ body: undefined }), /body/);
  assert.throws(() => base({ scripts: '/assets/js/day.js' }), /scripts/);
});

// ---------------------------------------------------------------------------------------------
// CSP: no inline script, no inline style
// ---------------------------------------------------------------------------------------------

function assertCspClean(html) {
  assert.doesNotMatch(html, /<style[\s>]/i, 'no <style> element');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'no style= attribute');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handler');
  const opens = html.match(/<script\b[^>]*>/gi) || [];
  for (const tag of opens) assert.match(tag, /\ssrc="[^"]+"/, `script without src: ${tag}`);
  // Every script element is empty: the opening tag is immediately followed by its close.
  const all = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  assert.equal(all.length, opens.length);
  for (const el of all) assert.match(el, /^<script\b[^>]*><\/script>$/i, `script has a body: ${el}`);
}

test('premise: the CSP check fails on inline script, <style>, style= and handlers', () => {
  for (const bad of ['<script>alert(1)</script>', '<script src="/a.js">x</script>', '<style>p{}</style>',
    '<p style="color:red">x</p>', '<img src="/x.png" onerror="x()">']) {
    assert.throws(() => assertCspClean(base({ body: bad })), assert.AssertionError, `should flag ${bad}`);
  }
});

test('no inline script, no <style>, no style= anywhere (no scripts)', () => {
  const html = base({ banner: false });
  assertCspClean(html);
  assert.doesNotMatch(html, /<script/i, 'no scripts unless asked for (and no banner)');
  assertCspClean(base()); // with the banner too
});

test('scripts render as external module scripts only', () => {
  const html = base({ scripts: ['/assets/js/stale.js', '/assets/js/day.js'], banner: false });
  assertCspClean(html);
  assert.match(html, /<script type="module" src="\/assets\/js\/stale.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/assets\/js\/day.js"><\/script>/);
  assert.equal((html.match(/<script\b/g) || []).length, 2);
});

test('script sources must be same-origin root-relative paths', () => {
  for (const bad of ['https://cdn.example/x.js', '//cdn.example/x.js', 'javascript:alert(1)', 'x.js',
    '/a b.js', '/x".js', '', 7]) {
    assert.throws(() => base({ scripts: [bad] }), /script/, `should reject ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Header + nav
// ---------------------------------------------------------------------------------------------

test('the wordmark is HTML text Bet<em>Gaffer</em> linking home with an accessible name', () => {
  const html = base();
  assert.match(html, /<a class="bg-wordmark" href="\/" aria-label="Bet Gaffer — home">Bet<em>Gaffer<\/em><\/a>/);
});

test('the nav carries Predictions, Our Record, Features, Founding in order (spec §2)', () => {
  assert.deepEqual(NAV.map((n) => [n.href, n.label]),
    [['/', 'Predictions'], ['/our-record/', 'Our Record'], ['/features/', 'Features'], ['/waitlist/', 'Founding']]);
  const html = base();
  const nav = html.match(/<nav class="bg-topbar__nav"[\s\S]*?<\/nav>/)[0];
  const links = [...nav.matchAll(/<a ([^>]*)>([^<]+)<\/a>/g)];
  assert.deepEqual(links.map((m) => m[2]), ['Predictions', 'Our Record', 'Features', 'Founding']);
  // Only the Founding item carries the accent class.
  assert.deepEqual(links.map((m) => /class="bg-topbar__founding"/.test(m[1])), [false, false, false, true]);
  assert.match(links[3][1], /href="\/waitlist\/"/);
});

test('aria-current="page" is on the active nav item only', () => {
  for (const { href } of NAV) {
    const html = base({ path: href });
    const current = html.match(/<a [^>]*aria-current[^>]*>/g) || [];
    assert.equal(current.length, 1, `exactly one aria-current on ${href}`);
    assert.match(current[0], new RegExp(`href="${href.replace(/\//g, '\\/')}"`));
    assert.match(current[0], /aria-current="page"/);
  }
  for (const path of ['/privacy/', '/day/2026-10-07/', '/waitlisted/', '/waitlist.html', '/features/waitlist/']) {
    assert.doesNotMatch(base({ path }), /aria-current/, `no aria-current on ${path}`);
  }
});

test('Founding is the current nav item on /waitlist/ and every page under it', () => {
  for (const path of ['/waitlist/', '/waitlist/thanks/', '/waitlist/invalid/', '/waitlist/a/b/']) {
    const current = base({ path }).match(/<a [^>]*aria-current[^>]*>[^<]*<\/a>/g) || [];
    assert.equal(current.length, 1, `exactly one aria-current on ${path}`);
    assert.match(current[0], /href="\/waitlist\/"[^>]*aria-current="page"[^>]*>Founding</, path);
  }
  // Sub-pages count only for the Founding item: a page under /our-record/ does not light Our Record.
  assert.doesNotMatch(base({ path: '/our-record/x/' }), /aria-current/);
});

test('a skip link targets <main>', () => {
  const html = base();
  assert.match(html, /<a class="bg-skip" href="#main">Skip to content<\/a>/);
  assert.match(html, /<main id="main"/);
});

// ---------------------------------------------------------------------------------------------
// <main>: stale banner slot, data attributes, body
// ---------------------------------------------------------------------------------------------

test('<main> opens with the empty, hidden staleness region and then the body verbatim', () => {
  const html = base();
  assert.match(html,
    /<main id="main"[^>]*>\s*<div class="stale" role="status" hidden><\/div>\s*<section class="probe">BODY-PROBE<\/section>\s*<\/main>/);
  assert.equal((html.match(/class="stale"/g) || []).length, 1);
});

test('mainData becomes escaped data-* attributes on <main>; null/undefined are omitted', () => {
  const html = base({ mainData: { generatedAt: '2026-10-07T21:00:00Z', day: '2026-10-07', tomorrow: null,
    extra: undefined } });
  const main = html.match(/<main\b[^>]*>/)[0];
  assert.match(main, /\sdata-generated-at="2026-10-07T21:00:00Z"/);
  assert.match(main, /\sdata-day="2026-10-07"/);
  assert.doesNotMatch(main, /data-tomorrow|data-extra/);

  const kebab = base({ mainData: { 'generated-at': '2026-10-07T21:00:00Z', tomorrow: '2026-10-08' } })
    .match(/<main\b[^>]*>/)[0];
  assert.match(kebab, /\sdata-generated-at="2026-10-07T21:00:00Z"/);
  assert.match(kebab, /\sdata-tomorrow="2026-10-08"/);

  const hostile = base({ mainData: { day: '"><script>alert(1)</script>' } }).match(/<main\b[^>]*>/)[0];
  assert.match(hostile, /data-day="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
});

test('mainData rejects attribute names that are not plain identifiers and non-scalar values', () => {
  for (const key of ['x" onload="alert(1)', 'on click', '', '1day', 'da_y', '-day']) {
    assert.throws(() => base({ mainData: { [key]: 'v' } }), /mainData/, `should reject key ${JSON.stringify(key)}`);
  }
  assert.throws(() => base({ mainData: { day: { a: 1 } } }), TypeError);
  assert.throws(() => base({ mainData: 'day' }), /mainData/);
});

test('two mainData keys that map to the same data-* name throw instead of emitting a duplicate attribute', () => {
  for (const md of [
    { generatedAt: '2026-10-07T21:00:00Z', 'generated-at': '2026-10-08T21:00:00Z' },
    { 'generated-at': 'a', generatedAt: 'b' },
    { generatedAt: null, 'generated-at': 'b' }, // even when one side is absent: the input is ambiguous
  ]) {
    assert.throws(() => base({ mainData: md }), (e) => {
      assert.ok(e instanceof TypeError);
      assert.match(e.message, /mainData/);
      assert.match(e.message, /data-generated-at/);
      return true;
    }, `should reject ${JSON.stringify(Object.keys(md))}`);
  }
  // Distinct names are fine.
  const main = base({ mainData: { generatedAt: 'a', generated: 'b' } }).match(/<main\b[^>]*>/)[0];
  assert.equal((main.match(/data-generated-at=/g) || []).length, 1);
  assert.equal((main.match(/data-generated=/g) || []).length, 1);
});

// ---------------------------------------------------------------------------------------------
// Founding banner (spec §2, Plan A Task 3)
// ---------------------------------------------------------------------------------------------

const BANNER_TEXT = 'Founding members: 1,000 places — 500 on the waitlist, 500 at launch · '
  + '30% off every subscription payment while you subscribe · See the benefits →';
const bannerOf = (html) => find(parse(html), (n) => n.tag === 'aside' && n.attrs['data-banner'] !== undefined);
const moduleScripts = (html) => findAll(parse(html), (n) => n.tag === 'script').map((s) => s.attrs.src);

test('premise: the banner copy is the programme numbers (founding.js) with a thousands separator', () => {
  assert.deepEqual([TOTAL_PLACES, WAITLIST_PLACES, LAUNCH_PLACES, DISCOUNT_PCT], [1000, 500, 500, 30]);
});

test('the banner is on by default: the spec §2 line, directly after the header, linking /waitlist/', () => {
  const html = base();
  const aside = bannerOf(html);
  assert.ok(aside, 'a [data-banner] aside');
  assert.equal(aside.attrs.class, 'bg-banner');
  assert.equal(aside.attrs['aria-label'], 'Founding members');
  const p = find(aside, (n) => n.tag === 'p');
  assert.equal(textOf(p).replace(/\s+/g, ' ').trim(), BANNER_TEXT);
  assert.equal(textOf(find(p, (n) => n.tag === 'strong')), 'Founding members:');
  const links = findAll(aside, (n) => n.tag === 'a');
  assert.deepEqual(links.map((a) => [a.attrs.href, textOf(a)]), [['/waitlist/', 'See the benefits →']]);
  // Placement: </header> then the banner, before <main>.
  assert.match(html, /<\/header>\n<aside class="bg-banner" aria-label="Founding members" data-banner>/);
  assert.ok(html.indexOf('data-banner>') < html.indexOf('<main'), 'before <main>');
  assert.equal((html.match(/data-banner>/g) || []).length, 1, 'one banner');
});

test('the banner offer percentage sits inside a data-figure="offer" element, and the claim scan passes', () => {
  const aside = bannerOf(base());
  const offer = find(aside, (n) => n.attrs?.['data-figure'] === 'offer');
  assert.ok(offer, 'an offer figure');
  assert.equal(textOf(offer), '30% off every subscription payment while you subscribe');
  assert.deepEqual(claimViolations(base({ path: '/' })), []);
  // Premise: the same scan reports the percentage once it leaves its figure.
  const bare = base({ path: '/' }).replace('<span data-figure="offer">', '<span>');
  assert.ok(claimViolations(bare).some((m) => /30%/.test(m)), 'a bare 30% is reported');
});

test('the close button is hidden in the static HTML (no JS: the banner shows and cannot be closed)', () => {
  const aside = bannerOf(base());
  const buttons = findAll(aside, (n) => n.tag === 'button');
  assert.equal(buttons.length, 1);
  const [b] = buttons;
  assert.equal(b.attrs.type, 'button');
  assert.equal(b.attrs.class, 'bg-banner__x');
  assert.equal(b.attrs['aria-label'], 'Hide the founding banner');
  assert.ok(b.attrs['data-banner-close'] !== undefined, 'data-banner-close');
  assert.ok(b.attrs.hidden !== undefined, 'hidden');
  assert.equal(textOf(b), '×');
});

test('banner: true loads /assets/js/banner.js as the FIRST module script, once', () => {
  assert.deepEqual(moduleScripts(base()), ['/assets/js/banner.js']);
  assert.deepEqual(moduleScripts(base({ scripts: ['/assets/js/stale.js', '/assets/js/day.js'] })),
    ['/assets/js/banner.js', '/assets/js/stale.js', '/assets/js/day.js']);
  // A caller that lists banner.js itself still gets it once, first.
  assert.deepEqual(moduleScripts(base({ scripts: ['/assets/js/stale.js', '/assets/js/banner.js'] })),
    ['/assets/js/banner.js', '/assets/js/stale.js']);
});

test('banner: false renders neither the banner nor banner.js', () => {
  const html = base({ banner: false, scripts: ['/assets/js/waitlist.js'] });
  assert.equal(bannerOf(html), null);
  assert.doesNotMatch(html, /data-banner|bg-banner|banner\.js/);
  assert.deepEqual(moduleScripts(html), ['/assets/js/waitlist.js']);
  assert.throws(() => base({ banner: 'no' }), /banner/);
  assert.throws(() => base({ banner: null }), /banner/);
});

// banner.js in a fake DOM built from a real page.
function fakeStorage(init = {}, { throwOnGet = false, throwOnSet = false } = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem(k) { if (throwOnGet) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (throwOnSet) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
  };
}
const liveBanner = (doc) => doc.querySelector('[data-banner]');

test('banner.js: shows the close button; a click remembers the choice and removes the banner', () => {
  assert.equal(BANNER_KEY, 'bg.founding.banner');
  const doc = fakeDocument(base());
  const storage = fakeStorage();
  bannerInit({ doc, storage });
  const btn = doc.querySelector('[data-banner-close]');
  assert.ok(liveBanner(doc), 'still there before the click');
  assert.equal(btn.hidden, false, 'the close button is shown once JS runs');
  assert.equal(btn.listeners.click.length, 1);
  btn.listeners.click[0]();
  assert.equal(liveBanner(doc), null, 'removed');
  assert.equal(storage.m.get('bg.founding.banner'), 'hidden');
});

test('banner.js: a remembered dismissal removes the banner on load; other values do not', () => {
  const doc = fakeDocument(base());
  bannerInit({ doc, storage: fakeStorage({ 'bg.founding.banner': 'hidden' }) });
  assert.equal(liveBanner(doc), null);
  for (const v of ['shown', '', 'HIDDEN']) {
    const d = fakeDocument(base());
    bannerInit({ doc: d, storage: fakeStorage({ 'bg.founding.banner': v }) });
    assert.ok(liveBanner(d), `value ${JSON.stringify(v)} keeps the banner`);
  }
});

test('banner.js: blocked storage never breaks the page — the banner shows and still closes for this view', () => {
  for (const storage of [null, fakeStorage({}, { throwOnGet: true, throwOnSet: true })]) {
    const doc = fakeDocument(base());
    assert.doesNotThrow(() => bannerInit({ doc, storage }));
    const btn = doc.querySelector('[data-banner-close]');
    assert.equal(btn.hidden, false);
    assert.doesNotThrow(() => btn.listeners.click[0]());
    assert.equal(liveBanner(doc), null);
  }
  // A page without the banner: nothing to do, nothing thrown.
  assert.doesNotThrow(() => bannerInit({ doc: fakeDocument(base({ banner: false })), storage: fakeStorage() }));
});

test('banner.js never fetches and imports nothing (the counter is read on /waitlist/ only)', () => {
  const src = readFileSync(join(ASSETS, 'js', 'banner.js'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket/);
  assert.doesNotMatch(src, /^\s*import\b|\bimport\s*\(/m);
});

// ---------------------------------------------------------------------------------------------
// Open Graph image
// ---------------------------------------------------------------------------------------------

test('ogImage renders og:image (absolute, from config.origin), its size and its alt text', () => {
  assert.equal(OG_FOUNDING, '/assets/img/og-founding.png');
  const html = base({ ogImage: OG_FOUNDING });
  assert.match(html, /<meta property="og:image" content="https:\/\/betgaffer\.com\/assets\/img\/og-founding\.png">/);
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  const alt = html.match(/<meta property="og:image:alt" content="([^"]+)">/);
  assert.ok(alt, 'og:image:alt');
  assert.match(alt[1], /founding member/i);
  assert.doesNotMatch(alt[1], /%/, 'no offer percentage outside an offer figure');
  assert.match(base({ ogImage: OG_FOUNDING, config: { ...cfg, origin: 'https://staging.example' } }),
    /<meta property="og:image" content="https:\/\/staging\.example\/assets\/img\/og-founding\.png">/);
});

test('without ogImage no og:image meta is emitted; a bad ogImage throws', () => {
  assert.doesNotMatch(base(), /og:image/);
  for (const bad of ['https://evil.example/x.png', '//evil.example/x.png', 'x.png', '/a/../b.png', '/x.svg', '/x"y.png', 7]) {
    assert.throws(() => base({ ogImage: bad }), /ogImage/, String(bad));
  }
  // Another image needs its own alt text; it is escaped.
  assert.throws(() => base({ ogImage: '/assets/img/other.png' }), /ogImageAlt/);
  const html = base({ ogImage: '/assets/img/other.png', ogImageAlt: 'A "card" <b>' });
  assert.match(html, /<meta property="og:image:alt" content="A &quot;card&quot; &lt;b&gt;">/);
});

test('og-founding.png ships as a real 1200x630 PNG under 200 KB', () => {
  const p = join(ASSETS, 'img', 'og-founding.png');
  assert.ok(existsSync(p), 'exists');
  const png = readFileSync(p);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR', 'IHDR is the first chunk');
  assert.equal(png.readUInt32BE(16), 1200, 'width');
  assert.equal(png.readUInt32BE(20), 630, 'height');
  assert.ok(png.length < 200 * 1024, `${png.length} bytes < 200 KB`);
  assert.ok(png.length > 5 * 1024, 'not a stub');
});

// ---------------------------------------------------------------------------------------------
// founding.css + the four-tab mobile nav
// ---------------------------------------------------------------------------------------------

test('founding.css: banner on surface-2 with an accent rule, a 44px close target that [hidden] hides, green Founding item', () => {
  const s = readFileSync(join(ASSETS, 'css', 'founding.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  const rule = (sel) => (new RegExp(`(?:^|\\})${sel.replace(/[.[\]-]/g, (c) => `\\${c}`)}\\{([^}]*)\\}`).exec(s) ?? [])[1] ?? '';
  assert.match(rule('.bg-banner'), /background:var\(--surface-2\)/);
  assert.match(rule('.bg-banner'), /border-left:\d+pxsolidvar\(--accent\)/);
  assert.match(rule('.bg-banner__x'), /min-width:(44px|var\(--tap\))/);
  assert.match(rule('.bg-banner__x'), /min-height:(44px|var\(--tap\))/);
  assert.match(rule('.bg-banner__x[hidden]'), /display:none/);
  assert.match(rule('.bg-banner__inp'), /min-width:0/, 'the line can shrink and wrap');
  assert.match(rule('.bg-banner__inp'), /overflow-wrap:anywhere/, 'a long word never forces a sideways scroll');
  assert.match(s, /\.bg-topbar__nava\.bg-topbar__founding\{[^}]*color:var\(--accent\)/);
  assert.doesNotMatch(s, /var\(--gold\)/, 'gold stays reserved for the recommended pick');
});

test('below 600px the nav is four equal tabs (one per NAV item)', () => {
  const s = readFileSync(join(ASSETS, 'css', 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  assert.equal(NAV.length, 4);
  assert.match(s, /\.bg-topbar__navul\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);?\}/);
});

test('below 360px the tab labels shrink so "PREDICTIONS" stays one word; overflow-wrap stays as a last resort', () => {
  const s = readFileSync(join(ASSETS, 'css', 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  const fourTabs = s.indexOf('.bg-topbar__navul{display:grid;grid-template-columns:repeat(4');
  const narrow = s.indexOf('@media(max-width:359.98px){.bg-topbar__nava{font-size:10px;letter-spacing:.02em;}}');
  assert.ok(fourTabs > -1, 'premise: the four-tab rule');
  assert.ok(narrow > fourTabs, 'the <360px rule follows the four-tab rule (same specificity: later wins)');
  const tab = /\.bg-topbar__nava\{([^}]*)\}/.exec(s.slice(fourTabs))[1];
  assert.match(tab, /overflow-wrap:anywhere/);
  assert.match(tab, /font-size:11px/, 'premise: 11px from 360px up');
});

test('the inactive Founding tab is green with an accent dot, never the current tab\'s background or underline', () => {
  const s = readFileSync(join(ASSETS, 'css', 'founding.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  const rules = [...s.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1], m[2]]);
  const founding = rules.filter(([sel]) => sel.includes('.bg-topbar__founding'));
  assert.ok(founding.length > 0, 'premise: founding rules parsed');
  for (const [sel, body] of founding) {
    if (sel.includes('[aria-current]') || sel.includes(':hover')) continue;
    assert.doesNotMatch(body, /border-bottom|background:var\(--accent-quiet\)/, `${sel}: no current-tab styling`);
  }
  const base = founding.find(([sel]) => sel === '.bg-topbar__nava.bg-topbar__founding');
  assert.ok(base, 'the founding tab rule');
  assert.match(base[1], /color:var\(--accent\)/);
  const dot = founding.find(([sel]) => sel === '.bg-topbar__nava.bg-topbar__founding::before');
  assert.ok(dot, 'a ::before dot (CSS-generated: not read as text)');
  assert.match(dot[1], /content:''/);
  assert.match(dot[1], /background:var\(--accent\)/);
  assert.match(dot[1], /border-radius:50%/);
  // The real current tab keeps the shared current styling: no dot, nothing overriding base.css.
  const cur = founding.find(([sel]) => sel === '.bg-topbar__nava.bg-topbar__founding[aria-current]::before');
  assert.ok(cur && /content:none/.test(cur[1]), 'no dot on the current Founding tab');
  assert.ok(!founding.some(([sel, body]) => sel.endsWith('[aria-current]') && /border|background/.test(body)),
    'no founding override of the current-tab underline or background');
});

test('navCurrent: exact match, or a section item (href ending in "/") over every page under it', () => {
  const founding = NAV.find((n) => n.label === 'Founding');
  assert.equal(navCurrent(founding, '/waitlist/'), true);
  assert.equal(navCurrent(founding, '/waitlist/thanks/'), true);
  assert.equal(navCurrent(founding, '/waitlisted/'), false);
  // A section href without its trailing slash would light /waitlisted/: it never counts as a section.
  assert.equal(navCurrent({ href: '/waitlist', section: true }, '/waitlisted/'), false);
  assert.equal(navCurrent({ href: '/waitlist', section: true }, '/waitlist'), true, 'exact match still holds');
  // Predictions ('/') is not a section: it must not be current on every page.
  const home = NAV.find((n) => n.href === '/');
  assert.equal(navCurrent(home, '/'), true);
  assert.equal(navCurrent(home, '/privacy/'), false);
  for (const n of NAV) if (n.section) assert.ok(n.href.endsWith('/'), `${n.href} ends in /`);
});

test('the footer carries the not-a-bookmaker line, the receipt-code line, 18+, legal links, © and contact', () => {
  const html = base();
  const foot = html.match(/<footer\b[\s\S]*?<\/footer>/)[0];
  assert.ok(foot.includes(NOT_A_BOOKMAKER), 'not-a-bookmaker line verbatim');
  assert.match(foot, />18\+</, '18+ badge');
  for (const [href, label] of [['/privacy/', 'Privacy'], ['/terms/', 'Terms'], ['/refunds/', 'Refunds']]) {
    assert.match(foot, new RegExp(`<a href="${href.replace(/\//g, '\\/')}"[^>]*>${label}</a>`));
  }
  assert.match(foot, /© 2026 Example Media Ltd/);
  assert.match(foot, /<a href="mailto:hello@example.com">hello@example.com<\/a>/);
  // Spec §10: the brand column states the receipt idea; no Receipts column, no repository link.
  const brand = foot.match(/<div class="bg-foot__brand">[\s\S]*?<\/div>/)[0];
  assert.ok(brand.includes('<p class="bg-foot__receipts">Every pick is frozen before kickoff and carries a receipt code.</p>'));
  assert.doesNotMatch(foot, /github|reposit|Receipts</i);
  assert.ok(!foot.includes(cfg.repo), 'the repo slug never reaches the footer');
  // Every footer link is one of: the three legal pages, the contact mailto.
  assert.deepEqual([...foot.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]),
    ['/privacy/', '/terms/', '/refunds/', 'mailto:hello@example.com']);
});

test('the footer year is the injected year', () => {
  for (const year of [1999, 2031]) {
    const html = page({ path: '/', title: 'Predictions', description: 'd', body: '', config: cfg, year });
    assert.match(html, new RegExp(`© ${year} Example Media Ltd`));
  }
  assert.throws(() => base({ year: '2026' }), /year/);
  assert.throws(() => base({ year: 2026.5 }), /year/);
});

test('without an injected year the footer uses the current Lagos year', () => {
  // Bracket the call so a Lagos New Year tick between the reads cannot make the test flaky.
  const before = Number(lagosToday().slice(0, 4));
  const html = page({ path: '/', title: 'Predictions', description: 'd', body: '', config: cfg });
  const after = Number(lagosToday().slice(0, 4));
  const shown = Number(html.match(/© (\d{4}) Example Media Ltd/)[1]);
  assert.ok(shown === before || shown === after, `year ${shown} is ${before} or ${after}`);
});

test('operator identity is escaped in the footer', () => {
  const html = base({ config: { ...cfg, operator: { ...cfg.operator, legal_name: '<b>Evil</b> & Co' } } });
  assert.match(html, /© 2026 &lt;b&gt;Evil&lt;\/b&gt; &amp; Co/);
  assert.doesNotMatch(html, /<b>Evil/);
});

test('the RC number prints once as "RC <n>", whatever prefix the config carries', () => {
  for (const rc of ['RC1234567', 'rc 1234567', '1234567', ' RC 1234567 ']) {
    const html = base({ config: { ...cfg, operator: { ...cfg.operator, rc_number: rc } } });
    const foot = html.match(/<footer\b[\s\S]*?<\/footer>/)[0];
    assert.match(foot, / · RC 1234567 · /, rc);
    assert.doesNotMatch(foot, /RC\s*RC/i, rc);
  }
  assert.doesNotMatch(base().match(/<footer\b[\s\S]*?<\/footer>/)[0], /\bRC\b/, 'no RC line without a number');
});

test('the head links the apple-touch-icon, which ships as a 512x512 PNG', () => {
  assert.match(base(), /<link rel="apple-touch-icon" href="\/assets\/img\/apple-touch-icon.png">/);
  const png = readFileSync(join(ASSETS, 'img', 'apple-touch-icon.png'));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
});

test('a missing operator identity fails the page instead of rendering a placeholder', () => {
  assert.throws(() => base({ config: { ...cfg, operator: { ...cfg.operator, legal_name: null } } }), /legal_name/);
});

test('a hostile operator email or repo fails the page instead of reaching an href', () => {
  assert.throws(() => base({ config: { ...cfg, operator: { ...cfg.operator, contact_email: 'a@b.com?bcc=x@y.com' } } }),
    /contact_email/);
  assert.throws(() => base({ config: { ...cfg, repo: 'geezerz/x"><script>' } }), /repo/);
  assert.throws(() => base({ config: { ...cfg, origin: 'http://betgaffer.com' } }), /origin/);
});

test('the shell copy never names the internal product or uses banned phrasing', () => {
  const html = base();
  for (const re of [new RegExp(INTERNAL, 'i'), /\btoken/i, /tipster/i, /sportsbook/i, /guarantee/i, /\bprofit/i, /\bwin rate/i]) {
    assert.doesNotMatch(html, re);
  }
});

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

test('vendored fonts are real woff2 files and both OFL licences ship beside them', () => {
  for (const f of ['inter-latin.woff2', 'jetbrains-mono-latin.woff2']) {
    const p = join(ASSETS, 'fonts', f);
    assert.ok(existsSync(p), `${f} exists`);
    const buf = readFileSync(p);
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${f} has the woff2 signature`);
    assert.ok(buf.length > 10_000, `${f} is not a stub`);
  }
  for (const f of ['OFL-inter.txt', 'OFL-jetbrains.txt']) {
    assert.match(readFileSync(join(ASSETS, 'fonts', f), 'utf8'), /SIL OPEN FONT LICENSE/i, `${f} is the OFL`);
  }
});

test('mark.svg and favicon.svg are standalone SVGs in the brand colours', () => {
  for (const f of ['mark.svg', 'favicon.svg']) {
    const svg = readFileSync(join(ASSETS, 'img', f), 'utf8');
    assert.match(svg, /^<svg\b[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/, `${f} root`);
    assert.match(svg, /<\/svg>\s*$/);
    assert.match(svg, /fill="#131C27"/);
    assert.match(svg, /fill="#22C55E"/);
    assert.doesNotMatch(svg, /<script|href=|xlink|on[a-z]+=|style=/i, `${f} has no script, link or style`);
  }
});

const css = () => readFileSync(join(ASSETS, 'css', 'base.css'), 'utf8');

test('base.css carries the brand tokens verbatim', () => {
  const s = css().replace(/\s+/g, '');
  const tokens = {
    '--bg': '#0B1017', '--surface': '#101822', '--surface-2': '#131C27', '--surface-3': '#192432',
    '--line': '#22303F', '--line-2': '#2E3F52', '--muted-2': '#55677E', '--muted': '#8494A8',
    '--ink-2': '#C0CAD8', '--ink': '#EDF1F6', '--accent': '#22C55E', '--accent-hi': '#4ADE80',
    '--accent-lo': '#16A34A', '--accent-quiet': 'rgba(34,197,94,.12)', '--on-accent': '#04160B',
    '--won': '#22C55E', '--lost': '#E5484D', '--hold': '#F0B542', '--void': '#55677E', '--gold': '#F5B301',
    '--r-1': '10px', '--r-2': '14px', '--r-3': '18px', '--r-pill': '999px', '--wrap': '80rem',
  };
  for (const [k, v] of Object.entries(tokens)) assert.ok(s.includes(`${k}:${v};`), `token ${k}:${v}`);
  assert.match(s, /color-scheme:dark/);
});

test('base.css ships the primitives later pages rely on', () => {
  const s = css();
  for (const sel of ['.t-d1', '.t-d2', '.t-h', '.t-b', '.t-s', '.t-lbl', '.mono', '.vh', '.bg-wrap',
    '.bg-btn', '.bg-btn--primary', '.bg-btn--ghost', '.bg-chip', '.bg-chip--won', '.bg-chip--lost',
    '.bg-chip--open', '.bg-chip--void', '.bg-empty', '.bg-topbar', '.bg-wordmark', '.bg-topbar__nav',
    '.bg-foot', '.bg-skip', '.stale']) {
    assert.ok(new RegExp(`${sel.replace(/[.-]/g, (c) => `\\${c}`)}(?![\\w-])`).test(s), `selector ${sel}`);
  }
  assert.match(s, /\.mono\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  assert.match(s, /:focus-visible\s*\{[^}]*outline:/);
  assert.match(s, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(s, /\.stale\[hidden\]\s*\{[^}]*display:\s*none/, 'the hidden stale region stays hidden');
  assert.match(s, /\.bg-btn\s*\{[^}]*min-height:\s*44px/, '44px touch target');
});

test('base.css declares both font faces with font-display: swap, self-hosted only', () => {
  const s = css();
  const faces = s.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.equal(faces.length, 2);
  assert.ok(faces.some((f) => /font-family:\s*'Inter'/.test(f) && /url\('\.\.\/fonts\/inter-latin\.woff2'\)/.test(f)));
  assert.ok(faces.some((f) => /font-family:\s*'JetBrains Mono'/.test(f)
    && /url\('\.\.\/fonts\/jetbrains-mono-latin\.woff2'\)/.test(f)));
  for (const f of faces) assert.match(f, /font-display:\s*swap/);
  assert.doesNotMatch(s, /@import|url\(\s*['"]?(https?:)?\/\//i, 'no external resources');
});

test('font preload hrefs are exactly the @font-face url()s as resolved from /assets/css/site.css', () => {
  const urls = [...css().matchAll(/@font-face\s*\{[^}]*?url\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 2, 'premise: both faces parsed');
  const resolved = urls.map((u) => new URL(u, 'https://x/assets/css/site.css').pathname).sort();
  const html = base();
  const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/g)]
    .map((m) => m[1]).sort();
  assert.deepEqual(preloads, resolved);
  for (const p of preloads) assert.ok(existsSync(join(ROOT, 'site', ...p.split('/').filter(Boolean))), `${p} exists`);
  assert.match(html, /<link rel="stylesheet" href="\/assets\/css\/site.css">/, 'premise: the resolution base is the sheet');
});

// WCAG relative luminance / contrast ratio.
function contrast(fg, bg) {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

test('the lost chip text reads at >= 4.5:1 on every surface; --lost stays the edge colour', () => {
  const s = css();
  const rule = s.match(/\.bg-chip--lost\s*\{([^}]*)\}/)[1];
  const color = rule.match(/(?:^|;)\s*color:\s*(#[0-9A-Fa-f]{6})\s*;/);
  assert.ok(color, 'the lost chip text is a literal hex colour, not var(--lost)');
  assert.equal(color[1].toUpperCase(), '#F87171');
  const tint = rule.match(/background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  const [r, g, b, a] = tint.slice(1).map(Number);
  for (const surface of ['#0B1017', '#101822', '#131C27', '#192432']) {
    const bg = hex(surface).map((c, i) => [r, g, b][i] * a + c * (1 - a));
    assert.ok(contrast(hex(color[1]), bg) >= 4.5, `#F87171 on the lost tint over ${surface}`);
  }
  assert.ok(contrast(hex('#E5484D'), hex('#192432')) < 4.5, 'premise: --lost itself fails as small text');
  assert.ok(s.replace(/\s+/g, '').includes('--lost:#E5484D;'), '--lost token unchanged');
});

test('a stacked table hides its thead with the .vh clip pattern, and every header box stays 1px wide', () => {
  const stacked = /@media \(max-width:639\.98px\)\{([\s\S]*?)\n\}/.exec(css().slice(css().indexOf('.bg-table{')));
  assert.ok(stacked, 'premise: the stacked-table block exists');
  const block = stacked[1].replace(/\s+/g, '');
  const thead = /\.bg-tablethead\{([^}]*)\}/.exec(block);
  assert.ok(thead, 'thead rule');
  for (const decl of ['display:block', 'position:absolute', 'width:1px', 'height:1px', 'overflow:hidden', 'clip-path:inset(50%)', 'white-space:nowrap']) {
    assert.ok(thead[1].includes(decl), `thead: ${decl}`);
  }
  // A table-header-group ignores width/overflow, so its cells would lay out at full width beyond
  // the viewport; the row and cells are blocks clamped to 1px too.
  const cells = /\.bg-tabletheadtr,\.bg-tabletheadth\{([^}]*)\}/.exec(block);
  assert.ok(cells, 'thead tr/th rule');
  for (const decl of ['display:block', 'width:1px', 'height:1px', 'overflow:hidden', 'padding:0']) assert.ok(cells[1].includes(decl), `cells: ${decl}`);
});

test('below 400px button labels may wrap and centre', () => {
  const s = css();
  const blocks = [...s.matchAll(/@media\s*\(max-width:\s*399(?:\.98)?px\)\s*\{([\s\S]*?\})\s*\}/g)].map((m) => m[1]);
  assert.ok(blocks.some((blk) => /\.bg-btn\s*\{[^}]*white-space:\s*normal/.test(blk)
    && /\.bg-btn\s*\{[^}]*text-align:\s*center/.test(blk)), 'a <400px rule lets .bg-btn wrap, centred');
});

test('gold is reserved for the recommended pick: base.css defines it but never uses it', () => {
  assert.doesNotMatch(css(), /var\(--gold\)/);
});
