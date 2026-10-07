# Deploying and operating betgaffer.com

Operator guide. The site is a static build of this repository served by **Cloudflare Pages**, plus one
Pages Function (`functions/api/waitlist.js`) backed by **Workers KV**. Work through the sections in
order the first time; sections 11–12 are for after launch.

Cloudflare moves settings around its dashboard from time to time. Where a menu path below doesn't
match what you see, search the dashboard for the setting's name.

Commands are written for Git Bash (or any POSIX shell) with Node.js 22.

---

## 1. DNS: move betgaffer.com to Cloudflare

The domain is registered with **INWX GmbH** (per RDAP). Its current nameservers, `nsc.go54.com` and
`nsd.go54.com`, do not answer, so the domain resolves nowhere today.

- [ ] Cloudflare dashboard → **Add a domain** → `betgaffer.com` → **Free** plan.
- [ ] Skip importing records (there are none worth keeping).
- [ ] Note the two nameservers Cloudflare assigns (`<name>.ns.cloudflare.com`).
- [ ] At INWX: domain → **Nameservers** → replace `nsc.go54.com` / `nsd.go54.com` with the two
      Cloudflare nameservers. Remove any DNSSEC DS record at INWX first (re-enable DNSSEC later
      from Cloudflare → DNS → Settings, and add the DS record it gives you at INWX).
- [ ] Wait until Cloudflare shows the zone as **Active** (minutes to a day). Check with
      `nslookup -type=ns betgaffer.com 1.1.1.1`.

## 2. Fill in the operator's identity

The legal pages name the operator, so **the build refuses to run** until these are set in
`site/config.js` (`operator`):

| Field | Required | Notes |
|---|---|---|
| `legal_name` | yes | The person or company that runs Bet Gaffer |
| `address` | yes | A postal address; it is published on the legal pages |
| `contact_email` | yes | Plain address, e.g. `hello@betgaffer.com` (set up in section 8) |
| `rc_number` | no | CAC registration number, if any |
| `privacy_email` | no | Defaults to `contact_email`; e.g. `privacy@betgaffer.com` |
| `mailbox_provider` | no | Who hosts the inbox mail is forwarded to, e.g. `Google (Gmail)`; named in the privacy policy |

- [ ] Fill the fields, run the tests and a local build, then commit and push:

```sh
node --test "tests/*.test.js"
node site/build.mjs
```

With a field missing the build stops with, for example:

```
build failed: site/config.js: operator identity incomplete; set operator.legal_name, operator.address, operator.contact_email (missing: legal_name, address, contact_email). The legal pages cannot be published with placeholders.
```

These values are public the moment they are pushed: this repository is public.

**Prices.** `pricing.tiers` in `site/config.js` is empty and `pricing.show_prices` is `false`, so
the features page states the pricing model without figures. To publish prices, fill `tiers`
(`{ name, monthly }`, monthly in whole naira) and set `show_prices: true` in the same commit. The
build refuses `show_prices: true` while `tiers` is empty.

## 3. Create the Pages project

- [ ] Workers & Pages → **Create** → **Pages** → **Connect to Git** → authorise GitHub for
      `geezerz/betgaffer-site` only.
- [ ] Production branch: `main`.
- [ ] Framework preset: **None**. Build command: `npm run build`. Build output directory: `dist`.
      Root directory: `/` (leave empty).
- [ ] Node version comes from `.node-version` (`22`). If the build log shows an older Node, add the
      build variable `NODE_VERSION` = `22`.
- [ ] Save and deploy. The first build must succeed (section 2 done). The site is now on
      `https://<project>.pages.dev`.
- [ ] **Preview deployments OFF:** Settings → Builds → **Branch control** → preview branches:
      **None** (production branch only). Pushes to other branches must never get a public URL.
- [ ] **Build-failure notifications ON:** Notifications → Add → **Pages** → project updates →
      event **Deployment failed** → your email. A build that refuses bad data otherwise leaves the
      site silently stale.

## 4. Custom domain

- [ ] Pages project → **Custom domains** → add `betgaffer.com`. Cloudflare creates the DNS record.
- [ ] `www`: DNS → add a **proxied** record `www` (CNAME to `betgaffer.com`), then Rules →
      **Redirect Rules** → template **Redirect from WWW to root** (301, keep the path and query).
      The waitlist only answers on the apex, so `www` must redirect, not serve.

## 5. Waitlist storage and settings

- [ ] Storage & Databases → **KV** → create namespace `betgaffer-waitlist`.
- [ ] Pages project → Settings → **Bindings** (older dashboards: Settings → Functions → KV
      namespace bindings) → **Production** → KV namespace: variable name `WAITLIST`, namespace
      `betgaffer-waitlist`. Do not bind it in Preview.
- [ ] Settings → **Variables and Secrets** → **Production**:
  - [ ] `WAITLIST_HOST` = `betgaffer.com` (plain text). Any other host, including
        `<project>.pages.dev`, gets 503 from the waitlist — those hosts bypass the WAF rule.
  - [ ] `WAITLIST_SECRET` = 32 or more random characters, type **Secret** (encrypted). Generate one:

```sh
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

- [ ] Bindings and variables apply to **new** deployments only: Deployments → latest → **Retry
      deployment** (or push a commit).

Without the binding, the secret (or a secret under 32 characters) or `WAITLIST_HOST`, the waitlist
answers "temporarily unavailable" (503). It never pretends to succeed.

## 6. Security settings

These keep the privacy policy true ("this site sets no cookies") and keep the contact address
readable without JavaScript.

- [ ] **WAF rate-limiting rule** (Security → WAF → Rate limiting rules; the Free plan allows one):
  - match: URI Path equals `/api/waitlist` (also Method equals `POST` where your plan offers the
    Method field — the Free plan matches on path only, which is fine: a page view costs one GET);
  - counting: per IP, **10 requests per 10 seconds**;
  - action: **Block**, for **1 minute** where your plan allows it (the Free plan's only timeout is
    10 seconds).

  This is the primary limit. The Function's own limit (20 attempts per hour per IP, kept in
  Cloudflare's cache) is only a per-data-centre backstop.
- [ ] **Security Level**: lowest (**Essentially Off**), if your dashboard still offers the setting,
      and any WAF rule action **Block — never Challenge**. A challenge sets the `cf_clearance` cookie.
- [ ] **Email Address Obfuscation: OFF** (Scrape Shield). It rewrites the contact address into a
      script-only link, hiding it from readers and reviewers without JavaScript.
- [ ] **Rocket Loader: OFF** (Speed → Optimization). It rewrites script tags into inline loaders,
      which the CSP blocks.
- [ ] **Bot Fight Mode: OFF** (Security → Bots). It sets a `__cf_bm` cookie.
- [ ] **Logs that retain IPs: OFF** for the Pages project — no persistent Workers Logs /
      observability and no Logpush job. Real-time tail logs are fine (nothing is kept).

## 7. Analytics

- [ ] Pages project → **Metrics** → **Web Analytics** → Enable. It is cookieless, and the CSP
      allows exactly its beacon (`static.cloudflareinsights.com` / `cloudflareinsights.com`).

## 8. Email

- [ ] Email → **Email Routing** → enable (Cloudflare adds the MX and SPF records).
- [ ] Destination address: the operator's inbox → verify it from the email Cloudflare sends.
- [ ] Routes: `hello@betgaffer.com` → operator inbox; `privacy@betgaffer.com` → operator inbox.
      Leave catch-all off.
- [ ] Send a test message to each address before the legal pages go live.

## 9. Google Search Console (for Google sign-in / OAuth verification)

- [ ] Search Console → Add property → **Domain** → `betgaffer.com` → copy the TXT value.
- [ ] Cloudflare DNS → add **TXT** at `betgaffer.com` with that value (it sits beside the SPF TXT
      record; both are fine) → Verify.

## 10. GitHub hardening

The publisher pushes `days/` and `index.json` with a fine-grained GitHub access credential (`contents: write` on
this repository only). That credential can push **anything** to `main`, including a Function that reads the
waitlist, and Pages would deploy it. A stolen credential is therefore a waitlist leak, not just a
defaced card.

- [ ] If your plan offers **push rulesets** with **Restrict file paths** (GitHub currently documents
      them for private and internal organisation repositories), create one on `main` blocking
      `functions/**`, `site/**`, `tests/**`, `package.json`, `.node-version`, `_worker.js`,
      `_routes.json` and `wrangler.*`. Bypass rules are per user, not per credential, so the publisher
      must push as a **different identity** (a GitHub App or a deploy key) with no bypass, while your
      account bypasses; otherwise the rule also blocks you and you disable it to ship site changes.
- [ ] If not available (the likely case for a public repository on a personal account), **accept
      the risk knowingly**, and reduce it:
  - [ ] give the credential the shortest expiry you can live with, scoped to this one repository;
  - [ ] after any unexpected deploy, list commits that touched anything else:
        `git log --format='%h %an %ad %s' --name-only -- . ':!days' ':!index.json'`;
  - [ ] treat a site-code commit you didn't make as an incident: revoke the credential, revert,
        rotate `WAITLIST_SECRET`.
- [ ] **Email privacy:** commits show the author email. Settings → Emails → **Keep my email
      addresses private** and **Block command line pushes that expose my email**; this repository
      commits as `geezerz <18566620+geezerz@users.noreply.github.com>`.

## 11. Post-deploy checks

```sh
H=https://betgaffer.com
for p in / /our-record/ /features/ /privacy/ /terms/ /refunds/ \
         /waitlist/thanks/ /waitlist/invalid/ /waitlist/slow-down/ /waitlist/unavailable/ \
         /index.json; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$H$p")" "$p"
done                                                     # all 200 (index.json: 404 before the first publish)
curl -s -o /dev/null -w '%{http_code}\n' "$H/no-such-page/"    # 404, not the home page
curl -s "$H/privacy/" | grep -c 'hello@betgaffer.com'          # > 0: the address is plain HTML
curl -s "$H/privacy/" | grep -c 'email-protection'             # 0: obfuscation is off
curl -sI "$H/" | grep -i '^content-security-policy'            # present
curl -sI "$H/" | grep -ci '^set-cookie'                        # 0
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.betgaffer.com/features/   # 301 → apex
curl -s "$H/api/waitlist"                                      # 200 {"places_left":…,"cap":500}
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.pages.dev/api/waitlist   # 503
```

- [ ] Every line matches its comment (use your own contact address in the grep).
- [ ] Join the waitlist once from a phone with your own address, find it in the KV browser
      (section 12), then delete it. That rehearses the data-subject runbook.
- [ ] Open the home page with JavaScript disabled: fixtures, picks and the contact address are
      all visible.

## 12. Operating

**Build budget.** Every push to `main` builds. The publisher pushes at most 7 times a day, about
210 builds a month of the Free plan's 500. Your own commits count too.

**A failed build** leaves the previous deploy live, so the site goes stale rather than wrong. Open
the build log: invalid or tampered data (a `picks_hash` that doesn't recompute, a listed day that is
missing, an unknown schema) is refused **on purpose**. Fix the data at its source and republish;
never edit `days/` or `index.json` by hand. `node site/verify.js` in a fresh clone shows which day
fails.

**Data-subject requests** (privacy@ / hello@). Reply within **30 days**; you may ask the person to
confirm from the address concerned. Each address is stored under one key, `e:` + the SHA-256 of
the address fully lower-cased:

```sh
node -e "console.log('e:'+require('crypto').createHash('sha256').update(process.argv[1].trim().toLowerCase()).digest('hex'))" "Someone@Example.com"
```

Then Storage & Databases → KV → `betgaffer-waitlist` → **KV pairs** → search the key.

| Request | Action |
|---|---|
| Access / portability | Copy the value (`{"email":…,"ts":…}`) into the reply |
| Erasure, withdraw consent, objection, restriction | Delete the key; confirm by email |
| Rectification | Delete the old key; add a key for the corrected address with `{"email":"<corrected>","ts":"<original ts>"}` |
| Under 18 | Delete the key |

Deleting a key frees a founding place; the places line catches up within about 10 minutes.

**Retention sweep.** The privacy policy promises: kept until 12 months after full launch, and never
more than 24 months after joining.

- [ ] At launch: set a reminder for launch + 12 months; on that day delete every key (or delete the
      namespace and bind a fresh empty one).
- [ ] If launch is late, from 24 months after the waitlist opened: once a month, delete every entry
      whose `ts` is more than 24 months old.

**Accepted residual risks**

- After a global KV write failure, the "storage is down" flag is per data centre, so for a while an
  existing address can still get the normal answer in a data centre that hasn't seen a failure.
- Junk sign-ups can use up founding places. The places line is a count of stored addresses, not a
  promise; delete obvious junk if it matters.
- Free KV allows 1,000 writes and 1,000 list operations a day. Past the write cap the waitlist
  answers "temporarily unavailable" until 00:00 UTC. The Workers Paid plan removes both caps.

## 13. Operator decisions

Operator decisions are tracked privately.
