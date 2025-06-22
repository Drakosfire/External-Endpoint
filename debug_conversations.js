const { connectDb } = require('./api/lib/db/connectDb');
const { getConvo } = require('./api/models/Conversation');
const { findUser } = require('./api/models');

async function debugConversations() {
    try {
        console.log('🔍 Debugging SMS Conversation Persistence\n');

        // Connect to database
        await connectDb();
        console.log('✅ Connected to MongoDB\n');

        const phoneNumber = '+19709788817';

        // 1. Check user
        console.log('=== 1. SMS User Check ===');
        const user = await findUser({
            $or: [
                { phoneNumber: phoneNumber },
                { 'metadata.phoneNumber': phoneNumber }
            ]
        });

        if (user) {
            console.log(`✅ User found: ${user._id}`);
            console.log(`   Phone: ${user.phoneNumber}`);
            console.log(`   Provider: ${user.provider}`);
            console.log(`   Messages: ${user.metadata?.messageCount || 'N/A'}`);
        } else {
            console.log('❌ No SMS user found');
            return;
        }

        // 2. Direct conversation search (what the code is doing)
        console.log('\n=== 2. Enhanced Search (Current Implementation) ===');
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        console.log(`   Searching for conversations updated after: ${sevenDaysAgo}`);

        const existingConversations = await getConvo(user._id, null, {
            'metadata.phoneNumber': phoneNumber,
            'metadata.source': 'sms',
            updatedAt: { $gte: sevenDaysAgo }
        });

        if (existingConversations && existingConversations.length > 0) {
            console.log(`✅ Found ${existingConversations.length} active conversation(s):`);
            existingConversations.forEach((conv, index) => {
                console.log(`   ${index + 1}. ID: ${conv.conversationId}`);
                console.log(`      Updated: ${conv.updatedAt}`);
                console.log(`      Created: ${conv.createdAt}`);
                console.log(`      User: ${conv.user}`);
                console.log(`      Phone: ${conv.metadata?.phoneNumber}`);
                console.log(`      Source: ${conv.metadata?.source}`);
            });
        } else {
            console.log('❌ No active conversations found with enhanced search');
        }

        // 3. Broader search (no time limit)
        console.log('\n=== 3. Broader Search (No Time Limit) ===');
        const allConversations = await getConvo(user._id, null, {
            'metadata.phoneNumber': phoneNumber,
            'metadata.source': 'sms'
        });

        if (allConversations && allConversations.length > 0) {
            console.log(`✅ Found ${allConversations.length} total conversation(s):`);
            allConversations.forEach((conv, index) => {
                const age = Math.floor((Date.now() - new Date(conv.updatedAt)) / (24 * 60 * 60 * 1000));
                console.log(`   ${index + 1}. ID: ${conv.conversationId}`);
                console.log(`      Updated: ${conv.updatedAt} (${age} days ago)`);
                console.log(`      User: ${conv.user}`);
                console.log(`      Agent: ${conv.agent_id || 'N/A'}`);
                console.log(`      Phone: ${conv.metadata?.phoneNumber || 'N/A'}`);
                console.log(`      Source: ${conv.metadata?.source || 'N/A'}`);
            });
        } else {
            console.log('❌ No conversations found at all');
        }

        // 4. Check recent conversation IDs from logs
        console.log('\n=== 4. Specific Conversation Check ===');
        const recentIds = [
            '91ff5583-2bb7-4565-8913-fc2e0fd822ed',
            '41e32c4e-44e0-4fde-b3ad-ea1499ef984f'
        ];

        for (const conversationId of recentIds) {
            const conv = await getConvo(null, conversationId);
            if (conv) {
                console.log(`✅ Conversation ${conversationId}:`);
                console.log(`   User: ${conv.user}`);
                console.log(`   Updated: ${conv.updatedAt}`);
                console.log(`   Phone: ${conv.metadata?.phoneNumber || 'N/A'}`);
                console.log(`   Source: ${conv.metadata?.source || 'N/A'}`);
                console.log(`   Agent: ${conv.agent_id || 'N/A'}`);
            } else {
                console.log(`❌ Conversation ${conversationId} not found`);
            }
        }

        // 5. Summary and recommendations
        console.log('\n=== 5. Analysis & Recommendations ===');

        if (existingConversations && existingConversations.length > 0) {
            console.log('✅ GOOD: Enhanced search is working correctly');
        } else if (allConversations && allConversations.length > 0) {
            const oldestConv = allConversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
            const age = Math.floor((Date.now() - new Date(oldestConv.updatedAt)) / (24 * 60 * 60 * 1000));

            if (age > 7) {
                console.log(`⚠️  ISSUE: Most recent conversation is ${age} days old (>7 day limit)`);
                console.log('   SOLUTION: Remove or increase the 7-day age filter');
            } else {
                console.log('⚠️  ISSUE: Conversations exist but search query doesn\'t match');
                console.log('   SOLUTION: Check metadata structure or user association');
            }
        } else {
            console.log('❌ ISSUE: No SMS conversations exist at all');
            console.log('   SOLUTION: Check conversation creation process');
        }

    } catch (error) {
        console.error('❌ Debug failed:', error);
    } finally {
        process.exit(0);
    }
}

debugConversations(); 