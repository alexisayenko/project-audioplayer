# Domain migration: play.isayenko.net to electrophone.cc

Runbook for moving the live site from `https://play.isayenko.net` to
`https://electrophone.cc` (bought 2026-10-14, see
[brand/domains.md](../brand/domains.md)). Same server (LXC 106 `tools` on
perkunas), same Cloudflare Tunnel (cloudflared on the host), same app
(FastAPI + web UI). Task: [task-0026](../tasks/task-0026.md). Deploy basics:
[deploy.md](deploy.md).

Owners: **A** = Alex, **C** = Claude. Verify any phase with
`bash scripts/check-domain.sh electrophone.cc --old play.isayenko.net`
(read-only; prints a PASS/FAIL table, exit 1 on any FAIL).

Principle: dual-host first (both hostnames serve the app), redirect last.
Browsers cache a 308 permanently, so the canonical redirect is the one step
that is hard to undo: do it only when everything else is proven.

## Status (2026-10-14)

Phases 0-3 done on 2026-10-14: Cloudflare zone active, both hostnames serve the app (`check-domain.sh` PASS), Google and Apple sign-in verified by Alex on `https://electrophone.cc`. Open: Phase 4 (iOS default server and TestFlight build), Phase 5 (`PUBLIC_HOSTS` on the server after the next release, HSTS, canonical redirect; recommended after one week of clean operation), Phase 6.

### Known issues

- `scripts/check-domain.sh` counts songs twice (reports 400 for a library of 200); the equal-count row still compares like with like, but the figure is wrong. To be fixed.

## Remaining steps (ordered)

1. **C** commits the iOS change (needs Alex's go) and the docs. Nothing in production changes.
2. **A** builds and uploads the TestFlight build, installs it on devices (before the redirect, Question C of the task).
3. **A** or root: server release with `PUBLIC_HOSTS=play.isayenko.net,electrophone.cc[,www.electrophone.cc]`. The `claude` user may set it through `/usr/local/sbin/audioplayer-env-set`.
4. Wait one week of clean dual-host operation (not before 2026-10-21).
5. **root/A** sets `CANONICAL_HOST=electrophone.cc` in `/etc/audioplayer/env` (the `claude` user's sudo does not allow it) and restarts the unit. Then **C** runs `check-domain.sh electrophone.cc --old play.isayenko.net`: old host must report 308.
6. One week later **A** enables HSTS in Cloudflare (SSL/TLS > Edge Certificates, max-age 1 day first, then 6 months, no includeSubDomains or preload).
7. **A/C** update bookmarks and docs URLs (README, CLAUDE.md, AGENTS.md, deploy.md, architecture.md, brand docs, project.yml comment).

Rollback: step 5 unset `CANONICAL_HOST` and restart (browsers keep a cached 308); step 6 max-age 0; iOS ship the previous build or edit the URL.

## Phases

### Phase 0: purchase (done)

- [x] Domain bought at Spaceship, 2026-10-14 (first year EUR 2.80, renewal EUR 7.43). Invoice stored in the private project-meta repo.

Rollback: none needed.

### Phase 1: Cloudflare zone and nameservers (done 2026-10-14)

Result: Cloudflare zone active, nameservers `bowen.ns.cloudflare.com` and `melissa.ns.cloudflare.com`; tunnel ingress for `electrophone.cc` and `www.electrophone.cc`.

1. **C** adds `electrophone.cc` as a site (Free plan) in Cloudflare, creates the tunnel ingress rule and DNS record for the new hostname, and sets null MX / SPF / DMARC records (no email planned). Values: see [Cloudflare values](#cloudflare-values-from-the-cloudflare-agent).
2. **A** at Spaceship, in the web UI:
   1. If DNSSEC is enabled for the domain, switch it off first (Spaceship: Domain List > electrophone.cc > DNSSEC); otherwise resolvers reject the new nameservers.
   2. Spaceship > Domain List > electrophone.cc > Nameservers > Custom nameservers.
   3. Enter `bowen.ns.cloudflare.com` and `melissa.ns.cloudflare.com` and save.
3. **A/C** wait for propagation (usually minutes, up to 24-48 h) until Cloudflare shows the site as **Active** (Cloudflare also sends an email). The DNS NS row of `check-domain.sh` turns PASS.
4. **C** (after Active) enables DNSSEC in Cloudflare (DNS > Settings > DNSSEC) and **A** adds the DS record at Spaceship, only if DNSSEC was on before.

Rollback: at Spaceship set the nameservers back to Spaceship's defaults (`launch1.spaceship.net`, `launch2.spaceship.net`); nothing else depends on the zone yet.

### Phase 2: verify DNS/TLS, dual-host operation (done 2026-10-14)

Result: `check-domain.sh electrophone.cc --old play.isayenko.net` PASS.

1. **C** runs `bash scripts/check-domain.sh electrophone.cc --old play.isayenko.net`; all rows PASS (DNS, TLS certificate, `/health`, guest `/me`, `/library`, write refused with 401, audio Range 206, equal song counts).
2. Both hostnames now serve the app. The old URL keeps working unchanged.
3. Consequence: session cookies are host-only, so a session from `play.isayenko.net` does not exist on `electrophone.cc`. **The owner and friends sign in again on the new host** (Google or Apple); their libraries and data are untouched (storage is per account, not per host). The guest view needs no sign-in and nothing changes for guests. Offline playback in the iOS app is unaffected.
4. Until Phase 3 is done, sign-in on the new host fails; guest view works.

Rollback: remove the hostname from the tunnel ingress (C); the old host is untouched.

### Phase 3: Google and Apple sign-in (done 2026-10-14)

Done by Alex on 2026-10-14; both providers verified on `https://electrophone.cc`. Values actually set (no secrets):

| Console | Object | Now |
| --- | --- | --- |
| Google Cloud, project `gramophone-offline`, OAuth client "Gramophone Web" | Authorised JavaScript origins | `https://play.isayenko.net` (unchanged) and `https://electrophone.cc` (added) |
| Apple Developer, Services ID "Gramophone Offline Web" (`com.alexisayenko.audioplayer.web`) | Domains | `play.isayenko.net` (unchanged) and `electrophone.cc` (added) |
| same | Return URLs | `https://play.isayenko.net/` (unchanged) and `https://electrophone.cc/` (added) |

Sessions are host-only, so users sign in again on the new host. The planning table below is kept for reference; items not listed above (extra redirect URIs, consent-screen name, authorised domain) were not needed for sign-in to work.

Exact values come from the server config work (`PUBLIC_HOSTS`, `CANONICAL_HOST`; see [deploy.md](deploy.md) and the sign-in ADRs in [decisions.md](decisions.md)). `PUBLIC_HOSTS` must list both hosts during dual-host. Confirm paths against deploy.md before saving.

| Where | Setting | Value |
| --- | --- | --- |
| Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client ID (Web) | Authorised JavaScript origins | add `https://electrophone.cc` (keep the old origin) |
| same | Authorised redirect URIs | add `https://electrophone.cc` plus any path listed in deploy.md `<to be filled: from the server-prep docs>` |
| Google Cloud Console > OAuth consent screen (Branding) | App name | `Electrophone Vega 108` |
| same | Authorised domains | add `electrophone.cc` (keep `isayenko.net`); application home page `https://electrophone.cc` |
| Apple Developer > Certificates, Identifiers & Profiles > Identifiers > Services IDs > the web Services ID > Sign in with Apple > Configure | Domains and Subdomains | add `electrophone.cc` |
| same | Return URLs | add `https://electrophone.cc` plus the path from deploy.md `<to be filled>` |

Notes:

- Google may ask to verify ownership of an authorised domain and may put changes to a published consent screen under review. Verify in Google Search Console (Domain property `electrophone.cc`, DNS TXT record, which **C** adds in Cloudflare once **A** gives the token). In "Testing" mode with listed users no review is needed.
- Apple may ask for domain verification of the Services ID; if so, **C** adds the TXT record or serves the file it provides.
- Add, never replace: keep the old origins and return URLs until Phase 6.
- Do not paste client secrets or key files into chat or the repo.

Test (A+C): **A** signs in with Google, then Apple, on `https://electrophone.cc`; **C** checks `/me` shows the account and the library loads.

Rollback: remove the added origins and URIs; the old host's sign-in is unaffected because the old entries were kept.

### Phase 4: iOS app default server

- Done in the working tree (2026-10-14, not committed): `Endpoints.defaultServer` is now `electrophone.cc`; `Settings.init` rewrites a stored `https://play.isayenko.net` to the new default so existing installs switch silently, a custom URL is kept. iOS sign-in is host-independent (Bearer ID token, native Google redirect scheme, Apple native), so no provider changes are needed. Remaining: the comment in `ios/project.yml` line 43 (left untouched on purpose). The comment in `ios/project.yml` line 43 ("The server is HTTPS (play.isayenko.net)") changes with it.
- Ships as a separate TestFlight build (see [architecture.md](architecture.md)). **C** prepares the change, **A** builds and uploads. Not before Phase 3 passes, since the app signs in through the same providers.
- During dual-host the installed build keeps working against the old URL. A server URL already saved in the app's Settings is not changed by the new default; change it by hand in Settings or reinstall.
- The old host must keep serving or redirecting until every device runs the new build (Phase 6).

Rollback: ship the previous build or set the URL back in Settings.

### Phase 5: cutover

Only after at least a week of clean dual-host operation and a signed-in test on every device. Recommended: not before 2026-10-21.

0. **C** sets `PUBLIC_HOSTS` (both hosts, plus `www` if wanted) in `/etc/audioplayer/env` after the next server release.
1. **C** sets `CANONICAL_HOST=electrophone.cc` in `/etc/audioplayer/env` and restarts the unit (deploy.md). Effect: GET/HEAD to other hosts get a 308 to the canonical host. Writes are not redirected.
2. **C** runs `check-domain.sh electrophone.cc --old play.isayenko.net`: the old-host row reports a 308 to the canonical host.
3. **C** enables HSTS on the new zone (Cloudflare: SSL/TLS > Edge Certificates > HTTP Strict Transport Security) with a short max-age first (for example 1 day), later 6 months; no includeSubDomains or preload until sure. Do it after the redirect has run cleanly for a week.
4. **A** updates bookmarks and home-screen shortcuts.
5. **C** updates URLs in the docs, in the same commit as each change: `README.md`, `CLAUDE.md` and `AGENTS.md` (kept identical), `docs/tech/deploy.md`, `docs/tech/architecture.md`, `docs/brand/README.md`, `docs/brand/domains.md`, scripts that mention the host, the `ios/project.yml` comment.

Rollback: unset `CANONICAL_HOST` and restart (C). Browsers that already cached the 308 keep going to the new host until the cache is cleared; that is why this phase is last. HSTS rollback: set max-age 0 in Cloudflare and wait out the old max-age on clients.

### Phase 6: decommission

- Keep the `play.isayenko.net` redirect for at least 12 months (iOS builds in the wild, bookmarks, shared links).
- Do not delete the old tunnel hostname or its DNS record; `isayenko.net` stays in use for other services.
- After 12 months: check the server logs for remaining old-host traffic; only then consider removing the old origins from Google and Apple.
- Renewal: `electrophone.cc` renews at EUR 7.43 per year from about 2027-10-14; turn on auto-renew at Spaceship, otherwise the site and sign-in die with the domain.

Rollback: not applicable (the old host is never removed).

## Cloudflare values (from the Cloudflare agent)

From the Cloudflare report of 2026-10-14. Done by C; the zone is now active (nameservers switched, 2026-10-14).

| Item | Value |
| --- | --- |
| Nameservers (two) | `bowen.ns.cloudflare.com`, `melissa.ns.cloudflare.com` |
| Zone | `electrophone.cc`, same Cloudflare account as `isayenko.net`, full setup, Free plan, status pending |
| Tunnel ingress (perkunas `/etc/cloudflared/config.yml`) | `electrophone.cc` and `www.electrophone.cc` to `http://192.168.0.10:8000`, after the `play.isayenko.net` rule; cloudflared restarted, 4 connections |
| DNS records | proxied CNAME `electrophone.cc` and `www` to the tunnel (`<tunnel-id>.cfargotunnel.com`); MX `0 .` (null MX); TXT `v=spf1 -all`; TXT `_dmarc` `v=DMARC1; p=reject; adkim=s; aspf=s` |
| Zone settings | SSL Full, Always Use HTTPS on, Automatic HTTPS Rewrites on, min TLS 1.2, Brotli on, HSTS off |
| Rollback (ingress) | `sudo cp -p /etc/cloudflared/config.yml.bak-electrophone-20261014192523 /etc/cloudflared/config.yml && sudo systemctl restart cloudflared` |

`www.electrophone.cc` also reaches the app; `PUBLIC_HOSTS` should include it or `www` should redirect to the apex.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| DNS propagation takes 24-48 h | Medium | Delay only | Old host keeps serving; check with `check-domain.sh` |
| DNSSEC left on at Spaceship during the NS switch | Low | New host unresolvable (SERVFAIL) | Disable first; re-enable via Cloudflare |
| Google consent screen change needs review or Search Console verification | Medium | Sign-in on the new host delayed | Start Phase 3 early; keep old entries |
| Sessions lost on the new host (host-only cookies) | Certain | Owner and friends sign in once again | Announce before Phase 2; data is per account |
| 308 cached permanently by browsers | Certain once enabled | Cannot be undone for visitors | Enable `CANONICAL_HOST` last, only when sure |
| HSTS set too early or too long | Low | Hard failure if the certificate breaks | Short max-age first, no preload |
| Cloudflare Free plan limits (request body size, proxy timeout) | Low | Same limits as today on both hosts | Audio streams in ranges |
| `.cc` TLD: spam reputation, some filters distrust it | Medium | Links blocked in some chats or mailers | No email planned; null MX/SPF/DMARC published; watch for blocks |
| Renewal forgotten (promo year, EUR 7.43 after) | Medium | Domain lapses | Auto-renew at Spaceship; reminder September 2027 |
| iOS build still points to the old URL | Certain until Phase 4 | None while the old host serves | Keep the old host 12 months |

## Checklist

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 0 | Domain purchased, invoice stored | A | done |
| 1a | Cloudflare site added, ingress and DNS records created | C | done 2026-10-14 |
| 1b | DNSSEC at Spaceship disabled (if it was on) | A | done 2026-10-14 |
| 1c | Nameservers changed at Spaceship | A | done 2026-10-14 |
| 1d | Cloudflare shows Active | A/C | done 2026-10-14 |
| 2a | `check-domain.sh` all PASS on the new host | C | done 2026-10-14 |
| 2b | Owner and friends told to sign in again | A | done 2026-10-14 |
| 3a | Google origins, redirect URIs, authorised domain added | A | done 2026-10-14 |
| 3b | Apple Services ID domain and return URL added | A | done 2026-10-14 |
| 3c | Sign-in tested on the new host (Google and Apple) | A+C | done 2026-10-14 |
| 4a | iOS default server changed and built | C+A | open |
| 4b | TestFlight build installed on devices | A | open |
| 5a | One week of clean dual-host operation | C | open |
| 5b | `CANONICAL_HOST` set, old host returns 308 | C | open |
| 5c | HSTS enabled on the new zone | C | open |
| 5d | Bookmarks and docs updated | A/C | open |
| 6a | Old-host redirect kept for 12 months | C | open |
| 6b | Auto-renew at Spaceship on | A | open |
