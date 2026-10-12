# CI/CD

Playbook for testing and shipping a project on the GitHub Free
plan with a $0 Actions budget. Extracted from moene
(`project-moodtracker`), which is the worked example throughout;
swap its commands for the project's own and keep the shape.

## Principles

- **Every workflow is manual.** Only `workflow_dispatch`; nothing
  on push, PR or schedule. Free private repos get ~2,000 Linux
  minutes a month and a $0 budget set to "Stop usage" means a
  surprise run can lock every later one out. The cost: a push or a
  Dependabot PR gets no checks until someone runs them.
- **Quality and deploy are separate workflows.** Quality
  workflows run tests and checks and never deploy; the deploy
  workflow builds and ships and runs no tests. Nothing gates the
  deploy on the checks — run them first if you want them.
- **Deploy is main-only and serialised.** Guard the job with
  `if: github.ref == 'refs/heads/main'` and a `concurrency` group
  so two deploys never overlap.
- **Secrets never live in the repo.** GitHub Actions secrets in
  CI, `~/.config/<service>/<name>.env` locally. See
  [Secrets and credentials](#secrets-and-credentials).
- **Pin everything that can drift.** Third-party actions by
  commit SHA with a version comment, the deploy tool's version,
  the test-tool version used by a cache key.
- **Every cloud path has a local twin.** Anything CI does, a
  developer machine can do, because minutes run out.

## The four workflows

| Name | File | Jobs | Needs | Runner | Cost |
| --- | --- | --- | --- | --- | --- |
| Test Code Quality | `code-quality.yml` | `web-unit`, `worker-unit`, `mobile-typecheck`, `mobile-lint`, `mobile-doctor`, `mobile-unit`, `sonar` (main only, after the unit jobs) | `SONAR_TOKEN` | Linux | measured in moene (2026-10-01): jobs run 15-57 s, Sonar 159 s; about 9 billed min per run, each parallel job rounds up to a whole minute |
| Test UI/UX Quality | `ui-quality.yml` | `web-e2e`, `web-lighthouse`, `mobile-xcuitest`, `mobile-e2e` | none | Linux + macOS | measured in moene (2026-10-01): Linux jobs about 3 billed min; the two macOS jobs took 717 s and 725 s, about 25 macOS min = about 250 billed min per run |
| Deploy Web | `deploy.yml` | `deploy` (main only) | `CLOUDFLARE_API_TOKEN` | Linux | measured in moene: 73 s, 2 billed min |
| Deploy App TestFlight | `testflight.yml` | `testflight` | `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | macOS | [TODO: not measured — the workflow never ran in moene; expect a macOS archive in the tens of minutes, billed x10] |

Triggers: all four are `workflow_dispatch`. Inputs where useful:
`all_browsers` (e2e in Chromium, Firefox, WebKit), `build_number`
and `private_build` (TestFlight).

### Shared structure across projects

The same four workflows, names and files, are used by moene
(Expo app plus web and Worker) and food-tracker (native SwiftUI
app plus a Cloudflare Worker). Keep the names and the file
layout; swap the jobs.

| Workflow | moene jobs | food-tracker jobs |
| --- | --- | --- |
| `code-quality.yml` | `web-unit`, `worker-unit`, `mobile-*`, `sonar` | `worker-unit`, `docs-lint`; with input `ios`: `ios-unit`, `sonar` |
| `ui-quality.yml` | `web-e2e`, `web-lighthouse`, `mobile-xcuitest`, `mobile-e2e` | `ios-xcuitest` |
| `deploy.yml` | `deploy` (site) | `deploy` (Worker and web client) |
| `testflight.yml` | `testflight` (Expo prebuild) | `testflight` (XcodeGen, `xcodebuild`) |

Shared patterns on every workflow:

- `workflow_dispatch` only, header comment naming the trigger and
  the `gh workflow run <file> --ref main` form.
- `permissions: contents: read`, `persist-credentials: false`,
  actions pinned by SHA with a version comment, `timeout-minutes`
  on macOS and long jobs, a `concurrency` group (deploy and
  TestFlight never cancel a run in progress).
- Deploy jobs guard with `if: github.ref == 'refs/heads/main'`;
  Sonar runs on `main` only, after the unit jobs.
- A `docs-lint` job (markdownlint-cli2 and actionlint) beside the
  unit jobs, and a local twin, `.github/scripts/check.sh`, that
  runs the same checks on a developer machine.
- A macOS job that is needed rarely (iOS unit tests for Sonar)
  sits behind a boolean `ios` input, default false, so a default
  Quality run costs Linux minutes only; XCUITest has its own
  workflow.
- A project without browser tests skips `web-e2e` and
  `web-lighthouse`; a native SwiftUI project uses XCUITest and
  no Maestro. Note the omission in the workflow header.
- A project with several deployables (site, Worker) keeps one
  `deploy.yml` per deployable only when they ship separately;
  otherwise one job each in the same file.

Run one:

```sh
gh workflow run code-quality.yml --ref main   # or Actions > workflow > Run workflow
gh run list --workflow code-quality.yml --limit 5
gh run watch                                  # pick the run, stream until done
gh run view <run-id> --log-failed             # failing steps only
```

`gh` needs a token with **Actions: Read and write** on the repo (a
fine-grained token, or `gh auth login`). Dependabot-authored runs
do not receive repository secrets, so a secret-needing job such as
Sonar must be dispatched by a person.

## Test layers

| Layer | Tool (moene) | Catches | Where |
| --- | --- | --- | --- |
| Unit | Node built-in test runner (web, Worker); Jest (mobile) | Logic, scoring, API handlers against fakes | `code-quality.yml` |
| Static | ESLint, `tsc --noEmit`, `expo-doctor` | Type errors, lint, SDK/dependency mismatches | `code-quality.yml` |
| Quality gate | SonarCloud, lcov coverage | Bugs, smells, coverage drops, hotspots | `sonar` job, main only |
| Web e2e | Playwright + axe against the built site, API mocked | Broken screens, WCAG A/AA violations (serious+ fail) | `web-e2e` |
| Web performance | Lighthouse CI against the **live** site | LCP, CLS, TBT, accessibility, best-practice regressions | `web-lighthouse` |
| Native accessibility | XCUITest `performAccessibilityAudit`, launch/hitch metrics | Touch targets, labels, contrast, launch regressions | `mobile-xcuitest` |
| Native flows | Maestro YAML flows, bundle-size budget | Navigation breakage, bundle bloat | `mobile-e2e` |

Notes per layer:

- **Unit.** `npm run test:coverage` writes `coverage/lcov.info`;
  the mobile job uploads its lcov as an artifact so the Sonar job
  can download and merge both.
- **Sonar.** `sonar-project.properties` sets `sonar.sources=.`,
  lists test paths in `sonar.test.inclusions`, both lcov files in
  `sonar.javascript.lcov.reportPaths`, and excludes docs, tests
  and fixtures from analysis (`sonar.exclusions`) and scripts,
  config and native plugins from coverage
  (`sonar.coverage.exclusions`). Use `fetch-depth: 0` on checkout.
  Turn off SonarCloud "Automatic Analysis" in its UI first, or it
  refuses CI analysis.
- **Web e2e.** Own `package.json` and lockfile in `e2e/` so the
  app root stays dependency-free. A tiny static server serves the
  built `dist/`; auth and data endpoints are mocked per test with
  fixtures, so no credentials or network are involved. Cache the
  browser download keyed on the Playwright version in the
  lockfile; upload the report on failure.
- **Lighthouse.** Audits whatever is deployed, so it measures new
  code only after a deploy. It audits the signed-out first screen,
  not the app behind login.
- **XCUITest.** A generated test target (a config plugin adds it
  to the prebuilt project). Build **Release**: a Debug Expo build
  expects a Metro server that CI does not run.
- **Maestro.** Pin the version; run only flows that need no
  login (`--exclude-tags signed-in,write`). A real login cannot
  be completed headlessly, so signed-in flows stay local.

## Cost model

- Billing multipliers on Free private repos: Linux 1x, Windows 2x,
  **macOS 10x**. 2,000 minutes a month is ~200 macOS minutes. In
  moene one full UI/UX run (two simulator jobs of ~12 min each)
  bills about 250 minutes, so the month holds about eight of them
  and nothing else.
- iOS simulator tests need macOS whatever the framework
  (XCUITest, Maestro, Detox), because the simulator only runs
  there. Web e2e needs no simulator and runs cheaply on Linux, so
  keep as much coverage as possible in web/Linux layers.
- Run macOS-only jobs locally by default (`xcodebuild test`,
  `maestro test`); dispatch them in CI only for a release or when
  the Mac is unavailable. Use `timeout-minutes` and `concurrency`
  with `cancel-in-progress` so a stuck run does not drain the
  budget.
- Cache aggressively: `setup-node` npm cache, Playwright browsers,
  CocoaPods `Pods/`.
- **When minutes run out** every job fails within seconds with no
  steps run, Deploy Web included, until the monthly reset. Use the
  local twins: manual deploy below and the local TestFlight path.
  Public repos are free on standard runners; making a private repo
  public is not a cost fix for a project with private data.

## Manual deploy fallback

Same build as CI, from a developer machine. The example is a
Cloudflare Worker with static assets.

```sh
set -a && . ~/.config/cloudflare/token.env && set +a   # never print it
export CLOUDFLARE_ACCOUNT_ID=[TODO: account id]
(cd [TODO: app dir] && npm ci) && npm run build:site
npx -y wrangler@[TODO: pinned version] deploy
```

- **Token permissions:** Workers Scripts: Edit and Account: Read.
  Without Workers Routes: Edit the deploy ends with a harmless
  `workers/routes` API error after the new version is uploaded;
  confirm with `wrangler deployments list`.
- **Pin the wrangler version** to the one in the workflow, the
  same pin CI uses. Features such as `run_worker_first` need a
  minimum version (4.20 there).
- **Deploy from a clean copy**, not a working tree with
  unfinished edits: `git worktree add ../deploy main` (or a fresh
  clone), `npm ci`, build, deploy, then remove the worktree. A
  shared checkout often holds other work that must not ship.
- **Config in the file, not the dashboard.** Every deploy
  rewrites Worker vars from `wrangler.toml`; secrets are never
  touched and must already exist in Cloudflare before code needing
  them is deployed.
- **Smoke checks after deploy:** `curl -sI https://[TODO: domain]/`
  returns 200; one unauthenticated API route returns its expected
  401/200; the redirect or alias domains still redirect; then run
  `web-lighthouse`.

## Mobile release path

Two paths to TestFlight, same steps: `expo prebuild`, `pod install`,
`xcodebuild archive`, `xcodebuild -exportArchive`, `altool
--validate-app` then `--upload-app`.

| | Local Mac | `testflight.yml` on macOS runner |
| --- | --- | --- |
| Signing | Xcode account session (an Admin of the team); cloud-managed distribution signing, no local certificate | App Store Connect API key with the **Admin** role through `-allowProvisioningUpdates -authenticationKey*` |
| Upload | `altool` with a key in `~/.appstoreconnect/private_keys/` | same, key written from secrets, removed in an `if: always()` step |
| Cost | free | [TODO: measure on the first run; billed x10 on macOS] |

- **Build number = latest on App Store Connect + 1**, never the
  last number in git; ASC rejects a repeated or lower one. The
  workflow reads the latest through the ASC API (ES256 JWT signed
  with the key) when `build_number` is blank, and writes the
  result into the generated `Info.plist`, not the app config.
- **Local key:** an App Manager key is enough for `altool`
  uploads but not for cloud signing on a fresh machine; that needs
  Admin. When archive or export fails on signing locally, sign in
  again under Xcode > Settings > Accounts and rerun.
- **UTF-8 locale:** set `LANG=en_US.UTF-8` and `LC_ALL=en_US.UTF-8`
  before `pod install` and in the workflow `env`; CocoaPods
  crashes with a Unicode normalisation error under a plain `C`
  locale.
- **Generated `ios/` is gitignored**, so cache Pods on the
  Podfile plus npm lockfile hash, not `Podfile.lock`.
- **Human-only steps:** add the GitHub secrets; create the ASC
  API key with the right role; sign in to Xcode; accept new
  Apple agreements.

## Secrets and credentials

- **Locally:** one file per credential,
  `~/.config/<service>/<name>.env`, `chmod 600`, sourced at use
  time with `set -a; . file; set +a`. Never printed, never in
  the repo or in `.claude/`, never a persistent env var.
- **In CI:** repository secrets (Settings > Secrets and variables
  > Actions). The owner sets them; an agent must not, and never
  reads their values.
- **Names per workflow:**
  - `code-quality.yml`: `SONAR_TOKEN`
  - `deploy.yml`: `CLOUDFLARE_API_TOKEN`
  - `testflight.yml`: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`
  - `ui-quality.yml`: none
- **GitHub token for `gh`:** fine-grained, scoped to the one repo,
  **Actions: Read and write** and nothing else; no Secrets
  permission, so it can dispatch runs but not read or change
  secrets.
- Third-party tokens use least privilege (Cloudflare: scripts
  only; ASC: the lowest role that works).
- Use `persist-credentials: false` on checkout where the job
  does not push, and `permissions: contents: read` at workflow
  level.

## Dependabot policy

- Weekly, minor and patch grouped into one PR per directory;
  prefixes `build(deps)` and `ci(deps)`.
- Merges are manual. Its PRs get no CI unless someone dispatches
  the quality workflows on the branch.
- Ignore semver-major bumps of the framework pins (`expo`,
  `react`, `react-native`); SDK upgrades are a deliberate task
  (`npx expo install --fix`).
- Skip, and leave open, updates the pinned framework or its lint
  plugins do not support yet (moene: ESLint, TypeScript, Jest
  majors waiting on Expo SDK support).
- Dependabot-triggered runs get no repo secrets, so a Sonar job
  cannot run for them.

## Setup checklist for a new project

1. Create the repo from the template; enable Issues/Actions;
   set the Actions budget to $0 "Stop usage".
2. Copy the starters below to `.github/workflows/` and
   `.github/scripts/check.sh`, and fill the `[TODO: …]`
   commands; add `.github/dependabot.yml`; pin each
   action to a commit SHA.
3. Create the SonarCloud project (disable Automatic Analysis),
   add `sonar-project.properties`, generate a token.
4. Add repository secrets: `SONAR_TOKEN`, `CLOUDFLARE_API_TOKEN`
   (and `ASC_*` if shipping iOS); put local copies in
   `~/.config/<service>/<name>.env`.
5. Dispatch each workflow once on `main`
   (`gh workflow run <file> --ref main`), fix red jobs, then
   deploy and run Lighthouse against the live site.
6. Record the result in [`README.md`](README.md) (Deploy and CI
   rows, known gaps) and add a dated line to
   [`../milestones.md`](../milestones.md).

## Lessons and pitfalls

- **Free-plan outage.** Minutes ran out and all jobs, deploy
  included, failed in seconds with no steps. The local deploy path
  became the normal path; keep it documented and tested.
- **Deploy from a clean copy** or other sessions' unfinished edits
  ship with it.
- **Pin versions:** wrangler (a feature needed 4.20+), Maestro
  (flows are written against one version), Playwright (cache key),
  Mermaid-style render tools used in build steps.
- **Sonar:** disable Automatic Analysis first; exclude test code
  from analysis and scripts/config/plugins from coverage; merge
  per-package lcov files; the scan needs full history.
- **Lighthouse** is only as good as the page it hits: a signed-out
  shell is what it audits. Wins came from a small first bundle,
  lazy-loading the signed-in shell, and an inline image as the
  LCP candidate (Performance 52 to 95); watch CLS and TBT after
  adding fonts or late-rendering content.
- **e2e mocks:** mock at the network boundary per test, scan every
  visited screen with axe, fail on serious/critical only.
- **44pt touch targets:** the XCUITest accessibility audit fails
  controls smaller than 44x44pt, links included; size tappable
  elements up front.
- **Release, not Debug,** for simulator tests that need an
  embedded JS bundle.
- **CI never has a login:** design tests so a signed-out run is a
  valid pass and tag signed-in flows to exclude them.
- **No `ASC_*` secrets means the TestFlight workflow fails at its
  first key step;** it is a fallback, not the daily path.

## Starter workflow files

Trimmed and generic. Pin every `uses:` to a commit SHA in real use.

### Test Code Quality

```yaml
name: Test Code Quality
on:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: code-quality-${{ github.ref }}
  cancel-in-progress: true
jobs:
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@[TODO: sha]
        with:
          fetch-depth: 0
      - uses: actions/setup-node@[TODO: sha]
        with:
          node-version: '[TODO: version]'
          cache: npm
      - run: npm ci
      - run: npm run lint && npm run typecheck   # [TODO: or remove]
      - run: npm run test:coverage                # writes coverage/lcov.info
      - uses: actions/upload-artifact@[TODO: sha]
        with:
          name: lcov
          path: coverage/lcov.info
  sonar:
    needs: [unit]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@[TODO: sha]
        with:
          fetch-depth: 0
      - uses: actions/download-artifact@[TODO: sha]
        with:
          name: lcov
          path: coverage
      - uses: SonarSource/sonarqube-scan-action@[TODO: sha]
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

For a project with a Worker or a native iOS target, add jobs
beside `unit`: `worker-unit` (`working-directory: worker`:
`npm ci`, `npx tsc --noEmit`, `npm test`), `docs-lint`
(`git ls-files '*.md' | xargs npx --yes markdownlint-cli2@[TODO:
version]`, then actionlint) and, behind an `ios` boolean input
(`if: ${{ inputs.ios }}`), `ios-unit` (macOS,
`xcodebuild test -enableCodeCoverage YES
-only-testing:[TODO: App]Tests`) feeding `sonar`.

### Local check script

`.github/scripts/check.sh`, the twin of the Linux quality jobs:

```sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

git ls-files '*.md' | xargs npx --yes markdownlint-cli2@[TODO: version]
for f in .github/workflows/*.yml .github/dependabot.yml; do
  python3 -c 'import sys, yaml; yaml.safe_load(open(sys.argv[1]))' "$f"
done
if command -v actionlint >/dev/null; then actionlint; else echo "actionlint not installed, skipped"; fi

[TODO: unit, lint and typecheck commands, e.g. (cd worker && npm ci && npx tsc --noEmit && npm test)]
```

### Test UI/UX Quality

```yaml
name: Test UI/UX Quality
on:
  workflow_dispatch:
    inputs:
      all_browsers:
        type: boolean
        default: false
jobs:
  web-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@[TODO: sha]
      - uses: actions/setup-node@[TODO: sha]
        with:
          node-version: '[TODO: version]'
          cache: npm
      - run: npm ci && npm run build   # [TODO: build to dist/]
      - run: npm ci && npx playwright install --with-deps chromium
        working-directory: e2e
      - run: npx playwright test
        working-directory: e2e
      - uses: actions/upload-artifact@[TODO: sha]
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report/
  web-lighthouse:            # audits the LIVE site: run after a deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@[TODO: sha]
      - uses: treosh/lighthouse-ci-action@[TODO: sha]
        with:
          urls: https://[TODO: domain]
          uploadArtifacts: true
  mobile-xcuitest:           # macOS = 10x minutes; prefer running locally
    runs-on: macos-latest
    timeout-minutes: 60
    env:
      LANG: en_US.UTF-8
      LC_ALL: en_US.UTF-8
    steps:
      - uses: actions/checkout@[TODO: sha]
      - uses: actions/setup-node@[TODO: sha]
        with:
          node-version: '[TODO: version]'
      - run: npm ci --ignore-scripts && npx expo prebuild --platform ios --no-install
      - run: cd ios && pod install
      - run: |
          xcodebuild test -workspace ios/[TODO: App].xcworkspace -scheme [TODO: App] \
            -configuration Release -destination 'platform=iOS Simulator,name=[TODO: iPhone]' \
            -only-testing:[TODO: App]UITests
```

### Deploy Web

```yaml
name: Deploy Web
on:
  workflow_dispatch:
jobs:
  deploy:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    concurrency: deploy
    steps:
      - uses: actions/checkout@[TODO: sha]
      - uses: actions/setup-node@[TODO: sha]
        with:
          node-version: '[TODO: version]'
          cache: npm
      - run: npm ci && npm run build   # [TODO: produces the deployable dir]
      - uses: cloudflare/wrangler-action@[TODO: sha]
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          wranglerVersion: '[TODO: pinned version]'
```

### Deploy App TestFlight

```yaml
name: Deploy App TestFlight
on:
  workflow_dispatch:
    inputs:
      build_number:
        description: CFBundleVersion (blank = latest on App Store Connect + 1)
        default: ''
concurrency:
  group: testflight
  cancel-in-progress: false
permissions:
  contents: read
env:
  LANG: en_US.UTF-8
  LC_ALL: en_US.UTF-8
jobs:
  testflight:
    runs-on: macos-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@[TODO: sha]
        with:
          persist-credentials: false
      - uses: actions/setup-node@[TODO: sha]
        with:
          node-version: '[TODO: version]'
      - name: Write App Store Connect API key
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_KEY_P8: ${{ secrets.ASC_KEY_P8 }}
        run: |
          umask 077; mkdir -p ~/.appstoreconnect/private_keys
          printf '%s\n' "$ASC_KEY_P8" > ~/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8
      - run: npm ci --ignore-scripts && npx expo prebuild --platform ios --no-install
      - run: cd ios && pod install
      # [TODO: set CFBundleVersion: input, or latest ASC build + 1 via the ASC API]
      - name: Archive, export, upload
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
        run: |
          K=~/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8
          A="-allowProvisioningUpdates -authenticationKeyPath $K -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
          xcodebuild -workspace ios/[TODO: App].xcworkspace -scheme [TODO: App] -configuration Release \
            -destination generic/platform=iOS -archivePath $RUNNER_TEMP/app.xcarchive \
            DEVELOPMENT_TEAM=[TODO: team id] $A archive
          xcodebuild -exportArchive -archivePath $RUNNER_TEMP/app.xcarchive \
            -exportOptionsPlist ExportOptions.plist -exportPath $RUNNER_TEMP/export $A
          ipa=$(ls $RUNNER_TEMP/export/*.ipa | head -1)
          xcrun altool --validate-app -f "$ipa" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
          xcrun altool --upload-app -f "$ipa" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
      - name: Remove API key
        if: always()
        run: rm -rf ~/.appstoreconnect/private_keys
```
