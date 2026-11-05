# MeetAnalyze (MeetLyst) — Business Logic & Core Algorithms

## 1. Dual-Stream Audio Capture & Separation

### The Challenge
If microphone and meeting tab audio are mixed into a single combined track before transmission, speech-to-text engines cannot differentiate who is speaking (Support Agent vs. Remote Client).

### The Solution: Hardware Separation + Software Analysis
1. **Microphone Stream (Support Agent)**:
   - Captured via `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
   - Guaranteed to represent the local support agent.
2. **Tab Stream (Client / Remote Attendees)**:
   - Captured via Chrome's `tabCapture` API (`chrome.tabCapture.getMediaStreamId`) targeting the active `meet.google.com` tab.
   - Guaranteed to represent everyone in the meeting *except* the local agent.
3. **Volume Diacritic Analysis**:
   - In [`frontend/entrypoints/offscreen/main.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/offscreen/main.ts), each stream feeds an independent `AnalyserNode` (`fftSize = 256`).
   - On every audio process frame (`onaudioprocess`), Root-Mean-Square (RMS) volume is computed:
     $$\text{RMS} = \sqrt{\frac{1}{N} \sum_{i=1}^{N} \left(\frac{x[i] - 128}{128}\right)^2}$$
   - If `micVolume > threshold && micVolume > tabVolume * 1.05`, the utterance is flagged as **Agent (`isSelf = true`)**.
   - If `tabVolume > threshold && tabVolume > micVolume * 1.05`, the utterance is flagged as **Client (`isSelf = false`)**.
4. **Echo Suppression**:
   - Tab audio is routed to `audioContext.destination` so the support agent can hear call attendees in their headphones.
   - Mic audio is **not** routed to `destination` (`outputBuffer.fill(0)`), completely eliminating local feedback loops.

---

## 2. Google Meet Active Speaker Detection & Scraping

Implemented in [`frontend/entrypoints/content.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/content.ts) with selectors isolated in [`frontend/entrypoints/utils/meet-selectors.ts`](file:///Users/aahil/Desktop/meetlyst/frontend/entrypoints/utils/meet-selectors.ts).

### 2.1 Identifying Local User ("You")
- **Strategy A**: Scans candidate elements (`[data-self-name]`, `.notranslate`, `div.zWGUkf`) for textual or aria-label markers containing `(You)`. Extracts the actual human name before the `(You)` tag.
- **Strategy B**: If not found in tiles, inspects the top-right Google Account avatar button (`a[aria-label*="Google Account" i]`) which contains `Google Account: First Last`.
- **Fallback**: Defaults to `'You'`.

### 2.2 Identifying Remote Attendees
- **Strategy A (`[data-self-name]`)**: Native attribute populated on Google Meet tiles.
- **Strategy B (Video Tiles)**: Inspects participant tiles (`div[data-participant-id]`), reading `.notranslate`, tile action buttons (`aria-label="More options for <Name>"`), pin buttons (`aria-label="Pin <Name> to screen"`), mute buttons (`aria-label="Mute <Name>"`), and video elements (`aria-label="<Name>'s video"`).
- **Strategy C (People Drawer)**: Reads rendered items in Google Meet's people list (`[role="listitem"]`).
- **Strategy D (Toast Alerts)**: Extracts names from join/leave notification toasts.
- **Material Icon Ligature & Element Filtering**:
  - Validates elements using `isValidNameElement()` to reject icon tags (`<i>`), `aria-hidden="true"`, action buttons (`button`), and Material Symbol font classes (`google-material-icons`, `material-icons`, `material-symbols`).
  - Rejects snake_case ligatures containing underscores (`/_/.test(lower)`, e.g. `frame_person`, `visual_effects`, `more_vert`).
  - Strict UI blacklist matching (`UI_BLACKLIST`) containing all Meet action strings and icon identifiers.
- **Local User Self Name Resolution**:
  - Directly queries `[data-self-name]` attribute and caches the resolved human name in `cachedSelfName`.
  - Self tiles (`[data-requested-participant-id]`, `[data-self-name]`, `(You)`) update `cachedSelfName` and are excluded from guest participant lists.
  - Dynamically constructs `selfAliases` (`'you'`, `'client'`, `selfName`, `cachedSelfName`) and continuously purges matching entries from `guests` and `knownGuests`.

### 2.3 Real-Time Active Speaker Detection
- **Closed Captions Priority**: If Meet captions are active, reads the latest speaker tag (`.NWpY1d`, `.zs7s8d`).
- **Visual Speaking Indicator**:
  - Checks for `aria-label*="speaking"`, `data-is-speaking="true"`, or `.speaking` class.
  - Checks computed border color on participant tiles for Google Meet's active speaking blue ring (`rgb(138, 180, 248)`, `rgb(102, 157, 246)`, `rgb(66, 133, 244)`).

---

## 3. Speaker Attribution & Retroactive Turn Correction

In a meeting with multiple clients, speech arrives on the tab stream before the visual active speaker indicator finishes animating. MeetAnalyze solves this using a **Heuristic Fallback Ladder & Retroactive Correction Engine**:

```
                       Tab Audio Energy Detected
                                  │
                                  ▼
             Is there an overlapping Speaker Interval from DOM?
                     ├── YES ──► Assign matched participant name
                     └── NO
                          │
                          ▼
             Is there an active glowing blue speech border right now?
                     ├── YES ──► Assign active speaker tile name
                     └── NO
                          │
                          ▼
             Did a new participant join in the last 15 seconds?
                     ├── YES ──► Assign newly joined attendee
                     └── NO
                          │
                          ▼
             Is there exactly 1 guest in the call (1-on-1 meeting)?
                     ├── YES ──► Assign that single client's name
                     └── NO
                          │
                          ▼
             Was someone speaking recently in this multi-person call?
                     ├── YES ──► Assign last active guest speaker
                     └── NO  ──► Assign generic "Client"
```

### 3.1 Hybrid Anchor Diarization (AssemblyAI + Meet DOM)
In addition to audio RMS separation for the local microphone, the offscreen processor enables AssemblyAI's native streaming diarization (`speaker_labels=true&speaker_labels_revision_interval_ms=300000`).

1. **Acoustic Clusters**:
   - AssemblyAI labels remote utterances with acoustic cluster identifiers (`speaker_label: "A"`, `"B"`, `"C"`).
2. **Anchor Binding to Google Meet Names**:
   - On the first occurrence of a cluster (e.g. `"A"`), the system checks the Google Meet DOM active speaker indicators (`speakerInfo.activeSpeaker`, recent intervals, or 1-on-1 guest fallback).
   - Once a match is confirmed, the mapping is saved in `clusterToNameMap["A"] = "Arsalan"`.
   - All subsequent utterances tagged with `"A"` automatically resolve to `"Arsalan"` even if the participant mutes video, hides their tile, or minimizes the window.
3. **Clean Fallback Policy**:
   - If a cluster is not yet anchored to a human name, it displays cleanly as `"Client"` in the UI (never exposing technical tags like `"Speaker A"`).
4. **SpeakerRevision Processing**:
   - When AssemblyAI emits a `SpeakerRevision` event, the system locates previous turns by `turnOrder` and updates their cluster and speaker assignments accordingly.

### 3.2 Retroactive Turn Correction
Whenever an active speaker event is confirmed by the content script:
- Offscreen inspects all finalized turns from the last **6 seconds**.
- If a turn was temporarily assigned `'Client'` or `'Guest'`, and an interval now confirms who spoke during that time window, the turn is **retroactively updated** with the true human name and broadcast to the UI.
- Any cluster mapping discovered is immediately back-propagated to earlier turns sharing that acoustic cluster.

---

## 4. Participant Join & Leave Deduplication

To prevent false join/leave notifications on every speech turn:

1. **Initial Baseline Establishment**:
   - On recording start, content script runs 3 sync ticks without firing join events, capturing all pre-existing attendees into `announcedJoins`.
2. **Strict Single-Announcement Policy**:
   - `sessionAnnouncedJoins` set in offscreen document ensures that an attendee receives at most one `[Name] joined the meeting` notification per active recording session.
3. **45-Second Disappearance Threshold**:
   - Attendees are **never** removed when temporarily switching cameras or muting. An attendee is only declared to have left if they are absent continuously for >45 seconds.
4. **Explicit Toast Interception**:
   - Listens to Google Meet leave toasts (`LEAVE_NOTIFICATION_PATTERNS`, e.g. `^(.+?)\s+(?:left|has left)`). Once processed, the element is recorded in a `WeakSet` to prevent duplicate alerts.

---

## 5. Sales Performance Evaluation Engine (`SALES_PROMPT`)

Located in [`backend/src/constants/prompt.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/constants/prompt.js), the evaluation rubric instructs the LLM Gateway to act as a **Senior Sales Manager and Sales Performance Analyst**.

### Evaluation Framework (7 Sections)
1. **Overall Call Assessment**:
   - Outcome classification: *Successful*, *Partially Successful*, or *Unsuccessful*.
   - Separation of conversation quality from business outcome.
2. **Strong Points**:
   - Communication, rapport building, active listening, objection handling, value proposition, closing techniques.
   - Mandatory quotation evidence and behavioral impact analysis.
3. **Weak Points**:
   - Missed discovery, interrupting, weak value propositions, dropped objections.
   - Strict rule: no weakness without transcript proof.
4. **Areas for Improvement**:
   - Practical coaching recommendations and alternative response scripts.
5. **Sales Performance Scorecard (1–10 Scale)**:
   - 10 evaluated categories: *Communication Skills*, *Active Listening*, *Rapport Building*, *Needs Discovery*, *Product Knowledge*, *Objection Handling*, *Value Proposition*, *Persuasion Skills*, *Closing Skills*, *Overall Professionalism*.
   - Uses `Not Assessable` when evidence is insufficient (never fabricating scores).
6. **Final Recommendations**:
   - Top 3 strengths, top 3 weaknesses, 5 actionable coaching improvements, and executive managerial assessment.
7. **Evaluation Guardrails**:
   - Evidence-based only (no hallucinated quotations or client emotions).
   - Context-aware scoring (acknowledging call stage and client responsiveness).
   - Constructive tone (critiquing behaviors, not personalities).

---

## 6. Microsoft Word (.doc) Generation Engine

Implemented in [`backend/src/utils/doc-generator.js`](file:///Users/aahil/Desktop/meetlyst/backend/src/utils/doc-generator.js).

### Technical Approach
Rather than requiring heavy, platform-dependent libraries (like `docx` or LibreOffice CLI), the utility generates an **Office HTML Document** with Microsoft Office XML namespaces:
- XML Namespace: `xmlns:o="urn:schemas-microsoft-com:office:office"`, `xmlns:w="urn:schemas-microsoft-com:office:word"`.
- Print Layout: `@page WordSection1 { size: 8.5in 11.0in; margin: 1.0in 1.0in 1.0in 1.0in; mso-header-margin: .5in; }`.
- Styling:
  - Font: Aptos, Calibri, Arial (10.5pt body text, `#222222`).
  - Scorecard Tables: Border collapsed (`1px solid #d1d5db`), header shaded in `#f3f4f6`, alternate row fills, bold categories.
  - Evidence Blockquotes: Left border (`3px solid #2563eb`), `#f8fafc` background fill, italicized transcript citations.
- Sent with headers `Content-Type: application/msword` and `Content-Disposition: attachment; filename="Meeting_Insight_Report_<timestamp>.doc"`.
- Natively opens with full fidelity in Microsoft Word, Google Docs, Apple Pages, and LibreOffice.

