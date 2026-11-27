#!/bin/bash
# Day 4 simulator verification + README screenshots.
# Drives the running stack (backend :3001, vite :5173, sim :9898) via the
# simulator automation API; restarts the simulator for a deterministic
# watchlist start. Screenshots land in docs/screenshots/.
# Usage: mkdir -p logs && bash sim-check.sh 2>&1 | tee logs/sim-check-day4.log
#   (mkdir first: tee opens the log file before this script's own mkdir runs)
# Run from the repo root.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
SHOTS="$ROOT/docs/screenshots"
LOGS="$ROOT/logs"
mkdir -p "$SHOTS" "$LOGS"
SIM=http://127.0.0.1:9898
API=http://127.0.0.1:3001

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

note "backend health"
curl -s "$API/api/health"; echo
curl -s "$API/api/prices?ids=bitcoin,ethereum,solana" | head -c 300; echo

note "restart simulator for a clean watchlist start"
bash "$ROOT/kill-sim.sh" >/dev/null 2>&1
sleep 2
# Direct nohup (no parens-subshell): a ( ... & ) subshell stays alive
# holding the caller's stdout pipe and hangs pipelines that tee output.
# Simulator binary lives in ~/workspace/npm-global (survives VM
# replacement; the old /usr global install was wiped 27 Nov ~09:40).
export PATH="$HOME/workspace/npm-global/bin:$PATH"
nohup xvfb-run -a evenhub-simulator http://localhost:5173 --automation-port 9898 >"$LOGS/sim.log" 2>&1 </dev/null &
disown
for i in $(seq 1 30); do curl -s "$SIM/api/ping" >/dev/null 2>&1 && break; sleep 1; done
curl -s "$SIM/api/ping"; echo
sleep 4  # let the app boot + first price fetch land

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

note "backend-offline check: kill backend, wait for next 45s poll"
bash "$ROOT/kill-server.sh"
sleep 50
shot 08-offline
# The watchlist must show the offline one-liner instead of blank/crash.
python3 - "$SHOTS/08-offline.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('L')
print('offline shot mean brightness:', sum(im.getdata()) / (576 * 288))
EOF

note "restart backend (with Groq key) and wait for recovery"
# Same no-subshell rule as the simulator start above.
nohup python3 "$ROOT/server/start-server.py" >"$ROOT/logs/server.log" 2>&1 </dev/null &
disown
for i in $(seq 1 30); do curl -s "$API/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -s "$API/api/health"; echo
sleep 50  # next 45s poll recovers
shot 09-recovered

note "exit flow: double-click on watchlist -> system exit dialog"
input double_click; sleep 2
# After shutDownPageContainer(1) the app container is gone, so the
# glasses framebuffer is BLANK by design — that IS the pass condition
# (the system dialog itself is OS chrome the screenshot API cannot see;
# sim.log confirms 'TextContainerUpgrade failed: container 1 not found').
curl -s -o "$SHOTS/10-exit-dialog.png" "$SIM/api/screenshot/glasses"
lit=$(lit_pixels "$SHOTS/10-exit-dialog.png")
echo "shot 10-exit-dialog: $lit lit pixels"
[ "$lit" -lt 100 ]
check $? "10-exit-dialog blank after shutdown (lit=$lit)"

echo "----"
if [ "$fail" = 0 ]; then echo "sim-check: ALL PASS"; else echo "sim-check: FAILURES PRESENT"; fi
exit $fail
