#!/bin/bash
# Kill the GlanceTrade simulator (automation port 9898) by PID from ss.
# Never inline `pkill -f evenhub-simulator`: the pattern matches the calling
# shell's own command line and kills it (2026-11-27 lesson).
PID=$(ss -ltnp 2>/dev/null | grep ':9898' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
if [ -n "$PID" ]; then
  echo "killing simulator pid $PID"
  kill "$PID"
  sleep 2
  kill -9 "$PID" 2>/dev/null
  echo "killed"
else
  echo "no simulator on :9898"
fi
