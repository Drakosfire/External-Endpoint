const mongoose = require('mongoose');

async function checkConversations() {
    try {
        await mongoose.connect('mongodb://localhost:27017/LibreChat');
        const { Conversation } = require('./api/db/models');

        const phone = '+19709788817';
        const userId = '680d0b736eab93a30b0f3c2f';

        console.log('=== Checking Existing Conversations ===');

        // Check all conversations for this user
        const allUserConvos = await Conversation.find({ user: userId }).sort({ updatedAt: -1 }).limit(5);
        console.log(`Found ${allUserConvos.length} total conversations for user`);

        allUserConvos.forEach((conv, i) => {
            console.log(`  ${i + 1}. ${conv.conversationId} - ${conv.title} - hasMetadata: ${!!conv.metadata}`);
            if (conv.metadata) {
                console.log(`     Metadata keys: ${Object.keys(conv.metadata)}`);
                console.log(`     Phone: ${conv.metadata.phoneNumber}`);
            }
        });

        // Check specifically for conversations with metadata.phoneNumber
        const metadataConvos = await Conversation.find({
            user: userId,
            'metadata.phoneNumber': phone
        });
        console.log(`\nFound ${metadataConvos.length} conversations with phone ${phone}`);

        // Check total conversations with any metadata
        const anyMetadataConvos = await Conversation.find({
            user: userId,
            metadata: { $exists: true }
        });
        console.log(`Found ${anyMetadataConvos.length} conversations with any metadata`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

checkConversations(); 