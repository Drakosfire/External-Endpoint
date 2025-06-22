const mongoose = require('mongoose');
require('dotenv').config();

// Import the actual Conversation model
const Conversation = require('./api/models/schema/convoSchema');

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/LibreChat';

async function testMongooseMetadata() {
    console.log('=== Testing Mongoose Metadata Operations ===\n');

    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB via Mongoose');

        const testConversationId = 'mongoose-test-' + Date.now();

        // Test 1: Create using Mongoose model with metadata
        console.log('\n1. Testing Mongoose model creation with metadata...');
        const testConvo = new Conversation({
            conversationId: testConversationId,
            title: 'Mongoose Metadata Test',
            endpoint: 'test',
            user: 'test-user',
            metadata: {
                phoneNumber: '+19709788817',
                source: 'sms',
                createdBy: 'mongoose-test',
                testField: 'mongoose-value'
            }
        });

        // Log the object before saving
        console.log('   Before save - metadata:', testConvo.metadata);
        console.log('   Before save - has phoneNumber:', !!testConvo.metadata?.phoneNumber);

        const saved = await testConvo.save();
        console.log(`   ✅ Saved conversation: ${saved.conversationId}`);
        console.log('   After save - metadata:', saved.metadata);
        console.log('   After save - has phoneNumber:', !!saved.metadata?.phoneNumber);

        // Test 2: Retrieve using Mongoose
        console.log('\n2. Retrieving via Mongoose...');
        const retrieved = await Conversation.findOne({ conversationId: testConversationId });

        if (retrieved) {
            console.log(`   ✅ Retrieved: ${retrieved.conversationId}`);
            console.log('   Retrieved metadata:', retrieved.metadata);
            console.log('   Has phoneNumber:', !!retrieved.metadata?.phoneNumber);
        } else {
            console.log('   ❌ Could not retrieve');
        }

        // Test 3: findOneAndUpdate using Mongoose
        console.log('\n3. Testing Mongoose findOneAndUpdate...');
        const updateData = {
            title: 'Updated Mongoose Test',
            metadata: {
                phoneNumber: '+19709788817',
                source: 'sms',
                createdBy: 'mongoose-update',
                updateField: 'updated-value'
            }
        };

        console.log('   Update data metadata:', updateData.metadata);

        const updated = await Conversation.findOneAndUpdate(
            { conversationId: testConversationId },
            { $set: updateData },
            { new: true, upsert: false }
        );

        if (updated) {
            console.log(`   ✅ Updated: ${updated.conversationId}`);
            console.log('   Updated metadata:', updated.metadata);
            console.log('   Has phoneNumber:', !!updated.metadata?.phoneNumber);
        } else {
            console.log('   ❌ Could not update');
        }

        // Test 4: Query by metadata using Mongoose
        console.log('\n4. Testing Mongoose query by metadata...');
        const queryResult = await Conversation.find({
            'metadata.phoneNumber': '+19709788817'
        });

        console.log(`   Found ${queryResult.length} conversations with this phone number`);
        if (queryResult.length > 0) {
            console.log('   First result metadata:', queryResult[0].metadata);
        }

        // Test 5: Check schema paths
        console.log('\n5. Checking Mongoose schema paths...');
        const schemaFields = Object.keys(Conversation.schema.paths);
        console.log('   Schema has metadata field:', schemaFields.includes('metadata'));
        console.log('   Metadata field type:', Conversation.schema.paths.metadata?.instance);
        console.log('   Schema fields count:', schemaFields.length);

        // Cleanup
        console.log('\n6. Cleaning up...');
        await Conversation.deleteOne({ conversationId: testConversationId });
        console.log('   ✅ Test conversation deleted');

    } catch (error) {
        console.error('Error testing Mongoose metadata:', error);
        console.error('Stack:', error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

testMongooseMetadata().catch(console.error); 