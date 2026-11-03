//all routes will be gathered here
const authRoutes = require('./auth.routes');
const assemblyaiRoutes= require('./assemblyai.routes');

const routes = [
    ...authRoutes,
    ...assemblyaiRoutes
]
module.exports = { routes }