# External Message Agent Actions Implementation

**Date**: June 2025  
**Purpose**: Documentation for implementing external message routing to LibreChat agents  
**Status**: ✅ **WORKING** - SMS to Agent integration functional

---

## 🎉 Current Status: WORKING

**✅ COMPLETED**: External SMS messages now successfully route to LibreChat agents with:
- ✅ **Agent routing**: Messages correctly routed to specific agents via metadata
- ✅ **Conversation persistence**: Phone numbers maintain consistent conversation threads  
- ✅ **Agent responses**: Agents respond appropriately to SMS messages
- ✅ **HTTP/HTTPS flexibility**: SMS server supports both protocols for different environments

**🎯 FUNCTIONAL**: Core SMS → Agent integration working, ready for optimization

**🔄 NEXT**: Create dedicated SMS agent + simplify SMS server architecture

---

## Quick Setup Summary

### Working Configuration

**SMS Server → LibreChat Agent Flow**:
```
SMS Router → SMS Server → LibreChat External Client → Agent Client → Response
```

**Required Payload Structure** (WORKING):
```json
{
  "role": "external",
  "content": "User's SMS message",
  "from": "+1234567890",
  "metadata": {
    "endpoint": "agents",
    "agent_id": "agent_YOUR_AGENT_ID",
    "model": "gpt-4o",
    "phoneNumber": "+1234567890",
    "source": "sms",
    "instructions": "Dynamic context-aware instructions...",
    "title": "SMS Agent Chat with +1234567890"
  }
}
```

**Environment Variables** (SMS Server):
```env
LIBRECHAT_AGENT_ID=agent_YOUR_ACTUAL_AGENT_ID
LIBRECHAT_AGENT_MODEL=gpt-4o
EXTERNAL_MESSAGE_API_KEY=your_librechat_api_key
PORT=3081
```

---

## Architecture Overview

### 🔄 Working Message Flow

1. **SMS Received** → Twilio/Cloud SMS Router
2. **Router Forwards** → SMS Server (`/api/receive-sms`)
3. **SMS Server Processes** → Generates agent payload with instructions
4. **LibreChat Receives** → External message at `/api/messages/{conversationId}`
5. **External Client Routes** → Detects `metadata.endpoint: "agents"`
6. **Agent Loads** → Agent system processes with user context
7. **Response Generated** → Agent responds via LLM
8. **Response Delivered** → Back through the chain to SMS

### 🏗️ Key Components

#### 1. SMS Server (Sizzek/mcp-servers/twilio-sms/)
- **Purpose**: Receives SMS webhooks, formats for LibreChat agents
- **Features**: 
  - Conversation persistence per phone number
  - Dynamic instruction generation
  - HTTP/HTTPS protocol flexibility
  - Agent metadata configuration

#### 2. LibreChat External Client (api/server/services/Endpoints/external/)
- **Purpose**: Handles external messages and routes to appropriate endpoints
- **Features**:
  - Agent endpoint detection via `metadata.endpoint`
  - Agent loading and authentication
  - Conversation creation/management
  - User context handling

#### 3. LibreChat Agent System (api/server/services/Endpoints/agents/)
- **Purpose**: Native agent processing with full LibreChat features
- **Features**:
  - Agent-specific behavior and instructions
  - Model configuration and parameters
  - Conversation context and memory

---

## Implementation Details

### ✅ Completed Implementation

#### 1. SMS Server Agent Integration
**File**: `Sizzek/mcp-servers/twilio-sms/src/sms-server.ts`

Key features implemented:
- **Conversation Management**: Phone number → conversation ID mapping
- **Dynamic Instructions**: Context-aware instructions based on time/content
- **Agent Configuration**: Environment-based agent ID and model selection
- **Protocol Flexibility**: HTTP/HTTPS support for different network setups

```javascript
// Working payload generation
const payload = {
    role: "external",
    content: message,
    from: from,
    metadata: {
        endpoint: "agents",
        agent_id: AGENT_ID,
        model: AGENT_MODEL,
        phoneNumber: phoneNumber,
        source: 'sms',
        instructions: generateSizzekInstructions(message, phoneNumber),
        title: `SMS Agent Chat with ${phoneNumber}`
    }
};
```

#### 2. External Client Agent Support
**Files**: 
- `api/server/services/Endpoints/external/initialize.js`
- `api/server/services/Endpoints/external/index.js`

Key features implemented:
- **Agent Detection**: Automatic routing when `metadata.endpoint === 'agents'`
- **Agent Loading**: Proper user context and agent authentication
- **Conversation Creation**: Agent conversations with correct endpoint and metadata
- **Error Handling**: Comprehensive error handling for agent access issues

#### 3. Message Routing Enhancement
**File**: `api/server/routes/messages.js`

- **External Message Handling**: Proper routing of external messages to External Client
- **Metadata Preservation**: Phone number and source information maintained
- **Agent Configuration**: Endpoint options configured for agent requests

### ✅ COMPLETED: Dynamic Instructions Integration

The SMS server sends dynamic instructions which are now properly integrated:

```javascript
metadata: {
    // ... other fields
    instructions: "You are Sizzek, a helpful AI assistant. Current context: Customer inquiry via SMS from +1234567890. Keep responses concise..."
}
```

**✅ IMPLEMENTED**: Dynamic instructions are extracted from `metadata.instructions` and passed to agents as `additional_instructions`, supplementing the agent's base instructions.

---

## Next Steps

### ✅ Phase 1: Basic Integration COMPLETED

**✅ WORKING**: SMS messages successfully route to LibreChat agents
- ✅ External message system detects and routes to agents
- ✅ Conversation persistence per phone number
- ✅ Agent responses delivered back through SMS

### Phase 2: Dedicated SMS Agent 🎯 NEXT PRIORITY

**🔄 RECOMMENDED APPROACH**: Create dedicated SMS agent in LibreChat

#### Step 1: Create SMS Agent in LibreChat
```
Agent Name: "Sizzek SMS Assistant"
System Prompt: 
"You are Sizzek, a helpful business assistant responding via SMS.

Key behaviors:
- Keep responses under 160 characters when possible
- Be concise but friendly and professional
- You are responding to SMS from phone number: {{phone_number}}
- If you see a timestamp in the message, use it for context
- For after-hours messages, acknowledge the time appropriately
- Focus on being helpful while being brief

You are responding to SMS messages, so brevity is important."

Variables:
- phone_number: (will be populated by SMS server)
```

#### Step 2: Use LibreChat Variables (BEST APPROACH)
**✨ LibreChat has a built-in variable system for agents!**

- **Agent Variables**: Create `{{phone_number}}` variable in agent configuration
- **SMS Server**: Pass phone number via metadata or content
- **LibreChat**: Automatically substitutes `{{phone_number}}` in system prompt
- **Clean & Native**: Uses LibreChat's standard variable functionality

#### Step 3: Simplify SMS Server  
- **Remove**: `generateSizzekInstructions()` function
- **Remove**: `metadata.instructions` field
- **Keep**: Simple message routing with agent ID
- **Add**: Phone number variable population
- **Optional**: Timestamp appending to message content

#### Step 4: Update Environment
```env
LIBRECHAT_AGENT_ID=your_new_sms_agent_id
```

**Benefits of this approach**:
- 📦 **Simpler SMS server**: Just routes messages, no business logic
- 🎯 **Centralized agent config**: All SMS behavior defined in LibreChat UI
- 🔧 **Easier maintenance**: Change SMS behavior without touching SMS server
- 📈 **Better scalability**: Standard agent system, no custom instruction injection

### Phase 3: Dynamic Context Integration 🕐 PLANNED

**🎯 Priority: Date/Time injection for SMS agent**

**🏆 BEST APPROACH: LibreChat Variables + Simple Timestamp**
```javascript
// In SMS server forwardToClient function
const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
});

const contentWithTime = `${message} [Time: ${timestamp} EST]`;

const payload = {
    role: "external",
    content: contentWithTime,  // "Hello [Time: Jun 7, 2:30 PM EST]"
    metadata: {
        endpoint: "agents",
        agent_id: AGENT_ID,
        phoneNumber: phoneNumber,
        source: 'sms',
        // Pass phone number for variable substitution
        agentVariables: {
            phone_number: phoneNumber
        }
    }
};
```

**🎯 Alternative: Research LibreChat Variable API**
Need to investigate how LibreChat's variable system works:
- How are variables passed to agents?
- Can they be set via external messages?
- What's the metadata structure for variables?

**Why this approach is superior**:
- ✅ **Native LibreChat feature**: Uses built-in variable system
- ✅ **Clean separation**: Phone number in system prompt, not content
- ✅ **Maintainable**: Change agent behavior in LibreChat UI
- ✅ **Extensible**: Can add more variables (time, context, etc.)

### Phase 4: Research LibreChat Variables 🔍 IMMEDIATE

**🎯 Priority Research Tasks**:
1. **How do LibreChat agent variables work?**
   - Where are variables defined in agent configuration?
   - How are they passed through external messages?
   - What's the correct metadata structure?

2. **Variable Integration Points**:
   - External Client: How to pass variables to agent initialization?
   - Agent Client: How are variables substituted in prompts?
   - Message flow: Where do variables get processed?

3. **Test Implementation**:
   - Create test agent with `{{phone_number}}` variable
   - Test variable substitution via external messages
   - Document the working variable flow

**Advanced context features** (future):
- Time-based behavior (business hours vs after-hours responses)
- Phone number history and context
- Message content analysis (support vs sales)
- Conversation state awareness

2. **Error Handling & Monitoring**
   - Failed message retry logic
   - Agent availability checking
   - Performance metrics and logging
   - Health check endpoints

3. **Multi-Agent Support**
   - Route different message types to different agents
   - Agent specialization (support, sales, general)
   - Load balancing between agents

### Phase 3: Production Readiness 🚀 FUTURE

1. **Scalability**
   - Redis for conversation persistence
   - Database for message history
   - Rate limiting and abuse prevention

2. **Security Enhancements**
   - Agent access control refinement
   - API key scoping
   - Audit logging

3. **Integration Improvements**
   - Twilio native integration
   - WhatsApp support
   - Multi-channel messaging

---

## Testing & Validation

### ✅ Confirmed Working

1. **Basic SMS → Agent Flow**
   ```bash
   # Test confirmed working
   SMS: "Hello" → Agent Response: "Hi! How can I help you?"
   ```

2. **Conversation Persistence**
   ```bash
   # Multiple messages maintain same conversation
   SMS 1: "Question 1" → Response in conversation X
   SMS 2: "Follow up" → Response continues in conversation X
   ```

3. **Agent Configuration**
   ```bash
   # Agent ID and model properly configured
   Agent: agent_Jnv6sPlq88coq_AjJguYh
   Model: gpt-4o
   ```

### 🔍 Need to Test

1. **Dynamic Instructions**
   ```bash
   # Verify instructions are being used by agent
   Test different instruction contexts
   Check agent behavior matches instructions
   ```

2. **Error Scenarios**
   ```bash
   # Invalid agent ID
   # Missing API key
   # Malformed requests
   ```

---

## Technical Reference

### Working cURL Test
```bash
curl -X POST "http://localhost:3080/api/messages/test-conversation-id" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "role": "external",
    "content": "Test message for agent",
    "metadata": {
      "endpoint": "agents",
      "agent_id": "agent_Jnv6sPlq88coq_AjJguYh",
      "model": "gpt-4o",
      "phoneNumber": "+1234567890",
      "source": "sms",
      "instructions": "Custom instructions for this message"
    }
  }'
```

### SMS Server Endpoints
```bash
# HTTP (Tailscale/Internal)
http://100.92.179.100:3081/api/receive-sms

# HTTPS (External, if SSL configured)
https://100.92.179.100:3081/api/receive-sms
```

### Environment Configuration
```env
# SMS Server
LIBRECHAT_AGENT_ID=agent_YOUR_AGENT_ID
LIBRECHAT_AGENT_MODEL=gpt-4o
EXTERNAL_MESSAGE_API_KEY=your_api_key
PORT=3081

# Optional SSL (leave blank for HTTP-only)
SSL_KEY_PATH=/path/to/private.key
SSL_CERT_PATH=/path/to/certificate.crt
```

---

## Troubleshooting

### Common Issues ✅ RESOLVED

1. **"Connection refused"** → Fixed: HTTP/HTTPS protocol mismatch
2. **"Agent not found"** → Fixed: User context setup before agent loading
3. **"Conversation not found"** → Fixed: External Client conversation creation

### Current Focus Areas

1. **Instructions not being used** → Need to verify agent instruction integration
2. **Response customization** → Ensure agent behavior matches dynamic context

---

## Questions for Investigation

### 🔍 Immediate Focus: Instructions

1. **Are dynamic instructions from SMS server being used by the agent?**
   - Check if `metadata.instructions` reach the agent system
   - Verify if they override/supplement base agent instructions
   - Test different instruction content and verify behavioral changes

2. **What's the best approach for instruction handling?**
   - External Client modification vs SMS Server content appending
   - Performance implications of each approach
   - Maintainability and scalability considerations

### 🤔 Future Considerations

1. **How to handle instruction conflicts?**
   - Dynamic instructions vs agent base instructions
   - Priority and override mechanisms

2. **Should we support instruction templates?**
   - Predefined instruction sets for different scenarios
   - Template parameters for dynamic content

---

## Success Metrics ✅

### Achieved
- [x] External SMS messages route to agents
- [x] Conversations persist per phone number  
- [x] Agents generate appropriate responses
- [x] HTTP/HTTPS protocol flexibility
- [x] Environment-based configuration

### In Progress
- [ ] LibreChat variable system research
- [ ] Phone number variable integration
- [ ] Dedicated SMS agent creation

### Planned  
- [ ] Variable-based context passing
- [ ] Multi-agent routing
- [ ] Advanced context awareness
- [ ] Production-ready scalability 