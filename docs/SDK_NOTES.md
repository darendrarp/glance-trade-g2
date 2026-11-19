# Even Hub SDK & Simulator — Research Notes

Researched 19 Nov 2026 (preparation phase). Sources are official docs
unless marked otherwise. Verify versions again on 23 Nov — the platform
moves fast.

## Official sources

- Docs hub: https://hub.evenrealities.com/
- Your First App: https://hub.evenrealities.com/docs/get-started/quickstart/first-app
  (last updated 2026-07-04)
- Device APIs: https://hub.evenrealities.com/docs/build/device-apis
  (last updated 2026-08-29)
- Simulator: https://hub.evenrealities.com/docs/test/simulator
  (last updated 2026-08-29)
- Templates repo (MIT): https://github.com/even-realities/evenhub-templates
  (4 templates: `minimal`, `asr`, `image`, `text-heavy`)
- Claude Code plugin / skills: `even-realities/everything-evenhub`
  (13 skills incl. `glasses-ui`, `handle-input`, `test-with-simulator`,
  `simulator-automation`, `cli-reference`, `design-guidelines`)
- Hackathon page: https://dorahacks.io/hackathon/even-realities/detail

## Verified toolchain (19 Nov 2026, via npm)

| Package | Latest | Notes |
|---|---|---|
| `@evenrealities/even_hub_sdk` | **0.0.16** | TypeScript bridge to the glasses |
| `@evenrealities/evenhub-cli` | **0.2.0** | `init`, `qr`, `pack`, upload, testers |
| `@evenrealities/evenhub-simulator` | **0.9.5** | Desktop simulator, 576×288 LVGL window |

Docs pages still reference older versions (SDK 0.0.14, simulator 0.9.3);
npm is the fresher source. Pin exact versions in `package.json` on day 1
and note them in the README.

## App model (the 30-second version)

- A Hub app **never runs on the glasses**. It is a web app (HTML/CSS/TS)
  running in a WebView inside the Even Realities phone app; the SDK is the
  bridge that turns code into display containers on the lenses and turns
  taps/swipes/mic audio back into events.
- `app.json` at the project root is the only Even-specific file (manifest:
  `package_id`, `name`, `version`, `edition: "202601"`, `min_sdk_version`,
  `entrypoint`, `permissions`, `supported_languages`).
- Scaffold options: Vite `vanilla-ts` by hand + `evenhub init`, or
  `npx degit even-realities/evenhub-templates/<name>`. **GlanceTrade will
  start from the `asr` template** (live mic → STT pipeline with companion
  UI; STT provider is a blank stub we plug our backend into).
- Dev loop: `npm run dev` (Vite :5173) + `evenhub-simulator
  http://localhost:5173`. Hot reload works; the simulator refreshes.
- Packaging: `npx evenhub pack` → single `.ehpk` file, submitted through
  the developer portal (optional for the hackathon submission).

## Core SDK patterns (from the official quickstart)

```ts
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge() // ALWAYS first; anything
// earlier silently no-ops. Resolves immediately in the simulator.

const mainText = new TextContainerProperty({
  xPosition: 0, yPosition: 0, width: 576, height: 288,
  borderWidth: 0, borderColor: 5, paddingLength: 4,
  containerID: 1, containerName: 'main',
  content: 'Hello from G2!',
  isEventCapture: 1, // required to receive input events
})

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [mainText] }))
// result 0 = success; 1 = invalid params, 2 = oversize, 3 = out of memory

bridge.onEvenHubEvent((event) => { /* single subscription point;
  route via event.textEvent / listEvent / sysEvent / audioEvent */ })

// Flicker-free text update (match containerID + containerName exactly):
bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content: '...' }))
// Layout changes (add/remove containers) need rebuildPageContainer.

// Exit on root page: mode 1 shows the system exit-confirmation dialog and
// is REQUIRED; silent exit (mode 0) or custom exit UI is rejected in QA.
bridge.shutDownPageContainer(1)
```

## Input handling — the gotcha that breaks most first apps

`OsEventTypeList.CLICK_EVENT` is `0`, and protobuf omits zero-value fields
on the wire. A single tap therefore arrives as an envelope with **no
`eventType` field at all** (e.g. `{ "sysEvent": { "eventSource": 1 } }`),
while a double-tap carries `eventType: 3`. From the templates README:

- Resolve the default **inside** the envelope check:

```ts
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}
```

- Do **NOT** flatten to `event.sysEvent?.eventType ?? CLICK_EVENT` — that
  reads CLICK on events carrying no `sysEvent` at all, so every scroll,
  lifecycle event, and audio frame fires the tap handler.
- Match explicit ids first (`DOUBLE_CLICK_EVENT` 3, `SCROLL_TOP_EVENT` 1,
  `SCROLL_BOTTOM_EVENT` 2); `CLICK_EVENT` is the fallback, checked last.
- Taps/double-taps/lifecycle arrive on `sysEvent`; scroll gestures on
  `textEvent`; PCM audio on `audioEvent`. Check each separately.
- Long press (SDK 0.0.14+, app 2.2.9+) arrives as two events:
  `LONG_PRESS_EVENT` (9) on press start, `LONG_PRESS_RELEASE_EVENT` on lift.

## Device APIs (what the bridge exposes)

- **Inputs:** G2 temple touchpads (press, double press, swipe up/down,
  long press + release), optional R1 ring (same event types, distinct
  source — route glasses-vs-ring to different handlers), IMU.
- **Microphone:** glasses mic PCM 16 kHz mono s16le, 100 ms per
  `audioEvent` (3,200 bytes / 1,600 samples). Permissions in `app.json`:
  `g2-microphone` (glasses) / `phone-microphone` (phone mic).
- **Location:** one-shot `getAppLocation` + continuous updates; declare
  `location` in `app.json`. (Not needed for GlanceTrade.)
- **Photos:** phone album picker / camera capture; image arrives as
  base64. (Not needed for GlanceTrade.)
- **Storage:** SDK local storage on the phone (paper portfolio lives here).
- **What the SDK does NOT expose:** direct Bluetooth, arbitrary pixel
  drawing, audio output, text alignment, font control, background colours,
  per-item list styling, programmatic scroll position, animations,
  glasses-side camera (none exists); images are greyscale-only.

## Display facts

- 576 × 288 px per eye, 4-bit greyscale (16 shades of green), 60 Hz,
  ~27.5° FOV. Line height 27 px (per Even's MIT `@evenrealities/pretext`
  metrics) → ~10 text lines per screen.
- `textColor` 0–4 = five brightness levels (use for hierarchy, not for
  photometric legibility sign-off — simulator levels differ from hardware).
- `zOrderIndex` stacking; contextual menu via `menuObject`
  (`menuItemClickEvent` carries the declared `itemID`).
- Text updates: `textContainerUpgrade` (flicker-free, 2000-char path per
  the `text-heavy` template).

## Simulator (v0.9.5 installed; docs describe 0.9.3)

- Node + LVGL window that mimics how containers, text, and events *look*.
  **Not a hardware emulator:** performance, frame pacing, BLE timing, and
  real-device quirks are not reproduced.
- Launch: `evenhub-simulator http://localhost:5173`
  (`-g/--glow`, `--automation-port <port>`, `--aid <device>` for audio
  input, `--list-audio-input-devices`).
- Screenshot button exports the glasses display as RGBA PNG to the
  working directory (raw framebuffer, no glow).
- Debugging: `RUST_LOG=debug evenhub-simulator …` logs every bridge call
  to stdout; right-click the webview → Inspect Element for console/DOM/
  network. A call the app makes that never appears in the debug log never
  crossed the bridge.
- Caveats: rendering not pixel-perfect vs hardware; list-scroll focus
  positioning can differ; image transfer is faster and doesn't enforce
  on-device size limits (LZ4 compression not decompressed in sim);
  status events not emitted (profiles hardcoded); error handling under
  abnormal conditions can differ. **Always validate on real hardware
  before deployment** (not available for this hackathon — simulator-only
  is explicitly allowed by the organisers).
- **Headless automation (v0.7.0+):** `--automation-port 9898` exposes an
  HTTP control plane — `GET /api/ping`, `GET /api/screenshot/glasses`
  (576×288 RGBA PNG; use `alpha > 0` as the lit-pixel test),
  `GET /api/screenshot/webview`, `GET /api/console[?since_id=N]`,
  `DELETE /api/console`, `POST /api/input` with
  `{action: up|down|click|double_click|long_press|long_press_release|context_menu}`.
  Allow ~4 s after launch before sending input. This is how build week
  will run CI smoke tests and capture demo screenshots.
  (Headless runs do not replace beta testing — noted, but beta testing
  needs hardware we do not have.)

## Headless-Linux setup (verified 19 Nov 2026 on this VM)

- `evenhub` CLI 0.2.0 installed globally and runs (`evenhub --version`).
- The simulator binary needs WebKitGTK: first run failed with
  `libwebkit2gtk-4.1.so.0: cannot open shared object file`.
- Fix (needs sudo; Xvfb is already installed on this VM):

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0
xvfb-run -a evenhub-simulator http://localhost:5173 --automation-port 9898
```

- Status 19 Nov 2026: the `apt-get update` needed before the install
  runs very slowly through this VM's egress proxy (hundreds of MB of
  package lists; still running after 12+ minutes when this note was
  written). The install itself is therefore **not yet verified** on this
  VM. Re-check on 23 Nov (day 0): if `evenhub-simulator --version`
  prints a version, the headless path works; if the install still
  cannot complete, **run the simulator on the user's laptop
  (macOS/Windows) and record the demo video there** — the app code is
  identical either way, and the laptop is also the more reliable
  screen-recording machine.
- Note: packages installed via apt are ephemeral if the VM is replaced;
  re-run the setup on 23 Nov before starting the build.

## Networking (from the hackathon brief + docs)

- External `fetch()` calls need a `network` permission with a `whitelist`
  in `app.json`: `{"name": "network", "desc": "...", "whitelist":
  ["https://<backend-host>"]}`.
- Route API calls through our own server; never ship API keys inside the
  app. Google sign-in does not work inside the WebView — use a separate
  login page or a pairing code (GlanceTrade needs no sign-in at all).
