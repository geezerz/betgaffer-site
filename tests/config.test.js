import { test } from 'node:test';
import assert from 'node:assert/strict';
import config, { requireOperator, REPO_RE } from '../site/config.js';
import * as features from '../site/content/features.js';
import * as terms from '../site/content/terms.js';

test('config carries the plan constants', () => {
  assert.equal(config.origin, 'https://betgaffer.com');
  assert.equal(config.repo, 'geezerz/betgaffer-site');
  assert.equal(config.brand, 'Bet Gaffer');
  assert.equal(config.descriptor, 'football match intelligence');
  assert.equal(config.founding_places, 500);
  assert.equal(config.stale_after_hours, 6);
  assert.equal(config.pricing.currency, 'NGN');
  // The published identity and prices are asserted in content.test.js ("shipped config").
  assert.equal(config.operator.trading_name, 'Bet Gaffer');
});

// A copy with the operator identity blanked: these tests must not depend on whether the operator
// has filled site/config.js yet (filling it must not turn the suite red).
const blank = () => {
  const cfg = structuredClone(config);
  for (const k of ['legal_name', 'address', 'rc_number', 'contact_email', 'privacy_email']) cfg.operator[k] = null;
  return cfg;
};

test('an unfilled operator identity makes requireOperator name every missing field', () => {
  assert.throws(() => requireOperator(blank()), (e) => {
    assert.ok(e instanceof Error);
    for (const k of ['legal_name', 'address', 'contact_email']) assert.match(e.message, new RegExp(`\\b${k}\\b`));
    assert.doesNotMatch(e.message, /privacy_email|rc_number/);
    return true;
  });
});

const full = (op = {}) => { const cfg = blank(); return { ...cfg, operator: { ...cfg.operator,
  legal_name: 'Example Ltd', address: '1 Example Road, Lagos', contact_email: 'hello@example.com', ...op } }; };

test('requireOperator names only the fields that are missing (null, empty or blank)', () => {
  assert.throws(() => requireOperator(full({ address: '   ' })), (e) => {
    assert.match(e.message, /\baddress\b/);
    assert.doesNotMatch(e.message, /legal_name|contact_email/);
    return true;
  });
  assert.throws(() => requireOperator(full({ legal_name: '', contact_email: null })), (e) => {
    assert.match(e.message, /\blegal_name\b/);
    assert.match(e.message, /\bcontact_email\b/);
    assert.doesNotMatch(e.message, /\baddress\b/);
    return true;
  });
  assert.throws(() => requireOperator(full({ legal_name: 42 })), /legal_name/);
  assert.throws(() => requireOperator({}), /legal_name.*address.*contact_email/);
});

test('requireOperator defaults privacy_email to contact_email and keeps an explicit one', () => {
  const op = requireOperator(full());
  assert.equal(op.privacy_email, 'hello@example.com');
  assert.equal(op.legal_name, 'Example Ltd');
  assert.equal(op.trading_name, 'Bet Gaffer');
  assert.equal(requireOperator(full({ privacy_email: 'privacy@example.com' })).privacy_email, 'privacy@example.com');
  assert.equal(requireOperator(full({ privacy_email: '' })).privacy_email, 'hello@example.com');
});

const HOSTILE_EMAILS = [
  'a@b.com?bcc=x@y.com', '"x"@y.com', 'a@b.com#frag', 'a@b.com&cc=x@y.com', 'a b@c.com', 'a@b',
  'a@b.c', '@b.com', 'a@', 'a@@b.com', ' a@b.com', 'a@b.com ', 'a@b.com\n', 'a<b>@c.com', 'a@b.com/x',
  'mailto:a@b.com', 'a@b.com,c@d.com', 'a@b.com;c@d.com', "a'@b.com",
];

test('requireOperator rejects a malformed or hostile contact_email, naming the field', () => {
  for (const contact_email of HOSTILE_EMAILS) {
    assert.throws(() => requireOperator(full({ contact_email })), (e) => {
      assert.match(e.message, /\bcontact_email\b/);
      assert.doesNotMatch(e.message, /\bprivacy_email\b/);
      return true;
    }, `should reject contact_email ${JSON.stringify(contact_email)}`);
  }
});

test('requireOperator rejects a malformed or hostile privacy_email, naming the field', () => {
  for (const privacy_email of HOSTILE_EMAILS) {
    assert.throws(() => requireOperator(full({ privacy_email })), (e) => {
      assert.match(e.message, /\bprivacy_email\b/);
      assert.doesNotMatch(e.message, /\bcontact_email\b/);
      return true;
    }, `should reject privacy_email ${JSON.stringify(privacy_email)}`);
  }
});

test('requireOperator accepts ordinary addresses', () => {
  for (const e of ['hello@example.com', 'first.last+tag@mail.example.co.uk', 'o_k-1%x@a-b.example.ng']) {
    assert.equal(requireOperator(full({ contact_email: e, privacy_email: e })).privacy_email, e);
  }
});

test('requireOperator validates cfg.repo as owner/name', () => {
  for (const repo of ['geezerz', 'geezerz/x/y', 'geezerz/x"><script>', '/x', 'x/', 'a b/c', 'evil.example/x?y',
    '../..', './x', 'x/..', '', null, 42]) {
    assert.throws(() => requireOperator({ ...full(), repo }), (e) => {
      assert.match(e.message, /\brepo\b/);
      return true;
    }, `should reject repo ${JSON.stringify(repo)}`);
  }
  assert.doesNotThrow(() => requireOperator({ ...full(), repo: 'some-org/my.site_v2' }));
});

test('requireOperator validates cfg.origin as a bare https origin', () => {
  for (const origin of ['http://betgaffer.com', 'https://betgaffer.com/', 'https://betgaffer.com/x', 'betgaffer.com',
    '//betgaffer.com', 'https://', 'https://bet gaffer.com', 'https://b.com"><x', 'javascript:alert(1)',
    'https://user@b.com', 'https://b.com?x', '', null]) {
    assert.throws(() => requireOperator({ ...full(), origin }), (e) => {
      assert.match(e.message, /\borigin\b/);
      return true;
    }, `should reject origin ${JSON.stringify(origin)}`);
  }
  for (const origin of ['https://betgaffer.com', 'https://staging.example', 'https://localhost:8443']) {
    assert.doesNotThrow(() => requireOperator({ ...full(), origin }), origin);
  }
});

test('requireOperator names every bad field at once', () => {
  assert.throws(() => requireOperator({ ...full({ contact_email: 'x', privacy_email: 'y' }), repo: 'r', origin: 'o' }),
    (e) => {
      for (const k of ['contact_email', 'privacy_email', 'repo', 'origin']) assert.match(e.message, new RegExp(`\\b${k}\\b`));
      return true;
    });
});

test('requireOperator does not mutate the config', () => {
  const cfg = full();
  requireOperator(cfg);
  assert.equal(cfg.operator.privacy_email, null);
});

test('show_prices without tiers is refused by requireOperator, naming pricing.tiers', () => {
  for (const tiers of [[], undefined, null, 'Free']) {
    assert.throws(() => requireOperator({ ...full(), pricing: { show_prices: true, currency: 'NGN', tiers } }), (e) => {
      assert.match(e.message, /pricing\.tiers/);
      return true;
    }, JSON.stringify(tiers));
  }
  assert.doesNotThrow(() => requireOperator({ ...full(), pricing: { show_prices: false, currency: 'NGN', tiers: [] } }));
  assert.doesNotThrow(() => requireOperator({ ...full(), pricing: { show_prices: true, currency: 'NGN', tiers: [{ name: 'A', monthly: 1 }] } }));
  // the shipped config (prices hidden, no tiers) passes this check
  assert.doesNotThrow(() => requireOperator(full()));
});

test('one owner/name rule: REPO_RE from config is the rule requireOperator, features and terms apply', () => {
  assert.ok(REPO_RE instanceof RegExp);
  // GitHub owners are letters, digits and hyphens; repository names add . and _ but are never . or ..
  for (const repo of ['my_org/x', 'my.org/x', 'x/..', 'x/.', 'geezerz/x y']) {
    assert.ok(!REPO_RE.test(repo), repo);
    assert.throws(() => requireOperator({ ...full(), repo }), /\brepo\b/, repo);
    for (const page of [features, terms]) assert.throws(() => page.render({ ...full(), repo }), /repo/, repo);
  }
  for (const repo of ['geezerz/betgaffer-site', 'some-org/my.site_v2', 'a/.x']) {
    assert.ok(REPO_RE.test(repo), repo);
    assert.doesNotThrow(() => requireOperator({ ...full(), repo }), repo);
  }
});
