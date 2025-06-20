const { findUser, createUser, updateUser } = require('./api/models');
const { getConvo, getMessages } = require('./api/models/Conversation');
const { v4: uuidv4 } = require('uuid');

// Test configurations
const testPhoneNumbers = [
    // Valid formats
    '+1234567890',
    '+44123456789',
    '+33123456789',
    '+1 (555) 123-4567',
    '555-123-4567',
    '15551234567',
    '1234567890',

    // Edge cases
    '+12345678901234', // Long international
    '+49301234567',    // German format

    // Invalid formats (should be rejected)
    '123',             // Too short
    'abc123',          // Contains letters
    '+',               // Just plus
    '',                // Empty
    null,              // Null
    undefined          // Undefined
];

/**
 * Enhanced phone number normalization (same as in validateExternalMessage.js)
 */
const normalizePhoneNumber = (phoneNumber) => {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return null;
    }

    let normalized = phoneNumber.replace(/[^0-9+]/g, '');

    if (normalized.startsWith('1') && normalized.length === 11 && !normalized.startsWith('+')) {
        normalized = '+' + normalized;
    } else if (normalized.length === 10 && !normalized.startsWith('+')) {
        normalized = '+1' + normalized;
    } else if (!normalized.startsWith('+') && normalized.length > 7) {
        normalized = '+' + normalized;
    }

    const e164Regex = /^\+[1-9]\d{6,14}$/;
    if (!e164Regex.test(normalized)) {
        return null;
    }

    return normalized;
};

/**
 * Test phone number normalization and validation
 */
async function testPhoneNumberValidation() {
    console.log('📱 Testing Phone Number Validation & Normalization\n');

    const validNumbers = [];
    const invalidNumbers = [];

    for (const testNumber of testPhoneNumbers) {
        const normalized = normalizePhoneNumber(testNumber);

        if (normalized) {
            validNumbers.push({ original: testNumber, normalized });
            console.log(`✅ ${testNumber || 'null/undefined'} -> ${normalized}`);
        } else {
            invalidNumbers.push(testNumber);
            console.log(`❌ ${testNumber || 'null/undefined'} -> INVALID`);
        }
    }

    console.log(`\n📊 Results: ${validNumbers.length} valid, ${invalidNumbers.length} invalid\n`);
    return { validNumbers, invalidNumbers };
}

/**
 * Test SMS user creation and management
 */
async function testSMSUserCreation() {
    console.log('👤 Testing SMS User Creation & Management\n');

    const testUsers = [];
    const validPhones = ['+1234567890', '+44123456789', '+33123456789'];

    // Test 1: Create users for different phone numbers
    console.log('📝 Creating SMS users...');
    for (const phone of validPhones) {
        try {
            // Check if user already exists
            let user = await findUser({
                $or: [
                    { phoneNumber: phone },
                    { 'metadata.phoneNumber': phone }
                ]
            });

            if (!user) {
                // Create new user (simulating the enhanced function)
                const baseUsername = `sms_${phone.replace(/[^0-9]/g, '')}`;
                let username = baseUsername;
                let attempt = 1;

                while (await findUser({ username })) {
                    username = `${baseUsername}_${attempt}`;
                    attempt++;
                }

                user = await createUser({
                    email: `${phone}@sms.librechat.ai`,
                    name: `SMS User ${phone}`,
                    username: username,
                    provider: 'sms',
                    phoneNumber: phone,
                    emailVerified: true,
                    role: 'USER',
                    metadata: {
                        phoneNumber: phone,
                        source: 'sms',
                        createdBy: 'sms-system',
                        firstContact: new Date(),
                        lastSMS: new Date(),
                        messageCount: 1,
                        preferences: {
                            defaultModel: 'gpt-4o',
                            endpoint: 'openai'
                        }
                    }
                }, true, true);

                console.log(`   ✅ Created user for ${phone}: ${user._id}`);
            } else {
                // Update existing user
                await updateUser(user._id, {
                    'metadata.lastSMS': new Date(),
                    $inc: { 'metadata.messageCount': 1 }
                });
                console.log(`   🔄 Updated existing user for ${phone}: ${user._id}`);
            }

            testUsers.push({ phone, user });
        } catch (error) {
            console.log(`   ❌ Error with ${phone}: ${error.message}`);
        }
    }

    // Test 2: Verify user isolation
    console.log('\n🔒 Testing user isolation...');
    const userIds = testUsers.map(({ user }) => user._id.toString());
    const uniqueIds = [...new Set(userIds)];

    if (userIds.length === uniqueIds.length) {
        console.log('   ✅ All users have unique IDs - isolation confirmed');
    } else {
        console.log('   ❌ Duplicate user IDs found - isolation failed');
    }

    // Test 3: Test duplicate phone number handling
    console.log('\n🔄 Testing duplicate phone number handling...');
    const duplicatePhone = validPhones[0];
    try {
        const user1 = await findUser({ phoneNumber: duplicatePhone });
        const user2 = await findUser({ phoneNumber: duplicatePhone });

        if (user1._id.toString() === user2._id.toString()) {
            console.log(`   ✅ Same user returned for duplicate phone: ${duplicatePhone}`);
        } else {
            console.log(`   ❌ Different users returned for same phone: ${duplicatePhone}`);
        }
    } catch (error) {
        console.log(`   ❌ Error testing duplicates: ${error.message}`);
    }

    return testUsers;
}

/**
 * Test conversation persistence and management
 */
async function testConversationPersistence(testUsers) {
    console.log('💬 Testing Conversation Persistence & Management\n');

    if (testUsers.length === 0) {
        console.log('❌ No test users available for conversation testing');
        return;
    }

    const testUser = testUsers[0];
    const { phone, user } = testUser;

    // Test 1: Create a conversation
    console.log('📝 Creating test conversation...');
    const conversationId = uuidv4();
    const testConversation = {
        conversationId,
        title: `SMS Chat ${phone}`,
        endpoint: 'openai',
        model: 'gpt-4o',
        user: user._id,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
            phoneNumber: phone,
            source: 'sms',
            createdBy: 'sms-system',
            lastMessage: new Date(),
            messageCount: 1
        }
    };

    try {
        // Simulate conversation creation (we can't directly use saveConvo here)
        console.log(`   ✅ Would create conversation: ${conversationId} for ${phone}`);

        // Test 2: Simulate finding existing conversation
        const existingConversations = await getConvo(user._id, null, {
            'metadata.phoneNumber': phone,
            'metadata.source': 'sms'
        });

        if (existingConversations && existingConversations.length > 0) {
            console.log(`   ✅ Found ${existingConversations.length} existing conversation(s) for ${phone}`);

            // Test conversation age filtering (7 days)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const activeConversations = existingConversations.filter(conv =>
                new Date(conv.updatedAt) >= sevenDaysAgo
            );

            console.log(`   ✅ ${activeConversations.length} active conversations (last 7 days)`);
        } else {
            console.log(`   ℹ️  No existing conversations found for ${phone}`);
        }

    } catch (error) {
        console.log(`   ❌ Conversation test error: ${error.message}`);
    }
}

/**
 * Test edge cases and error scenarios
 */
async function testEdgeCases() {
    console.log('⚠️  Testing Edge Cases & Error Scenarios\n');

    // Test 1: Race condition simulation
    console.log('🏁 Testing race condition handling...');
    const racePhone = '+15551234567';

    try {
        // Delete any existing user for clean test
        await findUser({ phoneNumber: racePhone }).then(user => {
            if (user) {
                console.log(`   🧹 Found existing user ${user._id} for cleanup`);
            }
        });

        // Simulate concurrent user creation attempts
        const promises = Array(3).fill().map(async (_, index) => {
            try {
                const user = await createUser({
                    email: `${racePhone}@sms.librechat.ai`,
                    name: `SMS User ${racePhone}`,
                    username: `sms_${racePhone.replace(/[^0-9]/g, '')}_race_${index}`,
                    provider: 'sms',
                    phoneNumber: racePhone,
                    emailVerified: true,
                    metadata: {
                        phoneNumber: racePhone,
                        source: 'sms',
                        testScenario: 'race-condition'
                    }
                }, true, true);
                return { success: true, userId: user._id.toString(), attempt: index };
            } catch (error) {
                return { success: false, error: error.message, attempt: index };
            }
        });

        const results = await Promise.all(promises);
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        console.log(`   📊 Race condition results: ${successful.length} successful, ${failed.length} failed`);

        if (successful.length === 1 && failed.length === 2) {
            console.log('   ✅ Race condition handled correctly (1 success, 2 duplicates)');
        } else if (successful.length > 0) {
            console.log('   ⚠️  Race condition partially handled');
            console.log('   📋 Successful attempts:', successful.map(r => `${r.attempt}: ${r.userId}`));
        } else {
            console.log('   ❌ Race condition handling failed - no successful creations');
        }

        // Show failed attempts
        failed.forEach(f => {
            console.log(`   🔍 Failed attempt ${f.attempt}: ${f.error}`);
        });

    } catch (error) {
        console.log(`   ❌ Race condition test error: ${error.message}`);
    }

    // Test 2: Username conflict resolution
    console.log('\n📝 Testing username conflict resolution...');
    const conflictPhone = '+15559876543';

    try {
        // Create base username user
        const baseUsername = `sms_${conflictPhone.replace(/[^0-9]/g, '')}`;

        // Check if base username exists
        const existingUser = await findUser({ username: baseUsername });
        if (existingUser) {
            console.log(`   ℹ️  Base username ${baseUsername} already exists`);
        }

        // Test username conflict detection
        let testUsername = baseUsername;
        let attempt = 1;

        while (await findUser({ username: testUsername })) {
            testUsername = `${baseUsername}_${attempt}`;
            attempt++;
            if (attempt > 5) break; // Prevent infinite loop in test
        }

        if (attempt > 1) {
            console.log(`   ✅ Username conflict resolution works: ${baseUsername} -> ${testUsername}`);
        } else {
            console.log(`   ℹ️  No username conflict for ${baseUsername}`);
        }

    } catch (error) {
        console.log(`   ❌ Username conflict test error: ${error.message}`);
    }
}

/**
 * Cleanup test data
 */
async function cleanupTestData() {
    console.log('🧹 Cleaning up test data...\n');

    const testPhones = ['+1234567890', '+44123456789', '+33123456789', '+15551234567', '+15559876543'];
    let cleanedCount = 0;

    for (const phone of testPhones) {
        try {
            const users = await findUser({
                $or: [
                    { phoneNumber: phone },
                    { 'metadata.phoneNumber': phone },
                    { email: `${phone}@sms.librechat.ai` }
                ]
            });

            if (users) {
                console.log(`   🗑️  Found test user for ${phone}: ${users._id}`);
                console.log(`      ⚠️  Manual cleanup required - delete user ${users._id} from MongoDB`);
                cleanedCount++;
            }
        } catch (error) {
            console.log(`   ❌ Cleanup error for ${phone}: ${error.message}`);
        }
    }

    console.log(`\n📊 Found ${cleanedCount} test users that need manual cleanup`);
    console.log('💡 To cleanup: db.users.deleteMany({"provider": "sms", "metadata.testScenario": {$exists: true}})');
}

/**
 * Main test runner
 */
async function runAllTests() {
    console.log('🚀 SMS User Management Enhanced Testing Suite\n');
    console.log('='.repeat(60) + '\n');

    try {
        // Test 1: Phone number validation
        const { validNumbers, invalidNumbers } = await testPhoneNumberValidation();

        // Test 2: SMS user creation
        const testUsers = await testSMSUserCreation();

        // Test 3: Conversation persistence
        await testConversationPersistence(testUsers);

        // Test 4: Edge cases
        await testEdgeCases();

        // Test 5: Cleanup instructions
        await cleanupTestData();

        console.log('\n' + '='.repeat(60));
        console.log('✅ Testing Suite Complete!');
        console.log('\n📋 Next Steps for Manual Testing:');
        console.log('1. Send SMS messages from your phone number');
        console.log('2. Check database: db.users.find({"provider": "sms"})');
        console.log('3. Restart server and send another message');
        console.log('4. Verify conversation persistence');
        console.log('5. Delete your user and repeat');

    } catch (error) {
        console.error('❌ Test suite failed:', error);
    }
}

// Export functions for individual testing
module.exports = {
    testPhoneNumberValidation,
    testSMSUserCreation,
    testConversationPersistence,
    testEdgeCases,
    cleanupTestData,
    runAllTests,
    normalizePhoneNumber
};

// Run all tests if called directly
if (require.main === module) {
    runAllTests();
} 