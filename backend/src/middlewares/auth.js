const { verifyJwt } = require('../utils/jwt-sign');

/** Fastify preHandler: requires `Authorization: Bearer <jwt>` and sets req.user = { userId, email }. */
const requireAuth = async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
        return res.status(401).send({ success: false, message: 'Authentication required' });
    }
    try {
        const payload = verifyJwt(token);
        if (!payload?.userId) throw new Error('Token missing user id');
        req.user = { userId: payload.userId, email: payload.email };
    } catch (e) {
        return res.status(401).send({ success: false, message: 'Invalid or expired session. Please log in again.' });
    }
};

module.exports = { requireAuth };
