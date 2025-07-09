const { logger } = require('~/config');
const { findUser, createUser, updateUser } = require('~/models');
const { getConvo } = require('~/models/Conversation');

/**
 * Check if a conversation ID is a placeholder (used for routing) rather than a real conversation
 * @param {string} conversationId - Conversation ID to check
 * @returns {boolean} - True if this is a placeholder ID
 */
const isPlaceholderConversationId = (conversationId) => {
    const placeholderIds = [
        'sms-conversation',
        'external-message',
        'external-sms',
        'placeholder'
    ];
    return placeholderIds.includes(conversationId);
};

/**
 * Enhanced phone number normalization with validation
 * @param {string} phoneNumber - Raw phone number from request
 * @returns {string|null} - Normalized phone number or null if invalid
 */
const normalizePhoneNumber = (phoneNumber) => {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return null;
    }

    // Remove all non-digit and non-plus characters
    let normalized = phoneNumber.replace(/[^0-9+]/g, '');

    // Handle common formats
    if (normalized.startsWith('1') && normalized.length === 11 && !normalized.startsWith('+')) {
        // US number without country code prefix
        normalized = '+' + normalized;
    } else if (normalized.length === 10 && !normalized.startsWith('+')) {
        // US number without country code
        normalized = '+1' + normalized;
    } else if (!normalized.startsWith('+') && normalized.length > 7) {
        // International number without + prefix
        normalized = '+' + normalized;
    }

    // Validate E.164 format (+ followed by 7-15 digits)
    const e164Regex = /^\+[1-9]\d{6,14}$/;
    if (!e164Regex.test(normalized)) {
        logger.warn('[validateExternalMessage] Invalid phone number format:', phoneNumber, '->', normalized);
        return null;
    }

    return normalized;
};

/**
 * Extract phone number from various request locations
 * @param {Object} requestBody - Request body
 * @returns {string|null} - Extracted phone number or null
 */
const extractPhoneNumber = (requestBody) => {
    const possibleSources = [
        requestBody.metadata?.phoneNumber,
        requestBody.from,
        requestBody.metadata?.from,
        requestBody.phoneNumber
    ];

    for (const source of possibleSources) {
        if (source) {
            const normalized = normalizePhoneNumber(source);
            if (normalized) {
                return normalized;
            }
        }
    }

    return null;
};

/**
 * Enhanced SMS user creation with comprehensive metadata
 * @param {string} phoneNumber - Normalized phone number
 * @param {Object} requestMetadata - Additional metadata from request
 * @returns {Object} - Created or existing user
 */
const getOrCreateSMSUser = async (phoneNumber, requestMetadata = {}) => {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
        throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }

    logger.info(`[getOrCreateSMSUser] Starting user lookup for phone: ${normalizedPhone}`);

    // Try to find existing user
    const searchQuery = {
        $or: [
            { phoneNumber: normalizedPhone },
            { 'metadata.phoneNumber': normalizedPhone }
        ]
    };

    logger.debug(`[getOrCreateSMSUser] Searching for user with phone: ${normalizedPhone}`);

    let user = await findUser(searchQuery);

    logger.info(`[getOrCreateSMSUser] User lookup result: ${user ? 'FOUND' : 'NOT_FOUND'}`, {
        userId: user?._id?.toString(),
        existingPhone: user?.phoneNumber,
        existingMetadataPhone: user?.metadata?.phoneNumber
    });

    if (!user) {
        logger.info(`[getOrCreateSMSUser] Creating new SMS user for ${normalizedPhone}`);

        // Generate unique username (handle potential conflicts)
        const baseUsername = `sms_${normalizedPhone.replace(/[^0-9]/g, '')}`;
        let username = baseUsername;
        let attempt = 1;

        logger.debug(`[getOrCreateSMSUser] Generated base username: ${baseUsername}`);

        // Check for username conflicts and create unique one if needed
        while (await findUser({ username })) {
            logger.debug(`[getOrCreateSMSUser] Username conflict detected: ${username}, trying attempt ${attempt + 1}`);
            username = `${baseUsername}_${attempt}`;
            attempt++;
            if (attempt > 10) {
                // Fallback to timestamp if too many conflicts
                username = `${baseUsername}_${Date.now()}`;
                logger.warn(`[getOrCreateSMSUser] Too many username conflicts, using timestamp: ${username}`);
                break;
            }
        }

        logger.info(`[getOrCreateSMSUser] Final username selected: ${username}`);

        const userPayload = {
            email: `${normalizedPhone}@sms.librechat.ai`,
            name: `SMS User ${normalizedPhone}`,
            username: username,
            provider: 'sms',
            phoneNumber: normalizedPhone,
            emailVerified: true,
            role: 'USER',
            metadata: {
                phoneNumber: normalizedPhone,
                source: 'sms',
                createdBy: 'sms-system',
                firstContact: new Date(),
                lastSMS: new Date(),
                messageCount: 1,
                preferences: {
                    defaultModel: 'gpt-4.1',
                    endpoint: 'openai'
                },
                // Add any additional metadata from request
                ...requestMetadata
            }
        };

        logger.debug(`[getOrCreateSMSUser] Creating user with email: ${userPayload.email}, username: ${userPayload.username}`);

        try {
            logger.info(`[getOrCreateSMSUser] Calling createUser() with payload...`);
            user = await createUser(userPayload, true, true);

            logger.info(`[getOrCreateSMSUser] Successfully created SMS user:`, {
                userId: user._id.toString(),
                phoneNumber: normalizedPhone,
                username: user.username,
                email: user.email,
                provider: user.provider,
                savedPhoneNumber: user.phoneNumber,
                savedMetadata: user.metadata
            });
        } catch (error) {
            logger.error('[getOrCreateSMSUser] Error creating SMS user:', error);
            logger.error('[getOrCreateSMSUser] Error details:', {
                message: error.message,
                code: error.code,
                name: error.name
            });

            // Handle duplicate email error (race condition)
            if (error.code === 11000) {
                // Try to find the user that was created by another request
                user = await findUser({
                    $or: [
                        { phoneNumber: normalizedPhone },
                        { 'metadata.phoneNumber': normalizedPhone },
                        { email: `${normalizedPhone}@sms.librechat.ai` }
                    ]
                });

                if (user) {
                    logger.info(`[validateExternalMessage] Found existing user after creation conflict:`, {
                        userId: user._id.toString(),
                        phoneNumber: normalizedPhone
                    });
                } else {
                    // If we still can't find the user, something is seriously wrong
                    throw new Error(`Failed to create or find SMS user for ${normalizedPhone}: ${error.message}`);
                }
            } else {
                throw error;
            }
        }
    } else {
        // Update existing user activity
        logger.info(`[getOrCreateSMSUser] Updating existing SMS user:`, {
            userId: user._id.toString(),
            currentPhone: user.phoneNumber,
            currentMetadataPhone: user.metadata?.phoneNumber,
            currentMessageCount: user.metadata?.messageCount || 0
        });

        const setPayload = {
            'metadata.lastSMS': new Date()
        };

        const incPayload = {
            'metadata.messageCount': 1
        };

        // If user doesn't have phoneNumber field set, add it
        if (!user.phoneNumber) {
            logger.info(`[getOrCreateSMSUser] Adding missing phoneNumber field to existing user`);
            setPayload.phoneNumber = normalizedPhone;
        }

        // If user doesn't have phoneNumber in metadata, add it
        if (!user.metadata?.phoneNumber) {
            logger.info(`[getOrCreateSMSUser] Adding missing metadata.phoneNumber to existing user`);
            setPayload['metadata.phoneNumber'] = normalizedPhone;
        }

        const updatePayload = {
            $set: setPayload,
            $inc: incPayload
        };

        logger.debug(`[getOrCreateSMSUser] Updating user with ${Object.keys(updatePayload).length} fields`);

        try {
            logger.debug(`[getOrCreateSMSUser] About to call updateUser with payload:`, updatePayload);
            // Use direct MongoDB update since updateUser() doesn't handle mixed $set/$inc operations
            const { User } = require('~/db/models');
            const updateResult = await User.findByIdAndUpdate(user._id, updatePayload, {
                new: true,
                runValidators: true,
            }).lean();

            logger.info(`[getOrCreateSMSUser] Successfully updated existing SMS user:`, {
                userId: user._id.toString(),
                phoneNumber: normalizedPhone,
                totalMessages: (user.metadata?.messageCount || 0) + 1,
                updateResultType: typeof updateResult,
                updateResultIsNull: updateResult === null,
                updateResultKeys: updateResult ? Object.keys(updateResult) : null
            });

            // Fetch updated user to verify changes - this is critical
            const updatedUser = await findUser({ _id: user._id });

            if (!updatedUser) {
                logger.error(`[getOrCreateSMSUser] CRITICAL: User disappeared after update! UserId: ${user._id.toString()}`);
            } else {
                logger.info(`[getOrCreateSMSUser] User verification after update:`, {
                    phoneNumber: updatedUser.phoneNumber,
                    metadataPhone: updatedUser.metadata?.phoneNumber,
                    messageCount: updatedUser.metadata?.messageCount,
                    userId: updatedUser._id.toString()
                });

                // Check if the phone number was actually saved
                if (!updatedUser.phoneNumber && updatePayload.phoneNumber) {
                    logger.error(`[getOrCreateSMSUser] CRITICAL: phoneNumber field was NOT saved to database!`);
                    logger.error(`[getOrCreateSMSUser] Expected: ${updatePayload.phoneNumber}, Got: ${updatedUser.phoneNumber}`);
                }

                if (!updatedUser.metadata?.phoneNumber && updatePayload['metadata.phoneNumber']) {
                    logger.error(`[getOrCreateSMSUser] CRITICAL: metadata.phoneNumber was NOT saved to database!`);
                    logger.error(`[getOrCreateSMSUser] Expected: ${updatePayload['metadata.phoneNumber']}, Got: ${updatedUser.metadata?.phoneNumber}`);
                }
            }

        } catch (updateError) {
            // Don't fail the request if metadata update fails
            logger.error('[getOrCreateSMSUser] Failed to update user metadata:', updateError);
            logger.error('[getOrCreateSMSUser] Update error details:', {
                message: updateError.message,
                code: updateError.code,
                name: updateError.name,
                userId: user._id.toString(),
                updatePayload: updatePayload
            });
        }
    }

    return user;
};

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

        // API Key validation
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            logger.warn('[validateExternalMessage] API key missing from request');
            return res.status(401).json({ error: 'API key required' });
        }

        if (apiKey !== process.env.EXTERNAL_MESSAGE_API_KEY) {
            logger.warn('[validateExternalMessage] Invalid API key provided');
            return res.status(403).json({ error: 'Invalid API key' });
        }

        // Note: Scheduled messages now flow through regular SMS pipeline
        // No special handling needed - they use synthetic phone numbers

        // Handle agent requests (basic validation)
        if (req.body.metadata?.endpoint === 'agents') {
            logger.debug('[validateExternalMessage] Agent request detected');

            if (!req.body.metadata.agent_id) {
                logger.warn('[validateExternalMessage] agent_id required for agent endpoint');
                return res.status(400).json({ error: 'agent_id required for agent endpoint' });
            }

            if (!req.body.metadata.agent_id.startsWith('agent_')) {
                logger.warn('[validateExternalMessage] Invalid agent_id format');
                return res.status(400).json({ error: 'Invalid agent_id format' });
            }

            logger.debug('[validateExternalMessage] Agent request format validated');
        }

        // Extract and validate phone number for SMS messages
        logger.debug('[validateExternalMessage] Extracting phone number from request body:', {
            metadataPhoneNumber: req.body.metadata?.phoneNumber,
            from: req.body.from,
            metadataFrom: req.body.metadata?.from,
            phoneNumber: req.body.phoneNumber
        });

        const phoneNumber = extractPhoneNumber(req.body);
        if (!phoneNumber) {
            logger.warn('[validateExternalMessage] No valid phone number provided in request');
            logger.debug('[validateExternalMessage] Request body keys:', Object.keys(req.body));
            return res.status(400).json({
                error: 'Valid phone number required',
                details: 'Please include a valid phone number in E.164 format (+1234567890) in metadata.phoneNumber or from field'
            });
        }

        logger.info(`[validateExternalMessage] Processing SMS message from: ${phoneNumber}`);

        // Get or create SMS user with enhanced metadata
        const user = await getOrCreateSMSUser(phoneNumber, req.body.metadata);

        // Check if conversation ID from URL is a placeholder
        let conversationIdFromUrl = null;
        if (req.path) {
            const pathMatch = req.path.match(/\/api\/messages\/([^\/]+)/);
            if (pathMatch) {
                conversationIdFromUrl = pathMatch[1];
            }
        }

        // Enhanced request context for downstream processing
        req.isServiceRequest = true;
        req.user = user;
        req.phoneNumber = phoneNumber;
        req.smsUserContext = {
            isNewUser: user.createdAt > new Date(Date.now() - 60000), // Created in last minute
            lastActivity: user.metadata?.lastSMS,
            totalMessages: user.metadata?.messageCount || 1,
            userPreferences: user.metadata?.preferences || {},
            usePlaceholderConversationId: conversationIdFromUrl ? isPlaceholderConversationId(conversationIdFromUrl) : false
        };

        logger.debug('[validateExternalMessage] SMS user validation complete', {
            userId: user._id.toString(),
            phoneNumber: phoneNumber,
            isNewUser: req.smsUserContext.isNewUser,
            conversationIdFromUrl: conversationIdFromUrl,
            isPlaceholder: req.smsUserContext.usePlaceholderConversationId
        });

        next();
    } catch (error) {
        logger.error('[validateExternalMessage] Error processing request:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to process external message request',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = validateExternalMessage; 