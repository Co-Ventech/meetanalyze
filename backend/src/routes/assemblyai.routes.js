const assemblyaiController = require('../controllers/assembly-ai.controller');

const assemblyaiRoutes = [
    {
        url: '/transcription/token',
        method: 'GET',
        handler: assemblyaiController.getTokenController
    },
    {
        url: '/transcription/summarize',
        method: 'POST',
        handler: assemblyaiController.summarizeTranscriptController
    },
    {
        url: '/summarize',
        method: 'POST',
        handler: assemblyaiController.summarizeTranscriptController
    }
];

module.exports = assemblyaiRoutes;