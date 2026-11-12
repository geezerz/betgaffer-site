// The blog + Learn section: content/blog (blog.json + one trusted HTML body per article, a byte-exact
// export from the platform) -> validated -> pages, sitemap-blog.xml, feed.xml, the llms.txt section.
// BUILD ONLY. Ported from the platform's blog validator, freshness rules and views.
//
// Structural errors throw (they can only come from a bad export). Freshness NEVER fails a build: the
// site rebuilds every 2 h from live data and a failed build freezes it. A stale piece stays up
// (noindex, with a note); an old one simply stops being rendered. tests/blog.test.js fails on a
// committed piece older than 90 days instead.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { escHtml, escAttr } from './esc.js';
import { OG_DEFAULT } from './layout.js';
import { addDays, isDate } from './time.js';

export const LEVELS = Object.freeze({ beginner: ['Beginner', 1], regular: ['Regular', 2], sharp: ['Sharp', 3] });
export const RECEIPTS_FROM = '2026-10-08';
export const MIN_ARTICLES = 3; // below this the blog does not exist at all
const CHECK_DAYS = 90; // Legal 12 Nov: past this a sourced page is stale; past GONE_DAYS (CHECK_DAYS when strict) it is gone
const GONE_DAYS = 120;
const RESERVED = new Set(['learn', 'media', 'page', 'topic', 'feed.xml']);
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** {{link:KEY:Label}} targets on this site; any other KEY renders inert. */
const LINKS = Object.freeze({ record: '/our-record/', features: '/features/', terms: '/terms/', privacy: '/privacy/', refunds: '/refunds/' });
const PUBLISHER = Object.freeze({ '@type': 'Organization', name: 'BetGaffer', url: 'https://betgaffer.com/' });
const SAME_AS = Object.freeze(['https://x.com/betgaffer_', 'https://www.instagram.com/betgaffer_/', 'https://www.threads.com/@betgaffer_']);

const dateParts = (d) => d.split('-').map(Number);
/** 'YYYY-MM-DD' -> '12 November 2026' (long) or '12 Nov 2026'. */
export const fmtLong = (d) => { const [y, m, n] = dateParts(d); return `${n} ${MON[m - 1]} ${y}`; };
export const fmtShort = (d) => { const [y, m, n] = dateParts(d); return `${n} ${MON[m - 1].slice(0, 3)} ${y}`; };
const utcMs = (d) => { const [y, m, n] = dateParts(d); return Date.UTC(y, m - 1, n); };
const ageDays = (from, to) => Math.round((utcMs(to) - utcMs(from)) / 86400000);

/** 'fresh' | 'stale' | 'gone' by the age of `checked`; a piece with neither checked nor source is always fresh. */
export function freshness(a, today) {
  if (a.checked === undefined && a.source === undefined) return 'fresh';
  const days = a.checked === undefined ? Infinity : ageDays(a.checked, today);
  return days <= CHECK_DAYS ? 'fresh' : days > (a.strict ? CHECK_DAYS : GONE_DAYS) ? 'gone' : 'stale';
}

export const pathOf = (a) => `${a.section === 'learn' ? '/blog/learn/' : '/blog/'}${a.slug}/`;

/** Read content/blog. null when there is no blog.json; throws on unparsable JSON. */
export async function readBlog(dir) {
  let raw;
  try { raw = await readFile(join(dir, 'blog.json'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error(`blog.json: ${e.message}`); }
  const bodies = {};
  for (const a of data.articles ?? []) {
    if (a.published === undefined || typeof a.slug !== 'string') continue;
    try { bodies[a.slug] = await readFile(join(dir, `${a.slug}.html`), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { data, bodies };
}

/** The publish rules (the platform's publish rules + this site's CSP/safety checks); [] = the content may ship. */
export function blogErrors({ data, bodies }) {
  const err = [];
  if (!Array.isArray(data.articles)) return ['blog.json: articles must be a list'];
  const list = data.articles;
  const by = new Map();
  for (const a of list) {
    if (by.has(a.slug)) err.push(`duplicate slug: ${a.slug}`);
    by.set(a.slug, a);
  }
  const rank = (a) => LEVELS[a?.level]?.[1] ?? 0;
  for (const a of list) {
    const id = a.slug;
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) err.push(`${id}: slug must be lower-case letters, digits and hyphens`);
    else if (RESERVED.has(id)) err.push(`${id}: reserved slug`);
    if (a.section !== 'learn' && a.section !== 'blog') err.push(`${id}: section must be learn or blog`);
    if (!Object.hasOwn(data.categories ?? {}, a.cat)) err.push(`${id}: unknown topic`);
    if (rank(a) === 0) err.push(`${id}: level must be beginner, regular or sharp`);
    if (typeof a.title !== 'string' || a.title.trim() === '') err.push(`${id}: no title`);
    for (const [k, step] of [['next', 1], ['start_with', -1]]) {
      if (a[k] === undefined) continue;
      const t = by.get(a[k]);
      if (!t) err.push(`${id}: ${k} points at a missing article`);
      else if (rank(t) !== rank(a) + step) err.push(`${id}: ${k} must be one level ${step > 0 ? 'up' : 'down'}`);
    }
    if (a.published === undefined) continue;
    for (const k of ['crumb', 'dek', 'card', 'updated', 'minutes', 'toc']) {
      if (!a[k] || (k === 'toc' && Object.keys(a.toc).length === 0)) err.push(`${id}: published without ${k}`);
    }
    for (const k of ['published', 'updated', 'checked']) {
      if (a[k] !== undefined && !isDate(a[k])) err.push(`${id}: ${k} is not a YYYY-MM-DD date`);
    }
    const body = bodies[id];
    if (body === undefined) { err.push(`${id}: no body file ${id}.html`); continue; }
    for (const h of Object.keys(a.toc ?? {})) if (!body.includes(`id="${h}"`)) err.push(`${id}: contents entry '${h}' has no heading`);
    const plain = `${body.replace(/<[^>]*>/g, ' ')} ${a.title} ${a.dek} ${a.card}`;
    const word = /\b(sure|safe)\b/i.exec(plain);
    if (word) err.push(`${id}: uses "${word[1]}"`);
    // The site's CSP admits no inline style, script or handler, and no image from outside /blog/media/.
    if (/<[^>]*\sstyle\s*=/i.test(body)) err.push(`${id}: body has a style= attribute`);
    if (/<script/i.test(body)) err.push(`${id}: body has a <script>`);
    if (/<[^>]*\son[a-z]+\s*=/i.test(body)) err.push(`${id}: body has an on*= handler`);
    for (const img of body.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\ssrc\s*=\s*["']\/blog\/media\//i.test(img[0])) err.push(`${id}: <img> src is not under /blog/media/`);
    }
  }
  return err;
}

/**
 * Legal's receipt lines (12 Nov) and the link target. S = first day of the unbroken run of Lagos days
 * ending YESTERDAY that carry a picks_hash, from RECEIPTS_FROM; no receipt yesterday -> no lines.
 * href: the latest listed day up to yesterday (its day page shows the card and its receipt codes).
 * @param {Set<string>} hashed  days whose published data has a picks_hash
 */
export function receipts(hashed, today) {
  const yesterday = addDays(today, -1);
  let since = null;
  for (let d = yesterday; d >= RECEIPTS_FROM && hashed.has(d); d = addDays(d, -1)) since = d;
  const html = since === null ? '' : `<p class="lr-ans">Since ${fmtLong(since)} every day's card shows its receipt code.</p>`
    + (since > RECEIPTS_FROM ? `<p>Cards before ${fmtLong(since)} don't show a receipt code here.</p>` : '');
  const latest = [...hashed].filter((d) => d <= yesterday).sort().at(-1);
  return { html, href: latest ? `/day/${latest}/` : '/' };
}

const level = (key) => {
  const [name, n] = LEVELS[key];
  return `<span class="lr-lvl lr-lvl--${n}"><i aria-hidden="true"><b></b><b></b><b></b></i><span class="visually-hidden">Level: </span>${name}</span>`;
};

function fillBody(a, body, rc) {
  return body
    .replaceAll('{{checked_long}}', a.checked ? fmtLong(a.checked) : '')
    .replaceAll('{{receipt_lines}}', rc.html)
    .replaceAll('{{receipt_href}}', escAttr(rc.href))
    .replace(/\{\{link:(\w+):([^}]+)\}\}/g, (_, key, label) => (Object.hasOwn(LINKS, key)
      ? `<a href="${escAttr(LINKS[key])}">${escHtml(label)}</a>`
      : `<span class="lr-inert" aria-disabled="true">${escHtml(label)}</span>`));
}

// Only the symbols the blog uses; hidden by class (the CSP forbids style=).
const SPRITE = '<svg class="ic-sprite" width="0" height="0" aria-hidden="true"><defs>'
  + '<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>'
  + '<symbol id="i-x" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>'
  + '<symbol id="i-right" viewBox="0 0 24 24"><path d="M9.5 5.5L16 12l-6.5 6.5"/></symbol></defs></svg>';

const crumbNav = (crumbs) => `<nav class="lr-crumb" aria-label="Breadcrumb">${crumbs.map(([label, path], i) => (i ? '<span aria-hidden="true">/</span>' : '')
  + (i === crumbs.length - 1 ? `<span aria-current="page">${escHtml(label)}</span>` : `<a href="${escAttr(path)}">${escHtml(label)}</a>`)).join('')}</nav>`;

/**
 * Everything the build needs, or null when the blog does not exist (no content, or fewer than
 * MIN_ARTICLES live pieces). Throws on structural errors.
 * @param {{data:object,bodies:object}|null} blog  readBlog()
 * @param {string} today   Lagos build day
 * @param {{html:string,href:string}} rc  receipts()
 * @returns {{pages:object[], sitemap:string, feed:string, llms:string}|null}  pages are page() options
 */
export function renderBlog(blog, { today, origin, rc }) {
  if (blog === null) return null;
  const errors = blogErrors(blog);
  if (errors.length) throw new Error(`blog: ${errors.join('; ')}`);
  const { data, bodies } = blog;
  const cats = data.categories;
  const mark = (a) => ({ ...a, state: freshness(a, today) });
  const live = data.articles.filter((a) => a.published !== undefined).map(mark).filter((a) => a.state !== 'gone');
  if (live.length < MIN_ARTICLES) return null;
  const bySlug = new Map(live.map((a) => [a.slug, a]));
  const learn = live.filter((a) => a.section === 'learn');
  const posts = live.filter((a) => a.section === 'blog').sort((x, y) => (x.published < y.published ? 1 : x.published > y.published ? -1 : 0));
  const url = (p) => origin + p;
  const org = { '@context': 'https://schema.org', '@type': 'Organization', name: 'BetGaffer', url: 'https://betgaffer.com/', logo: `${origin}/assets/img/apple-touch-icon.png`, sameAs: SAME_AS };
  const crumbLd = (crumbs) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [['Home', '/'], ...crumbs].map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url(p) })),
  });
  const card = (a) => `<a class="lr-card" href="${escAttr(pathOf(a))}"><span class="lr-card__top"><span class="lr-cat">${escHtml(cats[a.cat])}</span>${level(a.level)}</span>`
    + `<b class="lr-card__t">${escHtml(a.title)}</b><span class="lr-card__p">${escHtml(a.card)}</span>`
    + `<span class="lr-card__f"><span>Updated <time datetime="${escAttr(a.updated)}">${fmtShort(a.updated)}</time> · ${a.minutes} min read</span>`
    + '<svg class="ic ic--s" aria-hidden="true"><use href="#i-right"/></svg></span></a>';
  const cards = (list) => `<div class="lr-cards">${list.map(card).join('')}</div>`;
  const allGuides = '<a class="lr-all" href="/blog/learn/">All guides<svg class="ic ic--xs" aria-hidden="true"><use href="#i-right"/></svg></a>';
  const common = { ogImage: OG_DEFAULT };

  const hub = (section) => {
    const copy = data[section];
    const path = section === 'blog' ? '/blog/' : '/blog/learn/';
    const crumbs = section === 'blog' ? [['Blog', '/blog/']] : [['Blog', '/blog/'], ['Learn', '/blog/learn/']];
    const ld = section === 'blog'
      ? { '@context': 'https://schema.org', '@type': 'Blog', name: copy.h1, url: url(path), blogPost: posts.map((a) => ({ '@type': 'BlogPosting', headline: a.title, url: url(pathOf(a)), dateModified: a.updated })) }
      : { '@context': 'https://schema.org', '@type': 'CollectionPage', name: copy.h1, url: url(path), hasPart: learn.map((a) => ({ '@type': 'Article', headline: a.title, url: url(pathOf(a)) })) };
    let sections = '';
    if (section === 'blog') {
      if (learn.length) sections += `<section aria-labelledby="b-learn"><div class="lr-band__head"><h2 id="b-learn">Learn</h2>${allGuides}</div>${cards(learn.slice(0, 3))}</section>`;
      if (posts.length) sections += `<section aria-labelledby="b-latest"><div class="lr-band__head"><h2 id="b-latest">Latest</h2></div>${cards(posts)}</section>`;
    } else {
      for (const [key, name] of Object.entries(cats)) {
        const inCat = learn.filter((a) => a.cat === key);
        if (inCat.length) sections += `<section class="lr-group" aria-labelledby="c-${escAttr(key)}"><h2 class="lr-group__h" id="c-${escAttr(key)}">${escHtml(name)}<span>${inCat.length}</span></h2>${cards(inCat)}</section>`;
      }
    }
    return {
      path, title: copy.title, fullTitle: copy.title, description: copy.meta, robots: 'index,follow', ogType: 'website', ...common,
      jsonLd: [ld, crumbLd(crumbs), org],
      body: `<div class="lr">${SPRITE}${crumbNav(crumbs)}<header class="lr-hub"><h1 class="lr-t">${escHtml(copy.h1)}</h1><p class="lr-dek">${escHtml(copy.dek)}</p></header>${sections}</div>`,
    };
  };

  const article = (a) => {
    const path = pathOf(a);
    const crumbs = a.section === 'learn' ? [['Blog', '/blog/'], ['Learn', '/blog/learn/'], [a.crumb, path]] : [['Blog', '/blog/'], [a.crumb, path]];
    const toc = `<ol class="lr-tocl">${Object.entries(a.toc).map(([id, t]) => `<li><a href="#${escAttr(id)}">${escHtml(t)}</a></li>`).join('')}</ol>`;
    const step = (dir, k, slug) => {
      const t = slug === undefined ? undefined : bySlug.get(slug);
      return t ? `<a class="lr-step lr-step--${dir}" href="${escAttr(pathOf(t))}"><span class="lr-step__k">${k}</span><b class="lr-step__t">${escHtml(t.title)}</b>${level(t.level)}</a>` : '';
    };
    const next = step('down', 'New to this? Start with', a.start_with) + step('up', 'Next', a.next);
    const rel = learn.filter((r) => r.slug !== a.slug).slice(0, 3);
    const stale = a.state === 'stale'
      ? `<p class="lr-stale" role="note">We last checked this page on ${fmtLong(a.checked)}. Some details may have changed since.</p>` : '';
    const source = a.source === undefined ? ''
      : `<p class="lr-src">${escHtml(a.source).replaceAll('{{checked}}', `<time datetime="${escAttr(a.checked)}">${fmtShort(a.checked)}</time>`)}</p>`;
    const ld = {
      '@context': 'https://schema.org', '@type': a.section === 'learn' ? 'Article' : 'BlogPosting', headline: a.title, description: a.card,
      datePublished: a.published, dateModified: a.updated, inLanguage: 'en-NG', mainEntityOfPage: url(path), author: PUBLISHER, publisher: PUBLISHER,
    };
    return {
      path, title: a.title, fullTitle: `${a.title} | BetGaffer`, description: a.card, robots: a.state === 'stale' ? 'noindex,follow' : 'index,follow', ogType: 'article', ...common,
      jsonLd: [ld, crumbLd(crumbs), org],
      body: `<div class="lr">${SPRITE}${crumbNav(crumbs)}<div class="lr-grid"><article class="lr-art">`
        + `<header class="lr-head"><div class="lr-head__top"><p class="lr-cat">${escHtml(cats[a.cat])}</p>${level(a.level)}</div>`
        + `<h1 class="lr-t">${escHtml(a.h1 ?? a.title)}</h1><p class="lr-dek">${escHtml(a.dek)}</p>`
        + `<p class="lr-meta"><span>Updated <time datetime="${escAttr(a.updated)}">${fmtShort(a.updated)}</time></span><span aria-hidden="true">·</span><span>${a.minutes} min read</span></p></header>`
        + `<details class="lr-toc"><summary>On this page</summary>${toc}</details>${stale}${fillBody(a, bodies[a.slug], rc)}${source}`
        + (next ? `<nav class="lr-path" aria-label="Where to go next">${next}</nav>` : '')
        + `</article><aside class="lr-aside" aria-label="On this page"><p class="lr-aside__h">On this page</p>${toc}</aside></div>`
        + (rel.length ? `<section class="lr-rel" aria-labelledby="lr-rel-h"><div class="lr-rel__head"><h2 id="lr-rel-h">Keep reading</h2>${allGuides}</div>${cards(rel)}</section>` : '')
        + '</div>',
    };
  };

  // sitemap-blog.xml: fresh pieces only (a stale page is noindex), lastmod straight from the data.
  const fresh = (list) => list.filter((a) => a.state === 'fresh');
  const maxUpdated = (list) => list.map((a) => a.updated).sort().at(-1);
  const urls = [
    ['/blog/', maxUpdated(live)],
    ['/blog/learn/', maxUpdated(learn.length ? learn : live)],
    ...[...fresh(learn), ...fresh(posts)].map((a) => [pathOf(a), a.updated]),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map(([p, lm]) => `  <url><loc>${escHtml(url(p))}</loc><lastmod>${lm}</lastmod></url>`).join('\n') + '\n</urlset>\n';

  const newest = fresh(live).sort((x, y) => (x.published < y.published ? 1 : x.published > y.published ? -1 : 0));
  const rfc822 = (d) => { const [y, m, n] = dateParts(d); return `${DOW[new Date(utcMs(d)).getUTCDay()]}, ${String(n).padStart(2, '0')} ${MON[m - 1].slice(0, 3)} ${y} 00:00:00 GMT`; };
  const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n<title>${escHtml(data.blog.title)}</title>\n<link>${url('/blog/')}</link>\n<description>${escHtml(data.blog.meta)}</description>\n<language>en-NG</language>\n`
    + newest.map((a) => `<item>\n<title>${escHtml(a.title)}</title>\n<link>${url(pathOf(a))}</link>\n<guid isPermaLink="true">${url(pathOf(a))}</guid>\n<pubDate>${rfc822(a.published)}</pubDate>\n<description>${escHtml(a.card)}</description>\n</item>\n`).join('')
    + '</channel>\n</rss>\n';
  const llms = `## Blog\n\n${fresh(live).map((a) => `- [${a.title}](${url(pathOf(a))}): ${a.card}\n`).join('')}\n`;

  return { pages: [hub('blog'), hub('learn'), ...live.map(article)], sitemap, feed, llms };
}
