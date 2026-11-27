// Phone companion UI (WebView, not on the glasses).
// The phone stays in the pocket during a session, but this page is where the
// user types commands when voice is unavailable, checks STT status, and
// resets the paper portfolio. It also mirrors exactly what the glasses show,
// so the demo can be followed (and recorded) from the phone.

export interface UiCallbacks {
  /** A typed command, e.g. "buy 0.01 bitcoin" — same grammar as voice. */
  onCommand(text: string): void
  /** Mic button pressed: start capture, or stop + transcribe. */
  onMicToggle(): void
  /** Refresh prices + odds now. */
  onRefresh(): void
  /** Reset paper portfolio (caller confirms first). */
  onResetRequest(): void
}

export type VoiceChip = 'ready' | 'off' | 'listening' | 'processing' | 'needs-credits' | 'unavailable'

let glassesEl: HTMLPreElement
let voiceEl: HTMLDivElement
let backendEl: HTMLDivElement
let mirrorEl: HTMLDivElement
let micBtn: HTMLButtonElement
let cmdInput: HTMLInputElement
let hintEl: HTMLDivElement

export function mountUi(cb: UiCallbacks) {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main class="panel">
      <header>
        <h1>GlanceTrade · Paper</h1>
        <div class="chips">
          <div id="backend" class="chip chip-unknown">Backend…</div>
          <div id="voice" class="chip chip-off">Voice off</div>
        </div>
      </header>
      <section aria-label="Glasses mirror">
        <pre id="glasses" class="glasses">Starting…</pre>
      </section>
      <section class="cmd" aria-label="Command">
        <input id="cmd" type="text" placeholder="Type a command — buy 0.01 bitcoin" autocomplete="off" />
        <button id="send" type="button">Send</button>
      </section>
      <div id="hint" class="hint">Try: "how much is bitcoin?" · "buy $500 of eth" · "show portfolio" · "alert BTC above 100k"</div>
      <section class="row">
        <button id="mic" type="button">Mic: OFF</button>
        <button id="refresh" type="button">Refresh prices</button>
        <button id="reset" type="button" class="danger">Reset paper</button>
      </section>
      <section class="mirror" aria-label="Portfolio mirror">
        <div id="mirror">Portfolio —</div>
      </section>
      <footer>Paper trading — no real money, no wallet. Telegram relay: disabled.</footer>
    </main>
  `
  glassesEl = app.querySelector<HTMLPreElement>('#glasses')!
  voiceEl = app.querySelector<HTMLDivElement>('#voice')!
  backendEl = app.querySelector<HTMLDivElement>('#backend')!
  mirrorEl = app.querySelector<HTMLDivElement>('#mirror')!
  micBtn = app.querySelector<HTMLButtonElement>('#mic')!
  cmdInput = app.querySelector<HTMLInputElement>('#cmd')!
  hintEl = app.querySelector<HTMLDivElement>('#hint')!

  const send = () => {
    const text = cmdInput.value.trim()
    if (!text) return
    cmdInput.value = ''
    cb.onCommand(text)
  }
  app.querySelector<HTMLButtonElement>('#send')!.addEventListener('click', send)
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send()
  })
  micBtn.addEventListener('click', () => cb.onMicToggle())
  app.querySelector<HTMLButtonElement>('#refresh')!.addEventListener('click', () => cb.onRefresh())
  app.querySelector<HTMLButtonElement>('#reset')!.addEventListener('click', () => cb.onResetRequest())
  injectStyles()
}

/** Exactly what the glasses display right now (same text, same lines). */
export function setGlassesText(text: string) {
  if (!glassesEl) return
  glassesEl.textContent = text
}

export function setBackendChip(online: boolean) {
  if (!backendEl) return
  backendEl.className = `chip ${online ? 'chip-ok' : 'chip-bad'}`
  backendEl.textContent = online ? 'Backend online' : 'Backend offline'
}

const VOICE_LABEL: Record<VoiceChip, string> = {
  ready: 'Voice ready',
  off: 'Voice off',
  listening: 'Listening…',
  processing: 'Transcribing…',
  'needs-credits': 'Voice: needs credits',
  unavailable: 'Voice unavailable',
}

export function setVoiceChip(state: VoiceChip) {
  if (!voiceEl) return
  voiceEl.className = `chip chip-${state === 'ready' || state === 'listening' ? 'ok' : state === 'off' ? 'off' : 'bad'}`
  voiceEl.textContent = VOICE_LABEL[state]
}

export function setMicButton(capturing: boolean) {
  if (!micBtn) return
  micBtn.textContent = capturing ? 'Mic: ON — tap to send' : 'Mic: OFF'
  micBtn.classList.toggle('live', capturing)
}

/** One-line portfolio/prices summary for the phone. */
export function setMirror(text: string) {
  if (!mirrorEl) return
  mirrorEl.textContent = text
}

export function setCommandHint(text: string) {
  if (!hintEl) return
  hintEl.textContent = text
}

function injectStyles() {
  // ER brand dark-theme surfaces: #232323 / #2E2E2E / #3E3E3E.
  // ER OS green (#3CFA44) + signal red (#FF453A) for state chips.
  const css = `
    :root { color-scheme: dark; }
    html, body { margin: 0; height: 100%; background: #232323; color: #E5E5E5;
      font: 16px/1.4 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif;
      touch-action: manipulation; -webkit-text-size-adjust: 100%;
      overscroll-behavior: none; }
    #app { display: flex; height: 100%; }
    .panel { display: flex; flex-direction: column; gap: 12px;
      width: 100%; max-width: 640px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: 0.02em; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { font-size: 11px; padding: 4px 10px; border-radius: 999px;
      border: 1px solid transparent; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
    .chip-unknown { color: #A7A7A7; border-color: #3E3E3E; }
    .chip-ok { color: #3CFA44; border-color: #3CFA44; background: rgba(60,250,68,0.08); }
    .chip-off { color: #E5E5E5; border-color: #7B7B7B; background: rgba(229,229,229,0.06); }
    .chip-bad { color: #FF453A; border-color: #FF453A; background: rgba(255,69,58,0.08); }
    .glasses { margin: 0; background: #0E2A12; color: #3CFA44; border: 1px solid #3E3E3E;
      border-radius: 12px; padding: 16px; font: 15px/1.5 ui-monospace, 'SF Mono', Menlo, monospace;
      min-height: 200px; white-space: pre-wrap; word-break: break-word; }
    .cmd { display: flex; gap: 8px; }
    .cmd input { flex: 1; min-width: 0; background: #2E2E2E; color: #E5E5E5;
      border: 1px solid #3E3E3E; border-radius: 10px; padding: 10px 12px; font-size: 15px; }
    .cmd input:focus { outline: 2px solid #3CFA44; outline-offset: 0; }
    button { background: #2E2E2E; color: #E5E5E5; border: 1px solid #3E3E3E;
      border-radius: 10px; padding: 10px 14px; font-size: 14px; cursor: pointer; }
    button:active { background: #3E3E3E; }
    button.live { color: #3CFA44; border-color: #3CFA44; }
    button.danger { color: #FF453A; border-color: #FF453A; }
    .hint { font-size: 12px; color: #7B7B7B; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .row button { flex: 1; white-space: nowrap; }
    .mirror { background: #2E2E2E; border: 1px solid #3E3E3E; border-radius: 12px;
      padding: 12px 16px; font-size: 14px; line-height: 1.5; }
    footer { font-size: 12px; color: #7B7B7B; text-align: center; }
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}
