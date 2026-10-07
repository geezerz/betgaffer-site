// Waitlist: the Pages Function (spec §8 S2–S5, §10, test 10), the build-time form, the browser module.
//
// The Function's handlers are imported and driven in-process with Node 22's global Request/Response
// and crypto.subtle, an in-memory fake KV with injectable failures, and a caches.default stub that is
// installed on globalThis per test and removed afterwards. Nothing is spawned.
//
// The join path's minimum response time is driven by an injected clock + sleep (context
// `__waitlistTiming`), so the suite stays fast while the floor is still asserted.

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { onRequestPost, onRequestGet } from '../functions/api/waitlist.js';
import {
  waitlistForm, waitlistResultPage, waitlistResultMeta, WAITLIST_RESULT_KINDS, CONSENT_TEXT, FOUNDING_CAP,
} from '../site/lib/waitlist-form.js';
import { placesText, messageFor } from '../site/assets/js/waitlist.js';
import { escHtml } from '../site/lib/esc.js';
import siteConfig from '../site/config.js';

// The private platform's name, built from char codes so the literal never appears in this repo.
const INTERNAL = String.fromCharCode(70, 111, 114, 101, 99, 97, 120, 116);
const ORIGIN = 'https://betgaffer.com';
const ENDPOINT = `${ORIGIN}/api/waitlist`;
const SECRET = 'k'.repeat(48);
const IP = '203.0.113.77';
const FLOOR_MS = 1000;
const HOST = 'betgaffer.com';
const SUCCESS = { ok: true, message: "You're on the list. We'll email you when your invite is ready." };
const MSG = {
  adult: 'Please confirm you are 18 or over.',
  email: 'Please enter a valid email address.',
  slow: 'Too many attempts — try again in an hour.',
  down: 'The waitlist is temporarily unavailable.',
};
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const keyOf = (email) => `e:${sha(email.trim().toLowerCase())}`;
const ch = (code) => String.fromCharCode(code);

// ─── fakes ──────────────────────────────────────────────────────────────────────────────────────

class FakeKV {
  constructor() {
    this.store = new Map();
    this.ops = [];
    this.failGet = null;   // (key) => boolean
    this.failPut = null;   // (key) => boolean
    this.failList = false;
    this.putError = 'KV put() limit exceeded for the day.';
    this.pageSize = 1000;  // KV may return fewer keys than `limit`; tests shrink this to force pages
    this.clock = null;     // a fake clock the ops advance, to model KV latency
    this.opCost = 0;
    // Real KV allows one write per second per key: a second put to a key already written in this
    // "second" fails with 429. Off unless a test turns it on.
    this.sameKeyLimit = false;
    this.written = new Set();
    // A barrier: the first `holdGets` gets wait for each other, so racing joins both read "absent".
    this.holdGets = 0;
    this.waiting = [];
  }

  tick() { if (this.clock) this.clock.now += this.opCost; }

  async get(key) {
    this.ops.push(['get', key]);
    this.tick();
    if (this.holdGets > 0) {
      const absent = !this.store.has(key);
      await new Promise((resolve) => {
        this.waiting.push(resolve);
        if (this.waiting.length >= this.holdGets) { this.holdGets = 0; this.waiting.splice(0).forEach((r) => r()); }
      });
      if (absent) return null; // both racers read before either wrote
    }
    if (this.failGet && this.failGet(key)) throw new Error('KV GET failed: 500 Internal Server Error');
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async put(key, value, opts) {
    this.ops.push(['put', key, opts]);
    this.tick();
    if (this.sameKeyLimit && this.written.has(key)) {
      throw new Error('KV PUT failed: 429 Too Many Requests');
    }
    this.written.add(key);
    if (this.failPut && this.failPut(key)) throw new Error(this.putError);
    if (typeof value !== 'string') throw new TypeError('fake KV stores strings only');
    this.store.set(key, value);
  }

  async list({ prefix = '', limit = 1000, cursor } = {}) {
    this.ops.push(['list', prefix, limit, cursor]);
    this.tick();
    if (this.failList) throw new Error('KV list failed');
    const names = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const n = Math.min(limit, this.pageSize);
    const keys = names.slice(start, start + n).map((name) => ({ name }));
    const end = start + keys.length;
    return end >= names.length ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(end) };
  }

  puts() { return this.ops.filter((o) => o[0] === 'put'); }
  count(op) { return this.ops.filter((o) => o[0] === op).length; }
}

// A caches.default stand-in honouring Cache-Control max-age against Date.now().
class FakeCache {
  constructor() {
    this.entries = new Map();
    this.fail = false;
  }

  static key(req) {
    const r = typeof req === 'string' ? new Request(req) : req;
    if (r.method !== 'GET') throw new TypeError('Cache API keys must be GET requests');
    const u = new URL(r.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TypeError('Cache API keys must be http(s)');
    return u.href;
  }

  async match(req) {
    if (this.fail) throw new Error('cache unavailable');
    const k = FakeCache.key(req);
    const e = this.entries.get(k);
    if (!e) return undefined;
    if (Date.now() >= e.expires) { this.entries.delete(k); return undefined; }
    return new Response(e.body, { status: e.status, headers: e.headers });
  }

  async put(req, res) {
    if (this.fail) throw new Error('cache unavailable');
    const cc = res.headers.get('Cache-Control') || '';
    if (/no-store/i.test(cc)) throw new TypeError('refusing to cache a no-store response');
    const m = /max-age=(\d+)/i.exec(cc);
    if (!m) throw new TypeError('test stub requires max-age');
    const body = await res.text();
    this.entries.set(FakeCache.key(req), {
      body, status: res.status, headers: [...res.headers], expires: Date.now() + Number(m[1]) * 1000, maxAge: Number(m[1]),
    });
  }

  rateBuckets() { return [...this.entries.keys()].filter((k) => k.includes('/__waitlist/rl/')); }
  flag() { return this.entries.get(`${ORIGIN}/__waitlist/kv-down`); }
}

function installCache() {
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  return cache;
}
afterEach(() => {
  delete globalThis.caches;
  mock.timers.reset();
});

function env(kv = new FakeKV(), extra = {}) {
  return { WAITLIST: kv, WAITLIST_SECRET: SECRET, WAITLIST_HOST: HOST, ...extra };
}

/** A fake clock whose sleep advances it instantly; `slept` records every floor wait. */
function fakeTiming() {
  const clock = { now: 0, slept: [] };
  clock.timing = {
    now: () => clock.now,
    sleep: async (ms) => { clock.slept.push(ms); clock.now += ms; },
  };
  return clock;
}

/**
 * Run a handler with a Pages-like context. waitUntil promises are collected and awaited before the
 * response is handed back, so the next request sees every deferred cache write.
 */
async function run(handler, request, e, { clock = fakeTiming(), waitUntil = true } = {}) {
  const pending = [];
  const context = {
    request, env: e, params: {}, data: {}, next() { throw new Error('no next'); },
    __waitlistTiming: clock.timing,
  };
  if (waitUntil) context.waitUntil = (p) => { pending.push(p); };
  const res = await handler(context);
  await Promise.all(pending);
  res.pending = pending.length;
  return res;
}

/**
 * A POST to the endpoint. `fields` overrides the default valid form; `headers` values of null drop
 * that header. JSON-accepting by default; `js: false` is the no-JS form post.
 */
function postReq({ fields = {}, body, headers = {}, js = true, ip = IP } = {}) {
  const h = new Headers();
  h.set('Accept', js ? 'application/json' : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8');
  h.set('Origin', ORIGIN);
  if (ip !== null) h.set('CF-Connecting-IP', ip);
  for (const [k, v] of Object.entries(headers)) {
    if (v === null) h.delete(k); else h.set(k, v);
  }
  const b = body !== undefined
    ? body
    : new URLSearchParams({ email: 'ada@example.com', adult: 'yes', bg_ref: '', ...fields });
  return new Request(ENDPOINT, { method: 'POST', headers: h, body: b });
}

const post = (e, opts = {}) => run(onRequestPost, postReq(opts), e, opts);
const get = (e, opts = {}) => run(onRequestGet, new Request(ENDPOINT, { headers: { Accept: 'application/json' } }), e, opts);

async function snap(res) {
  return { status: res.status, headers: [...res.headers].sort(), body: await res.text() };
}

function assertHardened(res, label = '') {
  assert.equal(res.headers.get('Cache-Control'), 'no-store', `Cache-Control ${label}`);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff', `nosniff ${label}`);
}

async function assertJson(res, status, message) {
  assert.equal(res.status, status);
  assertHardened(res, `(${status})`);
  assert.match(res.headers.get('Content-Type'), /^application\/json/);
  const j = await res.json();
  assert.equal(j.message, message);
  assert.equal(j.ok, status === 200);
  return j;
}

function seed(kv, n) {
  for (let i = 0; i < n; i += 1) kv.store.set(`e:${sha(`seed${i}@example.com`)}`, JSON.stringify({ email: `seed${i}@example.com`, ts: '2026-10-07T00:00:00.000Z' }));
}

// ─── POST: success and storage ──────────────────────────────────────────────────────────────────

test('a new address is stored as exactly {email, ts} under a hashed key: one KV write, no counter', async () => {
  const kv = new FakeKV();
  const before = Date.now();
  const res = await post(env(kv));
  assert.deepEqual(await assertJson(res, 200, SUCCESS.message), SUCCESS);

  const key = keyOf('ada@example.com');
  assert.deepEqual([...kv.store.keys()], [key]);
  assert.equal(kv.puts().length, 1, 'exactly one KV write per new sign-up');
  const value = JSON.parse(kv.store.get(key));
  assert.deepEqual(Object.keys(value).sort(), ['email', 'ts']);
  assert.equal(value.email, 'ada@example.com');
  assert.match(value.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  assert.ok(Date.parse(value.ts) >= before - 1000 && Date.parse(value.ts) <= Date.now() + 1000);
});

test('the key is the sha256 of the fully lower-cased address; the address is stored as typed (trimmed)', async () => {
  const kv = new FakeKV();
  await post(env(kv), { fields: { email: '  Ada.Obi@Example.COM  ' } });
  assert.deepEqual([...kv.store.keys()], [`e:${sha('ada.obi@example.com')}`]);
  assert.equal(JSON.parse(kv.store.get(keyOf('ada.obi@example.com'))).email, 'Ada.Obi@Example.COM');

  // A@x.com then a@x.com: one key, and the second is treated as existing (no write)
  const kv2 = new FakeKV();
  await post(env(kv2), { fields: { email: 'A@x.com' } });
  const writes = kv2.puts().length;
  await post(env(kv2), { fields: { email: 'a@x.com' } });
  assert.equal(kv2.puts().length, writes);
  assert.deepEqual([...kv2.store.keys()], [`e:${sha('a@x.com')}`]);
  assert.equal(JSON.parse(kv2.store.get(`e:${sha('a@x.com')}`)).email, 'A@x.com');
});

test('JSON bodies are accepted as well as form posts', async () => {
  const kv = new FakeKV();
  const res = await post(env(kv), {
    body: JSON.stringify({ email: 'json@example.com', adult: 'yes', bg_ref: '' }),
    headers: { 'Content-Type': 'application/json' },
  });
  await assertJson(res, 200, SUCCESS.message);
  assert.ok(kv.store.has(keyOf('json@example.com')));
});

// ─── test 10: enumeration ───────────────────────────────────────────────────────────────────────

test('ENUMERATION: a new and an existing address get identical status, headers and body (JSON)', async () => {
  const kv = new FakeKV();
  const first = await snap(await post(env(kv)));
  const putsAfterFirst = kv.puts().length;
  const second = await snap(await post(env(kv)));
  assert.deepEqual(second, first);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body), SUCCESS);
  assert.equal(kv.puts().length, putsAfterFirst, 'an existing address writes nothing');
});

test('ENUMERATION: a new and an existing address get identical 303s on the no-JS path', async () => {
  const kv = new FakeKV();
  const first = await snap(await post(env(kv), { js: false }));
  const second = await snap(await post(env(kv), { js: false }));
  assert.deepEqual(second, first);
  assert.equal(first.status, 303);
  assert.ok(first.headers.some(([k, v]) => k === 'location' && v === '/waitlist/thanks/'));
});

test('ENUMERATION (C1): once a KV write fails, new and existing addresses get identical 503s', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T21:30:00Z') });
  const cache = installCache();
  const kv = new FakeKV();
  await post(env(kv), { fields: { email: 'existing@example.com' }, ip: '192.0.2.10' });
  assert.ok(kv.store.has(keyOf('existing@example.com')));

  kv.failPut = () => true; // the daily write limit is exhausted
  const fresh = await snap(await post(env(kv), { fields: { email: 'new1@example.com' }, ip: '192.0.2.11' }));
  assert.equal(fresh.status, 503);
  assert.deepEqual(JSON.parse(fresh.body), { ok: false, message: MSG.down });

  const gets = kv.count('get');
  const existing = await snap(await post(env(kv), { fields: { email: 'existing@example.com' }, ip: '192.0.2.12' }));
  const fresh2 = await snap(await post(env(kv), { fields: { email: 'new2@example.com' }, ip: '192.0.2.13' }));
  assert.deepEqual(existing, fresh);
  assert.deepEqual(fresh2, fresh);
  assert.equal(kv.count('get'), gets, 'the kv-down flag is checked BEFORE the record is read');

  // a limit error holds the flag until the next 00:00 UTC (2h30m away)
  assert.equal(cache.flag().maxAge, 2.5 * 3600);
  // no-JS: identical 303s too
  const a = await snap(await post(env(kv), { js: false, fields: { email: 'existing@example.com' }, ip: '192.0.2.14' }));
  const b = await snap(await post(env(kv), { js: false, fields: { email: 'new3@example.com' }, ip: '192.0.2.15' }));
  assert.deepEqual(a, b);
  assert.equal(a.status, 303);
  assert.ok(a.headers.some(([k, v]) => k === 'location' && v === '/waitlist/unavailable/'));
});

test('C1: a non-limit write error holds the kv-down flag for 60 s, then joins resume', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T10:00:00Z') });
  const cache = installCache();
  const kv = new FakeKV();
  kv.store.set(keyOf('existing@example.com'), JSON.stringify({ email: 'existing@example.com', ts: 'x' }));
  kv.putError = 'KV PUT failed: 500 Internal Server Error';
  kv.failPut = () => true;
  assert.equal((await post(env(kv), { fields: { email: 'new@example.com' } })).status, 503);
  assert.equal(cache.flag().maxAge, 60);
  assert.equal((await post(env(kv), { fields: { email: 'existing@example.com' } })).status, 503);
  kv.failPut = null;
  mock.timers.tick(61 * 1000);
  assert.equal((await post(env(kv), { fields: { email: 'existing@example.com' } })).status, 200);
});

test('honeypot (bg_ref): a filled field gets the normal success and stores nothing', async () => {
  const real = await snap(await post(env(new FakeKV()), { fields: { email: 'real@example.com' } }));
  const kv = new FakeKV();
  const bot = await snap(await post(env(kv), { fields: { email: 'bot@example.com', bg_ref: 'http://spam.example' } }));
  assert.deepEqual(bot, real);
  assert.equal(kv.puts().length, 0);
  assert.equal(kv.store.size, 0);
  const kv2 = new FakeKV();
  const r = await post(env(kv2), { js: false, fields: { bg_ref: 'x' } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('Location'), '/waitlist/thanks/');
  assert.equal(kv2.store.size, 0);
});

// ─── I1: minimum response time ──────────────────────────────────────────────────────────────────

test('TIMING (I1): success and 503 outcomes on the join path all take at least 1000 ms', async () => {
  // KV latency is modelled at 120 ms per op: an existing address costs one read, a new one a read
  // and a write. Without the floor the two would differ by 120 ms.
  const outcomes = {};
  const timed = async (label, setup, opts) => {
    const clock = fakeTiming();
    const kv = new FakeKV();
    kv.clock = clock;
    kv.opCost = 120;
    setup(kv);
    const res = await post(env(kv), { ...opts, clock });
    outcomes[label] = { status: res.status, end: clock.now, slept: clock.slept };
  };
  await timed('new', () => {});
  await timed('existing', (kv) => kv.store.set(keyOf('ada@example.com'), '{"email":"ada@example.com","ts":"x"}'));
  await timed('honeypot', () => {}, { fields: { bg_ref: 'x' } });
  await timed('put-503', (kv) => { kv.failPut = () => true; });
  await timed('get-503', (kv) => { kv.failGet = () => true; });
  for (const [label, o] of Object.entries(outcomes)) {
    assert.ok([200, 503].includes(o.status), label);
    assert.equal(o.end, FLOOR_MS, `${label} ends at the floor (slept ${o.slept})`);
    assert.equal(o.slept.length, 1, `${label} slept once`);
  }
  assert.equal(outcomes.new.slept[0], FLOOR_MS - 240);
  assert.equal(outcomes.existing.slept[0], FLOOR_MS - 120);

  // unconfigured 503 is floored too; an outcome already past the floor does not sleep
  const c1 = fakeTiming();
  assert.equal((await post({}, { clock: c1 })).status, 503);
  assert.equal(c1.now, FLOOR_MS);
  const c2 = fakeTiming();
  const slow = new FakeKV();
  slow.clock = c2;
  slow.opCost = 500;
  assert.equal((await post(env(slow), { clock: c2 })).status, 200);
  assert.deepEqual(c2.slept, []);
});

test('TIMING (I1): the real default sleep is used when no clock is injected', async () => {
  const t0 = performance.now();
  const res = await onRequestPost({ request: postReq({ fields: { email: 'real-clock@example.com' } }), env: env() });
  assert.equal(res.status, 200);
  assert.ok(performance.now() - t0 >= FLOOR_MS - 20, `took ${performance.now() - t0} ms`);
});

// ─── validation ─────────────────────────────────────────────────────────────────────────────────

test('missing or wrong 18+ confirmation → 400, nothing stored', async () => {
  for (const adult of [undefined, '', 'no', 'YES ', 'on', 'true']) {
    const kv = new FakeKV();
    const fields = { email: 'ada@example.com', bg_ref: '' };
    if (adult !== undefined) fields.adult = adult;
    const res = await post(env(kv), { body: new URLSearchParams(fields) });
    await assertJson(res, 400, MSG.adult);
    assert.equal(kv.store.size, 0, `adult=${JSON.stringify(adult)}`);
  }
});

test('malformed, formula-leading and non-ASCII addresses → 400, nothing stored (I3)', async () => {
  const bad = [
    '', '   ', 'ada', 'ada@', '@example.com', 'ada@example', 'ada@example.c', 'ada@@example.com',
    'a da@example.com', 'ada@exa mple.com', 'ada@example.com.', 'ada@.example.com', 'ada@example..com',
    'ada@-example.com', 'ada@example-.com', 'ada@example.c0m',
    '=HYPERLINK("x")@example.com', '=ada@example.com', '+ada@example.com', '-ada@example.com', '@ada@example.com',
    'ada,obi@example.com', 'ada@example,com', '"ada"@example.com', 'ada"@example.com', '<ada>@example.com',
    'ada@exa<mple.com', 'ada(x)@example.com', 'ada;x@example.com', 'ada\\x@example.com', 'ada:x@example.com',
    `ada${ch(0x202e)}moc@example.com`, `ada@example.com${ch(0x2028)}`, `ada${ch(0x2028)}x@example.com`,
    `ada@example.com${ch(0x2029)}`, `${ch(0xfeff)}ada@example.com`, `ada@example.com${ch(0xa0)}`,
    `ad${ch(0xe1)}@example.com`, `ada@ex${ch(0xe1)}mple.com`, `ada@${ch(0x0435)}xample.com`,
    `ada${ch(0)}@example.com`, `ada${ch(7)}x@example.com`, `ada${ch(0x7f)}@example.com`,
    `${'a'.repeat(243)}@example.com`, // 255 chars
  ];
  assert.equal(bad.at(-1).length, 255);
  for (const email of bad) {
    const kv = new FakeKV();
    const res = await post(env(kv), { fields: { email } });
    await assertJson(res, 400, MSG.email);
    assert.equal(kv.store.size, 0, `stored ${JSON.stringify(email)}`);
  }
  // premise: valid shapes, including the 254-char boundary, are accepted
  for (const email of [`${'a'.repeat(242)}@example.com`, 'ada+wl@example.com.ng', "o'brien@mail.example.org",
    'a.b_c-d@sub-1.example.io', 'x=y@example.com']) {
    const kv = new FakeKV();
    await assertJson(await post(env(kv), { fields: { email } }), 200, SUCCESS.message);
    assert.equal(kv.store.size, 1, email);
  }
});

test('a JSON body with non-string fields or a non-object body → 400, nothing stored', async () => {
  for (const body of ['{"email":["a@example.com"],"adult":"yes"}', '{"email":"a@example.com","adult":true}', '[]', 'null', '{bad']) {
    const kv = new FakeKV();
    const res = await post(env(kv), { body, headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 400, body);
    assertHardened(res);
    assert.equal(kv.store.size, 0);
  }
});

test('a 3 KB body → 413 whether or not Content-Length declares it; 2048 bytes is accepted', async () => {
  const pad = (n) => {
    const base = new URLSearchParams({ email: 'ada@example.com', adult: 'yes', bg_ref: '', pad: '' }).toString();
    return base + 'x'.repeat(n - base.length);
  };
  const kv = new FakeKV();
  let res = await post(env(kv), { body: pad(3072), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 413);
  assertHardened(res);
  res = await post(env(kv), { body: pad(3072), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '3072' } });
  assert.equal(res.status, 413);
  assert.equal(kv.store.size, 0);
  res = await post(env(kv), { body: pad(2048), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  await assertJson(res, 200, SUCCESS.message);
});

test('an unsupported content type → 415', async () => {
  const res = await post(env(), { body: 'email=ada@example.com&adult=yes', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(res.status, 415);
  assertHardened(res);
});

test('a cross-origin POST → 403; same-origin and absent Origin are accepted', async () => {
  for (const origin of ['https://evil.example', 'http://betgaffer.com', 'https://betgaffer.com.evil.example', 'null']) {
    const kv = new FakeKV();
    const res = await post(env(kv), { headers: { Origin: origin } });
    assert.equal(res.status, 403, origin);
    assertHardened(res);
    assert.equal(kv.store.size, 0);
  }
  await assertJson(await post(env(), { headers: { Origin: null } }), 200, SUCCESS.message);
});

// ─── configuration and storage failures: never a fake success ───────────────────────────────────

test('missing KV binding, secret (or a short secret) or host → 503 on POST and GET', async () => {
  const cases = [
    { WAITLIST_SECRET: SECRET, WAITLIST_HOST: HOST },
    { WAITLIST: new FakeKV(), WAITLIST_HOST: HOST },
    { WAITLIST: new FakeKV(), WAITLIST_SECRET: 'too-short', WAITLIST_HOST: HOST },
    { WAITLIST: new FakeKV(), WAITLIST_SECRET: '', WAITLIST_HOST: HOST },
    { WAITLIST: new FakeKV(), WAITLIST_SECRET: SECRET },
    { WAITLIST: new FakeKV(), WAITLIST_SECRET: SECRET, WAITLIST_HOST: '' },
    {},
  ];
  // premise: the same env with the host present works
  await assertJson(await post({ WAITLIST: new FakeKV(), WAITLIST_SECRET: SECRET, WAITLIST_HOST: HOST }), 200, SUCCESS.message);
  for (const e of cases) {
    await assertJson(await post(e), 503, MSG.down);
    await assertJson(await get(e), 503, MSG.down);
    const nojs = await post(e, { js: false });
    assert.equal(nojs.status, 303);
    assert.equal(nojs.headers.get('Location'), '/waitlist/unavailable/');
  }
});

test('HOST (I2): off the configured host (e.g. <project>.pages.dev) joins and places → 503, floored', async () => {
  const cache = installCache();
  for (const origin of ['https://betgaffer-site.pages.dev', 'https://abc123.betgaffer-site.pages.dev', 'https://www.betgaffer.com']) {
    const kv = new FakeKV();
    const mk = (js) => {
      const h = { Accept: js ? 'application/json' : 'text/html', Origin: origin, 'CF-Connecting-IP': IP };
      return new Request(`${origin}/api/waitlist`, { method: 'POST', headers: h, body: new URLSearchParams({ email: 'ada@example.com', adult: 'yes', bg_ref: '' }) });
    };
    const clock = fakeTiming();
    const res = await run(onRequestPost, mk(true), env(kv), { clock });
    await assertJson(res, 503, MSG.down);
    assert.equal(clock.now, FLOOR_MS, `${origin}: the floor applies`);
    const nojs = await run(onRequestPost, mk(false), env(kv));
    assert.equal(nojs.status, 303);
    assert.equal(nojs.headers.get('Location'), '/waitlist/unavailable/');
    const g = await run(onRequestGet, new Request(`${origin}/api/waitlist`), env(kv));
    await assertJson(g, 503, MSG.down);
    assert.equal(kv.ops.length, 0, `${origin}: KV untouched`);
  }
  assert.equal(cache.entries.size, 0, 'no rate-limit bucket, flag or places entry off-host');
  // the configured host is matched case-insensitively from the env value
  await assertJson(await post(env(new FakeKV(), { WAITLIST_HOST: ' BetGaffer.com ' })), 200, SUCCESS.message);
});

test('RACE (re-review I1): two simultaneous joins for the same NEW address both succeed identically', async () => {
  const cache = installCache();
  const kv = new FakeKV();
  kv.sameKeyLimit = true;
  kv.holdGets = 2;
  const [a, b] = await Promise.all([
    post(env(kv), { fields: { email: 'twin@example.com' }, ip: '192.0.2.21' }),
    post(env(kv), { fields: { email: 'twin@example.com' }, ip: '192.0.2.22' }),
  ]);
  assert.equal(kv.puts().length, 2, 'premise: both racers wrote, and the second write hit the per-key limit');
  const sa = await snap(a);
  assert.equal(sa.status, 200);
  assert.deepEqual(await snap(b), sa);
  assert.equal(cache.flag(), undefined, 'a same-key 429 is not an outage: no kv-down flag');
  assert.ok(kv.store.has(keyOf('twin@example.com')));
  // and the next join for anyone still works
  await assertJson(await post(env(kv), { fields: { email: 'after@example.com' }, ip: '192.0.2.23' }), 200, SUCCESS.message);
});

test('RACE: a put rejected with 429 / Too Many Requests is a success without the flag; other errors are not', async () => {
  for (const msg of ['KV PUT failed: 429 Too Many Requests', 'too many requests', 'HTTP 429']) {
    const cache = installCache();
    const kv = new FakeKV();
    kv.failPut = () => true;
    kv.putError = msg;
    await assertJson(await post(env(kv)), 200, SUCCESS.message);
    assert.equal(cache.flag(), undefined, msg);
  }
  // premise: a daily-limit error still refuses and sets the flag
  const cache = installCache();
  const kv = new FakeKV();
  kv.failPut = () => true;
  await assertJson(await post(env(kv)), 503, MSG.down);
  assert.ok(cache.flag());
});

test('TIMING: an unexpected throw inside join is a floored 503, never an unhandled error', async () => {
  const throwing = {
    WAITLIST: new FakeKV(),
    WAITLIST_HOST: HOST,
    get WAITLIST_SECRET() { throw new Error('binding exploded'); },
  };
  const clock = fakeTiming();
  await assertJson(await post(throwing, { clock }), 503, MSG.down);
  assert.equal(clock.now, FLOOR_MS);
  const nojs = await post(throwing, { js: false });
  assert.equal(nojs.status, 303);
  assert.equal(nojs.headers.get('Location'), '/waitlist/unavailable/');
});

test('KV failures (the record read, the record write, the daily write limit) → 503, never success', async () => {
  const scenarios = [
    (kv) => { kv.failGet = () => true; },
    (kv) => { kv.failPut = () => true; },
    (kv) => { kv.failPut = () => true; kv.putError = 'KV PUT failed: 500'; },
  ];
  for (const arm of scenarios) {
    const kv = new FakeKV();
    arm(kv);
    await assertJson(await post(env(kv)), 503, MSG.down);
    const nojs = await post(env(kv), { js: false, fields: { email: 'other@example.com' } });
    assert.equal(nojs.status, 303);
    assert.equal(nojs.headers.get('Location'), '/waitlist/unavailable/');
  }
});

// ─── rate limit (Cache-API backstop) ────────────────────────────────────────────────────────────

test('RATE LIMIT: the 21st attempt from one IP within the hour → 429; nothing IP-derived reaches KV', async () => {
  const cache = installCache();
  const kv = new FakeKV();
  for (let i = 1; i <= 20; i += 1) {
    const res = await post(env(kv), { fields: { email: `user${i}@example.com` } });
    assert.equal(res.status, 200, `attempt ${i}`);
  }
  await assertJson(await post(env(kv), { fields: { email: 'user21@example.com' } }), 429, MSG.slow);
  assert.ok(!kv.store.has(keyOf('user21@example.com')), 'the limited attempt stored nothing');
  const nojs = await post(env(kv), { js: false, fields: { email: 'user22@example.com' } });
  assert.equal(nojs.status, 303);
  assert.equal(nojs.headers.get('Location'), '/waitlist/slow-down/');

  await assertJson(await post(env(kv), { ip: '198.51.100.9', fields: { email: 'other@example.com' } }), 200, SUCCESS.message);

  assert.equal(kv.store.size, 21);
  for (const [k, v] of kv.store) {
    assert.match(k, /^e:[0-9a-f]{64}$/);
    assert.ok(!k.includes(IP) && !v.includes(IP), `IP found in ${k}`);
    assert.deepEqual(Object.keys(JSON.parse(v)).sort(), ['email', 'ts']);
  }
  assert.ok(cache.entries.size >= 1);
  for (const [k, e] of cache.entries) {
    assert.ok(!k.includes(IP) && !e.body.includes(IP), `raw IP in cache entry ${k}`);
    assert.ok(e.maxAge > 0 && e.maxAge <= 3600, `max-age ${e.maxAge}`);
  }
});

test('RATE LIMIT (I2): IPv6 addresses share a bucket per /56, whatever the notation', async () => {
  const cache = installCache();
  const kv = new FakeKV();
  // rotate both the interface ID and the subnet byte (low byte of group 3) inside 2001:db8:1:200::/56
  for (let i = 1; i <= 20; i += 1) {
    const ip = `2001:db8:1:2${(i * 12).toString(16).padStart(2, '0')}::${i.toString(16)}`;
    assert.equal((await post(env(kv), { ip, fields: { email: `v6-${i}@example.com` } })).status, 200, ip);
  }
  assert.equal(cache.rateBuckets().length, 1, 'one bucket for the whole /56');
  for (const ip of ['2001:db8:1:2ff:ffff:ffff:ffff:ffff', '2001:0DB8:0001:0200:a:b:c:d', '2001:db8:1:200::', '2001:db8:1:2a0:0:0:0:1%eth0']) {
    assert.equal((await post(env(kv), { ip, fields: { email: 'rotated@example.com' } })).status, 429, ip);
  }
  // a different /56 is a different bucket: the high byte of group 3 or an earlier group differs
  assert.equal((await post(env(kv), { ip: '2001:db8:1:300::1', fields: { email: 'next56@example.com' } })).status, 200);
  assert.equal((await post(env(kv), { ip: '2001:db8::1', fields: { email: 'zero56@example.com' } })).status, 200);
  assert.equal(cache.rateBuckets().length, 3);
  // IPv4 buckets stay per address
  assert.equal((await post(env(kv), { ip: '192.0.2.1', fields: { email: 'v4a@example.com' } })).status, 200);
  assert.equal((await post(env(kv), { ip: '192.0.2.2', fields: { email: 'v4b@example.com' } })).status, 200);
  assert.equal(cache.rateBuckets().length, 5);
  for (const k of cache.entries.keys()) assert.ok(!/2001|db8|192\.0\.2/i.test(k), `raw address in cache key ${k}`);
});

test('RATE LIMIT: the window closes after an hour', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T10:00:00Z') });
  installCache();
  const kv = new FakeKV();
  for (let i = 0; i < 20; i += 1) await post(env(kv), { fields: { email: `w${i}@example.com` } });
  assert.equal((await post(env(kv), { fields: { email: 'late@example.com' } })).status, 429);
  mock.timers.tick(59 * 60 * 1000);
  assert.equal((await post(env(kv), { fields: { email: 'late@example.com' } })).status, 429);
  mock.timers.tick(61 * 1000);
  assert.equal((await post(env(kv), { fields: { email: 'late@example.com' } })).status, 200);
});

test('RATE LIMIT: invalid attempts count too (a flood of junk is throttled)', async () => {
  installCache();
  const kv = new FakeKV();
  for (let i = 0; i < 20; i += 1) assert.equal((await post(env(kv), { fields: { email: 'nope' } })).status, 400);
  assert.equal((await post(env(kv))).status, 429);
});

test('without caches.default (or with a failing cache) the backstop is skipped, not fatal', async () => {
  const kv = new FakeKV();
  for (let i = 0; i < 25; i += 1) {
    assert.equal((await post(env(kv), { fields: { email: `n${i}@example.com` } })).status, 200);
  }
  const cache = installCache();
  cache.fail = true;
  for (let i = 0; i < 25; i += 1) {
    assert.equal((await post(env(kv), { fields: { email: `f${i}@example.com` } })).status, 200);
  }
  assert.equal(kv.store.size, 50);
});

test('cache writes go through waitUntil when it exists, and are awaited inline when it does not', async () => {
  installCache();
  const kv = new FakeKV();
  const a = await post(env(kv), { fields: { email: 'wu1@example.com' } });
  assert.ok(a.pending >= 1, 'the rate-limit counter write was handed to waitUntil');
  const g = await get(env(kv));
  assert.ok(g.pending >= 1, 'the places cache write was handed to waitUntil');

  const cache = installCache();
  const b = await post(env(new FakeKV()), { fields: { email: 'wu2@example.com' }, waitUntil: false });
  assert.equal(b.status, 200);
  assert.equal(cache.rateBuckets().length, 1, 'written inline without waitUntil');
});

// ─── response shape ─────────────────────────────────────────────────────────────────────────────

test('no-JS path: every outcome is a 303 to its result page, hardened', async () => {
  installCache();
  const cases = [
    [{}, '/waitlist/thanks/'],
    [{ fields: { email: 'bad' } }, '/waitlist/invalid/'],
    [{ fields: { adult: '' } }, '/waitlist/invalid/'],
    [{ headers: { Origin: 'https://evil.example' } }, '/waitlist/invalid/'],
    [{ body: 'x'.repeat(3000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, '/waitlist/invalid/'],
    [{ body: 'hi', headers: { 'Content-Type': 'text/plain' } }, '/waitlist/invalid/'],
  ];
  for (const [opts, loc] of cases) {
    const res = await post(env(), { ...opts, js: false, ip: '192.0.2.1' });
    assert.equal(res.status, 303, loc);
    assert.equal(res.headers.get('Location'), loc);
    assertHardened(res, loc);
    assert.equal(await res.text(), '');
  }
});

test('the Function never logs an email address or an IP', async () => {
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  for (const m of methods) mock.method(console, m, (...a) => { lines.push(a.map(String).join(' ')); });
  try {
    installCache();
    const kv = new FakeKV();
    await post(env(kv), { fields: { email: 'secret.person@example.com' } });
    kv.failPut = () => true;
    await post(env(kv), { fields: { email: 'secret.person2@example.com' } });
    kv.failGet = () => true;
    kv.failList = true;
    await get(env(kv));
    await post(env(kv), { fields: { email: 'bad' } });
  } finally {
    for (const m of methods) console[m].mock.restore();
  }
  for (const l of lines) {
    assert.ok(!/secret\.person/.test(l), `logged an email: ${l}`);
    assert.ok(!l.includes(IP), `logged an IP: ${l}`);
  }
});

// ─── GET: places left (list-based) ──────────────────────────────────────────────────────────────

test('GET places_left = max(0, 500 − number of e: keys), floored at 0, hardened', async () => {
  for (const [n, left] of [[0, 500], [1, 499], [123, 377], [499, 1], [500, 0], [731, 0]]) {
    const kv = new FakeKV();
    seed(kv, n);
    kv.store.set('meta:count', '9999'); // a stray non-record key is not counted
    const res = await get(env(kv));
    assert.equal(res.status, 200);
    assertHardened(res);
    assert.deepEqual(await res.json(), { places_left: left, cap: 500 }, `n=${n}`);
    for (const op of kv.ops.filter((o) => o[0] === 'list')) {
      assert.equal(op[1], 'e:');
      assert.equal(op[2], 1000);
    }
  }
});

test('GET paginates only until 500 records are counted', async () => {
  let kv = new FakeKV();
  seed(kv, 731);
  kv.pageSize = 100;
  assert.deepEqual(await (await get(env(kv))).json(), { places_left: 0, cap: 500 });
  assert.equal(kv.count('list'), 5, 'stops at the page that reaches 500');

  kv = new FakeKV();
  seed(kv, 123);
  kv.pageSize = 100;
  assert.deepEqual(await (await get(env(kv))).json(), { places_left: 377, cap: 500 });
  assert.equal(kv.count('list'), 2, 'follows the cursor to list_complete');
});

test('GET is cached for 600 s via the Cache API, and the client still sees no-store', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T10:00:00Z') });
  const cache = installCache();
  const kv = new FakeKV();
  seed(kv, 10);
  assert.deepEqual(await (await get(env(kv))).json(), { places_left: 490, cap: 500 });
  seed(kv, 11);
  const lists = kv.count('list');
  mock.timers.tick(599 * 1000);
  const cached = await get(env(kv));
  assertHardened(cached);
  assert.deepEqual(await cached.json(), { places_left: 490, cap: 500 });
  assert.equal(kv.count('list'), lists, 'served from cache without a KV list');
  assert.ok([...cache.entries.values()].some((e) => e.maxAge === 600));
  mock.timers.tick(2 * 1000);
  assert.deepEqual(await (await get(env(kv))).json(), { places_left: 489, cap: 500 });
});

test('GET: a KV list error → 503', async () => {
  const kv = new FakeKV();
  kv.failList = true;
  await assertJson(await get(env(kv)), 503, MSG.down);
});

test('GET: a failed list is remembered for 60 s — 503 without re-listing, then a fresh count', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T10:00:00Z') });
  const cache = installCache();
  const kv = new FakeKV();
  seed(kv, 7);
  kv.failList = true;
  await assertJson(await get(env(kv)), 503, MSG.down);
  assert.equal(kv.count('list'), 1);
  assert.ok([...cache.entries.values()].some((e) => e.maxAge === 60), 'the failure marker lives 60 s');
  kv.failList = false;
  mock.timers.tick(59 * 1000);
  await assertJson(await get(env(kv)), 503, MSG.down);
  assert.equal(kv.count('list'), 1, 'no re-list while the marker is live');
  mock.timers.tick(2 * 1000);
  assert.deepEqual(await (await get(env(kv))).json(), { places_left: 493, cap: 500 });
  assert.equal(kv.count('list'), 2);
});

test('the founding cap has one value everywhere: config, the form, the Function', async () => {
  assert.equal(FOUNDING_CAP, siteConfig.founding_places);
  const res = await get(env());
  assert.equal((await res.json()).cap, FOUNDING_CAP);
  assert.match(waitlistForm(), new RegExp(`>${FOUNDING_CAP} founding places<`));
});

test('the Function is self-contained for workerd: no node: imports, no require', () => {
  const src = readFileSync(new URL('../functions/api/waitlist.js', import.meta.url), 'utf8');
  assert.ok(!/\bfrom\s+['"]node:/.test(src) && !/\bimport\s*\(\s*['"]node:/.test(src), 'node: import');
  assert.ok(!/\brequire\s*\(/.test(src), 'require()');
  assert.ok(!/\bprocess\./.test(src) && !/\bBuffer\b/.test(src), 'node globals');
  assert.ok(!/console\.\w+\([^)]*\b(email|ip)\b/i.test(src), 'a console call mentions email/ip');
  assert.ok(!/meta:count/.test(src), 'no counter key: places are counted from the records');
});

// ─── the build-time form ────────────────────────────────────────────────────────────────────────

const visibleText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('waitlistForm(): a no-JS POST form with email, required 18+ box, honeypot, consent, status, places', () => {
  const html = waitlistForm();
  assert.match(html, /<form\b[^>]*\bmethod="post"[^>]*\baction="\/api\/waitlist"/);
  const email = /<input\b[^>]*\bname="email"[^>]*>/.exec(html)?.[0];
  assert.ok(email, 'email input');
  for (const a of ['type="email"', 'autocomplete="email"', 'required', 'maxlength="254"']) assert.ok(email.includes(a), a);
  const emailId = /\bid="([^"]+)"/.exec(email)[1];
  assert.match(html, new RegExp(`<label\\b[^>]*for="${emailId}"`));

  const adult = /<input\b[^>]*\bname="adult"[^>]*>/.exec(html)?.[0];
  assert.ok(adult, '18+ box');
  for (const a of ['type="checkbox"', 'value="yes"', 'required']) assert.ok(adult.includes(a), a);
  const adultId = /\bid="([^"]+)"/.exec(adult)[1];
  assert.match(html, new RegExp(`<label\\b[^>]*for="${adultId}"[^>]*>I am 18 or over</label>`));

  assert.ok(!/name="website"/.test(html), 'the honeypot is not named "website" (autofill bait for real users)');
  const hp = /<input\b[^>]*\bname="bg_ref"[^>]*>/.exec(html)?.[0];
  assert.ok(hp, 'honeypot');
  for (const a of ['tabindex="-1"', 'autocomplete="off"']) assert.ok(hp.includes(a), a);
  assert.ok(!hp.includes('required'));
  const hpId = /\bid="([^"]+)"/.exec(hp)[1];
  assert.match(html, new RegExp(`<div class="vh"[^>]*>\\s*<label for="${hpId}">Leave this empty</label>\\s*${hp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</div>`));

  assert.equal(CONSENT_TEXT, "We'll use this address only to tell you when your invite is ready. It is stored by Cloudflare "
    + 'in the United States, where data protection law may protect it less than Nigerian law does.');
  // NDPA s.43 informed consent: the transfer risk is stated next to the field, followed by the policy link
  assert.match(html, /<p class="bg-wl__consent">[^<]*Nigerian law does\. <a href="\/privacy\/">[^<]+<\/a>\.?<\/p>/);
  assert.ok(html.includes(escHtml(CONSENT_TEXT)));
  assert.match(html, /<a href="\/privacy\/">[^<]+<\/a>/);
  assert.match(html, /<button\b[^>]*type="submit"[^>]*class="bg-btn bg-btn--primary"[^>]*>Join the waitlist<\/button>/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<p\b[^>]*data-waitlist-places[^>]*>500 founding places<\/p>/);
});

test('waitlistForm(): CSP-clean, no date or countdown, banned-word clean', () => {
  const pages = [waitlistForm(), ...WAITLIST_RESULT_KINDS.map((k) => waitlistResultPage(k))];
  const banned = new RegExp(`\\b(sure bet|sure game|banker|guaranteed|fixed match|fixed game|can't lose|cannot lose|jackpot|make money|double your money|free bet|bonus code|cash out|win more|win rate|profitable|roi|profit|yield|staking|bankroll|tipster|punter|gambler|${INTERNAL}|tokens?|we win|we won|countdown|launches on|days? left|hours? left)\\b`, 'i');
  for (const html of pages) {
    assert.ok(!/<script\b/i.test(html) && !/<style\b/i.test(html) && !/\sstyle=/i.test(html), 'CSP');
    const text = visibleText(html);
    assert.ok(!banned.test(text), `banned: ${banned.exec(text)?.[0]}`);
    assert.ok(!/\b20\d\d\b|\b\d{1,2}:\d{2}\b|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text), 'a date');
    assert.ok(!/%/.test(text), 'a percentage');
  }
});

test('waitlistForm(): id prefixes keep two forms on one page distinct; a bad prefix throws', () => {
  const a = waitlistForm({ idPrefix: 'wl-top' });
  const b = waitlistForm({ idPrefix: 'wl-foot' });
  const ids = (h) => [...h.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids(a).filter((x) => ids(b).includes(x)).length, 0);
  assert.throws(() => waitlistForm({ idPrefix: '"><img' }), TypeError);
});

test('waitlistResultPage(kind) renders each no-JS result page; unknown kinds throw', () => {
  assert.deepEqual([...WAITLIST_RESULT_KINDS], ['thanks', 'invalid', 'slow-down', 'unavailable']);
  const expect = {
    thanks: "You're on the list",
    invalid: 'Please enter a valid email address',
    'slow-down': 'Too many attempts',
    unavailable: 'temporarily unavailable',
  };
  for (const kind of WAITLIST_RESULT_KINDS) {
    const body = waitlistResultPage(kind);
    assert.ok(visibleText(body).includes(expect[kind]), kind);
    assert.match(body, /<h1\b/);
    const meta = waitlistResultMeta(kind);
    assert.ok(typeof meta.title === 'string' && meta.title && typeof meta.description === 'string' && meta.description);
    assert.equal(meta.noindex, true);
    assert.equal(meta.path, `/waitlist/${kind}/`);
  }
  assert.match(waitlistResultPage('invalid'), /action="\/api\/waitlist"/);
  for (const bad of ['', 'Thanks', '../x', undefined, 'toString', '__proto__']) {
    assert.throws(() => waitlistResultPage(bad), TypeError, String(bad));
    assert.throws(() => waitlistResultMeta(bad), TypeError, String(bad));
  }
});

test('waitlist.css: every class the form uses is styled; the live region is never display:none', () => {
  const css = readFileSync(new URL('../site/assets/css/waitlist.css', import.meta.url), 'utf8');
  const html = [waitlistForm(), ...WAITLIST_RESULT_KINDS.map((k) => waitlistResultPage(k))].join('\n');
  const classes = new Set([...html.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const fromBase = new Set(['vh', 'bg-btn', 'bg-btn--primary', 'bg-btn--ghost', 't-lbl', 't-s', 't-b', 't-d2', 'mono']);
  for (const c of classes) {
    if (fromBase.has(c)) continue;
    assert.ok(css.includes(`.${c}`), `.${c} is not styled`);
  }
  assert.ok(!/@import|expression\(|url\(\s*['"]?https?:/i.test(css));
  // A role=status region removed from the accessibility tree while empty may not announce its
  // first message in some screen readers.
  for (const rule of css.matchAll(/([^{}]*\.bg-wl__status[^{}]*)\{([^}]*)\}/g)) {
    assert.ok(!/display\s*:\s*none|visibility\s*:\s*hidden/i.test(rule[2]), `hides the live region: ${rule[1].trim()}`);
  }
});

// ─── the browser module ─────────────────────────────────────────────────────────────────────────

test('placesText: "n of 500 founding places left", the at-capacity line, null for nonsense', () => {
  assert.equal(placesText({ places_left: 377, cap: 500 }), '377 of 500 founding places left');
  assert.equal(placesText({ places_left: 1, cap: 500 }), '1 of 500 founding places left');
  assert.equal(placesText({ places_left: 500, cap: 500 }), '500 of 500 founding places left');
  assert.equal(placesText({ places_left: 0, cap: 500 }), 'The 500 founding places are taken — you can still join the waitlist.');
  for (const bad of [null, {}, { places_left: -1, cap: 500 }, { places_left: 501, cap: 500 }, { places_left: 2.5, cap: 500 },
    { places_left: '3', cap: 500 }, { places_left: 3, cap: 0 }, { places_left: 3 }, 'x']) {
    assert.equal(placesText(bad), null, JSON.stringify(bad));
  }
});

test('messageFor: the server message when it is a sane string, else a status fallback', () => {
  assert.equal(messageFor(200, SUCCESS), SUCCESS.message);
  assert.equal(messageFor(400, { ok: false, message: MSG.email }), MSG.email);
  assert.equal(messageFor(429, null), MSG.slow);
  assert.equal(messageFor(503, { message: 42 }), MSG.down);
  assert.equal(messageFor(500, { message: 'x'.repeat(1000) }), MSG.down);
  assert.equal(messageFor(400, null), 'Please check your email address and the 18+ box, then try again.');
  assert.equal(messageFor(200, { ok: true }), SUCCESS.message);
});

test('the browser module never parses server data as HTML and touches no DOM on import', () => {
  const src = readFileSync(new URL('../site/assets/js/waitlist.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src));
  assert.match(src, /textContent/);
  assert.match(src, /\bAccept['"]?\s*:\s*['"]application\/json['"]/);
  assert.ok(!/^\s*import\b/m.test(src), 'self-contained: it is served alone, without site/lib');
});
