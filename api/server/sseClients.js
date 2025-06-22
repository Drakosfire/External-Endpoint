const { logger } = require('~/config');
// Simple in-memory registry for SSE clients
const clients = new Map(); // userId -> Set of res

function addClient(userId, res) {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);
    logger.info(`[SSE] Added client for user: ${userId}, total: ${clients.get(userId).size}`);

    // Clean up any existing disconnected clients for this user
    cleanupDisconnectedClients(userId);
}

function removeClient(userId, res) {
    if (clients.has(userId)) {
        clients.get(userId).delete(res);
        if (clients.get(userId).size === 0) clients.delete(userId);
        logger.info(`[SSE] Removed client for user: ${userId}, remaining: ${clients.get(userId)?.size || 0}`);
    }
}

function cleanupDisconnectedClients(userId) {
    if (!clients.has(userId)) return;

    const userClients = clients.get(userId);
    const disconnectedClients = new Set();

    for (const res of userClients) {
        if (res.writableEnded || res.destroyed) {
            disconnectedClients.add(res);
        }
    }

    for (const res of disconnectedClients) {
        removeClient(userId, res);
    }

    if (disconnectedClients.size > 0) {
        logger.debug(`[SSE] Cleaned up ${disconnectedClients.size} disconnected clients for user: ${userId}`);
    }
}

function getActiveUsers() {
    // Clean up disconnected clients before returning active users
    for (const userId of clients.keys()) {
        cleanupDisconnectedClients(userId);
    }

    return Array.from(clients.keys()).filter(userId => {
        const userClients = clients.get(userId);
        return userClients && userClients.size > 0;
    });
}

function hasActiveUser(userId) {
    cleanupDisconnectedClients(userId);
    return clients.has(userId) && clients.get(userId).size > 0;
}

function broadcastToUser(userId, event, data) {
    if (!clients.has(userId)) {
        logger.debug(`[SSE] No clients found for user: ${userId}`);
        return false;
    }

    const userClients = clients.get(userId);
    const disconnectedClients = new Set();
    let successfulBroadcasts = 0;

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
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
                res.setHeader('X-Accel-Buffering', 'no');
            }

            // Only write if the response is still writable
            if (!res.writableEnded) {
                const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
                res.write(eventData);

                // Try to flush if available
                if (typeof res.flush === 'function') {
                    res.flush();
                }

                successfulBroadcasts++;
                logger.debug(`[SSE] Successfully sent event '${event}' to user: ${userId}`);
            } else {
                disconnectedClients.add(res);
            }
        } catch (error) {
            logger.warn(`[SSE] Error broadcasting to user ${userId}:`, error.message);
            disconnectedClients.add(res);
        }
    }

    // Clean up disconnected clients
    for (const res of disconnectedClients) {
        removeClient(userId, res);
    }

    // Log results
    if (successfulBroadcasts > 0) {
        logger.info(`[SSE] Successfully broadcast '${event}' to ${successfulBroadcasts} client(s) for user: ${userId}`);
    } else {
        logger.warn(`[SSE] Failed to broadcast '${event}' to any clients for user: ${userId}`);
    }

    return successfulBroadcasts > 0;
}

function broadcastToUsers(userIds, event, data) {
    logger.info(`[SSE] Broadcasting '${event}' to users: ${userIds.join(', ')}`);
    let totalSuccessful = 0;

    for (const userId of userIds) {
        if (broadcastToUser(userId, event, data)) {
            totalSuccessful++;
        }
    }

    logger.info(`[SSE] Broadcast completed: ${totalSuccessful}/${userIds.length} users reached`);
    return totalSuccessful;
}

function broadcastNewConversation(userId, conversation) {
    if (!conversation || !conversation.conversationId) {
        logger.error('[SSE] Invalid conversation object for broadcast:', conversation);
        return false;
    }

    logger.info(`[SSE] Broadcasting new conversation to user: ${userId}, conversationId: ${conversation.conversationId}`);
    return broadcastToUser(userId, 'newConversation', {
        conversation,
        timestamp: new Date().toISOString()
    });
}

// Periodic cleanup of disconnected clients
setInterval(() => {
    logger.debug('[SSE] Running periodic cleanup of disconnected clients');
    for (const userId of clients.keys()) {
        cleanupDisconnectedClients(userId);
    }
}, 60000); // Clean up every minute

module.exports = {
    addClient,
    removeClient,
    getActiveUsers,
    hasActiveUser,
    broadcastToUser,
    broadcastToUsers,
    broadcastNewConversation,
    cleanupDisconnectedClients
};