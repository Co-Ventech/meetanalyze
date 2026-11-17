const controller = require('../controllers/meetings.controller');
const { requireAuth } = require('../middlewares/auth');
const { createMeetingValidator } = require('../validators/meeting.validator');

const idParams = {
    params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
    },
};

const meetingsRoutes = [
    { url: '/meetings', method: 'POST', bodyLimit: 5 * 1024 * 1024, preHandler: [requireAuth, createMeetingValidator], handler: controller.createMeetingController },
    { url: '/meetings', method: 'GET', preHandler: requireAuth, handler: controller.listMeetingsController },
    { url: '/meetings/:id', method: 'GET', schema: idParams, preHandler: requireAuth, handler: controller.getMeetingController },
    { url: '/meetings/:id', method: 'DELETE', schema: idParams, preHandler: requireAuth, handler: controller.deleteMeetingController },
    { url: '/meetings/:id/retry', method: 'POST', schema: idParams, preHandler: requireAuth, handler: controller.retryMeetingController },
];

module.exports = meetingsRoutes;
