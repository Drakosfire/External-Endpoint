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
    }
}

function broadcastToUser(userId, event, data) {
    if (!clients.has(userId)) {
        logger.info(`[SSE] No clients found for user: ${userId}`);
        return;
    }
    logger.info(`[SSE] Broadcasting to user: ${userId}, client count: ${clients.get(userId).size}`);
    for (const res of clients.get(userId)) {
        logger.info(`[SSE] Writing event to user: ${userId}`);
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        res.flush();
    }
}

function broadcastToUsers(userIds, event, data) {
    logger.info(`[SSE] Broadcasting to users: ${userIds}`);
    for (const userId of userIds) {
        broadcastToUser(userId, event, data);
    }
}

module.exports = { addClient, removeClient, broadcastToUser, broadcastToUsers };