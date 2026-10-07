// The site build (plan S2–S8, Task 6): artifact -> validate -> verify hashes -> render -> dist/.
//
//   node site/build.mjs [--root <dir>] [--out <dir>] [--config <file>]
//     --root    the published artifact (index.json + days/); default: the repository root
//     --out     output directory; default: ./dist
//     --config  a module whose default export is the site config; default: site/config.js
//
// Any invalid input throws and the CLI exits 1, leaving the previous output (and so the previous
// Cloudflare Pages deploy) exactly as it was: a stale page is better than a misrendered receipt.
//
// Atomicity (S2): everything is rendered in memory first; then written to <out>.tmp; then <out>
// is renamed to <out>.old, <out>.tmp to <out>, and <out>.old removed. Windows cannot rename over a
// directory, hence the three steps. A failure before the second rename leaves <out> untouched and
// removes <out>.tmp; a crash between the two renames is repaired at the start of the next build.
//
// Tests import build(); nothing here spawns a process.

import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { requireOperator } from './config.js';
import { loadSite } from './lib/data.js';
import { escAttr, escHtml } from './lib/esc.js';
import { renderDay } from './lib/fixtures.js';
import { page } from './lib/layout.js';
import { renderRecord } from './lib/record.js';
import { ring } from './lib/ring.js';
import { fmtDayLong, lagosToday } from './lib/time.js';
import { waitlistForm, waitlistResultMeta, waitlistResultPage, WAITLIST_RESULT_KINDS } from './lib/waitlist-form.js';
import * as features from './content/features.js';
import * as privacy from './content/privacy.js';
import * as terms from './content/terms.js';
import * as refunds from './content/refunds.js';

const SITE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SITE, '..');

/** site.css = these files, in this order. */
export const CSS_ORDER = Object.freeze(['base.css', 'fixtures.css', 'record.css', 'content.css', 'waitlist.css']);
/** site/lib modules that run in the browser too, copied to /assets/js/lib/ for the archive loader. */
export const ISOMORPHIC_LIB = Object.freeze(['esc.js', 'time.js', 'hash.js', 'ring.js', 'fixtures.js']);
/** Same-site browser entry modules. */
const SCRIPT = Object.freeze({ stale: '/assets/js/stale.js', day: '/assets/js/day.js', waitlist: '/assets/js/waitlist.js' });

/** dist/_headers (Cloudflare Pages), exactly as the plan states it. */
export const HEADERS = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
/days/*
  Cache-Control: public, max-age=300
/index.json
  Cache-Control: public, max-age=120
/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const DAY_MS = 86400000;

/** 'YYYY-MM-DD' + n calendar days (UTC arithmetic on a date, never the host timezone). */
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ choosing days

/**
 * Which day the home page shows (plan Task 6 step 3).
 *   home      = today when listed and not compacted, else the newest listed non-compacted day
 *               before today (missingToday = true), else null;
 *   tomorrow  = index.newest_day when it is the calendar day after today, listed and not compacted
 *               (a day further ahead is not "tomorrow", and is labelled by its date).
 */
export function chooseDays(index) {
  if (!index) return { today: null, home: null, tomorrow: null, missingToday: false };
  const { today, days } = index;
  const full = days.filter((d) => !d.compacted);
  const home = full.some((d) => d.day === today) ? today : (full.find((d) => d.day < today)?.day ?? null);
  const next = addDays(today, 1);
  const tomorrow = index.newest_day === next && full.some((d) => d.day === next) ? next : null;
  return { today, home, tomorrow, missingToday: home !== today };
}

// ------------------------------------------------------------------ page parts

/**
 * Up to seven listed days around `shown` (ascending), as links to /day/<d>/. Each day's
 * "Today"/"Tomorrow" tag is empty and hidden here: stale.js fills it for the visitor's date.
 */
function dayStrip(listedAsc, shown, { onDayPage }) {
  if (listedAsc.length < 2) return '';
  const at = shown === null ? listedAsc.length - 1 : Math.max(0, listedAsc.indexOf(shown));
  const start = Math.min(Math.max(0, at - 3), Math.max(0, listedAsc.length - 7));
  const items = listedAsc.slice(start, start + 7).map((d) => {
    const [dow, dd, mon] = fmtDayLong(d).split(' ');
    const current = d === shown ? (onDayPage ? ' aria-current="page"' : ' aria-current="true"') : '';
    return `<li><a class="day-strip__link" href="/day/${escAttr(d)}/"${current}>`
      + `<span class="day-strip__dow">${escHtml(dow)}</span>`
      + `<span class="day-strip__date">${escHtml(`${dd} ${mon}`)}</span>`
      + `<span class="day-strip__tag" data-rel-day="${escAttr(d)}" data-rel="strip" hidden></span>`
      + `<span class="vh">${escHtml(` — ${fmtDayLong(d)}`)}</span></a></li>`;
  }).join('');
  return `<nav class="day-strip" aria-label="Published days"><ol class="day-strip__list" role="list">${items}</ol></nav>`;
}

const pageHead = (sub) => `<header class="day-head home-head"><div class="day-head__title"><h1 class="t-d1">Football predictions</h1>${sub ? `<p class="day-head__date">${sub}</p>` : ''}</div></header>`;

function tomorrowLine(tomorrow) {
  if (!tomorrow) return '';
  // The lead is the date form (stale.js relLabel 'next'); stale.js says "Tomorrow's"/"Today's" in the browser.
  return `<p class="home-next"><span data-rel-day="${escAttr(tomorrow)}" data-rel="next">${escHtml(`The card for ${fmtDayLong(tomorrow)} is published:`)}</span> <a href="/day/${escAttr(tomorrow)}/">${escHtml(fmtDayLong(tomorrow))}</a></p>`;
}

function homeBody({ index, choice, days, listedAsc, repo, neighbours }) {
  if (!index) {
    return `${pageHead('')}
<div class="bg-empty home-empty">
<h2>No card yet</h2>
<p>The first card publishes the evening before match day: every fixture we cover that day, at most one recommended pick each, with its probability.</p>
<div class="bg-empty__row"><a class="bg-btn bg-btn--ghost" href="/features/">What Bet Gaffer does</a></div>
</div>`;
  }
  const { today, home, tomorrow, missingToday } = choice;
  const strip = dayStrip(listedAsc, home, { onDayPage: false });
  if (home === null) {
    return `${pageHead('')}
<div class="bg-empty home-empty">
<h2>${escHtml(`No card has been published for ${fmtDayLong(today)} yet.`)}</h2>
<p>Each day's card publishes the evening before match day.</p>
${tomorrow ? tomorrowLine(tomorrow) : ''}
</div>
${strip}`;
  }
  const notice = missingToday
    ? `<div class="home-notice" role="note"><p>${escHtml(`No card was published for ${fmtDayLong(today)}.`)} ${escHtml(`This is the most recent card, for ${fmtDayLong(home)}.`)}</p></div>\n`
    : '';
  const { prev, next } = neighbours(home);
  const card = renderDay(days.get(home), { prevDay: prev, nextDay: next, repo });
  return `${notice}${tomorrowLine(tomorrow)}
${strip}
${card}`;
}

function stubBody(entry, { repo, prev, next }) {
  const d = entry.day;
  const long = fmtDayLong(d);
  const history = `https://github.com/${repo}/commits/main/days/${d}.json`;
  const historyLink = `<a href="${escAttr(history)}" rel="noopener">${escHtml(`days/${d}.json`)}</a>`;
  const head = '<header class="day-head">'
    + '<div class="day-head__title">'
    + `<p class="t-lbl day-head__rel" data-rel-day="${escAttr(d)}" data-rel="eyebrow" hidden></p>`
    + '<h1 class="t-d1">Football predictions</h1>'
    + `<p class="day-head__date">${escHtml(long)}</p>`
    + `<p class="day-head__count mono">${escHtml(`${plural(entry.fixtures, 'fixture', 'fixtures')} listed`)}</p>`
    + '</div>'
    + ring(entry.accuracy, { dayLabel: `Picks published for ${long}, settled so far`, date: d, relDay: d })
    + '<p class="day-head__note">The ring counts this card’s own published picks. The graded record, every settled pick over time, is on <a href="/our-record/">Our Record</a>.</p>'
    + `<p class="day-receipt mono">receipt <a class="day-receipt__link" href="${escAttr(history)}" rel="noopener">${escHtml(entry.picks_hash.slice(0, 'sha256:'.length + 12))}</a></p>`
    + '</header>';
  if (entry.compacted) {
    return `<div id="day-root" class="day-root" data-day="${escAttr(d)}"><div class="day day--stub">${head}`
      + `<p class="day-stub__note">This day's full card is in the repository history: ${historyLink}</p></div></div>`;
  }
  return `<div id="day-root" class="day-root" data-day="${escAttr(d)}" data-src="/days/${escAttr(d)}.json" `
    + `data-hash="${escAttr(entry.picks_hash)}" data-repo="${escAttr(repo)}" data-prev="${escAttr(prev ?? '')}" data-next="${escAttr(next ?? '')}">`
    + `<div class="day day--stub">${head}`
    + `<noscript><p class="day-stub__note">This day's fixtures load with JavaScript. The raw file is in the repository history: ${historyLink}</p></noscript>`
    + '</div></div>';
}

function notFoundBody() {
  return `<section class="bg-empty nf" aria-labelledby="nf-h">
<h1 class="t-d2" id="nf-h">Page not found</h1>
<p>There is no page at this address. The link may be mistyped, or the page may have moved.</p>
<div class="bg-empty__row"><a class="bg-btn bg-btn--primary" href="/">Today's predictions</a><a class="bg-btn bg-btn--ghost" href="/our-record/">Our Record</a></div>
</section>`;
}

/** Features breadth from the home day file: active (non-withdrawn) rows only; absent when empty. */
function breadthOf(day, date) {
  if (!day) return undefined;
  const active = day.fixtures.filter((f) => f.withdrawn !== true);
  if (active.length === 0) return undefined;
  return {
    markets: day.counts.markets_per_fixture,
    competitions: new Set(active.map((f) => f.comp)).size,
    fixtures: active.length,
    day: date,
  };
}

// ------------------------------------------------------------------ filesystem

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** fs op with retries for Windows' transient locks (an indexer or a server holding a handle). */
async function retry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !RETRY_CODES.has(e.code)) throw e;
      await sleep(40 * 2 ** i);
    }
  }
}
const rmrf = (p) => rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

function inside(child, parent) {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** Refuse an out directory whose removal or replacement could destroy a source. */
function checkOut(outAbs, rootAbs) {
  if (dirname(outAbs) === outAbs) throw new Error(`build: out ${outAbs} is a filesystem root`);
  if (inside(rootAbs, outAbs)) throw new Error(`build: out ${outAbs} is or contains the data root ${rootAbs}`);
  if (inside(REPO_ROOT, outAbs)) throw new Error(`build: out ${outAbs} is or contains the repository ${REPO_ROOT}`);
  for (const p of [join(rootAbs, 'days'), ...['site', 'functions', 'tests', 'days', '.git'].map((s) => join(REPO_ROOT, s))]) {
    if (inside(outAbs, p)) throw new Error(`build: out ${outAbs} is inside ${p}`);
  }
}

/**
 * The file that marks a directory as this build's own output. It ships with the rest of the output,
 * so the host may serve it at /.betgaffer-build; it holds only MARKER_TEXT (no path, time or name),
 * which is public by design. Keeping it in the output is what lets the next build recognise and
 * replace its own directory.
 */
export const MARKER = '.betgaffer-build';
const MARKER_TEXT = 'This directory is generated by site/build.mjs (Bet Gaffer) and is replaced whole on every build.\n';

/**
 * Refuse to replace or delete anything the build did not make (review I1): `p` may be absent, an
 * empty directory, or a directory carrying MARKER. A file, a link, or a non-empty directory
 * without the marker (a README.md, a notes folder, a home directory) is refused untouched.
 */
async function assertOwned(p) {
  let st;
  try {
    st = await lstat(p);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  if (!st.isDirectory()) throw new Error(`build: ${p} exists and is not a directory; refusing to replace it (choose another --out)`);
  const entries = await readdir(p);
  if (entries.length > 0 && !entries.includes(MARKER)) {
    throw new Error(`build: ${p} is not a build output (it has no ${MARKER} marker); refusing to replace or delete it (choose another --out, or empty it)`);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by someone else
  }
}

/**
 * <out>.lock (review M6): one build at a time per output, so two builds can never interleave their
 * tmp/swap steps. A lock whose pid is no longer running is stale and taken over. Returns release().
 */
async function acquireLock(lock, outAbs) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let fh;
    try {
      fh = await open(lock, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw new Error(`build: cannot create the lock ${lock} (${e.code ?? e.message})`);
      let text;
      try {
        text = await readFile(lock, 'utf8');
      } catch (e2) {
        throw new Error(`build: the lock ${lock} cannot be read (${e2.code ?? e2.message}); delete it if no build is running`);
      }
      const pid = /^\d+\s*$/.test(text) ? Number.parseInt(text, 10) : NaN;
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error(`build: another build may be writing ${outAbs} (unreadable lock ${lock}); delete it if no build is running`);
      }
      if (alive(pid)) throw new Error(`build: another build (pid ${pid}) is writing ${outAbs}; if none is running, delete ${lock}`);
      await rm(lock, { force: true }); // stale: its build is gone
      continue;
    }
    try {
      await fh.writeFile(`${process.pid}\n`);
    } finally {
      await fh.close();
    }
    return async () => {
      try {
        if ((await readFile(lock, 'utf8')) === `${process.pid}\n`) await rm(lock, { force: true });
      } catch {
        // already gone
      }
    };
  }
  throw new Error(`build: could not take the lock ${lock}`);
}

async function filesIn(dir) {
  return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
}

const routeFile = (path) => (path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1));

// ------------------------------------------------------------------ build

/**
 * Build the site. Throws on any invalid input or failure, leaving `out` as it was.
 *
 * @param {object} o
 * @param {string} [o.root]       artifact directory (index.json + days/); default the repo root
 * @param {string} [o.out]        output directory; default <repo>/dist
 * @param {object} o.config       site config (REQUIRED; the CLI loads site/config.js or --config)
 * @param {number} [o.now]        epoch ms; fixes the copyright year and no-data "today"
 * @param {(m:string)=>void} [o.warn]  warnings (unlisted day files); default stderr
 * @param {(tmp:string)=>Promise<void>} [o.beforeSwap]  test seam: runs after <out>.tmp is complete
 * @param {string} [o.configPath] the config file's path, named in operator errors (the CLI passes it)
 * @returns {Promise<{ out: string, routes: string[], files: number }>}
 */
export async function build({ root = REPO_ROOT, out = join(REPO_ROOT, 'dist'), config, ...rest } = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('build: config is required (the CLI loads site/config.js or --config <file>)');
  }
  const rootAbs = resolve(root);
  const outAbs = resolve(out);
  checkOut(outAbs, rootAbs);
  const release = await acquireLock(`${outAbs}.lock`, outAbs);
  try {
    return await buildLocked({ rootAbs, outAbs, config, ...rest });
  } finally {
    await release();
  }
}

async function buildLocked({ rootAbs, outAbs, config, now = Date.now(), warn, beforeSwap, configPath }) {
  const tmp = `${outAbs}.tmp`;
  const old = `${outAbs}.old`;
  for (const p of [outAbs, tmp, old]) await assertOwned(p);

  // A crash between the swap's two renames left <out> missing and the last good site in <out>.old.
  if (!(await exists(outAbs)) && (await exists(old))) await retry(() => rename(old, outAbs));

  // 1. Validation + hash verification (S6); 2. operator identity (S8), naming the file in use.
  const { index, days } = await loadSite(rootAbs, warn ? { warn } : {});
  try {
    requireOperator(config);
  } catch (e) {
    if (typeof configPath !== 'string' || configPath === '') throw e;
    throw new Error(e.message.replace(/^site\/config\.js:/, `${configPath}:`));
  }

  // 3. Days.
  const choice = chooseDays(index);
  const listed = index ? index.days : [];
  const listedAsc = listed.map((d) => d.day).sort();
  const neighbours = (d) => {
    const i = listedAsc.indexOf(d);
    return { prev: i > 0 ? listedAsc[i - 1] : null, next: i >= 0 && i < listedAsc.length - 1 ? listedAsc[i + 1] : null };
  };
  const repo = config.repo;
  const year = Number(lagosToday(now).slice(0, 4));
  const today = index ? index.today : lagosToday(now);
  const staleAfterHours = Number.isFinite(config.stale_after_hours) && config.stale_after_hours > 0 ? config.stale_after_hours : 6;

  // 4–5. Render every page in memory first: a renderer that throws stops the build before disk.
  const pages = new Map();
  const add = (o) => {
    if (pages.has(o.path)) throw new Error(`build: route ${o.path} rendered twice`);
    pages.set(o.path, page({ config, year, ...o }));
  };

  add({
    path: '/',
    title: 'Football predictions',
    description: 'The day’s football in the competitions Bet Gaffer covers: at most one recommended pick per fixture, '
      + 'with its probability, graded in public after full time.',
    body: homeBody({ index, choice, days, listedAsc, repo, neighbours }),
    scripts: [SCRIPT.stale],
    mainData: {
      generatedAt: index ? index.generated_at : null,
      day: choice.home,
      tomorrow: choice.tomorrow,
      view: 'home',
      staleAfterHours,
    },
  });

  for (const entry of listed) {
    const d = entry.day;
    const { prev, next } = neighbours(d);
    const full = d === choice.home || d === choice.tomorrow;
    const body = full
      ? renderDay(days.get(d), { prevDay: prev, nextDay: next, repo })
      : stubBody(entry, { repo, prev, next });
    const isStubWithFetch = !full && !entry.compacted;
    add({
      path: `/day/${d}/`,
      title: `Football predictions for ${fmtDayLong(d)}`,
      description: `The Bet Gaffer card for ${fmtDayLong(d)}: each fixture we cover, at most one recommended pick with its probability, graded after full time.`,
      body: `${dayStrip(listedAsc, d, { onDayPage: true })}\n${body}`,
      // The home page shows this same card: name / as the canonical URL (review M7).
      canonicalPath: d === choice.home && d === today ? '/' : undefined,
      scripts: isStubWithFetch ? [SCRIPT.stale, SCRIPT.day] : [SCRIPT.stale],
      mainData: { generatedAt: index.generated_at, day: d, tomorrow: choice.tomorrow, view: 'day', staleAfterHours },
    });
  }

  add({
    path: '/our-record/',
    title: 'Our Record',
    description: 'Every graded Bet Gaffer card pick: each figure with its count, its period and its status.',
    body: renderRecord(index ? index.record : null, { today, days: listedAsc, repo }),
    scripts: [SCRIPT.stale], // relabels the in-progress day; the late-data banner
    mainData: { generatedAt: index ? index.generated_at : null, view: 'record', staleAfterHours },
  });

  const breadth = choice.home ? breadthOf(days.get(choice.home), choice.home) : undefined;
  add({ ...features.META, body: features.render({ ...config, breadth }, { waitlistHtml: waitlistForm() }), scripts: [SCRIPT.waitlist] });
  for (const mod of [privacy, terms, refunds]) add({ ...mod.META, body: mod.render(config) });

  for (const kind of WAITLIST_RESULT_KINDS) {
    const meta = waitlistResultMeta(kind);
    const body = waitlistResultPage(kind);
    add({ ...meta, body, scripts: /data-waitlist[\s>]/.test(body) ? [SCRIPT.waitlist] : [] });
  }

  add({ path: '/404.html', title: 'Page not found', description: 'There is no page at this address.', body: notFoundBody(), noindex: true });

  // 6. What gets copied (sources checked before anything is written).
  const copies = [];
  if (index) {
    copies.push([join(rootAbs, 'index.json'), 'index.json']);
    for (const e of listed) {
      const name = `${e.day}${e.compacted ? '.min' : ''}.json`;
      copies.push([join(rootAbs, 'days', name), `days/${name}`]);
    }
  }
  const assets = join(SITE, 'assets');
  for (const sub of ['fonts', 'img', 'js']) {
    for (const f of await filesIn(join(assets, sub))) copies.push([join(assets, sub, f), `assets/${sub}/${f}`]);
  }
  for (const f of ISOMORPHIC_LIB) copies.push([join(SITE, 'lib', f), `assets/js/lib/${f}`]);
  const css = (await Promise.all(CSS_ORDER.map(async (f) => `/* site/assets/css/${f} */\n${await readFile(join(assets, 'css', f), 'utf8')}`))).join('\n');

  // 7–8. Write <out>.tmp, then swap.
  await rmrf(tmp);
  let fileCount = 0;
  try {
    const write = async (rel, data) => {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
      fileCount++;
    };
    for (const [path, html] of pages) await write(routeFile(path), html);
    await write('assets/css/site.css', css);
    await write('_headers', HEADERS);
    await write(MARKER, MARKER_TEXT);
    for (const [from, rel] of copies) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await copyFile(from, p);
      fileCount++;
    }
    if (beforeSwap) await beforeSwap(tmp);

    await rmrf(old); // garbage from an earlier run whose final cleanup failed
    const hadOut = await exists(outAbs);
    if (hadOut) await retry(() => rename(outAbs, old));
    try {
      await retry(() => rename(tmp, outAbs));
    } catch (e) {
      if (hadOut) await retry(() => rename(old, outAbs)).catch(() => {});
      throw e;
    }
  } catch (e) {
    await rmrf(tmp).catch(() => {});
    throw e;
  }
  try {
    await rmrf(old);
  } catch (e) {
    (warn ?? ((m) => process.stderr.write(`${m}\n`)))(`warning: could not remove ${old} (${e.code ?? e.message}); the next build removes it`);
  }
  return { out: outAbs, routes: [...pages.keys()], files: fileCount };
}

// ------------------------------------------------------------------ CLI

/** --root/--out/--config (space or = form). Unknown flags and stray arguments throw. */
export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { root: { type: 'string' }, out: { type: 'string' }, config: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  return { root: values.root, out: values.out, config: values.config };
}

/** The default export of a config module. */
export async function loadConfig(file) {
  const abs = resolve(file);
  let mod;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (e) {
    throw new Error(`build: cannot load config ${abs}: ${e.message}`);
  }
  if (mod.default === null || typeof mod.default !== 'object') {
    throw new Error(`build: config ${abs} has no default export (it must \`export default { … }\`)`);
  }
  return mod.default;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const a = parseCli(process.argv.slice(2));
    const config = await loadConfig(a.config ?? join(SITE, 'config.js'));
    const configPath = a.config ?? 'site/config.js';
    const r = await build({ root: a.root ?? REPO_ROOT, out: a.out ?? 'dist', config, configPath });
    console.log(`built ${r.routes.length} pages (${r.files} files) into ${r.out}`);
  } catch (e) {
    console.error(`build failed: ${e.message}`);
    process.exitCode = 1;
  }
}

