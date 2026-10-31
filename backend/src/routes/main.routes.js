//all routes will be gathered here
const authRoutes = require('./auth.routes')

const routes = [
    ...authRoutes,
]
module.exports = { routes }