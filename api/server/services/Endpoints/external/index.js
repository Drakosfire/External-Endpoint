const BaseClient = require('~/app/clients/BaseClient');
const { logger } = require('~/config');
const { v4: uuidv4 } = require('uuid');
const { saveMessage, getUserById, saveConvo } = require('~/models');
const { getConvo } = require('~/models/Conversation');
const { broadcastToUsers } = require('~/server/sseClients');
const { SystemRoles } = require('librechat-data-provider');

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
            model_parameters: options.model_parameters
        };
        this.user = null;
    }

    async initialize() {
        logger.info('[ExternalClient] Initializing client');
        // Log only the relevant options without the request/response objects
        const { req, res, ...loggableOptions } = this.options;
        // logger.info('[ExternalClient] Client options:', JSON.stringify(loggableOptions, null, 2));
        // logger.info('[ExternalClient] Request object:', this.req ? 'Present' : 'Missing');
        // logger.info('[ExternalClient] Response object:', this.res ? 'Present' : 'Missing');

        if (!this.req || !this.res) {
            throw new Error('Request and response objects are required for ExternalClient initialization');
        }

        // First try to get user from options
        logger.info('[ExternalClient] Checking options.user:', this.options.user);
        if (this.options.user) {
            this.user = this.options.user;
            logger.info('[ExternalClient] Using user from options:', this.user);
        }

        // If no user in options, try to get from conversation owner
        logger.info('[ExternalClient] Checking conversationId:', this.options.conversationId);
        if (!this.user && this.options.conversationId) {
            try {
                logger.info('[ExternalClient] Attempting to get conversation:', this.options.conversationId);
                const conversation = await getConvo(null, this.options.conversationId);
                logger.info('[ExternalClient] Conversation found:', conversation ? 'Yes' : 'No');
                if (conversation && conversation.user) {
                    this.user = conversation.user;
                    logger.info('[ExternalClient] Using user from conversation owner:', this.user);
                }
            } catch (err) {
                logger.warn('[ExternalClient] Failed to get user from conversation:', err);
            }
        }

        // If still no user, try to recover from JWT token
        if (!this.user) {
            logger.info('[ExternalClient] Attempting to extract JWT token');
            const token = extractJwtToken(this.req);
            logger.info('[ExternalClient] JWT token found:', token ? 'Yes' : 'No');
            if (token) {
                try {
                    const jwt = require('jsonwebtoken');
                    const payload = jwt.verify(token, process.env.JWT_SECRET);
                    this.user = payload?.id;
                    if (this.user) {
                        logger.info('[ExternalClient] Recovered user from JWT token:', this.user);
                    }
                } catch (err) {
                    logger.warn('[ExternalClient] Failed to recover JWT token:', err);
                }
            }
        }

        // If still no user, try to get from request
        logger.info('[ExternalClient] Checking req.user:', this.req.user ? 'Present' : 'Missing');
        if (!this.user && this.req.user) {
            this.user = this.req.user.id;
            logger.info('[ExternalClient] Using user from request:', this.user);
        }

        // If still no user, try to get from API key
        logger.info('[ExternalClient] Checking API key:', this.apiKey ? 'Present' : 'Missing');
        if (!this.user && this.apiKey) {
            try {
                const user = await getUserById(this.apiKey);
                if (user) {
                    this.user = user.id;
                    logger.info('[ExternalClient] Using user from API key:', this.user);
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
            user: this.user
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
            model: this.model
        });

        if (!this.user) {
            logger.error('[ExternalClient] User not authenticated');
            throw new Error('User not authenticated');
        }

        // Convert string message to object if needed
        const messageObj = typeof message === 'string' ? { content: message } : message;

        // First try to create conversation if needed
        let conversation = null;
        try {
            conversation = await this.createConversationIfNeeded(messageObj);
            if (conversation) {
                logger.info('[ExternalClient] Created/found conversation:', conversation.conversationId);
                messageObj.conversationId = conversation.conversationId;
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

        // Format the message for LLM processing
        const formattedMessage = {
            messageId: uuidv4(),
            conversationId: finalConversationId,
            parentMessageId: opts.parentMessageId,
            role: 'external',  // Keep original role for our internal use
            openAIRole: this.mapRoleToOpenAI('external'),  // Add mapped role for OpenAI
            isCreatedByUser: false,
            text: messageText,  // Use the extracted text
            content: [{ type: 'text', text: messageText }],  // Format content array
            user: this.user,
            endpoint: this.endpoint,
            metadata: messageObj?.metadata || {}  // Preserve metadata if present
        };

        // Create a minimal request object for saveMessage
        const req = {
            user: { id: this.user },
            body: { isTemporary: false }
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

        // Save the LLM response
        logger.info('[ExternalClient] Saving LLM response');
        const llmResponse = {
            ...response,
            conversationId: finalConversationId,
            role: 'assistant',
            isCreatedByUser: false,
            messageId: uuidv4(),
            parentMessageId: savedMessage.messageId,
            user: this.user,
            endpoint: this.endpoint
        };

        const savedResponse = await saveMessage(
            req,
            llmResponse,
            { context: 'ExternalClient.sendMessage - LLM Response' }
        );

        if (!savedResponse) {
            logger.error('[ExternalClient] Failed to save LLM response');
            throw new Error('Failed to save LLM response');
        }

        logger.info('[ExternalClient] LLM response saved successfully');

        // Broadcast both messages in a single event
        broadcastToUsers([this.user], 'newMessage', {
            conversationId: savedMessage.conversationId,
            messages: [savedMessage, savedResponse]
        });

        // Return the conversation ID for reference
        return {
            conversationId: finalConversationId,
            messageId: savedMessage.messageId,
            responseId: savedResponse.messageId
        };
    }

    async processWithLLM(message, opts = {}) {
        // Get the conversation to determine the correct endpoint type
        const conversation = await getConvo(null, message.conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        // Use the conversation's endpoint type for LLM initialization
        const llmEndpointType = conversation.endpointType || 'openAI';  // Default to OpenAI if not specified
        logger.info('[ExternalClient] Using LLM endpoint type:', llmEndpointType);

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
        logger.info('[ExternalClient] Mapped endpoint type:', correctEndpointType);

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
        }

        // Add API key and conversation details to the request body for the LLM client
        this.req.body = {
            ...this.req.body,
            apiKey: this.apiKey,
            model: conversation.model || this.model,
            endpoint: correctEndpointType,
            conversation: conversation,
            user: this.user
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

    async createConversationIfNeeded(message) {
        // If we have a conversationId in the message, try to get the conversation
        if (message.conversationId) {
            try {
                const existingConversation = await getConvo(null, message.conversationId);
                if (existingConversation) {
                    logger.info('[ExternalClient] Found existing conversation:', message.conversationId);
                    return existingConversation;
                }
            } catch (error) {
                logger.warn('[ExternalClient] Error getting existing conversation:', error);
            }
        }

        // Create new conversation
        const newConversation = {
            conversationId: message.conversationId || uuidv4(),
            title: message.metadata?.title || 'New External Conversation',
            endpoint: this.endpoint,
            model: this.model,
            user: this.user,
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                ...message.metadata,
                source: message.metadata?.source || 'external',
                createdBy: 'external-service'
            }
        };

        logger.info('[ExternalClient] Creating new conversation:', newConversation.conversationId);

        // Create a minimal request object for saveConvo
        const req = {
            user: { id: this.user },
            body: { isTemporary: false }
        };

        const conversation = await saveConvo(
            req,
            newConversation,
            { context: 'ExternalClient.createConversationIfNeeded' }
        );

        if (!conversation) {
            throw new Error('Failed to create conversation');
        }

        logger.info('[ExternalClient] Successfully created conversation:', conversation.conversationId);
        return conversation;
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