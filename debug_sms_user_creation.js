#!/usr/bin/env node

/**
 * SMS User Creation Debug Script
 * Step-by-step testing to identify where user creation breaks down
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Configuration
const config = {
  baseUrl: 'http://localhost:3080',
  apiKey: process.env.EXTERNAL_MESSAGE_API_KEY || 'your_sms_api_key',
  testPhoneNumber: '+15551234567',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/LibreChat'
};

console.log('🔧 SMS User Creation Debug Script');
console.log('==================================\n');

// Step 1: Test API Key Authentication
async function testApiKeyAuth() {
  console.log('📝 Step 1: Testing API Key Authentication');
  console.log('----------------------------------------');

  const curlCommand = `curl -X POST ${config.baseUrl}/api/messages/sms-conversation \\
    -H "Content-Type: application/json" \\
    -H "x-api-key: INVALID_KEY" \\
    -d '{
      "role": "external",
      "content": "Test auth",
      "from": "${config.testPhoneNumber}",
      "metadata": {
        "phoneNumber": "${config.testPhoneNumber}",
        "source": "sms"
      }
    }' \\
    -v`;

  console.log('Testing with INVALID API key (expect 403):');
  console.log(curlCommand);
  console.log('\n');

  try {
    const { stdout, stderr } = await execAsync(curlCommand);
    console.log('Response:', stdout);
    console.log('Stderr:', stderr);
  } catch (error) {
    console.log('Expected error (403):', error.message);
  }

  console.log('\n✅ API Key auth test completed\n');
}

// Step 2: Test Valid API Key and Phone Number Extraction
async function testPhoneNumberExtraction() {
  console.log('📱 Step 2: Testing Phone Number Extraction');
  console.log('------------------------------------------');

  const curlCommand = `curl -X POST ${config.baseUrl}/api/messages/sms-conversation \\
    -H "Content-Type: application/json" \\
    -H "x-api-key: ${config.apiKey}" \\
    -d '{
      "role": "external",
      "content": "Test phone extraction",
      "from": "${config.testPhoneNumber}",
      "metadata": {
        "phoneNumber": "${config.testPhoneNumber}",
        "source": "sms"
      }
    }' \\
    -v`;

  console.log('Testing phone number extraction:');
  console.log(curlCommand);
  console.log('\n');

  try {
    const { stdout, stderr } = await execAsync(curlCommand);
    console.log('Response:', stdout);

    // Parse response to check for user creation logs
    if (stdout.includes('error')) {
      console.log('❌ Request failed');
    } else {
      console.log('✅ Request succeeded');
    }
  } catch (error) {
    console.log('Error:', error.message);
  }

  console.log('\n✅ Phone number extraction test completed\n');
}

// Step 3: Test Different Phone Number Formats
async function testPhoneNumberFormats() {
  console.log('🔢 Step 3: Testing Different Phone Number Formats');
  console.log('--------------------------------------------------');

  const phoneFormats = [
    '+15551234567',      // E.164 format
    '15551234567',       // Without + prefix
    '5551234567',        // Without country code
    '+1 (555) 123-4567', // Formatted with spaces/parentheses
    '555-123-4567',      // Dashes only
    'invalid123'         // Invalid format (should fail)
  ];

  for (const phone of phoneFormats) {
    console.log(`Testing format: ${phone}`);

    const curlCommand = `curl -X POST ${config.baseUrl}/api/messages/sms-conversation \\
      -H "Content-Type: application/json" \\
      -H "x-api-key: ${config.apiKey}" \\
      -d '{
        "role": "external",
        "content": "Format test: ${phone}",
        "from": "${phone}",
        "metadata": {
          "phoneNumber": "${phone}",
          "source": "sms"
        }
      }' \\
      --silent \\
      --max-time 10`;

    try {
      const { stdout } = await execAsync(curlCommand);
      const response = JSON.parse(stdout);

      if (response.error) {
        console.log(`  ❌ ${phone}: ${response.error}`);
      } else {
        console.log(`  ✅ ${phone}: Success`);
      }
    } catch (error) {
      console.log(`  ❌ ${phone}: Request failed - ${error.message}`);
    }
  }

  console.log('\n✅ Phone format tests completed\n');
}

// Step 4: MongoDB User Creation Check
async function checkMongoDBUserCreation() {
  console.log('🗄️  Step 4: Checking MongoDB User Creation');
  console.log('-------------------------------------------');

  const mongoCommand = `mongosh "${config.mongoUri}" --eval "
    console.log('📊 Current SMS users in database:');
    db.users.find({provider: 'sms'}).forEach(user => {
      console.log('User ID:', user._id.toString());
      console.log('Phone:', user.phoneNumber);
      console.log('Email:', user.email);
      console.log('Created:', user.createdAt);
      console.log('Metadata:', JSON.stringify(user.metadata, null, 2));
      console.log('---');
    });
    
    console.log('📈 Total SMS users:', db.users.countDocuments({provider: 'sms'}));
  "`;

  console.log('Checking MongoDB for SMS users:');
  console.log(mongoCommand);
  console.log('\n');

  try {
    const { stdout } = await execAsync(mongoCommand);
    console.log(stdout);
  } catch (error) {
    console.log('MongoDB check failed:', error.message);
    console.log('Note: Make sure MongoDB is running and accessible');
  }

  console.log('\n✅ MongoDB user check completed\n');
}

// Step 5: Test User Creation with Detailed Logging
async function testDetailedUserCreation() {
  console.log('🔍 Step 5: Testing User Creation with Detailed Logging');
  console.log('------------------------------------------------------');

  // Clean up existing test user first
  const cleanupCommand = `mongosh "${config.mongoUri}" --eval "
    db.users.deleteMany({phoneNumber: '${config.testPhoneNumber}'});
    console.log('Cleaned up existing test users');
  "`;

  console.log('Cleaning up existing test users...');
  try {
    await execAsync(cleanupCommand);
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.log('⚠️  Cleanup warning:', error.message);
  }

  // Now test user creation
  const curlCommand = `curl -X POST ${config.baseUrl}/api/messages/sms-conversation \\
    -H "Content-Type: application/json" \\
    -H "x-api-key: ${config.apiKey}" \\
    -d '{
      "role": "external",
      "content": "Hello, this should create a new user!",
      "from": "${config.testPhoneNumber}",
      "metadata": {
        "phoneNumber": "${config.testPhoneNumber}",
        "source": "sms",
        "messageType": "text"
      }
    }' \\
    -v`;

  console.log('\nSending user creation request:');
  console.log(curlCommand);
  console.log('\n');

  try {
    const { stdout, stderr } = await execAsync(curlCommand);
    console.log('Response:', stdout);
    console.log('Debug info:', stderr);

    // Wait a moment for database write
    console.log('\nWaiting 2 seconds for database write...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if user was created
    const checkCommand = `mongosh "${config.mongoUri}" --eval "
      const user = db.users.findOne({phoneNumber: '${config.testPhoneNumber}'});
      if (user) {
        console.log('✅ User FOUND:');
        console.log('  ID:', user._id.toString());
        console.log('  Phone:', user.phoneNumber);
        console.log('  Email:', user.email);
        console.log('  Provider:', user.provider);
        console.log('  Created:', user.createdAt);
        console.log('  Metadata:', JSON.stringify(user.metadata, null, 2));
      } else {
        console.log('❌ User NOT FOUND for phone: ${config.testPhoneNumber}');
        console.log('📊 All SMS users:');
        db.users.find({provider: 'sms'}).forEach(u => console.log('  Phone:', u.phoneNumber, 'ID:', u._id.toString()));
      }
    "`;

    console.log('Checking if user was created...');
    const { stdout: checkResult } = await execAsync(checkCommand);
    console.log(checkResult);

  } catch (error) {
    console.log('Error during user creation test:', error.message);
  }

  console.log('\n✅ Detailed user creation test completed\n');
}

// Step 6: Test Multiple User Creation (Isolation)
async function testUserIsolation() {
  console.log('👥 Step 6: Testing User Isolation (Multiple Phone Numbers)');
  console.log('----------------------------------------------------------');

  const testPhones = ['+15551111111', '+15552222222', '+15553333333'];

  for (const phone of testPhones) {
    console.log(`Creating user for ${phone}...`);

    const curlCommand = `curl -X POST ${config.baseUrl}/api/messages/sms-conversation \\
      -H "Content-Type: application/json" \\
      -H "x-api-key: ${config.apiKey}" \\
      -d '{
        "role": "external",
        "content": "Hello from ${phone}",
        "from": "${phone}",
        "metadata": {
          "phoneNumber": "${phone}",
          "source": "sms"
        }
      }' \\
      --silent \\
      --max-time 10`;

    try {
      const { stdout } = await execAsync(curlCommand);
      console.log(`  Response length: ${stdout.length} chars`);
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
    }
  }

  // Check all created users
  console.log('\nChecking all created test users...');
  const checkCommand = `mongosh "${config.mongoUri}" --eval "
    console.log('📊 All test SMS users:');
    db.users.find({
      provider: 'sms',
      phoneNumber: {\\$in: ${JSON.stringify(testPhones)}}
    }).forEach(user => {
      console.log('Phone:', user.phoneNumber, 'ID:', user._id.toString(), 'Created:', user.createdAt);
    });
    
    const count = db.users.countDocuments({
      provider: 'sms',
      phoneNumber: {\\$in: ${JSON.stringify(testPhones)}}
    });
    console.log('Total users created:', count, '/ Expected:', ${testPhones.length});
  "`;

  try {
    const { stdout } = await execAsync(checkCommand);
    console.log(stdout);
  } catch (error) {
    console.log('Check failed:', error.message);
  }

  console.log('\n✅ User isolation test completed\n');
}

// Step 7: Log Analysis
async function analyzeServerLogs() {
  console.log('📋 Step 7: Analyzing Server Logs');
  console.log('----------------------------------');

  console.log('Looking for SMS user creation logs...');
  console.log('Check these log patterns in your LibreChat logs:');
  console.log('');
  console.log('1. validateExternalMessage logs:');
  console.log('   grep "validateExternalMessage" api/logs/*.log');
  console.log('');
  console.log('2. User creation logs:');
  console.log('   grep "getOrCreateSMSUser" api/logs/*.log');
  console.log('');
  console.log('3. MongoDB operation logs:');
  console.log('   grep "Creating new SMS user" api/logs/*.log');
  console.log('');
  console.log('4. Error logs:');
  console.log('   grep "ERROR" api/logs/*.log | grep -i sms');
  console.log('');

  // Try to show recent logs if log files exist
  const logCommands = [
    'tail -20 api/logs/debug.log 2>/dev/null | grep -i sms || echo "No debug.log found"',
    'tail -20 api/logs/error.log 2>/dev/null | grep -i sms || echo "No error.log found"',
    'find . -name "*.log" -type f 2>/dev/null | head -5 || echo "No log files found"'
  ];

  for (const cmd of logCommands) {
    try {
      const { stdout } = await execAsync(cmd);
      console.log(`Command: ${cmd}`);
      console.log(stdout);
      console.log('---');
    } catch (error) {
      console.log(`Command failed: ${cmd}`);
    }
  }

  console.log('\n✅ Log analysis completed\n');
}

// Main execution
async function runDebugSuite() {
  console.log(`🚀 Starting SMS User Creation Debug Suite`);
  console.log(`Configuration:`);
  console.log(`  Base URL: ${config.baseUrl}`);
  console.log(`  Test Phone: ${config.testPhoneNumber}`);
  console.log(`  MongoDB: ${config.mongoUri}`);
  console.log(`  API Key: ${config.apiKey ? '✅ Set' : '❌ Missing'}`);
  console.log('');

  if (!config.apiKey || config.apiKey === 'your_sms_api_key') {
    console.log('❌ ERROR: Please set EXTERNAL_MESSAGE_API_KEY environment variable');
    console.log('   export EXTERNAL_MESSAGE_API_KEY=your_actual_api_key');
    process.exit(1);
  }

  try {
    await testApiKeyAuth();
    await testPhoneNumberExtraction();
    await testPhoneNumberFormats();
    await checkMongoDBUserCreation();
    await testDetailedUserCreation();
    await testUserIsolation();
    await analyzeServerLogs();

    console.log('🎉 Debug Suite Complete!');
    console.log('========================');
    console.log('');
    console.log('Next Steps:');
    console.log('1. Check the MongoDB results above');
    console.log('2. Review any error messages');
    console.log('3. Examine server logs for detailed error information');
    console.log('4. If users are not being created, check:');
    console.log('   - LibreChat server is running');
    console.log('   - MongoDB is accessible');
    console.log('   - validateExternalMessage middleware is working');
    console.log('   - User model creation is not failing');

  } catch (error) {
    console.error('❌ Debug suite failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runDebugSuite().catch(console.error);
}

module.exports = {
  runDebugSuite,
  testApiKeyAuth,
  testPhoneNumberExtraction,
  testDetailedUserCreation,
  checkMongoDBUserCreation
}; 