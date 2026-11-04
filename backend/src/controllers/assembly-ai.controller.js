const { getTemporaryToken } = require('../services/assembly.service');

const getTokenController = async (req, res) => {
    try {
        const token = await getTemporaryToken(480);
        return res.status(200).send({
            success: true,
            token,
        });
    } catch (e) {
        console.error("Error (controllers -> assembly-ai.controller): ", e);
        return res.status(500).send({
            success: false,
            message: e.message || "Failed to generate streaming token",
        });
    }
};


const evaluateSalesCallController = async (req, res) => {
    try {
        const {
            transcript
        } = req.body;
        const result = await assemblyAIGenerateResponse(SALES_PROMPT);
        return res.status(200).send({
            success: true,
            result,
        });
    } catch (e) {
        console.error("Error (controllers -> assembly-ai.controller): ", e);
        return res.status(500).send({
            success: false,
            message: e.message || "Failed to evaluate sales call",
        });
    }
};

module.exports = { getTokenController, evaluateSalesCallController };
