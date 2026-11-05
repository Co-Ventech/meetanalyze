# MeetAnalyze (MeetLyst) — Architecture Specification

## 1. Architectural Philosophy
MeetAnalyze is designed to bridge the boundary between **browser execution environments** and **cloud AI intelligence**:
- In the browser, Manifest V3 security constraints prohibit persistent background scripts, direct tab audio access from popups, and long-running WebSockets. We solve this using Chrome's **Offscreen Document API** paired with an MV3 Service Worker.
- In the meeting tab, DOM obfuscation and class rotation by Google are mitigated using **structural, attribute-based selectors** and multiple redundant detection strategies.
- On the backend, we maintain a lightweight, high-performance **Fastify service** that acts as a secure broker for AssemblyAI tokens and LLM Gateway requests, while generating executive Word documents on the fly.

---

## 2. Frontend Architecture (Chrome Extension MV3)

The extension is built using the **WXT** framework (`wxt build`, targeting Chrome MV3).

```
frontend/entrypoints/
├── background.ts                 # Service worker (lifecycle & message routing)
├── content.ts                    # Content script injected into meet.google.com
├── offscreen/                    # Offscreen document for audio capture & WebSocket
│   ├── index.html
│   └── main.ts
├── permission/                   # Foreground tab for granting mic permissions
│   ├── index.html
│   └── main.tsx
├── popup/                        # Main user interface (Popup)
│   ├── App.tsx                   # Unified meeting intelligence dashboard
│   ├── main.tsx
│   └── hooks/                    # useRealtimeTranscription.ts
├── sidepanel/                    # Chrome side panel interface (hosts App.tsx)
│   ├── index.html
│   └── main.tsx
└── utils/
    ├── meet-selectors.ts         # Resilient Google Meet selectors & regexes
    └── check-google-meet-connection.ts # Tab query & verification helpers
```

### 2.1 Component Roles & Lifecycles

#### A. Background Service Worker ([`frontend/entrypoints/background.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/background.ts))
- **Role**: Coordinates communication between tabs, offscreen documents, popups, and side panels.
- **Offscreen Management**: Creates the offscreen document on demand (`reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK']`) via `ensureOffscreenDocument()`.
- **State Storage**: Syncs transient transcription state (`isRecording`, `isTabAudioCaptured`, `partialTranscript`, `finalTranscripts`, `speakerInfo`) into `chrome.storage.local`.
- **Side Panel Trigger**: Responds to `OPEN_SIDE_PANEL` events to dock the UI beside Google Meet.

#### B. Offscreen Audio Processor ([`frontend/entrypoints/offscreen/main.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/offscreen/main.ts))
- **Role**: Continuous audio streaming, volume diacritic analysis, and WebSocket management.
- **Audio Capture**:
  - Local Agent Stream: `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
  - Client Tab Stream: `navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } })`.
- **Audio Pipeline**:
  - `AudioContext` initializes two parallel `AnalyserNode` instances (`micAnalyser` and `tabAnalyser`).
  - Audio is fed into a `ScriptProcessorNode(2048, 1, 1)` that downsamples/formats Float32 to 16-bit PCM (`floatTo16BitPCM`).
  - To prevent echo/feedback into the agent's headset, the microphone stream output is zeroed out, while tab audio is passed to `audioContext.destination`.
- **WebSocket Streaming**: Maintains a low-latency connection to AssemblyAI Real-Time Streaming v3 (`wss://streaming.assemblyai.com/v3/ws`).
- **Speaker Attribution Engine**:
  - Measures RMS energy of both streams on every audio buffer (`onaudioprocess`).
  - Correlates client speech bursts with Google Meet active speaker intervals (`matchSpeakerFromIntervals`).
  - Corrects preceding turns retroactively within a 6-second window.

#### C. Google Meet Content Script ([`frontend/entrypoints/content.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/content.ts))
- **Role**: Runs directly inside `*://meet.google.com/*` tabs.
- **Observer**: Subscribes to DOM changes via `MutationObserver` on `document.body` (monitoring `aria-label`, `data-is-speaking`, `class`, `style`, `data-self-name`) combined with a 600ms polling interval.
- **Participant Detection**:
  - Local User ("You"): Detected through `[data-self-name]`, `(You)` text matches, or top-right Google Account avatar button.
  - Remote Guests: Identified via video tile containers, `.notranslate` tags, tile action buttons (`aria-label="More options for X"`), video labels (`aria-label="X's video"`), and avatar alt texts.
- **Active Speaker Tracking**:
  - Reads active Google Meet Closed Captions if available.
  - Detects visual active speaking indicators (audio visualizer wave, blue speech border colors `rgb(138, 180, 248)`).
  - Maintains rolling `SpeakerInterval[]` records with a 45-second retention buffer.
- **Join/Leave Event Tracking**:
  - Establishes a 3-tick baseline on session startup so initial participants are not falsely reported as new joiners.
  - Monitors join/leave toast snackbars (`JOIN_NOTIFICATION_PATTERNS`, `LEAVE_NOTIFICATION_PATTERNS`).
  - Flags participants as left if absent continuously for >45 seconds (never dropping them during active speaking).

#### D. Popup & Side Panel UI ([`frontend/entrypoints/popup/App.tsx`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/popup/App.tsx))
- **Role**: User control surface rendered in both the extension popup and the side panel.
- **Features**:
  - Real-time Google Meet connectivity check.
  - Live transcript stream with distinct color-coded badges for Agent ("You") and Clients/Guests.
  - Interactive participant chips showing active speaker status with one-click renaming.
  - Tab capture warning banner if only microphone audio is active.
  - **"Show Meeting Insight"** action button: Submits the collected transcript to the backend and triggers a direct browser download of `Meeting_Insight_Report_<timestamp>.doc`.

---

## 3. Extension Internal Messaging Protocol

Communication between Chrome Extension contexts is structured via typed JSON messages passed through `chrome.runtime.sendMessage`:

| Message Type | Sender | Recipient | Payload | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `START_RECORDING` | Popup/Sidepanel | Background | `{ streamId, token, host, targetTabId }` | Requests background to ensure offscreen doc and start capture. |
| `START_OFFSCREEN_RECORDING` | Background | Offscreen | `{ streamId, token, host, initialTranscripts, targetTabId }` | Commands offscreen document to initialize audio graphs & WS. |
| `STOP_RECORDING` | Popup/Sidepanel | Background | `{}` | Requests recording termination. |
| `STOP_OFFSCREEN_RECORDING` | Background | Offscreen | `{}` | Gracefully closes WebSocket (`Terminate`) and releases audio tracks. |
| `RECORDING_STARTED` | Offscreen | Background, UI | `{ isTabAudioCaptured }` | Notifies that streams are active and streaming has commenced. |
| `RECORDING_STOPPED` | Offscreen | Background, UI | `{ finalTranscripts }` | Broadcasts final transcripts after session shutdown. |
| `TRANSCRIPT_UPDATE` | Offscreen | Background, UI | `{ partialTranscript, finalTranscripts, isFinal, isTabAudioCaptured }` | Emits updated partial or finalized turn. |
| `SPEAKER_INFO_UPDATED` | Content Script | Background | `{ speakerInfo }` | Emits refreshed roster, active speaker, and intervals. |
| `SPEAKER_INFO_DISPATCH` | Background | Offscreen, UI | `{ speakerInfo }` | Forwards speaker info from background to offscreen and UI. |
| `POLL_SPEAKER_INFO` | Offscreen | Background -> Content | `{ targetTabId }` | Offscreen directly polls the Meet tab for immediate speaker data. |
| `PARTICIPANTS_JOINED` | Content Script | Background, Offscreen | `{ joined: string[], roster: string[] }` | Announces newly joined attendee(s). |
| `PARTICIPANTS_LEFT` | Content Script | Background, Offscreen | `{ left: string[], roster: string[] }` | Announces participant departure. |
| `SET_GUEST_NAME` | UI | Background | `{ name, originalName }` | User initiates guest rename. |
| `SET_GUEST_NAME_OFFSCREEN` | Background | Offscreen | `{ name, originalName }` | Renames participant retroactively in all transcripts. |
| `CLEAR_TRANSCRIPTS` | UI | Background, Offscreen | `{}` | Clears all transcript history and resets baseline. |
| `OPEN_SIDE_PANEL` | UI (Popup) | Background | `{}` | Requests side panel opening in the active window. |

---

## 4. Backend Architecture (Fastify Service)

The backend is built with **Fastify 4.x** in Node.js (CommonJS), supporting both traditional long-running Node processes and Vercel Serverless deployments.

```
backend/
├── api/index.js               # Vercel serverless request wrapper
├── server.js                  # Fastify server initialization & route mounting
├── vercel.json                # Serverless rewrites to /api/index
├── config/
│   ├── pg-config.js           # Sequelize PostgreSQL instance with SSL
│   └── assembly-ai.config.js  # AssemblyAI constants & endpoints
├── src/
│   ├── constants/
│   │   └── prompt.js          # SALES_PROMPT (7-category evaluation rubric)
│   ├── controllers/
│   │   ├── assembly-ai.controller.js  # Token & Summarize endpoints
│   │   └── auth.controller.js         # User registration & login endpoints
│   ├── models/                # Sequelize models (user.js, user_roles.js, etc.)
│   ├── routes/                # assemblyai.routes.js, auth.routes.js, main.routes.js
│   ├── services/
│   │   ├── assembly.service.js        # AssemblyAI token & LLM Gateway client
│   │   ├── auth.service.js            # Authentication workflows
│   │   └── user.service.js            # User CRUD & password validation
│   └── utils/
│       ├── dns-resolver.js    # 3-tier DNS resilience monkey-patch
│       ├── doc-generator.js   # Word (.doc) binary buffer generator
│       └── sync-models.js     # Sequelize auto-sync helper
```

### 4.1 Key Backend Subsystems

#### A. DNS Resilience Layer ([`backend/src/utils/dns-resolver.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/utils/dns-resolver.js))
Loaded at line 1 of [`backend/server.js`](file:///Users/aahil/Desktop/meetlyst/backend/server.js). It monkey-patches Node's `dns.lookup` to prevent macOS Darwin `getaddrinfo ENOTFOUND` errors when resolving AssemblyAI domains. If system `getaddrinfo` fails, it falls back to:
1. Direct c-ares `resolve4(hostname)`.
2. Public DNS servers (`8.8.8.8`, `1.1.1.1`).
3. Static IP mappings (`STATIC_ASSEMBLYAI_IPS`) while preserving full HTTPS SNI.

#### B. AssemblyAI Integration Service ([`backend/src/services/assembly.service.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/services/assembly.service.js))
- **`getTemporaryToken(expiresInSeconds = 480)`**: Requests an ephemeral token from `https://streaming.assemblyai.com/v3/token` so client-side extensions never expose the master API key.
- **`generateSalesCallInsight(transcriptText)`**: Calls AssemblyAI's LLM Gateway (`https://llm-gateway.assemblyai.com/v1/chat/completions`) passing `SALES_PROMPT` as system prompt and the transcript as user message. It uses the account-accessible model `qwen3.5-4b-32k-fast` (with fallbacks `claude-sonnet-4-6`, `gemini-2.5-flash`, `gpt-4.1`).

#### C. Word Document Generator ([`backend/src/utils/doc-generator.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/utils/doc-generator.js))
- Transforms markdown output into a complete Microsoft Word HTML document with Office namespaces (`urn:schemas-microsoft-com:office:word`, `mso-page-orientation`, `mso-header-margin`).
- Formats markdown tables into styled HTML tables with border collapsibility, shaded header rows, and cell padding.
- Emits binary buffers with `Content-Type: application/msword` that natively open in Microsoft Word, Google Docs, Apple Pages, and LibreOffice without external npm dependencies.

#### D. Authentication & User Management
- Routes: `/api/v1/auth/register`, `/api/v1/auth/login`.
- Password security: Salted hashing via `bcrypt` with pre-save hooks on the `User` model.
- Tokens: Signed JWTs containing user email and role (`jsonwebtoken`).
- Input validation: Joi schema validation executed via Fastify `preHandler` hooks.

---

## 5. End-to-End Data Flow

```
1. Extension Loaded
   ├── Content script injects into Google Meet tab.
   └── Popup queries backend GET /api/v1/transcription/token.

2. User Clicks "Start Live Transcription"
   ├── Foreground checks mic permission (opens permission.html if needed).
   ├── tabCapture acquires Meet audio streamId.
   ├── Background creates offscreen document (offscreen.html).
   └── Offscreen mixes Mic + Tab, opens WebSocket to AssemblyAI Streaming v3.

3. Live Call Transcription & Speaker Diarization
   ├── Audio streamed as 16-bit PCM (16kHz/48kHz).
   ├── Audio energy analysis identifies if Mic (You) or Tab (Client) is speaking.
   ├── Content script maps active visual borders to attendee names.
   ├── AssemblyAI sends "Turn" events.
   └── Offscreen updates partial and final turns in storage & UI.

4. User Clicks "Show Meeting Insight"
   ├── Popup sends full transcript turns to POST /api/v1/summarize.
   ├── Backend calls AssemblyAI LLM Gateway with SALES_PROMPT.
   ├── Model evaluates performance against 7-category rubric.
   ├── Backend wraps output in Word .doc format with executive styling.
   └── Browser receives binary stream and triggers immediate .doc file download.
```

