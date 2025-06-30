const ExternalClient = require('./index');
const { logger } = require('~/config');

const initializeClient = async ({ req, res, endpointOption }) => {
    logger.info('[ExternalClient] Initializing client');

    const { conversation } = req;
    const apiKey = req.headers['x-api-key'];

    // For external messages, conversation might not exist yet - ExternalClient will handle creation
    if (!conversation && req.body && req.body.role !== 'external') {
        throw new Error('Conversation is required for external client initialization');
    }

    // Check if this is an agent request from the message metadata
    const isAgentRequest = req.body.metadata?.endpoint === 'agents' && req.body.metadata?.agent_id;

    // If no conversation exists (for external messages), create a minimal structure
    let clientOptions;
    if (!conversation && req.body && req.body.role === 'external') {
        // Extract conversationId from request params if available
        const conversationId = req.params?.conversationId || req.body?.conversationId;

        // Determine endpoint based on agent request or metadata
        // CRITICAL FIX: Don't default to 'external' - use proper LLM endpoint
        const requestedEndpoint = req.body.metadata?.endpoint;
        const endpoint = isAgentRequest ? 'agents' : (requestedEndpoint || 'openAI');
        const endpointType = isAgentRequest ? 'agents' : (requestedEndpoint || 'openAI');

        clientOptions = {
            req,
            res,
            conversationId, // Pass conversationId for lookup/creation
            endpoint: endpoint,
            endpointType: endpointType,
            model: req.body.metadata?.model || endpointOption?.modelOptions?.model || 'gpt-4o',
            attachments: endpointOption?.attachments, // Pass through MMS media attachments
            ...endpointOption
        };

        // Log attachment passing
        if (endpointOption?.attachments) {
            logger.info(`[External Initialize] Passing ${endpointOption.attachments.length} attachment(s) to client`);
        }

        // Add agent-specific options if this is an agent request
        if (isAgentRequest) {
            clientOptions.agent_id = req.body.metadata.agent_id;
            clientOptions.model_parameters = {
                model: req.body.metadata?.model || 'gpt-4o'
            };

            logger.info('[ExternalClient] Configured for agent request:', {
                agent_id: clientOptions.agent_id,
                endpoint: clientOptions.endpoint
            });
        }
    } else {
        // Use existing conversation structure
        clientOptions = {
            req,
            res,
            user: conversation.user,
            endpoint: conversation.endpoint,
            endpointType: conversation.endpointType || conversation.endpoint,
            model: conversation.model,
            agent_id: conversation.agent_id,
            ...endpointOption
        };
    }

    logger.info('[ExternalClient] Client options:', {
        user: clientOptions.user,
        endpoint: clientOptions.endpoint,
        endpointType: clientOptions.endpointType,
        model: clientOptions.model,
        agent_id: clientOptions.agent_id,
        conversationId: clientOptions.conversationId,
        isAgentRequest: isAgentRequest
    });

    // Create the external client with API key
    const client = new ExternalClient(apiKey, clientOptions);

    // Initialize the client
    await client.initialize();

    logger.info('[ExternalClient] Client initialized successfully', {
        endpoint: clientOptions.endpoint,
        endpointType: clientOptions.endpointType,
        model: clientOptions.model,
        user: clientOptions.user,
        agent_id: clientOptions.agent_id,
        conversationId: clientOptions.conversationId,
        isAgentRequest: isAgentRequest
    });

    return {
        client,
        endpoint: clientOptions.endpoint
    };
};

module.exports = {
    initializeClient
}; 