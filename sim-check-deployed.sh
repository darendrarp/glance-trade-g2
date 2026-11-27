#!/bin/bash
# Deployed-backend simulator verification (Day 6, Vercel live).
# Drives the running stack (vite :5173 built with
# VITE_BACKEND_URL=https://glance-trade-g2.vercel.app, sim :9898)
# via the simulator automation API. The local backend :3001 is NOT
# touched (it stays up as fallback until this check passes).
# Screenshots land in docs/screenshots/deployed/ (Day 4 shots untouched).
# Usage: mkdir -p logs && bash sim-check-deployed.sh 2>&1 | tee logs/sim-check-deployed.log
# Run from the repo root.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
SHOTS="$ROOT/docs/screenshots/deployed"
LOGS="$ROOT/logs"
mkdir -p "$SHOTS" "$LOGS"
SIM=http://127.0.0.1:9898
API=https://glance-trade-g2.vercel.app

fail=0
note() { echo "== $*"; }
check() { if [ "$1" = 0 ]; then echo "ok: $2"; else echo "FAIL: $2"; fail=1; fi; }

lit_pixels() {
  python3 - "$1" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
a = im.getchannel('A')
print(sum(1 for px in a.getdata() if px > 0))
EOF
}

shot() {
  local name="$1"
  curl -s -o "$SHOTS/$name.png" "$SIM/api/screenshot/glasses"
  local lit
  lit=$(lit_pixels "$SHOTS/$name.png")
  echo "shot $name: $lit lit pixels"
  [ "$lit" -gt 100 ]
  check $? "$name has content (lit=$lit)"
}

input() { curl -s -X POST "$SIM/api/input" -H 'Content-Type: application/json' -d "{\"action\":\"$1\"}" >/dev/null; sleep 1; }
click() { input click; }
down() { input down; }

note "deployed backend health (Vercel)"
curl -s "$API/api/health"; echo
curl -s "$API/api/prices?ids=bitcoin,ethereum,solana" | head -c 300; echo

note "vite serves the app with the Vercel backend URL"
curl -s http://127.0.0.1:5173/src/api.ts | grep -q "glance-trade-g2.vercel.app"
check $? "served api.ts points at Vercel"

note "restart simulator for a clean watchlist start"
bash "$ROOT/kill-sim.sh" >/dev/null 2>&1
sleep 2
export PATH="$HOME/workspace/npm-global/bin:$PATH"
nohup xvfb-run -a evenhub-simulator http://localhost:5173 --automation-port 9898 >"$LOGS/sim-deployed.log" 2>&1 </dev/null &
disown
for i in $(seq 1 30); do curl -s "$SIM/api/ping" >/dev/null 2>&1 && break; sleep 1; done
curl -s "$SIM/api/ping"; echo
sleep 6  # let the app boot + first price fetch land (Vercel cold start can be slow)

shot 01-watchlist
click; sleep 1            # watchlist BTC -> asset
shot 02-asset
click; sleep 1            # asset -> trade (buy draft)
shot 03-trade
click; sleep 2            # confirm $500 BTC buy -> tradeDone
shot 04-tradedone
click; sleep 1            # tradeDone -> portfolio
shot 05-portfolio
click; sleep 1            # portfolio -> watchlist
down; down; down; down    # focus: BTC,ETH,SOL,Portfolio -> Alerts
click; sleep 1            # -> alerts screen
shot 06-alerts
input double_click; sleep 1  # back -> watchlist
down; down; down; down; down # focus -> Odds
click; sleep 2            # -> odds screen
shot 07-odds
input double_click; sleep 1  # back -> watchlist

echo "----"
if [ "$fail" = 0 ]; then echo "sim-check-deployed: ALL PASS"; else echo "sim-check-deployed: FAILURES PRESENT"; fi
exit $fail
