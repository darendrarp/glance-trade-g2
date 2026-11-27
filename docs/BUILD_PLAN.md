# Build Plan — 23–29 Nov 2026

**Rule:** no application code before build week starts.
Build week opens **Mon 23 Nov 2026, 12:00 Dubai time (15:00 WIB)** with the
online kickoff + Even Realities tech briefing. Submission closes
**Sun 29 Nov 2026, 23:59 Dubai time (Mon 30 Nov 2026, 02:59 WIB)**.

All times below are WIB. The plan assumes the builder (Paijo) works
async with the user available for the few decisions/keys flagged 🔑.

## Day 0 — Mon 23 Nov (kickoff, 15:00 WIB)

- [ ] Watch/read the kickoff + tech briefing; note any rule changes,
      new sponsor prizes, or Telegram-clarification. **If the Telegram
      rule is clarified against cross-track use, drop the relay module.**
- [ ] Re-verify toolchain versions (`npm view` SDK/CLI/simulator);
      re-run headless-Linux simulator setup if the VM was replaced:
      `sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0`
      (Xvfb already installed), then `xvfb-run -a evenhub-simulator --version`.
- [ ] Scaffold: `npx degit even-realities/evenhub-templates/asr app`
      (ASR template = mic pipeline + STT stub). Pin exact SDK version.
- [ ] "Hello from G2" check: change one line of text, confirm it renders
      in the simulator and one tap works (per the official quickstart).
- [ ] Create backend skeleton (`server/`, Vercel serverless or plain
      Node): `/api/prices` with CoinGecko fetch + 45 s cache.
- [x] 🔑 STT key (Groq) for the backend env — DONE 27 Nov ~09:02, user
      connected `custom.groq`; Whisper verified end-to-end ~09:05.

## Day 1 — Tue 24 Nov (read path)

- [ ] Glasses UI shell: screen router (S1 watchlist → S2 asset → S4
      portfolio → S6 odds), text containers, brightness hierarchy.
- [ ] Input handler with the protobuf zero-value gotcha handled
      (envelope check, explicit ids first, click last) + R1 ring routing.
- [ ] Live prices end-to-end: backend `/api/prices` → glasses S1/S2,
      45 s refresh, `cached Xs ago` note, 429 backoff.
- [ ] Polymarket `/api/odds` → S6 (read-only). Verify Gamma response
      shape live; hide screen if unreachable.
- [ ] Headless smoke test via simulator automation API (`/api/ping`,
      boot → screenshot lit-pixel assertion, one `click` input).
- [ ] Commit + push to GitHub (public repo, `main`).

## Day 2 — Wed 25 Nov (write path: paper trading)

- [ ] Paper engine: $10,000 virtual cash, positions, fills at cached
      price, SDK local storage persistence, reset (long-press + confirm).
- [ ] S3 trade-confirm screen: tap presets ($100/$500/$1,000) →
      confirm/cancel. Double-tap cancels; single tap confirms.
- [ ] S4 portfolio screen with session PnL.
- [ ] End-to-end tap trade in the simulator, verified by screenshot
      before/after (cash decreases, position appears).
- [ ] Glyph test: does `▁▃▅▇` render for a 1-line sparkline? Add if yes,
      drop if no.

## Day 3 — Thu 26 Nov (voice)

- [ ] Wire mic capture → backend `/api/stt` (Whisper) → deterministic
      command parser (amount + asset + direction). No LLM in the hot path.
- [ ] Voice flows: price query, buy/sell pre-fill S3, "show portfolio",
      alert creation. Ambiguous input → ask on screen, never guess a trade.
- [ ] Simulator audio input test (`--list-audio-input-devices`, `--aid`).
      If simulator mic input proves unreliable, demo voice via the
      typed-command fallback and say so honestly in the video.
- [ ] S5 alerts screen + alert evaluation while app is open + fired-alert
      banner (dismiss by tap).

## Day 4 — Fri 27 Nov (Telegram relay + hardening) — DONE 27 Nov ~10:00 WIB

- [x] Optional Telegram relay: settings-page pairing (bot token + chat id),
      backend forwarder, fired-alert → Telegram message. Disabled by default.
      Rule VERIFIED on the official DoraHacks page 27 Nov: the "Best
      Telegram integration" special prize is explicitly open to projects
      from any track — relay is compliant, NOT dropped. Forwarder built
      (`server/api/_lib.js` handleTelegram + `api/alerts/telegram.js`),
      5/5 unit tests (no token leak), app fire-and-forget on alert fire,
      footer chip mirrors `/api/health` relayConfigured.
- [x] Exit flow: root double-tap → system exit-confirmation dialog
      (`shutDownPageContainer(1)`); verified in simulator 27 Nov —
      container torn down after double-click (sim.log: "container 1 not
      found"); the dialog itself is OS chrome the screenshot API cannot
      capture, screenshot is blank by design.
- [x] Error handling everywhere: offline backend, CoinGecko 429,
      STT failure — every failure shows a one-line message on the glasses,
      never a blank screen or a crash. Verified: backend kill → watchlist
      shows `OFFLINE — last prices shown` with last cached prices; restart
      → `Live · cached 0s ago`. STT 503 path verified in smoke test.
- [x] `app.json` finalised: network whitelist = backend origin only
      (localhost:3001 for now; Vercel URL added once deployed);
      permissions `g2-microphone` (+ `phone-microphone` if used).
      min_app_version bumped 2.0.0 → 2.2.10 (SDK 0.0.16 floor).
- [x] `evenhub pack` → `.ehpk` smoke test: PASS, `app/out.ehpk`
      45,825 bytes (gitignored build artifact, upload at submit time).
- [x] Full README update: setup, architecture, rule disclosure, screenshots.
- [ ] Deploy backend to Vercel — BLOCKED 27 Nov: the Vercel MCP
      connection returns 403 "You don't have permission to create the
      project" for both create_git_project and create_project (account
      darendrarp@gmail.com, Hobby, team darendrarp); CLI fallback
      unavailable (no ~/.vercel auth; npx download timed out at 100 s).
      Serverless code is ready (`server/api/*.js` + vercel.json);
      needs the user to either create project `glance-trade-backend`
      in the Vercel dashboard (import darendrarp/glance-trade-g2, root
      directory `server`) or re-connect Vercel with project-create
      permission — then set GROQ_API_KEY + timeout env vars and deploy.
      Until then the submission runs the backend locally (:3001) and the
      packaged .ehpk points at localhost; README documents the deploy
      steps.

## Day 5 — Sat 28 Nov (video + polish) — PULLED FORWARD to Fri 27 Nov

- [x] Voiceover recorded (TTS, en, `docs/video/vo1.mp3`–`vo6.mp3`,
      total ~55 s) per `docs/VIDEO_SCRIPT.md`.
- [x] Timed driver script (`docs/video/drive.sh`) + record/mux script
      (`docs/video/record.sh`): ffmpeg x11grab 15 fps crop 1200×830,
      voiceover muxed at shot starts, 15 s end card (PIL).
- [x] Record demo video (≤ 3 min) in the simulator per
      `docs/VIDEO_SCRIPT.md`. Screen-record the simulator window
      (headless: Xvfb + ffmpeg, or the user's laptop if capture fails).
      DONE 27 Nov ~03:04 WIB: `docs/video/glancetrade-demo.mp4` (2:25,
      1.4 MB, 1200×830) — voiceover TTS muxed at shot starts, 15 s end
      card. Verified frame-by-frame + audio levels: watchlist live at
      t=0, buy 0.01 BTC (cash $10.000 → $9.387), alert set (3 rows, no
      duplicate after the dedup fix), Polymarket odds, portfolio + exit
      (glasses blank). Scripts: `docs/video/drive.sh` + `record.sh`
      (measured timeline documented in drive.sh header).
      Detour: VM replaced ~09:40 WIB mid-dry-run (sim/backend/vite/Xvfb
      dead, /tmp wiped, apt + global npm wiped) — stack rebuilt: azure
      mirror only (cogentco stalled), WebKitGTK + xdotool reinstalled,
      sim/CLI reinstalled into `~/workspace/npm-global` (survives the
      next replacement). First take had 2 flaws (glasses still booting
      at t=0; VO5/VO6 ~5-8 s early) — re-recorded with a 15 s settle +
      corrected VO delays; second take verified clean.
- [x] Alert-dedup polish fix (dry run found it): voice-created alert
      duplicated the seeded one (id mismatch `a-btc-100k` vs generated)
      — `main.ts` now dedups by (coin, dir, threshold). Tests 19/19,
      `.ehpk` re-packed (45.846 bytes).
- [ ] Polish pass against the judging criteria (usefulness, read+write,
      execution, UX, safety). Fix any simulator-vs-design gaps.
- [ ] Stretch goal ONLY if everything above is green: Hyperliquid
      testnet read-only quote preview. Otherwise cut it — a polished
      paper trader beats a half-broken testnet integration.
- [ ] Freeze code by ~21:00 WIB. Final commit + push.

## Day 6 — Sun 29 Nov (submission)

- [ ] Final end-to-end run: fresh clone → `npm install` → `npm run dev`
      → simulator → full demo flow (README instructions must work verbatim).
      NOTE 27 Nov: a fresh clone was pulled (commit 5727bd5 verified) but
      running/installing/building inside the clone FAILED an
      execution-risk check — the clone's content must not be executed
      without explicit user approval. Ask the user in plain words before
      running the fresh-clone steps; meanwhile the same tree was already
      verified in the working repo (npm test 19/19, build, smoke, sim
      6/6 screens) and the GitHub push was SHA-verified blob by blob.
- [ ] Upload video (YouTube unlisted or Loom — user account) + add link
      to README and submission draft.
- [ ] 🔑 User: review the submission draft (`docs/SUBMISSION_DRAFT.md`),
      register on DoraHacks, and submit (builder does not submit).
- [ ] Submit before **02:59 WIB Mon 30 Nov** (23:59 Dubai Sun 29 Nov).
      Target: submitted by 29 Nov 21:00 WIB to leave margin.

## Environment & accounts needed (build week)

| Need | Who | Notes |
|---|---|---|
| DoraHacks account + team registration | User | Builder never registers/submits |
| STT API key (Groq) | User | DONE 27 Nov — backend env only; tap fallback exists |
| Vercel deploy (or equivalent free host) | Builder (existing Vercel connection) | Backend hosting, free tier |
| Telegram bot (optional, for relay demo) | User (2 min via @BotFather) | Only if relay demo is wanted |
| Video upload (YouTube/Loom) | User account | Builder provides the recording |
| Even Hub developer account | Not needed for the hackathon submission | Only needed for store publishing / real hardware |

## Risks

| Risk | Mitigation |
|---|---|
| Simulator won't run headless on the VM (WebKitGTK) | Apt install verified in prep; fallback: user's laptop for sim + video |
| CoinGecko keyless throttling (~3/min per IP reported) | Backend cache 45 s, one batched call, 429 backoff |
| STT key unavailable | Tap presets + typed commands; app fully demo-able without voice |
| Simulator mic input unreliable | Same fallback; video shows tap flow + explains voice path |
| Scope creep (Hyperliquid, charts) | Stretch-only, cut without mercy on day 5 |
| VM replacement wipes apt packages / global npm tools | Setup commands documented here + in SDK_NOTES; re-run on day 0 |
