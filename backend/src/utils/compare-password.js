const { compare } = require("bcrypt");

const comparePassword = async (userPassword, hashedPassword) => {
    return await compare(userPassword, hashedPassword)
}

module.exports = { comparePassword }