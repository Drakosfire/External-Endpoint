const { logger } = require('~/config');
const { findUser, createUser, updateUser } = require('~/models');
const { getConvo } = require('~/models/Conversation');

/**
 * Middleware to validate external message requests with API key authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const validateExternalMessage = async (req, res, next) => {
    try {
        logger.debug('[validateExternalMessage] Validating external message request')
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

        // Check if this is a scheduled message
        const isScheduledMessage = req.body.metadata?.source === 'scheduled' ||
            req.body.metadata?.source === 'scheduled-task' ||
            req.body.metadata?.type === 'scheduled' ||
            req.body.metadata?.taskName; // Detect scheduled task by taskName presence

        if (isScheduledMessage) {
            logger.debug('[validateExternalMessage] Scheduled message detected, skipping phone validation');

            // For scheduled messages, we need to get the user from the existing conversation
            // Extract conversationId from URL path since req.params isn't available yet
            let conversationId = req.body.conversationId;

            // If not in body, try to extract from URL path
            if (!conversationId && req.path) {
                const pathMatch = req.path.match(/\/api\/messages\/([a-f0-9-]{36})/i);
                if (pathMatch) {
                    conversationId = pathMatch[1];
                }
            }

            // Also try req.url if req.path didn't work
            if (!conversationId && req.url) {
                const urlMatch = req.url.match(/\/api\/messages\/([a-f0-9-]{36})/i);
                if (urlMatch) {
                    conversationId = urlMatch[1];
                }
            }

            if (!conversationId) {
                logger.error('[validateExternalMessage] Conversation ID required for scheduled messages');
                return res.status(400).json({ error: 'Conversation ID required for scheduled messages' });
            }

            logger.debug('[validateExternalMessage] Extracted conversation ID for scheduled message:', conversationId);

            try {
                const conversation = await getConvo(null, conversationId);
                if (!conversation) {
                    logger.error('[validateExternalMessage] Conversation not found for scheduled message:', conversationId);
                    return res.status(404).json({ error: 'Conversation not found for scheduled message' });
                }

                // Use the conversation owner as the user
                const user = await findUser({ _id: conversation.user });
                if (!user) {
                    logger.error('[validateExternalMessage] User not found for conversation:', conversation.user);
                    return res.status(404).json({ error: 'User not found for conversation' });
                }

                logger.info('[validateExternalMessage] Using conversation owner for scheduled message:', {
                    conversationId,
                    userId: user._id.toString(),
                    taskName: req.body.metadata?.taskName
                });

                // Mark as service request for message handling
                req.isServiceRequest = true;
                // Set user from conversation owner
                req.user = user;
                // Mark as scheduled message
                req.isScheduledMessage = true;

                logger.debug('[validateExternalMessage] Scheduled message validation complete');
                return next();
            } catch (error) {
                logger.error('[validateExternalMessage] Error processing scheduled message:', error);
                return res.status(500).json({ error: 'Failed to process scheduled message' });
            }
        }

        // Basic validation for agent requests (format check only)
        if (req.body.metadata?.endpoint === 'agents') {
            logger.debug('[validateExternalMessage] Agent request detected');

            if (!req.body.metadata.agent_id) {
                logger.warn('[validateExternalMessage] agent_id required for agent endpoint');
                return res.status(400).json({ error: 'agent_id required for agent endpoint' });
            }

            // Simple format validation
            if (!req.body.metadata.agent_id.startsWith('agent_')) {
                logger.warn('[validateExternalMessage] Invalid agent_id format');
                return res.status(400).json({ error: 'Invalid agent_id format' });
            }

            logger.debug('[validateExternalMessage] Agent request format validated, deferring access check to ExternalClient');
        }

        // Extract phone number from various possible locations
        const phoneNumber = req.body.metadata?.phoneNumber ||
            req.body.from ||
            (req.body.body && req.body.metadata?.phoneNumber);

        if (!phoneNumber) {
            logger.warn('[validateExternalMessage] No phone number provided in request');
            return res.status(400).json({
                error: 'Phone number required',
                details: 'Please include phoneNumber in metadata or from field'
            });
        }

        // Normalize phone number (remove spaces, dashes, etc)
        const normalizedPhone = phoneNumber.replace(/[^0-9+]/g, '');

        logger.info('[validateExternalMessage] Processing message from:', normalizedPhone);

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
            try {
                user = await createUser({
                    email: `${normalizedPhone}@sms.librechat.ai`,
                    name: `SMS User ${normalizedPhone}`,
                    username: `sms_${normalizedPhone}`,
                    provider: 'sms',
                    phoneNumber: normalizedPhone,
                    emailVerified: true,
                    metadata: {
                        phoneNumber: normalizedPhone,
                        lastSMS: new Date(),
                        source: 'sms'
                    }
                }, true, true);

                logger.info('[validateExternalMessage] Successfully created new user:', {
                    userId: user._id.toString(),
                    phoneNumber: normalizedPhone
                });
            } catch (error) {
                logger.error('[validateExternalMessage] Error creating user:', error);
                // If user creation failed due to duplicate email, try to find the user again
                if (error.code === 11000) {
                    user = await findUser({
                        $or: [
                            { phoneNumber: normalizedPhone },
                            { 'metadata.phoneNumber': normalizedPhone }
                        ]
                    });
                    if (user) {
                        logger.info('[validateExternalMessage] Found existing user after creation error:', {
                            userId: user._id.toString(),
                            phoneNumber: normalizedPhone
                        });
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
        } else {
            // Update last SMS timestamp
            await updateUser(user._id, {
                'metadata.lastSMS': new Date()
            });
            logger.info('[validateExternalMessage] Updated existing user:', {
                userId: user._id.toString(),
                phoneNumber: normalizedPhone
            });
        }

        // Mark as service request for message handling
        req.isServiceRequest = true;
        // Set user
        req.user = user;
        // Add phone number to request for conversation handling
        req.phoneNumber = normalizedPhone;

        logger.debug('[validateExternalMessage] External message validation complete');
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