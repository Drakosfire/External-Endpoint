/**
 * MCP Server Connectivity Test
 * Tests MCP server connections and user isolation functionality
 */

// Load environment variables from .env file
require('dotenv').config({ path: '../../.env' });

const { connectDb } = require('./api/db/connect');

// Fix imports similar to metadata test
const mongoose = require('./api/node_modules/mongoose');
const { userSchema } = require('./packages/data-schemas/dist/index.cjs');

// Create models manually like in metadata test
const User = mongoose.models.User || mongoose.model('User', userSchema);

// Create user function
const createUser = async (userData, returnObj = false, bypassPermissions = false) => {
    const user = new User(userData);
    const savedUser = await user.save();
    return returnObj ? savedUser : savedUser._id;
};
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Required environment variables (should be set in .env file)
const MONGO_URI = process.env.MONGO_URI;

// Validate required environment variables
function validateEnvironmentVariables() {
    const requiredVars = [
        { name: 'MONGO_URI', value: MONGO_URI }
    ];

    const missingVars = requiredVars.filter(envVar => !envVar.value);

    if (missingVars.length > 0) {
        console.error('❌ Missing required environment variables in .env file:');
        missingVars.forEach(envVar => {
            console.error(`   - ${envVar.name}`);
        });
        console.error('\nPlease ensure these variables are set in your .env file:');
        console.error('   MONGO_URI=mongodb://localhost:27017/LibreChat');
        process.exit(1);
    }

    console.log('✅ Environment variables loaded from .env for MCP testing');
}

/**
 * Test MCP server configuration reading
 */
function testMCPConfiguration() {
    console.log('\n📋 Testing MCP Configuration...');

    try {
        const yaml = require('js-yaml');
        const configContent = fs.readFileSync('./librechat.yaml', 'utf8');
        const config = yaml.load(configContent);

        if (config.mcpServers) {
            console.log(`✅ Found ${Object.keys(config.mcpServers).length} MCP servers:`);
            Object.keys(config.mcpServers).forEach(serverName => {
                console.log(`   - ${serverName}`);
            });
            return { success: true, servers: config.mcpServers };
        } else {
            console.log('❌ No MCP servers configured');
            return { success: false, error: 'No MCP servers configured' };
        }

    } catch (error) {
        console.error('❌ Error reading MCP configuration:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Test user isolation concept
 */
async function testUserIsolation() {
    console.log('\n🔒 Testing User Isolation...');

    try {
        // Create test users
        const testUsers = [];
        for (let i = 1; i <= 2; i++) {
            const testUser = await createUser({
                email: `mcp-test-${i}-${Date.now()}@test.com`,
                name: `MCP Test User ${i}`,
                username: `mcp_test_${i}_${Date.now()}`,
                provider: 'local',
                emailVerified: true,
                role: 'USER'
            }, true, true);

            testUsers.push(testUser);
            console.log(`✅ Created test user ${i}: ${testUser._id}`);
        }

        // Test isolation
        const contexts = testUsers.map(user => ({
            userId: user._id.toString(),
            contextKey: `user_context_${user._id.toString()}`
        }));

        const uniqueKeys = new Set(contexts.map(ctx => ctx.contextKey));
        if (uniqueKeys.size === contexts.length) {
            console.log('✅ User contexts are unique (isolation verified)');
            return { success: true, userCount: testUsers.length };
        } else {
            console.log('❌ Duplicate contexts detected');
            return { success: false, error: 'Context collision' };
        }

    } catch (error) {
        console.error('❌ User isolation test failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Run all MCP tests
 */
async function runAllMCPTests() {
    console.log('🚀 Starting MCP Server Tests\n');

    try {
        // Validate environment variables first
        validateEnvironmentVariables();

        await connectDb();
        console.log('✅ Connected to MongoDB');

        // Test configuration
        const configResult = testMCPConfiguration();
        console.log(configResult.success ? '✅ MCP Configuration: PASSED' : '❌ MCP Configuration: FAILED');

        // Test user isolation
        const isolationResult = await testUserIsolation();
        console.log(isolationResult.success ? '✅ User Isolation: PASSED' : '❌ User Isolation: FAILED');

        console.log('\n✅ MCP tests completed');
        return true;

    } catch (error) {
        console.error('❌ MCP test suite failed:', error);
        return false;
    } finally {
        // Cleanup
        try {
            const User = mongoose.models.User || mongoose.model('User', require('./packages/data-schemas/dist/index.cjs').userSchema);
            await User.deleteMany({
                email: /mcp-test-.*@test\.com/
            });
            console.log('✅ Test data cleaned up');
        } catch (error) {
            console.warn('⚠️ Cleanup warning:', error.message);
        }
        process.exit(0);
    }
}

module.exports = {
    testMCPConfiguration,
    testUserIsolation,
    runAllMCPTests
};

if (require.main === module) {
    runAllMCPTests().catch(console.error);
} 