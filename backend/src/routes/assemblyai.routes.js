const assemblyaiController = require('../controllers/assembly-ai.controller');

const assemblyaiRoutes = [
    {
        url: '/transcription/token',
        method: 'GET',
        handler: assemblyaiController.getTokenController
    }
]

module.exports = assemblyaiRoutes