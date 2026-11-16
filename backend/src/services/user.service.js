const { StatusCodes } = require("http-status-codes");
const User = require("../models/user");
const { signJwt } = require("../utils/jwt-sign");

const sanitize = (user) => {
    const { password, ...rest } = user.toJSON();
    return rest;
}

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
            data: sanitize(userCreate)
        }
    } catch (e) {
        console.log(e)
        if (e.name === 'SequelizeUniqueConstraintError') {
            return { status: StatusCodes.CONFLICT, message: "An account with this email already exists" }
        }
        return {
            status: StatusCodes.INTERNAL_SERVER_ERROR,
            message: "Error during User Creation: " + e.message
        }
    }
}

const loginUser = async ({ email, password }) => {
    const user = await User.scope(null).findOne({
        where: {
            email
        }
    });

    if (!user) {
        return {
            status: StatusCodes.NOT_FOUND,
            message: "User Not Found",
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
    const token = signJwt({ userId: user.user_id, email: user.email });

    return {
        status: StatusCodes.OK,
        message: "User Logged in",
        data: {
            accessToken: token,
            user: sanitize(user)
        }
    }
}

module.exports = { createUser, loginUser }