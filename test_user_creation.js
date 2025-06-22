const mongoose = require('mongoose');
const { findUser, createUser } = require('./api/models');

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/LibreChat';

async function testUserCreation() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const phoneNumber = '+19709788817';

        // First, check if user already exists
        console.log('\n1. Checking for existing user...');
        let existingUser = await findUser({
            $or: [
                { phoneNumber: phoneNumber },
                { 'metadata.phoneNumber': phoneNumber }
            ]
        });

        if (existingUser) {
            console.log('Found existing user:', {
                id: existingUser._id.toString(),
                phoneNumber: existingUser.phoneNumber,
                email: existingUser.email,
                username: existingUser.username,
                metadata: existingUser.metadata
            });
        } else {
            console.log('No existing user found');
        }

        // Try to create a new user (with different phone to avoid conflicts)
        const testPhone = '+19709788818';
        console.log('\n2. Testing user creation with phone:', testPhone);

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
                        defaultModel: 'gpt-4.1',
                        endpoint: 'openai'
                    }
                }
            }, true, true);

            console.log('Successfully created test user:', {
                id: newUser._id.toString(),
                phoneNumber: newUser.phoneNumber,
                email: newUser.email,
                username: newUser.username,
                metadata: newUser.metadata
            });

            // Clean up test user
            console.log('\n3. Cleaning up test user...');
            await mongoose.model('User').deleteOne({ _id: newUser._id });
            console.log('Test user deleted');

        } catch (createError) {
            console.error('Error creating test user:', createError);
        }

        // Check total user count
        console.log('\n4. Total users in database:');
        const userCount = await mongoose.model('User').countDocuments();
        console.log('Total users:', userCount);

        // List all users with phone numbers
        console.log('\n5. Users with phone numbers:');
        const usersWithPhones = await mongoose.model('User').find({
            phoneNumber: { $exists: true, $ne: null }
        }).select('_id phoneNumber email username metadata.phoneNumber');

        console.log('Users with phone numbers:', usersWithPhones);

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

testUserCreation(); 