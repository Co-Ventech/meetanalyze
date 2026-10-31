const authService = require('../services/auth.service')

const registerController = async (req, res) => {
    const result = await authService.register(req.body)
    res.status(result.status).send({ ...result })
}

const loginController = async (req, res) => {
    const result = await authService.login(req.body)
    res.status(result.status).send({ ...result })
}

module.exports = {
    registerController,
    loginController
}