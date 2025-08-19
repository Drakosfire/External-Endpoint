// MongoDB initialization script for LibreChat
// This script runs when MongoDB container first starts

print('Starting MongoDB initialization for LibreChat...');

// Switch to LibreChat database
db = db.getSiblingDB('LibreChat');

// Create LibreChat user with read/write permissions
print('Creating LibreChat database user...');
db.createUser({
    user: 'librechat_user',
    pwd: process.env.MONGO_PASSWORD || 'CHANGE_THIS_PASSWORD_IMMEDIATELY',
    roles: [
        { role: 'readWrite', db: 'LibreChat' },
        { role: 'dbAdmin', db: 'LibreChat' }
    ]
});

// Create indexes for better performance
print('Creating database indexes...');
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "phoneNumber": 1 }, { sparse: true });
db.conversations.createIndex({ "user": 1, "createdAt": -1 });
db.messages.createIndex({ "conversationId": 1, "createdAt": 1 });

print('MongoDB initialization complete!');
print('⚠️  IMPORTANT: Change the default password immediately!');

