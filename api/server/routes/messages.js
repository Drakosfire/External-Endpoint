const express = require('express');
const { ContentTypes } = require('librechat-data-provider');
const {
  saveConvo,
  saveMessage,
  getMessage,
  getMessages,
  updateMessage,
  deleteMessages,
} = require('~/models');
const { findAllArtifacts, replaceArtifactContent } = require('~/server/services/Artifacts/update');
const { requireJwtAuth, validateMessageReq } = require('~/server/middleware');
const validateExternalMessage = require('../middleware/validateExternalMessage');
const { cleanUpPrimaryKeyValue } = require('~/lib/utils/misc');
const { getConvosQueried } = require('~/models/Conversation');
const { countTokens } = require('~/server/utils');
const { Message } = require('~/models/Message');
const { logger } = require('~/config');
const { Conversation } = require('~/models/Conversation');
const { v4: uuidv4 } = require('uuid');
const { sendEvent } = require('~/config');
const { addClient, removeClient } = require('~/server/sseClients');

const router = express.Router();

// Apply JWT auth to all routes except external messages
router.use((req, res, next) => {
  // For external messages, use API key validation instead of JWT
  if (req.body.role === 'external') {
    return validateExternalMessage(req, res, next);
  }
  requireJwtAuth(req, res, next);
});

router.get('/', async (req, res) => {
  try {
    const user = req.user.id ?? '';
    const {
      cursor = null,
      sortBy = 'createdAt',
      sortDirection = 'desc',
      pageSize: pageSizeRaw,
      conversationId,
      messageId,
      search,
    } = req.query;
    const pageSize = parseInt(pageSizeRaw, 10) || 25;

    let response;
    const sortField = ['endpoint', 'createdAt', 'updatedAt'].includes(sortBy)
      ? sortBy
      : 'createdAt';
    const sortOrder = sortDirection === 'asc' ? 1 : -1;

    if (conversationId && messageId) {
      const message = await Message.findOne({ conversationId, messageId, user: user }).lean();
      response = { messages: message ? [message] : [], nextCursor: null };
    } else if (conversationId) {
      const filter = { conversationId, user: user };
      if (cursor) {
        filter[sortField] = sortOrder === 1 ? { $gt: cursor } : { $lt: cursor };
      }
      const messages = await Message.find(filter)
        .sort({ [sortField]: sortOrder })
        .limit(pageSize + 1)
        .lean();
      const nextCursor = messages.length > pageSize ? messages.pop()[sortField] : null;
      response = { messages, nextCursor };
    } else if (search) {
      const searchResults = await Message.meiliSearch(search, undefined, true);

      const messages = searchResults.hits || [];

      const result = await getConvosQueried(req.user.id, messages, cursor);

      const activeMessages = [];
      for (let i = 0; i < messages.length; i++) {
        let message = messages[i];
        if (message.conversationId.includes('--')) {
          message.conversationId = cleanUpPrimaryKeyValue(message.conversationId);
        }
        if (result.convoMap[message.conversationId]) {
          const convo = result.convoMap[message.conversationId];

          const dbMessage = await getMessage({ user, messageId: message.messageId });
          activeMessages.push({
            ...message,
            title: convo.title,
            conversationId: message.conversationId,
            model: convo.model,
            isCreatedByUser: dbMessage?.isCreatedByUser,
            endpoint: dbMessage?.endpoint,
            iconURL: dbMessage?.iconURL,
          });
        }
      }

      response = { messages: activeMessages, nextCursor: null };
    } else {
      response = { messages: [], nextCursor: null };
    }

    res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/artifact/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { index, original, updated } = req.body;

    if (typeof index !== 'number' || index < 0 || original == null || updated == null) {
      return res.status(400).json({ error: 'Invalid request parameters' });
    }

    const message = await getMessage({ user: req.user.id, messageId });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const artifacts = findAllArtifacts(message);
    if (index >= artifacts.length) {
      return res.status(400).json({ error: 'Artifact index out of bounds' });
    }

    const targetArtifact = artifacts[index];
    let updatedText = null;

    if (targetArtifact.source === 'content') {
      const part = message.content[targetArtifact.partIndex];
      updatedText = replaceArtifactContent(part.text, targetArtifact, original, updated);
      if (updatedText) {
        part.text = updatedText;
      }
    } else {
      updatedText = replaceArtifactContent(message.text, targetArtifact, original, updated);
      if (updatedText) {
        message.text = updatedText;
      }
    }

    if (!updatedText) {
      return res.status(400).json({ error: 'Original content not found in target artifact' });
    }

    const savedMessage = await saveMessage(
      req,
      {
        messageId,
        conversationId: message.conversationId,
        text: message.text,
        content: message.content,
        user: req.user.id,
      },
      { context: 'POST /api/messages/artifact/:messageId' },
    );

    res.status(200).json({
      conversationId: savedMessage.conversationId,
      content: savedMessage.content,
      text: savedMessage.text,
    });
  } catch (error) {
    logger.error('Error editing artifact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stream', requireJwtAuth, (req, res) => {
  // Enhanced logging for SSE connection setup
  logger.info('[SSE /stream] New SSE connection request:', {
    userId: req.user?.id,
    userType: typeof req.user?.id,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  const userId = req.user.id;

  // Ensure userId is a string for consistency
  const userIdString = userId.toString();
  logger.info('[SSE /stream] Adding client:', {
    originalUserId: userId,
    userIdString: userIdString,
    originalType: typeof userId,
    stringType: typeof userIdString
  });

  addClient(userIdString, res);
  logger.info(`[SSE] Added client for user: ${userIdString}`);

  // Send initial connection confirmation
  try {
    res.write(`event: connected\ndata: ${JSON.stringify({
      message: 'SSE connection established',
      userId: userIdString,
      timestamp: new Date().toISOString()
    })}\n\n`);
    res.flush();
  } catch (error) {
    logger.error('[SSE] Error sending initial message:', error);
  }

  // Set up heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({
          timestamp: new Date().toISOString()
        })}\n\n`);
        res.flush();
        logger.debug(`[SSE] Heartbeat sent to user: ${userIdString}`);
      } else {
        clearInterval(heartbeatInterval);
        removeClient(userIdString, res);
      }
    } catch (error) {
      logger.debug(`[SSE] Heartbeat failed for user ${userIdString}, cleaning up:`, error.message);
      clearInterval(heartbeatInterval);
      removeClient(userIdString, res);
    }
  }, 30000); // Send heartbeat every 30 seconds

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    removeClient(userIdString, res);
    logger.info(`[SSE] Connection closed for user: ${userIdString}`);
  });

  req.on('error', (error) => {
    logger.error(`[SSE] Connection error for user ${userIdString}:`, error.message);
    clearInterval(heartbeatInterval);
    removeClient(userIdString, res);
  });

  // Handle response errors
  res.on('error', (error) => {
    logger.error(`[SSE] Response error for user ${userIdString}:`, error.message);
    clearInterval(heartbeatInterval);
    removeClient(userIdString, res);
  });

  res.on('close', () => {
    logger.debug(`[SSE] Response closed for user: ${userIdString}`);
    clearInterval(heartbeatInterval);
    removeClient(userIdString, res);
  });
});

router.get('/:conversationId', validateMessageReq, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const messages = await getMessages({ conversationId }, '-_id -__v -user');
    res.status(200).json(messages);
  } catch (error) {
    logger.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:conversationId', validateMessageReq, async (req, res) => {
  try {
    const message = req.body;
    let conversationId = req.params.conversationId;

    logger.info('[Messages] Processing message request:', {
      conversationId: conversationId,
      messageRole: message.role,
      isExternal: message.role === 'external'
    });

    if (message.role === 'external') {
      // Let the external client handle conversation creation
      const { initializeClient } = require('~/server/services/Endpoints/external/initialize');
      const endpointOption = {
        endpoint: 'external',
        modelOptions: {
          model: message.metadata?.model || 'gpt-4o'
        },
        conversationId: req.params.conversationId // Pass conversation ID from params
      };

      logger.info('[Messages] Initializing external client with options:', {
        conversationId: endpointOption.conversationId,
        model: endpointOption.modelOptions.model
      });

      const { client } = await initializeClient({
        req,
        res,
        endpointOption
      });

      // Process message (client will handle conversation creation if needed)
      await client.sendMessage(message);
      return res.end();
    }

    // Handle regular messages
    try {
      const savedMessage = await saveMessage(
        {
          ...req,
          conversation: { conversationId: req.params.conversationId }
        },
        { ...message, user: req.user.id, conversationId: req.params.conversationId },
        { context: 'POST /api/messages/:conversationId' },
      );
      if (!savedMessage) {
        return res.status(400).json({ error: 'Message not saved' });
      }
      await saveConvo(
        {
          ...req,
          conversation: { conversationId: req.params.conversationId }
        },
        savedMessage,
        { context: 'POST /api/messages/:conversationId' }
      );
      return res.status(201).json(savedMessage);
    } catch (error) {
      logger.error('Error saving message:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (error) {
    logger.error('Error processing message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:conversationId/:messageId', validateMessageReq, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    const message = await getMessages({ conversationId, messageId }, '-_id -__v -user');
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.status(200).json(message);
  } catch (error) {
    logger.error('Error fetching message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:conversationId/:messageId', validateMessageReq, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;
    const { text, index, model } = req.body;

    if (index === undefined) {
      const tokenCount = await countTokens(text, model);
      const result = await updateMessage(req, { messageId, text, tokenCount });
      return res.status(200).json(result);
    }

    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    const message = (await getMessages({ conversationId, messageId }, 'content tokenCount'))?.[0];
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const existingContent = message.content;
    if (!Array.isArray(existingContent) || index >= existingContent.length) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    const updatedContent = [...existingContent];
    if (!updatedContent[index]) {
      return res.status(400).json({ error: 'Content part not found' });
    }

    if (updatedContent[index].type !== ContentTypes.TEXT) {
      return res.status(400).json({ error: 'Cannot update non-text content' });
    }

    const oldText = updatedContent[index].text;
    updatedContent[index] = { type: ContentTypes.TEXT, text };

    let tokenCount = message.tokenCount;
    if (tokenCount !== undefined) {
      const oldTokenCount = await countTokens(oldText, model);
      const newTokenCount = await countTokens(text, model);
      tokenCount = Math.max(0, tokenCount - oldTokenCount) + newTokenCount;
    }

    const result = await updateMessage(req, { messageId, content: updatedContent, tokenCount });
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error updating message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:conversationId/:messageId', validateMessageReq, async (req, res) => {
  try {
    const { messageId } = req.params;
    await deleteMessages({ messageId });
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add debug endpoint for testing SSE
router.post('/debug/broadcast', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userIdString = userId.toString(); // Ensure consistency with SSE client registration
    const { event = 'testMessage', data = { message: 'Test broadcast', timestamp: new Date().toISOString() } } = req.body;

    logger.info(`[DEBUG] Broadcasting test event to user:`, {
      originalUserId: userId,
      userIdString: userIdString,
      event: event,
      data: data
    });

    const { broadcastToUser, hasActiveUser } = require('~/server/sseClients');
    const hasConnection = hasActiveUser(userIdString);

    logger.info(`[DEBUG] User ${userIdString} has active SSE connection: ${hasConnection}`);

    if (hasConnection) {
      const success = broadcastToUser(userIdString, event, data);
      res.json({
        success: success,
        message: `Test event '${event}' broadcast to user ${userIdString}`,
        hasActiveConnection: hasConnection,
        userIdUsed: userIdString,
        broadcastSuccess: success
      });
    } else {
      res.json({
        success: false,
        message: `No active SSE connection found for user ${userIdString}`,
        hasActiveConnection: hasConnection,
        userIdUsed: userIdString,
        broadcastSuccess: false
      });
    }
  } catch (error) {
    logger.error('[DEBUG] Error in test broadcast:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add immediate external message test endpoint
router.post('/debug/external-message', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userIdString = userId.toString();
    const { conversationId, messageText = 'Test external message' } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    logger.info(`[DEBUG] Creating test external message for user ${userIdString}`);

    // Create a test message similar to external messages
    const testMessage = {
      messageId: uuidv4(),
      conversationId: conversationId,
      parentMessageId: null,
      role: 'external',
      isCreatedByUser: false,
      text: messageText,
      content: [{ type: 'text', text: messageText }],
      user: userIdString,
      endpoint: 'external',
      metadata: {
        source: 'test',
        createdBy: 'debug-endpoint'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save the message
    const savedMessage = await saveMessage(
      { user: { id: userIdString }, body: { isTemporary: false } },
      testMessage,
      { context: 'DEBUG external message test' }
    );

    if (!savedMessage) {
      return res.status(500).json({ error: 'Failed to save test message' });
    }

    // Broadcast immediately
    const { broadcastToUsers, hasActiveUser } = require('~/server/sseClients');
    const hasConnection = hasActiveUser(userIdString);

    logger.info(`[DEBUG] Broadcasting test external message to user ${userIdString}, hasConnection: ${hasConnection}`);

    const broadcastSuccess = broadcastToUsers([userIdString], 'newMessage', {
      conversationId: savedMessage.conversationId,
      messages: [savedMessage],
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Test external message created and broadcast',
      savedMessage: {
        messageId: savedMessage.messageId,
        conversationId: savedMessage.conversationId,
        text: savedMessage.text
      },
      hasActiveConnection: hasConnection,
      broadcastSuccess: broadcastSuccess > 0
    });

  } catch (error) {
    logger.error('[DEBUG] Error in external message test:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

module.exports = router;
