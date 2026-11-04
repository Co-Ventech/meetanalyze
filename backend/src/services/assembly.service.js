const dns = require('node:dns');

// Prioritize IPv4 lookup to prevent macOS Happy Eyeballs getaddrinfo ENOTFOUND issues
try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (err) {
  console.warn('[AssemblyAI] Could not set dns default result order:', err);
}

/**
 * AssemblyAI Service
 * Handles temporary token generation for client-side Real-Time Streaming v3.
 * Supports automatic fallback across regional endpoints (Global, US, EU)
 * to guard against local DNS resolution failures.
 */
const getTemporaryToken = async (expiresInSeconds = 480) => {
  const apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not defined in backend/.env');
  }

  // Endpoints to try in order of priority
  const candidateHosts = [
    'streaming.assemblyai.com',
    'streaming.us.assemblyai.com',
    'streaming.eu.assemblyai.com',
  ];

  let lastError = null;

  for (const host of candidateHosts) {
    try {
      const url = `https://${host}/v3/token?expires_in_seconds=${expiresInSeconds}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: apiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AssemblyAI token request to ${host} failed (HTTP ${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (!data?.token) {
        throw new Error(`AssemblyAI token response from ${host} missing token field`);
      }

      return {
        token: data.token,
        host,
      };
    } catch (err) {
      lastError = err;
      console.warn(`[AssemblyAI] Token generation attempt on ${host} failed (${err.code || err.message}). Trying fallback...`);
    }
  }

  throw lastError || new Error('Failed to generate AssemblyAI streaming token on all endpoints');
};

const { SALES_PROMPT } = require('../constants/prompt');

/**
 * Generate meeting performance insight using AssemblyAI LLM Gateway and the SALES_PROMPT.
 * Evaluates the sales call across all 7 assessment categories and guardrails.
 */
const generateSalesCallInsight = async (transcriptText) => {
  const apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not configured in backend/.env');
  }

  if (!transcriptText || !transcriptText.trim()) {
    throw new Error('Transcript text is required to generate meeting insights.');
  }

  // Gateway endpoints (Global / US, EU)
  const candidateGateways = [
    'https://llm-gateway.assemblyai.com/v1/chat/completions',
    'https://llm-gateway.eu.assemblyai.com/v1/chat/completions',
  ];

  // Primary model verified for this account first, followed by standard fallback models
  const candidateModels = [
    'qwen3.5-4b-32k-fast',
    'claude-sonnet-4-6',
    'gemini-2.5-flash',
    'gpt-4.1',
  ];

  let lastError = null;

  for (const gatewayUrl of candidateGateways) {
    for (const model of candidateModels) {
      try {
        const response = await fetch(gatewayUrl, {
          method: 'POST',
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: SALES_PROMPT,
              },
              {
                role: 'user',
                content: `Please evaluate this sales call transcript according to the specified instructions:\n\n<transcript>\n${transcriptText}\n</transcript>`,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`LLM Gateway ${model} on ${gatewayUrl} returned HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content || !content.trim()) {
          throw new Error(`Empty content returned by model ${model}`);
        }

        return {
          model,
          content: content.trim(),
        };
      } catch (err) {
        lastError = err;
        console.warn(`[AssemblyAI] LLM attempt with ${model} on ${gatewayUrl} failed (${err.message}). Trying next candidate...`);
      }
    }
  }

  throw lastError || new Error('Failed to generate sales call insight on all LLM Gateway candidates');
};

module.exports = {
  getTemporaryToken,
  generateSalesCallInsight,
};
