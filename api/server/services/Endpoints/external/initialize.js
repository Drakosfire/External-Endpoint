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

    // If no conversation exists (for external messages), create a minimal structure
    let clientOptions;
    if (!conversation && req.body && req.body.role === 'external') {
        // Extract conversationId from request params if available
        const conversationId = req.params?.conversationId || req.body?.conversationId;

        clientOptions = {
            req,
            res,
            conversationId, // Pass conversationId for lookup/creation
            endpoint: 'external',
            endpointType: 'external',
            model: req.body.metadata?.model || endpointOption?.modelOptions?.model || 'gpt-4o',
            ...endpointOption
        };
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
        conversationId: clientOptions.conversationId
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
        conversationId: clientOptions.conversationId
    });

    return {
        client,
        endpoint: clientOptions.endpoint
    };
};

module.exports = {
    initializeClient
}; 