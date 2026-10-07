# Bet Gaffer — published cards and record

This repository holds the daily prediction cards and the record behind
[betgaffer.com](https://betgaffer.com), plus the code that turns them into the website.

Bet Gaffer is football match intelligence: probabilities for the fixtures in the competitions we
cover, with at most one recommended pick per fixture. It is not a bookmaker and takes no bets.

## What the receipts show

- **Every pick is committed before its kickoff** (a kickoff later moved earlier is marked
  `pre_ko: false` and not counted). Each row carries its freeze time (`frozen_at`, UTC), and a
  fixture first seen less than 10 minutes before kickoff carries no pick (`late: true`).
- **A published pick never changes.** Later updates add grades and display details (kickoff time,
  status, names); none of those is part of the receipt hash.
- **The record figures come from the accuracy ledger**, which includes days before this repository
  began. The cards here are the public, checkable part of that record from the first published day
  onwards.

## Layout

| Path | What it is |
|---|---|
| `days/YYYY-MM-DD.json` | One full card per Lagos (WAT, UTC+1) day: every fixture, its pick, its grade |
| `days/YYYY-MM-DD.min.json` | Summary of a day older than 90 days; the full file stays in git history |
| `index.json` | The list of published days (newest first) and the record figures |
| `site/` | The static site build, the verifier and the page renderers |
| `functions/` | The waitlist endpoint (a Cloudflare Pages Function) |
| `tests/` | The site's tests, with sample data under `tests/fixtures/` |
| `docs/DEPLOY.md` | How the site is deployed and operated |

`days/` and `index.json` are written by an automated publisher. **Please don't open pull requests
against them** — they would be overwritten, and a card can't be edited after the fact anyway.

### Fields in a day file

| Field | Meaning |
|---|---|
| `fx`, `api_fx` | Our fixture id, and the data provider's fixture id |
| `home_id`, `away_id` | Team ids |
| `pick` | `{market, label, pct, price, price_est, why}` or `null`; `pct` is the stated probability in whole percent; `price` is a decimal price or `null`, `price_est: true` when it is an estimate |
| `frozen_at` | When the pick was frozen (UTC) |
| `pre_ko` | `false` if the kickoff moved to before the freeze; such a pick is marked and left out of the accuracy figures |
| `late` | First seen within 10 minutes of kickoff (or after it); never has a pick |
| `withdrawn` | The fixture's identity changed after publication; the row is kept, marked and left out of the accuracy figures |
| `grade` | `won`, `lost`, `push`, `void`, `pending`, `withdrawn`, or `null` when there is no pick |
| `picks_hash` | The receipt: a SHA-256 over every row's identity, pick, freeze time and withdrawn flag |
| `prev_hash` | The previous day's `picks_hash` at the time of publishing |

## Verify the cards

Needs Node.js 22 or later. No install, no dependencies.

```sh
git clone https://github.com/geezerz/betgaffer-site.git
cd betgaffer-site
node site/verify.js
```

It recomputes `picks_hash` for every full day file, checks each against `index.json`, and checks each
compacted day's summary against `index.json`. Every line should start with `OK`; anything else prints
`MISMATCH` and the command exits with status 1. To check another copy of the data, pass its directory:
`node site/verify.js path/to/dir` (it must contain `days/` and, optionally, `index.json`).

### The canonical form (to write your own verifier)

1. Take the day file's `fixtures` array and sort the rows by `fx`, ascending.
2. Turn each row into the array
   `[fx, api_fx, home_id, away_id, pick, frozen_at, withdrawn]`, where `pick` is `null` or the array
   `[market, label, pct, price, price_est, why]` and `price` is the decimal written with exactly two
   decimals as a **string** (`1.2` becomes `"1.20"`) or `null`. `frozen_at` is the string or `null`.
   `label`, `pct` and `why` may be `null`. A missing or `null` `api_fx`, `home_id` or `away_id`
   counts as `0`, a missing or `null` `withdrawn` or `price_est` as `false`, and a `pick` without a
   non-empty `market` as `null`.
3. Serialise the list of rows as JSON with **no whitespace**, `/` and non-ASCII characters
   **unescaped** — except U+2028 and U+2029, which are written as the six-character escapes
   `\u2028` and `\u2029`.
4. `picks_hash` = `"sha256:"` + the lowercase hex SHA-256 of that text's UTF-8 bytes.

Worked example (`tests/fixtures/hash-vectors.json`, vector `basic`):

```
[[10,100,1,4,["over_1_5","Over 1.5",88,"1.20",false,"Form/xG"],"2026-10-07T22:15:00Z",false],[20,200,2,3,null,null,false]]
sha256:77be54ba48d4aace9a1439296590130a38c9d03eaa41967a3e921c57fc436a21
```

The `unicode` vector in the same file covers U+2028/U+2029 and non-ASCII text.

The publisher changes a day's `picks_hash` between versions of its file only when a new fixture row
appears, a row published without a pick gets its first pick before kickoff (stamped with that run's
`frozen_at`), or a row becomes `withdrawn`. An existing pick never changes. To see every version:
`git log -p -- days/<day>.json`.

### Check a compacted day

After 90 days a card is reduced to `days/<day>.min.json` and the full file is removed in the same
commit. The full file is still in git history:

```sh
git rev-list -n 1 HEAD -- days/2026-07-01.json          # the commit that removed it
git restore --source=<that-commit>^ -- days/2026-07-01.json
node site/verify.js                                      # two OK lines with the same hash
rm days/2026-07-01.json                                  # tidy up
```

The first `OK` line is the restored file recomputed from its rows; the second confirms that
`index.json` and the summary carry that same hash. `git log -- days/2026-07-01.json` lists every
version the day went through.

## Build the site

Needs Node.js 22 or later; no install step.

```sh
npm test          # node --test "tests/*.test.js"
npm run build     # node site/build.mjs → dist/
```

The build validates every data file and recomputes every `picks_hash`; any invalid or tampered input
stops it with a message and exit status 1, leaving the previous `dist/` untouched. It also refuses to
run until the operator's legal identity is filled in `site/config.js`. Options:
`node site/build.mjs --root <data dir> --out <dir> --config <file>`.

## Licence

Site code is MIT-licensed ([LICENSE](LICENSE)); the published cards, record and site text are not.
See [LICENSE-CONTENT.md](LICENSE-CONTENT.md).
