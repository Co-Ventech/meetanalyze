# Google Meet Media API and Meet Add-ons SDK for per-participant audio and active-speaker data (as of 2026-11-13)

> **Headline finding:** Google **deprecated the Meet Media API on Oct 28, 2026**. It will **never reach GA**, and its endpoints shut down **permanently on January 15, 2027**. Only existing Developer Preview Program participants keep access until then. The official guide pages (overview, virtual-streams, C++ reference) now return HTTP 404. The GitHub samples repo was archived on Oct 28, 2026. Technical details below come from the archived reference-client source code, the Workspace admin help page, and a Recall.ai write-up (updated Nov 12, 2026).

## 1. Status, eligibility, enrollment, consent, editions, consumer accounts

### Takeaway
The Meet Media API was only ever a Developer Preview (from Feb 24, 2025). It was deprecated on Oct 28, 2026 and turns off on Jan 15, 2027. While it ran, every participant had to be enrolled in the Developer Preview Program, a host or co-host had to consent, and the app needed restricted-scope verification. It is not a viable path for a new product.

### Cited Findings
- **Feb 24, 2025:** The Meet Media API became "available as part of the Developer Preview Program" for real-time access to Meet conference media. — [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- **Oct 28, 2026:** Google says it has "decided to wind down the Google Meet Media API and permanently turn down its endpoints on January 15, 2027." Preview participants keep their credentials and staging environments until then. "After this date, you will not be able to access the Meet Media API." The Meet REST API and Meet Add-ons SDK (both GA) are not affected. Google recommends the Meet REST API for workflows such as action-item extraction and post-call summaries. — [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- The samples README says: "The Google Meet Media API has been discontinued and will not advance to General Availability (GA)." The repository was archived by its owner on Oct 28, 2026 and is now read-only. — [GitHub googleworkspace/meet-media-api-samples](https://github.com/googleworkspace/meet-media-api-samples)
- The official overview pages (developers.google.com/meet/media-api/guides/overview, /workspace/... and its localized variants), the virtual-streams guide (including the developers.google.cn mirror) and the C++ MediaEntry reference all returned **HTTP 404** on 2026-11-13. — fetch attempts against [overview](https://developers.google.com/meet/media-api/guides/overview) and [virtual-streams](https://developers.google.com/workspace/meet/media-api/guides/virtual-streams)
- **All participants must be enrolled in the Developer Preview Program** for the API to capture their speech, video or screenshare. If the app is enabled before non-preview participants join, preview participants cannot hear those participants. If any participant is not enrolled when the app is enabled mid-meeting, the app fails to get data. Non-enrolled users can still join as viewers. — [Recall.ai blog, "What is the Google Meet Media API" (pub. Jul 16, 2025; upd. Nov 12, 2026)](https://www.recall.ai/blog/what-is-the-google-meet-media-api)
- **Host consent:** The host or co-host must approve app access during the meeting. Third-party apps must be enabled in the Calendar invite or by the host in host controls, otherwise `connectActiveConference` fails. Anyone, including viewers, can revoke consent, and the stream then ends immediately with no platform recovery. For Gmail-hosted meetings the host must be present. If the app joins first, the connection fails silently because the SDP offer is ignored. — [Recall.ai blog](https://www.recall.ai/blog/what-is-the-google-meet-media-api)
- **Admin control:** The admin setting reads "Let third-party apps that join a Meet call use the audio and video of the call through Meet Media API". It lives at Admin console > Apps > Google Workspace > Google Meet > Meet safety settings > Media API. The consent options are "Everyone from the host's org can give consent" (the default) or "Only the host or co-host can give consent." Changes can take up to 24 hours. — [Workspace Admin Help: Control Media API access in Google Meet](https://knowledge.workspace.google.com/admin/meet/control-media-api-access-in-google-meet?hl=en)
- **Consent indicators:** The Admin Help page says Media API works in a meeting only if at least one user in the call has previously agreed to the terms. Participants are informed when the API is in use, and each participant can turn it off. — [Workspace Admin Help](https://knowledge.workspace.google.com/admin/meet/control-media-api-access-in-google-meet?hl=en)
- **Editions listed for the admin control:** Frontline Starter/Standard/Plus; Business Starter/Standard/Plus; Enterprise Standard/Plus; Essentials Starter, Essentials, Enterprise Essentials, and Enterprise Essentials Plus; G Suite Basic. The help page carried no deprecation notice when fetched. — [Workspace Admin Help](https://knowledge.workspace.google.com/admin/meet/control-media-api-access-in-google-meet?hl=en)
- **Consumer (@gmail.com):** Recall.ai reports that Google says capture works when the host is present, but Recall.ai could not verify this because of preview restrictions. — [Recall.ai blog](https://www.recall.ai/blog/what-is-the-google-meet-media-api)

### Inferences
- With shutdown on Jan 15, 2027 (about 2 months from now) and new preview enrollment unlikely, the Meet Media API is **not an option** for this extension. Any work on it would be thrown away.
- Even before deprecation, the rule that every participant be enrolled made it unusable for general notetaking with external or arbitrary attendees. It suited only internal meetings where everyone was enrolled.

### Gaps
- No primary Google source is still online stating the "all participants enrolled" rule or the participant-facing consent UI. The Google overview page is 404, so these points rest on Recall.ai and the admin help page.
- Handling of minors and external-domain participants is not documented in any source still available.
- Whether new Developer Preview enrollments are still accepted: not stated, though the deprecation notice implies they are not.

## 2. Technical model: virtual audio streams, CSRC-to-participant mapping, data channels, video

### Takeaway
The client is a WebRTC peer of Meet's SFU. It receives **exactly 3 virtual audio streams** (SSRCs) that carry the current loudest speakers. The real speaker in each RTP packet is identified by its **CSRC**. The `media-entries` data channel maps each participant's `audioCsrc` to a participant key, and the reference client resolves this with `RTCRtpReceiver.getContributingSources()`. Participant join and leave arrive as resource snapshots and deletions on the `participants` channel.

### Cited Findings
- The reference client says "Meet only supports 3 audio virtual ssrcs. If disabled, there will be no audio." (`NUMBER_OF_AUDIO_VIRTUAL_SSRC = 3`). The number of audio streams is not configurable; `enableAudioStreams` is a boolean. — [meetmediaapiclient_impl.ts / mediatypes.d.ts (archived repo)](https://github.com/googleworkspace/meet-media-api-samples/tree/main/web)
- Video streams must number between 0 and 3 (`MINIMUM_VIDEO_STREAMS = 0`, `MAXIMUM_VIDEO_STREAMS = 3`). — [meetmediaapiclient_impl.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/internal/meetmediaapiclient_impl.ts)
- Search-indexed text of the now-removed Google virtual-streams guide says three things. Audio uses three media streams, each with a static SSRC that "never change[s] for the life of the session". "The CSRC in the RTP packet headers identifies the true source of the RTP packets. Meet assigns each participant … their own unique CSRC when they join. This value remains constant until they leave." The guide also says the SFU caps virtual streams, and participants can outnumber them. — [Manage virtual media streams (search snippet; page now 404)](https://developers.google.com/workspace/meet/media-api/guides/virtual-streams)
- The reference client opens these WebRTC data channels: `session-control`, `media-stats`, `video-assignment`, `media-entries` and `participants`. The SDP offer must be ordered audio, then data channels, then video. ICE uses `stun:stun.l.google.com:19302`, with unified-plan and max-bundle. — [meetmediaapiclient_impl.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/internal/meetmediaapiclient_impl.ts)
- **MediaEntry (media-entries channel)** carries several fields. `participantKey` (format `participants/{participant}`) and `sessionName` (a Meet REST ParticipantSession) are the identifiers. `audioCsrc` ("CSRC for any audio stream contributed by this participant") and `videoCsrcs` carry the stream sources. `presenter`, `screenshare`, `audioMuted` and `videoMuted` are state flags. `participantId` is deprecated. Deletions arrive as `DeletedMediaEntry`. — [datachannels.d.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/types/datachannels.d.ts)
- **Participant (participants channel):** Each participant arrives as one of `signedInUser` (a unique ID interoperable with the Admin SDK and People API, plus a display name), `anonymousUser` (a display name) or `phoneUser` (a partially redacted number). Each also has a `participantKey` that links to the Meet REST `conferenceRecords.participants` resource. Removals arrive as `DeletedParticipant` in `deletedResources`, which works as a real-time leave signal. — [datachannels.d.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/types/datachannels.d.ts); [mediatypes.d.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/types/mediatypes.d.ts)
- **CSRC resolution in the TS client:** The client calls `receiver.getContributingSources()` on each virtual audio track's receiver. It matches `contributingSource.source === mediaEntry.audioCsrc` to assign the track to a media entry, and unassigns it when the CSRC is no longer present. — [media_entries_channel_handler.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/internal/channel_handlers/media_entries_channel_handler.ts)
- The public client type `MediaEntry` exposes `participant`, `audioMuted`, `audioMeetStreamTrack` and `isLoudestSpeaker` ("Whether audio from this media entry is from the loudest speaker"), all as `Subscribable`. The client exposes `participants: Subscribable<Participant[]>`, `joinMeeting()` and `leaveMeeting()`. — [mediatypes.d.ts / meetmediaapiclient.d.ts](https://github.com/googleworkspace/meet-media-api-samples/tree/main/web/types)
- The C++ reference doc describes `audio_csrc` as unused for now, while `video_csrcs` holds the video CSRCs. This conflicts with the TS client, which does use `audioCsrc`. — [C++ media-entry reference (search snippet; page now 404)](https://developers.google.com/workspace/meet/media-api/reference/cpp/struct/meet/media-entry)
- **Session connection:** The client calls `POST https://meet.googleapis.com/v2beta/{spaces/ID}:connectActiveConference` with `Authorization: Bearer {accessToken}` to exchange the SDP offer and answer. — [default_communication_protocol_impl.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/internal/communication_protocols/default_communication_protocol_impl.ts)
- **Media and wire requirements (per Recall.ai):**
  - Codecs: Opus audio; AV1, VP8 or VP9 video, at 128×128 to 2880×1800, 1–30 fps, 30 kbps to 5 Mbps.
  - Required RTP header extensions: Absolute Send Time, Transport-Wide CC, Absolute Capture Time, Dependency Descriptor and Audio Level Indication.
  - The client must send `getStats()` data on the `media-stats` channel, typically every 10 s, or the connection can drop.
  - There is no built-in reconnect, so the app must handle ICE restarts.
  - Recall.ai recommends at least 4 Mbps of bandwidth and a libwebrtc no more than 12 months behind Chromium.
  - There are no captions, transcript or chat streams, and no breakout rooms.
  — [Recall.ai blog](https://www.recall.ai/blog/what-is-the-google-meet-media-api)

### Inferences
- The data model would have solved the attribution problem cleanly. Each of the 3 audio tracks carries one speaker at a time, identified by CSRC, which maps to `participantKey` and display name. Each track could have been streamed to ASR as its own channel. In calls where more than 3 people talk at once, quieter speakers would be dropped.
- Join and leave detection would have come from `participants` snapshots and deletions, with mute state from `media-entries`.

### Gaps
- No published latency numbers were found.
- How the 3 loudest streams are selected and how fast they switch is undocumented in the remaining sources.

## 3. Scopes, verification, authorization, restrictions

### Takeaway
The API used restricted OAuth scopes such as `meetings.conference.media.readonly`, which required Google app verification plus a third-party security assessment. Encrypted or watermarked meetings were rejected.

### Cited Findings
- Scopes were restricted, for example `meetings.conference.media.readonly`. They required app verification and a third-party security assessment, which Recall.ai reports takes 4–7 weeks. The REST API uses a mix of sensitive and restricted scopes. — [Recall.ai blog](https://www.recall.ai/blog/what-is-the-google-meet-media-api)
- Encrypted or watermarked meetings are automatically rejected. — [Recall.ai blog](https://www.recall.ai/blog/what-is-the-google-meet-media-api)
- An admin can limit consent to the host or co-host only. — [Workspace Admin Help](https://knowledge.workspace.google.com/admin/meet/control-media-api-access-in-google-meet?hl=en)

### Inferences
- The full scope list (for example, separate audio-only or video-only scopes) cannot be verified now because the docs are offline.

### Gaps
- The exact scope names beyond `meetings.conference.media.readonly`, client-side-encryption specifics and minors' accounts: no surviving primary source.

## 4. Browser/extension vs server; pricing and quotas

### Takeaway
A TypeScript browser reference client existed, built on standard `RTCPeerConnection` and served as a static web app, so a browser context was technically possible. A C++ client covered server or bot use. No pricing was found. Shutdown makes this moot.

### Cited Findings
- The repo contains TypeScript (`web/`) and C++ (`cpp/`) reference clients. The web sample is a webpack app with a small `server.js` and an App Engine `app.yaml`. The client takes `meetingSpaceId`, `numberOfVideoStreams`, `enableAudioStreams` and `accessToken`, and exposes the remote tracks as standard `MediaStreamTrack`s. — [GitHub repo tree](https://github.com/googleworkspace/meet-media-api-samples); [mediatypes.d.ts](https://github.com/googleworkspace/meet-media-api-samples/blob/main/web/types/mediatypes.d.ts)
- Recall.ai integrated it as `meeting_direct_connect`. Its docs note that Meet captions do not work with Meet Media, because only audio and video are output and transcription needs a third-party provider. — [Recall.ai docs (search snippet)](https://docs.recall.ai/docs/google-meet-media-api)

### Inferences
- An MV3 extension could have run the TS client in an extension page or offscreen document, given an OAuth token for an enrolled app with the restricted scope. The client is a separate WebRTC participant, not the user's own Meet tab session.

### Gaps
- No pricing or quota information was found.

## 5. Meet Add-ons SDK: participant, speaker or audio data?

### Takeaway
No. The Add-ons SDK (GA since Sep 9, 2024) provides side panel and main stage iframes plus co-activity and collaboration features. Its only meeting data is `getMeetingInfo()`, which returns `meetingId` and `meetingCode`. There is no participant list, active speaker or audio. Participant join and leave must come from the Meet REST API or Workspace Events, and only after the fact or near real time.

### Cited Findings
- The Add-ons SDK reached GA on **Sep 9, 2024**. `meetingCode` retrieval was added on Oct 7, 2024 (v1.1.0). `getCurrentMeetingRecordingStatus()` was deprecated on Feb 12, 2024 with no replacement. — [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- The SDK provides a side panel, a main stage (a separate page that calls `createAddonSession`) and collaboration. It is distributed through the Google Workspace Marketplace. — [Add-ons overview](https://developers.google.com/workspace/meet/add-ons/guides/overview)
- `MeetSidePanelClient` methods are `notifyMainStage`, `closeAddon`, `endActivity`, `getActivityStartingState`, `getFrameOpenReason`, `getMeetingInfo`, `on` (frame-to-frame messages), `setActivityStartingState` and `startActivity`. None returns participants, an active speaker or audio. — [MeetSidePanelClient reference](https://developers.google.com/workspace/meet/add-ons/reference/websdk/addon_sdk.meetsidepanelclient)
- `MeetingInfo` has only `meetingCode` and `meetingId` (usable with the Meet REST API). — [MeetingInfo reference](https://developers.google.com/workspace/meet/add-ons/reference/websdk/addon_sdk.meetinginfo)
- **Alternative join/leave signal through the Meet REST API (GA):**
  - Active participants can be listed with `latestEndTime IS NULL`, and active sessions with `endTime IS NULL`.
  - Participants come back as `signedinUser`, `anonymousUser` or `phoneUser`, each with a `displayName`.
  - Meeting space owners or participants can call it.
  — [Meet REST API participants guide](https://developers.google.com/workspace/meet/api/guides/participants)
  - Since Feb 7, 2025 (GA), all meeting participants can query conference records, including participants. — [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- **Workspace Events API (GA since Feb 15, 2024):**
  - Event types include `google.workspace.meet.participant.v2.joined` and `.left`, alongside conference, recording, transcript and smartNote events.
  - Payloads carry only a resource name.
  - Subscriptions target a space or a user (spaces they own).
  - Calendar invitees can receive only `conference.v2.started` and `transcript.v2.fileGenerated`, so participant joined/left events require owner-level subscription.
  — [Meet events guide](https://developers.google.com/workspace/events/guides/events-meet); [release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)

### Inferences
- Join and leave detection can be done officially by a meeting owner's subscription to Workspace Events, which needs a backend to receive events. A non-owner participant can poll `conferenceRecords.participants` with `latestEndTime IS NULL`. Neither gives "who is speaking."
- No supported Google API now gives real-time active-speaker data or per-participant audio. Options are DOM scraping (current approach), a meeting bot (a vendor such as Recall.ai, or self-built), or local diarization of the mixed stream with speaker-to-name mapping using DOM speaking cues as weak labels.

### Gaps
- REST API latency for live participant listings is undocumented.
- Exact OAuth scopes for participant events were not captured. The events guide defers them to scope-selection pages.

## 6. Real-world adoption and gotchas

### Takeaway
Recall.ai shipped a Meet Media integration (`meeting_direct_connect`) but described it as suitable only for internal, all-enrolled meetings. They now steer customers to bots or desktop SDKs ahead of the Jan 15, 2027 shutdown.

### Cited Findings
- Recall.ai recommends using Meet Media only for internal real-time use cases where all participants are enrolled, and planning migration before Jan 15, 2027 to its Desktop Recording SDK or Meeting Bot API, or to a self-built bot. — [Recall.ai blog](https://www.recall.ai/blog/what-is-the-google-meet-media-api)
- Gotchas Recall.ai reports:
  - A silent failure if the app connects before the host in Gmail-hosted meetings.
  - Any participant can kill the stream by revoking consent.
  - Mandatory stats reporting on `media-stats`.
  - Strict RTP requirements: padding and frame-size mismatches are rejected.
  - No SDK beyond the reference clients.
  — [Recall.ai blog](https://www.recall.ai/blog/what-is-the-google-meet-media-api)
- Recall.ai's Google Meet Bot API (a separate product) is marketed as working across all Workspace tiers, including free plans, with real-time transcripts by webhook. — [Recall.ai Google Meet Bot API (search snippet)](https://www.recall.ai/product/meeting-bot-api/google-meet)

### Inferences
- The Meet Media API's deprecation suggests Google is not offering third parties sanctioned real-time media access. Bots and client-side capture remain the industry norm for Meet.

### Gaps
- No independent (non-Recall.ai) developer experience reports were found. The api-evangelist mirror of the Recall.ai post was unreachable (DNS error).
