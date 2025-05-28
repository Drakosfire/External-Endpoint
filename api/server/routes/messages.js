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
  // Log the user object attached by Passport
  console.log('[SSE /stream] req.user:', req.user);
  // Optionally, log the cookies and headers
  console.log('[SSE /stream] req.cookies:');
  console.log('[SSE /stream] req.headers:');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.user.id;
  addClient(userId, res);
  logger.info(`[SSE] Added client for user: ${userId}`);

  req.on('close', () => {
    removeClient(userId, res);
    logger.info(`[SSE] Connection closed for user: ${userId}`);
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
    const conversation = req.conversation;
    // logger.debug(`[External Message] Attempting endpoint discovery - conversationId: ${req.params.conversationId}, endpoint: ${conversation?.endpoint}, model: ${conversation?.model}, endpointType: ${conversation?.endpointType}`);

    // If no conversation exists, create a new one
    if (!conversation) {
      logger.info(`[Message] Creating new conversation for conversationId: ${req.params.conversationId}`);

      // Get the most recent active conversation for the user
      const { Conversation } = require('~/models');
      const lastConversation = await Conversation.findOne(
        { user: req.user.id },
        {},
        { sort: { updatedAt: -1 } }
      ).lean();

      // Create new conversation with parameters from last conversation or defaults
      const newConversation = {
        conversationId: req.params.conversationId,
        title: 'New Chat',
        endpoint: lastConversation?.endpoint || 'openai',
        model: lastConversation?.model || 'gpt-4o-mini',
        endpointType: lastConversation?.endpointType,
        user: req.user.id,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save the new conversation
      const { saveConvo } = require('~/models');
      await saveConvo(
        {
          ...req,
          conversation: { conversationId: req.params.conversationId }
        },
        newConversation,
        { context: 'POST /api/messages/:conversationId - Creating new conversation' }
      );

      // Set the conversation for the request
      req.conversation = newConversation;
    }

    // Log successful discovery
    // logger.info(`[External Message] Endpoint discovered - conversationId: ${conversation.conversationId}, endpoint: ${conversation.endpoint}, model: ${conversation.model}`);

    const message = req.body;

    // Handle external messages
    if (message.role === 'external') {
      logger.info('[Message] Processing external message');

      const { role, content } = message;
      if (role !== 'external') {
        logger.warn(`[Message] Invalid role: ${role}`);
        return res.status(400).json({ error: 'Role must be external' });
      }

      const conversation = req.conversation;
      if (!conversation) {
        logger.error('[Message] No conversation found');
        return res.status(404).json({ error: 'Conversation not found' });
      }

      try {
        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Fetch the last message in the conversation
        logger.info('[Message] Fetching last message in conversation');
        const lastMessage = await Message.findOne(
          { conversationId: req.params.conversationId },
          {},
          { sort: { createdAt: -1 } }
        );
        logger.info(`[Message] Last message found: ${lastMessage ? 'yes' : 'no'}`);

        // Initialize the external client
        const { initializeClient } = require('~/server/services/Endpoints/external/initialize');

        // Prepare endpoint options
        const endpointOption = {
          endpoint: conversation.endpoint,
          modelOptions: {
            model: conversation.model
          }
        };

        // Add agent information if needed
        if (conversation.endpoint === 'agents') {
          endpointOption.agent_id = conversation.agent_id;
          endpointOption.model_parameters = conversation.model_parameters;
        }

        const { client } = await initializeClient({
          req,
          res,
          endpointOption
        });

        // Process the message through the external client
        await client.sendMessage(message, {
          conversationId: req.params.conversationId,
          parentMessageId: lastMessage ? lastMessage.messageId : null,
        });

        // Send final message and end the response
        const { sendMessage } = require('~/server/utils/streamResponse');
        sendMessage(res, {
          final: true,
          conversation,
          requestMessage: {
            parentMessageId: lastMessage ? lastMessage.messageId : null,
          },
        });
        return res.end();
      } catch (error) {
        logger.error('[Message] Error processing external message:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
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
    logger.error('Error saving message:', error);
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

module.exports = router;
