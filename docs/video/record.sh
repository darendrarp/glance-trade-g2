#!/bin/bash
# Record the GlanceTrade demo video (VIDEO_SCRIPT.md) + mux voiceover.
# Run from docs/video/. Expects the stack running (backend :3001 with Groq
# key, vite :5173) and a FRESH simulator on display :100 (restart it first:
#   bash ../../kill-sim.sh
#   DISPLAY=:100 nohup ~/workspace/npm-global/bin/evenhub-simulator \
#     http://localhost:5173 --automation-port 9898 \
#     > ../../logs/sim.log 2>&1 </dev/null &
#   then wait for http://127.0.0.1:9898/api/ping + a few seconds for boot).
# Output: glancetrade-demo.mp4 (~2:21, <=3 min).
set -u
cd "$(dirname "$0")"
export DISPLAY=:100  # Xvfb :100 runs with -ac (no auth)

echo "== warm backend cache so shot 1 shows live prices at once"
curl -s "http://127.0.0.1:3001/api/prices?ids=bitcoin,ethereum,solana" >/dev/null
curl -s "http://127.0.0.1:3001/api/odds" >/dev/null
curl -s "http://127.0.0.1:9898/api/ping" || { echo "simulator not up on :9898"; exit 1; }
# Long settle: the sim boots the app + first bridge push takes ~10-15 s
# after ping. Recording too early catches the glasses mid-boot
# ("Loading prices...", take 27 Nov 03:00). Wait until settled.
sleep 15

echo "== recording display :100 (crop: both sim windows)"
ffmpeg -y -v error -f x11grab -video_size 1280x1024 -framerate 15 -i :100 \
  -vf "crop=1200:830:40:100" -c:v libx264 -pix_fmt yuv420p -preset veryfast \
  video-raw.mp4 &
FFPID=$!
sleep 2  # let the recorder settle

echo "== driving the shot list (126 s)"
bash drive.sh

echo "== stop recording"
kill -INT "$FFPID"
wait "$FFPID" 2>/dev/null
ffprobe -v quiet -show_entries format=duration -of csv=p=0 video-raw.mp4

echo "== end card (15 s, silent)"
python3 - <<'EOF'
from PIL import Image, ImageDraw, ImageFont
W, H = 1200, 830
im = Image.new('RGB', (W, H), (0, 0, 0))
d = ImageDraw.Draw(im)
def font(sz):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'):
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            continue
    return ImageFont.load_default()
green = (60, 250, 68)
lines = [
    ('GlanceTrade', 72),
    ('github.com/darendrarp/glance-trade-g2', 34),
    ('Track 02  ·  Crypto & DeFi', 34),
    ('Heads Up: Even Realities Hackathon', 34),
]
y = 250
for text, sz in lines:
    f = font(sz)
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, fill=green, font=f)
    y += sz + 36
im.save('endcard.png')
print('end card written')
EOF

echo "== mux: raw + end card, voiceover at shot starts"
ffmpeg -y -v error \
  -i video-raw.mp4 -loop 1 -t 15 -i endcard.png \
  -i vo1.mp3 -i vo2.mp3 -i vo3.mp3 -i vo4.mp3 -i vo5.mp3 -i vo6.mp3 \
  -filter_complex "\
[0:v][1:v]concat=n=2:v=1:a=0[v];\
[2:a]adelay=0|0[a1];[3:a]adelay=16000|16000[a2];[4:a]adelay=30000|30000[a3];\
[5:a]adelay=68000|68000[a4];[6:a]adelay=98000|98000[a5];[7:a]adelay=113000|113000[a6];\
[a1][a2][a3][a4][a5][a6]amix=inputs=6:normalize=0[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -preset veryfast \
  -c:a aac -b:a 128k -movflags +faststart glancetrade-demo.mp4
echo "== done"
ffprobe -v quiet -show_entries format=duration,size -of default=noprint_wrappers=1 glancetrade-demo.mp4
ls -la glancetrade-demo.mp4
