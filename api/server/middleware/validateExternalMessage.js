const { logger } = require('~/config');

/**
 * Middleware to validate external message requests with API key authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const validateExternalMessage = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        logger.warn('API key missing from request');
        return res.status(401).json({ error: 'API key required' });
    }

    if (apiKey !== process.env.EXTERNAL_MESSAGE_API_KEY) {
        logger.warn('Invalid API key provided');
        return res.status(403).json({ error: 'Invalid API key' });
    }

    // Mark as service request for message handling
    req.isServiceRequest = true;
    next();
};

module.exports = validateExternalMessage; 