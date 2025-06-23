# LibreChat External Message System Testing Environment Setup

This guide covers setting up the environment variables required for running the comprehensive testing suite for LibreChat's external message system integration.

## 📋 **Required Environment Variables**

Create a `.env` file in your LibreChat root directory with the following variables:

### 🗄️ **Database Configuration**
```bash
# MongoDB connection string for LibreChat database
MONGO_URI=mongodb://localhost:27017/LibreChat

# Alternative for production environments:
# MONGO_URI=mongodb://username:password@host:port/LibreChat
```

### 🔐 **Authentication & Security**
```bash
# JWT secret for token generation and validation
# Generate a secure random string for production use
JWT_SECRET=your_jwt_secret_here_change_this_in_production

# External Message API Key for SMS and external system authentication
# This key is used to authenticate external systems sending messages to LibreChat
EXTERNAL_MESSAGE_API_KEY=your_external_api_key_here_change_this_in_production
```

### 🌐 **Server Configuration**
```bash
# Base URL for LibreChat server (used in testing)
# Optional - defaults to http://localhost:3080 if not set
BASE_URL=http://localhost:3080
TEST_BASE_URL=http://localhost:3080
```

### 🔧 **MCP (Model Context Protocol) Configuration**
```bash
# MongoDB configuration for MCP servers
MONGODB_CONNECTION_STRING=mongodb://localhost:27017
MONGODB_DATABASE=LibreChat
MONGODB_COLLECTION=mcp_memory

# MCP Storage Configuration
MCP_STORAGE_TYPE=paginated-graph
MCP_USER_BASED=true

# Dynamic MCP User ID (set by MCP server at runtime)
# MCP_USER_ID=${USER_ID}  # This is a template value filled by the system
```

## 🧪 **Test File Requirements**

Each test file validates specific environment variables:

### **`test_user_creation.js`**
```bash
Required:
- MONGO_URI
- JWT_SECRET
- EXTERNAL_MESSAGE_API_KEY

Optional:
- TEST_BASE_URL (defaults to localhost:3080)
```

### **`test_sse_realtime.js`**
```bash
Required:
- JWT_SECRET
- EXTERNAL_MESSAGE_API_KEY

Optional:
- TEST_BASE_URL (defaults to localhost:3080)
```

### **`test_jwt_authentication.js`**
```bash
Required:
- JWT_SECRET
- EXTERNAL_MESSAGE_API_KEY

Optional:
- TEST_BASE_URL (defaults to localhost:3080)
```

### **`test_mcp_connectivity.js`**
```bash
Required:
- MONGO_URI
```

### **`test_mcp_user_isolation.js`**
```bash
Required:
- MONGO_URI
```

### **`test_end_to_end.js`**
```bash
Required:
- EXTERNAL_MESSAGE_API_KEY

Optional:
- TEST_BASE_URL (defaults to localhost:3080)
```

## 🚀 **Quick Setup Guide**

1. **Create `.env` file**:
   ```bash
   cp .env.example .env  # If you have an example file
   # OR create a new .env file
   ```

2. **Add required variables**:
   ```bash
   # Minimum required for testing
   MONGO_URI=mongodb://localhost:27017/LibreChat
   JWT_SECRET=generate_a_secure_random_string_here
   EXTERNAL_MESSAGE_API_KEY=your_api_key_for_external_systems
   ```

3. **Test environment validation**:
   ```bash
   # Each test file will validate variables and show clear error messages
   node test_user_creation.js
   ```

## ⚠️ **Environment Variable Validation**

All test files now include automatic validation that will:

- ✅ Check for required environment variables on startup
- ❌ Exit with clear error messages if variables are missing
- 📝 Show exactly which variables need to be set in `.env`
- 🔧 Provide example values for missing variables

### **Example Error Message**:
```bash
❌ Missing required environment variables in .env file:
   - JWT_SECRET
   - EXTERNAL_MESSAGE_API_KEY

Please ensure these variables are set in your .env file:
   JWT_SECRET=your_jwt_secret_here
   EXTERNAL_MESSAGE_API_KEY=your_api_key_here
   TEST_BASE_URL=http://localhost:3080  # Optional, defaults to localhost:3080
```

## 🔒 **Security Best Practices**

1. **Never commit actual credentials** to version control
2. **Use strong, unique values** for JWT_SECRET and API keys
3. **Restrict database access** to necessary IPs only
4. **Use environment-specific files** (.env.development, .env.production)
5. **Rotate secrets regularly** in production environments

## 🧪 **Running the Test Suite**

Once your `.env` file is configured:

```bash
# Run individual tests
node test_user_creation.js
node test_sse_realtime.js
node test_jwt_authentication.js

# Run complete test suite
node run_all_tests.js
```

## 🛠️ **Troubleshooting**

### **MongoDB Connection Issues**
```bash
# Check if MongoDB is running
mongo --eval "db.adminCommand('ismaster')"

# Or for newer MongoDB versions
mongosh --eval "db.adminCommand('ismaster')"

# Start MongoDB if not running
sudo systemctl start mongodb  # Linux
brew services start mongodb/brew/mongodb-community  # macOS
```

### **Port Conflicts**
```bash
# Check if port 3080 is in use
lsof -i :3080

# Use different port if needed
TEST_BASE_URL=http://localhost:3081
```

### **Permission Issues**
```bash
# Ensure MongoDB data directory permissions
sudo chown -R mongodb:mongodb /var/lib/mongodb
sudo chown mongodb:mongodb /tmp/mongodb-27017.sock
```

## 📚 **Additional Configuration**

### **Optional Services for Full Integration Testing**

```bash
# Speech-to-Text (OpenAI)
STT_API_KEY=your_openai_api_key_for_stt

# Twilio SMS Integration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number

# Google Calendar API (for MCP calendar integration)
GOOGLE_CALENDAR_API_KEY=path/to/google/credentials.json
```

### **Development vs Production**

```bash
# Development
NODE_ENV=development
LOG_LEVEL=debug

# Production
NODE_ENV=production
LOG_LEVEL=info
```

This setup ensures that all test files can run successfully with proper environment variable validation and clear error reporting. 