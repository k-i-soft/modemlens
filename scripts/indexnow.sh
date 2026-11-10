#!/usr/bin/env bash
# Reports the ModemLens URLs to IndexNow. Run it after each deploy.
#
# IndexNow forwards the ping to Bing, Yandex, Seznam and Naver. Bing matters
# because ChatGPT Search builds on the Bing index. Google does not take part in
# IndexNow; for Google use the Search Console.
#
# The key lives at public/<key>.txt and is public, which the protocol requires.
set -euo pipefail

HOST="modemlens.k-i-soft.ch"
KEY="813569cb5ed0fd86c21fc4f92b0b4846"

# The key file must be live, or IndexNow rejects the ping with 403.
if [[ "$(curl -s "https://$HOST/$KEY.txt")" != "$KEY" ]]; then
  echo "✗ https://$HOST/$KEY.txt does not return the key. Deploy first." >&2
  exit 1
fi

# One page today; read the live sitemap so only what is actually served is reported.
URLS=$(curl -s "https://$HOST/sitemap.xml" | grep -oE '<loc>[^<]+</loc>' | sed -E 's#</?loc>##g')
[[ -z "$URLS" ]] && URLS="https://$HOST/"

BODY=$(HOST="$HOST" KEY="$KEY" URLS="$URLS" python3 -c '
import json, os
print(json.dumps({
    "host": os.environ["HOST"],
    "key": os.environ["KEY"],
    "keyLocation": f"https://{os.environ[\"HOST\"]}/{os.environ[\"KEY\"]}.txt",
    "urlList": os.environ["URLS"].split(),
}))')

STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" -d "$BODY")

if [[ "$STATUS" == "200" || "$STATUS" == "202" ]]; then
  echo "✓ IndexNow accepted the ping (HTTP $STATUS) for:"
  echo "$URLS" | sed 's/^/    /'
else
  echo "✗ IndexNow returned HTTP $STATUS" >&2
  exit 1
fi
