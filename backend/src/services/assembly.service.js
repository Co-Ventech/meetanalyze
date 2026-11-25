require('../utils/dns-resolver');

const { SALES_PROMPT } = require('../constants/prompt');

/**
 * AssemblyAI LLM Gateway service.
 * Transcription now comes from Google Meet captions; AssemblyAI is only used for the LLM analysis.
 */

const GATEWAYS = [
  'https://llm-gateway.assemblyai.com/v1/chat/completions',
  'https://llm-gateway.eu.assemblyai.com/v1/chat/completions',
];

// Strongest model first: the 4B model is fast but misreads long or messy caption transcripts,
// so it is only a last resort.
const MODELS = [
  'claude-sonnet-4-6',
  'gpt-4.1',
  'gemini-2.5-flash',
  'qwen3.5-4b-32k-fast',
];

const OUTCOMES = ['Successful', 'Partially Successful', 'Unsuccessful'];

// The gateway defaults to max_tokens=1000, which truncates the full evaluation mid-JSON.
const MAX_TOKENS = 6000;
// Small models occasionally emit slightly malformed JSON; retry the same model this many times.
const ATTEMPTS_PER_MODEL = 2;

const asString = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const asStringArray = (v) => (Array.isArray(v) ? v.map(asString).filter(Boolean) : []);
const asEvidenceArray = (v) =>
  (Array.isArray(v) ? v : [])
    .map((item) => (typeof item === 'string'
      ? { point: item.trim(), evidence: '' }
      : { point: asString(item?.point), evidence: asString(item?.evidence) }))
    .filter((item) => item.point);

const clampScore = (v, max) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, Math.round(n * 10) / 10));
};

/** Extract the first JSON object from a model reply (handles ```json fences and stray prose). */
const extractJson = (content) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Model reply did not contain a JSON object');
  const json = body.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (err) {
    // Light repair for common small-model mistakes: trailing commas and smart quotes as delimiters
    const repaired = json
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[“”]/g, '"');
    try {
      return JSON.parse(repaired);
    } catch {
      throw err;
    }
  }
};

/** Validate and normalise the model's JSON into the shape the dashboard expects. */
const normalizeInsight = (raw) => {
  if (raw?.error) throw new Error(asString(raw.error));

  const scorecard = (Array.isArray(raw?.scorecard) ? raw.scorecard : [])
    .map((row) => ({
      category: asString(row?.category),
      score: clampScore(row?.score, 10),
      comment: asString(row?.comment),
    }))
    .filter((row) => row.category);

  if (!scorecard.length && !asString(raw?.summary)) {
    throw new Error('Model reply was missing the summary and scorecard');
  }

  const scored = scorecard.filter((row) => row.score !== null);
  let overallScore = clampScore(raw?.overallScore, 100);
  if (overallScore === null && scored.length) {
    overallScore = Math.round((scored.reduce((a, r) => a + r.score, 0) / scored.length) * 10);
  }

  const outcome = OUTCOMES.find((o) => o.toLowerCase() === asString(raw?.outcome).toLowerCase()) || null;
  const rec = raw?.recommendations || {};

  return {
    outcome,
    outcomeReason: asString(raw?.outcomeReason),
    overallScore,
    summary: asString(raw?.summary),
    strongPoints: asEvidenceArray(raw?.strongPoints),
    weakPoints: asEvidenceArray(raw?.weakPoints),
    improvements: asEvidenceArray(raw?.improvements),
    scorecard,
    recommendations: {
      strengths: asStringArray(rec.strengths),
      weaknesses: asStringArray(rec.weaknesses),
      improvements: asStringArray(rec.improvements),
      managerAssessment: asString(rec.managerAssessment),
    },
    limitations: asStringArray(raw?.limitations),
  };
};

/**
 * Generate a structured sales-call evaluation using the AssemblyAI LLM Gateway.
 * Tries each gateway/model pair until one returns valid JSON.
 * @returns {Promise<{model: string, insight: object}>}
 */
const generateSalesCallInsight = async (transcriptText) => {
  const apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not configured in backend/.env');
  }

  if (!transcriptText || !transcriptText.trim()) {
    throw new Error('Transcript text is required to generate meeting insights.');
  }

  const attemptErrors = [];

  for (const gatewayUrl of GATEWAYS) {
    for (const model of MODELS) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
        let retryable = false;
        try {
          const response = await fetch(gatewayUrl, {
            method: 'POST',
            headers: {
              'Authorization': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              max_tokens: MAX_TOKENS,
              temperature: 0.2,
              messages: [
                { role: 'system', content: SALES_PROMPT },
                {
                  role: 'user',
                  content: `Evaluate this sales call transcript and reply with the JSON object only:\n\n<transcript>\n${transcriptText}\n</transcript>`,
                },
              ],
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            // 4xx = this model/gateway is not available to the account; don't retry it
            throw new Error(`HTTP ${response.status}: ${errText}`);
          }

          const data = await response.json();
          const choice = data?.choices?.[0];
          const content = choice?.message?.content;
          retryable = true;
          if (!content || !content.trim()) {
            throw new Error(`Empty content returned by model ${model}`);
          }
          if (choice.finish_reason === 'length') {
            throw new Error(`Reply from ${model} was cut off at the token limit`);
          }

          return { model, insight: normalizeInsight(extractJson(content)) };
        } catch (err) {
          attemptErrors.push(`[${model} @ ${gatewayUrl} #${attempt}]: ${err.message}`);
          console.warn(`[AssemblyAI] LLM attempt ${attempt} with ${model} on ${gatewayUrl} failed (${err.message}).`);
          if (!retryable) break;
        }
      }
    }
  }

  throw new Error(`Failed to generate sales call insight on all LLM Gateway candidates: ${attemptErrors.join('; ')}`);
};

module.exports = {
  generateSalesCallInsight,
  normalizeInsight,
  extractJson,
};
