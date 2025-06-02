const { getConvo, getMessages } = require('~/models');
const { logger } = require('~/config');

// Middleware to validate conversationId and user relationship
const validateMessageReq = async (req, res, next) => {
  let conversationId = req.params.conversationId || req.body.conversationId;

  if (conversationId === 'new') {
    return res.status(200).send([]);
  }

  if (!conversationId && req.body.message) {
    conversationId = req.body.message.conversationId;
  }

  // Allow external messages to bypass user validation
  if (req.body.role === 'external') {
    const conversation = await getConvo(null, conversationId);
    // Store conversation in request for later use (even if null)
    req.conversation = conversation;

    // For external messages, validate the parent message ID if provided
    if (req.body.parentMessageId) {
      try {
        const messages = await getMessages({ conversationId });
        const parentMessage = messages.find(msg => msg.messageId === req.body.parentMessageId);

        if (!parentMessage) {
          logger.warn('[validateMessageReq] Invalid parentMessageId provided:', req.body.parentMessageId);
          return res.status(400).json({ error: 'Invalid parent message ID' });
        }

        if (messages.some(msg => msg.parentMessageId === req.body.parentMessageId)) {
          logger.warn('[validateMessageReq] Parent message already has a child:', req.body.parentMessageId);
          return res.status(400).json({ error: 'Parent message already has a child' });
        }
      } catch (error) {
        logger.error('[validateMessageReq] Error validating parent message:', error);
        return res.status(500).json({ error: 'Error validating parent message' });
      }
    }

    return next();
  }

  const conversation = await getConvo(req.user.id, conversationId);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (conversation.user !== req.user.id) {
    return res.status(403).json({ error: 'User not authorized for this conversation' });
  }

  // For regular messages, also validate parent message ID
  if (req.body.parentMessageId) {
    try {
      const messages = await getMessages({ conversationId });
      const parentMessage = messages.find(msg => msg.messageId === req.body.parentMessageId);

      if (!parentMessage) {
        return res.status(400).json({ error: 'Invalid parent message ID' });
      }

      if (messages.some(msg => msg.parentMessageId === req.body.parentMessageId)) {
        return res.status(400).json({ error: 'Parent message already has a child' });
      }
    } catch (error) {
      logger.error('[validateMessageReq] Error validating parent message:', error);
      return res.status(500).json({ error: 'Error validating parent message' });
    }
  }

  next();
};

module.exports = validateMessageReq;
