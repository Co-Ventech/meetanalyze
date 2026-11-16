const dotenv = require('dotenv')
const jwt = require('jsonwebtoken')
dotenv.config()


const signJwt = (data) => {
    const verificationToken = jwt.sign(data, process.env.JWT_SECRET, {
        expiresIn: process.env.ACCESS_TOKEN_VALIDITY_DURATION || '7d'
    })
    return verificationToken;
}

const verifyJwt = (token) => jwt.verify(token, process.env.JWT_SECRET)

module.exports = { signJwt, verifyJwt }