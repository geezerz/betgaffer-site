// The dedicated founding page /waitlist/, its result pages and the home founding card (Plan A Task 4,
// spec §2 and §3 as amended in §14 and the plan's "Task 4 additions"). The copy below is typed out
// from the spec on purpose, not imported from the page module: a test that read the page's own
// constants would pass whatever the page said.
//
// Built over the fixture artifact with the exported build(); nothing is spawned.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { build } from '../site/build.mjs';
import * as waitlist from '../site/content/waitlist.js';
import * as F from '../site/lib/founding.js';
import { THANKS_MESSAGE, waitlistForm } from '../site/lib/waitlist-form.js';
import { init as waitlistInit, placesText } from '../site/assets/js/waitlist.js';
import {
  parse, find, findAll, textOf, visibleText, claimViolations, percentagesOutsideOffers, cspViolations,
} from './html-scan.js';
import { fakeDocument } from './fake-dom.js';
import { REPO_ROOT, workspace, copyArtifact, testConfig } from './site-fixtures.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');

// ── spec copy (§2, §3; amendments "Task 4 additions") ──────────────────────────────────────────
const LEDE = "1,000 places. 30% off your plan's price at every payment, for as long as you subscribe — plus double Credits, first look at new features and priority support.";
const LAUNCH_TILE = '500 places for the first people to subscribe at launch.';
const FULL_LINE = "All 500 waitlist places are taken. Join anyway and we'll email your invite when it's ready — with a head start on one of the 500 launch places.";
const STEPS = [
  ['Join the waitlist.', 'The first 500 people reserve a founding place.'],
  ['Claim it at launch.', "We'll email your invite. Start any paid plan within 30 days of it and the place is yours. Places not claimed in time go to the next people who subscribe."],
  ['Keep it while you subscribe.', 'If your subscription lapses, you have 90 days to come back and keep everything. After that, the place passes to the next member in line.'],
];
const QUESTIONS = [
  ['When does Bet Gaffer launch?', "Invites go out in batches. Join the waitlist and we'll email you when yours is ready."],
  ['What if I miss the 30 days?', "Your waitlist place goes to the earliest-paying subscriber without a place. If launch places are still open when you subscribe, you'll get one of those."],
  ['Does the free account or a free trial count?', "No. Founding status starts with your first paid subscription. A first payment that is refunded or reversed doesn't count."],
  ['Can I give my place to someone else?', "No. Founding places are personal and can't be transferred or exchanged for anything."],
  ['Does the 30% combine with other discounts?', 'No. If another percentage discount applies, you get whichever saves you more.'],
  ['What if I cancel?', 'You have 90 days after your last paid period ends to subscribe again and keep everything. After that, the place passes to the next member in line.'],
];
const META_DESCRIPTION = '1,000 founding places. 30% off every subscription payment while you subscribe, double Credits, first look at new features and priority support.';
const THANKS = "You're on the founding waitlist. We'll email your invite when it's ready — if you're among the first 500, you'll have 30 days from that email to claim your place.";
const CARD_TITLE = 'Be one of 1,000 founding members';
const SUMMARY = '30% off every subscription payment · double Credits · first look at new features · priority support';

const RESULT_KINDS = ['thanks', 'invalid', 'slow-down', 'unavailable'];

/** Percentages written in s that are not one of the programme's two offer numbers. */
const OFFER = new Set([`${F.DISCOUNT_PCT}%`, `${F.TOPUP_BONUS_PCT}%`]);
const strayPercentages = (s) => [...s.matchAll(/\d[\d.,]*%/g)].map((m) => m[0]).filter((p) => !OFFER.has(p));

const has = (n, c) => (n.attrs.class ?? '').split(/\s+/).includes(c);
const exists = (p) => access(p).then(() => true, () => false);

// ── the module, without a build ────────────────────────────────────────────────────────────────

describe('site/content/waitlist.js', () => {
  test('META: /waitlist/, title "Founding members", the spec §3 description', () => {
    assert.equal(waitlist.META.path, '/waitlist/');
    assert.equal(waitlist.META.title, 'Founding members');
    assert.equal(waitlist.META.description, META_DESCRIPTION);
  });

  test('META.description: its only percentages are offer percentages (meta tags cannot carry data-figure)', () => {
    assert.deepEqual(strayPercentages(waitlist.META.description), []);
    assert.match(waitlist.META.description, /30% off/, 'premise: the description does carry the offer');
    // Premise: a wrong value (or a stray accuracy figure) in the description is caught.
    assert.deepEqual(strayPercentages(waitlist.META.description.replace('30%', '25%')), ['25%']);
    assert.deepEqual(strayPercentages(`${waitlist.META.description} Right 84.48% of the time.`), ['84.48%']);
    assert.deepEqual(strayPercentages(waitlist.META.description.replace('30%', '130%')), ['130%']);
  });

  test('render() needs the form HTML; anything else throws instead of shipping a page without its form', () => {
    for (const bad of [undefined, null, 42, '', '<p>no form</p>']) {
      assert.throws(() => waitlist.render(testConfig(), { waitlistHtml: bad }), TypeError, String(bad));
    }
    assert.throws(() => waitlist.render(testConfig()), TypeError);
    assert.doesNotThrow(() => waitlist.render(testConfig(), { waitlistHtml: waitlistForm({ places: false }) }));
  });

  test('foundingCard(): spec §2 card — title, the four-item summary in an offer figure, the button to /waitlist/', () => {
    const html = waitlist.foundingCard();
    const doc = parse(html);
    const sec = find(doc, (n) => n.tag === 'section' && has(n, 'bg-fd-card'));
    assert.ok(sec, '<section class="bg-fd-card">');
    assert.ok(textOf(sec).startsWith(CARD_TITLE), textOf(sec));
    const offer = findAll(sec, (n) => n.attrs['data-figure'] === 'offer');
    assert.equal(offer.length, 1);
    assert.equal(textOf(offer[0]), SUMMARY);
    const a = findAll(sec, (n) => n.tag === 'a');
    assert.equal(a.length, 1);
    assert.equal(a[0].attrs.href, '/waitlist/');
    assert.equal(textOf(a[0]), 'See the founding benefits');
    assert.ok(has(a[0], 'bg-btn') && has(a[0], 'bg-btn--primary'));
    assert.deepEqual(percentagesOutsideOffers(html), []);
    // No heading: on the home page the card comes before the day's <h1>.
    assert.equal(findAll(sec, (n) => /^h[1-6]$/.test(n.tag)).length, 0, 'no heading before the page h1');
    assert.ok(sec.attrs['aria-labelledby'], 'the region is named');
  });
});

// ── the built site ─────────────────────────────────────────────────────────────────────────────

describe('/waitlist/ and the founding card in the built site', () => {
  let ws;
  let page;
  let doc;
  const read = (rel) => readFile(join(ws.out, rel), 'utf8');
  before(async () => {
    ws = await workspace();
    await copyArtifact(ws.root);
    await build({ root: ws.root, out: ws.out, config: testConfig(), now: NOW, warn: () => {} });
    page = await read('waitlist/index.html');
    doc = parse(page);
  });
  after(async () => { await ws?.cleanup(); });

  test('dist/waitlist/index.html exists; title, description and og tags are the spec\'s', async () => {
    assert.ok(await exists(join(ws.out, 'waitlist/index.html')));
    assert.match(page, /<title>Founding members — Bet Gaffer<\/title>/);
    const meta = (k, v) => find(doc, (n) => n.tag === 'meta' && n.attrs[k] === v)?.attrs.content;
    assert.equal(meta('name', 'description'), META_DESCRIPTION);
    assert.equal(meta('property', 'og:description'), META_DESCRIPTION);
    assert.equal(meta('property', 'og:image'), 'https://betgaffer.com/assets/img/og-founding.png');
    assert.equal(meta('property', 'og:image:width'), '1200');
    assert.equal(meta('property', 'og:image:height'), '630');
    assert.ok(meta('property', 'og:image:alt'));
    assert.equal(find(doc, (n) => n.tag === 'link' && n.attrs.rel === 'canonical')?.attrs.href, 'https://betgaffer.com/waitlist/');
    assert.doesNotMatch(page, /name="robots"/, 'the founding page is indexed');
    // Built meta tags: offer percentages only.
    for (const m of findAll(doc, (n) => n.tag === 'meta' && n.attrs.content !== undefined)) {
      assert.deepEqual(strayPercentages(m.attrs.content), [], `${m.attrs.name ?? m.attrs.property}`);
    }
  });

  test('loads waitlist.js as its only module script; no banner, no banner.js', () => {
    const scripts = findAll(doc, (n) => n.tag === 'script').map((s) => [s.attrs.type, s.attrs.src]);
    assert.deepEqual(scripts, [['module', '/assets/js/waitlist.js']]);
    assert.equal(find(doc, (n) => n.attrs['data-banner'] !== undefined), null);
    assert.deepEqual(cspViolations(page), []);
  });

  test('the seven sections of spec §3, in order', () => {
    const main = find(doc, (n) => n.tag === 'main');
    const h1 = findAll(main, (n) => n.tag === 'h1');
    assert.equal(h1.length, 1);
    assert.equal(textOf(h1[0]), 'Become a founding member');
    const preorder = findAll(main, () => true); // every element, in document order
    const at = (pred, what) => {
      const hit = find(main, pred);
      assert.ok(hit, `${what} is on the page`);
      return preorder.indexOf(hit);
    };
    const order = [
      ['hero h1', (n) => n.tag === 'h1'],
      ['counter tile', (n) => n.attrs['data-waitlist-places'] !== undefined],
      ['launch tile', (n) => n.tag === 'p' && textOf(n).startsWith('500 places') && n.attrs['data-waitlist-places'] === undefined],
      ['form', (n) => n.tag === 'form' && n.attrs['data-waitlist'] !== undefined],
      ...F.BENEFITS.map((b) => [`benefit ${b.id}`, (n) => /^h[23]$/.test(n.tag) && textOf(n) === b.title]),
      ['How it works', (n) => n.tag === 'h2' && textOf(n) === 'How it works'],
      ...STEPS.map(([title], i) => [`step ${i + 1}`, (n) => n.tag === 'h3' && textOf(n) === title]),
      ['Questions', (n) => n.tag === 'h2' && textOf(n) === 'Questions'],
      ...QUESTIONS.map(([q]) => [q, (n) => n.tag === 'summary' && textOf(n) === q]),
      ['rules link', (n) => n.tag === 'a' && n.attrs.href === '/terms/#founding'],
    ];
    let last = -1;
    for (const [what, pred] of order) {
      const pos = at(pred, what);
      assert.ok(pos > last, `${what} comes after the previous section`);
      last = pos;
    }
  });

  test('hero: the FOUNDING MEMBERS eyebrow and the spec lede, its percentage in an offer figure', () => {
    const t = visibleText(page);
    assert.ok(t.includes(LEDE), 'lede verbatim');
    const hero = find(doc, (n) => n.tag === 'header' && has(n, 'bg-fd__hero'));
    assert.ok(hero, 'the hero header');
    const eyebrow = find(hero, (n) => n.tag === 'p' && has(n, 't-lbl'));
    assert.equal(textOf(eyebrow), 'Founding members');
    const lede = find(hero, (n) => textOf(n) === LEDE && n.tag === 'p');
    assert.equal(lede.attrs['data-figure'], 'offer');
  });

  test('counters: ONE waitlist counter (the tile, outside the form) reading "500 places"; the launch tile', () => {
    const counters = findAll(doc, (n) => n.attrs['data-waitlist-places'] !== undefined);
    assert.equal(counters.length, 1, 'one counter on the page');
    assert.equal(textOf(counters[0]), '500 places');
    assert.ok(has(counters[0], 'bg-fd__count') && has(counters[0], 'mono'));
    const form = find(doc, (n) => n.tag === 'form' && n.attrs['data-waitlist'] !== undefined);
    assert.equal(find(form, (n) => n.attrs['data-waitlist-places'] !== undefined), null, 'the form has no places line');
    const tiles = findAll(doc, (n) => has(n, 'bg-fd__tile'));
    assert.equal(tiles.length, 2);
    assert.ok(textOf(tiles[0]).startsWith('Waitlist places'), textOf(tiles[0]));
    assert.equal(textOf(tiles[1]), `Launch places ${LAUNCH_TILE}`);
  });

  test('the form: the shared waitlist form, button "Join the founding waitlist", the hidden "places taken" line above it', () => {
    const form = find(doc, (n) => n.tag === 'form' && n.attrs['data-waitlist'] !== undefined);
    assert.equal(form.attrs.action, '/api/waitlist');
    assert.equal(form.attrs.method, 'post');
    const btn = findAll(form, (n) => n.tag === 'button' && n.attrs.type === 'submit');
    assert.equal(btn.length, 1);
    assert.equal(textOf(btn[0]), 'Join the founding waitlist');
    const full = findAll(doc, (n) => n.attrs['data-waitlist-full'] !== undefined);
    assert.equal(full.length, 1);
    assert.ok(full[0].attrs.hidden !== undefined, 'hidden until JS sees places_left === 0');
    assert.equal(textOf(full[0]), FULL_LINE);
    assert.equal(find(form, (n) => n.attrs['data-waitlist-full'] !== undefined), null, 'outside the form');
    assert.ok(page.indexOf('data-waitlist-full') < page.indexOf('<form'), 'above the form');
  });

  test('benefits: six cards in programme order, each the founding.js title + sentence; percentages in offer figures', () => {
    const cards = findAll(doc, (n) => n.tag === 'li' && has(n, 'bg-fd__benefit'));
    assert.equal(cards.length, F.BENEFITS.length);
    assert.equal(cards.length, 6);
    cards.forEach((c, i) => {
      const b = F.BENEFITS[i];
      assert.equal(c.attrs['data-benefit'], b.id);
      const h = find(c, (n) => n.tag === 'h3');
      assert.equal(textOf(h), b.title);
      assert.ok(textOf(c).includes(b.text), `${b.id} sentence verbatim`);
      if (/%/.test(`${b.title} ${b.text}`)) assert.equal(c.attrs['data-figure'], 'offer', `${b.id} offer figure`);
    });
    assert.ok(find(doc, (n) => n.tag === 'h2' && textOf(n) === 'What founding members get'));
  });

  test('how it works: three numbered steps, verbatim', () => {
    const ol = find(doc, (n) => n.tag === 'ol' && has(n, 'bg-fd__steps'));
    assert.ok(ol, '<ol class="bg-fd__steps">');
    const items = findAll(ol, (n) => n.tag === 'li');
    assert.equal(items.length, 3);
    items.forEach((li, i) => assert.equal(textOf(li), `${STEPS[i][0]} ${STEPS[i][1]}`));
  });

  test('questions: six details/summary pairs (keyboard operable without JS), verbatim answers', () => {
    const details = findAll(doc, (n) => n.tag === 'details');
    assert.equal(details.length, QUESTIONS.length);
    details.forEach((d, i) => {
      const s = findAll(d, (n) => n.tag === 'summary');
      assert.equal(s.length, 1);
      assert.equal(textOf(s[0]), QUESTIONS[i][0]);
      assert.equal(d.children.filter((c) => c.tag !== undefined)[0], s[0], 'summary is the first child');
      assert.equal(textOf(d), `${QUESTIONS[i][0]} ${QUESTIONS[i][1]}`);
    });
    // The percentage in the 5th question sits in an offer figure.
    const q5 = find(details[4], (n) => n.attrs['data-figure'] === 'offer');
    assert.ok(q5 && /30%/.test(textOf(q5)));
  });

  test('the rules link reads "Read the full programme rules" and the Terms carry that anchor', async () => {
    const a = findAll(doc, (n) => n.tag === 'a' && n.attrs.href === '/terms/#founding');
    assert.equal(a.length, 1);
    assert.equal(textOf(a[0]), 'Read the full programme rules');
    assert.match(await read('terms/index.html'), /id="founding"/);
  });

  test('claims: no stray percentage, no banned phrase; the scan fires on a bare or wrong offer', () => {
    assert.deepEqual(claimViolations(page), []);
    assert.deepEqual(percentagesOutsideOffers(page), []);
    const plant = (frag) => page.replace('</main>', `${frag}</main>`);
    assert.ok(claimViolations(plant('<p>30% off</p>')).some((m) => /"30%"/.test(m)));
    assert.ok(claimViolations(plant('<p data-figure="offer">25% off</p>')).some((m) => /"25%"/.test(m)));
  });

  test('the four result pages are built with no banner (the every-page banner rule is in build.test.js)', async () => {
    for (const k of RESULT_KINDS) {
      const html = await read(`waitlist/${k}/index.html`);
      assert.equal(findAll(parse(html), (n) => n.attrs['data-banner'] !== undefined).length, 0, k);
      assert.doesNotMatch(html, /banner\.js/, k);
    }
  });

  test('the thanks page and THANKS_MESSAGE carry the spec §3 thanks copy', async () => {
    assert.equal(THANKS_MESSAGE, THANKS);
    assert.ok(visibleText(await read('waitlist/thanks/index.html')).includes(THANKS));
  });

  test('/features/ has no form and does not load waitlist.js', async () => {
    const html = await read('features/index.html');
    assert.doesNotMatch(html, /<form/);
    assert.doesNotMatch(html, /waitlist\.js/);
  });

  test('home and full day pages: the founding card sits immediately before the day card, above the first fixture row', async () => {
    for (const rel of ['index.html', 'day/2026-10-07/index.html', 'day/2026-10-08/index.html']) {
      const html = await read(rel);
      const cards = findAll(parse(html), (n) => n.tag === 'section' && has(n, 'bg-fd-card'));
      assert.equal(cards.length, 1, `${rel}: one founding card`);
      const card = html.indexOf('<section class="bg-fd-card"');
      const row = html.search(/<li\b[^>]*\bdata-fx=/);
      assert.ok(row > 0, `${rel}: premise, the page has fixture rows`);
      assert.ok(card < row, `${rel}: card before the first row`);
      assert.match(html, /<\/section>\s*<div class="day" data-day=/, `${rel}: directly before the day card`);
      assert.ok(card < html.indexOf('<h1'), `${rel}: above the day header`);
      const text = visibleText(html);
      assert.ok(text.includes(CARD_TITLE) && text.includes(SUMMARY) && text.includes('See the founding benefits'), rel);
      assert.deepEqual(claimViolations(html), [], rel);
    }
    for (const rel of ['our-record/index.html', 'features/index.html', 'waitlist/index.html']) {
      assert.doesNotMatch(await read(rel), /class="bg-fd-card"/, `${rel}: no home card`);
    }
  });

  test('waitlist.js finds the counter and the "places taken" line at DOCUMENT level (both sit outside the form)', async () => {
    const run = async (data) => {
      const d = fakeDocument(page);
      await waitlistInit({ doc: d, load: async () => data });
      return {
        tile: d.querySelector('[data-waitlist-places]').textContent,
        fullHidden: d.querySelector('[data-waitlist-full]').hidden,
      };
    };
    assert.deepEqual(await run({ places_left: 377, cap: 500 }), { tile: '377 of 500 left', fullHidden: true });
    assert.deepEqual(await run({ places_left: 0, cap: 500 }), { tile: 'All 500 taken', fullHidden: false });
    assert.deepEqual(await run(null), { tile: '500 places', fullHidden: true }, 'no data: the static text stays');
    assert.equal(placesText({ places_left: 0, cap: 500 }), 'All 500 taken');
  });

  test('founding.css styles every class the waitlist page and the home card use', async () => {
    const css = readFileSync(join(REPO_ROOT, 'site/assets/css/founding.css'), 'utf8');
    const waitlistCss = readFileSync(join(REPO_ROOT, 'site/assets/css/waitlist.css'), 'utf8');
    const main = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    const home = main(await read('index.html'));
    const cardHtml = home.slice(home.indexOf('<section class="bg-fd-card"'), home.indexOf('</section>', home.indexOf('<section class="bg-fd-card"')));
    const classes = new Set([...`${main(page)}${cardHtml}`.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
    const fromBase = new Set(['bg-wrap', 'bg-page', 'vh', 'bg-btn', 'bg-btn--primary', 'bg-btn--ghost', 't-lbl', 't-lbl--quiet', 't-s', 't-b', 't-h', 't-d1', 't-d2', 'mono', 'stale']);
    let checked = 0;
    for (const c of classes) {
      if (fromBase.has(c) || c.startsWith('bg-wl')) continue;
      assert.ok(new RegExp(`\\.${c.replace(/[-_]/g, '\\$&')}(?![\\w-])`).test(css), `.${c} is styled in founding.css`);
      checked++;
    }
    assert.ok(checked >= 10, `premise: the page uses its own classes (${checked})`);
    for (const c of [...classes].filter((x) => x.startsWith('bg-wl'))) assert.ok(waitlistCss.includes(`.${c}`), `.${c}`);
    assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
    // Brand tokens only: no raw hex colour outside a var() fallback-free token use.
    const props = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.deepEqual(props.match(/#[0-9a-f]{3,8}\b/gi) ?? [], [], 'colours come from base.css tokens');
  });
});
