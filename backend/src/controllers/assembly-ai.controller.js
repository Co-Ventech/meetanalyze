const { getTemporaryToken, generateSalesCallInsight } = require('../services/assembly.service');
const { generateMeetingDoc } = require('../utils/doc-generator');

const getTokenController = async (req, res) => {
    try {
        const result = await getTemporaryToken(480);
        const token = typeof result === 'object' ? result.token : result;
        const host = typeof result === 'object' ? result.host : 'streaming.assemblyai.com';
        return res.status(200).send({
            success: true,
            token,
            host,
        });
    } catch (e) {
        console.error("Error (controllers -> assembly-ai.controller): ", e);
        return res.status(500).send({
            success: false,
            message: e.message || "Failed to generate streaming token",
        });
    }
};

const summarizeTranscriptController = async (req, res) => {
    try {
        const rawTranscript = req.body?.transcript || req.body?.text || req.body;

        let transcriptText = '';
        if (typeof rawTranscript === 'string') {
            transcriptText = rawTranscript.trim();
        } else if (Array.isArray(rawTranscript)) {
            transcriptText = rawTranscript
                .map((item) => {
                    if (!item) return '';
                    if (typeof item === 'string') return item;
                    if (item.systemNotice) return ''; // Skip system messages (e.g. joined/left notifications)
                    const speaker = item.speaker ? `${item.speaker}` : 'Speaker';
                    const time = item.timestamp ? ` [${item.timestamp}]` : '';
                    return `${speaker}${time}: ${item.text || ''}`;
                })
                .filter(Boolean)
                .join('\n\n');
        }

        if (!transcriptText || transcriptText.trim().length < 5) {
            return res.status(400).send({
                success: false,
                message: 'A valid meeting transcript is required to generate meeting insights.',
            });
        }

        // Generate sales performance insight using AssemblyAI LLM Gateway and the SALES_PROMPT
        const insightResult = await generateSalesCallInsight(transcriptText);

        // Convert generated evaluation into a Microsoft Word (.doc) document
        const docBuffer = generateMeetingDoc(insightResult.content, {
            title: 'Meeting Insight & Sales Performance Report',
            generatedAt: new Date().toLocaleString(),
        });

        const filename = `Meeting_Insight_Report_${Date.now()}.doc`;

        return res
            .header('Content-Type', 'application/msword')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .header('Access-Control-Expose-Headers', 'Content-Disposition')
            .send(docBuffer);
    } catch (e) {
        console.error("Error (controllers -> assembly-ai.controller -> summarize): ", e);
        return res.status(500).send({
            success: false,
            message: e.message || "Failed to generate meeting insight summary",
        });
    }
};

module.exports = {
    getTokenController,
    summarizeTranscriptController,
    evaluateSalesCallController: summarizeTranscriptController,
};
