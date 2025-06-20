#!/usr/bin/env node
/**
 * MongoDB Message Query Script for LibreChat
 * 
 * This script helps you find and analyze individual messages in the MongoDB database.
 * Make sure to set your MONGO_URI environment variable before running.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDb = require('./lib/db/connectDb');

// Import the Message model
const Message = require('./models/schema/messageSchema');

async function queryMessages() {
    try {
        // Connect to MongoDB
        await connectDb();
        console.log('✅ Connected to MongoDB');

        // Example queries - uncomment the ones you want to use

        // 1. Find messages by conversation ID
        // const conversationId = 'your-conversation-id-here';
        // const messagesByConvo = await Message.find({ conversationId }).sort({ createdAt: 1 });
        // console.log(`Found ${messagesByConvo.length} messages in conversation ${conversationId}`);

        // 2. Find messages by user
        // const userId = 'your-user-id-here';
        // const messagesByUser = await Message.find({ user: userId }).limit(10).sort({ createdAt: -1 });
        // console.log(`Latest 10 messages by user ${userId}:`);
        // messagesByUser.forEach(msg => {
        //     console.log(`- ${msg.messageId}: ${msg.text?.substring(0, 100)}...`);
        // });

        // 3. Find messages with specific text content
        // const searchText = 'your-search-term';
        // const messagesWithText = await Message.find({ 
        //     text: { $regex: searchText, $options: 'i' } 
        // }).limit(10);
        // console.log(`Found ${messagesWithText.length} messages containing "${searchText}"`);

        // 4. Find external messages (like SMS)
        const externalMessages = await Message.find({
            role: 'external'
        }).limit(10).sort({ createdAt: -1 });
        console.log(`\n📱 Found ${externalMessages.length} external messages:`);
        externalMessages.forEach(msg => {
            console.log(`- ID: ${msg.messageId}`);
            console.log(`  Conversation: ${msg.conversationId}`);
            console.log(`  User: ${msg.user}`);
            console.log(`  Text: ${msg.text?.substring(0, 150)}...`);
            console.log(`  Created: ${msg.createdAt}`);
            console.log(`  Sender: ${msg.sender || 'N/A'}`);
            console.log('---');
        });

        // 5. Find messages by specific messageId
        // const messageId = 'your-message-id-here';
        // const specificMessage = await Message.findOne({ messageId });
        // if (specificMessage) {
        //     console.log(`\n📄 Message Details:`);
        //     console.log(JSON.stringify(specificMessage.toObject(), null, 2));
        // }

        // 6. Find recent messages with errors
        const errorMessages = await Message.find({
            error: true
        }).limit(5).sort({ createdAt: -1 });
        console.log(`\n❌ Found ${errorMessages.length} recent error messages:`);
        errorMessages.forEach(msg => {
            console.log(`- ${msg.messageId}: ${msg.text?.substring(0, 100)}...`);
            console.log(`  Created: ${msg.createdAt}`);
        });

        // 7. Get message statistics
        const totalMessages = await Message.countDocuments();
        const userMessages = await Message.countDocuments({ isCreatedByUser: true });
        const assistantMessages = await Message.countDocuments({ isCreatedByUser: false });
        const externalCount = await Message.countDocuments({ role: 'external' });

        console.log(`\n📊 Database Statistics:`);
        console.log(`- Total messages: ${totalMessages}`);
        console.log(`- User messages: ${userMessages}`);
        console.log(`- Assistant messages: ${assistantMessages}`);
        console.log(`- External messages: ${externalCount}`);

        // 8. Find messages by date range
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const recentMessages = await Message.countDocuments({
            createdAt: { $gte: yesterday }
        });
        console.log(`- Messages in last 24h: ${recentMessages}`);

    } catch (error) {
        console.error('❌ Error querying messages:', error);
    } finally {
        // Close the connection
        await mongoose.connection.close();
        console.log('\n✅ Database connection closed');
    }
}

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
📋 LibreChat Message Query Tool

Usage: node query_messages.js [options]

Options:
  --help, -h          Show this help message
  --conversation-id   Query by conversation ID
  --user-id          Query by user ID  
  --search-text      Search for text content
  --message-id       Find specific message by ID
  --external         Show external messages only
  --errors          Show error messages only
  --stats           Show database statistics only

Examples:
  node query_messages.js --stats
  node query_messages.js --external
  node query_messages.js --search-text "hello world"
  node query_messages.js --conversation-id "conv-123"
        `);
        process.exit(0);
    }

    // Handle command line arguments
    if (args.includes('--conversation-id')) {
        const convId = args[args.indexOf('--conversation-id') + 1];
        if (convId) {
            queryByConversationId(convId);
            return;
        }
    }

    if (args.includes('--user-id')) {
        const userId = args[args.indexOf('--user-id') + 1];
        if (userId) {
            queryByUserId(userId);
            return;
        }
    }

    if (args.includes('--message-id')) {
        const msgId = args[args.indexOf('--message-id') + 1];
        if (msgId) {
            queryByMessageId(msgId);
            return;
        }
    }

    if (args.includes('--search-text')) {
        const searchText = args[args.indexOf('--search-text') + 1];
        if (searchText) {
            queryByText(searchText);
            return;
        }
    }

    // Default: run the main query function
    queryMessages();
}

// Specific query functions
async function queryByConversationId(conversationId) {
    try {
        await connectDb();
        console.log(`🔍 Searching for messages in conversation: ${conversationId}`);

        const messages = await Message.find({ conversationId })
            .sort({ createdAt: 1 });

        console.log(`\n📋 Found ${messages.length} messages:`);
        messages.forEach((msg, index) => {
            console.log(`${index + 1}. [${msg.role || 'unknown'}] ${msg.messageId}`);
            console.log(`   User: ${msg.user}`);
            console.log(`   Text: ${msg.text?.substring(0, 200)}...`);
            console.log(`   Created: ${msg.createdAt}`);
            console.log('');
        });
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
    }
}

async function queryByUserId(userId) {
    try {
        await connectDb();
        console.log(`🔍 Searching for messages by user: ${userId}`);

        const messages = await Message.find({ user: userId })
            .limit(20)
            .sort({ createdAt: -1 });

        console.log(`\n📋 Found ${messages.length} recent messages:`);
        messages.forEach((msg, index) => {
            console.log(`${index + 1}. ${msg.messageId}`);
            console.log(`   Conversation: ${msg.conversationId}`);
            console.log(`   Text: ${msg.text?.substring(0, 150)}...`);
            console.log(`   Created: ${msg.createdAt}`);
            console.log('');
        });
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
    }
}

async function queryByMessageId(messageId) {
    try {
        await connectDb();
        console.log(`🔍 Searching for message: ${messageId}`);

        const message = await Message.findOne({ messageId });

        if (message) {
            console.log(`\n📄 Message Found:`);
            console.log(JSON.stringify(message.toObject(), null, 2));
        } else {
            console.log(`❌ Message not found: ${messageId}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
    }
}

async function queryByText(searchText) {
    try {
        await connectDb();
        console.log(`🔍 Searching for messages containing: "${searchText}"`);

        const messages = await Message.find({
            text: { $regex: searchText, $options: 'i' }
        }).limit(10).sort({ createdAt: -1 });

        console.log(`\n📋 Found ${messages.length} messages:`);
        messages.forEach((msg, index) => {
            console.log(`${index + 1}. ${msg.messageId}`);
            console.log(`   User: ${msg.user}`);
            console.log(`   Conversation: ${msg.conversationId}`);
            console.log(`   Text: ${msg.text?.substring(0, 200)}...`);
            console.log(`   Created: ${msg.createdAt}`);
            console.log('');
        });
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
    }
}

module.exports = {
    queryMessages,
    queryByConversationId,
    queryByUserId,
    queryByMessageId,
    queryByText
}; 