const { hash } = require("bcrypt");

const encryptPassword = async (password) => {
    const saltRounds = 10;
    try {
        const hashedPassword = await hash(password, saltRounds);
        return hashedPassword;
    } catch (error) {
        console.error('utils->encryptPassword.js')
        console.error(error)
    }
}

module.exports = { encryptPassword }