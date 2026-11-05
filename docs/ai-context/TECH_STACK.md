# MeetAnalyze (MeetLyst) — Technology Stack

## 1. Core Runtime & Language Environment

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `>=20.0.0` (Dev: `v24.19.0`) | JavaScript runtime for both backend and frontend build tooling. |
| **Package Manager** | pnpm / npm | `pnpm@9.15.5` (Corepack) | Workspace monorepo dependency management with lockfile integrity. |
| **Monorepo Engine** | npm / pnpm Workspaces | Root `package.json` | Orchestrates multi-package development and build scripts. |
| **Frontend Language** | TypeScript | `^5.9.3` | Strongly-typed client code, interfaces, and Chrome API types. |
| **Backend Language** | JavaScript | ECMAScript 2022 (CommonJS) | Fastify backend implementation. |

---

## 2. Frontend Technology Stack (Chrome Extension)

| Category | Package / Tool | Version | Purpose / Reasoning |
| :--- | :--- | :--- | :--- |
| **Extension Framework** | `wxt` | `^0.21.3` (installed: `0.21.5`) | Next-generation web extension framework. Provides hot-module reloading, automatic Manifest V3 generation, entrypoint bundling, and multi-browser support. |
| **UI Framework** | `react` | `^19.2.4` | Component-based UI for the extension popup and side panel. |
| **DOM Renderer** | `react-dom` | `^19.2.4` | Mounts React components into extension HTML entrypoints. |
| **Styling** | `tailwindcss` | `^4.0.0` | Utility-first CSS framework for extension UI styling. |
| **Tailwind Vite Plugin** | `@tailwindcss/vite` | `^4.0.0` | High-speed Vite integration for Tailwind v4 CSS compilation. |
| **WXT React Module** | `@wxt-dev/module-react` | `^1.1.5` | Integrates React Fast Refresh and JSX transformation into WXT. |
| **Browser Extension Tool** | `web-ext` | `^10.5.0` | CLI tool for linting, running, and packaging WebExtensions. |
| **Audio Processing** | Web Audio API | Browser Native | Native browser audio graphs (`AudioContext`, `AnalyserNode`, `ScriptProcessorNode`) for dual-stream mixing and PCM conversion. |
| **Chrome APIs** | Chrome MV3 | Native Browser | `chrome.tabCapture`, `chrome.offscreen`, `chrome.sidePanel`, `chrome.storage`, `chrome.tabs`, `chrome.runtime`. |

---

## 3. Backend Technology Stack

| Category | Package / Tool | Version | Purpose / Reasoning |
| :--- | :--- | :--- | :--- |
| **HTTP Framework** | `fastify` | `^4.28.1` (installed: `4.29.1`) | High-performance, low-overhead Node.js web framework. Highly extensible with plugin architecture and built-in JSON serialization. |
| **CORS Middleware** | `@fastify/cors` | `^9.0.1` | Enables cross-origin requests from Chrome extension origins and development environments. |
| **Database ORM** | `sequelize` | `^6.37.3` (installed: `6.37.8`) | Promise-based Node.js ORM for PostgreSQL. Supports migrations, model definitions, hooks, and connection pooling. |
| **PostgreSQL Driver** | `pg` | `^8.12.0` | Pure JavaScript PostgreSQL client for Node.js with native SSL support. |
| **Password Hashing** | `bcrypt` | `^5.1.1` | Cryptographic salted hashing for user credentials. |
| **Token Authentication** | `jsonwebtoken` | `^9.0.2` | Signs and verifies HMAC-SHA256 JSON Web Tokens for API authorization. |
| **Input Validation** | `joi` | `^17.13.3` | Object schema validation for HTTP request payloads (e.g. registration and login). |
| **Environment Config** | `dotenv` | `^16.4.5` | Loads environment variables from `.env` files into `process.env`. |
| **Dev Process Monitor**| `nodemon` | `^3.1.4` | Watches backend files and auto-restarts the server during development. |
| **HTTP Status Constants**| `http-status-codes`| `^2.3.0` | Standard HTTP response code constants. |
| **Email Utility** | `nodemailer` | `^6.9.15` | SMTP transport utility for transactional email notifications. |
| **Doc File Generation**| Native Buffer / XML | Built-in | Custom XML/HTML builder producing Microsoft Word `.doc` documents with zero third-party dependencies. |
| **DNS Resolution Layer**| `node:dns` / c-ares | Node Built-in | Monkey-patched DNS resolver with multi-tier fallback to bypass macOS Darwin `getaddrinfo` bugs. |

---

## 4. Third-Party APIs & External Services

| Service | Endpoint / Model | Purpose |
| :--- | :--- | :--- |
| **AssemblyAI Streaming v3** | `wss://streaming.assemblyai.com/v3/ws`<br>Model: `universal-3-6-pro` | Real-time, low-latency audio transcription (supports 32 languages, native code-switching, and punctuate-on-the-fly). |
| **AssemblyAI Ephemeral Tokens** | `https://streaming.assemblyai.com/v3/token` | Generates short-lived (480-second) streaming tokens so client extensions do not need raw API keys. |
| **AssemblyAI LLM Gateway** | `https://llm-gateway.assemblyai.com/v1/chat/completions`<br>Model: `qwen3.5-4b-32k-fast` | OpenAI-compatible endpoint for applying language models to transcripts. Runs sales evaluation against `SALES_PROMPT`. |
| **Google Meet** | WebRTC Application (`meet.google.com`) | Target video-conferencing platform whose DOM and audio are captured. |
| **Neon / Cloud PostgreSQL** | PostgreSQL Database | Persistent storage for users, authentication tokens, and business models with SSL requirement. |
| **Vercel** | Serverless Functions | Production hosting target for backend API via `backend/vercel.json` and `backend/api/index.js`. |

---

## 5. Environment Variables Dictionary

> [!IMPORTANT]
> Never commit actual values or secrets to source control. Use the `.env.example` templates.

### Backend (`backend/.env`)

| Variable Name | Required | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `PORT` | No | `5000` (or `2000`) | Port on which Fastify listens when running locally. |
| `SERVER_HOST` | No | `0.0.0.0` | Network binding interface for the HTTP server. |
| `NODE_ENV` | No | `development` | Environment mode (`development`, `production`, `test`). |
| `DB_DIALECT` | No | `postgres` | Sequelize database dialect identifier. |
| `DB_HOST` | No | `localhost` | Hostname for local PostgreSQL database. |
| `DB_PORT` | No | `7778` (or `5432`) | Port for PostgreSQL connection. |
| `DB_NAME` | No | `meetlyst_db` | Name of the PostgreSQL database. |
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@host:port/db?sslmode=require` | Connection URI with SSL parameters for database access. |
| `ACCESS_TOKEN_VALIDITY_DURATION` | No | `12h` | Expiration window for signed user JWTs. |
| `JWT_SECRET` | **Yes** | String secret | Secret key used to sign and verify authentication tokens. |
| `JWT_ACCESS_TOKEN_SECRET` | No | String secret | Secondary secret for specific token verification routines. |
| `ASSEMBLYAI_API_KEY` | **Yes** | Hexadecimal string | Master API key used to generate streaming tokens and call LLM Gateway. |

### Frontend (`frontend/.env`)

| Variable Name | Required | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `VITE_API_BASE_URL` | No | `http://localhost:2000` (fallback: `http://localhost:5000`) | Base URL of the backend API used by the extension popup. |

