#!/bin/bash
# Kill the GlanceTrade backend (listening on :3001) by PID from ss, no pkill -f.
PID=$(ss -ltnp 2>/dev/null | grep ':3001' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
if [ -n "$PID" ]; then
  echo "killing backend pid $PID"
  kill "$PID"
  sleep 1
  kill -9 "$PID" 2>/dev/null
  echo "killed"
else
  echo "no backend on :3001"
fi
