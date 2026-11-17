const Joi = require("joi");

const turnSchema = Joi.object({
    id: Joi.string().allow(''),
    speaker: Joi.string().allow('').required(),
    isSelf: Joi.boolean(),
    text: Joi.string().allow('').required(),
    timestamp: Joi.string().allow(''),
    startMs: Joi.number(),
    endMs: Joi.number(),
    systemNotice: Joi.boolean(),
}).unknown(true);

const createMeetingSchema = Joi.object({
    meetCode: Joi.string().allow('', null),
    title: Joi.string().allow('', null).max(255),
    startedAt: Joi.date().allow(null),
    endedAt: Joi.date().allow(null),
    participants: Joi.array().items(Joi.string()).default([]),
    transcript: Joi.array().items(turnSchema).min(1).required(),
});

const createMeetingValidator = (req, res, done) => {
    const { error, value } = createMeetingSchema.validate(req.body);
    if (error) {
        return res.status(400).send({ success: false, message: error.details[0].message });
    }
    req.body = value;
    done();
};

module.exports = { createMeetingValidator };
