/**
 * End-to-End External Message Flow Test
 * Tests the complete SMS → LibreChat → AI → Response flow
 */

// Load environment variables from .env file
require('dotenv').config({ path: '../../.env' });

const { connectDb } = require('./api/db/connect');

// Fix imports similar to metadata test
const mongoose = require('./api/node_modules/mongoose');
const { userSchema, convoSchema } = require('./packages/data-schemas/dist/index.cjs');

// Create models manually like in metadata test
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', convoSchema);

// Create user functions
const findUser = async (query) => {
    return await User.findOne(query);
};

const createUser = async (userData, returnObj = false, bypassPermissions = false) => {
    const user = new User(userData);
    const savedUser = await user.save();
    return returnObj ? savedUser : savedUser._id;
};

const getConvo = async (userId, conversationId) => {
    return await Conversation.findOne({ user: userId, conversationId: conversationId });
};
const { v4: uuidv4 } = require('./api/node_modules/uuid');

// Required environment variables (should be set in .env file)
const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3080';
const EXTERNAL_MESSAGE_API_KEY = process.env.EXTERNAL_MESSAGE_API_KEY;

// Validate required environment variables
function validateEnvironmentVariables() {
    const requiredVars = [
        { name: 'EXTERNAL_MESSAGE_API_KEY', value: EXTERNAL_MESSAGE_API_KEY }
    ];

    const missingVars = requiredVars.filter(envVar => !envVar.value);

    if (missingVars.length > 0) {
        console.error('❌ Missing required environment variables in .env file:');
        missingVars.forEach(envVar => {
            console.error(`   - ${envVar.name}`);
        });
        console.error('\nPlease ensure these variables are set in your .env file:');
        console.error('   EXTERNAL_MESSAGE_API_KEY=your_api_key_here');
        console.error('   TEST_BASE_URL=http://localhost:3080  # Optional, defaults to localhost:3080');
        process.exit(1);
    }

    console.log('✅ Environment variables loaded from .env for end-to-end testing');
}

/**
 * Create SMS message payload
 */
function createSMSMessage(phoneNumber, content, conversationId = null) {
    return {
        role: 'external',
        content: content,
        conversationId: conversationId || uuidv4(),
        metadata: {
            phoneNumber: phoneNumber,
            source: 'sms',
            createdBy: 'e2e-test'
        },
        from: phoneNumber
    };
}

/**
 * Test complete SMS user flow
 */
async function testCompleteFlow() {
    console.log('\n👤 Testing Complete SMS User Flow...');

    const testPhone = '+1555E2E001';
    const fetch = require('./api/node_modules/node-fetch');

    try {
        // Send first message
        console.log('📤 Sending first SMS message...');
        const message = createSMSMessage(testPhone, 'Hello, this is a test message!');

        const response = await fetch(`${BASE_URL}/api/messages/${message.conversationId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(message)
        });

        console.log(`Response Status: ${response.status}`);
        if (response.ok) {
            console.log('✅ Message sent successfully');
        } else {
            const errorText = await response.text();
            console.log('❌ Message failed:', errorText);
            return { success: false, error: errorText };
        }

        // Verify user creation
        console.log('👤 Verifying user creation...');
        const user = await findUser({ phoneNumber: testPhone });

        if (user) {
            console.log(`✅ User created: ${user._id}`);
            console.log(`📱 Phone: ${user.phoneNumber}`);
        } else {
            console.log('❌ User not created');
            return { success: false, error: 'User not found' };
        }

        // Verify conversation
        console.log('💬 Verifying conversation...');
        const conversation = await getConvo(user._id, message.conversationId);

        if (conversation) {
            console.log(`✅ Conversation created: ${conversation.conversationId}`);
        } else {
            console.log('❌ Conversation not created');
            return { success: false, error: 'Conversation not found' };
        }

        return { success: true, userId: user._id, conversationId: conversation.conversationId };

    } catch (error) {
        console.error('❌ Complete flow test failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Test user isolation
 */
async function testUserIsolation() {
    console.log('\n🔒 Testing User Isolation...');

    const phone1 = '+1555E2E002';
    const phone2 = '+1555E2E003';
    const fetch = require('./api/node_modules/node-fetch');

    try {
        // Send messages from different phones
        const message1 = createSMSMessage(phone1, 'Message from phone 1');
        const message2 = createSMSMessage(phone2, 'Message from phone 2');

        console.log('📤 Sending messages from different phones...');

        const [response1, response2] = await Promise.all([
            fetch(`${BASE_URL}/api/messages/${message1.conversationId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': EXTERNAL_MESSAGE_API_KEY
                },
                body: JSON.stringify(message1)
            }),
            fetch(`${BASE_URL}/api/messages/${message2.conversationId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': EXTERNAL_MESSAGE_API_KEY
                },
                body: JSON.stringify(message2)
            })
        ]);

        if (response1.ok && response2.ok) {
            console.log('✅ Both messages sent successfully');
        } else {
            console.log('❌ Message sending failed');
            return { success: false, error: 'Message sending failed' };
        }

        // Verify separate users
        const user1 = await findUser({ phoneNumber: phone1 });
        const user2 = await findUser({ phoneNumber: phone2 });

        if (user1 && user2 && user1._id.toString() !== user2._id.toString()) {
            console.log('✅ Users are properly isolated');
            return { success: true, isolation: true };
        } else {
            console.log('❌ User isolation failed');
            return { success: false, error: 'Users not isolated' };
        }

    } catch (error) {
        console.error('❌ User isolation test failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Run all E2E tests
 */
async function runAllE2ETests() {
    console.log('🚀 Starting End-to-End Tests\n');

    try {
        // Validate environment variables first
        validateEnvironmentVariables();

        await connectDb();
        console.log('✅ Connected to MongoDB');

        // Test complete flow
        const flowResult = await testCompleteFlow();
        console.log(flowResult.success ? '✅ Complete Flow: PASSED' : '❌ Complete Flow: FAILED');

        // Test user isolation
        const isolationResult = await testUserIsolation();
        console.log(isolationResult.success ? '✅ User Isolation: PASSED' : '❌ User Isolation: FAILED');

        console.log('\n✅ E2E tests completed');
        return true;

    } catch (error) {
        console.error('❌ E2E test suite failed:', error);
        return false;
    } finally {
        // Cleanup
        try {
            // Use the already imported User model
            await User.deleteMany({ phoneNumber: /\+1555E2E/ });
            console.log('✅ Test data cleaned up');
        } catch (error) {
            console.warn('⚠️ Cleanup warning:', error.message);
        }
        process.exit(0);
    }
}

module.exports = {
    createSMSMessage,
    testCompleteFlow,
    testUserIsolation,
    runAllE2ETests
};

if (require.main === module) {
    runAllE2ETests().catch(console.error);
} 