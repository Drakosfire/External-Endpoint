const BaseClient = require('~/app/clients/BaseClient');
const { logger } = require('~/config');
const { v4: uuidv4 } = require('uuid');
const { saveMessage, getUserById } = require('~/models');
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

        if (!this.req || !this.res) {
            throw new Error('Request and response objects are required for ExternalClient initialization');
        }

        // Try to recover user from JWT token
        const token = extractJwtToken(this.req);
        if (token) {
            try {
                const jwt = require('jsonwebtoken');
                const payload = jwt.verify(token, process.env.JWT_SECRET);
                this.user = payload?.id;
                if (this.user) {
                    logger.info('[ExternalClient] Recovered user from JWT token');
                }
            } catch (err) {
                logger.warn('[ExternalClient] Failed to recover JWT token:', err);
            }
        }

        // If no user recovered from JWT, use the provided user
        if (!this.user) {
            this.user = options.user;
        }

        if (!this.user) {
            throw new Error('User ID is required for ExternalClient initialization');
        }

        logger.info('[ExternalClient] Initialized with options:', {
            endpoint: this.endpoint,
            endpointType: this.endpointType,
            model: this.model,
            agent_id: this.options.agent_id,
            user: this.user
        });
    }

    async sendMessage(message, opts = {}) {
        logger.info('[ExternalClient] Processing external message');
        logger.info('[ExternalClient] Options:', {
            user: this.user,
            endpoint: this.endpoint,
            model: this.model
        });

        const { conversationId, parentMessageId } = opts;
        if (!conversationId) {
            throw new Error('Conversation ID is required for external messages');
        }

        // Format the message for LLM processing
        const formattedMessage = {
            messageId: uuidv4(),
            conversationId,
            parentMessageId,
            role: 'external',
            isCreatedByUser: false,
            text: typeof message === 'string' ? message : (message?.text || ''),
            content: Array.isArray(message?.content) ? message.content : [{ type: 'text', text: message }],
            user: this.user,
            endpoint: this.endpoint
        };

        // Save the external message
        logger.info('[ExternalClient] Saving external message');
        const savedMessage = await saveMessage(
            { user: { id: this.user } },
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
        const response = await this.processWithLLM(formattedMessage, opts);

        // Save the LLM response
        logger.info('[ExternalClient] Saving LLM response');
        const llmResponse = {
            ...response,
            conversationId,
            role: 'assistant',
            isCreatedByUser: false,
            messageId: uuidv4(),
            parentMessageId: savedMessage.messageId,
            user: this.user,
            endpoint: this.endpoint
        };

        const savedResponse = await saveMessage(
            { user: { id: this.user } },
            llmResponse,
            { context: 'ExternalClient.sendMessage - LLM Response' }
        );

        if (!savedResponse) {
            logger.error('[ExternalClient] Failed to save LLM response');
            throw new Error('Failed to save LLM response');
        }

        logger.info('[ExternalClient] LLM response saved successfully');

        // Broadcast both messages
        broadcastToUsers([this.user], 'newMessage', {
            conversationId: savedMessage.conversationId,
            message: savedMessage,
        });

        broadcastToUsers([this.user], 'newMessage', {
            conversationId: savedResponse.conversationId,
            message: savedResponse,
        });

        return {
            message: savedMessage,
            response: savedResponse
        };
    }

    async processWithLLM(message, opts = {}) {
        // Get the appropriate LLM client based on conversation endpoint
        const { initializeClient: initializeLLMClient } = require(`~/server/services/Endpoints/${this.endpointType}/initialize`);

        // Prepare endpoint options
        const endpointOption = {
            endpoint: this.endpoint,
            modelOptions: {
                model: this.model
            }
        };

        // Handle agent endpoint
        if (this.endpoint === 'agents') {
            logger.info('[ExternalClient] Loading agent for external message');
            const { loadAgent } = require('~/models/Agent');
            const agent = await loadAgent({
                req: this.req,
                agent_id: this.options.agent_id,
                endpoint: this.endpoint,
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

        const { client } = await initializeLLMClient({
            req: this.req,
            res: this.res,
            endpointOption
        });

        logger.info(`[ExternalClient] Processing with ${this.endpointType} client`);

        // Process the message through the LLM
        const response = await client.sendMessage(message.text || message.content[0].text, {
            conversationId: message.conversationId,
            parentMessageId: message.parentMessageId,
            onProgress: (token) => {
                logger.debug(`[ExternalClient] Received token: ${token}`);
            }
        });

        logger.info('[ExternalClient] LLM processing complete');
        return response;
    }

    async buildMessages(messages, parentMessageId) {
        // Format messages for LLM processing
        return messages.map(msg => ({
            role: msg.role,
            content: msg.text || (msg.content?.[0]?.text || '')
        }));
    }
}

module.exports = ExternalClient; 