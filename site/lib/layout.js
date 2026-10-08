// Page shell: <head>, header + nav, the founding banner, <main>, footer. BUILD ONLY (never shipped to the browser).
//
// CSP contract (plan S4, Task 2): the shell emits no inline <script> body, no <style> element and no
// style= attribute. Scripts are external module scripts on same-origin root-relative paths only.
// Every interpolated value goes through escHtml / escAttr.

import { escHtml, escAttr } from './esc.js';
import { lagosToday } from './time.js';
import { requireOperator } from '../config.js';
import { rcNumber } from '../content/common.js';
import { TOTAL_PLACES, WAITLIST_PLACES, LAUNCH_PLACES, DISCOUNT_PCT } from './founding.js';

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

/** The founding banner's own script: the FIRST module script on every page that carries the banner. */
export const BANNER_SCRIPT = '/assets/js/banner.js';

/** The founding Open Graph image (1200x630, generated once and committed) and its alt text. */
export const OG_FOUNDING = '/assets/img/og-founding.png';
const OG_ALT = Object.freeze({ [OG_FOUNDING]: `Bet Gaffer: become a founding member. ${thousands(TOTAL_PLACES)} places.` });
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
function thousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); } // hoisted: OG_ALT uses it

/**
 * The sitewide founding banner (spec §2). The numbers come from founding.js; the offer percentage
 * sits in a data-figure="offer" element (the claim guard allows it nowhere else). The close button
 * is hidden until banner.js runs: without JS the banner shows and cannot be closed.
 */
function banner() {
  return `<aside class="bg-banner" aria-label="Founding members" data-banner>
<div class="bg-wrap bg-banner__in">
<p><strong>Founding members:</strong> ${escHtml(thousands(TOTAL_PLACES))} places — ${escHtml(thousands(WAITLIST_PLACES))} on the waitlist, ${escHtml(thousands(LAUNCH_PLACES))} at launch · <span data-figure="offer">${escHtml(DISCOUNT_PCT)}% off every subscription payment while you subscribe</span> · <a href="/waitlist/">See the benefits →</a></p>
<button type="button" class="bg-banner__x" data-banner-close aria-label="Hide the founding banner" hidden>×</button>
</div>
</aside>`;
}

/**
 * Is this nav item the current page? An exact match, or — for a `section` item whose href ends in
 * '/' — any page under it ('/waitlist/' lights '/waitlist/thanks/', never '/waitlisted/'). Only
 * section items match by prefix: '/' (Predictions) would otherwise be current on every page.
 */
export function navCurrent({ href, section }, path) {
  return path === href || (section === true && href.endsWith('/') && path.startsWith(href));
}

function header(path) {
  const items = NAV.map((item) => {
    const { href, label, cls } = item;
    const current = navCurrent(item, path) ? ' aria-current="page"' : '';
    const klass = cls ? ` class="${escAttr(cls)}"` : '';
    return `<li><a href="${escAttr(href)}"${klass}${current}>${escHtml(label)}</a></li>`;
  }).join('');
  return `<a class="bg-skip" href="#main">Skip to content</a>
<header class="bg-topbar">
<div class="bg-topbar__in">
<a class="bg-wordmark" href="/" aria-label="Bet Gaffer — home">Bet<em>Gaffer</em></a>
<nav class="bg-topbar__nav" aria-label="Primary"><ul role="list">${items}</ul></nav>
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
<p class="bg-foot__receipts">Every pick on a published card is frozen before kickoff and carries a receipt code.</p>
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
 * @param {boolean} [o.banner]    the founding banner under the header (default true; false on
 *                                /waitlist/ and its result pages, spec §2); true also loads
 *                                banner.js as the first module script
 * @param {string} [o.ogImage]    site path of a 1200x630 PNG/JPEG -> og:image (absolute, from
 *                                config.origin) + og:image:width/height/alt
 * @param {string} [o.ogImageAlt] og:image:alt; defaults to the known alt of OG_FOUNDING, required
 *                                for any other image
 */
export function page({
  path, title, description, body, scripts = [], noindex = false, mainData = {},
  config, year, canonicalPath, banner: withBanner = true, ogImage, ogImageAlt,
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
  }
  // Throws naming every missing operator field (plan S8), then every malformed contact_email,
  // privacy_email, repo or origin. The emails and origin land in href attributes below; repo is
  // validated but never rendered (spec §10: no page links or names the repository).
  const op = requireOperator(config);
  const y = year === undefined ? Number(lagosToday().slice(0, 4)) : year;
  if (!Number.isInteger(y)) throw new TypeError('page: year must be an integer');

  const fullTitle = `${title} — ${config.brand || 'Bet Gaffer'}`;
  const url = config.origin + (canonicalPath ?? path);
  // banner.js first, so a dismissed banner is removed before any other module runs (spec §2).
  const allScripts = withBanner ? [BANNER_SCRIPT, ...scripts.filter((s) => s !== BANNER_SCRIPT)] : scripts;
  const scriptTags = allScripts.map((s) => `<script type="module" src="${escAttr(s)}"></script>`).join('\n');
  const ogImageTags = ogImage === undefined ? '' : `<meta property="og:image" content="${escAttr(config.origin + ogImage)}">
<meta property="og:image:width" content="${OG_WIDTH}">
<meta property="og:image:height" content="${OG_HEIGHT}">
<meta property="og:image:alt" content="${escAttr(ogAlt)}">
`;

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
<link rel="stylesheet" href="/assets/css/site.css">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escAttr(config.brand || 'Bet Gaffer')}">
<meta property="og:title" content="${escAttr(fullTitle)}">
<meta property="og:description" content="${escAttr(description)}">
${noindex ? '' : `<meta property="og:url" content="${escAttr(url)}">\n`}${ogImageTags}${scriptTags ? `${scriptTags}\n` : ''}</head>
<body>
${header(path)}
${withBanner ? `${banner()}\n` : ''}<main id="main" class="bg-wrap bg-page" tabindex="-1"${dataAttrs(mainData)}>
<div class="stale" role="status" hidden></div>
${body}
</main>
${footer(op, y)}
</body>
</html>
`;
}
