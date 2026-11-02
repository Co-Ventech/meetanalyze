/**
 * AssemblyAI Service
 * Handles temporary token generation for client-side Real-Time Streaming v3.
 */

const getTemporaryToken = async (expiresInSeconds = 480) => {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not defined in environment variables");
  }

  // Request temporary token from AssemblyAI Streaming v3
  // Note: All AssemblyAI endpoints use raw API key (no Bearer prefix)
  const url = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${expiresInSeconds}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AssemblyAI token request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.token;
};

module.exports = {
  getTemporaryToken,
};
