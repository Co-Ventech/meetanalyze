const userController = require('../controllers/auth.controller')
const authValidator = require('../validators/auth.validator')

const authRoutes = [
    {
        url: '/auth/register',
        method: 'POST',
        preHandler: authValidator.registerValidator,
        handler: userController.registerController
    },
    {
        url: '/auth/login',
        method: 'POST',
        preHandler: authValidator.loginValidator,
        handler: userController.loginController
    }
]

module.exports = authRoutes