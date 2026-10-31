const Joi = require("joi");

const registerValidatorSchema = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required()
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(1).required()
});

const registerValidator = (req, res, done) => {
    try {
        const { error } = registerValidatorSchema.validate(req.body);
        if (error) {
            return res.status(400).send(error.details[0].message);
        }
        done();
    } catch (error) {
        console.error("validators->authValidator.js->registerValidator");
        console.log(err)
    }
}

const loginValidator = (req, res, done) => {
    try {
        const { error } = loginSchema.validate(req.body);
        if (error) {
            return res.status(400).send(error.details[0].message);
        }
        done();
    } catch (error) {
        console.error("validators->authValidator.js->registerValidator");
        console.log(err)
    }
}

module.exports = {
    registerValidator,
    loginValidator
}

