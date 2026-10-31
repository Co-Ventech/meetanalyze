const userService = require('./user.service')

const register = async (body) => {
    const result = await userService.createUser({ ...body });
    return result;
}

const login = async (body) => {
    const result = await userService?.loginUser({
        email: body.email,
        password: body.password,
    });
    return result;
}

module.exports = { register, login }