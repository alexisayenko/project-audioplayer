#!/usr/bin/env bash
# Read-only domain health check for the Electrophone server.
# Usage: bash scripts/check-domain.sh [HOST] [--old OLD_HOST]
#   HOST      host to check (default: electrophone.cc)
#   --old H   previous host, compared with HOST (default: none; with no
#             --old only HOST is checked). Example: --old old.example.net
# Checks: DNS (NS/A/AAAA/CNAME), TLS (certificate, HSTS), app (/health, /,
# anonymous /me, /library and /catalog refused with 401 because the public
# view is off (ADR-0041), POST /anon/session issues a token, unauthenticated
# write refused, Cloudflare blocks /wp-login.php and /.env), and the old
# host's redirect behaviour.
# No secrets, no library writes (the POST /songs probe is unauthenticated and
# must be refused; /anon/session only mints a device token). Needs curl and openssl; dig is optional (nslookup fallback).
# Exit code: 0 if no check FAILs, 1 otherwise. WARN does not fail.
set -u

HOST="electrophone.cc"
OLD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --old) OLD="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) HOST="$1"; shift ;;
  esac
done

FAILS=0
ROWS=""
row() { # status check detail
  local status="$1" check="$2" detail="$3"
  ROWS="${ROWS}$(printf '%-5s | %-34s | %s' "$status" "$check" "$detail")"$'\n'
  [[ "$status" = "FAIL" ]] && FAILS=$((FAILS + 1))
  return 0
}
pass() { local check="$1" detail="$2"; row PASS "$check" "$detail"; return 0; }
fail() { local check="$1" detail="$2"; row FAIL "$check" "$detail"; return 0; }
warn() { local check="$1" detail="$2"; row WARN "$check" "$detail"; return 0; }
info() { local check="$1" detail="$2"; row INFO "$check" "$detail"; return 0; }

dns() { # type name -> values, one per line
  local type="$1" name="$2"
  if command -v dig >/dev/null 2>&1; then
    dig +short "$type" "$name" 2>/dev/null | sed 's/\.$//'
  else
    nslookup -type="$type" "$name" 2>/dev/null | tr -d '\r' | awk -v t="$type" '
      t=="NS" && /nameserver =/ {print $NF}
      t=="A" && /^Address/ && !/#/ && seen {print $2}
      t=="AAAA" && /^Address/ && !/#/ && seen {print $2}
      t=="CNAME" && /canonical name =/ {print $NF}
      /^Name:/ {seen=1}' | sed 's/\.$//'
  fi
  return 0
}

get() { # url [curl args] -> body on stdout, headers in $HDR file
  curl -s -m 20 -D "$HDR" "$@"
  return 0
}
HTTP_CODE='%{http_code}'
HDR="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$HDR" "$BODY"' EXIT
status_of() { head -n1 "$HDR" | tr -d '\r' | awk '{print $2}'; return 0; }
header_of() { local name="$1"; grep -i "^$name:" "$HDR" | tail -n1 | tr -d '\r' | cut -d' ' -f2-; return 0; }

check_host() { # host
  local h="$1" url="https://$1" t s body
  # (a) DNS
  local ns a aaaa cn
  ns="$(dns NS "$h" | sort | tr '\n' ' ')"
  if [[ -z "$ns" ]] && [[ "${h#*.*.}" != "$h" ]]; then
    ns="(subdomain: see parent zone)"
  fi
  if printf '%s' "$ns" | grep -qi 'ns\.cloudflare\.com'; then
    pass "DNS NS $h" "$ns"
  elif [[ -n "$ns" ]]; then
    if [[ "${h#*.*.}" != "$h" ]]; then info "DNS NS $h" "$ns"; else fail "DNS NS $h" "not Cloudflare: $ns"; fi
  else
    fail "DNS NS $h" "no NS answer (nameservers not switched yet?)"
  fi
  a="$(dns A "$h" | tr '\n' ' ')"; aaaa="$(dns AAAA "$h" | tr '\n' ' ')"; cn="$(dns CNAME "$h" | tr '\n' ' ')"
  if [[ -n "$a$aaaa$cn" ]]; then pass "DNS A/AAAA/CNAME $h" "A=${a:-none} AAAA=${aaaa:-none} CNAME=${cn:-none}"
  else fail "DNS A/AAAA/CNAME $h" "no address records"; fi

  # (b) TLS
  t="$(get -o /dev/null "$url/" -w "$HTTP_CODE")"
  if [[ "$t" = "200" ]]; then pass "HTTPS GET / $h" "status 200"
  else fail "HTTPS GET / $h" "status ${t:-none}"; return; fi
  local hsts; hsts="$(header_of strict-transport-security)"
  if [[ -n "$hsts" ]]; then info "HSTS $h" "$hsts"; else info "HSTS $h" "not set"; fi
  local cert
  cert="$(printf '' | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' ')"
  if [[ -n "$cert" ]]; then
    pass "TLS cert $h" "$(printf '%s' "$cert" | sed 's/issuer=//; s/notAfter=/expires /')"
    if ! printf '' | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -checkend 604800 >/dev/null 2>&1; then
      fail "TLS expiry $h" "certificate expires within 7 days"
    fi
  else fail "TLS cert $h" "could not read certificate"; fi

  # (c) app
  body="$(get "$url/health")"
  flat="$(printf '%s' "$body" | tr -d ' ')"
  case "$flat" in *'"ready":false'*) warn "/health $h" "server is starting (startup work still running): $body"; flat="" ;; *) ;; esac
  flat="$(printf '%s' "$flat" | sed 's/,"ready":true,"startup":{[^}]*}//')"
  if [[ "$flat" = '{"status":"ok","sync":{"state":"ok"}}' ]] || [[ "$flat" = '{"status":"ok","sync":"ok"}' ]]; then pass "/health $h" "$body"
  elif [[ "$flat" = '{"status":"ok","sync":{"state":"degraded"}}' ]]; then warn "/health $h" "git sync degraded (stale or error): $body"
  elif [[ -n "$flat" ]]; then fail "/health $h" "got: ${body:0:80}"; fi

  body="$(get "$url/")"
  if printf '%s' "$body" | grep -qi '<title>Electrophone'; then pass "/ HTML title $h" "Electrophone"
  else fail "/ HTML title $h" "no Electrophone <title>"; fi

  s="$(curl -s -m 20 -o /dev/null -w "$HTTP_CODE" "$url/me")"
  if [[ "$s" = "401" ]]; then pass "anon /me $h" "401 (public view off)"; else fail "anon /me $h" "status $s (expect 401)"; fi

  for p in /library /catalog; do
    s="$(curl -s -m 20 -o /dev/null -w "$HTTP_CODE" "$url$p")"
    if [[ "$s" = "401" ]]; then pass "anon $p $h" "401"; else fail "anon $p $h" "status $s (expect 401)"; fi
  done

  get "$url/anon/session" -X POST -o "$BODY"
  s="$(status_of)"
  if [[ "$s" = "200" ]] && grep -q '"token":"' "$BODY"; then pass "POST /anon/session $h" "200, token issued"
  else fail "POST /anon/session $h" "status $s (expect 200 with a token)"; fi
  s="$(curl -s -m 20 -o /dev/null -w "$HTTP_CODE" -X POST -H 'Content-Type: application/json' -d '{"url":"x"}' "$url/anon/downloads")"
  if [[ "$s" = "401" ]]; then pass "anon POST /anon/downloads no token $h" "401"; else fail "anon POST /anon/downloads no token $h" "status $s (expect 401)"; fi

  s="$(curl -s -m 20 -o /dev/null -w "$HTTP_CODE" -X POST -H 'Content-Type: application/json' -d '{}' "$url/songs")"
  if [[ "$s" = "401" ]]; then pass "unauth POST /songs $h" "401"; else fail "unauth POST /songs $h" "status $s (expect 401)"; fi

  for p in /wp-login.php /.env; do
    s="$(curl -s -m 20 -o /dev/null -w "$HTTP_CODE" "$url$p")"
    if [[ "$s" = "403" ]]; then pass "Cloudflare block $p $h" "403"; else warn "Cloudflare block $p $h" "status $s (expect 403 from the WAF rule)"; fi
  done
}

check_host "$HOST" new

# (d) + (e) old host
if [[ -n "$OLD" ]]; then
  check_host "$OLD" old
  s="$(curl -s -m 20 -o /dev/null -D "$HDR" -w "$HTTP_CODE" "https://$OLD/")"
  loc="$(header_of location)"
  case "$s" in
    308|301|302|307) info "old host redirect" "$OLD -> $s $loc"
      case "$loc" in *"$HOST"*) pass "old host redirects to canonical" "$s to $loc" ;; *) warn "old host redirects elsewhere" "$loc" ;; esac ;;
    200) info "old host redirect" "$OLD serves directly (dual-host, no redirect yet)" ;;
    *) fail "old host redirect" "status $s" ;;
  esac
fi

printf '%-5s | %-34s | %s\n' STATUS CHECK DETAIL
printf '%s' "$ROWS"
if [[ "$FAILS" -gt 0 ]]; then echo "RESULT: FAIL ($FAILS failing)"; exit 1; fi
echo "RESULT: PASS"
