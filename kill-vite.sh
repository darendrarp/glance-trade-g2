#!/bin/bash
# Kill the GlanceTrade vite dev server (port 5173) by PID from ss.
# Never inline `pkill -f vite`: the pattern matches the calling
# shell's own command line and kills it.
PID=$(ss -ltnp 2>/dev/null | grep ':5173' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
if [ -n "$PID" ]; then
  echo "killing vite pid $PID"
  kill "$PID"
  sleep 2
  kill -9 "$PID" 2>/dev/null
  echo "killed"
else
  echo "no vite on :5173"
fi
