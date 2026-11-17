//all routes will be gathered here
const authRoutes = require('./auth.routes');
const meetingsRoutes = require('./meetings.routes');

const routes = [
    ...authRoutes,
    ...meetingsRoutes
]
module.exports = { routes }
