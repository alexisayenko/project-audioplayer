#!/bin/sh
# Local test app with seeded fixture data: seed | start | cookie | stop
# Needs the WSL venv ~/ap2venv (fastapi, uvicorn). From Git Bash it re-runs itself in WSL.
# All values below are localhost-only test fixtures; nothing touches production or real data.
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  exec wsl -e env ${PORT:+PORT=$PORT} ${DEV_LOCAL_DIR:+DEV_LOCAL_DIR=$DEV_LOCAL_DIR} ${AP_VENV:+AP_VENV=$AP_VENV} bash "$(wsl wslpath -a "$(cygpath -m "$0")")" "$@"
fi

REPO=$(cd "$(dirname "$0")/.." && pwd)
DIR=${DEV_LOCAL_DIR:-$HOME/.cache/electrophone-dev}
PORT=${PORT:-8765}
VENV=${AP_VENV:-$HOME/ap2venv}
PIDFILE=$DIR/server.pid
LOG=$DIR/server.log

env_setup() {
  export AUDIO_DATA_DIR=$DIR/data AUDIO_DOWNLOAD_DIR=$DIR/music AUDIO_MUSIC_ROOT=$DIR/music AUDIO_PLAYS_DIR=$DIR/plays
  export OWNER_EMAIL=test-owner@localhost.test AUDIO_API_TOKEN=localtest-token AUDIO_SESSION_SECRET=localtest-session-secret
  export AUDIO_WEB_BUNDLE=0 AUDIO_TAG_LOOKUP=0 AUDIO_GENRE_LOOKUP=0 AUDIO_PLAYS_SYNC=0 ANON_DOWNLOADS_ENABLED=0 GIT_SYNC_MODE=off
}

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

do_stop() {
  if running; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    i=0
    while running && [ $i -lt 20 ]; do sleep 0.25; i=$((i + 1)); done
    if running; then kill -9 "$(cat "$PIDFILE")" 2>/dev/null || true; fi
  fi
  rm -f "$PIDFILE"
}

do_start() {
  [ -d "$DIR/data" ] || { echo "no data in $DIR; run: $0 seed" >&2; exit 1; }
  if running; then echo "already running (pid $(cat "$PIDFILE"))"; return; fi
  env_setup
  cd "$REPO/server"
  nohup "$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" > "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  i=0
  until curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ $i -gt 60 ]; then echo "server did not come up; see $LOG" >&2; exit 1; fi
    sleep 0.5
  done
  echo "up: http://127.0.0.1:$PORT (pid $(cat "$PIDFILE"), log $LOG)"
}

write_library() {
  env_setup
  cd "$REPO/server"
  "$VENV/bin/python" - <<'PY'
import json, os
from app import users
uid = users.owner_uid()
rows = [
 ("Insomnia","Faithless",1995,"Reverence",["trance","house"],510),
 ("Not Over Yet","Grace",1995,"Not Over Yet",["trance"],220),
 ("What Is Love","Haddaway",1993,"The Album",["eurodance"],270),
 ("Rhythm Is a Dancer","Snap!",1992,"The Madman's Return",["eurodance","house"],305),
 ("Strobe","deadmau5",2009,"For Lack of a Better Name",["progressive house"],633),
 ("Sandstorm","Darude",1999,"Before the Storm",["trance"],225),
 ("Windowlicker","Aphex Twin",1999,"Windowlicker",["idm","electronic"],367),
 ("Halcyon","Orbital",1993,"Orbital 2",["techno","ambient"],360),
 ("Smalltown Boy","Bronski Beat",1984,"The Age of Consent",["synthpop"],299),
 ("Alright","Supergrass",1995,"I Should Coco",["britpop"],183),
 ("Hallucinogen in Dub","Hallucinogen",1997,"Twisted",["psytrance"],488),
 ("Snowghost","Hallucinogen",1995,"Twisted",["psytrance"],412),
 ("Open Your Mind","Hallucinogen",1995,"Twisted",["psytrance"],476),
 ("Pressure","Nadia Ali",2009,None,["progressive house"],318),
 ("Cold Heart","Dua Lipa",2021,"Cold Heart",["pop"],202),
 ("Лондон, гуд бай","Земфира",1999,None,["rock"],246),
 ("Blue Monday","New Order",1983,"Power, Corruption & Lies",["synthpop","new wave"],449),
 ("Teardrop","Massive Attack",1998,"Mezzanine",["trip hop"],330),
 ("Angel","Massive Attack",1998,"Mezzanine",["trip hop"],379),
 ("Windowlicker (Live)","Aphex Twin",2003,None,["idm"],410),
 ("Around the World","Daft Punk",1997,"Homework",["house","french house"],429),
 ("Da Funk","Daft Punk",1995,"Homework",["house","french house"],328),
 ("One More Time","Daft Punk",2000,"Discovery",["house","disco"],320),
 ("Levels","Avicii",2011,None,["progressive house"],200),
 ("Untitled Demo","Unknown Artist",None,None,[],95),
]
songs = []
for i, (t, a, y, al, g, d) in enumerate(rows):
    vid = "seed%07d" % i
    s = {"id": vid, "title": t, "artists": [a], "featured": [], "released": y, "album": al,
         "source_url": f"https://www.youtube.com/watch?v={vid}", "duration": d,
         "added_at": f"2026-10-{1+i%25:02d}T10:{i%60:02d}:00Z", "updated_at": f"2026-10-{1+i%25:02d}T11:{i%60:02d}:00Z",
         "tags": [f"genre:{x}" for x in g] + ([f"decade:{str(y)[2]}0s"] if y else []),
         "sources": [{"source": "youtube", "id": vid, "url": f"https://www.youtube.com/watch?v={vid}"}]}
    if i in (3, 13):
        s["bpm"] = 125
    songs.append(s)
p = os.path.join(os.environ["AUDIO_DATA_DIR"], "users", uid)
os.makedirs(p, exist_ok=True)
with open(os.path.join(p, "library.json"), "w", encoding="utf-8") as f:
    json.dump({"settings": {"credits_schema": 1}, "songs": songs}, f, ensure_ascii=False, indent=1)
PY
}

api_seed() {
  PORT=$PORT "$VENV/bin/python" - <<'PY'
import json, os, urllib.request, urllib.error
B = "http://127.0.0.1:" + os.environ["PORT"]
H = {"X-API-Token": "localtest-token", "Content-Type": "application/json"}
def call(m, p, b=None):
    r = urllib.request.Request(B + p, method=m, headers=H, data=json.dumps(b).encode() if b is not None else None)
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
def tr(titles):
    return [{"no": i + 1, "title": t, "durationS": d} for i, (t, d) in enumerate(titles)]
def disc(n):
    return {"type": "discogs", "id": str(n), "url": f"https://www.discogs.com/release/{n}"}
albums = [
 {"title": "Twisted", "artist": "Hallucinogen", "year": 1995, "genres": ["Electronic", "Psytrance"], "rymUrl": None,
  "links": {"discogs": "https://www.discogs.com/release/1001", "rateyourmusic": "https://rateyourmusic.com/release/album/hallucinogen/twisted/", "youtube": None, "wikipedia": "https://en.wikipedia.org/wiki/Twisted_(Hallucinogen_album)"},
  "source": disc(1001), "tracks": tr([("Snowghost", 412), ("Hallucinogen in Dub", 488), ("Open Your Mind", 476), ("LSD", None), ("Spirals", 300)])},
 {"title": "Homework", "artist": "Daft Punk", "year": 1997, "genres": ["Electronic", "House"], "rymUrl": None,
  "links": {"discogs": "https://www.discogs.com/release/1002", "rateyourmusic": None, "youtube": "https://www.youtube.com/playlist?list=PLseedhomework", "wikipedia": None},
  "source": disc(1002), "tracks": tr([("Daftendirekt", 163), ("WDPK 83.7 FM", 28), ("Revolution 909", 325), ("Da Funk", 328), ("Around the World", 429)])},
 {"title": "Mezzanine", "artist": "Massive Attack", "year": 1998, "genres": ["Electronic", "Trip Hop"], "rymUrl": None,
  "links": {"discogs": "https://www.discogs.com/release/1003", "rateyourmusic": None, "youtube": None, "wikipedia": None},
  "source": disc(1003), "tracks": tr([("Angel", 379), ("Risingson", 298), ("Teardrop", 330)])},
]
ids = []
for a in albums:
    s, r = call("POST", "/albums", a)
    print("album", s)
    ids.append(r["id"])
for ai, no, sid in [(0, 1, "seed0000011"), (0, 2, "seed0000010"), (0, 3, "seed0000012"), (1, 4, "seed0000021"), (1, 5, "seed0000020"), (2, 1, "seed0000018"), (2, 3, "seed0000017")]:
    call("PUT", f"/albums/{ids[ai]}/tracks/{no}/song", {"songId": sid})
s, _ = call("POST", "/playlists", {"name": "Test mix", "songs": ["seed0000000", "seed0000004", "seed0000005", "seed0000022"]})
print("playlist", s, "songs", len(call("GET", "/library")[1]["songs"]), "albums", len(call("GET", "/albums")[1]))
PY
}

do_seed() {
  do_stop
  rm -rf "$DIR/data" "$DIR/music" "$DIR/plays"
  mkdir -p "$DIR/data" "$DIR/music" "$DIR/plays"
  write_library
  do_start
  api_seed
  do_stop
  echo "seeded $DIR/data"
}

do_cookie() {
  env_setup
  cd "$REPO/server"
  "$VENV/bin/python" - <<'PY'
from app import session, users
v = session.issue({"provider": "google", "email": "test-owner@localhost.test", "uid": users.owner_uid()})
print(f'document.cookie="{session.COOKIE}={v}; path=/; secure; samesite=strict"')
PY
}

case "${1:-}" in
  seed) do_seed ;;
  start) do_start ;;
  cookie) do_cookie ;;
  stop) do_stop; echo stopped ;;
  *) echo "usage: $0 seed|start|cookie|stop  (DEV_LOCAL_DIR, PORT, AP_VENV optional)" >&2; exit 2 ;;
esac
