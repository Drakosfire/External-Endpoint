/**
 * SSE Real-time Functionality Test
 * Tests Server-Sent Events for external message broadcasting and real-time updates
 */

// Load environment variables from .env file
require('dotenv').config({ path: '../../.env' });

const { logger } = require('./api/config');
const { findUser, createUser } = require('./api/models');
const { connectDb } = require('./api/lib/db/connectDb');
const { v4: uuidv4 } = require('uuid');
const EventSource = require('eventsource');
const jwt = require('jsonwebtoken');

// Required environment variables (should be set in .env file)
const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3080';
const JWT_SECRET = process.env.JWT_SECRET;
const EXTERNAL_MESSAGE_API_KEY = process.env.EXTERNAL_MESSAGE_API_KEY;

// Validate required environment variables
function validateEnvironmentVariables() {
    const requiredVars = [
        { name: 'JWT_SECRET', value: JWT_SECRET },
        { name: 'EXTERNAL_MESSAGE_API_KEY', value: EXTERNAL_MESSAGE_API_KEY }
    ];

    const missingVars = requiredVars.filter(envVar => !envVar.value);

    if (missingVars.length > 0) {
        console.error('❌ Missing required environment variables in .env file:');
        missingVars.forEach(envVar => {
            console.error(`   - ${envVar.name}`);
        });
        console.error('\nPlease ensure these variables are set in your .env file:');
        console.error('   JWT_SECRET=your_jwt_secret_here');
        console.error('   EXTERNAL_MESSAGE_API_KEY=your_api_key_here');
        console.error('   TEST_BASE_URL=http://localhost:3080  # Optional, defaults to localhost:3080');
        process.exit(1);
    }

    console.log('✅ Environment variables loaded from .env for SSE testing');
}

/**
 * Create a test JWT token for SSE authentication
 */
function createTestJWT(userId) {
    return jwt.sign(
        {
            id: userId.toString(),
            role: 'USER',
            iat: Date.now() / 1000
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
}

/**
 * Test SSE connection establishment and authentication
 */
async function testSSEConnectionAuth() {
    console.log('\n🔗 Testing SSE Connection & Authentication\n');

    try {
        // Create a test user for SSE testing
        const testUserId = uuidv4();
        const testUser = await createUser({
            _id: testUserId,
            email: `sse-test-${Date.now()}@test.com`,
            name: 'SSE Test User',
            username: `sse_test_${Date.now()}`,
            provider: 'local',
            emailVerified: true,
            role: 'USER'
        }, true, true);

        console.log(`✅ Created test user: ${testUser._id}`);

        // Generate JWT token
        const jwtToken = createTestJWT(testUser._id);
        console.log('✅ Generated JWT token for SSE authentication');

        // Test 1: Valid JWT authentication
        console.log('\n📡 Testing SSE connection with valid JWT...');

        return new Promise((resolve, reject) => {
            const sseUrl = `${BASE_URL}/api/messages/stream`;
            const eventSource = new EventSource(sseUrl, {
                headers: {
                    'Authorization': `Bearer ${jwtToken}`,
                    'Accept': 'text/event-stream'
                }
            });

            let connectionEstablished = false;
            let heartbeatReceived = false;
            const timeout = setTimeout(() => {
                eventSource.close();
                if (!connectionEstablished) {
                    reject(new Error('SSE connection timeout'));
                }
            }, 10000);

            eventSource.onopen = () => {
                console.log('   ✅ SSE connection opened successfully');
                connectionEstablished = true;
            };

            eventSource.addEventListener('connected', (event) => {
                console.log('   ✅ Received connection confirmation event');
                const data = JSON.parse(event.data);
                console.log(`   📊 Connection data:`, {
                    userId: data.userId,
                    timestamp: data.timestamp
                });

                if (data.userId === testUser._id.toString()) {
                    console.log('   ✅ User ID matches - authentication successful');
                } else {
                    console.log('   ❌ User ID mismatch in connection event');
                }
            });

            eventSource.addEventListener('heartbeat', (event) => {
                if (!heartbeatReceived) {
                    console.log('   ✅ Received heartbeat event');
                    heartbeatReceived = true;
                    clearTimeout(timeout);
                    eventSource.close();
                    resolve({
                        connectionEstablished,
                        heartbeatReceived,
                        testUserId: testUser._id
                    });
                }
            });

            eventSource.onerror = (error) => {
                console.log('   ❌ SSE connection error:', error);
                clearTimeout(timeout);
                eventSource.close();
                reject(error);
            };
        });

    } catch (error) {
        console.error('❌ SSE connection test failed:', error);
        throw error;
    }
}

/**
 * Test external message broadcasting via SSE
 */
async function testExternalMessageBroadcast(testUserId) {
    console.log('\n📢 Testing External Message Broadcasting\n');

    try {
        // Set up SSE listener
        const jwtToken = createTestJWT(testUserId);
        const sseUrl = `${BASE_URL}/api/messages/stream`;

        return new Promise((resolve, reject) => {
            const eventSource = new EventSource(sseUrl, {
                headers: {
                    'Authorization': `Bearer ${jwtToken}`,
                    'Accept': 'text/event-stream'
                }
            });

            let messageReceived = false;
            const timeout = setTimeout(() => {
                eventSource.close();
                if (!messageReceived) {
                    reject(new Error('No external message received via SSE'));
                }
            }, 15000);

            eventSource.onopen = () => {
                console.log('   ✅ SSE listener established');

                // Send external message after connection is established
                setTimeout(async () => {
                    await sendTestExternalMessage(testUserId);
                }, 1000);
            };

            eventSource.addEventListener('newMessage', (event) => {
                console.log('   ✅ Received newMessage event via SSE');
                const data = JSON.parse(event.data);
                console.log(`   📊 Message data:`, {
                    conversationId: data.conversationId,
                    messageCount: data.messages?.length,
                    timestamp: data.timestamp
                });

                // Verify the message content
                if (data.messages && data.messages.length > 0) {
                    const message = data.messages[0];
                    if (message.role === 'external' && message.text?.includes('SSE Test Message')) {
                        console.log('   ✅ External message content verified');
                        messageReceived = true;
                        clearTimeout(timeout);
                        eventSource.close();
                        resolve(data);
                    }
                }
            });

            eventSource.onerror = (error) => {
                console.log('   ❌ SSE error during message broadcast test:', error);
                clearTimeout(timeout);
                eventSource.close();
                reject(error);
            };
        });

    } catch (error) {
        console.error('❌ External message broadcast test failed:', error);
        throw error;
    }
}

/**
 * Send a test external message
 */
async function sendTestExternalMessage(userId) {
    console.log('   📤 Sending test external message...');

    const fetch = require('node-fetch');
    const conversationId = uuidv4();

    const externalMessage = {
        role: 'external',
        content: 'SSE Test Message - Real-time broadcasting test',
        metadata: {
            phoneNumber: '+1555TEST123',
            source: 'sms',
            createdBy: 'sse-test'
        },
        from: '+1555TEST123'
    };

    try {
        const response = await fetch(`${BASE_URL}/api/messages/${conversationId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(externalMessage)
        });

        if (response.ok) {
            console.log('   ✅ External message sent successfully');
        } else {
            const errorText = await response.text();
            console.log('   ❌ External message send failed:', response.status, errorText);
        }
    } catch (error) {
        console.log('   ❌ Error sending external message:', error.message);
    }
}

/**
 * Test SSE connection cleanup and error handling
 */
async function testSSECleanupAndErrors() {
    console.log('\n🧹 Testing SSE Cleanup & Error Handling\n');

    try {
        // Test 1: Invalid JWT token
        console.log('📋 Testing invalid JWT rejection...');
        const invalidToken = 'invalid.jwt.token';
        const sseUrl = `${BASE_URL}/api/messages/stream`;

        return new Promise((resolve, reject) => {
            const eventSource = new EventSource(sseUrl, {
                headers: {
                    'Authorization': `Bearer ${invalidToken}`,
                    'Accept': 'text/event-stream'
                }
            });

            let errorReceived = false;
            const timeout = setTimeout(() => {
                eventSource.close();
                if (!errorReceived) {
                    console.log('   ✅ Invalid JWT properly rejected (connection refused)');
                    resolve(true);
                } else {
                    reject(new Error('Invalid JWT was accepted'));
                }
            }, 5000);

            eventSource.onopen = () => {
                console.log('   ❌ Invalid JWT was incorrectly accepted');
                clearTimeout(timeout);
                eventSource.close();
                reject(new Error('Invalid JWT should have been rejected'));
            };

            eventSource.onerror = (error) => {
                console.log('   ✅ Invalid JWT properly rejected with error');
                errorReceived = true;
                clearTimeout(timeout);
                eventSource.close();
                resolve(true);
            };
        });

    } catch (error) {
        console.error('❌ SSE cleanup test failed:', error);
        throw error;
    }
}

/**
 * Test SSE message delivery timing and reliability
 */
async function testSSEReliability(testUserId) {
    console.log('\n⚡ Testing SSE Message Delivery Reliability\n');

    try {
        const jwtToken = createTestJWT(testUserId);
        const sseUrl = `${BASE_URL}/api/messages/stream`;
        const messageCount = 3;
        let receivedCount = 0;

        return new Promise((resolve, reject) => {
            const eventSource = new EventSource(sseUrl, {
                headers: {
                    'Authorization': `Bearer ${jwtToken}`,
                    'Accept': 'text/event-stream'
                }
            });

            const timeout = setTimeout(() => {
                eventSource.close();
                console.log(`   📊 Received ${receivedCount}/${messageCount} messages`);
                if (receivedCount >= messageCount) {
                    console.log('   ✅ All messages received successfully');
                    resolve(true);
                } else {
                    reject(new Error(`Only received ${receivedCount}/${messageCount} messages`));
                }
            }, 20000);

            eventSource.onopen = () => {
                console.log('   ✅ SSE connection established for reliability test');

                // Send multiple messages rapidly
                for (let i = 1; i <= messageCount; i++) {
                    setTimeout(async () => {
                        await sendTestBroadcast(testUserId, i);
                    }, i * 1000);
                }
            };

            eventSource.addEventListener('testMessage', (event) => {
                receivedCount++;
                const data = JSON.parse(event.data);
                console.log(`   ✅ Received test message ${receivedCount}: ${data.message}`);

                if (receivedCount >= messageCount) {
                    clearTimeout(timeout);
                    eventSource.close();
                    resolve(true);
                }
            });

            eventSource.onerror = (error) => {
                console.log('   ❌ SSE error during reliability test:', error);
                clearTimeout(timeout);
                eventSource.close();
                reject(error);
            };
        });

    } catch (error) {
        console.error('❌ SSE reliability test failed:', error);
        throw error;
    }
}

/**
 * Send a test broadcast message
 */
async function sendTestBroadcast(userId, messageNumber) {
    const fetch = require('node-fetch');

    try {
        const jwtToken = createTestJWT(userId);
        const response = await fetch(`${BASE_URL}/api/messages/debug/broadcast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify({
                event: 'testMessage',
                data: {
                    message: `Test broadcast message ${messageNumber}`,
                    timestamp: new Date().toISOString(),
                    messageNumber: messageNumber
                }
            })
        });

        if (response.ok) {
            console.log(`   📤 Sent test broadcast ${messageNumber}`);
        } else {
            console.log(`   ❌ Failed to send test broadcast ${messageNumber}`);
        }
    } catch (error) {
        console.log(`   ❌ Error sending test broadcast ${messageNumber}:`, error.message);
    }
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
    console.log('\n🧹 Cleaning up test data...');

    try {
        // Remove test users
        const User = require('./api/models/User');
        await User.deleteMany({
            $or: [
                { email: /sse-test-.*@test\.com/ },
                { username: /sse_test_.*/ }
            ]
        });
        console.log('✅ Test users cleaned up');

        // Remove test conversations
        const { Conversation } = require('./api/models/Conversation');
        await Conversation.deleteMany({
            'metadata.createdBy': 'sse-test'
        });
        console.log('✅ Test conversations cleaned up');

    } catch (error) {
        console.warn('⚠️ Cleanup error (non-critical):', error.message);
    }
}

/**
 * Run all SSE tests
 */
async function runAllSSETests() {
    console.log('🚀 Starting SSE Real-time Functionality Tests\n');
    console.log('='.repeat(60));

    try {
        // Validate environment variables first
        validateEnvironmentVariables();

        // Connect to database
        await connectDb();
        console.log('✅ Connected to MongoDB');

        let testResults = {
            connectionAuth: false,
            messageBroadcast: false,
            cleanupErrors: false,
            reliability: false
        };

        // Test 1: SSE Connection & Authentication
        try {
            const connectionResult = await testSSEConnectionAuth();
            testResults.connectionAuth = true;
            console.log('\n✅ SSE Connection & Authentication: PASSED');

            // Test 2: External Message Broadcasting
            try {
                await testExternalMessageBroadcast(connectionResult.testUserId);
                testResults.messageBroadcast = true;
                console.log('\n✅ External Message Broadcasting: PASSED');

                // Test 3: SSE Reliability
                try {
                    await testSSEReliability(connectionResult.testUserId);
                    testResults.reliability = true;
                    console.log('\n✅ SSE Reliability: PASSED');
                } catch (error) {
                    console.log('\n❌ SSE Reliability: FAILED -', error.message);
                }

            } catch (error) {
                console.log('\n❌ External Message Broadcasting: FAILED -', error.message);
            }

        } catch (error) {
            console.log('\n❌ SSE Connection & Authentication: FAILED -', error.message);
        }

        // Test 4: Cleanup & Error Handling
        try {
            await testSSECleanupAndErrors();
            testResults.cleanupErrors = true;
            console.log('\n✅ SSE Cleanup & Error Handling: PASSED');
        } catch (error) {
            console.log('\n❌ SSE Cleanup & Error Handling: FAILED -', error.message);
        }

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 SSE TEST RESULTS SUMMARY');
        console.log('='.repeat(60));

        const passedTests = Object.values(testResults).filter(Boolean).length;
        const totalTests = Object.keys(testResults).length;

        console.log(`🎯 Overall: ${passedTests}/${totalTests} tests passed`);
        console.log(`✅ Connection & Auth: ${testResults.connectionAuth ? 'PASS' : 'FAIL'}`);
        console.log(`✅ Message Broadcasting: ${testResults.messageBroadcast ? 'PASS' : 'FAIL'}`);
        console.log(`✅ Cleanup & Errors: ${testResults.cleanupErrors ? 'PASS' : 'FAIL'}`);
        console.log(`✅ Reliability: ${testResults.reliability ? 'PASS' : 'FAIL'}`);

        if (passedTests === totalTests) {
            console.log('\n🎉 All SSE tests passed! Real-time functionality is working correctly.');
        } else {
            console.log('\n⚠️ Some SSE tests failed. Check the logs above for details.');
        }

        return testResults;

    } catch (error) {
        console.error('❌ SSE test suite failed:', error);
        return false;
    } finally {
        await cleanupTestData();
        process.exit(0);
    }
}

// Export for use in other test files
module.exports = {
    testSSEConnectionAuth,
    testExternalMessageBroadcast,
    testSSECleanupAndErrors,
    testSSEReliability,
    runAllSSETests
};

// Run if called directly
if (require.main === module) {
    runAllSSETests().catch(console.error);
} 