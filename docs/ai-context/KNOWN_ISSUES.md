# MeetAnalyze (MeetLyst) — Known Issues & Troubleshooting

## 1. Resolved Technical Issues

### 1.1 macOS Darwin `getaddrinfo ENOTFOUND` DNS Resolution Bug
- **Symptom**:
  ```text
  Error (controllers -> assembly-ai.controller): [TypeError: fetch failed] {
    [cause]: Error: getaddrinfo ENOTFOUND streaming.assemblyai.com / llm-gateway.assemblyai.com
    code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo'
  }
  ```
- **Root Cause**:
  In macOS (Darwin) with Node.js, `getaddrinfo` queries both IPv6 (AAAA) and IPv4 (A) records simultaneously. On certain Wi-Fi networks, routers, or VPNs where IPv6 is unroutable or returns empty/SERVFAIL for CNAME aliases, macOS `getaddrinfo` throws `ENOTFOUND` (`errno: -3008`). Standard `dns.setDefaultResultOrder('ipv4first')` only sorts returned records if `getaddrinfo` succeeds; it does not prevent `getaddrinfo` from failing when AAAA queries fail.
- **Confirmed Solution**:
  Implemented [`backend/src/utils/dns-resolver.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/utils/dns-resolver.js) and imported it on line 1 of `server.js`. It monkey-patches `dns.lookup` to provide:
  1. Direct c-ares `dns.resolve4` (bypasses OS `getaddrinfo`).
  2. Public DNS resolution via Google (`8.8.8.8`) and Cloudflare (`1.1.1.1`).
  3. Static IP fallbacks with preserved TLS/SNI support.

---

### 1.2 Vercel Deployment `ERR_INVALID_THIS` (`URLSearchParams`) with pnpm
- **Symptom**:
  ```text
  ERR_PNPM_META_FETCH_FAIL GET https://registry.npmjs.org/concurrently: Value of "this" must be of type URLSearchParams
  WARN GET ... error (ERR_INVALID_THIS)
  Error: [BUILD_UTILS_SPAWN_1] Command "pnpm install" exited with 1
  ```
- **Root Cause**:
  In Node.js 22.14+, strict brand checks were added to the internal implementation of `URLSearchParams`. Older unpinned versions of `pnpm` (< 9.15.5) have a known bug in `@pnpm/network` where `URLSearchParams.prototype.get` / `getAll` is called with an invalid `this` binding context.
- **Confirmed Solution**:
  Explicitly added `"packageManager": "pnpm@9.15.5"` and `"engines": { "node": ">=20.0.0" }` in both root [`package.json`](file:///Users/aahil/Desktop/meetlyst/package.json) and [`frontend/package.json`](file:///Users/aahil/Desktop/meetlyst/frontend/package.json). This instructs Vercel Corepack to use pnpm 9.15.5, which includes the official bugfix. Alternatively, Vercel Install Command can be set to `npm install`.

---

### 1.3 AssemblyAI LLM Gateway Model Access Permissions (HTTP 400)
- **Symptom**:
  ```text
  LLM Gateway claude-sonnet-4-6 returned HTTP 400: {"code":400,"message":"Your account does not have access to this LLM Gateway model"}
  ```
- **Root Cause**:
  AssemblyAI accounts have tiered access to external LLM providers on the LLM Gateway. Proprietary models like Anthropic Claude or OpenAI GPT may require specific account entitlements or custom enterprise billing agreements.
- **Confirmed Solution**:
  Targeted the account-accessible high-speed model `qwen3.5-4b-32k-fast` (hosted by AssemblyAI with 32k context) as the primary model in [`backend/src/services/assembly.service.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/services/assembly.service.js). Standard models (`claude-sonnet-4-6`, `gemini-2.5-flash`, `gpt-4.1`) are retained as fallback candidates.

---

### 1.4 Participant Join/Leave Notification Tag Spam
- **Symptom**:
  A `[Name] joined the meeting` tag was injected into the transcript on every speaking turn or whenever a participant muted/unmuted.
- **Root Cause**:
  Content script dropped participants from the active roster during brief DOM redraws (e.g. camera toggling) and re-added them when they spoke, triggering false join/leave cycles.
- **Confirmed Solution**:
  1. Content script establishes a 3-tick initial baseline on call startup so pre-existing attendees never trigger join notices.
  2. Participants are only removed if absent continuously for >45 seconds.
  3. `sessionAnnouncedJoins` set in offscreen document acts as a deduplication firewall, enforcing at most one join tag per participant per session.
  4. Explicit leave toasts (`LEAVE_NOTIFICATION_PATTERNS`) are tracked using a `WeakSet` to prevent duplicate processing.

---

### 1.5 Microphone Permission Denial in Extension Popup
- **Symptom**:
  Clicking "Start Live Transcription" failed with `NotAllowedError` or dismissed permissions immediately in the extension popup.
- **Root Cause**:
  In Manifest V3, standard browser extension popups are transient windows that close immediately when focus shifts. Chrome blocks or dismisses `getUserMedia` dialogs spawned directly inside extension popups.
- **Confirmed Solution**:
  Created a dedicated foreground tab [`frontend/entrypoints/permission/main.tsx`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/permission/main.tsx) (`permission.html`). When the popup detects missing microphone permission, it opens `permission.html`, allowing the user to grant permanent microphone access once.

---

### 1.6 Local Audio Feedback & Echo Loop
- **Symptom**:
  The support agent heard their own voice echoed with latency in their headphones.
- **Root Cause**:
  `audioContext.destination` was connected to the combined audio graph, echoing the microphone stream back to the system default output.
- **Confirmed Solution**:
  In `frontend/entrypoints/offscreen/main.ts`:
  - `tabSource` is connected to `audioContext.destination` (so agent hears remote participants).
  - In `processor.onaudioprocess`, the output buffer is explicitly zeroed: `e.outputBuffer.getChannelData(0).fill(0)`, preventing local microphone audio from playing through the agent's speakers.

---

## 2. Active Technical Constraints & Watch Items

### 2.1 Google Meet DOM Obfuscation
- **Description**: Google Meet uses compiled, minified CSS class names (e.g. `.zWGUkf`, `.NWpY1d`) that change periodically across Google deployments.
- **Mitigation**:
  All selectors in [`frontend/entrypoints/utils/meet-selectors.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/utils/meet-selectors.ts) prioritize semantic HTML5 attributes:
  - `[data-self-name]`
  - `[data-participant-id]`
  - `aria-label*="(You)"`
  - `aria-label*="speaking"`
  - `role="status"`
  - Tile computed border colors (`ACTIVE_SPEAKER_BORDER_COLORS`)
- **Action for Future Developers**: If Google Meet changes its markup, only update `meet-selectors.ts`; do not alter core business logic in `content.ts`.

### 2.2 Tab Audio Capture Single-Stream Limitation
- **Description**: `chrome.tabCapture` captures the mixed audio of all remote meeting participants as a single stream.
- **Mitigation**:
  Speaker separation among multiple clients relies on visual DOM active speaker detection and timestamped intervals. In 1-on-1 calls, attribution is 100% deterministic. In multi-person client calls, name attribution relies on the heuristic ladder and retroactive interval correction.

