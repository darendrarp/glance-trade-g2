#!/bin/bash
# Timed driver for the GlanceTrade demo video (VIDEO_SCRIPT.md shot list).
# Run WHILE ffmpeg records display :100 (see record.sh). All times are
# seconds from recording start; the voiceover clips (vo1..vo6.mp3) are
# muxed in post at the shot starts below.
#
# Shot plan (MEASURED timeline, 27 Nov — type_cmd takes ~5 s, so shots
# 5-6 land ~5 s later than the nominal plan; VO delays in record.sh
# match these measured times):
#   0-16   S1 watchlist (VO1) — Refresh click at t=4 shows a live refresh
#   16-30  S2 asset (VO2) — tap BTC
#   30-68  S3 voice buy (VO3) — type "buy 0.01 bitcoin", tap confirm,
#          trade done -> portfolio, hold
#   68-95  S5 alerts (VO4) — type "alert BTC above 100k" -> alerts screen
#   95-110 S6 odds (VO5 @98) — back, down x5, tap Odds; odds lands ~98
#   110-131 S4 portfolio + exit (VO6 @113) — back, down x3, tap Portfolio
#          (lands ~113), double-tap (back), double-tap on watchlist ->
#          exit dialog (~127)
#   131    driver ends; record.sh appends the 15 s end card in post.
set -u
export DISPLAY=:100  # Xvfb :100 runs with -ac (no auth)
SIM=http://127.0.0.1:9898

api() { curl -s -X POST "$SIM/api/input" -H 'Content-Type: application/json' -d "{\"action\":\"$1\"}" >/dev/null; }
click() { api click; }
down() { api down; }
dbl() { api double_click; }

# Type a command into the phone companion UI's command box (center ~350,415
# on the 1280x1024 display) and press Enter. Same parser as voice.
type_cmd() {
  xdotool mousemove 350 415 click 1
  sleep 0.5
  xdotool type --delay 80 "$1"
  xdotool key Return
  sleep 3
}

# --- shot 1: watchlist (0-16) ---
sleep 4
xdotool mousemove 350 495 click 1   # "Refresh prices" — live refresh on camera
sleep 12
# --- shot 2: asset (16-30) ---
click
sleep 14
# --- shot 3: voice buy (30-68) ---
type_cmd "buy 0.01 bitcoin"
sleep 2
click   # confirm the trade on S3
sleep 3
click   # trade done -> portfolio
sleep 28
# --- shot 4: voice alert (68-90) ---
type_cmd "alert BTC above 100k"
sleep 22
# --- shot 5: odds (90-104) ---
dbl     # back -> watchlist
sleep 1
down; down; down; down; down   # focus -> Odds
sleep 1
click   # -> odds screen
sleep 12
# --- shot 6: portfolio + exit (104-126) ---
dbl     # back -> watchlist
sleep 1
down; down; down   # focus -> Portfolio
sleep 1
click   # -> portfolio
sleep 12
dbl     # back -> watchlist
sleep 2
dbl     # watchlist double-tap -> system exit dialog
sleep 4
echo "driver done"
