// Fix imports similar to metadata test  
const mongoose = require('./api/node_modules/mongoose');
const { userSchema } = require('./packages/data-schemas/dist/index.cjs');

// Create models manually like in metadata test
const User = mongoose.models.User || mongoose.model('User', userSchema);

// Create user functions
const findUser = async (query) => {
    return await User.findOne(query);
};

const createUser = async (userData, returnObj = false, bypassPermissions = false) => {
    const user = new User(userData);
    const savedUser = await user.save();
    return returnObj ? savedUser : savedUser._id;
};
const jwt = require('./node_modules/jsonwebtoken');

// Load environment variables from .env file
require('dotenv').config({ path: '../../.env' });

// Required environment variables (should be set in .env file)
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3080';
const EXTERNAL_MESSAGE_API_KEY = process.env.EXTERNAL_MESSAGE_API_KEY;

// Validate required environment variables
function validateEnvironmentVariables() {
    const requiredVars = [
        { name: 'MONGO_URI', value: MONGO_URI },
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
        console.error('   MONGO_URI=mongodb://localhost:27017/LibreChat');
        console.error('   JWT_SECRET=your_jwt_secret_here');
        console.error('   EXTERNAL_MESSAGE_API_KEY=your_api_key_here');
        console.error('   TEST_BASE_URL=http://localhost:3080  # Optional, defaults to localhost:3080');
        process.exit(1);
    }

    console.log('✅ All required environment variables loaded from .env');
}

/**
 * Test JWT token generation and validation
 */
async function testJWTAuthentication(userId) {
    console.log('\n🔐 Testing JWT Authentication...');

    try {
        // Generate JWT token
        const token = jwt.sign(
            {
                id: userId.toString(),
                role: 'USER',
                iat: Math.floor(Date.now() / 1000)
            },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        console.log('✅ JWT token generated successfully');
        console.log(`   Token (first 20 chars): ${token.substring(0, 20)}...`);

        // Test token validation
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.id === userId.toString()) {
                console.log('✅ JWT token validation successful');
                console.log(`   User ID matches: ${decoded.id}`);
                return { success: true, token: token };
            } else {
                console.log('❌ JWT token user ID mismatch');
                return { success: false, error: 'User ID mismatch' };
            }
        } catch (verifyError) {
            console.log('❌ JWT token validation failed:', verifyError.message);
            return { success: false, error: verifyError.message };
        }

    } catch (error) {
        console.log('❌ JWT authentication test failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Test various JWT scenarios (expired, invalid, malformed)
 */
async function testJWTEdgeCases(userId) {
    console.log('\n🧪 Testing JWT Edge Cases...');

    const tests = [
        {
            name: 'Expired Token',
            token: jwt.sign(
                { id: userId.toString(), role: 'USER', exp: Math.floor(Date.now() / 1000) - 3600 },
                JWT_SECRET
            ),
            shouldFail: true
        },
        {
            name: 'Invalid Signature',
            token: jwt.sign(
                { id: userId.toString(), role: 'USER' },
                'wrong_secret'
            ),
            shouldFail: true
        },
        {
            name: 'Malformed Token',
            token: 'invalid.jwt.token',
            shouldFail: true
        },
        {
            name: 'No User ID',
            token: jwt.sign(
                { role: 'USER' },
                JWT_SECRET
            ),
            shouldFail: true
        },
        {
            name: 'Valid Admin Token',
            token: jwt.sign(
                { id: userId.toString(), role: 'ADMIN' },
                JWT_SECRET,
                { expiresIn: '1h' }
            ),
            shouldFail: false
        }
    ];

    let passed = 0;
    const total = tests.length;

    for (const test of tests) {
        try {
            const decoded = jwt.verify(test.token, JWT_SECRET);
            if (test.shouldFail) {
                console.log(`❌ ${test.name}: Should have failed but passed`);
            } else {
                console.log(`✅ ${test.name}: Passed as expected`);
                passed++;
            }
        } catch (error) {
            if (test.shouldFail) {
                console.log(`✅ ${test.name}: Failed as expected (${error.message})`);
                passed++;
            } else {
                console.log(`❌ ${test.name}: Should have passed but failed (${error.message})`);
            }
        }
    }

    console.log(`\n📊 JWT Edge Cases: ${passed}/${total} passed`);
    return { passed, total, success: passed === total };
}

/**
 * Test external API authentication
 */
async function testExternalAPIAuth(userId) {
    console.log('\n🌐 Testing External API Authentication...');

    try {
        const fetch = require('./api/node_modules/node-fetch');
        const { v4: uuidv4 } = require('./api/node_modules/uuid');

        // Generate JWT for API call
        const token = jwt.sign(
            { id: userId.toString(), role: 'USER' },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Test external message API with authentication
        const testMessage = {
            role: 'external',
            content: 'JWT authentication test message',
            metadata: {
                phoneNumber: '+1555JWT123',
                source: 'sms',
                createdBy: 'jwt-test'
            },
            from: '+1555JWT123'
        };

        console.log('📤 Testing external API call with JWT...');

        const response = await fetch(`${BASE_URL}/api/messages/${uuidv4()}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-api-key': EXTERNAL_MESSAGE_API_KEY
            },
            body: JSON.stringify(testMessage)
        });

        console.log(`   Response Status: ${response.status}`);

        if (response.ok) {
            console.log('✅ External API authentication successful');
            return { success: true, status: response.status };
        } else {
            const errorText = await response.text();
            console.log('❌ External API authentication failed');
            console.log(`   Error: ${errorText.substring(0, 100)}...`);
            return { success: false, error: errorText, status: response.status };
        }

    } catch (error) {
        console.log('❌ External API authentication test failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Test API key validation scenarios
 */
async function testAPIKeyValidation() {
    console.log('\n🔑 Testing API Key Validation...');

    try {
        const fetch = require('./api/node_modules/node-fetch');
        const { v4: uuidv4 } = require('./api/node_modules/uuid');

        const testMessage = {
            role: 'external',
            content: 'API key test message',
            metadata: {
                phoneNumber: '+1555API123',
                source: 'sms'
            },
            from: '+1555API123'
        };

        const tests = [
            {
                name: 'Valid API Key',
                apiKey: EXTERNAL_MESSAGE_API_KEY,
                shouldPass: true
            },
            {
                name: 'Invalid API Key',
                apiKey: 'invalid-key',
                shouldPass: false
            },
            {
                name: 'Missing API Key',
                apiKey: null,
                shouldPass: false
            }
        ];

        let passed = 0;
        const total = tests.length;

        for (const test of tests) {
            const headers = {
                'Content-Type': 'application/json'
            };

            if (test.apiKey) {
                headers['x-api-key'] = test.apiKey;
            }

            try {
                const response = await fetch(`${BASE_URL}/api/messages/${uuidv4()}`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(testMessage)
                });

                const success = response.ok;
                if ((success && test.shouldPass) || (!success && !test.shouldPass)) {
                    console.log(`✅ ${test.name}: Status ${response.status} (Expected: ${test.shouldPass ? 'pass' : 'fail'})`);
                    passed++;
                } else {
                    console.log(`❌ ${test.name}: Status ${response.status} (Expected: ${test.shouldPass ? 'pass' : 'fail'})`);
                }
            } catch (error) {
                console.log(`❌ ${test.name}: Request failed - ${error.message}`);
            }
        }

        console.log(`\n📊 API Key Tests: ${passed}/${total} passed`);
        return { passed, total, success: passed === total };

    } catch (error) {
        console.log('❌ API key validation test failed:', error.message);
        return { success: false, error: error.message };
    }
}

async function testUserCreation() {
    let testUserId = null;

    try {
        console.log('🚀 Starting Enhanced User Creation & Authentication Tests\n');

        // Validate environment variables first
        validateEnvironmentVariables();
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const phoneNumber = '+19709788817';

        // First, check if user already exists
        console.log('\n1. 🔍 Checking for existing user...');
        let existingUser = await findUser({
            $or: [
                { phoneNumber: phoneNumber },
                { 'metadata.phoneNumber': phoneNumber }
            ]
        });

        if (existingUser) {
            console.log('✅ Found existing user:', {
                id: existingUser._id.toString(),
                phoneNumber: existingUser.phoneNumber,
                email: existingUser.email,
                username: existingUser.username,
                metadata: existingUser.metadata
            });
        } else {
            console.log('ℹ️ No existing user found');
        }

        // Try to create a new user (with different phone to avoid conflicts)
        const testPhone = '+19709788818';
        console.log('\n2. 👤 Testing user creation with phone:', testPhone);

        try {
            const newUser = await createUser({
                email: `${testPhone}@sms.librechat.ai`,
                name: `SMS User ${testPhone}`,
                username: `sms_${testPhone.replace(/[^0-9]/g, '')}_test`,
                provider: 'sms',
                phoneNumber: testPhone,
                emailVerified: true,
                role: 'USER',
                metadata: {
                    phoneNumber: testPhone,
                    source: 'sms',
                    createdBy: 'test-script',
                    firstContact: new Date(),
                    lastSMS: new Date(),
                    messageCount: 1,
                    preferences: {
                        defaultModel: 'gpt-4o',
                        endpoint: 'openAI'
                    }
                }
            }, true, true);

            console.log('✅ Successfully created test user:', {
                id: newUser._id.toString(),
                phoneNumber: newUser.phoneNumber,
                email: newUser.email,
                username: newUser.username,
                metadata: newUser.metadata
            });

            testUserId = newUser._id;

            // 3. Test JWT authentication with the created user
            console.log('\n3. 🔐 Testing JWT authentication...');
            const jwtResult = await testJWTAuthentication(testUserId);
            if (jwtResult.success) {
                console.log('✅ JWT authentication tests passed');

                // 4. Test JWT edge cases
                const edgeResult = await testJWTEdgeCases(testUserId);
                if (edgeResult.success) {
                    console.log('✅ JWT edge case tests passed');
                } else {
                    console.log('❌ JWT edge case tests failed');
                }

                // 5. Test external API authentication
                const apiResult = await testExternalAPIAuth(testUserId);
                if (apiResult.success) {
                    console.log('✅ External API authentication tests passed');
                } else {
                    console.log('❌ External API authentication tests failed');
                }

                // 6. Test API key validation
                const keyResult = await testAPIKeyValidation();
                if (keyResult.success) {
                    console.log('✅ API key validation tests passed');
                } else {
                    console.log('❌ API key validation tests failed');
                }

            } else {
                console.log('❌ JWT authentication tests failed');
                return false;
            }

        } catch (createError) {
            console.error('❌ Error creating test user:', createError);
            return false;
        }

        console.log('\n🎉 All user creation and authentication tests completed successfully!');
        return true;

    } catch (error) {
        console.error('❌ Test suite failed:', error);
        return false;
    } finally {
        // Clean up test user if created
        if (testUserId) {
            try {
                console.log('\n7. 🧹 Cleaning up test user...');
                await mongoose.model('User').deleteOne({ _id: testUserId });
                console.log('✅ Test user deleted');
            } catch (cleanupError) {
                console.warn('⚠️ Cleanup warning:', cleanupError.message);
            }
        }

        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
        process.exit(0);
    }
}

module.exports = {
    testJWTAuthentication,
    testJWTEdgeCases,
    testExternalAPIAuth,
    testAPIKeyValidation,
    testUserCreation
};

if (require.main === module) {
    testUserCreation().catch(console.error);
}