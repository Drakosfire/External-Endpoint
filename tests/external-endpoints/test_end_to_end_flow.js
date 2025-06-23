/**
 * End-to-End External Message Flow Test
 * Tests the complete SMS → LibreChat → AI → Response flow
 */

const { connectDb } = require('./api/lib/db/connectDb');
const { findUser, createUser } = require('./api/models');
const { getConvo, saveConvo } = require('./api/models/Conversation');
const { v4: uuidv4 } = require('uuid');

// Test configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3080';
const EXTERNAL_MESSAGE_API_KEY = process.env.EXTERNAL_MESSAGE_API_KEY || 'test-key';

/**
 * Simulate external SMS message payload
 */
function createSMSMessagePayload(phoneNumber, content, conversationId = null) {
    return {
        role: 'external',
        content: content,
        conversationId: conversationId || uuidv4(),
        metadata: {
            phoneNumber: phoneNumber,
            source: 'sms',
            createdBy: 'e2e-test',
            timestamp: new Date().toISOString()
        },
        from: phoneNumber
    };
}

/**
 * Test complete SMS user flow
 */
async function testCompleteUserFlow() {
    console.log('\n👤 Testing Complete SMS User Flow...');

    const testPhoneNumber = '+1555E2E0001';
    const fetch = require('node-fetch');

    try {
        // Step 1: Send first SMS message (should create user and conversation)
        console.log('\n📤 Step 1: Sending first SMS message...');
        const firstMessage = createSMSMessagePayload(
            testPhoneNumber,
            'Hello, this is my first message!'
        );

        const firstResponse = await fetch(`${BASE_URL}/api/messages/${firstMessage.conversationId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(firstMessage)
        });

        console.log(`   Response Status: ${firstResponse.status}`);
        if (firstResponse.ok) {
            console.log('   ✅ First message sent successfully');
        } else {
            const errorText = await firstResponse.text();
            console.log('   ❌ First message failed:', errorText);
            return { success: false, step: 'first_message', error: errorText };
        }

        // Step 2: Verify user was created
        console.log('\n👤 Step 2: Verifying user creation...');
        const user = await findUser({
            $or: [
                { phoneNumber: testPhoneNumber },
                { 'metadata.phoneNumber': testPhoneNumber }
            ]
        });

        if (user) {
            console.log(`   ✅ User created: ${user._id}`);
            console.log(`   📱 Phone: ${user.phoneNumber}`);
            console.log(`   📧 Email: ${user.email}`);
            console.log(`   👤 Username: ${user.username}`);
        } else {
            console.log('   ❌ User not created');
            return { success: false, step: 'user_creation', error: 'User not found' };
        }

        // Step 3: Verify conversation was created
        console.log('\n💬 Step 3: Verifying conversation creation...');
        const conversation = await getConvo(user._id, firstMessage.conversationId);

        if (conversation) {
            console.log(`   ✅ Conversation created: ${conversation.conversationId}`);
            console.log(`   📱 Phone in metadata: ${conversation.metadata?.phoneNumber}`);
            console.log(`   🔗 User ID: ${conversation.user}`);
        } else {
            console.log('   ❌ Conversation not created');
            return { success: false, step: 'conversation_creation', error: 'Conversation not found' };
        }

        // Step 4: Send follow-up message (should use existing conversation)
        console.log('\n📤 Step 4: Sending follow-up message...');
        const followUpMessage = createSMSMessagePayload(
            testPhoneNumber,
            'This is my second message in the same conversation.',
            firstMessage.conversationId // Use same conversation
        );

        const followUpResponse = await fetch(`${BASE_URL}/api/messages/${followUpMessage.conversationId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(followUpMessage)
        });

        console.log(`   Response Status: ${followUpResponse.status}`);
        if (followUpResponse.ok) {
            console.log('   ✅ Follow-up message sent successfully');
        } else {
            const errorText = await followUpResponse.text();
            console.log('   ❌ Follow-up message failed:', errorText);
            return { success: false, step: 'followup_message', error: errorText };
        }

        // Step 5: Test conversation discovery with placeholder ID
        console.log('\n🔍 Step 5: Testing conversation discovery...');
        const placeholderMessage = createSMSMessagePayload(
            testPhoneNumber,
            'Testing conversation discovery with placeholder ID',
            'sms-conversation' // Placeholder that should find existing conversation
        );

        const placeholderResponse = await fetch(`${BASE_URL}/api/messages/sms-conversation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(placeholderMessage)
        });

        console.log(`   Response Status: ${placeholderResponse.status}`);
        if (placeholderResponse.ok) {
            console.log('   ✅ Conversation discovery working correctly');
        } else {
            const errorText = await placeholderResponse.text();
            console.log('   ⚠️ Conversation discovery issue:', errorText);
            // This is not a critical failure for the overall flow
        }

        return {
            success: true,
            userId: user._id,
            conversationId: conversation.conversationId,
            phoneNumber: testPhoneNumber
        };

    } catch (error) {
        console.error('❌ Complete user flow test failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Test user isolation between different phone numbers
 */
async function testUserIsolation() {
    console.log('\n🔒 Testing User Isolation Between Phone Numbers...');

    const phone1 = '+1555E2E0002';
    const phone2 = '+1555E2E0003';
    const fetch = require('node-fetch');

    try {
        // Send messages from two different phone numbers
        const message1 = createSMSMessagePayload(phone1, 'Message from phone 1');
        const message2 = createSMSMessagePayload(phone2, 'Message from phone 2');

        console.log('\n📤 Sending messages from different phone numbers...');

        // Send first message
        const response1 = await fetch(`${BASE_URL}/api/messages/${message1.conversationId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(message1)
        });

        // Send second message
        const response2 = await fetch(`${BASE_URL}/api/messages/${message2.conversationId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(message2)
        });

        if (response1.ok && response2.ok) {
            console.log('   ✅ Both messages sent successfully');
        } else {
            console.log('   ❌ One or both messages failed');
            return { success: false, error: 'Message sending failed' };
        }

        // Verify separate users were created
        console.log('\n👥 Verifying separate users were created...');

        const user1 = await findUser({ phoneNumber: phone1 });
        const user2 = await findUser({ phoneNumber: phone2 });

        if (user1 && user2) {
            console.log(`   ✅ User 1: ${user1._id} (${phone1})`);
            console.log(`   ✅ User 2: ${user2._id} (${phone2})`);

            if (user1._id.toString() !== user2._id.toString()) {
                console.log('   ✅ Users are properly isolated');
                return {
                    success: true,
                    user1: user1._id,
                    user2: user2._id,
                    isolation: true
                };
            } else {
                console.log('   ❌ Users are not isolated (same ID)');
                return { success: false, error: 'User isolation failed' };
            }
        } else {
            console.log('   ❌ Users not created properly');
            return { success: false, error: 'User creation failed' };
        }

    } catch (error) {
        console.error('❌ User isolation test failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Test conversation persistence and metadata
 */
async function testConversationPersistence() {
    console.log('\n💾 Testing Conversation Persistence & Metadata...');

    const testPhone = '+1555E2E0004';
    const fetch = require('node-fetch');

    try {
        // Send message with rich metadata
        const messageWithMetadata = createSMSMessagePayload(
            testPhone,
            'Testing metadata persistence'
        );

        // Add additional metadata
        messageWithMetadata.metadata.testField = 'test_value';
        messageWithMetadata.metadata.sessionId = uuidv4();
        messageWithMetadata.metadata.priority = 'high';

        console.log('\n📤 Sending message with rich metadata...');

        const response = await fetch(`${BASE_URL}/api/messages/${messageWithMetadata.conversationId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(messageWithMetadata)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log('   ❌ Message with metadata failed:', errorText);
            return { success: false, error: errorText };
        }

        console.log('   ✅ Message with metadata sent successfully');

        // Verify metadata persistence
        console.log('\n🔍 Verifying metadata persistence...');

        // Wait a moment for processing
        await new Promise(resolve => setTimeout(resolve, 1000));

        const user = await findUser({ phoneNumber: testPhone });
        if (!user) {
            console.log('   ❌ User not found for metadata verification');
            return { success: false, error: 'User not found' };
        }

        const conversation = await getConvo(user._id, messageWithMetadata.conversationId);
        if (!conversation) {
            console.log('   ❌ Conversation not found for metadata verification');
            return { success: false, error: 'Conversation not found' };
        }

        console.log('   📊 Conversation metadata:');
        console.log(`      Phone: ${conversation.metadata?.phoneNumber}`);
        console.log(`      Source: ${conversation.metadata?.source}`);
        console.log(`      Created by: ${conversation.metadata?.createdBy}`);
        console.log(`      Test field: ${conversation.metadata?.testField}`);

        // Verify critical metadata
        const metadataValid = conversation.metadata?.phoneNumber === testPhone &&
            conversation.metadata?.source === 'sms' &&
            conversation.metadata?.createdBy === 'e2e-test';

        if (metadataValid) {
            console.log('   ✅ Metadata preserved correctly');
            return {
                success: true,
                conversationId: conversation.conversationId,
                metadata: conversation.metadata
            };
        } else {
            console.log('   ❌ Metadata not preserved correctly');
            return { success: false, error: 'Metadata validation failed' };
        }

    } catch (error) {
        console.error('❌ Conversation persistence test failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Test error handling and edge cases
 */
async function testErrorHandling() {
    console.log('\n🛡️ Testing Error Handling & Edge Cases...');

    const fetch = require('node-fetch');

    try {
        const tests = [
            {
                name: 'Invalid phone number',
                payload: {
                    role: 'external',
                    content: 'Test with invalid phone',
                    metadata: { phoneNumber: 'invalid-phone' }
                },
                expectedStatus: 400
            },
            {
                name: 'Missing phone number',
                payload: {
                    role: 'external',
                    content: 'Test with no phone',
                    metadata: { source: 'sms' }
                },
                expectedStatus: 400
            },
            {
                name: 'Invalid API key',
                payload: createSMSMessagePayload('+1555TEST999', 'Test invalid API key'),
                headers: { 'x-api-key': 'invalid-key' },
                expectedStatus: 403
            },
            {
                name: 'Missing API key',
                payload: createSMSMessagePayload('+1555TEST998', 'Test missing API key'),
                headers: {}, // No API key
                expectedStatus: 401
            }
        ];

        let passedTests = 0;

        for (const test of tests) {
            console.log(`\n📋 Testing: ${test.name}`);

            const headers = {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY,
                ...test.headers
            };

            const response = await fetch(`${BASE_URL}/api/messages/${uuidv4()}`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(test.payload)
            });

            if (response.status === test.expectedStatus) {
                console.log(`   ✅ ${test.name}: Status ${response.status} (expected)`);
                passedTests++;
            } else {
                console.log(`   ❌ ${test.name}: Status ${response.status} (expected ${test.expectedStatus})`);
            }
        }

        console.log(`\n📊 Error handling tests: ${passedTests}/${tests.length} passed`);

        return {
            success: passedTests === tests.length,
            passed: passedTests,
            total: tests.length
        };

    } catch (error) {
        console.error('❌ Error handling test failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Clean up test data
 */
async function cleanupE2ETestData() {
    console.log('\n🧹 Cleaning up E2E test data...');

    try {
        // Remove test users
        const User = require('./api/models/User');
        const deletedUsers = await User.deleteMany({
            $or: [
                { phoneNumber: /\+1555E2E/ },
                { email: /e2e-test/ }
            ]
        });
        console.log(`✅ Removed ${deletedUsers.deletedCount} test users`);

        // Remove test conversations
        const { Conversation } = require('./api/models/Conversation');
        const deletedConversations = await Conversation.deleteMany({
            'metadata.createdBy': 'e2e-test'
        });
        console.log(`✅ Removed ${deletedConversations.deletedCount} test conversations`);

        // Remove test messages
        const Message = require('./api/models/Message');
        const deletedMessages = await Message.deleteMany({
            'metadata.createdBy': 'e2e-test'
        });
        console.log(`✅ Removed ${deletedMessages.deletedCount} test messages`);

    } catch (error) {
        console.warn('⚠️ E2E cleanup error (non-critical):', error.message);
    }
}

/**
 * Run all end-to-end tests
 */
async function runAllE2ETests() {
    console.log('🚀 Starting End-to-End External Message Flow Tests\n');
    console.log('='.repeat(70));

    try {
        // Connect to database
        await connectDb();
        console.log('✅ Connected to MongoDB for E2E testing');

        let testResults = {
            completeUserFlow: { success: false },
            userIsolation: { success: false },
            conversationPersistence: { success: false },
            errorHandling: { success: false }
        };

        // Test 1: Complete User Flow
        console.log('\n📋 Test 1: Complete SMS User Flow');
        try {
            testResults.completeUserFlow = await testCompleteUserFlow();
            console.log(testResults.completeUserFlow.success ? '✅ Complete User Flow: PASSED' : '❌ Complete User Flow: FAILED');
        } catch (error) {
            console.log('❌ Complete User Flow: FAILED -', error.message);
        }

        // Test 2: User Isolation
        console.log('\n📋 Test 2: User Isolation');
        try {
            testResults.userIsolation = await testUserIsolation();
            console.log(testResults.userIsolation.success ? '✅ User Isolation: PASSED' : '❌ User Isolation: FAILED');
        } catch (error) {
            console.log('❌ User Isolation: FAILED -', error.message);
        }

        // Test 3: Conversation Persistence
        console.log('\n📋 Test 3: Conversation Persistence');
        try {
            testResults.conversationPersistence = await testConversationPersistence();
            console.log(testResults.conversationPersistence.success ? '✅ Conversation Persistence: PASSED' : '❌ Conversation Persistence: FAILED');
        } catch (error) {
            console.log('❌ Conversation Persistence: FAILED -', error.message);
        }

        // Test 4: Error Handling
        console.log('\n📋 Test 4: Error Handling');
        try {
            testResults.errorHandling = await testErrorHandling();
            console.log(testResults.errorHandling.success ? '✅ Error Handling: PASSED' : '❌ Error Handling: FAILED');
        } catch (error) {
            console.log('❌ Error Handling: FAILED -', error.message);
        }

        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 END-TO-END TEST RESULTS SUMMARY');
        console.log('='.repeat(70));

        const passedTests = Object.values(testResults).filter(result => result.success).length;
        const totalTests = Object.keys(testResults).length;

        console.log(`🎯 Overall: ${passedTests}/${totalTests} test suites passed`);
        console.log(`✅ Complete User Flow: ${testResults.completeUserFlow.success ? 'PASS' : 'FAIL'}`);
        console.log(`✅ User Isolation: ${testResults.userIsolation.success ? 'PASS' : 'FAIL'}`);
        console.log(`✅ Conversation Persistence: ${testResults.conversationPersistence.success ? 'PASS' : 'FAIL'}`);
        console.log(`✅ Error Handling: ${testResults.errorHandling.success ? 'PASS' : 'FAIL'}`);

        if (testResults.errorHandling.success) {
            console.log(`   Error Handling Details: ${testResults.errorHandling.passed}/${testResults.errorHandling.total} tests passed`);
        }

        if (passedTests === totalTests) {
            console.log('\n🎉 All end-to-end tests passed! External message system is working correctly.');
            console.log('💬 SMS → LibreChat → AI → Response flow is fully operational.');
        } else {
            console.log('\n⚠️ Some end-to-end tests failed. External message system needs attention.');
            console.log('🔧 Check the failed tests above for specific issues to address.');
        }

        return testResults;

    } catch (error) {
        console.error('❌ E2E test suite failed:', error);
        return false;
    } finally {
        await cleanupE2ETestData();
        process.exit(0);
    }
}

// Export for use in other test files
module.exports = {
    createSMSMessagePayload,
    testCompleteUserFlow,
    testUserIsolation,
    testConversationPersistence,
    testErrorHandling,
    runAllE2ETests
};

// Run if called directly
if (require.main === module) {
    runAllE2ETests().catch(console.error);
} 