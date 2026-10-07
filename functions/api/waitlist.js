// Cloudflare Pages Function: POST /api/waitlist (join), GET /api/waitlist (places left).
// Spec §8 S2–S5, §10; plan S14 and Task 7 (+ Task 7 security review).
//
// Runs in workerd: Web APIs only (fetch types, crypto.subtle, Cache API). No node: imports, no
// imports at all — this file is deployed as-is.
//
// Bindings (Pages project → Settings → Functions):
//   WAITLIST         KV namespace. One key per address: `e:<hex sha256(lower-cased address)>` →
//                    {"email": <as typed, trimmed>, "ts": <ISO time>}. Nothing else is stored.
//   WAITLIST_SECRET  secret, ≥ 32 characters: the HMAC key for the per-IP rate-limit bucket.
//   WAITLIST_HOST    the one hostname the waitlist answers on (e.g. "betgaffer.com"). Any other
//                    host — <project>.pages.dev, preview aliases, www — gets 503: those bypass the
//                    WAF rule and the Cache API, so every protection below would be off there.
//
// Budget (free plan): KV allows 1,000 writes and 1,000 lists a day, one write per second per key,
// and is eventually consistent; the Cache API works on a custom domain only. So a new address costs
// exactly one write, an existing one none; the places line counts `e:` keys with list() at most once
// per 600 s per data centre (cached; a failed list is remembered for 60 s); the per-IP limit is a
// Cache-API backstop to the WAF rule (docs/DEPLOY.md), keyed on HMAC(secret, IPv4 address or IPv6
// /56) — nothing IP-derived reaches KV.
//
// Enumeration (spec S3): a new and an existing address get the same response. Two side channels are
// narrowed too: (1) when a KV write fails (e.g. the daily write limit), a Cache-API "kv-down" flag
// makes every join IN THAT DATA CENTRE answer 503 before any record is read. The Cache API is per
// data centre, so after a global write exhaustion an existing address can still read 200 in a data
// centre where no write has failed yet, until the first new-address attempt there sets its flag.
// That residual risk is accepted on the free plan (the Workers Paid plan removes the daily write
// cap). A same-key 429 (two racing joins for one new address) is a success, not an outage, and sets
// no flag. (2) success and 503 joins are padded to a 1,000 ms minimum, so the extra write a new
// address costs is not visible in the timing.
//
// Privacy: this file never logs an email address or an IP.

const CAP = 500;                  // = site/config.js founding_places (asserted by tests/waitlist.test.js)
const MAX_BODY = 2048;
const RATE_LIMIT = 20;            // attempts per bucket per window (loose: carrier NAT puts many behind one IP)
const RATE_WINDOW_S = 3600;
const PLACES_CACHE_S = 600;
const KV_DOWN_S = 60;             // flag lifetime after a write error that is not the daily limit
const LIST_PAGE = 1000;
const MAX_LIST_PAGES = 10;        // a bound on the pagination loop; 500 records never need more than one page
const MIN_SECRET = 32;
const JOIN_FLOOR_MS = 1000;
const PLACES_FAIL_S = 60;         // a failed list is answered 503 from cache for this long

const MESSAGES = Object.freeze({
  ok: "You're on the list. We'll email you when your invite is ready.",
  adult: 'Please confirm you are 18 or over.',
  email: 'Please enter a valid email address.',
  unreadable: 'That request could not be read. Please try again.',
  tooLarge: 'That request was too large.',
  type: 'That request was in a format the waitlist does not accept.',
  origin: 'That request did not come from this site.',
  slow: 'Too many attempts — try again in an hour.',
  down: 'The waitlist is temporarily unavailable.',
});

// No-JS outcome pages (built by the site; Task 6 renders /waitlist/<kind>/).
const RESULT_PAGE = Object.freeze({
  200: '/waitlist/thanks/',
  400: '/waitlist/invalid/',
  403: '/waitlist/invalid/',
  413: '/waitlist/invalid/',
  415: '/waitlist/invalid/',
  429: '/waitlist/slow-down/',
  503: '/waitlist/unavailable/',
});

// ASCII only (review I3): no quotes, commas, angle brackets, bidi or line-separator characters.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

// Real time source. Tests inject a fake one as context.__waitlistTiming (Pages never sets it).
const REAL_TIMING = Object.freeze({
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
});

// ─── responses ──────────────────────────────────────────────────────────────────────────────────

function wantsJson(request) {
  return /application\/json/i.test(request.headers.get('Accept') || '');
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** The one response builder for POST: JSON for the script, a 303 to a result page for no-JS. */
function outcome(request, { status, message }) {
  if (wantsJson(request)) return json(status, { ok: status === 200, message });
  return new Response(null, { status: 303, headers: { ...BASE_HEADERS, Location: RESULT_PAGE[status] } });
}

const result = (status, message) => ({ status, message });

// ─── helpers ────────────────────────────────────────────────────────────────────────────────────

function configured(env) {
  return Boolean(env && env.WAITLIST
    && typeof env.WAITLIST.get === 'function' && typeof env.WAITLIST.put === 'function'
    && typeof env.WAITLIST.list === 'function'
    && typeof env.WAITLIST_SECRET === 'string' && env.WAITLIST_SECRET.length >= MIN_SECRET
    && typeof env.WAITLIST_HOST === 'string' && env.WAITLIST_HOST.trim() !== '');
}

/** True only on the configured custom domain (never <project>.pages.dev, a preview, or www). */
function onHost(request, env) {
  return new URL(request.url).hostname === env.WAITLIST_HOST.trim().toLowerCase();
}

/** KV's one-write-per-second-per-key refusal: another join for the same address is storing it. */
const sameKeyRace = (err) => /429|too many/i.test(err && typeof err.message === 'string' ? err.message : String(err));

function cacheStore() {
  try {
    const c = globalThis.caches;
    return c && c.default && typeof c.default.match === 'function' && typeof c.default.put === 'function'
      ? c.default : null;
  } catch {
    return null;
  }
}

const cacheKey = (request, path) => new Request(`${new URL(request.url).origin}/__waitlist/${path}`, { method: 'GET' });

/** A cache write that never fails the request: handed to waitUntil when present, else awaited. */
async function cacheWrite(context, cache, key, body, maxAge) {
  const write = (async () => {
    try {
      await cache.put(key, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${maxAge}` },
      }));
    } catch { /* the cache is a backstop / optimisation */ }
  })();
  if (typeof context.waitUntil === 'function') context.waitUntil(write);
  else await write;
}

async function cacheRead(cache, key) {
  try {
    const hit = await cache.match(key);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

class BodyTooLarge extends Error {}

function declaredTooLarge(request) {
  const declared = (request.headers.get('Content-Length') || '').trim();
  return /^\d+$/.test(declared) && Number(declared) > MAX_BODY;
}

/**
 * Read at most MAX_BODY bytes; throws BodyTooLarge beyond it without buffering the rest. The
 * declared Content-Length is advisory only (it may be absent or lie): the stream count decides.
 */
async function readCapped(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes); // invalid UTF-8 throws TypeError
}

/** → { email, adult, honeypot } of strings-or-undefined, or null when the body cannot be read. */
function parseFields(kind, text) {
  let field;
  if (kind === 'form') {
    const p = new URLSearchParams(text);
    field = (k) => (p.has(k) ? p.get(k) : undefined);
  } else {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
    field = (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : undefined);
  }
  return { email: field('email'), adult: field('adult'), honeypot: field('bg_ref') };
}

function bodyKind(request) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') return 'form';
  if (type === 'application/json') return 'json';
  return null;
}

/** The trimmed address as typed, or null when it is not acceptable. */
function checkEmail(raw) {
  if (typeof raw !== 'string') return null;
  // ASCII whitespace only (as browsers sanitise type=email). String.prototype.trim would also strip
  // U+2028/U+2029, NBSP and BOM, silently accepting an address that arrived with them.
  const email = raw.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
  if (email === '' || email.length > 254) return null;
  if ('=+-@'.includes(email[0])) return null;          // spreadsheet formula injection
  return EMAIL_RE.test(email) ? email : null;
}

/**
 * The rate-limit identity: an IPv4 address as-is, an IPv6 address reduced to its /56 (one
 * subscriber typically holds a /56 or larger, so rotating the low 72 bits must not buy fresh buckets).
 * Unparseable input is used verbatim — it is only ever hashed.
 */
function rateIdentity(ip) {
  let s = ip.trim().toLowerCase();
  if (!s.includes(':')) return `v4:${s}`;
  s = s.replace(/%.*$/, '');                             // zone id
  const v4tail = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4tail) {                                          // dotted IPv4 tail → two hex groups
    const o = v4tail.slice(2).map(Number);
    if (o.some((n) => n > 255)) return `raw:${s}`;
    s = `${v4tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return `raw:${s}`;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return `raw:${s}`;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return `raw:${s}`;
  const n = groups.map((g) => parseInt(g, 16));
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) {   // IPv4-mapped: per IPv4 address
    return `v4:${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
  }
  // /56: groups 0-2 and the high byte of group 3 (ISPs commonly delegate a /56 per subscriber).
  return `v6:${n.slice(0, 3).map((x) => x.toString(16)).join(':')}:${(n[3] & 0xff00).toString(16)}::/56`;
}

/**
 * Per-IP backstop. Returns true when this attempt is over the limit. Skipped (false) when the Cache
 * API or the client IP is unavailable, or when the cache throws: a backstop must never take the
 * form down.
 */
async function overLimit(context, env) {
  const { request } = context;
  const cache = cacheStore();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!cache || !ip) return false;
  try {
    const bucket = await hmacHex(env.WAITLIST_SECRET, `rl:${rateIdentity(ip)}`);
    const key = cacheKey(request, `rl/${bucket}`);
    const now = Math.floor(Date.now() / 1000);
    let start = now;
    let count = 0;
    const v = await cacheRead(cache, key);
    if (v && Number.isInteger(v.start) && Number.isInteger(v.count)
      && v.start <= now && now - v.start < RATE_WINDOW_S && v.count >= 0) {
      ({ start, count } = v);
    }
    count += 1;
    if (count > RATE_LIMIT) return true;
    const remaining = Math.max(1, start + RATE_WINDOW_S - now);
    await cacheWrite(context, cache, key, JSON.stringify({ start, count }), remaining);
    return false;
  } catch {
    return false;
  }
}

/** Seconds the kv-down flag should live: to the next 00:00 UTC for the daily limit, else 60. */
function kvDownSeconds(err) {
  const message = err && typeof err.message === 'string' ? err.message : String(err);
  if (!/limit/i.test(message)) return KV_DOWN_S;
  const nowS = Math.floor(Date.now() / 1000);
  return Math.max(1, 86400 - (nowS % 86400));
}

/** Records counted with list(), stopping as soon as CAP is reached. */
async function countRecords(kv) {
  let count = 0;
  let cursor;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const r = await kv.list(cursor ? { prefix: 'e:', limit: LIST_PAGE, cursor } : { prefix: 'e:', limit: LIST_PAGE });
    count += Array.isArray(r && r.keys) ? r.keys.length : 0;
    if (count >= CAP || !r || r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return count;
}

// ─── join ───────────────────────────────────────────────────────────────────────────────────────

async function join(context) {
  const { request, env } = context;
  if (!configured(env)) return result(503, MESSAGES.down);
  if (!onHost(request, env)) return result(503, MESSAGES.down);

  // Cheap header checks first; the body is only read for a same-origin request of an accepted type.
  if (declaredTooLarge(request)) return result(413, MESSAGES.tooLarge);
  const kind = bodyKind(request);
  if (!kind) return result(415, MESSAGES.type);
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) return result(403, MESSAGES.origin);

  let text;
  try {
    text = await readCapped(request);
  } catch (err) {
    if (err instanceof BodyTooLarge) return result(413, MESSAGES.tooLarge);
    return result(400, MESSAGES.unreadable); // invalid UTF-8, a broken stream
  }
  const fields = parseFields(kind, text);
  if (!fields) return result(400, MESSAGES.unreadable);

  // Every readable same-origin attempt counts, valid or not.
  if (await overLimit(context, env)) return result(429, MESSAGES.slow);

  // Honeypot: indistinguishable from a real success, and nothing is stored.
  if (fields.honeypot !== undefined && fields.honeypot !== '') return result(200, MESSAGES.ok);

  if (fields.adult !== 'yes') return result(400, MESSAGES.adult);
  const email = checkEmail(fields.email);
  if (!email) return result(400, MESSAGES.email);

  // While a write has recently failed, every join is refused BEFORE any record is read: otherwise
  // an existing address (read only) would succeed while a new one (needs a write) would fail.
  const cache = cacheStore();
  const downKey = cacheKey(request, 'kv-down');
  if (cache && (await cacheRead(cache, downKey))) return result(503, MESSAGES.down);

  const kv = env.WAITLIST;
  let key;
  let existing;
  try {
    key = `e:${await sha256Hex(email.toLowerCase())}`;
    existing = await kv.get(key);
  } catch {
    console.error('waitlist: storage read error on join'); // fixed text: no address, no IP, no key
    return result(503, MESSAGES.down);
  }
  if (existing === null) {
    try {
      await kv.put(key, JSON.stringify({ email, ts: new Date().toISOString() }));
    } catch (err) {
      // Two simultaneous joins for one new address: KV refuses the second write with 429 because
      // the first is storing the same record. That is a success, not an outage — answering 503
      // (or setting the flag) would reveal the race and let anyone trip the flag cheaply.
      if (!sameKeyRace(err)) {
        console.error('waitlist: storage write error on join');
        if (cache) await cacheWrite(context, cache, downKey, '{"down":true}', kvDownSeconds(err));
        return result(503, MESSAGES.down);
      }
    }
  }
  // Identical for a new and an existing address (spec S3).
  return result(200, MESSAGES.ok);
}

export async function onRequestPost(context) {
  const timing = context.__waitlistTiming || REAL_TIMING;
  const t0 = timing.now();
  let r;
  try {
    r = await join(context);
  } catch {
    console.error('waitlist: unexpected error on join');
    r = result(503, MESSAGES.down); // still floored below
  }
  if (r.status === 200 || r.status === 503) {
    const wait = JOIN_FLOOR_MS - (timing.now() - t0);
    if (wait > 0) await timing.sleep(wait);
  }
  return outcome(context.request, r);
}

// ─── places ─────────────────────────────────────────────────────────────────────────────────────

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!configured(env) || !onHost(request, env)) return json(503, { ok: false, message: MESSAGES.down });

  const cache = cacheStore();
  const key = cacheKey(request, 'places');
  if (cache) {
    const v = await cacheRead(cache, key);
    if (v && v.down === true) return json(503, { ok: false, message: MESSAGES.down }); // recent list failure
    if (v && Number.isInteger(v.places_left) && v.places_left >= 0 && v.places_left <= CAP && v.cap === CAP) {
      return json(200, { places_left: v.places_left, cap: CAP });
    }
  }

  let count;
  try {
    count = await countRecords(env.WAITLIST);
  } catch {
    console.error('waitlist: storage list error on places');
    // Remember the failure briefly so a burst of page views does not re-list (and burn list budget).
    if (cache) await cacheWrite(context, cache, key, '{"down":true}', PLACES_FAIL_S);
    return json(503, { ok: false, message: MESSAGES.down });
  }
  const payload = { places_left: Math.max(0, CAP - count), cap: CAP };
  if (cache) await cacheWrite(context, cache, key, JSON.stringify(payload), PLACES_CACHE_S);
  return json(200, payload);
}
