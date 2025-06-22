#!/bin/bash

# SMS User Creation Debug Script - Manual Testing
# Set your environment variables first:
# export EXTERNAL_MESSAGE_API_KEY=your_api_key_here

echo "🔧 SMS User Creation Manual Testing"
echo "==================================="
echo ""

# Configuration
BASE_URL="http://localhost:3080"
TEST_PHONE="+15551234567"
API_KEY="${EXTERNAL_MESSAGE_API_KEY}"

if [ -z "$API_KEY" ]; then
    echo "❌ ERROR: Please set EXTERNAL_MESSAGE_API_KEY environment variable"
    echo "   export EXTERNAL_MESSAGE_API_KEY=your_actual_api_key"
    exit 1
fi

echo "Configuration:"
echo "  Base URL: $BASE_URL"
echo "  Test Phone: $TEST_PHONE"
echo "  API Key: ✅ Set"
echo ""

# Step 1: Test Invalid API Key (should get 403)
echo "📝 Step 1: Testing Invalid API Key (expect 403)"
echo "----------------------------------------------"
curl -X POST "$BASE_URL/api/messages/sms-conversation" \
  -H "Content-Type: application/json" \
  -H "x-api-key: INVALID_KEY" \
  -d '{
    "role": "external",
    "content": "Test invalid key",
    "from": "'$TEST_PHONE'",
    "metadata": {
      "phoneNumber": "'$TEST_PHONE'",
      "source": "sms"
    }
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  -s
echo ""
echo "✅ Step 1 completed"
echo ""

# Step 2: Test Valid API Key with Phone Number
echo "📱 Step 2: Testing Valid API Key and Phone Number"
echo "------------------------------------------------"
curl -X POST "$BASE_URL/api/messages/sms-conversation" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "role": "external",
    "content": "Hello, this should create a new SMS user!",
    "from": "'$TEST_PHONE'",
    "metadata": {
      "phoneNumber": "'$TEST_PHONE'",
      "source": "sms",
      "messageType": "text"
    }
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  -v
echo ""
echo "✅ Step 2 completed"
echo ""

# Step 3: Test Different Phone Formats
echo "🔢 Step 3: Testing Different Phone Number Formats"
echo "------------------------------------------------"

PHONE_FORMATS=(
  "+15551234567"
  "15551234567"
  "5551234567"
  "+1 (555) 123-4567"
  "555-123-4567"
  "invalid123"
)

for phone in "${PHONE_FORMATS[@]}"; do
  echo "Testing format: $phone"
  
  response=$(curl -X POST "$BASE_URL/api/messages/sms-conversation" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{
      "role": "external",
      "content": "Format test: '$phone'",
      "from": "'$phone'",
      "metadata": {
        "phoneNumber": "'$phone'",
        "source": "sms"
      }
    }' \
    -w "%{http_code}" \
    -s \
    -o /tmp/sms_response.json)
  
  if [ "$response" = "200" ] || [ "$response" = "201" ]; then
    echo "  ✅ $phone: Success (HTTP $response)"
  else
    echo "  ❌ $phone: Failed (HTTP $response)"
    echo "     Response: $(cat /tmp/sms_response.json)"
  fi
done

echo ""
echo "✅ Step 3 completed"
echo ""

# Step 4: Check MongoDB for Created Users
echo "🗄️  Step 4: Checking MongoDB for Created Users"
echo "---------------------------------------------"
echo "Run this command to check MongoDB:"
echo ""
echo "mongosh 'mongodb://localhost:27017/LibreChat' --eval \""
echo "  console.log('📊 SMS Users in Database:');"
echo "  db.users.find({provider: 'sms'}).forEach(user => {"
echo "    console.log('Phone:', user.phoneNumber, 'ID:', user._id.toString());"
echo "    console.log('Email:', user.email);"
echo "    console.log('Created:', user.createdAt);"
echo "    console.log('---');"
echo "  });"
echo "  console.log('Total SMS users:', db.users.countDocuments({provider: 'sms'}));"
echo "\""
echo ""

# If mongosh is available, try to run it
if command -v mongosh &> /dev/null; then
    echo "🔍 Attempting to check MongoDB..."
    mongosh 'mongodb://localhost:27017/LibreChat' --eval "
      console.log('📊 SMS Users in Database:');
      db.users.find({provider: 'sms'}).forEach(user => {
        console.log('Phone:', user.phoneNumber, 'ID:', user._id.toString());
        console.log('Email:', user.email);
        console.log('Created:', user.createdAt);
        console.log('---');
      });
      console.log('Total SMS users:', db.users.countDocuments({provider: 'sms'}));
    " 2>/dev/null || echo "⚠️  MongoDB connection failed - check connection manually"
else
    echo "⚠️  mongosh not found - check MongoDB manually using the command above"
fi

echo ""
echo "✅ Step 4 completed"
echo ""

# Step 5: Test Specific User Creation and Verification
echo "🔍 Step 5: Focused User Creation Test"
echo "------------------------------------"

# Clean up test user first (if mongosh available)
if command -v mongosh &> /dev/null; then
    echo "Cleaning up existing test user..."
    mongosh 'mongodb://localhost:27017/LibreChat' --eval "
      db.users.deleteMany({phoneNumber: '$TEST_PHONE'});
      console.log('Cleaned up test users for $TEST_PHONE');
    " 2>/dev/null
fi

echo "Creating user for $TEST_PHONE..."
response=$(curl -X POST "$BASE_URL/api/messages/sms-conversation" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "role": "external",
    "content": "Hello! This is a focused test to create user '$TEST_PHONE'",
    "from": "'$TEST_PHONE'",
    "metadata": {
      "phoneNumber": "'$TEST_PHONE'",
      "source": "sms",
      "messageType": "text",
      "testType": "focused"
    }
  }' \
  -w "%{http_code}" \
  -s \
  -o /tmp/sms_focused_response.json)

echo "HTTP Response Code: $response"
echo "Response Body:"
cat /tmp/sms_focused_response.json
echo ""

# Wait for database write
echo "Waiting 3 seconds for database write..."
sleep 3

# Check if user was created
if command -v mongosh &> /dev/null; then
    echo "Checking if user was created..."
    mongosh 'mongodb://localhost:27017/LibreChat' --eval "
      const user = db.users.findOne({phoneNumber: '$TEST_PHONE'});
      if (user) {
        console.log('✅ SUCCESS: User found!');
        console.log('  ID:', user._id.toString());
        console.log('  Phone:', user.phoneNumber);
        console.log('  Email:', user.email);
        console.log('  Provider:', user.provider);
        console.log('  Created:', user.createdAt);
        console.log('  Metadata:', JSON.stringify(user.metadata, null, 2));
      } else {
        console.log('❌ FAILURE: User not found for phone: $TEST_PHONE');
        console.log('All SMS users in database:');
        db.users.find({provider: 'sms'}).forEach(u => {
          console.log('  Phone:', u.phoneNumber, 'ID:', u._id.toString());
        });
      }
    " 2>/dev/null
else
    echo "⚠️  Cannot verify user creation - mongosh not available"
fi

echo ""
echo "✅ Step 5 completed"
echo ""

# Summary and Next Steps
echo "🎉 Manual Testing Complete!"
echo "============================"
echo ""
echo "📋 What to check next:"
echo "1. Did Step 2 return HTTP 200/201? If not, check:"
echo "   - LibreChat server is running on $BASE_URL"
echo "   - API key is correct in environment variable"
echo "   - External message endpoint is configured"
echo ""
echo "2. Did Step 5 show 'SUCCESS: User found!'? If not:"
echo "   - Check LibreChat server logs: tail -f api/logs/*.log"
echo "   - Look for validateExternalMessage logs"
echo "   - Check for user creation errors"
echo ""
echo "3. Check server logs for detailed information:"
echo "   docker-compose logs librechat | grep -i sms"
echo "   # or if running directly:"
echo "   tail -f api/logs/debug.log | grep -E '(validateExternalMessage|getOrCreateSMSUser)'"
echo ""
echo "4. Common issues to investigate:"
echo "   - validateExternalMessage middleware not being called"
echo "   - Phone number validation failing"
echo "   - MongoDB connection issues"
echo "   - User model createUser() function failing"
echo "   - Database write permissions"
echo ""

# Cleanup
rm -f /tmp/sms_response.json /tmp/sms_focused_response.json

echo "🔧 Next: Run 'node debug_sms_user_creation.js' for automated analysis" 