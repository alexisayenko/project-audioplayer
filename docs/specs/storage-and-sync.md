# Storage and sync

Code: `server/app/gitstore.py`, `server/app/library.py`, `server/app/deps.py`, `server/app/jsonio.py`,
`web/js/app.js`. ADR: ADR-0005 (and ADR-0004 for audio hosting), ADR-0012 (per-user layout).

## Where data lives

| Data | Home |
| --- | --- |
| `profile.json`, `library.json`, `drafts.json` (per user) | git repo `alexisayenko/data-storage`, ~~`audioplayer/library.json`~~ `audioplayer/users/<uid>/{profile,library,drafts}.json` (ADR-0012; drafts: ADR-0032, DATA-180) |
| covers `<id>.jpg` | git LFS repo `alexisayenko/data-storage-lfs`, ~~`audioplayer/covers/<id>.jpg`~~ `audioplayer/users/<uid>/covers/<id>.jpg` |
| audio `<id>.m4a` | server disk (perkunas dataset, bind-mounted into LXC 106), in neither repo; ~~`<music_root>/<id>.m4a`~~ `<music_root>/users/<uid>/<id>.m4a` |

- STO-001 MUST: with `AUDIO_DATA_REPO` set, the live library is the server's own clone of the data repo and every library change is a commit; the server never uses the PC's `C:\Alex\data-storage`. Status: implemented (deployed 2026-10-13)
- STO-002 MUST: with `AUDIO_DATA_REPO` unset (dev, tests) `users/<uid>/library.json`, `profile.json` and `covers/` are plain files in `AUDIO_DATA_DIR` (default `.`) and `/health` `sync` is always `ok`. Status: implemented
- STO-003 MUST: covers go to the LFS repo when `AUDIO_COVERS_REPO` is set; LFS tracking is decided by that repo's `.gitattributes` and needs `git-lfs` on the server. Status: implemented
- STO-004 MUST: reads are served from the local clone (no pull on read). Status: implemented
- STO-005 MUST: audio is never committed to git. Status: implemented

## Audio location (`music_root`)

- STO-010 MUST: the audio directory is resolved in this order: env `AUDIO_MUSIC_ROOT`, then the owner's `settings.music_root` (one server-wide root; each user's files are below `users/<uid>/`), then `AUDIO_DOWNLOAD_DIR` (default `downloads`). Status: implemented
- STO-011 MUST: `<servername>://<path>/` resolves through the hosts map to `<mount>/<path>`; a plain path is used as is. Status: implemented
- STO-012 MUST: the hosts map comes from `AUDIO_HOSTS="name=/mount;name2=/mount2"` and/or `AUDIO_HOSTS_FILE` (JSON `{name: mount}`; `AUDIO_HOSTS` wins on conflict). It is kept outside the repo. Status: implemented
- STO-013 MUST: an unknown `<servername>` gives 503 `music_root server '<name>' is not configured (AUDIO_HOSTS)` for file/BPM requests. Status: implemented
- STO-014 MUST: songs reference audio only by relative `file`; relocating music means changing one value. Status: implemented

## Write path

- STO-020 MUST: all writes are single-writer: a per-user lock, then (git store) the one global git lock: `git pull --rebase`, write the user's `library.json` atomically, `git add -A -- audioplayer`, commit, push. Status: implemented
- STO-021 MUST: commit messages are `audioplayer: <uid8> add <id>`, `edit <id>`, `delete <id>`, `delete audio <id>`, `bpm <id>`, `signup`, `detect bpm for N songs` (BPM backfill) (`<uid8>` = first 8 hex of the uid); author defaults to `audioplayer-server <audioplayer@localhost>`. Status: implemented
- STO-022 MUST: both repos are committed and pushed in the same write when both are configured. Status: implemented
- STO-023 MUST: pull is best effort: a failed pull is logged, the rebase is aborted, and the write proceeds (offline must not block writes). Status: implemented
- STO-024 MUST: if the write body raises, uncommitted tracked changes are reverted (`git checkout -- .`). Status: implemented
- STO-025 MUST: git runs non-interactively (`GIT_TERMINAL_PROMPT=0`, 120 s timeout); an optional deploy key `AUDIO_GIT_SSH_KEY` is used with `IdentitiesOnly` and the key path is scrubbed from error text. Status: implemented
- STO-026 SHOULD: in `request` mode a save costs one push (~1-2 s), in `timer` mode none (STO-054); acceptable at a few hundred songs. Status: implemented

## Retry and sync states

- STO-030 MUST: in `request` mode (rollback, `GIT_SYNC_MODE=request`) a failed push keeps the local commit, marks the repo dirty and starts one background retry thread (pull, push) with exponential backoff, 2 s doubling to a 300 s cap, until a push succeeds; in `timer` mode (default) there is no retry thread: the next timer run retries. Status: implemented
- STO-031 MUST: `/health` `sync.state` is `ok` (nothing unpushed), `pending` (unpushed, oldest younger than the stale threshold, fewer than 5 consecutive failures, no rejection), `stale` (oldest unpushed commit older than `interval + 30 s`, 90 s by default, strictly greater), `error` (a rejected push, 5 or more consecutive failed runs, or no upstream); the owner form carries the counts (API-137). Status: implemented (built, not deployed)
- STO-032 MUST: at startup unpushed local commits (`@{u}..HEAD`) are detected and pushed (`resync` in `request` mode; STO-056 in `timer` mode). Status: implemented
- STO-033 MUST: the web UI polls `/health` every 30 s (and at load) and shows the top banner only when `sync.state` is `stale` or `error`, not on `pending`, which is normal for up to a minute after a save; see WEB-094 to WEB-097. Status: implemented (built, not deployed)
- STO-034 MUST: a write is never lost because of a push failure; it is acknowledged to the client, committed locally and pushed later. Status: implemented
- STO-035 SHOULD: a remote that moved is never merged automatically: when only GitHub is ahead it is fast-forwarded (STO-057); when both sides have new commits outside the owned paths the local commits are rebased (STO-061); when GitHub touched an owned path `sync` is `error` ("diverged") and the operator resolves it by hand ([deploy.md](../tech/deploy.md#git-sync-timer)); with `GIT_SYNC_INBOUND=0` the repo is marked `rejected` instead. Status: implemented (built, not deployed)

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUDIO_API_TOKEN` | (required) | API token; unset gives 503 |
| `AUDIO_DATA_REPO` | unset | path of the data repo clone; enables the git store |
| `AUDIO_COVERS_REPO` | unset | path of the LFS covers repo clone |
| `AUDIO_GIT_SSH_KEY` | unset | deploy key path |
| `AUDIO_MUSIC_ROOT` | unset | overrides `settings.music_root` |
| `AUDIO_HOSTS`, `AUDIO_HOSTS_FILE` | unset | server name to mount path map |
| `AUDIO_DOWNLOAD_DIR` | `downloads` | fallback audio dir |
| `AUDIO_DATA_DIR` | `.` | plain-file `library.json` and `covers/` (no git store) |
| `AUDIO_WEB_DIR` | `<repo>/web` | static UI dir, read at call time (`server/app/web.py`), so a test or a restart-free change takes effect |
| `OWNER_EMAIL` (alias `ALLOWED_EMAIL`) | `alex.isayenko@gmail.com` | the owner: quota-exempt; the `X-API-Token` and `?token=` act as this user |
| `ALLOWED_APPLE_SUB` | unset | Apple `sub` values (comma list) mapped to the owner when Apple hides the email |
| `SIGNUP_OPEN` | `1` | `0`: only existing users and the owner may sign in |
| `USER_MAX_SONGS`, `USER_MAX_BYTES`, `USER_ADDS_PER_HOUR` | `500`, `5368709120`, `20` | per-user limits (owner exempt) |
| `USER_MAX_CONCURRENT_DOWNLOADS`, `GLOBAL_MAX_CONCURRENT_DOWNLOADS` | `1`, `2` | downloads running at once; extra adds are `queued` |
| `POOL_MAX_BYTES` | `161061273600` | audio under `music_root/users` that refuses new downloads (owner included) |
| `AUDIO_TAG_LOOKUP`, `AUDIO_GENRE_LOOKUP` | on | `0/false/no/off` on either disables MusicBrainz and Wikidata/Wikipedia suggestions (tags, year, links) |
| `AUDIO_MB_USER_AGENT` | `audioplayer/0.1 (...)` | User-Agent for MusicBrainz, Wikidata and Wikipedia |

- STO-040 MUST: no credential or token is stored in either repo. Status: implemented

## Per-user layout (ADR-0012)

- STO-050 MUST: every user has `audioplayer/users/<uid>/profile.json` (`email`, `provider`, `created_at`, `subs`) and `library.json` in the data repo, `audioplayer/users/<uid>/covers/<id>.jpg` in the covers repo and `<music_root>/users/<uid>/<id>.m4a` for audio; `uid` is the first 16 hex of `sha256(lowercased email)` (Apple without email: of `sub`). The email appears only inside `profile.json`, never in a path, file name or commit message. Status: implemented
- STO-051 MUST: there is no shared audio pool: the same song in two libraries is two files; a request only ever resolves paths under its own `uid`, which the server derives from the credential. Status: implemented
- STO-052 MUST: library writes are serialised per user; the git write and local commit is serialised across all users by one lock (in `request` mode it also covers pull and push); a user's usage (bytes) is the sum of the real files in their audio directory. Status: implemented
- STO-053 (removed): the one-time legacy-to-per-user migration ran on 2026-10-13; the migration code and its marker were then removed. Status: removed
- STO-054 MUST: in `timer` mode a save writes atomically and commits locally under the git lock (`git add` of `audioplayer/` excluding `*.tmp`, `git commit` with `audioplayer: <uid8> <verb>`), then returns: no pull, no push, no network in the request; a failing save reverts tracked changes and removes new untracked files. Status: implemented (built, not deployed)
- STO-055 MUST: `python -m app.gitsync` (run every 60 s by `audioplayer-gitsync.timer`) pushes each repo with unpushed commits, data then covers, without a lock around the push (the inbound fast-forward of STO-057 takes the write lock); exit 0 ok, 1 a push failed, 2 a repo rejected, 3 config or state error; `--status` prints the owner-form sync object and changes nothing; `--clear-rejected data|covers` clears a sticky rejection; a busy run lock skips the run. Status: implemented (built, not deployed)
- STO-056 MUST: at startup in `timer` mode the server sweeps stray `.json-*.tmp` files, commits a dirty tree as `audioplayer: recover uncommitted changes`, fetches, fast-forwards when only the remote is ahead, marks a diverged repo `rejected`, and pushes unpushed commits within 30 s before the migrations run; on clean shutdown it makes one push pass. Status: implemented (built, not deployed)
- STO-057 MUST: with `GIT_SYNC_INBOUND` not `0` (default `1`) each timer run first does `git fetch` per repo; when `origin` is ahead and the local branch has no unpushed commits it runs `git merge --ff-only` (never rebase, merge commit or force); when local is ahead only it pushes as before; when both have new commits and GitHub touched an owned path it does neither (otherwise STO-061), sets `sync.state` `error` with `last_error` "data diverged: GitHub and the server both have new commits; resolve by hand" (`covers diverged: ...` for the covers repo), logs ERROR on every run and exits 2; the state clears by itself when the repos agree again. A push rejected because `origin` moved is handled the same way. Status: implemented (built, not deployed)
- STO-058 MUST: the fast-forward runs under the same cross-process lock as saves (`flock` on `<GIT_SYNC_STATE_FILE>.write.lock`, plus the in-process lock): saves, cover writes and startup recovery take it blocking (30 s cap), the timer takes it for at most 0.5 s and skips the pull when busy, so a save never starts while files are being rewritten and the timer never holds a save for longer than its local git steps. Status: implemented (built, not deployed)
- STO-059 MUST: before a fast-forward every changed `library.json`, `profile.json` and `drafts.json` is read from the incoming commit and must parse (and, for a library, pass `library.normalize`; for a draft list, hold a `drafts` list); otherwise nothing is applied, the repo is `error` with "inbound change invalid (path)" (only for files under an owned prefix; a change that touches only other paths is fast-forwarded without reading any JSON) and the file is named in the ERROR log; if a file is invalid after the merge, `git reset --hard` returns to the previous HEAD. The server keeps no in-memory library, so a pulled change is served by the next request. Status: implemented (built, not deployed)
- STO-060 MUST: the state file records `last_pull_at` and per repo `behind` and `inbound_error`; `GET /health` owner form reports `inbound: {enabled, last_pull_at, behind}` (API-144). Status: implemented (built, not deployed)
- STO-061 MUST: with `GIT_SYNC_INBOUND` and `GIT_SYNC_REBASE_FOREIGN` not `0` (default `1`), when local has unpushed commits and `origin` has new commits whose paths (every GitHub-only commit, `git log --name-only --no-renames -m`) are all outside `GIT_SYNC_OWNED_PREFIXES` (comma-separated, default `audioplayer/`, the tree saves stage, same in both repos) and disjoint from the local-only commits' paths, the timer takes the write lock (0.5 s, else skips), runs `git rebase @{u}` on the unpushed commits only, re-validates every `library.json` and `profile.json` in the rebased tree, and pushes; on a conflict or an invalid result it runs `git rebase --abort`, restores the previous `HEAD` and reports the diverged (or "inbound change invalid after rebase (path)") error; a successful rebase clears a sticky `rejected` flag and logs INFO "rebased N local commits over M foreign commits (paths outside audioplayer/)". Status: implemented (built, not deployed) (ADR-0028)
- STO-062 MUST: the state file records per repo `last_rebase_at` and `foreign_commits` (cumulative); `GET /health` owner `inbound` gains `foreign_commits` and `last_rebase_at` (additive, API-144); a push rejected after the fetch because of foreign commits outside the owned paths counts as a push failure (retry next run, `error` after 5), a rejection caused by an owned path is the diverged error. Status: implemented (built, not deployed)
