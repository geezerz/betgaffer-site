// The blog + Learn section (site/lib/blog.js, wired in site/build.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { build, REPO_ROOT } from '../site/build.mjs';
import { backdated, blogErrors, freshness, pathOf, readBlog, receiptFooter, receipts } from '../site/lib/blog.js';
import { lagosToday, addDays } from '../site/lib/time.js';
import { workspace, copyArtifact, testConfig } from './site-fixtures.js';
import { parse, findAll, cspViolations, claimViolations, bareCounts, visibleText } from './html-scan.js';
import { findBanned } from '../site/lib/claims.js';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const TODAY = '2026-11-12';
const REAL_BLOG = join(REPO_ROOT, 'content', 'blog');
const exists = (p) => access(p).then(() => true, () => false);
const read = (ws, rel) => readFile(join(ws.out, rel), 'utf8');

const piece = (slug, o = {}) => ({
  slug, section: 'learn', cat: 'maths', level: 'beginner', title: `Title ${slug}`, published: '2026-11-01', updated: '2026-11-02',
  checked: '2026-11-01', crumb: `Crumb ${slug}`, dek: `Dek ${slug}`, card: `Card ${slug}`, minutes: 2, toc: { a: 'Part A' }, ...o,
});
const SB_NOTICE = "BetGaffer isn't affiliated with or endorsed by SportyBet.";
const SB_LINK = '<a href="https://www.sportybet.com/ng/m/help" rel="nofollow">';
const bodyOf = (extra = '') => `<section aria-labelledby="a"><h2 id="a">Part A</h2><p>Words. ${extra}</p></section>`;
/** A valid export: two learn guides (beginner -> regular), two posts, one planned piece. */
const sample = () => ({
  data: {
    blog: { title: 'Blog | BetGaffer', meta: 'Blog meta', h1: 'Blog h1', dek: 'Blog dek' },
    learn: { title: 'Learn | BetGaffer', meta: 'Learn meta', h1: 'Learn h1', dek: 'Learn dek' },
    categories: { maths: 'Ticket maths', trust: 'Trust' },
    articles: [
      piece('g1', { next: 'g2' }),
      piece('g2', { level: 'regular', start_with: 'g1' }),
      piece('p1', { section: 'blog', cat: 'trust', published: '2026-11-03', updated: '2026-11-03' }),
      piece('p2', { section: 'blog', cat: 'trust', published: '2026-11-05', updated: '2026-11-05' }),
      { slug: 'planned', section: 'learn', cat: 'maths', level: 'sharp', title: 'Planned piece' },
    ],
  },
  bodies: Object.fromEntries(['g1', 'g2', 'p1', 'p2'].map((s) => [s, bodyOf()])),
});

/** Write a blog dir from sample()-shaped input into the workspace, build, return { ws, result }. */
async function buildBlog(mutate = () => {}, { now = NOW, keep = false } = {}) {
  const ws = await workspace();
  await copyArtifact(ws.root);
  const dir = join(ws.dir, 'blog');
  await mkdir(dir);
  const s = sample();
  mutate(s);
  await writeFile(join(dir, 'blog.json'), JSON.stringify(s.data));
  for (const [slug, html] of Object.entries(s.bodies)) await writeFile(join(dir, `${slug}.html`), html);
  const result = await build({ root: ws.root, out: ws.out, config: testConfig(), now, warn: () => {}, blogDir: dir });
  return keep ? { ws, result } : { ws, result, done: ws.cleanup };
}

describe('validator', () => {
  test('the sample export is valid', () => assert.deepEqual(blogErrors(sample()), []));

  const bad = [
    ['duplicate slug', (s) => s.data.articles.push(piece('g1')), /duplicate slug: g1/],
    ['slug characters', (s) => { s.data.articles[0].slug = 'G_1'; }, /slug must be/],
    ['reserved slug', (s) => { s.data.articles[0].slug = 'learn'; s.bodies.learn = bodyOf(); }, /reserved slug/],
    ['section', (s) => { s.data.articles[0].section = 'news'; }, /section must be learn or blog/],
    ['unknown cat', (s) => { s.data.articles[0].cat = 'nope'; }, /unknown topic/],
    ['level', (s) => { s.data.articles[0].level = 'pro'; }, /level must be/],
    ['empty title', (s) => { s.data.articles[0].title = ' '; }, /no title/],
    ['next to a missing slug', (s) => { s.data.articles[0].next = 'ghost'; }, /next points at a missing article/],
    ['next not exactly one level up', (s) => { s.data.articles[0].next = 'p1'; }, /next must be one level up/],
    ['start_with to a higher level', (s) => { s.data.articles[0].start_with = 'g2'; }, /start_with must not be a higher level/],
    ['article token to a missing slug', (s) => { s.bodies.g1 = bodyOf('{{article:ghost:Ghost}}'); }, /links a missing article 'ghost'/],
    ['SportyBet in the title without the notice', (s) => { s.data.articles[0].title = 'How SportyBet settles it'; s.bodies.g1 = bodyOf('Rules can change, so check yours.'); }, /without the notice/],
    ['SportyBet named without the rules line', (s) => { Object.assign(s.data.articles[0], { notice: SB_NOTICE }); s.bodies.g1 = bodyOf('SportyBet settles it.'); }, /Rules can change, so check/],
    ['a second SportyBet link', (s) => { Object.assign(s.data.articles[0], { notice: SB_NOTICE }); s.bodies.g1 = bodyOf(`Rules can change, so check ${SB_LINK}x</a> ${SB_LINK}y</a>.`); }, /more than one SportyBet link/],
    ['a tracked SportyBet link', (s) => { Object.assign(s.data.articles[0], { notice: SB_NOTICE }); s.bodies.g1 = bodyOf('Rules can change, so check <a href="https://www.sportybet.com/ng/m/help?ref=x" rel="nofollow">x</a>.'); }, /must be exactly https:\/\/www\.sportybet\.com\/ng\/m\/help/],
    ['published without crumb', (s) => { delete s.data.articles[0].crumb; }, /published without crumb/],
    ['published with an empty toc', (s) => { s.data.articles[0].toc = {}; }, /published without toc/],
    ['bad date', (s) => { s.data.articles[0].updated = '2026-13-40'; }, /updated is not a YYYY-MM-DD/],
    ['missing body file', (s) => { delete s.bodies.g1; }, /no body file g1\.html/],
    ['toc key without a heading', (s) => { s.data.articles[0].toc = { zzz: 'Z' }; }, /'zzz' has no heading/],
    ['the word sure', (s) => { s.bodies.g1 = bodyOf('Be sure.'); }, /uses "sure"/],
    ['the word safe in the title', (s) => { s.data.articles[0].title = 'A safe bet'; }, /uses "safe"/],
    ['style=', (s) => { s.bodies.g1 = bodyOf('<b style="x:y">b</b>'); }, /style= attribute/],
    ['<script', (s) => { s.bodies.g1 = bodyOf('<script>1</script>'); }, /<script>/],
    ['on*= handler', (s) => { s.bodies.g1 = bodyOf('<b onclick="x()">b</b>'); }, /on\*= handler/],
    ['img from elsewhere', (s) => { s.bodies.g1 = bodyOf('<img src="https://x.test/a.png" alt="">'); }, /not under \/blog\/media\//],
  ];
  for (const [name, mutate, re] of bad) {
    test(`rejects: ${name}`, () => {
      const s = sample();
      mutate(s);
      assert.match(blogErrors(s).join('\n'), re);
    });
  }

  test('accepts a same-level start_with and a SportyBet page that meets Legal 12 Nov (R-211)', () => {
    const s = sample();
    s.data.articles[1].start_with = 'g2';
    Object.assign(s.data.articles[0], { notice: SB_NOTICE });
    s.bodies.g1 = bodyOf(`On SportyBet it settles at full time. Rules can change, so check ${SB_LINK}their rules</a>.`);
    assert.deepEqual(blogErrors(s), []);
  });

  test('accepts an img under /blog/media/, and a pointer to a planned slug is an error only when it does not exist', () => {
    const s = sample();
    s.bodies.g1 = bodyOf('<img src="/blog/media/a.png" alt="">');
    s.data.articles[1].next = 'planned';
    assert.deepEqual(blogErrors(s), []);
  });

  test('a structural error fails the build', async () => {
    await assert.rejects(buildBlog((s) => { s.data.articles[0].title = ''; }), /blog: .*no title/);
  });
});

describe('freshness (Legal 12 Nov)', () => {
  const at = (n, o = {}) => freshness({ checked: addDays(TODAY, -n), ...o }, TODAY);
  const table = [
    [0, {}, 'fresh'], [90, {}, 'fresh'], [91, {}, 'stale'], [120, {}, 'stale'], [121, {}, 'gone'],
    [90, { strict: true }, 'fresh'], [91, { strict: true }, 'gone'],
  ];
  for (const [n, o, want] of table) test(`${n} days${o.strict ? ', strict' : ''} -> ${want}`, () => assert.equal(at(n, o), want));
  test('neither checked nor source: always fresh; a source with no checked date: gone', () => {
    assert.equal(freshness({}, TODAY), 'fresh');
    assert.equal(freshness({ source: 's' }, TODAY), 'gone');
  });

  test('every committed piece is fresh today (the build never fails on age, so this does)', async () => {
    const { data } = await readBlog(REAL_BLOG);
    for (const a of data.articles.filter((x) => x.published)) assert.equal(freshness(a, lagosToday()), 'fresh', `${a.slug}: recheck and bump "checked"`);
  });

  test('the build never fails on age: a 200-day-old piece is simply gone', async () => {
    const { ws, done } = await buildBlog((s) => { s.data.articles[2].checked = '2026-04-01'; s.data.articles[3].checked = '2026-04-01'; });
    try {
      assert.equal(await exists(join(ws.out, 'blog/p1/index.html')), false);
      assert.equal(await exists(join(ws.out, 'blog/index.html')), false, 'only 2 live pieces: below the gate');
    } finally { await done(); }
  });
});

describe('receipts', () => {
  test('the site footer never claims every pick past a gap (Legal 12 Nov)', () => {
    for (const [since, want] of [
      ['2026-10-08', 'Every pick carries a receipt code. '],
      ['2026-11-06', 'Picks carry a receipt code from 6 November 2026. '],
      [null, ''],
    ]) assert.equal(receiptFooter(since), want, String(since));
  });
  test('receipts() reports the start of the run it vouches for', () => {
    const set = new Set(['2026-11-10', '2026-11-11', '2026-11-12']);
    assert.equal(receipts(set, '2026-11-13').since, '2026-11-10');
    assert.equal(receipts(set, '2026-11-14').since, null, 'nothing yesterday');
  });
  const days = (from, to) => { const o = []; for (let d = from; d <= to; d = addDays(d, 1)) o.push(d); return new Set(o); };
  test('a run back to the first day: one line only', () => {
    const r = receipts(days('2026-10-08', '2026-11-12'), '2026-11-13');
    assert.equal(r.html, '<p class="lr-ans">Since 8 October 2026 every day\'s card shows its receipt code.</p>');
    assert.equal(r.href, '/day/2026-11-12/');
  });
  test('a gap restarts the run and adds the earlier-cards line (no link)', () => {
    const set = days('2026-10-08', '2026-11-12');
    set.delete('2026-11-05');
    const r = receipts(set, '2026-11-13');
    assert.equal(r.html, '<p class="lr-ans">Since 6 November 2026 every day\'s card shows its receipt code.</p><p>Cards before 6 November 2026 don\'t show a receipt code here.</p>');
    assert.doesNotMatch(r.html, /<a /);
  });
  test('no receipt yesterday: no lines; the link is the latest day up to yesterday', () => {
    const r = receipts(days('2026-10-08', '2026-11-10'), '2026-11-13');
    assert.equal(r.html, '');
    assert.equal(r.href, '/day/2026-11-10/');
  });
  test('days before the first receipt day never extend the run', () => {
    assert.match(receipts(days('2026-10-01', '2026-10-09'), '2026-10-10').html, /Since 8 October 2026/);
  });
});

describe('publication dates (operator R-210: true and identical in the byline, JSON-LD and sitemap)', () => {
  test('the byline says Published, and adds Updated only when the piece really changed later', async () => {
    const { ws, done } = await buildBlog((s) => { s.data.articles[2].updated = s.data.articles[2].published; });
    try {
      for (const [rel, pub, upd] of [['blog/p1/index.html', '2026-11-03', null], ['blog/learn/g1/index.html', '2026-11-01', '2026-11-02']]) {
        const h = await read(ws, rel);
        const meta = h.match(/<p class="lr-meta">[\s\S]*?<\/p>/)[0];
        assert.match(meta, new RegExp(`Published <time datetime="${pub}">`), rel);
        if (upd) assert.match(meta, new RegExp(`Updated <time datetime="${upd}">`), rel);
        else assert.doesNotMatch(meta, /Updated/, `${rel}: never "Updated" on the day it was published`);
        const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((x) => x.datePublished);
        assert.equal(ld.datePublished, pub);
        assert.equal(ld.dateModified, upd ?? pub);
      }
    } finally { await done(); }
  });
  test('a piece dated in the future is not published yet; updated before published is an error', async () => {
    const { ws, done } = await buildBlog((s) => { s.data.articles.push(piece('later', { published: '2026-11-20', updated: '2026-11-20' })); s.bodies.later = bodyOf(); });
    try {
      assert.equal(await exists(join(ws.out, 'blog/learn/later/index.html')), false);
      assert.doesNotMatch(await read(ws, 'sitemap-blog.xml'), /later/);
      assert.doesNotMatch(await read(ws, 'blog/learn/index.html'), /Title later/);
    } finally { await done(); }
    const s = sample();
    s.data.articles[0].updated = '2026-10-30';
    assert.ok(blogErrors(s).some((e) => /updated is before published/.test(e)));
    // WR3 11-12: updated <= max(published, today): a scheduled piece keeps updated == published; a live one never claims a future update.
    const live = sample();
    live.data.articles[0].updated = '2026-11-13';
    assert.ok(blogErrors(live, TODAY).some((e) => /updated is in the future/.test(e)));
    const sched = sample();
    Object.assign(sched.data.articles[0], { published: '2026-11-20', updated: '2026-11-20' });
    assert.deepEqual(blogErrors(sched, TODAY), []);
  });
});

describe('Learn guides 11-12 (WR3): notice and article links', () => {
  test('the notice sits under the h1; an article token links a live guide and is inert for a planned one', async () => {
    const { ws, done } = await buildBlog((s) => {
      Object.assign(s.data.articles[0], { notice: SB_NOTICE });
      s.bodies.g1 = bodyOf(`On SportyBet it settles. Rules can change, so check ${SB_LINK}their rules</a>. See {{article:g2:the next guide}} and {{article:planned:a later one}}.`
        + ' Gaffer comes with some plans{{when:pricing:; {{link:pricing:Pricing}} shows which}}. {{when:features:<a href="/features/">See it</a>}}');
    });
    try {
      const h = await read(ws, 'blog/learn/g1/index.html');
      assert.match(h, /<h1 class="lr-t">[^<]*<\/h1><p class="lr-notice">BetGaffer isn&#39;t affiliated with or endorsed by SportyBet\.<\/p>/);
      assert.match(h, /<a href="\/blog\/learn\/g2\/">the next guide<\/a>/);
      assert.match(h, /<span class="lr-inert" aria-disabled="true">a later one<\/span>/);
      // {{when:KEY:text}} renders only where this host has a page for KEY (WR3 11-12): no pricing page here, a features page yes.
      assert.match(h, /Gaffer comes with some plans\. <a href="\/features\/">See it<\/a>/);
      assert.doesNotMatch(h, /\{\{|shows which/);
    } finally { await done(); }
  });
});

describe('merge preflight: a piece going live for the first time is dated today (Marketing R-210)', () => {
  test('only pieces not yet in the live sitemap, published before today, are backdated', () => {
    const arts = [piece('live1'), piece('new-ok', { published: TODAY, updated: TODAY }), piece('new-old'), piece('later', { published: '2026-11-20', updated: '2026-11-20' }), { slug: 'planned' }];
    const live = new Set(['https://betgaffer.com/blog/learn/live1/']);
    assert.deepEqual(backdated(arts, live, TODAY, 'https://betgaffer.com'), ['new-old']);
    assert.deepEqual(backdated(arts, new Set(), TODAY, 'https://betgaffer.com'), ['live1', 'new-old'], 'nothing live yet: every past-dated piece is new');
  });
});

describe('the built blog (fixture content)', () => {
  test('gate: three live pieces -> everything; two -> nothing blog-related anywhere', async () => {
    const on = await buildBlog();
    const off = await buildBlog((s) => { s.data.articles.splice(2, 2); });
    try {
      for (const rel of ['blog/index.html', 'blog/learn/index.html', 'blog/learn/g1/index.html', 'blog/p1/index.html', 'sitemap-blog.xml', 'blog/feed.xml']) {
        assert.ok(await exists(join(on.ws.out, rel)), `on: ${rel}`);
        assert.equal(await exists(join(off.ws.out, rel)), false, `off: ${rel}`);
      }
      assert.match(await read(on.ws, 'robots.txt'), /Sitemap: https:\/\/betgaffer\.com\/sitemap-blog\.xml\n$/);
      assert.match(await read(on.ws, 'llms.txt'), /## Blog\n\n- \[Title g1\]\(https:\/\/betgaffer\.com\/blog\/learn\/g1\/\): Card g1/);
      assert.match(await read(on.ws, 'index.html'), /<a href="\/blog\/learn\/">Learn<\/a>/);
      assert.doesNotMatch(await read(on.ws, 'sitemap.xml'), /blog/, 'the main sitemap never lists blog urls');
      for (const rel of ['robots.txt', 'llms.txt', 'index.html', '404.html', 'features/index.html']) {
        assert.doesNotMatch(await read(off.ws, rel), /\/blog\/|Sitemap: .*blog|## Blog/, `off: ${rel}`);
      }
    } finally { await on.done(); await off.done(); }
  });

  test('the footer lists Blog with Learn under it on every page, after Legal and before Contact', async () => {
    const { ws, done } = await buildBlog();
    try {
      for (const rel of ['index.html', 'our-record/index.html', 'waitlist/index.html', '404.html', 'blog/learn/g1/index.html']) {
        const foot = (await read(ws, rel)).match(/<footer\b[\s\S]*?<\/footer>/)[0];
        assert.deepEqual([...foot.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]).slice(0, 6),
          ['/privacy/', '/terms/', '/refunds/', '/blog/', '/blog/learn/', 'mailto:hello@example.com'], rel);
      }
    } finally { await done(); }
  });

  test('head: canonical, robots, titles, og:type, one JSON-LD set per page', async () => {
    const { ws, done } = await buildBlog();
    try {
      const head = async (rel) => (await read(ws, rel)).match(/<head>[\s\S]*<\/head>/)[0];
      const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

      const art = await head('blog/learn/g1/index.html');
      assert.match(art, /<title>Title g1 \| BetGaffer<\/title>/);
      assert.match(art, /<meta name="description" content="Card g1">/);
      assert.match(art, /<link rel="canonical" href="https:\/\/betgaffer\.com\/blog\/learn\/g1\/">/);
      assert.match(art, /<meta name="robots" content="index,follow">/);
      assert.match(art, /<meta property="og:type" content="article">/);
      const [, article, crumbs, org] = ld(art);
      assert.deepEqual(Object.keys(article), ['@context', '@type', 'headline', 'description', 'datePublished', 'dateModified', 'inLanguage', 'mainEntityOfPage', 'author', 'publisher']);
      assert.equal(article['@type'], 'Article');
      assert.deepEqual(article.author, { '@type': 'Organization', name: 'BetGaffer', url: 'https://betgaffer.com/' });
      assert.deepEqual(crumbs.itemListElement.map((i) => [i.position, i.name, i.item]), [
        [1, 'Home', 'https://betgaffer.com/'], [2, 'Blog', 'https://betgaffer.com/blog/'], [3, 'Learn', 'https://betgaffer.com/blog/learn/'], [4, 'Crumb g1', 'https://betgaffer.com/blog/learn/g1/'],
      ]);
      assert.equal(org['@type'], 'Organization');
      assert.match(org.logo, /^https:\/\/betgaffer\.com\/assets\/img\/.+\.png$/);
      assert.deepEqual(org.sameAs, ['https://x.com/betgaffer_', 'https://www.instagram.com/betgaffer_/', 'https://www.threads.com/@betgaffer_']);

      const post = ld(await head('blog/p1/index.html'))[1];
      assert.equal(post['@type'], 'BlogPosting');

      const hub = await head('blog/index.html');
      assert.match(hub, /<title>Blog \| BetGaffer<\/title>/);
      assert.match(hub, /<meta property="og:type" content="website">/);
      const blogLd = ld(hub)[1];
      assert.deepEqual(blogLd.blogPost.map((p) => p.headline), ['Title p2', 'Title p1'], 'posts only, newest first');
      assert.deepEqual(Object.keys(blogLd.blogPost[0]), ['@type', 'headline', 'url', 'dateModified']);

      const learn = ld(await head('blog/learn/index.html'))[1];
      assert.equal(learn['@type'], 'CollectionPage');
      assert.deepEqual(learn.hasPart.map((p) => p.headline), ['Title g1', 'Title g2'], 'file order');
    } finally { await done(); }
  });

  test('article page: crumb, level, toc, next / start-with, keep reading, one founding CTA; planned targets are left off', async () => {
    const { ws, done } = await buildBlog((s) => { s.data.articles[1].next = 'planned'; });
    try {
      const g1 = await read(ws, 'blog/learn/g1/index.html');
      assert.match(g1, /<nav class="lr-crumb" aria-label="Breadcrumb">/);
      assert.match(g1, /<a class="lr-step lr-step--up" href="\/blog\/learn\/g2\/">/);
      assert.doesNotMatch(g1, /Start with/);
      assert.match(g1, /<li><a href="#a">Part A<\/a><\/li>/);
      assert.match(g1, /<h2 id="lr-rel-h">Keep reading<\/h2>/);
      assert.equal((g1.match(/\sdata-banner[\s>]/g) ?? []).length, 1, 'only the site\'s own founding card');
      const g2 = await read(ws, 'blog/learn/g2/index.html');
      assert.match(g2, /Start with<\/span><b class="lr-step__t">Title g1/);
      assert.doesNotMatch(g2, /Planned piece|lr-step--up/, 'a planned next is dropped, never inert');
      assert.equal(await exists(join(ws.out, 'blog/learn/planned/index.html')), false);
      assert.doesNotMatch(await read(ws, 'blog/learn/index.html') + await read(ws, 'sitemap-blog.xml'), /Planned piece|planned/);
    } finally { await done(); }
  });

  test('a piece in the wrong section has no file; a stale one is noindex, noted, off the sitemap and feed but on the hubs', async () => {
    const { ws, done } = await buildBlog((s) => { s.data.articles[3].checked = '2026-08-05'; }); // 99 days
    try {
      assert.equal(await exists(join(ws.out, 'blog/learn/p1/index.html')), false);
      assert.equal(await exists(join(ws.out, 'blog/g1/index.html')), false);
      const stale = await read(ws, 'blog/p2/index.html');
      assert.match(stale, /<meta name="robots" content="noindex,follow">/);
      assert.match(stale, /<link rel="canonical" href="https:\/\/betgaffer\.com\/blog\/p2\/">/);
      assert.match(stale, /<p class="lr-stale" role="note">We last checked this page on 5 August 2026\. Some details may have changed since\.<\/p><section/);
      assert.doesNotMatch(await read(ws, 'sitemap-blog.xml'), /blog\/p2\//);
      assert.doesNotMatch(await read(ws, 'blog/feed.xml'), /blog\/p2\//);
      assert.doesNotMatch(await read(ws, 'llms.txt'), /blog\/p2\//);
      assert.match(await read(ws, 'blog/index.html'), /href="\/blog\/p2\/"/);
    } finally { await done(); }
  });

  test('sitemap-blog.xml order and lastmod; feed newest first; two builds are byte-identical', async () => {
    const a = await buildBlog();
    const b = await buildBlog(() => {}, { now: NOW + 3 * 3600 * 1000 });
    try {
      const sm = await read(a.ws, 'sitemap-blog.xml');
      assert.deepEqual([...sm.matchAll(/<loc>([^<]*)<\/loc><lastmod>([^<]*)<\/lastmod>/g)].map((m) => [m[1].replace('https://betgaffer.com', ''), m[2]]), [
        ['/blog/', '2026-11-05'], ['/blog/learn/', '2026-11-02'], ['/blog/learn/g1/', '2026-11-02'], ['/blog/learn/g2/', '2026-11-02'], ['/blog/p2/', '2026-11-05'], ['/blog/p1/', '2026-11-03'],
      ]);
      const feed = await read(a.ws, 'blog/feed.xml');
      assert.match(feed, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0">/);
      assert.deepEqual([...feed.matchAll(/<item>\n<title>([^<]*)/g)].map((m) => m[1]), ['Title p2', 'Title p1', 'Title g1', 'Title g2']);
      assert.match(feed, /<guid isPermaLink="true">https:\/\/betgaffer\.com\/blog\/p2\/<\/guid>\n<pubDate>Thu, 05 Nov 2026 00:00:00 GMT<\/pubDate>/);
      for (const rel of ['sitemap-blog.xml', 'blog/feed.xml', 'blog/index.html']) assert.equal(await read(a.ws, rel), await read(b.ws, rel), rel);
    } finally { await a.done(); await b.done(); }
  });

  test('premise: hostile JSON text is escaped in the page and "<" is escaped in JSON-LD', async () => {
    const { ws, done } = await buildBlog((s) => { s.data.articles[0].title = 'A <b>&"x"'; s.data.articles[0].card = 'C <i>'; });
    try {
      const html = await read(ws, 'blog/learn/g1/index.html');
      assert.doesNotMatch(html, /<b>&"x"/);
      assert.match(html, /A &lt;b&gt;&amp;&quot;x&quot;/);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) assert.ok(!m[1].includes('<'));
      assert.ok(html.includes('A \\u003cb>'));
    } finally { await done(); }
  });
});

describe('the built blog (committed content, real data)', () => {
  test('pages, receipts, tokens and scanners', async () => {
    const ws = await workspace();
    try {
      const now = Date.parse('2026-11-13T10:00:00Z');
      const r = await build({ root: REPO_ROOT, out: ws.out, config: testConfig(), now, warn: () => {} });
      for (const rel of ['blog/index.html', 'blog/learn/index.html', 'blog/learn/asian-handicap-0/index.html', 'blog/learn/draw-no-bet/index.html',
        'blog/how-to-check-us/index.html', 'sitemap-blog.xml', 'blog/feed.xml']) assert.ok(await exists(join(ws.out, rel)), rel);
      assert.ok(r.routes.includes('/blog/how-to-check-us/'));

      const check = await read(ws, 'blog/how-to-check-us/index.html');
      assert.ok(check.includes('<p class="lr-ans">Since 8 October 2026 every day\'s card shows its receipt code.</p>'));
      assert.doesNotMatch(check, /don't show a receipt code here/);
      assert.match(check, /<a href="\/day\/2026-11-12\/">on the page<\/a>/);
      assert.match(check, /<a href="\/our-record\/">Our Record<\/a>/);
      assert.doesNotMatch(check, /\{\{/);
      assert.equal(await exists(join(ws.out, 'day/2026-11-12/index.html')), true, 'the receipt link lands on a page that exists');

      const { data } = await readBlog(REAL_BLOG);
      const pages = ['blog/index.html', 'blog/learn/index.html', ...data.articles.filter((a) => a.published && a.published <= TODAY)
        .map((a) => `${pathOf(a).slice(1)}index.html`)];
      assert.ok(pages.length >= 5, 'premise: every live guide and post is scanned');
      for (const rel of pages) {
        const html = await read(ws, rel);
        assert.doesNotThrow(() => parse(html), rel);
        assert.deepEqual(cspViolations(html), [], rel);
        // The charter's figure rules guard the site's own claims (rings, records, offers). A guide's worked examples
        // ("a 1.50 price implies 67%", "add up to more than 100%") are Legal-cleared teaching copy, so the figure rules
        // run on the page with the blog's content removed; banned phrases still run on every word.
        assert.deepEqual(claimViolations(html.replace(/<div class="lr">[\s\S]*<\/div>(?=\s*<\/main>)/, '')), [], rel);
        assert.deepEqual(findBanned(visibleText(html)), [], rel);
        assert.deepEqual(bareCounts(html), [], rel);
        assert.doesNotMatch(html, /github/i, rel);
        const links = [...html.matchAll(/<a [^>]*href="(\/[^"#]*)/g)].map((m) => m[1]);
        for (const href of links) assert.ok(await exists(join(ws.out, href.endsWith('/') ? `${href}index.html` : href)), `${rel}: ${href} exists`);
        const doc = parse(html);
        for (const u of findAll(doc, (n) => n.tag === 'use')) assert.ok(html.includes(`id="${u.attrs.href.slice(1)}"`), `${rel}: sprite has ${u.attrs.href}`);
      }
    } finally { await ws.cleanup(); }
  });
});
