const { StatusCodes } = require("http-status-codes");
const User = require("../models/user");
const { signJwt } = require("../utils/jwt-sign");

const createUser = async ({ email, name, password, userRole }) => {
    try {
        const userCreate = await User.create({
            name,
            email,
            password,
            user_role: userRole
        });

        return {
            status: StatusCodes.CREATED,
            message: "User Created Successfully",
            data: userCreate.toJSON()
        }
    } catch (e) {
        console.log(e)
        return {
            status: StatusCodes.INTERNAL_SERVER_ERROR,
            message: "Error during User Creation: " + e.message
        }
    }
}

const loginUser = async ({ email, password }) => {
    const user = await User.findOne({
        where: {
            email
        }
    });

    if (!user) {
        return {
            status: StatusCodes.NOT_FOUND,
            message: "User Not Found",
            data: userCreate.toJSON()
        }
    }
    const isValid = await user.validatePassword(password);

    if (!isValid) {
        return {
            status: StatusCodes.UNAUTHORIZED,
            message: "Password is wrong",
        }
    }

    //create access token for the user
    const token = signJwt({ email });

    return {
        status: StatusCodes.OK,
        message: "User Logged in",
        data: {
            accessToken: token
        }
    }
}

module.exports = { createUser, loginUser }