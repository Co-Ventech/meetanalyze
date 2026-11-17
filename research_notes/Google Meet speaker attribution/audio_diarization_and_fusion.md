# Audio-side speaker diarization for real-time meeting transcription, and fusion with external speaker-activity signals

Research date: 2026-11-13. Context: Chrome extension (offscreen document) streams mixed Google Meet tab audio (remote participants) plus a separate local mic stream to AssemblyAI Streaming v3 and maps turns to names using Meet DOM active-speaker intervals.

## Q1. AssemblyAI Universal-Streaming v3: diarization / speaker labels, multichannel, word timestamps, turn detection, async correction pass

### Takeaway
As of November 2026, AssemblyAI Streaming v3 supports real-time diarization on all streaming models (`speaker_labels: true`, `max_speakers` 1-10). It returns per-turn and per-word speaker labels, a `PENDING` label, an uncalibrated `speaker_confidence`, and retroactive `SpeakerRevision` messages. AssemblyAI marks the feature as beta. Multichannel streaming means one WebSocket session per channel. Name-based "Speaker Identification" is offered only as a pre-recorded Speech Understanding add-on, not in streaming.

### Cited Findings
**Streaming diarization: parameters and output**
- Diarization works on all streaming models (`universal-3-6-pro`, `universal-streaming-english`, `universal-streaming-multilingual`). You enable it with `speaker_labels: true` and no model change is needed. — [AssemblyAI docs: Streaming Diarization and Multichannel](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- `max_speakers` takes an integer from 1 to 10 and is "a hard limit, not a hint": extra speakers are merged into the closest existing label. The docs advise setting it slightly above the expected count, because a value set too high can cause over-splitting. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- Per-turn output has two fields. `speaker_label` is the dominant speaker for the turn, and `speaker_confidence` scores how clearly the turn matched that speaker. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- Per-word output: each final word (`word_is_final: true`) in `words` has a `speaker` field, which allows speaker changes to be detected mid-turn. Non-final words never carry it, and the field is omitted rather than set to null. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- Word-level speaker labels (instead of inheriting the turn's label) arrived in a streaming diarization upgrade published 4 May 2026. — [AssemblyAI blog: streaming diarization major upgrade](https://assemblyai.com/blog/streaming-diarization-major-upgrade)
- `PENDING` is returned when a turn has less than about 1 s of audio, or when a word can't be confidently attributed (often short backchannels such as "yeah"). About 1 s of audio is needed for a reliable embedding. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- `speaker_confidence` is experimental and uncalibrated (0-1). It is useful only for relative comparison, not as an absolute threshold. A turn-level 0.0 means "not available". — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)

**Label stability and revisions**
- Accuracy improves as the session builds speaker profiles. The first 1-2 turns may be misassigned, and early turns may be reassigned. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- At session end, a refinement pass sends a `SpeakerRevision` message that contains only the turns whose labels changed. Text and timestamps never change. The pass adds about 400 ms at session end. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- `speaker_labels_revision_interval_ms` turns on mid-session revisions. Its minimum is 120000 ms (lower values are raised), the recommended value is 300000 ms, and 0 or unset means end-of-session revision only. Revisions are deltas: apply them in arrival order, with the last write per `turn_order` winning. `SpeakerRevision` carries no confidence values. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)

**Documented limitations (the docs label the feature "beta")**
- Short utterances under about 1 s get `PENDING`.
- Overlapping speech is assigned to one speaker.
- Turns at the start of a session may be misassigned.
- Background noise and mic bleed reduce accuracy.
- The docs advise letting each speaker produce "a few complete sentences" before relying on per-turn labels.
- Source for all five points: [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)

**Accuracy figures (all vendor-reported)**
- AssemblyAI's 4 May 2026 upgrade, compared with its previous diarization model:
  - 66% fewer false-alarm speakers
  - 60% lower phantom-turn rate
  - 12% relative cpWER improvement overall, and 24% on 2-speaker audio
- The same post compares Universal-Streaming with Deepgram Nova-3: 51% fewer false-alarm speakers, 80% fewer phantom turns, and 11% better cpWER on average.
- The post gives no DER figures and no latency figures.
- Source: [AssemblyAI blog](https://assemblyai.com/blog/streaming-diarization-major-upgrade)
- An independent-of-AssemblyAI but competitor-run benchmark (pyannote, published 5 Nov 2026, DIHARD III, no overlap exclusion) found the following. — [pyannote blog: streaming diarization benchmark](https://www.pyannote.ai/blog/streaming-diarization-benchmark)
  - AssemblyAI v3 streaming DER: 39.2% (false alarm 6.9%, missed 20.4%, confusion 11.8%)
  - Meeting-domain DER for the non-pyannote vendors: 58.1-67.0%

**Multichannel**
- For multichannel streaming, AssemblyAI says to create a separate streaming session per channel, which keeps speakers separated. — [AssemblyAI docs](https://www.assemblyai.com/docs/streaming/diarization-and-multichannel.md)
- AssemblyAI's meeting-notetaker guide gives these recommendations:
  - For live multichannel audio, open one streaming session per channel and label each session with its speaker name.
  - For pre-recorded audio with per-participant channels, use `multichannel=True` with `speaker_labels=False`, because channels already separate speakers.
  - Source: [AssemblyAI meeting notetaker best practices](https://www.assemblyai.com/docs/meeting-notetaker-best-practices.md)

**Turn detection for meetings**
- The notetaker guide recommends `format_turns: true` and longer endpointing than voice agents use: example `min_turn_silence` 560 ms and `max_turn_silence` 2000 ms, against model defaults of 100 ms and 1000 ms. — [AssemblyAI meeting notetaker best practices](https://www.assemblyai.com/docs/meeting-notetaker-best-practices.md)

**Async post-call correction and speaker identification**
- The guide recommends a hybrid: stream during the meeting for live captions, then upload the full recording to the pre-recorded API afterwards for a more accurate transcript with speaker names. It suggests webhooks for the result. — [AssemblyAI meeting notetaker best practices](https://www.assemblyai.com/docs/meeting-notetaker-best-practices.md)
- Pre-recorded diarization takes `min_speakers_expected` / `max_speakers_expected`. Use `speakers_expected` only when the exact headcount is known. — [AssemblyAI meeting notetaker best practices](https://www.assemblyai.com/docs/meeting-notetaker-best-practices.md)
- Speaker Identification needs diarization turned on first. You pass participant names as `known_values` with `speaker_type: "name"` (or `"role"`). Names can come from the meeting platform or calendar. If names arrive later, send the `transcript_id` to the Speech Understanding endpoint to identify speakers after the fact. — [AssemblyAI meeting notetaker best practices](https://www.assemblyai.com/docs/meeting-notetaker-best-practices.md)

**Pricing (page last updated 2026-11-10)**
| Item | Price |
|---|---|
| Universal-3.6 Pro Realtime, streaming base | $0.45/hr |
| Universal-Streaming English / Multilingual, streaming base | $0.15/hr |
| Streaming diarization add-on | +$0.12/hr, whole session |
| Async diarization, standard | +$0.02/hr |
| Async diarization, experimental | +$0.065/hr |
| Speaker Identification (pre-recorded) | +$0.02/hr |
| Multichannel | Billed per channel |

Source: [AssemblyAI pricing](https://www.assemblyai.com/pricing.md)

### Inferences
- **Mic stream.** The product's current architecture already matches AssemblyAI's documented multichannel pattern (one session for the mic, one for the tab). The mic session should run with `speaker_labels: false` and be attributed to the local user directly. Diarization is only needed on the tab-audio session.
- **Tab session settings.** Set `max_speakers` from the Meet participant count (minus the local user) plus 1, capped at 10. Too low merges distinct people; too high over-splits.
- **Short turns.** Meetings have many short backchannels, and those will come back as `PENDING`. They should fall back to the DOM active-speaker signal.
- **Revisions.** Because `SpeakerRevision` arrives later, the transcript store must be keyed by `turn_order` and support retroactive relabelling. That makes the mid-session revision interval (300 s) worth enabling.
- **Accuracy expectations.** pyannote's benchmark (DIHARD III meeting domain, roughly 58-67% DER for non-pyannote vendors) suggests AssemblyAI's streaming diarization alone will be unreliable for multi-person meetings. It should be treated as one noisy signal to fuse, not ground truth.
- **Post-call correction.** A post-call async re-run is the cheapest accuracy boost: +$0.02/hr diarization plus +$0.02/hr Speaker Identification on top of async base pricing. However, `known_values` speaker identification works from transcript content, not voiceprints. That is an inference from the parameter design; AssemblyAI does not document the internal mechanism here, so it cannot be assumed to bind names to voices.

### Gaps
- No AssemblyAI-published DER or latency figure for streaming diarization was found.
- I did not confirm whether label assignment adds latency to Turn events. The docs say only that the end-of-session refinement takes about 400 ms.
- Whether Speaker Identification can run on streaming sessions was not found. The pricing page lists it as pre-recorded only.
- The docs did not state the exact date the feature entered beta, nor any GA plan.

## Q2. Alternative real-time diarization providers: features, quality, latency, pricing

### Takeaway
Streaming diarization exists at Deepgram, Speechmatics, Azure (ConversationTranscriber), pyannoteAI (Streaming Diarization GA, Nov 2026), and open-source tools (diart, NVIDIA Streaming Sortformer). It is not available for Google Chirp 3 streaming (batch only). Gladia's real-time diarization is unclear or conflicting. The only cross-vendor streaming DER benchmark found was run by pyannote, a competitor. On DIHARD III it ranked pyannote 19.8%, Speechmatics 31.3%, Deepgram 39.1%, and AssemblyAI 39.2%.

### Cited Findings
**Cross-vendor benchmark (pyannote-run, 5 Nov 2026, DIHARD III, 11 domains)** — [pyannote blog](https://www.pyannote.ai/blog/streaming-diarization-benchmark)

| System | DER | False alarm | Missed speech | Speaker confusion |
|---|---|---|---|---|
| pyannote | 19.8% | 4.8% | 7.7% | 7.3% |
| Speechmatics RT v2 | 31.3% | 6.2% | 19.7% | 5.5% |
| Deepgram Nova 3 | 39.1% | 4.6% | 25.3% | 9.3% |
| AssemblyAI v3 | 39.2% | 6.9% | 20.4% | 11.8% |

- Meeting-domain DER: pyannote 44.6% against 58.1-67.0% for the other vendors.
- Latency was not measured.
- The page has internal inconsistencies:
  - It claims "close to half" the nearest system's error, but 19.8 vs 31.3 is about 63%.
  - Its webvideo figures are inconsistent between the text and the table.
- The page says pyannote Streaming Diarization is "now available in General Availability". No price is given on the page.

**Deepgram**
- In streaming, diarization returns a speaker number per word starting at 0. The streaming reference lists `v1` and `latest` as diarize model values and says specifying that parameter enables diarization, so `diarize=true` is not also needed. — [Deepgram listen-streaming reference (via search snippet)](https://developers.deepgram.com/reference/speech-to-text-api/listen-streaming)
- Streaming output lacks `speaker_confidence`, and only the v1 diarizer is available in streaming. Batch output has per-word speaker confidence. — [Deepgram blog on speaker labels](https://deepgram.com/learn/speaker-labels-stt-output-formats-configuration-accuracy) (from a search summary; the direct docs fetch failed)
- Deepgram's guidance:
  - A wrong exact speaker count can hurt more than giving no hint.
  - For fixed two-party audio, use multichannel instead of diarization.
  - Source: [Deepgram blog](https://deepgram.com/learn/speaker-labels-stt-output-formats-configuration-accuracy)
- Pricing: third-party sources put the streaming diarization add-on at about $0.002/min (about $0.12/hr). Base Nova-3 streaming is quoted inconsistently, roughly $0.0048-0.0092/min, and some quotes are promotional. — [Deepgram pricing](https://deepgram.com/pricing); [brasstranscripts](https://brasstranscripts.com/blog/deepgram-pricing-per-minute-2025-real-time-vs-batch). These figures were not verified on the official page.

**Speechmatics (real-time)**
- Diarization modes are `speaker`, `channel`, and `channel_and_speaker`. Labels are `S1`, `S2`, and so on, with `UU` for unidentifiable speech. — [Speechmatics realtime diarization docs](https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization)
- `speaker_diarization_config` has three settings — [Speechmatics realtime diarization docs](https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization)
  - `speaker_sensitivity`: 0-1, default 0.5
  - `prefer_current_speaker`: default false
  - `max_speakers`: 2 or more, no limit by default
- An internal beta docs page says the default `max_speakers` is 20, which conflicts with the public page. — [Speechmatics beta docs](https://docs-beta.internal.speechmatics.com/features/diarization/speaker-diarization)
- Speaker labels are corrected at sentence boundaries, which requires punctuation. — [Speechmatics docs](https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization)
- In SaaS, `channel` / `channel_and_speaker` modes allow at most 2 channels, sent via `AddChannelAudio`. — [Speechmatics docs](https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization)
- The `max_delay` setting ranges from 0.7 to 4.0 s; lower values trade accuracy for latency. — [LiveKit Speechmatics plugin docs](https://docs.livekit.io/reference/python/v1/livekit/plugins/speechmatics/index.html)
- Real-time **speaker identification** (enrollment) works as follows — [Speechmatics realtime speaker identification](https://docs.speechmatics.com/speech-to-text/realtime/speaker-identification); changelog dated [15 Oct 2025](https://speechmatics.featurebase.app/changelog/20251015-real-time-saas)
  - Get identifiers either with a `GetSpeakers` message or with `get_speakers: true`. They come back in a `SpeakersResult` that lists each label with its `speaker_identifiers`.
  - In later sessions, pass `speakers: [{label: "Alice", speaker_identifiers: [...]}]`. Matching speech is tagged with the enrolled name; other speakers get `S1` and so on.
  - `max_speakers` counts only the non-enrolled speakers.
  - It is not supported on the Melia 1 or Oak 1 models.

**Azure AI Speech (ConversationTranscriber real-time diarization)**
- Speakers are labelled `Guest-1`, `Guest-2`, and so on.
- `SpeechServiceResponse_DiarizeIntermediateResults=true` is needed for speaker IDs on intermediate results; without it they are `Unknown`.
- The REST API for short audio does not support real-time diarization.
- Page last updated 2026-06-05.
- Source: [Azure quickstart: real-time diarization](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-stt-diarization)
- The Japanese version of the quickstart is titled "(preview)". It says the service works best with 7 s or more of continuous speech from one speaker; otherwise the speaker is "Unknown". — [Azure quickstart (ja-jp)](https://learn.microsoft.com/ja-jp/azure/ai-services/speech-service/get-started-stt-diarization)
- A Microsoft Q&A answer (community/moderator, not official docs) makes two points. — [Microsoft Q&A](https://learn.microsoft.com/en-gb/answers/questions/2100982/can-i-set-maximum-number-of-participants-to-real-t)
  - Real-time diarization has no fixed speaker limit and no max-speaker setting; a maximum can only be set in batch.
  - Real-time diarization does not use voice signatures, and Azure speaker recognition is being retired.
- I did not retrieve the exact retirement date.

**Google Cloud Speech-to-Text v2 (Chirp)**
- Chirp 3 diarization is "available only in BatchRecognize" according to the model page; another Google page says BatchRecognize and Recognize. — [Chirp 3 docs](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3)
- Chirp 2 has no diarization. — [Chirp 2 docs](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-2?hl=en)
- So streaming diarization is not available on Chirp.

**Gladia**
- The sources conflict:
  - Gladia's product page describes diarization as async, run in the same async request as transcription. — [Gladia diarization page](https://www.gladia.io/product/audio-intelligence/speaker-diarization)
  - A Gladia blog post (21 Aug 2026) calls diarization "async-only" (Solaria-3, powered by pyannoteAI Precision-2) and cites Solaria-1 for real-time STT, without stating that real-time diarization is supported. — [Gladia blog: speaker re-identification](https://www.gladia.io/blog/speaker-re-identification-across-recurring-meetings)
  - Speechmatics (a competitor) says Gladia has no real-time diarization. — [Speechmatics vs Gladia](https://speechmatics.com/how-we-compare/gladia-alternative)
  - A different Gladia blog post claims Solaria-1 has "bundled diarization" at 103 ms partial latency. — [Gladia blog](https://www.gladia.io/blog/best-real-time-stt-models-for-meeting-assistants-2026)

**NVIDIA Streaming Sortformer (open weights)**
- Checkpoints are `diar_streaming_sortformer_4spk-v2` and others. It supports up to 4 speakers ("unable to produce more than four outputs"), is optimised for English, and runs via NeMo / Riva NIM. Original post 18 Aug 2025.
- A September 2026 update names Nemotron 3 Diarization, which supports up to 8 speakers.
- Source: [NVIDIA blog](https://developer.nvidia.com/blog/identify-speakers-in-meetings-calls-and-voice-apps-in-real-time-with-nvidia-streaming-sortformer)
- The paper reports latency as input-buffer delay only, excluding computation time. — [arXiv 2507.18446](https://arxiv.org/pdf/2507.18446)
- Reported results vary widely by setup:
  - NeMo Curator docs: streaming CallHome-eng0 DER 6.2% (macro) at a 0.25 s collar. The default `chunk_len=340` is about 30.4 s latency. — [NeMo Curator docs](https://docs.nvidia.com/nemo/curator/latest/curate-audio/process-data/quality-filtering/speaker-separation)
  - A third party reports 31.7% DER on AMI SDM at the 30.4 s configuration. — [FluidInference docs](https://docs.fluidinference.com/diarization/sortformer)

**diart (open source, pyannote-based)**
- Implements Coria et al. (ASRU 2021) online diarization with latency adjustable from 500 ms to 5 s. — [diart on PyPI](https://pypi.org/project/diart/0.8.0/)
- A 2024 latency evaluation found the lowest latency with diart using pyannote/embedding and pyannote/segmentation. — [arXiv 2407.04293](https://fugumt.com/fugumt/paper_check/2407.04293v1_enmode)
- On AMI, a related online system found that longer latency reduces false alarm and confusion but increases missed detection. — [arXiv 2402.00067](https://arxiv.org/pdf/2402.00067)

### Inferences
- Speechmatics is the only provider found with documented **real-time** voice enrollment (known speakers by name), which maps directly onto "which voice is which Meet participant". Its per-session channel limit is 2 in SaaS, which happens to fit a tab-plus-mic design.
- Running diart or Sortformer means sending audio to a server-side GPU; neither is practical inside a Chrome extension. Sortformer's 4-speaker cap (8 for Nemotron 3) also limits larger meetings.
- No provider's streaming diarization reaches low DER on meeting-domain audio (all vendors are above 44% in the pyannote DIHARD meeting subset). Fusion with DOM signals therefore matters more than switching vendors.

### Gaps
- **Rev.ai streaming diarization:** no source found in this pass. Its status is unverified.
- **Latency:** no vendor-independent latency measurements for streaming diarization.
- **Pricing:** pyannote streaming pricing and Speechmatics real-time diarization pricing were not found.
- **Gladia:** real-time diarization status is unresolved.
- **Azure:** speaker recognition retirement date not retrieved.

## Q3. Fusing anonymous diarization clusters with name signals (active-speaker timelines, captions); architecture best practice

### Takeaway
The industry pattern, documented by Recall.ai and AssemblyAI, is hybrid:
- Per-source streams are attributed directly by channel.
- On a mixed stream, platform speaker-timeline signals are matched against transcript words, and machine diarization separates voices where timelines fail (overlap, shared devices).
- A post-call re-diarization pass corrects labels retroactively.

The standard tool for mapping anonymous clusters to identities is a 1:1 assignment solved with the Hungarian algorithm over an overlap matrix, as used in DER scoring and in DOVER-Lap.

### Cited Findings
- **How timeline diarization works.** Recall.ai's "speaker timeline" diarization matches transcribed words to the active-speaker time ranges from the meeting platform. — [Recall.ai blog (25 Mar 2026, updated 3 Nov 2026)](https://www.recall.ai/blog/speaker-diarization); [Recall docs: speaker timeline](https://docs.recall.ai/docs/speaker-timeline)
- **Where timelines fail.** Timeline attribution breaks when multiple people share one device, and during overlap, because "the active speaker tag often remains assigned to just one speaker". — [Recall.ai blog](https://www.recall.ai/blog/speaker-diarization)
- **Hybrid diarization.** Recall's "hybrid" mode attributes speech on separate audio streams directly to named participants and uses machine diarization to separate voices on shared streams. The article does not explain how disagreements between the two signals are resolved. — [Recall.ai blog](https://www.recall.ai/blog/speaker-diarization)
- **Google Meet active-speaker signals** — [Recall.ai blog](https://www.recall.ai/blog/speaker-diarization)
  - Meet has no direct active-speaker event.
  - Post-meeting, `conferenceRecords.transcripts.entries` can attribute segments to participants, but only if native transcription was enabled.
  - For real time, Recall describes inferring the speaker from RTP audio levels across SSRC/CSRC.
  - The Meet Media API that supports this is being shut down on 15 Jan 2027.
- **Meet DOM indicator caveats** (Vexa, third party) — [Vexa docs](https://docs.vexa.ai/speaker-identification)
  - Speaker detection works when there are 3 or more participants (the speaking indicator appears in the speaker bar).
  - During screen sharing, indicators may be hidden or reduced.
- **Hungarian mapping in DER scoring.** System labels need not match reference names, so DER scoring finds a 1:1 cluster-to-speaker mapping with the Hungarian method on a bipartite graph, then counts the remaining speaker error. — [arXiv 2407.08752](https://arxiv.org/pdf/2407.08752); [medkit docs](https://medkit.readthedocs.io/en/stable/reference/api/medkit/audio/metrics/diarization/index.html)
- **Hungarian mapping in DOVER-Lap.** DOVER used pairwise linear-sum assignment (Hungarian) for label mapping between systems. DOVER-Lap reframes the problem as graph partitioning, with a polynomial-time Hungarian-based variant. — [arXiv 2104.01954](https://arxiv.org/pdf/2104.01954)
- **AssemblyAI's guidance for named per-channel streams.** Open one streaming session per channel and label each session with the speaker's name. — [AssemblyAI meeting notetaker best practices](https://www.assemblyai.com/docs/meeting-notetaker-best-practices.md)
- **Deepgram's guidance for fixed parties.** Multichannel separation is preferable to diarization for fixed two-party audio. — [Deepgram blog](https://deepgram.com/learn/speaker-labels-stt-output-formats-configuration-accuracy)

### Inferences (proposed design; not taken from any single source)
1. **Channelise first.**
   - The mic session is attributed to the local user with no diarization.
   - The tab session runs diarization, with `max_speakers` set to the remote participant count plus 1.
   - Remove mic-to-tab echo or bleed where possible, because AssemblyAI documents that bleed degrades diarization.
2. **Overlap matrix.** For the tab stream, keep a running matrix `O[c][p]` = seconds of final words labelled cluster c that overlap DOM active-speaker intervals of participant p.
   - Shift DOM intervals by an estimated lag before computing overlap. The Meet UI indicator lags audio; calibrate the offset by cross-correlating the DOM speaking timeline with word timestamps.
   - Weight each contribution by word duration.
   - Ignore spans where more than one participant is marked speaking, as well as `PENDING` words.
3. **Hungarian assignment.** Solve a Hungarian (linear-sum) assignment on `-O` to get a 1:1 cluster-to-name map. Add dummy "unknown" rows and columns so extra clusters or silent participants are allowed.
4. **Accept or reject each mapping.** Accept a mapping only when both hold:
   - support is at least N seconds (for example 10-20 s);
   - margin is at least a set amount (for example 60%), where margin = the best name's share of the cluster's overlap minus the second-best share.
   Otherwise, fall back to per-turn DOM attribution.
5. **Per-turn arbitration.**
   - If the cluster has a confident mapping and the DOM interval agrees or is absent, use the cluster's name.
   - If the DOM shows exactly one speaker with high coverage of the turn and the cluster mapping is weak, use the DOM.
   - Use per-word `speaker` to split turns at mid-turn speaker changes.
   - Because `speaker_confidence` is uncalibrated, use it only to rank, not to threshold.
6. **Retroactive relabel.**
   - Recompute the assignment whenever a `SpeakerRevision` arrives (mid-session every 300 s, and at session end).
   - After the call, run async diarization (and optionally AssemblyAI Speaker Identification with participant names as `known_values`).
   - Re-run the same overlap and Hungarian mapping on the higher-quality clusters, then rewrite stored turn labels.
7. **Captions as an extra vote.** Meet's own captions carry speaker names. Text-aligning caption segments to ASR words (by fuzzy string match plus time) gives a second name-bearing timeline that can be added to `O` with its own weight. This rests on general knowledge of Meet captions and was not verified in this pass.
8. **Voice enrollment for cross-turn consistency.**
   - Once a cluster-to-name mapping is confident, its audio could be used to enrol a voiceprint: Speechmatics `GetSpeakers` in real time, or cosine-matched embeddings.
   - Gladia's blog suggests cosine thresholds that are model-specific: about 0.6-0.75 typical, 0.25 for the MATLAB ECAPA model. It also suggests at least 1 s segments, centroid updates only on high-confidence matches, and multiple consecutive matches before accepting. — [Gladia blog](https://www.gladia.io/blog/speaker-re-identification-across-recurring-meetings)

### Gaps
- No peer-reviewed paper was found that specifically fuses web-conference UI active-speaker signals with audio diarization clusters. The design above is inference from scoring and system-combination practice.
- No measured figure was found for the lag between Meet's DOM active-speaker indicator and the audio.
- Recall.ai's blog and its docs conflict on Google Meet speaker-timeline support. The blog says there is no direct event; the docs list Meet as supported.

## Q4. Speaker identification with voice enrollment

### Takeaway
Among the providers checked, Speechmatics is the clearest documented real-time option for enrolled-voice identification. AssemblyAI's Speaker Identification is a pre-recorded add-on that assigns supplied names or roles to diarized speakers, not documented voiceprint enrollment. Azure's real-time diarization does not use voice signatures, and Azure speaker recognition is being retired. A do-it-yourself path is possible with embedding models (pyannote, ECAPA/TitaNet) and cosine matching.

### Cited Findings
- **Speechmatics real-time:** enrol via `GetSpeakers` / `get_speakers`, then pass `speakers` with `speaker_identifiers`. Unmatched speakers get `S#`. Not supported on Melia 1 or Oak 1. Launched for real-time SaaS 15 Oct 2025. — [Speechmatics docs](https://docs.speechmatics.com/speech-to-text/realtime/speaker-identification); [changelog](https://speechmatics.featurebase.app/changelog/20251015-real-time-saas)
- **Speechmatics claim:** providing speaker identifiers "can also increase the accuracy of our diarization system". — [Speechmatics speaker identification](https://docs.speechmatics.com/speech-to-text/features/speaker-identification)
- **AssemblyAI Speaker Identification:** you supply `known_values` with `speaker_type` set to `name` or `role`. It requires diarization, can be applied afterwards via `transcript_id`, costs +$0.02/hr, and is listed as pre-recorded. Accuracy improves with distinct voices, more speech per speaker, and fewer speakers. — [AssemblyAI notetaker guide](https://www.assemblyai.com/docs/meeting-notetaker-best-practices.md); [AssemblyAI pricing](https://www.assemblyai.com/pricing.md)
- **AssemblyAI TitaNet guide:** AssemblyAI also publishes a guide on speaker identification with NVIDIA TitaNet embeddings for pre-recorded audio (a DIY embedding approach). — [AssemblyAI TitaNet guide](https://www.assemblyai.com/docs/pre-recorded-audio/guides/titanet-speaker-identification.md). Contents not fetched.
- **Azure:** real-time diarization gives generic Guest-N IDs with no voice signatures. The same Microsoft Q&A reply says speaker recognition is being retired. — [Microsoft Q&A](https://learn.microsoft.com/en-gb/answers/questions/2100982/can-i-set-maximum-number-of-participants-to-real-t)
- **Embedding-based re-identification practice:** see the thresholds and procedures in Q3 inference 8. — [Gladia blog](https://www.gladia.io/blog/speaker-re-identification-across-recurring-meetings)

### Inferences
- In a Meet extension, enrollment can be bootstrapped automatically. Segments where the DOM shows exactly one remote speaker for 3 s or more, with high overlap, are near-labelled training data per participant. That supports per-meeting voiceprints with no user effort, and cross-meeting voiceprints if consent and storage policy allow.
- If the product stays on AssemblyAI, enrollment would have to be DIY (server-side embeddings on the tab audio) or happen post-call. AssemblyAI streaming exposes no enrollment API in the docs reviewed.

### Gaps
- No information found on: pyannoteAI voiceprint or identification API details and pricing; Speechmatics identification pricing; Picovoice Eagle accuracy.
- The exact Azure speaker recognition retirement date was not retrieved.
