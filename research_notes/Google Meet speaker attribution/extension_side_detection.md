# Extension-side speaker and join/leave detection in Google Meet (no official APIs), as of Nov 2026

Research note: several fetches failed with DNS errors (webrtchacks.com, red5.net, docs.recall.ai, docs.granola.ai). Where that happened, the claim comes from search-result summaries and is labelled as such. The best primary source found is the open-source **Attendee** bot (attendee-labs/attendee). Its injected payload, `google_meet_chromedriver_payload.js`, runs inside the Meet page. The same code could run as an MV3 MAIN-world script, because it uses only page-level JS APIs.

## 1. WebRTC hooking: SSRC/CSRC audio levels, getStats, Meet's audio delivery, and mapping to participants

### Takeaway
Meet does not send one track per participant. It sends **3 fixed audio SSRC "virtual streams"** that carry the 3 loudest speakers. Each RTP packet's **CSRC** names the real speaker, and that CSRC stays the same for the participant's whole session. Meet's own internal **`collections` RTCDataChannel** (deflate-compressed protobuf) maps each CSRC/`streamId` to a `deviceId`, and the `deviceId` maps to a `fullName`/`displayName`. Attendee does exactly this in production by wrapping `RTCPeerConnection` and `RTCRtpReceiver.prototype.getContributingSources`. It is the most accurate in-browser signal available: per-frame, audio-derived, and name-resolved, with no DOM heuristics.

### Cited Findings
**Meet's audio transport**
- The Meet Media API docs say audio uses "three distinct media streams, each having its own static SSRC. Once established, these SSRC values never change for the life of the session." The CSRC in the RTP header "identifies the true source of the RTP packets." — [Google: Manage virtual media streams](https://developers.google.cn/workspace/meet/media-api/guides/virtual-streams?hl=en)
- "Meet assigns each participant in a conference a unique CSRC value when they join. This value remains constant until they leave." When a stream stops being one of the loudest, "Meet switches the RTP packets that make up the SSRC to the loudest." So a given SSRC/track cannot be assumed to be one person. — [Google: virtual streams](https://developers.google.com/workspace/meet/media-api/guides/virtual-streams?hl=en)
- The Media API's `MediaEntry.audioCsrc` is "the CSRC for any audio stream contributed by this participant", and is zero when the participant has no stream. The Media API sends resource updates (media entries, participants) over WebRTC data channels, not HTTP. — [Google: media_api.mediaentry.audiocsrc](https://developers.google.com/workspace/meet/media-api/reference/dc/media_api.mediaentry.audiocsrc); [Meet Media API overview](https://developers.google.com/meet/media-api/guides/overview)
- The official Media API requires that the Cloud project, the OAuth principal **and all conference participants** be enrolled in the Developer Preview Program. That rules it out for a consumer extension. — [Meet Media API overview](https://developers.google.com/meet/media-api/guides/overview) (via search summary)
- The Meet C++ reference `AudioFrame` has a contributing-source field and a flag for whether the frame came from the loudest speaker. — [Google: meet::AudioFrame](https://developers.google.com/workspace/meet/media-api/reference/cpp/struct/meet/audio-frame) (via search summary)
- From the webrtcHacks "Meet vs Duo" article (2022, observational, via search summary only): Meet first negotiates one audio m-line, then adds **three receive-only audio m-lines**. The article says Chrome only renders the 3 loudest audio sources, so Meet rewrites SSRCs and forwards the 3 loudest. — [webrtcHacks](https://webrtchacks.com/meet-vs-duo-2-faces-of-googles-webrtc/). A Red5 article describes the same thing: 3 shared slots that remap participants (mix-minus style). — [Red5](https://www.red5.net/blog/how-google-meet-implements-audio-using-mix-minus-with-webrtc/) (fetch failed; search summary only)

**Attendee's in-page implementation, verified from source** — [attendee google_meet_chromedriver_payload.js](https://raw.githubusercontent.com/attendee-labs/attendee/main/bots/google_meet_bot_adapter/google_meet_chromedriver_payload.js)
- `RTCInterceptor` replaces `window.RTCPeerConnection` with a function that calls `Reflect.construct(...)` on the original. It also wraps `peerConnection.createDataChannel` and listens for the `datachannel` and `track` events.
- `RTCRtpReceiverInterceptor` wraps `RTCRtpReceiver.prototype.getContributingSources`. Each receiver's results are forwarded to `receiverManager.updateContributingSources`, which caches the latest CSRC list for every receiver. Meet's own code calls `getContributingSources` itself, apparently for its UI. Attendee only reads results; it does not poll the receiver independently. `getSynchronizationSources` does not appear in the visible code.
- Audio frames are accessed with WebCodecs `MediaStreamTrackProcessor({ track })` and `MediaStreamTrackGenerator({ kind: 'audio' })`, piped through a `TransformStream`. For each frame, `handleAudioTrack` reads `receiverManager.getContributingSources(receiver)`, maps each source to a user (`source.source.toString()` is used as the `streamId` key), sorts by `audioLevel`, and **assigns the frame to the loudest mapped CSRC**. Frames whose CSRCs cannot be mapped are dropped (`.filter(x => x.user)`).
- The data channel labelled **`collections`** carries participant state. Attendee decompresses each payload with `pako.inflate(new Uint8Array(event.data))` and decodes it with a hand-written protobuf schema (`messageTypes` / `createMessageDecoder`). The schema was reverse-engineered:
  - `CollectionEvent.body` is field 1, repeated.
  - `DeviceOutputInfoList` has `deviceOutputType` (field 2, varint; "Speculating that 1 = audio, 2 = video"), `streamId` (field 4, string), `deviceId` (field 6, string) and `deviceOutputStatus` (field 10; `disabled` = field 1).
  - `UserInfoList` has `deviceId` (1), `fullName` (2), `profilePicture` (3), `status` (4; "in meeting = 1 vs not in meeting = 6", 7 = removed per the code) and `displayName` (29).
- Other data channels: **`media-director`** is only logged. **`captions`** and **`captions_v2`** carry Meet's own live captions as protobuf (`CaptionWrapper`, `CaptionWrapperV2`), so speaker-labelled captions can be read **without scraping the DOM**.
- Mapping chain: `UserManager.getUserByStreamId(streamId)` finds the device output whose `streamId === streamId`, then returns `allUsersMap.get(deviceOutput.deviceId)`. Device outputs are keyed `${deviceId}-${outputType}`.
- The full roster comes from `FetchInterceptor`, which wraps `window.fetch`. It matches `https://meet.google.com/$rpc/google.rtc.meetings.v1.MeetingSpaceService/SyncMeetingSpaceCollections` exactly, clones the response, and calls `userManager.newUsersListSynced(userInfoList)`.
- Speech start/stop: `ParticipantSpeechStartStopManager.sampleVolumeLevels` runs every **250 ms** (a code comment says 500 ms, which conflicts) with threshold `audioLevel >= 0.01`. Hysteresis is `startThresholdSamples = 1` and `stopThresholdSamples = 4`, so speech starts after about 250 ms and stops after about 1 s. It emits `ParticipantSpeechStartStopEvent`.

**Known failure mode** — [attendee issue #1100](https://github.com/attendee-labs/attendee/issues/1100)
- Per-participant audio for a participant is silently dropped when their device output never reaches `deviceOutputMap`. That map is filled only from `collections` events.
- The failure was seen in 2 of 4 test meetings. Both involved a host who was already present before the bot joined. Across 25 `DeviceOutputsUpdate` messages, none contained the host's device, but captions for the host still arrived.
- Suspected decoder bugs:
  - Non-repeated fields are overwritten instead of merged.
  - `String.fromCharCode.apply` throws `RangeError` on messages over about 125 KB.
  - Events that lack a user list are handled incorrectly.

**Other projects**
- Vexa (open-source bot) does **not** use per-speaker audio. Its docs describe attribution as "speaker binding / clustering / captions" with no per-speaker audio. When it cannot resolve a speaker, it leaves the speaker empty rather than guessing, and it publishes no measured accuracy rate. — [Vexa docs](https://docs.vexa.ai/speaker-identification)
- Sussurro #104 is a spike on an MV3 MAIN-world `document_start` `RTCPeerConnection` Proxy plus a `getReceivers()` rescan after `setRemoteDescription`. It was tested only in a local harness: the hook installed about 1–3 ms after document start, and the page created its peer connection at about 65–120 ms. Meet results were deferred to a later issue. In Firefox, the isolated-world script may be injected after the MAIN-world script, so the author resends a handshake every second. — [fullo/Sussurro #104](https://github.com/fullo/Sussurro/issues/104)
- The aegis-stack proposal assumes one remote track per speaker. That assumption is wrong for Meet because of the 3 virtual streams. — [lbedner/aegis-stack #1510](https://github.com/lbedner/aegis-stack/issues/1510)
- MDN: `track` events can have an empty `streams` array, so stream IDs are not reliable identifiers. — [MDN track event](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/track_event)
- MDN: `RTCRtpReceiver.getContributingSources()` and `getSynchronizationSources()` return `{source, audioLevel (0..1), timestamp, rtpTimestamp}` for sources seen in the last 10 s. — [MDN getContributingSources](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/getContributingSources)
- Chrome MV3: content scripts can run in `world: "MAIN"` (manifest `content_scripts[].world` or `chrome.scripting.registerContentScripts`). That is needed to patch page globals such as `RTCPeerConnection` and `fetch` before Meet caches them. Use `run_at: "document_start"`. — [Chrome scripting API: ExecutionWorld](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld)

### Inferences
- For this product, the best fix is a MAIN-world `document_start` script that does four things:
  1. Wraps `RTCRtpReceiver.prototype.getContributingSources`, or polls `pc.getReceivers()` for the 3 audio receivers every 50–100 ms itself, to build a per-CSRC `audioLevel` timeline with `performance.now()` timestamps.
  2. Hooks the `datachannel` event and decodes `collections` with pako and protobuf to build the maps CSRC/streamId → deviceId → name.
  3. Wraps `fetch` to catch `SyncMeetingSpaceCollections` for the initial roster.
  4. Sends that data to the isolated content script with `window.postMessage`, or a `CustomEvent` with a nonce.

  The result is a name-resolved VAD timeline. It replaces DOM tile heuristics, and the existing tabCapture mixed stream can stay.
- Polling `getContributingSources` yourself avoids depending on how often Meet calls it. Meet's own polling interval is unknown.
- Mapping uncertainty: Attendee keys on `source.source.toString()` matching `streamId`. That suggests Meet's `streamId` string in `collections` equals the decimal CSRC. This is inferred from the code and not documented by Google.
- Copy Attendee's decoder fixes (merge semantics, no `apply` on large arrays). Add a fallback for the "host present before join" gap: if a CSRC has no mapping, label it provisionally and resolve it later from DOM, captions or the roster.
- `getStats()` `inbound-rtp.audioLevel` is per SSRC, so per slot rather than per person. It is useful only as a cross-check; per-person attribution should use CSRCs.
- Meet's CSP and Trusted Types do not block a MAIN-world content script registered by the extension. Injecting through inline `<script>` tags may be blocked; this is untested here.
- Fragility: protobuf field numbers, data-channel labels (`captions` became `captions_v2`) and RPC URLs can change without notice. They are still more stable than obfuscated CSS class names. Budget for monitoring and schema-drift alerts.

### Gaps
- No Google confirmation that the consumer Meet web client uses the same 3-SSRC + CSRC scheme as the Media API. Attendee's working code strongly implies it does.
- Meet's polling rate for `getContributingSources`, and the exact `audioLevel` scale and latency in Meet's stream, were not found.
- No public measured accuracy for the CSRC approach.
- The webrtcHacks and Red5 primary pages could not be fetched (DNS errors).

## 2. Scraping Meet live captions as a speaker-label track

### Takeaway
Caption-based tools (TranscripTonic, Tactiq, Recall's sample extension) get speaker names directly from Meet's caption blocks. They rely on structural selectors such as `div[role="region"][tabindex="0"]` plus `characterData` mutations, and they break when Meet changes the UI. A more robust option is the `captions` / `captions_v2` data channel, as Attendee does. In either form, captions work well as a **speaker-label track** aligned to AssemblyAI text. They are not good as a text source.

### Cited Findings
- TranscripTonic (MIT, all processing in the browser) uses these selectors, from config.js:
  - `TRANSCRIPT_REGION: 'div[role="region"][tabindex="0"]'`
  - `USER_NAME: ".awLEm"`, `MEETING_TITLE: ".u6vdEc"`
  - `GOOGLE_SYMBOLS: ".google-symbols"` with icon text `call_end` (used to detect meeting start and end) and `closed_caption_off` / `translate_cc` (captions toggle)
  - `CHAT_LIVE_REGION: 'div[aria-live="polite"].Ge9Kpc'`

  — [transcriptonic google-meet/config.js](https://raw.githubusercontent.com/vivek-nexus/transcriptonic/main/extension/content-scripts/google-meet/config.js)
- TranscripTonic logic:
  - It reacts only to `characterData` mutations. Speaker name = `mutation.target.parentElement.previousSibling.textContent`; text = `parentElement.textContent`.
  - It handles only the **third-from-last child**, because the last two children are not transcript elements and "Meet mutates previous blocks to make minor corrections".
  - When the mutation's parent element changes, it treats that as a new speaker block and flushes the buffer.
  - If text shrinks by more than 250 chars, it assumes Meet dropped very long text (about 30 min of one speaker) and resets.
  - It re-attaches the observer every 2 s. Code comments mark these as "CRITICAL DOM DEPENDENCY".

  — [transcriptonic google-meet/index.js](https://raw.githubusercontent.com/vivek-nexus/transcriptonic/main/extension/content-scripts/google-meet/index.js)
- Other open-source caption scrapers: [syffs/google-meet-transcripts](https://github.com/syffs/google-meet-transcripts), [sughodke/google-meet-transcripts](https://github.com/sughodke/google-meet-transcripts), and [recallai/chrome-recording-transcription-extension](https://github.com/recallai/chrome-recording-transcription-extension). Recall's extension saves timestamped caption text, requires captions to be turned on, and records tab audio and video as well. (Search-result summaries.)
- Meet Buddy's author reports that Meet renders captions as obfuscated divs whose class names change periodically, so it locates them by position and structure. A TranscripTonic user's report of missing transcripts was attributed to Meet updates. — [aumiqx Meet Buddy write-up](https://aumiqx.com/learn/meet-buddy-real-time-meeting-copilot/) (search summary)
- Tactiq reads Meet's live caption stream, so its transcript depends on captions being enabled; on Meet it labels each line with the participant's name. Reviews report weaker speaker accuracy with overlapping talk and similar voices. Language-support figures conflict (30+ vs 60+). — [vexascribe comparison](https://vexascribe.com/compare/best-google-meet-transcription-tools) (competitor-authored); [devtoollab](https://devtoollab.com/ai-tools/tactiq); [proactor](https://proactor.ai/blog/?p=3757); [geekflare](https://geekflare.com/ai/tactiq-review/)
- Meet caption languages expanded in 2020 (French, German, Portuguese, Spanish) and 2022 (Japanese, Russian, Italian, Korean, Dutch, Portuguese, Mandarin traditional; some marked Beta). Each user chooses the meeting's spoken language when enabling captions. — [Workspace Updates 2020](https://workspaceupdates.googleblog.com/2020/12/additional-language-support-for-live-captions.html); [Workspace Updates 2022](https://workspaceupdates.googleblog.com/2022/12/more-languages-for-captions-and-translated-captions-in-google-meet.html)
- Attendee decodes `captions` / `captions_v2` data-channel protobuf (`CaptionWrapper` / `CaptionWrapperV2`) when `collectCaptions` is set. — [attendee payload](https://raw.githubusercontent.com/attendee-labs/attendee/main/bots/google_meet_bot_adapter/google_meet_chromedriver_payload.js)
- Granola's extension determines Meet speakers from participant names and current-speaker indicators in the Meet UI. — [Granola docs](https://docs.granola.ai/help-center/taking-notes/speaker-attribution-google-meet) (search summary; fetch failed)

### Inferences
- How to use captions as a label track:
  1. Turn captions on; they can be hidden visually.
  2. Record (speaker, caption text, first-seen time, last-update time) per block.
  3. Fuzzy-align caption tokens to AssemblyAI words in a ±3 s window, using normalized-token Levenshtein or DTW.
  4. Copy the speaker label onto the aligned ASR words.

  Text alignment avoids the timing-offset problem completely. It also handles same-speaker continuation, because Meet splits caption blocks per speaker.
- Captions are only usable as a label track when the meeting's caption language matches what people are actually speaking. In unsupported languages or mixed-language calls, caption text is garbage. Fall back to CSRC VAD in those cases.
- Enabling captions is visible only to the local user; other participants are not notified. Still, auto-toggling the captions control is a UI action the user should agree to.
- Caption latency was not measured here. It is likely on the order of 1–2 s, and blocks are revised in place.

### Gaps
- No primary source found for caption latency, or for whether caption speaker labels go wrong when people overlap.
- Tactiq's and Fireflies' extension internals are not public.
- The official Meet help-center language list was not retrieved.

## 3. Better DOM approaches (participant list, data attributes, speaking indicators, join/leave)

### Takeaway
DOM-only attribution, which is what this product does now, is the least reliable layer. Indicators are throttled or animated, are hidden during screen share and in some layouts, and need 3+ participants in some views. Class names are obfuscated and change. Keep the DOM only for names, a roster fallback and sanity checks, and drive attribution from CSRC audio levels or captions.

### Cited Findings
- Vexa (via search summary of its docs):
  - It detects the tile showing the "speaking" animation using injected JS.
  - Detection works with 3+ participants, where the indicator appears in the speaker bar.
  - Screen sharing can hide or reduce the indicators.
  - It uses vote-based identity locking: 1.0 vote for a single speaker, 0.5 each when two speak at once.

  — [Vexa speaker identification](https://docs.vexa.ai/speaker-identification)
- Vexa's platform modules watch only tiles that emit a speaking signal, so silent participants leave no record (issue #861). — [Vexa docs](https://docs.vexa.ai/speaker-identification)
- "Google Meet's DOM is not a public API; selectors may need updates when Meet changes." — [Apify google-meet-transcription-bot](https://apify.com/lexis-solutions/google-meet-transcription-bot) (third-party)
- Attendee's join/leave handling:
  - The roster comes from the `SyncMeetingSpaceCollections` fetch, which Meet's comments say lags by about a minute for leaves.
  - Single-user `collections` events are ambiguous: "we can't tell whether the event is a join or leave event, so we'll assume it's a join".
  - It maps status codes 1 = in meeting, 6 = not in meeting, 7 = removed, and emits `UsersUpdate {newUsers, removedUsers, updatedUsers}`.

  — [attendee payload](https://raw.githubusercontent.com/attendee-labs/attendee/main/bots/google_meet_bot_adapter/google_meet_chromedriver_payload.js)
- The "Highlight Speaker for Google Meet" Chrome extension exists and works from the DOM speaking indicators. — [Chrome Web Store](https://chrome.google.com/webstore/detail/highlight-speaker-for-goo/ffnajlckjebjbkgemeklcibgljpnlikb) (search listing only)

### Inferences
- If you keep a DOM layer:
  - Anchor on stable attributes: `data-participant-id` / `data-requested-participant-id` on tiles (widely used by scrapers, but not verified in a primary source here), plus `aria-label`s and `role="list"` in the People panel. Avoid class names.
  - Use one `MutationObserver` on a high-level container (`subtree`, `attributes`, `attributeFilter` limited to the attributes you need) rather than per-tile observers.
  - Debounce at about 100 ms.
- Join/leave: combine the People-panel list diff, join/leave toast text in `aria-live` regions, and `collections` status codes, and take whichever arrives first. `collections` with its status field is the most authoritative.
- Fragility: keep selectors in remote config, add self-tests that alert when a selector returns 0 nodes during an active call, and expect breakage roughly every few months.

### Gaps
- No primary source found that documents `data-participant-id` or the speaking-indicator class names as of Nov 2026. A live DOM inspection is needed.

## 4. How bot-based notetakers determine speakers in Meet

### Takeaway
Bots run a real Meet web client in headless Chrome. They use either (a) the in-page WebRTC CSRC + `collections` approach (Attendee) to get per-participant audio and a speaker timeline, (b) captions plus DOM speaking indicators (Vexa), or (c) platform "active speaker" signals assembled from such sources (Recall). Recall's own blog says Google Meet has no direct active-speaker event. Machine diarization is a fallback that cannot produce names.

### Cited Findings
- Recall: speaker-timeline diarization is the default. It matches transcribed words to the time ranges in which each speaker is active, using the platform's active-speaker data. Speakers who talked before the bot joined can show as null at the start of a transcript. Timestamps are relative to the `in_call_recording` event. — [Recall docs: speaker timeline](https://docs.recall.ai/docs/speaker-timeline) (search summary)
- Recall's blog says Zoom exposes `OnActiveSpeakerChangeEvent` while **Google Meet does not provide a direct active-speaker event**. — [Recall blog: speaker diarization](https://www.recall.ai/blog/speaker-diarization) (search summary)
- Recall's "perfect diarization" (one stream per participant) platform table lists Zoom and Teams; Google Meet was not listed in the search snippet. — [Recall docs: perfect diarization](https://docs.recall.ai/docs/perfect-diarization); [separate audio realtime](https://docs.recall.ai/docs/how-to-get-separate-audio-per-participant-realtime) (search summary; fetch failed, so treat Meet support status as unverified)
- AssemblyAI's notetaker guide says Google Meet needs a third-party recording solution such as Recall.ai to get separate per-participant audio. — [AssemblyAI meeting notetaker best practices](https://www.assemblyai.com/docs/meeting-notetaker-best-practices) (search summary)
- Recall gets names by integrating with the platform. Machine diarization degrades with more speakers, overlap and short utterances, and "doesn't have a way to figure out the actual names". — [Recall blog: speaker labels and names explained](https://www.recall.ai/blog/speaker-labels-and-names-explained)
- Attendee (open source) offers `per_participant_audio` for Meet through CSRC mapping, and also collects captions from data channels. — [attendee issue #1100](https://github.com/attendee-labs/attendee/issues/1100)
- Vexa uses DOM speaking indicators and captions; no per-speaker audio. — [Vexa docs](https://docs.vexa.ai/speaker-identification)

### Inferences
- Fireflies, Otter, tl;dv and Read.ai do not publish their Meet internals. They very likely use one of the same three families. Recall-style "per-participant audio" on Meet is technically possible through CSRC demuxing, but overlapping speech beyond the top 3 is lost, and a slot can switch between people mid-utterance.

### Gaps
- No engineering blog from Fireflies, Otter, tl;dv or Read.ai describing their Meet speaker detection was found.
- Whether Recall supports separate per-participant audio for Meet as of Nov 2026 is unverified.

## 5. Recommended fusion: aligning words to speaker timelines, overlap, and latency offsets

### Takeaway
Build one name-resolved activity timeline, using CSRC `audioLevel` as the primary source and the caption label track as a secondary one, both on a single monotonic clock. Assign each AssemblyAI word to the speaker with the most energy-weighted overlap in a lag-corrected window. Smooth at the turn level with hysteresis and voting. Estimate the DOM/CSRC-to-audio lag online rather than hard-coding it.

### Cited Findings
- Vexa's voting: 1.0 vote for a single detected speaker, 0.5 each for simultaneous speakers, with identity locked after enough votes. — [Vexa docs](https://docs.vexa.ai/speaker-identification)
- Attendee's speech start/stop: 250 ms sampling, threshold 0.01, start after 1 sample, stop after 4 samples. Each frame is assigned to the loudest mapped CSRC. — [attendee payload](https://raw.githubusercontent.com/attendee-labs/attendee/main/bots/google_meet_bot_adapter/google_meet_chromedriver_payload.js)
- Recall's speaker-timeline diarization maps words onto active-speaker ranges. Recall notes that merging streams before diarization loses overlapping speech, and that separate streams improve attribution, especially during overlap. — [Recall docs: speaker timeline](https://docs.recall.ai/docs/speaker-timeline); [Recall speaker diarization API](https://www.recall.ai/product/speaker-diarization-api) (search summaries)
- `getContributingSources` entries carry `timestamp` (DOMHighResTimeStamp, the time the last packet from that source was played out) and `rtpTimestamp`. They can therefore be put on the same `performance.now()` clock as frames from the tabCapture audio pipeline. — [MDN getContributingSources](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/getContributingSources)

### Inferences
**Clock**
- Timestamp everything with `performance.now()` (plus a `timeOrigin` offset) in the MAIN world, the content script and the offscreen document.
- Record the wall-clock time at which the first PCM chunk was sent to AssemblyAI. Its word `start`/`end` times (ms from stream start) then map to that clock.
- Keep tab audio and mic audio as separate AssemblyAI sessions, or tag the channel. The mic stream is always "me", which removes the self-attribution errors.

**Lag estimation**
- Cross-correlate the summed CSRC `audioLevel` envelope with the RMS envelope of the tabCapture stream over a sliding 10 s window. That gives the offset between the CSRC timeline and the captured audio (expected to be tens of ms, because both reflect playout).
- For DOM indicators, expect +300–1000 ms lag plus animation smoothing. That is the main reason the current approach misattributes short turns.

**Assigning words**
- For each word [s, e], score each candidate speaker by ∫ audioLevel over [s−δ, e+δ] with δ ≈ 150 ms, and pick the argmax.
- If the top two scores are within 20%, mark the word as overlap. Then split by caption-text alignment if captions exist; otherwise keep the dominant speaker.

**Turn-level smoothing**
- Run an HMM or Viterbi pass over the word labels with a switch penalty, or require ≥ 2 consecutive words or ≥ 300 ms before allowing a speaker change.
- Re-segment AssemblyAI turns at speaker changes, so the system no longer forces one label per ASR turn.

**Retroactive correction**
- Keep the 45 s buffer, but key it by CSRC. When an unmapped CSRC later resolves to a name (from `collections` or the roster), relabel all of its past words in one pass. Do not re-correlate.

**Fallback order**
1. CSRC + `collections` mapping.
2. CSRC with name from DOM tile correlation, done once per CSRC.
3. Caption label track via text alignment.
4. DOM speaking indicator.
5. AssemblyAI diarization labels: `speaker_labels` is not available in streaming v3 here, so leave the word "Unknown".

**Overlap**
- Meet forwards at most 3 concurrent speakers. A single mixed tabCapture stream cannot separate their words.
- Accept dominant-speaker labelling. Alternatively, tap each of the 3 remote tracks (via `MediaStreamTrackProcessor`, as Attendee does) and send each slot to ASR separately, splitting each slot's audio at CSRC changes. That gives true per-person streams, at the cost of 3× the ASR connections.

**ToS and consent**
- Hooking Meet's internals and decoding private protobuf is reverse-engineering of an undocumented client. It may conflict with Google's Terms of Service, and Chrome Web Store reviewers may question MAIN-world patching of `RTCPeerConnection` and `fetch`. It is safer to state it in the listing and privacy policy, and to keep all processing local except for ASR.
- Recording or transcribing others needs notice and consent in all-party-consent jurisdictions (for example, several US states, and the EU under GDPR). A visible in-call notice, or a chat message the user approves, is good practice. Captions-based tools avoid capturing audio, but still process other people's speech.

### Gaps
- No published measurements of DOM-indicator lag versus audio in Meet, or of CSRC `timestamp` precision in Meet, were found. Both need instrumentation in this product.
- AssemblyAI Streaming v3's diarization support status as of Nov 2026 was not checked here (out of scope).
