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
import { REPO_ROOT, workspace, copyArtifact, testConfig, htmlFiles } from './site-fixtures.js';
import { findBanned } from '../site/lib/claims.js';
import { commitmentSentences, commitmentViolations } from '../site/lib/commitments.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');

// ── spec copy (§2, §3; amendments "Task 4 additions") ──────────────────────────────────────────
const LEDE = "1,000 places. 30% off your plan's price at every payment, for as long as you subscribe — plus double Credits, first look at new features and priority support.";
const LAUNCH_TILE = '500 places for the first people to subscribe at launch.';
const FULL_LINE = "All 500 waitlist places are taken. Join anyway and we'll email your invite when it's ready — with a head start on one of the 500 launch places.";
const STEPS = [
  ['Join the waitlist.', 'The first 500 people reserve a founding place.'],
  ['Claim it at launch.', "We'll email your invite. Start any paid plan within 30 days of it and the place is yours. Places not claimed in time go to the earliest-paying subscribers without a place."],
  ['Keep it while you subscribe.', 'If your subscription lapses, you have 90 days to come back and keep everything. After that, the place passes to the next member in line.'],
];
const QUESTIONS = [
  ['When does Bet Gaffer launch?', "Invites go out in batches. Join the waitlist and we'll email you when yours is ready."],
  ['What if I miss the 30 days?', "Your waitlist place goes to the earliest-paying subscriber without a place. If launch places are still open when you subscribe, you'll get one of those."],
  ['Does the free account or a free trial count?', "No. Founding status starts with your first paid subscription. A first payment that is refunded or reversed doesn't count."],
  ['Can I give my place to someone else?', "No. Founding places are personal and can't be transferred or exchanged for anything. Claiming a place needs a verified phone number — one place per number."],
  ['Does the 30% combine with other discounts?', 'No. If another percentage discount applies, you get whichever saves you more.'],
  ['What if I cancel?', 'You have 90 days after your last paid period ends to subscribe again and keep everything. After that, the place passes to the next member in line.'],
];
const META_DESCRIPTION = '1,000 founding places. 30% off every subscription payment while you subscribe, double Credits, first look at new features and priority support.';
const THANKS = "You're on the founding waitlist. We'll email your invite when it's ready — if you're among the first 500, you'll have 30 days from that email to claim your place.";

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

  test('foundingCard(i): all ten variants render the stand-out card (spec §16.5)', () => {
    assert.equal(F.VARIANTS.length, 10, 'premise: ten variants');
    for (const [i, v] of F.VARIANTS.entries()) {
      const html = waitlist.foundingCard(i);
      const doc = parse(html);
      const slots = findAll(doc, (n) => n.attrs['data-banner'] !== undefined);
      assert.equal(slots.length, 1, `variant ${i}: one [data-banner]`);
      const [slot] = slots;
      assert.equal(slot.tag, 'aside', `variant ${i}`);
      assert.ok(has(slot, 'bg-wrap') && has(slot, 'bg-fd-slot'), `variant ${i}: in the page column`);
      assert.equal(slot.attrs['aria-label'], 'Founding members');
      assert.equal(slot.attrs['data-variant'], String(i));
      const cards = findAll(slot, (n) => has(n, 'bg-fd-card'));
      assert.equal(cards.length, 1, `variant ${i}: one card`);
      const head = find(slot, (n) => n.attrs['data-fd-heading'] !== undefined);
      const line = find(slot, (n) => n.attrs['data-fd-line'] !== undefined);
      assert.ok(head && has(head, 'bg-fd-card__title') && head.tag === 'p', `variant ${i}: the heading (a <p>: no heading before the page h1)`);
      assert.ok(line && has(line, 'bg-fd-card__line') && line.tag === 'p', `variant ${i}: the line`);
      assert.equal(textOf(head), v.heading.map((x) => x.t).join(''), `variant ${i} heading`);
      assert.equal(textOf(line), v.line.map((x) => x.t).join(''), `variant ${i} line`);
      // Highlights: strong.fd-hl, one per hl segment, in order.
      const strongs = findAll(slot, (n) => n.tag === 'strong');
      assert.deepEqual(strongs.map((n) => [n.attrs.class, textOf(n)]),
        [...v.heading, ...v.line].filter((x) => x.hl).map((x) => ['fd-hl', x.t]), `variant ${i} highlights`);
      // Offer figures: exactly the % segments.
      assert.deepEqual(findAll(slot, (n) => n.attrs['data-figure'] === 'offer').map(textOf),
        [...v.heading, ...v.line].filter((x) => x.offer).map((x) => x.t), `variant ${i} offers`);
      assert.deepEqual(percentagesOutsideOffers(html), [], `variant ${i}`);
      // The button and the close control.
      const a = findAll(slot, (n) => n.tag === 'a');
      assert.deepEqual(a.map((n) => [n.attrs.href, textOf(n)]), [['/waitlist/', 'See the founding benefits']]);
      assert.ok(has(a[0], 'bg-btn') && has(a[0], 'bg-btn--primary') && has(a[0], 'bg-fd-card__cta'));
      const x = findAll(slot, (n) => n.tag === 'button');
      assert.equal(x.length, 1);
      assert.equal(x[0].attrs.type, 'button');
      assert.ok(x[0].attrs['data-banner-close'] !== undefined, 'data-banner-close');
      assert.ok(x[0].attrs.hidden !== undefined, 'hidden until banner.js runs');
      assert.equal(x[0].attrs['aria-label'], 'Hide the founding card');
      assert.equal(findAll(slot, (n) => /^h[1-6]$/.test(n.tag)).length, 0, 'no heading element');
      assert.match(html, /^<aside\b/, 'a single top-level element');
      assert.ok(html.trimEnd().endsWith('</aside>'));
      assert.doesNotMatch(html, /\sstyle=|<script|<style/i, 'CSP');
    }
  });

  test('foundingCard(i): every variant passes the claim scan, the banned list and the commitments guard', () => {
    const wrap = (h) => `<!doctype html><html lang="en-NG"><head><title>t</title></head><body>${h}</body></html>`;
    for (let i = 0; i < F.VARIANTS.length; i++) {
      const html = waitlist.foundingCard(i);
      assert.deepEqual(claimViolations(wrap(html)), [], `variant ${i}`);
      assert.deepEqual(findBanned(html), [], `variant ${i}`);
      assert.deepEqual(commitmentSentences(html), [], `variant ${i}: no time commitment`);
      assert.deepEqual(commitmentViolations(html), { unapproved: [], refundable: [] }, `variant ${i}`);
    }
    // Premise: each scan fires on a card.
    const card = waitlist.foundingCard(0);
    assert.ok(claimViolations(wrap(card.replace(' data-figure="offer"', ''))).some((m) => /30%/.test(m)), 'a % outside its offer figure');
    assert.deepEqual(findBanned(card.replace('priority support', 'a sure bet')), ['sure bet']);
    assert.equal(commitmentSentences(card.replace('priority support', 'support within 12 hours')).length, 1);
  });

  test('foundingCard(i): anything but an index into VARIANTS throws', () => {
    for (const bad of [undefined, null, -1, 10, 1.5, '3', NaN]) {
      assert.throws(() => waitlist.foundingCard(bad), RangeError, String(bad));
    }
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

  test('loads the menu script (every page, spec §16.3) then waitlist.js, nothing else; no banner, no banner.js', () => {
    const scripts = findAll(doc, (n) => n.tag === 'script').map((s) => [s.attrs.type, s.attrs.src]);
    assert.deepEqual(scripts, [['module', '/assets/js/nav.js'], ['module', '/assets/js/waitlist.js']]);
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
    assert.equal(textOf(tiles[0]), 'Waitlist places 500 places for the first 500 people to join the waitlist.');
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

  test('/waitlist/invalid/: the retry form has no places line, keeps waitlist.js (progressive submit) and never fetches the counter', async () => {
    const html = await read('waitlist/invalid/index.html');
    const d = parse(html);
    assert.ok(find(d, (n) => n.tag === 'form' && n.attrs['data-waitlist'] !== undefined), 'the retry form');
    assert.equal(find(d, (n) => n.attrs['data-waitlist-places'] !== undefined), null, 'no counter');
    assert.ok(find(d, (n) => n.tag === 'script' && n.attrs.src === '/assets/js/waitlist.js'), 'the script still enhances the submit');
    let loads = 0;
    const fd = fakeDocument(html);
    await waitlistInit({ doc: fd, load: async () => { loads++; return { places_left: 3, cap: 500 }; } });
    assert.equal(loads, 0, 'no GET /api/waitlist on a page without a counter');
    // Premise: on /waitlist/ (which has the counter) the same init does load once.
    await waitlistInit({ doc: fakeDocument(page), load: async () => { loads++; return null; } });
    assert.equal(loads, 1);
  });

  test('/features/ has no form and does not load waitlist.js', async () => {
    const html = await read('features/index.html');
    assert.doesNotMatch(html, /<form/);
    assert.doesNotMatch(html, /waitlist\.js/);
  });

  test('every page but /waitlist/*: one founding card directly under the header, outside <main>, its variant chosen by path', async () => {
    const files = await htmlFiles(ws.out);
    const variants = new Set();
    let withCard = 0;
    for (const { rel, html } of files) {
      const d = parse(html);
      const cards = findAll(d, (n) => has(n, 'bg-fd-card'));
      if (rel.startsWith('waitlist/')) {
        assert.equal(cards.length, 0, `${rel}: no card on the founding page or its result pages`);
        continue;
      }
      assert.equal(cards.length, 1, `${rel}: exactly one card`);
      const slot = find(d, (n) => n.attrs['data-banner'] !== undefined);
      assert.ok(slot && slot.children.includes(cards[0]), `${rel}: the card is the [data-banner] slot's`);
      assert.equal(find(find(d, (n) => n.tag === 'main'), (n) => has(n, 'bg-fd-card')), null, `${rel}: not inside <main>`);
      assert.match(html, /<\/header>\n<aside class="bg-wrap bg-fd-slot"/, `${rel}: directly after the header`);
      assert.ok(html.indexOf('bg-fd-slot') < html.indexOf('<main'), `${rel}: before <main>`);
      const path = rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
      const i = F.variantFor(path);
      assert.equal(slot.attrs['data-variant'], String(i), `${rel} (${path})`);
      assert.equal(textOf(find(slot, (n) => n.attrs['data-fd-heading'] !== undefined)), F.VARIANTS[i].heading.map((x) => x.t).join(''), rel);
      assert.deepEqual(claimViolations(html), [], rel);
      // The slim banner and the in-list card are gone.
      assert.doesNotMatch(html, /bg-banner|See the benefits →/, `${rel}: no slim banner`);
      variants.add(i);
      withCard++;
    }
    assert.equal(withCard, files.length - 5, 'premise: every page outside /waitlist/* was scanned');
    assert.ok(variants.size >= 5, `no-JS readers see different copy on different pages: ${variants.size} variants`);
  });

  test('home and full day pages: the card is not repeated inside the day card (one card, under the header)', async () => {
    for (const rel of ['index.html', 'day/2026-10-07/index.html', 'day/2026-10-08/index.html']) {
      const html = await read(rel);
      const d = parse(html);
      const day = find(d, (n) => n.tag === 'div' && has(n, 'day') && n.attrs['data-day'] !== undefined);
      assert.ok(day, `${rel}: premise, the day card`);
      assert.equal(find(day, (n) => has(n, 'bg-fd-card')), null, `${rel}: no card in the list`);
      assert.equal((html.match(/class="bg-fd-card"/g) ?? []).length, 1, rel);
      assert.ok(html.indexOf('class="bg-fd-card"') < html.indexOf('<h1'), `${rel}: above the day header`);
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

  test('founding.css styles every class the waitlist page and the founding card use', async () => {
    const css = readFileSync(join(REPO_ROOT, 'site/assets/css/founding.css'), 'utf8');
    const waitlistCss = readFileSync(join(REPO_ROOT, 'site/assets/css/waitlist.css'), 'utf8');
    const main = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    const home = await read('index.html');
    const cardHtml = home.slice(home.indexOf('<aside class="bg-wrap bg-fd-slot"'), home.indexOf('</aside>', home.indexOf('<aside class="bg-wrap bg-fd-slot"')));
    assert.match(cardHtml, /bg-fd-card__cta/, 'premise: the card markup was found');
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
