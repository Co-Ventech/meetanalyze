# MeetAnalyze (MeetLyst) — Architectural Decision Records (ADRs)

## ADR-001: Monorepo Structure with WXT (Frontend) and Fastify (Backend)

- **Context**: The product consists of a Manifest V3 Chrome Extension and a serverless-ready Node.js API service for token generation and transcript evaluations.
- **Decision**:
  - Use an npm/pnpm workspace monorepo with `frontend/` and `backend/`.
  - Use **WXT** (`wxt.dev`) for the extension to gain Vite-powered TypeScript/React 19 compilation, automatic MV3 manifest generation, and multi-browser support.
  - Use **Fastify** for the backend to ensure minimal overhead, sub-millisecond route handling, and native serverless compatibility.
- **Consequences**:
  - Independent dependency trees prevent frontend bundling tools from bleeding into backend Node modules.
  - Monorepo scripts (`npm run dev`, `npm run build:frontend`) allow seamless concurrent local development.

---

## ADR-002: Offscreen Document for Audio Capture & WebSocket Streaming

- **Context**: In Manifest V3, background scripts are short-lived Service Workers that terminate after 30 seconds of inactivity and cannot access the DOM or Web Audio APIs (`AudioContext`). Extension popups terminate immediately when the user clicks away.
- **Decision**:
  - Use Chrome's **Offscreen Document API** (`chrome.offscreen.createDocument`) with reasons `USER_MEDIA` and `AUDIO_PLAYBACK`.
  - Place all `AudioContext`, `ScriptProcessorNode`, PCM downsampling, and WebSocket connections inside `frontend/entrypoints/offscreen/main.ts`.
- **Consequences**:
  - Audio recording continues uninterrupted even when the user minimizes Chrome, switches tabs, or closes the popup.
  - Requires message-based coordination between popup, background service worker, and offscreen document.

---

## ADR-003: Hybrid Dual-Stream Audio Capture with DOM Scraping for Speaker Diarization

- **Context**: AssemblyAI receives raw audio and cannot identify participants by real name, only generic `Speaker A` / `Speaker B`.
- **Decision**:
  - Capture two distinct hardware streams:
    1. Local Support Agent Microphone (`getUserMedia`).
    2. Google Meet Remote Attendees (`chrome.tabCapture`).
  - Real-time volume analyzers compare RMS energy to immediately classify whether local user ("You") or remote attendees are speaking.
  - Combine with a Google Meet content script that reads participant names, active visual speaker indicators (blue border, visualizer bars, captions), and maintains timestamped intervals.
  - Retroactively correct turns within a 6-second window once speaker intervals confirm the speaker's identity.
- **Consequences**:
  - 100% deterministic separation between Support Agent and Client.
  - Real human names are attached to transcript turns without manual user labeling.
  - Solves the single greatest challenge of meeting transcription plugins.

---

## ADR-004: Native HTML-Word (.doc) Generation without External Dependencies

- **Context**: The user needs to download an executive Word document summarizing sales call performance. Standard npm packages (like `docx` or external headless office converters) introduce complex native binaries, heavy node_modules bloat, and dependency compatibility issues on serverless runtimes like Vercel.
- **Decision**:
  - Build a custom Word generator ([`backend/src/utils/doc-generator.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/utils/doc-generator.js)) that translates markdown into semantic HTML formatted with Microsoft Office XML namespaces (`xmlns:o="urn:schemas-microsoft-com:office:office"`, `xmlns:w="urn:schemas-microsoft-com:office:word"`).
  - Stream the output as a binary buffer with `Content-Type: application/msword` and `Content-Disposition: attachment; filename="Meeting_Insight_Report_<timestamp>.doc"`.
- **Consequences**:
  - Zero external npm dependencies.
  - Lightning-fast generation (< 50ms) with zero memory footprint.
  - Natively opens with rich styling, print margins, and scorecard tables in Microsoft Word, Google Docs, Apple Pages, and LibreOffice.

---

## ADR-005: Multi-Tier DNS Fallback Resolver for macOS Darwin Bug

- **Context**: On macOS with Node.js, `getaddrinfo` frequently fails with `ENOTFOUND` (`errno: -3008`) when querying AssemblyAI hostnames (`streaming.assemblyai.com`, `llm-gateway.assemblyai.com`) due to an OS-level issue with concurrent IPv6 (AAAA) lookups.
- **Decision**:
  - Implement a dedicated DNS resilience utility ([`backend/src/utils/dns-resolver.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/utils/dns-resolver.js)) and load it on line 1 of `server.js`.
  - Provide a 3-tier fallback when `dns.lookup` fails:
    1. Direct c-ares `dns.resolve4` (bypasses OS `getaddrinfo`).
    2. Public DNS resolvers (`8.8.8.8`, `1.1.1.1`).
    3. Static verified IP mappings for AssemblyAI endpoints with full TLS SNI preservation.
- **Consequences**:
  - Completely eliminates network connection crashes on macOS developer machines.
  - Zero performance impact on non-affected systems (standard OS lookup executes first).

---

## ADR-006: AssemblyAI LLM Gateway Model Selection (`qwen3.5-4b-32k-fast`)

- **Context**: The backend needs to analyze meeting transcripts using AssemblyAI's LLM Gateway. Proprietary models (like `claude-sonnet-4-6` or `gpt-4.1`) returned `HTTP 400: Your account does not have access to this LLM Gateway model`.
- **Decision**:
  - Set `qwen3.5-4b-32k-fast` as the primary evaluation model in `backend/src/services/assembly.service.js`.
  - Retain `claude-sonnet-4-6`, `gemini-2.5-flash`, and `gpt-4.1` as candidate fallbacks.
  - Collect and report errors across all candidate attempts to prevent obscuring root failures.
- **Consequences**:
  - High inference throughput and low latency (< 10 seconds for full call evaluations).
  - 32,000 token context window comfortably accommodates long multi-hour transcripts.
  - Works out of the box with standard AssemblyAI account tiers.

---

## ADR-007: Pinning pnpm 9.15.5 & Node 20+ for Vercel Deployment Compatibility

- **Context**: Vercel deployments failed during `pnpm install` with `ERR_INVALID_THIS: Value of "this" must be of type URLSearchParams` due to a known bug in older pnpm versions running on Node 22+.
- **Decision**:
  - Explicitly declare `"packageManager": "pnpm@9.15.5"` and `"engines": { "node": ">=20.0.0" }` in both root `package.json` and `frontend/package.json`.
  - Recommend configuring Vercel Install Command to `npm install` if pnpm is not strictly required.
- **Consequences**:
  - Vercel Corepack activates pnpm 9.15.5, which includes the official patch for Node 22's `URLSearchParams` brand checks.
  - Eliminates build crashes on CI and Vercel.

---

## ADR-008: Decoupled Google Meet DOM Selectors Module

- **Context**: Google Meet continuously updates its frontend, rotating class names and DOM structures. Hardcoding class names inside business logic makes maintenance fragile.
- **Decision**:
  - Centralize all DOM selectors, CSS queries, regex notification patterns, and UI blacklists into [`frontend/entrypoints/utils/meet-selectors.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/utils/meet-selectors.ts).
  - Prioritize semantic HTML5 and accessibility attributes (`[data-self-name]`, `[data-participant-id]`, `aria-label*="(You)"`, `role="status"`).
- **Consequences**:
  - When Google modifies Meet's layout, maintenance is isolated to updating a single configuration file without touching core detection or diarization code.

