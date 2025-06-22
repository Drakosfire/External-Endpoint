# LibreChat Logging Guidelines

## ⚠️ CRITICAL: Token Conservation & Security

Logging in LibreChat must be **token-efficient** and **security-conscious**. Verbose logging can consume thousands of tokens unnecessarily and expose sensitive data.

## ❌ NEVER Log These

### 1. **Full Objects/Payloads**
```javascript
// ❌ BAD - Wastes tokens, exposes data
logger.debug('User payload:', JSON.stringify(userPayload, null, 2));
logger.info('Request body:', req.body);

// ✅ GOOD - Concise, informative
logger.debug('Creating user with email:', userPayload.email);
logger.info('Request contains keys:', Object.keys(req.body));
```

### 2. **Sensitive Data**
```javascript
// ❌ BAD - Security risk
logger.debug('User password:', user.password);
logger.info('API key:', apiKey);

// ✅ GOOD - Safe logging
logger.debug('Password validation:', password ? 'provided' : 'missing');
logger.info('API key:', apiKey ? 'valid' : 'invalid');
```

### 3. **Stack Traces in Production**
```javascript
// ❌ BAD - Verbose, exposes internals
logger.error('Error:', error.stack);

// ✅ GOOD - Essential info only
logger.error('Error:', { message: error.message, code: error.code, name: error.name });
```

### 4. **Large Arrays/Collections**
```javascript
// ❌ BAD - Can be massive
logger.debug('All conversations:', conversations);

// ✅ GOOD - Summary info
logger.debug('Found conversations:', conversations.length);
```

## ✅ DO Log These

### 1. **Key Identifiers**
```javascript
logger.info('Processing user:', { userId: user._id.toString(), phoneNumber });
logger.debug('Conversation found:', conversationId);
```

### 2. **State Changes**
```javascript
logger.info('User created successfully:', { userId, username, provider });
logger.info('Conversation updated:', { conversationId, messageCount });
```

### 3. **Flow Control**
```javascript
logger.debug('Starting SMS user lookup');
logger.info('Validation complete, proceeding to message processing');
```

### 4. **Error Context (Minimal)**
```javascript
logger.error('Database operation failed:', {
    operation: 'createUser',
    userId: user._id,
    message: error.message,
    code: error.code
});
```

## 📏 Log Level Guidelines

### `logger.error()` - Production Critical
- Database failures
- Authentication failures  
- System errors that affect functionality
- **Keep minimal** - only essential error info

### `logger.warn()` - Production Important
- Validation failures
- Deprecated feature usage
- Performance concerns
- **Brief descriptions** only

### `logger.info()` - Production Tracking
- User actions (login, message sent)
- System state changes
- Feature usage
- **Key identifiers** only

### `logger.debug()` - Development Only
- Flow control
- Variable states (summarized)
- Detailed troubleshooting
- **Should not impact production performance**

## 🔧 Practical Examples

### SMS User Management
```javascript
// ✅ GOOD - Efficient logging
logger.info('SMS user lookup:', { phone: normalizedPhone });
logger.debug('User found:', user ? 'yes' : 'no');
logger.info('User created:', { userId: user._id, username: user.username });

// ❌ BAD - Token waste
logger.debug('Search query:', JSON.stringify(searchQuery, null, 2));
logger.info('Full user object:', user);
```

### Error Handling
```javascript
// ✅ GOOD - Essential info
logger.error('User creation failed:', {
    phone: normalizedPhone,
    message: error.message,
    code: error.code
});

// ❌ BAD - Verbose
logger.error('Full error:', error);
logger.error('Stack trace:', error.stack);
```

### Request Processing
```javascript
// ✅ GOOD - Summary
logger.debug('Request keys:', Object.keys(req.body));
logger.info('Processing request:', { endpoint: req.path, method: req.method });

// ❌ BAD - Full exposure
logger.debug('Full request:', req.body);
logger.info('Headers:', req.headers);
```

## 🎯 Token Conservation Rules

1. **One-line summaries** over multi-line objects
2. **Count/length** instead of full arrays
3. **Key identifiers** instead of full records
4. **Boolean states** instead of full conditionals
5. **Error essentials** instead of full stack traces

## 🔒 Security Rules

1. **Never log passwords, tokens, or API keys**
2. **Sanitize user input** before logging
3. **Use development-only** logs for sensitive debugging
4. **Redact PII** in production logs
5. **Limit error exposure** in production

## 📊 Before/After Example

### ❌ Before (Token Heavy)
```javascript
logger.debug('User search query:', JSON.stringify({
    $or: [
        { phoneNumber: '+19709788817' },
        { 'metadata.phoneNumber': '+19709788817' }
    ]
}, null, 2));
logger.info('User payload:', JSON.stringify(userPayload, null, 2));
logger.error('Full error:', error);
```
**Token cost: ~500 tokens**

### ✅ After (Token Efficient)
```javascript
logger.debug('Searching for user with phone: +19709788817');
logger.info('Creating user with email: +19709788817@sms.librechat.ai');
logger.error('User creation failed:', { message: error.message, code: error.code });
```
**Token cost: ~50 tokens**

---

**Remember: Every log line costs tokens. Make them count!** 