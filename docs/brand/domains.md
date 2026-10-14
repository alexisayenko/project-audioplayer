# Domain candidates

Possible domains for the brand **Electrophone Vega 108** (see
[Name and domain](README.md#name-and-domain)). The app is live today at
https://electrophone.cc ([architecture](../tech/architecture.md)); a
dedicated domain is optional and not decided. This file holds the detailed
domain data and the checks history.

## Check 2026-10-14

Prices in EUR as shown at the registrar Alex checked (registrar not
recorded): first-year (promo) price vs yearly renewal. All were available at
check time; none is purchased. First-year prices are promos: availability and
price can change, so re-check before buying.

| Domain | Year 1 | Renewal | Note | 3-year total |
| --- | --- | --- | --- | --- |
| `electrophone.cc` | 2.80 | 7.43 | -16.72% promo | 17.66 |
| `vega108.cc` | 2.80 | 7.43 | | 17.66 |
| `vega-108.com` | 7.98 | 8.97 | +6.81% shown | 25.92 |
| `vega108.app` | 5.58 | 13.03 | -26.70% | 31.64 |
| `electrophone.app` | 5.58 | 13.03 | | 31.64 |
| `electrophone.org` | 5.98 | 10.24 | 27% off | 26.46 |
| `electrophone.ai` | 71.91 | not shown | | n/a |
| `electrophone.net` | 10.07 | not shown | | n/a |

3-year total = year 1 + two renewals.

Recommendation: **`vega108.app`** (clean, no hyphen, HTTPS-only TLD, matches
"Vega 108"); runner-up `vega-108.com` (most trusted TLD, hyphen is awkward).
`.cc` is cheapest but has a spammy reputation; `.ai` is too expensive.

Registrar: check Cloudflare Registrar first (at-cost pricing, no renewal markup; `isayenko.net` already lives there with DNS and the Cloudflare Tunnel) and verify which TLDs it supports before buying elsewhere.

## Status and follow-up

**PURCHASED: `electrophone.cc` (2026-10-14).** The earlier recommendation
(`vega108.app`) was not followed.

## Purchased

| Field | Value |
| --- | --- |
| Domain name | `electrophone.cc` |
| Price paid | EUR 2.80 (first year; list price EUR 7.43, saved EUR 4.63) |
| Date of purchase | 2026-10-14 |
| Future price | EUR 7.43 per year (renewal; the first-year promo ends after year 1) |
| Expires / renews | about 2027-10-14 (typical 1-year term; verify the exact expiry at the registrar, it is not stated on the invoice) |
| Auto-renew | unknown, check at the registrar |
| Registrar | Spaceship |
| Status | PURCHASED |
| Invoice | stored in the private project-meta repo: `audioplayer/invoices/2026-10-14-electrophone.cc-invoice.pdf` |

**Migration status:** Cloudflare zone active; both hostnames serve the app; Google and Apple sign-in verified on electrophone.cc (2026-10-14). Open: iOS default URL, cutover, decommission. See [tech/domain-migration.md](../tech/domain-migration.md) and [task-0026](../tasks/task-0026.md).

Next steps for the domain:

- add a tunnel hostname for it in the cloudflared ingress on perkunas, plus
  DNS records;
- remove `play.isayenko.net` (done 2026-10-14, no redirect, ADR-0019);
- update OAuth redirect URIs and allowed origins for Google and Apple sign-in;
- update the iOS app's default server URL;
- update `docs/tech/deploy.md` and `CLAUDE.md` / `AGENTS.md` (keep the two
  identical);
- set cookie/session domain settings if any, and re-check CORS and allowed
  hosts in the server config.

## Not checked

| Domain | Status | Notes |
| --- | --- | --- |
| electrophone.com | not checked | Matches the app name; the `.com` default. Not in the 2026-10-14 screenshots. |
| other `.com` variants | not checked | Only `vega-108.com` was checked. |

## History

- Earlier stub: `electrophone.com`, `electrophone.cc`, `vega108.cc` listed as
  "not checked". `electrophone.cc` and `vega108.cc` were checked on
  2026-10-14 (table above).

Record each new check here with its date. A purchase goes into
[`../business/budget.md`](../business/budget.md).
