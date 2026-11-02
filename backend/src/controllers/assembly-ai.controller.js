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

module.exports = { getTokenController };
