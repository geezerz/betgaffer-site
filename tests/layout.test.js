import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { page, NAV } from '../site/lib/layout.js';
import { lagosToday } from '../site/lib/time.js';

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
  const html = base();
  assertCspClean(html);
  assert.doesNotMatch(html, /<script/i, 'no scripts unless asked for');
});

test('scripts render as external module scripts only', () => {
  const html = base({ scripts: ['/assets/js/stale.js', '/assets/js/day.js'] });
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

test('the nav carries Predictions, Our Record, Features in order', () => {
  assert.deepEqual(NAV.map((n) => [n.href, n.label]),
    [['/', 'Predictions'], ['/our-record/', 'Our Record'], ['/features/', 'Features']]);
  const html = base();
  const nav = html.match(/<nav class="bg-topbar__nav"[\s\S]*?<\/nav>/)[0];
  const labels = [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Predictions', 'Our Record', 'Features']);
});

test('aria-current="page" is on the active nav item only', () => {
  for (const { href } of NAV) {
    const html = base({ path: href });
    const current = html.match(/<a [^>]*aria-current[^>]*>/g) || [];
    assert.equal(current.length, 1, `exactly one aria-current on ${href}`);
    assert.match(current[0], new RegExp(`href="${href.replace(/\//g, '\\/')}"`));
    assert.match(current[0], /aria-current="page"/);
  }
  for (const path of ['/privacy/', '/day/2026-10-07/', '/waitlist/thanks/']) {
    assert.doesNotMatch(base({ path }), /aria-current/, `no aria-current on ${path}`);
  }
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
// Footer
// ---------------------------------------------------------------------------------------------

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
