# Deploying and operating betgaffer.com

Operator guide. The site is a static build of this repository served by **Cloudflare Pages**, plus one
Pages Function (`functions/api/waitlist.js`) backed by **Workers KV**. Work through the sections in
order the first time; sections 11–12 are for after launch.

Cloudflare moves settings around its dashboard from time to time. Where a menu path below doesn't
match what you see, search the dashboard for the setting's name.

Commands are written for Git Bash (or any POSIX shell) with Node.js 22.

---

## 1. DNS: move betgaffer.com to Cloudflare

The registrar is **INWX GmbH** (per RDAP), sold through a reseller: the domain is managed in the
**Go54** (formerly WhoGoHost) client area unless you hold your own INWX account. The current
nameservers, `nsc.go54.com` and `nsd.go54.com`, serve Go54's default hosting records (`A` for the
apex, `www` and `mail`, an `MX` and an SPF `TXT`). None of them is wanted.

- [ ] Cloudflare dashboard → Domains → **Onboard a domain** → `betgaffer.com` → **Free** plan.
- [ ] Review DNS records: **delete every imported record**. Pages (section 4) and Email Routing
      (section 8) create the right ones; a leftover apex/`www` `A` record blocks the custom domain,
      and a leftover `MX` blocks Email Routing.
- [ ] Note the two nameservers Cloudflare assigns (`<name>.ns.cloudflare.com`).
- [ ] DNSSEC must be off before the switch: `nslookup -type=DS betgaffer.com 1.1.1.1` returns no DS
      record (it is unsigned today). If one appears, remove it at the registrar first (INWX: menu
      **DNSSEC**). Re-enable DNSSEC later from Cloudflare → DNS → Settings and add its DS record at
      the registrar.
- [ ] Change the nameservers to the two Cloudflare ones. Go54: **Domains → My Domains → ⋮ → Manage
      Nameservers → Change Nameservers**. Own INWX account: **Domain list → action menu → External
      name servers → Nameserver → External Nameservers** → Save (INWX: 3–48 hours).
- [ ] Wait until Cloudflare shows the zone as **Active** (minutes to a day; a Free zone still
      Pending after 28 days is deleted). Check with `nslookup -type=ns betgaffer.com 1.1.1.1`.

## 2. Fill in the operator's identity

The legal pages name the operator, so **the build refuses to run** until these are set in
`site/config.js` (`operator`):

| Field | Required | Notes |
|---|---|---|
| `legal_name` | yes | The person or company that runs Bet Gaffer |
| `address` | yes | A postal address; it is published on the legal pages |
| `contact_email` | yes | Plain address: `contact@betgaffer.com` (set up in section 8) |
| `rc_number` | no | CAC registration number, if any |
| `privacy_email` | no | Leave `null`: it defaults to `contact_email`, so one address serves both |
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

**Prices.** `pricing.tiers` in `site/config.js` holds the published plans (`{ name, monthly }`,
monthly in whole naira) and `pricing.show_prices` is `true`. To withdraw the figures, set
`show_prices: false`; the features page then states the pricing model without them. The build
refuses `show_prices: true` while `tiers` is empty.

## 3. Create the Pages project

- [ ] Workers & Pages → **Create application** → **Pages** tab → **Import an existing Git
      repository** (older wording: Connect to Git). The screen opens on Workers; do not create a
      Worker. Install the **Cloudflare Workers and Pages** GitHub app with **Only select
      repositories** → `geezerz/betgaffer-site`.
- [ ] Production branch: `main`.
- [ ] Framework preset: **None**. Build command: `npm run build`. Build output directory: `dist`.
      Root directory: `/` (leave empty).
- [ ] Node version comes from `.node-version` (`22`). If the build log shows an older Node, add the
      build variable `NODE_VERSION` = `22`.
- [ ] Save and deploy. The first build must succeed (section 2 done). The site is now on
      `https://<project>.pages.dev`.
- [ ] **Preview deployments OFF:** Settings → Build → **Branch control** (Cloudflare's docs: Builds &
      deployments → Configure Production deployments) → keep **Enable automatic production branch
      deployments** ticked → Preview branch: **None**. Pushes to other branches must never get a
      public URL.
- [ ] **Build-failure notifications ON:** Alerts (older: Notifications) → **Create an Alert** →
      **Pages: Project updates** → this project, environment Production, event **Deployment
      failed** → your email. A build that refuses bad data otherwise leaves the site silently stale.
- [ ] **Fail open:** Settings → Runtime → **Fail open / closed** → Fail open, so the pages stay up
      if the Free plan's daily Functions allowance is ever exhausted (only the waitlist stops).

## 4. Custom domain

- [ ] Pages project → **Custom domains** → **Set up a domain** → `betgaffer.com`, then again for
      `www.betgaffer.com`. Cloudflare creates both DNS records; never add a `CNAME` to `pages.dev`
      by hand (it fails with 522).
- [ ] Rules → **Overview** → **Create rule** → **Redirect Rule** → Wildcard pattern, Request URL
      `http*://www.betgaffer.com/*` → Target URL `https://betgaffer.com/${2}`, **301**, **Preserve
      query string** on (or the template **Redirect from WWW to root**, which matches `https://www.*`
      only). The waitlist only answers on the apex, so `www` must redirect, not serve.
- [ ] SSL/TLS → Edge Certificates: **Always Use HTTPS** on, **Minimum TLS Version** 1.2. Leave
      Cloudflare's HSTS setting off (the site sends its own header) and never enable preload.

## 5. Waitlist storage and settings

- [ ] Storage & databases → **Workers KV** → **Create instance** → `betgaffer-waitlist`.
- [ ] Pages project → Settings → **Bindings** (older dashboards: Settings → Functions → KV
      namespace bindings) → **Production** → KV namespace: variable name `WAITLIST`, namespace
      `betgaffer-waitlist`. Do not bind it in Preview.
- [ ] Settings → **Variables and Secrets** → **Production** → **Add**:
  - [ ] `WAITLIST_HOST` = `betgaffer.com` (plain text). Any other host, including
        `<project>.pages.dev`, gets 503 from the waitlist — those hosts bypass the WAF rule.
  - [ ] `WAITLIST_SECRET` = 32 or more random characters, type **Secret** (encrypted). Generate one:

```sh
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

- [ ] Bindings and variables apply to **new** deployments only: Deployments → latest production →
      **⋯** → **Retry deployment** (or push a commit).

Without the binding, the secret (or a secret under 32 characters) or `WAITLIST_HOST`, the waitlist
answers "temporarily unavailable" (503). It never pretends to succeed.

## 6. Security settings

These keep the privacy policy true ("this site sets no cookies") and keep the contact address
readable without JavaScript.

- [ ] **WAF rate-limiting rule** (Security → **Security rules** → Create rule → **Rate limiting
      rules**; older dashboards: Security → WAF → Rate limiting rules; the Free plan allows one):
  - match: URI Path equals `/api/waitlist` (also Method equals `POST` where your plan offers the
    Method field — the Free plan matches on Path and Verified Bot only, which is fine: a page view
    costs one GET);
  - counting: per IP, **10 requests per 10 seconds**;
  - action: **Block**, for **1 minute** where your plan allows it (the Free plan's only period and
    timeout are 10 seconds).

  This is the primary limit. The Function's own limit (20 attempts per hour per IP, kept in
  Cloudflare's cache) is only a per-data-centre backstop.
- [ ] **Under Attack Mode: OFF** (zone Overview → Quick Actions; off by default). The old Security
      Level values such as "Essentially Off" no longer exist; Security Level now only toggles Under
      Attack Mode. Any WAF rule action is **Block — never Challenge**: a challenge sets the
      `cf_clearance` cookie.
- [ ] **Email Address Obfuscation: OFF** (Security → **Settings**, filter Client-side abuse; older
      dashboards: Scrape Shield). It is **on by default**. It rewrites the contact address into a
      script-only link, hiding it from readers and reviewers without JavaScript.
- [ ] **Rocket Loader: OFF** (Speed → **Settings** → Content Optimization). It rewrites script tags
      into inline loaders, which the CSP blocks.
- [ ] **Bot Fight Mode: OFF** (Security → **Settings**, filter Bot traffic). It sets a `__cf_bm`
      cookie, and while it is on, JavaScript Detections (a `cf_clearance` cookie and an injected
      script) is forced on too.
- [ ] **Logs that retain IPs: none** for the Pages project — no Logpush job (Workers Paid only), and
      no persistent Workers Logs / observability if the project offers it. The Functions real-time
      log (Deployments → View details → Functions) is fine: Cloudflare does not store it.

## 7. Analytics

- [ ] Pages project → **Metrics** → **Web Analytics** → Enable. Cloudflare injects the beacon on
      the **next deployment** (Retry deployment, or wait for the next publish). It is cookieless, and
      the CSP allows exactly its beacon (`static.cloudflareinsights.com` / `cloudflareinsights.com`).
      Do not also enable zone-level automatic Web Analytics for the domain (double counting).

## 8. Email

- [ ] Compute → Email Service → **Email Routing** (older dashboards: the domain → Email → Email
      Routing) → **Onboard Domain** → `betgaffer.com`. Cloudflare adds 3 MX records, an SPF TXT and a
      DKIM TXT. Any other MX record must be deleted first.
- [ ] **Destination Addresses**: the operator's inbox → verify it from the email Cloudflare sends
      (a rule pointing at an unverified address stays disabled).
- [ ] **Routing Rules** → Create routing rule: `contact@betgaffer.com` → **Send to an email** →
      operator inbox. That is the only address: `privacy_email` defaults to `contact_email`. Leave
      catch-all off.
- [ ] Send a test message to contact@ from a different account before the legal pages go live.
- [ ] Email Routing only receives. Replies go out from the operator's inbox unless a separate SMTP
      sending service is set up for the domain (then merge its `include:` into the one SPF record).

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
curl -s "$H/privacy/" | grep -c 'contact@betgaffer.com'        # > 0: the address is plain HTML
curl -s "$H/privacy/" | grep -c 'email-protection'             # 0: obfuscation is off
curl -sI "$H/" | grep -i '^content-security-policy'            # present
curl -sI "$H/" | grep -ci '^set-cookie'                        # 0
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.betgaffer.com/features/   # 301 → apex
curl -s "$H/api/waitlist"                                      # 200 {"places_left":…,"cap":500}
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.pages.dev/api/waitlist   # 503
```

- [ ] Every line matches its comment.
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

**Data-subject requests** (they arrive at contact@betgaffer.com). Reply within **30 days**; you may ask the person to
confirm from the address concerned. Each address is stored under one key, `e:` + the SHA-256 of
the address fully lower-cased:

```sh
node -e "console.log('e:'+require('crypto').createHash('sha256').update(process.argv[1].trim().toLowerCase()).digest('hex'))" "Someone@Example.com"
```

Then Storage & databases → **Workers KV** → `betgaffer-waitlist` → **KV Pairs** → find the key.

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
