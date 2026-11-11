require('./src/utils/dns-resolver');

const fastify = require('fastify')({
    logger: true
})
const cors = require('@fastify/cors')
const {routes} = require('./src/routes/main.routes')
const dotenv = require('dotenv')
const { syncModels } = require('./src/utils/sync-models')
dotenv.config()

fastify.register(cors, {
    origin: "*",
    methods: ['GET', 'POST', 'PUT', 'DELETE']
})

routes.forEach(route => {
    route.url = `/api/v1${route.url.startsWith('/') ? route.url : '/' + route.url}`
    fastify.route(route)
});

syncModels();

// Only listen on port when running locally (not in Vercel serverless)
if (!process.env.VERCEL) {
    fastify.listen({
        port: process.env.PORT || 5000,
        host: process.env.SERVER_HOST || '0.0.0.0',
    }, (err, address) => {
        if (err) {
            fastify.log.error(err);
            process.exit(1)
        }
        console.log(`server is running on port: ${process.env.PORT || 5000}`)
    })
}

// Export serverless handler for Vercel
module.exports = async (req, res) => {
    await fastify.ready();
    fastify.server.emit('request', req, res);
};
