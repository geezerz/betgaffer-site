// Page shell: <head>, header + nav, the founding card, <main>, footer. BUILD ONLY (never shipped to the browser).
//
// CSP contract (plan S4, Task 2): the shell emits no inline <script> body, no <style> element and no
// style= attribute. Scripts are external module scripts on same-origin root-relative paths only, plus
// the one classic first-paint guard (EARLY_SCRIPT) on pages with the founding card.
// Every interpolated value goes through escHtml / escAttr.

import { escHtml, escAttr } from './esc.js';
import { lagosToday } from './time.js';
import { fmtInt } from './num.js';
import { requireOperator } from '../config.js';
import { rcNumber } from '../content/common.js';
import { TOTAL_PLACES, variantFor } from './founding.js';
import { foundingCard } from '../content/waitlist.js';

/**
 * Primary navigation, in display order. `section: true` makes every page under the item's path
 * current too (the founding waitlist's result pages, spec §2); `cls` is the item's own class.
 */
export const NAV = Object.freeze([
  Object.freeze({ href: '/', label: 'Predictions' }),
  Object.freeze({ href: '/our-record/', label: 'Our Record' }),
  Object.freeze({ href: '/features/', label: 'Features' }),
  Object.freeze({ href: '/waitlist/', label: 'Founding', cls: 'bg-topbar__founding', section: true }),
]);

/** The founding card's script (dismiss + variant rotation): the FIRST module script on every page with the card. */
export const BANNER_SCRIPT = '/assets/js/banner.js';
/**
 * The card's first-paint guard: the site's ONE classic (non-module), synchronous script, in <head>
 * before the stylesheet on every page with the card. It marks <html> for a visitor who dismissed the
 * card, so the card never paints and then disappears (zero layout shift). Only where the card is: on
 * /waitlist/* it would be a render-blocking request with nothing to hide.
 */
export const EARLY_SCRIPT = '/assets/js/early.js';
/** The small-screen menu's script (spec §16.3): on EVERY page, right after banner.js (or first). */
export const NAV_SCRIPT = '/assets/js/nav.js';
/** Restores today's tab row below 600 px when scripting is off; linked inside <noscript>, never in site.css. */
export const NOJS_CSS = '/assets/css/nojs.css';

/** The founding Open Graph image (1200x630, generated once and committed) and its alt text. */
export const OG_FOUNDING = '/assets/img/og-founding.png';
/** Social-preview images (SEO 2026-10-20), one per page family; dimensions are each image's real
 *  pixel size (never 1200x630 by assumption -- page() takes ogImageWidth/ogImageHeight per image). */
export const OG_HOME = '/assets/img/og-home.jpg';
export const OG_DAY = '/assets/img/og-day.jpg';
export const OG_RECORD = '/assets/img/og-record.jpg';
export const OG_FEATURES = '/assets/img/og-features.jpg';
export const OG_DEFAULT = '/assets/img/og-default.jpg';
export const OG_DIMENSIONS = Object.freeze({
  [OG_HOME]: Object.freeze({ width: 1424, height: 752 }),
  [OG_DAY]: Object.freeze({ width: 1584, height: 672 }),
  [OG_RECORD]: Object.freeze({ width: 1584, height: 672 }),
  [OG_FEATURES]: Object.freeze({ width: 1584, height: 672 }),
  [OG_DEFAULT]: Object.freeze({ width: 1584, height: 672 }),
});
/**
 * JSON-LD (SEO 2026-10-19): the site's own identity only -- name and url, nothing per-page, so it
 * never needs the claim/commitment guards the page's visible copy goes through. One fixed object,
 * never built from `config`: site-wide identity, not per-page data (page() still takes a `config`
 * for everything else; this is the one exception). Exported so build.mjs can pin the CSP script-src
 * hash to this EXACT content (the shell's own no-inline-script rule, plan S4 Task 2, admits no
 * exception without one) -- change this object and the pinned hash test fails until both are
 * updated together.
 */
export const JSON_LD_SITE = Object.freeze({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Bet Gaffer', url: 'https://betgaffer.com/' });
/** The exact <script type="application/ld+json"> text content every page carries. */
export const JSON_LD_CONTENT = JSON.stringify(JSON_LD_SITE).replace(/</g, '\\u003c');
const OG_ALT = Object.freeze({
  [OG_FOUNDING]: `Bet Gaffer: become a founding member. ${fmtInt(TOTAL_PLACES)} places.`,
  [OG_HOME]: 'Bet Gaffer: football match predictions, probability by probability.',
  [OG_DAY]: "Bet Gaffer: today's recommended picks, each with its probability.",
  [OG_RECORD]: 'Bet Gaffer: Our Record, graded pick accuracy over time.',
  [OG_FEATURES]: 'Bet Gaffer: tools for checking and tracking your slips.',
  [OG_DEFAULT]: 'Bet Gaffer.',
});
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const LEGAL = Object.freeze([
  ['/privacy/', 'Privacy'],
  ['/terms/', 'Terms'],
  ['/refunds/', 'Refunds'],
]);

export const NOT_A_BOOKMAKER = 'Bet Gaffer is football match intelligence. We are not a bookmaker: '
  + 'we take no bets, hold no stakes and pay no winnings.';

// A site path: root-relative, never protocol-relative, no quotes/spaces/markup.
const PATH_RE = /^\/[A-Za-z0-9._~/-]*$/;
// A script: a same-origin root-relative .js module path.
const SCRIPT_RE = /^\/[A-Za-z0-9._~/-]+\.js$/;
// A social preview image: a same-origin root-relative raster (scrapers do not render SVG).
const OG_IMAGE_RE = /\.(?:png|jpe?g)$/;
// A data-* name: lower camelCase or kebab-case identifier (generatedAt / generated-at).
const DATA_KEY_RE = /^[a-z][a-zA-Z0-9]*(?:-[a-z0-9]+)*$/;

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

function checkPath(p, what) {
  // '.' and '..' segments are rejected: URL resolution would rewrite them, so the canonical URL and
  // aria-current would name a page other than the one being rendered.
  if (typeof p !== 'string' || !PATH_RE.test(p) || p.includes('//')
    || p.split('/').some((seg) => seg === '.' || seg === '..')) {
    throw new TypeError(`page: ${what} must be a root-relative site path, got ${JSON.stringify(p)}`);
  }
}

function dataAttrs(mainData) {
  if (mainData === null || typeof mainData !== 'object' || Array.isArray(mainData)) {
    throw new TypeError('page: mainData must be a plain object');
  }
  let out = '';
  const seen = new Map(); // data-* name -> the key that produced it
  for (const [key, value] of Object.entries(mainData)) {
    if (!DATA_KEY_RE.test(key)) throw new TypeError(`page: mainData key ${JSON.stringify(key)} is not a plain identifier`);
    const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    // Checked before the null skip: {generatedAt, 'generated-at'} is ambiguous whichever side is set.
    if (seen.has(name)) {
      throw new TypeError(`page: mainData keys ${JSON.stringify(seen.get(name))} and ${JSON.stringify(key)} `
        + `both map to data-${name}`);
    }
    seen.set(name, key);
    if (value === null || value === undefined) continue; // absent fact: omit the attribute entirely
    out += ` data-${name}="${escAttr(value)}"`; // escAttr throws TypeError on a non-scalar
  }
  return out;
}

/** 1000 -> '1,000' (deterministic: never the host locale). */

/**
 * Is this nav item the current page? An exact match, or — for a `section` item whose href ends in
 * '/' — any page under it ('/waitlist/' lights '/waitlist/thanks/', never '/waitlisted/'). Only
 * section items match by prefix: '/' (Predictions) would otherwise be current on every page.
 */
export function navCurrent({ href, section }, path) {
  return path === href || (section === true && href.endsWith('/') && path.startsWith(href));
}

/**
 * The topbar (spec §2, §16.3). Below 600 px the CSS default is the wordmark and a ☰ button; the
 * panel (#bg-nav-panel: the four nav links, then the legal links in their own list) opens below the
 * bar. nav.js only opens and closes it. Without JS, nojs.css (in <noscript>) restores the tab row.
 * From 600 px the panel is display:contents, so the nav sits inline exactly as before, and the
 * button and the legal list are not displayed.
 */
function header(path) {
  const items = NAV.map((item) => {
    const { href, label, cls } = item;
    const current = navCurrent(item, path) ? ' aria-current="page"' : '';
    const klass = cls ? ` class="${escAttr(cls)}"` : '';
    return `<li><a href="${escAttr(href)}"${klass}${current}>${escHtml(label)}</a></li>`;
  }).join('');
  const legal = LEGAL.map(([href, label]) => `<li><a href="${escAttr(href)}">${escHtml(label)}</a></li>`).join('');
  return `<a class="bg-skip" href="#main">Skip to content</a>
<header class="bg-topbar">
<div class="bg-topbar__in">
<a class="bg-wordmark" href="/" aria-label="Bet Gaffer — home">Bet<em>Gaffer</em></a>
<button class="bg-burger" type="button" aria-expanded="false" aria-controls="bg-nav-panel"><span class="bg-burger__bars" aria-hidden="true"></span><span class="vh">Menu</span></button>
<div class="bg-topbar__panel" id="bg-nav-panel">
<nav class="bg-topbar__nav" aria-label="Primary"><ul role="list">${items}</ul></nav>
<ul class="bg-topbar__legal" role="list" aria-label="Legal">${legal}</ul>
</div>
</div>
</header>`;
}

function footer(op, year) {
  const legal = LEGAL.map(([href, label]) => `<li><a href="${escAttr(href)}">${escHtml(label)}</a></li>`).join('');
  const ident = [
    `© ${escHtml(year)} ${escHtml(op.legal_name)}`,
    rcNumber(op) ? `RC ${escHtml(rcNumber(op))}` : '', // the config may already carry the "RC" prefix
    escHtml(op.address),
  ].filter(Boolean).join(' · ');
  return `<footer class="bg-foot">
<div class="bg-wrap bg-foot__in">
<div class="bg-foot__brand">
<p class="bg-wordmark bg-foot__mark" aria-hidden="true">Bet<em>Gaffer</em></p>
<p class="bg-foot__statement">${escHtml(NOT_A_BOOKMAKER)}</p>
<p class="bg-foot__receipts">Every pick is made before kickoff and carries a receipt code. A pick this site listed after kickoff is recorded with its listing time and counted with its real grade.</p>
<p class="bg-foot__age"><span class="bg-age">18+</span><span>For adults aged 18 and over.</span></p>
</div>
<nav class="bg-foot__col" aria-label="Legal">
<h2 class="t-lbl t-lbl--quiet">Legal</h2>
<ul role="list">${legal}</ul>
</nav>
<div class="bg-foot__col">
<h2 class="t-lbl t-lbl--quiet">Contact</h2>
<p><a href="mailto:${escAttr(op.contact_email)}">${escHtml(op.contact_email)}</a></p>
</div>
<p class="bg-foot__legal mono">${ident}</p>
</div>
</footer>`;
}

/**
 * A full HTML document.
 *
 * @param {object} o
 * @param {string} o.path         site path of this page ('/', '/our-record/', '/day/2026-10-08/', '/404.html')
 * @param {string} o.title        page title; rendered as "<title> — Bet Gaffer"
 * @param {string} o.description  meta + Open Graph description
 * @param {string} o.body         trusted, already-escaped HTML fragment placed in <main>
 * @param {string[]} [o.scripts]  same-origin module script paths
 * @param {boolean} [o.noindex]  robots noindex; such a page also omits canonical and og:url
 * @param {string} [o.canonicalPath]  site path the canonical/og:url name instead of `path` (e.g. the
 *                                day page of the card the home page shows -> '/')
 * @param {object} [o.mainData]   { key: scalar } -> data-* attributes on <main>; null/undefined omitted
 * @param {object} o.config       site config, REQUIRED (the build passes site/config.js explicitly);
 *                                operator identity, repo and origin are validated by requireOperator
 * @param {number} [o.year]       copyright year (default: the current Lagos year)
 * @param {boolean} [o.banner]    the founding card under the header (spec §16.5; default true; false
 *                                on /waitlist/ and its result pages). Its static copy is
 *                                VARIANTS[variantFor(path)] (PAGE_VARIANTS for the fixed pages, the
 *                                path hash for dated ones), so different pages carry different copy
 *                                without JS; true also loads early.js (classic, in <head>) and
 *                                banner.js as the first module script
 * @param {string} [o.ogImage]    site path of a PNG/JPEG -> og:image (absolute, from config.origin)
 *                                + og:image:width/height/alt
 * @param {string} [o.ogImageAlt] og:image:alt; defaults to the known alt of OG_FOUNDING, required
 *                                for any other image
 * @param {number} [o.ogImageWidth]  the image's real pixel width; defaults to OG_DIMENSIONS[ogImage],
 *                                 else 1200 (OG_FOUNDING's own); required for any other image
 * @param {number} [o.ogImageHeight] as ogImageWidth, default 630
 */
export function page({
  path, title, description, body, scripts = [], noindex = false, mainData = {},
  config, year, canonicalPath, banner: withBanner = true, ogImage, ogImageAlt, ogImageWidth, ogImageHeight,
} = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('page: config is required (pass the site config object explicitly)');
  }
  checkPath(path, 'path');
  if (canonicalPath !== undefined) checkPath(canonicalPath, 'canonicalPath');
  if (!nonEmpty(title)) throw new TypeError('page: title must be a non-empty string');
  if (!nonEmpty(description)) throw new TypeError('page: description must be a non-empty string');
  if (typeof body !== 'string') throw new TypeError('page: body must be an HTML string');
  if (!Array.isArray(scripts)) throw new TypeError('page: scripts must be an array of paths');
  scripts.forEach((s, i) => {
    if (typeof s !== 'string' || !SCRIPT_RE.test(s) || s.includes('//')) {
      throw new TypeError(`page: scripts[${i}] must be a same-origin root-relative .js path, got ${JSON.stringify(s)}`);
    }
  });
  if (typeof noindex !== 'boolean') throw new TypeError('page: noindex must be a boolean');
  if (typeof withBanner !== 'boolean') throw new TypeError('page: banner must be a boolean');
  let ogAlt = null;
  if (ogImage !== undefined) {
    checkPath(ogImage, 'ogImage');
    if (!OG_IMAGE_RE.test(ogImage)) throw new TypeError(`page: ogImage must be a .png or .jpg path, got ${JSON.stringify(ogImage)}`);
    ogAlt = ogImageAlt ?? (Object.hasOwn(OG_ALT, ogImage) ? OG_ALT[ogImage] : undefined);
    if (!nonEmpty(ogAlt)) throw new TypeError(`page: ogImageAlt is required for ${ogImage}`);
    const known = OG_DIMENSIONS[ogImage];
    ogImageWidth ??= known?.width ?? OG_WIDTH;
    ogImageHeight ??= known?.height ?? OG_HEIGHT;
    for (const [k, v] of [['ogImageWidth', ogImageWidth], ['ogImageHeight', ogImageHeight]]) {
      if (!Number.isInteger(v) || v <= 0) throw new TypeError(`page: ${k} must be a positive integer, got ${JSON.stringify(v)}`);
    }
  }
  // Throws naming every missing operator field (plan S8), then every malformed contact_email,
  // privacy_email, repo or origin. The emails and origin land in href attributes below; repo is
  // validated but never rendered (spec §10: no page links or names the repository).
  const op = requireOperator(config);
  const y = year === undefined ? Number(lagosToday().slice(0, 4)) : year;
  if (!Number.isInteger(y)) throw new TypeError('page: year must be an integer');

  const fullTitle = `${title} — ${config.brand || 'Bet Gaffer'}`;
  const url = config.origin + (canonicalPath ?? path);
  // banner.js first, so a dismissed card is removed before any other module runs (spec §2); then
  // nav.js on every page (spec §16.3); then the page's own scripts. Each at most once.
  const own = scripts.filter((s) => s !== BANNER_SCRIPT && s !== NAV_SCRIPT);
  const allScripts = [...(withBanner ? [BANNER_SCRIPT] : []), NAV_SCRIPT, ...own];
  const scriptTags = allScripts.map((s) => `<script type="module" src="${escAttr(s)}"></script>`).join('\n');
  const ogImageTags = ogImage === undefined ? '' : `<meta property="og:image" content="${escAttr(config.origin + ogImage)}">
<meta property="og:image:width" content="${ogImageWidth}">
<meta property="og:image:height" content="${ogImageHeight}">
<meta property="og:image:alt" content="${escAttr(ogAlt)}">
`;
  // Twitter Card: the same title/description/image as Open Graph above, never typed twice.
  const twitterTags = `<meta name="twitter:card" content="${ogImage === undefined ? 'summary' : 'summary_large_image'}">
<meta name="twitter:title" content="${escAttr(fullTitle)}">
<meta name="twitter:description" content="${escAttr(description)}">
${ogImage === undefined ? '' : `<meta name="twitter:image" content="${escAttr(config.origin + ogImage)}">\n<meta name="twitter:image:alt" content="${escAttr(ogAlt)}">\n`}`;
  const jsonLd = `<script type="application/ld+json">${JSON_LD_CONTENT}</script>\n`;

  return `<!doctype html>
<html lang="en-NG">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(fullTitle)}</title>
<meta name="description" content="${escAttr(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${escAttr(url)}">`}
<meta name="theme-color" content="#0B1017">
<meta name="color-scheme" content="dark">
<meta name="format-detection" content="telephone=no">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/jetbrains-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
${withBanner ? `<script src="${escAttr(EARLY_SCRIPT)}"></script>\n` : ''}<link rel="stylesheet" href="/assets/css/site.css">
<noscript><link rel="stylesheet" href="${escAttr(NOJS_CSS)}"></noscript>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escAttr(config.brand || 'Bet Gaffer')}">
<meta property="og:title" content="${escAttr(fullTitle)}">
<meta property="og:description" content="${escAttr(description)}">
${noindex ? '' : `<meta property="og:url" content="${escAttr(url)}">\n`}${ogImageTags}${twitterTags}${jsonLd}${scriptTags ? `${scriptTags}\n` : ''}</head>
<body>
${header(path)}
${withBanner ? `${foundingCard(variantFor(path))}\n` : ''}<main id="main" class="bg-wrap bg-page" tabindex="-1"${dataAttrs(mainData)}>
<div class="stale" role="status" hidden></div>
${body}
</main>
${footer(op, y)}
</body>
</html>
`;
}
