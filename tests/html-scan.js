// A small, dependency-free HTML scanner for the built-site tests (plan Task 6).
//
// parse() builds an element tree from the build's own output and is deliberately STRICT: the
// claim checks below reason about which element a figure sits in, so the tree must be the one a
// browser builds. It throws on a bare '<' in text (an escaping failure), a stray or mismatched
// close tag, an element left open, a block element opened inside a <p> (the browser would close
// the <p> early and the figure would land outside the element the scanner thinks holds it) and a
// link nested in a link.
//
// claimViolations() is spec test 16: banned public-copy phrases (site/lib/claims.js findBanned),
// every percentage in visible text inside an allowed figure, and the charter's 100% rule.
// cspViolations() is the CSP half of test 9's companion: no inline script, no <style>, no style=,
// no inline event handler, no javascript: URL.

import { findBanned } from '../site/lib/claims.js';
import { fmtDayLong, isDate } from '../site/lib/time.js';
import { DISCOUNT_PCT, TOPUP_BONUS_PCT } from '../site/lib/founding.js';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Raw-text elements: their content is text up to the matching close tag.
const RAW = new Set(['script', 'style', 'textarea', 'title']);
// Elements a browser will not nest inside an open <p> (it closes the <p> first).
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu',
  'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
// Inline elements do not separate words in visible text; every other element does.
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'code', 'em', 'i', 'kbd', 'mark', 's', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'u', 'var']);
// Never rendered as text.
const HIDDEN = new Set(['script', 'style', 'template', 'head']);

const OPEN_RE = /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const CLOSE_RE = /<\/([A-Za-z][A-Za-z0-9-]*)\s*>/y;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z]+));/g;

/** Decode the character references the build emits (one pass: "&amp;lt;" stays the text "&lt;"). */
export function decode(s) {
  return s.replace(ENTITY, (whole, dec, hex, name) => {
    if (name !== undefined) return Object.hasOwn(NAMED, name.toLowerCase()) ? NAMED[name.toLowerCase()] : whole;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  });
}

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    const v = m[2] ?? m[3] ?? m[4];
    attrs[name] = v === undefined ? '' : decode(v);
  }
  return attrs;
}

/** Parse an HTML document into { tag:'#root', children } (elements: { tag, attrs, children, parent }; text: { text }). */
export function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  // The 1-based line of offset `at`: the newlines before it, counted incrementally (offsets only
  // grow as the parse advances; re-splitting the document per element was quadratic on a big page).
  let lineNo = 1;
  let nextNl = html.indexOf('\n'); // the first newline not yet counted (-1: none left)
  let counted = 0; // every newline before this offset is in lineNo
  const line = (at) => {
    if (at < counted) { lineNo = 1; nextNl = html.indexOf('\n'); }
    while (nextNl !== -1 && nextNl < at) { lineNo += 1; nextNl = html.indexOf('\n', nextNl + 1); }
    counted = at;
    return lineNo;
  };
  const pushText = (raw) => { if (raw) cur.children.push({ text: decode(raw), parent: cur }); };
  const inStack = (tag) => { for (let n = cur; n; n = n.parent) if (n.tag === tag) return true; return false; };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { pushText(html.slice(i)); break; }
    pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) throw new Error(`html-scan: unterminated comment at line ${line(lt)}`);
      i = end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      if (end === -1) throw new Error(`html-scan: unterminated declaration at line ${line(lt)}`);
      i = end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      CLOSE_RE.lastIndex = lt;
      const m = CLOSE_RE.exec(html);
      if (!m) throw new Error(`html-scan: malformed close tag at line ${line(lt)}`);
      const tag = m[1].toLowerCase();
      if (cur.tag !== tag) {
        throw new Error(`html-scan: </${tag}> at line ${line(lt)} closes <${cur.tag}>${inStack(tag) ? ' (an element was left open)' : ' (no such element is open)'}`);
      }
      cur = cur.parent;
      i = lt + m[0].length;
      continue;
    }
    OPEN_RE.lastIndex = lt;
    const m = OPEN_RE.exec(html);
    if (!m) throw new Error(`html-scan: a bare "<" in text at line ${line(lt)} (escaping failure?): ${JSON.stringify(html.slice(lt, lt + 40))}`);
    const tag = m[1].toLowerCase();
    if (CLOSES_P.has(tag) && inStack('p')) throw new Error(`html-scan: <${tag}> inside an open <p> at line ${line(lt)}`);
    if (tag === 'a' && inStack('a')) throw new Error(`html-scan: <a> inside an <a> at line ${line(lt)}`);
    const el = { tag, attrs: parseAttrs(m[2]), children: [], parent: cur, line: line(lt) };
    cur.children.push(el);
    i = lt + m[0].length;
    if (VOID.has(tag) || m[3] === '/') continue;
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      if (close === -1) throw new Error(`html-scan: <${tag}> at line ${el.line} is never closed`);
      if (close > i) el.children.push({ text: tag === 'title' || tag === 'textarea' ? decode(html.slice(i, close)) : html.slice(i, close), parent: el, raw: true });
      CLOSE_RE.lastIndex = close;
      const c = CLOSE_RE.exec(html);
      if (!c) throw new Error(`html-scan: malformed </${tag}> at line ${line(close)}`);
      i = close + c[0].length;
      continue;
    }
    cur = el;
  }
  if (cur !== root) throw new Error(`html-scan: <${cur.tag}> opened at line ${cur.line} is never closed`);
  return root;
}

/** Every element under node (depth first, node included) for which pred is true. */
export function findAll(node, pred) {
  const out = [];
  const walk = (n) => {
    if (n.tag === undefined) return;
    if (pred(n)) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

export const find = (node, pred) => findAll(node, pred)[0] ?? null;

/** Visible text of an element: inline elements join words, other elements separate them. */
export function textOf(node) {
  const parts = [];
  const walk = (n) => {
    if (n.tag === undefined) { parts.push(n.text); return; }
    if (HIDDEN.has(n.tag)) return;
    const block = !INLINE.has(n.tag);
    if (block) parts.push(' ');
    for (const c of n.children) walk(c);
    if (block) parts.push(' ');
  };
  walk(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** The visible text of a document's <body>. */
export function visibleText(html) {
  const body = find(parse(html), (n) => n.tag === 'body');
  if (!body) throw new Error('html-scan: no <body>');
  return textOf(body);
}

/**
 * Body text as [{ text, el }] segments (el = the text's parent element), with block boundaries as
 * separator segments, so a figure split over inline tags ("8<b>3</b>%") is still one match.
 */
function segments(body) {
  const segs = [];
  const walk = (n) => {
    if (n.tag === undefined) { segs.push({ text: n.text, el: n.parent }); return; }
    if (HIDDEN.has(n.tag)) return;
    const block = !INLINE.has(n.tag);
    if (block) segs.push({ text: ' ', el: null });
    for (const c of n.children) walk(c);
    if (block) segs.push({ text: ' ', el: null });
  };
  walk(body);
  return segs;
}

const ancestors = (el) => { const out = []; for (let n = el; n && n.tag !== '#root'; n = n.parent) out.push(n); return out; };

const PCT_RE = /\d+(?:\.\d+)?%/g;
const pctOf = (s) => Number(s.slice(0, -1));
const ATTR_COPY = ['aria-label', 'title', 'alt'];
// The offer figure's two percentages exactly as written ("30%", "20%"). Compared as strings over
// the whole written number (WRITTEN_RE), so "1,030%", "130%", "030%" or "30.0%" never pass as 30.
const OFFER_WRITTEN = new Set([`${DISCOUNT_PCT}%`, `${TOPUP_BONUS_PCT}%`]);
const WRITTEN_RE = /\d[\d.,]*%/g;
/** The whole number a PCT_RE match at index belongs to, with any digits, "," or "." before it. */
function written(src, index, match) {
  let i = index;
  while (i > 0 && /[\d.,]/.test(src[i - 1])) i -= 1;
  return src.slice(i, index) + match;
}
const FRACTION_RE = /\d[\d,]* of \d[\d,]*/;
const RETRO_RE = /\bso far\b|\bto date\b/i;
const STATED_RE = /\bstated at\b/i;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
// The record headline states its figure plainly (Plan A Task 5, spec §7): the fraction and its
// period. Selection rule, coverage, status and interval are no longer printed.
export const HEADLINE_PARTS = Object.freeze(['period']);

function periodText(p) {
  if (isDate(p)) return fmtDayLong(p);
  const m = /^(\d{4})-(\d{2})$/.exec(p ?? '');
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return null;
}

/**
 * Why an element may hold a percentage (pct: the whole number as written, e.g. "30%"), or null.
 * kinds limits which figures count (null: all of them).
 */
function allowedBy(el, pct, kinds = null) {
  const why = figureOf(el, pct);
  return why !== null && (kinds === null || kinds.includes(why)) ? why : null;
}

function figureOf(el, pct) {
  const fig = el.attrs['data-figure'];
  if (fig === 'pick-prob') return 'pick-prob';
  // The founding offer (Plan A Task 1b): the percentage itself, and every percentage in the
  // figure's visible text, is one of the programme's two numbers. One wrong value licenses none.
  if (fig === 'offer') {
    return OFFER_WRITTEN.has(pct) && [...textOf(el).matchAll(WRITTEN_RE)].every((m) => OFFER_WRITTEN.has(m[0])) ? 'offer' : null;
  }
  if (fig === 'ring') return FRACTION_RE.test(textOf(el)) ? 'ring' : null;
  if (fig === 'record-row') {
    const t = textOf(el);
    const p = periodText(el.attrs['data-period']);
    return FRACTION_RE.test(t) && p !== null && t.includes(p) ? 'record-row' : null;
  }
  if (el.attrs['data-claim'] === 'headline') {
    // Every part present with visible text, and the block carries its "X of Y" fraction.
    const parts = new Set(findAll(el, (n) => n !== el && n.attrs['data-claim-part'] !== undefined && textOf(n) !== '')
      .map((n) => n.attrs['data-claim-part']));
    return HEADLINE_PARTS.every((p) => parts.has(p)) && FRACTION_RE.test(textOf(el)) ? 'headline' : null;
  }
  return null;
}

function hundredOk(el) {
  const t = textOf(el);
  return FRACTION_RE.test(t) && RETRO_RE.test(t) && STATED_RE.test(t);
}

const where = (el) => el.tag === '#root' ? 'the top level' : `<${el.tag}${el.attrs.class ? ` class="${el.attrs.class}"` : ''}> (line ${el.line})`;

/**
 * Test 16 over one built page: [] when clean, else one message per violation.
 *   - banned phrases in the visible text, the <title> or the description metadata;
 *   - a percentage in visible text, aria-label, title or alt outside every allowed figure
 *     (pick-prob; a ring carrying its fraction; a record row carrying its fraction and period; the
 *     headline block holding its period part and its fraction; an offer figure, data-figure="offer", whose every
 *     percentage is DISCOUNT_PCT or TOPUP_BONUS_PCT from site/lib/founding.js);
 *   - a 100% not inside an element that also carries its fraction, "so far" and "stated at".
 */
export function claimViolations(html) {
  const doc = parse(html);
  const body = find(doc, (n) => n.tag === 'body');
  if (!body) return ['no <body>'];
  const out = [];

  const title = find(doc, (n) => n.tag === 'title');
  const metas = findAll(doc, (n) => n.tag === 'meta' && /^(description|og:title|og:description)$/.test(n.attrs.name ?? n.attrs.property ?? ''));
  const copy = [textOf(body), title ? title.children.map((c) => c.text).join('') : '', ...metas.map((m) => m.attrs.content ?? '')];
  for (const t of copy) for (const p of findBanned(t)) out.push(`banned phrase "${p}"`);
  // Accessible names and tooltips are copy too (review M3): aria-label, title and alt.
  for (const el of findAll(body, (n) => ATTR_COPY.some((a) => n.attrs[a] !== undefined))) {
    for (const a of ATTR_COPY) if (el.attrs[a] !== undefined) for (const p of findBanned(el.attrs[a])) out.push(`banned phrase "${p}"`);
  }

  return out.concat(percentageViolations(body, null, { hundredRule: true }));
}

/**
 * Content pages (features, privacy, terms, refunds) may print a percentage only inside an offer
 * figure (Plan A Task 1b) — no ring, record row or headline licenses one there. Takes a whole
 * document (scans its <body>) or a body fragment; [] when clean, else one message per stray
 * percentage in visible text, aria-label, title or alt. Same offer rule as claimViolations.
 */
export function percentagesOutsideOffers(html) {
  const doc = parse(html);
  return percentageViolations(find(doc, (n) => n.tag === 'body') ?? doc, ['offer'], { hundredRule: false });
}

/**
 * Percentages under body that no allowed figure licenses (kinds: the figure kinds that count, null
 * = every kind), plus, with hundredRule, the charter's 100% rule.
 */
function percentageViolations(body, kinds, { hundredRule }) {
  const out = [];
  const licensed = (chain, pct) => chain.some((x) => allowedBy(x, pct, kinds) !== null);
  const segs = segments(body);
  const flat = segs.map((s) => s.text).join('');
  const starts = [];
  let at = 0;
  for (const s of segs) { starts.push(at); at += s.text.length; }
  const segAt = (off) => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return segs[lo];
  };

  // Percentages in accessible names and tooltips (review M3): aria-label, title and alt.
  for (const el of findAll(body, (n) => ATTR_COPY.some((a) => n.attrs[a] !== undefined))) {
    for (const a of ATTR_COPY) {
      const v = el.attrs[a];
      if (v === undefined) continue;
      const chain = ancestors(el);
      for (const m of v.matchAll(PCT_RE)) {
        if (!licensed(chain, written(v, m.index, m[0]))) {
          out.push(`percentage "${m[0]}" outside an allowed figure, in ${a}= of ${where(el)}: "${v}"`);
        }
        const selfOk = FRACTION_RE.test(v) && RETRO_RE.test(v) && STATED_RE.test(v);
        if (hundredRule && pctOf(m[0]) === 100 && !selfOk && !chain.some(hundredOk)) {
          out.push(`"${m[0]}" without its fraction, "so far" and "stated at" in one element, in ${a}= of ${where(el)}: "${v}"`);
        }
      }
    }
  }

  for (const m of flat.matchAll(PCT_RE)) {
    const el = segAt(m.index).el;
    const chain = ancestors(el);
    const context = flat.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30).replace(/\s+/g, ' ').trim();
    if (!licensed(chain, written(flat, m.index, m[0]))) {
      out.push(`percentage "${m[0]}" outside an allowed figure, in ${where(el)}: "${context}"`);
    }
    if (hundredRule && pctOf(m[0]) === 100 && !chain.some(hundredOk)) {
      out.push(`"${m[0]}" without its fraction, "so far" and "stated at" in one element, in ${where(el)}: "${context}"`);
    }
  }
  return out;
}

/** CSP: [] when clean, else one message per inline script, <style>, style=, on*= or javascript: URL. */
export function cspViolations(html) {
  const out = [];
  // Raw belts first, so a parser blind spot cannot hide one.
  if (/<style[\s>]/i.test(html)) out.push('a <style> element');
  if (/<[^>]*\sstyle\s*=/i.test(html)) out.push('a style= attribute');
  const doc = parse(html);
  for (const el of findAll(doc, () => true)) {
    // JSON-LD is the one inline script the shell allows (layout.js's JSON_LD_CONTENT), CSP-pinned
    // by its own exact-content hash (build.mjs); a dedicated test holds it to that one string.
    if (el.tag === 'script' && el.attrs.type !== 'application/ld+json') {
      if (el.attrs.src === undefined) out.push(`inline <script> (line ${el.line})`);
      if (el.children.some((c) => c.text.trim() !== '')) out.push(`<script> with a body (line ${el.line})`);
    }
    for (const [k, v] of Object.entries(el.attrs ?? {})) {
      if (k === 'style') out.push(`style= on ${where(el)}`);
      if (/^on/.test(k)) out.push(`inline handler ${k}= on ${where(el)}`);
      if ((k === 'href' || k === 'src' || k === 'action') && /^\s*javascript:/i.test(v)) out.push(`javascript: URL on ${where(el)}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ thousands separators (BRAND 2026-10-12)

// Every count of four or more digits a visitor reads is written with thousands separators
// (site/lib/num.js fmtInt). bareCounts() reports each run of four or more digits that is not.
//
// Scanned, one text node or attribute value at a time (so a number never borrows its excuse from a
// neighbouring element): every text node under <body>, the <title>, the aria-label / title / alt /
// placeholder of every element, and the content of the text <meta>s (TEXT_METAS). data-* attributes,
// hrefs, datetime= and the machine <meta>s (theme-color, og:url, og:image:width...) are not text.
//
// A run is allowed only when, within its own node, it is exactly one of:
//   year     exactly four digits, 1900-2099, straight after a month name or its three-letter form
//            and one space ("Oct 2026", "8 October 2026"), after "© ", or after "Act " (a statute);
//   reg      straight after the whole word "RC" or "RC " (the operator's company registration number);
//   receipt  inside a token of exactly twelve lower-case hex characters (the receipt code).
// Not scanned: the text of .fx__comp / .fx__team / .fx__selname / .fx__why — names and words the
// publisher supplies ("1461 Trabzon FK", "Schalke 04"), which the site never formats.
const NAME_CLASSES = new Set(['fx__comp', 'fx__team', 'fx__selname', 'fx__why']);
const TEXT_METAS = new Set(['description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']);
const COUNT_ATTRS = ['aria-label', 'title', 'alt', 'placeholder'];
const MONTH_BEFORE = new RegExp(`(?<![A-Za-z])(?:${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')}) $`);
const HEX12_RE = /(?<![0-9A-Za-z])[0-9a-f]{12}(?![0-9A-Za-z])/g;

/** The bare runs of 4+ digits in one string: [{ run, context }]. */
export function bareRuns(s) {
  const out = [];
  const receipts = [...s.matchAll(HEX12_RE)].map((m) => [m.index, m.index + 12]);
  for (const m of s.matchAll(/\d{4,}/g)) {
    const run = m[0];
    const at = m.index;
    const before = s.slice(0, at);
    if (receipts.some(([a, b]) => at >= a && at + run.length <= b)) continue;
    if (/(?<![A-Za-z])RC ?$/.test(before)) continue;
    const isYear = run.length === 4 && Number(run) >= 1900 && Number(run) <= 2099;
    if (isYear && (MONTH_BEFORE.test(before) || /(?:©|\bAct) $/.test(before))) continue;
    out.push({ run, context: s.slice(Math.max(0, at - 30), at + run.length + 20) });
  }
  return out;
}

/** Every bare count on a page: [] when clean, else one "<where>: <run> in <context>" per run. */
export function bareCounts(html) {
  const doc = parse(html);
  const out = [];
  const report = (where1, s) => { for (const r of bareRuns(s)) out.push(`${where1}: ${r.run} in ${JSON.stringify(r.context)}`); };
  const classes = (el) => (el.attrs.class ?? '').split(/\s+/);
  const walk = (n, inBody) => {
    if (n.tag === undefined) {
      if (inBody) report(`text in ${where(n.parent)}`, n.text);
      return;
    }
    if (n.tag === 'title') { for (const c of n.children) report('<title>', c.text); return; }
    if (n.tag === 'meta') {
      const key = n.attrs.name ?? n.attrs.property;
      if (TEXT_METAS.has(key)) report(`<meta ${key}>`, n.attrs.content ?? '');
      return;
    }
    if (n.tag === 'script' || n.tag === 'style' || n.tag === 'template') return;
    for (const a of COUNT_ATTRS) if (n.attrs[a] !== undefined) report(`${a}= on ${where(n)}`, n.attrs[a]);
    if (classes(n).some((c) => NAME_CLASSES.has(c))) return;
    for (const c of n.children) walk(c, inBody || n.tag === 'body');
  };
  walk(doc, false);
  return out;
}
