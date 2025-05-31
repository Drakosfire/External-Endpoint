const { logger } = require('~/config');
// Simple in-memory registry for SSE clients
const clients = new Map(); // userId -> Set of res

function addClient(userId, res) {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);
    logger.info(`[SSE] Added client for user: ${userId}, total: ${clients.get(userId).size}`);
}

function removeClient(userId, res) {
    if (clients.has(userId)) {
        clients.get(userId).delete(res);
        if (clients.get(userId).size === 0) clients.delete(userId);
        logger.info(`[SSE] Removed client for user: ${userId}, remaining: ${clients.get(userId)?.size || 0}`);
    }
}

function broadcastToUser(userId, event, data) {
    if (!clients.has(userId)) {
        logger.info(`[SSE] No clients found for user: ${userId}`);
        return;
    }

    const userClients = clients.get(userId);
    const disconnectedClients = new Set();

    for (const res of userClients) {
        try {
            // Check if the response is still writable
            if (res.writableEnded || res.destroyed) {
                disconnectedClients.add(res);
                continue;
            }

            // Set headers only if they haven't been sent and the response is still writable
            if (!res.headersSent && !res.writableEnded) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders();
            }

            // Only write if the response is still writable
            if (!res.writableEnded) {
                logger.info(`[SSE] Writing event to user: ${userId}, event: ${event}`);
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                res.flush();
            } else {
                disconnectedClients.add(res);
            }
        } catch (error) {
            logger.error(`[SSE] Error broadcasting to user ${userId}:`, error);
            disconnectedClients.add(res);
        }
    }

    // Clean up disconnected clients
    for (const res of disconnectedClients) {
        removeClient(userId, res);
    }

    // If no clients remain, log it
    if (!clients.has(userId) || clients.get(userId).size === 0) {
        logger.info(`[SSE] No active clients remaining for user: ${userId}`);
    }
}

function broadcastToUsers(userIds, event, data) {
    logger.info(`[SSE] Broadcasting to users: ${userIds}`);
    for (const userId of userIds) {
        broadcastToUser(userId, event, data);
    }
}

function broadcastNewConversation(userId, conversation) {
    if (!conversation || !conversation.conversationId) {
        logger.error('[SSE] Invalid conversation object for broadcast:', conversation);
        return;
    }

    logger.info(`[SSE] Broadcasting new conversation to user: ${userId}, conversationId: ${conversation.conversationId}`);
    broadcastToUser(userId, 'newConversation', {
        conversation,
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    addClient,
    removeClient,
    broadcastToUser,
    broadcastToUsers,
    broadcastNewConversation
};