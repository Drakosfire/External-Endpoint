const BaseClient = require('~/app/clients/BaseClient');
const { logger } = require('~/config');
const { v4: uuidv4 } = require('uuid');
const { saveMessage, getUserById, saveConvo } = require('~/models');
const { getConvo } = require('~/models/Conversation');
const { broadcastToUsers, broadcastNewConversation } = require('~/server/sseClients');
const { SystemRoles } = require('librechat-data-provider');
const { ObjectId } = require('mongodb');

// Custom extractor to get JWT from query param or Authorization header
const extractJwtToken = (req) => {
    let token = null;
    // Try to get token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }
    // Fallback: try to get token from query parameter
    else if (req.query && req.query.token) {
        token = req.query.token;
    }
    // Fallback: try to get token from cookies
    else if (req.cookies && req.cookies.refreshToken) {
        token = req.cookies.refreshToken;
    }
    return token;
};

class ExternalClient extends BaseClient {
    constructor(apiKey, options = {}) {
        super(apiKey, options);
        this.endpoint = 'external';
        this.sender = 'External';
        this.req = options.req;
        this.res = options.res;
        this.model = options.model;
        this.endpointType = options.endpointType || 'default';
        this.options = {
            ...options,
            agent_id: options.agent_id,
            model_parameters: options.model_parameters,
            conversationId: options.conversationId
        };
        this.user = null;
    }

    // Override token usage recording to skip token spending for external messages
    async recordTokenUsage({ promptTokens, completionTokens }) {
        logger.debug('[ExternalClient] Skipping token usage recording for external message', {
            promptTokens,
            completionTokens
        });
        return;
    }

    // Override token count to return 0 for external messages
    getTokenCountForResponse(responseMessage) {
        logger.debug('[ExternalClient] Skipping token count for external message', responseMessage);
        return 0;
    }

    async initialize() {
        logger.info('[ExternalClient] Initializing client');

        if (!this.req || !this.res) {
            throw new Error('Request and response objects are required for ExternalClient initialization');
        }

        // For external messages, we should always have a user from validateExternalMessage
        if (this.req.user) {
            // Ensure we have the full user object, not just the ID
            if (typeof this.req.user === 'string' || this.req.user instanceof ObjectId) {
                this.user = this.req.user;
            } else {
                this.user = this.req.user._id || this.req.user.id;
            }
            logger.info('[ExternalClient] Using phone number-based user from request:', {
                userId: this.user,
                phoneNumber: this.req.phoneNumber
            });
            return;
        }

        // If we somehow don't have a user from the request (shouldn't happen),
        // try other methods as fallback
        if (this.options.user) {
            this.user = this.options.user._id || this.options.user.id;
            logger.info('[ExternalClient] Using user from options:', this.user);
            return;
        }

        // If no user in options, try to get from conversation owner
        if (this.options.conversationId) {
            try {
                logger.info('[ExternalClient] Attempting to get conversation:', this.options.conversationId);
                const conversation = await getConvo(null, this.options.conversationId);
                logger.info('[ExternalClient] Conversation found:', conversation ? 'Yes' : 'No');
                if (conversation && conversation.user) {
                    this.user = conversation.user;
                    logger.info('[ExternalClient] Using user from conversation owner:', this.user);
                    return;
                }
            } catch (err) {
                logger.warn('[ExternalClient] Failed to get user from conversation:', err);
            }
        }

        // If still no user, try to recover from JWT token
        const token = extractJwtToken(this.req);
        if (token) {
            try {
                const jwt = require('jsonwebtoken');
                const payload = jwt.verify(token, process.env.JWT_SECRET);
                this.user = payload?.id;
                if (this.user) {
                    logger.info('[ExternalClient] Recovered user from JWT token:', this.user);
                    return;
                }
            } catch (err) {
                logger.warn('[ExternalClient] Failed to recover JWT token:', err);
            }
        }

        // Last resort: try to get from API key (only for non-external messages)
        if (this.apiKey && !this.req.isServiceRequest) {
            try {
                const user = await getUserById(this.apiKey);
                if (user) {
                    this.user = user._id || user.id;
                    logger.info('[ExternalClient] Using user from API key:', this.user);
                    return;
                }
            } catch (err) {
                logger.warn('[ExternalClient] Failed to get user from API key:', err);
            }
        }

        if (!this.user) {
            logger.error('[ExternalClient] No user found in any source');
            throw new Error('User not authenticated');
        }

        logger.info('[ExternalClient] Client initialized successfully');
        logger.info('[ExternalClient] Initialized with options:', {
            endpoint: this.endpoint,
            endpointType: this.endpointType,
            model: this.model,
            agent_id: this.options.agent_id,
            user: this.user,
            phoneNumber: this.req.phoneNumber
        });
    }

    // Helper function to map roles to valid OpenAI roles
    mapRoleToOpenAI(role) {
        const roleMap = {
            'external': 'user',  // Map external messages to user role
            'assistant': 'assistant',
            'system': 'system',
            'user': 'user',
            'function': 'function',
            'tool': 'tool',
            'developer': 'developer'
        };
        return roleMap[role] || 'user';  // Default to user role if unknown
    }

    async sendMessage(message, opts = {}) {
        logger.info('[ExternalClient] Processing external message');
        logger.info('[ExternalClient] Options:', {
            user: this.user,
            endpoint: this.endpoint,
            model: this.model,
            conversationId: this.options.conversationId
        });

        if (!this.user) {
            logger.error('[ExternalClient] User not authenticated');
            throw new Error('User not authenticated');
        }

        // Convert string message to object if needed
        const messageObj = typeof message === 'string' ? { content: message } : message;

        // CRITICAL FIX: Set conversation ID from options BEFORE creating/finding conversation
        if (!messageObj.conversationId && this.options.conversationId) {
            messageObj.conversationId = this.options.conversationId;
            logger.info('[ExternalClient] Set conversationId from options:', this.options.conversationId);
        }

        // First try to create conversation if needed
        let conversation = null;
        try {
            logger.info('[ExternalClient] Attempting to find/create conversation');
            conversation = await this.createConversationIfNeeded(messageObj);
            if (conversation) {
                logger.info('[ExternalClient] Created/found conversation:', conversation.conversationId);
                messageObj.conversationId = conversation.conversationId;
                // Update client properties from conversation
                this.endpoint = conversation.endpoint;
                this.model = conversation.model;
            }
        } catch (error) {
            logger.error('[ExternalClient] Error creating/finding conversation:', error);
            throw error;
        }

        // Use the conversationId from either the message or opts
        const finalConversationId = messageObj.conversationId || opts.conversationId;
        if (!finalConversationId) {
            throw new Error('Conversation ID is required for external messages');
        }

        // Extract the message content
        let messageText;
        if (messageObj?.content) {
            messageText = typeof messageObj.content === 'string' ? messageObj.content : messageObj.content[0]?.text || '';
        } else if (messageObj?.text) {
            messageText = messageObj.text;
        } else {
            messageText = '';
        }

        // Get the last message in the conversation to ensure proper threading
        let parentMessageId = opts.parentMessageId || null;
        try {
            const { getMessages } = require('~/models');
            const messages = await getMessages({ conversationId: finalConversationId });
            if (messages && messages.length > 0) {
                // Get the last message that isn't an error message and isn't already a child
                const lastValidMessage = [...messages].reverse().find(msg =>
                    !msg.error &&
                    !messages.some(m => m.parentMessageId === msg.messageId)
                );
                if (lastValidMessage) {
                    parentMessageId = lastValidMessage.messageId;
                    logger.info('[ExternalClient] Set parentMessageId from last valid message:', parentMessageId);
                }
            }
        } catch (error) {
            logger.warn('[ExternalClient] Failed to get last message for parentMessageId:', error);
        }

        // Format the message for LLM processing
        const formattedMessage = {
            messageId: uuidv4(),
            conversationId: finalConversationId,
            parentMessageId: parentMessageId,
            role: 'external',
            openAIRole: this.mapRoleToOpenAI('external'),
            isCreatedByUser: false,
            text: messageText,
            content: [{ type: 'text', text: messageText }],
            user: this.user,
            endpoint: this.endpoint,
            metadata: {
                ...messageObj?.metadata,
                source: messageObj?.metadata?.source || 'external',
                createdBy: 'external-service'
            }
        };

        // Create a minimal request object for saveMessage
        const req = {
            user: { id: this.user },
            body: {
                role: 'external',
                user: 'system',
                isTemporary: false
            }
        };

        // Save the external message
        logger.info('[ExternalClient] Saving external message');
        const savedMessage = await saveMessage(
            req,
            formattedMessage,
            { context: 'ExternalClient.sendMessage' }
        );

        if (!savedMessage) {
            logger.error('[ExternalClient] Failed to save external message');
            throw new Error('Failed to save external message');
        }

        logger.info('[ExternalClient] External message saved successfully');

        // Process through LLM
        logger.info('[ExternalClient] Processing through LLM');
        const response = await this.processWithLLM(formattedMessage, { ...opts, conversationId: finalConversationId });

        // Save the LLM response with the same parent message ID
        logger.info('[ExternalClient] Saving LLM response');
        const llmResponse = {
            ...response,
            conversationId: finalConversationId,
            role: 'assistant',
            isCreatedByUser: false,
            messageId: uuidv4(),
            parentMessageId: savedMessage.messageId,
            user: this.user,
            endpoint: this.endpoint,
            metadata: {
                source: 'external',
                createdBy: 'external-service'
            }
        };

        // Use the same request object structure for consistency
        const llmReq = {
            user: { id: this.user },
            body: {
                role: 'external',
                user: 'system',
                isTemporary: false
            }
        };

        logger.info(`[ExternalClient] Final request state before saveMessage: hasUser=${!!llmReq.user}, userId=${llmReq.user?.id}, bodyRole=${llmReq.body?.role}, bodyUser=${llmReq.body?.user}, bodyUserType=${typeof llmReq.body?.user}, messageId=${llmResponse.messageId}, conversationId=${llmResponse.conversationId}`);

        try {
            const savedResponse = await saveMessage(
                llmReq,
                llmResponse,
                { context: 'ExternalClient.sendMessage - LLM Response' }
            );

            if (!savedResponse) {
                logger.error('[ExternalClient] Failed to save LLM response - saveMessage returned null');
                throw new Error('Failed to save LLM response');
            }

            logger.info('[ExternalClient] LLM response saved successfully:', {
                messageId: savedResponse.messageId,
                conversationId: savedResponse.conversationId
            });

            // Enhanced logging for broadcasting
            logger.info('[ExternalClient] About to broadcast messages:', {
                userId: this.user,
                userType: typeof this.user,
                conversationId: savedMessage.conversationId,
                messageCount: 1,
                savedResponseId: savedResponse.messageId
            });

            // Ensure user ID is a string for SSE broadcasting
            const userIdString = this.getUserIdString();
            logger.info('[ExternalClient] Converting user ID for SSE broadcasting:', {
                originalUserId: this.user,
                userIdString: userIdString,
                originalType: typeof this.user,
                stringType: typeof userIdString
            });

            // Check if user has active SSE connections
            const { hasActiveUser } = require('~/server/sseClients');
            const hasActiveConnection = hasActiveUser(userIdString);
            logger.info('[ExternalClient] User SSE connection status:', {
                userId: userIdString,
                hasActiveConnection
            });

            // Only broadcast the LLM response, not the user message
            broadcastToUsers([userIdString], 'newMessage', {
                conversationId: savedMessage.conversationId,
                messages: [savedResponse],
                timestamp: new Date().toISOString()
            });

            logger.info('[ExternalClient] Broadcast completed for newMessage event');

            // Return the conversation ID for reference
            return {
                conversationId: finalConversationId,
                messageId: savedMessage.messageId,
                responseId: savedResponse.messageId
            };
        } catch (error) {
            logger.error('[ExternalClient] Error saving LLM response:', {
                error: error.message,
                stack: error.stack,
                requestState: {
                    hasUser: !!llmReq.user,
                    userId: llmReq.user?.id,
                    bodyRole: llmReq.body?.role,
                    bodyUser: llmReq.body?.user
                }
            });
            throw error;
        }
    }

    async processWithLLM(message, opts = {}) {
        // Get the conversation to determine the correct endpoint type
        const conversation = await getConvo(null, message.conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        // Use the conversation's endpoint type for LLM initialization
        const llmEndpointType = conversation.endpointType || 'openAI';  // Default to OpenAI if not specified
        logger.info(`[ExternalClient] Using LLM endpoint type: ${llmEndpointType}`);

        // Map endpoint type to correct case
        const endpointMap = {
            'openai': 'openAI',
            'azureopenai': 'azureOpenAI',
            'anthropic': 'anthropic',
            'google': 'google',
            'custom': 'custom',
            'agents': 'agents',
            'bedrock': 'bedrock',
            'gptplugins': 'gptPlugins',
            'assistants': 'assistants',
            'azureassistants': 'azureAssistants'
        };

        const correctEndpointType = endpointMap[llmEndpointType.toLowerCase()] || llmEndpointType;
        logger.info(`[ExternalClient] Mapped endpoint type: ${correctEndpointType}`);

        // Get the appropriate LLM client based on conversation endpoint
        let initializeModule;
        try {
            initializeModule = require(`../${correctEndpointType}/initialize`);
        } catch (error) {
            logger.error('[ExternalClient] Failed to load initialization module:', error);
            throw new Error(`Failed to load initialization module for endpoint type: ${correctEndpointType}`);
        }

        const initializeLLMClient = initializeModule.initializeClient || initializeModule;

        if (typeof initializeLLMClient !== 'function') {
            throw new Error(`Failed to load LLM client initializer for endpoint type: ${correctEndpointType}`);
        }

        // Prepare endpoint options
        const endpointOption = {
            endpoint: correctEndpointType,
            modelOptions: {
                model: conversation.model || this.model
            }
        };

        // Handle agent endpoint
        if (correctEndpointType === 'agents') {
            logger.info('[ExternalClient] Loading agent for external message');
            const { loadAgent } = require('~/models/Agent');
            const agent = await loadAgent({
                req: this.req,
                agent_id: this.options.agent_id,
                endpoint: correctEndpointType,
                model_parameters: this.options.model_parameters
            });

            if (!agent) {
                logger.error('[ExternalClient] Agent not found');
                throw new Error('Agent not found');
            }

            endpointOption.agent = Promise.resolve(agent);
            endpointOption.agent_id = this.options.agent_id;
            logger.info('[ExternalClient] Agent loaded successfully');
        }

        logger.info('[ExternalClient] Initializing LLM client with options:', {
            endpoint: endpointOption.endpoint,
            model: endpointOption.modelOptions.model,
            agent_id: endpointOption.agent_id
        });

        // Ensure user information is available in the request
        if (!this.req.user) {
            this.req.user = { id: this.user };
        } else if (!this.req.user.id) {
            this.req.user.id = this.user;
        }

        // Add API key and conversation details to the request body for the LLM client
        this.req.body = {
            ...this.req.body,
            apiKey: this.apiKey,
            model: conversation.model || this.model,
            endpoint: correctEndpointType,
            conversation: conversation,
            user: 'system', // Set to 'system' string for external authentication
            role: 'external' // Ensure external role is set for LLM client
        };

        const { client } = await initializeLLMClient({
            req: this.req,
            res: this.res,
            endpointOption
        });

        logger.info(`[ExternalClient] Processing with ${correctEndpointType} client`);

        // Format the message with the correct role for the LLM
        const llmMessage = {
            text: message.text || message.content[0].text,
            role: this.mapRoleToOpenAI(message.role),
            conversationId: message.conversationId,
            parentMessageId: message.parentMessageId
        };

        // Process the message through the LLM
        const response = await client.sendMessage(llmMessage.text, {
            conversationId: llmMessage.conversationId,
            parentMessageId: llmMessage.parentMessageId,
            role: llmMessage.role,
            onProgress: (token) => {
                logger.debug(`[ExternalClient] Received token: ${token}`);
            }
        });

        logger.info('[ExternalClient] LLM processing complete');
        return response;
    }

    async buildMessages(messages, parentMessageId) {
        // Format messages for LLM processing with mapped roles
        return messages.map(msg => ({
            role: this.mapRoleToOpenAI(msg.role),
            content: msg.text || (msg.content?.[0]?.text || '')
        }));
    }

    async findExistingConversation(conversationId) {
        try {
            const existingConversation = await getConvo(null, conversationId);
            if (existingConversation) {
                logger.info('[ExternalClient] Found existing conversation:', conversationId);
                // Update the user ID to match the existing conversation
                this.user = existingConversation.user;
                // Update endpoint and model from existing conversation
                this.endpoint = existingConversation.endpoint;
                this.model = existingConversation.model;
                return existingConversation;
            }
        } catch (error) {
            logger.error('[ExternalClient] Error getting existing conversation:', error);
        }
        return null;
    }

    async findExistingSMSConversation(phoneNumber) {
        try {
            const existingConversations = await getConvo(this.user, null, {
                'metadata.phoneNumber': phoneNumber,
                'metadata.source': 'sms'
            });

            if (existingConversations && existingConversations.length > 0) {
                // Use the most recent conversation
                const recentConversation = existingConversations[0];
                logger.info('[ExternalClient] Found existing SMS conversation:', recentConversation.conversationId);

                // Update client properties from existing conversation
                this.endpoint = recentConversation.endpoint;
                this.model = recentConversation.model;

                return recentConversation;
            }
        } catch (error) {
            logger.warn('[ExternalClient] Error finding existing SMS conversation:', error);
        }
        return null;
    }

    async createNewConversation(message, phoneNumber) {
        // Ensure we have a valid user ID
        if (!this.user) {
            logger.error('[ExternalClient] No valid user ID available for conversation creation');
            throw new Error('User ID is required for conversation creation');
        }

        // Create new conversation
        const newConversation = {
            conversationId: message.conversationId || uuidv4(),
            title: message.metadata?.title || `SMS Conversation with ${phoneNumber}`,
            endpoint: this.endpoint,
            model: this.model,
            user: this.user,
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                ...message.metadata,
                phoneNumber: phoneNumber,
                source: 'sms',
                createdBy: 'external-service',
                lastMessage: new Date()
            }
        };

        logger.info('[ExternalClient] Creating new SMS conversation:', newConversation.conversationId);

        // Create a minimal request object for saveConvo
        const req = {
            user: { id: this.user },
            body: { isTemporary: false },
            isServiceRequest: true
        };

        try {
            const conversation = await saveConvo(
                req,
                newConversation,
                {
                    context: 'ExternalClient.createNewConversation',
                    isExternalMessage: true
                }
            );

            if (!conversation) {
                throw new Error('Failed to create conversation');
            }

            logger.info('[ExternalClient] Successfully created SMS conversation:', conversation.conversationId);

            // Broadcast the new conversation
            const userIdString = conversation.user.toString();
            broadcastNewConversation(userIdString, conversation);

            return conversation;
        } catch (error) {
            if (error.code === 11000 && error.codeName === 'DuplicateKey') {
                // If we get a duplicate key error, it means the conversation was created in parallel
                const existingConversation = await getConvo(null, newConversation.conversationId);
                if (existingConversation) {
                    logger.info('[ExternalClient] Retrieved existing conversation after duplicate key error:', existingConversation.conversationId);
                    this.user = existingConversation.user;
                    this.endpoint = existingConversation.endpoint;
                    this.model = existingConversation.model;
                    return existingConversation;
                }
            }
            throw error;
        }
    }

    async createConversationIfNeeded(message) {
        // If we have a conversationId in the message, try to get the conversation
        if (message.conversationId) {
            const existingConversation = await this.findExistingConversation(message.conversationId);
            if (existingConversation) {
                return existingConversation;
            }
            logger.info('[ExternalClient] No conversation found with ID, creating new one:', message.conversationId);
        }

        // Get phone number from request metadata
        const phoneNumber = this.req.phoneNumber;
        if (!phoneNumber) {
            logger.error('[ExternalClient] No phone number available for conversation creation');
            throw new Error('Phone number is required for SMS conversation creation');
        }

        // Try to find existing conversation for this phone number
        const existingSMSConversation = await this.findExistingSMSConversation(phoneNumber);
        if (existingSMSConversation) {
            return existingSMSConversation;
        }

        // Create new conversation
        return await this.createNewConversation(message, phoneNumber);
    }

    validateConversation(conversation) {
        if (!conversation) return false;
        if (!conversation.conversationId) return false;
        if (!conversation.user) return false;
        if (!conversation.endpoint) return false;
        return true;
    }

    async handleConversationError(error, message) {
        logger.error('[ExternalClient] Conversation error:', error);
        if (error.code === 'CONVERSATION_NOT_FOUND') {
            // Try to create conversation
            return await this.createConversationIfNeeded(message);
        }
        throw error;
    }

    // Helper function to ensure user ID is always a string for SSE operations
    getUserIdString() {
        if (!this.user) {
            throw new Error('User not set');
        }

        // Convert to string regardless of original format (ObjectId, Buffer, or string)
        const userIdString = this.user.toString();
        logger.debug('[ExternalClient] User ID conversion:', {
            original: this.user,
            originalType: typeof this.user,
            converted: userIdString,
            convertedType: typeof userIdString
        });

        return userIdString;
    }
}

const buildOptions = async ({ req, res, endpointOption }) => {
    logger.info('[ExternalClient] Building options');
    const { conversation } = req;
    if (!conversation) {
        throw new Error('Conversation is required for external client initialization');
    }

    return {
        req,
        res,
        user: conversation.user,
        endpoint: conversation.endpoint,
        endpointType: conversation.endpointType || conversation.endpoint,
        model: conversation.model,
        agent_id: conversation.agent_id,
        ...endpointOption
    };
};

// Export the class directly
module.exports = ExternalClient;
// Also export buildOptions as a property
module.exports.buildOptions = buildOptions; 