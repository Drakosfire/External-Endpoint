const { logger } = require('~/config');

/**
 * Middleware to validate external message requests with API key authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const validateExternalMessage = async (req, res, next) => {
    logger.info('[validateExternalMessage] Validating external message request');

    // Verify this is an external message request
    if (req.body.role !== 'external') {
        logger.warn('[validateExternalMessage] Invalid role for external message request');
        return res.status(400).json({ error: 'Invalid role for external message request' });
    }

    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        logger.warn('[validateExternalMessage] API key missing from request');
        return res.status(401).json({ error: 'API key required' });
    }

    if (apiKey !== process.env.EXTERNAL_MESSAGE_API_KEY) {
        logger.warn('[validateExternalMessage] Invalid API key provided');
        return res.status(403).json({ error: 'Invalid API key' });
    }

    // Mark as service request for message handling
    req.isServiceRequest = true;
    req.user = { id: 'external-service' };
    logger.info('[validateExternalMessage] External message request validated successfully');
    next();
};

module.exports = validateExternalMessage; 