const mongoose = require('mongoose');

async function checkCurrentConvo() {
    try {
        await mongoose.connect('mongodb://localhost:27017/LibreChat');
        const { Conversation } = require('./db/models');

        const conversationId = '669ae50a-341f-4a29-84ed-f29166bdaf16';

        console.log('=== Checking Current Conversation ===');
        console.log('Looking for conversation:', conversationId);
        console.log('Time:', new Date().toISOString());

        const conv = await Conversation.findOne({ conversationId });

        if (conv) {
            console.log('✅ Found conversation:', conv.conversationId);
            console.log('Title:', conv.title);
            console.log('Created:', conv.createdAt);
            console.log('Updated:', conv.updatedAt);
            console.log('Has metadata:', !!conv.metadata);

            if (conv.metadata) {
                console.log('✅ METADATA STILL EXISTS!');
                console.log('Metadata keys:', Object.keys(conv.metadata));
                console.log('Phone number:', conv.metadata.phoneNumber);
                console.log('Source:', conv.metadata.source);
                console.log('Created by:', conv.metadata.createdBy);
            } else {
                console.log('❌ METADATA DISAPPEARED!');
            }

            // Also check raw MongoDB
            const rawDoc = await Conversation.collection.findOne({ conversationId });
            console.log('\nRaw MongoDB check:');
            console.log('Raw doc has metadata field:', 'metadata' in (rawDoc || {}));
            if ('metadata' in (rawDoc || {})) {
                console.log('Raw metadata keys:', Object.keys(rawDoc.metadata || {}));
            }

        } else {
            console.log('❌ Conversation not found!');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

checkCurrentConvo(); 