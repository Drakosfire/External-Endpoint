# External Agent Integration

## Current Understanding

### Agent Promise Flow
- The agent promise is a Promise that resolves to an agent configuration object
- Required when the endpoint is 'agents'
- Contains agent capabilities, tools, and configuration
- Must be passed in `endpointOption.agent`

### Working Flow in Regular Messages
```javascript
// In messages.js
const agent = await loadAgent({
  req,
  agent_id: conversation.agent_id,
  endpoint: conversation.endpoint,
  model_parameters: conversation.model_parameters
});

if (!agent) {
  throw new Error('Agent not found');
}

endpointOption.agent = Promise.resolve(agent);
endpointOption.agent_id = conversation.agent_id;
```

### External Endpoint Differences
- Operates outside the normal request/response cycle
- Handles messages asynchronously
- Needs to maintain context across multiple operations
- Has its own client initialization flow

## Investigation Results

### Code Flow Analysis

#### Regular Flow (Working)
```
messages.js 
→ loadAgent() 
→ Promise.resolve(agent) 
→ endpointOption.agent 
→ initializeClient 
→ process message
```

#### External Flow (Current)
```
ExternalClient.processWithLLM 
→ loadAgent() 
→ Promise.resolve(agent) 
→ endpointOption.agent 
→ initializeLLMClient 
→ process message
```

### Context Requirements
- User context (from JWT or provided)
- Request/Response objects
- Agent ID and parameters
- Model configuration

### Initialization Differences
- Regular flow: Direct request/response cycle
- External flow: Asynchronous message processing
- Context preservation challenges
- Different client initialization

## Solution Approaches

### Context Preservation
1. Ensure all necessary context is passed through
2. Verify user and request objects
3. Check model parameters
4. Maintain JWT token handling

### Promise Handling
1. Try different promise resolution strategies
2. Consider async initialization
3. Look at error handling
4. Ensure proper promise chain

### Error Management
1. Proper error logging
2. Context-aware error messages
3. Graceful fallbacks
4. User feedback

## Implementation Notes

### Required Changes
1. Proper agent promise creation
2. Context preservation
3. Error handling
4. Logging improvements

### Testing Strategy
1. Logging Points:
   - Agent loading
   - Promise creation
   - Client initialization
   - Message processing

2. Error Cases:
   - Missing agent
   - Invalid promise
   - Context issues
   - JWT handling

### Future Considerations
1. Better context management
2. Improved error handling
3. Enhanced logging
4. Performance optimization

## Current Issues

### Agent Promise Error
- Error: "No agent promise provided"
- Occurs in external message processing
- Related to promise handling in external client
- Needs investigation of promise resolution timing

### Context Issues
- User context preservation
- Request/Response object handling
- JWT token recovery
- Model parameter passing

## Next Steps

1. **Code Investigation**:
   - Examine agents/initialize.js
   - Look at agents/build.js
   - Check external/initialize.js
   - Compare initialization flows

2. **Implementation**:
   - Fix promise handling
   - Improve context preservation
   - Enhance error handling
   - Add comprehensive logging

3. **Testing**:
   - Verify agent loading
   - Check promise resolution
   - Test error cases
   - Validate context preservation 