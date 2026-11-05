# MeetAnalyze (MeetLyst) — AI Knowledge System Entrypoint

Welcome to the **MeetAnalyze** (also known as **MeetLyst**) repository.

This document serves as the **mandatory entry point** for all Antigravity and AI coding assistants. It establishes the protocol to ensure consistent, efficient, and regression-free development without repeatedly re-scanning the entire codebase.

---

# Persistent Project Context Rules

This repository maintains a persistent AI knowledge base in `docs/ai-context/`.

## Before Every Task
- Read this file first.
- Read `docs/ai-context/PROJECT_OVERVIEW.md`.
- Identify and read only the context documents relevant to the current task.
- Inspect relevant source files before making implementation decisions.
- Do not unnecessarily rescan the repository.

## During Development
- Follow the existing architecture and coding conventions.
- Reuse existing implementations wherever possible.
- Avoid unnecessary refactoring.
- Never assume undocumented behavior.
- Do not change unrelated functionality.

## After Every Significant Change
- Update relevant context documentation.
- Record important decisions and their rationale.
- Update implementation status.
- Document newly discovered bugs and confirmed fixes.
- Keep the knowledge base consistent with the actual code.

## Context Integrity
- Source code is the ultimate source of truth.
- Never preserve outdated information as current.
- Never invent missing project details.
- Do not store secrets or credentials.
- Flag uncertainty explicitly.

## Repository Scanning
A full repository scan is not the default.
Use targeted inspection and expand the scope only when technically necessary.

## Completion
At the end of significant tasks, report:
- What changed.
- Which context documents were updated.
- Any outstanding issues.
- Any decisions requiring developer approval.

---

## Quick Navigation: Context Index

All persistent project context is maintained inside the [`docs/ai-context/`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/) directory:

| Document | Primary Focus & Contents |
| :--- | :--- |
| **[`PROJECT_OVERVIEW.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/PROJECT_OVERVIEW.md)** | Product vision, core value proposition, high-level architecture diagram, and directory map. |
| **[`ARCHITECTURE.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/ARCHITECTURE.md)** | Detailed Chrome MV3 extension architecture, offscreen audio pipeline, Fastify backend, and internal messaging contracts. |
| **[`TECH_STACK.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/TECH_STACK.md)** | Complete tech inventory (WXT, React 19, Tailwind v4, Fastify, Sequelize), versions, and environment variables dictionary. |
| **[`DATABASE_SCHEMA.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/DATABASE_SCHEMA.md)** | PostgreSQL connection parameters, Sequelize model definitions (`User`, `UserRoles`, boilerplate models), and ER diagram. |
| **[`API_DOCUMENTATION.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/API_DOCUMENTATION.md)** | REST endpoints (`/api/v1/auth/*`, `/api/v1/summarize`, `/api/v1/transcription/token`) and AssemblyAI Streaming v3 WebSocket protocol. |
| **[`BUSINESS_LOGIC.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/BUSINESS_LOGIC.md)** | Dual-stream audio mixing, Meet DOM scraping, retroactive turn correction, join/leave deduplication, and Word document generator. |
| **[`IMPLEMENTATION_STATUS.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/IMPLEMENTATION_STATUS.md)** | Feature completion matrix, subsystem health checks, and planned development roadmap. |
| **[`KNOWN_ISSUES.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/KNOWN_ISSUES.md)** | Solved bugs (macOS DNS resolution bug, Vercel pnpm `URLSearchParams` issue, mic permissions) and active watch items. |
| **[`DECISIONS.md`](file:///Users/aahil/Desktop/meetlyst/docs/ai-context/DECISIONS.md)** | Architectural Decision Records (ADRs 001–008) detailing key technical choices, trade-offs, and rationale. |

---

## Engineering & Safety Guidelines

- **Zero-Secret Rule**: NEVER print, expose, hardcode, or commit actual API keys, database passwords, JWT secrets, or tokens. Reference environment variable names only.
- **Minimal, Targeted Changes**: Avoid mass refactors. Keep diffs focused strictly on the user's objective.
- **Decoupled Google Meet Selectors**: All Google Meet CSS/DOM queries must remain isolated in [`frontend/entrypoints/utils/meet-selectors.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/utils/meet-selectors.ts). Never sprinkle raw, undocumented classes into application logic.
- **DNS Resilience Guarantee**: Any external HTTP/WebSocket network calls on the backend must utilize [`backend/src/utils/dns-resolver.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/utils/dns-resolver.js) to preserve compatibility across macOS environments.
- **Audio Feedback Protection**: Local microphone streams must never be bridged into `audioContext.destination`. Only tab audio may play through user speakers.
