const Meeting = require('../models/meeting');
const { generateSalesCallInsight } = require('../services/assembly.service');
const { formatTranscript, isMostlyNonEnglish, computeSpeakerStats, spokenTurns } = require('../utils/transcript');

const LIST_ATTRIBUTES = ['meeting_id', 'title', 'meet_code', 'started_at', 'ended_at', 'duration_ms', 'participants', 'status', 'insight', 'createdAt'];

const toListItem = (m) => ({
    id: m.meeting_id,
    title: m.title,
    meetCode: m.meet_code,
    startedAt: m.started_at,
    endedAt: m.ended_at,
    durationMs: m.duration_ms,
    participants: m.participants || [],
    status: m.status,
    outcome: m.insight?.outcome || null,
    overallScore: m.insight?.overallScore ?? null,
    createdAt: m.createdAt,
});

const toDetail = (m) => ({
    ...toListItem(m),
    transcript: m.transcript || [],
    speakerStats: m.speaker_stats || [],
    insight: m.insight || null,
    model: m.model,
    error: m.error,
});

const analyze = async (meeting) => {
    try {
        await meeting.update({ status: 'processing', error: null });
        const { model, insight } = await generateSalesCallInsight(formatTranscript(meeting.transcript));
        await meeting.update({ insight, model, status: 'ready' });
        return true;
    } catch (e) {
        console.error('Error (meetings.controller -> analyze): ', e);
        await meeting.update({ status: 'failed', error: e.message });
        return false;
    }
};

const createMeetingController = async (req, res) => {
    const { meetCode, title, startedAt, endedAt, participants, transcript } = req.body;

    const transcriptText = formatTranscript(transcript);
    if (transcriptText.trim().length < 5) {
        return res.status(400).send({ success: false, message: 'The transcript is empty. Make sure captions were captured during the meeting.' });
    }
    if (isMostlyNonEnglish(transcriptText)) {
        return res.status(400).send({ success: false, message: 'Only English transcripts are accepted for meeting insight evaluation.' });
    }

    const turns = spokenTurns(transcript);
    const firstMs = turns.find((t) => Number.isFinite(t.startMs))?.startMs;
    const lastMs = [...turns].reverse().find((t) => Number.isFinite(t.endMs))?.endMs;
    const start = startedAt ? new Date(startedAt) : (firstMs ? new Date(firstMs) : new Date());
    const end = endedAt ? new Date(endedAt) : (lastMs ? new Date(lastMs) : new Date());
    const speakerNames = [...new Set(turns.map((t) => t.speaker).filter(Boolean))];

    const meeting = await Meeting.create({
        user_id: req.user.userId,
        meet_code: meetCode || null,
        title: title || (meetCode ? `Meeting ${meetCode}` : 'Google Meet call'),
        started_at: start,
        ended_at: end,
        duration_ms: Math.max(0, end - start),
        participants: [...new Set([...(participants || []), ...speakerNames])],
        transcript,
        speaker_stats: computeSpeakerStats(transcript),
        status: 'processing',
    });

    const ok = await analyze(meeting);
    if (!ok) {
        return res.status(502).send({
            success: false,
            message: 'The meeting was saved but the analysis failed. You can retry from the dashboard.',
            data: { id: meeting.meeting_id, status: 'failed' },
        });
    }
    return res.status(201).send({ success: true, data: { id: meeting.meeting_id, status: 'ready' } });
};

const findOwned = (req) => Meeting.findOne({ where: { meeting_id: req.params.id, user_id: req.user.userId } });

const retryMeetingController = async (req, res) => {
    const meeting = await findOwned(req);
    if (!meeting) return res.status(404).send({ success: false, message: 'Meeting not found' });
    const ok = await analyze(meeting);
    if (!ok) return res.status(502).send({ success: false, message: meeting.error || 'Analysis failed' });
    return res.send({ success: true, data: toDetail(meeting) });
};

const listMeetingsController = async (req, res) => {
    const meetings = await Meeting.findAll({
        where: { user_id: req.user.userId },
        attributes: LIST_ATTRIBUTES,
        order: [['started_at', 'DESC']],
        limit: 200,
    });
    return res.send({ success: true, data: meetings.map(toListItem) });
};

const getMeetingController = async (req, res) => {
    const meeting = await findOwned(req);
    if (!meeting) return res.status(404).send({ success: false, message: 'Meeting not found' });
    return res.send({ success: true, data: toDetail(meeting) });
};

const deleteMeetingController = async (req, res) => {
    const count = await Meeting.destroy({ where: { meeting_id: req.params.id, user_id: req.user.userId } });
    if (!count) return res.status(404).send({ success: false, message: 'Meeting not found' });
    return res.send({ success: true });
};

module.exports = {
    createMeetingController,
    retryMeetingController,
    listMeetingsController,
    getMeetingController,
    deleteMeetingController,
};
