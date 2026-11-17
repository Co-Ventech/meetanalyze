# Google Meet REST API (v2) and Google Workspace Events API as a real-time source of participant join/leave and active-speaker data

Research date: 2026-11-13. All facts below come from Google's own developer docs unless marked otherwise. Statements under "Inferences" are reasoning, not documented fact.

**Bottom-line verdict:** The REST API and the Workspace Events API can give near-real-time join/leave signals, with delivery lag of up to a few minutes. **Neither can tell you who is speaking in real time.** No REST resource contains speaking, active-speaker, audio-level or mute data. The only source of per-speaker attribution, transcript entries, is post-meeting only. Google's only real-time media API, the Meet Media API, was deprecated on Oct 28, 2026 and its endpoints shut down on Jan 15, 2027.

## 1. Resources in Meet REST API v2, when each is available, and whether any carries speaking data

### Takeaway
Spaces, conferenceRecords, participants and participantSessions can be read during a live meeting. These give a polling-based "who is currently in the call" list. Recordings, transcripts, transcript entries and smart notes appear only after the meeting or artifact ends. No resource has an active-speaker or "is speaking" field. Transcript entries do carry per-utterance participant attribution, but only after the conference.

### Cited Findings
- Availability by resource, per the overview:
  - Spaces: before, during and after.
  - conferenceRecords: "created automatically when the conference starts."
  - Participants and participantSessions: available during and after. Active conference metadata and participant sessions can be retrieved during a conference.
  - Recordings, transcripts, transcript entries and smart notes: after. Recordings are "usually ready to be fetched soon after a conference ends."
  - Source: [Meet REST API overview](https://developers.google.com/workspace/meet/api/guides/overview)
- The overview has no mention of active speaker. Its "real-time" language refers only to lifecycle events delivered through the Workspace Events API. — [Meet REST API overview](https://developers.google.com/workspace/meet/api/guides/overview)
- **Active participants mid-call:**
  - The participants guide says: "To list all active participants in an existing conference, use `latestEndTime IS NULL`."
  - For active participant sessions, filter on `endTime IS NULL`.
  - Source: [Work with participants](https://developers.google.com/workspace/meet/api/guides/participants)
- **Participant resource fields:**
  - `name`, `earliestStartTime`, and `latestEndTime` ("can be null for an active meeting").
  - Exactly one of `signedinUser`, `anonymousUser` or `phoneUser`.
  - The resource has **no fields for speaking or mute status**.
  - Source: [Participant reference](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants)
- participantSessions:
  - One session ID is created per participant-device pair. Rejoining from the same device creates a new session ID.
  - Fields are `startTime` and `endTime`.
  - Source: [Work with participants](https://developers.google.com/workspace/meet/api/guides/participants)
- **TranscriptEntry fields:** `name`, `participant` ("The participant who spoke"), `text` (up to 10K words), `languageCode` (BCP-47), `startTime` and `endTime`. — [TranscriptEntry reference](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts.entries)
- Transcript entry timing and retention:
  - "Each transcript entry is connected to a `participant` name in the conference."
  - Entries are ordered by `startTime`.
  - "Transcript entry data is available for 30 days after the conference ends."
  - Entries "might not match" the Docs transcript if that file was edited.
  - Source: [Meet artifacts guide](https://developers.google.com/workspace/meet/api/guides/artifacts)
- Transcript prerequisites:
  - Transcription has to be turned on in Meet before the conference ends: "participants must configure them in Meet before the conference ends."
  - "When all participants leave the meeting, the transcript stops automatically."
  - Artifacts go to the organizer's Drive.
  - Source: [Meet artifacts guide](https://developers.google.com/workspace/meet/api/guides/artifacts)
- Permitted use: "The Meet REST API isn't intended for performance tracking or user evaluation within your domain." — [Meet REST API overview](https://developers.google.com/workspace/meet/api/guides/overview)

### Inferences
- Meet's own transcript entries (participant ID plus start and end times) would be strong ground truth for **post-hoc re-attribution**, since you could align them against AssemblyAI timestamps after the call. They cannot drive live attribution. They also need Meet's built-in transcription to be on, which depends on the edition (see section 3).
- Polling participants with `latestEndTime IS NULL` gives a roster but not the speaker. The roster could narrow the candidate set for DOM-based attribution and catch join/leave changes. It cannot fix attribution errors between people who are present together.

### Gaps
- I found no documented latency for when a participant or participantSession record appears or updates through REST after a real join or leave.
- I found no documented field anywhere in the REST API for audio level, mute state, hand raise or active speaker. As far as the docs show, these data do not exist in this API.

## 2. Workspace Events API: Meet event types, delivery, latency, subscription lifetime, targets and payloads

### Takeaway
Meet has 14 v2 event types, including `participant.v2.joined` and `participant.v2.left`. They are delivered only to a Google Cloud Pub/Sub topic. The payload contains only a resource name, which you must look up through the REST API. Google says event generation can take "up to a few minutes." Meet subscriptions last at most 7 days and must be renewed. There is no speaking or active-speaker event.

### Cited Findings
- Event types and payloads:

  | Resource | Events | Payload |
  |---|---|---|
  | Conference | `google.workspace.meet.conference.v2.started`, `.ended` | `conferenceRecord` |
  | Participant | `google.workspace.meet.participant.v2.joined`, `.left` | `conferenceRecord.participantSession` |
  | Recording | `google.workspace.meet.recording.v2.started`, `.ended`, `.fileGenerated` | — |
  | Transcript | `google.workspace.meet.transcript.v2.started`, `.ended`, `.fileGenerated` | — |
  | Smart note | `google.workspace.meet.smartNote.v2.started`, `.ended`, `.fileGenerated` | — |

  Source: [Workspace Events: Meet events](https://developers.google.com/workspace/events/guides/events-meet)
- "Each payload contains only the resource's `name`." Full data has to be fetched through the Meet REST API. — [Workspace Events: Meet events](https://developers.google.com/workspace/events/guides/events-meet)
- `payloadOptions.includeResource` is "supported only for Google Chat and Google Drive events," so Meet events never include the resource data inline. — [Subscription reference](https://developers.google.com/workspace/events/reference/rest/v1/subscriptions); [Create subscription](https://developers.google.com/workspace/events/guides/create-subscription)
- Subscription targets:
  - A single meeting space: `//meet.googleapis.com/spaces/SPACE`.
  - A user: `//cloudidentity.googleapis.com/users/USER`, which "receives events about all meeting spaces where the user is the owner of the meeting space."
  - Source: [Workspace Events: Meet events](https://developers.google.com/workspace/events/guides/events-meet)
- **Restriction for non-owners:** "Calendar invitees and other participants invited to a conference can only receive the following events: `google.workspace.meet.conference.v2.started` and `google.workspace.meet.transcript.v2.fileGenerated`." This invitee access went GA on Nov 12, 2025. — [Workspace Events: Meet events](https://developers.google.com/workspace/events/guides/events-meet); [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- Delivery:
  - Events go only to a Pub/Sub topic `projects/{project}/topics/{topic}` in the same GCP project as the subscription.
  - The Meet publisher service account is `meet-api-event-push@system.gserviceaccount.com`.
  - The API uses ordering keys.
  - Push delivery is configured on the Pub/Sub subscription.
  - Source: [Create subscription](https://developers.google.com/workspace/events/guides/create-subscription); [Subscription reference](https://developers.google.com/workspace/events/reference/rest/v1/subscriptions)
- **Latency:** "It can take up to a few minutes for an event to generate a Pub/Sub message." — [Create subscription](https://developers.google.com/workspace/events/guides/create-subscription)
- Lifetime:
  - The `ttl` maximum is "If payloads omit resource data, up to 7 days." With resource data it is up to 4 hours, extendable to 24 hours with domain-wide delegation.
  - Meet payloads always omit resource data, so the maximum is 7 days.
  - Source: [Subscription reference](https://developers.google.com/workspace/events/reference/rest/v1/subscriptions)
- Renewal:
  - Renew by PATCHing `ttl` to `0s`, which sets the maximum expiration. The call returns a long-running operation.
  - Google says "don't rely on expiration reminder events" and recommends tracking `expireTime` yourself.
  - Source: [Update or renew subscription](https://developers.google.com/workspace/events/guides/update-subscription)
- Subscription states:
  - States are ACTIVE, SUSPENDED and DELETED.
  - Suspension reasons include `USER_SCOPE_REVOKED`, `RESOURCE_DELETED`, `ENDPOINT_PERMISSION_DENIED` and others. A suspended subscription is restored with the `reactivate` method.
  - Source: [Subscription reference](https://developers.google.com/workspace/events/reference/rest/v1/subscriptions)
- Authentication:
  - "User" targets support only user authentication.
  - Scopes are chosen per event type.
  - Source: [Create subscription](https://developers.google.com/workspace/events/guides/create-subscription)
- History:
  - Meet events went GA on Feb 15, 2024.
  - Workspace Events v1beta for Meet and Chat ended Apr 30, 2025, and users had to migrate to v1.
  - smartNote events went GA on Apr 2, 2026.
  - Source: [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)

### Inferences
- A join or leave event can arrive minutes after it happens, and it then needs a REST round trip to resolve the participantSession, then the participant, then the name. That makes the signal far too slow and coarse for speech attribution, which needs about 100 ms resolution. It is usable for roster maintenance. It could also mark a speaker label as stale after someone leaves.
- An extension user who is not the space owner gets no participant join/leave events at all. They get only conference started and transcript fileGenerated. Many users of a transcription extension join meetings they don't own, so the events path would not work for them. REST polling of participants may still work, because the participants guide says owners *or participants* can call get and list.

### Gaps
- Google publishes no p50 or p99 latency figure, only "up to a few minutes." I found no independent latency measurements in this session.

## 3. Auth: scopes, verification, editions, ownership, and external or non-owned meetings

### Takeaway
Reading conference and participant data needs `meetings.space.readonly`, which is a **sensitive** scope and requires Google's additional app verification. Fetching transcript or recording files from Drive needs **restricted** Drive scopes, which bring a restricted-scope verification and a security assessment if data is stored or transmitted server-side. Participants can read participant records. Owners get the full event stream, while invitees get only two event types. Google's docs do not say whether consumer Gmail accounts are supported.

### Cited Findings
- Scope sensitivity and verification requirements:

  | Scope | Sensitivity | Verification |
  |---|---|---|
  | `meetings.space.settings` | Non-sensitive | Basic |
  | `meetings.space.created` | Sensitive | Additional |
  | `meetings.space.readonly` | Sensitive | Additional |
  | `drive.readonly`, `drive.meet.readonly` | Restricted | Restricted-scope verification |

  Source: [Meet API auth guide](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)
- On restricted scopes: "If you store restricted scope data on servers (or transmit), then you must go through a security assessment." — [Meet API auth guide](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)
- `meetings.space.readonly` lets apps "read metadata about any meeting space the user has access to." "The app has the same permissions as that user." — [Meet API auth guide](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)
- Who can read records:
  - Meeting space owners or participants can call get and list on participants and participantSessions.
  - Anyone who is a meeting space owner or participant can retrieve transcript entries.
  - "Participant access to conference data" went GA on Feb 7, 2025.
  - Source: [Work with participants](https://developers.google.com/workspace/meet/api/guides/participants) (as summarized in search results); [Meet artifacts guide](https://developers.google.com/workspace/meet/api/guides/artifacts); [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- Artifacts go to the organizer's Drive. The organizer is "The user that created the meeting space." — [Meet REST API overview](https://developers.google.com/workspace/meet/api/guides/overview)
- Domain-wide delegation lets an admin authorize a service account without per-user consent. — [Meet API auth guide](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)
- Edition and account support:
  - The official overview and auth pages do not say which account types or Workspace editions are supported.
  - Secondary sources say recordings and transcripts need eligible Workspace editions, and that consumer @gmail.com meetings lack recording.
  - Sources: [Recall.ai guide](https://www.recall.ai/blog/how-to-get-a-recording-from-the-google-meet-api); [Composio guide](https://docs.composio.dev/kb/guide/toolkits-googlemeet). These are non-primary; treat with caution.

### Inferences
- A public Chrome Web Store extension requesting `meetings.space.readonly` would need Google OAuth verification for a sensitive scope. Adding Drive transcript access means a restricted-scope review plus a CASA security assessment if a backend touches the data. This is a substantial compliance cost.
- For meetings hosted in another organization, the user's access as a "participant" may let them list participants. Whether cross-org participant reads actually work was not confirmed in the docs I read.

### Gaps
- I could not confirm from primary docs whether personal Gmail accounts can call conferenceRecords and participants at all, or whether results are limited for them.
- I could not confirm cross-domain or external-meeting behavior for participant listing.
- I could not confirm the exact Workspace editions required for Meet transcripts and transcript entries.

## 4. Participant identity, and how it maps to DOM display names

### Takeaway
A participant has exactly one identity type:
- **signedinUser:** a stable `users/{id}` plus a `displayName` (first and last name, or a room device name).
- **anonymousUser:** the self-entered `displayName`.
- **phoneUser:** a partially redacted phone number as `displayName`.

These display names are probably the same strings Meet renders in its tiles, but no doc states that.

### Cited Findings
- signedinUser:
  - `user` is "users/{user}," interoperable with the Admin SDK and People API.
  - `displayName` is the first and last name for a personal device, or the admin-set device name for a robot or room account (for example, "Altostrat Room").
  - Source: [Participant reference](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants)
- anonymousUser: `displayName` is "the name the user provides when joining anonymously." — [Participant reference](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants)
- phoneUser: `displayName` is the phone number, partially redacted. — [Participant reference](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants)
- "For privacy reasons, profile information might not be available for all participants." — [Work with participants](https://developers.google.com/workspace/meet/api/guides/participants)
- Multiple devices: one participant can have multiple participantSessions, one per device and per rejoin. Companion-mode devices appear as signedinUser. — [Work with participants](https://developers.google.com/workspace/meet/api/guides/participants)

### Inferences
- Matching DOM tile names to `displayName` strings is plausible for signed-in and anonymous users. Edge cases include:
  - duplicate names
  - users signed in on two devices, including Companion mode, which shows as one participant with two sessions
  - room devices representing several people
  - the local user's tile showing "You"
  - phone users whose DOM label may differ from the redacted number
- The DOM does not expose the `users/{id}` key, so name matching would be heuristic.

### Gaps
- I found no documentation of DOM-to-API identity mapping, or of whether the Meet UI's display name exactly equals the API `displayName`. This would have to be tested empirically.

## 5. Quotas, pricing, limitations and GA/preview status (as of Nov 2026)

### Takeaway
The REST API v2 and Meet events have been GA since Feb 15, 2024. Standard use is free, with generous per-minute quotas, though overage charges are planned for later in 2026. The Meet Media API was Google's only real-time media and audio path. It was deprecated on Oct 28, 2026 and shuts down on Jan 15, 2027, so it is no longer a viable route to active-speaker data.

### Cited Findings
- Quotas:

  | Request type | Per project | Per user per project |
  |---|---|---|
  | Reads | 6,000/min | 600/min |
  | Writes | 1,000/min | 100/min |
  | `spaces.create` | 100/min | 10/min |

  There is no daily cap. Exceeding a quota returns HTTP 429; Google recommends exponential backoff. Source: [Meet API usage limits](https://developers.google.com/workspace/meet/api/guides/limits)
- Pricing: standard use has no extra cost. "Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026." — [Meet API usage limits](https://developers.google.com/workspace/meet/api/guides/limits)
- Status timeline:

  | Date | Change |
  |---|---|
  | Nov 2, 2023 | Meet API Developer Preview |
  | Feb 15, 2024 | v2 GA; Workspace Events Meet events GA |
  | Feb 7, 2025 | Participant access to conference data GA |
  | Apr 29, 2025 | Auto-recording, auto-transcript and auto-notes pre-configuration GA |
  | Apr 2, 2026 | smartNotes GA |
  | Apr 16, 2026 | `phoneAccess` and `gatewaySipAccess` GA |
  | Sep 11, 2026 | `spaces.members` (co-host management) GA |

  Release notes contain no active-speaker or real-time-speaker entries. Source: [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- **Meet Media API deprecated:**
  - It entered Developer Preview on Feb 24, 2025 to provide real-time media access, and was deprecated on Oct 28, 2026.
  - The notice says: "we have decided to wind down the Google Meet Media API and permanently turn down its endpoints on January 15, 2027."
  - The REST API and Add-ons SDK are unaffected.
  - Source: [Meet release notes](https://developers.google.com/workspace/meet/release-notes?hl=en)
- Other limits:
  - Meeting codes generally expire 365 days after last use.
  - One active conference per space.
  - Transcript entries are kept for 30 days.
  - Source: [Meet REST API overview](https://developers.google.com/workspace/meet/api/guides/overview)

### Inferences
- With the Media API going away, there is no official Google API path to real-time per-speaker audio or active-speaker data as of Nov 2026. DOM or tab-audio approaches, or third-party meeting bots, remain the only real-time options.

### Gaps
- The Media API overview pages returned 404 when fetched, likely removed after deprecation. I could not verify from primary docs its exact speaker-attribution mechanism, such as per-participant virtual audio streams or CSRC-to-participant mapping, or its enrollment requirements. Training-era recollection: it required all participants to be enrolled in the Developer Preview Program. This is unverified and moot given the shutdown.
- I found no exact date for when quota-overage billing takes effect.

## 6. Feasibility from a Chrome MV3 extension (chrome.identity) plus a backend Pub/Sub relay

### Takeaway
The setup is technically feasible, but it doesn't solve the speaker problem. An extension can get OAuth tokens and poll the REST API for the live roster. Events need a GCP Pub/Sub topic with a backend relay, for example push to a server and then WebSocket to the extension. Latency is minutes. Events cover only owner-owned spaces, with 7-day renewals, and verification is needed for sensitive or restricted scopes.

### Cited Findings
- Delivery is only to a Pub/Sub topic in the same GCP project as the subscription. Apps Script cannot be a push endpoint, so a backend is needed to relay events to clients. — [Create subscription](https://developers.google.com/workspace/events/guides/create-subscription); [Subscription reference](https://developers.google.com/workspace/events/reference/rest/v1/subscriptions)
- Subscriptions expire after at most 7 days for Meet and need active renewal. — [Subscription reference](https://developers.google.com/workspace/events/reference/rest/v1/subscriptions); [Update or renew subscription](https://developers.google.com/workspace/events/guides/update-subscription)
- Event latency can be "up to a few minutes." — [Create subscription](https://developers.google.com/workspace/events/guides/create-subscription)
- User-target subscriptions only cover spaces the user owns. Invitees get only conference started and transcript fileGenerated. — [Workspace Events: Meet events](https://developers.google.com/workspace/events/guides/events-meet)
- The read quota of 600/min per user per project allows polling the participants list about every few seconds, well within limits. — [Meet API usage limits](https://developers.google.com/workspace/meet/api/guides/limits)

### Inferences
- **Practical hybrid design:**
  - Poll `conferenceRecords.participants` with `latestEndTime IS NULL`, every 5–15 s, using the chrome.identity token, to maintain an authoritative roster and help DOM name normalization.
  - Optionally, after the meeting, pull Meet transcript entries (participant plus start and end times) to re-attribute AssemblyAI segments by time overlap. This only works if Meet transcription was on and the user is owner or participant, and it requires the edition support and scope verification above.
  - Neither step provides live active-speaker data.
- To resolve the conferenceRecord for the current tab, the extension can derive the meeting code from the URL and call `spaces.get` (meeting codes work as aliases), then list conferenceRecords filtered by space. This is plausible from the docs but untested here.
- For real-time "who is speaking," the realistic options are still client-side:
  - improved DOM speaking-indicator scraping
  - per-participant audio levels from the WebRTC stats or media tracks visible in the tab, if accessible to a content script
  - acoustic diarization (for example AssemblyAI speaker labels) fused with roster names

  These are outside the scope of this note, and their feasibility is not verified here.

### Gaps
- I did not verify the chrome.identity `getAuthToken` versus `launchWebAuthFlow` details for these scopes, or whether Google allows sensitive Meet scopes for Chrome extension OAuth clients, in this session.
- I did not verify whether conferenceRecords filtered by space works for non-owner participants in real time.
