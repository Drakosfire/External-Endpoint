# SMS User Management Testing Guide

**Date**: June 2025
**Purpose**: Comprehensive manual testing guide for enhanced SMS user management system  
**Target**: Phase 1 - SMS User Creation & Conversation Persistence  

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Testing Environment Setup](#testing-environment-setup)
3. [Automated Test Suite](#automated-test-suite)
4. [Manual Testing Procedures](#manual-testing-procedures)
5. [Edge Cases Testing](#edge-cases-testing)
6. [MongoDB Verification Commands](#mongodb-verification-commands)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Access
- MongoDB database access
- SMS sending capability (your phone number)
- LibreChat server with enhanced SMS middleware
- Terminal access to LibreChat directory

### Environment Variables
```bash
# Ensure these are set in your .env
EXTERNAL_MESSAGE_API_KEY=your_sms_api_key
MONGO_URI=mongodb://mongodb:27017/LibreChat  # Docker
# or
MONGO_URI=mongodb://localhost:27017/LibreChat  # Local
```

---

## Testing Environment Setup

### 1. Clean Database State (Optional)
```bash
# Connect to MongoDB
mongo mongodb://localhost:27017/LibreChat

# Remove any existing SMS test users
db.users.deleteMany({"provider": "sms", "phoneNumber": {$regex: "^\\+1555"}})

# Check clean state
db.users.find({"provider": "sms"}).count()
```

### 2. Start LibreChat Server
```bash
# In Docker environment
docker-compose up

# Or local development
npm run start
```

### 3. Enable Enhanced Logging
Add to your environment for detailed logs:
```bash
DEBUG=validateExternalMessage,ExternalClient
LOG_LEVEL=debug
```

---

## Automated Test Suite

### Run the Enhanced Test Suite
```bash
# Navigate to LibreChat directory
cd /path/to/LibreChat

# Run automated tests
node test_sms_enhanced.js
```

**Expected Output**:
```
🚀 SMS User Management Enhanced Testing Suite

📱 Testing Phone Number Validation & Normalization
✅ +1234567890 -> +1234567890
✅ +44123456789 -> +44123456789
❌ 123 -> INVALID
❌ abc123 -> INVALID

📊 Results: 7 valid, 6 invalid

👤 Testing SMS User Creation & Management
📝 Creating SMS users...
   ✅ Created user for +1234567890: 507f1f77bcf86cd799439011
   
🔒 Testing user isolation...
   ✅ All users have unique IDs - isolation confirmed
```

---

## Manual Testing Procedures

### Test 1: Basic SMS User Creation

#### Step 1: Send Initial Message
1. Send SMS to your Twilio number from your phone: `"Hello, this is my first message"`
2. Check logs for user creation:
   ```
   [validateExternalMessage] Creating new SMS user for +1234567890
   [validateExternalMessage] Successfully created SMS user: {...}
   ```

#### Step 2: Verify in Database
```javascript
// MongoDB query
db.users.find({"phoneNumber": "+1234567890"}).pretty()
```

**Expected Result**:
```javascript
{
  "_id": ObjectId("..."),
  "email": "+1234567890@sms.librechat.ai",
  "name": "SMS User +1234567890",
  "username": "sms_1234567890",
  "provider": "sms",
  "phoneNumber": "+1234567890",
  "emailVerified": true,
  "role": "USER",
  "metadata": {
    "phoneNumber": "+1234567890",
    "source": "sms",
    "createdBy": "sms-system",
    "firstContact": ISODate("..."),
    "lastSMS": ISODate("..."),
    "messageCount": 1,
    "preferences": {
      "defaultModel": "gpt-4o",
      "endpoint": "openai"
    }
  },
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

### Test 2: Conversation Persistence

#### Step 1: Create Conversation
1. Send message: `"Let's start a conversation"`
2. Wait for response
3. Note conversation ID from logs or database

#### Step 2: Check Conversation
```javascript
// Find conversations for your phone number
db.conversations.find({
  "metadata.phoneNumber": "+1234567890",
  "metadata.source": "sms"
}).pretty()
```

#### Step 3: Test Persistence
1. **Restart LibreChat server**
2. Send another message: `"This should continue our conversation"`
3. Verify it uses the same conversation ID

### Test 3: Multiple Messages & Activity Tracking

#### Step 1: Send Multiple Messages
```
Message 1: "Hello"
Message 2: "How are you?"
Message 3: "What's the weather like?"
```

#### Step 2: Verify Message Count
```javascript
db.users.find(
  {"phoneNumber": "+1234567890"}, 
  {"metadata.messageCount": 1, "metadata.lastSMS": 1}
)
```

**Expected**: `messageCount` should increment, `lastSMS` should update

### Test 4: User Isolation

#### Step 1: Use Different Phone Number
If you have access to another phone, send from different number:
`"Hello from different phone"`

#### Step 2: Verify Separate Users
```javascript
// Count total SMS users
db.users.find({"provider": "sms"}).count()

// List all SMS users
db.users.find(
  {"provider": "sms"}, 
  {"phoneNumber": 1, "_id": 1, "metadata.messageCount": 1}
)
```

**Expected**: Separate user entries for each phone number

---

## Edge Cases Testing

### Edge Case 1: Phone Number Format Variations

Test different phone number formats by modifying your SMS payload:

```bash
# Test various formats (manually modify SMS server or test script)
curl -X POST http://localhost:3001/api/messages/new \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "role": "external",
    "content": "Test message",
    "from": "555-123-4567",
    "metadata": {"phoneNumber": "555-123-4567"}
  }'
```

**Test Numbers**:
- `+1 (555) 123-4567`
- `555-123-4567`
- `15551234567`
- `1234567890`

### Edge Case 2: Concurrent User Creation

#### Simulate Race Condition
```javascript
// Run this in MongoDB shell to simulate concurrent requests
// (This is for testing - don't run multiple times)

// Create multiple attempts simultaneously
const phone = "+15551234567";
const attempts = [];

for (let i = 0; i < 3; i++) {
  attempts.push(
    db.users.insertOne({
      email: `${phone}@sms.librechat.ai`,
      phoneNumber: phone,
      provider: "sms",
      createdAt: new Date()
    })
  );
}

// Check results - should see only one success due to unique constraints
db.users.find({"phoneNumber": phone}).count()
```

### Edge Case 3: Invalid Phone Numbers

Test the enhanced validation by sending messages with invalid numbers:

```javascript
// These should be rejected by validateExternalMessage
const invalidNumbers = [
  "123",           // Too short
  "abc123",        // Contains letters  
  "+",             // Just plus
  "",              // Empty
];

// Each should return 400 error with message:
// "Valid phone number required"
```

### Edge Case 4: Username Conflicts

Create users with potential username conflicts:

```javascript
// First create a user manually with base username
db.users.insertOne({
  username: "sms_1234567890",
  email: "test1@example.com",
  provider: "local"
});

// Then send SMS from +1234567890
// Should create username: sms_1234567890_1
```

---

## MongoDB Verification Commands

### User Management Queries

```javascript
// 1. Find all SMS users
db.users.find({"provider": "sms"})

// 2. Count SMS users
db.users.find({"provider": "sms"}).count()

// 3. Find user by phone number
db.users.findOne({"phoneNumber": "+1234567890"})

// 4. Check user activity
db.users.find(
  {"provider": "sms"}, 
  {
    "phoneNumber": 1, 
    "metadata.messageCount": 1, 
    "metadata.lastSMS": 1,
    "createdAt": 1
  }
).sort({"metadata.lastSMS": -1})

// 5. Find users created in last hour
db.users.find({
  "provider": "sms",
  "createdAt": {$gte: new Date(Date.now() - 3600000)}
})
```

### Conversation Management Queries

```javascript
// 1. Find SMS conversations
db.conversations.find({"metadata.source": "sms"})

// 2. Find conversations for specific phone
db.conversations.find({"metadata.phoneNumber": "+1234567890"})

// 3. Check conversation age and activity
db.conversations.find(
  {"metadata.source": "sms"},
  {
    "conversationId": 1,
    "metadata.phoneNumber": 1,
    "updatedAt": 1,
    "createdAt": 1
  }
).sort({"updatedAt": -1})

// 4. Find active conversations (last 7 days)
db.conversations.find({
  "metadata.source": "sms",
  "updatedAt": {$gte: new Date(Date.now() - 7*24*60*60*1000)}
})

// 5. Count conversations per phone number
db.conversations.aggregate([
  {$match: {"metadata.source": "sms"}},
  {$group: {
    _id: "$metadata.phoneNumber",
    count: {$sum: 1},
    lastUpdate: {$max: "$updatedAt"}
  }},
  {$sort: {"lastUpdate": -1}}
])
```

### Message History Queries

```javascript
// 1. Find messages for SMS conversations
db.messages.find({
  "conversationId": {$in: db.conversations.distinct("conversationId", {"metadata.source": "sms"})}
}).limit(10).sort({"createdAt": -1})

// 2. Count messages per SMS user
db.messages.aggregate([
  {$lookup: {
    from: "conversations",
    localField: "conversationId", 
    foreignField: "conversationId",
    as: "conversation"
  }},
  {$match: {"conversation.metadata.source": "sms"}},
  {$group: {
    _id: "$conversation.metadata.phoneNumber",
    messageCount: {$sum: 1}
  }}
])
```

---

## Database Cleanup Commands

### Clean Test Data

```javascript
// Remove test SMS users (be careful!)
db.users.deleteMany({
  "provider": "sms",
  "phoneNumber": {$regex: "^\\+1555"}  // Only test numbers
})

// Remove test conversations
db.conversations.deleteMany({
  "metadata.source": "sms",
  "metadata.phoneNumber": {$regex: "^\\+1555"}
})

// Verify cleanup
db.users.find({"provider": "sms"}).count()
db.conversations.find({"metadata.source": "sms"}).count()
```

### Clean Your Personal Test Data

```javascript
// Replace with your actual phone number
const yourPhone = "+1234567890";

// Remove your test user
db.users.deleteOne({"phoneNumber": yourPhone})

// Remove your test conversations  
db.conversations.deleteMany({"metadata.phoneNumber": yourPhone})

// Remove your test messages
const conversationIds = db.conversations.distinct("conversationId", {"metadata.phoneNumber": yourPhone});
db.messages.deleteMany({"conversationId": {$in: conversationIds}})
```

---

## Troubleshooting

### Common Issues

#### 1. User Not Created
**Symptoms**: No user found in database after SMS
**Checks**:
```javascript
// Check for any SMS users
db.users.find({"provider": "sms"})

// Check server logs
tail -f api/logs/debug.log | grep validateExternalMessage

// Check if phone number normalization failed
// Enable debug logging and check format
```

#### 2. Conversation Not Persisting
**Symptoms**: New conversation created on each restart
**Checks**:
```javascript
// Verify conversation exists
db.conversations.find({"metadata.source": "sms"})

// Check if conversation search is working
db.conversations.find({
  "metadata.phoneNumber": "+1234567890",
  "metadata.source": "sms",
  "updatedAt": {$gte: new Date(Date.now() - 7*24*60*60*1000)}
})

// Check ExternalClient logs
tail -f api/logs/debug.log | grep ExternalClient
```

#### 3. Duplicate Users Created
**Symptoms**: Multiple users for same phone number
**Investigation**:
```javascript
// Find duplicate phone numbers
db.users.aggregate([
  {$match: {"provider": "sms"}},
  {$group: {
    _id: "$phoneNumber",
    count: {$sum: 1},
    users: {$push: "$_id"}
  }},
  {$match: {"count": {$gt: 1}}}
])
```

#### 4. Phone Number Format Issues
**Symptoms**: 400 error "Valid phone number required"
**Debug**:
- Check phone number normalization in logs
- Test with different formats
- Verify E.164 compliance

### Debug Logging

Enable detailed logging:
```bash
# Add to .env
DEBUG=validateExternalMessage*,ExternalClient*
LOG_LEVEL=debug

# Or export in terminal
export DEBUG=validateExternalMessage*,ExternalClient*
```

Monitor logs in real-time:
```bash
# Follow logs
tail -f api/logs/debug.log

# Filter for SMS activity
tail -f api/logs/debug.log | grep -E "(validateExternalMessage|ExternalClient|SMS)"
```

---

## Test Results Documentation

### Create Test Report

Document your findings:

```markdown
## SMS User Management Test Results

**Date**: [DATE]
**Tester**: [NAME]  
**Environment**: [Docker/Local]

### ✅ Passed Tests
- [ ] Basic user creation
- [ ] Phone number normalization  
- [ ] Conversation persistence
- [ ] User isolation
- [ ] Message count tracking

### ❌ Failed Tests
- [ ] [Test name]: [Issue description]

### 🐛 Issues Found
1. **Issue**: [Description]
   **Impact**: [High/Medium/Low]
   **Steps to Reproduce**: [Steps]
   **Expected**: [Expected behavior]
   **Actual**: [Actual behavior]

### 📊 Performance Notes
- User creation time: [X]ms
- Conversation lookup time: [X]ms
- Database query performance: [Notes]

### 🔧 Recommendations
- [Improvement suggestions]
```

---

## Next Steps

After completing Phase 1 testing:

1. **Document Results**: Record all findings and issues
2. **Performance Review**: Note any slow queries or operations
3. **Edge Case Analysis**: Identify additional edge cases
4. **Phase 2 Preparation**: Plan MCP server enhancement testing
5. **Production Readiness**: Assess readiness for production deployment

---

## Emergency Rollback

If testing reveals critical issues:

### Quick Rollback Steps
1. **Stop LibreChat**: `docker-compose down` or `Ctrl+C`
2. **Restore Original File**: 
   ```bash
   git checkout HEAD -- api/server/middleware/validateExternalMessage.js
   git checkout HEAD -- api/server/services/Endpoints/external/index.js
   ```
3. **Clean Test Data**: Use cleanup commands above
4. **Restart**: `docker-compose up` or `npm run start`

### Backup Strategy
```bash
# Before testing, backup critical files
mkdir -p backup/$(date +%Y%m%d)
cp api/server/middleware/validateExternalMessage.js backup/$(date +%Y%m%d)/
cp api/server/services/Endpoints/external/index.js backup/$(date +%Y%m%d)/
```

---

**Remember**: This is Phase 1 testing. Focus on SMS user creation and conversation persistence. MCP server enhancements come in Phase 2! 