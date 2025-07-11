// External Endpoint Client

const BaseClient = require('~/app/clients/BaseClient');
const { logger } = require('~/config');
const { v4: uuidv4 } = require('uuid');
const { saveMessage, getUserById, saveConvo } = require('~/models');
const { getConvo } = require('~/models/Conversation');
const { Conversation } = require('~/db/models');
const { broadcastToUsers, broadcastNewConversation } = require('~/server/sseClients');
const { SystemRoles } = require('librechat-data-provider');
const { ObjectId } = require('mongodb');
const { User } = require('~/db/models');

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

        // CRITICAL FIX: Don't default endpoint to 'external' - determine it properly
        // 'external' is the message role, not the processing endpoint
        this.endpoint = options.endpoint || 'openAI';  // Default to OpenAI instead of 'external'
        this.sender = 'External';
        this.req = options.req;
        this.res = options.res;
        this.model = options.model || 'gpt-4o';
        this.endpointType = options.endpointType || options.endpoint || 'openAI';
        this.options = {
            ...options,
            agent_id: options.agent_id,
            model_parameters: options.model_parameters,
            conversationId: options.conversationId
        };
        this.user = null;
    }

    // Helper function to check if conversation ID is a placeholder
    isPlaceholderConversationId(conversationId) {
        const placeholderIds = [
            'sms-conversation',
            'external-message',
            'external-sms',
            'placeholder'
        ];
        return placeholderIds.includes(conversationId);
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

        // PRIORITY 1: Always use phone number-based user from validateExternalMessage for external messages
        if (this.req.user) {
            // Ensure we have the full user object, not just the ID
            if (typeof this.req.user === 'string' || this.req.user instanceof ObjectId) {
                this.user = this.req.user;
            } else {
                this.user = this.req.user._id || this.req.user.id;
            }
            logger.info('[ExternalClient] Using phone number-based user from request (PRIORITY):', {
                userId: typeof this.user === 'object' ? this.user.toString() : this.user,
                phoneNumber: this.req.phoneNumber
            });
            return;
        }

        // PRIORITY 2: If we somehow don't have a user from the request (shouldn't happen),
        // try other methods as fallback
        if (this.options.user) {
            this.user = this.options.user._id || this.options.user.id;
            logger.info('[ExternalClient] Using user from options:', this.user);
            return;
        }

        // PRIORITY 3: Only use conversation owner as last resort for non-external messages
        // NOTE: This should not happen for external messages since validateExternalMessage sets req.user
        if (this.options.conversationId) {
            try {
                logger.info('[ExternalClient] Attempting to get conversation:', this.options.conversationId);
                const conversation = await getConvo(null, this.options.conversationId);
                logger.info('[ExternalClient] Conversation found:', conversation ? 'Yes' : 'No');
                if (conversation && conversation.user) {
                    this.user = conversation.user;
                    logger.warn('[ExternalClient] FALLBACK: Using user from conversation owner (this should not happen for external messages):', this.user);
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
        logger.debug('[ExternalClient] Processing external message');
        logger.debug('[ExternalClient] Options:', {
            user: typeof this.user === 'object' ? this.user.toString() : this.user,
            userType: typeof this.user,
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

        // Handle media attachments from MMS
        if (this.options.attachments && this.options.attachments.length > 0) {
            logger.info('[ExternalClient] Processing', this.options.attachments.length, 'MMS media attachment(s)');
            // Set attachments for processing by the underlying client (as Promise for LibreChat compatibility)
            this.options.attachments = Promise.resolve(this.options.attachments);
        } else {
            logger.debug('[ExternalClient] No MMS attachments to process');
        }

        // CRITICAL FIX: Set conversation ID from options BEFORE creating/finding conversation
        if (!messageObj.conversationId && this.options.conversationId) {
            messageObj.conversationId = this.options.conversationId;
            logger.debug(`[ExternalClient] Set conversationId from options: ${this.options.conversationId}`);
        }

        // First try to create conversation if needed
        let conversation = null;
        try {
            logger.debug('[ExternalClient] Attempting to find/create conversation');
            conversation = await this.createConversationIfNeeded(messageObj);
            if (conversation) {
                logger.debug(`[ExternalClient] Created/found conversation: ${conversation.conversationId}`);
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
                // Sort messages by createdAt to get the actual last message
                const sortedMessages = messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

                // Get the last message that isn't an error message
                const lastValidMessage = [...sortedMessages].reverse().find(msg => !msg.error);

                if (lastValidMessage) {
                    parentMessageId = lastValidMessage.messageId;
                    logger.info('[ExternalClient] Set parentMessageId from last valid message:', {
                        parentMessageId,
                        lastMessageText: lastValidMessage.text?.substring(0, 50) + '...',
                        lastMessageRole: lastValidMessage.role,
                        lastMessageCreatedAt: lastValidMessage.createdAt
                    });
                }
            }
        } catch (error) {
            logger.warn('[ExternalClient] Failed to get last message for parentMessageId:', error);
        }

        // Process through LLM directly - let BaseClient handle all message creation
        logger.info('[ExternalClient] Processing through LLM');
        const formattedMessage = {
            text: messageText,
            content: [{ type: 'text', text: messageText }],
            conversationId: finalConversationId,
            parentMessageId: parentMessageId,
            metadata: {
                ...messageObj?.metadata,
                source: messageObj?.metadata?.source || 'external',
                createdBy: 'external-service'
            }
        };

        const response = await this.processWithLLM(formattedMessage, {
            ...opts,
            conversationId: finalConversationId,
            parentMessageId: parentMessageId
        });

        // Return the conversation ID for reference
        return {
            conversationId: finalConversationId,
            messageId: response.messageId,
            responseId: response.messageId
        };
    }

    async processWithLLM(message, opts = {}) {
        // Get the conversation to determine the correct endpoint type
        const conversation = await getConvo(null, message.conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        // Check for agent endpoint in message metadata first, then fall back to conversation
        const requestedEndpoint = message.metadata?.endpoint || conversation.endpoint;

        // Use the requested endpoint or conversation's endpoint type for LLM initialization
        const llmEndpointType = requestedEndpoint || conversation.endpointType || 'openAI';  // Default to OpenAI if not specified
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
            },
            attachments: this.options.attachments // Pass through MMS media attachments
        };

        // Pass attachments to agent client for automatic image processing
        if (this.options.attachments) {
            // Check if attachments is a Promise (from previous processing) or an array
            if (this.options.attachments instanceof Promise) {
                const attachments = await this.options.attachments;
                logger.info('[ExternalClient] Passing', attachments.length, 'attachment(s) to agent for vision processing');
                // Let AgentClient handle image encoding automatically via addImageURLs
                endpointOption.attachments = Promise.resolve(attachments);
            } else if (Array.isArray(this.options.attachments)) {
                logger.info('[ExternalClient] Passing', this.options.attachments.length, 'attachment(s) to agent for vision processing');
                endpointOption.attachments = Promise.resolve(this.options.attachments);
            }
        }

        // Ensure user information is available in the request BEFORE agent loading
        if (!this.req.user) {
            this.req.user = { id: this.user };
        } else if (!this.req.user.id) {
            this.req.user.id = this.user;
        }

        logger.info('[ExternalClient] User context set:', {
            userId: this.req.user.id,
            userType: typeof this.req.user.id
        });

        // Handle agent endpoint with enhanced detection
        if (correctEndpointType === 'agents') {
            // Set agent_id from message metadata or conversation or options
            const agent_id = message.metadata?.agent_id || conversation.agent_id || this.options.agent_id;
            if (agent_id) {
                this.options.agent_id = agent_id;
                logger.info(`[ExternalClient] Using agent_id: ${agent_id}`);
            }

            logger.info('[ExternalClient] Loading agent for external message');
            logger.debug('[ExternalClient] Agent loading parameters:', {
                agent_id: this.options.agent_id,
                endpoint: correctEndpointType,
                model_parameters: this.options.model_parameters,
                message_metadata: message.metadata
            });
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

            // BUGFIX: Ensure agent has proper model_parameters.model for external messages
            // This prevents "Cannot read properties of undefined (reading 'match')" errors
            logger.debug('[ExternalClient] Agent model_parameters check:', {
                'has_model_parameters': !!agent.model_parameters,
                'model_parameters': agent.model_parameters,
                'model_parameters.model': agent.model_parameters?.model,
                'agent.model': agent.model,
                'message.metadata': message.metadata
            });

            if (!agent.model_parameters) {
                logger.warn('[ExternalClient] Agent missing model_parameters, creating empty object');
                agent.model_parameters = {};
            }

            logger.debug('[ExternalClient] Checking model_parameters.model condition:', {
                'model_parameters.model': agent.model_parameters.model,
                'condition !agent.model_parameters.model': !agent.model_parameters.model,
                'typeof model': typeof agent.model_parameters.model
            });

            if (!agent.model_parameters.model) {
                // Use model from message metadata, agent's model property, or default
                logger.debug('[ExternalClient] Model fallback debug:', {
                    'message.metadata?.model': message.metadata?.model,
                    'agent.model': agent.model,
                    'this.model': this.model,
                    'agent object keys': Object.keys(agent),
                    'agent.model type': typeof agent.model
                });
                const modelToUse = message.metadata?.model || agent.model || this.model || 'gpt-4o';
                logger.warn('[ExternalClient] Agent missing model_parameters.model, setting to:', modelToUse);
                agent.model_parameters.model = modelToUse;
                logger.info('[ExternalClient] Set model_parameters.model for agent:', {
                    agent_id: agent.id,
                    model: agent.model_parameters.model
                });
            } else {
                logger.debug('[ExternalClient] Agent already has model_parameters.model:', agent.model_parameters.model);
            }

            endpointOption.agent = Promise.resolve(agent);
            endpointOption.agent_id = this.options.agent_id;

            // Extract and use dynamic instructions from message metadata
            if (message.metadata?.additional_instructions) {
                logger.info('[ExternalClient] Using additional instructions from metadata');
                endpointOption.additional_instructions = message.metadata.additional_instructions;
                logger.debug('[ExternalClient] Additional instructions:', {
                    additional_instructions: message.metadata.additional_instructions
                });
            } else if (message.metadata?.instructions) {
                logger.info('[ExternalClient] Using dynamic instructions from metadata');
                endpointOption.additional_instructions = message.metadata.instructions;
                logger.debug('[ExternalClient] Dynamic instructions:', {
                    instructions: message.metadata.instructions
                });
            }

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
        const sendOptions = {
            conversationId: llmMessage.conversationId,
            parentMessageId: llmMessage.parentMessageId,
            role: llmMessage.role,
            onProgress: (token) => {
                logger.debug(`[ExternalClient] Received token: ${token}`);
            }
        };

        // CRITICAL FIX: Include attachments in sendMessage call if they exist
        if (endpointOption.attachments) {
            sendOptions.attachments = endpointOption.attachments;
            logger.info(`[ExternalClient] Including attachments in LLM sendMessage call`);
        }

        const response = await client.sendMessage(llmMessage.text, sendOptions);

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
                logger.info(`[ExternalClient] Found existing conversation: ${conversationId}`);
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
            logger.info(`[ExternalClient] Searching for existing SMS conversation: ${phoneNumber}`);

            // CRITICAL FIX: User IDs are stored as STRINGS in the database, not ObjectIds!
            let searchUserId = this.user;

            // DEBUG: Check user type and format
            logger.debug(`[ExternalClient] User type detection:`, {
                user: this.user,
                userType: typeof this.user,
                isBuffer: this.user instanceof Buffer,
                isString: typeof this.user === 'string',
                isObjectId: this.user instanceof ObjectId,
                constructor: this.user?.constructor?.name
            });

            // Convert to string for database search (user IDs are stored as strings)
            if (this.user instanceof Buffer) {
                // Convert Buffer to hex string
                searchUserId = this.user.toString('hex');
                logger.debug(`[ExternalClient] Converted Buffer to string:`, {
                    original: this.user,
                    converted: searchUserId,
                    convertedType: typeof searchUserId
                });
            } else if (this.user instanceof ObjectId) {
                // Convert ObjectId to string
                searchUserId = this.user.toString();
                logger.debug(`[ExternalClient] Converted ObjectId to string:`, {
                    original: this.user,
                    converted: searchUserId,
                    convertedType: typeof searchUserId
                });
            } else if (typeof this.user === 'string') {
                // Already a string - perfect
                searchUserId = this.user;
                logger.debug(`[ExternalClient] User is already string:`, {
                    user: this.user,
                    type: typeof this.user
                });
            } else {
                // Try to convert to string
                logger.debug(`[ExternalClient] Converting unknown user type to string:`, {
                    user: this.user,
                    userType: typeof this.user,
                    constructor: this.user?.constructor?.name
                });
                searchUserId = this.user.toString();
                logger.debug(`[ExternalClient] Converted to string:`, {
                    original: this.user,
                    converted: searchUserId
                });
            }

            // DEBUG: Log search criteria
            logger.debug(`[ExternalClient] Search criteria:`, {
                user: searchUserId,
                userType: typeof searchUserId,
                phoneNumber: phoneNumber,
                phoneNumberType: typeof phoneNumber
            });

            // Primary search: Look for conversations with exact metadata match
            const existingConversations = await Conversation.find({
                user: searchUserId,
                'metadata.phoneNumber': phoneNumber,
                'metadata.source': 'sms'
            }).lean();

            logger.info(`[ExternalClient] Primary search found ${existingConversations.length} conversations`);

            // DEBUG: If we found conversations, log their metadata
            if (existingConversations.length > 0) {
                logger.debug(`[ExternalClient] Found conversations metadata:`,
                    existingConversations.map(c => ({
                        conversationId: c.conversationId,
                        user: c.user,
                        metadata: c.metadata,
                        updatedAt: c.updatedAt
                    }))
                );
            } else {
                // DEBUG: Let's check if there are ANY conversations for this user
                const userConversations = await Conversation.find({ user: searchUserId }).lean();
                logger.debug(`[ExternalClient] User has ${userConversations.length} total conversations`);

                if (userConversations.length > 0) {
                    logger.debug(`[ExternalClient] Sample user conversation metadata:`,
                        userConversations.slice(0, 3).map(c => ({
                            conversationId: c.conversationId,
                            hasMetadata: !!c.metadata,
                            metadata: c.metadata
                        }))
                    );
                }
            }

            if (existingConversations.length > 0) {
                const recentConversation = existingConversations.sort((a, b) =>
                    new Date(b.updatedAt) - new Date(a.updatedAt)
                )[0];

                logger.info(`[ExternalClient] Using existing conversation: ${recentConversation.conversationId}`);

                // Update client properties from existing conversation
                this.endpoint = recentConversation.endpoint;
                this.model = recentConversation.model;

                return recentConversation;
            }

            // Secondary search: Look for any conversation with phone number in metadata (broader search)
            const anyWithPhoneInMetadata = await Conversation.find({
                user: searchUserId,
                $or: [
                    { 'metadata.phoneNumber': phoneNumber },
                    { 'metadata.from': phoneNumber }
                ]
            }).lean();

            logger.info(`[ExternalClient] Secondary search found ${anyWithPhoneInMetadata.length} conversations`);

            // DEBUG: If secondary search found conversations, log their metadata
            if (anyWithPhoneInMetadata.length > 0) {
                logger.debug(`[ExternalClient] Secondary search found conversations:`,
                    anyWithPhoneInMetadata.map(c => ({
                        conversationId: c.conversationId,
                        user: c.user,
                        metadata: c.metadata,
                        updatedAt: c.updatedAt
                    }))
                );
            }

            if (anyWithPhoneInMetadata.length > 0) {
                const mostRecent = anyWithPhoneInMetadata.sort((a, b) =>
                    new Date(b.updatedAt) - new Date(a.updatedAt)
                )[0];

                logger.info(`[ExternalClient] Reusing and updating conversation: ${mostRecent.conversationId}`);

                // Update the conversation metadata to match our current expectations
                await Conversation.findOneAndUpdate(
                    { conversationId: mostRecent.conversationId },
                    {
                        $set: {
                            'metadata.phoneNumber': phoneNumber,
                            'metadata.source': 'sms',
                            'metadata.lastMessage': new Date()
                        }
                    }
                );

                return mostRecent;
            }

            logger.info(`[ExternalClient] No existing SMS conversation found for: ${phoneNumber}`);

            // DEBUG: Let's do a final check with different user ID formats to see if that's the issue
            const userIdString = typeof this.user === 'object' ? this.user.toString() : this.user;
            logger.debug(`[ExternalClient] Testing user ID format variations:`, {
                originalUser: this.user,
                originalUserType: typeof this.user,
                userIdString: userIdString,
                userIdStringType: typeof userIdString
            });

            // Try a more flexible search to see if user ID format is the issue
            const flexibleSearch = await Conversation.find({
                $or: [
                    { user: searchUserId },
                    { user: userIdString },
                    { user: this.user }
                ],
                'metadata.phoneNumber': phoneNumber
            }).lean();

            if (flexibleSearch.length > 0) {
                logger.warn(`[ExternalClient] FOUND CONVERSATIONS with flexible user search! This suggests user ID format mismatch.`);
                logger.debug(`[ExternalClient] Flexible search results:`,
                    flexibleSearch.map(c => ({
                        conversationId: c.conversationId,
                        user: c.user,
                        userType: typeof c.user,
                        metadata: c.metadata
                    }))
                );
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

        // Check if this is a scheduled message
        const isScheduledMessage = this.req.isScheduledMessage ||
            message.metadata?.source === 'scheduled' ||
            message.metadata?.source === 'scheduled-task' ||
            message.metadata?.type === 'scheduled' ||
            message.metadata?.taskName;

        // Check if this is an agent request
        const isAgentRequest = message.metadata?.endpoint === 'agents' && message.metadata?.agent_id;
        const endpoint = isAgentRequest ? 'agents' : this.endpoint;
        const model = isAgentRequest ? (message.metadata?.model || 'gpt-4o') : this.model;

        // Determine conversation title and source
        let title, source;
        if (isScheduledMessage) {
            title = message.metadata?.title ||
                (message.metadata?.taskName ? `Scheduled: ${message.metadata.taskName}` : 'Scheduled Message');
            source = 'scheduled';
        } else if (isAgentRequest) {
            title = message.metadata?.title || `Agent Conversation with ${phoneNumber}`;
            source = 'sms';
        } else {
            title = message.metadata?.title || `SMS Conversation with ${phoneNumber}`;
            source = 'sms';
        }

        // Generate conversation ID - don't use placeholder IDs from routing
        const isUsingPlaceholder = message.conversationId && this.isPlaceholderConversationId(message.conversationId);
        const conversationId = (message.conversationId && !isUsingPlaceholder) ? message.conversationId : uuidv4();

        if (isUsingPlaceholder) {
            logger.info(`[ExternalClient] Generating new conversation ID instead of using placeholder: ${message.conversationId}`);
        }

        // Create new conversation
        const newConversation = {
            conversationId: conversationId,
            title: title,
            endpoint: endpoint,
            model: model,
            user: this.user,
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                ...message.metadata,
                ...(phoneNumber && { phoneNumber: phoneNumber }),
                source: source,
                createdBy: 'external-service',
                lastMessage: new Date()
            }
        };

        // Add agent_id to conversation if this is an agent request
        if (isAgentRequest) {
            newConversation.agent_id = message.metadata.agent_id;
            logger.info('[ExternalClient] Creating agent conversation:', {
                conversationId: newConversation.conversationId,
                agent_id: newConversation.agent_id,
                endpoint: newConversation.endpoint,
                source: source
            });
        } else if (isScheduledMessage) {
            logger.info('[ExternalClient] Creating scheduled conversation:', {
                conversationId: newConversation.conversationId,
                taskName: message.metadata?.taskName,
                endpoint: newConversation.endpoint
            });
        } else {
            logger.info(`[ExternalClient] Creating SMS conversation: ${newConversation.conversationId}`);
        }

        // Create a minimal request object for saveConvo
        // Ensure user ID is a string (convert ObjectId/Buffer to string)
        const userId = typeof this.user === 'object' ? this.user.toString() : this.user;
        const req = {
            user: { id: userId },
            body: { isTemporary: false },
            isServiceRequest: true
        };

        // Debug the request object being passed to saveConvo
        logger.debug('[ExternalClient] saveConvo request object:', {
            hasUser: !!req.user,
            userId: req.user?.id,
            userIdType: typeof req.user?.id,
            isServiceRequest: req.isServiceRequest,
            isTemporary: req.body?.isTemporary
        });

        try {
            logger.info(`[ExternalClient] Creating ${source} conversation: ${newConversation.conversationId}`);



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

            logger.info(`[ExternalClient] Successfully created conversation: ${conversation.conversationId}`);

            // Broadcast the new conversation
            const userIdString = conversation.user.toString();
            broadcastNewConversation(userIdString, conversation);

            return conversation;
        } catch (error) {
            if (error.code === 11000 && error.codeName === 'DuplicateKey') {
                // If we get a duplicate key error, it means the conversation was created in parallel
                const existingConversation = await getConvo(null, newConversation.conversationId);
                if (existingConversation) {
                    logger.info(`[ExternalClient] Retrieved existing conversation after duplicate key error: ${existingConversation.conversationId}`);
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
        // Check if we're using a placeholder conversation ID (for SMS routing)
        const isUsingPlaceholder = message.conversationId && this.isPlaceholderConversationId(message.conversationId);

        // If we have a conversationId and it's NOT a placeholder, try to get the conversation
        if (message.conversationId && !isUsingPlaceholder) {
            const existingConversation = await this.findExistingConversation(message.conversationId);
            if (existingConversation) {
                return existingConversation;
            }
            logger.info(`[ExternalClient] No conversation found with ID, will create new one: ${message.conversationId}`);
        } else if (isUsingPlaceholder) {
            logger.info(`[ExternalClient] Ignoring placeholder conversation ID: ${message.conversationId}, using phone number-based discovery`);
        }

        // Check if this is a scheduled message
        const isScheduledMessage = this.req.isScheduledMessage ||
            message.metadata?.source === 'scheduled' ||
            message.metadata?.source === 'scheduled-task' ||
            message.metadata?.type === 'scheduled' ||
            message.metadata?.taskName;

        if (isScheduledMessage) {
            logger.info('[ExternalClient] Scheduled message detected, skipping phone number requirement');

            // For scheduled messages, we should have a conversation ID
            if (!message.conversationId) {
                logger.error('[ExternalClient] Scheduled message must have a conversation ID');
                throw new Error('Scheduled message must have a conversation ID');
            }

            // This shouldn't happen since we should have found the conversation above
            logger.warn('[ExternalClient] Creating new conversation for scheduled message (unexpected)');
            return await this.createNewConversation(message, null);
        }

        // Get phone number from request metadata (for SMS messages)
        const phoneNumber = this.req.phoneNumber;
        if (!phoneNumber) {
            logger.error('[ExternalClient] No phone number available for conversation creation');
            throw new Error('Phone number is required for SMS conversation creation');
        }

        // Try to find existing conversation for this phone number
        const existingSMSConversation = await this.findExistingSMSConversation(phoneNumber);

        if (existingSMSConversation) {
            logger.info(`[ExternalClient] Reusing existing SMS conversation: ${existingSMSConversation.conversationId}`);
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

    async _resolveUser(phoneNumber) {
        try {
            // First try to find existing user by phone number
            const user = await User.findOne({ phoneNumber });
            if (phoneNumber) {
                logger.info('[ExternalClient] Using phone number-based user from request (PRIORITY):', {
                    phoneNumber,
                    userId: user._id.toString()
                });
                return user;
            }

            // If no phone number provided, use default user
            const defaultUser = await User.findOne({ email: 'sms-user@librechat.ai' });
            if (!defaultUser) {
                throw new Error('Default SMS user not found');
            }
            logger.info('[ExternalClient] Using default SMS user:', {
                userId: defaultUser._id.toString()
            });
            return defaultUser;
        } catch (error) {
            logger.error('[ExternalClient] Error resolving user:', error);
            throw error;
        }
    }

    async _initializeClient(options) {
        try {
            const { user, conversationId, agent_id } = options;

            // Log options with stringified user ID
            logger.info('[ExternalClient] Options:', {
                model: this.model,
                user: {
                    _id: user._id.toString(),
                    phoneNumber: user.phoneNumber
                }
            });

            // PRIORITY 1: Always use phone number-based user from validateExternalMessage for external messages
            if (this.req.user) {
                // Ensure we have the full user object, not just the ID
                if (typeof this.req.user === 'string' || this.req.user instanceof ObjectId) {
                    this.user = this.req.user;
                } else {
                    this.user = this.req.user._id || this.req.user.id;
                }
                logger.info('[ExternalClient] Using phone number-based user from request (PRIORITY):', {
                    phoneNumber: this.req.phoneNumber
                });
                return;
            }

            // PRIORITY 2: If we somehow don't have a user from the request (shouldn't happen),
            // try other methods as fallback
            if (this.options.user) {
                this.user = this.options.user._id || this.options.user.id;
                logger.info('[ExternalClient] Using user from options:', this.user);
                return;
            }

            // PRIORITY 3: Only use conversation owner as last resort for non-external messages
            // NOTE: This should not happen for external messages since validateExternalMessage sets req.user
            if (this.options.conversationId) {
                try {
                    logger.info('[ExternalClient] Attempting to get conversation:', this.options.conversationId);
                    const conversation = await getConvo(null, this.options.conversationId);
                    logger.info('[ExternalClient] Conversation found:', conversation ? 'Yes' : 'No');
                    if (conversation && conversation.user) {
                        this.user = conversation.user;
                        logger.warn('[ExternalClient] FALLBACK: Using user from conversation owner (this should not happen for external messages):', this.user);
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
        } catch (error) {
            logger.error('[ExternalClient] Error initializing client:', error);
            throw error;
        }
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