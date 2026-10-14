#!/usr/bin/env bash
# Read-only domain health check for the Electrophone server.
# Usage: bash scripts/check-domain.sh [HOST] [--old OLD_HOST]
#   HOST      host to check (default: electrophone.cc)
#   --old H   previous host, compared with HOST (default: none; with no
#             --old only HOST is checked). Example: --old play.isayenko.net
# Checks: DNS (NS/A/AAAA/CNAME), TLS (certificate, HSTS), app (/health, /,
# guest /me, /library, unauthenticated write, audio Range, cache header),
# the old host's redirect behaviour, and equal song counts on both hosts.
# No secrets, no writes (the POST /songs probe is unauthenticated and must
# be refused). Needs curl and openssl; dig is optional (nslookup fallback).
# Exit code: 0 if no check FAILs, 1 otherwise. WARN does not fail.
set -u

HOST="electrophone.cc"
OLD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --old) OLD="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) HOST="$1"; shift ;;
  esac
done

FAILS=0
ROWS=""
row() { # status check detail
  ROWS="${ROWS}$(printf '%-5s | %-34s | %s' "$1" "$2" "$3")"$'\n'
  [ "$1" = "FAIL" ] && FAILS=$((FAILS + 1))
  return 0
}
pass() { row PASS "$1" "$2"; }
fail() { row FAIL "$1" "$2"; }
warn() { row WARN "$1" "$2"; }
info() { row INFO "$1" "$2"; }

dns() { # type name -> values, one per line
  if command -v dig >/dev/null 2>&1; then
    dig +short "$1" "$2" 2>/dev/null | sed 's/\.$//'
  else
    nslookup -type="$1" "$2" 2>/dev/null | tr -d '\r' | awk -v t="$1" '
      t=="NS" && /nameserver =/ {print $NF}
      t=="A" && /^Address/ && !/#/ && seen {print $2}
      t=="AAAA" && /^Address/ && !/#/ && seen {print $2}
      t=="CNAME" && /canonical name =/ {print $NF}
      /^Name:/ {seen=1}' | sed 's/\.$//'
  fi
}

get() { # url [curl args] -> body on stdout, headers in $HDR file
  curl -s -m 20 -D "$HDR" "$@"
}
HDR="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$HDR" "$BODY"' EXIT
status_of() { head -n1 "$HDR" | tr -d '\r' | awk '{print $2}'; }
header_of() { grep -i "^$1:" "$HDR" | tail -n1 | tr -d '\r' | cut -d' ' -f2-; }
count_songs() { grep -o '"added_at":"' | wc -l | tr -d ' '; }

check_host() { # host -> sets LIBCOUNT_<n>
  local h="$1" url="https://$1" t s body ids
  # (a) DNS
  local ns a aaaa cn
  ns="$(dns NS "$h" | sort | tr '\n' ' ')"
  if [ -z "$ns" ] && [ "${h#*.*.}" != "$h" ]; then
    ns="(subdomain: see parent zone)"
  fi
  if printf '%s' "$ns" | grep -qi 'ns\.cloudflare\.com'; then
    pass "DNS NS $h" "$ns"
  elif [ -n "$ns" ]; then
    if [ "${h#*.*.}" != "$h" ]; then info "DNS NS $h" "$ns"; else fail "DNS NS $h" "not Cloudflare: $ns"; fi
  else
    fail "DNS NS $h" "no NS answer (nameservers not switched yet?)"
  fi
  a="$(dns A "$h" | tr '\n' ' ')"; aaaa="$(dns AAAA "$h" | tr '\n' ' ')"; cn="$(dns CNAME "$h" | tr '\n' ' ')"
  if [ -n "$a$aaaa$cn" ]; then pass "DNS A/AAAA/CNAME $h" "A=${a:-none} AAAA=${aaaa:-none} CNAME=${cn:-none}"
  else fail "DNS A/AAAA/CNAME $h" "no address records"; fi

  # (b) TLS
  t="$(get -o /dev/null "$url/" -w '%{http_code}')"
  if [ "$t" = "200" ]; then pass "HTTPS GET / $h" "status 200"
  else fail "HTTPS GET / $h" "status ${t:-none}"; return; fi
  local hsts; hsts="$(header_of strict-transport-security)"
  if [ -n "$hsts" ]; then info "HSTS $h" "$hsts"; else info "HSTS $h" "not set"; fi
  local cert
  cert="$(printf '' | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' ')"
  if [ -n "$cert" ]; then
    pass "TLS cert $h" "$(printf '%s' "$cert" | sed 's/issuer=//; s/notAfter=/expires /')"
    if ! printf '' | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -checkend 604800 >/dev/null 2>&1; then
      fail "TLS expiry $h" "certificate expires within 7 days"
    fi
  else fail "TLS cert $h" "could not read certificate"; fi

  # (c) app
  body="$(get "$url/health")"
  if [ "$(printf '%s' "$body" | tr -d ' ')" = '{"status":"ok","sync":"ok"}' ]; then pass "/health $h" "$body"
  else fail "/health $h" "got: ${body:0:80}"; fi

  body="$(get "$url/")"
  if printf '%s' "$body" | grep -qi '<title>Electrophone'; then pass "/ HTML title $h" "Electrophone"
  else fail "/ HTML title $h" "no Electrophone <title>"; fi

  body="$(get "$url/me")"
  keys="$(printf '%s' "$body" | grep -o '"[a-z_]*":' | tr -d '":' | sort | tr '\n' ' ')"
  if [ "$keys" = "audio guest owner_label public_view " ]; then pass "guest /me keys $h" "$keys"
  else fail "guest /me keys $h" "keys: ${keys:-none} (expect audio guest owner_label public_view)"; fi

  get "$url/library" >"$BODY"
  s="$(status_of)"
  local n; n="$(count_songs <"$BODY")"
  if [ "$s" = "200" ] && [ "$n" -gt 0 ]; then pass "/library $h" "200, $n songs"
  else fail "/library $h" "status $s, $n songs"; fi
  eval "COUNT_$2=$n"
  local cc; cc="$(header_of cache-control)"
  case "$cc" in *private*) pass "/library Cache-Control $h" "$cc" ;; *) fail "/library Cache-Control $h" "'${cc:-missing}' (expect private)" ;; esac

  s="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$url/songs")"
  if [ "$s" = "401" ]; then pass "unauth POST /songs $h" "401"; else fail "unauth POST /songs $h" "status $s (expect 401)"; fi

  ids="$(tr '{' '\n' <"$BODY" | grep '"file":"' | grep -o '"id":"[^"]*"' | head -n1 | cut -d'"' -f4)"
  if [ -n "$ids" ]; then
    s="$(curl -s -m 30 -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1023' "$url/files/$ids")"
    if [ "$s" = "206" ]; then pass "/files/<id> Range $h" "206 ($ids)"; else fail "/files/<id> Range $h" "status $s for $ids (expect 206)"; fi
  else warn "/files/<id> Range $h" "no song with audio file in /library"; fi
}

COUNT_new=0; COUNT_old=0
check_host "$HOST" new

# (d) + (e) old host
if [ -n "$OLD" ]; then
  check_host "$OLD" old
  s="$(curl -s -m 20 -o /dev/null -D "$HDR" -w '%{http_code}' "https://$OLD/")"
  loc="$(header_of location)"
  case "$s" in
    308|301|302|307) info "old host redirect" "$OLD -> $s $loc"
      case "$loc" in *"$HOST"*) pass "old host redirects to canonical" "$s to $loc" ;; *) warn "old host redirects elsewhere" "$loc" ;; esac ;;
    200) info "old host redirect" "$OLD serves directly (dual-host, no redirect yet)" ;;
    *) fail "old host redirect" "status $s" ;;
  esac
  if [ "$COUNT_new" = "$COUNT_old" ]; then pass "song counts equal" "$HOST=$COUNT_new $OLD=$COUNT_old"
  else fail "song counts equal" "$HOST=$COUNT_new $OLD=$COUNT_old"; fi
fi

printf '%-5s | %-34s | %s\n' STATUS CHECK DETAIL
printf '%s' "$ROWS"
if [ "$FAILS" -gt 0 ]; then echo "RESULT: FAIL ($FAILS failing)"; exit 1; fi
echo "RESULT: PASS"
