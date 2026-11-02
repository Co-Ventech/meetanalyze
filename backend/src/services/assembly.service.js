
const { client } = require('../../config/assembly-ai.config')

const CONNECTION_PARAMS = {
    sampleRate: 16000,
    speechModel: "universal-3-6-pro",
    mode: "balanced",
    speakerLabels: true,
    maxSpeakers: 5
}

const getAssemblyAIToken = async () => {
   try {
    const token = await client.streaming.createTemporaryToken({
      expires_in_seconds: 60,
    });

    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Unable to generate transcription token",
    });
  }
}

module.exports={
    getAssemblyAIToken
}
