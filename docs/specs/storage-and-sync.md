# Storage and sync

Code: `server/app/gitstore.py`, `server/app/library.py`, `server/app/main.py`,
`web/js/app.js`. ADR: ADR-0005 (and ADR-0004 for audio hosting), ADR-0012 (per-user layout).

## Where data lives

| Data | Home |
| --- | --- |
| `profile.json`, `library.json` (per user) | git repo `alexisayenko/data-storage`, ~~`audioplayer/library.json`~~ `audioplayer/users/<uid>/{profile,library}.json` (ADR-0012) |
| covers `<id>.jpg` | git LFS repo `alexisayenko/data-storage-lfs`, ~~`audioplayer/covers/<id>.jpg`~~ `audioplayer/users/<uid>/covers/<id>.jpg` |
| audio `<id>.m4a` | server disk (perkunas dataset, bind-mounted into LXC 106), in neither repo; ~~`<music_root>/<id>.m4a`~~ `<music_root>/users/<uid>/<id>.m4a` |

- STO-001 MUST: with `AUDIO_DATA_REPO` set, the live library is the server's own clone of the data repo and every library change is a commit; the server never uses the PC's `C:\Alex\data-storage`. Status: implemented (not yet deployed)
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
- STO-021 MUST: commit messages are `audioplayer: <uid8> add <id>`, `edit <id>`, `delete <id>`, `delete audio <id>`, `bpm <id>`, `signup` (`<uid8>` = first 8 hex of the uid); author defaults to `audioplayer-server <audioplayer@localhost>`. Status: implemented
- STO-022 MUST: both repos are committed and pushed in the same write when both are configured. Status: implemented
- STO-023 MUST: pull is best effort: a failed pull is logged, the rebase is aborted, and the write proceeds (offline must not block writes). Status: implemented
- STO-024 MUST: if the write body raises, uncommitted tracked changes are reverted (`git checkout -- .`). Status: implemented
- STO-025 MUST: git runs non-interactively (`GIT_TERMINAL_PROMPT=0`, 120 s timeout); an optional deploy key `AUDIO_GIT_SSH_KEY` is used with `IdentitiesOnly` and the key path is scrubbed from error text. Status: implemented
- STO-026 SHOULD: a save costs one push (~1-2 s); acceptable at a few hundred songs. Status: implemented

## Retry and sync states

- STO-030 MUST: a failed push keeps the local commit, marks the repo dirty and starts one background retry thread (pull, push) with exponential backoff, 2 s doubling to a 300 s cap, until a push succeeds. Status: implemented
- STO-031 MUST: `/health` `sync` is `ok` (nothing unpushed), `pending` (unpushed, fewer than 5 consecutive push failures), `error` (5 or more). Status: implemented
- STO-032 MUST: at startup unpushed local commits (`@{u}..HEAD`) are detected and pushed (`resync`). Status: implemented
- STO-033 MUST: the web UI polls `/health` every 30 s (and at load) and shows a banner when `sync` is not `ok`: `pending` "Library changes are waiting to sync to git."; `error` "Library changes are not reaching git (retrying). Check the server." Status: implemented
- STO-034 MUST: a write is never lost because of a push failure; it is acknowledged to the client and synced later. Status: implemented
- STO-035 SHOULD: a conflicting remote edit (manual change in `data-storage`) is resolved by `pull --rebase`; an unresolvable conflict ends in `error` state. Status: to-confirm

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
| `AUDIO_WEB_DIR` | `<repo>/web` | static UI dir |
| `OWNER_EMAIL` (alias `ALLOWED_EMAIL`) | `alex.isayenko@gmail.com` | the owner: quota-exempt, owns the migrated legacy library |
| `SIGNUP_OPEN` | `1` | `0`: only existing users and the owner may sign in |
| `USER_MAX_SONGS`, `USER_MAX_BYTES`, `USER_ADDS_PER_HOUR` | `500`, `5368709120`, `20` | per-user limits (owner exempt) |
| `USER_MAX_CONCURRENT_DOWNLOADS`, `GLOBAL_MAX_CONCURRENT_DOWNLOADS` | `1`, `2` | downloads running at once; extra adds are `queued` |
| `POOL_MAX_BYTES` | `161061273600` | audio under `music_root/users` that refuses new downloads (owner included) |
| `AUDIO_TAG_LOOKUP`, `AUDIO_GENRE_LOOKUP` | on | `0/false/no/off` on either disables MusicBrainz and Wikidata/Wikipedia suggestions (tags, year, links) |
| `AUDIO_MB_USER_AGENT` | `audioplayer/0.1 (...)` | User-Agent for MusicBrainz, Wikidata and Wikipedia |

- STO-040 MUST: no credential or token is stored in either repo. Status: implemented

## Per-user layout and migration (ADR-0012)

- STO-050 MUST: every user has `audioplayer/users/<uid>/profile.json` (`email`, `provider`, `created_at`, `subs`) and `library.json` in the data repo, `audioplayer/users/<uid>/covers/<id>.jpg` in the covers repo and `<music_root>/users/<uid>/<id>.m4a` for audio; `uid` is the first 16 hex of `sha256(lowercased email)` (Apple without email: of `sub`). The email appears only inside `profile.json`, never in a path, file name or commit message. Status: implemented
- STO-051 MUST: there is no shared audio pool: the same song in two libraries is two files; a request only ever resolves paths under its own `uid`, which the server derives from the credential. Status: implemented
- STO-052 MUST: library writes are serialised per user; the git pull/commit/push cycle is serialised across all users by one lock; a user's usage (bytes) is the sum of the real files in their audio directory. Status: implemented
- STO-053 MUST: at startup, if `audioplayer/library.json` (legacy) exists and the per-user owner library does not, the legacy library, `covers/*.jpg` and the loose audio files in `music_root` are moved under the owner's uid and committed as `audioplayer: migrate legacy library to per-user layout` (both repos), plus the marker `audioplayer/migrations/legacy-to-per-user.json`. Status: implemented
- STO-054 MUST: the migration is idempotent and safe: the marker stops a second run; a conflict (legacy and per-user library both present, a file at both locations, unreadable JSON) aborts before any change; a crash midway is resumed by the next start; a failure while committing rolls the moves back. Status: implemented
