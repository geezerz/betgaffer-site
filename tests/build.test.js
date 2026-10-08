// The site build (plan Task 6; spec test 9 and the CSP / atomicity / no-data requirements).
// Every test calls the exported build() — no process is ever spawned.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, rm, access, rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build, HEADERS, CSS_ORDER, ISOMORPHIC_LIB, chooseDays, parseCli, loadConfig } from '../site/build.mjs';
import realConfig from '../site/config.js';
import { fmtDayLong, fmtStamp } from '../site/lib/time.js';
import { nodeSha256 } from '../site/lib/data.js';
import * as privacy from '../site/content/privacy.js';
import * as terms from '../site/content/terms.js';
import * as refunds from '../site/content/refunds.js';
import { parse, find, findAll, textOf, visibleText, cspViolations } from './html-scan.js';
import {
  REPO_ROOT, testConfig, workspace, copyArtifact, addArchive, readJson, writeJson, snapshot, htmlFiles, rehash,
} from './site-fixtures.js';

const NOW = Date.parse('2026-10-07T22:30:00Z'); // 23:30 WAT on the fixture's today
const quiet = () => {};
const run = (ws, o = {}) => build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: quiet, ...o });
const read = (ws, rel) => readFile(join(ws.out, rel), 'utf8');
const D07 = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/artifact/days/2026-10-07.json'), 'utf8'));
const D08 = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/artifact/days/2026-10-08.json'), 'utf8'));
const INDEX = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/artifact/index.json'), 'utf8'));
const mainOf = (html) => find(parse(html), (n) => n.tag === 'main');
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

const PAGE_ROUTES = [
  'index.html', 'our-record/index.html', 'features/index.html', 'privacy/index.html', 'terms/index.html',
  'refunds/index.html', 'waitlist/thanks/index.html', 'waitlist/invalid/index.html',
  'waitlist/slow-down/index.html', 'waitlist/unavailable/index.html', '404.html',
  'day/2026-10-07/index.html', 'day/2026-10-08/index.html',
];

// ------------------------------------------------------------------ the fixture artifact build

describe('build of the fixture artifact', () => {
  let ws;
  let result;
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    result = await run(ws);
  });
  after(() => ws.cleanup());

  test('every route file exists, and build() reports the routes it wrote', async () => {
    for (const r of PAGE_ROUTES) assert.ok(await exists(join(ws.out, r)), `${r} exists`);
    assert.deepEqual([...result.routes].sort(), [
      '/', '/404.html', '/day/2026-10-07/', '/day/2026-10-08/', '/features/', '/our-record/', '/privacy/',
      '/refunds/', '/terms/', '/waitlist/invalid/', '/waitlist/slow-down/', '/waitlist/thanks/', '/waitlist/unavailable/',
    ]);
  });

  test('data, assets and the isomorphic lib modules are copied byte for byte', async () => {
    for (const rel of ['index.json', 'days/2026-10-07.json', 'days/2026-10-08.json']) {
      assert.deepEqual(await readFile(join(ws.out, rel)), await readFile(join(ws.root, rel)), rel);
    }
    for (const f of ['inter-latin.woff2', 'jetbrains-mono-latin.woff2', 'OFL-inter.txt', 'OFL-jetbrains.txt']) {
      assert.deepEqual(await readFile(join(ws.out, 'assets/fonts', f)), await readFile(join(REPO_ROOT, 'site/assets/fonts', f)), f);
    }
    for (const f of ['favicon.svg', 'mark.svg', 'apple-touch-icon.png']) {
      assert.deepEqual(await readFile(join(ws.out, 'assets/img', f)), await readFile(join(REPO_ROOT, 'site/assets/img', f)), f);
    }
    for (const f of ['day.js', 'stale.js', 'waitlist.js']) {
      assert.deepEqual(await readFile(join(ws.out, 'assets/js', f)), await readFile(join(REPO_ROOT, 'site/assets/js', f)), f);
    }
    assert.deepEqual([...ISOMORPHIC_LIB].sort(), ['esc.js', 'fixtures.js', 'hash.js', 'ring.js', 'time.js']);
    for (const f of ISOMORPHIC_LIB) {
      assert.deepEqual(await readFile(join(ws.out, 'assets/js/lib', f)), await readFile(join(REPO_ROOT, 'site/lib', f)), f);
    }
    assert.deepEqual((await readdir(join(ws.out, 'assets/js/lib'))).sort(), [...ISOMORPHIC_LIB].sort(), 'nothing build-only is shipped');
  });

  test('every browser module imports only files the build ships (relative ./lib/ or sibling paths)', async () => {
    const shipped = new Set(Object.keys(await snapshot(join(ws.out, 'assets/js'))));
    assert.ok(shipped.has('day.js') && shipped.has('lib/fixtures.js'), 'premise: modules are shipped');
    for (const rel of shipped) {
      const src = await readFile(join(ws.out, 'assets/js', rel), 'utf8');
      const specs = [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
      for (const s of specs) {
        assert.match(s, /^\.\.?\//, `${rel} imports ${s}: only relative specifiers resolve in the browser`);
        const target = new URL(s, `https://x/assets/js/${rel}`).pathname.replace('/assets/js/', '');
        assert.ok(shipped.has(target), `${rel} imports ${s}, which the build does not ship`);
      }
      assert.doesNotMatch(src, /from\s*['"]node:/, `${rel} imports a node: module`);
    }
  });

  test('site.css concatenates the five stylesheets in the fixed order', async () => {
    assert.deepEqual([...CSS_ORDER], ['base.css', 'fixtures.css', 'record.css', 'content.css', 'waitlist.css']);
    const css = await read(ws, 'assets/css/site.css');
    let at = -1;
    for (const f of CSS_ORDER) {
      const part = await readFile(join(REPO_ROOT, 'site/assets/css', f), 'utf8');
      const i = css.indexOf(part);
      assert.ok(i > at, `${f} appears whole and after the previous file`);
      at = i;
    }
  });

  test('_headers is exactly the plan\'s, with a referrer policy the waitlist Origin check survives', async () => {
    const h = await read(ws, '_headers');
    assert.equal(h, HEADERS);
    assert.equal(HEADERS, [
      '/*',
      "  Content-Security-Policy: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
      '  Strict-Transport-Security: max-age=31536000',
      '/days/*',
      '  Cache-Control: public, max-age=300',
      '/index.json',
      '  Cache-Control: public, max-age=120',
      '/assets/fonts/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
    ].join('\n'));
    assert.doesNotMatch(h, /no-referrer(?!-when)/, 'never no-referrer: the Function rejects a POST whose Origin is withheld');
    assert.doesNotMatch(h, /interest-cohort/);
    assert.doesNotMatch(h, /unsafe-inline|unsafe-eval/);
  });

  test('CSP: no inline script, no <style>, no style=, no handler, no javascript: URL in any HTML file', async () => {
    const files = await htmlFiles(ws.out);
    assert.equal(files.length, PAGE_ROUTES.length);
    for (const { rel, html } of files) {
      assert.deepEqual(cspViolations(html), [], rel);
      for (const s of findAll(parse(html), (n) => n.tag === 'script')) {
        assert.equal(s.attrs.type, 'module', `${rel}: scripts are modules`);
        assert.match(s.attrs.src, /^\/assets\/js\/[a-z-]+\.js$/, `${rel}: same-site script`);
        assert.ok(existsSync(join(ws.out, s.attrs.src)), `${rel}: ${s.attrs.src} is shipped`);
      }
    }
  });

  test('every page with a waitlist form loads /assets/js/waitlist.js as a module; no other page does', async () => {
    let withForm = 0;
    for (const { rel, html } of await htmlFiles(ws.out)) {
      const doc = parse(html);
      const hasForm = find(doc, (n) => n.tag === 'form' && n.attrs['data-waitlist'] !== undefined) !== null;
      const hasScript = find(doc, (n) => n.tag === 'script' && n.attrs.src === '/assets/js/waitlist.js' && n.attrs.type === 'module') !== null;
      assert.equal(hasScript, hasForm, rel);
      if (hasForm) withForm++;
    }
    assert.ok(withForm >= 2, 'premise: /features/ and /waitlist/invalid/ carry the form');
  });

  test('every page links the apple-touch-icon and prints the RC number once', async () => {
    for (const { rel, html } of await htmlFiles(ws.out)) {
      assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/img\/apple-touch-icon.png">/, rel);
      assert.doesNotMatch(html, /RC RC/, rel);
    }
    assert.match(await read(ws, 'index.html'), /RC 1234567/);
  });

  // ---- test 9: the no-JS render is complete in the static HTML

  /**
   * Test 9, row by row: each fixture's own <li data-fx> carries its teams, and a picked row its
   * label and its probability (">99%" for a stated 100); a row without a pick has no probability.
   */
  function assertRows(html, day) {
    const doc = parse(html);
    const rows = findAll(doc, (n) => n.tag === 'li' && n.attrs['data-fx'] !== undefined);
    assert.equal(rows.length, day.fixtures.length, 'one row per fixture');
    let picked = 0;
    for (const f of day.fixtures) {
      const li = rows.filter((r) => r.attrs['data-fx'] === String(f.fx));
      assert.equal(li.length, 1, `fx ${f.fx}: exactly one row`);
      const t = textOf(li[0]);
      assert.ok(t.includes(f.home), `fx ${f.fx}: home ${f.home} in its own row`);
      assert.ok(t.includes(f.away), `fx ${f.fx}: away ${f.away} in its own row`);
      const prob = findAll(li[0], (n) => n.attrs['data-figure'] === 'pick-prob');
      if (f.pick) {
        picked++;
        assert.ok(t.includes(f.pick.label ?? f.pick.market), `fx ${f.fx}: label`);
        if (Number.isInteger(f.pick.pct)) {
          assert.equal(prob.length, 1, `fx ${f.fx}: one probability`);
          assert.ok(textOf(prob[0]).includes(f.pick.pct === 100 ? '>99%' : `${f.pick.pct}%`), `fx ${f.fx}: ${f.pick.pct}% in ${textOf(prob[0])}`);
        }
      } else {
        assert.equal(prob.length, 0, `fx ${f.fx}: no pick, no probability`);
      }
    }
    return picked;
  }

  test('no-JS (test 9): every home-day row carries its teams, pick label and probability', async () => {
    const html = await read(ws, 'index.html');
    assert.ok(assertRows(html, D07) > 0, 'premise: the home day has picks');
    assert.ok(visibleText(html).includes(fmtDayLong('2026-10-07')));
  });

  test('no-JS (test 9): the tomorrow page is fully rendered too, row by row', async () => {
    assert.ok(assertRows(await read(ws, 'day/2026-10-08/index.html'), D08) > 100, 'premise: tomorrow has picks');
  });

  test('premise: the row check fails when a row loses its probability or a team', () => {
    const html = readFileSync(join(ws.out, 'index.html'), 'utf8');
    const f = D07.fixtures.find((x) => x.pick && Number.isInteger(x.pick.pct));
    const noProb = html.replace(new RegExp(`(data-fx="${f.fx}"[\\s\\S]*?)data-figure="pick-prob"`), '$1data-x="gone"');
    assert.notEqual(noProb, html);
    assert.throws(() => assertRows(noProb, D07), /one probability/);
    const moved = { ...D07, fixtures: D07.fixtures.map((x) => (x.fx === f.fx ? { ...x, home: D07.fixtures.find((y) => y.fx !== f.fx).home } : x)) };
    assert.throws(() => assertRows(html, moved), /home .* in its own row/);
  });

  test('no-JS: the record page carries the 30-day fraction, its period and every month', async () => {
    const text = visibleText(await read(ws, 'our-record/index.html'));
    assert.match(text, /10,268 of 12,154/);
    assert.match(text, /84\.48%/);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    assert.ok(INDEX.record.months.length > 0);
    for (const m of INDEX.record.months) {
      const [y, mo] = m.period.split('-').map(Number);
      assert.ok(text.includes(`${months[mo - 1]} ${y}`), m.period);
    }
  });

  test('no-JS: the legal pages carry every section heading; features carries its sections and form', async () => {
    for (const [rel, mod] of [['privacy/index.html', privacy], ['terms/index.html', terms], ['refunds/index.html', refunds]]) {
      const text = visibleText(await read(ws, rel));
      assert.ok(mod.SECTION_TITLES.length > 3, `premise: ${rel} has sections`);
      for (const t of mod.SECTION_TITLES) assert.ok(text.includes(t), `${rel}: ${t}`);
      assert.ok(text.includes('Example Media Ltd'), `${rel}: operator`);
    }
    const f = visibleText(await read(ws, 'features/index.html'));
    for (const t of ['On this site today', 'Coming at full launch', 'Founding waitlist', 'Join the waitlist']) assert.ok(f.includes(t), t);
  });

  test('features breadth comes from the home day file (fixtures, competitions, markets)', async () => {
    const active = D07.fixtures.filter((x) => !x.withdrawn);
    const comps = new Set(active.map((x) => x.comp)).size;
    const text = visibleText(await read(ws, 'features/index.html'));
    assert.ok(text.includes(`On the card for ${fmtDayLong('2026-10-07')}: ${active.length} fixtures in ${comps} competitions, with up to ${D07.counts.markets_per_fixture} markets priced per fixture.`), text.slice(0, 600));
  });

  test('home <main> carries generated-at, the shown day, tomorrow, the view and the staleness window', async () => {
    const m = mainOf(await read(ws, 'index.html'));
    assert.equal(m.attrs['data-generated-at'], INDEX.generated_at);
    assert.equal(m.attrs['data-day'], '2026-10-07');
    assert.equal(m.attrs['data-tomorrow'], '2026-10-08');
    assert.equal(m.attrs['data-view'], 'home');
    assert.equal(m.attrs['data-stale-after-hours'], '6');
    const d = mainOf(await read(ws, 'day/2026-10-08/index.html'));
    assert.equal(d.attrs['data-view'], 'day');
    assert.equal(d.attrs['data-day'], '2026-10-08');
  });

  test('home and day pages load stale.js and carry the empty hidden banner region and the 7-day strip', async () => {
    for (const rel of ['index.html', 'day/2026-10-07/index.html', 'day/2026-10-08/index.html']) {
      const html = await read(ws, rel);
      const doc = parse(html);
      assert.ok(find(doc, (n) => n.tag === 'script' && n.attrs.src === '/assets/js/stale.js'), `${rel} stale.js`);
      const region = find(doc, (n) => n.attrs.class === 'stale');
      assert.ok(region && region.attrs.hidden !== undefined && textOf(region) === '', `${rel} empty hidden banner`);
      const strip = find(doc, (n) => n.tag === 'nav' && /day-strip/.test(n.attrs.class ?? ''));
      assert.ok(strip, `${rel} strip`);
      const hrefs = findAll(strip, (n) => n.tag === 'a').map((a) => a.attrs.href);
      assert.deepEqual(hrefs, ['/day/2026-10-07/', '/day/2026-10-08/'], `${rel} strip links`);
    }
    const day7 = parse(await read(ws, 'day/2026-10-07/index.html'));
    const cur = findAll(day7, (n) => n.tag === 'a' && n.attrs['aria-current'] === 'page' && /day-strip/.test(n.attrs.class ?? ''));
    assert.deepEqual(cur.map((a) => a.attrs.href), ['/day/2026-10-07/']);
  });

  test('the home page links tomorrow\'s published card', async () => {
    const doc = parse(await read(ws, 'index.html'));
    assert.ok(find(doc, (n) => n.tag === 'a' && n.attrs.href === '/day/2026-10-08/' && /home-next/.test(n.parent.attrs.class ?? '')));
  });

  test('waitlist result pages and the 404 are noindex; the content pages are not', async () => {
    for (const k of ['thanks', 'invalid', 'slow-down', 'unavailable']) {
      const html = await read(ws, `waitlist/${k}/index.html`);
      assert.match(html, /<meta name="robots" content="noindex">/, k);
    }
    assert.match(await read(ws, '404.html'), /<meta name="robots" content="noindex">/);
    assert.match(await read(ws, '404.html'), /Page not found/);
    for (const rel of ['index.html', 'our-record/index.html', 'features/index.html', 'privacy/index.html']) {
      assert.doesNotMatch(await read(ws, rel), /name="robots"/, rel);
    }
  });

  test('/day/<today>/ names / as its canonical URL (same card); other days name themselves', async () => {
    const canon = (html) => find(parse(html), (n) => n.tag === 'link' && n.attrs.rel === 'canonical')?.attrs.href;
    const ogUrl = (html) => find(parse(html), (n) => n.tag === 'meta' && n.attrs.property === 'og:url')?.attrs.content;
    const today = await read(ws, 'day/2026-10-07/index.html');
    assert.equal(canon(today), 'https://betgaffer.com/');
    assert.equal(ogUrl(today), 'https://betgaffer.com/');
    assert.equal(canon(await read(ws, 'day/2026-10-08/index.html')), 'https://betgaffer.com/day/2026-10-08/');
    assert.equal(canon(await read(ws, 'index.html')), 'https://betgaffer.com/');
  });

  test('the output carries the build marker, and no lock is left behind', async () => {
    assert.match(await read(ws, '.betgaffer-build'), /site\/build\.mjs/);
    assert.equal(await exists(`${ws.out}.lock`), false);
  });

  test('rebuilding swaps the whole directory: a stray file in the old dist is gone, no .tmp/.old remains', async () => {
    await writeFile(join(ws.out, 'stray.txt'), 'old');
    await run(ws);
    assert.equal(await exists(join(ws.out, 'stray.txt')), false);
    assert.equal(await exists(`${ws.out}.tmp`), false);
    assert.equal(await exists(`${ws.out}.old`), false);
  });
});

// ------------------------------------------------------------------ atomicity and refusals

describe('a refused build leaves dist exactly as it was', () => {
  let ws;
  let before0;
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    await run(ws);
    before0 = await snapshot(ws.out);
  });
  after(() => ws.cleanup());

  const untouched = async () => {
    assert.deepEqual(await snapshot(ws.out), before0, 'dist unchanged');
    assert.equal(await exists(`${ws.out}.tmp`), false, 'no dist.tmp left behind');
    assert.equal(await exists(`${ws.out}.old`), false, 'no dist.old left behind');
  };
  const withRoot = async (mutate, fn) => {
    const w = await workspace();
    try {
      await copyArtifact(w.root);
      await mutate(w.root);
      await fn(w.root);
    } finally {
      await w.cleanup();
    }
  };

  test('a tampered day file (pick changed, hash not) -> throws picks_hash mismatch', async () => {
    await withRoot(async (root) => {
      const p = join(root, 'days/2026-10-08.json');
      const d = await readJson(p);
      const f = d.fixtures.find((x) => x.pick);
      f.pick.label = `${f.pick.label} (edited)`;
      await writeJson(p, d);
    }, async (root) => {
      await assert.rejects(build({ root, out: ws.out, config: testConfig(), now: NOW, warn: quiet }), /picks_hash mismatch 2026-10-08/);
    });
    await untouched();
  });

  test('a listed day with no file -> throws', async () => {
    await withRoot((root) => rm(join(root, 'days/2026-10-07.json')), async (root) => {
      await assert.rejects(build({ root, out: ws.out, config: testConfig(), now: NOW, warn: quiet }), /listed in index\.json but the file is missing/);
    });
    await untouched();
  });

  test('schema 2 -> throws unsupported schema', async () => {
    await withRoot(async (root) => {
      const i = await readJson(join(root, 'index.json'));
      i.schema = 2;
      await writeJson(join(root, 'index.json'), i);
    }, async (root) => {
      await assert.rejects(build({ root, out: ws.out, config: testConfig(), now: NOW, warn: quiet }), /unsupported schema/);
    });
    await untouched();
  });

  test('a day whose accuracy disagrees with its rows (accuracy is outside picks_hash) -> throws', async () => {
    await withRoot(async (root) => {
      const acc = { won: 1, lost: 0, pushes: 0, graded: 1, pct: 100 };
      const p = join(root, 'days/2026-10-07.json');
      const d = await readJson(p);
      d.accuracy = acc;
      await writeJson(p, d);
      const i = await readJson(join(root, 'index.json'));
      i.days.find((x) => x.day === '2026-10-07').accuracy = acc;
      await writeJson(join(root, 'index.json'), i);
    }, async (root) => {
      await assert.rejects(build({ root, out: ws.out, config: testConfig(), now: NOW, warn: quiet }), /does not match its rows/);
    });
    await untouched();
  });

  test('a missing operator field -> throws naming every missing field', async () => {
    const cfg = testConfig();
    cfg.operator = { ...cfg.operator, legal_name: null, address: '  ' };
    await assert.rejects(build({ root: ws.root, out: ws.out, config: cfg, now: NOW, warn: quiet }),
      (e) => /legal_name/.test(e.message) && /address/.test(e.message) && !/contact_email/.test(e.message));
    await untouched();
  });

  test('the real site/config.js with its operator identity blanked -> throws naming legal_name, address and contact_email', async () => {
    const blanked = { ...realConfig, operator: { ...realConfig.operator, legal_name: null, address: null, contact_email: null } };
    await assert.rejects(build({ root: ws.root, out: ws.out, config: blanked, now: NOW, warn: quiet }),
      (e) => ['legal_name', 'address', 'contact_email'].every((k) => e.message.includes(k)));
    await untouched();
  });

  test('a failure after rendering into dist.tmp (before the swap) removes dist.tmp and keeps dist', async () => {
    let sawTmp = false;
    await assert.rejects(run(ws, {
      beforeSwap: async (tmp) => {
        sawTmp = existsSync(join(tmp, 'index.html'));
        throw new Error('injected failure before swap');
      },
    }), /injected failure before swap/);
    assert.ok(sawTmp, 'premise: the new site was fully written to dist.tmp');
    await untouched();
  });

  test('a missing config -> throws', async () => {
    await assert.rejects(build({ root: ws.root, out: ws.out, now: NOW, warn: quiet }), /config/);
    await untouched();
  });

  test('an out directory that is, or contains, the source -> throws before touching anything', async () => {
    await assert.rejects(build({ root: ws.root, out: ws.root, config: testConfig(), now: NOW, warn: quiet }), /out/);
    await assert.rejects(build({ root: ws.root, out: ws.dir, config: testConfig(), now: NOW, warn: quiet }), /out/);
    await assert.rejects(build({ root: ws.root, out: join(REPO_ROOT, 'site'), config: testConfig(), now: NOW, warn: quiet }), /out/);
    assert.ok(existsSync(join(ws.root, 'index.json')));
    await untouched();
  });

  test('the operator error names the config file actually in use', async () => {
    const cfg = testConfig();
    cfg.operator = { ...cfg.operator, contact_email: null };
    await assert.rejects(build({ root: ws.root, out: ws.out, config: cfg, configPath: 'ops/live-config.js', now: NOW, warn: quiet }),
      (e) => e.message.startsWith('ops/live-config.js:') && !e.message.includes('site/config.js') && /contact_email/.test(e.message));
    await untouched();
  });

  test('a crashed earlier swap (dist gone, dist.old holding the last good site) is recovered, not deleted', async () => {
    const w = await workspace();
    try {
      await copyArtifact(w.root);
      await build({ root: w.root, out: w.out, config: testConfig(), now: NOW, warn: quiet });
      const good = await snapshot(w.out);
      await rename(w.out, `${w.out}.old`);
      // The next build fails on bad input: the last good site must be back in place.
      const i = await readJson(join(w.root, 'index.json'));
      i.schema = 2;
      await writeJson(join(w.root, 'index.json'), i);
      await assert.rejects(build({ root: w.root, out: w.out, config: testConfig(), now: NOW, warn: quiet }), /unsupported schema/);
      assert.deepEqual(await snapshot(w.out), good);
      assert.equal(await exists(`${w.out}.old`), false);
    } finally {
      await w.cleanup();
    }
  });
});

// ------------------------------------------------------------------ the build only replaces its own output

describe('the build only replaces or deletes its own output', () => {
  const MARKER = '.betgaffer-build';

  /** A workspace with the artifact; `setup(ws)` plants something at or beside the out path. */
  async function refused(setup, re) {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      await setup(ws);
      const before1 = await snapshot(ws.dir);
      await assert.rejects(run(ws), re);
      assert.deepEqual(await snapshot(ws.dir), before1, 'nothing anywhere in the workspace was touched');
    } finally {
      await ws.cleanup();
    }
  }

  test('an --out that is a file (say README.md) is refused and left byte-identical', async () => {
    await refused(async (ws) => {
      ws.out = join(ws.dir, 'README.md');
      await writeFile(ws.out, '# Bet Gaffer\n\nThe public receipts.\n');
    }, /README\.md.*not a directory/);
  });

  test('a non-empty folder that is not a build output is refused', async () => {
    await refused(async (ws) => {
      ws.out = join(ws.dir, 'notes');
      await mkdir(ws.out);
      await writeFile(join(ws.out, 'ideas.txt'), 'keep me');
    }, /not a build output/);
  });

  test('a home-like folder is refused (nested files, no marker)', async () => {
    await refused(async (ws) => {
      ws.out = join(ws.dir, 'home');
      await mkdir(join(ws.out, 'Documents'), { recursive: true });
      await mkdir(join(ws.out, 'Desktop'));
      await writeFile(join(ws.out, 'Documents', 'cv.docx'), 'cv');
    }, /not a build output/);
  });

  test('a foreign <out>.old is never restored into <out> or deleted', async () => {
    await refused(async (ws) => {
      await mkdir(`${ws.out}.old`);
      await writeFile(join(`${ws.out}.old`, 'precious.txt'), 'keep me');
    }, /dist\.old.*not a build output/);
  });

  test('a file at <out>.tmp, or a foreign folder there, is refused', async () => {
    await refused((ws) => writeFile(`${ws.out}.tmp`, 'not ours'), /dist\.tmp.*not a directory/);
    await refused(async (ws) => {
      await mkdir(`${ws.out}.tmp`);
      await writeFile(join(`${ws.out}.tmp`, 'x.txt'), 'not ours');
    }, /dist\.tmp.*not a build output/);
  });

  test('premise: the same paths are accepted once they are empty or carry the marker', async () => {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      await mkdir(ws.out);
      await run(ws); // empty folder: accepted
      await writeFile(join(ws.out, 'extra.txt'), 'x');
      await run(ws); // our own output (marker present): replaced
      assert.equal(await exists(join(ws.out, 'extra.txt')), false);
      assert.ok(await exists(join(ws.out, MARKER)));
      await rm(join(ws.out, MARKER));
      await assert.rejects(run(ws), /not a build output/, 'removing the marker makes it foreign');
    } finally {
      await ws.cleanup();
    }
  });

  test('a lock held by a live build is refused; a stale lock (dead pid) is taken over and released', async () => {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      await writeFile(`${ws.out}.lock`, `${process.pid}\n`);
      await assert.rejects(run(ws), /another build \(pid \d+\) is writing/);
      assert.equal(await exists(ws.out), false);
      assert.equal(await readFile(`${ws.out}.lock`, 'utf8'), `${process.pid}\n`, 'a live lock is left alone');
      await writeFile(`${ws.out}.lock`, '2147483646\n'); // no such process
      await run(ws);
      assert.ok(await exists(join(ws.out, 'index.html')));
      assert.equal(await exists(`${ws.out}.lock`), false);
    } finally {
      await ws.cleanup();
    }
  });

  test('two builds started together: one builds, the other is refused, and the output is whole', async () => {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      const results = await Promise.allSettled([run(ws), run(ws)]);
      // Both start in the same tick, so both reach the lock before either finishes: exactly one wins.
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one build ran');
      const refusedOne = results.find((r) => r.status === 'rejected');
      assert.match(refusedOne.reason.message, /another build/);
      assert.ok(await exists(join(ws.out, 'index.html')));
      assert.equal(await exists(`${ws.out}.tmp`), false);
      assert.equal(await exists(`${ws.out}.lock`), false);
    } finally {
      await ws.cleanup();
    }
  });

  test('a failed build releases its lock', async () => {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      await assert.rejects(run(ws, { config: { ...testConfig(), operator: {} } }), /legal_name/);
      assert.equal(await exists(`${ws.out}.lock`), false);
    } finally {
      await ws.cleanup();
    }
  });
});

// ------------------------------------------------------------------ archive stubs

describe('archive: every listed day gets a page; older days are stubs', () => {
  let ws;
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    await addArchive(ws.root);
    await run(ws);
  });
  after(() => ws.cleanup());

  test('a full older day is a stub: summary ring, receipt, #day-root with its source, hash and neighbours, noscript history link', async () => {
    const html = await read(ws, 'day/2026-10-06/index.html');
    const doc = parse(html);
    const root = find(doc, (n) => n.attrs.id === 'day-root');
    assert.ok(root);
    assert.equal(root.attrs['data-src'], '/days/2026-10-06.json');
    assert.equal(root.attrs['data-day'], '2026-10-06');
    assert.match(root.attrs['data-hash'], /^sha256:[0-9a-f]{64}$/);
    assert.equal(root.attrs['data-repo'], 'geezerz/betgaffer-site');
    assert.equal(root.attrs['data-prev'], '2026-10-05');
    assert.equal(root.attrs['data-next'], '2026-10-07');
    const ring = find(root, (n) => n.attrs['data-figure'] === 'ring');
    assert.match(textOf(ring), /2 of 3 landed/);
    const ns = find(doc, (n) => n.tag === 'noscript');
    assert.ok(ns);
    assert.ok(find(ns, (n) => n.tag === 'a' && n.attrs.href === 'https://github.com/geezerz/betgaffer-site/commits/main/days/2026-10-06.json'));
    assert.ok(find(doc, (n) => n.tag === 'script' && n.attrs.src === '/assets/js/day.js'));
    // A stub carries no fixture rows: they come from the fetched file.
    assert.equal(findAll(doc, (n) => n.attrs.class === 'fx').length, 0);
    assert.ok(html.length < 20000, `stub is small (${html.length} bytes)`);
  });

  test('a compacted day is a summary only, with the repository-history link and no fetch', async () => {
    const doc = parse(await read(ws, 'day/2026-10-05/index.html'));
    const root = find(doc, (n) => n.attrs.id === 'day-root');
    assert.ok(root);
    assert.equal(root.attrs['data-src'], undefined, 'nothing to fetch');
    assert.ok(find(doc, (n) => n.tag === 'a' && n.attrs.href === 'https://github.com/geezerz/betgaffer-site/commits/main/days/2026-10-05.json'));
    assert.match(textOf(root), /full card is in the repository history/);
    assert.match(textOf(root), /30 of 36 landed/);
    assert.equal(find(doc, (n) => n.tag === 'script' && n.attrs.src === '/assets/js/day.js'), null);
  });

  test('the strip shows listed days around the shown day', async () => {
    const doc = parse(await read(ws, 'day/2026-10-06/index.html'));
    const strip = find(doc, (n) => n.tag === 'nav' && /day-strip/.test(n.attrs.class ?? ''));
    assert.deepEqual(findAll(strip, (n) => n.tag === 'a').map((a) => a.attrs.href),
      ['/day/2026-10-05/', '/day/2026-10-06/', '/day/2026-10-07/', '/day/2026-10-08/']);
  });

  test('only listed day files are copied, under their listed names', async () => {
    assert.deepEqual((await readdir(join(ws.out, 'days'))).sort(), ['2026-10-05.min.json', '2026-10-06.json', '2026-10-07.json', '2026-10-08.json']);
  });
});

describe('the archive loader (built day.js) verifies the receipt before rendering', () => {
  let ws;
  let dayjs;
  let edge;
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    await addArchive(ws.root);
    await run(ws);
    dayjs = await import(pathToFileURL(join(ws.out, 'assets/js/day.js')).href);
    edge = await readJson(join(ws.out, 'days/2026-10-06.json'));
  });
  after(() => ws.cleanup());

  const respond = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
  const stub = (o = {}) => ({ src: '/days/2026-10-06.json', day: '2026-10-06', hash: edge.picks_hash, repo: 'geezerz/betgaffer-site', prev: '2026-10-05', next: '2026-10-07', ...o });

  test('the WebCrypto digest matches node:crypto', async () => {
    assert.equal(await dayjs.webSha256hex('Bet Gaffer ★'), nodeSha256('Bet Gaffer ★'));
  });

  test('a good file renders the full card with the shared renderer', async () => {
    const html = await dayjs.loadDay({ ...stub(), fetchImpl: respond(edge) });
    assert.match(html, /data-fx="900001"/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'hostile strings arrive escaped');
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /href="\/day\/2026-10-05\/"/);
  });

  test('the day file is fetched same-origin with cache: no-cache (a republished grade is never served stale)', async () => {
    const calls = [];
    await dayjs.loadDay({ ...stub(), fetchImpl: async (url, opts) => { calls.push([url, opts]); return respond(edge)(); } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/days/2026-10-06.json');
    assert.equal(calls[0][1].cache, 'no-cache');
    assert.equal(calls[0][1].credentials, 'same-origin');
  });

  test('no WebCrypto (e.g. an insecure context) is a render failure, never "failed its receipt check"', async () => {
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond(edge), sha256hex: (t) => dayjs.webSha256hex(t, null) }),
      (e) => e.kind === 'render' && /WebCrypto/.test(e.message));
    await assert.rejects(dayjs.webSha256hex('x', { digest: async () => { throw new Error('denied'); } }), (e) => e.kind === 'render');
  });

  test('a tampered file fails its receipt check', async () => {
    const bad = structuredClone(edge);
    bad.fixtures.find((f) => f.pick).pick.pct = 99;
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond(bad) }), (e) => e.kind === 'receipt');
  });

  test('a file whose own hash differs from the stub\'s (index) hash fails its receipt check', async () => {
    await assert.rejects(dayjs.loadDay({ ...stub({ hash: `sha256:${'0'.repeat(64)}` }), fetchImpl: respond(edge) }), (e) => e.kind === 'receipt');
  });

  test('a fetch failure, an HTTP error and unparsable JSON are load failures', async () => {
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: async () => { throw new TypeError('offline'); } }), (e) => e.kind === 'fetch');
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond(edge, 404) }), (e) => e.kind === 'fetch');
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond('{nope') }), (e) => e.kind === 'fetch');
  });

  test('a verified file the renderer refuses (accuracy disagrees with rows) is a render failure', async () => {
    const bad = structuredClone(edge);
    bad.accuracy = { won: 3, lost: 0, pushes: 1, graded: 3, pct: 100 };
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond(bad) }), (e) => e.kind === 'render');
  });

  test('a wrong-day, compacted or newer-schema file is refused', async () => {
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond({ ...edge, lagos_day: '2026-10-04' }) }), (e) => e.kind === 'render');
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond({ ...edge, compacted: true }) }), (e) => e.kind === 'render');
    await assert.rejects(dayjs.loadDay({ ...stub(), fetchImpl: respond({ ...edge, schema: 2 }) }), (e) => e.kind === 'render');
  });

  test('readStub accepts only a same-site day path and a well-formed stub', () => {
    const el = (ds) => ({ dataset: ds });
    const ok = { src: '/days/2026-10-06.json', day: '2026-10-06', hash: edge.picks_hash, repo: 'geezerz/betgaffer-site', prev: '2026-10-05', next: '' };
    assert.equal(dayjs.readStub(el(ok)).src, '/days/2026-10-06.json');
    assert.equal(dayjs.readStub(el(ok)).next, null);
    for (const src of ['https://evil.example/days/2026-10-06.json', '//evil.example/x.json', '/days/2026-10-07.json', '/days/../index.json']) {
      assert.throws(() => dayjs.readStub(el({ ...ok, src })), src);
    }
    assert.throws(() => dayjs.readStub(el({ ...ok, repo: 'a/b?c' })));
    assert.throws(() => dayjs.readStub(el({ ...ok, hash: 'sha256:xyz' })));
  });

  test('the user-facing messages are the plan\'s', () => {
    assert.match(dayjs.MESSAGES.receipt, /^This card failed its receipt check/);
    assert.match(dayjs.MESSAGES.fetch, /^Couldn't load this day\. The raw file is in the repository history:/);
  });
});

// ------------------------------------------------------------------ staleness (built stale.js)

describe('staleNotice (built stale.js) at the Lagos-midnight boundaries', () => {
  let ws;
  let staleNotice;
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    await run(ws);
    ({ staleNotice } = await import(pathToFileURL(join(ws.out, 'assets/js/stale.js')).href));
  });
  after(() => ws.cleanup());

  const GEN = '2026-10-07T22:15:00Z';
  const base = { generatedAt: GEN, day: '2026-10-07', tomorrow: '2026-10-08', staleAfterHours: 6 };
  const at = (iso, o = {}) => staleNotice({ ...base, nowMs: Date.parse(iso), ...o });
  const kinds = (n) => n.map((x) => x.kind);

  test('23:59:59 WAT on the shown day: nothing to say', () => {
    assert.deepEqual(at('2026-10-07T22:59:59Z'), []);
  });

  test('00:00:00 WAT the next day, tomorrow published: "today\'s card is here" with its link', () => {
    const n = at('2026-10-07T23:00:00Z');
    assert.deepEqual(kinds(n), ['tomorrow']);
    assert.equal(n[0].text, `It's ${fmtDayLong('2026-10-08')} in Lagos — today's card is here:`);
    assert.equal(n[0].href, '/day/2026-10-08/');
    assert.equal(n[0].linkText, fmtDayLong('2026-10-08'));
  });

  test('00:00:00 WAT the next day, no tomorrow: the card is for an earlier day', () => {
    const n = at('2026-10-07T23:00:00Z', { tomorrow: null });
    assert.deepEqual(kinds(n), ['old']);
    assert.equal(n[0].text, `This is the card for ${fmtDayLong('2026-10-07')}. Today's card has not been published yet.`);
    assert.equal(n[0].href, undefined);
  });

  test('two days later with tomorrow published: still "not published yet" (tomorrow is not today)', () => {
    assert.deepEqual(kinds(at('2026-10-08T23:00:00Z', { generatedAt: '2026-10-08T22:00:00Z' })), ['old']);
  });

  test('a day page (no day passed) never gets the date notice', () => {
    assert.deepEqual(at('2026-10-08T23:00:00Z', { day: null, generatedAt: '2026-10-08T22:00:00Z' }), []);
  });

  test('late: exactly 6 h old is fine; 6 h and 1 s is late, with the stamp', () => {
    assert.deepEqual(at('2026-10-08T04:15:00Z', { day: null }), []);
    const n = at('2026-10-08T04:15:01Z', { day: null });
    assert.deepEqual(kinds(n), ['late']);
    assert.equal(n[0].text, `Last updated ${fmtStamp(GEN)}. Updates normally run every 4 hours; this one is late.`);
  });

  test('late and past midnight together give both notices, late first', () => {
    assert.deepEqual(kinds(at('2026-10-08T05:00:00Z')), ['late', 'tomorrow']);
  });

  test('a configured window is honoured; a missing or nonsense one falls back to 6 h', () => {
    assert.deepEqual(kinds(at('2026-10-07T23:15:01Z', { day: null, staleAfterHours: 1 })), ['late']);
    assert.deepEqual(at('2026-10-07T23:15:01Z', { day: null, staleAfterHours: NaN }), []);
    assert.deepEqual(at('2026-10-07T23:15:01Z', { day: null, staleAfterHours: 0 }), []);
  });

  test('a generated_at in the future (clock skew) or malformed is never "late"', () => {
    assert.deepEqual(at('2026-10-07T20:00:00Z', { day: null, generatedAt: '2026-10-08T22:00:00Z' }), []);
    assert.deepEqual(at('2026-10-09T20:00:00Z', { day: null, generatedAt: 'yesterday' }), []);
  });
});

// ------------------------------------------------------------------ day choice, no-data and fallbacks

describe('choosing the home day', () => {
  const idx = (o) => ({ today: '2026-10-07', newest_day: '2026-10-08', days: [{ day: '2026-10-08', compacted: false }, { day: '2026-10-07', compacted: false }], ...o });

  test('today listed: home is today, tomorrow is the next calendar day when listed', () => {
    assert.deepEqual(chooseDays(idx()), { today: '2026-10-07', home: '2026-10-07', tomorrow: '2026-10-08', missingToday: false });
  });
  test('today not listed: the newest non-compacted day before it, flagged', () => {
    const c = chooseDays(idx({ today: '2026-10-09' }));
    assert.equal(c.home, '2026-10-08');
    assert.equal(c.missingToday, true);
    assert.equal(c.tomorrow, null);
  });
  test('compacted days are never the home day', () => {
    const c = chooseDays(idx({ today: '2026-10-09', days: [{ day: '2026-10-08', compacted: true }, { day: '2026-10-07', compacted: false }] }));
    assert.equal(c.home, '2026-10-07');
  });
  test('a newest day two days ahead is not "tomorrow"', () => {
    assert.equal(chooseDays(idx({ today: '2026-10-06', days: [{ day: '2026-10-08', compacted: false }] })).tomorrow, null);
  });
  test('no listed day at or before today: no home day', () => {
    assert.deepEqual(chooseDays(idx({ days: [{ day: '2026-10-08', compacted: false }] })), { today: '2026-10-07', home: null, tomorrow: '2026-10-08', missingToday: true });
  });
  test('no index: nothing', () => {
    assert.deepEqual(chooseDays(null), { today: null, home: null, tomorrow: null, missingToday: false });
  });
});

describe('no-data mode and fallback homes', () => {
  test('no index.json (before the first publish): the site still builds, with explicit empty states', async () => {
    const ws = await workspace();
    try {
      const r = await run(ws);
      assert.deepEqual([...r.routes].filter((p) => p.startsWith('/day/')), []);
      const home = visibleText(await read(ws, 'index.html'));
      assert.match(home, /The first card publishes the evening before match day/);
      assert.match(visibleText(await read(ws, 'our-record/index.html')), /No record yet/);
      assert.doesNotMatch(visibleText(await read(ws, 'features/index.html')), /On the card for/);
      for (const r2 of ['privacy/index.html', 'terms/index.html', 'refunds/index.html', 'features/index.html', '404.html']) {
        assert.ok(await exists(join(ws.out, r2)), r2);
      }
      assert.equal(await exists(join(ws.out, 'index.json')), false);
      assert.equal(await exists(join(ws.out, 'days')), false);
      const m = mainOf(await read(ws, 'index.html'));
      assert.equal(m.attrs['data-generated-at'], undefined);
      assert.equal(m.attrs['data-day'], undefined);
      for (const { rel, html } of await htmlFiles(ws.out)) assert.deepEqual(cspViolations(html), [], rel);
    } finally {
      await ws.cleanup();
    }
  });

  test('today not published: home shows the latest earlier card with a notice', async () => {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      const i = await readJson(join(ws.root, 'index.json'));
      i.today = '2026-10-09';
      await writeJson(join(ws.root, 'index.json'), i);
      await run(ws);
      const html = await read(ws, 'index.html');
      const text = visibleText(html);
      assert.ok(text.includes(`No card was published for ${fmtDayLong('2026-10-09')}.`), text.slice(0, 400));
      assert.equal(mainOf(html).attrs['data-day'], '2026-10-08');
      assert.ok(text.includes(D08.fixtures[0].home));
      assert.doesNotMatch(text, /Today's published picks/, 'the shown day is not labelled today');
    } finally {
      await ws.cleanup();
    }
  });

  test('only tomorrow listed: home renders the no-card state plus the tomorrow link', async () => {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      await rm(join(ws.root, 'days/2026-10-07.json'));
      const i = await readJson(join(ws.root, 'index.json'));
      i.days = i.days.filter((d) => d.day === '2026-10-08');
      await writeJson(join(ws.root, 'index.json'), i);
      await run(ws);
      const html = await read(ws, 'index.html');
      const text = visibleText(html);
      assert.ok(text.includes(`No card has been published for ${fmtDayLong('2026-10-07')} yet.`), text.slice(0, 400));
      assert.ok(find(parse(html), (n) => n.tag === 'a' && n.attrs.href === '/day/2026-10-08/'));
      assert.equal(mainOf(html).attrs['data-day'], undefined);
      assert.equal(mainOf(html).attrs['data-tomorrow'], '2026-10-08');
    } finally {
      await ws.cleanup();
    }
  });

  test('a home day with zero fixtures says so', async () => {
    const ws = await workspace();
    try {
      await copyArtifact(ws.root);
      const p = join(ws.root, 'days/2026-10-07.json');
      const d = await readJson(p);
      d.fixtures = [];
      d.counts = { ...d.counts, fixtures: 0, priced: 0, recommended: 0 };
      d.pick_source = { ...d.pick_source, ledger_match_n: 0, ledger_match_matched: 0, ledger_match_served_n: 0, ledger_match_unserved: 0, ledger_match_rate: null };
      await writeJson(p, d);
      await rehash(ws.root, '2026-10-07');
      const i = await readJson(join(ws.root, 'index.json'));
      i.days.find((x) => x.day === '2026-10-07').fixtures = 0;
      await writeJson(join(ws.root, 'index.json'), i);
      await run(ws);
      assert.ok(visibleText(await read(ws, 'index.html')).includes(`No fixtures were scheduled in the competitions we cover on ${fmtDayLong('2026-10-07')}.`));
      assert.doesNotMatch(visibleText(await read(ws, 'features/index.html')), /On the card for/, 'an empty day claims no breadth');
    } finally {
      await ws.cleanup();
    }
  });
});

// ------------------------------------------------------------------ CLI helpers (never spawned)

describe('CLI', () => {
  test('parseCli reads --root, --out and --config (both spellings) and rejects unknown flags', () => {
    assert.deepEqual(parseCli(['--root', 'r', '--out=o', '--config', 'c.js']), { root: 'r', out: 'o', config: 'c.js' });
    assert.deepEqual(parseCli([]), { root: undefined, out: undefined, config: undefined });
    assert.throws(() => parseCli(['--nope']));
    assert.throws(() => parseCli(['stray']));
  });

  test('loadConfig loads a module\'s default export and refuses one without it', async () => {
    const ws = await workspace();
    try {
      const good = join(ws.dir, 'cfg.js');
      await writeFile(good, `export default ${JSON.stringify(testConfig())};\n`);
      assert.equal((await loadConfig(good)).operator.legal_name, 'Example Media Ltd');
      const bad = join(ws.dir, 'nodefault.js');
      await writeFile(bad, 'export const x = 1;\n');
      await assert.rejects(loadConfig(bad), /default export/);
      await assert.rejects(loadConfig(join(ws.dir, 'missing.js')), /config/);
    } finally {
      await ws.cleanup();
    }
  });
});
