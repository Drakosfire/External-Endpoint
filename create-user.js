// Switch to LibreChat database
db = db.getSiblingDB('LibreChat');

// Create LibreChat user with read/write permissions
print('Creating LibreChat database user...');
db.createUser({
    user: 'LibreChat_user',
    pwd: 'q3ZrDjcrvlrk+wMEIJRklIz0xLmbKFoOgeIepP3UpqA=',
    roles: [
        { role: 'readWrite', db: 'LibreChat' },
        { role: 'dbAdmin', db: 'LibreChat' }
    ]
});

print('LibreChat user created successfully!');
