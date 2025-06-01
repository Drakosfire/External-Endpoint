const { logger } = require('~/config');
const { findUser, createUser, updateUser } = require('~/models');

/**
 * Middleware to validate external message requests with API key authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const validateExternalMessage = async (req, res, next) => {
    try {
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

        // Extract phone number from metadata
        const phoneNumber = req.body.metadata?.phoneNumber;
        if (!phoneNumber) {
            logger.warn('[validateExternalMessage] No phone number provided in metadata');
            return res.status(400).json({
                error: 'Phone number required in metadata',
                details: 'Please include phoneNumber in the metadata object of your request'
            });
        }

        // Normalize phone number (remove spaces, dashes, etc)
        const normalizedPhone = phoneNumber.replace(/[^0-9+]/g, '');

        // Try to find existing user by phone number
        let user = await findUser({
            $or: [
                { phoneNumber: normalizedPhone },
                { 'metadata.phoneNumber': normalizedPhone }
            ]
        });

        // If no user found, create new user
        if (!user) {
            logger.info('[validateExternalMessage] Creating new user for phone number:', normalizedPhone);
            user = await createUser({
                email: `${normalizedPhone}@sms.librechat.ai`,
                name: `SMS User ${normalizedPhone}`,
                username: `sms_${normalizedPhone}`,
                provider: 'sms',
                phoneNumber: normalizedPhone,
                metadata: {
                    phoneNumber: normalizedPhone,
                    lastSMS: new Date(),
                    source: 'sms'
                }
            }, true, true);
        } else {
            // Update last SMS timestamp
            await updateUser(user._id, {
                'metadata.lastSMS': new Date()
            });
        }

        // Mark as service request for message handling
        req.isServiceRequest = true;
        // Set user
        req.user = user;

        // Add phone number to request for conversation handling
        req.phoneNumber = normalizedPhone;

        logger.info('[validateExternalMessage] External message request validated successfully', {
            userId: user._id,
            phoneNumber: normalizedPhone
        });

        next();
    } catch (error) {
        logger.error('[validateExternalMessage] Error processing request:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to process external message request'
        });
    }
};

module.exports = validateExternalMessage; 