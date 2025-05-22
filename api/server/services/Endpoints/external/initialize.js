const { EModelEndpoint } = require('librechat-data-provider');
const ExternalClient = require('./index');
const { logger } = require('~/config');

const initializeClient = async ({ req, res, endpointOption }) => {
    logger.info('[ExternalClient] Initializing client');

    const { conversation } = req;
    if (!conversation) {
        throw new Error('Conversation is required for external client initialization');
    }

    const clientOptions = {
        req,
        res,
        user: conversation.user,
        endpoint: conversation.endpoint,
        endpointType: conversation.endpointType || conversation.endpoint, // Use endpointType if available, fallback to endpoint
        model: conversation.model,
        agent_id: conversation.agent_id,
        ...endpointOption
    };

    // If this is an agents endpoint, we need to pass the agent information
    if (conversation.endpoint === 'agents') {
        clientOptions.agent_id = conversation.agent_id;
        clientOptions.model_parameters = conversation.model_parameters;
    }

    logger.info('[ExternalClient] Client options:', {
        user: clientOptions.user,
        endpoint: clientOptions.endpoint,
        endpointType: clientOptions.endpointType,
        model: clientOptions.model,
        agent_id: clientOptions.agent_id
    });

    // Create the external client
    const client = new ExternalClient(null, clientOptions);

    logger.info('[ExternalClient] Client initialized successfully', {
        endpoint: conversation.endpoint,
        endpointType: conversation.endpointType,
        model: conversation.model,
        user: conversation.user,
        agent_id: clientOptions.agent_id
    });

    return {
        client,
        endpoint: conversation.endpoint
    };
};

module.exports = {
    initializeClient
}; 